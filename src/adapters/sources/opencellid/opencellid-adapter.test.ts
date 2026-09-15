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
import {
  MAX_TILE_KM2,
  tilesFor,
  OpenCelliDAdapter,
  makeOpenCelliDAdapter,
  DEFAULT_MAX_TILES,
  DEFAULT_DAILY_BUDGET,
  ledgerFor,
  resetLedgers,
} from './opencellid-adapter.js';

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
    const adapter = new OpenCelliDAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
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
    const adapter = new OpenCelliDAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
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
    const adapter = new OpenCelliDAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
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
    const res = makeOpenCelliDAdapter(mkEngine(new FakeCache()), {
      SOURCE_OPENCELLID_MODE: 'MOCK',
    });
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
    const res = makeOpenCelliDAdapter(mkEngine(new FakeCache()), {
      SOURCE_OPENCELLID_MODE: 'LIVE',
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });
});

function seedFetchResult(fetchedAt: string): FetchResult<TelecomCoverage> {
  const entity: TelecomCoverage = {
    position: [-121.8375, 39.7285],
    technology: 'LTE',
    online: true,
  };
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

describe('tilesFor — OpenCelliD answers at most 4 km² per query (ADR-045)', () => {
  const km2 = ([w, s, e, n]: readonly [number, number, number, number]): number => {
    const midLat = (((s + n) / 2) * Math.PI) / 180;
    return (e - w) * 111.32 * Math.cos(midLat) * (n - s) * 111.32;
  };

  it('with a focus: one tile under the cap, centred on each focus box', () => {
    const tiles = tilesFor({
      id: 'us-ca',
      bbox: [-124.48, 32.53, -114.13, 42.01],
      focus: [
        [-121.7, 39.6, -121.5, 39.8],
        [-122.3, 38.4, -122.1, 38.6],
      ],
    });
    expect(tiles).toHaveLength(2);
    for (const t of tiles) expect(km2(t)).toBeLessThan(MAX_TILE_KM2);
    const [w, s, e, n] = tiles[0]!;
    expect((w + e) / 2).toBeCloseTo(-121.6, 6);
    expect((s + n) / 2).toBeCloseTo(39.7, 6);
  });

  it('without a focus: the bbox itself when it fits, nothing when it does not', () => {
    expect(tilesFor({ id: 'q', bbox: [-121.61, 39.69, -121.59, 39.71] })).toHaveLength(1);
    expect(tilesFor({ id: 'us-ca', bbox: [-124.48, 32.53, -114.13, 42.01] })).toHaveLength(0);
    expect(tilesFor({ id: 'butte', bbox: [-121.9, 39.6, -121.7, 39.8] })).toHaveLength(0);
  });

  it('a region-sized query without a focus degrades down the ladder without a request', async () => {
    const adapter = new OpenCelliDAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'http://127.0.0.1:9/cell/getInArea', apiKey: 'k' }),
    });
    const res = await adapter.fetch({ id: 'us-ca', bbox: [-124.48, 32.53, -114.13, 42.01] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
  });
});

