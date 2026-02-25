import type {
  CrawlerType,
  SearchDateFilter,
  SearchSort,
  VideoDetailMode,
  VideoType,
  YoutubeScraperInput,
} from "./types";

export type { CrawlerType, SearchDateFilter, SearchSort, VideoDetailMode, VideoType, YoutubeScraperInput } from "./types";

const DEFAULTS: Omit<YoutubeScraperInput, "youtubeUrls" | "searchTerms"> = {
  crawlerType: "camoufox",
  maxResults: 200,
  maxResultsPerSource: 100,
  maxPagesPerSource: 5,
  maxRuntimeSeconds: 1800,
  maxIdleCycles: 5,
  includeSourceSummaryRecords: true,
  videoDetailMode: "full",
  dedupeWithinSource: true,
  searchSort: "relevance",
  searchDateFilter: "any",
  includeVideoTypes: ["video", "short", "live"],
  publishedAfter: null,
  publishedBefore: null,
  countryCode: null,
  languageCode: null,
  saveRawPayloads: false,
  proxyRequired: true,
};

const KNOWN_KEYS = new Set<string>([
  "youtubeUrls",
  "startUrls",
  "searchTerms",
  "crawlerType",
  "maxResults",
  "maxResultsPerSource",
  "maxPagesPerSource",
  "maxRuntimeSeconds",
  "maxIdleCycles",
  "includeSourceSummaryRecords",
  "videoDetailMode",
  "dedupeWithinSource",
  "searchSort",
  "searchDateFilter",
  "includeVideoTypes",
  "publishedAfter",
  "publishedBefore",
  "countryCode",
  "languageCode",
  "saveRawPayloads",
  "proxyRequired",
]);

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);

export class InputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputValidationError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown, key: string): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new InputValidationError(`${key} must be an array of strings`);
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw new InputValidationError(`${key} must contain only strings`);
    }
    const trimmed = item.trim();
    if (trimmed) {
      out.push(trimmed);
    }
  }
  return out;
}

function asBoolean(value: unknown, key: string, fallback: boolean): boolean {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== "boolean") {
    throw new InputValidationError(`${key} must be a boolean`);
  }
  return value;
}

function asEnum<T extends string>(value: unknown, key: string, allowed: readonly T[], fallback: T): T {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new InputValidationError(`${key} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

function asInteger(value: unknown, key: string, fallback: number, min: number, max: number): number {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || !Number.isFinite(value)) {
    throw new InputValidationError(`${key} must be an integer`);
  }
  if (value < min || value > max) {
    throw new InputValidationError(`${key} must be between ${min} and ${max}`);
  }
  return value;
}

function asNullableString(value: unknown, key: string, fallback: string | null): string | null {
  if (value === undefined) {
    return fallback;
  }
  if (value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new InputValidationError(`${key} must be a string or null`);
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeYoutubeUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new InputValidationError(`Invalid URL: ${raw}`);
  }
  const host = parsed.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) {
    throw new InputValidationError(`youtubeUrls must contain only YouTube URLs: ${raw}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new InputValidationError(`Unsupported URL protocol: ${raw}`);
  }
  parsed.hash = "";
  if (host === "youtu.be") {
    const id = parsed.pathname.replace(/^\//, "").split("/")[0];
    if (!id) {
      throw new InputValidationError(`Invalid short YouTube URL: ${raw}`);
    }
    const canonical = new URL("https://www.youtube.com/watch");
    canonical.searchParams.set("v", id);
    if (parsed.searchParams.get("list")) {
      canonical.searchParams.set("list", parsed.searchParams.get("list") as string);
    }
    return canonical.toString();
  }
  return parsed.toString();
}

function isYoutubeHomeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    // Treat the bare homepage as a non-target placeholder. A search URL is /results.
    return path === "/" && !parsed.searchParams.get("search_query");
  } catch {
    return false;
  }
}

function validateDate(value: string | null, key: string): string | null {
  if (value === null) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new InputValidationError(`${key} must be YYYY-MM-DD`);
  }
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    throw new InputValidationError(`${key} must be a valid date`);
  }
  return value;
}

function normalizeCode(value: string | null, key: string, len: number): string | null {
  if (value === null) {
    return null;
  }
  const code = value.trim();
  if (!code) {
    return null;
  }
  if (code.length !== len || !/^[A-Za-z]+$/.test(code)) {
    throw new InputValidationError(`${key} must be ${len} letters`);
  }
  return code.toUpperCase();
}

function normalizeLanguageCode(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const code = value.trim();
  if (!code) {
    return null;
  }
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/.test(code)) {
    throw new InputValidationError("languageCode must be a valid BCP-47-like code");
  }
  return code;
}

