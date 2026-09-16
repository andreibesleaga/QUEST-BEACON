// BEACON — per-user identity through the HTTP dispatcher (E7·B4; ADR-017, Art. XIII). Replaces the
// `role:<ROLE>` audit-actor stub with the verified JWT `sub` when real auth is on, while the offline
// dev-header path stays role-keyed. DETERMINISTIC: fixed clock, counter newId, no network/timers.
import { describe, it, expect } from 'vitest';
import { createHttpDeps, handleHttp, type CreateHttpDepsOptions } from './http-dispatcher.js';
import { resolvePrincipal, signDevToken } from './rbac.js';
import type { HttpDeps, HttpRequest } from './http-types.js';
import type { MemoryReportStore } from '@/adapters/memory/memory-core.js';

const FIXED = '2026-07-05T22:00:00Z';
const SECRET = 'test-hs256-secret-identity';

function counterIds(): (prefix: string) => string {
  let n = 0;
  return (prefix) => `${prefix}-${++n}`;
}

/** Deps in REAL-AUTH posture: AUTH_SECRET set, NO dev-trust header ⇒ a bearer JWT is the only way to elevate. */
function jwtDeps(
  env: Record<string, string> = { AUTH_SECRET: SECRET },
  overrides: CreateHttpDepsOptions = {},
): HttpDeps {
  return createHttpDeps({
    core: { clock: () => FIXED, newId: counterIds(), env },
    rateLimit: { capacity: 1000, refillPerSec: 0 },
    ...overrides,
  });
}

/** Deps in OFFLINE posture: dev-header trusted, NO secret (the e2e/golden-path posture). */
function devHeaderDeps(): HttpDeps {
  return createHttpDeps({
    core: { clock: () => FIXED, newId: counterIds(), env: { AUTH_DEV_TRUST_HEADER: 'on' } },
    rateLimit: { capacity: 1000, refillPerSec: 0 },
  });
}

function req(partial: Partial<HttpRequest> & Pick<HttpRequest, 'method' | 'path'>): HttpRequest {
  return { headers: {}, ...partial };
}
const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

describe('PATCH /reports/:id — recorded actor is the verified sub, not role:<ROLE>', () => {
  it('a sub-bearing VERIFIER Bearer records the TRUE actor (sub) in the audit trail', async () => {
    const d = jwtDeps();
    const store = d.reports as unknown as MemoryReportStore;
    const token = await signDevToken('VERIFIER', SECRET, '1h', 'user-alice');
    const res = await handleHttp(
      req({
        method: 'PATCH',
        path: '/api/v1/reports/rep-demo-1',
        headers: bearer(token),
        body: JSON.stringify({ decision: 'VERIFIED' }),
      }),
      d,
    );
    expect(res.status).toBe(202);
    const trail = store.auditTrail();
    expect(trail).toHaveLength(1);
    expect(trail[0]?.actorId).toBe('user-alice'); // the JWT sub — NOT role:VERIFIER
    expect(trail[0]?.decision).toBe('VERIFIED');
  });

  it('a VERIFIER token with NO sub falls back to the role key (role:VERIFIER)', async () => {
    const d = jwtDeps();
    const store = d.reports as unknown as MemoryReportStore;
    const token = await signDevToken('VERIFIER', SECRET); // no sub claim
    const res = await handleHttp(
      req({
        method: 'PATCH',
        path: '/api/v1/reports/rep-demo-1',
        headers: bearer(token),
        body: JSON.stringify({ decision: 'VERIFIED' }),
      }),
      d,
    );
    expect(res.status).toBe(202);
    expect(store.auditTrail()[0]?.actorId).toBe('role:VERIFIER');
  });

  it('the offline dev-header path is UNCHANGED — actor is the role key (role:VERIFIER)', async () => {
    const d = devHeaderDeps();
    const store = d.reports as unknown as MemoryReportStore;
    const res = await handleHttp(
      req({
        method: 'PATCH',
        path: '/api/v1/reports/rep-demo-1',
        headers: { 'x-beacon-role': 'VERIFIER' },
        body: JSON.stringify({ decision: 'VERIFIED' }),
      }),
      d,
    );
    expect(res.status).toBe(202);
    expect(store.auditTrail()[0]?.actorId).toBe('role:VERIFIER');
  });

  it('a client-supplied {actorId} is REJECTED 400 under JWT auth too (never reaches the audit)', async () => {
    const d = jwtDeps();
    const store = d.reports as unknown as MemoryReportStore;
    const token = await signDevToken('VERIFIER', SECRET, '1h', 'user-alice');
    const res = await handleHttp(
      req({
        method: 'PATCH',
        path: '/api/v1/reports/rep-demo-1',
        headers: bearer(token),
        body: JSON.stringify({ decision: 'VERIFIED', actorId: 'attacker-999' }),
      }),
      d,
    );
    expect(res.status).toBe(400);
    expect(store.auditTrail()).toHaveLength(0);
  });

  it('header-only x-beacon-role with AUTH_SECRET set (no bearer) resolves PUBLIC → 403 (cannot verify)', async () => {
    const d = jwtDeps(); // AUTH_SECRET set, dev-trust OFF
    const res = await handleHttp(
      req({
        method: 'PATCH',
        path: '/api/v1/reports/rep-demo-1',
        headers: { 'x-beacon-role': 'VERIFIER' },
        body: JSON.stringify({ decision: 'VERIFIED' }),
      }),
      d,
    );
    expect(res.status).toBe(403);
  });
});

