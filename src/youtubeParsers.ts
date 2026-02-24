import type {
  ClientContext,
  Continuation,
  ParsedListPage,
  ParsedPageArtifacts,
  ParsedVideoPage,
  ParserDiagnostics,
  SourceSummary,
  Thumbnail,
  YoutubeVideo,
} from "./types";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function textFromRuns(value: unknown): string | null {
  const rec = asRecord(value);
  if (!rec) {
    return null;
  }
  if (typeof rec.simpleText === "string") {
    return rec.simpleText;
  }
  const runs = asArray(rec.runs);
  const joined = runs
    .map((run) => {
      const r = asRecord(run);
      return typeof r?.text === "string" ? r.text : "";
    })
    .join("")
    .trim();
  return joined || null;
}

function thumbnailArray(value: unknown): Thumbnail[] {
  const thumbs = asArray(asRecord(value)?.thumbnails);
  return thumbs
    .map((item) => {
      const r = asRecord(item);
      if (!r || typeof r.url !== "string") {
        return null;
      }
      return {
        url: r.url,
        width: typeof r.width === "number" ? r.width : null,
        height: typeof r.height === "number" ? r.height : null,
      } satisfies Thumbnail;
    })
    .filter((item): item is Thumbnail => Boolean(item));
}

function parseCount(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const normalized = value.replace(/,/g, "").trim();
  const plain = normalized.match(/(-?\d+)/);
  if (plain && !/[KMBT]/i.test(normalized)) {
    return Number.parseInt(plain[1], 10);
  }
  const short = normalized.match(/([\d.]+)\s*([KMBT])/i);
  if (!short) {
    return plain ? Number.parseInt(plain[1], 10) : null;
  }
  const base = Number.parseFloat(short[1]);
  const mult = { K: 1_000, M: 1_000_000, B: 1_000_000_000, T: 1_000_000_000_000 }[short[2].toUpperCase() as "K" | "M" | "B" | "T"];
  return Number.isFinite(base) ? Math.round(base * mult) : null;
}

function parseDurationSeconds(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parts = value.split(":").map((p) => Number.parseInt(p, 10));
  if (parts.some((n) => !Number.isFinite(n))) {
    return null;
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return null;
}

function extractDescriptionLinks(text: string | null): { text: string | null; url: string }[] {
  if (!text) {
    return [];
  }
  const links = text.match(/https?:\/\/[^\s)]+/g) || [];
  return links.map((url) => ({ text: url, url }));
}

