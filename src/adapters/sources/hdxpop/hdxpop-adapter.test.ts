// BEACON — HDX population adapter tests (S2·Lane A3; ADR-009/F1/F5/F6, Art. XVI). Mode-switch
// (MOCK/CACHED/LIVE) each yields usable PopulationEstimates with the correct mode/degraded/freshness; the
// live rung degrades to the recorded mock when upstream is unreachable; provenance is stamped on every
// record; the outward PopulationPort sums only the regions the query bbox contains; the RO coverage gate
// refuses a US query; the keyless factory needs no key. NO live network: `fetch` is stubbed in LIVE tests.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { ok } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { PopulationEstimate } from '@/ports/infrastructure-sources.js';
import type { CachePort } from '@/ports/infra.js';
import { asId } from '@/domain/index.js';
import type { SourceId } from '@/domain/index.js';
import type { FetchResult, Region, SourceConfig } from '@/adapters/_shared/index.js';
import { RedundancyEngine, cacheKey } from '@/adapters/_shared/index.js';
import { HdxPopAdapter, makeHdxPopAdapter } from './hdxpop-adapter.js';

const NOW = '2026-07-05T22:00:00Z'; // fixed clock — no wall-clock dependence anywhere in this suite
const SOURCE_LABEL = 'UN OCHA HDX — COD-PS (Eurostat via UNFPA)';
const LICENSE = 'CC BY-IGO (Creative Commons Attribution for Intergovernmental Organisations)';
const INTERNAL_REGION_ID = 'hdxpop-rou-adm1'; // the adapter's stable single-key cache region

const csv = readFileSync(
  fileURLToPath(new URL('./__fixtures__/rou-admpop-adm1.csv', import.meta.url)),
  'utf8',
);

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

const region: Region = { id: 'ro', bbox: [20.2, 43.6, 29.7, 48.3], iso: 'RO' };
const mkEngine = (cache: CachePort) =>
  new RedundancyEngine({ cache, nowIso: () => NOW, idGen: () => 'sid-hdxpop' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});

/** Stub the platform fetch with a responder — NO live network is ever reached in these tests. */
function stubFetch(responder: (url: string) => Response): string[] {
  const seen: string[] = [];
  vi.stubGlobal('fetch', (url: string) => {
    seen.push(String(url));
    return Promise.resolve(responder(String(url)));
  });
  return seen;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HdxPopAdapter mode-switch', () => {
  it('MOCK mode serves the recorded resource as PopulationEstimates (degraded, provenance MOCK)', async () => {
    const adapter = new HdxPopAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(8);
    const first = res.value.records[0];
    expect(first?.entity.count).toBe(2514357);
    expect(first?.provenance.mode).toBe('MOCK');
    expect(first?.provenance.source).toBe(SOURCE_LABEL);
    expect(first?.provenance.license).toBe(LICENSE);
    expect(first?.provenance.adapter).toBe('hdxpop');
  });

  it('CACHED mode serves last-known-good with degraded=true and preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    cache.store.set(cacheKey('hdxpop', region.id), seedFetchResult('2026-07-05T20:00:00Z'));
    const adapter = new HdxPopAdapter({ engine: mkEngine(cache), config: cfg('CACHED') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.degraded).toBe(true);
    expect(res.value.freshness).toBe('2026-07-05T20:00:00Z');
  });

  it('LIVE mode downloads the configured CKAN resource verbatim (no query params to build)', async () => {
    const seen = stubFetch(() => new Response(csv, { status: 200 }));
    const url =
      'https://data.humdata.org/dataset/abc/resource/def/download/rou_admpop_adm1_2022_v01.csv';
    const adapter = new HdxPopAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url }),
    });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('LIVE');
    expect(res.value.degraded).toBe(false);
    expect(res.value.records).toHaveLength(8);
    expect(seen).toEqual([url]);
  });

  it('LIVE mode degrades to the recorded mock when upstream is unreachable (F5 → OP3)', async () => {
    stubFetch(() => new Response('gateway timeout', { status: 504 }));
    const adapter = new HdxPopAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'https://data.humdata.org/x' }),
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK'); // live down, cache empty → recorded mock, never a dead-end
    expect(res.value.records).toHaveLength(8);
  });
});

