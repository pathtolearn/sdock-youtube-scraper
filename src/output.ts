import type { OutputRecord, SourceKind, SourceSummary, YoutubeVideo } from "./types";

export function buildSourceSummaryRecord(params: {
  sourceKind: SourceKind;
  sourceId: string;
  sourceInput: string;
  sourceUrl: string | null;
  summary: SourceSummary;
  runContext?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  fetchedAt?: string;
}): OutputRecord {
  return {
    recordType: "source_summary",
    sourceKind: params.sourceKind,
    sourceId: params.sourceId,
    sourceInput: params.sourceInput,
    sourceUrl: params.sourceUrl,
    fetchedAt: params.fetchedAt || new Date().toISOString(),
    runContext: params.runContext || {},
    metadata: params.metadata || {},
    summary: params.summary,
    video: null,
  };
}

export function buildVideoRecord(params: {
  sourceKind: SourceKind;
  sourceId: string;
  sourceInput: string;
  sourceUrl: string | null;
  video: YoutubeVideo;
  runContext?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  fetchedAt?: string;
}): OutputRecord {
  return {
    recordType: "video",
    sourceKind: params.sourceKind,
    sourceId: params.sourceId,
    sourceInput: params.sourceInput,
    sourceUrl: params.sourceUrl,
    fetchedAt: params.fetchedAt || new Date().toISOString(),
    runContext: params.runContext || {},
    metadata: params.metadata || {},
    summary: null,
    video: params.video,
  };
}

export function applyDateFilters(video: YoutubeVideo, publishedAfter: string | null, publishedBefore: string | null): boolean {
  if (!publishedAfter && !publishedBefore) {
    return true;
  }
  if (!video.publishedAt) {
    return true;
  }
  const day = video.publishedAt.slice(0, 10);
  if (publishedAfter && day < publishedAfter) {
    return false;
  }
  if (publishedBefore && day > publishedBefore) {
    return false;
  }
  return true;
}
