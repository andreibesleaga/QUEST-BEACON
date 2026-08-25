// BEACON — role-scope tests (E6·T-257/T-258; ADR-017/CM-C2/ASI03).
import { describe, expect, it } from 'vitest';
import { loadPolicy } from './policy-loader.js';
import { checkRoleScope } from './role-scope.js';

const { policy } = loadPolicy();

describe('checkRoleScope — deny-by-default RBAC', () => {
  it('EM may use the CLOUD tier (allowed_models: *)', () => {
    expect(checkRoleScope(policy, { role: 'EM', modelTier: 'CLOUD' }).allowed).toBe(true);
  });

  it('PUBLIC may NOT use the CLOUD tier (local only)', () => {
    const v = checkRoleScope(policy, { role: 'PUBLIC', modelTier: 'CLOUD' });
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/may not use model tier/);
  });

  it('PUBLIC may use the LOCAL tier', () => {
    expect(checkRoleScope(policy, { role: 'PUBLIC', modelTier: 'LOCAL' }).allowed).toBe(true);
  });

  it('every role may use the DETERMINISTIC rung (safe fallback)', () => {
    expect(checkRoleScope(policy, { role: 'PUBLIC', modelTier: 'DETERMINISTIC' }).allowed).toBe(true);
  });

  it('rejects a max_tokens request above the role ceiling', () => {
    const v = checkRoleScope(policy, { role: 'RESPONDER', modelTier: 'LOCAL', requestedMaxTokens: 9999 });
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/max_tokens/);
  });
});
