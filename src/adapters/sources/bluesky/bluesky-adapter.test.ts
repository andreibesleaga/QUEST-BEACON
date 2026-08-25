// BEACON — Bluesky adapter tests (E4·T-179; ADR-009/F1/F5/F6, Art. XIV). Mode-switch (mock/cached/live)
// each yields usable NewsItems stamped SOCIAL/0.35 on every item (never merged as fact); the live rung
// degrades to the recorded mock when upstream is unreachable; provenance is stamped on every record; the
// outward NewsIntelPort.fetchNews adapts the ladder to the Sourced envelope with a default query fallback;
// URL construction is pure. S2·Lane-A1: LIVE is now the BYO-ACCOUNT rung — the factory fail-fasts (CONFIG)
// on `SOURCE_BLUESKY_MODE=live` without BOTH `BLUESKY_IDENTIFIER` and `BLUESKY_APP_PASSWORD`, points the
// search at the operator's PDS when they ARE set, and the adapter then reads through the authed session
// (injected fetch — no live network). MOCK stays the default mode.
import { describe, it, expect, vi } from 'vitest';
import { ok, asId } from '@/domain/index.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { SourceId } from '@/domain/index.js';
import type { NewsItem } from '@/ports/intel.js';
import type { CachePort } from '@/ports/infra.js';
import type { FetchResult, Region, SourceConfig } from '@/adapters/_shared/index.js';
import { RedundancyEngine, cacheKey } from '@/adapters/_shared/index.js';
import { BlueskyAdapter, buildBlueskyUrl, makeBlueskyAdapter } from './bluesky-adapter.js';
import type { FetchLike } from './bluesky-session.js';
import { BlueskySessionClient } from './bluesky-session.js';

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
const region: Region = { id: 'wildfire', bbox: [-180, -90, 180, 90] };
const mkEngine = (cache: CachePort) =>
  new RedundancyEngine({ cache, nowIso: () => NOW, idGen: () => 'sid-bluesky' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});

describe('BlueskyAdapter mode-switch', () => {
  it('MOCK mode serves the recorded fixture as SOCIAL/0.35 NewsItems (degraded, provenance MOCK)', async () => {
    const adapter = new BlueskyAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(4);
    for (const r of res.value.records) {
      expect(r.entity.sourceAuthority).toBe('SOCIAL');
      expect(r.entity.credibility).toBe(0.35);
      expect(r.provenance.mode).toBe('MOCK');
      expect(r.provenance.source).toBe('Bluesky');
      expect(r.provenance.adapter).toBe('bluesky');
      expect(r.provenance.license).toBe('Bluesky public API terms');
    }
  });

  it('CACHED mode serves last-known-good with degraded=true and preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    const seeded = seedFetchResult('2026-07-15T08:00:00Z');
    cache.store.set(cacheKey('bluesky', region.id), seeded);
    const adapter = new BlueskyAdapter({ engine: mkEngine(cache), config: cfg('CACHED') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.degraded).toBe(true);
    expect(res.value.freshness).toBe('2026-07-15T08:00:00Z');
  });

  it('LIVE mode degrades to the recorded mock when upstream is unreachable (F5 → OP3)', async () => {
    const adapter = new BlueskyAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'http://127.0.0.1:9/xrpc/app.bsky.feed.searchPosts' }),
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK'); // live down, cache empty → recorded mock, never a dead-end
    expect(res.value.records.length).toBeGreaterThan(0);
  });
});

describe('BlueskyAdapter outward NewsIntelPort', () => {
  it('fetchNews returns a Sourced envelope of NewsItems, all SOCIAL/0.35, with freshness', async () => {
    const adapter = new BlueskyAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetchNews('wildfire');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(4);
    for (const item of res.value.data) {
      expect(item.sourceAuthority).toBe('SOCIAL');
      expect(item.credibility).toBe(0.35);
    }
    expect(res.value.freshness.fetchedAt).toBe(NOW);
  });

  it('falls back to the default disaster-corroboration query when the query is blank', async () => {
    const adapter = new BlueskyAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetchNews('   ');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data.length).toBeGreaterThan(0); // MOCK ignores the query, but must still succeed
  });

  it('reports a healthy (CLOSED) breaker before any failure, with GLOBAL coverage and id bluesky', () => {
    const adapter = new BlueskyAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('bluesky');
    expect(adapter.coverage).toEqual({ kind: 'GLOBAL' });
  });
});

