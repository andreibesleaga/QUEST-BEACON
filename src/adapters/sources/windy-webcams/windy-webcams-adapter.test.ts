// BEACON — Windy Webcams adapter tests (E11 "Live Views" · CW1 windy-webcams lane; CameraDirectoryPort
// P16/ADR-009/F1/F5/F6). Mode-switch (mock/cached/live) each yields usable CameraFeed with the correct
// mode/degraded/freshness; the live rung degrades to the recorded mock when upstream is unreachable;
// provenance is stamped on every record; the outward CameraDirectoryPort.fetchCameras adapts the ladder
// to the Sourced envelope; the factory fails fast (CONFIG) when LIVE mode lacks WINDY_WEBCAMS_API_KEY
// (mirrors opencellid-adapter.test.ts, the KEYED exemplar).
import { describe, it, expect, vi } from 'vitest';
import { ok } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { CameraFeed } from '@/domain/camera-feed.js';
import type { SourceId } from '@/domain/index.js';
import { asId } from '@/domain/index.js';
import type { CachePort } from '@/ports/infra.js';
import type { FetchResult, Region, SourceConfig } from '@/adapters/_shared/index.js';
import { RedundancyEngine, cacheKey } from '@/adapters/_shared/index.js';
import { WindyWebcamsAdapter, makeWindyWebcamsAdapter } from './windy-webcams-adapter.js';

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

// A bbox covering both CA (west) and RO (east) — coverage is GLOBAL so region choice doesn't gate anything;
// this just exercises a realistic mixed query.
const region: Region = { id: 'demo', bbox: [-125, 32, 30, 48] };
// Deterministic clock must be safely in the past — Freshness rejects a future fetchedAt (domain invariant).
const NOW = '2026-07-05T22:00:00Z';
const mkEngine = (cache: CachePort) =>
  new RedundancyEngine({ cache, nowIso: () => NOW, idGen: () => 'sid-windy-webcams' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});

describe('WindyWebcamsAdapter mode-switch', () => {
  it('MOCK mode serves the recorded fixture as CameraFeed[] (degraded, provenance MOCK)', async () => {
    const adapter = new WindyWebcamsAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(8);
    const first = res.value.records[0];
    expect(first?.entity.kind).toBe('WEBCAM');
    expect(first?.entity.provider).toBe('windy.com');
    expect(first?.entity.viewUrl.startsWith('https://')).toBe(true);
    expect(first?.provenance.mode).toBe('MOCK');
    expect(first?.provenance.source).toBe('Windy Webcams');
    expect(first?.provenance.license).toBe('Windy Webcams API ToS (link-only; attribution required)');
    expect(first?.provenance.adapter).toBe('windy-webcams');
  });

  it('MOCK fixture carries a mix of active/inactive webcams (isLive honest-degrade)', async () => {
    const adapter = new WindyWebcamsAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const feeds = res.value.records.map((r) => r.entity);
    expect(feeds.some((f) => f.isLive === false)).toBe(true);
    expect(feeds.some((f) => f.isLive === true)).toBe(true);
  });

  it('CACHED mode serves last-known-good with degraded=true and preserved freshness (F6)', async () => {
    const cache = new FakeCache();
    cache.store.set(cacheKey('windy-webcams', region.id), seedFetchResult('2026-07-05T20:00:00Z'));
    const adapter = new WindyWebcamsAdapter({ engine: mkEngine(cache), config: cfg('CACHED') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
    expect(res.value.degraded).toBe(true);
    expect(res.value.freshness).toBe('2026-07-05T20:00:00Z');
  });

  it('LIVE mode degrades to the recorded mock when upstream is unreachable (F5 → OP3)', async () => {
    const adapter = new WindyWebcamsAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('LIVE', { url: 'http://127.0.0.1:9/webcams/api/v3/webcams', apiKey: 'k' }),
      breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
    });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK'); // live down, cache empty → recorded mock, never a dead-end
    expect(res.value.records.length).toBeGreaterThan(0);
  });
});

