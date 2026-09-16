// BEACON — NIFC adapter tests (E4·T-17x; DATA_SOURCE_VERIFICATION §1/ADR-009/F1/F5/F6). Mode-switch
// (mock/cached/live) each yields usable PERIMETER HazardGeometry with the correct mode/degraded/freshness;
// the live rung degrades to the recorded mock when upstream is unreachable; COUNTRIES[US] coverage gates
// non-US regions (unlike FIRMS/GDACS's GLOBAL); the outward HazardSourcePort.fetchHazards adapts the
// ladder to the Sourced envelope; the factory defaults to CACHED and fails fast on a bad mode.
import { describe, it, expect } from 'vitest';
import { ok } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { HazardGeometry, HazardGeometryId, IncidentId, SourceId } from '@/domain/index.js';
import { asId, makeHazardGeometry } from '@/domain/index.js';
import type { CachePort } from '@/ports/infra.js';
import type { FetchResult, Region, SourceConfig } from '@/adapters/_shared/index.js';
import { RedundancyEngine, cacheKey } from '@/adapters/_shared/index.js';
import { NifcAdapter, makeNifcAdapter } from './nifc-adapter.js';

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
const CA: Region = { id: 'ca', bbox: [-124, 32, -114, 42], iso: 'US' };
const mkEngine = (cache: CachePort) =>
  new RedundancyEngine({ cache, nowIso: () => NOW, idGen: () => 'sid-nifc' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});

describe('NifcAdapter mode-switch', () => {
  it('MOCK mode serves the recorded fixture as PERIMETER HazardGeometry (degraded, provenance MOCK)', async () => {
    const adapter = new NifcAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch(CA);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(2);
    const first = res.value.records[0];
    expect(first?.entity.kind).toBe('PERIMETER');
    expect(first?.provenance.mode).toBe('MOCK');
    expect(first?.provenance.source).toBe('NIFC/WFIGS');
    expect(first?.provenance.license).toBe('US public domain (NIFC/WFIGS)');
    expect(first?.provenance.adapter).toBe('nifc');
  });

  it('CACHED mode serves last-known-good with degraded=true and preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    cache.store.set(cacheKey('nifc', CA.id), seedFetchResult('2026-07-05T20:00:00Z'));
    const adapter = new NifcAdapter({ engine: mkEngine(cache), config: cfg('CACHED') });
    const res = await adapter.fetch(CA);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.degraded).toBe(true);
    expect(res.value.freshness).toBe('2026-07-05T20:00:00Z');
  });

  it('CACHED mode with an empty cache degrades to the recorded mock (never a dead-end)', async () => {
    const adapter = new NifcAdapter({ engine: mkEngine(new FakeCache()), config: cfg('CACHED') });
    const res = await adapter.fetch(CA);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.records.length).toBeGreaterThan(0);
  });

  it('LIVE mode degrades to the recorded mock when upstream is unreachable (F5 → OP3)', async () => {
    const adapter = new NifcAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'http://127.0.0.1:9/query' }),
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(CA);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK'); // live down, cache empty → recorded mock, never a dead-end
    expect(res.value.records.length).toBeGreaterThan(0);
  });

  it('NOT_COVERED for a non-US region (COUNTRIES[US] coverage gate, unlike FIRMS/GDACS GLOBAL)', async () => {
    const adapter = new NifcAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const romania: Region = { id: 'ro', bbox: [20, 43, 30, 48], iso: 'RO' };
    const res = await adapter.fetch(romania);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('NOT_COVERED');
  });

  it('NOT_COVERED for a region with no iso set', async () => {
    const adapter = new NifcAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch({ id: 'anon', bbox: [-124, 32, -114, 42] });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('NOT_COVERED');
  });
});

describe('NifcAdapter outward HazardSourcePort', () => {
  it('fetchHazards returns a Sourced envelope of PERIMETER HazardGeometry with freshness', async () => {
    const adapter = new NifcAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetchHazards({ bbox: CA.bbox });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(2);
    expect(res.value.data[0]?.kind).toBe('PERIMETER');
    expect(res.value.freshness.fetchedAt).toBe(NOW);
  });

  it('reports a healthy (CLOSED) breaker before any failure, and correct identity/coverage', () => {
    const adapter = new NifcAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('nifc');
    expect(adapter.coverage).toEqual({ kind: 'COUNTRIES', iso: ['US'] });
  });
});

describe('makeNifcAdapter factory', () => {
  it('defaults to CACHED mode when SOURCE_NIFC_MODE is unset', () => {
    const res = makeNifcAdapter(mkEngine(new FakeCache()), {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
  });

  it('builds a MOCK adapter from env', () => {
    const res = makeNifcAdapter(mkEngine(new FakeCache()), { SOURCE_NIFC_MODE: 'MOCK' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
  });

  it('rejects an invalid mode (CONFIG)', () => {
    const res = makeNifcAdapter(mkEngine(new FakeCache()), { SOURCE_NIFC_MODE: 'bogus' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });

  it('honors SOURCE_NIFC_URL override', () => {
    const res = makeNifcAdapter(mkEngine(new FakeCache()), {
      SOURCE_NIFC_MODE: 'MOCK',
      SOURCE_NIFC_URL: 'https://example.test/query',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // No key required for LIVE (keyless public endpoint) — LIVE mode alone must not fail fast.
    const live = makeNifcAdapter(mkEngine(new FakeCache()), { SOURCE_NIFC_MODE: 'LIVE' });
    expect(live.ok).toBe(true);
  });
});

function seedFetchResult(fetchedAt: string): FetchResult<HazardGeometry> {
  const entity = makeHazardGeometry({
    id: asId<HazardGeometryId>('nifc:Seed Fire:0'),
    incidentId: asId<IncidentId>('nifc-unassigned'),
    sourceId: asId<SourceId>('sid-seed'),
    kind: 'PERIMETER',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-122.6, 38.9],
          [-122.5, 38.9],
          [-122.5, 39.0],
          [-122.6, 38.9],
        ],
      ],
    },
    observedAt: fetchedAt,
  });
  return {
    records: [
      {
        entity,
        provenance: {
          id: asId<SourceId>('44444444-4444-4444-8444-444444444444'),
          source: 'NIFC/WFIGS',
          adapter: 'nifc',
          fetchedAt,
          license: 'US public domain (NIFC/WFIGS)',
          mode: 'LIVE',
        },
      },
    ],
    freshness: fetchedAt,
    mode: 'LIVE',
    degraded: false,
  };
}
