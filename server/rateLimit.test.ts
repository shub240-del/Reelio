import { beforeEach, describe, expect, it } from "vitest";
import {
  consumeRateLimit,
  RateLimitError,
  resetRateLimitsForTests,
} from "./rateLimit";

describe("rate limiter", () => {
  beforeEach(() => resetRateLimitsForTests());

  it("isolates subjects and rejects requests above the fixed-window limit", () => {
    consumeRateLimit("ai", 1, 2, 60_000, 1_000);
    consumeRateLimit("ai", 1, 2, 60_000, 1_001);
    consumeRateLimit("ai", 2, 2, 60_000, 1_002);

    expect(() => consumeRateLimit("ai", 1, 2, 60_000, 1_003)).toThrow(
      RateLimitError
    );
  });

  it("starts a fresh bucket after the window expires", () => {
    consumeRateLimit("upload", "user", 1, 1_000, 5_000);
    expect(() => consumeRateLimit("upload", "user", 1, 1_000, 5_999)).toThrow(
      "Retry in 1 seconds"
    );
    expect(() =>
      consumeRateLimit("upload", "user", 1, 1_000, 6_000)
    ).not.toThrow();
  });
});
