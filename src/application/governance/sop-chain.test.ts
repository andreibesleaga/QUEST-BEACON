// BEACON — SOP approval-chain tests (MW-D/D4; ADR-034 §6, FR-GOV-2 / FST-4, Art. XIII).
// Deterministic: fixed instants only, no clock read, no network.
import { describe, expect, it } from 'vitest';
import { isErr, isOk } from '@/domain/shared/result.js';
import { APPROVER_ROLES, isApproverRole } from '@/domain/governance.js';
import type { ApprovalAttempt, SopChainConfig } from '@/domain/governance.js';
import { APP_USER_ROLES } from '@/domain/app-user.js';
import type { AppUserRole } from '@/domain/app-user.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { AppUserId, IncidentId } from '@/domain/value-objects/ids.js';
import { FakeGovernanceLedger } from '../../../tests/_harness/fakes/fake-governance.js';
import { decideSopApproval } from './sop-chain.js';
import { DEFAULT_GOVERNANCE_CONFIG } from './governance-config.js';

const T0 = '2026-07-05T22:00:00.000Z';
const LATER = '2026-07-05T23:00:00.000Z'; // T0 + 60 min — past every window used below
const actor = (role: AppUserRole): AppUserId => asId<AppUserId>(`u-${role.toLowerCase()}-1`);
const target = 'eap:ro-flood-2026#ep-1';

const chain: SopChainConfig = {
  authorizerRole: 'EM',
  fallbackRole: 'VERIFIER',
  fallbackAfterMinutes: 30,
};

describe('decideSopApproval', () => {
  it('reports PENDING with the responsible role and writes NOTHING to the ledger', () => {
    const ledger = new FakeGovernanceLedger();
    const res = decideSopApproval({ ledger }, { target, requestedAt: T0, now: T0 });
    expect(isOk(res)).toBe(true);
    if (isOk(res)) {
      expect(res.value.outcome.state).toBe('PENDING');
      expect(res.value.ledgerHash).toBeUndefined();
    }
    // A pending approval is not an event — the ledger records decisions, not polls.
    expect(ledger.entries).toHaveLength(0);
  });

  it('records an approval by the primary authorizer, by ID and ROLE (never by name)', () => {
    const ledger = new FakeGovernanceLedger();
    const attempt: ApprovalAttempt = { actorId: actor('EM'), role: 'EM', at: T0 };
    const res = decideSopApproval(
      { ledger },
      { target, requestedAt: T0, now: T0, attempt, config: chain },
    );
    expect(isOk(res)).toBe(true);
    const entry = ledger.entries[0];
    expect(entry?.action).toBe('SOP_APPROVE');
    expect(entry?.actorId).toBe('u-em-1');
    expect(entry?.actorRole).toBe('EM');
    expect(entry?.at).toBe(T0);
    if (isOk(res)) expect(res.value.ledgerHash).toBe(entry?.hash);
  });

  it('records WHICH role acted when the delegated fallback approves (FST-4)', () => {
    const ledger = new FakeGovernanceLedger();
    const attempt: ApprovalAttempt = { actorId: actor('VERIFIER'), role: 'VERIFIER', at: LATER };
    const res = decideSopApproval(
      { ledger },
      {
        target,
        requestedAt: T0,
        now: LATER,
        attempt,
        config: chain,
        incidentId: asId<IncidentId>('inc-1'),
      },
    );
    expect(isOk(res)).toBe(true);
    expect(ledger.entries[0]?.actorRole).toBe('VERIFIER');
    const digest = ledger.entries[0]?.evidenceDigest;
    expect(digest).toBeDefined();
    expect(ledger.evidenceFor(digest ?? '')).toEqual({
      actorRole: 'VERIFIER',
      evidence: {
        requestedAt: T0,
        decidedAt: LATER,
        authorizerRole: 'EM',
        fallbackRole: 'VERIFIER',
        fallbackAfterMinutes: 30,
        delegated: true,
      },
    });
  });

  it('REFUSES a fallback attempt before the window (UNAUTHORIZED) and records nothing', () => {
    const ledger = new FakeGovernanceLedger();
    const attempt: ApprovalAttempt = { actorId: actor('VERIFIER'), role: 'VERIFIER', at: T0 };
    const res = decideSopApproval(
      { ledger },
      { target, requestedAt: T0, now: T0, attempt, config: chain },
    );
    expect(isErr(res)).toBe(true);
    if (isErr(res)) {
      expect(res.error.code).toBe('UNAUTHORIZED');
      expect(res.error.message).toMatch(/not responsible now/);
    }
    expect(ledger.entries).toHaveLength(0);
  });

  it('REFUSES every non-approver role, at every clock, with or without a delegation open', () => {
    for (const role of APP_USER_ROLES.filter((r) => !isApproverRole(r))) {
      for (const now of [T0, LATER]) {
        const attempt: ApprovalAttempt = { actorId: actor(role), role, at: now };
        const res = decideSopApproval({}, { target, requestedAt: T0, now, attempt, config: chain });
        expect(isErr(res)).toBe(true);
      }
    }
  });

  it('works without a ledger (the decision is correct even when unrecorded)', () => {
    const attempt: ApprovalAttempt = { actorId: actor('EM'), role: 'EM', at: T0 };
    const res = decideSopApproval({}, { target, requestedAt: T0, now: T0, attempt, config: chain });
    expect(isOk(res) && res.value.outcome.state).toBe('APPROVED');
    expect(isOk(res) && res.value.ledgerHash).toBeUndefined();
  });

  it('propagates a ledger failure instead of reporting an unrecorded approval', () => {
    const attempt: ApprovalAttempt = { actorId: actor('EM'), role: 'EM', at: 'not-an-instant' };
    // `at` reaches the ledger as the append instant, so a malformed one is refused by the chain writer.
    const res = decideSopApproval(
      { ledger: new FakeGovernanceLedger() },
      { target, requestedAt: T0, now: T0, attempt, config: chain },
    );
    expect(isErr(res)).toBe(true);
    if (isErr(res)) expect(res.error.code).toBe('INVARIANT_VIOLATION');
  });

  it('defaults to the SHIPPED governance config when no per-protocol override is given', () => {
    const attempt: ApprovalAttempt = {
      actorId: actor(DEFAULT_GOVERNANCE_CONFIG.approval.authorizerRole),
      role: DEFAULT_GOVERNANCE_CONFIG.approval.authorizerRole,
      at: T0,
    };
    const res = decideSopApproval({}, { target, requestedAt: T0, now: T0, attempt });
    expect(isOk(res) && res.value.outcome.state).toBe('APPROVED');
  });
});

