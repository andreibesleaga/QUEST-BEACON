// BEACON — audit-log read handler tests (E7·routes; register row 18). DETERMINISTIC: fixed clock, a real
// in-memory AuditChain, no IO. Asserts the VERIFIER+ gate, the envelope contract, chain-order paging with
// re-linkable prevHash→hash adjacency, the limit clamp, and that tampering flips `chainVerified` to false.
import { describe, it, expect } from 'vitest';
import {
  handleAuditEvents,
  AUDIT_EVENTS_DEFAULT_LIMIT,
  AUDIT_EVENTS_MAX_LIMIT,
  type AuditEventsData,
  type AuditEventsPage,
} from './audit-events.js';
import { makeAuditChain, type AuditSink } from '@/adapters/compliance/audit-chain.js';
import type { AuditEvent } from '@/domain/audit-event.js';
import type { AppUserRole } from '@/domain/app-user.js';
import type { Envelope } from '@/ports/interaction.js';

const FIXED = '2026-07-05T22:00:00Z';

function chainOf(count: number): AuditSink {
  const audit = makeAuditChain();
  for (let i = 1; i <= count; i++)
    audit.append({ action: 'alert.emit', target: `alert-${i}`, at: FIXED });
  return audit;
}

const deps = (audit: AuditSink) => ({ audit, clock: () => FIXED });
const envelope = (body: unknown): Envelope => body as Envelope;
const dataOf = (body: unknown): AuditEventsData => envelope(body).data as AuditEventsData;
const pageOf = (body: unknown): AuditEventsPage => envelope(body).meta?.['page'] as AuditEventsPage;

describe('handleAuditEvents — GET /audit-events', () => {
  it.each<AppUserRole>(['PUBLIC', 'RESPONDER'])(
    'refuses %s with 403 — "view audit log" is VERIFIER/EM (CLARIFICATIONS §B.Q6)',
    async (role) => {
      const res = await handleAuditEvents({ role }, deps(chainOf(3)));
      expect(res.status).toBe(403);
      expect(envelope(res.body).errors?.[0]?.code).toBe('UNAUTHORIZED');
      expect(envelope(res.body).errors?.[0]?.message).toContain('VERIFIER+');
    },
  );

  it('serves VERIFIER the chain with non-empty provenance + freshness (F1)', async () => {
    const res = await handleAuditEvents({ role: 'VERIFIER' }, deps(chainOf(3)));
    expect(res.status).toBe(200);
    const env = envelope(res.body);
    // Provenance names the CHAIN — this is BEACON's own governance record, not an ingested feed.
    expect(env.provenance).toEqual([
      { sourceId: 'beacon-audit-chain', mode: 'LIVE', fetchedAt: FIXED },
    ]);
    expect(env.freshness).toBe(FIXED);
    const data = dataOf(res.body);
    expect(data.total).toBe(3);
    expect(data.events.length).toBe(3);
    expect(data.chainVerified).toBe(true);
  });

  it('carries the hash-chain fields and serves CHAIN ORDER so a client can re-link the page', async () => {
    const data = dataOf((await handleAuditEvents({ role: 'EM' }, deps(chainOf(3)))).body);
    const events = data.events as readonly AuditEvent[];
    expect(events[0]?.prevHash).toBeUndefined(); // genesis
    expect(events[0]?.hash).toBeTypeOf('string');
    expect(events[1]?.prevHash).toBe(events[0]?.hash);
    expect(events[2]?.prevHash).toBe(events[1]?.hash);
    expect(events.map((e) => e.target)).toEqual(['alert-1', 'alert-2', 'alert-3']);
  });

  it('pages by offset/limit and reports hasMore + a nextCursor that is the next offset', async () => {
    const audit = chainOf(5);
    const first = await handleAuditEvents({ role: 'VERIFIER', limit: 2 }, deps(audit));
    expect(dataOf(first.body).events.map((e) => e.target)).toEqual(['alert-1', 'alert-2']);
    expect(pageOf(first.body)).toEqual({ limit: 2, offset: 0, hasMore: true, nextCursor: '2' });

    const second = await handleAuditEvents({ role: 'VERIFIER', limit: 2, offset: 2 }, deps(audit));
    expect(dataOf(second.body).events.map((e) => e.target)).toEqual(['alert-3', 'alert-4']);
    expect(pageOf(second.body).nextCursor).toBe('4');

    const last = await handleAuditEvents({ role: 'VERIFIER', limit: 2, offset: 4 }, deps(audit));
    expect(dataOf(last.body).events.map((e) => e.target)).toEqual(['alert-5']);
    expect(pageOf(last.body)).toEqual({ limit: 2, offset: 4, hasMore: false, nextCursor: null });
  });

  it('an offset past the end is an empty page, not an error (total still reports the chain length)', async () => {
    const res = await handleAuditEvents({ role: 'VERIFIER', offset: 99 }, deps(chainOf(2)));
    expect(res.status).toBe(200);
    expect(dataOf(res.body).events).toEqual([]);
    expect(dataOf(res.body).total).toBe(2);
    expect(pageOf(res.body).hasMore).toBe(false);
  });

  it('defaults and clamps the page size (an unbounded append-only log is never returned whole)', async () => {
    const audit = chainOf(1);
    expect(pageOf((await handleAuditEvents({ role: 'EM' }, deps(audit))).body).limit).toBe(
      AUDIT_EVENTS_DEFAULT_LIMIT,
    );
    expect(
      pageOf((await handleAuditEvents({ role: 'EM', limit: 100_000 }, deps(audit))).body).limit,
    ).toBe(AUDIT_EVENTS_MAX_LIMIT);
    expect(
      pageOf((await handleAuditEvents({ role: 'EM', limit: 0 }, deps(audit))).body).limit,
    ).toBe(1);
  });

  it('reports chainVerified=false when the chain has been tampered with (fail-closed on read)', async () => {
    // A REAL tamper, not a stubbed verdict: rewrite a stored row's target so its recorded `hash` no longer
    // matches linkHash(prevHash, payload). `verify()` recomputes every link on read and must catch it.
    const audit = chainOf(2);
    const tampered = audit.events[1] as { target: string };
    tampered.target = 'alert-999';
    const res = await handleAuditEvents({ role: 'VERIFIER' }, deps(audit));
    expect(res.status).toBe(200); // the READ succeeds; the VERDICT is in the body, never a 5xx
    expect(dataOf(res.body).chainVerified).toBe(false);
  });

  it('an empty chain is an empty page — a fresh process has audited nothing yet', async () => {
    const res = await handleAuditEvents({ role: 'VERIFIER' }, deps(makeAuditChain()));
    expect(res.status).toBe(200);
    expect(dataOf(res.body)).toEqual({ events: [], total: 0, chainVerified: true });
  });
});
