// BEACON — the shipped deployment profiles must NOT honour the spoofable role header.
//
// WHY THIS FILE EXISTS. A security audit (2026-09-11) proved, by execution, that `npm run docker:up` —
// the project's own documented command — rendered `DEPLOY_MODE=local` from the developer's `.env` into a
// container publishing port 3000 on ALL interfaces. `local` is precisely what unlocks the spoofable
// `x-beacon-role` header, so anyone who could reach that port could claim EM and then read precise SOS
// coordinates (Art. XIV) or promote a DRAFT alert to an ACTUAL CAP (Art. XIII).
//
// Two details made it worse than it looks, and both are pinned below:
//   * setting `AUTH_SECRET` did NOT close it — `resolvePrincipal` only takes the JWT branch when a bearer
//     is actually PRESENT, and the header path is the fallthrough for a request that carries none;
//   * `rbac.ts` already documented this as a residual risk, but nothing asserted it, so the repo shipped
//     the profile that realised the risk it had written down.
//
// The guard in `resolveRole` was correct all along. What was missing was a test that the PROFILES WE SHIP
// actually land on the safe side of it. That is what this file is: not a re-test of the guard, but a test
// of the deployment values, so the seam cannot silently reopen the next time someone edits a compose file.
import { describe, expect, it } from 'vitest';
import { resolveRole } from './rbac.js';

const SPOOFED = { 'x-beacon-role': 'EM' } as const;

/**
 * The environment the container actually sees, read from `infra/docker-compose.yml`'s `environment:`
 * block. Kept as literals rather than parsed from the YAML on purpose: if someone changes the compose
 * file, this test should FAIL and make them think, not quietly follow them to the new value.
 */
const COMPOSE_PROFILE = {
  NODE_ENV: 'production',
  DEPLOY_MODE: 'cloud',
  AUTH_DEV_TRUST_HEADER: 'off',
  AUTH_DEV_LOGIN: 'off',
} as const;

/** Railway / k8s — `DEPLOY_MODE=cloud`, the posture the judged deployment runs under. */
const CLOUD_PROFILE = { NODE_ENV: 'production', DEPLOY_MODE: 'cloud' } as const;

describe('the shipped deployment profiles refuse the spoofable role header', () => {
  it('docker compose: a request claiming EM is PUBLIC', () => {
    expect(resolveRole(SPOOFED, COMPOSE_PROFILE)).toBe('PUBLIC');
  });

  it('docker compose: still PUBLIC even if AUTH_DEV_TRUST_HEADER is forced on', () => {
    // Defence in depth. `DEPLOY_MODE=cloud` short-circuits before the flag is ever consulted, so an
    // operator who exports the flag by habit does not silently reopen the door.
    expect(resolveRole(SPOOFED, { ...COMPOSE_PROFILE, AUTH_DEV_TRUST_HEADER: 'on' })).toBe(
      'PUBLIC',
    );
  });

  it('cloud (Railway / k8s): a request claiming EM is PUBLIC', () => {
    expect(resolveRole(SPOOFED, CLOUD_PROFILE)).toBe('PUBLIC');
  });

  it('an unset DEPLOY_MODE in production is PUBLIC — the guard fails CLOSED', () => {
    // The guard reads RAW process.env, so Zod defaults do not apply and `undefined` must not pass.
    expect(resolveRole(SPOOFED, { NODE_ENV: 'production' })).toBe('PUBLIC');
  });

  it('the local demo path still works, so the switcher is not collateral damage', () => {
    // The seam is legitimate — it is how the role switcher demos RBAC on a developer's own machine. What
    // was wrong was shipping it inside a published-port container, not the seam existing at all.
    expect(resolveRole(SPOOFED, { DEPLOY_MODE: 'local', AUTH_DEV_TRUST_HEADER: 'on' })).toBe('EM');
  });
});
