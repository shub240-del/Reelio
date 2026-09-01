export class RateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super(`Too many requests. Retry in ${retryAfterSeconds} seconds.`);
    this.name = "RateLimitError";
  }
}

import {
  getCoordinationAdapter,
  resetCoordinationForTests,
} from "./coordination";

/** Shared fixed-window guard. Development uses the explicit memory adapter. */
export async function consumeRateLimit(
  scope: string,
  subject: string | number,
  limit: number,
  windowMs: number,
) {
  const decision = await getCoordinationAdapter().consumeRateLimit(
    scope,
    subject,
    limit,
    windowMs
  );
  if (!decision.allowed) throw new RateLimitError(decision.retryAfterSeconds);
}

export async function resetRateLimitsForTests() {
  await resetCoordinationForTests();
}
