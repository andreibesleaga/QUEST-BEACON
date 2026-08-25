// BEACON — IFRC Alert Hub adapter tests (S2·Lane-A2; ADR-009/F1/F5/F6, Art. XVI). Mode-switch
// (mock/cached/live) each yields usable NewsItems with the correct mode/degraded/freshness; the live rung
// degrades to the recorded mock when upstream is unreachable (never a dead-end); provenance is stamped on
// every record; the GraphQL document is a fixed literal parameterised only by limit; the factory is
// keyless. NO LIVE NETWORK: the live rung points at a closed local port.
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
import { CapHubAdapter, alertsQuery, makeCapHubAdapter } from './caphub-adapter.js';

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

const world: Region = { id: 'caphub-world', bbox: [-180, -90, 180, 90] };
const mkEngine = (cache: CachePort) =>
  new RedundancyEngine({ cache, nowIso: () => '2026-07-05T22:00:00Z', idGen: () => 'sid-caphub' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});

describe('CapHubAdapter mode-switch', () => {
  it('MOCK mode serves the recorded response as NewsItems (degraded, provenance MOCK)', async () => {
    const adapter = new CapHubAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch(world);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(5);
    const first = res.value.records[0];
    expect(first?.entity.sourceAuthority).toBe('OFFICIAL');
    expect(first?.provenance.mode).toBe('MOCK');
    expect(first?.provenance.source).toBe('IFRC Alert Hub (worldwide CAP aggregator)');
    expect(first?.provenance.license).toContain('issuing national authority');
    expect(first?.provenance.adapter).toBe('caphub');
  });

  it('CACHED mode serves last-known-good with degraded=true and preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    cache.store.set(cacheKey('caphub', world.id), seedFetchResult('2026-07-05T20:00:00Z'));
    const adapter = new CapHubAdapter({ engine: mkEngine(cache), config: cfg('CACHED') });
    const res = await adapter.fetch(world);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.degraded).toBe(true);
    expect(res.value.freshness).toBe('2026-07-05T20:00:00Z');
  });

  it('LIVE mode degrades to the recorded mock when upstream is unreachable (F5 → OP3)', async () => {
    const adapter = new CapHubAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'http://127.0.0.1:9/graphql/' }),
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(world);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.records.length).toBeGreaterThan(0);
  });
});

describe('alertsQuery', () => {
  it('parameterises ONLY the pagination limit, and truncates it to an integer', () => {
    expect(alertsQuery(50)).toContain('pagination:{limit:50,offset:0}');
    expect(alertsQuery(7.9)).toContain('pagination:{limit:7,offset:0}');
    // The field selection is a fixed literal — nothing caller-supplied reaches the GraphQL document.
    expect(alertsQuery(1)).toContain('info{event headline description severity urgency certainty');
  });
});

describe('CapHubAdapter outward NewsIntelPort', () => {
  it('fetchNews returns every alert for a blank query', async () => {
    const adapter = new CapHubAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetchNews('');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(5);
    expect(res.value.freshness.fetchedAt).toBe('2026-07-05T22:00:00Z');
  });

  it('filters case-insensitively over title + summary', async () => {
    const adapter = new CapHubAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetchNews('forestfire');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(1);
    expect(res.value.data[0]?.title).toBe('Forestfire');
  });

  it('surfaces a domain NOT_FOUND when every rung is exhausted', async () => {
    const adapter = new CapHubAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
      fixturesDir: '/nonexistent-caphub-fixtures',
    });
    const res = await adapter.fetchNews('');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('NOT_FOUND');
  });

  it('reports a healthy (CLOSED) breaker before any failure', () => {
    const adapter = new CapHubAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('caphub');
    expect(adapter.coverage).toEqual({ kind: 'GLOBAL' });
  });
});

describe('makeCapHubAdapter factory', () => {
  it('defaults to CACHED (per-issuer licence terms — LIVE is an operator decision)', () => {
    const res = makeCapHubAdapter(mkEngine(new FakeCache()), {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
  });

  it('builds a LIVE adapter with NO key (the hub API is keyless)', () => {
    const res = makeCapHubAdapter(mkEngine(new FakeCache()), { SOURCE_CAPHUB_MODE: 'LIVE' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('LIVE');
  });

  it('fails fast (CONFIG) on an invalid mode', () => {
    const res = makeCapHubAdapter(mkEngine(new FakeCache()), { SOURCE_CAPHUB_MODE: 'live-ish' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });
});

function seedFetchResult(fetchedAt: string): FetchResult<NewsItem> {
  const entity: NewsItem = {
    title: 'Seeded flood warning',
    url: 'https://example.gov/cap/1.xml',
    publishedAt: fetchedAt,
    sourceAuthority: 'OFFICIAL',
    credibility: 0.85,
  };
  return {
    records: [
      {
        entity,
        provenance: {
          id: asId<SourceId>('77777777-7777-4777-8777-777777777777'),
          source: 'IFRC Alert Hub (worldwide CAP aggregator)',
          adapter: 'caphub',
          fetchedAt,
          license: 'IFRC Alert Hub aggregation; each alert under its issuing national authority’s terms — attribution',
          mode: 'LIVE',
        },
      },
    ],
    freshness: fetchedAt,
    mode: 'LIVE',
    degraded: false,
  };
}
