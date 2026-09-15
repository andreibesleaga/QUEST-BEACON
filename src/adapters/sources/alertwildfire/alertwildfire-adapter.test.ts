// BEACON — ALERTWildfire adapter tests (ADR-027/F1/F5/F6). Each mode yields provenance-stamped CameraFeed
// rows (the recorded fixture is 15 Butte-area FIRE_CAMERAs); the live rung degrades to the recorded mock
// when upstream is unreachable; COUNTRIES[US] coverage gates non-US regions; the outward
// CameraDirectoryPort adapts the ladder and bbox-scopes the mapped cameras to the query; the factory reads
// SOURCE_ALERTWILDFIRE_* env and defaults to CACHED (plan Q3 — keyless but live-capable). Deterministic
// clock is safely in the past (no network in tests).
import { describe, it, expect } from 'vitest';
import { ok, asId, makeCameraFeed } from '@/domain/index.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { CameraFeed } from '@/domain/index.js';
import type { CameraFeedId, SourceId } from '@/domain/value-objects/ids.js';
import type { CachePort } from '@/ports/infra.js';
import type { FetchResult, Region, SourceConfig } from '@/adapters/_shared/index.js';
import { RedundancyEngine, cacheKey } from '@/adapters/_shared/index.js';
import { AlertWildfireAdapter, makeAlertWildfireAdapter } from './alertwildfire-adapter.js';

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
const BUTTE: Region = { id: 'us-butte', bbox: [-122.0, 39.0, -120.9, 40.2], iso: 'US' };
const mkEngine = (cache: CachePort) =>
  new RedundancyEngine({ cache, nowIso: () => NOW, idGen: () => 'sid-alert' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});

describe('AlertWildfireAdapter mode-switch', () => {
  it('MOCK mode serves the recorded fixture as 15 FIRE_CAMERA CameraFeeds', async () => {
    const adapter = new AlertWildfireAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    const res = await adapter.fetch(BUTTE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(15);
    const first = res.value.records[0];
    expect(first?.entity.kind).toBe('FIRE_CAMERA');
    expect(first?.entity.provider).toBe('ALERTCalifornia | UC San Diego');
    expect(first?.entity.viewUrl.startsWith('https://')).toBe(true);
    expect(first?.provenance.source).toBe('ALERTCalifornia');
    expect(first?.provenance.adapter).toBe('alertwildfire');
    expect(first?.provenance.mode).toBe('MOCK');
    expect(first?.provenance.license).toContain('CC BY-NC-ND 4.0');
    expect(first?.provenance.license).toContain('ALERTCalifornia | UC San Diego');
  });

  it('CACHED mode serves last-known-good with degraded=true and preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    cache.store.set(cacheKey('alertwildfire', BUTTE.id), seedFetchResult('2026-07-05T20:00:00Z'));
    const adapter = new AlertWildfireAdapter({ engine: mkEngine(cache), config: cfg('CACHED') });
    const res = await adapter.fetch(BUTTE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.freshness).toBe('2026-07-05T20:00:00Z');
  });

  it('LIVE mode degrades to the recorded mock when upstream is unreachable (F5 → OP3)', async () => {
    const adapter = new AlertWildfireAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'http://127.0.0.1:9' }),
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(BUTTE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.records.length).toBeGreaterThan(0);
  });

  it('COUNTRIES[US] coverage serves a US region', async () => {
    const adapter = new AlertWildfireAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    expect((await adapter.fetch(BUTTE)).ok).toBe(true);
  });

  it('COUNTRIES[US] coverage rejects a non-US region as NOT_COVERED', async () => {
    const adapter = new AlertWildfireAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    const res = await adapter.fetch({ id: 'ro', bbox: [20, 43, 30, 48], iso: 'RO' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('NOT_COVERED');
  });
});

describe('AlertWildfireAdapter outward CameraDirectoryPort', () => {
  it('fetchCameras returns a Sourced envelope of CameraFeed with freshness', async () => {
    const adapter = new AlertWildfireAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    const res = await adapter.fetchCameras({ bbox: BUTTE.bbox });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(15);
    expect(res.value.freshness.fetchedAt).toBe(NOW);
    expect(res.value.data.every((c) => c.kind === 'FIRE_CAMERA')).toBe(true);
  });

  it('fetchCameras bbox-scopes the mapped cameras to the query window', async () => {
    const adapter = new AlertWildfireAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    // Tight window around Bald Mtn (Butte): only its two colocated cameras fall inside.
    const res = await adapter.fetchCameras({ bbox: [-121.5, 39.94, -121.46, 39.96] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(2);
    expect(res.value.data.every((c) => c.title.startsWith('Bald Mtn'))).toBe(true);
  });

  it('reports a healthy (CLOSED) breaker and correct identity/coverage', () => {
    const adapter = new AlertWildfireAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
    });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('alertwildfire');
    expect(adapter.coverage).toEqual({ kind: 'COUNTRIES', iso: ['US'] });
  });
});

describe('makeAlertWildfireAdapter factory', () => {
  it('defaults to CACHED mode (not MOCK) when SOURCE_ALERTWILDFIRE_MODE is unset (plan Q3)', () => {
    const res = makeAlertWildfireAdapter(mkEngine(new FakeCache()), {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
  });

  it('builds a MOCK adapter from env when explicitly requested', () => {
    const res = makeAlertWildfireAdapter(mkEngine(new FakeCache()), {
      SOURCE_ALERTWILDFIRE_MODE: 'MOCK',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
  });

  it('rejects an invalid mode (CONFIG fail-fast)', () => {
    const res = makeAlertWildfireAdapter(mkEngine(new FakeCache()), {
      SOURCE_ALERTWILDFIRE_MODE: 'bogus',
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });
});

function seedFetchResult(fetchedAt: string): FetchResult<CameraFeed> {
  const entity = makeCameraFeed({
    id: asId<CameraFeedId>('alertwildfire:10'),
    position: [-121.482498, 39.952499],
    kind: 'FIRE_CAMERA',
    title: 'Bald Mtn. (Butte) 1',
    provider: 'ALERTCalifornia | UC San Diego',
    viewUrl: 'https://cameras.alertcalifornia.org/?id=Axis-BaldMtnButte1',
    license: 'CC BY-NC-ND 4.0 (imagery; link-only use)',
    isLive: true,
  });
  return {
    records: [
      {
        entity,
        provenance: {
          id: asId<SourceId>('77777777-7777-4777-8777-777777777777'),
          source: 'ALERTCalifornia',
          adapter: 'alertwildfire',
          fetchedAt,
          license: 'CC BY-NC-ND 4.0 (imagery; link-only use) — ALERTCalifornia | UC San Diego',
          mode: 'LIVE',
        },
      },
    ],
    freshness: fetchedAt,
    mode: 'LIVE',
    degraded: false,
  };
}
