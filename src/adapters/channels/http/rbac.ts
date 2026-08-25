// BEACON — HTTP actor-role resolution (E7·T-320/T-321; ADR-017). Resolves the caller's RBAC role from the
// request headers. Two resolvers coexist:
//   • resolveRole(headers, env)      — SYNC, unchanged. Dev/demo path only: honours the (spoofable)
//     `x-beacon-role` header ONLY when `AUTH_DEV_TRUST_HEADER=on`; otherwise least-privilege PUBLIC.
//   • resolveRoleJwt(headers, env)   — ASYNC, real auth (ADR-017). If an `authorization: Bearer <jwt>`
//     header is present AND `AUTH_SECRET` is set, verify the token (jose, HS256, EXPLICIT alg allow-list —
//     rejects alg=none / alg-confusion; exp verified) and extract `role`. ANY failure (bad sig, wrong
//     secret, expired, alg=none, unknown role) ⇒ PUBLIC (FAIL-CLOSED; never throws out). With no bearer or
//     no AUTH_SECRET it falls back to the sync dev-header path, then PUBLIC.
// The RBAC gate itself is enforced downstream by the command-router (Art. XIII); this only resolves WHO.
//
// Wiring note (for the integrator): the dispatcher calls the async `resolveRoleJwt`
// (`await resolveRoleJwt(req.headers, deps.env)` in handleHttp) — real JWT auth when `AUTH_SECRET` is set,
// falling back to the sync dev-header path otherwise. `AUTH_SECRET` (HS256 shared secret) is documented in .env.example.
import { SignJWT, jwtVerify } from 'jose';
import type { AppUserRole } from '@/domain/app-user.js';
import { APP_USER_ROLES } from '@/domain/app-user.js';

/** The only JWT signature algorithm BEACON accepts — pinned allow-list rejects alg=none / RS-HS confusion. */
const JWT_ALGS = ['HS256'] as const;

/** Case-insensitive header read (Next lowercases header names; be tolerant of either). */
export function readHeader(
  headers: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower && v !== undefined) return v;
  }
  return undefined;
}

/**
 * Resolve the actor role. FAIL-CLOSED: only honour the (unauthenticated, spoofable) `x-beacon-role` header
 * when the explicit demo flag `AUTH_DEV_TRUST_HEADER=on` is set; otherwise ALWAYS PUBLIC (least privilege).
 * `env` defaults to process.env; tests inject it.
 */
export function resolveRole(
  headers: Readonly<Record<string, string | undefined>>,
  env: Record<string, string | undefined> = process.env,
): AppUserRole {
  // PRODUCTION/CLOUD HARD-OFF (finding F-344). The header-trust path is STRICTLY MORE POWERFUL than the
  // dev-login minter — it grants any role with no secret and no token at all — yet `handleDevLogin`
  // (http-dispatcher.ts) already hard-404s under these exact conditions and this did not. The asymmetry was
  // the bug: the weaker door was bolted and the stronger one left open.
  //
  // This is not hypothetical misconfiguration. EVERY profile in docs/E2E_TESTING_PLAYBOOK.md sets
  // AUTH_DEV_TRUST_HEADER=on, including the cloud-AI and live-source demos — so a copied demo profile was
  // one `DEPLOY_MODE=cloud` away from an unauthenticated caller reading precise SOS coordinates (Art. XIV)
  // and promoting a DRAFT alert to a schema-valid ACTUAL CAP recorded in the hash chain as a genuine
  // emission (Art. XIII). The E3 security audit demonstrated exactly that sequence against the real
  // dispatcher before this guard existed.
  //
  // ── NARROWED 2026-08-01, deliberately, after the first version broke the product. ──────────────────
  // The first cut of this guard was `NODE_ENV === 'production' || DEPLOY_MODE === 'cloud'`, copied verbatim
  // from `handleDevLogin`. That is wrong HERE, and running it revealed why: **`NODE_ENV=production` means
  // "optimized build", not "internet-reachable deployment".** `next start` sets it for ANY production build
  // — including `docker compose up`, the demo that gets filmed, and the Playwright suite, which deliberately
  // runs a prod build for deterministic timing. The strict rule silently downgraded every actor to PUBLIC in
  // all three, so the role switcher, the verifier queue and the logistics board would have been dead on
  // camera. Using NODE_ENV as a deployment signal is a category error.
  //
  // `DEPLOY_MODE` is the signal this project actually defines for the question being asked (`src/config/
  // index.ts:57`, `.env.example:16`), so it is the one that decides:
  //   • `cloud`                        ⇒ hard-off, unconditionally.
  //   • `production` w/o explicit local ⇒ hard-off, as defence in depth for a deploy that never set
  //                                       DEPLOY_MODE at all (the realistic misconfiguration).
  //   • `production` + explicit `local` ⇒ trusted. An operator stating DEPLOY_MODE=local is asserting this
  //                                       process is not internet-reachable. That is the demo and the tests.
  //
  // RESIDUAL RISK, stated rather than hidden: a cloud deployment that sets BOTH `DEPLOY_MODE=local` AND
  // `AUTH_DEV_TRUST_HEADER=on` re-opens the header path. That requires two explicit, individually documented
  // mistakes, and it is the price of having a local demo at all — the alternative was a guard so strict that
  // the product it protects does not run. `handleDevLogin` keeps the stricter rule: it is not needed by any
  // local flow, so nothing is gained by loosening it.
  if (env.DEPLOY_MODE === 'cloud') return 'PUBLIC';
  if (env.NODE_ENV === 'production' && env.DEPLOY_MODE !== 'local') return 'PUBLIC';
  if ((env.AUTH_DEV_TRUST_HEADER ?? '').toLowerCase() !== 'on') return 'PUBLIC';
  const candidate = readHeader(headers, 'x-beacon-role')?.toUpperCase();
  return (APP_USER_ROLES as readonly string[]).includes(candidate ?? '')
    ? (candidate as AppUserRole)
    : 'PUBLIC';
}

