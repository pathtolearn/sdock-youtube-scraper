import { request, type APIRequestContext } from "playwright";

export type ProxyApplyScope = "all_outbound" | "http_only" | "browser_only";

export type RuntimeProxySettings = {
  enabled: boolean;
  applyScope: ProxyApplyScope;
  proxyUrl: string | null;
  provider: string | null;
  endpoint: string | null;
  profileId: string | null;
  rotationMode: string | null;
};

export type ProxyFetchResponse = {
  status: number;
  url: string;
  text: () => Promise<string>;
};

let cachedProxyContext: APIRequestContext | null = null;
let cachedProxyUrl: string | null = null;

function normalizeProxyUrl(raw: string | undefined): string | null {
  const value = (raw || "").trim();
  if (!value) {
    return null;
  }
  try {
    return new URL(value).toString();
  } catch {
    try {
      return new URL(`http://${value}`).toString();
    } catch {
      return null;
    }
  }
}

function parseApplyScope(raw: string | undefined): ProxyApplyScope {
  if (raw === "http_only" || raw === "browser_only" || raw === "all_outbound") {
    return raw;
  }
  return "all_outbound";
}

function headersToRecord(headers?: HeadersInit): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }
  if (headers instanceof Headers) {
    const out: Record<string, string> = {};
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return headers;
}

function toPlaywrightProxy(proxyUrl: string): { server: string; username?: string; password?: string } {
  const parsed = new URL(proxyUrl);
  return {
    server: `${parsed.protocol}//${parsed.host}`,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
  };
}

async function getProxyRequestContext(settings: RuntimeProxySettings): Promise<APIRequestContext> {
  if (!settings.proxyUrl) {
    throw new Error("Proxy URL missing");
  }
  if (cachedProxyContext && cachedProxyUrl === settings.proxyUrl) {
    return cachedProxyContext;
  }
  if (cachedProxyContext) {
    await cachedProxyContext.dispose();
  }
  cachedProxyContext = await request.newContext({
    proxy: toPlaywrightProxy(settings.proxyUrl),
    ignoreHTTPSErrors: true,
  });
  cachedProxyUrl = settings.proxyUrl;
  return cachedProxyContext;
}

export function readProxySettings(env: Record<string, string | undefined> = process.env): RuntimeProxySettings {
  const proxyUrl =
    normalizeProxyUrl(env.STEALTHDOCK_PROXY_URL) ||
    normalizeProxyUrl(env.HTTPS_PROXY) ||
    normalizeProxyUrl(env.HTTP_PROXY) ||
    normalizeProxyUrl(env.ALL_PROXY) ||
    normalizeProxyUrl(env.https_proxy) ||
    normalizeProxyUrl(env.http_proxy) ||
    normalizeProxyUrl(env.all_proxy);
  const applyScope = parseApplyScope(env.STEALTHDOCK_PROXY_APPLY_SCOPE);
  const enabledFlag = (env.STEALTHDOCK_PROXY_ENABLED || "").trim() === "1";
  return {
    enabled: Boolean(proxyUrl) && (enabledFlag || Boolean(proxyUrl)),
    applyScope,
    proxyUrl,
    provider: (env.STEALTHDOCK_PROXY_PROVIDER || "").trim() || null,
    endpoint: (env.STEALTHDOCK_PROXY_ENDPOINT || "").trim() || null,
    profileId: (env.STEALTHDOCK_PROXY_PROFILE_ID || "").trim() || null,
    rotationMode: (env.STEALTHDOCK_PROXY_ROTATION_MODE || "").trim() || null,
  };
}

export function shouldProxyHttp(settings: RuntimeProxySettings): boolean {
  return settings.enabled && (settings.applyScope === "all_outbound" || settings.applyScope === "http_only");
}

export function shouldProxyBrowser(settings: RuntimeProxySettings): boolean {
  return settings.enabled && (settings.applyScope === "all_outbound" || settings.applyScope === "browser_only");
}

export function playwrightProxyConfig(
  settings: RuntimeProxySettings,
): { server: string; username?: string; password?: string } | undefined {
  if (!shouldProxyBrowser(settings) || !settings.proxyUrl) {
    return undefined;
  }
  return toPlaywrightProxy(settings.proxyUrl);
}

export async function proxyFetch(
  url: string,
  init: RequestInit | undefined,
  settings: RuntimeProxySettings,
): Promise<ProxyFetchResponse> {
  if (!shouldProxyHttp(settings)) {
    const response = await fetch(url, init);
    return {
      status: response.status,
      url: response.url || url,
      text: () => response.text(),
    };
  }
  const context = await getProxyRequestContext(settings);
  const response = await context.fetch(url, {
    method: init?.method,
    headers: headersToRecord(init?.headers),
    data: init?.body as string | Buffer | undefined,
    failOnStatusCode: false,
    maxRedirects: 20,
  });
  return {
    status: response.status(),
    url: response.url() || url,
    text: () => response.text(),
  };
}

export function proxyRuntimeEventPayload(settings: RuntimeProxySettings): Record<string, unknown> {
  return {
    enabled: settings.enabled,
    apply_scope: settings.applyScope,
    provider: settings.provider,
    endpoint: settings.endpoint,
    profile_id: settings.profileId,
    rotation_mode: settings.rotationMode,
  };
}
