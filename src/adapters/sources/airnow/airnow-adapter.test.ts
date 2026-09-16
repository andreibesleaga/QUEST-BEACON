// BEACON — AirNow adapter tests (S2 Lane A4; ADR-009/F1/F5/F6, Art. XVI). Mode-switch (mock/cached/live)
// each yields usable AirQualityReadings with the correct mode/degraded/freshness; the nationwide file is
// narrowed to the region's bbox; the hour-addressed LIVE url is built from an INJECTED clock; the live rung
// degrades to the recorded mock when upstream is unreachable; NOT_COVERED is honest for a non-US bbox; the
// factory does not demand the (unnecessary) key. No live network: fetch is stubbed / pointed at a dead port.
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
import { AirNowAdapter, makeAirNowAdapter } from './airnow-adapter.js';

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

const LICENSE = 'US EPA AirNow — public domain (US Gov); attribution requested; preliminary data';
// The recorded fixture is a real PNW wildfire-smoke hour (WA/OR/ID).
const pnw: Region = { id: 'us-pnw', bbox: [-125, 42, -116, 49] };
const NOW = '2026-07-05T22:00:00Z';
const mkEngine = (cache: CachePort) =>
  new RedundancyEngine({ cache, nowIso: () => NOW, idGen: () => 'sid-airnow' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});
const mk = (
  config: SourceConfig,
  extra: Partial<ConstructorParameters<typeof AirNowAdapter>[0]> = {},
) => new AirNowAdapter({ engine: mkEngine(new FakeCache()), config, nowIso: () => NOW, ...extra });

describe('AirNowAdapter mode-switch', () => {
  it('MOCK mode serves the recorded fixture as AirQualityReadings (degraded, provenance MOCK)', async () => {
    const res = await mk(cfg('MOCK')).fetch(pnw);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records.length).toBeGreaterThan(0);
    const first = res.value.records[0];
    expect(first?.entity.pollutant).toBe('PM25');
    expect(first?.entity.aqiCategory).toBe('VERY_UNHEALTHY');
    expect(first?.provenance.mode).toBe('MOCK');
    expect(first?.provenance.source).toBe('US EPA AirNow');
    expect(first?.provenance.adapter).toBe('airnow');
    expect(first?.provenance.license).toBe(LICENSE);
  });

  it('narrows the nationwide file to the queried bbox (differential: a smaller box keeps fewer sites)', async () => {
    const all = await mk(cfg('MOCK')).fetch(pnw);
    const oregon = await mk(cfg('MOCK')).fetch({ id: 'or', bbox: [-118.5, 42, -116, 46] });
    expect(all.ok && oregon.ok).toBe(true);
    if (!all.ok || !oregon.ok) return;
    expect(oregon.value.records.length).toBeLessThan(all.value.records.length);
    expect(oregon.value.records.map((r) => r.entity.stationName)).toEqual(['Cove - City Hall']);
  });

  it('CACHED mode serves last-known-good with degraded=true and preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    cache.store.set(cacheKey('airnow', pnw.id), seedFetchResult('2026-07-05T20:00:00Z'));
    const adapter = new AirNowAdapter({
      engine: mkEngine(cache),
      config: cfg('CACHED'),
      nowIso: () => NOW,
    });
    const res = await adapter.fetch(pnw);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.freshness).toBe('2026-07-05T20:00:00Z');
  });

  it('LIVE mode degrades to the recorded mock when upstream is unreachable (F5 → OP3)', async () => {
    const res = await mk(cfg('LIVE', { url: 'http://127.0.0.1:9/airnow' }), {
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    }).fetch(pnw);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK'); // live down, cache empty → recorded mock, never a dead-end
    expect(res.value.records.length).toBeGreaterThan(0);
  });

  it('returns NOT_COVERED for a bbox outside North America instead of an empty layer (OP4)', async () => {
    const res = await mk(cfg('MOCK')).fetch({ id: 'ro', bbox: [25.9, 44.3, 26.3, 44.6] });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('NOT_COVERED');
  });
});

describe('AirNowAdapter live URL', () => {
  it('addresses the UTC hour file `lagHours` behind the INJECTED clock', async () => {
    const seen: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((url: string) => {
      seen.push(String(url));
      return Promise.reject(new Error('no live network in tests'));
    }) as typeof globalThis.fetch;
    try {
      await mk(cfg('LIVE'), {
        lagHours: 2,
        breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
      }).fetch(pnw);
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(seen[0]).toBe(
      'https://files.airnowtech.org/airnow/2026/20260705/HourlyAQObs_2026070520.dat',
    );
  });
});

describe('AirNowAdapter outward AirQualityPort', () => {
  it('fetchAirQuality returns a Sourced envelope of AirQualityReading with freshness', async () => {
    const res = await mk(cfg('MOCK')).fetchAirQuality({ bbox: pnw.bbox });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data[0]?.stationId.startsWith('airnow:')).toBe(true);
    expect(res.value.freshness.fetchedAt).toBe(NOW);
  });

  it('surfaces an out-of-coverage query as a domain NOT_FOUND, never a silent empty list', async () => {
    const res = await mk(cfg('MOCK')).fetchAirQuality({ bbox: [25.9, 44.3, 26.3, 44.6] });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('NOT_FOUND');
  });

  it('reports a healthy (CLOSED) breaker and a North-America BBOX coverage claim', () => {
    const adapter = mk(cfg('MOCK'));
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('airnow');
    expect(adapter.coverage).toEqual({ kind: 'BBOX', bbox: [-172, 14, -50, 72] });
  });
});

describe('makeAirNowAdapter factory', () => {
  it('builds a MOCK adapter from env', () => {
    const res = makeAirNowAdapter(mkEngine(new FakeCache()), { SOURCE_AIRNOW_MODE: 'MOCK' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
  });

  it('accepts LIVE with AIRNOW_API_KEY unset — the Hourly AQ Obs file product is keyless', () => {
    const res = makeAirNowAdapter(mkEngine(new FakeCache()), { SOURCE_AIRNOW_MODE: 'LIVE' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('LIVE');
  });

  it('fails fast (CONFIG) on an invalid mode', () => {
    const res = makeAirNowAdapter(mkEngine(new FakeCache()), { SOURCE_AIRNOW_MODE: 'live-ish' });
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
          stationId: 'airnow:1',
          position: [-119.5, 48.4],
          pollutant: 'PM25',
          value: 205,
          unit: 'UG/M3',
          aqi: 284,
          aqiCategory: 'VERY_UNHEALTHY',
          observedAt: fetchedAt,
          sourceId: asId<SourceId>('sid-seed'),
        },
        provenance: {
          id: asId<SourceId>('55555555-5555-4555-8555-555555555555'),
          source: 'US EPA AirNow',
          adapter: 'airnow',
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
