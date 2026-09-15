// BEACON — ANM adapter tests (S2·Lane A3; ADR-009/F1/F5/F6, Art. XVI). Mode-switch (MOCK/CACHED/LIVE) each
// yields usable WeatherObservations with the correct mode/degraded/freshness; the live rung degrades to the
// recorded mock when the (currently datacenter-blocked) host is unreachable; provenance is stamped on every
// record; the RO-only coverage gate refuses an out-of-country region; the keyless factory needs no key.
// NO live network: `fetch` is stubbed in every LIVE test.
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
import { AnmAdapter, makeAnmAdapter } from './anm-adapter.js';

const NOW = '2026-07-05T22:00:00Z'; // fixed clock — no wall-clock dependence anywhere in this suite
const SOURCE_LABEL = 'ANM Meteo România';
const LICENSE =
  'ANM (Administrația Națională de Meteorologie, România) — free public feed, attribution requested';

const body = readFileSync(
  fileURLToPath(new URL('./__fixtures__/starea-vremii.json', import.meta.url)),
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

const region: Region = { id: 'ro', bbox: [27.0, 45.5, 28.2, 46.0], iso: 'RO' };
const mkEngine = (cache: CachePort) =>
  new RedundancyEngine({ cache, nowIso: () => NOW, idGen: () => 'sid-anm' });
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

describe('AnmAdapter mode-switch', () => {
  it('MOCK mode serves the recorded fixture as WeatherObservations (degraded, provenance MOCK)', async () => {
    const adapter = new AnmAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(5);
    const first = res.value.records[0];
    expect(first?.entity.tempC).toBe(20.5);
    expect(first?.entity.windDirDeg).toBe(292.5);
    expect(first?.provenance.mode).toBe('MOCK');
    expect(first?.provenance.source).toBe(SOURCE_LABEL);
    expect(first?.provenance.license).toBe(LICENSE);
    expect(first?.provenance.adapter).toBe('anm');
  });

  it('CACHED mode serves last-known-good with degraded=true and preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    cache.store.set(cacheKey('anm', region.id), seedFetchResult('2026-07-05T20:00:00Z'));
    const adapter = new AnmAdapter({ engine: mkEngine(cache), config: cfg('CACHED') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.degraded).toBe(true);
    expect(res.value.freshness).toBe('2026-07-05T20:00:00Z');
  });

  it('LIVE mode GETs the national snapshot endpoint (no bbox param — ANM does not accept one)', async () => {
    const seen = stubFetch(() => new Response(body, { status: 200 }));
    const adapter = new AnmAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'https://www.meteoromania.ro' }),
    });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('LIVE');
    expect(res.value.degraded).toBe(false);
    expect(res.value.records).toHaveLength(5);
    expect(seen).toEqual(['https://www.meteoromania.ro/wp-json/meteoapi/v2/starea-vremii']);
  });

  it('LIVE mode degrades to the recorded mock when the host refuses the connection (F5 → OP3)', async () => {
    // Reproduces exactly what this environment saw on 2026-08-08: the TLS handshake is reset.
    stubFetch(() => {
      throw new Error('SSL_ERROR_SYSCALL');
    });
    const adapter = new AnmAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'https://www.meteoromania.ro' }),
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK'); // live blocked, cache empty → recorded mock, never a dead-end
    expect(res.value.records).toHaveLength(5);
  });
});

describe('AnmAdapter coverage + outward WeatherSourcePort', () => {
  it('is RO-only: a non-RO region is refused NOT_COVERED rather than answered with RO stations', async () => {
    const adapter = new AnmAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch({ id: 'ca', bbox: [-124, 32, -114, 42], iso: 'US' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('NOT_COVERED');
  });

  it('fetchWeather returns a Sourced envelope of WeatherObservation with freshness', async () => {
    const adapter = new AnmAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetchWeather({ bbox: region.bbox });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(5);
    expect(res.value.data[0]?.position).toEqual([27.965588, 44.088268]);
    expect(res.value.freshness.fetchedAt).toBe(NOW);
  });

  it('fetchWeather surfaces a typed NOT_FOUND when every rung is exhausted', async () => {
    const adapter = new AnmAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
      fixturesDir: '/nonexistent-anm-fixtures',
    });
    const res = await adapter.fetchWeather({ bbox: region.bbox });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('NOT_FOUND');
  });

  it('reports a healthy (CLOSED) breaker and RO COUNTRIES coverage before any failure', () => {
    const adapter = new AnmAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('anm');
    expect(adapter.coverage).toEqual({ kind: 'COUNTRIES', iso: ['RO'] });
  });
});

describe('makeAnmAdapter factory', () => {
  it('defaults to CACHED (honest default — the host was unreachable at build time)', () => {
    const res = makeAnmAdapter(mkEngine(new FakeCache()), {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
  });

  it('builds a LIVE adapter with NO key — ANM meteoapi is keyless', () => {
    const res = makeAnmAdapter(mkEngine(new FakeCache()), { SOURCE_ANM_MODE: 'LIVE' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('LIVE');
  });

  it('fails fast (CONFIG) on an invalid SOURCE_ANM_MODE', () => {
    const res = makeAnmAdapter(mkEngine(new FakeCache()), { SOURCE_ANM_MODE: 'uneori' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });
});

function seedFetchResult(fetchedAt: string): FetchResult<WeatherObservation> {
  return {
    records: [
      {
        entity: { at: fetchedAt, position: [28.03, 45.47], tempC: 21.7 },
        provenance: {
          id: asId<SourceId>('55555555-5555-4555-8555-555555555555'),
          source: SOURCE_LABEL,
          adapter: 'anm',
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
