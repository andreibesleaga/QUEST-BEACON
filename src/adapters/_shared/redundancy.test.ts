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
    breaker: {
      failureThreshold: 2,
      cooldownSec: 60,
      halfOpenTrials: 1,
      timeoutMs: 500,
      maxRetries: 0,
    },
    mapper,
    loadMockRaw: () => Promise.resolve([{ v: 99 }]),
    ...overrides,
  };
}

const engine = (cache: CachePort) =>
  new RedundancyEngine({ cache, nowIso: () => '2026-07-05T10:00:00Z', idGen: () => 'sid-fixed' });

// WHY THESE EXIST. When a LIVE fetch failed, the engine classified the error and then DISCARDED it:
// `if (live.ok) return live;` and on it went to the cache rung. So a source that had quietly degraded to
// the recorded fixture told an operator nothing about WHY — not at LOG_LEVEL=debug, not anywhere. Six
// sources were serving mock in production with no way to find out what was wrong short of reproducing
// each fetch by hand. The reason was computed on every single failure and thrown away.
describe('RedundancyEngine degradation reporting', () => {
  it('reports why a LIVE source fell back, naming the adapter and the reason', async () => {
    const seen: { adapterId: string; from: string; to: string; reason: string }[] = [];
    const eng = new RedundancyEngine({
      cache: new FakeCache(),
      nowIso: () => '2026-07-05T10:00:00Z',
      idGen: () => 'sid-fixed',
      onDegrade: (e) => seen.push({ ...e }),
    });
    await eng.run(
      baseSpec({
        mode: 'LIVE',
        fetchLive: () => Promise.reject(new Error('ECONNREFUSED 1.2.3.4:443')),
      }),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]?.adapterId).toBe('test');
    expect(seen[0]?.from).toBe('LIVE');
    expect(seen[0]?.to).toBe('MOCK'); // the rung it actually landed on, not the one it wanted
    expect(seen[0]?.reason).toContain('ECONNREFUSED');
  });

  it('names the CACHE rung when the cache is what caught the fall', async () => {
    const cache = new FakeCache();
    const seen: { to: string }[] = [];
    const eng = new RedundancyEngine({
      cache,
      nowIso: () => '2026-07-05T10:00:00Z',
      idGen: () => 'sid-fixed',
      onDegrade: (e) => seen.push({ to: e.to }),
    });
    await eng.run(baseSpec({ mode: 'LIVE', fetchLive: () => Promise.resolve([{ v: 5 }]) })); // warm it
    await eng.run(baseSpec({ mode: 'LIVE', fetchLive: () => Promise.reject(new Error('down')) }));
    expect(seen.map((e) => e.to)).toEqual(['CACHED']);
  });

  // CREDENTIAL LEAK (Copilot, PR #14). The reason string is built from the classified adapter error, and
  // `statusError` embeds the URL. FIRMS puts its MAP_KEY in the PATH, others put keys in the query — so an
  // unconditional stderr sink would have written live API keys into the Railway log on every failure of
  // exactly the sources most likely to fail. A diagnostic channel that leaks the credential it is
  // diagnosing is worse than no channel.
  it('never writes a URL path or query into the reason — only scheme and host survive', async () => {
    const seen: string[] = [];
    const eng = new RedundancyEngine({
      cache: new FakeCache(),
      nowIso: () => '2026-07-05T10:00:00Z',
      idGen: () => 'sid-fixed',
      onDegrade: (e) => seen.push(e.reason),
    });
    await eng.run(
      baseSpec({
        mode: 'LIVE',
        fetchLive: () =>
          Promise.reject(
            new Error(
              'GET https://firms.modaps.eosdis.nasa.gov/api/area/csv/SUPERSECRETMAPKEY/VIIRS/world/1 failed 401',
            ),
          ),
      }),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toContain('SUPERSECRETMAPKEY');
    expect(seen[0]).toContain('firms.modaps.eosdis.nasa.gov'); // the useful half is kept
  });

  it('redacts a query-string credential and URL userinfo too', async () => {
    const seen: string[] = [];
    const eng = new RedundancyEngine({
      cache: new FakeCache(),
      nowIso: () => '2026-07-05T10:00:00Z',
      idGen: () => 'sid-fixed',
      onDegrade: (e) => seen.push(e.reason),
    });
    await eng.run(
      baseSpec({
        mode: 'LIVE',
        fetchLive: () =>
          Promise.reject(
            new Error('https://user:hunter2@api.census.gov/data?key=CENSUSKEY123 refused'),
          ),
      }),
    );
    expect(seen[0]).not.toContain('CENSUSKEY123');
    expect(seen[0]).not.toContain('hunter2');
  });

  it('prefers the adapter-stated cachedReason over the generic cold-cache line', async () => {
    const seen: string[] = [];
    const eng = new RedundancyEngine({
      cache: new FakeCache(),
      nowIso: () => '2026-07-05T10:00:00Z',
      idGen: () => 'sid-fixed',
      onDegrade: (e) => seen.push(e.reason),
    });
    await eng.run(
      baseSpec({
        mode: 'CACHED',
        cachedReason: "no reporting point lies inside region 'ro' (mode=LIVE, 1 configured)",
      }),
    );
    expect(seen).toEqual(["no reporting point lies inside region 'ro' (mode=LIVE, 1 configured)"]);
  });

  it('does not report a CACHED source that was served from cache — it got the rung it asked for', async () => {
    const cache = new FakeCache();
    const eng = new RedundancyEngine({
      cache,
      nowIso: () => '2026-07-05T10:00:00Z',
      idGen: () => 'sid-fixed',
      onDegrade: () => {
        throw new Error('should not be called');
      },
    });
    // Warm it through LIVE, then read it back as CACHED. Reporting CACHED->CACHED on every successful
    // read would put a degradation line in the log for every healthy cached adapter, on every fetch.
    await eng.run(baseSpec({ mode: 'LIVE', fetchLive: () => Promise.resolve([{ v: 5 }]) }));
    const seen: string[] = [];
    const eng2 = new RedundancyEngine({
      cache,
      nowIso: () => '2026-07-05T10:00:00Z',
      idGen: () => 'sid-fixed',
      onDegrade: (e) => seen.push(`${e.from}->${e.to}`),
    });
    await eng2.run(baseSpec({ mode: 'CACHED', fetchLive: () => Promise.reject(new Error('x')) }));
    expect(seen).toEqual([]);
  });

  it('survives a sink that rejects asynchronously, not just one that throws', async () => {
    const eng = new RedundancyEngine({
      cache: new FakeCache(),
      nowIso: () => '2026-07-05T10:00:00Z',
      idGen: () => 'sid-fixed',
      // A `() => void` signature does not stop an async function being supplied; its rejection would
      // otherwise surface as an unhandled rejection and, under Node's default, take the process down.
      onDegrade: () => Promise.reject(new Error('sink is down')) as unknown as void,
    });
    const res = await eng.run(
      baseSpec({ mode: 'LIVE', fetchLive: () => Promise.reject(new Error('down')) }),
    );
    expect(res.ok).toBe(true); // the fetch still succeeded on the mock rung
  });

  it('says nothing when nothing degraded', async () => {
    const seen: unknown[] = [];
    const eng = new RedundancyEngine({
      cache: new FakeCache(),
      nowIso: () => '2026-07-05T10:00:00Z',
      idGen: () => 'sid-fixed',
      onDegrade: (e) => seen.push(e),
    });
    await eng.run(baseSpec({ mode: 'LIVE', fetchLive: () => Promise.resolve([{ v: 1 }]) }));
    // A report on a healthy fetch is worse than no report: it trains an operator to ignore the channel.
    expect(seen).toHaveLength(0);
  });

  it('does not report a MOCK-mode source, which has not degraded — it is configured that way', async () => {
    const seen: unknown[] = [];
    const eng = new RedundancyEngine({
      cache: new FakeCache(),
      nowIso: () => '2026-07-05T10:00:00Z',
      idGen: () => 'sid-fixed',
      onDegrade: (e) => seen.push(e),
    });
    await eng.run(baseSpec({ mode: 'MOCK', fetchLive: () => Promise.reject(new Error('x')) }));
    expect(seen).toHaveLength(0);
  });
});

