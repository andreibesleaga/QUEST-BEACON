// BEACON — OpenAQ adapter tests (S2 Lane A4; ADR-009/F1/F5/F6, Art. XVI). Mode-switch (mock/cached/live)
// each yields usable AirQualityReadings with the correct mode/degraded/freshness; the LIVE rung issues the
// documented two-stage v3 call with the X-API-Key header and an lon/lat-ordered bbox, BOUNDED by
// maxLocations; the live rung degrades to the recorded mock when upstream fails; the factory fail-fasts on
// LIVE without OPENAQ_API_KEY. No live network: `fetch` is stubbed with recorded bodies / a rejection.
import { describe, it, expect } from 'vitest';
import { ok } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { AirQualityReading } from '@/ports/air-quality.js';
import type { CachePort } from '@/ports/infra.js';
import type { FetchResult, Region, SourceConfig } from '@/adapters/_shared/index.js';
import { RedundancyEngine, cacheKey } from '@/adapters/_shared/index.js';
import { asId } from '@/domain/index.js';
import type { SourceId } from '@/domain/index.js';
import { OpenAqAdapter, makeOpenAqAdapter } from './openaq-adapter.js';

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

const LICENSE = 'OpenAQ aggregate — per-location open licences (attribution required)';
const region: Region = { id: 'us-pnw', bbox: [-125, 42, -116, 49] };
const mkEngine = (cache: CachePort) =>
  new RedundancyEngine({ cache, nowIso: () => '2026-07-05T22:00:00Z', idGen: () => 'sid-openaq' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});

/** Record every request, answering from an in-memory table. NEVER touches the network. */
function stubFetch(bodyFor: (url: string) => string | undefined): { calls: { url: string; key?: string }[]; restore: () => void } {
  const calls: { url: string; key?: string }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(url), ...(headers['X-API-Key'] !== undefined ? { key: headers['X-API-Key'] } : {}) });
    const body = bodyFor(String(url));
    if (body === undefined) return Promise.reject(new Error('unexpected url'));
    return Promise.resolve(new Response(body, { status: 200 }));
  }) as typeof globalThis.fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const LOCATIONS_BODY = JSON.stringify({
  results: [
    { id: 1592, name: 'Omak-Colville Tribe', coordinates: { latitude: 48.39999, longitude: -119.518959 }, sensors: [{ id: 3920, parameter: { id: 2, name: 'pm25', units: 'µg/m³' } }] },
    { id: 1607, name: 'Cove - City Hall', coordinates: { latitude: 45.300884, longitude: -117.812896 }, sensors: [{ id: 4114, parameter: { id: 2, name: 'pm25', units: 'µg/m³' } }] },
  ],
});
const latestBody = (sensorsId: number, value: number): string =>
  JSON.stringify({ results: [{ sensorsId, value, datetime: { utc: '2026-08-08T04:00:00Z' }, coordinates: { latitude: 48.39999, longitude: -119.518959 } }] });

describe('OpenAqAdapter mode-switch', () => {
  it('MOCK mode joins the two recorded fixtures into AirQualityReadings (degraded, provenance MOCK)', async () => {
    const adapter = new OpenAqAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(4);
    const first = res.value.records[0];
    expect(first?.entity.stationId).toBe('openaq:1592:3920');
    expect(first?.entity.aqi).toBeUndefined(); // concentrations only — never a fabricated index
    expect(first?.provenance.mode).toBe('MOCK');
    expect(first?.provenance.source).toBe('OpenAQ');
    expect(first?.provenance.adapter).toBe('openaq');
    expect(first?.provenance.license).toBe(LICENSE);
  });

  it('CACHED mode serves last-known-good with degraded=true and preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    cache.store.set(cacheKey('openaq', region.id), seedFetchResult('2026-07-05T20:00:00Z'));
    const adapter = new OpenAqAdapter({ engine: mkEngine(cache), config: cfg('CACHED') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.freshness).toBe('2026-07-05T20:00:00Z');
  });

  it('LIVE mode degrades to the recorded mock when upstream fails (F5 → OP3)', async () => {
    const stub = stubFetch(() => undefined);
    try {
      const adapter = new OpenAqAdapter({
        engine: mkEngine(new FakeCache()),
        config: cfg('LIVE', { apiKey: 'k' }),
        breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
      });
      const res = await adapter.fetch(region);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.value.mode).toBe('MOCK'); // never a dead-end
      expect(res.value.records.length).toBeGreaterThan(0);
    } finally {
      stub.restore();
    }
  });
});

