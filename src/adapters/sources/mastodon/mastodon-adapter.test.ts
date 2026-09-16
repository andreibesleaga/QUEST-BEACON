// BEACON — Mastodon adapter tests (S2·Lane-A1; ADR-009/F1/F5/F6, Art. XIV/XVI). Mode-switch
// (mock/cached/live) each yields usable NewsItems stamped SOCIAL/0.35 on every item (never merged as fact);
// LIVE issues one GET per watched tag and merges them; a single failing tag does not sink the live rung but
// an all-tags failure degrades to the recorded mock; provenance is stamped on every record; the outward
// NewsIntelPort adapts the ladder to the Sourced envelope; the factory reads MASTODON_* env, defaults to
// KEYLESS LIVE and fail-fasts on bad config. No live network: `fetch` is stubbed per test.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ok, asId } from '@/domain/index.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { SourceId } from '@/domain/index.js';
import type { NewsItem } from '@/ports/intel.js';
import type { CachePort } from '@/ports/infra.js';
import type { FetchResult, Region, SourceConfig } from '@/adapters/_shared/index.js';
import { RedundancyEngine, cacheKey } from '@/adapters/_shared/index.js';
import {
  MastodonAdapter,
  buildMastodonTagUrl,
  makeMastodonAdapter,
  selectTags,
} from './mastodon-adapter.js';

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

const NOW = '2026-07-05T22:00:00Z'; // the project's fixed deterministic clock
const SOURCE_LABEL = 'Mastodon public timeline (vetted-social)';
const region: Region = { id: 'us-ca', bbox: [-180, -90, 180, 90] };
const fixtureJson = readFileSync(
  fileURLToPath(new URL('./__fixtures__/timeline.json', import.meta.url)),
  'utf8',
);

const mkEngine = (cache: CachePort) =>
  new RedundancyEngine({ cache, nowIso: () => NOW, idGen: () => 'sid-mastodon' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});

/** Stub the platform fetch with a per-URL responder — NO live network is ever reached in these tests. */
function stubFetch(responder: (url: string) => Promise<Response> | Response): string[] {
  const seen: string[] = [];
  vi.stubGlobal('fetch', (url: string) => {
    seen.push(String(url));
    return Promise.resolve(responder(String(url)));
  });
  return seen;
}

const jsonResponse = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MastodonAdapter mode-switch', () => {
  it('MOCK mode serves the recorded fixture as SOCIAL/0.35 NewsItems (degraded, provenance MOCK)', async () => {
    const adapter = new MastodonAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(5);
    for (const r of res.value.records) {
      expect(r.entity.sourceAuthority).toBe('SOCIAL');
      expect(r.entity.credibility).toBe(0.35);
      expect(r.provenance.mode).toBe('MOCK');
      expect(r.provenance.source).toBe(SOURCE_LABEL);
      expect(r.provenance.adapter).toBe('mastodon');
      expect(r.provenance.license).toBe(
        'Mastodon instance public API — public posts, corroboration-only',
      );
    }
  });

  it('CACHED mode serves last-known-good with degraded=true and preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    cache.store.set(cacheKey('mastodon', region.id), seedFetchResult('2026-07-05T21:00:00Z'));
    const adapter = new MastodonAdapter({ engine: mkEngine(cache), config: cfg('CACHED') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.degraded).toBe(true);
    expect(res.value.freshness).toBe('2026-07-05T21:00:00Z');
  });

  it('LIVE mode fetches ONE tag timeline per watched tag and merges them into one deduped list', async () => {
    const seen = stubFetch(() => jsonResponse(fixtureJson));
    const adapter = new MastodonAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'https://instance.test' }),
      tags: ['wildfire', 'flood'],
    });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('LIVE');
    expect(res.value.degraded).toBe(false);
    expect(seen).toEqual([
      'https://instance.test/api/v1/timelines/tag/wildfire?limit=20',
      'https://instance.test/api/v1/timelines/tag/flood?limit=20',
    ]);
    // The same 5 statuses come back for both tags — de-duplication keeps exactly 5, newest-first.
    expect(res.value.records).toHaveLength(5);
    expect(res.value.records[0]?.entity.publishedAt).toBe('2026-07-05T21:35:19.000Z');
    expect(res.value.records[0]?.provenance.mode).toBe('LIVE');
  });

  it('LIVE keeps serving the tags that DID answer when one tag timeline is down (Art. XVI)', async () => {
    stubFetch((url) =>
      url.includes('/tag/flood') ? jsonResponse('nope', 503) : jsonResponse(fixtureJson),
    );
    const adapter = new MastodonAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'https://instance.test' }),
      tags: ['wildfire', 'flood'],
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('LIVE');
    expect(res.value.records).toHaveLength(5);
  });

  it('LIVE mode degrades to the recorded mock when EVERY tag timeline is unreachable (F5 → OP3)', async () => {
    stubFetch(() => Promise.reject(new Error('ECONNREFUSED')));
    const adapter = new MastodonAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'https://instance.test' }),
      tags: ['wildfire', 'flood'],
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK'); // live down, cache empty → recorded mock, never a dead-end
    expect(res.value.records).toHaveLength(5);
  });
});