// ── THE LOAD-BEARING TEST: no configuration yields "nobody approved but it went out" ─────────────────
//
// Exhaustive over the cross-product of every VALID chain configuration × a window boundary sweep × every
// role in the system × attempt-present/absent. The property asserted is not "approval usually works": it is
// that the ONLY way to reach an APPROVED outcome is with a real actor id whose role carries approval
// authority — and that a PENDING outcome never carries an approver to mistake for one.
describe('no configuration yields "nobody approved but it went out"', () => {
  const validChains: readonly SopChainConfig[] = APPROVER_ROLES.flatMap((authorizerRole) =>
    APPROVER_ROLES.filter((fallbackRole) => fallbackRole !== authorizerRole).flatMap(
      (fallbackRole) =>
        [1, 30, 1440].map((fallbackAfterMinutes) => ({
          authorizerRole,
          fallbackRole,
          fallbackAfterMinutes,
        })),
    ),
  );
  // Both sides of every boundary, in ms offsets from `requestedAt`.
  const offsetsMs = [
    -60_000, 0, 59_999, 60_000, 60_001, 1_799_999, 1_800_000, 86_399_999, 86_400_000,
  ];

  it('covers a non-trivial configuration space (guard against a vacuous cross-product)', () => {
    expect(validChains).toHaveLength(6);
    expect(validChains.length * offsetsMs.length * (APP_USER_ROLES.length + 1)).toBeGreaterThan(
      200,
    );
  });

  it('never produces an approval without a named human in an approver role', () => {
    let approvals = 0;
    let pendings = 0;
    for (const config of validChains) {
      for (const offset of offsetsMs) {
        const now = new Date(Date.parse(T0) + offset).toISOString();
        const attempts: readonly (ApprovalAttempt | undefined)[] = [
          undefined,
          ...APP_USER_ROLES.map((role) => ({ actorId: actor(role), role, at: now })),
          // Adversarial: an approver ROLE with a blank id — the "approved by nobody" shape.
          { actorId: asId<AppUserId>(''), role: 'EM' as const, at: now },
        ];
        for (const attempt of attempts) {
          const ledger = new FakeGovernanceLedger();
          const res = decideSopApproval(
            { ledger },
            { target, requestedAt: T0, now, config, ...(attempt !== undefined ? { attempt } : {}) },
          );
          if (isErr(res)) {
            // A refusal is a refusal: nothing was recorded and nothing proceeds.
            expect(ledger.entries).toHaveLength(0);
            continue;
          }
          const outcome = res.value.outcome;
          if (outcome.state === 'PENDING') {
            pendings += 1;
            expect(Object.keys(outcome)).not.toContain('approval');
            expect(res.value.ledgerHash).toBeUndefined();
            expect(ledger.entries).toHaveLength(0);
            continue;
          }
          approvals += 1;
          // The invariant, stated three ways.
          expect(String(outcome.approval.approvedBy).trim().length).toBeGreaterThan(0);
          expect(isApproverRole(outcome.approval.approvedByRole)).toBe(true);
          expect(outcome.approval.approvedByRole).toBe(
            outcome.approval.delegated ? config.fallbackRole : config.authorizerRole,
          );
          // …and the approval is on the record, with the acting role.
          expect(ledger.entries).toHaveLength(1);
          expect(ledger.entries[0]?.actorRole).toBe(outcome.approval.approvedByRole);
          expect(ledger.verify().intact).toBe(true);
        }
      }
    }
    // Both arms were actually exercised — a cross-product that only ever refused would prove nothing.
    expect(approvals).toBeGreaterThan(0);
    expect(pendings).toBeGreaterThan(0);
  });

  it('has no configuration in which NOBODY is responsible (the deadlock case)', () => {
    for (const config of validChains) {
      for (const offset of offsetsMs) {
        const now = new Date(Date.parse(T0) + offset).toISOString();
        const res = decideSopApproval({}, { target, requestedAt: T0, now, config });
        expect(isOk(res)).toBe(true);
        if (isOk(res) && res.value.outcome.state === 'PENDING') {
          expect(res.value.outcome.responsibleRoles.length).toBeGreaterThan(0);
          for (const role of res.value.outcome.responsibleRoles)
            expect(isApproverRole(role)).toBe(true);
        }
      }
    }
  });
});
