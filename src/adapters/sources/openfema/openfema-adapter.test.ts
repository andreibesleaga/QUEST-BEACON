// BEACON — OpenFEMA adapter tests (S2·Lane-A2; ADR-009/F1/F5/F6, Art. XVI). Mode-switch (mock/cached/live)
// each yields usable NewsItems with the correct mode/degraded/freshness; the live rung degrades to the
// recorded mock when upstream is unreachable (never a dead-end); provenance is stamped on every record;
// the outward NewsIntelPort filters; coverage is US-only; the factory is keyless. NO LIVE NETWORK: the
// live rung points at a closed local port.
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
import { OpenFemaAdapter, makeOpenFemaAdapter } from './openfema-adapter.js';

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

const usRegion: Region = {
  id: 'us-declarations',
  bbox: [-179.15, 18.91, -66.94, 71.39],
  iso: 'US',
};
const mkEngine = (cache: CachePort) =>
  new RedundancyEngine({ cache, nowIso: () => '2026-07-05T22:00:00Z', idGen: () => 'sid-fema' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});

describe('OpenFemaAdapter mode-switch', () => {
  it('MOCK mode serves the recorded response as NewsItems (degraded, provenance MOCK)', async () => {
    const adapter = new OpenFemaAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch(usRegion);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(6);
    const first = res.value.records[0];
    expect(first?.entity.sourceAuthority).toBe('OFFICIAL');
    expect(first?.provenance.mode).toBe('MOCK');
    expect(first?.provenance.source).toBe('OpenFEMA (FEMA Disaster Declarations)');
    expect(first?.provenance.license).toBe('US public domain');
    expect(first?.provenance.adapter).toBe('openfema');
  });

  it('CACHED mode serves last-known-good with degraded=true and preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    cache.store.set(cacheKey('openfema', usRegion.id), seedFetchResult('2026-07-05T20:00:00Z'));
    const adapter = new OpenFemaAdapter({ engine: mkEngine(cache), config: cfg('CACHED') });
    const res = await adapter.fetch(usRegion);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.degraded).toBe(true);
    expect(res.value.freshness).toBe('2026-07-05T20:00:00Z');
  });

  it('LIVE mode degrades to the recorded mock when upstream is unreachable (F5 → OP3)', async () => {
    const adapter = new OpenFemaAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'http://127.0.0.1:9/api/open/v2/DisasterDeclarationsSummaries' }),
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(usRegion);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.records.length).toBeGreaterThan(0);
  });

  it('returns NOT_COVERED for a non-US region rather than mislabelling it (OP4)', async () => {
    const adapter = new OpenFemaAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch({ id: 'ro', bbox: [20.2, 43.6, 29.7, 48.3], iso: 'RO' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('NOT_COVERED');
  });
});

describe('OpenFemaAdapter outward NewsIntelPort', () => {
  it('fetchNews returns every declaration for a blank query', async () => {
    const adapter = new OpenFemaAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetchNews('   ');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(6);
    expect(res.value.freshness.fetchedAt).toBe('2026-07-05T22:00:00Z');
  });

  it('filters case-insensitively over title + summary', async () => {
    const adapter = new OpenFemaAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetchNews('spokane');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(2); // Spokane (County) + Spokane Indian Reservation
  });

  it('surfaces a domain NOT_FOUND when every rung is exhausted', async () => {
    const adapter = new OpenFemaAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
      fixturesDir: '/nonexistent-openfema-fixtures',
    });
    const res = await adapter.fetchNews('');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('NOT_FOUND');
  });

  it('reports a healthy (CLOSED) breaker before any failure', () => {
    const adapter = new OpenFemaAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('openfema');
    expect(adapter.coverage).toEqual({ kind: 'COUNTRIES', iso: ['US'] });
  });
});

describe('makeOpenFemaAdapter factory', () => {
  it('defaults to CACHED when no mode is configured', () => {
    const res = makeOpenFemaAdapter(mkEngine(new FakeCache()), {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
  });

  it('builds a LIVE adapter with NO key (OpenFEMA is keyless)', () => {
    const res = makeOpenFemaAdapter(mkEngine(new FakeCache()), { SOURCE_OPENFEMA_MODE: 'LIVE' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('LIVE');
  });

  it('fails fast (CONFIG) on an invalid mode', () => {
    const res = makeOpenFemaAdapter(mkEngine(new FakeCache()), { SOURCE_OPENFEMA_MODE: 'maybe' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });
});

function seedFetchResult(fetchedAt: string): FetchResult<NewsItem> {
  const entity: NewsItem = {
    title: 'DR-1234-CA — SEEDED',
    url: 'https://www.fema.gov/disaster/1234',
    publishedAt: fetchedAt,
    sourceAuthority: 'OFFICIAL',
    credibility: 0.95,
  };
  return {
    records: [
      {
        entity,
        provenance: {
          id: asId<SourceId>('66666666-6666-4666-8666-666666666666'),
          source: 'OpenFEMA (FEMA Disaster Declarations)',
          adapter: 'openfema',
          fetchedAt,
          license: 'US public domain',
          mode: 'LIVE',
        },
      },
    ],
    freshness: fetchedAt,
    mode: 'LIVE',
    degraded: false,
  };
}
