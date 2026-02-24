import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { extractEmbeddedJson, requireEmbeddedJson } from "../src/extractEmbeddedJson";

const fixturesDir = path.join(process.cwd(), "test", "fixtures");

describe("extractEmbeddedJson", () => {
  it("extracts ytInitialData and player response", () => {
    const html = fs.readFileSync(path.join(fixturesDir, "video-page.html"), "utf8");
    const out = extractEmbeddedJson(html);
    expect(out.ytInitialData).toBeTruthy();
    expect(out.ytInitialPlayerResponse).toBeTruthy();
    expect(out.ytcfg).toBeTruthy();
  });

  it("throws on missing blobs when required", () => {
    expect(() => requireEmbeddedJson("<html><body>No JSON</body></html>")).toThrow("No YouTube embedded JSON found");
  });

  it("handles window assignment variant", () => {
    const html = fs.readFileSync(path.join(fixturesDir, "search-page.html"), "utf8");
    const out = extractEmbeddedJson(html);
    expect(out.ytInitialData).toBeTruthy();
  });
});
