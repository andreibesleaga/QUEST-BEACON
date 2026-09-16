// BEACON — Agency-RSS adapter tests (D-32/D-33; ADR-009/F1/F5/F6). Each mode yields provenance-stamped
// NewsItems, sorted newest-first; the live rung tolerates a partial-feed failure and only degrades when
// EVERY selected feed is unreachable; fetchLive caps at the first N=3 configured feeds (latency bound);
// coverage GLOBAL never rejects a region; the RO region rule picks AGENCYRSS_FEEDS_RO; the outward
// NewsIntelPort adapts the ladder + filters by query + routes RO-shaped queries to the RO feed set; the
// factory reads SOURCE_AGENCYRSS_* + AGENCYRSS_FEEDS[_RO] env. Network is stubbed (no real egress) — a
// deterministic in-memory fetch double, never the live internet. Deterministic clock is safely in the past.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { ok, asId } from '@/domain/index.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { SourceId } from '@/domain/index.js';
import type { NewsItem } from '@/ports/intel.js';
import type { CachePort } from '@/ports/infra.js';
import type { FetchResult, Region, SourceConfig } from '@/adapters/_shared/index.js';
import { RedundancyEngine, cacheKey } from '@/adapters/_shared/index.js';
import {
  AgencyRssAdapter,
  makeAgencyRssAdapter,
  parseFeedsEnv,
  regionForQuery,
} from './agency-rss-adapter.js';

const FIXTURE = readFileSync(
  fileURLToPath(new URL('./__fixtures__/feed.xml', import.meta.url)),
  'utf8',
);

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
const GLOBAL: Region = { id: 'global', bbox: [-180, -90, 180, 90] };
const mkEngine = (cache: CachePort) =>
  new RedundancyEngine({ cache, nowIso: () => NOW, idGen: () => 'sid-agency-rss' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AgencyRssAdapter mode-switch', () => {
  it('MOCK mode serves the recorded fixture as provenance-stamped NewsItems, sorted newest-first', async () => {
    const adapter = new AgencyRssAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
      feeds: [],
    });
    const res = await adapter.fetch(GLOBAL);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(5);
    // fixture pubDates are NOT already monotonic (23:05 / 21:06 / 16:07 / 08:42 / 15:00) — this proves the
    // loader actually sorts, not just passes fixture order through.
    expect(res.value.records.map((r) => r.entity.title)).toEqual([
      expect.stringContaining('Fiji'),
      expect.stringContaining('ELIDA'),
      expect.stringContaining('Philipp'),
      expect.stringContaining('Canada'),
      expect.stringContaining('Peru'),
    ]);
    const first = res.value.records[0];
    expect(first?.entity.url).toBe(
      'https://www.gdacs.org/report.aspx?eventtype=EQ&eventid=1551894',
    );
    expect(first?.entity.sourceAuthority).toBe('OFFICIAL');
    expect(first?.entity.credibility).toBe(0.85);
    expect(first?.provenance.source).toBe('Agency RSS aggregation');
    expect(first?.provenance.adapter).toBe('agency-rss');
    expect(first?.provenance.mode).toBe('MOCK');
    expect(first?.provenance.license).toBe('per-feed (verified open feeds)');
  });

  it('caps the merged result at maxItems (cap 25 in production; overridden here to prove the cap applies)', async () => {
    const adapter = new AgencyRssAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
      feeds: [],
      maxItems: 3,
    });
    const res = await adapter.fetch(GLOBAL);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.records).toHaveLength(3);
  });

  it('CACHED mode serves last-known-good with degraded=true and preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    cache.store.set(cacheKey('agency-rss', GLOBAL.id), seedFetchResult('2026-07-15T07:00:00Z'));
    const adapter = new AgencyRssAdapter({
      engine: mkEngine(cache),
      config: cfg('CACHED'),
      feeds: [],
    });
    const res = await adapter.fetch(GLOBAL);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.freshness).toBe('2026-07-15T07:00:00Z');
  });

  it('LIVE mode degrades to the recorded mock when EVERY configured feed is unreachable (F5 -> OP3)', async () => {
    const adapter = new AgencyRssAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE'),
      feeds: ['http://127.0.0.1:9/feed-a.xml', 'http://127.0.0.1:9/feed-b.xml'], // two unreachable feeds
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(GLOBAL);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK'); // both feeds down, cache empty -> recorded mock, never a dead-end
    expect(res.value.records.length).toBeGreaterThan(0);
  });

  it('LIVE mode tolerates a partial-feed failure: one feed down, one up -> still LIVE (not degraded)', async () => {
    const calledUrls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL) => {
        const url = String(input);
        calledUrls.push(url);
        if (url.includes('down')) return Promise.reject(new Error('ECONNREFUSED'));
        return Promise.resolve(new Response(FIXTURE, { status: 200 }));
      }),
    );
    const adapter = new AgencyRssAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE'),
      feeds: ['https://down.example.test/feed.xml', 'https://up.example.test/feed.xml'],
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(GLOBAL);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('LIVE');
    expect(res.value.degraded).toBe(false);
    expect(res.value.records).toHaveLength(5);
    expect(calledUrls).toEqual([
      'https://down.example.test/feed.xml',
      'https://up.example.test/feed.xml',
    ]);
  });

  it('fetchLive caps at the FIRST N=3 configured feeds per fetch (latency bound)', async () => {
    const calledUrls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL) => {
        calledUrls.push(String(input));
        return Promise.resolve(new Response(FIXTURE, { status: 200 }));
      }),
    );
    const feeds = Array.from({ length: 5 }, (_, i) => `https://feed${i + 1}.example.test/rss.xml`);
    const adapter = new AgencyRssAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE'),
      feeds,
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(GLOBAL);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('LIVE');
    expect(calledUrls).toEqual(feeds.slice(0, 3));
  });

  it('GLOBAL coverage never rejects a region (any region is covered)', async () => {
    const adapter = new AgencyRssAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
      feeds: [],
    });
    const res = await adapter.fetch({ id: 'au', bbox: [113, -44, 154, -10], iso: 'AU' });
    expect(res.ok).toBe(true);
  });
});