// ── The daily request budget (2026-09-14: the free key was answering 429 under the focus tiles) ───────
describe('OpenCelliDAdapter daily budget — spent means last-known-good, never a request', () => {
  const focus: Region = {
    id: 'us-ca@focus',
    bbox: [-124.5, 32.5, -114.1, 42.0],
    focus: [
      [-121.7, 39.6, -121.5, 39.8],
      [-121.9, 39.9, -121.7, 40.1],
    ],
  };
  const spyFetch = (): { calls: string[]; restore: () => void } => {
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL) => {
      calls.push(String(input));
      return Promise.resolve(new Response('[]', { status: 200 }));
    }) as typeof fetch;
    return { calls, restore: () => (globalThis.fetch = original) };
  };

  it('reserves one request per tile, refuses the cycle that would exceed the budget, and resets at the next UTC day', async () => {
    resetLedgers();
    let now = '2026-07-05T22:00:00Z';
    const adapter = new OpenCelliDAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { apiKey: 'k' }),
      dailyBudget: 3,
      now: () => now,
    });
    const spy = spyFetch();
    try {
      const first = await adapter.fetch(focus); // 2 tiles → 2 requests
      expect(first.ok && first.value.mode).toBe('LIVE');
      expect(spy.calls).toHaveLength(2);
      expect(adapter.requestsSpentToday()).toBe(2);
      const second = await adapter.fetch(focus); // 2 more would be 4 of 3 → RATE_LIMITED, no request
      expect(second.ok && second.value.mode).toBe('CACHED'); // last-known-good from the first cycle
      expect(spy.calls).toHaveLength(2);
      now = '2026-07-06T00:00:01Z'; // the day turns
      expect(adapter.requestsSpentToday()).toBe(0);
      const third = await adapter.fetch(focus);
      expect(third.ok && third.value.mode).toBe('LIVE');
      expect(spy.calls).toHaveLength(4);
    } finally {
      spy.restore();
    }
  });

  it('one ledger per API key across adapters: five regional adapters share ONE daily budget', async () => {
    resetLedgers();
    const now = () => '2026-07-05T22:00:00Z';
    const mk = () =>
      new OpenCelliDAdapter({
        engine: mkEngine(new FakeCache()),
        config: cfg('LIVE', { apiKey: 'shared-key' }),
        dailyBudget: 3,
        now,
      });
    const a = mk();
    const b = mk();
    const spy = spyFetch();
    try {
      expect((await a.fetch(focus)).ok).toBe(true); // 2 of 3 spent by region a
      expect(b.requestsSpentToday()).toBe(2); // region b sees the same ledger
      const res = await b.fetch(focus); // 2 more would exceed → no request from b either
      expect(res.ok && res.value.mode).toBe('MOCK'); // b has no last-known-good of its own yet
      expect(spy.calls).toHaveLength(2);
    } finally {
      spy.restore();
    }
    expect(ledgerFor('shared-key', 999).limit).toBe(3); // the first adapter's limit stands for the key
  });

  it('the factory reads both knobs: tiles per region and the daily budget reach a live fetch', async () => {
    resetLedgers();
    const three: Region = { ...focus, focus: [...focus.focus!, [-122.1, 40.2, -121.9, 40.4]] };
    const res = makeOpenCelliDAdapter(mkEngine(new FakeCache()), {
      SOURCE_OPENCELLID_MODE: 'LIVE',
      OPENCELLID_API_KEY: 'knobs',
      SOURCE_OPENCELLID_MAX_TILES: '2',
      SOURCE_OPENCELLID_DAILY_BUDGET: '3',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const spy = spyFetch();
    try {
      await res.value.fetch(three); // 3 focus boxes, 2 tiles allowed → 2 requests
      expect(spy.calls).toHaveLength(2);
      await res.value.fetch(three); // 2 more of a 3 budget → refused without a request
      expect(spy.calls).toHaveLength(2);
    } finally {
      spy.restore();
    }
    // Bad knob values fall back to the defaults rather than failing the build.
    const bad = makeOpenCelliDAdapter(mkEngine(new FakeCache()), {
      SOURCE_OPENCELLID_MODE: 'MOCK',
      SOURCE_OPENCELLID_MAX_TILES: 'many',
      SOURCE_OPENCELLID_DAILY_BUDGET: '-1',
    });
    expect(bad.ok).toBe(true);
    expect(tilesFor(three)).toHaveLength(3);
    expect(
      tilesFor({ ...three, focus: Array.from({ length: 9 }, () => three.focus![0]!) }),
    ).toHaveLength(DEFAULT_MAX_TILES);
    expect(tilesFor(three, 0)).toHaveLength(1); // never zero tiles for a region with a focus
    expect(DEFAULT_DAILY_BUDGET).toBe(800);
  });
});
