import type { ParsedPageArtifacts } from "./types";

export class EmbeddedJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddedJsonError";
  }
}

function parseJsonLiteral(jsonText: string): unknown {
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    throw new EmbeddedJsonError(`Failed to parse embedded JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function extractAssignment(html: string, variableName: string): unknown | null {
  const patterns = [
    new RegExp(`${variableName}\\s*=\\s*(\\{[\\s\\S]*?\\});`, "m"),
    new RegExp(`${variableName}\\s*=\\s*(\\[[\\s\\S]*?\\]);`, "m"),
    new RegExp(`(?:window\\[\\"${variableName}\\"\\]|window\\.${variableName})\\s*=\\s*(\\{[\\s\\S]*?\\});`, "m"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return parseJsonLiteral(match[1]);
    }
  }
  return null;
}

function extractYtcfg(html: string): Record<string, unknown> | null {
  const ytcfg: Record<string, unknown> = {};
  const re = /ytcfg\.set\((\{[\s\S]*?\})\);/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const parsed = parseJsonLiteral(match[1]);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      Object.assign(ytcfg, parsed as Record<string, unknown>);
    }
  }
  return Object.keys(ytcfg).length > 0 ? ytcfg : null;
}

export function extractEmbeddedJson(html: string): ParsedPageArtifacts {
  const ytInitialData = extractAssignment(html, "ytInitialData");
  const ytInitialPlayerResponse = extractAssignment(html, "ytInitialPlayerResponse");
  const ytcfg = extractYtcfg(html);
  return {
    ytInitialData,
    ytInitialPlayerResponse,
    ytcfg,
  };
}

export function requireEmbeddedJson(html: string): ParsedPageArtifacts {
  const artifacts = extractEmbeddedJson(html);
  if (!artifacts.ytInitialData && !artifacts.ytInitialPlayerResponse) {
    throw new EmbeddedJsonError("No YouTube embedded JSON found in page HTML");
  }
  return artifacts;
}
