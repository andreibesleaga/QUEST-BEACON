// BEACON — named-user credentials (the real login behind POST /auth/login; ADR-017, Art. XIII).
//
// WHY THIS EXISTS ALONGSIDE dev-login: `handleDevLogin` mints an ARBITRARY role for anyone who can reach
// it, which is why it is hard-off in cloud/production (F-344). That left a deployed BEACON with no way to
// become EM at all. This module is the missing half — real accounts, real secrets, usable in EVERY posture
// (local, docker, Railway) because it depends on nothing but env + node:crypto.
//
// DESIGN, and its limits stated plainly:
//  • Accounts are CONFIG, not a table. `AUTH_USERS` carries `id:ROLE:password` triples, so the same
//    mechanism works air-gapped with FEATURE_STORE=memory and on a cloud deploy with no DB seeding step.
//    A production system would put these in an IdP; that is ROADMAP-POST-V1, and this file does not
//    pretend otherwise.
//  • Passwords are NEVER compared as strings and never stored beyond process memory. Each is stretched with
//    scrypt (memory-hard, node stdlib — no new dependency) under a per-user salt bound to AUTH_SECRET, and
//    compared with `timingSafeEqual`. An unknown user still performs a full derivation before failing, so
//    the response time does not disclose which accounts exist.
//  • The minted token is the SAME HS256 bearer `resolvePrincipal` already verifies fail-closed, and its
//    `sub` is the real account id — so the hash-chained triage audit records a PERSON, not `role:EM`.
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { AppUserRole } from '@/domain/app-user.js';
import { APP_USER_ROLES } from '@/domain/app-user.js';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

/** scrypt output length. 32 bytes = 256 bits, the standard derived-key width. */
const KEY_LENGTH = 32;

/** One configured account. The password is held ONLY as its derived key — never as plaintext. */
export interface CredentialRecord {
  readonly userId: string;
  readonly role: AppUserRole;
  readonly derivedKey: Buffer;
}

/**
 * Parse `AUTH_USERS` — `id:ROLE:password` triples separated by commas or newlines. A malformed or
 * unknown-role entry is DROPPED rather than defaulted: silently granting a typo'd role would be the
 * privilege-escalation version of a helpful default. PUBLIC is rejected too — it is the unauthenticated
 * baseline and needs no account, so an entry claiming it can only be a mistake.
 *
 * Deriving the keys is deliberately done ONCE, at store construction, so login itself is a single
 * derivation and a hot path cannot be turned into a CPU-exhaustion lever.
 */
export async function parseCredentials(
  raw: string | undefined,
  secret: string,
): Promise<readonly CredentialRecord[]> {
  if (raw === undefined || raw.trim() === '') return [];
  const out: CredentialRecord[] = [];
  for (const entry of raw.split(/[,\n]/)) {
    const trimmed = entry.trim();
    if (trimmed === '') continue;
    // Split on the FIRST two colons only: a password may legitimately contain one.
    const first = trimmed.indexOf(':');
    const second = trimmed.indexOf(':', first + 1);
    if (first <= 0 || second <= first + 1) continue;
    const userId = trimmed.slice(0, first);
    const role = trimmed.slice(first + 1, second).toUpperCase();
    const password = trimmed.slice(second + 1);
    if (password === '' || role === 'PUBLIC') continue;
    if (!(APP_USER_ROLES as readonly string[]).includes(role)) continue;
    out.push({
      userId,
      role: role as AppUserRole,
      derivedKey: await scrypt(password, saltFor(userId, secret), KEY_LENGTH),
    });
  }
  return out;
}

/**
 * Per-user salt. Binding it to AUTH_SECRET means the SAME password configured on two deployments derives
 * two different keys, so a key lifted from one is useless against the other; including the user id stops
 * two accounts that share a password from sharing a derived key.
 */
function saltFor(userId: string, secret: string): string {
  return `beacon:${userId}:${secret}`;
}

/**
 * Verify a login attempt. Returns the matched account, or undefined.
 *
 * The unknown-user branch still runs a full scrypt derivation against a throwaway salt before returning
 * undefined: without it, "no such user" would answer measurably faster than "wrong password" and the
 * endpoint would enumerate accounts.
 */
export async function verifyCredential(
  credentials: readonly CredentialRecord[],
  userId: string,
  password: string,
  secret: string,
): Promise<CredentialRecord | undefined> {
  const found = credentials.find((c) => c.userId === userId);
  const salt = found !== undefined ? saltFor(userId, secret) : randomBytes(16).toString('hex');
  const attempt = await scrypt(password, salt, KEY_LENGTH);
  if (found === undefined) return undefined;
  // Equal lengths are guaranteed (both are KEY_LENGTH), so timingSafeEqual cannot throw here.
  return timingSafeEqual(attempt, found.derivedKey) ? found : undefined;
}
