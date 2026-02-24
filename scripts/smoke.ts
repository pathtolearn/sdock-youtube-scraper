import fs from "node:fs";
import path from "node:path";

import Ajv from "ajv";
import addFormats from "ajv-formats";

import { extractEmbeddedJson } from "../src/extractEmbeddedJson";
import { parseRuntimeInput } from "../src/input";
import { buildSourceSummaryRecord, buildVideoRecord } from "../src/output";
import { parseSearchPage } from "../src/youtubeParsers";

const root = process.cwd();

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(root, filePath), "utf8")) as Record<string, unknown>;
}

function main(): void {
  const inputSchema = readJson("input.schema.json");
  const outputSchema = readJson("output.schema.json");
  const exampleInput = readJson("example.input.json");

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  const validateInput = ajv.compile(inputSchema);
  if (!validateInput(exampleInput)) {
    throw new Error(`example.input.json failed validation: ${JSON.stringify(validateInput.errors)}`);
  }
  const parsedInput = parseRuntimeInput(exampleInput);

  const searchHtml = fs.readFileSync(path.join(root, "test/fixtures/search-page.html"), "utf8");
  const parsedSearch = parseSearchPage(extractEmbeddedJson(searchHtml), "https://www.youtube.com/results?search_query=fixture", {
    searchSort: parsedInput.searchSort,
    searchDateFilter: parsedInput.searchDateFilter,
  });
  if (parsedSearch.videos.length === 0) {
    throw new Error("Expected fixture search page to produce videos");
  }

  const summaryRecord = buildSourceSummaryRecord({
    sourceKind: "search_term",
    sourceId: "src_0001",
    sourceInput: "fixture",
    sourceUrl: "https://www.youtube.com/results?search_query=fixture",
    summary: parsedSearch.summary,
  });
  const videoRecord = buildVideoRecord({
    sourceKind: "search_term",
    sourceId: "src_0001",
    sourceInput: "fixture",
    sourceUrl: "https://www.youtube.com/results?search_query=fixture",
    video: parsedSearch.videos[0],
  });

  const validateOutput = ajv.compile(outputSchema);
  if (!validateOutput(summaryRecord)) {
    throw new Error(`Summary output failed validation: ${JSON.stringify(validateOutput.errors)}`);
  }
  if (!validateOutput(videoRecord)) {
    throw new Error(`Video output failed validation: ${JSON.stringify(validateOutput.errors)}`);
  }

  console.log("Smoke checks passed");
  console.log(`Parsed search videos: ${parsedSearch.videos.length}`);
}

main();