describe('AgencyRssAdapter RO region selection', () => {
  it('selects AGENCYRSS_FEEDS_RO over AGENCYRSS_FEEDS when the region.iso is RO', async () => {
    const calledUrls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL) => {
        calledUrls.push(String(input));
        return Promise.resolve(new Response(FIXTURE, { status: 200 }));
      }),
    );
    const adapter = new AgencyRssAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE'),
      feeds: ['https://worldwide.example.test/rss.xml'],
      feedsRo: ['https://digi24.example.test/rss.xml'],
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch({ id: 'ro', bbox: [20, 43, 30, 48], iso: 'RO' });
    expect(res.ok).toBe(true);
    expect(calledUrls).toEqual(['https://digi24.example.test/rss.xml']);
  });

  it('falls back to AGENCYRSS_FEEDS when AGENCYRSS_FEEDS_RO is empty even for an RO region', async () => {
    const calledUrls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL) => {
        calledUrls.push(String(input));
        return Promise.resolve(new Response(FIXTURE, { status: 200 }));
      }),
    );
    const adapter = new AgencyRssAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE'),
      feeds: ['https://worldwide.example.test/rss.xml'],
      feedsRo: [],
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch({ id: 'ro', bbox: [20, 43, 30, 48], iso: 'RO' });
    expect(res.ok).toBe(true);
    expect(calledUrls).toEqual(['https://worldwide.example.test/rss.xml']);
  });

  it('regionForQuery: a RO-shaped query ("Romania", whole-word "ro") selects the RO region', () => {
    expect(regionForQuery('Romania flood update').iso).toBe('RO');
    expect(regionForQuery('flooding in ro today').iso).toBe('RO');
  });

  it('regionForQuery: any other query selects the GLOBAL region (no iso)', () => {
    expect(regionForQuery('wildfire near Los Angeles').iso).toBeUndefined();
    expect(regionForQuery('').iso).toBeUndefined();
    expect(regionForQuery('storm forecast').iso).toBeUndefined(); // "storm" contains "ro" but not as a whole word
  });
});

