import { describe, expect, it } from "vitest";

import { buildContinuationRequest, extractContinuationItems, extractContinuationTokens } from "../src/pagination";

describe("pagination helpers", () => {
  it("builds continuation request payload", () => {
    const req = buildContinuationRequest({
      token: "TOKEN1",
      endpoint: "search",
      clientContext: { clientName: "WEB", clientVersion: "2.1", hl: "en", gl: "US" },
    });
    expect(req.endpoint).toContain("/search");
    expect(req.body.continuation).toBe("TOKEN1");
    expect(req.headers["x-youtube-client-name"]).toBe("WEB");
  });

  it("extracts continuation tokens and items", () => {
    const payload = {
      onResponseReceivedCommands: [
        {
          appendContinuationItemsAction: {
            continuationItems: [
              { videoRenderer: { videoId: "a" } },
              { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: "TOKEN2" } } } },
            ],
          },
        },
      ],
    };
    expect(extractContinuationItems(payload).length).toBeGreaterThan(0);
    expect(extractContinuationTokens(payload)).toContain("TOKEN2");
  });
});
