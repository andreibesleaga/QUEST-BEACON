// BEACON — CEMS Rapid Mapping adapter tests (S2·Lane-A2; ADR-009/F1/F5/F6, Art. XVI). Mode-switch
// (mock/cached/live) each yields usable HazardGeometry with the correct mode/degraded/freshness; the live
// rung degrades to the recorded mock when upstream is unreachable (never a dead-end); provenance is
// stamped on every record; the outward HazardSourcePort clips to the caller's bbox; the factory is
// keyless. NO LIVE NETWORK: the live rung points at a closed local port.
import { describe, it, expect } from 'vitest';
import { ok } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { HazardGeometry, HazardGeometryId, IncidentId, SourceId } from '@/domain/index.js';
import { asId, makeHazardGeometry } from '@/domain/index.js';
import type { CachePort } from '@/ports/infra.js';
import type { FetchResult, Region, SourceConfig } from '@/adapters/_shared/index.js';
import { RedundancyEngine, cacheKey } from '@/adapters/_shared/index.js';
import { CemsRmAdapter, makeCemsRmAdapter } from './cemsrm-adapter.js';

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
  new RedundancyEngine({ cache, nowIso: () => '2026-07-05T22:00:00Z', idGen: () => 'sid-cems' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});

describe('CemsRmAdapter mode-switch', () => {
  it('MOCK mode serves the recorded page as HazardGeometry (degraded, provenance MOCK)', async () => {
    const adapter = new CemsRmAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(19); // 20 recorded rows, 1 out-of-scope (Volcanic activity)
    const first = res.value.records[0];
    expect(first?.entity.kind).toBe('HOTSPOT');
    expect(first?.provenance.mode).toBe('MOCK');
    expect(first?.provenance.source).toBe('Copernicus EMS Rapid Mapping');
    expect(first?.provenance.license).toBe('Copernicus/JRC open (attribution)');
    expect(first?.provenance.adapter).toBe('cemsrm');
  });

  it('CACHED mode serves last-known-good with degraded=true and preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    cache.store.set(cacheKey('cemsrm', region.id), seedFetchResult('2026-07-05T20:00:00Z'));
    const adapter = new CemsRmAdapter({ engine: mkEngine(cache), config: cfg('CACHED') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.degraded).toBe(true);
    expect(res.value.freshness).toBe('2026-07-05T20:00:00Z');
  });

  it('LIVE mode degrades to the recorded mock when upstream is unreachable (F5 → OP3)', async () => {
    const adapter = new CemsRmAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'http://127.0.0.1:9/backend/dashboard-api/public-activations-info/' }),
      breaker: { failureThreshold: 4, cooldownSec: 300, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.records.length).toBeGreaterThan(0);
  });
});

describe('CemsRmAdapter outward HazardSourcePort', () => {
  it('fetchHazards returns a Sourced envelope clipped to the caller bbox', async () => {
    const adapter = new CemsRmAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const all = await adapter.fetchHazards({ bbox: region.bbox });
    expect(all.ok).toBe(true);
    if (!all.ok) return;
    expect(all.value.data).toHaveLength(19);
    expect(all.value.freshness.fetchedAt).toBe('2026-07-05T22:00:00Z');

    // Greece window: the recorded page carries exactly three GR wildfire activations.
    const gr = await adapter.fetchHazards({ bbox: [19.3, 34.8, 28.3, 41.8] });
    expect(gr.ok).toBe(true);
    if (!gr.ok) return;
    expect(gr.value.data.map((h) => h.id).sort()).toEqual([
      'cemsrm:EMSR907',
      'cemsrm:EMSR909',
      'cemsrm:EMSR910',
    ]);
  });

  it('surfaces a domain NOT_FOUND when every rung is exhausted', async () => {
    const adapter = new CemsRmAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
      fixturesDir: '/nonexistent-cemsrm-fixtures',
    });
    const res = await adapter.fetchHazards({ bbox: region.bbox });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('NOT_FOUND');
  });

  it('reports a healthy (CLOSED) breaker before any failure', () => {
    const adapter = new CemsRmAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('cemsrm');
    expect(adapter.coverage).toEqual({ kind: 'GLOBAL' });
  });
});

describe('makeCemsRmAdapter factory', () => {
  it('defaults to CACHED when no mode is configured (slow feed — LIVE buys little)', () => {
    const res = makeCemsRmAdapter(mkEngine(new FakeCache()), {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
  });

  it('builds a LIVE adapter with NO key (the route is keyless)', () => {
    const res = makeCemsRmAdapter(mkEngine(new FakeCache()), { SOURCE_CEMSRM_MODE: 'LIVE' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('LIVE');
  });

  it('fails fast (CONFIG) on an invalid mode', () => {
    const res = makeCemsRmAdapter(mkEngine(new FakeCache()), { SOURCE_CEMSRM_MODE: 'occasionally' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });
});

function seedFetchResult(fetchedAt: string): FetchResult<HazardGeometry> {
  const entity = makeHazardGeometry({
    id: asId<HazardGeometryId>('cemsrm:EMSR758'),
    incidentId: asId<IncidentId>('cemsrm-unassigned'),
    sourceId: asId<SourceId>('sid-seed'),
    kind: 'FLOOD_REACH',
    geometry: { type: 'Point', coordinates: [27.9, 45.9] },
    observedAt: fetchedAt,
  });
  return {
    records: [
      {
        entity,
        provenance: {
          id: asId<SourceId>('55555555-5555-4555-8555-555555555555'),
          source: 'Copernicus EMS Rapid Mapping',
          adapter: 'cemsrm',
          fetchedAt,
          license: 'Copernicus/JRC open (attribution)',
          mode: 'LIVE',
        },
      },
    ],
    freshness: fetchedAt,
    mode: 'LIVE',
    degraded: false,
  };
}
