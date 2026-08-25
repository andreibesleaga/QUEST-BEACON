// BEACON — Redundancy ladder tests (E4·T-141; adapter-contract §3.1.5, ADR-009, Art. XVI). The engine
// walks live → last-known-good cache → recorded-mock → unavailable and NEVER dead-ends. Covers: live
// success caches; breaker-open → cache; source-down (no cache) → mock; all-rungs-fail → unavailable;
// NOT_COVERED; mode=MOCK/CACHED short-circuits.
import { describe, it, expect } from 'vitest';
import { ok } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { CachePort } from '@/ports/infra.js';
import type { AntiCorruptionMapper, Coverage, Region, RedundancySpec } from './index.js';
import { RedundancyEngine } from './index.js';

class FakeCache implements CachePort {
  private readonly store = new Map<string, unknown>();
  get<T>(key: string): Promise<Result<T | null, DomainError>> {
    return Promise.resolve(ok((this.store.get(key) ?? null) as T | null));
  }
  set<T>(key: string, value: T): Promise<Result<void, DomainError>> {
    this.store.set(key, value);
    return Promise.resolve(ok(undefined));
  }
  delete(key: string): Promise<Result<void, DomainError>> {
    this.store.delete(key);
    return Promise.resolve(ok(undefined));
  }
  clear(): void {
    this.store.clear();
  }
}

interface Raw {
  readonly v: number;
}
const mapper: AntiCorruptionMapper<Raw, number> = { toCanonical: (raw) => raw.v };
const GLOBAL: Coverage = { kind: 'GLOBAL' };
const region: Region = { id: 'ca', bbox: [-124, 32, -114, 42] };

function baseSpec(overrides: Partial<RedundancySpec<Raw, number>>): RedundancySpec<Raw, number> {
  return {
    adapterId: 'test',
    source: 'Test',
    license: 'Public Domain',
    mode: 'LIVE',
    coverage: GLOBAL,
    region,
    cacheTtlSec: 900,
    breaker: { failureThreshold: 2, cooldownSec: 60, halfOpenTrials: 1, timeoutMs: 500, maxRetries: 0 },
    mapper,
    loadMockRaw: () => Promise.resolve([{ v: 99 }]),
    ...overrides,
  };
}

const engine = (cache: CachePort) =>
  new RedundancyEngine({ cache, nowIso: () => '2026-07-05T10:00:00Z', idGen: () => 'sid-fixed' });

describe('RedundancyEngine ladder', () => {
  it('live success maps records, stamps LIVE provenance, and writes cache', async () => {
    const cache = new FakeCache();
    const res = await engine(cache).run(baseSpec({ fetchLive: () => Promise.resolve([{ v: 1 }, { v: 2 }]) }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('LIVE');
    expect(res.value.degraded).toBe(false);
    expect(res.value.records.map((r) => r.entity)).toEqual([1, 2]);
    expect(res.value.records[0]?.provenance.mode).toBe('LIVE');
  });

  it('serves last-known-good cache when the live call fails', async () => {
    const cache = new FakeCache();
    const eng = engine(cache);
    await eng.run(baseSpec({ fetchLive: () => Promise.resolve([{ v: 7 }]) })); // seed cache
    const res = await eng.run(baseSpec({ fetchLive: () => Promise.reject(new Error('down')) }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records.map((r) => r.entity)).toEqual([7]);
  });

  it('breaker-open short-circuits to cache (F5)', async () => {
    const cache = new FakeCache();
    const eng = engine(cache);
    await eng.run(baseSpec({ fetchLive: () => Promise.resolve([{ v: 5 }]) })); // seed cache
    const down = baseSpec({ fetchLive: () => Promise.reject(new Error('down')) });
    await eng.run(down); // failure 1
    await eng.run(down); // failure 2 → breaker OPEN
    const res = await eng.run(down); // short-circuited → cache
    expect(res.ok && res.value.mode).toBe('CACHED');
    expect(eng.health('test', down.breaker).state).toBe('OPEN');
  });

  it('falls through to the recorded mock when live fails and cache is empty (F5/OP3)', async () => {
    const res = await engine(new FakeCache()).run(
      baseSpec({ fetchLive: () => Promise.reject(new Error('down')) }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records[0]?.entity).toBe(99);
    expect(res.value.records[0]?.provenance.mode).toBe('MOCK');
  });

  it('mode=MOCK serves the fixture directly (air-gapped path)', async () => {
    const res = await engine(new FakeCache()).run(baseSpec({ mode: 'MOCK', fetchLive: () => Promise.reject('x') }));
    expect(res.ok && res.value.mode).toBe('MOCK');
  });

  it('mode=CACHED skips live and serves cache', async () => {
    const cache = new FakeCache();
    const eng = engine(cache);
    let liveCalls = 0;
    await eng.run(baseSpec({ fetchLive: () => { liveCalls++; return Promise.resolve([{ v: 3 }]); } })); // seed via LIVE
    const res = await eng.run(baseSpec({ mode: 'CACHED', fetchLive: () => { liveCalls++; return Promise.resolve([{ v: 4 }]); } }));
    expect(res.ok && res.value.mode).toBe('CACHED');
    expect(liveCalls).toBe(1); // CACHED did not call live
  });

  it('returns UPSTREAM_UNAVAILABLE only when every rung is exhausted (no mock configured)', async () => {
    const noMock: RedundancySpec<Raw, number> = {
      adapterId: 'test',
      source: 'Test',
      license: 'Public Domain',
      mode: 'LIVE',
      coverage: GLOBAL,
      region,
      cacheTtlSec: 900,
      breaker: { failureThreshold: 2, cooldownSec: 60, timeoutMs: 500, maxRetries: 0 },
      mapper,
      fetchLive: () => Promise.reject(new Error('down')),
    };
    const res = await engine(new FakeCache()).run(noMock);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('UPSTREAM_UNAVAILABLE');
  });

  it('returns NOT_COVERED when the region is outside a BBOX coverage (OP4)', async () => {
    const res = await engine(new FakeCache()).run(
      baseSpec({
        coverage: { kind: 'BBOX', bbox: [10, 40, 20, 50] }, // Europe — disjoint from CA region
        fetchLive: () => Promise.resolve([{ v: 1 }]),
      }),
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('NOT_COVERED');
  });
});
