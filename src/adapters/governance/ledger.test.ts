// BEACON — governance ledger tests (MW-D/D4; ADR-034 §5, FR-GOV-1 / FEV-19, Art. XIV).
// Deterministic: every instant is injected, nothing reads a clock or a network.
import { describe, expect, it } from 'vitest';
import { isErr, isOk } from '@/domain/shared/result.js';
import { evidenceDigest, verifyAuditLink } from '@/domain/audit-event.js';
import { LEDGER_ACTIONS } from '@/domain/governance.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { AppUserId, IncidentId } from '@/domain/value-objects/ids.js';
import { makeAuditChain } from '@/adapters/compliance/audit-chain.js';
import { makeAlertSink } from '@/adapters/alerting/alert-sink.js';
import { makeAlert } from '@/domain/alert.js';
import type { EmittableAlert } from '@/ports/logistics.js';
import type { AlertId } from '@/domain/value-objects/ids.js';
import { makeGovernanceLedger } from './ledger.js';

const T0 = '2026-07-05T22:00:00.000Z';
const T1 = '2026-07-05T22:05:00.000Z';
const em = asId<AppUserId>('u-em-1');

describe('makeGovernanceLedger — append-only chain', () => {
  it('links every entry to its predecessor and numbers them 1..n', () => {
    const ledger = makeGovernanceLedger();
    const a = ledger.append({ action: 'EAP_EVAL', target: 'eap:ro#ep-1', at: T0 });
    const b = ledger.append({
      action: 'EAP_ACTIVATE',
      target: 'eap:ro#ep-1',
      at: T1,
      actorId: em,
      actorRole: 'EM',
    });
    expect(isOk(a) && isOk(b)).toBe(true);
    if (!isOk(a) || !isOk(b)) return;
    expect(a.value.seq).toBe(1);
    expect(a.value.prevHash).toBeUndefined();
    expect(b.value.seq).toBe(2);
    expect(b.value.prevHash).toBe(a.value.hash);
    expect(ledger.entries).toHaveLength(2);
    expect(ledger.verify()).toEqual({ intact: true, entries: 2 });
  });

  it('REUSES the existing chain primitive — every entry verifies with the domain `verifyAuditLink`', () => {
    // The point of ADR-034 §5: one chain, one verifier. If this ledger had invented its own linking, the
    // domain's own verifier would not accept its events.
    const audit = makeAuditChain();
    const ledger = makeGovernanceLedger({ audit });
    ledger.append({ action: 'EAP_EVAL', target: 'eap:ro#ep-1', at: T0 });
    ledger.append({ action: 'EAP_STOP', target: 'eap:ro#ep-1', at: T1 });
    let prev: string | undefined;
    for (const event of audit.events) {
      expect(verifyAuditLink(event, prev)).toBe(true);
      prev = event.hash;
    }
    expect(audit.verify()).toBe(true);
  });

  it('shares ONE chain with the CAP emitter when the same AuditSink is injected', () => {
    // Governance decisions and alert emissions must be one verifiable sequence, not two logs to reconcile.
    const audit = makeAuditChain();
    const ledger = makeGovernanceLedger({ audit });
    const sink = makeAlertSink({ clock: () => T1, audit });
    ledger.append({
      action: 'EAP_ACTIVATE',
      target: 'eap:ro#ep-1',
      at: T0,
      actorId: em,
      actorRole: 'EM',
    });
    const alert = makeAlert({
      id: asId<AlertId>('al-1'),
      incidentId: asId<IncidentId>('inc-1'),
      category: 'Met',
      severity: 'SEVERE',
      capStatus: 'ACTUAL',
      approvedBy: em,
    }) as EmittableAlert;
    return sink.emit(alert).then((res) => {
      expect(isOk(res)).toBe(true);
      expect(audit.events.map((e) => e.action)).toEqual(['EAP_ACTIVATE', 'ALERT_EMIT']);
      expect(audit.events[1]?.prevHash).toBe(audit.events[0]?.hash);
      expect(ledger.verify().intact).toBe(true);
      // The ledger's own read model stays scoped to what IT wrote, while verification covers the whole chain.
      expect(ledger.entries).toHaveLength(1);
      expect(ledger.verify().entries).toBe(2);
    });
  });
});