describe('RedundancyEngine ladder', () => {
  it('live success maps records, stamps LIVE provenance, and writes cache', async () => {
    const cache = new FakeCache();
    const res = await engine(cache).run(
      baseSpec({ fetchLive: () => Promise.resolve([{ v: 1 }, { v: 2 }]) }),
    );
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
    const res = await engine(new FakeCache()).run(
      baseSpec({ mode: 'MOCK', fetchLive: () => Promise.reject('x') }),
    );
    expect(res.ok && res.value.mode).toBe('MOCK');
  });

  it('mode=CACHED skips live and serves cache', async () => {
    const cache = new FakeCache();
    const eng = engine(cache);
    let liveCalls = 0;
    await eng.run(
      baseSpec({
        fetchLive: () => {
          liveCalls++;
          return Promise.resolve([{ v: 3 }]);
        },
      }),
    ); // seed via LIVE
    const res = await eng.run(
      baseSpec({
        mode: 'CACHED',
        fetchLive: () => {
          liveCalls++;
          return Promise.resolve([{ v: 4 }]);
        },
      }),
    );
    expect(res.ok && res.value.mode).toBe('CACHED');
    expect(liveCalls).toBe(1); // CACHED did not call live
  });

  // THE COLD-CACHE CASE — the one `mode=CACHED skips live and serves cache` cannot reach, because it
  // seeds the cache with a LIVE run first and therefore only ever exercises a WARM cache.
  //
  // This is NOT a bug, and the test below pins it as correct: CONFIGURATION.md §200 says the CACHED
  // posture "contacts no upstream at all", which is what makes the air-gapped and tight-demo-loop
  // profiles possible. But it has a consequence nothing stated until now, and operators have been
  // bitten by it:
  //
  //   `writeLastGood` is called from exactly ONE place — inside the live path. A source configured
  //   CACHED never takes that path, so it never writes a cache entry, so its cache can only ever be
  //   warmed by a LIVE run earlier in the SAME process. With an in-memory cache and a container that
  //   restarts on every deploy, the cache is cold every time. A CACHED source therefore serves the
  //   recorded fixture — correctly labelled MOCK — for the entire life of the deployment.
  //
  // So on a cloud deploy, `SOURCE_X_MODE=cached` does not mean "recent real data". It means MOCK.
  // The mode an operator wants for real-but-resilient data is `live`, whose ladder is
  // live -> cache -> mock and which is the only mode that ever warms the cache.
  it('mode=CACHED contacts no upstream, so a cold cache serves the MOCK fixture (documented, and the operator trap)', async () => {
    let liveCalls = 0;
    const res = await engine(new FakeCache()).run(
      baseSpec({
        mode: 'CACHED',
        fetchLive: () => {
          liveCalls += 1;
          return Promise.resolve([{ v: 7 }]);
        },
      }),
    );
    expect(liveCalls).toBe(0); // the air-gapped guarantee: CACHED reaches no network
    expect(res.ok && res.value.mode).toBe('MOCK');
    expect(res.ok && res.value.degraded).toBe(true); // and it SAYS so, rather than passing a fixture off as cached
  });

  it('mode=CACHED never warms its own cache, so it cannot recover on a later call', async () => {
    const cache = new FakeCache();
    const eng = engine(cache);
    const spec = () => baseSpec({ mode: 'CACHED', fetchLive: () => Promise.resolve([{ v: 7 }]) });
    await eng.run(spec());
    const second = await eng.run(spec());
    // Still MOCK. This is the half operators assume is temporary — it is not; only a LIVE run writes
    // last-known-good, so a CACHED source that started cold stays on the fixture forever.
    expect(second.ok && second.value.mode).toBe('MOCK');
  });

  it('mode=LIVE is the only mode that warms the cache, which is what makes CACHED usable at all', async () => {
    const cache = new FakeCache();
    const eng = engine(cache);
    await eng.run(baseSpec({ mode: 'LIVE', fetchLive: () => Promise.resolve([{ v: 7 }]) }));
    const cached = await eng.run(
      baseSpec({ mode: 'CACHED', fetchLive: () => Promise.reject(new Error('x')) }),
    );
    expect(cached.ok && cached.value.mode).toBe('CACHED');
    expect(cached.ok && cached.value.records[0]?.entity).toBe(7);
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
