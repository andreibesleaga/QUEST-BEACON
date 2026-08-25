// BEACON — GDELT adapter tests (E4·T-157; ADR-009/F1/F5/F6, NewsIntelPort P6). Mode-switch (mock/cached/
// live) each yields provenance-stamped NewsItems; the live rung degrades to the recorded mock when
// upstream is unreachable; the outward NewsIntelPort.fetchNews adapts the ladder to the Sourced envelope
// with credibility/sourceAuthority set; the factory defaults to LIVE (keyless) and fails fast on a bad
// mode. Deterministic clock is safely in the past (flaky-test rule).
import { describe, it, expect } from 'vitest';
import { ok, asId } from '@/domain/index.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { SourceId } from '@/domain/index.js';
import type { NewsItem } from '@/ports/intel.js';
import type { CachePort } from '@/ports/infra.js';
import type { FetchResult, Region, SourceConfig } from '@/adapters/_shared/index.js';
import { RedundancyEngine, cacheKey } from '@/adapters/_shared/index.js';
import { GdeltAdapter, makeGdeltAdapter } from './gdelt-adapter.js';

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

const NOW = '2026-07-15T09:00:00Z'; // safely past — Freshness rejects future fetchedAt (flaky-test rule)
const GLOBAL_BBOX: readonly [number, number, number, number] = [-180, -90, 180, 90];
const region: Region = { id: 'wildfire california', bbox: GLOBAL_BBOX };
const mkEngine = (cache: CachePort) =>
  new RedundancyEngine({ cache, nowIso: () => NOW, idGen: () => 'sid-gdelt' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});

describe('GdeltAdapter mode-switch', () => {
  it('MOCK mode serves the recorded fixture as MEDIA NewsItems (degraded, provenance MOCK)', async () => {
    const adapter = new GdeltAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(5);
    const first = res.value.records[0];
    expect(first?.entity.sourceAuthority).toBe('MEDIA');
    expect(first?.entity.credibility).toBe(0.65);
    expect(first?.provenance.mode).toBe('MOCK');
    expect(first?.provenance.source).toBe('GDELT Project');
    expect(first?.provenance.license).toBe('GDELT open');
    expect(first?.provenance.adapter).toBe('gdelt');
  });

  it('CACHED mode serves last-known-good with degraded=true and preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    cache.store.set(cacheKey('gdelt', region.id), seedFetchResult('2026-07-15T07:00:00Z'));
    const adapter = new GdeltAdapter({ engine: mkEngine(cache), config: cfg('CACHED') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.degraded).toBe(true);
    expect(res.value.freshness).toBe('2026-07-15T07:00:00Z');
  });

  it('LIVE mode degrades to the recorded mock when upstream is unreachable (F5 -> OP3)', async () => {
    const adapter = new GdeltAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'http://127.0.0.1:9/api/v2/doc/doc' }),
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK'); // live down, cache empty -> recorded mock, never a dead-end
    expect(res.value.records.length).toBeGreaterThan(0);
  });

  it('GLOBAL coverage accepts any region/query (no NOT_COVERED gate)', async () => {
    const adapter = new GdeltAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch({ id: 'flood romania', bbox: GLOBAL_BBOX, iso: 'RO' });
    expect(res.ok).toBe(true);
  });
});

describe('GdeltAdapter outward NewsIntelPort', () => {
  it('fetchNews returns a Sourced envelope of NewsItems with credibility/sourceAuthority + freshness', async () => {
    const adapter = new GdeltAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetchNews('wildfire california');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data.length).toBeGreaterThan(0);
    expect(res.value.data[0]?.credibility).toBe(0.65);
    expect(res.value.data[0]?.sourceAuthority).toBe('MEDIA');
    expect(res.value.freshness.fetchedAt).toBe(NOW);
  });

  it('fetchNews falls back to a default query when the caller passes an empty string', async () => {
    const adapter = new GdeltAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetchNews('');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(5); // still serves the mock fixture (query only shapes the LIVE URL)
  });

  it('reports a healthy (CLOSED) breaker before any failure, and correct identity/coverage', () => {
    const adapter = new GdeltAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('gdelt');
    expect(adapter.coverage).toEqual({ kind: 'GLOBAL' });
  });
});

describe('makeGdeltAdapter factory', () => {
  it('defaults to LIVE mode from env (keyless — no API key required)', () => {
    const res = makeGdeltAdapter(mkEngine(new FakeCache()), {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('LIVE');
  });

  it('builds a MOCK adapter when SOURCE_GDELT_MODE=MOCK', () => {
    const res = makeGdeltAdapter(mkEngine(new FakeCache()), { SOURCE_GDELT_MODE: 'MOCK' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
  });

  it('rejects an invalid mode (CONFIG, fail-fast)', () => {
    const res = makeGdeltAdapter(mkEngine(new FakeCache()), { SOURCE_GDELT_MODE: 'bogus' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });
});

function seedFetchResult(fetchedAt: string): FetchResult<NewsItem> {
  const entity: NewsItem = {
    title: 'California wildfire prevention funding at risk of drying up',
    url: 'https://www.latimes.com/environment/story/2026-05-29/california-wildfire-prevention-funding-at-risk',
    publishedAt: fetchedAt,
    summary: 'latimes.com — United States — English',
    sourceAuthority: 'MEDIA',
    credibility: 0.65,
  };
  return {
    records: [
      {
        entity,
        provenance: {
          id: asId<SourceId>('77777777-7777-4777-8777-777777777777'),
          source: 'GDELT Project',
          adapter: 'gdelt',
          fetchedAt,
          license: 'GDELT open',
          mode: 'LIVE',
        },
      },
    ],
    freshness: fetchedAt,
    mode: 'LIVE',
    degraded: false,
  };
}
