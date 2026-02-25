import { proxyFetch, type RuntimeProxySettings } from "./proxy";
import type { Continuation } from "./types";
import { buildContinuationRequest } from "./pagination";

export type HttpFetchResult = {
  status: number;
  url: string;
  html: string;
};

export type YouTubeGateState = "none" | "consent_wall" | "challenge_wall" | "signin_interstitial";

const CONSENT_MARKERS = [
  "consent.youtube.com",
  "before you continue to youtube",
  "before you continue",
  "accept all",
  "i agree",
];

const CHALLENGE_MARKERS = [
  "unusual traffic",
  "captcha",
  "our systems have detected unusual traffic",
];

const SIGNIN_MARKERS = [
  "sign in to confirm",
  "sign in to continue",
  "accounts.google.com",
];

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

export function detectYouTubeGate(html: string, pageUrl = ""): { state: YouTubeGateState; reason?: string } {
  const lower = html.toLowerCase();
  const lowerUrl = pageUrl.toLowerCase();
  const hasConsent = CONSENT_MARKERS.some((marker) => lower.includes(marker) || lowerUrl.includes(marker));
  const hasChallenge = CHALLENGE_MARKERS.some((marker) => lower.includes(marker) || lowerUrl.includes(marker));
  const hasSignin = SIGNIN_MARKERS.some((marker) => lower.includes(marker) || lowerUrl.includes(marker));
  if (hasChallenge) {
    return { state: "challenge_wall", reason: "challenge_or_consent_wall" };
  }
  if (hasConsent) {
    return { state: "consent_wall", reason: "challenge_or_consent_wall" };
  }
  if (hasSignin) {
    return { state: "signin_interstitial", reason: "challenge_or_consent_wall" };
  }
  return { state: "none" };
}

export function looksBlocked(status: number, html: string, pageUrl = ""): { blocked: boolean; reason?: string; state?: YouTubeGateState } {
  if (status === 403 || status === 429) {
    return { blocked: true, reason: `http_${status}` };
  }
  const gate = detectYouTubeGate(html, pageUrl);
  if (gate.state !== "none") {
    return { blocked: true, reason: gate.reason, state: gate.state };
  }
  return { blocked: false, state: "none" };
}
