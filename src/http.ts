import { proxyFetch, type RuntimeProxySettings } from "./proxy";
import type { Continuation } from "./types";
import { buildContinuationRequest } from "./pagination";

export type HttpFetchResult = {
  status: number;
  url: string;
  html: string;
};

export async function fetchHtml(url: string, proxySettings: RuntimeProxySettings, headers?: Record<string, string>): Promise<HttpFetchResult> {
  const response = await proxyFetch(
    url,
    {
      method: "GET",
      headers: {
        "user-agent": "StealthDockYouTubeScraper/1.0 (+https://stealthdock.local)",
        accept: "text/html,application/xhtml+xml",
        ...(headers || {}),
      },
    },
    proxySettings,
  );
  return {
    status: response.status,
    url: response.url || url,
    html: await response.text(),
  };
}

export async function fetchContinuationJson(continuation: Continuation, proxySettings: RuntimeProxySettings): Promise<unknown> {
  const req = buildContinuationRequest(continuation);
  const response = await proxyFetch(
    req.endpoint,
    {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify(req.body),
    },
    proxySettings,
  );
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Failed to parse continuation JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function looksBlocked(status: number, html: string): { blocked: boolean; reason?: string } {
  if (status === 403 || status === 429) {
    return { blocked: true, reason: `http_${status}` };
  }
  const lower = html.toLowerCase();
  if (lower.includes("captcha") || lower.includes("unusual traffic") || lower.includes("consent.youtube.com") || lower.includes("sign in to confirm")) {
    return { blocked: true, reason: "challenge_or_consent_wall" };
  }
  return { blocked: false };
}
