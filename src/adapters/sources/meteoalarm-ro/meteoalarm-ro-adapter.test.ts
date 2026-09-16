// BEACON — MeteoAlarm-RO adapter tests (E4·T-177; ADR-009/F1/F5/F6). Each mode yields provenance-stamped
// NewsItems; the live rung degrades to the recorded mock when upstream is unreachable; COUNTRIES=['RO']
// gates coverage (non-RO → NOT_COVERED); the outward NewsIntelPort adapts the ladder + filters by query;
// the factory reads SOURCE_METEOALARM_RO_* env. Deterministic clock is safely in the past (flaky-test rule).
import { describe, it, expect } from 'vitest';
import { ok, asId } from '@/domain/index.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { SourceId } from '@/domain/index.js';
import type { NewsItem } from '@/ports/intel.js';
import type { CachePort } from '@/ports/infra.js';
import type { FetchResult, Region, SourceConfig } from '@/adapters/_shared/index.js';
import { RedundancyEngine, cacheKey } from '@/adapters/_shared/index.js';
import { MeteoalarmRoAdapter, makeMeteoalarmRoAdapter } from './meteoalarm-ro-adapter.js';

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

const NOW = '2026-07-05T22:00:00Z'; // safely past — Freshness rejects future fetchedAt (flaky-test rule)
const ROMANIA: Region = { id: 'ro', bbox: [20, 43, 30, 48], iso: 'RO' };
const mkEngine = (cache: CachePort) =>
  new RedundancyEngine({ cache, nowIso: () => NOW, idGen: () => 'sid-meteoalarm-ro' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});

describe('MeteoalarmRoAdapter mode-switch', () => {
  it('MOCK mode serves the recorded fixture as provenance-stamped NewsItems', async () => {
    const adapter = new MeteoalarmRoAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    const res = await adapter.fetch(ROMANIA);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(3);
    const first = res.value.records[0];
    expect(first?.entity.title).toContain('Vrancea');
    expect(first?.entity.url).toContain('feeds.meteoalarm.org');
    expect(first?.provenance.source).toBe('MeteoAlarm');
    expect(first?.provenance.adapter).toBe('meteoalarm-ro');
    expect(first?.provenance.mode).toBe('MOCK');
    expect(first?.provenance.license).toContain('CC BY 4.0');
  });

  it('CACHED mode serves last-known-good with degraded=true and preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    cache.store.set(cacheKey('meteoalarm-ro', ROMANIA.id), seedFetchResult('2026-07-05T20:00:00Z'));
    const adapter = new MeteoalarmRoAdapter({ engine: mkEngine(cache), config: cfg('CACHED') });
    const res = await adapter.fetch(ROMANIA);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.freshness).toBe('2026-07-05T20:00:00Z');
  });

  it('LIVE mode degrades to the recorded mock when upstream is unreachable (F5 → OP3)', async () => {
    const adapter = new MeteoalarmRoAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'http://127.0.0.1:9' }),
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(ROMANIA);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.records.length).toBeGreaterThan(0);
  });

  it('COUNTRIES=[RO] coverage rejects a non-RO region with NOT_COVERED (OP4)', async () => {
    const adapter = new MeteoalarmRoAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    const res = await adapter.fetch({ id: 'au', bbox: [113, -44, 154, -10], iso: 'AU' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('NOT_COVERED');
  });
});

describe('MeteoalarmRoAdapter outward NewsIntelPort', () => {
  it('fetchNews returns a Sourced envelope of NewsItems with freshness', async () => {
    const adapter = new MeteoalarmRoAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    const res = await adapter.fetchNews('');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(3);
    expect(res.value.freshness.fetchedAt).toBe(NOW);
  });

  it('fetchNews filters by a case-insensitive query over title+summary', async () => {
    const adapter = new MeteoalarmRoAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    const res = await adapter.fetchNews('vaslui');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(1);
    expect(res.value.data[0]?.title).toContain('Vaslui');
  });

  it('reports a healthy (CLOSED) breaker and correct identity/coverage', () => {
    const adapter = new MeteoalarmRoAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('meteoalarm-ro');
    expect(adapter.coverage).toEqual({ kind: 'COUNTRIES', iso: ['RO'] });
  });
});

describe('makeMeteoalarmRoAdapter factory', () => {
  it('builds a MOCK adapter from env (default mode)', () => {
    const res = makeMeteoalarmRoAdapter(mkEngine(new FakeCache()), {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
  });

  it('rejects an invalid mode (CONFIG, fail-fast)', () => {
    const res = makeMeteoalarmRoAdapter(mkEngine(new FakeCache()), {
      SOURCE_METEOALARM_RO_MODE: 'bogus',
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });
});

function seedFetchResult(fetchedAt: string): FetchResult<NewsItem> {
  const entity: NewsItem = {
    title: 'Yellow Thunderstorm Warning issued for Romania - Vrancea',
    url: 'https://feeds.meteoalarm.org/api/v1/warnings/feeds-romania/x?index_area=37',
    publishedAt: fetchedAt,
    summary: 'Vrancea — awareness_type=3, awareness_level=2',
  };
  return {
    records: [
      {
        entity,
        provenance: {
          id: asId<SourceId>('66666666-6666-4666-8666-666666666666'),
          source: 'MeteoAlarm',
          adapter: 'meteoalarm-ro',
          fetchedAt,
          license: 'MeteoAlarm — terms equivalent to CC BY 4.0',
          mode: 'LIVE',
        },
      },
    ],
    freshness: fetchedAt,
    mode: 'LIVE',
    degraded: false,
  };
}
