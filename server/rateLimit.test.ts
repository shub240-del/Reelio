import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  consumeRateLimit,
  RateLimitError,
  resetRateLimitsForTests,
} from "./rateLimit";

describe("rate limiter", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await resetRateLimitsForTests();
  });
  afterEach(() => vi.useRealTimers());

  it("isolates subjects and rejects requests above the fixed-window limit", async () => {
    vi.setSystemTime(1_000);
    await consumeRateLimit("ai", 1, 2, 60_000);
    await consumeRateLimit("ai", 1, 2, 60_000);
    await consumeRateLimit("ai", 2, 2, 60_000);

    await expect(consumeRateLimit("ai", 1, 2, 60_000)).rejects.toBeInstanceOf(
      RateLimitError
    );
  });

  it("starts a fresh bucket after the window expires", async () => {
    vi.setSystemTime(5_000);
    await consumeRateLimit("upload", "user", 1, 1_000);
    vi.setSystemTime(5_999);
    await expect(
      consumeRateLimit("upload", "user", 1, 1_000)
    ).rejects.toThrow("Retry in 1 seconds");
    vi.setSystemTime(6_000);
    await expect(
      consumeRateLimit("upload", "user", 1, 1_000)
    ).resolves.toBeUndefined();
  });
});
