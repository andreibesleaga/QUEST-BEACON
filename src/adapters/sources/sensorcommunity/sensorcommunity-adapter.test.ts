// BEACON — Sensor.Community adapter tests (S2 Lane A4; ADR-009/F1/F5/F6, Art. XVI). Mode-switch
// (mock/cached/live) each yields usable AirQualityReadings with the correct mode/degraded/freshness; the
// live rung degrades to the recorded mock when upstream is unreachable; the ODbL attribution rides on
// every record's provenance; the outward AirQualityPort adapts the ladder to the Sourced envelope; the
// keyless factory never demands a key. No live network: the live rung is pointed at a closed local port.
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
import { SensorCommunityAdapter, makeSensorCommunityAdapter } from './sensorcommunity-adapter.js';

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

const LICENSE = 'ODbL 1.0 (database) / DbCL 1.0 (contents) — "Data: Sensor.Community contributors"';
const region: Region = { id: 'ro', bbox: [25.9, 44.3, 26.3, 44.6] };
const mkEngine = (cache: CachePort) =>
  new RedundancyEngine({ cache, nowIso: () => '2026-07-05T22:00:00Z', idGen: () => 'sid-sc' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});

describe('SensorCommunityAdapter mode-switch', () => {
  it('MOCK mode serves the recorded fixture as AirQualityReadings (degraded, provenance MOCK + ODbL)', async () => {
    const adapter = new SensorCommunityAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records.length).toBeGreaterThan(0);
    const first = res.value.records[0];
    expect(first?.entity.unit).toBe('µg/m³');
    expect(first?.provenance.mode).toBe('MOCK');
    expect(first?.provenance.source).toBe('Sensor.Community');
    expect(first?.provenance.adapter).toBe('sensorcommunity');
    // ODbL §4.3: the attribution notice is a licence OBLIGATION, so it must ride on the data itself.
    expect(first?.provenance.license).toBe(LICENSE);
  });

  it('counts the channels its lenient ACL had to skip in the recorded fixture (data-hygiene trace)', async () => {
    const adapter = new SensorCommunityAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    await adapter.fetch(region);
    // The recorded fixture deliberately includes a real temperature/pressure/humidity-only station.
    expect(adapter.skippedLastParse).toBeGreaterThan(0);
  });

  it('CACHED mode serves last-known-good with degraded=true and preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    cache.store.set(
      cacheKey('sensorcommunity', region.id),
      seedFetchResult('2026-07-05T20:00:00Z'),
    );
    const adapter = new SensorCommunityAdapter({ engine: mkEngine(cache), config: cfg('CACHED') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.degraded).toBe(true);
    expect(res.value.freshness).toBe('2026-07-05T20:00:00Z');
  });

  it('LIVE mode degrades to the recorded mock when upstream is unreachable (F5 → OP3)', async () => {
    const adapter = new SensorCommunityAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'http://127.0.0.1:9/airrohr/v1/filter' }),
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK'); // live down, cache empty → recorded mock, never a dead-end
    expect(res.value.records.length).toBeGreaterThan(0);
  });
});

describe('SensorCommunityAdapter live URL', () => {
  it("transposes BEACON's [west,south,east,north] into the documented LAT-FIRST box= corners", async () => {
    const seen: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((url: string) => {
      seen.push(String(url));
      return Promise.reject(new Error('no live network in tests'));
    }) as typeof globalThis.fetch;
    try {
      const adapter = new SensorCommunityAdapter({
        engine: mkEngine(new FakeCache()),
        config: cfg('LIVE'),
        breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
      });
      await adapter.fetch(region);
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(seen[0]).toBe('https://data.sensor.community/airrohr/v1/filter/box=44.3,25.9,44.6,26.3');
  });
});

describe('SensorCommunityAdapter outward AirQualityPort', () => {
  it('fetchAirQuality returns a Sourced envelope of AirQualityReading with freshness', async () => {
    const adapter = new SensorCommunityAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    const res = await adapter.fetchAirQuality({ bbox: region.bbox });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data.length).toBeGreaterThan(0);
    expect(res.value.data[0]?.stationId.startsWith('sensorcommunity:')).toBe(true);
    expect(res.value.freshness.fetchedAt).toBe('2026-07-05T22:00:00Z');
  });

  it('reports a healthy (CLOSED) breaker before any failure and a GLOBAL coverage claim', () => {
    const adapter = new SensorCommunityAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('sensorcommunity');
    expect(adapter.coverage).toEqual({ kind: 'GLOBAL' });
  });
});

describe('makeSensorCommunityAdapter factory', () => {
  it('builds a MOCK adapter from env', () => {
    const res = makeSensorCommunityAdapter(mkEngine(new FakeCache()), {
      SOURCE_SENSORCOMMUNITY_MODE: 'MOCK',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
  });

  it('accepts LIVE with NO key at all (the network is keyless — no fail-fast)', () => {
    const res = makeSensorCommunityAdapter(mkEngine(new FakeCache()), {
      SOURCE_SENSORCOMMUNITY_MODE: 'LIVE',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('LIVE');
  });

  it('fails fast (CONFIG) on an invalid mode', () => {
    const res = makeSensorCommunityAdapter(mkEngine(new FakeCache()), {
      SOURCE_SENSORCOMMUNITY_MODE: 'SOMETIMES',
    });
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
          stationId: 'sensorcommunity:1',
          position: [26.1, 44.4],
          pollutant: 'PM25',
          value: 9,
          unit: 'µg/m³',
          observedAt: fetchedAt,
          sourceId: asId<SourceId>('sid-seed'),
        },
        provenance: {
          id: asId<SourceId>('44444444-4444-4444-8444-444444444444'),
          source: 'Sensor.Community',
          adapter: 'sensorcommunity',
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