function extractHashtags(text: string | null): string[] {
  if (!text) {
    return [];
  }
  const set = new Set<string>();
  for (const match of text.matchAll(/(^|\s)(#[\p{L}\p{N}_-]+)/gu)) {
    set.add(match[2]);
  }
  return [...set];
}

function walk(value: unknown, visitor: (node: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      walk(item, visitor);
    }
    return;
  }
  const rec = asRecord(value);
  if (!rec) {
    return;
  }
  visitor(rec);
  for (const child of Object.values(rec)) {
    walk(child, visitor);
  }
}

function pickRenderer(root: unknown, names: string[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  walk(root, (node) => {
    for (const name of names) {
      const child = asRecord(node[name]);
      if (child) {
        out.push(child);
      }
    }
  });
  return out;
}

function firstRenderer(root: unknown, names: string[]): Record<string, unknown> | null {
  return pickRenderer(root, names)[0] || null;
}

function continuationFromNode(root: unknown, ytcfg: Record<string, unknown> | null): Continuation | null {
  let token: string | null = null;
  let endpoint: "browse" | "search" | undefined;
  walk(root, (node) => {
    if (token) {
      return;
    }
    const cmd = asRecord(node.continuationCommand);
    if (typeof cmd?.token === "string") {
      token = cmd.token;
    }
    const nextData = asRecord(node.nextContinuationData);
    if (typeof nextData?.continuation === "string") {
      token = nextData.continuation;
    }
    const continuationItem = asRecord(node.continuationEndpoint);
    if (continuationItem) {
      if (asRecord(continuationItem.searchEndpoint)) {
        endpoint = "search";
      }
      if (asRecord(continuationItem.browseEndpoint)) {
        endpoint = "browse";
      }
    }
    const commandExecutor = asRecord(node.commandExecutorCommand);
    const commands = asArray(commandExecutor?.commands);
    for (const c of commands) {
      const cRec = asRecord(c);
      const contCmd = asRecord(cRec?.continuationCommand);
      if (typeof contCmd?.token === "string") {
        token = contCmd.token;
        return;
      }
    }
  });
  if (!token) {
    return null;
  }
  const clientContext: ClientContext | undefined = ytcfg
    ? {
        clientName: String(ytcfg.INNERTUBE_CLIENT_NAME || "WEB"),
        clientVersion: String(ytcfg.INNERTUBE_CLIENT_VERSION || "2.0"),
        hl: typeof ytcfg.HL === "string" ? ytcfg.HL : undefined,
        gl: typeof ytcfg.GL === "string" ? ytcfg.GL : undefined,
      }
    : undefined;
  return { token, endpoint, clientContext };
}

function canonicalVideoUrl(id: string, rawUrl?: string | null): string {
  if (rawUrl && /^https?:\/\//.test(rawUrl)) {
    return rawUrl;
  }
  return `https://www.youtube.com/watch?v=${id}`;
}

function inferVideoType(renderer: Record<string, unknown>): { isLive: boolean | null; isShort: boolean | null } {
  const badges = pickRenderer(renderer, ["metadataBadgeRenderer"]);
  const texts = badges.map((b) => textFromRuns(b.label) || "").join(" ").toLowerCase();
  const overlay = JSON.stringify(renderer).toLowerCase();
  const isLive = texts.includes("live") || overlay.includes("livebadge") ? true : null;
  const isShort = overlay.includes("shorts") || texts.includes("short") ? true : null;
  return { isLive, isShort };
}

function videoFromRenderer(renderer: Record<string, unknown>, fallbackUrl?: string): YoutubeVideo | null {
  const videoId = (typeof renderer.videoId === "string" ? renderer.videoId : undefined)
    || (typeof renderer.video_id === "string" ? renderer.video_id : undefined);
  if (!videoId) {
    return null;
  }

  const title = textFromRuns(renderer.title) || textFromRuns(renderer.headline);
  const descSnippet = textFromRuns(renderer.descriptionSnippet) || textFromRuns(renderer.descriptionText) || null;
  const longBylineRuns = asArray(asRecord(renderer.longBylineText)?.runs);
  const channelRun = asRecord(longBylineRuns[0]);
  const channelName = typeof channelRun?.text === "string" ? channelRun.text : textFromRuns(renderer.ownerText);
  const channelUrl = (() => {
    const browse = asRecord(asRecord(channelRun?.navigationEndpoint)?.browseEndpoint);
    const browseId = typeof browse?.browseId === "string" ? browse.browseId : null;
    if (browseId) {
      return `https://www.youtube.com/channel/${browseId}`;
    }
    return null;
  })();

  const publishedLabel = textFromRuns(renderer.publishedTimeText)
    || textFromRuns(renderer.publishedTime)
    || textFromRuns(renderer.dateText);
  const durationLabel = textFromRuns(renderer.lengthText)
    || textFromRuns(asRecord(renderer.thumbnailOverlays)?.thumbnailOverlayTimeStatusRenderer)
    || textFromRuns(renderer.durationText);
  const viewText = textFromRuns(renderer.viewCountText) || textFromRuns(renderer.shortViewCountText);
  const thumbs = thumbnailArray(renderer.thumbnail);
  const desc = descSnippet;
  const typeFlags = inferVideoType(renderer);

  const bylineRuns = asArray(asRecord(renderer.ownerText)?.runs);
  const ownerRun = asRecord(bylineRuns[0]);
  const channelNameResolved = channelName || (typeof ownerRun?.text === "string" ? ownerRun.text : null);

  return {
    id: videoId,
    url: canonicalVideoUrl(videoId, fallbackUrl),
    title,
    description: desc,
    descriptionLinks: extractDescriptionLinks(desc),
    channelName: channelNameResolved,
    channelUrl,
    channelId: channelUrl ? channelUrl.split("/").pop() || null : null,
    publishedAt: null,
    publishedLabel,
    durationSeconds: parseDurationSeconds(durationLabel),
    durationLabel,
    viewCount: parseCount(viewText),
    likeCount: null,
    commentCount: null,
    isLive: typeFlags.isLive,
    isShort: typeFlags.isShort,
    thumbnails: thumbs,
    hashtags: extractHashtags(desc),
    availability: null,
    language: null,
    captionsAvailable: null,
  };
}

function mergeVideo(base: YoutubeVideo, detail: Partial<YoutubeVideo>): YoutubeVideo {
  const out = { ...base };
  (Object.keys(detail) as Array<keyof YoutubeVideo>).forEach((k) => {
    const v = detail[k];
    if (v !== undefined && v !== null) {
      (out as Record<string, unknown>)[k] = v;
    }
  });
  if (detail.description !== undefined) {
    out.description = detail.description ?? out.description;
    out.descriptionLinks = extractDescriptionLinks(out.description);
    out.hashtags = extractHashtags(out.description);
  }
  return out;
}

function defaultDiagnostics(source: string): ParserDiagnostics {
  return { blocked: false, warnings: [], source };
}

function blockedByArtifacts(artifacts: ParsedPageArtifacts): string | null {
  if (!artifacts.ytInitialData && !artifacts.ytInitialPlayerResponse) {
    return "missing_embedded_json";
  }
  return null;
}

function makeEmptySummary(entityType: SourceSummary["entityType"], url: string, filtersApplied: Record<string, unknown> = {}): SourceSummary {
  return {
    entityType,
    id: null,
    title: null,
    url,
    description: null,
    channelName: null,
    channelUrl: null,
    itemCount: null,
    subscriberCount: null,
    totalViews: null,
    joinedDate: null,
    thumbnails: [],
    filtersApplied,
    itemsDiscovered: 0,
    continuationsUsed: 0,
  };
}

function parseVideoDetailsFromPlayer(player: unknown, pageUrl: string): Partial<YoutubeVideo> {
  const pr = asRecord(player);
  const details = asRecord(pr?.videoDetails);
  const micro = asRecord(asRecord(pr?.microformat)?.playerMicroformatRenderer);
  const id = typeof details?.videoId === "string" ? details.videoId : null;
  const title = typeof details?.title === "string" ? details.title : null;
  const description = typeof details?.shortDescription === "string" ? details.shortDescription : null;
  const channelName = typeof details?.author === "string" ? details.author : null;
  const channelId = typeof details?.channelId === "string" ? details.channelId : null;
  const channelUrl = channelId ? `https://www.youtube.com/channel/${channelId}` : null;
  const viewCount = typeof details?.viewCount === "string" ? parseCount(details.viewCount) : typeof details?.viewCount === "number" ? details.viewCount : null;
  const durationSeconds = typeof details?.lengthSeconds === "string" ? Number.parseInt(details.lengthSeconds, 10) : null;
  const thumbnails = thumbnailArray(details?.thumbnail);
  const keywords = asArray(details?.keywords).filter((k): k is string => typeof k === "string");
  const isLive = typeof details?.isLiveContent === "boolean" ? details.isLiveContent : null;
  const captionsAvailable = asRecord(pr?.captions) ? true : null;
  const publishedAt = typeof micro?.publishDate === "string" ? `${micro.publishDate}T00:00:00.000Z` : null;
  const language = typeof micro?.availableCountries === "string" ? micro.availableCountries : null;
  const durationLabel = Number.isFinite(durationSeconds)
    ? new Date((durationSeconds as number) * 1000).toISOString().slice(11, 19)
    : null;

  return {
    id: id || undefined,
    url: id ? canonicalVideoUrl(id, pageUrl) : pageUrl,
    title,
    description,
    descriptionLinks: description ? extractDescriptionLinks(description) : undefined,
    channelName,
    channelUrl,
    channelId,
    publishedAt,
    publishedLabel: typeof micro?.publishDate === "string" ? micro.publishDate : null,
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
    durationLabel,
    viewCount,
    thumbnails,
    hashtags: description ? extractHashtags(description) : keywords.filter((k) => k.startsWith("#")),
    isLive,
    isShort: pageUrl.includes("/shorts/") ? true : null,
    language,
    captionsAvailable,
    availability: typeof micro?.isUnlisted === "boolean" && micro.isUnlisted ? "unlisted" : null,
  };
}

function firstVideoRendererFromInitialData(initialData: unknown): Record<string, unknown> | null {
  const renderers = pickRenderer(initialData, ["videoRenderer", "compactVideoRenderer", "playlistVideoRenderer", "gridVideoRenderer"]);
  return renderers[0] || null;
}

function listVideosFromInitialData(initialData: unknown): YoutubeVideo[] {
  const rawRenderers = pickRenderer(initialData, ["videoRenderer", "playlistVideoRenderer", "gridVideoRenderer", "compactVideoRenderer"]);
  const seen = new Set<string>();
  const out: YoutubeVideo[] = [];
  for (const renderer of rawRenderers) {
    const video = videoFromRenderer(renderer);
    if (!video || seen.has(video.id)) {
      continue;
    }
    seen.add(video.id);
    out.push(video);
  }
  return out;
}

export function parseVideoPage(artifacts: ParsedPageArtifacts, pageUrl: string): ParsedVideoPage {
  const diagnostics = defaultDiagnostics("video_page");
  const blockedReason = blockedByArtifacts(artifacts);
  if (blockedReason) {
    diagnostics.blocked = true;
    diagnostics.blockReason = blockedReason;
  }

  const summary = makeEmptySummary("video_source", pageUrl);
  const playerVideo = parseVideoDetailsFromPlayer(artifacts.ytInitialPlayerResponse, pageUrl);

  let video: YoutubeVideo | null = null;
  if (playerVideo.id) {
    video = {
      id: playerVideo.id,
      url: playerVideo.url || pageUrl,
      title: playerVideo.title ?? null,
      description: playerVideo.description ?? null,
      descriptionLinks: extractDescriptionLinks(playerVideo.description ?? null),
      channelName: playerVideo.channelName ?? null,
      channelUrl: playerVideo.channelUrl ?? null,
      channelId: playerVideo.channelId ?? null,
      publishedAt: playerVideo.publishedAt ?? null,
      publishedLabel: playerVideo.publishedLabel ?? null,
      durationSeconds: playerVideo.durationSeconds ?? null,
      durationLabel: playerVideo.durationLabel ?? null,
      viewCount: playerVideo.viewCount ?? null,
      likeCount: playerVideo.likeCount ?? null,
      commentCount: playerVideo.commentCount ?? null,
      isLive: playerVideo.isLive ?? null,
      isShort: playerVideo.isShort ?? null,
      thumbnails: playerVideo.thumbnails ?? [],
      hashtags: playerVideo.hashtags ?? [],
      availability: playerVideo.availability ?? null,
      language: playerVideo.language ?? null,
      captionsAvailable: playerVideo.captionsAvailable ?? null,
    };
  }

  const fallbackRenderer = artifacts.ytInitialData ? firstVideoRendererFromInitialData(artifacts.ytInitialData) : null;
  if (fallbackRenderer) {
    const listed = videoFromRenderer(fallbackRenderer, pageUrl);
    if (listed) {
      video = video ? mergeVideo(listed, video) : listed;
    }
  }

  if (video) {
    summary.id = video.id;
    summary.title = video.title;
    summary.url = video.url;
    summary.description = video.description;
    summary.channelName = video.channelName;
    summary.channelUrl = video.channelUrl;
    summary.thumbnails = video.thumbnails;
    summary.itemCount = 1;
    summary.itemsDiscovered = 1;
  }

  return {
    summary,
    video,
    continuation: continuationFromNode(artifacts.ytInitialData, artifacts.ytcfg),
    diagnostics,
  };
}

function parseListSummaryFromRoot(entityType: SourceSummary["entityType"], root: unknown, pageUrl: string, filtersApplied: Record<string, unknown>): SourceSummary {
  const summary = makeEmptySummary(entityType, pageUrl, filtersApplied);
  const playlistHeader = firstRenderer(root, ["playlistHeaderRenderer"]);
  const channelHeader = firstRenderer(root, ["c4TabbedHeaderRenderer", "channelMetadataRenderer"]);
  const searchHeader = firstRenderer(root, ["searchHeaderRenderer"]);
  const metadata = firstRenderer(root, ["playlistMetadataRenderer", "metadataRowContainer"]);

  if (playlistHeader) {
    summary.id = typeof playlistHeader.playlistId === "string" ? playlistHeader.playlistId : null;
    summary.title = textFromRuns(playlistHeader.title) || summary.title;
    summary.channelName = textFromRuns(playlistHeader.ownerText) || summary.channelName;
    summary.itemCount = parseCount(textFromRuns(playlistHeader.numVideosText));
    summary.thumbnails = thumbnailArray(playlistHeader.playlistHeaderBanner);
  }

  if (channelHeader) {
    summary.title = textFromRuns(channelHeader.title) || summary.title;
    summary.channelName = textFromRuns(channelHeader.title) || summary.channelName;
    summary.subscriberCount = parseCount(textFromRuns(channelHeader.subscriberCountText));
    summary.totalViews = parseCount(textFromRuns(channelHeader.viewCountText));
    summary.joinedDate = textFromRuns(channelHeader.joinedDateText);
    summary.thumbnails = summary.thumbnails.length ? summary.thumbnails : thumbnailArray(channelHeader.avatar);
    if (typeof channelHeader.channelId === "string") {
      summary.id = channelHeader.channelId;
      summary.channelUrl = `https://www.youtube.com/channel/${channelHeader.channelId}`;
    }
  }

  if (searchHeader) {
    summary.title = textFromRuns(searchHeader.title) || summary.title || "Search results";
  }

  if (metadata && !summary.title) {
    summary.title = textFromRuns(metadata.title);
  }

  return summary;
}

function parseListPage(entityType: SourceSummary["entityType"], artifacts: ParsedPageArtifacts, pageUrl: string, filtersApplied: Record<string, unknown> = {}): ParsedListPage {
  const diagnostics = defaultDiagnostics(`${entityType}_page`);
  const blockedReason = blockedByArtifacts(artifacts);
  if (blockedReason) {
    diagnostics.blocked = true;
    diagnostics.blockReason = blockedReason;
  }
  const root = artifacts.ytInitialData;
  const summary = parseListSummaryFromRoot(entityType, root, pageUrl, filtersApplied);
  const videos = listVideosFromInitialData(root);
  summary.itemsDiscovered = videos.length;
  summary.itemCount = summary.itemCount ?? videos.length;

  return {
    summary,
    videos,
    continuation: continuationFromNode(root, artifacts.ytcfg),
    diagnostics,
  };
}

export function parseSearchPage(artifacts: ParsedPageArtifacts, pageUrl: string, filtersApplied: Record<string, unknown> = {}): ParsedListPage {
  return parseListPage("search", artifacts, pageUrl, filtersApplied);
}

export function parsePlaylistPage(artifacts: ParsedPageArtifacts, pageUrl: string): ParsedListPage {
  return parseListPage("playlist", artifacts, pageUrl);
}

export function parseChannelPage(artifacts: ParsedPageArtifacts, pageUrl: string): ParsedListPage {
  return parseListPage("channel", artifacts, pageUrl);
}

export function parseContinuationPayload(payload: unknown, pageUrl: string, entityType: SourceSummary["entityType"]): ParsedListPage {
  const root = asRecord(payload);
  const ytcfg = asRecord(root?.ytcfg) || null;
  return parseListPage(entityType, { ytInitialData: payload, ytInitialPlayerResponse: null, ytcfg }, pageUrl);
}
