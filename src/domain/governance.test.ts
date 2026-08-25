// BEACON — governance domain tests (MW-D/D4; ADR-034 §5/§6, Art. XIII/XIV).
// Deterministic: every instant is a literal, no clock is read anywhere in this file.
import { describe, expect, it } from 'vitest';
import {
  APPROVER_ROLES,
  LEDGER_ACTIONS,
  assertValidSopChain,
  findPersonIdentifyingKey,
  isApproverRole,
  makeLedgerEntry,
  resolveApproval,
  responsibleRoles,
} from './governance.js';
import type { ApprovalAttempt, LedgerEntry, SopChainConfig } from './governance.js';
import { APP_USER_ROLES } from './app-user.js';
import { PERSON_IDENTIFYING_KEYS } from './shared/aggregate-only.js';
import { InvariantViolation } from './errors.js';
import { asId } from './value-objects/ids.js';
import type { AppUserId } from './value-objects/ids.js';

const T0 = '2026-07-05T22:00:00.000Z'; // the project's fixed test clock
const em = asId<AppUserId>('u-em-1');
const verifier = asId<AppUserId>('u-ver-1');

const chain: SopChainConfig = { authorizerRole: 'EM', fallbackRole: 'VERIFIER', fallbackAfterMinutes: 30 };

const entry = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  seq: 1,
  action: 'EAP_ACTIVATE',
  target: 'eap:ro-flood#ep-1',
  at: T0,
  hash: 'abcd1234',
  ...over,
});

describe('closed vocabularies', () => {
  it('APPROVER_ROLES is a strict subset of APP_USER_ROLES and excludes PUBLIC/RESPONDER', () => {
    for (const role of APPROVER_ROLES) expect(APP_USER_ROLES).toContain(role);
    expect(isApproverRole('PUBLIC')).toBe(false);
    expect(isApproverRole('RESPONDER')).toBe(false);
    expect(isApproverRole('VERIFIER')).toBe(true);
    expect(isApproverRole('EM')).toBe(true);
  });

  it('LEDGER_ACTIONS has no duplicates (a duplicated action would double-count an audit)', () => {
    expect(new Set(LEDGER_ACTIONS).size).toBe(LEDGER_ACTIONS.length);
  });
});

describe('findPersonIdentifyingKey (Art. XIV shape guard)', () => {
  it('returns undefined for primitives, null and PII-free governance evidence', () => {
    expect(findPersonIdentifyingKey(null)).toBeUndefined();
    expect(findPersonIdentifyingKey(42)).toBeUndefined();
    expect(findPersonIdentifyingKey('a string is not a key')).toBeUndefined();
    expect(findPersonIdentifyingKey({ expired: 3, purged: 3, cutoff: T0 })).toBeUndefined();
    // The shapes this lane's own use-cases actually write must pass, or the guard would block governance.
    expect(
      findPersonIdentifyingKey({
        actorRole: 'EM',
        evidence: { requestedAt: T0, authorizerRole: 'EM', fallbackRole: 'VERIFIER', delegated: false },
      }),
    ).toBeUndefined();
  });

  it('finds a person-identifying key at the top level and reports its path', () => {
    expect(findPersonIdentifyingKey({ email: 'x' })).toBe('email');
    expect(findPersonIdentifyingKey({ ok: 1, phoneNumber: 'x' })).toBe('phoneNumber');
  });

  it('walks nested objects and arrays, reporting the full path', () => {
    expect(findPersonIdentifyingKey({ a: { b: { firstName: 'x' } } })).toBe('a.b.firstName');
    expect(findPersonIdentifyingKey({ rows: [{ ok: 1 }, { reporterName: 'x' }] })).toBe('rows[1].reporterName');
    expect(findPersonIdentifyingKey([{ deep: [{ ssn: 'x' }] }])).toBe('[0].deep[0].ssn');
    expect(findPersonIdentifyingKey({ rows: [{ ok: 1 }, { fine: 2 }] })).toBeUndefined();
  });

  it('reuses the ONE shared denylist rather than declaring a second (ADR-035 §4 Layer C)', () => {
    // Two denylists in one system is the same defect class as two hash chains: two things to keep in step
    // and two ways to disagree. This asserts the delegation, not a copy — including the substring net,
    // which a private exact-match list of this lane's own would NOT have caught.
    for (const key of PERSON_IDENTIFYING_KEYS) expect(findPersonIdentifyingKey({ [key]: 'x' })).toBe(key);
    expect(findPersonIdentifyingKey({ contactEmail: 'x' })).toBe('contactEmail'); // substring net
    expect(findPersonIdentifyingKey({ reporterPhone: 'x' })).toBe('reporterPhone');
    // …and the ledger passes NO allowlist, so a governance record gets zero exemptions.
    expect(findPersonIdentifyingKey({ evidence: { patientId: 'p-1' } })).toBe('evidence.patientId');
  });
});

