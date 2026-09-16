// BEACON — WorldPop adapter tests (E4·T-worldpop; ADR-009/F1/F5/F6, PopulationPort P12). Mode-switch
// (mock/cached/live) each yields a usable PopulationEstimate with the correct mode/degraded/freshness; the
// live rung degrades to the recorded mock when upstream is unreachable; provenance is stamped on every
// record; the outward PopulationPort.estimatePopulation adapts the ladder to the Sourced envelope; the
// factory fails fast on bad config and defaults to CACHED (DATA_SOURCE_VERIFICATION population row).
import { describe, it, expect } from 'vitest';
import { ok } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import type { BBox } from '@/domain/value-objects/geo.js';
import type { DomainError } from '@/domain/errors.js';
import type { SourceId } from '@/domain/value-objects/ids.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { PopulationEstimate } from '@/ports/infrastructure-sources.js';
import type { CachePort } from '@/ports/infra.js';
import type { FetchResult, Region, SourceConfig } from '@/adapters/_shared/index.js';
import { RedundancyEngine, cacheKey } from '@/adapters/_shared/index.js';
import { WorldPopAdapter, makeWorldPopAdapter } from './worldpop-adapter.js';

class FakeCache implements CachePort {
  readonly store = new Map<string, unknown>();
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
}

// The same Butte-County-ish bbox the recorded fixture was captured against (see worldpop-adapter.ts header).
const region: Region = { id: 'butte', bbox: [-121.9, 39.4, -121.35, 39.85] };
const mkEngine = (cache: CachePort) =>
  new RedundancyEngine({
    cache,
    nowIso: () => '2026-07-15T09:02:34Z',
    idGen: () => 'sid-worldpop',
  });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});

describe('WorldPopAdapter mode-switch', () => {
  it('MOCK mode serves the recorded fixture as a PopulationEstimate (degraded, provenance MOCK)', async () => {
    const adapter = new WorldPopAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(1);
    const first = res.value.records[0];
    expect(first?.entity.area).toEqual(region.bbox);
    expect(first?.entity.count).toBe(215183);
    expect(first?.provenance.mode).toBe('MOCK');
    expect(first?.provenance.source).toBe('WorldPop');
    expect(first?.provenance.license).toBe('CC BY 4.0');
    expect(first?.provenance.adapter).toBe('worldpop');
  });

  it('CACHED mode serves last-known-good with degraded=true and preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    cache.store.set(cacheKey('worldpop', region.id), seedFetchResult('2026-07-15T08:00:00Z'));
    const adapter = new WorldPopAdapter({ engine: mkEngine(cache), config: cfg('CACHED') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.degraded).toBe(true);
    expect(res.value.freshness).toBe('2026-07-15T08:00:00Z');
    expect(res.value.records[0]?.entity.count).toBe(200000);
  });

  it('LIVE mode degrades to the recorded mock when upstream is unreachable (F5 → OP3)', async () => {
    const adapter = new WorldPopAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'http://127.0.0.1:9/v1/services/stats' }),
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK'); // live down, cache empty → recorded mock, never a dead-end
    expect(res.value.records).toHaveLength(1);
    expect(res.value.records[0]?.entity.count).toBeGreaterThan(0);
  });
});

describe('WorldPopAdapter outward PopulationPort', () => {
  it('estimatePopulation returns a Sourced PopulationEstimate with a numeric count and freshness', async () => {
    const adapter = new WorldPopAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.estimatePopulation(region.bbox);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data.area).toEqual(region.bbox);
    expect(typeof res.value.data.count).toBe('number');
    expect(res.value.data.count).toBeGreaterThan(0);
    expect(res.value.freshness.fetchedAt).toBe('2026-07-15T09:02:34Z');
  });

  it('reports a healthy (CLOSED) breaker and correct identity/coverage', () => {
    const adapter = new WorldPopAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('worldpop');
    expect(adapter.coverage).toEqual({ kind: 'GLOBAL' });
  });
});

