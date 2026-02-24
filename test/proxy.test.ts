import { beforeEach, describe, expect, it, vi } from "vitest";

const playwrightMock = vi.hoisted(() => {
  const proxiedFetchSpy = vi.fn();
  const disposeSpy = vi.fn();
  const newContextSpy = vi.fn(async () => ({
    fetch: proxiedFetchSpy,
    dispose: disposeSpy,
  }));
  return { proxiedFetchSpy, disposeSpy, newContextSpy };
});

vi.mock("playwright", () => ({
  request: {
    newContext: playwrightMock.newContextSpy,
  },
}));

const { proxiedFetchSpy, newContextSpy } = playwrightMock;

import {
  playwrightProxyConfig,
  proxyFetch,
  readProxySettings,
  shouldProxyBrowser,
  shouldProxyHttp,
} from "../src/proxy";

describe("proxy helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses runtime proxy settings and apply scope", () => {
    const settings = readProxySettings({
      STEALTHDOCK_PROXY_ENABLED: "1",
      STEALTHDOCK_PROXY_APPLY_SCOPE: "http_only",
      STEALTHDOCK_PROXY_URL: "http://proxy.example.com:8080",
      STEALTHDOCK_PROXY_PROVIDER: "brightdata",
    });

    expect(settings.enabled).toBe(true);
    expect(settings.applyScope).toBe("http_only");
    expect(settings.proxyUrl).toBe("http://proxy.example.com:8080/");
    expect(settings.provider).toBe("brightdata");
    expect(shouldProxyHttp(settings)).toBe(true);
    expect(shouldProxyBrowser(settings)).toBe(false);
  });

  it("creates playwright proxy config from URL credentials", () => {
    const settings = readProxySettings({
      STEALTHDOCK_PROXY_ENABLED: "1",
      STEALTHDOCK_PROXY_APPLY_SCOPE: "all_outbound",
      STEALTHDOCK_PROXY_URL: "http://user:pass@proxy.example.com:9000",
    });

    expect(playwrightProxyConfig(settings)).toEqual({
      server: "http://proxy.example.com:9000",
      username: "user",
      password: "pass",
    });
  });

  it("uses direct fetch when http proxy scope is disabled", async () => {
    const fetchSpy = vi.fn(async () => ({
      status: 200,
      url: "https://example.com/",
      text: async () => "ok",
    }));
    vi.stubGlobal("fetch", fetchSpy as typeof fetch);

    const settings = readProxySettings({
      STEALTHDOCK_PROXY_ENABLED: "1",
      STEALTHDOCK_PROXY_APPLY_SCOPE: "browser_only",
      STEALTHDOCK_PROXY_URL: "http://user:pass@proxy.example.com:9000",
    });

    const response = await proxyFetch("https://example.com", { method: "GET" }, settings);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(newContextSpy).not.toHaveBeenCalled();
  });

  it("routes through playwright request context when http proxy applies", async () => {
    proxiedFetchSpy.mockResolvedValue({
      status: () => 201,
      url: () => "https://example.com/proxied",
      text: async () => "proxied",
    });

    const directFetchSpy = vi.fn();
    vi.stubGlobal("fetch", directFetchSpy as typeof fetch);

    const settings = readProxySettings({
      STEALTHDOCK_PROXY_ENABLED: "1",
      STEALTHDOCK_PROXY_APPLY_SCOPE: "all_outbound",
      STEALTHDOCK_PROXY_URL: "http://user:pass@proxy.example.com:9000",
    });
    const response = await proxyFetch(
      "https://example.com",
      {
        method: "POST",
        headers: { "x-test": "1" },
        body: "payload",
      },
      settings,
    );

    expect(response.status).toBe(201);
    expect(await response.text()).toBe("proxied");
    expect(newContextSpy).toHaveBeenCalledWith({
      proxy: {
        server: "http://proxy.example.com:9000",
        username: "user",
        password: "pass",
      },
      ignoreHTTPSErrors: true,
    });
    expect(proxiedFetchSpy).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        method: "POST",
        headers: { "x-test": "1" },
        data: "payload",
      }),
    );
    expect(directFetchSpy).not.toHaveBeenCalled();
  });
});
