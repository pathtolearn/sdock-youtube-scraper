import { describe, expect, it } from "vitest";

import { selectEngine } from "../src/engine";

describe("selectEngine", () => {
  it("falls back to playwright when camoufox is unavailable", () => {
    const resolved = selectEngine("camoufox", {
      CAMOUFOX_AVAILABLE: "0",
      STEALTHDOCK_CAMOUFOX_AVAILABLE: "0",
      STEALTHDOCK_CAMOUFOX_ENABLED: "0",
    });

    expect(resolved.selected).toBe("playwright");
    expect(resolved.fallbackReason).toBe("camoufox_unavailable");
  });

  it("keeps camoufox when enabled", () => {
    const resolved = selectEngine("camoufox", {
      STEALTHDOCK_CAMOUFOX_ENABLED: "1",
    });

    expect(resolved.selected).toBe("camoufox");
    expect(resolved.fallbackReason).toBeNull();
  });

  it("keeps explicit playwright selection", () => {
    const resolved = selectEngine("playwright", {});

    expect(resolved.selected).toBe("playwright");
    expect(resolved.fallbackReason).toBeNull();
  });
});
