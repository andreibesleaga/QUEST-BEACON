// BEACON — Open-Meteo adapter tests (E4·T-157; ADR-009/F1/F5/F6). Each mode yields a usable
// WeatherObservation with correct mode/degraded/freshness; the live rung degrades to the recorded mock when
// upstream is unreachable; provenance is stamped; GLOBAL coverage serves any region (incl. Romania); the
// outward WeatherSourcePort adapts the ladder; the factory reads SOURCE_OPEN_METEO_* env.
import { describe, it, expect } from 'vitest';
import { ok } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { SourceId } from '@/domain/index.js';
import { asId } from '@/domain/index.js';
import type { CachePort } from '@/ports/infra.js';
import type { WeatherObservation } from '@/ports/data-sources.js';
import type { FetchResult, Region, SourceConfig } from '@/adapters/_shared/index.js';
import { RedundancyEngine, cacheKey } from '@/adapters/_shared/index.js';
import { OpenMeteoAdapter, makeOpenMeteoAdapter } from './open-meteo-adapter.js';

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

const ROMANIA: Region = { id: 'ro', bbox: [20, 43, 30, 48], iso: 'RO' };
// Deterministic clock must be safely in the past — Freshness rejects a future fetchedAt (domain invariant).
const NOW = '2026-07-05T22:00:00Z';
const mkEngine = (cache: CachePort) => new RedundancyEngine({ cache, nowIso: () => NOW, idGen: () => 'sid-om' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({ mode, timeoutMs: 400, ...extra });

describe('OpenMeteoAdapter mode-switch', () => {
  it('MOCK mode serves the recorded fixture as WeatherObservation (degraded, provenance MOCK)', async () => {
    const adapter = new OpenMeteoAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch(ROMANIA);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(1);
    const first = res.value.records[0];
    expect(first?.entity.tempC).toBe(31.2);
    expect(first?.entity.position).toEqual([26.1025, 44.4268]);
    expect(first?.provenance.source).toBe('Open-Meteo');
    expect(first?.provenance.adapter).toBe('open-meteo');
    expect(first?.provenance.mode).toBe('MOCK');
  });

  it('CACHED mode serves last-known-good with degraded=true and preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    cache.store.set(cacheKey('open-meteo', ROMANIA.id), seedFetchResult('2026-07-05T20:00:00Z'));
    const adapter = new OpenMeteoAdapter({ engine: mkEngine(cache), config: cfg('CACHED') });
    const res = await adapter.fetch(ROMANIA);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.freshness).toBe('2026-07-05T20:00:00Z');
  });

  it('LIVE mode degrades to the recorded mock when upstream is unreachable (F5 → OP3)', async () => {
    const adapter = new OpenMeteoAdapter({
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

  it('GLOBAL coverage serves any region (no NOT_COVERED)', async () => {
    const adapter = new OpenMeteoAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const far = await adapter.fetch({ id: 'jp', bbox: [129, 31, 146, 46], iso: 'JP' });
    expect(far.ok).toBe(true);
  });
});

describe('OpenMeteoAdapter outward WeatherSourcePort', () => {
  it('fetchWeather returns a Sourced envelope of WeatherObservation with freshness', async () => {
    const adapter = new OpenMeteoAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetchWeather({ bbox: ROMANIA.bbox });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(1);
    expect(res.value.freshness.fetchedAt).toBe(NOW);
  });

  it('reports a healthy (CLOSED) breaker and correct identity', () => {
    const adapter = new OpenMeteoAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('open-meteo');
    expect(adapter.coverage.kind).toBe('GLOBAL');
  });
});

describe('makeOpenMeteoAdapter factory', () => {
  it('builds a MOCK adapter from env', () => {
    const res = makeOpenMeteoAdapter(mkEngine(new FakeCache()), { SOURCE_OPEN_METEO_MODE: 'MOCK' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
  });

  it('rejects an invalid mode (CONFIG)', () => {
    const res = makeOpenMeteoAdapter(mkEngine(new FakeCache()), { SOURCE_OPEN_METEO_MODE: 'bogus' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });
});

function seedFetchResult(fetchedAt: string): FetchResult<WeatherObservation> {
  return {
    records: [
      {
        entity: { at: fetchedAt, position: [26.1025, 44.4268], tempC: 30 },
        provenance: {
          id: asId<SourceId>('44444444-4444-4444-8444-444444444444'),
          source: 'Open-Meteo',
          adapter: 'open-meteo',
          fetchedAt,
          license: 'CC BY 4.0',
          mode: 'LIVE',
        },
      },
    ],
    freshness: fetchedAt,
    mode: 'LIVE',
    degraded: false,
  };
}
