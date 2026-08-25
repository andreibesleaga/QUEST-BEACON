// BEACON — APP_USER invariant tests (E1·T-080). Role enum + isResponder/roleRank RBAC helpers.
import { describe, it, expect } from 'vitest';
import { makeAppUser, isResponder, roleRank, APP_USER_ROLES } from './app-user.js';
import { asId } from './value-objects/ids.js';
import type { AppUserId, OrgId } from './value-objects/ids.js';
import { InvariantViolation } from './errors.js';

const id = asId<AppUserId>('u-1');

describe('makeAppUser', () => {
  it('defaults role to PUBLIC (least privilege)', () => {
    expect(makeAppUser({ id }).role).toBe('PUBLIC');
  });

  it('accepts every role in the enum and keeps optional org', () => {
    for (const role of APP_USER_ROLES) {
      const u = makeAppUser({ id, role, orgId: asId<OrgId>('org') });
      expect(u.role).toBe(role);
      expect(u.orgId).toBe('org');
    }
  });

  it('rejects a role outside the enum', () => {
    expect(() => makeAppUser({ id, role: 'ADMIN' as never })).toThrow(InvariantViolation);
  });
});

describe('RBAC helpers', () => {
  it('ranks roles PUBLIC < RESPONDER < VERIFIER < EM', () => {
    expect(roleRank('PUBLIC')).toBeLessThan(roleRank('RESPONDER'));
    expect(roleRank('RESPONDER')).toBeLessThan(roleRank('VERIFIER'));
    expect(roleRank('VERIFIER')).toBeLessThan(roleRank('EM'));
  });

  it('isResponder is true for RESPONDER and above, false for PUBLIC', () => {
    expect(isResponder('PUBLIC')).toBe(false);
    expect(isResponder('RESPONDER')).toBe(true);
    expect(isResponder('VERIFIER')).toBe(true);
    expect(isResponder('EM')).toBe(true);
  });
});
