export class RateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super(`Too many requests. Retry in ${retryAfterSeconds} seconds.`);
    this.name = "RateLimitError";
  }
}

interface Bucket {
  startedAt: number;
  count: number;
}

const buckets = new Map<string, Bucket>();

/** Per-process fixed-window guard. Production can replace this with Redis without changing callers. */
export function consumeRateLimit(
  scope: string,
  subject: string | number,
  limit: number,
  windowMs: number,
  now = Date.now()
) {
  const key = `${scope}:${subject}`;
  const current = buckets.get(key);
  if (!current || now - current.startedAt >= windowMs) {
    buckets.set(key, { startedAt: now, count: 1 });
    return;
  }
  if (current.count >= limit) {
    throw new RateLimitError(
      Math.max(1, Math.ceil((current.startedAt + windowMs - now) / 1000))
    );
  }
  current.count += 1;

  if (buckets.size > 10_000) {
    for (const [bucketKey, bucket] of buckets) {
      if (now - bucket.startedAt >= windowMs) buckets.delete(bucketKey);
    }
  }
}

export function resetRateLimitsForTests() {
  buckets.clear();
}
