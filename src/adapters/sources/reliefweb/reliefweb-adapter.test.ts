// BEACON — ReliefWeb adapter tests (E4·T-189; ADR-009/F1/F5/F6, DATA_SOURCE_VERIFICATION §5). Mode-switch
// (mock/cached/live) each yields provenance-stamped NewsItems; the live rung degrades to the recorded mock
// when upstream is unreachable; the outward NewsIntelPort.fetchNews adapts the ladder to the Sourced
// envelope with credibility/sourceAuthority preserved; the factory fails fast on LIVE without an appname.
// Deterministic clock is safely in the past (flaky-test rule).
import { describe, it, expect } from 'vitest';
import { ok } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import { asId } from '@/domain/index.js';
import type { SourceId } from '@/domain/index.js';
import type { NewsItem } from '@/ports/intel.js';
import type { CachePort } from '@/ports/infra.js';
import type { FetchResult, Region, SourceConfig } from '@/adapters/_shared/index.js';
import { RedundancyEngine, cacheKey } from '@/adapters/_shared/index.js';
import { ReliefWebAdapter, makeReliefWebAdapter } from './reliefweb-adapter.js';

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

const NOW = '2026-07-10T12:00:00Z'; // safely past — Freshness rejects future fetchedAt (flaky-test rule)
const GLOBAL: Region = { id: 'global', bbox: [-180, -90, 180, 90] };
const mkEngine = (cache: CachePort) =>
  new RedundancyEngine({ cache, nowIso: () => NOW, idGen: () => 'sid-reliefweb' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});

describe('ReliefWebAdapter mode-switch', () => {
  it('MOCK mode serves the recorded fixture as provenance-stamped NewsItems', async () => {
    const adapter = new ReliefWebAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    const res = await adapter.fetch(GLOBAL);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(5);
    const first = res.value.records[0];
    expect(first?.entity.title).toContain('Romania: Floods');
    expect(first?.entity.sourceAuthority).toBe('OFFICIAL');
    expect(first?.entity.credibility).toBe(0.9);
    expect(first?.provenance.source).toBe('UN OCHA ReliefWeb');
    expect(first?.provenance.adapter).toBe('reliefweb');
    expect(first?.provenance.mode).toBe('MOCK');
    expect(first?.provenance.license).toBe('UN OCHA terms (attribution)');
  });

  it('CACHED mode serves last-known-good with degraded=true and preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    cache.store.set(cacheKey('reliefweb', GLOBAL.id), seedFetchResult('2026-07-10T09:00:00Z'));
    const adapter = new ReliefWebAdapter({ engine: mkEngine(cache), config: cfg('CACHED') });
    const res = await adapter.fetch(GLOBAL);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.degraded).toBe(true);
    expect(res.value.freshness).toBe('2026-07-10T09:00:00Z');
  });

  it('CACHED mode falls back to the recorded mock when the cache is empty', async () => {
    const adapter = new ReliefWebAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('CACHED'),
    });
    const res = await adapter.fetch(GLOBAL);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.records).toHaveLength(5);
  });

  it('LIVE mode degrades to the recorded mock when upstream is unreachable (F5 → OP3)', async () => {
    const adapter = new ReliefWebAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', {
        url: 'http://127.0.0.1:9/v2/reports',
        apiKey: 'beacon-fixture-recording',
      }),
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(GLOBAL);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK'); // live down, cache empty → recorded mock, never a dead-end
    expect(res.value.records.length).toBeGreaterThan(0);
  });
});

describe('ReliefWebAdapter outward NewsIntelPort', () => {
  it('fetchNews returns a Sourced envelope of NewsItems with freshness + credibility/sourceAuthority', async () => {
    const adapter = new ReliefWebAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    const res = await adapter.fetchNews('wildfire');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(5);
    expect(res.value.freshness.fetchedAt).toBe(NOW);
    for (const item of res.value.data) {
      expect(item.sourceAuthority).toBe('OFFICIAL');
      expect(item.credibility).toBe(0.9);
    }
  });

  it('reports a healthy (CLOSED) breaker and correct identity/coverage', () => {
    const adapter = new ReliefWebAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('reliefweb');
    expect(adapter.coverage).toEqual({ kind: 'GLOBAL' });
  });
});

describe('makeReliefWebAdapter factory', () => {
  it('builds a CACHED adapter from env by default (task brief: defaultMode CACHED)', () => {
    const res = makeReliefWebAdapter(mkEngine(new FakeCache()), {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
  });

  it('builds a MOCK adapter from env when explicitly configured', () => {
    const res = makeReliefWebAdapter(mkEngine(new FakeCache()), { SOURCE_RELIEFWEB_MODE: 'MOCK' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
  });

  it('fails fast (CONFIG) when LIVE mode lacks RELIEFWEB_APPNAME', () => {
    const res = makeReliefWebAdapter(mkEngine(new FakeCache()), { SOURCE_RELIEFWEB_MODE: 'LIVE' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });

  it('builds a LIVE adapter from env when RELIEFWEB_APPNAME is set', () => {
    const res = makeReliefWebAdapter(mkEngine(new FakeCache()), {
      SOURCE_RELIEFWEB_MODE: 'LIVE',
      RELIEFWEB_APPNAME: 'beacon-fixture-recording',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('LIVE');
  });

  it('honors SOURCE_RELIEFWEB_URL as an override of the default v2 endpoint', () => {
    const res = makeReliefWebAdapter(mkEngine(new FakeCache()), {
      SOURCE_RELIEFWEB_URL: 'https://example.test/v2/reports',
    });
    expect(res.ok).toBe(true);
  });
});

function seedFetchResult(fetchedAt: string): FetchResult<NewsItem> {
  const entity: NewsItem = {
    title: 'Seeded cached ReliefWeb report',
    url: 'https://reliefweb.int/node/1',
    publishedAt: fetchedAt,
    summary: 'Seeded summary',
    sourceAuthority: 'OFFICIAL',
    credibility: 0.9,
  };
  return {
    records: [
      {
        entity,
        provenance: {
          id: asId<SourceId>('77777777-7777-4777-8777-777777777777'),
          source: 'UN OCHA ReliefWeb',
          adapter: 'reliefweb',
          fetchedAt,
          license: 'UN OCHA terms (attribution)',
          mode: 'LIVE',
        },
      },
    ],
    freshness: fetchedAt,
    mode: 'LIVE',
    degraded: false,
  };
}
