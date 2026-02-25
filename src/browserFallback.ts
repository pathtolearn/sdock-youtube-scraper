import { chromium } from "playwright";

import { extractEmbeddedJson } from "./extractEmbeddedJson";
import { detectYouTubeGate, type YouTubeGateState } from "./http";
import { playwrightProxyConfig, type RuntimeProxySettings } from "./proxy";

export type BrowserPageState = "youtube_content_ready" | "consent_wall" | "challenge_wall" | "signin_interstitial" | "unknown_no_json";

export type BrowserFallbackTelemetryEvent = {
  eventType: string;
  payload: Record<string, unknown>;
  stage?: string;
  level?: "info" | "warning" | "error";
  message?: string;
};

export type BrowserFallbackResult = {
  status: number;
  url: string;
  html: string;
  attempts: number;
  consentHandled: boolean;
  detectedState: BrowserPageState;
  timings: {
    gotoMs: number;
    stabilizeMs: number;
    consentMs: number;
    totalMs: number;
  };
  warnings: string[];
};

export class BrowserFetchError extends Error {
  code: string;
  attempt: number;
  state?: BrowserPageState;
  phase?: string;

  constructor(code: string, message: string, attempt: number, options?: { state?: BrowserPageState; phase?: string }) {
    super(message);
    this.name = "BrowserFetchError";
    this.code = code;
    this.attempt = attempt;
    this.state = options?.state;
    this.phase = options?.phase;
  }
}

type LocatorLike = {
  first: () => LocatorLike;
  isVisible: (options?: { timeout?: number }) => Promise<boolean>;
  click: (options?: { timeout?: number }) => Promise<void>;
};

type ClickContextLike = {
  locator: (selector: string) => LocatorLike;
  url: () => string;
};

type ResponseLike = { status?: () => number } | null;

type PageLike = ClickContextLike & {
  goto: (url: string, options: { waitUntil: "domcontentloaded"; timeout: number }) => Promise<ResponseLike>;
  waitForTimeout: (ms: number) => Promise<void>;
  waitForNavigation: (options: { waitUntil: "domcontentloaded"; timeout: number }) => Promise<unknown>;
  content: () => Promise<string>;
  frames: () => ClickContextLike[];
};

type BrowserContextLike = {
  newPage: () => Promise<PageLike>;
  close?: () => Promise<void>;
};

type BrowserLike = {
  newContext: (options: { userAgent: string }) => Promise<BrowserContextLike>;
  close: () => Promise<void>;
};

export type BrowserFallbackOptions = {
  requestedEngine?: string;
  telemetry?: (event: BrowserFallbackTelemetryEvent) => void | Promise<void>;
  browserFactory?: (proxySettings: RuntimeProxySettings) => Promise<BrowserLike>;
};

const USER_AGENT = "StealthDockYouTubeScraper/1.0 (+https://stealthdock.local)";
const MAX_ATTEMPTS = 2;
const GOTO_TIMEOUT_MS = 60_000;
const POST_GOTO_STABILIZE_MS = 1_500;
const CONSENT_SELECTOR_TIMEOUT_MS = 1_500;
const POST_CONSENT_NAV_TIMEOUT_MS = 8_000;
const POST_CONSENT_WAIT_MS_ATTEMPT_1 = 2_000;
const POST_CONSENT_WAIT_MS_ATTEMPT_2 = 3_500;
const OVERALL_BROWSER_FALLBACK_BUDGET_MS = 90_000;
const BROWSER_LAUNCH_TIMEOUT_MS = 20_000;
const CONTEXT_INIT_TIMEOUT_MS = 10_000;
const PAGE_CONTENT_TIMEOUT_MS = 10_000;
const UNKNOWN_JSON_RECHECK_POLL_MS = 500;
const UNKNOWN_JSON_RECHECK_MAX_MS = 4_000;

const CONSENT_SELECTORS = [
  'button:has-text("Accept all")',
  'button:has-text("I agree")',
  'button:has-text("Accept")',
  'button:has-text("Agree")',
  '[aria-label*="Accept"]',
  'form button[type="submit"]',
  'button[jsname]',
];

