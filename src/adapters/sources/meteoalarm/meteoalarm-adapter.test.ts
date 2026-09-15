// BEACON — MeteoAlarm generic adapter tests (B3.1; ADR-009/F1/F5/F6). One adapter class, N country feeds:
// each preset yields provenance-stamped NewsItems under its OWN id/coverage/env prefix; the live rung
// degrades to the recorded-style mock when upstream is unreachable; COUNTRIES=[iso] gates coverage; the
// factories read SOURCE_METEOALARM_GR_* / SOURCE_METEOALARM_ES_* env. Deterministic past clock, NO net.
import { describe, it, expect } from 'vitest';
import { ok } from '@/domain/index.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { CachePort } from '@/ports/infra.js';
import type { Region } from '@/adapters/_shared/index.js';
import { RedundancyEngine } from '@/adapters/_shared/index.js';
import { makeMeteoalarmEsAdapter, makeMeteoalarmGrAdapter } from './meteoalarm-adapter.js';

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
const GREECE: Region = { id: 'gr', bbox: [19.3, 34.8, 29.7, 41.8], iso: 'GR' };
const SPAIN: Region = { id: 'es', bbox: [-9.4, 35.9, 4.4, 43.9], iso: 'ES' };
const mkEngine = () =>
  new RedundancyEngine({
    cache: new FakeCache(),
    nowIso: () => NOW,
    idGen: () => 'sid-meteoalarm',
  });
const env = (extra: Record<string, string> = {}): Record<string, string | undefined> => extra;

describe('MeteoalarmAdapter (generic, per-country presets)', () => {
  it('meteoalarm-gr MOCK serves the labelled hand-authored fixture as provenance-stamped NewsItems', async () => {
    const made = makeMeteoalarmGrAdapter(mkEngine(), env());
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const res = await made.value.fetch(GREECE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.degraded).toBe(true);
    expect(res.value.records).toHaveLength(2);
    const first = res.value.records[0];
    expect(first?.entity.title).toContain('Greece - Attica');
    expect(first?.entity.url).toContain('feeds-greece');
    expect(first?.provenance.source).toBe('MeteoAlarm');
    expect(first?.provenance.adapter).toBe('meteoalarm-gr');
    expect(first?.provenance.mode).toBe('MOCK');
    expect(first?.provenance.license).toContain('CC BY 4.0');
  });

  it('meteoalarm-es MOCK serves the Spain fixture under its own id (no cross-country bleed)', async () => {
    const made = makeMeteoalarmEsAdapter(mkEngine(), env());
    if (!made.ok) throw new Error('factory failed');
    const res = await made.value.fetch(SPAIN);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.records).toHaveLength(2);
    expect(res.value.records[0]?.entity.title).toContain('Spain - Sevilla');
    expect(res.value.records[0]?.provenance.adapter).toBe('meteoalarm-es');
  });

  it('COUNTRIES=[GR] coverage rejects a non-GR region with NOT_COVERED (OP4) — incl. RO', async () => {
    const made = makeMeteoalarmGrAdapter(mkEngine(), env());
    if (!made.ok) throw new Error('factory failed');
    const res = await made.value.fetch({ id: 'ro', bbox: [20, 43, 30, 48], iso: 'RO' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('NOT_COVERED');
  });

  it('LIVE mode degrades to the recorded-style mock when upstream is unreachable (F5 → OP3)', async () => {
    const made = makeMeteoalarmEsAdapter(
      mkEngine(),
      env({
        SOURCE_METEOALARM_ES_MODE: 'LIVE',
        SOURCE_METEOALARM_ES_URL: 'http://127.0.0.1:9',
        SOURCE_METEOALARM_ES_TIMEOUT_MS: '400',
      }),
    );
    if (!made.ok) throw new Error('factory failed');
    const res = await made.value.fetch(SPAIN);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mode).toBe('MOCK');
    expect(res.value.records.length).toBeGreaterThan(0);
  });

  it('outward NewsIntelPort filters by query and reports identity/coverage/health per preset', async () => {
    const made = makeMeteoalarmGrAdapter(mkEngine(), env());
    if (!made.ok) throw new Error('factory failed');
    const adapter = made.value;
    expect(adapter.id).toBe('meteoalarm-gr');
    expect(adapter.coverage).toEqual({ kind: 'COUNTRIES', iso: ['GR'] });
    expect(adapter.health().state).toBe('CLOSED');
    const res = await adapter.fetchNews('crete');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data).toHaveLength(1);
    expect(res.value.data[0]?.title).toContain('Crete');
    expect(res.value.freshness.fetchedAt).toBe(NOW);
  });

  it('factories fail fast (CONFIG) on an invalid mode, per their OWN env prefix', () => {
    const gr = makeMeteoalarmGrAdapter(mkEngine(), env({ SOURCE_METEOALARM_GR_MODE: 'bogus' }));
    expect(gr.ok).toBe(false);
    if (!gr.ok) expect(gr.error.kind).toBe('CONFIG');
    // The ES factory ignores the GR prefix (per-country isolation): same env builds fine.
    const es = makeMeteoalarmEsAdapter(mkEngine(), env({ SOURCE_METEOALARM_GR_MODE: 'bogus' }));
    expect(es.ok).toBe(true);
  });
});

// ── Content negotiation (2026-09-12) ──────────────────────────────────────────────────────────────────
//
// Three sources — meteoalarm-ro, -es and -gr — served MOCK on the live deployment with `HTTP 406` in the
// log while configured live. Verified against feeds.meteoalarm.org the same day: the edge accepts the
// request with no Accept header and with a q-weighted list, and refuses the exact single type
// `application/atom+xml` that this adapter used to send. The header is therefore load-bearing, and a
// well-meaning "tidy it up to just the type we parse" edit would silently take three countries' weather
// warnings off the board again. That is what this test is for.
describe('the live rung asks for content the way a browser does', () => {
  it('sends an Accept header that offers a fallback, not one exact type', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = ((url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return Promise.resolve(
        new Response('<feed xmlns="http://www.w3.org/2005/Atom"></feed>', { status: 200 }),
      );
    }) as typeof fetch;
    try {
      const made = makeMeteoalarmGrAdapter(mkEngine(), env({ SOURCE_METEOALARM_GR_MODE: 'live' }));
      expect(made.ok).toBe(true);
      if (!made.ok) return;
      await made.value.fetch(GREECE);
    } finally {
      globalThis.fetch = original;
    }
    expect(calls).toHaveLength(1);
    const headers = calls[0]?.init?.headers as Record<string, string> | undefined;
    const accept = headers?.['Accept'] ?? '';
    // The precise type is still offered FIRST — this is content negotiation, not a shrug.
    expect(accept.startsWith('application/atom+xml')).toBe(true);
    // …and something weaker follows it, which is the half the server was refusing to do without.
    expect(accept).toMatch(/q=0\.\d/);
    expect(headers?.['User-Agent']).toContain('BEACON');
  });
});
