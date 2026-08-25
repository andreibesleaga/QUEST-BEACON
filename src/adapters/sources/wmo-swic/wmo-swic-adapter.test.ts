// BEACON — WMO-SWIC relay adapter tests (B3.2; ADR-009/F1/F5/F6). Each mode yields provenance-stamped
// NewsItems (never hazard geometry — F-48); the mock rung walks the SAME index→CAP-documents pipeline as
// LIVE; the live rung degrades to the recorded-style mock when upstream is unreachable; COUNTRIES=['PH']
// gates coverage; the factory reads SOURCE_WMO_SWIC_* + WMO_SWIC_SOURCE_ID env. Deterministic past clock
// (flaky-test rule), NO network.
import { describe, it, expect } from 'vitest';
import { ok, asId } from '@/domain/index.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { SourceId } from '@/domain/index.js';
import type { NewsItem } from '@/ports/intel.js';
import type { CachePort } from '@/ports/infra.js';
import type { FetchResult, Region, SourceConfig } from '@/adapters/_shared/index.js';
import { RedundancyEngine, cacheKey } from '@/adapters/_shared/index.js';
import { WmoSwicAdapter, makeWmoSwicAdapter } from './wmo-swic-adapter.js';

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

const NOW = '2026-07-05T22:00:00Z'; // safely past — Freshness rejects future fetchedAt (flaky-test rule)
const PH: Region = { id: 'ph', bbox: [116.93, 4.59, 126.6, 21.12], iso: 'PH' };
const mkEngine = (cache: CachePort) =>
  new RedundancyEngine({ cache, nowIso: () => NOW, idGen: () => 'sid-wmo-swic' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});

describe('WmoSwicAdapter mode-switch', () => {
  it('MOCK walks the index→CAP-documents pipeline and serves BOTH fixture alerts as provenance-stamped NewsItems', async () => {
    const adapter = new WmoSwicAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch(PH);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(2); // one gfa + one acp
    const gfa = res.value.records[0];
    expect(gfa?.entity.title).toBe('General Flood Advisory (Severe)');
    expect(gfa?.entity.url).toContain('severeweather.wmo.int/v2/cap-alerts/ph-pagasa-en');
    expect(gfa?.provenance.source).toContain('WMO SWIC');
    expect(gfa?.provenance.adapter).toBe('wmo-swic');
    expect(gfa?.provenance.mode).toBe('MOCK');
    expect(gfa?.provenance.license).toContain('CC BY 4.0');
  });

  it('F-48 🔴 adapter-level pin: the acp record is labelled advisory alert-intel and NO record carries geometry', async () => {
    const adapter = new WmoSwicAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch(PH);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const acp = res.value.records.find((r) => r.entity.title.includes('Tropical Cyclone'));
    expect(acp?.entity.summary).toContain('alerting area only, not the storm extent'); // mandatory labelling
    for (const record of res.value.records) {
      // NewsItems only — never a HazardGeometry, so nothing here can reach EXPOSURE_BEARING_BY_KIND
      // or the map's hazard-footprint rendering (see wmo-swic-acl.ts header for the mechanism choice).
      expect(Object.keys(record.entity)).not.toContain('geometry');
      expect(Object.keys(record.entity)).not.toContain('kind');
    }
  });

  it('CACHED mode serves last-known-good with preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    cache.store.set(cacheKey('wmo-swic', PH.id), seedFetchResult('2026-07-05T20:00:00Z'));
    const adapter = new WmoSwicAdapter({ engine: mkEngine(cache), config: cfg('CACHED') });
    const res = await adapter.fetch(PH);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.freshness).toBe('2026-07-05T20:00:00Z');
  });

  it('LIVE mode degrades to the recorded-style mock when upstream is unreachable (F5 → OP3)', async () => {
    const adapter = new WmoSwicAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'http://127.0.0.1:9' }),
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(PH);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.records.length).toBeGreaterThan(0);
  });

  it('COUNTRIES=[PH] coverage rejects a non-PH region with NOT_COVERED (OP4)', async () => {
    const adapter = new WmoSwicAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch({ id: 'ro', bbox: [20, 43, 30, 48], iso: 'RO' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('NOT_COVERED');
  });
});

describe('WmoSwicAdapter outward NewsIntelPort', () => {
  it('fetchNews returns a Sourced envelope of NewsItems with freshness', async () => {
    const adapter = new WmoSwicAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetchNews('');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(2);
    expect(res.value.freshness.fetchedAt).toBe(NOW);
  });

  it('fetchNews filters by a case-insensitive query over title+summary', async () => {
    const adapter = new WmoSwicAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetchNews('kiyapo');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(1);
    expect(res.value.data[0]?.title).toContain('Typhoon Kiyapo');
  });

  it('reports a healthy (CLOSED) breaker and correct identity/coverage', () => {
    const adapter = new WmoSwicAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('wmo-swic');
    expect(adapter.coverage).toEqual({ kind: 'COUNTRIES', iso: ['PH'] });
  });
});

describe('makeWmoSwicAdapter factory', () => {
  it('builds a MOCK adapter from env (default mode; default source id ph-pagasa-en)', async () => {
    const res = makeWmoSwicAdapter(mkEngine(new FakeCache()), {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    const fetched = await res.value.fetch(PH); // the default source id resolves the shipped fixtures
    expect(fetched.ok).toBe(true);
  });

  it('rejects an invalid mode (CONFIG, fail-fast)', () => {
    const res = makeWmoSwicAdapter(mkEngine(new FakeCache()), { SOURCE_WMO_SWIC_MODE: 'bogus' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });

  it('WMO_SWIC_SOURCE_ID is honoured: an unknown source id has no fixture ⇒ MOCK fails fast (CONFIG), never a silent empty', async () => {
    const res = makeWmoSwicAdapter(mkEngine(new FakeCache()), { WMO_SWIC_SOURCE_ID: 'xx-nosuch-en' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const fetched = await res.value.fetch(PH);
    expect(fetched.ok).toBe(false);
    if (fetched.ok) return;
    expect(fetched.error.kind).toBe('CONFIG'); // T-137: configured-but-absent fixture is loud
  });
});

function seedFetchResult(fetchedAt: string): FetchResult<NewsItem> {
  const entity: NewsItem = {
    title: 'General Flood Advisory (Severe)',
    url: 'https://severeweather.wmo.int/v2/cap-alerts/ph-pagasa-en/2026/07/27/09/47/59-58b49f5fb6529a1eabdacffc14d9daaa.xml',
    publishedAt: fetchedAt,
    summary: 'Maguindanao; Lanao Del Sur — General Flood Advisory (Severe)',
  };
  return {
    records: [
      {
        entity,
        provenance: {
          id: asId<SourceId>('77777777-7777-4777-8777-777777777777'),
          source: 'WMO SWIC CAP relay (PAGASA-DOST)',
          adapter: 'wmo-swic',
          fetchedAt,
          license: 'CC BY 4.0 (PAGASA-DOST); relay under WMO Unified Data Policy Res. 1 — attribution',
          mode: 'LIVE',
        },
      },
    ],
    freshness: fetchedAt,
    mode: 'LIVE',
    degraded: false,
  };
}
