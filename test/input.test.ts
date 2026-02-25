import { describe, expect, it } from "vitest";

import { InputValidationError, parseRuntimeInput } from "../src/input";

describe("parseRuntimeInput", () => {
  it("rejects when both youtubeUrls and searchTerms are empty", () => {
    expect(() => parseRuntimeInput({})).toThrow(InputValidationError);
  });

  it("accepts youtubeUrls payload and applies defaults", () => {
    const parsed = parseRuntimeInput({ youtubeUrls: ["https://youtu.be/abc123xyz00"] });
    expect(parsed.youtubeUrls[0]).toBe("https://www.youtube.com/watch?v=abc123xyz00");
    expect(parsed.searchTerms).toEqual([]);
    expect(parsed.crawlerType).toBe("camoufox");
  });

  it("accepts legacy startUrls alias for backward compatibility", () => {
    const parsed = parseRuntimeInput({ startUrls: ["https://youtu.be/abc123xyz00"] });
    expect(parsed.youtubeUrls[0]).toBe("https://www.youtube.com/watch?v=abc123xyz00");
  });

  it("accepts search-term-only payload", () => {
    const parsed = parseRuntimeInput({ searchTerms: ["  test term  "] });
    expect(parsed.searchTerms).toEqual(["test term"]);
  });

  it("ignores bare YouTube homepage URL when searchTerms are provided", () => {
    const parsed = parseRuntimeInput({
      youtubeUrls: ["https://youtube.com/"],
      searchTerms: ["test"],
    });
    expect(parsed.youtubeUrls).toEqual([]);
    expect(parsed.searchTerms).toEqual(["test"]);
  });

  it("rejects bare YouTube homepage URL as the only target with a clear message", () => {
    expect(() => parseRuntimeInput({ youtubeUrls: ["https://youtube.com/"] })).toThrow(
      "specific YouTube video/channel/playlist/search URLs",
    );
  });

  it("ignores unknown fields", () => {
    const parsed = parseRuntimeInput({ searchTerms: ["test"], unknownField: 123 });
    expect((parsed as Record<string, unknown>).unknownField).toBeUndefined();
  });

  it("rejects invalid YouTube hosts", () => {
    expect(() => parseRuntimeInput({ youtubeUrls: ["https://example.com"] })).toThrow("YouTube URLs");
  });

  it("rejects invalid date ranges", () => {
    expect(() => parseRuntimeInput({ searchTerms: ["test"], publishedAfter: "2025-01-02", publishedBefore: "2025-01-01" })).toThrow(
      "publishedAfter cannot be later than publishedBefore",
    );
  });

  it("enforces maxResultsPerSource <= maxResults", () => {
    expect(() => parseRuntimeInput({ searchTerms: ["test"], maxResults: 10, maxResultsPerSource: 11 })).toThrow(
      "maxResultsPerSource cannot exceed maxResults",
    );
  });
});