/** Rate-limit key: the resolved (trusted) role — never a client-chosen header (which would be spoofable). */
export function actorKey(role: AppUserRole): string {
  return `role:${role}`;
}

/**
 * The resolved caller: the RBAC `role` (always) plus the TRUE per-user identity `sub` (only when a
 * verified JWT carried a `sub` claim). The dev-header / PUBLIC branches have no verified identity, so
 * `sub` is absent there — `actorId()` falls back to the role key for them (fail-closed accountability).
 */
export interface Principal {
  readonly role: AppUserRole;
  readonly sub?: string;
}

/** Extract the raw JWT from an `authorization: Bearer <jwt>` header (case-insensitive), else undefined. */
function readBearer(headers: Readonly<Record<string, string | undefined>>): string | undefined {
  const raw = readHeader(headers, 'authorization');
  if (raw === undefined) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match?.[1];
}

/** Narrow an arbitrary JWT `role` claim to a known AppUserRole, else PUBLIC (fail-closed). */
function roleFromClaim(claim: unknown): AppUserRole {
  const candidate = typeof claim === 'string' ? claim.toUpperCase() : '';
  return (APP_USER_ROLES as readonly string[]).includes(candidate) ? (candidate as AppUserRole) : 'PUBLIC';
}

/**
 * Verify a bearer JWT (HS256, pinned alg allow-list, exp enforced by jose) and resolve its {role, sub}.
 * The `sub` claim (the true per-user identity) is carried through ONLY when it is a string. Any
 * verification failure (bad signature, wrong secret, expired, alg=none/confusion) ⇒ {role:'PUBLIC'}
 * with NO sub (fail-closed — a spoofed/forged token can never surface a per-user actor).
 */
async function verifyBearerPrincipal(token: string, secret: string): Promise<Principal> {
  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key, { algorithms: [...JWT_ALGS] });
    const role = roleFromClaim(payload.role);
    return typeof payload.sub === 'string' ? { role, sub: payload.sub } : { role };
  } catch {
    return { role: 'PUBLIC' };
  }
}

/**
 * Resolve the caller PRINCIPAL ({role, sub?}) with real JWT auth (ADR-017). Fail-closed at every branch:
 *   (a) `authorization: Bearer <jwt>` present AND `AUTH_SECRET` set ⇒ verify + extract {role, sub}
 *       (invalid ⇒ {role:'PUBLIC'}, no sub);
 *   (b) else the demo `AUTH_DEV_TRUST_HEADER=on` → `x-beacon-role` path ⇒ {role} (no sub — the header is
 *       unauthenticated, so there is no verified per-user identity to trust);
 *   (c) else {role:'PUBLIC'}.
 * `env` defaults to process.env; tests inject it. NEVER throws — a caller can await this without a guard.
 */
export async function resolvePrincipal(
  headers: Readonly<Record<string, string | undefined>>,
  env: Record<string, string | undefined> = process.env,
): Promise<Principal> {
  const bearer = readBearer(headers);
  const secret = env.AUTH_SECRET;
  if (bearer !== undefined && secret !== undefined && secret !== '') {
    return verifyBearerPrincipal(bearer, secret);
  }
  return { role: resolveRole(headers, env) };
}

/**
 * Resolve the actor role with real JWT auth (ADR-017). Thin wrapper over resolvePrincipal so existing
 * role-only callers/tests are unaffected. NEVER throws.
 */
export async function resolveRoleJwt(
  headers: Readonly<Record<string, string | undefined>>,
  env: Record<string, string | undefined> = process.env,
): Promise<AppUserRole> {
  return (await resolvePrincipal(headers, env)).role;
}

/**
 * The single "true actor, else role-key fallback" helper. Returns the verified per-user identity (`sub`)
 * when present, else the role key (`role:<ROLE>`) — so the audit trail always records the most accurate
 * server-derived actor available, never a client-supplied value.
 */
export function actorId(principal: Principal): string {
  // Treat an empty/whitespace `sub` as ABSENT (not a valid actor) so accountability stays fail-closed: a
  // blank JWT subject falls back to the role key rather than recording "" as the audit actor.
  const sub = principal.sub?.trim();
  return sub !== undefined && sub !== '' ? sub : actorKey(principal.role);
}

/**
 * Dev/test helper: mint a short-lived HS256 bearer token carrying `role` (validated by resolveRoleJwt)
 * and, when supplied, a `sub` (the per-user identity surfaced by resolvePrincipal). NOT for production
 * issuance — real tokens come from the auth provider. `exp` defaults to 1h from now; pass an absolute
 * epoch-seconds number (e.g. a past value) to forge an already-expired token in tests. The 4-arg
 * (role, secret, exp) shape stays backward-compatible — `sub` is optional.
 */
export function signDevToken(
  role: AppUserRole,
  secret: string,
  exp: string | number = '1h',
  sub?: string,
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  const builder = new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(exp);
  if (sub !== undefined) builder.setSubject(sub);
  return builder.sign(key);
}