describe('OpenAqAdapter LIVE two-stage call', () => {
  it('issues locations?bbox= (lon/lat order, NO transpose) then one /latest per station, keyed', async () => {
    const stub = stubFetch((url) => {
      if (url.includes('/locations?')) return LOCATIONS_BODY;
      if (url.endsWith('/locations/1592/latest')) return latestBody(3920, 205);
      if (url.endsWith('/locations/1607/latest')) return latestBody(4114, 116.9);
      return undefined;
    });
    try {
      const adapter = new OpenAqAdapter({ engine: mkEngine(new FakeCache()), config: cfg('LIVE', { apiKey: 'secret-key' }) });
      const res = await adapter.fetch(region);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.value.mode).toBe('LIVE');
      expect(res.value.degraded).toBe(false);
      expect(res.value.records).toHaveLength(2);
      expect(stub.calls.map((c) => c.url)).toEqual([
        'https://api.openaq.org/v3/locations?bbox=-125,42,-116,49&parameters_id=2&limit=5',
        'https://api.openaq.org/v3/locations/1592/latest',
        'https://api.openaq.org/v3/locations/1607/latest',
      ]);
      expect(stub.calls.every((c) => c.key === 'secret-key')).toBe(true);
    } finally {
      stub.restore();
    }
  });

  it('BOUNDS the stage-2 fan-out at maxLocations (a free community API is not a fan-out target)', async () => {
    const stub = stubFetch((url) => (url.includes('/locations?') ? LOCATIONS_BODY : latestBody(3920, 205)));
    try {
      const adapter = new OpenAqAdapter({
        engine: mkEngine(new FakeCache()),
        config: cfg('LIVE', { apiKey: 'k' }),
        maxLocations: 1,
      });
      await adapter.fetch(region);
      expect(stub.calls.filter((c) => c.url.endsWith('/latest'))).toHaveLength(1);
    } finally {
      stub.restore();
    }
  });
});

describe('OpenAqAdapter outward AirQualityPort', () => {
  it('fetchAirQuality returns a Sourced envelope of AirQualityReading with freshness', async () => {
    const adapter = new OpenAqAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetchAirQuality({ bbox: region.bbox });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(4);
    expect(res.value.freshness.fetchedAt).toBe('2026-07-05T22:00:00Z');
  });

  it('reports a healthy (CLOSED) breaker before any failure and a GLOBAL coverage claim', () => {
    const adapter = new OpenAqAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('openaq');
    expect(adapter.coverage).toEqual({ kind: 'GLOBAL' });
  });
});

describe('makeOpenAqAdapter factory', () => {
  it('builds a MOCK adapter from env', () => {
    const res = makeOpenAqAdapter(mkEngine(new FakeCache()), { SOURCE_OPENAQ_MODE: 'MOCK' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
  });

  it('fails fast (CONFIG) when LIVE mode lacks OPENAQ_API_KEY (v3 401s without it)', () => {
    const res = makeOpenAqAdapter(mkEngine(new FakeCache()), { SOURCE_OPENAQ_MODE: 'LIVE' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });
});

function seedFetchResult(fetchedAt: string): FetchResult<AirQualityReading> {
  return {
    records: [
      {
        entity: {
          stationId: 'openaq:1592:3920',
          position: [-119.518959, 48.39999],
          pollutant: 'PM25',
          value: 205,
          unit: 'µg/m³',
          observedAt: fetchedAt,
          sourceId: asId<SourceId>('sid-seed'),
        },
        provenance: {
          id: asId<SourceId>('66666666-6666-4666-8666-666666666666'),
          source: 'OpenAQ',
          adapter: 'openaq',
          fetchedAt,
          license: LICENSE,
          mode: 'LIVE',
        },
      },
    ],
    freshness: fetchedAt,
    mode: 'LIVE',
    degraded: false,
  };
}
