export type CrawlerType = "camoufox" | "playwright" | "http:fast";
export type VideoDetailMode = "full" | "listing_only";
export type SearchSort = "relevance" | "upload_date" | "view_count";
export type SearchDateFilter = "any" | "hour" | "today" | "week" | "month" | "year";
export type VideoType = "video" | "short" | "live";

export type SourceKind = "video_url" | "channel_url" | "playlist_url" | "search_url" | "search_term";
export type RecordType = "source_summary" | "video";

export type Thumbnail = {
  url: string;
  width: number | null;
  height: number | null;
};

export type DescriptionLink = {
  text: string | null;
  url: string;
};

export type YoutubeVideo = {
  id: string;
  url: string;
  title: string | null;
  description: string | null;
  descriptionLinks: DescriptionLink[];
  channelName: string | null;
  channelUrl: string | null;
  channelId: string | null;
  publishedAt: string | null;
  publishedLabel: string | null;
  durationSeconds: number | null;
  durationLabel: string | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  isLive: boolean | null;
  isShort: boolean | null;
  thumbnails: Thumbnail[];
  hashtags: string[];
  availability: string | null;
  language: string | null;
  captionsAvailable: boolean | null;
};

export type SourceSummaryEntityType = "video_source" | "channel" | "playlist" | "search";

export type SourceSummary = {
  entityType: SourceSummaryEntityType;
  id: string | null;
  title: string | null;
  url: string | null;
  description: string | null;
  channelName: string | null;
  channelUrl: string | null;
  itemCount: number | null;
  subscriberCount: number | null;
  totalViews: number | null;
  joinedDate: string | null;
  thumbnails: Thumbnail[];
  filtersApplied: Record<string, unknown>;
  itemsDiscovered: number;
  continuationsUsed: number;
};

export type SourceSummaryRecord = {
  recordType: "source_summary";
  sourceKind: SourceKind;
  sourceId: string;
  sourceInput: string;
  sourceUrl: string | null;
  fetchedAt: string;
  runContext: Record<string, unknown>;
  metadata: Record<string, unknown>;
  summary: SourceSummary;
  video: null;
};

export type VideoRecord = {
  recordType: "video";
  sourceKind: SourceKind;
  sourceId: string;
  sourceInput: string;
  sourceUrl: string | null;
  fetchedAt: string;
  runContext: Record<string, unknown>;
  metadata: Record<string, unknown>;
  summary: null;
  video: YoutubeVideo;
};

export type OutputRecord = SourceSummaryRecord | VideoRecord;

export type ParserDiagnostics = {
  blocked: boolean;
  blockReason?: string;
  warnings: string[];
  source?: string;
};

export type ClientContext = {
  clientName: string;
  clientVersion: string;
  hl?: string;
  gl?: string;
};

export type Continuation = {
  token: string;
  clickTrackingParams?: string;
  endpoint?: "browse" | "search";
  clientContext?: ClientContext;
};

export type ParsedPageArtifacts = {
  ytInitialData: unknown | null;
  ytInitialPlayerResponse: unknown | null;
  ytcfg: Record<string, unknown> | null;
};

export type ParsedVideoPage = {
  summary: SourceSummary;
  video: YoutubeVideo | null;
  continuation: Continuation | null;
  diagnostics: ParserDiagnostics;
};

export type ParsedListPage = {
  summary: SourceSummary;
  videos: YoutubeVideo[];
  continuation: Continuation | null;
  diagnostics: ParserDiagnostics;
};

export type QueueTaskType =
  | "seed_url"
  | "seed_search_term"
  | "fetch_video"
  | "fetch_playlist_page"
  | "fetch_channel_videos_page"
  | "fetch_search_page"
  | "fetch_continuation_page"
  | "enrich_video_detail";

export type QueueTaskMetadata = {
  taskType: QueueTaskType;
  sourceId: string;
  sourceKind: SourceKind;
  sourceInput: string;
  pageIndex?: number;
  continuationIndex?: number;
  query?: string;
  targetType?: "video" | "playlist" | "channel" | "search";
  videoId?: string;
  playlistId?: string;
  channelRef?: string;
  parentTaskId?: string;
  listingContext?: Partial<YoutubeVideo> & { videoId?: string };
  detailMode?: VideoDetailMode;
};

export type ClassifiedYoutubeUrl = {
  kind: "video" | "playlist" | "channel" | "search";
  normalizedUrl: string;
  sourceKind: Exclude<SourceKind, "search_term">;
  preferredTaskType: Extract<QueueTaskType, "fetch_video" | "fetch_playlist_page" | "fetch_channel_videos_page" | "fetch_search_page">;
  videoId?: string;
  playlistId?: string;
  channelRef?: string;
  query?: string;
};

export type YoutubeScraperInput = {
  youtubeUrls: string[];
  searchTerms: string[];
  crawlerType: CrawlerType;
  maxResults: number;
  maxResultsPerSource: number;
  maxPagesPerSource: number;
  maxRuntimeSeconds: number;
  maxIdleCycles: number;
  includeSourceSummaryRecords: boolean;
  videoDetailMode: VideoDetailMode;
  dedupeWithinSource: boolean;
  searchSort: SearchSort;
  searchDateFilter: SearchDateFilter;
  includeVideoTypes: VideoType[];
  publishedAfter: string | null;
  publishedBefore: string | null;
  countryCode: string | null;
  languageCode: string | null;
  saveRawPayloads: boolean;
  proxyRequired: boolean;
};