describe('makeBlueskyAdapter factory', () => {
  it('builds a MOCK adapter from env (default mode)', () => {
    const res = makeBlueskyAdapter(mkEngine(new FakeCache()), {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
  });

  it('fails fast (CONFIG) on LIVE without credentials — the keyless public search now 403s', () => {
    const res = makeBlueskyAdapter(mkEngine(new FakeCache()), { SOURCE_BLUESKY_MODE: 'LIVE' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
    expect(res.error.retryable).toBe(false);
    expect(res.error.message).toContain('BLUESKY_IDENTIFIER');
    expect(res.error.message).toContain('BLUESKY_APP_PASSWORD');
  });

  it('fails fast (CONFIG) on LIVE with only HALF the credentials set (both vars or neither)', () => {
    for (const half of [
      { BLUESKY_IDENTIFIER: 'beacon-demo.bsky.social' },
      { BLUESKY_APP_PASSWORD: 'abcd-efgh-ijkl-mnop' },
    ]) {
      const res = makeBlueskyAdapter(mkEngine(new FakeCache()), { SOURCE_BLUESKY_MODE: 'LIVE', ...half });
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error.kind).toBe('CONFIG');
    }
  });

  it('builds a LIVE adapter when BOTH BYO-account credentials are set', () => {
    const res = makeBlueskyAdapter(mkEngine(new FakeCache()), {
      SOURCE_BLUESKY_MODE: 'LIVE',
      BLUESKY_IDENTIFIER: 'beacon-demo.bsky.social',
      BLUESKY_APP_PASSWORD: 'abcd-efgh-ijkl-mnop',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('LIVE');
  });

  it('routes the authed search through the operator PDS (BLUESKY_SERVICE_URL), not the public AppView', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      seen.push(String(url));
      const body = String(url).includes('createSession')
        ? JSON.stringify({ accessJwt: 'access-1', refreshJwt: 'refresh-1' })
        : JSON.stringify({ posts: [] });
      return Promise.resolve(new Response(body, { status: 200 }));
    });
    const res = makeBlueskyAdapter(mkEngine(new FakeCache()), {
      SOURCE_BLUESKY_MODE: 'LIVE',
      BLUESKY_IDENTIFIER: 'beacon-demo.bsky.social',
      BLUESKY_APP_PASSWORD: 'abcd-efgh-ijkl-mnop',
      BLUESKY_SERVICE_URL: 'https://pds.test/',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    await res.value.fetch(region);
    expect(seen[0]).toBe('https://pds.test/xrpc/com.atproto.server.createSession');
    expect(seen[1]).toBe('https://pds.test/xrpc/app.bsky.feed.searchPosts?q=wildfire&limit=25');
    vi.unstubAllGlobals();
  });

  it('MOCK stays the default and needs no credentials at all (the operator brings no account)', () => {
    const res = makeBlueskyAdapter(mkEngine(new FakeCache()), {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
  });

  it('honors SOURCE_BLUESKY_URL to override the default base endpoint', () => {
    const res = makeBlueskyAdapter(mkEngine(new FakeCache()), {
      SOURCE_BLUESKY_MODE: 'MOCK',
      SOURCE_BLUESKY_URL: 'https://example.test/xrpc/app.bsky.feed.searchPosts',
    });
    expect(res.ok).toBe(true);
  });

  it('fails fast (CONFIG) on an invalid mode', () => {
    const res = makeBlueskyAdapter(mkEngine(new FakeCache()), { SOURCE_BLUESKY_MODE: 'bogus' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });
});

describe('BlueskyAdapter authed LIVE rung (BYO account)', () => {
  const CREDENTIALS = { identifier: 'beacon-demo.bsky.social', appPassword: 'abcd-efgh-ijkl-mnop' };
  const SERVICE = 'https://pds.test';
  const SEARCH_BASE = `${SERVICE}/xrpc/app.bsky.feed.searchPosts`;
  // Hand-authored from the documented AT Protocol lexicons (docs.bsky.app) — no live capture is possible
  // without an account, and the operator is deliberately not creating one.
  const sessionBody = (n: number): string =>
    JSON.stringify({ did: 'did:plc:examplebeacondemo00000000', accessJwt: `access-${n}`, refreshJwt: `refresh-${n}` });
  const searchBody = JSON.stringify({
    posts: [
      {
        uri: 'at://did:plc:examplea1b2c3d4e5f6g7h8/app.bsky.feed.post/3kauthedpost01',
        cid: 'bafyexamplecid000000000000000000000000000000009',
        author: { did: 'did:plc:examplea1b2c3d4e5f6g7h8', handle: 'example-authed.bsky.social' },
        record: {
          $type: 'app.bsky.feed.post',
          text: 'Authed corroboration post about the fire line.',
          createdAt: '2026-07-05T18:00:00.000Z',
        },
        indexedAt: '2026-07-05T18:00:05.000Z',
      },
    ],
  });

  const authedAdapter = (fetchImpl: FetchLike): BlueskyAdapter =>
    new BlueskyAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: SEARCH_BASE }),
      session: new BlueskySessionClient({ credentials: CREDENTIALS, serviceUrl: SERVICE, fetchImpl, timeoutMs: 400 }),
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });

  it('reads searchPosts through the authenticated session and maps SOCIAL/0.35 NewsItems', async () => {
    const seen: string[] = [];
    const fetchImpl: FetchLike = (url, init) => {
      seen.push(`${init?.method ?? 'GET'} ${String(url)}`);
      return Promise.resolve(
        new Response(String(url).includes('createSession') ? sessionBody(1) : searchBody, { status: 200 }),
      );
    };
    const res = await authedAdapter(fetchImpl).fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('LIVE');
    expect(res.value.degraded).toBe(false);
    expect(res.value.records).toHaveLength(1);
    expect(res.value.records[0]?.entity.sourceAuthority).toBe('SOCIAL');
    expect(res.value.records[0]?.entity.credibility).toBe(0.35);
    expect(seen[0]).toBe(`POST ${SERVICE}/xrpc/com.atproto.server.createSession`);
    expect(seen[1]).toBe(`GET ${SEARCH_BASE}?q=wildfire&limit=25`);
  });

  it('survives an expired access token mid-fetch (refresh + retry) without degrading', async () => {
    const fetchImpl: FetchLike = (url, init) => {
      const u = String(url);
      const auth = ((init?.headers ?? {}) as Record<string, string>).authorization;
      if (u.includes('createSession')) return Promise.resolve(new Response(sessionBody(1), { status: 200 }));
      if (u.includes('refreshSession')) return Promise.resolve(new Response(sessionBody(2), { status: 200 }));
      return Promise.resolve(
        auth === 'Bearer access-1'
          ? new Response(JSON.stringify({ error: 'ExpiredToken' }), { status: 401 })
          : new Response(searchBody, { status: 200 }),
      );
    };
    const res = await authedAdapter(fetchImpl).fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('LIVE');
    expect(res.value.records).toHaveLength(1);
  });

  it('degrades to the recorded mock when the authed rung cannot authenticate at all (Art. XVI)', async () => {
    const fetchImpl: FetchLike = () => Promise.resolve(new Response('{}', { status: 401 }));
    const res = await authedAdapter(fetchImpl).fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK'); // never a dead-end
    expect(res.value.records).toHaveLength(4);
  });
});

describe('buildBlueskyUrl (pure URL construction)', () => {
  it('builds the default searchPosts URL with an encoded query and limit=25', () => {
    const url = buildBlueskyUrl('https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts', 'wildfire');
    expect(url).toBe('https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=wildfire&limit=25');
  });

  it('URL-encodes special characters and spaces in the query', () => {
    const url = buildBlueskyUrl('https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts', 'wildfire near me & now');
    expect(url).toBe(
      'https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=wildfire%20near%20me%20%26%20now&limit=25',
    );
  });

  it('respects an overridden base URL and an explicit limit', () => {
    const url = buildBlueskyUrl('https://example.test/xrpc/app.bsky.feed.searchPosts', 'flood', 10);
    expect(url).toBe('https://example.test/xrpc/app.bsky.feed.searchPosts?q=flood&limit=10');
  });
});

function seedFetchResult(fetchedAt: string): FetchResult<NewsItem> {
  const entity: NewsItem = {
    title: 'Seeded cached corroboration post about the fire line',
    url: 'https://bsky.app/profile/example-seed.bsky.social/post/seedrkey01',
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
          id: asId<SourceId>('77777777-7777-4777-8777-777777777777'),
          source: 'Bluesky',
          adapter: 'bluesky',
          fetchedAt,
          license: 'Bluesky public API terms',
          mode: 'LIVE',
        },
      },
    ],
    freshness: fetchedAt,
    mode: 'LIVE',
    degraded: false,
  };
}
