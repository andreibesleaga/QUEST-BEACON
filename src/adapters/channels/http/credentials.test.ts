// BEACON — named-account credential tests (POST /auth/login). Deterministic: pure functions over an
// injected secret, no clock, no IO, no network. These assert the SECURITY properties, not just the happy
// path — a login that "works" while granting the wrong role or accepting a malformed entry is worse than
// no login at all.
import { describe, it, expect } from 'vitest';
import { parseCredentials, verifyCredential } from './credentials.js';

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
const USERS = 'em@beacon.demo:EM:em-pass,verifier@beacon.demo:VERIFIER:ver-pass';

describe('parseCredentials', () => {
  it('parses id:ROLE:password triples and never retains the plaintext password', async () => {
    const creds = await parseCredentials(USERS, SECRET);
    expect(creds.map((c) => [c.userId, c.role])).toEqual([
      ['em@beacon.demo', 'EM'],
      ['verifier@beacon.demo', 'VERIFIER'],
    ]);
    // The record carries a derived key only — the password must not survive anywhere on it.
    expect(JSON.stringify(creds)).not.toContain('em-pass');
  });

  it('accepts newline-separated entries (the natural shape of a multi-line env var)', async () => {
    const creds = await parseCredentials('a:EM:p1\nb:RESPONDER:p2', SECRET);
    expect(creds).toHaveLength(2);
  });

  it('keeps a password containing a colon intact (splits on the FIRST two only)', async () => {
    const creds = await parseCredentials('u:EM:pa:ss', SECRET);
    expect(creds).toHaveLength(1);
    await expect(verifyCredential(creds, 'u', 'pa:ss', SECRET)).resolves.toBeDefined();
  });

  // Dropping, not defaulting, is the point: a typo'd role that silently became PUBLIC — or worse, EM —
  // would be a privilege bug wearing the costume of a helpful default.
  it('DROPS an unknown role rather than defaulting it', async () => {
    expect(await parseCredentials('u:ADMIN:p', SECRET)).toHaveLength(0);
  });

  it('DROPS a PUBLIC entry — PUBLIC is the unauthenticated baseline and needs no account', async () => {
    expect(await parseCredentials('u:PUBLIC:p', SECRET)).toHaveLength(0);
  });

  it('DROPS malformed and empty-password entries', async () => {
    expect(await parseCredentials('no-colons,u:EM:,:EM:p', SECRET)).toHaveLength(0);
  });

  it('returns nothing for unset/blank config (login then 404s — the offline posture)', async () => {
    expect(await parseCredentials(undefined, SECRET)).toHaveLength(0);
    expect(await parseCredentials('   ', SECRET)).toHaveLength(0);
  });
});

describe('verifyCredential', () => {
  it('accepts the right password and returns the account with ITS configured role', async () => {
    const creds = await parseCredentials(USERS, SECRET);
    const account = await verifyCredential(creds, 'em@beacon.demo', 'em-pass', SECRET);
    expect(account?.role).toBe('EM');
    expect(account?.userId).toBe('em@beacon.demo');
  });

  it('rejects a wrong password', async () => {
    const creds = await parseCredentials(USERS, SECRET);
    await expect(
      verifyCredential(creds, 'em@beacon.demo', 'wrong', SECRET),
    ).resolves.toBeUndefined();
  });

  it('rejects an unknown user', async () => {
    const creds = await parseCredentials(USERS, SECRET);
    await expect(
      verifyCredential(creds, 'nobody@beacon.demo', 'em-pass', SECRET),
    ).resolves.toBeUndefined();
  });

  // A caller cannot ask for a role — the role is whatever the ACCOUNT was configured with. This is the
  // structural difference from dev-login (which mints any requested role and is therefore cloud-hard-off).
  it("a verifier's password never yields EM — the role comes from the account, never the request", async () => {
    const creds = await parseCredentials(USERS, SECRET);
    const account = await verifyCredential(creds, 'verifier@beacon.demo', 'ver-pass', SECRET);
    expect(account?.role).toBe('VERIFIER');
  });

  // The salt is bound to AUTH_SECRET, so a derived key lifted from one deployment is useless against
  // another that happens to use the same password.
  it('keys are deployment-bound: the same password fails under a different AUTH_SECRET', async () => {
    const creds = await parseCredentials(USERS, SECRET);
    await expect(
      verifyCredential(creds, 'em@beacon.demo', 'em-pass', 'a-different-secret'),
    ).resolves.toBeUndefined();
  });
});
