export type LeaseItem = {
  request_id: string;
  url: string;
  canonical_url: string;
  attempt: number;
  max_attempts: number;
  metadata: Record<string, unknown>;
};

export type BootstrapPayload = {
  run: {
    id: string;
    input: Record<string, unknown>;
    request_policy: {
      max_requests_per_minute: number;
      max_depth: number;
      include_globs: string[];
      exclude_globs: string[];
      respect_robots: boolean;
      dedupe_by_canonical_url: boolean;
    };
    concurrency: {
      min_concurrency: number;
      max_concurrency: number;
      autoscale_mode: "adaptive" | "fixed";
    };
    budget_policy: {
      max_items: number | null;
      max_total_charge_usd: number | null;
      soft_stop: boolean;
    };
  };
  output_schema: Record<string, unknown>;
};

export type CompletionOutcome = "succeeded" | "failed";
export type RemainingPolicy = "require_empty" | "fail_remaining";

export type CompletionRequest = {
  outcome: CompletionOutcome;
  stop_reason: string;
  remaining_policy: RemainingPolicy;
  remaining_failure_type?: "network" | "parse" | "blocked" | "policy" | "budget" | "infra";
  remaining_failure_reason?: string;
  metrics?: Record<string, unknown>;
};

const runId = process.env.STEALTHDOCK_RUN_ID || process.env.RUN_ID || "";
const runToken = process.env.STEALTHDOCK_RUN_TOKEN || process.env.RUN_TOKEN || "";
const baseUrl = process.env.STEALTHDOCK_INTERNAL_API_BASE_URL || process.env.INTERNAL_API_BASE_URL || "http://host.docker.internal:8920";
const requestTimeoutMs = Number(process.env.STEALTHDOCK_INTERNAL_API_TIMEOUT_MS || "15000");

function endpoint(path: string): string {
  if (!runId) {
    throw new Error("RUN_ID is required");
  }
  return `${baseUrl}/v2/internal/runs/${runId}${path}`;
}

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const url = endpoint(path);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, requestTimeoutMs));
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${runToken}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Internal API ${path} failed: ${response.status} ${text}`);
    }
    return (await response.json()) as T;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Internal API ${path} request failed: ${reason}`);
  } finally {
    clearTimeout(timeout);
  }
}

export async function bootstrap(): Promise<BootstrapPayload> {
  return post<BootstrapPayload>("/bootstrap", {});
}

export async function lease(workerId: string, limit: number, leaseSeconds = 60): Promise<LeaseItem[]> {
  const payload = await post<{ items: LeaseItem[] }>("/queue/lease", {
    worker_id: workerId,
    limit,
    lease_seconds: leaseSeconds,
  });
  return payload.items || [];
}

export async function enqueue(items: Array<{ url: string; discovered_from_request_id?: string; priority?: number; metadata?: Record<string, unknown> }>): Promise<void> {
  if (items.length === 0) {
    return;
  }
  await post("/queue/enqueue", { items });
}

export async function ack(requestId: string, statusCode: number, latencyMs: number, metadata: Record<string, unknown>): Promise<void> {
  await post("/queue/ack", {
    request_id: requestId,
    status_code: statusCode,
    latency_ms: latencyMs,
    metadata,
  });
}

export async function fail(
  requestId: string,
  errorType: "network" | "parse" | "blocked" | "policy" | "budget" | "infra",
  errorReason: string,
  retryable: boolean,
  statusCode: number | null,
  latencyMs: number,
): Promise<void> {
  await post("/queue/fail", {
    request_id: requestId,
    error_type: errorType,
    error_reason: errorReason,
    retryable,
    status_code: statusCode,
    latency_ms: latencyMs,
  });
}

export async function pushDataset(records: Array<Record<string, unknown>>): Promise<void> {
  if (records.length === 0) {
    return;
  }
  await post("/dataset/push", { records });
}

export async function event(
  eventType: string,
  payload: Record<string, unknown>,
  requestId?: string,
  stage?: string,
  message?: string,
  level = "info",
): Promise<void> {
  await post("/events", {
    event_type: eventType,
    request_id: requestId || null,
    stage: stage || null,
    payload,
    message: message || null,
    level,
  });
}

export async function complete(payload: CompletionRequest): Promise<void> {
  await post("/complete", payload);
}