describe('makeLedgerEntry', () => {
  it('accepts a well-formed entry and freezes it (append-only: entries are never edited in place)', () => {
    const e = makeLedgerEntry(entry({ actorId: em, actorRole: 'EM', evidenceDigest: 'deadbeef', prevHash: 'aaaa1111' }));
    expect(Object.isFrozen(e)).toBe(true);
    expect(e.actorRole).toBe('EM');
    expect(e.evidenceDigest).toBe('deadbeef');
  });

  it('rejects an action outside the closed vocabulary', () => {
    expect(() => makeLedgerEntry(entry({ action: 'DELETE_EVERYTHING' as LedgerEntry['action'] }))).toThrow(
      InvariantViolation,
    );
  });

  it('rejects a non-positive/non-integer seq, an empty target, a bad instant and an empty hash', () => {
    expect(() => makeLedgerEntry(entry({ seq: 0 }))).toThrow(/positive integer/);
    expect(() => makeLedgerEntry(entry({ seq: 1.5 }))).toThrow(/positive integer/);
    expect(() => makeLedgerEntry(entry({ target: '   ' }))).toThrow(/non-empty/);
    expect(() => makeLedgerEntry(entry({ at: 'yesterday' }))).toThrow(/valid instant/);
    expect(() => makeLedgerEntry(entry({ hash: '' }))).toThrow(/non-empty/);
  });

  it('has no person-identifying field in its type surface (Art. XIV, by construction)', () => {
    const e = makeLedgerEntry(entry({ actorId: em, actorRole: 'EM' }));
    expect(findPersonIdentifyingKey({ ...e })).toBeUndefined();
  });
});

describe('responsibleRoles (pure function of the injected clock)', () => {
  it('is the primary authorizer alone before the fallback window elapses', () => {
    expect(responsibleRoles(chain, T0, T0)).toEqual(['EM']);
    expect(responsibleRoles(chain, T0, '2026-07-05T22:29:59.999Z')).toEqual(['EM']);
  });

  it('adds the fallback role at exactly the boundary and after it (inclusive)', () => {
    expect(responsibleRoles(chain, T0, '2026-07-05T22:30:00.000Z')).toEqual(['EM', 'VERIFIER']);
    expect(responsibleRoles(chain, T0, '2026-07-06T09:00:00.000Z')).toEqual(['EM', 'VERIFIER']);
  });

  it('never returns an empty set — an empty set IS the deadlock this mechanism removes', () => {
    for (const now of [T0, '2026-07-05T21:00:00.000Z', '2026-07-09T00:00:00.000Z']) {
      expect(responsibleRoles(chain, T0, now).length).toBeGreaterThan(0);
    }
  });
});

