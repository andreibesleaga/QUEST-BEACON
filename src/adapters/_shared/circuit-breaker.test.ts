// BEACON — Circuit-breaker tests (E4·T-133; ADR-009/F5). Assert the CLOSED→OPEN→HALF_OPEN→CLOSED
// transitions of adapter-contract §3.1.2: N consecutive failures trip OPEN and short-circuit; after the
// cooldown a single trial re-closes on success.
import { describe, it, expect, vi } from 'vitest';
import { isBrokenCircuitError } from 'cockatiel';
import { ManagedBreaker, classify, DEFAULT_BACKSTOP_TIMEOUT_MS } from './circuit-breaker.js';
import { makeAdapterError } from './errors.js';

const cfg = {
  failureThreshold: 2,
  cooldownSec: 0.03,
  halfOpenTrials: 1,
  timeoutMs: 1000,
  maxRetries: 0,
};

const fail = () => Promise.reject(new Error('upstream down'));

describe('ManagedBreaker (F5)', () => {
  it('starts CLOSED and reports zero failures', () => {
    const b = new ManagedBreaker(cfg);
    expect(b.state()).toBe('CLOSED');
    expect(b.health().consecutiveFailures).toBe(0);
  });

  it('trips OPEN after N consecutive failures and short-circuits to a BrokenCircuitError', async () => {
    const b = new ManagedBreaker(cfg);
    await expect(b.execute(fail)).rejects.toThrow();
    await expect(b.execute(fail)).rejects.toThrow();
    expect(b.state()).toBe('OPEN');
    expect(b.health().consecutiveFailures).toBeGreaterThanOrEqual(2);
    // Next call is short-circuited (no upstream hit) with a broken-circuit error → classify=CIRCUIT_OPEN.
    let caught: unknown;
    await b.execute(() => Promise.resolve(1)).catch((e) => (caught = e));
    expect(isBrokenCircuitError(caught)).toBe(true);
    expect(classify(caught).kind).toBe('CIRCUIT_OPEN');
  });

  it('re-CLOSES after cooldown when the HALF_OPEN trial succeeds', async () => {
    // Fixed-clock discipline: cockatiel's OPEN→HALF_OPEN transition is gated on Date.now() elapsing past
    // halfOpenAfter (not on a scheduled timer), so fake timers — which also freeze/advance Date.now — drive
    // the cooldown deterministically with ZERO wall-clock dependence (no CI-throttling flake). We advance a
    // hair past the 30ms cooldown, then the trial call finds the breaker HALF_OPEN and its success re-CLOSES.
    vi.useFakeTimers();
    try {
      const b = new ManagedBreaker(cfg);
      await b.execute(fail).catch(() => undefined);
      await b.execute(fail).catch(() => undefined);
      expect(b.state()).toBe('OPEN');
      await vi.advanceTimersByTimeAsync(45); // deterministically elapse the 30ms cooldown (no real clock)
      const value = await b.execute(() => Promise.resolve(42));
      expect(value).toBe(42);
      expect(b.state()).toBe('CLOSED');
      expect(b.health().consecutiveFailures).toBe(0);
      expect(b.health().lastSuccessAt).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets the failure counter and records lastSuccessAt on success', async () => {
    const b = new ManagedBreaker(cfg);
    await b.execute(fail).catch(() => undefined);
    await b.execute(() => Promise.resolve('ok'));
    expect(b.health().consecutiveFailures).toBe(0);
    expect(b.state()).toBe('CLOSED');
  });

  // Regression for the two-timeout cap (found live 2026-08-04): the DEFAULT breaker timeout used to be
  // the SAME 8s as the HTTP default, so any configured SOURCE_*_TIMEOUT_MS above 8s was silently killed
  // by the breaker with "Operation timed out after 8000ms" (WorldPop's 30s budget could never work).
  // The default is now a hang BACKSTOP that must sit ABOVE every legitimate per-source budget; an
  // explicit cfg.timeoutMs still wins (the explicit-1000ms behaviour is covered by the tests above).
  it('default per-attempt timeout is a hang backstop ABOVE per-source budgets, not an 8s cap', async () => {
    vi.useFakeTimers();
    try {
      const b = new ManagedBreaker({ failureThreshold: 3, cooldownSec: 1 }); // NO explicit timeoutMs
      // A 30s attempt (the documented WorldPop budget) must SURVIVE the default policy.
      const slow = b.execute(
        () => new Promise<string>((res) => setTimeout(() => res('ok'), 30_000)),
      );
      await vi.advanceTimersByTimeAsync(30_001);
      await expect(slow).resolves.toBe('ok');
      expect(DEFAULT_BACKSTOP_TIMEOUT_MS).toBeGreaterThan(30_000);
      // …and a true hang is STILL killed by the backstop (the guard is loosened, not removed).
      const hang = b.execute(() => new Promise<never>(() => {}));
      const rejected = expect(hang).rejects.toThrow();
      // Default retries (2) each get their own backstop window + backoff — advance past all of them.
      await vi.advanceTimersByTimeAsync(3 * DEFAULT_BACKSTOP_TIMEOUT_MS + 10_000);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('classify', () => {
  it('passes an AdapterError through unchanged', () => {
    const e = makeAdapterError('RATE_LIMITED', 'slow down');
    expect(classify(e)).toBe(e);
  });
  it('maps an unknown throw to a retryable UPSTREAM_UNAVAILABLE', () => {
    expect(classify(new Error('boom')).kind).toBe('UPSTREAM_UNAVAILABLE');
    expect(classify('weird').retryable).toBe(true);
  });
});
