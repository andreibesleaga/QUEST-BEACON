// BEACON — 511 DOT adapter tests (E11 "Live Views" · CW1; CameraDirectoryPort P16/ADR-009/F1/F5/F6). Mode-
// switch (mock/cached/live) each yields usable CameraFeed with the correct mode/degraded/freshness; the
// live rung degrades to the recorded mock when upstream is unreachable; provenance is stamped on every
// record; the outward CameraDirectoryPort.fetchCameras adapts the ladder to the Sourced envelope AND
// filters to the caller's query bbox (point-in-bbox, since the upstream API has no bbox parameter); the
// factory fails fast (CONFIG) when LIVE mode lacks DOT511_API_KEY.
import { describe, it, expect } from 'vitest';
import { ok } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { CameraFeedId, SourceId } from '@/domain/index.js';
import { asId } from '@/domain/index.js';
import type { CachePort } from '@/ports/infra.js';
import type { CameraFeed } from '@/domain/camera-feed.js';
import type { FetchResult, Region, SourceConfig } from '@/adapters/_shared/index.js';
import { RedundancyEngine, cacheKey } from '@/adapters/_shared/index.js';
import { Dot511Adapter, coverageForHost, makeDot511Adapter } from './dot511-adapter.js';

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

// Metro-Atlanta bbox that covers all 7 usable fixture cameras (spanning ~33.63-33.99N, -84.46 to -83.98W).
const gaBbox: readonly [number, number, number, number] = [-84.6, 33.5, -83.9, 34.2];
const region: Region = { id: 'dot511-state-cameras', bbox: [-180, -90, 180, 90], iso: 'US' };
// Deterministic clock must be safely in the past — Freshness rejects a future fetchedAt (domain invariant).
const NOW = '2026-07-05T22:00:00Z';
const mkEngine = (cache: CachePort) =>
  new RedundancyEngine({ cache, nowIso: () => NOW, idGen: () => 'sid-dot511' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});

describe('Dot511Adapter mode-switch', () => {
  it('MOCK mode serves the recorded fixture as CameraFeed (degraded, provenance MOCK)', async () => {
    const adapter = new Dot511Adapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(7); // 3 of the 10 fixture rows are drop-worthy (see acl test)
    const first = res.value.records[0];
    expect(first?.entity.kind).toBe('TRAFFIC_CCTV');
    expect(first?.entity.position).toEqual([-84.3963, 33.7756]);
    expect(first?.provenance.mode).toBe('MOCK');
    expect(first?.provenance.source).toBe('511 DOT (state traveler info)');
    expect(first?.provenance.license).toBe('State DOT open data (developer key)');
    expect(first?.provenance.adapter).toBe('dot511');
  });

  it('CACHED mode serves last-known-good with degraded=true and preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    cache.store.set(cacheKey('dot511', region.id), seedFetchResult('2026-07-05T20:00:00Z'));
    const adapter = new Dot511Adapter({ engine: mkEngine(cache), config: cfg('CACHED') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.degraded).toBe(true);
    expect(res.value.freshness).toBe('2026-07-05T20:00:00Z');
  });

  it('LIVE mode degrades to the recorded mock when upstream is unreachable (F5 -> OP3)', async () => {
    const adapter = new Dot511Adapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'http://127.0.0.1:9/api/v2/get/cameras', apiKey: 'k' }),
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK'); // live down, cache empty -> recorded mock, never a dead-end
    expect(res.value.records.length).toBeGreaterThan(0);
  });
});

describe('Dot511Adapter outward CameraDirectoryPort', () => {
  it('fetchCameras returns a Sourced envelope of CameraFeed within the query bbox', async () => {
    const adapter = new Dot511Adapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetchCameras({ bbox: gaBbox });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(7);
    expect(res.value.data.every((c) => c.kind === 'TRAFFIC_CCTV')).toBe(true);
    expect(res.value.data.every((c) => c.isLive)).toBe(true);
    expect(res.value.data.every((c) => new URL(c.viewUrl).protocol === 'https:')).toBe(true);
    expect(res.value.freshness.fetchedAt).toBe('2026-07-05T22:00:00Z');
  });

  it('bbox-filters out cameras outside the query area (point-in-bbox)', async () => {
    const adapter = new Dot511Adapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    // Tiny bbox around only camera 1001 (33.7756,-84.3963).
    const tinyBbox: readonly [number, number, number, number] = [-84.4, 33.77, -84.39, 33.78];
    const res = await adapter.fetchCameras({ bbox: tinyBbox });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(1);
    expect(res.value.data[0]?.id).toBe('dot511-1001');
  });

  it('returns an empty (never erroring) list when no camera falls inside the query bbox', async () => {
    const adapter = new Dot511Adapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const farAwayBbox: readonly [number, number, number, number] = [-122.5, 37.5, -122.0, 38.0]; // SF, not GA
    const res = await adapter.fetchCameras({ bbox: farAwayBbox });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(0);
  });

  it('reports a healthy (CLOSED) breaker before any failure', () => {
    const adapter = new Dot511Adapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('dot511');
    expect(adapter.coverage).toEqual({ kind: 'BBOX', bbox: [-85.61, 30.36, -80.84, 35.0] }); // the Georgia default host
  });
});