describe('tamper evidence', () => {
  it('detects a SPLICED chain entry and names where it broke', () => {
    const audit = makeAuditChain();
    const ledger = makeGovernanceLedger({ audit });
    ledger.append({ action: 'EAP_EVAL', target: 'eap:ro#ep-1', at: T0 });
    ledger.append({ action: 'EAP_ACTIVATE', target: 'eap:ro#ep-1', at: T1, actorId: em });
    ledger.append({ action: 'EAP_STOP', target: 'eap:ro#ep-1', at: T1 });
    // Rewrite history IN PLACE: make the activation look like a mere evaluation. (`audit.events` hands back
    // a fresh array of the SAME event objects, so this mutates the stored entry — the real tamper vector.)
    const target = audit.events[1] as unknown as { action: string };
    target.action = 'EAP_EVAL';
    const verdict = ledger.verify();
    expect(verdict.intact).toBe(false);
    expect(verdict.brokenAt).toBe(2);
    expect(verdict.reason).toBe('CHAIN_LINK');
  });

  it('detects MUTATED evidence even though the chain links still verify', () => {
    const ledger = makeGovernanceLedger();
    const appended = ledger.append({
      action: 'EAP_EVAL',
      target: 'eap:ro#ep-1',
      at: T0,
      evidence: { membersOverThreshold: 34, memberTotal: 51 },
    });
    expect(isOk(appended)).toBe(true);
    if (!isOk(appended)) return;
    expect(ledger.verify().intact).toBe(true);
    // The evidence lives beside the chain; the chain binds it by digest. Edit it and the binding breaks.
    const stored = ledger.evidenceFor(appended.value.evidenceDigest ?? '') as {
      evidence: { membersOverThreshold: number };
    };
    stored.evidence.membersOverThreshold = 50;
    const verdict = ledger.verify();
    expect(verdict.intact).toBe(false);
    expect(verdict.brokenAt).toBe(1);
    expect(verdict.reason).toBe('EVIDENCE_DIGEST');
  });

  it('binds the evidence into the chain hash itself (the digest is not decorative)', () => {
    const bare = makeGovernanceLedger().append({ action: 'EAP_EVAL', target: 't', at: T0 });
    const withEvidence = makeGovernanceLedger().append({
      action: 'EAP_EVAL',
      target: 't',
      at: T0,
      evidence: { members: 34 },
    });
    expect(isOk(bare) && isOk(withEvidence)).toBe(true);
    if (!isOk(bare) || !isOk(withEvidence)) return;
    expect(withEvidence.value.hash).not.toBe(bare.value.hash);
    expect(withEvidence.value.evidenceDigest).toBe(evidenceDigest({ evidence: { members: 34 } }));
  });

  it('content-addresses evidence: identical evidence yields one stored record', () => {
    const ledger = makeGovernanceLedger();
    const a = ledger.append({
      action: 'EAP_EVAL',
      target: 't1',
      at: T0,
      evidence: { members: 34 },
    });
    const b = ledger.append({
      action: 'EAP_EVAL',
      target: 't2',
      at: T1,
      evidence: { members: 34 },
    });
    expect(isOk(a) && isOk(b) && a.value.evidenceDigest).toBe(
      isOk(b) ? b.value.evidenceDigest : '',
    );
    expect(ledger.verify().intact).toBe(true);
  });
});

describe('fail-closed input handling', () => {
  it('refuses an action outside the closed vocabulary and writes nothing', () => {
    const ledger = makeGovernanceLedger();
    const res = ledger.append({
      action: 'DROP_TABLE' as (typeof LEDGER_ACTIONS)[number],
      target: 't',
      at: T0,
    });
    expect(isErr(res) && res.error.code).toBe('INVARIANT_VIOLATION');
    expect(ledger.entries).toHaveLength(0);
    expect(ledger.verify().entries).toBe(0);
  });

  it('refuses an empty target and a non-instant `at` (no wall-clock default exists)', () => {
    const ledger = makeGovernanceLedger();
    expect(isErr(ledger.append({ action: 'EAP_EVAL', target: '  ', at: T0 }))).toBe(true);
    const bad = ledger.append({ action: 'EAP_EVAL', target: 't', at: 'now-ish' });
    expect(isErr(bad) && bad.error.message).toMatch(/injected clock/);
    expect(ledger.entries).toHaveLength(0);
  });

  it('REFUSES evidence carrying a person-identifying key, naming the path but never the value', () => {
    const ledger = makeGovernanceLedger();
    const res = ledger.append({
      action: 'EAP_ACTIVATE',
      target: 'eap:ro#ep-1',
      at: T0,
      evidence: { decidedBy: { role: 'EM', email: 'chief@example.org' } },
    });
    expect(isErr(res)).toBe(true);
    if (!isErr(res)) return;
    expect(res.error.code).toBe('CONFLICT');
    expect(res.error.message).toContain('evidence.decidedBy.email');
    expect(res.error.message).not.toContain('chief@example.org'); // the refusal must not copy the datum
    expect(ledger.entries).toHaveLength(0);
  });

  it('accepts an actor id and role — an actor is an id and a role, never a name (Art. XIV)', () => {
    const ledger = makeGovernanceLedger();
    const res = ledger.append({
      action: 'SOP_APPROVE',
      target: 'eap:ro#ep-1',
      at: T0,
      actorId: em,
      actorRole: 'VERIFIER',
      incidentId: asId<IncidentId>('inc-1'),
      regionId: 'ro',
    });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.actorId).toBe('u-em-1');
    expect(res.value.actorRole).toBe('VERIFIER');
    // The role is bound by the digest, so it is as tamper-evident as everything else on the entry.
    expect(ledger.evidenceFor(res.value.evidenceDigest ?? '')).toEqual({ actorRole: 'VERIFIER' });
  });

  it('returns undefined for an unknown digest rather than inventing evidence', () => {
    expect(makeGovernanceLedger().evidenceFor('nope')).toBeUndefined();
  });

  it('records every action in the closed vocabulary (the enum is exercised, not merely declared)', () => {
    const ledger = makeGovernanceLedger();
    for (const action of LEDGER_ACTIONS) {
      expect(isOk(ledger.append({ action, target: `t:${action}`, at: T0 }))).toBe(true);
    }
    expect(ledger.entries).toHaveLength(LEDGER_ACTIONS.length);
    expect(ledger.verify().intact).toBe(true);
  });
});
