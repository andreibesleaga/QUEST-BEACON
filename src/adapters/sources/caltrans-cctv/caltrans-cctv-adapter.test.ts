// BEACON — Caltrans CCTV adapter tests (ADR-009/F1/F5/F6, CameraDirectoryPort P16). Each mode yields
// provenance-stamped CameraFeed rows (MOCK fixture: 11 usable of 12 recorded, 10 streaming Butte-County +
// 1 no-stream snapshot, the out-of-service row already dropped at the ACL); a bbox narrows the served set
// (the client-side stand-in for the server-side spatial query the per-district endpoint cannot do); the
// live rung degrades to the recorded mock when upstream is unreachable; COUNTRIES[US] coverage gates
// non-US regions; the outward CameraDirectoryPort adapts the ladder; the factory reads
// SOURCE_CALTRANS_CCTV_* env and defaults to LIVE (keyless — per the feature-plan source table). Fixed
// past clock, no network.
import { describe, it, expect } from 'vitest';
import { ok, asId, makeCameraFeed } from '@/domain/index.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { CameraFeed } from '@/domain/index.js';
import type { CameraFeedId, SourceId } from '@/domain/value-objects/ids.js';
import type { CachePort } from '@/ports/infra.js';
import type { FetchResult, Region, SourceConfig } from '@/adapters/_shared/index.js';
import { RedundancyEngine, cacheKey } from '@/adapters/_shared/index.js';
import { CaltransCctvAdapter, makeCaltransCctvAdapter } from './caltrans-cctv-adapter.js';

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

const NOW = '2026-07-05T22:00:00Z'; // safely past — Freshness rejects future fetchedAt
// Covers every position in the recorded fixture (Butte County Chico/Durham + the Sacramento snapshot row).
const WIDE_CA: Region = { id: 'ca-wide', bbox: [-122.0, 38.0, -121.0, 40.0], iso: 'US' };
// Covers ONLY the Butte-County streaming cameras — excludes the Sacramento no-stream snapshot row (id 130).
const BUTTE_ONLY: Region = { id: 'ca-butte', bbox: [-121.9, 39.6, -121.7, 39.8], iso: 'US' };
// A valid US bbox with no cameras in the fixture — exercises "covered but empty", not NOT_COVERED.
const EMPTY_US: Region = { id: 'us-empty', bbox: [-81.0, 25.0, -80.0, 26.0], iso: 'US' };

const mkEngine = (cache: CachePort) =>
  new RedundancyEngine({ cache, nowIso: () => NOW, idGen: () => 'sid-caltrans-cctv' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});