describe('WindyWebcamsAdapter LIVE fetch (deterministic fetch stub — no real network)', () => {
  const LIVE_BODY = JSON.stringify({
    webcams: [
      {
        webcamId: 42,
        title: 'Stubbed Live Cam',
        status: 'active',
        lastUpdatedOn: '2026-07-05T21:58:00.000Z',
        location: { latitude: 44.4, longitude: 26.1 },
        urls: { detail: 'https://www.windy.com/webcams/42' },
      },
    ],
  });

  it('LIVE mode serves the upstream response: correct bbox/include URL + x-windy-api-key header, mapped CameraFeed', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL, init?: RequestInit) => {
        calls.push({ url: String(input), headers: (init?.headers as Record<string, string>) ?? {} });
        return Promise.resolve(new Response(LIVE_BODY, { status: 200 }));
      }),
    );
    try {
      const adapter = new WindyWebcamsAdapter({
        engine: mkEngine(new FakeCache()),
        config: cfg('LIVE', { url: 'https://api.windy.com/webcams/api/v3/webcams', apiKey: 'test-key-123' }),
        breaker: { failureThreshold: 5, cooldownSec: 120, timeoutMs: 400, maxRetries: 0 },
      });
      const res = await adapter.fetch(region);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.value.mode).toBe('LIVE');
      expect(res.value.degraded).toBe(false);
      expect(res.value.records).toHaveLength(1);
      expect(res.value.records[0]?.entity.title).toBe('Stubbed Live Cam');
      expect(res.value.records[0]?.entity.position).toEqual([26.1, 44.4]);
      expect(calls).toHaveLength(1);
      // region.bbox is [-125,32,30,48] ([minLon,minLat,maxLon,maxLat]); Windy's bbox is north,east,south,west.
      expect(calls[0]?.url).toBe(
        'https://api.windy.com/webcams/api/v3/webcams?bbox=48,30,32,-125&include=location,urls&limit=50',
      );
      expect(calls[0]?.headers['x-windy-api-key']).toBe('test-key-123');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('WindyWebcamsAdapter outward CameraDirectoryPort', () => {
  it('fetchCameras adapts a redundancy-ladder failure to a domain NOT_FOUND error', async () => {
    const adapter = new WindyWebcamsAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('MOCK'),
      fixturesDir: '/nonexistent-fixtures-dir-for-test',
    });
    const res = await adapter.fetchCameras({ bbox: region.bbox });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.message).toContain('Windy Webcams unavailable');
  });

  it('fetchCameras returns a Sourced envelope of CameraFeed with attribution + https viewUrl', async () => {
    const adapter = new WindyWebcamsAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetchCameras({ bbox: region.bbox });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(8);
    expect(res.value.data.every((c) => c.viewUrl.startsWith('https://'))).toBe(true);
    expect(res.value.data.every((c) => c.provider === 'windy.com')).toBe(true);
    expect(res.value.data.every((c) => c.license === 'Windy Webcams API ToS (link-only; attribution required)')).toBe(
      true,
    );
    expect(res.value.freshness.fetchedAt).toBe('2026-07-05T22:00:00Z');
  });

  it('reports a healthy (CLOSED) breaker before any failure', () => {
    const adapter = new WindyWebcamsAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('windy-webcams');
    expect(adapter.coverage).toEqual({ kind: 'GLOBAL' });
  });
});

describe('makeWindyWebcamsAdapter factory', () => {
  it('builds a CACHED adapter from env by default mode', () => {
    const res = makeWindyWebcamsAdapter(mkEngine(new FakeCache()), {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
  });

  it('builds a MOCK adapter from env', () => {
    const res = makeWindyWebcamsAdapter(mkEngine(new FakeCache()), { SOURCE_WINDY_WEBCAMS_MODE: 'MOCK' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
  });

  it('builds a LIVE adapter from env when WINDY_WEBCAMS_API_KEY is set', () => {
    const res = makeWindyWebcamsAdapter(mkEngine(new FakeCache()), {
      SOURCE_WINDY_WEBCAMS_MODE: 'LIVE',
      WINDY_WEBCAMS_API_KEY: 'test-key',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('LIVE');
  });

  it('fails fast (CONFIG) when LIVE mode lacks WINDY_WEBCAMS_API_KEY', () => {
    const res = makeWindyWebcamsAdapter(mkEngine(new FakeCache()), { SOURCE_WINDY_WEBCAMS_MODE: 'LIVE' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });
});

function seedFetchResult(fetchedAt: string): FetchResult<CameraFeed> {
  const entity: CameraFeed = {
    id: asId<CameraFeed['id']>('windy:1358084658'),
    position: [-122.4783, 37.8199],
    kind: 'WEBCAM',
    title: 'Golden Gate Bridge View',
    provider: 'windy.com',
    viewUrl: 'https://www.windy.com/webcams/1358084658',
    license: 'Windy Webcams API ToS (link-only; attribution required)',
    isLive: true,
  };
  return {
    records: [
      {
        entity,
        provenance: {
          id: asId<SourceId>('55555555-5555-4555-8555-555555555555'),
          source: 'Windy Webcams',
          adapter: 'windy-webcams',
          fetchedAt,
          license: 'Windy Webcams API ToS (link-only; attribution required)',
          mode: 'LIVE',
        },
      },
    ],
    freshness: fetchedAt,
    mode: 'LIVE',
    degraded: false,
  };
}