async function emit(telemetry: BrowserFallbackOptions["telemetry"], event: BrowserFallbackTelemetryEvent): Promise<void> {
  if (!telemetry) {
    return;
  }
  try {
    await telemetry(event);
  } catch {
    // Telemetry is best-effort. Runtime event delivery issues should not break scraping.
  }
}

function mapGateState(gate: YouTubeGateState): Exclude<BrowserPageState, "youtube_content_ready" | "unknown_no_json"> {
  if (gate === "consent_wall") {
    return "consent_wall";
  }
  if (gate === "challenge_wall") {
    return "challenge_wall";
  }
  return "signin_interstitial";
}

export function classifyBrowserPageState(pageUrl: string, html: string): { state: BrowserPageState; hasEmbeddedJson: boolean } {
  const gate = detectYouTubeGate(html, pageUrl);
  const artifacts = extractEmbeddedJson(html);
  const hasEmbeddedJson = Boolean(artifacts.ytInitialData || artifacts.ytInitialPlayerResponse);
  if (hasEmbeddedJson && gate.state === "none") {
    return { state: "youtube_content_ready", hasEmbeddedJson };
  }
  if (gate.state !== "none") {
    return { state: mapGateState(gate.state), hasEmbeddedJson };
  }
  return { state: "unknown_no_json", hasEmbeddedJson };
}

export async function tryConsentClick(
  page: PageLike,
  attempt: number,
  telemetry?: BrowserFallbackOptions["telemetry"],
): Promise<{ clicked: boolean; selector?: string; frameUrl?: string; navigated?: boolean; elapsedMs: number; reason?: string }> {
  const startedAt = Date.now();
  const targets: ClickContextLike[] = [page, ...page.frames()];
  for (const target of targets) {
    const frameUrl = safeUrl(target);
    for (const selector of CONSENT_SELECTORS) {
      await emit(telemetry, {
        eventType: "youtube.consent_click_attempt",
        payload: { attempt, selector, frame_url: frameUrl },
        stage: "browser",
      });
      try {
        const locator = target.locator(selector).first();
        const visible = await locator.isVisible({ timeout: CONSENT_SELECTOR_TIMEOUT_MS });
        if (!visible) {
          continue;
        }
        const navPromise = page
          .waitForNavigation({ waitUntil: "domcontentloaded", timeout: POST_CONSENT_NAV_TIMEOUT_MS })
          .then(() => true)
          .catch(() => false);
        await locator.click({ timeout: CONSENT_SELECTOR_TIMEOUT_MS });
        const settleMs = attempt >= 2 ? POST_CONSENT_WAIT_MS_ATTEMPT_2 : POST_CONSENT_WAIT_MS_ATTEMPT_1;
        await page.waitForTimeout(settleMs);
        const navigated = await navPromise;
        await emit(telemetry, {
          eventType: "youtube.consent_click_succeeded",
          payload: { attempt, selector, frame_url: frameUrl, navigated },
          stage: "browser",
          message: "Consent interaction succeeded",
        });
        return { clicked: true, selector, frameUrl, navigated, elapsedMs: Date.now() - startedAt };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await emit(telemetry, {
          eventType: "youtube.consent_click_failed",
          payload: { attempt, selector, frame_url: frameUrl, reason },
          stage: "browser",
          level: "warning",
        });
      }
    }
  }
  const reason = "no_consent_selector_click_succeeded";
  await emit(telemetry, {
    eventType: "youtube.consent_click_failed",
    payload: { attempt, reason },
    stage: "browser",
    level: "warning",
    message: "Consent selectors unavailable or click failed",
  });
  return { clicked: false, elapsedMs: Date.now() - startedAt, reason };
}

function safeUrl(ctx: { url?: () => string }): string {
  try {
    return typeof ctx.url === "function" ? ctx.url() : "";
  } catch {
    return "";
  }
}