describe('CaltransCctvAdapter mode-switch', () => {
  it('MOCK mode serves the recorded fixture as CameraFeed, bbox-filtered (11 usable of 12 recorded rows)', async () => {
    const adapter = new CaltransCctvAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    const res = await adapter.fetch(WIDE_CA);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(11);
    const first = res.value.records[0];
    expect(first?.provenance.source).toBe('Caltrans District CCTV');
    expect(first?.provenance.adapter).toBe('caltrans-cctv');
    expect(first?.provenance.mode).toBe('MOCK');
    expect(first?.provenance.license).toBe('Caltrans open data');
    expect(res.value.records.every((r) => r.entity.kind === 'TRAFFIC_CCTV')).toBe(true);
    expect(res.value.records.every((r) => r.entity.provider === 'Caltrans')).toBe(true);
    expect(res.value.records.every((r) => r.entity.viewUrl.startsWith('https://'))).toBe(true);
  });

  it('a narrower bbox serves only the cameras within it (10 Butte-County streaming cameras)', async () => {
    const adapter = new CaltransCctvAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    const res = await adapter.fetch(BUTTE_ONLY);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.records).toHaveLength(10);
    expect(res.value.records.every((r) => r.entity.isLive)).toBe(true);
  });

  it('a covered-but-empty bbox yields zero records (never NOT_COVERED)', async () => {
    const adapter = new CaltransCctvAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    const res = await adapter.fetch(EMPTY_US);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.records).toHaveLength(0);
  });

  it('CACHED mode serves last-known-good with degraded=true and preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    cache.store.set(cacheKey('caltrans-cctv', WIDE_CA.id), seedFetchResult('2026-07-05T20:00:00Z'));
    const adapter = new CaltransCctvAdapter({ engine: mkEngine(cache), config: cfg('CACHED') });
    const res = await adapter.fetch(WIDE_CA);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.freshness).toBe('2026-07-05T20:00:00Z');
  });

  it('LIVE mode degrades to the recorded mock when upstream is unreachable (F5 → OP3)', async () => {
    const adapter = new CaltransCctvAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'http://127.0.0.1:9' }),
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(WIDE_CA);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.records.length).toBeGreaterThan(0);
  });

  it('COUNTRIES[US] coverage serves a US region', async () => {
    const adapter = new CaltransCctvAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    expect((await adapter.fetch(WIDE_CA)).ok).toBe(true);
  });

  it('COUNTRIES[US] coverage rejects a non-US region as NOT_COVERED', async () => {
    const adapter = new CaltransCctvAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    const res = await adapter.fetch({ id: 'ro', bbox: [20, 43, 30, 48], iso: 'RO' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('NOT_COVERED');
  });

  it('COUNTRIES[US] coverage rejects a region with no iso as NOT_COVERED', async () => {
    const adapter = new CaltransCctvAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    const res = await adapter.fetch({ id: 'unknown', bbox: WIDE_CA.bbox });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('NOT_COVERED');
  });
});

describe('CaltransCctvAdapter outward CameraDirectoryPort', () => {
  it('fetchCameras returns a Sourced envelope of CameraFeed with freshness (iso:US auto-injected)', async () => {
    const adapter = new CaltransCctvAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    const res = await adapter.fetchCameras({ bbox: WIDE_CA.bbox });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(11);
    expect(res.value.freshness.fetchedAt).toBe(NOW);
  });

  it('reports a healthy (CLOSED) breaker and correct identity', () => {
    const adapter = new CaltransCctvAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('caltrans-cctv');
    expect(adapter.coverage).toEqual({ kind: 'COUNTRIES', iso: ['US'] });
  });
});

describe('makeCaltransCctvAdapter factory', () => {
  it('defaults to LIVE mode when SOURCE_CALTRANS_CCTV_MODE is unset (keyless, per feature-plan source table)', () => {
    const res = makeCaltransCctvAdapter(mkEngine(new FakeCache()), {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('LIVE');
  });

  it('builds a MOCK adapter from env when explicitly requested', () => {
    const res = makeCaltransCctvAdapter(mkEngine(new FakeCache()), {
      SOURCE_CALTRANS_CCTV_MODE: 'MOCK',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
  });

  it('rejects an invalid mode (CONFIG) — fail-fast', () => {
    const res = makeCaltransCctvAdapter(mkEngine(new FakeCache()), {
      SOURCE_CALTRANS_CCTV_MODE: 'bogus',
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });
});

function seedFetchResult(fetchedAt: string): FetchResult<CameraFeed> {
  const entity = makeCameraFeed({
    id: asId<CameraFeedId>('caltrans-cctv:3:117'),
    position: [-121.834856, 39.725615],
    kind: 'TRAFFIC_CCTV',
    title: 'Hwy 32 at Main St Chico (Chico)',
    provider: 'Caltrans',
    viewUrl: 'https://wzmedia.dot.ca.gov/D3/32_Main_St_Chico_BUT32_EB.stream/playlist.m3u8',
    license: 'Caltrans open data',
    isLive: true,
  });
  return {
    records: [
      {
        entity,
        provenance: {
          id: asId<SourceId>('77777777-7777-4777-8777-777777777777'),
          source: 'Caltrans District CCTV',
          adapter: 'caltrans-cctv',
          fetchedAt,
          license: 'Caltrans open data',
          mode: 'LIVE',
        },
      },
    ],
    freshness: fetchedAt,
    mode: 'LIVE',
    degraded: false,
  };
}
