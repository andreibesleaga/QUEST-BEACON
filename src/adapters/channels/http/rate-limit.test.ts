// BEACON — token-bucket rate limiter tests (E7·T-320c). Deterministic: fixed clock, no timers.
import { describe, it, expect } from 'vitest';
import { createTokenBucketLimiter } from './rate-limit.js';

const FIXED = '2026-07-05T22:00:00Z';

describe('createTokenBucketLimiter', () => {
  it('allows up to capacity then rejects (429 signal) with a frozen clock', () => {
    const limiter = createTokenBucketLimiter({ capacity: 2, refillPerSec: 0, clock: () => FIXED });
    expect(limiter.take('a')).toBe(true);
    expect(limiter.take('a')).toBe(true);
    expect(limiter.take('a')).toBe(false);
  });

  it('isolates buckets per actor key', () => {
    const limiter = createTokenBucketLimiter({ capacity: 1, refillPerSec: 0, clock: () => FIXED });
    expect(limiter.take('a')).toBe(true);
    expect(limiter.take('b')).toBe(true); // different actor, own bucket
    expect(limiter.take('a')).toBe(false);
  });

  it('refills over elapsed time', () => {
    let t = Date.parse(FIXED);
    const clock = () => new Date(t).toISOString();
    const limiter = createTokenBucketLimiter({ capacity: 1, refillPerSec: 1, clock });
    expect(limiter.take('a')).toBe(true);
    expect(limiter.take('a')).toBe(false);
    t += 1000; // one second → one token back
    expect(limiter.take('a')).toBe(true);
  });
});