async function defaultBrowserFactory(proxySettings: RuntimeProxySettings): Promise<BrowserLike> {
  return (await chromium.launch({ headless: true, proxy: playwrightProxyConfig(proxySettings) })) as unknown as BrowserLike;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  buildError: () => BrowserFetchError,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await new Promise<T>((resolve, reject) => {
      timer = setTimeout(() => reject(buildError()), timeoutMs);
      promise.then(resolve, reject);
    });
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function readPageSnapshot(
  page: PageLike,
  fallbackUrl: string,
  attempt: number,
): Promise<{ html: string; pageUrl: string; pageState: ReturnType<typeof classifyBrowserPageState> }> {
  const html = await withTimeout(
    page.content(),
    PAGE_CONTENT_TIMEOUT_MS,
    () => new BrowserFetchError("browser_timeout", "network_browser: content_timeout", attempt, { phase: "content" }),
  );
  const pageUrl = page.url() || fallbackUrl;
  const pageState = classifyBrowserPageState(pageUrl, html);
  return { html, pageUrl, pageState };
}

async function recheckUnknownNoJson(
  page: PageLike,
  fallbackUrl: string,
  attempt: number,
  current: { html: string; pageUrl: string; pageState: ReturnType<typeof classifyBrowserPageState> },
): Promise<{ html: string; pageUrl: string; pageState: ReturnType<typeof classifyBrowserPageState> }> {
  if (current.pageState.state !== "unknown_no_json") {
    return current;
  }
  const deadline = Date.now() + UNKNOWN_JSON_RECHECK_MAX_MS;
  let snapshot = current;
  while (Date.now() < deadline) {
    await page.waitForTimeout(UNKNOWN_JSON_RECHECK_POLL_MS);
    snapshot = await readPageSnapshot(page, fallbackUrl, attempt);
    if (snapshot.pageState.state !== "unknown_no_json") {
      return snapshot;
    }
  }
  return snapshot;
}

export async function fetchHtmlWithBrowser(
  url: string,
  proxySettings: RuntimeProxySettings,
  options: BrowserFallbackOptions = {},
): Promise<BrowserFallbackResult> {
  const telemetry = options.telemetry;
  const browserFactory = options.browserFactory || defaultBrowserFactory;
  const overallStartedAt = Date.now();
  let lastFailure: BrowserFetchError | null = null;
  let consentHandledAny = false;
  const warnings: string[] = [];
  let totalGotoMs = 0;
  let totalStabilizeMs = 0;
  let totalConsentMs = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (Date.now() - overallStartedAt > OVERALL_BROWSER_FALLBACK_BUDGET_MS) {
      await emit(telemetry, {
        eventType: "youtube.browser_timeout",
        payload: { url, attempt, timeout_ms: OVERALL_BROWSER_FALLBACK_BUDGET_MS, phase: "overall_budget" },
        stage: "browser",
        level: "warning",
        message: "Browser fallback overall budget exceeded",
      });
      throw new BrowserFetchError("browser_timeout", "network_browser: overall browser fallback timeout", attempt, { phase: "overall_budget" });
    }

    await emit(telemetry, {
      eventType: "youtube.browser_fetch_started",
      payload: { url, attempt, proxy_enabled: proxySettings.enabled, requested_engine: options.requestedEngine || null },
      stage: "browser",
      message: "Starting browser fetch",
    });

    let browser: BrowserLike | null = null;
    let context: BrowserContextLike | null = null;
    try {
      browser = await withTimeout(
        browserFactory(proxySettings),
        BROWSER_LAUNCH_TIMEOUT_MS,
        () => new BrowserFetchError("browser_timeout", "network_browser: launch_timeout", attempt, { phase: "launch" }),
      );
      context = await withTimeout(
        browser.newContext({ userAgent: USER_AGENT }),
        CONTEXT_INIT_TIMEOUT_MS,
        () => new BrowserFetchError("browser_timeout", "network_browser: context_timeout", attempt, { phase: "context" }),
      );
      const page = await withTimeout(
        context.newPage(),
        CONTEXT_INIT_TIMEOUT_MS,
        () => new BrowserFetchError("browser_timeout", "network_browser: new_page_timeout", attempt, { phase: "new_page" }),
      );

      let response: ResponseLike;
      const gotoStartedAt = Date.now();
      try {
        response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: GOTO_TIMEOUT_MS });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        totalGotoMs += Date.now() - gotoStartedAt;
        await emit(telemetry, {
          eventType: "youtube.browser_timeout",
          payload: { url, attempt, timeout_ms: GOTO_TIMEOUT_MS, phase: "goto", error: reason },
          stage: "browser",
          level: "warning",
          message: "Browser navigation timed out or failed",
        });
        lastFailure = new BrowserFetchError("browser_navigation_failed", `network_browser: goto_timeout_or_failure: ${reason}`, attempt, { phase: "goto" });
        continue;
      }
      totalGotoMs += Date.now() - gotoStartedAt;

      const stabilizeStartedAt = Date.now();
      await page.waitForTimeout(POST_GOTO_STABILIZE_MS);
      totalStabilizeMs += Date.now() - stabilizeStartedAt;

      let snapshot = await readPageSnapshot(page, url, attempt);
      snapshot = await recheckUnknownNoJson(page, url, attempt, snapshot);
      let html = snapshot.html;
      let pageUrl = snapshot.pageUrl;
      let pageState = snapshot.pageState;
      await emit(telemetry, {
        eventType: "youtube.browser_page_state",
        payload: { url, attempt, state: pageState.state, page_url: pageUrl, has_embedded_json: pageState.hasEmbeddedJson },
        stage: "browser",
      });

      if (pageState.state === "consent_wall") {
        await emit(telemetry, {
          eventType: "youtube.consent_detected",
          payload: { url, attempt, page_url: pageUrl },
          stage: "browser",
          level: "warning",
          message: "Consent wall detected in browser fallback",
        });
        const consent = await tryConsentClick(page, attempt, telemetry);
        totalConsentMs += consent.elapsedMs;
        consentHandledAny = consentHandledAny || consent.clicked;
        snapshot = await readPageSnapshot(page, url, attempt);
        snapshot = await recheckUnknownNoJson(page, url, attempt, snapshot);
        html = snapshot.html;
        pageUrl = snapshot.pageUrl;
        pageState = snapshot.pageState;
        await emit(telemetry, {
          eventType: "youtube.browser_page_state",
          payload: { url, attempt, state: pageState.state, page_url: pageUrl, has_embedded_json: pageState.hasEmbeddedJson, after_consent: true },
          stage: "browser",
        });
      }

      if (pageState.state === "youtube_content_ready") {
        const result: BrowserFallbackResult = {
          status: response?.status?.() ?? 200,
          url: pageUrl,
          html,
          attempts: attempt,
          consentHandled: consentHandledAny,
          detectedState: pageState.state,
          timings: {
            gotoMs: totalGotoMs,
            stabilizeMs: totalStabilizeMs,
            consentMs: totalConsentMs,
            totalMs: Date.now() - overallStartedAt,
          },
          warnings,
        };
        await emit(telemetry, {
          eventType: "youtube.browser_fetch_finished",
          payload: {
            url,
            attempts: attempt,
            status: result.status,
            detected_state: result.detectedState,
            consent_handled: result.consentHandled,
            has_embedded_json: true,
            warnings,
          },
          stage: "browser",
          message: "Browser fallback completed",
        });
        return result;
      }

      const failureCode =
        pageState.state === "consent_wall" || pageState.state === "challenge_wall" || pageState.state === "signin_interstitial"
          ? "browser_still_consent_wall"
          : "browser_no_embedded_json_after_navigation";
      const failureMessage =
        pageState.state === "unknown_no_json"
          ? `parse_browser: no_embedded_json_after_successful_navigation (attempt=${attempt})`
          : `blocked_browser: ${pageState.state}_after_retry (attempt=${attempt})`;
      lastFailure = new BrowserFetchError(failureCode, failureMessage, attempt, { state: pageState.state });
      warnings.push(`${pageState.state}@attempt${attempt}`);
      await emit(telemetry, {
        eventType: "youtube.browser_fetch_finished",
        payload: {
          url,
          attempts: attempt,
          status: response?.status?.() ?? 200,
          detected_state: pageState.state,
          consent_handled: consentHandledAny,
          has_embedded_json: false,
          warnings,
        },
        stage: "browser",
        level: "warning",
        message: "Browser fallback attempt did not yield parseable YouTube content",
      });
    } finally {
      try {
        await context?.close?.();
      } catch {
        // ignore context close failure
      }
      try {
        await browser?.close?.();
      } catch {
        // ignore browser close failure
      }
    }
  }

  throw lastFailure || new BrowserFetchError("browser_navigation_failed", "network_browser: browser fallback failed", MAX_ATTEMPTS);
}
