import { selectEngine } from "./engine";
import { extractEmbeddedJson } from "./extractEmbeddedJson";
import { fetchHtml, fetchContinuationJson, looksBlocked } from "./http";
import { InputValidationError, parseRuntimeInput } from "./input";
import { buildSourceSummaryRecord, buildVideoRecord, applyDateFilters } from "./output";
import { parseContinuationPayload, parseChannelPage, parsePlaylistPage, parseSearchPage, parseVideoPage } from "./youtubeParsers";
import { ack, bootstrap, complete, enqueue, event, fail, lease, pushDataset } from "./runtimeClient";
import { readProxySettings, proxyRuntimeEventPayload, type RuntimeProxySettings } from "./proxy";
import { completionPolicyForStopReason, evaluateStopReason } from "./stopPolicy";
import { fetchHtmlWithBrowser } from "./browserFallback";
import { buildSearchUrlFromTerm, classifyYoutubeUrl, makeSourceId, sourceKindForSearchTerm, toSeedTaskFromClassified } from "./url";
import type { OutputRecord, QueueTaskMetadata, YoutubeScraperInput, YoutubeVideo, SourceSummary } from "./types";

const USER_AGENT = "StealthDockYouTubeScraper/1.0 (+https://stealthdock.local)";

type FailureKind = "network" | "parse" | "blocked" | "policy" | "budget" | "infra";

type SourceState = {
  pagesFetched: number;
  continuationsUsed: number;
  videoIdsSeen: Set<string>;
  sourceSummaryEmitted: boolean;
  videoCountEmitted: number;
};

function classifyFailure(error: unknown): { type: FailureKind; retryable: boolean; reason: string } {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("403") || lower.includes("429") || lower.includes("captcha") || lower.includes("blocked") || lower.includes("consent")) {
    return { type: "blocked", retryable: true, reason: message };
  }
  if (lower.includes("invalid input") || lower.includes("parse") || lower.includes("embedded json")) {
    return { type: "parse", retryable: false, reason: message };
  }
  if (lower.includes("timeout") || lower.includes("network") || lower.includes("fetch")) {
    return { type: "network", retryable: true, reason: message };
  }
  return { type: "infra", retryable: false, reason: message };
}

function asTaskMetadata(value: unknown): QueueTaskMetadata {
  const rec = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    taskType: (typeof rec.taskType === "string" ? rec.taskType : "fetch_video") as QueueTaskMetadata["taskType"],
    sourceId: typeof rec.sourceId === "string" ? rec.sourceId : "src_0000",
    sourceKind: (typeof rec.sourceKind === "string" ? rec.sourceKind : "video_url") as QueueTaskMetadata["sourceKind"],
    sourceInput: typeof rec.sourceInput === "string" ? rec.sourceInput : "",
    pageIndex: typeof rec.pageIndex === "number" ? rec.pageIndex : 0,
    continuationIndex: typeof rec.continuationIndex === "number" ? rec.continuationIndex : 0,
    query: typeof rec.query === "string" ? rec.query : undefined,
    targetType: typeof rec.targetType === "string" ? (rec.targetType as QueueTaskMetadata["targetType"]) : undefined,
    videoId: typeof rec.videoId === "string" ? rec.videoId : undefined,
    playlistId: typeof rec.playlistId === "string" ? rec.playlistId : undefined,
    channelRef: typeof rec.channelRef === "string" ? rec.channelRef : undefined,
    parentTaskId: typeof rec.parentTaskId === "string" ? rec.parentTaskId : undefined,
    listingContext: rec.listingContext && typeof rec.listingContext === "object" ? (rec.listingContext as QueueTaskMetadata["listingContext"]) : undefined,
    detailMode: rec.detailMode === "listing_only" ? "listing_only" : "full",
  };
}

function sourceStateFor(map: Map<string, SourceState>, sourceId: string): SourceState {
  const existing = map.get(sourceId);
  if (existing) {
    return existing;
  }
  const created: SourceState = {
    pagesFetched: 0,
    continuationsUsed: 0,
    videoIdsSeen: new Set<string>(),
    sourceSummaryEmitted: false,
    videoCountEmitted: 0,
  };
  map.set(sourceId, created);
  return created;
}

function shouldIncludeVideoType(video: YoutubeVideo, input: YoutubeScraperInput): boolean {
  const want = new Set(input.includeVideoTypes);
  if (video.isLive === true) {
    return want.has("live");
  }
  if (video.isShort === true) {
    return want.has("short");
  }
  return want.has("video");
}