describe('makeDot511Adapter factory', () => {
  it('builds a CACHED adapter from env by default mode', () => {
    const res = makeDot511Adapter(mkEngine(new FakeCache()), {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
  });

  it('builds a MOCK adapter from env', () => {
    const res = makeDot511Adapter(mkEngine(new FakeCache()), { SOURCE_DOT511_MODE: 'MOCK' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
  });

  it('builds a LIVE adapter from env when DOT511_API_KEY is set', () => {
    const res = makeDot511Adapter(mkEngine(new FakeCache()), {
      SOURCE_DOT511_MODE: 'LIVE',
      DOT511_API_KEY: 'test-key',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('LIVE');
  });

  it('fails fast (CONFIG) when LIVE mode lacks DOT511_API_KEY', () => {
    const res = makeDot511Adapter(mkEngine(new FakeCache()), { SOURCE_DOT511_MODE: 'LIVE' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });
});

function seedFetchResult(fetchedAt: string): FetchResult<CameraFeed> {
  const entity: CameraFeed = {
    id: asId<CameraFeedId>('dot511-1001'),
    position: [-84.3963, 33.7756],
    kind: 'TRAFFIC_CCTV',
    title: 'I-75 NB at Downtown Connector',
    provider: '511 DOT (state traveler info)',
    viewUrl: 'https://511ga.org/map/Cctv/1001',
    license: 'State DOT open data (developer key)',
    isLive: true,
  };
  return {
    records: [
      {
        entity,
        provenance: {
          id: asId<SourceId>('55555555-5555-4555-8555-555555555555'),
          source: '511 DOT (state traveler info)',
          adapter: 'dot511',
          fetchedAt,
          license: 'State DOT open data (developer key)',
          mode: 'LIVE',
        },
      },
    ],
    freshness: fetchedAt,
    mode: 'LIVE',
    degraded: false,
  };
}

// ── The configured host's coverage (2026-09-14) ──────────────────────────────────────────────────────
describe('coverageForHost — a 511 host answers for one state, and is asked only about that state', () => {
  it('the Georgia default host covers Georgia; an operator-configured host keeps the US-wide declaration', () => {
    expect(coverageForHost(undefined)).toEqual({
      kind: 'BBOX',
      bbox: [-85.61, 30.36, -80.84, 35.0],
    });
    expect(coverageForHost('https://511ga.org/api/v2/get/cameras')).toEqual({
      kind: 'BBOX',
      bbox: [-85.61, 30.36, -80.84, 35.0],
    });
    expect(coverageForHost('https://511.example-state.gov/api/v2/get/cameras')).toEqual({
      kind: 'COUNTRIES',
      iso: ['US'],
    });
    expect(coverageForHost('not a url')).toEqual({ kind: 'COUNTRIES', iso: ['US'] });
  });

  it('a California query on the Georgia host sends no request and answers the empty list', async () => {
    const calls: string[] = [];
    const adapter = new Dot511Adapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { apiKey: 'k', url: 'https://511ga.org/api/v2/get/cameras' }),
    });
    // Any live fetch would be a real network call; the coverage gate must answer before one is made.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL) => {
      calls.push(String(input));
      return Promise.reject(new Error('unexpected network call'));
    }) as typeof fetch;
    try {
      const res = await adapter.fetchCameras({ bbox: [-124.5, 32.5, -114.1, 42.0] }); // California
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.value.data).toHaveLength(0);
      expect(calls).toHaveLength(0);
      // The framework path (the registry asks per region) is gated the same way.
      const ca: Region = { id: 'us-ca', bbox: [-124.5, 32.5, -114.1, 42.0], iso: 'US' };
      const framework = await adapter.fetch(ca);
      expect(framework.ok).toBe(false);
      if (!framework.ok) expect(framework.error.kind).toBe('NOT_COVERED');
      expect(calls).toHaveLength(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('a Georgia query still walks the ladder (MOCK fixture served inside the metro-Atlanta bbox)', async () => {
    const adapter = new Dot511Adapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetchCameras({ bbox: gaBbox });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.data.length).toBeGreaterThan(0);
  });
});
