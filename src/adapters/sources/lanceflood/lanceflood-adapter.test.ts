// BEACON — NASA LANCE NRT flood adapter tests (S2·Lane-A2; ADR-009/F1/F5/F6, Art. XVI). Mode-switch
// (mock/cached/live) each yields usable NewsItems with the correct mode/degraded/freshness; the live rung
// degrades to the recorded mock when upstream is unreachable (never a dead-end); region selection keeps
// only overlapping tiles, newest-first, capped; the factory fail-fasts on LIVE without EARTHDATA_TOKEN.
// NO LIVE NETWORK: the live rung points at a closed local port.
import { describe, it, expect } from 'vitest';
import { ok } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { SourceId } from '@/domain/index.js';
import { asId } from '@/domain/index.js';
import type { CachePort } from '@/ports/infra.js';
import type { NewsItem } from '@/ports/intel.js';
import type { FetchResult, Region, SourceConfig } from '@/adapters/_shared/index.js';
import { RedundancyEngine, cacheKey } from '@/adapters/_shared/index.js';
import { LanceFloodAdapter, makeLanceFloodAdapter } from './lanceflood-adapter.js';

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

const world: Region = { id: 'lanceflood-world', bbox: [-180, -90, 180, 90] };
const caRegion: Region = { id: 'us-ca', bbox: [-124.5, 32.5, -114, 42.1] };
const mkEngine = (cache: CachePort) =>
  new RedundancyEngine({ cache, nowIso: () => '2026-07-05T22:00:00Z', idGen: () => 'sid-lance' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});

describe('LanceFloodAdapter mode-switch', () => {
  it('MOCK mode serves the recorded listing as NewsItems (degraded, provenance MOCK)', async () => {
    const adapter = new LanceFloodAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch(world);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(10);
    const first = res.value.records[0];
    expect(first?.provenance.mode).toBe('MOCK');
    expect(first?.provenance.source).toBe('NASA LANCE MODIS NRT flood (MCDWD_L3_NRT)');
    expect(first?.provenance.license).toBe('NASA open / attribution requested');
    expect(first?.provenance.adapter).toBe('lanceflood');
  });

  it('selects only the tiles overlapping the region, newest composite day first', async () => {
    const adapter = new LanceFloodAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch(caRegion);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // The recorded slice holds 2 days × {h05v04, h05v05, h06v04, h06v05, h20v04}; only the four CA tiles
    // overlap the CA bbox, and the Romania tile (h20v04) must never appear in a CA query.
    const titles = res.value.records.map((r) => r.entity.title);
    expect(titles).toHaveLength(8);
    expect(titles.some((t) => t.includes('h20v04'))).toBe(false);
    expect(titles[0]).toContain('2026-08-07'); // newest composite day first (A2026219)
    expect(titles[0]).toContain('h05v04');
  });

  it('caps the mapped advisories at maxItems', async () => {
    const adapter = new LanceFloodAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
      maxItems: 3,
    });
    const res = await adapter.fetch(world);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.records).toHaveLength(3);
  });

  it('CACHED mode serves last-known-good with degraded=true and preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    cache.store.set(cacheKey('lanceflood', world.id), seedFetchResult('2026-07-05T20:00:00Z'));
    const adapter = new LanceFloodAdapter({ engine: mkEngine(cache), config: cfg('CACHED') });
    const res = await adapter.fetch(world);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.degraded).toBe(true);
    expect(res.value.freshness).toBe('2026-07-05T20:00:00Z');
  });

  it('LIVE mode degrades to the recorded mock when upstream is unreachable (F5 → OP3)', async () => {
    const adapter = new LanceFloodAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'http://127.0.0.1:9/api/v2/content/details', apiKey: 'token' }),
      breaker: { failureThreshold: 4, cooldownSec: 300, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(world);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.records.length).toBeGreaterThan(0);
  });
});

describe('LanceFloodAdapter outward NewsIntelPort', () => {
  it('fetchNews returns every advisory for a blank query', async () => {
    const adapter = new LanceFloodAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetchNews('');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(10);
    expect(res.value.freshness.fetchedAt).toBe('2026-07-05T22:00:00Z');
  });

  it('filters case-insensitively over title + summary', async () => {
    const adapter = new LanceFloodAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetchNews('H20V04');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(2);
  });

  it('surfaces a domain NOT_FOUND when every rung is exhausted', async () => {
    const adapter = new LanceFloodAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
      fixturesDir: '/nonexistent-lance-fixtures',
    });
    const res = await adapter.fetchNews('');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('NOT_FOUND');
  });

  it('reports a healthy (CLOSED) breaker before any failure', () => {
    const adapter = new LanceFloodAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('lanceflood');
    expect(adapter.coverage).toEqual({ kind: 'GLOBAL' });
  });
});

describe('makeLanceFloodAdapter factory', () => {
  it('defaults to CACHED when no mode is configured', () => {
    const res = makeLanceFloodAdapter(mkEngine(new FakeCache()), {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
  });

  it('fails fast (CONFIG) when LIVE mode lacks EARTHDATA_TOKEN', () => {
    const res = makeLanceFloodAdapter(mkEngine(new FakeCache()), { SOURCE_LANCEFLOOD_MODE: 'LIVE' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
    expect(res.error.message).toContain('EARTHDATA_TOKEN');
  });

  it('builds a LIVE adapter when the Earthdata token is present', () => {
    const res = makeLanceFloodAdapter(mkEngine(new FakeCache()), {
      SOURCE_LANCEFLOOD_MODE: 'LIVE',
      EARTHDATA_TOKEN: 'edl-token',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('LIVE');
  });
});

function seedFetchResult(fetchedAt: string): FetchResult<NewsItem> {
  const entity: NewsItem = {
    title: 'NASA LANCE NRT observed-flood product available — tile h20v04 (2026-07-05)',
    url: 'https://nrt3.modaps.eosdis.nasa.gov/api/v2/content/archives/x.hdf',
    publishedAt: fetchedAt,
    sourceAuthority: 'OFFICIAL',
    credibility: 0.9,
  };
  return {
    records: [
      {
        entity,
        provenance: {
          id: asId<SourceId>('88888888-8888-4888-8888-888888888888'),
          source: 'NASA LANCE MODIS NRT flood (MCDWD_L3_NRT)',
          adapter: 'lanceflood',
          fetchedAt,
          license: 'NASA open / attribution requested',
          mode: 'LIVE',
        },
      },
    ],
    freshness: fetchedAt,
    mode: 'LIVE',
    degraded: false,
  };
}