describe('MastodonAdapter outward NewsIntelPort', () => {
  it('fetchNews returns a Sourced envelope of NewsItems, all SOCIAL/0.35, with freshness', async () => {
    const adapter = new MastodonAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetchNews('wildfire');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(5);
    for (const item of res.value.data) {
      expect(item.sourceAuthority).toBe('SOCIAL');
      expect(item.credibility).toBe(0.35);
    }
    expect(res.value.freshness.fetchedAt).toBe(NOW);
  });

  it('narrows the live fetch to ONE tag when the query names a configured tag', async () => {
    const seen = stubFetch(() => jsonResponse(fixtureJson));
    const adapter = new MastodonAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'https://instance.test' }),
      tags: ['wildfire', 'flood'],
    });
    const res = await adapter.fetchNews('Flood');
    expect(res.ok).toBe(true);
    expect(seen).toEqual(['https://instance.test/api/v1/timelines/tag/flood?limit=20']);
  });

  it('fetches the WHOLE watchlist for a blank query or a free-text query (never invents a hashtag)', async () => {
    const seen = stubFetch(() => jsonResponse(fixtureJson));
    const adapter = new MastodonAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'https://instance.test' }),
      tags: ['wildfire', 'flood'],
    });
    await adapter.fetchNews('   ');
    await adapter.fetchNews('wildfire OR flood OR evacuation');
    expect(seen.filter((u) => u.includes('/tag/wildfire'))).toHaveLength(2);
    expect(seen.filter((u) => u.includes('/tag/flood'))).toHaveLength(2);
  });

  it('reports a healthy (CLOSED) breaker before any failure, with GLOBAL coverage and id mastodon', () => {
    const adapter = new MastodonAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('mastodon');
    expect(adapter.coverage).toEqual({ kind: 'GLOBAL' });
  });
});

describe('makeMastodonAdapter factory', () => {
  it("defaults to KEYLESS LIVE with no env at all (the demo's live social source)", () => {
    const res = makeMastodonAdapter(mkEngine(new FakeCache()), {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('LIVE');
  });

  it('honors SOURCE_MASTODON_MODE and needs no API key in any mode', () => {
    const res = makeMastodonAdapter(mkEngine(new FakeCache()), { SOURCE_MASTODON_MODE: 'MOCK' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
  });

  it('uses MASTODON_INSTANCE (trailing slash trimmed) as the live base URL', async () => {
    const seen = stubFetch(() => jsonResponse(fixtureJson));
    const res = makeMastodonAdapter(mkEngine(new FakeCache()), {
      MASTODON_INSTANCE: 'https://mastodon.example/',
      MASTODON_TAGS: '#Wildfire',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    await res.value.fetch(region);
    expect(seen).toEqual(['https://mastodon.example/api/v1/timelines/tag/wildfire?limit=20']);
  });

  it('parses MASTODON_TAGS into the watchlist (comma-separated, #-stripped, lowercased)', async () => {
    const seen = stubFetch(() => jsonResponse(fixtureJson));
    const res = makeMastodonAdapter(mkEngine(new FakeCache()), {
      MASTODON_INSTANCE: 'https://mastodon.example',
      MASTODON_TAGS: 'Wildfire, inundatii ,#Flood',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    await res.value.fetch(region);
    expect(seen.map((u) => u.split('/tag/')[1])).toEqual([
      'wildfire?limit=20',
      'inundatii?limit=20',
      'flood?limit=20',
    ]);
  });

  it('fails fast (CONFIG) on an invalid mode', () => {
    const res = makeMastodonAdapter(mkEngine(new FakeCache()), { SOURCE_MASTODON_MODE: 'bogus' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });

  it('fails fast (CONFIG) when MASTODON_INSTANCE is not an absolute http(s) URL', () => {
    const res = makeMastodonAdapter(mkEngine(new FakeCache()), {
      MASTODON_INSTANCE: 'mastodon.social',
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });

  it('fails fast (CONFIG) when MASTODON_TAGS was set but contains no usable hashtag', () => {
    const res = makeMastodonAdapter(mkEngine(new FakeCache()), { MASTODON_TAGS: '!!!, ###' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });
});

describe('buildMastodonTagUrl / selectTags (pure)', () => {
  it('builds the documented tag-timeline URL with an encoded tag and an explicit limit', () => {
    expect(buildMastodonTagUrl('https://mastodon.social', 'wildfire', 25)).toBe(
      'https://mastodon.social/api/v1/timelines/tag/wildfire?limit=25',
    );
  });

  it('trims a trailing slash on the instance and URL-encodes a non-ASCII tag', () => {
    expect(buildMastodonTagUrl('https://mastodon.social//', 'incendiu', 5)).toBe(
      'https://mastodon.social/api/v1/timelines/tag/incendiu?limit=5',
    );
    expect(buildMastodonTagUrl('https://mastodon.social', 'inundații', 5)).toBe(
      'https://mastodon.social/api/v1/timelines/tag/inunda%C8%9Bii?limit=5',
    );
  });

  it('narrows to a configured tag (case-insensitively) and otherwise returns the whole watchlist', () => {
    const configured = ['wildfire', 'flood'];
    expect(selectTags('Flood', configured)).toEqual(['flood']);
    expect(selectTags('us-ca', configured)).toEqual(configured);
    expect(selectTags('', configured)).toEqual(configured);
  });
});

function seedFetchResult(fetchedAt: string): FetchResult<NewsItem> {
  const entity: NewsItem = {
    title: 'Seeded cached corroboration post about the fire line',
    url: 'https://example-instance.test/@example-observer-1/110000000000000001',
    publishedAt: fetchedAt,
    summary: 'Seeded cached corroboration post about the fire line, kept for freshness testing.',
    credibility: 0.35,
    sourceAuthority: 'SOCIAL',
  };
  return {
    records: [
      {
        entity,
        provenance: {
          id: asId<SourceId>('66666666-6666-4666-8666-666666666666'),
          source: SOURCE_LABEL,
          adapter: 'mastodon',
          fetchedAt,
          license: 'Mastodon instance public API — public posts, corroboration-only',
          mode: 'LIVE',
        },
      },
    ],
    freshness: fetchedAt,
    mode: 'LIVE',
    degraded: false,
  };
}