describe('HdxPopAdapter outward PopulationPort', () => {
  it('sums ONLY the regions whose centroid the query bbox contains', async () => {
    const adapter = new HdxPopAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    // A tight box around București-Ilfov's centroid (26.1, 44.45) — no other region centroid falls inside.
    const res = await adapter.estimatePopulation([25.8, 44.2, 26.4, 44.7]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data.count).toBe(2318824); // RO008 alone, verbatim from the recorded resource
    expect(res.value.data.area).toEqual([25.8, 44.2, 26.4, 44.7]);
    expect(res.value.freshness.fetchedAt).toBe(NOW);
  });

  it('sums the whole country when the bbox spans every region centroid', async () => {
    const adapter = new HdxPopAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.estimatePopulation([20.2, 43.6, 29.7, 48.3]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data.count).toBe(18983507);
  });

  it('returns 0 (never a guess) when no region centroid falls inside the bbox', async () => {
    const adapter = new HdxPopAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.estimatePopulation([-124, 32, -114, 42]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data.count).toBe(0);
  });

  it('surfaces a typed NOT_FOUND when every rung is exhausted', async () => {
    const adapter = new HdxPopAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
      fixturesDir: '/nonexistent-hdxpop-fixtures',
    });
    const res = await adapter.estimatePopulation(region.bbox);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('NOT_FOUND');
  });

  it('caches the admin-1 set under ONE stable region id, whatever bbox is asked about', async () => {
    const cache = new FakeCache();
    const adapter = new HdxPopAdapter({
      engine: mkEngine(cache),
      config: cfg('LIVE', { url: 'https://data.humdata.org/x' }),
    });
    stubFetch(() => new Response(csv, { status: 200 }));
    await adapter.estimatePopulation([25.8, 44.2, 26.4, 44.7]);
    expect([...cache.store.keys()]).toEqual([cacheKey('hdxpop', INTERNAL_REGION_ID)]);
  });

  it('is RO-only: a non-RO region is refused NOT_COVERED rather than answered with RO totals', async () => {
    const adapter = new HdxPopAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch({ id: 'ca', bbox: [-124, 32, -114, 42], iso: 'US' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('NOT_COVERED');
  });

  it('reports a healthy (CLOSED) breaker and RO COUNTRIES coverage before any failure', () => {
    const adapter = new HdxPopAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('hdxpop');
    expect(adapter.coverage).toEqual({ kind: 'COUNTRIES', iso: ['RO'] });
  });
});

describe('makeHdxPopAdapter factory', () => {
  it('defaults to CACHED (the upstream is a fixed statistical vintage, not a live signal)', () => {
    const res = makeHdxPopAdapter(mkEngine(new FakeCache()), {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
  });

  it('builds a LIVE adapter with NO key — HDX CKAN and its resource downloads are keyless', () => {
    const res = makeHdxPopAdapter(mkEngine(new FakeCache()), { SOURCE_HDXPOP_MODE: 'LIVE' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('LIVE');
  });

  it('fails fast (CONFIG) on an invalid SOURCE_HDXPOP_MODE', () => {
    const res = makeHdxPopAdapter(mkEngine(new FakeCache()), { SOURCE_HDXPOP_MODE: 'sometimes' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });
});

function seedFetchResult(fetchedAt: string): FetchResult<PopulationEstimate> {
  return {
    records: [
      {
        entity: { area: [25.1, 43.45, 27.1, 45.45], count: 2318824 },
        provenance: {
          id: asId<SourceId>('66666666-6666-4666-8666-666666666666'),
          source: SOURCE_LABEL,
          adapter: 'hdxpop',
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
