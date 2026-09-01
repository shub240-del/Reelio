import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RedisCoordinationAdapter } from "./coordination";

const redisUrl = process.env.REDIS_INTEGRATION_URL;
const describeRedis = redisUrl ? describe : describe.skip;
let first: RedisCoordinationAdapter;
let second: RedisCoordinationAdapter;

describeRedis("Redis multi-instance coordination", () => {
  beforeAll(async () => {
    first = new RedisCoordinationAdapter(redisUrl!);
    second = new RedisCoordinationAdapter(redisUrl!);
    expect(await first.ping()).toBe(true);
    expect(await second.ping()).toBe(true);
  });

  afterAll(async () => {
    await Promise.all([first?.close(), second?.close()]);
  });

  it("shares one atomic rate limit across two simulated instances", async () => {
    const subject = randomUUID();
    expect(
      await first.consumeRateLimit("integration", subject, 2, 10_000)
    ).toMatchObject({ allowed: true });
    expect(
      await second.consumeRateLimit("integration", subject, 2, 10_000)
    ).toMatchObject({ allowed: true });
    const denied = await first.consumeRateLimit(
      "integration",
      subject,
      2,
      10_000
    );
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("delivers cancellation requested by one instance to another", async () => {
    const job = `analysis:${randomUUID()}`;
    await first.requestCancellation(job, 10_000);
    expect(await second.isCancellationRequested(job)).toBe(true);
    await second.clearJobState(job);
    expect(await first.isCancellationRequested(job)).toBe(false);
  });

  it("prevents duplicate workers and safely recovers an abandoned lease", async () => {
    const job = `export:${randomUUID()}`;
    expect(await first.acquireLease(job, "worker-a", 150)).toBe(true);
    expect(await second.acquireLease(job, "worker-b", 150)).toBe(false);
    await new Promise(resolve => setTimeout(resolve, 220));
    expect(await second.acquireLease(job, "worker-b", 1_000)).toBe(true);
    expect(await first.renewLease(job, "worker-a", 1_000)).toBe(false);
    await second.releaseLease(job, "worker-b");
  });

  it("surfaces Redis outage instead of silently using memory", async () => {
    const unavailable = new RedisCoordinationAdapter("redis://127.0.0.1:6398");
    await expect(unavailable.ping()).rejects.toBeDefined();
    await unavailable.close();
  });
});
