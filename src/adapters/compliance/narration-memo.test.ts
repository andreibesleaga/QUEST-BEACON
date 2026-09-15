// BEACON — narration-memo tests. The guarantee under test is a COST guarantee with a correctness edge:
// identical, already-allowed requests must not reach the model twice inside the TTL, and anything that
// could legitimately change the answer (facts, role, tier, operation, time) must reach it again.
import { describe, expect, it } from 'vitest';
import { ok, err, isErr } from '@/domain/shared/result.js';
import { DomainError } from '@/domain/errors.js';
import type { Result } from '@/domain/shared/result.js';
import type { AICompliancePort, ComplianceDecision, ComplianceRequest } from '@/ports/intel.js';
import { withNarrationMemo } from './narration-memo.js';

/** A gateway stub that counts calls and returns whatever the test tells it to. */
function stub(
  reply: (n: number) => Result<ComplianceDecision<unknown>, DomainError> = () =>
    ok({ allowed: true, result: { text: 'prose' } }),
): { port: AICompliancePort; calls: () => number } {
  let calls = 0;
  const port: AICompliancePort = {
    mediate: async <TRes>(): Promise<Result<ComplianceDecision<TRes>, DomainError>> => {
      calls += 1;
      return reply(calls) as Result<ComplianceDecision<TRes>, DomainError>;
    },
  };
  return { port, calls: () => calls };
}

const REQ = (
  payload: unknown = { facts: ['a'] },
  over: Partial<ComplianceRequest<unknown>> = {},
): ComplianceRequest<unknown> => ({
  actorRole: 'EM',
  modelTier: 'CLOUD',
  operation: 'llm.narrate',
  payload,
  ...over,
});

/** A gateway stub whose reply is deferred until the test releases it — models the slow cloud call. */
function slowStub(): {
  port: AICompliancePort;
  calls: () => number;
  release: (decision?: ComplianceDecision<unknown>) => void;
  fail: (error: DomainError) => void;
} {
  let calls = 0;
  let settle: ((r: Result<ComplianceDecision<unknown>, DomainError>) => void) | undefined;
  const port: AICompliancePort = {
    mediate: async <TRes>(): Promise<Result<ComplianceDecision<TRes>, DomainError>> => {
      calls += 1;
      return new Promise<Result<ComplianceDecision<unknown>, DomainError>>((resolve) => {
        settle = resolve;
      }) as Promise<Result<ComplianceDecision<TRes>, DomainError>>;
    },
  };
  return {
    port,
    calls: () => calls,
    release: (decision = { allowed: true, result: { text: 'prose' } }) => settle?.(ok(decision)),
    fail: (error) => settle?.(err(error)),
  };
}

describe('withNarrationMemo — single-flight (A1: async narration must not multiply model calls)', () => {
  it('collapses CONCURRENT identical requests into ONE upstream call', async () => {
    // The async read path abandons its wait and returns deterministic-only, but the narration keeps
    // running. Every SSE-driven refetch arrives while that call is still in flight; without single-flight
    // each one would start another model call — the exact leak the memo exists to prevent.
    const { port, calls, release } = slowStub();
    const memo = withNarrationMemo(port, { ttlSec: 60, now: () => 1_000 });
    const a = memo.mediate(REQ());
    const b = memo.mediate(REQ());
    const c = memo.mediate(REQ());
    expect(calls()).toBe(1);
    release();
    expect(await a).toEqual(await b);
    expect(await b).toEqual(await c);
    expect(calls()).toBe(1);
  });

  it('does NOT share a flight between different fact sets', async () => {
    const { port, calls, release } = slowStub();
    const memo = withNarrationMemo(port, { ttlSec: 60, now: () => 1_000 });
    void memo.mediate(REQ({ facts: ['a'] }));
    void memo.mediate(REQ({ facts: ['b'] }));
    expect(calls()).toBe(2);
    release();
  });

  it('serves the completed flight from the cache afterwards — one call total', async () => {
    const { port, calls, release } = slowStub();
    const memo = withNarrationMemo(port, { ttlSec: 60, now: () => 1_000 });
    const inflight = memo.mediate(REQ());
    release();
    await inflight;
    await memo.mediate(REQ());
    expect(calls()).toBe(1);
  });

  it('clears the flight on failure so the next attempt can retry — a breaker-open must be free to clear', async () => {
    const { port, calls, fail } = slowStub();
    const memo = withNarrationMemo(port, { ttlSec: 60, now: () => 1_000 });
    const first = memo.mediate(REQ());
    fail(new DomainError('INTERNAL_ERROR', 'breaker open'));
    expect(isErr(await first)).toBe(true);
    void memo.mediate(REQ());
    expect(calls()).toBe(2);
  });

  it('clears the flight when the upstream REJECTS, and propagates the rejection', async () => {
    let calls = 0;
    const port: AICompliancePort = {
      mediate: async (): Promise<never> => {
        calls += 1;
        return Promise.reject(new Error('socket hang up'));
      },
    };
    const memo = withNarrationMemo(port, { ttlSec: 60, now: () => 1_000 });
    await expect(memo.mediate(REQ())).rejects.toThrow('socket hang up');
    await expect(memo.mediate(REQ())).rejects.toThrow('socket hang up');
    expect(calls).toBe(2);
  });
});

