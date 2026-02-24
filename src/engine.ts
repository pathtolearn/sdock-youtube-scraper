import type { CrawlerType } from "./input";

export type SelectedEngine = CrawlerType;

export type EngineResolution = {
  selected: SelectedEngine;
  requested: SelectedEngine;
  fallbackReason: string | null;
};

function isEnabled(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function isCamoufoxAvailable(env: Record<string, string | undefined> = process.env): boolean {
  return isEnabled(env.CAMOUFOX_AVAILABLE) || isEnabled(env.STEALTHDOCK_CAMOUFOX_AVAILABLE) || isEnabled(env.STEALTHDOCK_CAMOUFOX_ENABLED);
}

export function selectEngine(requested: SelectedEngine, env: Record<string, string | undefined> = process.env): EngineResolution {
  if (requested === "camoufox" && !isCamoufoxAvailable(env)) {
    return {
      selected: "playwright",
      requested,
      fallbackReason: "camoufox_unavailable",
    };
  }
  return {
    selected: requested,
    requested,
    fallbackReason: null,
  };
}
