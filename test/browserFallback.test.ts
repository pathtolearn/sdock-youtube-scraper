import { describe, expect, it, vi } from "vitest";

import {
  BrowserFetchError,
  classifyBrowserPageState,
  fetchHtmlWithBrowser,
  tryConsentClick,
  type BrowserFallbackTelemetryEvent,
} from "../src/browserFallback";

type FakePageConfig = {
  url: string;
  urlByPhase?: string[];
  htmlByPhase: string[];
  visibleSelectors?: string[];
  clickUpdatesPhase?: boolean;
  gotoStatus?: number;
  gotoThrows?: Error;
  frames?: Array<{ url: string; visibleSelectors?: string[] }>;
};

function makeFakePage(config: FakePageConfig) {
  let phase = 0;
  const pageFrames = (config.frames || []).map((frame) => ({
    url: () => frame.url,
    locator: (selector: string) => ({
      first() {
        return this;
      },
      async isVisible() {
        return (frame.visibleSelectors || []).includes(selector);
      },
      async click() {
        return;
      },
    }),
  }));

  const page = {
    async goto() {
      if (config.gotoThrows) {
        throw config.gotoThrows;
      }
      return { status: () => config.gotoStatus ?? 200 };
    },
    async waitForTimeout() {
      return;
    },
    async waitForNavigation() {
      return;
    },
    async content() {
      return config.htmlByPhase[Math.min(phase, config.htmlByPhase.length - 1)] || "";
    },
    url() {
      return (config.urlByPhase && config.urlByPhase[Math.min(phase, config.urlByPhase.length - 1)]) || config.url;
    },
    frames() {
      return pageFrames;
    },
    locator(selector: string) {
      return {
        first() {
          return this;
        },
        async isVisible() {
          return (config.visibleSelectors || []).includes(selector);
        },
        async click() {
          if (config.clickUpdatesPhase) {
            phase = Math.min(phase + 1, config.htmlByPhase.length - 1);
          }
        },
      };
    },
  };
  return page;
}

function makeBrowserFactory(pageConfigs: FakePageConfig[]) {
  let index = 0;
  return async () => ({
    async newContext() {
      const page = makeFakePage(pageConfigs[Math.min(index++, pageConfigs.length - 1)]);
      return {
        async newPage() {
          return page;
        },
        async close() {
          return;
        },
      };
    },
    async close() {
      return;
    },
  });
}

describe("classifyBrowserPageState", () => {
  it("detects content-ready pages via embedded JSON", () => {
    const html = '<html><script>var ytInitialData = {};</script></html>';
    expect(classifyBrowserPageState("https://www.youtube.com/watch?v=x", html)).toEqual({
      state: "youtube_content_ready",
      hasEmbeddedJson: true,
    });
  });

  it("detects consent walls", () => {
    const html = '<html>Before you continue to YouTube <button>Accept all</button></html>';
    expect(classifyBrowserPageState("https://consent.youtube.com/", html).state).toBe("consent_wall");
  });
});

describe("tryConsentClick", () => {
  it("clicks a visible consent selector on the page", async () => {
    const page = makeFakePage({
      url: "https://consent.youtube.com/",
      htmlByPhase: ["consent"],
      visibleSelectors: ['button:has-text("Accept all")'],
    });
    const events: BrowserFallbackTelemetryEvent[] = [];
    const result = await tryConsentClick(page, 1, async (event) => {
      events.push(event);
    });
    expect(result.clicked).toBe(true);
    expect(result.selector).toBe('button:has-text("Accept all")');
    expect(events.some((e) => e.eventType === "youtube.consent_click_succeeded")).toBe(true);
  });

  it("tries iframe contexts too", async () => {
    const page = makeFakePage({
      url: "https://consent.youtube.com/",
      htmlByPhase: ["consent"],
      visibleSelectors: [],
      frames: [{ url: "https://consent.youtube.com/iframe", visibleSelectors: ['button:has-text("I agree")'] }],
    });
    const result = await tryConsentClick(page, 1);
    expect(result.clicked).toBe(true);
    expect(result.frameUrl).toContain("iframe");
  });
});

describe("fetchHtmlWithBrowser", () => {
  it("handles consent wall and returns content after click", async () => {
    const consentHtml = '<html>Before you continue to YouTube <button>Accept all</button></html>';
    const contentHtml = '<html><script>var ytInitialData = {};</script></html>';
    const events: BrowserFallbackTelemetryEvent[] = [];
    const result = await fetchHtmlWithBrowser(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      { enabled: true, applyScope: "all_outbound", proxyUrl: null, provider: null, endpoint: null, profileId: null, rotationMode: null },
      {
        requestedEngine: "camoufox",
        telemetry: async (event) => {
          events.push(event);
        },
        browserFactory: makeBrowserFactory([
          {
            url: "https://consent.youtube.com/",
            urlByPhase: ["https://consent.youtube.com/", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
            htmlByPhase: [consentHtml, contentHtml],
            visibleSelectors: ['button:has-text("Accept all")'],
            clickUpdatesPhase: true,
          },
        ]),
      },
    );
    expect(result.detectedState).toBe("youtube_content_ready");
    expect(result.consentHandled).toBe(true);
    expect(events.some((e) => e.eventType === "youtube.browser_fetch_started")).toBe(true);
    expect(events.some((e) => e.eventType === "youtube.consent_detected")).toBe(true);
    expect(events.some((e) => e.eventType === "youtube.browser_fetch_finished")).toBe(true);
  });

  it("retries once and then fails with actionable blocked error", async () => {
    const consentHtml = '<html>Before you continue to YouTube <button>Accept all</button></html>';
    await expect(
      fetchHtmlWithBrowser(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        { enabled: true, applyScope: "all_outbound", proxyUrl: null, provider: null, endpoint: null, profileId: null, rotationMode: null },
        {
          browserFactory: makeBrowserFactory([
            { url: "https://consent.youtube.com/", htmlByPhase: [consentHtml], visibleSelectors: [] },
            { url: "https://consent.youtube.com/", htmlByPhase: [consentHtml], visibleSelectors: [] },
          ]),
        },
      ),
    ).rejects.toBeInstanceOf(BrowserFetchError);
  });

  it("returns browser timeout/navigation failure as tagged error", async () => {
    await expect(
      fetchHtmlWithBrowser(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        { enabled: true, applyScope: "all_outbound", proxyUrl: null, provider: null, endpoint: null, profileId: null, rotationMode: null },
        {
          browserFactory: makeBrowserFactory([{ url: "https://www.youtube.com/", htmlByPhase: [""], gotoThrows: new Error("Timeout 30000ms exceeded") }]),
        },
      ),
    ).rejects.toThrow(/network_browser/);
  });
});
