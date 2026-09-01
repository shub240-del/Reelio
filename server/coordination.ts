import { createHash, randomUUID } from "node:crypto";
import { createClient, type RedisClientType } from "redis";

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface CoordinationAdapter {
  readonly kind: "memory" | "redis";
  consumeRateLimit(
    scope: string,
    subject: string | number,
    limit: number,
    windowMs: number
  ): Promise<RateLimitDecision>;
  acquireLease(jobKey: string, ownerId: string, ttlMs: number): Promise<boolean>;
  renewLease(jobKey: string, ownerId: string, ttlMs: number): Promise<boolean>;
  releaseLease(jobKey: string, ownerId: string): Promise<void>;
  requestCancellation(jobKey: string, ttlMs?: number): Promise<void>;
  isCancellationRequested(jobKey: string): Promise<boolean>;
  clearJobState(jobKey: string): Promise<void>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

interface MemoryBucket {
  startedAt: number;
  count: number;
}

interface MemoryLease {
  ownerId: string;
  expiresAt: number;
}

export interface MemoryCoordinationState {
  buckets: Map<string, MemoryBucket>;
  leases: Map<string, MemoryLease>;
  cancellations: Map<string, number>;
}

export function createMemoryCoordinationState(): MemoryCoordinationState {
  return {
    buckets: new Map(),
    leases: new Map(),
    cancellations: new Map(),
  };
}

const sharedMemoryState = createMemoryCoordinationState();

function assertPositiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

function digest(value: string | number) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 32);
}

function redisKey(kind: string, value: string) {
  return `reelio:v1:${kind}:${value}`;
}

export class MemoryCoordinationAdapter implements CoordinationAdapter {
  readonly kind = "memory" as const;

  constructor(private readonly state = sharedMemoryState) {}

  async consumeRateLimit(
    scope: string,
    subject: string | number,
    limit: number,
    windowMs: number
  ): Promise<RateLimitDecision> {
    assertPositiveInteger(limit, "Rate limit");
    assertPositiveInteger(windowMs, "Rate-limit window");
    const now = Date.now();
    const key = `${scope}:${digest(subject)}`;
    const bucket = this.state.buckets.get(key);
    if (!bucket || now - bucket.startedAt >= windowMs) {
      this.state.buckets.set(key, { startedAt: now, count: 1 });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (bucket.count >= limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((bucket.startedAt + windowMs - now) / 1000)
        ),
      };
    }
    bucket.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  async acquireLease(jobKey: string, ownerId: string, ttlMs: number) {
    assertPositiveInteger(ttlMs, "Lease TTL");
    const now = Date.now();
    const current = this.state.leases.get(jobKey);
    if (current && current.expiresAt > now && current.ownerId !== ownerId) {
      return false;
    }
    this.state.leases.set(jobKey, { ownerId, expiresAt: now + ttlMs });
    return true;
  }

  async renewLease(jobKey: string, ownerId: string, ttlMs: number) {
    assertPositiveInteger(ttlMs, "Lease TTL");
    const current = this.state.leases.get(jobKey);
    if (
      !current ||
      current.ownerId !== ownerId ||
      current.expiresAt <= Date.now()
    ) {
      return false;
    }
    current.expiresAt = Date.now() + ttlMs;
    return true;
  }

  async releaseLease(jobKey: string, ownerId: string) {
    if (this.state.leases.get(jobKey)?.ownerId === ownerId) {
      this.state.leases.delete(jobKey);
    }
  }

  async requestCancellation(jobKey: string, ttlMs = 60 * 60 * 1000) {
    assertPositiveInteger(ttlMs, "Cancellation TTL");
    this.state.cancellations.set(jobKey, Date.now() + ttlMs);
  }

  async isCancellationRequested(jobKey: string) {
    const expiresAt = this.state.cancellations.get(jobKey);
    if (!expiresAt) return false;
    if (expiresAt <= Date.now()) {
      this.state.cancellations.delete(jobKey);
      return false;
    }
    return true;
  }

  async clearJobState(jobKey: string) {
    this.state.cancellations.delete(jobKey);
  }

  async ping() {
    return true;
  }

  async close() {}
}

const RENEW_LEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0`;

const RELEASE_LEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0`;

const RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}`;

export class RedisCoordinationAdapter implements CoordinationAdapter {
  readonly kind = "redis" as const;
  private readonly client: RedisClientType;
  private connectPromise: Promise<RedisClientType> | null = null;

  constructor(url: string) {
    if (!url) throw new Error("REDIS_URL is required for Redis coordination.");
    this.client = createClient({
      url,
      socket: {
        connectTimeout: 2_000,
        reconnectStrategy: false,
      },
    });
    this.client.on("error", () => {
      // Callers receive the operation failure. Do not log connection strings or
      // silently downgrade to process-local coordination.
    });
  }

  private async connected() {
    if (this.client.isReady) return this.client;
    this.connectPromise ??= this.client.connect().catch(error => {
      this.connectPromise = null;
      throw error;
    });
    return this.connectPromise;
  }

  async consumeRateLimit(
    scope: string,
    subject: string | number,
    limit: number,
    windowMs: number
  ): Promise<RateLimitDecision> {
    assertPositiveInteger(limit, "Rate limit");
    assertPositiveInteger(windowMs, "Rate-limit window");
    const client = await this.connected();
    const value = (await client.eval(RATE_LIMIT_SCRIPT, {
      keys: [redisKey("rate", `${digest(scope)}:${digest(subject)}`)],
      arguments: [String(windowMs)],
    })) as [number, number];
    const [count, ttl] = value.map(Number);
    return {
      allowed: count <= limit,
      retryAfterSeconds:
        count <= limit ? 0 : Math.max(1, Math.ceil(Math.max(ttl, 1) / 1000)),
    };
  }

  async acquireLease(jobKey: string, ownerId: string, ttlMs: number) {
    assertPositiveInteger(ttlMs, "Lease TTL");
    const result = await (await this.connected()).set(
      redisKey("lease", digest(jobKey)),
      ownerId,
      { NX: true, PX: ttlMs }
    );
    return result === "OK";
  }

  async renewLease(jobKey: string, ownerId: string, ttlMs: number) {
    assertPositiveInteger(ttlMs, "Lease TTL");
    const result = await (await this.connected()).eval(RENEW_LEASE_SCRIPT, {
      keys: [redisKey("lease", digest(jobKey))],
      arguments: [ownerId, String(ttlMs)],
    });
    return Number(result) === 1;
  }

  async releaseLease(jobKey: string, ownerId: string) {
    await (await this.connected()).eval(RELEASE_LEASE_SCRIPT, {
      keys: [redisKey("lease", digest(jobKey))],
      arguments: [ownerId],
    });
  }

  async requestCancellation(jobKey: string, ttlMs = 60 * 60 * 1000) {
    assertPositiveInteger(ttlMs, "Cancellation TTL");
    await (await this.connected()).set(
      redisKey("cancel", digest(jobKey)),
      "1",
      { PX: ttlMs }
    );
  }

  async isCancellationRequested(jobKey: string) {
    return (
      (await (await this.connected()).exists(
        redisKey("cancel", digest(jobKey))
      )) === 1
    );
  }

  async clearJobState(jobKey: string) {
    await (await this.connected()).del(redisKey("cancel", digest(jobKey)));
  }

  async ping() {
    return (await (await this.connected()).ping()) === "PONG";
  }

  async close() {
    if (this.client.isOpen) await this.client.quit();
  }
}

let singleton: CoordinationAdapter | null = null;

export function getCoordinationAdapter(): CoordinationAdapter {
  if (singleton) return singleton;
  const redisUrl = process.env.REDIS_URL?.trim();
  if (redisUrl) {
    singleton = new RedisCoordinationAdapter(redisUrl);
    return singleton;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "REDIS_URL is required in production for shared rate limits and job coordination."
    );
  }
  singleton = new MemoryCoordinationAdapter();
  return singleton;
}

export async function checkCoordinationConnection() {
  try {
    return await getCoordinationAdapter().ping();
  } catch {
    return false;
  }
}

export async function resetCoordinationForTests() {
  if (singleton) await singleton.close();
  singleton = null;
  sharedMemoryState.buckets.clear();
  sharedMemoryState.leases.clear();
  sharedMemoryState.cancellations.clear();
}

export function createWorkerId() {
  return `${process.pid}:${randomUUID()}`;
}
