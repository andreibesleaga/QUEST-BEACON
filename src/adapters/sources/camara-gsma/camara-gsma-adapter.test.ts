// BEACON — CAMARA/GSMA adapter tests (TelecomPort P13; adapter-contract, ADR-009, Art. XIV/XVI).
// MOCK-only adapter: MOCK serves the recorded fixture; the factory fails fast (CONFIG) on LIVE (operator
// sandbox required); CACHED degrades to the same recorded mock (no live rung ever exists to warm a
// cache); the outward TelecomPort.fetchCoverage adapts the ladder to the Sourced envelope; provenance is
// stamped on every record; health starts CLOSED.
import { describe, it, expect } from 'vitest';
import { ok } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { CachePort } from '@/ports/infra.js';
import type { SourceConfig } from '@/adapters/_shared/index.js';
import { RedundancyEngine } from '@/adapters/_shared/index.js';
import { CamaraGsmaAdapter, makeCamaraGsmaAdapter } from './camara-gsma-adapter.js';

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

const region = { id: 'ca', bbox: [-124, 32, -114, 42] as const };
const mkEngine = (cache: CachePort) =>
  new RedundancyEngine({ cache, nowIso: () => '2026-07-15T00:00:00Z', idGen: () => 'sid-camara' });
const cfg = (mode: SourceConfig['mode'], extra: Partial<SourceConfig> = {}): SourceConfig => ({
  mode,
  timeoutMs: 400,
  ...extra,
});

describe('CamaraGsmaAdapter mode-switch', () => {
  it('MOCK mode serves the recorded fixture as TelecomCoverage (degraded, provenance MOCK)', async () => {
    const adapter = new CamaraGsmaAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(4);
    const first = res.value.records[0];
    expect(first?.entity.online).toBe(true);
    expect(first?.provenance.mode).toBe('MOCK');
    expect(first?.provenance.source).toBe('CAMARA / GSMA Open Gateway');
    expect(first?.provenance.license).toBe('operator terms (CAMARA/GSMA)');
    expect(first?.provenance.adapter).toBe('camara-gsma');
  });

  it('CACHED mode with an empty cache degrades to the recorded mock (documented CACHED≈MOCK behavior)', async () => {
    const adapter = new CamaraGsmaAdapter({ engine: mkEngine(new FakeCache()), config: cfg('CACHED') });
    const res = await adapter.fetch(region);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK'); // no live rung ever exists to populate the cache
    expect(res.value.degraded).toBe(true);
    expect(res.value.records.length).toBeGreaterThan(0);
  });
});

describe('CamaraGsmaAdapter outward TelecomPort', () => {
  it('fetchCoverage returns a Sourced envelope of TelecomCoverage with freshness', async () => {
    const adapter = new CamaraGsmaAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    const res = await adapter.fetchCoverage({ bbox: region.bbox });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(4);
    expect(res.value.data[0]).toHaveProperty('online');
    expect(res.value.freshness.fetchedAt).toBe('2026-07-15T00:00:00Z');
  });

  it('reports a healthy (CLOSED) breaker before any failure', () => {
    const adapter = new CamaraGsmaAdapter({ engine: mkEngine(new FakeCache()), config: cfg('MOCK') });
    expect(adapter.health().state).toBe('CLOSED');
    expect(adapter.id).toBe('camara-gsma');
    expect(adapter.coverage).toEqual({ kind: 'GLOBAL' });
  });
});

describe('makeCamaraGsmaAdapter factory', () => {
  it('builds a MOCK adapter from env (default mode)', () => {
    const res = makeCamaraGsmaAdapter(mkEngine(new FakeCache()), {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
  });

  it('builds a CACHED adapter from env', () => {
    const res = makeCamaraGsmaAdapter(mkEngine(new FakeCache()), { SOURCE_CAMARA_GSMA_MODE: 'CACHED' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('CACHED');
  });

  it('fails fast (CONFIG) on LIVE — operator sandbox agreement required, honest gating', () => {
    const res = makeCamaraGsmaAdapter(mkEngine(new FakeCache()), { SOURCE_CAMARA_GSMA_MODE: 'LIVE' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
    expect(res.error.message).toMatch(/operator sandbox agreement/i);
    expect(res.error.message).toMatch(/contracts? an operator/i);
  });
});
