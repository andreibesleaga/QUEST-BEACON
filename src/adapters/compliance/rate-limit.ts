// BEACON — pipeline stage 3: sliding-window rate limit (E6·T-262; ADR-017/CM-C12/LLM10/ASI04).
// Per-caller sliding window from policies.yml rate_limit; exceeding it short-circuits 429 Retry-After.
// Deterministic via an injectable clock (no real timers) so tests are stable.
export interface RateLimiter {
  /** true = within budget (allowed); false = window exceeded (429). */
  check(callerKey: string): boolean;
  retryAfterMs: number;
}

export function makeRateLimiter(
  windowMs: number,
  maxRequests: number,
  now: () => number = () => Date.now(),
): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    retryAfterMs: windowMs,
    check(callerKey: string): boolean {
      const t = now();
      const recent = (hits.get(callerKey) ?? []).filter((ts) => t - ts < windowMs);
      if (recent.length >= maxRequests) {
        hits.set(callerKey, recent);
        return false;
      }
      recent.push(t);
      hits.set(callerKey, recent);
      return true;
    },
  };
}
