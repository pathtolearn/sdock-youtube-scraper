import { describe, expect, it } from "vitest";

import { completionPolicyForStopReason, evaluateStopReason } from "../src/stopPolicy";

describe("evaluateStopReason", () => {
  const baseState = {
    startedAtMs: 1_000,
    nowMs: 1_500,
    maxRuntimeSeconds: 10,
    processedPages: 0,
    maxPages: 100,
    emittedResults: 0,
    maxResults: 100,
    idleCycles: 0,
    maxIdleCycles: 5,
    queueDrainedIdleThreshold: 2,
  };

  it("returns max_runtime_reached when runtime is exceeded", () => {
    const reason = evaluateStopReason({
      ...baseState,
      nowMs: 12_000,
    });
    expect(reason).toBe("max_runtime_reached");
  });

  it("returns max_pages_reached when processed pages hit limit", () => {
    const reason = evaluateStopReason({
      ...baseState,
      processedPages: 100,
    });
    expect(reason).toBe("max_pages_reached");
  });

  it("returns max_results_reached when emitted results hit limit", () => {
    const reason = evaluateStopReason({
      ...baseState,
      emittedResults: 100,
    });
    expect(reason).toBe("max_results_reached");
  });

  it("returns max_idle_cycles_reached before queue_drained when idle limit is low", () => {
    const reason = evaluateStopReason({
      ...baseState,
      idleCycles: 1,
      maxIdleCycles: 1,
      queueDrainedIdleThreshold: 2,
    });
    expect(reason).toBe("max_idle_cycles_reached");
  });

  it("returns queue_drained when idle threshold is reached before max idle", () => {
    const reason = evaluateStopReason({
      ...baseState,
      idleCycles: 2,
      maxIdleCycles: 5,
      queueDrainedIdleThreshold: 2,
    });
    expect(reason).toBe("queue_drained");
  });

  it("maps queue_drained to require_empty completion", () => {
    const completion = completionPolicyForStopReason("queue_drained");
    expect(completion.outcome).toBe("succeeded");
    expect(completion.remainingPolicy).toBe("require_empty");
    expect(completion.remainingFailureType).toBeUndefined();
  });

  it("maps budget-like stop reasons to fail_remaining completion", () => {
    const completion = completionPolicyForStopReason("max_results_reached");
    expect(completion.outcome).toBe("succeeded");
    expect(completion.remainingPolicy).toBe("fail_remaining");
    expect(completion.remainingFailureType).toBe("budget");
  });
});