describe('resolveApproval', () => {
  it('is PENDING with no attempt, and PENDING carries no approver property at all', () => {
    const out = resolveApproval(chain, T0, T0);
    expect(out.state).toBe('PENDING');
    if (out.state === 'PENDING') {
      expect(out.responsibleRoles).toEqual(['EM']);
      expect(out.delegationOpen).toBe(false);
      expect(Object.keys(out)).not.toContain('approval');
    }
  });

  it('reports the delegation as open once the fallback role is co-responsible', () => {
    const out = resolveApproval(chain, T0, '2026-07-05T23:00:00.000Z');
    expect(out.state === 'PENDING' && out.delegationOpen).toBe(true);
  });

  it('APPROVES a primary-authorizer attempt and marks it not delegated', () => {
    const attempt: ApprovalAttempt = { actorId: em, role: 'EM', at: T0 };
    const out = resolveApproval(chain, T0, T0, attempt);
    expect(out.state).toBe('APPROVED');
    if (out.state === 'APPROVED') {
      expect(out.approval).toEqual({ approvedBy: em, approvedByRole: 'EM', approvedAt: T0, delegated: false });
    }
  });

  it('APPROVES the fallback role ONLY after the window, and marks it delegated', () => {
    const early: ApprovalAttempt = { actorId: verifier, role: 'VERIFIER', at: T0 };
    expect(resolveApproval(chain, T0, T0, early).state).toBe('PENDING');
    const late: ApprovalAttempt = { actorId: verifier, role: 'VERIFIER', at: '2026-07-05T23:00:00.000Z' };
    const out = resolveApproval(chain, T0, '2026-07-05T23:00:00.000Z', late);
    expect(out.state === 'APPROVED' && out.approval.delegated).toBe(true);
    expect(out.state === 'APPROVED' && out.approval.approvedByRole).toBe('VERIFIER');
  });

  it('refuses a non-approver role even after the window (Art. XIII is not a timeout)', () => {
    for (const role of ['PUBLIC', 'RESPONDER'] as const) {
      const attempt: ApprovalAttempt = { actorId: asId<AppUserId>('u-x'), role, at: T0 };
      expect(resolveApproval(chain, T0, '2026-07-09T00:00:00.000Z', attempt).state).toBe('PENDING');
    }
  });

  it('refuses an attempt with a blank actor id — "approved by nobody" is not approval', () => {
    const attempt: ApprovalAttempt = { actorId: asId<AppUserId>('   '), role: 'EM', at: T0 };
    expect(resolveApproval(chain, T0, T0, attempt).state).toBe('PENDING');
  });
});

describe('assertValidSopChain', () => {
  it('accepts both delegation directions (down for availability, up for escalation)', () => {
    expect(() => assertValidSopChain(chain, 'approval')).not.toThrow();
    expect(() =>
      assertValidSopChain({ authorizerRole: 'VERIFIER', fallbackRole: 'EM', fallbackAfterMinutes: 15 }, 'approval'),
    ).not.toThrow();
  });

  it('rejects a non-approver role in either slot', () => {
    expect(() =>
      assertValidSopChain({ ...chain, authorizerRole: 'RESPONDER' as never }, 'approval'),
    ).toThrow(/authorizerRole/);
    expect(() => assertValidSopChain({ ...chain, fallbackRole: 'PUBLIC' as never }, 'approval')).toThrow(
      /fallbackRole/,
    );
  });

  it('rejects a self-delegation (a fallback that changes nothing while looking configured)', () => {
    expect(() => assertValidSopChain({ ...chain, fallbackRole: 'EM' }, 'approval')).toThrow(/no-op/);
  });

  it('rejects a non-positive or non-finite window', () => {
    expect(() => assertValidSopChain({ ...chain, fallbackAfterMinutes: 0 }, 'approval')).toThrow(/positive/);
    expect(() => assertValidSopChain({ ...chain, fallbackAfterMinutes: -5 }, 'approval')).toThrow(/positive/);
    expect(() => assertValidSopChain({ ...chain, fallbackAfterMinutes: Number.NaN }, 'approval')).toThrow(/positive/);
  });
});
