// BEACON — ALERT invariant tests (E1·T-068). No ACTUAL without approvedBy (Art. XIII) + enums.
import { describe, it, expect } from 'vitest';
import { asId } from './value-objects/ids.js';
import type { AlertId, AppUserId, IncidentId } from './value-objects/ids.js';
import { InvariantViolation, InvalidTransition } from './errors.js';
import { makeAlert, approveAlert } from './alert.js';

const approver = asId<AppUserId>('99999999-9999-9999-9999-999999999999');
const base = {
  id: asId<AlertId>('88888888-8888-8888-8888-888888888888'),
  incidentId: asId<IncidentId>('77777777-7777-7777-7777-777777777777'),
  category: 'Fire',
  severity: 'SEVERE',
} as const;

describe('makeAlert', () => {
  it('constructs a DRAFT alert without an approver', () => {
    const a = makeAlert({ ...base });
    expect(a.capStatus).toBe('DRAFT');
    expect(a.edxlKind).toBe('CAP'); // schema default
  });

  it('rejects ACTUAL without approvedBy (Art. XIII)', () => {
    expect(() => makeAlert({ ...base, capStatus: 'ACTUAL' })).toThrow(InvariantViolation);
  });

  it('accepts ACTUAL when approvedBy is present', () => {
    const a = makeAlert({ ...base, capStatus: 'ACTUAL', approvedBy: approver });
    expect(a.approvedBy).toBe(approver);
  });

  it('rejects an invalid category', () => {
    // @ts-expect-error — runtime guard for an out-of-enum category
    expect(() => makeAlert({ ...base, category: 'Zombie' })).toThrow(InvariantViolation);
  });

  it('rejects an invalid severity', () => {
    // @ts-expect-error — runtime guard for an out-of-enum severity
    expect(() => makeAlert({ ...base, severity: 'APOCALYPTIC' })).toThrow(InvariantViolation);
  });
});

describe('approveAlert', () => {
  it('promotes DRAFT→ACTUAL with an approver', () => {
    const draft = makeAlert({ ...base });
    const actual = approveAlert(draft, approver);
    expect(actual.capStatus).toBe('ACTUAL');
    expect(actual.approvedBy).toBe(approver);
  });

  it('refuses to re-approve an already-ACTUAL alert', () => {
    const actual = makeAlert({ ...base, capStatus: 'ACTUAL', approvedBy: approver });
    expect(() => approveAlert(actual, approver)).toThrow(InvalidTransition);
  });

  it('refuses to approve a DRAFT with a falsy approver (Art. XIII)', () => {
    const draft = makeAlert({ ...base });
    expect(() => approveAlert(draft, asId<AppUserId>(''))).toThrow(InvariantViolation);
  });
});
