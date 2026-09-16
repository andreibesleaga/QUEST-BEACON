// BEACON — CNADNR-RO adapter tests (CameraDirectoryPort P16; adapter-contract, ADR-009/027, Art. XVI).
// MOCK-only adapter: MOCK serves the curated fixture; the factory fails fast (CONFIG) on LIVE (no
// machine-readable upstream); CACHED degrades to the same recorded mock; the outward
// CameraDirectoryPort.fetchCameras adapts the ladder to the Sourced envelope and bbox-filters the curated
// catalog; a bbox outside Romania is NOT_COVERED. Fixed clock '2026-07-05T22:00:00Z' — no network.
import { describe, it, expect } from 'vitest';
import { ok } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { CachePort } from '@/ports/infra.js';
import type { Region, SourceConfig } from '@/adapters/_shared/index.js';
import { RedundancyEngine } from '@/adapters/_shared/index.js';
import { CnadnrRoAdapter, makeCnadnrRoAdapter } from './cnadnr-ro-adapter.js';

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
const ROMANIA: Region = { id: 'ro', bbox: [20, 43, 30, 48], iso: 'RO' };
const mkEngine = (cache: CachePort) =>
  new RedundancyEngine({ cache, nowIso: () => NOW, idGen: () => 'sid-cnadnr-ro' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});

describe('CnadnrRoAdapter mode-switch', () => {
  it('MOCK mode serves the curated fixture as provenance-stamped TRAFFIC_CCTV CameraFeeds', async () => {
    const adapter = new CnadnrRoAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch(ROMANIA);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(5);
    const first = res.value.records[0];
    expect(first?.entity.kind).toBe('TRAFFIC_CCTV');
    expect(first?.entity.isLive).toBe(true);
    expect(first?.provenance.mode).toBe('MOCK');
    expect(first?.provenance.source).toBe('CNADNR/CNAIR Trafic Live');
    expect(first?.provenance.license).toBe('Official public agency pages (link-only)');
    expect(first?.provenance.adapter).toBe('cnadnr-ro');
  });

  it('CACHED mode with an empty cache falls through to the curated mock (no live rung ever populates it)', async () => {
    const adapter = new CnadnrRoAdapter({
      engine: mkEngine(new FakeCache()),
      config: cfg('CACHED'),
    });
    const res = await adapter.fetch(ROMANIA);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records.length).toBeGreaterThan(0);
  });

  it('COUNTRIES=[RO] coverage rejects a non-RO region with NOT_COVERED (OP4)', async () => {
    const adapter = new CnadnrRoAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch({ id: 'us', bbox: [-124, 32, -114, 42], iso: 'US' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('NOT_COVERED');
  });
});

describe('CnadnrRoAdapter outward CameraDirectoryPort', () => {
  it('fetchCameras returns a Sourced envelope of every curated CameraFeed for a Romania-wide bbox', async () => {
    const adapter = new CnadnrRoAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetchCameras({ bbox: ROMANIA.bbox });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(5);
    expect(res.value.data[0]).toHaveProperty('viewUrl');
    expect(res.value.freshness.fetchedAt).toBe(NOW);
  });

  it('bbox-filters the curated catalog to only the cameras inside a narrower Fetesti-only window', async () => {
    const adapter = new CnadnrRoAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    // A tight box around Fetesti (44.38,27.83) that excludes Giurgiu (43.90,25.97).
    const res = await adapter.fetchCameras({ bbox: [27.5, 44.2, 28.1, 44.5] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(3);
    expect(res.value.data.every((c) => c.title.startsWith('Fetesti'))).toBe(true);
  });

  it('NOT_COVERED (as a DomainError) for a bbox entirely inside the US (outside RO coverage)', async () => {
    const adapter = new CnadnrRoAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetchCameras({ bbox: [-124, 32, -114, 42] });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.message).toMatch(/NOT_COVERED/);
  });

  it('reports a healthy (CLOSED) breaker and correct identity/coverage', () => {
    const adapter = new CnadnrRoAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('cnadnr-ro');
    expect(adapter.coverage).toEqual({ kind: 'COUNTRIES', iso: ['RO'] });
  });
});

describe('makeCnadnrRoAdapter factory', () => {
  it('builds a MOCK adapter from env (default mode)', () => {
    const res = makeCnadnrRoAdapter(mkEngine(new FakeCache()), {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
  });

  it('builds a MOCK adapter from an explicit SOURCE_CNADNR_RO_MODE=mock env', () => {
    const res = makeCnadnrRoAdapter(mkEngine(new FakeCache()), { SOURCE_CNADNR_RO_MODE: 'mock' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
  });

  it('fails fast (CONFIG) on LIVE — CNADNR/CNAIR has no machine-readable feed, honest gating', () => {
    const res = makeCnadnrRoAdapter(mkEngine(new FakeCache()), { SOURCE_CNADNR_RO_MODE: 'LIVE' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
    expect(res.error.message).toMatch(/no machine-readable|no live endpoint/i);
  });

  it('rejects an invalid mode (CONFIG, fail-fast)', () => {
    const res = makeCnadnrRoAdapter(mkEngine(new FakeCache()), { SOURCE_CNADNR_RO_MODE: 'bogus' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });
});
