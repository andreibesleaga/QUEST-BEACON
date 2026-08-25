// BEACON — real JWT auth resolution tests (E7·T-320/T-321; ADR-017). Deterministic: no network, no real
// timers. A validly-signed token resolves its role; every attack/edge (alg=none, wrong secret, expired,
// unknown role) is FAIL-CLOSED to PUBLIC; the dev-header demo path still works when flagged.
import { describe, it, expect } from 'vitest';
import { SignJWT, UnsecuredJWT } from 'jose';
import { resolveRole, resolveRoleJwt, signDevToken } from './rbac.js';

const SECRET = 'test-secret-do-not-use-in-prod-0123456789';
const OTHER_SECRET = 'a-completely-different-secret-value-9876543';
const AUTH_ENV = { AUTH_SECRET: SECRET } as const;

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

describe('resolveRoleJwt — real JWT auth (ADR-017)', () => {
  it('resolves the role from a validly-signed VERIFIER token', async () => {
    const token = await signDevToken('VERIFIER', SECRET);
    expect(await resolveRoleJwt(bearer(token), AUTH_ENV)).toBe('VERIFIER');
  });

  it('honours a case-insensitive Authorization header name and EM role', async () => {
    const token = await signDevToken('EM', SECRET);
    expect(await resolveRoleJwt({ Authorization: `Bearer ${token}` }, AUTH_ENV)).toBe('EM');
  });

  it('FAIL-CLOSED to PUBLIC on an alg=none (unsecured) token', async () => {
    const token = new UnsecuredJWT({ role: 'EM' }).setIssuedAt().encode();
    expect(await resolveRoleJwt(bearer(token), AUTH_ENV)).toBe('PUBLIC');
  });

  it('FAIL-CLOSED to PUBLIC when signed with the wrong secret', async () => {
    const token = await signDevToken('EM', OTHER_SECRET);
    expect(await resolveRoleJwt(bearer(token), AUTH_ENV)).toBe('PUBLIC');
  });

  it('FAIL-CLOSED to PUBLIC on an expired token', async () => {
    // exp firmly in the past (2001) → deterministic regardless of wall-clock.
    const token = await signDevToken('EM', SECRET, 1_000_000_000);
    expect(await resolveRoleJwt(bearer(token), AUTH_ENV)).toBe('PUBLIC');
  });

  it('FAIL-CLOSED to PUBLIC on a valid signature but unknown role claim', async () => {
    const token = await new SignJWT({ role: 'SUPERADMIN' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    expect(await resolveRoleJwt(bearer(token), AUTH_ENV)).toBe('PUBLIC');
  });

  it('FAIL-CLOSED to PUBLIC on a malformed bearer token', async () => {
    expect(await resolveRoleJwt(bearer('not-a-jwt'), AUTH_ENV)).toBe('PUBLIC');
  });

  it('ignores a valid token when AUTH_SECRET is unset (no bearer trust without a secret)', async () => {
    const token = await signDevToken('EM', SECRET);
    expect(await resolveRoleJwt(bearer(token), {})).toBe('PUBLIC');
  });

  it('falls back to the dev-header path when no bearer is present and the flag is on', async () => {
    const env = { AUTH_DEV_TRUST_HEADER: 'on' };
    expect(await resolveRoleJwt({ 'x-beacon-role': 'VERIFIER' }, env)).toBe('VERIFIER');
  });

  it('defaults to PUBLIC with neither a bearer nor the dev flag', async () => {
    expect(await resolveRoleJwt({ 'x-beacon-role': 'EM' }, {})).toBe('PUBLIC');
  });
});

describe('resolveRole — sync dev-header path is unchanged', () => {
  it('trusts x-beacon-role only when AUTH_DEV_TRUST_HEADER=on', () => {
    expect(resolveRole({ 'x-beacon-role': 'EM' }, { AUTH_DEV_TRUST_HEADER: 'on' })).toBe('EM');
    expect(resolveRole({ 'x-beacon-role': 'EM' }, {})).toBe('PUBLIC');
  });

  // F-344. The header-trust path is STRICTLY MORE POWERFUL than the dev-login minter — it grants any role
  // with no secret and no token — yet `handleDevLogin` hard-404s in production/cloud and this did not. The
  // E3 security audit demonstrated the consequence against the real dispatcher: an unauthenticated caller
  // read precise SOS coordinates (Art. XIV) and promoted a DRAFT alert to a schema-valid ACTUAL CAP
  // recorded in the hash chain as a genuine emission (Art. XIII). Every profile in the E2E playbook sets
  // this flag on, so a copied demo profile was one DEPLOY_MODE=cloud away from that sequence.
  //
  // The flag being ON is the whole point of these cases: the guard must beat an explicitly-enabled flag,
  // not merely an absent one, because "flipped or leaked into a cloud deploy" is the scenario it exists for.
  it('IGNORES the trusted header in a production build that never declared a deploy mode (F-344)', () => {
    const env = { AUTH_DEV_TRUST_HEADER: 'on', NODE_ENV: 'production' };
    expect(resolveRole({ 'x-beacon-role': 'EM' }, env)).toBe('PUBLIC');
    expect(resolveRole({ 'x-beacon-role': 'VERIFIER' }, env)).toBe('PUBLIC');
  });

  it('IGNORES the trusted header in a cloud deploy even when the flag is explicitly on (F-344)', () => {
    const env = { AUTH_DEV_TRUST_HEADER: 'on', DEPLOY_MODE: 'cloud' };
    expect(resolveRole({ 'x-beacon-role': 'EM' }, env)).toBe('PUBLIC');
    expect(resolveRole({ 'x-beacon-role': 'RESPONDER' }, env)).toBe('PUBLIC');
  });

  // `cloud` must beat an explicit `local`-looking posture: DEPLOY_MODE is a single value, but this pins that
  // the cloud branch is evaluated FIRST and unconditionally, so no later condition can re-open it.
  it('IGNORES the trusted header in a cloud deploy even in a non-production build (F-344)', () => {
    const env = { AUTH_DEV_TRUST_HEADER: 'on', DEPLOY_MODE: 'cloud', NODE_ENV: 'development' };
    expect(resolveRole({ 'x-beacon-role': 'EM' }, env)).toBe('PUBLIC');
  });

  it('still works for the local/dev demo profile the playbook documents (no regression)', () => {
    expect(resolveRole({ 'x-beacon-role': 'EM' }, { AUTH_DEV_TRUST_HEADER: 'on', NODE_ENV: 'development' })).toBe('EM');
    expect(resolveRole({ 'x-beacon-role': 'EM' }, { AUTH_DEV_TRUST_HEADER: 'on', DEPLOY_MODE: 'local' })).toBe('EM');
  });

  // THE CASE THAT MATTERS FOR SHIPPING, and the one the first version of this guard broke. `next start`
  // sets NODE_ENV=production for `docker compose up`, for the demo that gets filmed, and for the Playwright
  // suite (which uses a prod build on purpose, for deterministic timing). An operator who has explicitly
  // declared DEPLOY_MODE=local has asserted the process is not internet-reachable; the header is honoured.
  // Without this case a guard written to protect the product would instead have disabled it on camera.
  it('IS honoured in a PRODUCTION BUILD that explicitly declares DEPLOY_MODE=local (the demo + e2e)', () => {
    const env = { AUTH_DEV_TRUST_HEADER: 'on', NODE_ENV: 'production', DEPLOY_MODE: 'local' };
    expect(resolveRole({ 'x-beacon-role': 'EM' }, env)).toBe('EM');
    expect(resolveRole({ 'x-beacon-role': 'VERIFIER' }, env)).toBe('VERIFIER');
  });

  // The flag remains the primary gate: declaring local does NOT by itself trust the header.
  it('DEPLOY_MODE=local alone does not trust the header without the explicit flag (least privilege)', () => {
    expect(resolveRole({ 'x-beacon-role': 'EM' }, { NODE_ENV: 'production', DEPLOY_MODE: 'local' })).toBe('PUBLIC');
  });
});
