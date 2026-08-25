// BEACON — OpenCelliD adapter tests (E4·T-13x; TelecomPort P13/ADR-009/F1/F5/F6). Mode-switch (mock/
// cached/live) each yields usable TelecomCoverage with the correct mode/degraded/freshness; the live rung
// degrades to the recorded mock when upstream is unreachable; provenance is stamped on every record; the
// outward TelecomPort.fetchCoverage adapts the ladder to the Sourced envelope with [lon,lat] positions +
// technologies; the factory fails fast (CONFIG) when LIVE mode lacks OPENCELLID_API_KEY.
import { describe, it, expect } from 'vitest';
import { ok } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { SourceId } from '@/domain/index.js';
import { asId } from '@/domain/index.js';
import type { CachePort } from '@/ports/infra.js';
import type { TelecomCoverage } from '@/ports/infrastructure-sources.js';
import type { FetchResult, Region, SourceConfig } from '@/adapters/_shared/index.js';
import { RedundancyEngine, cacheKey } from '@/adapters/_shared/index.js';
import { OpenCelliDAdapter, makeOpenCelliDAdapter } from './opencellid-adapter.js';

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

const region: Region = { id: 'butte-ca', bbox: [-121.9, 39.6, -121.7, 39.8] };
// Deterministic clock must be safely in the past — Freshness rejects a future fetchedAt (domain invariant).
const NOW = '2026-07-05T22:00:00Z';
const mkEngine = (cache: CachePort) =>
  new RedundancyEngine({ cache, nowIso: () => NOW, idGen: () => 'sid-opencellid' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});

describe('OpenCelliDAdapter mode-switch', () => {
  it('MOCK mode serves the recorded fixture as TelecomCoverage (degraded, provenance MOCK)', async () => {
    const adapter = new OpenCelliDAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(6);
    const first = res.value.records[0];
    expect(first?.entity.online).toBe(true);
    expect(first?.entity.position).toEqual([-121.8375, 39.7285]);
    expect(first?.provenance.mode).toBe('MOCK');
    expect(first?.provenance.source).toBe('OpenCelliD');
    expect(first?.provenance.license).toBe('CC BY-SA (OpenCelliD)');
    expect(first?.provenance.adapter).toBe('opencellid');
  });

  it('CACHED mode serves last-known-good with degraded=true and preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    cache.store.set(cacheKey('opencellid', region.id), seedFetchResult('2026-07-05T20:00:00Z'));
    const adapter = new OpenCelliDAdapter({ engine: mkEngine(cache), config: cfg('CACHED') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.degraded).toBe(true);
    expect(res.value.freshness).toBe('2026-07-05T20:00:00Z');
  });

  it('LIVE mode degrades to the recorded mock when upstream is unreachable (F5 → OP3)', async () => {
    const adapter = new OpenCelliDAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'http://127.0.0.1:9/cell/getInArea', apiKey: 'k' }),
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK'); // live down, cache empty → recorded mock, never a dead-end
    expect(res.value.records.length).toBeGreaterThan(0);
  });
});

describe('OpenCelliDAdapter outward TelecomPort', () => {
  it('fetchCoverage returns a Sourced envelope of TelecomCoverage with [lon,lat] positions + technologies', async () => {
    const adapter = new OpenCelliDAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetchCoverage({ bbox: region.bbox });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(6);
    expect(res.value.data[0]?.position).toEqual([-121.8375, 39.7285]);
    const technologies = new Set(res.value.data.map((c) => c.technology));
    expect(technologies).toEqual(new Set(['LTE', 'NR', 'UMTS']));
    expect(res.value.data.every((c) => c.online)).toBe(true);
    expect(res.value.freshness.fetchedAt).toBe('2026-07-05T22:00:00Z');
  });

  it('reports a healthy (CLOSED) breaker before any failure', () => {
    const adapter = new OpenCelliDAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('opencellid');
    expect(adapter.coverage).toEqual({ kind: 'GLOBAL' });
  });
});

describe('makeOpenCelliDAdapter factory', () => {
  it('builds a CACHED adapter from env by default mode', () => {
    const res = makeOpenCelliDAdapter(mkEngine(new FakeCache()), {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
  });

  it('builds a MOCK adapter from env', () => {
    const res = makeOpenCelliDAdapter(mkEngine(new FakeCache()), { SOURCE_OPENCELLID_MODE: 'MOCK' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
  });

  it('builds a LIVE adapter from env when OPENCELLID_API_KEY is set', () => {
    const res = makeOpenCelliDAdapter(mkEngine(new FakeCache()), {
      SOURCE_OPENCELLID_MODE: 'LIVE',
      OPENCELLID_API_KEY: 'test-key',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('LIVE');
  });

  it('fails fast (CONFIG) when LIVE mode lacks OPENCELLID_API_KEY', () => {
    const res = makeOpenCelliDAdapter(mkEngine(new FakeCache()), { SOURCE_OPENCELLID_MODE: 'LIVE' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });
});

function seedFetchResult(fetchedAt: string): FetchResult<TelecomCoverage> {
  const entity: TelecomCoverage = { position: [-121.8375, 39.7285], technology: 'LTE', online: true };
  return {
    records: [
      {
        entity,
        provenance: {
          id: asId<SourceId>('44444444-4444-4444-8444-444444444444'),
          source: 'OpenCelliD',
          adapter: 'opencellid',
          fetchedAt,
          license: 'CC BY-SA (OpenCelliD)',
          mode: 'LIVE',
        },
      },
    ],
    freshness: fetchedAt,
    mode: 'LIVE',
    degraded: false,
  };
}