function mergeListingAndDetail(listing: QueueTaskMetadata["listingContext"], detail: YoutubeVideo): YoutubeVideo {
  if (!listing) {
    return detail;
  }
  const merged: YoutubeVideo = { ...detail };
  for (const [key, value] of Object.entries(listing)) {
    if (value === undefined || value === null || key === "videoId") {
      continue;
    }
    if ((merged as Record<string, unknown>)[key] === null || (merged as Record<string, unknown>)[key] === undefined) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

async function fetchWithFallback(url: string, input: YoutubeScraperInput, proxySettings: RuntimeProxySettings): Promise<{ status: number; url: string; html: string; usedBrowser: boolean }> {
  const http = await fetchHtml(url, proxySettings, { "user-agent": USER_AGENT });
  const block = looksBlocked(http.status, http.html);
  const artifacts = extractEmbeddedJson(http.html);
  const missingJson = !artifacts.ytInitialData && !artifacts.ytInitialPlayerResponse;
  if (!block.blocked && !missingJson) {
    return { ...http, usedBrowser: false };
  }
  if (input.crawlerType === "http:fast") {
    if (block.blocked) {
      throw new Error(`blocked_http: ${block.reason || http.status}`);
    }
    throw new Error("parse_http: missing embedded YouTube JSON in http:fast mode");
  }
  await event("youtube.fallback_to_browser", { url, reason: block.reason || (missingJson ? "missing_embedded_json" : "unknown") }, undefined, "runtime", "Falling back to browser", "warning");
  const browser = await fetchHtmlWithBrowser(url, proxySettings);
  return { ...browser, usedBrowser: true };
}

function maybeRawPayloads(enabled: boolean, artifacts: ReturnType<typeof extractEmbeddedJson>): Record<string, unknown> | undefined {
  if (!enabled) {
    return undefined;
  }
  return {
    ytcfg_keys: artifacts.ytcfg ? Object.keys(artifacts.ytcfg).slice(0, 20) : [],
    has_initial_data: Boolean(artifacts.ytInitialData),
    has_player_response: Boolean(artifacts.ytInitialPlayerResponse),
  };
}

async function processTask(params: {
  requestId: string;
  url: string;
  metadata: QueueTaskMetadata;
  input: YoutubeScraperInput;
  proxySettings: RuntimeProxySettings;
  sourceStates: Map<string, SourceState>;
  emittedVideoCounter: { value: number };
  processedPagesCounter: { value: number };
}): Promise<{ statusCode: number; records: OutputRecord[] }> {
  const { requestId, url, metadata, input, proxySettings, sourceStates, emittedVideoCounter, processedPagesCounter } = params;
  const sourceState = sourceStateFor(sourceStates, metadata.sourceId);
  const records: OutputRecord[] = [];
  const runContextBase = { taskType: metadata.taskType, pageIndex: metadata.pageIndex ?? 0, continuationIndex: metadata.continuationIndex ?? 0 };

  const emitSourceSummary = (summary: SourceSummary, extraMeta: Record<string, unknown> = {}): void => {
    if (!input.includeSourceSummaryRecords || sourceState.sourceSummaryEmitted) {
      return;
    }
    summary.itemsDiscovered = Math.max(summary.itemsDiscovered, sourceState.videoCountEmitted);
    summary.continuationsUsed = sourceState.continuationsUsed;
    records.push(
      buildSourceSummaryRecord({
        sourceKind: metadata.sourceKind,
        sourceId: metadata.sourceId,
        sourceInput: metadata.sourceInput,
        sourceUrl: url,
        summary,
        runContext: runContextBase,
        metadata: extraMeta,
      }),
    );
    sourceState.sourceSummaryEmitted = true;
  };

  const emitVideo = (video: YoutubeVideo, extraMeta: Record<string, unknown> = {}): void => {
    if (emittedVideoCounter.value >= input.maxResults) {
      return;
    }
    if (sourceState.videoCountEmitted >= input.maxResultsPerSource) {
      return;
    }
    if (input.dedupeWithinSource && sourceState.videoIdsSeen.has(video.id)) {
      return;
    }
    if (!shouldIncludeVideoType(video, input)) {
      return;
    }
    if (!applyDateFilters(video, input.publishedAfter, input.publishedBefore)) {
      return;
    }
    sourceState.videoIdsSeen.add(video.id);
    sourceState.videoCountEmitted += 1;
    emittedVideoCounter.value += 1;
    records.push(
      buildVideoRecord({
        sourceKind: metadata.sourceKind,
        sourceId: metadata.sourceId,
        sourceInput: metadata.sourceInput,
        sourceUrl: url,
        video,
        runContext: runContextBase,
        metadata: extraMeta,
      }),
    );
  };

  const enqueueContinuation = async (token: string, endpoint: "search" | "browse" | undefined, ytcfg: Record<string, unknown> | null): Promise<void> => {
    if (sourceState.pagesFetched >= input.maxPagesPerSource) {
      return;
    }
    await enqueue([
      {
        url,
        discovered_from_request_id: requestId,
        metadata: {
          ...metadata,
          taskType: "fetch_continuation_page",
          continuationIndex: (metadata.continuationIndex ?? 0) + 1,
          pageIndex: (metadata.pageIndex ?? 0) + 1,
          targetType: metadata.targetType,
          continuation: token,
          continuationEndpoint: endpoint,
          ytcfg,
        } as Record<string, unknown>,
      },
    ]);
  };

  if (metadata.taskType === "fetch_continuation_page") {
    const anyMeta = metadata as QueueTaskMetadata & { continuation?: string; continuationEndpoint?: "browse" | "search"; ytcfg?: Record<string, unknown> | null };
    if (!anyMeta.continuation) {
      throw new Error("Continuation task missing token");
    }
    const payload = await fetchContinuationJson(
      {
        token: anyMeta.continuation,
        endpoint: anyMeta.continuationEndpoint,
        clientContext: anyMeta.ytcfg
          ? {
              clientName: String(anyMeta.ytcfg.INNERTUBE_CLIENT_NAME || "WEB"),
              clientVersion: String(anyMeta.ytcfg.INNERTUBE_CLIENT_VERSION || "2.0"),
              hl: typeof anyMeta.ytcfg.HL === "string" ? anyMeta.ytcfg.HL : undefined,
              gl: typeof anyMeta.ytcfg.GL === "string" ? anyMeta.ytcfg.GL : undefined,
            }
          : undefined,
      },
      proxySettings,
    );
    processedPagesCounter.value += 1;
    sourceState.pagesFetched += 1;
    sourceState.continuationsUsed += 1;
    const entityType = metadata.targetType === "channel" ? "channel" : metadata.targetType === "playlist" ? "playlist" : "search";
    const parsed = parseContinuationPayload(payload, url, entityType);
    if (parsed.diagnostics.blocked) {
      await event("youtube.blocked_detected", { url, reason: parsed.diagnostics.blockReason, taskType: metadata.taskType }, requestId, "parse", "Blocked content detected", "warning");
    }
    emitSourceSummary(parsed.summary, { continuation: true });
    for (const video of parsed.videos) {
      if (input.videoDetailMode === "full") {
        await enqueue([
          {
            url: video.url,
            discovered_from_request_id: requestId,
            metadata: {
              ...metadata,
              taskType: "enrich_video_detail",
              videoId: video.id,
              listingContext: video,
            } as Record<string, unknown>,
          },
        ]);
      } else {
        emitVideo(video, { source: "continuation" });
      }
    }
    if (parsed.continuation) {
      await enqueueContinuation(parsed.continuation.token, parsed.continuation.endpoint, parsed.continuation.clientContext as unknown as Record<string, unknown> | null);
    }
    return { statusCode: 200, records };
  }

  if (metadata.taskType === "enrich_video_detail") {
    const fetched = await fetchWithFallback(url, input, proxySettings);
    const artifacts = extractEmbeddedJson(fetched.html);
    const parsed = parseVideoPage(artifacts, fetched.url);
    processedPagesCounter.value += 1;
    sourceState.pagesFetched += 1;
    if (parsed.video) {
      emitVideo(mergeListingAndDetail(metadata.listingContext, parsed.video), {
        source: parsed.diagnostics.source,
        fetched_status: fetched.status,
        fetched_engine: fetched.usedBrowser ? "browser" : "http",
        raw: maybeRawPayloads(input.saveRawPayloads, artifacts),
      });
    }
    return { statusCode: fetched.status, records };
  }

  const fetched = await fetchWithFallback(url, input, proxySettings);
  const block = looksBlocked(fetched.status, fetched.html);
  if (block.blocked) {
    await event("youtube.blocked_detected", { url, reason: block.reason }, requestId, "fetch", "Blocked response detected", "warning");
  }
  const artifacts = extractEmbeddedJson(fetched.html);
  processedPagesCounter.value += 1;
  sourceState.pagesFetched += 1;

  if (metadata.taskType === "fetch_video") {
    const parsed = parseVideoPage(artifacts, fetched.url);
    emitSourceSummary(parsed.summary, {
      source: parsed.diagnostics.source,
      fetched_status: fetched.status,
      fetched_engine: fetched.usedBrowser ? "browser" : "http",
      raw: maybeRawPayloads(input.saveRawPayloads, artifacts),
    });
    if (parsed.video) {
      emitVideo(parsed.video, {
        source: parsed.diagnostics.source,
        fetched_status: fetched.status,
        fetched_engine: fetched.usedBrowser ? "browser" : "http",
      });
    }
    return { statusCode: fetched.status, records };
  }

  const filtersApplied = metadata.sourceKind === "search_term"
    ? {
        searchSort: input.searchSort,
        searchDateFilter: input.searchDateFilter,
        includeVideoTypes: input.includeVideoTypes,
        publishedAfter: input.publishedAfter,
        publishedBefore: input.publishedBefore,
      }
    : {};

  const parsedList = metadata.taskType === "fetch_playlist_page"
    ? parsePlaylistPage(artifacts, fetched.url)
    : metadata.taskType === "fetch_channel_videos_page"
      ? parseChannelPage(artifacts, fetched.url)
      : parseSearchPage(artifacts, fetched.url, filtersApplied);

  parsedList.summary.continuationsUsed = sourceState.continuationsUsed;
  emitSourceSummary(parsedList.summary, {
    source: parsedList.diagnostics.source,
    fetched_status: fetched.status,
    fetched_engine: fetched.usedBrowser ? "browser" : "http",
    raw: maybeRawPayloads(input.saveRawPayloads, artifacts),
  });

  for (const video of parsedList.videos) {
    if (input.videoDetailMode === "full") {
      await enqueue([
        {
          url: video.url,
          discovered_from_request_id: requestId,
          metadata: {
            ...metadata,
            taskType: "enrich_video_detail",
            videoId: video.id,
            listingContext: video,
          } as Record<string, unknown>,
        },
      ]);
    } else {
      emitVideo(video, { source: parsedList.diagnostics.source, page_kind: metadata.taskType });
    }
  }

  if (parsedList.continuation && sourceState.pagesFetched < input.maxPagesPerSource) {
    try {
      await enqueueContinuation(parsedList.continuation.token, parsedList.continuation.endpoint, artifacts.ytcfg);
    } catch (error) {
      await event(
        "youtube.continuation_failed",
        { url, error: error instanceof Error ? error.message : String(error) },
        requestId,
        "pagination",
        "Failed to enqueue continuation",
        "warning",
      );
    }
  }

  return { statusCode: fetched.status, records };
}

async function seedInitialTasks(input: YoutubeScraperInput): Promise<void> {
  const items: Array<{ url: string; metadata: Record<string, unknown> }> = [];
  let index = 1;

  for (const startUrl of input.youtubeUrls) {
    const sourceId = makeSourceId(index++);
    const classified = classifyYoutubeUrl(startUrl);
    const seed = toSeedTaskFromClassified(classified, sourceId, startUrl, input.videoDetailMode);
    items.push({ url: seed.url, metadata: seed.metadata as Record<string, unknown> });
  }

  for (const term of input.searchTerms) {
    const sourceId = makeSourceId(index++);
    const searchUrl = buildSearchUrlFromTerm(term, input);
    items.push({
      url: searchUrl,
      metadata: {
        taskType: "fetch_search_page",
        sourceId,
        sourceKind: sourceKindForSearchTerm(),
        sourceInput: term,
        query: term,
        targetType: "search",
        pageIndex: 0,
        continuationIndex: 0,
        detailMode: input.videoDetailMode,
      },
    });
  }

  if (items.length > 0) {
    await enqueue(items);
  }
}

async function main(): Promise<void> {
  const runtime = await bootstrap();
  let input: YoutubeScraperInput;
  try {
    input = parseRuntimeInput(runtime.run.input || {});
  } catch (error) {
    const message = error instanceof InputValidationError ? error.message : "Invalid input";
    await event("runtime.input_invalid", { error: message }, undefined, "runtime", message, "error");
    throw new Error(`Invalid input: ${message}`);
  }

  const proxySettings = readProxySettings();
  const engine = selectEngine(input.crawlerType);
  if (engine.fallbackReason) {
    await event("engine.fallback", engine as unknown as Record<string, unknown>, undefined, "runtime", "Camoufox unavailable; fallback to Playwright", "warning");
  }
  await event("proxy.detected", proxyRuntimeEventPayload(proxySettings), undefined, "runtime", "Proxy settings detected");
  await event(
    "runtime.started",
    {
      requested_engine: input.crawlerType,
      selected_engine: engine.selected,
      proxy_required: input.proxyRequired,
      start_url_count: input.youtubeUrls.length,
      search_term_count: input.searchTerms.length,
    },
    undefined,
    "runtime",
  );

  await seedInitialTasks(input);

  const sourceStates = new Map<string, SourceState>();
  const emittedVideoCounter = { value: 0 };
  const processedPagesCounter = { value: 0 };
  const startedAtMs = Date.now();
  let idleCycles = 0;
  const workerId = `${process.env.HOSTNAME || "worker"}-${Date.now()}`;
  let consecutiveBlocked = 0;

  while (true) {
    const stopReason = evaluateStopReason({
      startedAtMs,
      nowMs: Date.now(),
      maxRuntimeSeconds: input.maxRuntimeSeconds,
      processedPages: processedPagesCounter.value,
      maxPages: Math.max(input.maxPagesPerSource * (input.youtubeUrls.length + input.searchTerms.length) * 5, 10),
      emittedResults: emittedVideoCounter.value,
      maxResults: input.maxResults,
      idleCycles,
      maxIdleCycles: input.maxIdleCycles,
      queueDrainedIdleThreshold: Math.min(2, input.maxIdleCycles),
    });
    if (stopReason) {
      const completion = completionPolicyForStopReason(stopReason);
      await event("runtime.completed", { stop_reason: stopReason, emitted_videos: emittedVideoCounter.value, processed_pages: processedPagesCounter.value }, undefined, "runtime");
      await complete({
        outcome: completion.outcome,
        stop_reason: completion.stopReason,
        remaining_policy: completion.remainingPolicy,
        remaining_failure_type: completion.remainingFailureType,
        remaining_failure_reason: completion.remainingFailureReason,
        metrics: {
          emitted_videos: emittedVideoCounter.value,
          processed_pages: processedPagesCounter.value,
          sources_seen: sourceStates.size,
        },
      });
      return;
    }

    const leased = await lease(workerId, 3, 60);
    if (leased.length === 0) {
      idleCycles += 1;
      continue;
    }
    idleCycles = 0;

    for (const item of leased) {
      const started = Date.now();
      const metadata = asTaskMetadata(item.metadata);
      try {
        const result = await processTask({
          requestId: item.request_id,
          url: item.url,
          metadata,
          input,
          proxySettings,
          sourceStates,
          emittedVideoCounter,
          processedPagesCounter,
        });
        consecutiveBlocked = 0;
        if (result.records.length > 0) {
          await pushDataset(result.records as Array<Record<string, unknown>>);
        }
        await ack(item.request_id, result.statusCode, Date.now() - started, {
          taskType: metadata.taskType,
          emitted_records: result.records.length,
        });
        if (processedPagesCounter.value % 10 === 0) {
          await event("runtime.progress", { emitted_videos: emittedVideoCounter.value, processed_pages: processedPagesCounter.value }, item.request_id, "runtime");
        }
      } catch (error) {
        const failure = classifyFailure(error);
        if (failure.type === "blocked") {
          consecutiveBlocked += 1;
          await event("youtube.blocked_detected", { url: item.url, error: failure.reason, consecutive_blocked: consecutiveBlocked }, item.request_id, "fetch", failure.reason, "warning");
          if (input.proxyRequired && !proxySettings.enabled && consecutiveBlocked >= 2) {
            await fail(item.request_id, "blocked", `${failure.reason}; proxy required and not configured`, false, null, Date.now() - started);
            await complete({
              outcome: "failed",
              stop_reason: "blocked_no_proxy",
              remaining_policy: "fail_remaining",
              remaining_failure_type: "blocked",
              remaining_failure_reason: "Repeated blocked responses without proxy while proxyRequired=true",
              metrics: { emitted_videos: emittedVideoCounter.value, processed_pages: processedPagesCounter.value },
            });
            return;
          }
        }
        await fail(item.request_id, failure.type, failure.reason, failure.retryable, null, Date.now() - started);
      }
    }
  }
}

main().catch(async (error) => {
  try {
    await event("runtime.completed", { outcome: "failed", error: error instanceof Error ? error.message : String(error) }, undefined, "runtime", "Actor failed", "error");
    await complete({
      outcome: "failed",
      stop_reason: "unhandled_error",
      remaining_policy: "fail_remaining",
      remaining_failure_type: "infra",
      remaining_failure_reason: error instanceof Error ? error.message : String(error),
    });
  } catch {
    // ignore secondary failure during shutdown
  }
  process.exitCode = 1;
});
