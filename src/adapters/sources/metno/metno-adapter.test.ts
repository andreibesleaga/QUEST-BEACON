// BEACON — met.no adapter tests (S2·Lane A3; ADR-009/F1/F5/F6, Art. XVI). Mode-switch (MOCK/CACHED/LIVE)
// each yields usable WeatherObservations with the correct mode/degraded/freshness; the live rung degrades to
// the recorded mock when upstream is unreachable; provenance is stamped on every record; the outward
// WeatherSourcePort adapts the ladder to the Sourced envelope; the factory fails fast when LIVE is selected
// without the licence-mandated contact User-Agent. NO live network: `fetch` is stubbed in every LIVE test.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { ok } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { WeatherObservation } from '@/ports/data-sources.js';
import type { CachePort } from '@/ports/infra.js';
import { asId } from '@/domain/index.js';
import type { SourceId } from '@/domain/index.js';
import type { FetchResult, Region, SourceConfig } from '@/adapters/_shared/index.js';
import { RedundancyEngine, cacheKey } from '@/adapters/_shared/index.js';
import { MetnoAdapter, makeMetnoAdapter } from './metno-adapter.js';

const NOW = '2026-07-05T22:00:00Z'; // fixed clock — no wall-clock dependence anywhere in this suite
const SOURCE_LABEL = 'MET Norway Locationforecast';
const LICENSE = 'CC BY 4.0 / NLOD (MET Norway)';
const UA = 'BEACON/1.0 (contact: ops@example.org)';

const body = readFileSync(
  fileURLToPath(new URL('./__fixtures__/locationforecast.json', import.meta.url)),
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

// Galați/Vaslui-ish RO box — the demo region met.no corroborates alongside Open-Meteo.
const region: Region = { id: 'ro', bbox: [27.0, 45.5, 27.3, 46.0] };
const mkEngine = (cache: CachePort) =>
  new RedundancyEngine({ cache, nowIso: () => NOW, idGen: () => 'sid-metno' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});

interface SeenCall {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

/** Stub the platform fetch with a responder — NO live network is ever reached in these tests. */
function stubFetch(responder: (url: string) => Response): SeenCall[] {
  const seen: SeenCall[] = [];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    seen.push({ url: String(url), init });
    return Promise.resolve(responder(String(url)));
  });
  return seen;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MetnoAdapter mode-switch', () => {
  it('MOCK mode serves the recorded fixture as WeatherObservations (degraded, provenance MOCK)', async () => {
    const adapter = new MetnoAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(3);
    const first = res.value.records[0];
    expect(first?.entity.tempC).toBe(26.1);
    expect(first?.entity.windSpeedMs).toBe(7.9);
    expect(first?.provenance.mode).toBe('MOCK');
    expect(first?.provenance.source).toBe(SOURCE_LABEL);
    expect(first?.provenance.license).toBe(LICENSE);
    expect(first?.provenance.adapter).toBe('metno');
  });

  it('CACHED mode serves last-known-good with degraded=true and preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    cache.store.set(cacheKey('metno', region.id), seedFetchResult('2026-07-05T20:00:00Z'));
    const adapter = new MetnoAdapter({ engine: mkEngine(cache), config: cfg('CACHED') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.degraded).toBe(true);
    expect(res.value.freshness).toBe('2026-07-05T20:00:00Z');
  });

  it('LIVE mode queries the bbox CENTRE with the contact User-Agent and maps the response', async () => {
    const seen = stubFetch(() => new Response(body, { status: 200 }));
    const adapter = new MetnoAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'https://api.met.no', apiKey: UA }),
    });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('LIVE');
    expect(res.value.degraded).toBe(false);
    expect(res.value.records).toHaveLength(3);
    expect(seen[0]?.url).toBe(
      'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=45.75&lon=27.15',
    );
    // Licence obligation: MET Norway requires an identifying contact User-Agent on EVERY request.
    expect((seen[0]?.init?.headers as Record<string, string>)['User-Agent']).toBe(UA);
  });

  it('LIVE mode degrades to the recorded mock when upstream is unreachable (F5 → OP3)', async () => {
    stubFetch(() => {
      throw new Error('ECONNREFUSED');
    });
    const adapter = new MetnoAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'https://api.met.no', apiKey: UA }),
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK'); // live down, cache empty → recorded mock, never a dead-end
    expect(res.value.records).toHaveLength(3);
  });
});

describe('MetnoAdapter outward WeatherSourcePort', () => {
  it('fetchWeather returns a Sourced envelope of WeatherObservation with freshness', async () => {
    const adapter = new MetnoAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetchWeather({ bbox: region.bbox });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(3);
    expect(res.value.data[0]?.position).toEqual([27.15, 45.75]);
    expect(res.value.freshness.fetchedAt).toBe(NOW);
  });

  it('reports a healthy (CLOSED) breaker and GLOBAL coverage before any failure', () => {
    const adapter = new MetnoAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('metno');
    expect(adapter.coverage).toEqual({ kind: 'GLOBAL' });
  });
});

describe('makeMetnoAdapter factory', () => {
  it('defaults to CACHED (offline-safe) when no mode is configured', () => {
    const res = makeMetnoAdapter(mkEngine(new FakeCache()), {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
  });

  it('builds a LIVE adapter when METNO_USER_AGENT is set', () => {
    const res = makeMetnoAdapter(mkEngine(new FakeCache()), {
      SOURCE_METNO_MODE: 'LIVE',
      METNO_USER_AGENT: UA,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('LIVE');
  });

  it('fails fast (CONFIG) when LIVE mode lacks METNO_USER_AGENT (licence obligation, not an option)', () => {
    const res = makeMetnoAdapter(mkEngine(new FakeCache()), { SOURCE_METNO_MODE: 'LIVE' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
    expect(res.error.message).toContain('METNO_USER_AGENT');
  });

  it('fails fast (CONFIG) on an invalid SOURCE_METNO_MODE', () => {
    const res = makeMetnoAdapter(mkEngine(new FakeCache()), { SOURCE_METNO_MODE: 'sometimes' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });
});

function seedFetchResult(fetchedAt: string): FetchResult<WeatherObservation> {
  return {
    records: [
      {
        entity: { at: fetchedAt, position: [27.15, 45.75], tempC: 21 },
        provenance: {
          id: asId<SourceId>('44444444-4444-4444-8444-444444444444'),
          source: SOURCE_LABEL,
          adapter: 'metno',
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
