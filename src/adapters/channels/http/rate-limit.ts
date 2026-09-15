// BEACON — naive per-actor rate limiter (E7·T-320c; SECURITY_BASELINE §2/API4). A simple in-memory token
// bucket keyed per actor, with an INJECTED clock so tests are deterministic (no wall-clock, no timers).
// This is intentionally small-but-real; the production guard (rate-limiter-flexible, per-IP+per-route
// sliding window) lands with T-320c — this covers the channel-local abuse floor.
import type { RateLimiter } from './http-types.js';

export interface TokenBucketOptions {
  /** Bucket size = max burst (default 60). */
  readonly capacity?: number;
  /** Tokens refilled per second (default 30). */
  readonly refillPerSec?: number;
  /** Injected clock (ISO-8601). Shares the core clock for determinism. */
  readonly clock: () => string;
}

interface Bucket {
  tokens: number;
  lastMs: number;
}

/** Create a token-bucket limiter. `take(key)` returns false when the actor's bucket is empty (→ 429). */
export function createTokenBucketLimiter(options: TokenBucketOptions): RateLimiter {
  const capacity = options.capacity ?? 60;
  const refillPerSec = options.refillPerSec ?? 30;
  const buckets = new Map<string, Bucket>();

  return {
    take(key: string): boolean {
      const nowMs = Date.parse(options.clock());
      const bucket = buckets.get(key) ?? { tokens: capacity, lastMs: nowMs };
      const elapsedSec = Math.max(0, (nowMs - bucket.lastMs) / 1000);
      bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSec * refillPerSec);
      bucket.lastMs = nowMs;
      const allowed = bucket.tokens >= 1;
      if (allowed) bucket.tokens -= 1;
      buckets.set(key, bucket);
      return allowed;
    },
  };
}
