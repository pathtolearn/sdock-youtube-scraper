import { describe, expect, it } from "vitest";

import { buildSearchUrlFromTerm, classifyYoutubeUrl } from "../src/url";

describe("classifyYoutubeUrl", () => {
  it("classifies watch URL", () => {
    const c = classifyYoutubeUrl("https://www.youtube.com/watch?v=abc123xyz00");
    expect(c.kind).toBe("video");
    expect(c.videoId).toBe("abc123xyz00");
    expect(c.sourceKind).toBe("video_url");
  });

  it("normalizes youtu.be URL", () => {
    const c = classifyYoutubeUrl("https://youtu.be/abc123xyz00?t=3");
    expect(c.normalizedUrl).toBe("https://www.youtube.com/watch?v=abc123xyz00");
  });

  it("classifies shorts/live URLs", () => {
    expect(classifyYoutubeUrl("https://www.youtube.com/shorts/abc123xyz00").kind).toBe("video");
    expect(classifyYoutubeUrl("https://www.youtube.com/live/abc123xyz00").kind).toBe("video");
  });

  it("classifies playlist/search/channel URLs", () => {
    expect(classifyYoutubeUrl("https://www.youtube.com/playlist?list=PL123").kind).toBe("playlist");
    expect(classifyYoutubeUrl("https://www.youtube.com/results?search_query=test").kind).toBe("search");
    const channel = classifyYoutubeUrl("https://www.youtube.com/@openai/about");
    expect(channel.kind).toBe("channel");
    expect(channel.normalizedUrl.endsWith("/videos")).toBe(true);
  });
});

describe("buildSearchUrlFromTerm", () => {
  it("builds URL and stores best-effort filter params", () => {
    const url = new URL(
      buildSearchUrlFromTerm("lofi beats", {
        searchSort: "upload_date",
        searchDateFilter: "week",
        countryCode: "US",
        languageCode: "en",
      }),
    );
    expect(url.searchParams.get("search_query")).toBe("lofi beats");
    expect(url.searchParams.get("gl")).toBe("US");
    expect(url.searchParams.get("hl")).toBe("en");
    expect(url.searchParams.get("stealthdock_sort")).toBe("upload_date");
    expect(url.searchParams.get("stealthdock_date")).toBe("week");
  });
});
