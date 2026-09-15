// BEACON — Principal resolution tests (E7·B4; ADR-017). True per-user identity (JWT `sub`) alongside the
// RBAC role, fail-closed. Deterministic: no network, no real timers. A validly-signed sub-bearing token
// surfaces {role, sub}; a spoofed/forged token surfaces NEITHER role nor sub (PUBLIC, no identity); the
// dev-header path carries a role but never a sub; actorId() prefers sub, else the role key.
import { describe, it, expect } from 'vitest';
import { resolvePrincipal, actorId, actorKey, signDevToken } from './rbac.js';

const SECRET = 'test-secret-do-not-use-in-prod-0123456789';
const OTHER_SECRET = 'a-completely-different-secret-value-9876543';
const AUTH_ENV = { AUTH_SECRET: SECRET } as const;

const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

describe('resolvePrincipal — {role, sub} with real JWT auth (ADR-017)', () => {
  it('returns {role, sub} for a sub-signed VERIFIER token', async () => {
    const token = await signDevToken('VERIFIER', SECRET, '1h', 'user-alice');
    expect(await resolvePrincipal(bearer(token), AUTH_ENV)).toEqual({
      role: 'VERIFIER',
      sub: 'user-alice',
    });
  });

  it('returns sub=undefined when the verified token carries no sub claim', async () => {
    const token = await signDevToken('VERIFIER', SECRET); // no sub
    const p = await resolvePrincipal(bearer(token), AUTH_ENV);
    expect(p.role).toBe('VERIFIER');
    expect(p.sub).toBeUndefined();
  });

  it('SPOOF: a sub-bearing token signed with the WRONG secret → {role:PUBLIC, sub:undefined}', async () => {
    const token = await signDevToken('EM', OTHER_SECRET, '1h', 'attacker-999');
    const p = await resolvePrincipal(bearer(token), AUTH_ENV);
    expect(p.role).toBe('PUBLIC');
    expect(p.sub).toBeUndefined();
  });

  it('dev-header path carries a role but NO sub (header is unauthenticated)', async () => {
    const p = await resolvePrincipal(
      { 'x-beacon-role': 'VERIFIER' },
      { AUTH_DEV_TRUST_HEADER: 'on' },
    );
    expect(p.role).toBe('VERIFIER');
    expect(p.sub).toBeUndefined();
  });

  it('PUBLIC fallback (no bearer, no dev flag) → {role:PUBLIC}, no sub', async () => {
    const p = await resolvePrincipal({ 'x-beacon-role': 'EM' }, {});
    expect(p).toEqual({ role: 'PUBLIC' });
  });
});

describe('signDevToken — optional subject', () => {
  it('embeds the subject when a sub is supplied', async () => {
    const token = await signDevToken('EM', SECRET, '1h', 'user-bob');
    expect((await resolvePrincipal(bearer(token), AUTH_ENV)).sub).toBe('user-bob');
  });

  it('stays backward-compatible with the 3-arg (role, secret, exp) shape (no sub)', async () => {
    const token = await signDevToken('EM', SECRET, '1h');
    expect((await resolvePrincipal(bearer(token), AUTH_ENV)).sub).toBeUndefined();
  });
});

describe('actorId — true actor else role-key fallback', () => {
  it('returns the sub when present', () => {
    expect(actorId({ role: 'VERIFIER', sub: 'user-alice' })).toBe('user-alice');
  });

  it('falls back to the role key when there is no sub', () => {
    expect(actorId({ role: 'VERIFIER' })).toBe(actorKey('VERIFIER'));
    expect(actorId({ role: 'VERIFIER' })).toBe('role:VERIFIER');
  });

  it('treats an empty/whitespace sub as absent → role key (fail-closed accountability)', () => {
    expect(actorId({ role: 'VERIFIER', sub: '' })).toBe('role:VERIFIER');
    expect(actorId({ role: 'VERIFIER', sub: '   ' })).toBe('role:VERIFIER');
  });
});
