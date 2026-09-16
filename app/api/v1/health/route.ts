// BEACON — liveness and readiness, SEPARATE FROM THE COMPOSITION (2026-09-12).
//
// WHY THIS FILE EXISTS. Health used to be one `case` inside the dispatcher, reached through the catch-all
// delegator that awaits `getHttpDepsAsync()` first. So the probe could only answer once the whole live
// composition — config, five regions of adapters, the database client — had succeeded. Two outages in two
// days came through that door:
//
//   * 2026-09-11: the composition took longer than Railway's 60-second edge timeout on a cold container,
//     so the first request after every deploy was cut. Health was cut with it.
//   * 2026-09-12: one mistyped variable (`FEATURE_CACHE=postgres`, never a legal value for that flag) made
//     boot validation throw, and EVERY route including health returned an opaque 500. The sentence naming
//     the bad variable existed only in stderr.
//
// Both are the same design error: the probe that tells you the app is broken was implemented on top of the
// thing that breaks. Next resolves a static segment ahead of a catch-all, so this file takes `/api/v1/health`
// away from the delegator entirely. It imports no composition, reads no config and touches no database.
// It cannot fail for the reasons the app fails, which is the entire point of a probe.
//
// LIVENESS vs READINESS, and why the status code is what it is:
//   * 200 means the PROCESS is serving. Railway should restart on a non-200, and restarting will not fix a
//     bad variable or a slow upstream — it would just crash-loop a container that is working correctly.
//   * The body carries READINESS separately, so an operator (or the check script) sees `building`, `ready`
//     or `failed` without a restart loop hiding the difference.
//
// The failure MESSAGE is operator-only. `loadConfig` names the offending variable and its accepted values;
// that sentence turns an evening of log archaeology into a one-line fix, and it is also a description of
// this deployment's internals, so it goes only to a caller carrying a valid EM bearer — verified here
// with node:crypto against AUTH_SECRET, never through the composition that may be the thing that failed.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getCompositionState } from '@/adapters/channels/http/http-dispatcher.js';

const JSON_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'application/json',
  // A probe must never be answered from a cache — a cached "ready" outlives the outage it is meant to report.
  'cache-control': 'no-store',
};

/**
 * Is this caller an operator?
 *
 * It verifies the SAME HS256 bearer `/auth/login` mints, using only `node:crypto` and `AUTH_SECRET` —
 * deliberately NOT the composition's verifier, because the composition is what may be down and this
 * endpoint exists for exactly that moment. So an operator pastes the token they already have.
 *
 * (The first version compared the bearer to `AUTH_SECRET` itself while its comment claimed it accepted
 * the signed-in bearer and read `AUTH_USERS`. Neither was true: a real login token would have been
 * refused. Caught in review on PR #12. Implementing what the comment promised was the right repair —
 * a raw shared secret in an `Authorization` header is also a credential nobody should be encouraged to
 * paste around.)
 *
 * Fail-closed at every step: no secret, no token, a bad signature, a malformed payload or an expired
 * token all mean "not an operator". Nothing here throws — a probe that 500s is not a probe.
 */
function bearerOf(req: Request): string | null {
  const header = req.headers.get('authorization') ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) return null;
  const token = header.slice(7).trim();
  return token === '' ? null : token;
}

/** Is this the signature our own `AUTH_SECRET` would produce for these two segments? */
function signatureValid(
  encHeader: string,
  encPayload: string,
  signature: string,
  secret: string,
): boolean {
  const expected = createHmac('sha256', secret)
    .update(`${encHeader}.${encPayload}`)
    .digest('base64url');
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  // Length-check BEFORE timingSafeEqual: it throws on a length mismatch, which would turn a malformed
  // token into a 500 from the one endpoint that must never fail.
  return given.length === want.length && timingSafeEqual(given, want);
}

function isOperator(req: Request): boolean {
  const secret = process.env.AUTH_SECRET;
  if (secret === undefined || secret === '') return false;
  const token = bearerOf(req);
  if (token === null) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [encHeader, encPayload, signature] = parts as [string, string, string];
  try {
    // Signature first. A payload is worth reading only once it is known to be ours.
    if (!signatureValid(encHeader, encPayload, signature, secret)) return false;
    const payload = JSON.parse(Buffer.from(encPayload, 'base64url').toString('utf8')) as {
      role?: unknown;
      exp?: unknown;
    };
    // Expiry is enforced here too. A signature stays valid forever; the claim is what expires, and a
    // probe that honoured an expired token would be a quiet way to keep a revoked operator reading
    // deployment internals.
    if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return false;
    return payload.role === 'EM';
  } catch {
    return false; // malformed base64, malformed JSON — not an operator, and not an exception either
  }
}

/**
 * The POSTURE the live data path is actually running in.
 *
 * `DATA_SOURCE_COMPOSITION` gates the whole live adapter path and DEFAULTS TO `seed`. Under `seed` no
 * adapter is consulted at all, whatever its own `SOURCE_*_MODE` says — so a deployment with every source
 * set to `live` still serves the hand-seeded picture, and `GET /sources` reports MOCK for each one. On
 * 2026-09-12 that read exactly like 23 upstreams being down. It was one variable.
 *
 * `LIVE_REINGEST_INTERVAL_SEC` is the second half: 0 or unset means the picture is assembled once at boot
 * and never refreshed, so every figure ages from process start no matter how live the sources are.
 *
 * Neither is withheld. `GET /sources` already publishes every source's served mode to anonymous callers,
 * so this discloses nothing new — it just says in one field what otherwise has to be inferred from 38 rows.
 */
function posture(): {
  dataSourceComposition: string;
  liveAdapters: boolean;
  liveReingestSec: number;
} {
  const composition = process.env.DATA_SOURCE_COMPOSITION;
  const mode = composition === undefined || composition === '' ? 'seed' : composition;
  // `Number(...)`, NOT `parseInt`, because `loadConfig` coerces this with `z.coerce.number()` and that is
  // what the running app obeys. `parseInt('6e2')` is 6; the app reads 600. A probe that disagreed with the
  // configuration it reports on is worse than one that stays silent (Copilot, PR #14).
  const raw = Number(process.env.LIVE_REINGEST_INTERVAL_SEC ?? '');
  return {
    dataSourceComposition: mode,
    liveAdapters: mode === 'adapters',
    liveReingestSec: Number.isFinite(raw) && raw > 0 ? raw : 0,
  };
}

export function GET(req: Request): Response {
  const state = getCompositionState();
  const ready = state.status === 'ready';
  const body: Record<string, unknown> = {
    status: 'ok', // liveness: this process is serving
    ready,
    composition: state.status,
    ...posture(),
    ...(state.status !== 'idle' ? { startedAtMs: state.startedAtMs } : {}),
    ...(state.status === 'ready' || state.status === 'failed'
      ? { elapsedMs: state.settledAtMs - state.startedAtMs }
      : {}),
    // The reason is present but withheld unless the caller proves it is an operator, so an anonymous
    // caller learns THAT the composition failed (which the site's behaviour already tells them) and not
    // WHICH variable is wrong (which describes the deployment's internals).
    ...(state.status === 'failed'
      ? isOperator(req)
        ? { error: state.error }
        : { error: 'withheld — send the operator bearer token to see the reason' }
      : {}),
  };
  return new Response(JSON.stringify(body), { status: 200, headers: JSON_HEADERS });
}

export const dynamic = 'force-dynamic'; // never prerendered, never cached