describe('POST /alerts/:id/approve — approvedBy is the verified sub', () => {
  it('a sub-bearing VERIFIER token records approvedBy = sub on the promoted ACTUAL alert', async () => {
    const d = jwtDeps();
    const token = await signDevToken('VERIFIER', SECRET, '1h', 'user-em-7');
    const res = await handleHttp(
      req({
        method: 'POST',
        path: '/api/v1/alerts/ca-alert-draft-1/approve',
        headers: bearer(token),
      }),
      d,
    );
    expect(res.status).toBe(201);
    const data = (res.body as { data: { alert: { capStatus: string; approvedBy: string } } }).data;
    expect(data.alert.capStatus).toBe('ACTUAL');
    expect(data.alert.approvedBy).toBe('user-em-7');
  });
});

describe('POST /auth/dev-login — the demo IdP surface', () => {
  // A disabled dev-login must return the router's GENERIC NOT_FOUND body (never leak posture/config, PR#3).
  const expectGeneric404 = (res: Awaited<ReturnType<typeof handleHttp>>): void => {
    expect(res.status).toBe(404);
    expect((res.body as { errors?: { message?: string }[] }).errors?.[0]?.message).toBe(
      'no such route',
    );
  };

  it('opt-in: AUTH_SECRET + AUTH_DEV_LOGIN=on → 200 {token} re-verifying to {role, sub:userId}', async () => {
    const d = jwtDeps({ AUTH_SECRET: SECRET, AUTH_DEV_LOGIN: 'on' });
    const res = await handleHttp(
      req({
        method: 'POST',
        path: '/api/v1/auth/dev-login',
        body: JSON.stringify({ role: 'VERIFIER', userId: 'user-alice' }),
      }),
      d,
    );
    expect(res.status).toBe(200);
    const token = (res.body as { token: string }).token;
    expect(typeof token).toBe('string');
    expect(await resolvePrincipal(bearer(token), { AUTH_SECRET: SECRET })).toEqual({
      role: 'VERIFIER',
      sub: 'user-alice',
    });
  });

  it('opt-in default: AUTH_SECRET set but AUTH_DEV_LOGIN unset → 404 (a secret alone never exposes minting)', async () => {
    const d = jwtDeps(); // AUTH_SECRET set, AUTH_DEV_LOGIN NOT set
    const res = await handleHttp(
      req({
        method: 'POST',
        path: '/api/v1/auth/dev-login',
        body: JSON.stringify({ role: 'VERIFIER', userId: 'user-alice' }),
      }),
      d,
    );
    expectGeneric404(res);
  });

  it('cloud/prod hard-off: even AUTH_SECRET + AUTH_DEV_LOGIN=on → 404 when NODE_ENV=production or DEPLOY_MODE=cloud', async () => {
    for (const env of [
      { AUTH_SECRET: SECRET, AUTH_DEV_LOGIN: 'on', NODE_ENV: 'production' },
      { AUTH_SECRET: SECRET, AUTH_DEV_LOGIN: 'on', DEPLOY_MODE: 'cloud' },
    ]) {
      const res = await handleHttp(
        req({
          method: 'POST',
          path: '/api/v1/auth/dev-login',
          body: JSON.stringify({ role: 'EM', userId: 'attacker' }),
        }),
        jwtDeps(env),
      );
      expectGeneric404(res); // the arbitrary-role minter is never reachable in a cloud/prod build
    }
  });

  it('without AUTH_SECRET (offline/e2e posture) → 404 (no token ever minted)', async () => {
    const d = devHeaderDeps(); // no AUTH_SECRET
    const res = await handleHttp(
      req({
        method: 'POST',
        path: '/api/v1/auth/dev-login',
        body: JSON.stringify({ role: 'VERIFIER', userId: 'user-alice' }),
      }),
      d,
    );
    expectGeneric404(res);
  });

  it('with AUTH_DEV_LOGIN=off it is disabled even when AUTH_SECRET is set → 404', async () => {
    const d = jwtDeps({ AUTH_SECRET: SECRET, AUTH_DEV_LOGIN: 'off' });
    const res = await handleHttp(
      req({
        method: 'POST',
        path: '/api/v1/auth/dev-login',
        body: JSON.stringify({ role: 'VERIFIER', userId: 'user-alice' }),
      }),
      d,
    );
    expectGeneric404(res);
  });

  it('rejects an unknown role with 400 VALIDATION_ERROR', async () => {
    const d = jwtDeps({ AUTH_SECRET: SECRET, AUTH_DEV_LOGIN: 'on' });
    const res = await handleHttp(
      req({
        method: 'POST',
        path: '/api/v1/auth/dev-login',
        body: JSON.stringify({ role: 'SUPERADMIN', userId: 'x' }),
      }),
      d,
    );
    expect(res.status).toBe(400);
  });
});
