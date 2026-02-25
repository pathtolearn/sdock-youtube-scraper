import { describe, expect, it } from "vitest";

import { detectYouTubeGate, looksBlocked } from "../src/http";

describe("detectYouTubeGate", () => {
  it("detects consent walls from URL and HTML markers", () => {
    expect(detectYouTubeGate("<html>Before you continue to YouTube<button>Accept all</button></html>", "https://consent.youtube.com/").state).toBe(
      "consent_wall",
    );
  });

  it("detects challenge walls", () => {
    expect(detectYouTubeGate("Our systems have detected unusual traffic from your computer network", "https://www.youtube.com/watch?v=x").state).toBe(
      "challenge_wall",
    );
  });

  it("does not misclassify normal content", () => {
    expect(detectYouTubeGate("<html><script>var ytInitialData={};</script></html>", "https://www.youtube.com/watch?v=x").state).toBe("none");
  });
});

describe("looksBlocked", () => {
  it("flags http 429 as blocked", () => {
    const blocked = looksBlocked(429, "ok", "https://www.youtube.com/watch?v=x");
    expect(blocked.blocked).toBe(true);
    expect(blocked.reason).toBe("http_429");
  });

  it("flags consent/challenge html as blocked", () => {
    const blocked = looksBlocked(200, "Before you continue to YouTube", "https://consent.youtube.com/");
    expect(blocked.blocked).toBe(true);
    expect(blocked.reason).toBe("challenge_or_consent_wall");
    expect(blocked.state).toBe("consent_wall");
  });
});
