// BEACON — EONET adapter tests (S2·Lane-A2; ADR-009/F1/F5/F6, Art. XVI). Mode-switch (mock/cached/live)
// each yields usable HazardGeometry with the correct mode/degraded/freshness; the live rung degrades to
// the recorded mock when upstream is unreachable (never a dead-end); provenance is stamped on every
// record; the outward HazardSourcePort clips to the caller's bbox; the factory is keyless and fail-fasts
// only on a genuinely invalid mode. NO LIVE NETWORK: the live rung points at a closed local port.
import { describe, it, expect } from 'vitest';
import { ok } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { HazardGeometry, HazardGeometryId, IncidentId, SourceId } from '@/domain/index.js';
import { asId, makeHazardGeometry } from '@/domain/index.js';
import type { CachePort } from '@/ports/infra.js';
import type { FetchResult, Region, SourceConfig } from '@/adapters/_shared/index.js';
import { RedundancyEngine, cacheKey } from '@/adapters/_shared/index.js';
import { EonetAdapter, makeEonetAdapter } from './eonet-adapter.js';

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

const region: Region = { id: 'world', bbox: [-180, -90, 180, 90] };
const mkEngine = (cache: CachePort) =>
  new RedundancyEngine({ cache, nowIso: () => '2026-07-05T22:00:00Z', idGen: () => 'sid-eonet' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});

describe('EonetAdapter mode-switch', () => {
  it('MOCK mode serves the recorded fixture as HazardGeometry (degraded, provenance MOCK)', async () => {
    const adapter = new EonetAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(5); // 6 recorded events, 1 out-of-scope severeStorms dropped
    const first = res.value.records[0];
    expect(first?.entity.kind).toBe('HOTSPOT');
    expect(first?.provenance.mode).toBe('MOCK');
    expect(first?.provenance.source).toBe('NASA EONET v3');
    expect(first?.provenance.license).toBe('NASA open / attribution requested');
    expect(first?.provenance.adapter).toBe('eonet');
  });

  it('CACHED mode serves last-known-good with degraded=true and preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    cache.store.set(cacheKey('eonet', region.id), seedFetchResult('2026-07-05T20:00:00Z'));
    const adapter = new EonetAdapter({ engine: mkEngine(cache), config: cfg('CACHED') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.degraded).toBe(true);
    expect(res.value.freshness).toBe('2026-07-05T20:00:00Z');
  });

  it('LIVE mode degrades to the recorded mock when upstream is unreachable (F5 → OP3)', async () => {
    const adapter = new EonetAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'http://127.0.0.1:9/api/v3/events' }),
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK'); // live down, cache empty → recorded mock, never a dead-end
    expect(res.value.records.length).toBeGreaterThan(0);
  });
});

describe('EonetAdapter outward HazardSourcePort', () => {
  it('fetchHazards returns a Sourced envelope clipped to the caller bbox', async () => {
    const adapter = new EonetAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const all = await adapter.fetchHazards({ bbox: [-180, -90, 180, 90] });
    expect(all.ok).toBe(true);
    if (!all.ok) return;
    expect(all.value.data).toHaveLength(5);
    expect(all.value.freshness.fetchedAt).toBe('2026-07-05T22:00:00Z');

    // California-only window: the recorded set has exactly two CA events (BUZZARD, GANN).
    const ca = await adapter.fetchHazards({ bbox: [-124.5, 32.5, -114, 42.1] });
    expect(ca.ok).toBe(true);
    if (!ca.ok) return;
    expect(ca.value.data.map((h) => h.id).sort()).toEqual([
      'eonet:EONET_22195',
      'eonet:EONET_22198',
    ]);
  });

  it('surfaces a domain NOT_FOUND when every rung is exhausted', async () => {
    const adapter = new EonetAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
      fixturesDir: '/nonexistent-eonet-fixtures',
    });
    const res = await adapter.fetchHazards({ bbox: region.bbox });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('NOT_FOUND');
  });

  it('reports a healthy (CLOSED) breaker before any failure', () => {
    const adapter = new EonetAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('eonet');
    expect(adapter.coverage).toEqual({ kind: 'GLOBAL' });
  });
});

describe('makeEonetAdapter factory', () => {
  it('defaults to CACHED when no mode is configured', () => {
    const res = makeEonetAdapter(mkEngine(new FakeCache()), {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
  });

  it('builds a LIVE adapter with NO key (EONET is keyless — a missing secret can never gate it)', () => {
    const res = makeEonetAdapter(mkEngine(new FakeCache()), { SOURCE_EONET_MODE: 'LIVE' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('LIVE');
  });

  it('fails fast (CONFIG) on an invalid mode', () => {
    const res = makeEonetAdapter(mkEngine(new FakeCache()), { SOURCE_EONET_MODE: 'sometimes' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });
});

function seedFetchResult(fetchedAt: string): FetchResult<HazardGeometry> {
  const entity = makeHazardGeometry({
    id: asId<HazardGeometryId>('eonet:EONET_1'),
    incidentId: asId<IncidentId>('eonet-unassigned'),
    sourceId: asId<SourceId>('sid-seed'),
    kind: 'HOTSPOT',
    geometry: { type: 'Point', coordinates: [-120.7, 38.1] },
    observedAt: fetchedAt,
  });
  return {
    records: [
      {
        entity,
        provenance: {
          id: asId<SourceId>('44444444-4444-4444-8444-444444444444'),
          source: 'NASA EONET v3',
          adapter: 'eonet',
          fetchedAt,
          license: 'NASA open / attribution requested',
          mode: 'LIVE',
        },
      },
    ],
    freshness: fetchedAt,
    mode: 'LIVE',
    degraded: false,
  };
}