describe('withNarrationMemo', () => {
  it('calls the gateway once for identical requests inside the TTL — the SSE-refetch storm costs one call', async () => {
    const { port, calls } = stub();
    const memo = withNarrationMemo(port, { ttlSec: 60, now: () => 1_000 });
    const a = await memo.mediate(REQ());
    const b = await memo.mediate(REQ());
    expect(calls()).toBe(1);
    expect(a).toEqual(b);
  });

  it('narrates again once the TTL expires', async () => {
    const { port, calls } = stub();
    let clock = 1_000;
    const memo = withNarrationMemo(port, { ttlSec: 10, now: () => clock });
    await memo.mediate(REQ());
    clock += 10_001;
    await memo.mediate(REQ());
    expect(calls()).toBe(2);
  });

  it('treats different facts, roles, tiers and operations as different requests', async () => {
    const { port, calls } = stub();
    const memo = withNarrationMemo(port, { ttlSec: 60, now: () => 1_000 });
    await memo.mediate(REQ({ facts: ['a'] }));
    await memo.mediate(REQ({ facts: ['b'] })); // different facts
    await memo.mediate(REQ({ facts: ['a'] }, { actorRole: 'PUBLIC' })); // different role
    await memo.mediate(REQ({ facts: ['a'] }, { modelTier: 'LOCAL' })); // different tier
    await memo.mediate(REQ({ facts: ['a'] }, { operation: 'vision.analyze' }));
    expect(calls()).toBe(5);
  });

  it('ignores property ORDER but respects array order', async () => {
    const { port, calls } = stub();
    const memo = withNarrationMemo(port, { ttlSec: 60, now: () => 1_000 });
    await memo.mediate(REQ({ a: 1, b: 2 }));
    await memo.mediate(REQ({ b: 2, a: 1 })); // same payload, different key order ⇒ cache hit
    expect(calls()).toBe(1);
    await memo.mediate(REQ({ facts: ['x', 'y'] }));
    await memo.mediate(REQ({ facts: ['y', 'x'] })); // reordered facts ⇒ a different SitRep
    expect(calls()).toBe(3);
  });

  it('never caches a BLOCK — a policy or breaker denial must be free to clear', async () => {
    const { port, calls } = stub(() => ok({ allowed: false, reason: 'breaker open' }));
    const memo = withNarrationMemo(port, { ttlSec: 60, now: () => 1_000 });
    await memo.mediate(REQ());
    await memo.mediate(REQ());
    expect(calls()).toBe(2);
  });

  it('never caches an allowed decision that carries no result', async () => {
    const { port, calls } = stub(() => ok({ allowed: true }));
    const memo = withNarrationMemo(port, { ttlSec: 60, now: () => 1_000 });
    await memo.mediate(REQ());
    await memo.mediate(REQ());
    expect(calls()).toBe(2);
  });

  it('never caches an error, and propagates it', async () => {
    const { port, calls } = stub(() => err(new DomainError('INTERNAL_ERROR', 'upstream gone')));
    const memo = withNarrationMemo(port, { ttlSec: 60, now: () => 1_000 });
    const first = await memo.mediate(REQ());
    await memo.mediate(REQ());
    expect(first.ok).toBe(false);
    expect(calls()).toBe(2);
  });

  it('evicts the oldest entry at the bound, so a long-lived instance cannot grow without limit', async () => {
    const { port, calls } = stub();
    const memo = withNarrationMemo(port, { ttlSec: 600, maxEntries: 2, now: () => 1_000 });
    await memo.mediate(REQ({ n: 1 }));
    await memo.mediate(REQ({ n: 2 }));
    await memo.mediate(REQ({ n: 3 })); // evicts n:1
    expect(calls()).toBe(3);
    await memo.mediate(REQ({ n: 3 })); // still cached
    expect(calls()).toBe(3);
    await memo.mediate(REQ({ n: 1 })); // evicted ⇒ narrates again
    expect(calls()).toBe(4);
  });

  it('returns the gateway UNWRAPPED when the TTL is not positive (memoization opt-out)', async () => {
    const { port, calls } = stub();
    const memo = withNarrationMemo(port, { ttlSec: 0 });
    expect(memo).toBe(port);
    await memo.mediate(REQ());
    await memo.mediate(REQ());
    expect(calls()).toBe(2);
  });

  it('handles null and primitive payloads without throwing', async () => {
    const { port, calls } = stub();
    const memo = withNarrationMemo(port, { ttlSec: 60, now: () => 1_000 });
    await memo.mediate(REQ(null));
    await memo.mediate(REQ(null));
    expect(calls()).toBe(1);
    await memo.mediate(REQ('text'));
    expect(calls()).toBe(2);
  });
});
