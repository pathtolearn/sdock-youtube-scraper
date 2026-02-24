import type { ClassifiedYoutubeUrl, QueueTaskMetadata, SourceKind, YoutubeScraperInput } from "./types";

function isYoutubeHost(hostname: string): boolean {
  return ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(hostname.toLowerCase());
}

function normalizeWatchUrl(videoId: string, listId?: string | null): string {
  const url = new URL("https://www.youtube.com/watch");
  url.searchParams.set("v", videoId);
  if (listId) {
    url.searchParams.set("list", listId);
  }
  return url.toString();
}

export function normalizeYoutubeUrl(raw: string): string {
  const url = new URL(raw);
  if (!isYoutubeHost(url.hostname)) {
    throw new Error(`Unsupported YouTube host: ${url.hostname}`);
  }
  url.hash = "";
  if (url.hostname === "youtu.be") {
    const id = url.pathname.replace(/^\//, "").split("/")[0];
    if (id) {
      return normalizeWatchUrl(id, url.searchParams.get("list"));
    }
  }
  if (url.pathname.startsWith("/shorts/")) {
    const id = url.pathname.split("/")[2] || "";
    if (id) {
      return `https://www.youtube.com/shorts/${id}`;
    }
  }
  if (url.pathname.startsWith("/live/")) {
    const id = url.pathname.split("/")[2] || "";
    if (id) {
      return `https://www.youtube.com/live/${id}`;
    }
  }
  if (url.pathname === "/watch") {
    const v = url.searchParams.get("v");
    if (v) {
      return normalizeWatchUrl(v, url.searchParams.get("list"));
    }
  }
  return url.toString();
}

export function classifyYoutubeUrl(raw: string): ClassifiedYoutubeUrl {
  const normalizedUrl = normalizeYoutubeUrl(raw);
  const url = new URL(normalizedUrl);
  const path = url.pathname;

  if (path === "/watch") {
    const videoId = url.searchParams.get("v") || undefined;
    if (!videoId) {
      throw new Error("YouTube watch URL missing v parameter");
    }
    return {
      kind: "video",
      normalizedUrl,
      sourceKind: "video_url",
      preferredTaskType: "fetch_video",
      videoId,
      playlistId: url.searchParams.get("list") || undefined,
    };
  }

  if (path.startsWith("/shorts/") || path.startsWith("/live/")) {
    const videoId = path.split("/")[2] || undefined;
    if (!videoId) {
      throw new Error("YouTube URL missing video id");
    }
    return {
      kind: "video",
      normalizedUrl,
      sourceKind: "video_url",
      preferredTaskType: "fetch_video",
      videoId,
    };
  }

  if (path === "/playlist") {
    const playlistId = url.searchParams.get("list") || undefined;
    if (!playlistId) {
      throw new Error("Playlist URL missing list parameter");
    }
    return {
      kind: "playlist",
      normalizedUrl,
      sourceKind: "playlist_url",
      preferredTaskType: "fetch_playlist_page",
      playlistId,
    };
  }

  if (path === "/results") {
    const query = url.searchParams.get("search_query") || "";
    return {
      kind: "search",
      normalizedUrl,
      sourceKind: "search_url",
      preferredTaskType: "fetch_search_page",
      query,
    };
  }

  if (
    path.startsWith("/@") ||
    path.startsWith("/channel/") ||
    path.startsWith("/user/") ||
    path.startsWith("/c/")
  ) {
    const channelRef = path.replace(/\/(videos|featured|playlists|about)$/i, "");
    const normalizedChannel = new URL(`https://www.youtube.com${channelRef}`);
    normalizedChannel.pathname = `${normalizedChannel.pathname.replace(/\/$/, "")}/videos`;
    return {
      kind: "channel",
      normalizedUrl: normalizedChannel.toString(),
      sourceKind: "channel_url",
      preferredTaskType: "fetch_channel_videos_page",
      channelRef,
    };
  }

  throw new Error(`Unsupported YouTube URL path: ${path}`);
}

export function buildSearchUrlFromTerm(term: string, input: Pick<YoutubeScraperInput, "searchSort" | "searchDateFilter" | "countryCode" | "languageCode">): string {
  const url = new URL("https://www.youtube.com/results");
  url.searchParams.set("search_query", term);
  if (input.countryCode) {
    url.searchParams.set("gl", input.countryCode);
  }
  if (input.languageCode) {
    url.searchParams.set("hl", input.languageCode);
  }
  if (input.searchSort !== "relevance") {
    url.searchParams.set("stealthdock_sort", input.searchSort);
  }
  if (input.searchDateFilter !== "any") {
    url.searchParams.set("stealthdock_date", input.searchDateFilter);
  }
  return url.toString();
}

export function sourceKindForSearchTerm(): SourceKind {
  return "search_term";
}

export function makeSourceId(index: number): string {
  return `src_${String(index).padStart(4, "0")}`;
}

export function toSeedTaskFromClassified(classified: ClassifiedYoutubeUrl, sourceId: string, sourceInput: string, detailMode: QueueTaskMetadata["detailMode"]): { url: string; metadata: QueueTaskMetadata } {
  return {
    url: classified.normalizedUrl,
    metadata: {
      taskType: classified.preferredTaskType,
      sourceId,
      sourceKind: classified.sourceKind,
      sourceInput,
      videoId: classified.videoId,
      playlistId: classified.playlistId,
      channelRef: classified.channelRef,
      query: classified.query,
      targetType: classified.kind,
      pageIndex: 0,
      continuationIndex: 0,
      detailMode,
    },
  };
}