describe('AgencyRssAdapter outward NewsIntelPort', () => {
  it('fetchNews returns a Sourced envelope of NewsItems with freshness', async () => {
    const adapter = new AgencyRssAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
      feeds: [],
    });
    const res = await adapter.fetchNews('');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(5);
    expect(res.value.freshness.fetchedAt).toBe(NOW);
  });

  it('fetchNews filters by a case-insensitive query over title+summary', async () => {
    const adapter = new AgencyRssAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
      feeds: [],
    });
    const res = await adapter.fetchNews('fiji');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(1);
    expect(res.value.data[0]?.title).toContain('Fiji');
  });

  it('reports a healthy (CLOSED) breaker and correct identity/coverage', () => {
    const adapter = new AgencyRssAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
      feeds: [],
    });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('agency-rss');
    expect(adapter.coverage).toEqual({ kind: 'GLOBAL' });
  });
});

describe('parseFeedsEnv', () => {
  it('splits a comma-separated env value into trimmed, non-empty URLs', () => {
    expect(
      parseFeedsEnv('https://a.test/rss.xml, https://b.test/rss.xml ,https://c.test/rss.xml'),
    ).toEqual(['https://a.test/rss.xml', 'https://b.test/rss.xml', 'https://c.test/rss.xml']);
  });

  it('drops empty segments (trailing comma / blank entries)', () => {
    expect(parseFeedsEnv('https://a.test/rss.xml,,  ,https://b.test/rss.xml,')).toEqual([
      'https://a.test/rss.xml',
      'https://b.test/rss.xml',
    ]);
  });

  it('returns an empty list for undefined/empty env', () => {
    expect(parseFeedsEnv(undefined)).toEqual([]);
    expect(parseFeedsEnv('')).toEqual([]);
  });
});

describe('makeAgencyRssAdapter factory', () => {
  it('defaults to LIVE mode (keyless) when SOURCE_AGENCYRSS_MODE is unset', () => {
    const res = makeAgencyRssAdapter(mkEngine(new FakeCache()), {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('LIVE');
  });

  it('rejects an invalid mode (CONFIG, fail-fast)', () => {
    const res = makeAgencyRssAdapter(mkEngine(new FakeCache()), { SOURCE_AGENCYRSS_MODE: 'bogus' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });

  it('wires AGENCYRSS_FEEDS/_RO from env end-to-end (LIVE-down over the configured feeds degrades to MOCK)', async () => {
    const res = makeAgencyRssAdapter(mkEngine(new FakeCache()), {
      SOURCE_AGENCYRSS_MODE: 'LIVE',
      SOURCE_AGENCYRSS_TIMEOUT_MS: '400',
      AGENCYRSS_FEEDS: 'http://127.0.0.1:9/a.xml,http://127.0.0.1:9/b.xml',
      AGENCYRSS_FEEDS_RO: 'http://127.0.0.1:9/ro-a.xml',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const fetched = await res.value.fetch(GLOBAL);
    expect(fetched.ok).toBe(true);
    if (!fetched.ok) return;
    expect(fetched.value.mode).toBe('MOCK'); // env-configured feeds were used, all unreachable -> degrade
  });
});

function seedFetchResult(fetchedAt: string): FetchResult<NewsItem> {
  const entity: NewsItem = {
    title: 'Seeded cached advisory',
    url: 'https://reliefweb.int/updates/seeded',
    publishedAt: fetchedAt,
    summary: 'Cached last-known-good sample.',
    sourceAuthority: 'OFFICIAL',
    credibility: 0.85,
  };
  return {
    records: [
      {
        entity,
        provenance: {
          id: asId<SourceId>('77777777-7777-4777-8777-777777777777'),
          source: 'Agency RSS aggregation',
          adapter: 'agency-rss',
          fetchedAt,
          license: 'per-feed (verified open feeds)',
          mode: 'LIVE',
        },
      },
    ],
    freshness: fetchedAt,
    mode: 'LIVE',
    degraded: false,
  };
}