function normalizeVideoTypes(value: unknown): VideoType[] {
  const raw = asStringArray(value, "includeVideoTypes");
  const allowed: VideoType[] = ["video", "short", "live"];
  if (raw.length === 0) {
    return [...DEFAULTS.includeVideoTypes];
  }
  const set = new Set<VideoType>();
  for (const item of raw) {
    if (!allowed.includes(item as VideoType)) {
      throw new InputValidationError(`includeVideoTypes must contain only: ${allowed.join(", ")}`);
    }
    set.add(item as VideoType);
  }
  return [...set];
}

export function parseRuntimeInput(raw: unknown): YoutubeScraperInput {
  if (!isObject(raw)) {
    throw new InputValidationError("Input must be an object");
  }
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (KNOWN_KEYS.has(key)) {
      payload[key] = value;
    }
  }

  const normalizedYoutubeUrls = [
    ...asStringArray(payload.youtubeUrls, "youtubeUrls"),
    ...asStringArray(payload.startUrls, "startUrls"),
  ].map(normalizeYoutubeUrl);
  const youtubeHomePlaceholders = normalizedYoutubeUrls.filter(isYoutubeHomeUrl);
  const youtubeUrls = normalizedYoutubeUrls.filter((url) => !isYoutubeHomeUrl(url));
  const searchTerms = asStringArray(payload.searchTerms, "searchTerms");

  if (youtubeUrls.length === 0 && searchTerms.length === 0) {
    if (youtubeHomePlaceholders.length > 0) {
      throw new InputValidationError(
        "youtubeUrls must be specific YouTube video/channel/playlist/search URLs. For keyword scraping, leave youtubeUrls empty and use searchTerms.",
      );
    }
    throw new InputValidationError("At least one of youtubeUrls or searchTerms must be provided");
  }

  const crawlerType = asEnum<CrawlerType>(payload.crawlerType, "crawlerType", ["camoufox", "playwright", "http:fast"], DEFAULTS.crawlerType);
  const maxResults = asInteger(payload.maxResults, "maxResults", DEFAULTS.maxResults, 1, 50000);
  const maxResultsPerSource = asInteger(payload.maxResultsPerSource, "maxResultsPerSource", DEFAULTS.maxResultsPerSource, 1, 10000);
  if (maxResultsPerSource > maxResults) {
    throw new InputValidationError("maxResultsPerSource cannot exceed maxResults");
  }

  const publishedAfter = validateDate(asNullableString(payload.publishedAfter, "publishedAfter", DEFAULTS.publishedAfter), "publishedAfter");
  const publishedBefore = validateDate(asNullableString(payload.publishedBefore, "publishedBefore", DEFAULTS.publishedBefore), "publishedBefore");
  if (publishedAfter && publishedBefore && publishedAfter > publishedBefore) {
    throw new InputValidationError("publishedAfter cannot be later than publishedBefore");
  }

  return {
    youtubeUrls,
    searchTerms,
    crawlerType,
    maxResults,
    maxResultsPerSource,
    maxPagesPerSource: asInteger(payload.maxPagesPerSource, "maxPagesPerSource", DEFAULTS.maxPagesPerSource, 1, 1000),
    maxRuntimeSeconds: asInteger(payload.maxRuntimeSeconds, "maxRuntimeSeconds", DEFAULTS.maxRuntimeSeconds, 10, 86400),
    maxIdleCycles: asInteger(payload.maxIdleCycles, "maxIdleCycles", DEFAULTS.maxIdleCycles, 1, 100),
    includeSourceSummaryRecords: asBoolean(payload.includeSourceSummaryRecords, "includeSourceSummaryRecords", DEFAULTS.includeSourceSummaryRecords),
    videoDetailMode: asEnum<VideoDetailMode>(payload.videoDetailMode, "videoDetailMode", ["full", "listing_only"], DEFAULTS.videoDetailMode),
    dedupeWithinSource: asBoolean(payload.dedupeWithinSource, "dedupeWithinSource", DEFAULTS.dedupeWithinSource),
    searchSort: asEnum<SearchSort>(payload.searchSort, "searchSort", ["relevance", "upload_date", "view_count"], DEFAULTS.searchSort),
    searchDateFilter: asEnum<SearchDateFilter>(payload.searchDateFilter, "searchDateFilter", ["any", "hour", "today", "week", "month", "year"], DEFAULTS.searchDateFilter),
    includeVideoTypes: normalizeVideoTypes(payload.includeVideoTypes),
    publishedAfter,
    publishedBefore,
    countryCode: normalizeCode(asNullableString(payload.countryCode, "countryCode", DEFAULTS.countryCode), "countryCode", 2),
    languageCode: normalizeLanguageCode(asNullableString(payload.languageCode, "languageCode", DEFAULTS.languageCode)),
    saveRawPayloads: asBoolean(payload.saveRawPayloads, "saveRawPayloads", DEFAULTS.saveRawPayloads),
    proxyRequired: asBoolean(payload.proxyRequired, "proxyRequired", DEFAULTS.proxyRequired),
  };
}