describe('makeWorldPopAdapter factory', () => {
  it('defaults to CACHED mode from env (DATA_SOURCE_VERIFICATION population row)', () => {
    const res = makeWorldPopAdapter(mkEngine(new FakeCache()), {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
  });

  it('honours SOURCE_WORLDPOP_MODE from env', () => {
    const res = makeWorldPopAdapter(mkEngine(new FakeCache()), { SOURCE_WORLDPOP_MODE: 'MOCK' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
  });

  it('fails fast (CONFIG) on an invalid SOURCE_WORLDPOP_MODE', () => {
    const res = makeWorldPopAdapter(mkEngine(new FakeCache()), { SOURCE_WORLDPOP_MODE: 'bogus' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });
});

function seedFetchResult(fetchedAt: string): FetchResult<PopulationEstimate> {
  const entity: PopulationEstimate = { area: region.bbox, count: 200000 };
  return {
    records: [
      {
        entity,
        provenance: {
          id: asId<SourceId>('55555555-5555-4555-8555-555555555555'),
          source: 'WorldPop',
          adapter: 'worldpop',
          fetchedAt,
          license: 'CC BY 4.0',
          mode: 'LIVE',
        },
      },
    ],
    freshness: fetchedAt,
    mode: 'LIVE',
    degraded: false,
  };
}

// ── The async task (2026-09-12) ───────────────────────────────────────────────────────────────────────
//
// The live board read `PARSE: WorldPop response missing/invalid data.total_population: undefined`, and the
// cause was the SIZE of the question, not a changed shape: `runasync=false` runs the job inline only while
// it is small, and hands back a bare task handle when it is not. These tests pin the three endings a task
// can have, with an injected sleep so nothing here waits on a real clock.
describe('WorldPopAdapter follows the async task', () => {
  const submitted = JSON.stringify({ status: 'started', taskid: 'task-1' });
  const finished = JSON.stringify({
    status: 'finished',
    error: false,
    data: { total_population: 215182.79 },
  });
  const tooLarge = JSON.stringify({
    status: 'finished',
    error: true,
    error_message:
      'The requested area was too large. Requested 964477.28 km^2 but allowance was 100000.',
  });

  /** A fetch that answers the submit once, then every poll from `polls`, in order. */
  function fakeFetch(
    first: string,
    polls: readonly string[],
  ): { fetch: typeof fetch; urls: string[] } {
    const urls: string[] = [];
    let n = 0;
    const impl = ((url: RequestInfo | URL) => {
      urls.push(String(url));
      const body = urls.length === 1 ? first : (polls[n++] ?? polls.at(-1) ?? '{}');
      return Promise.resolve(new Response(body, { status: 200 }));
    }) as typeof fetch;
    return { fetch: impl, urls };
  }

  async function withFetch<T>(impl: typeof fetch, run: () => Promise<T>): Promise<T> {
    const original = globalThis.fetch;
    globalThis.fetch = impl;
    try {
      return await run();
    } finally {
      globalThis.fetch = original;
    }
  }

  it('polls the task endpoint and returns the population the task finally produced', async () => {
    const { fetch: impl, urls } = fakeFetch(submitted, [submitted, finished]);
    const adapter = new WorldPopAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE'),
      sleep: () => Promise.resolve(),
    });
    const res = await withFetch(impl, () => adapter.fetch(region));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('LIVE');
    expect(res.value.records[0]?.entity.count).toBe(215183);
    // The task URL is DERIVED from the configured stats URL, so a pinned host keeps both halves of the
    // conversation on the same server.
    expect(urls[1]).toBe('https://api.worldpop.org/v1/tasks/task-1');
    // And the submit no longer asks for the synchronous mode that was spending 40 s before failing.
    expect(urls[0]).not.toContain('runasync');
  });

  it("surfaces WorldPop's OWN refusal, so the log says 'area too large' instead of 'undefined field'", async () => {
    const { fetch: impl } = fakeFetch(submitted, [tooLarge]);
    const adapter = new WorldPopAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE'),
      sleep: () => Promise.resolve(),
    });
    const res = await withFetch(impl, () => adapter.fetch(region));
    // The ladder still serves — degraded to the recorded mock, which is the whole point of Art. XVI.
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
  });

  it('refuses a region-sized bbox up front as NOT_COVERED — no request, no rung, no citation', async () => {
    const { fetch: impl, urls } = fakeFetch(submitted, [tooLarge]);
    const adapter = new WorldPopAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE'),
      sleep: () => Promise.resolve(),
    });
    // California, as regions.json draws it: ~970,000 km² against an allowance of 100,000.
    const california: Region = { id: 'us-ca', bbox: [-124.5, 32.5, -114.1, 42.0] };
    const res = await withFetch(impl, () => adapter.fetch(california));
    expect(urls).toHaveLength(0); // nothing submitted, nothing polled — the refusal was known in advance
    // NOT_COVERED, not a degraded rung: a cold CACHED rung would have served the Butte County mock as
    // California's population. Skipped and uncited is the honest outcome.
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('NOT_COVERED');
    expect(res.error.message).toMatch(/km² bbox exceeds WorldPop's 100,000 km²/);
    // An incident-sized polygon is still asked live.
    const { fetch: small, urls: smallUrls } = fakeFetch(submitted, [finished]);
    const live = await withFetch(small, () => adapter.fetch(region));
    expect(smallUrls.length).toBeGreaterThan(0);
    expect(live.ok && live.value.mode).toBe('LIVE');
  });

  it('refuses the same question under the CACHED default: a cold cache must not fall through to the Butte mock', async () => {
    const cached = new WorldPopAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('CACHED'),
    });
    const california: Region = { id: 'us-ca', bbox: [-124.5, 32.5, -114.1, 42.0] };
    const res = await cached.fetch(california);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('NOT_COVERED');
    // …while an operator who explicitly asked for the fixture still gets it, labelled MOCK.
    const mock = new WorldPopAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const served = await mock.fetch(california);
    expect(served.ok && served.value.mode).toBe('MOCK');
  });

  it('keys the last-known-good cache by the requested AREA, so a warm county answer never serves a region', async () => {
    const cache = new FakeCache();
    const adapter = new WorldPopAdapter({
      engine: mkEngine(cache),
      config: cfg('LIVE'),
      sleep: () => Promise.resolve(),
    });
    const { fetch: impl } = fakeFetch(submitted, [finished]);
    const warm = await withFetch(impl, () => adapter.estimatePopulation(region.bbox));
    expect(warm.ok).toBe(true);
    // The county answer is cached under ITS bbox, never under a shared 'query' key…
    expect(cache.store.has(cacheKey('worldpop', 'query'))).toBe(false);
    expect(cache.store.has(cacheKey('worldpop', 'query:-121.9,39.4,-121.35,39.85'))).toBe(true);
    // …at full precision: a bbox 11 m away is a different question with its own key.
    const nearby: BBox = [-121.90001, 39.4, -121.35, 39.85];
    const other = await withFetch(impl, () => adapter.estimatePopulation(nearby));
    expect(other.ok).toBe(true);
    expect(cache.store.has(cacheKey('worldpop', 'query:-121.90001,39.4,-121.35,39.85'))).toBe(true);
  });

  it('gives up on a task that never finishes, rather than hanging the composition', async () => {
    const { fetch: impl, urls } = fakeFetch(submitted, [submitted]);
    const adapter = new WorldPopAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE'),
      taskWaitMs: 30, // a deadline the fake clock crosses immediately
      pollIntervalMs: 10,
      sleep: () => Promise.resolve(),
    });
    const res = await withFetch(impl, () => adapter.fetch(region));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK'); // degraded, labelled — never a hang and never a dead-end
    expect(urls.length).toBeGreaterThan(1); // it did poll before giving up
  });
});
