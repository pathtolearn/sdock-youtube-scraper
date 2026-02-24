import type { ClientContext, Continuation } from "./types";

export type ContinuationRequest = {
  endpoint: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
};

function defaultClientContext(input?: ClientContext): ClientContext {
  return {
    clientName: input?.clientName || "WEB",
    clientVersion: input?.clientVersion || "2.20250101.00.00",
    hl: input?.hl,
    gl: input?.gl,
  };
}

export function buildContinuationRequest(continuation: Continuation): ContinuationRequest {
  const client = defaultClientContext(continuation.clientContext);
  const endpoint = continuation.endpoint === "browse"
    ? "https://www.youtube.com/youtubei/v1/browse?prettyPrint=false"
    : "https://www.youtube.com/youtubei/v1/search?prettyPrint=false";
  return {
    endpoint,
    headers: {
      "content-type": "application/json",
      "x-youtube-client-name": client.clientName,
      "x-youtube-client-version": client.clientVersion,
    },
    body: {
      context: {
        client: {
          clientName: client.clientName,
          clientVersion: client.clientVersion,
          hl: client.hl,
          gl: client.gl,
        },
      },
      continuation: continuation.token,
      clickTracking: continuation.clickTrackingParams ? { clickTrackingParams: continuation.clickTrackingParams } : undefined,
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function extractContinuationTokens(payload: unknown): string[] {
  const tokens = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    const rec = asRecord(value);
    if (!rec) {
      return;
    }
    const continuationCommand = asRecord(rec.continuationCommand);
    if (typeof continuationCommand?.token === "string") {
      tokens.add(continuationCommand.token);
    }
    const nextData = asRecord(rec.nextContinuationData);
    if (typeof nextData?.continuation === "string") {
      tokens.add(nextData.continuation);
    }
    Object.values(rec).forEach(walk);
  };
  walk(payload);
  return [...tokens];
}

export function extractContinuationItems(payload: unknown): unknown[] {
  const items: unknown[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item);
      }
      return;
    }
    const rec = asRecord(value);
    if (!rec) {
      return;
    }
    for (const key of ["continuationItems", "items"]) {
      const arr = asArray(rec[key]);
      if (arr.length > 0) {
        items.push(...arr);
      }
    }
    Object.values(rec).forEach(walk);
  };
  walk(payload);
  return items;
}
