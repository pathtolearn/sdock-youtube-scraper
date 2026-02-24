import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { extractEmbeddedJson } from "../src/extractEmbeddedJson";
import { parseChannelPage, parseContinuationPayload, parsePlaylistPage, parseSearchPage, parseVideoPage } from "../src/youtubeParsers";

const fixturesDir = path.join(process.cwd(), "test", "fixtures");

function html(name: string): string {
  return fs.readFileSync(path.join(fixturesDir, name), "utf8");
}

function json(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), "utf8"));
}

describe("youtube parsers", () => {
  it("parses video page details", () => {
    const parsed = parseVideoPage(extractEmbeddedJson(html("video-page.html")), "https://www.youtube.com/watch?v=abc123xyz00");
    expect(parsed.video?.id).toBe("abc123xyz00");
    expect(parsed.video?.viewCount).toBe(12345);
    expect(parsed.video?.hashtags).toContain("#fixture");
    expect(parsed.summary.entityType).toBe("video_source");
  });

  it("parses search page videos + continuation", () => {
    const parsed = parseSearchPage(extractEmbeddedJson(html("search-page.html")), "https://www.youtube.com/results?search_query=test", {
      searchSort: "relevance",
    });
    expect(parsed.summary.entityType).toBe("search");
    expect(parsed.videos.length).toBeGreaterThan(0);
    expect(parsed.continuation?.token).toBe("SEARCH_CONT_TOKEN_1");
  });

  it("parses playlist page summary and items", () => {
    const parsed = parsePlaylistPage(extractEmbeddedJson(html("playlist-page.html")), "https://www.youtube.com/playlist?list=PL_FIXTURE_1");
    expect(parsed.summary.entityType).toBe("playlist");
    expect(parsed.summary.id).toBe("PL_FIXTURE_1");
    expect(parsed.videos.map((v) => v.id)).toEqual(["plv001", "plv002"]);
  });

  it("parses channel page summary and items", () => {
    const parsed = parseChannelPage(extractEmbeddedJson(html("channel-page.html")), "https://www.youtube.com/@fixture/videos");
    expect(parsed.summary.entityType).toBe("channel");
    expect(parsed.summary.channelName).toBe("Fixture Channel");
    expect(parsed.videos[0]?.id).toBe("chv001");
  });

  it("parses continuation payload", () => {
    const parsed = parseContinuationPayload(json("continuation-search.json"), "https://www.youtube.com/results?search_query=test", "search");
    expect(parsed.videos[0]?.id).toBe("svid003");
    expect(parsed.continuation?.token).toBe("SEARCH_CONT_TOKEN_2");
  });
});
