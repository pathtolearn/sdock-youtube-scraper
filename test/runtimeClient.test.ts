import { afterEach, describe, expect, it, vi } from "vitest";

function applyEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const snapshot = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    process.env[key] = value;
  }
  return snapshot;
}

function restoreEnv(snapshot: NodeJS.ProcessEnv): void {
  const currentKeys = Object.keys(process.env);
  for (const key of currentKeys) {
    if (!(key in snapshot)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }
}

describe("runtimeClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("targets internal runtime API directly even when proxy env vars are set", async () => {
    const snapshot = applyEnv({
      STEALTHDOCK_RUN_ID: "run-runtime-client-test",
      STEALTHDOCK_RUN_TOKEN: "token-runtime-client-test",
      STEALTHDOCK_INTERNAL_API_BASE_URL: "http://host.docker.internal:8920",
      HTTP_PROXY: "http://proxy.example.com:8080",
      HTTPS_PROXY: "http://proxy.example.com:8080",
      ALL_PROXY: "http://proxy.example.com:8080",
    });
    try {
      const fetchSpy = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ run: { id: "run-runtime-client-test" } }),
        text: async () => "",
      }));
      vi.stubGlobal("fetch", fetchSpy as typeof fetch);

      const runtimeClient = await import("../src/runtimeClient");
      await runtimeClient.bootstrap();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [calledUrl] = fetchSpy.mock.calls[0];
      expect(String(calledUrl)).toContain("http://host.docker.internal:8920/v2/internal/runs/run-runtime-client-test/bootstrap");
      expect(String(calledUrl)).not.toContain("proxy.example.com");
    } finally {
      restoreEnv(snapshot);
    }
  });

  it("posts completion handshake payload to /complete", async () => {
    const snapshot = applyEnv({
      STEALTHDOCK_RUN_ID: "run-runtime-client-complete",
      STEALTHDOCK_RUN_TOKEN: "token-runtime-client-complete",
      STEALTHDOCK_INTERNAL_API_BASE_URL: "http://host.docker.internal:8920",
    });
    try {
      const fetchSpy = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ accepted: true }),
        text: async () => "",
      }));
      vi.stubGlobal("fetch", fetchSpy as typeof fetch);

      const runtimeClient = await import("../src/runtimeClient");
      await runtimeClient.complete({
        outcome: "succeeded",
        stop_reason: "queue_drained",
        remaining_policy: "require_empty",
        metrics: { processed_pages: 3 },
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
      expect(String(calledUrl)).toContain("/v2/internal/runs/run-runtime-client-complete/complete");
      const body = JSON.parse(String((calledInit as RequestInit).body));
      expect(body.outcome).toBe("succeeded");
      expect(body.remaining_policy).toBe("require_empty");
      expect(body.stop_reason).toBe("queue_drained");
    } finally {
      restoreEnv(snapshot);
    }
  });
});
