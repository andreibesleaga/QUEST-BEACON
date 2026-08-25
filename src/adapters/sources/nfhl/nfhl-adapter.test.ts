// BEACON — NFHL adapter tests (ADR-009/F1/F5/F6). Each mode yields provenance-stamped FloodZone rows (the
// MultiPolygon VE fixture feature splits into 2, so MOCK serves 4 total); the live rung degrades to the
// recorded mock when upstream is unreachable; COUNTRIES[US] coverage gates non-US regions; the outward
// FloodZonePort adapts the ladder; the factory reads SOURCE_NFHL_* env and defaults to CACHED (not MOCK,
// unlike FIRMS/GDACS — DSV: NFHL is slow under load). Deterministic clock is safely in the past.
import { describe, it, expect } from 'vitest';
import { ok, asId, makeFloodZone } from '@/domain/index.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { FloodZone } from '@/domain/index.js';
import type { SourceId } from '@/domain/value-objects/ids.js';
import type { CachePort } from '@/ports/infra.js';
import type { FetchResult, Region, SourceConfig } from '@/adapters/_shared/index.js';
import { RedundancyEngine, cacheKey } from '@/adapters/_shared/index.js';
import { NfhlAdapter, makeNfhlAdapter } from './nfhl-adapter.js';

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
const LOUISIANA: Region = { id: 'us-la', bbox: [-90.2, 29.8, -89.9, 30.1], iso: 'US' };
const mkEngine = (cache: CachePort) => new RedundancyEngine({ cache, nowIso: () => NOW, idGen: () => 'sid-nfhl' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});

describe('NfhlAdapter mode-switch', () => {
  it('MOCK mode serves the recorded fixture as FloodZone (MultiPolygon VE splits into 2 records)', async () => {
    const adapter = new NfhlAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch(LOUISIANA);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(4); // AE + X + VE-part0 + VE-part1
    expect(res.value.records.map((r) => r.entity.zone)).toEqual(['AE', 'X', 'VE', 'VE']);
    const first = res.value.records[0];
    expect(first?.provenance.source).toBe('FEMA NFHL');
    expect(first?.provenance.adapter).toBe('nfhl');
    expect(first?.provenance.mode).toBe('MOCK');
    expect(first?.provenance.license).toBe('US public domain (FEMA)');
  });

  it('CACHED mode serves last-known-good with degraded=true and preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    cache.store.set(cacheKey('nfhl', LOUISIANA.id), seedFetchResult('2026-07-05T20:00:00Z'));
    const adapter = new NfhlAdapter({ engine: mkEngine(cache), config: cfg('CACHED') });
    const res = await adapter.fetch(LOUISIANA);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.freshness).toBe('2026-07-05T20:00:00Z');
  });

  it('LIVE mode degrades to the recorded mock when upstream is unreachable (F5 → OP3)', async () => {
    const adapter = new NfhlAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'http://127.0.0.1:9' }),
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(LOUISIANA);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.records.length).toBeGreaterThan(0);
  });

  it('COUNTRIES[US] coverage serves a US region', async () => {
    const adapter = new NfhlAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    expect((await adapter.fetch(LOUISIANA)).ok).toBe(true);
  });

  it('COUNTRIES[US] coverage rejects a non-US region as NOT_COVERED', async () => {
    const adapter = new NfhlAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch({ id: 'ro', bbox: [20, 43, 30, 48], iso: 'RO' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('NOT_COVERED');
  });

  it('COUNTRIES[US] coverage rejects a region with no iso as NOT_COVERED', async () => {
    const adapter = new NfhlAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch({ id: 'unknown', bbox: [-90.2, 29.8, -89.9, 30.1] });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('NOT_COVERED');
  });
});

describe('NfhlAdapter outward FloodZonePort', () => {
  it('fetchZones returns a Sourced envelope of FloodZone with freshness', async () => {
    const adapter = new NfhlAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetchZones({ bbox: LOUISIANA.bbox });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(4);
    expect(res.value.freshness.fetchedAt).toBe(NOW);
  });

  it('reports a healthy (CLOSED) breaker and correct identity', () => {
    const adapter = new NfhlAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('nfhl');
    expect(adapter.coverage).toEqual({ kind: 'COUNTRIES', iso: ['US'] });
  });
});

describe('makeNfhlAdapter factory', () => {
  it('defaults to CACHED mode (not MOCK) when SOURCE_NFHL_MODE is unset (DSV: slow under load)', () => {
    const res = makeNfhlAdapter(mkEngine(new FakeCache()), {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
  });

  it('builds a MOCK adapter from env when explicitly requested', () => {
    const res = makeNfhlAdapter(mkEngine(new FakeCache()), { SOURCE_NFHL_MODE: 'MOCK' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
  });

  it('rejects an invalid mode (CONFIG)', () => {
    const res = makeNfhlAdapter(mkEngine(new FakeCache()), { SOURCE_NFHL_MODE: 'bogus' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });
});

function seedFetchResult(fetchedAt: string): FetchResult<FloodZone> {
  const entity = makeFloodZone({
    id: 'nfhl:100234:0',
    zone: 'AE',
    geom: {
      type: 'Polygon',
      coordinates: [
        [
          [-90.1, 29.95],
          [-90.05, 29.95],
          [-90.05, 30.0],
          [-90.1, 29.95],
        ],
      ],
    },
  });
  return {
    records: [
      {
        entity,
        provenance: {
          id: asId<SourceId>('66666666-6666-4666-8666-666666666666'),
          source: 'FEMA NFHL',
          adapter: 'nfhl',
          fetchedAt,
          license: 'US public domain (FEMA)',
          mode: 'LIVE',
        },
      },
    ],
    freshness: fetchedAt,
    mode: 'LIVE',
    degraded: false,
  };
}
