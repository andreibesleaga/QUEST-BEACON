// BEACON — sliding-window rate limit tests (E6·T-261/T-262; ADR-017/CM-C12/LLM10).
import { describe, expect, it } from 'vitest';
import { makeRateLimiter } from './rate-limit.js';

describe('makeRateLimiter — per-caller sliding window', () => {
  it('permits up to max_requests then blocks within the window', () => {
    const t = 0;
    const rl = makeRateLimiter(1000, 2, () => t);
    expect(rl.check('em')).toBe(true);
    expect(rl.check('em')).toBe(true);
    expect(rl.check('em')).toBe(false); // 3rd within window
  });

  it('resets once the window slides past old hits', () => {
    let t = 0;
    const rl = makeRateLimiter(1000, 1, () => t);
    expect(rl.check('em')).toBe(true);
    expect(rl.check('em')).toBe(false);
    t = 1001;
    expect(rl.check('em')).toBe(true);
  });

  it('isolates callers (one caller cannot exhaust another)', () => {
    const t = 0;
    const rl = makeRateLimiter(1000, 1, () => t);
    expect(rl.check('em')).toBe(true);
    expect(rl.check('public')).toBe(true);
  });
});
