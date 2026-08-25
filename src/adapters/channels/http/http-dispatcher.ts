// BEACON — HTTP dispatcher (E7·T-334; ADR-023). The framework-agnostic driving adapter over the shared
// core: it resolves the actor role (stub RBAC, ADR-017), rate-limits per actor, maps the route → a
// canonical Command, stamps receivedAt from the injected clock, dispatches through buildInteraction()'s
// InteractionPort, and serializes the universal Envelope. ZERO core change — the router owns RBAC + logic.
import { DomainError } from '@/domain/errors.js';
import type { AppUserRole } from '@/domain/app-user.js';
import type { CommandVerb, Envelope, InteractionRequest } from '@/ports/interaction.js';
import { buildInteraction, type BuildCoreOptions } from '@/main/build-core.js';
import { buildFeatureDeps, type FeatureSeed } from '@/main/feature-seed.js';
import type { MapSeed } from '@/adapters/memory/memory-map.js';
import { assembleLiveSeeds } from '@/main/live-composition.js';
import { startBackgroundJobs, type BackgroundJobsOptions } from '@/main/scheduler.js';
import { MemoryReportStore, defaultReportQueueSeed } from '@/adapters/memory/memory-core.js';
import { loadConfig, type Env } from '@/config/index.js';
import { makeDb } from '@/adapters/persistence/client.js';
import { makePgPublicReportStore } from '@/adapters/persistence/read-models.js';
import type { HttpDeps, HttpFeatureDeps, HttpRequest, HttpResponse } from './http-types.js';
import { resolvePrincipal, actorKey, actorId, signDevToken, type Principal } from './rbac.js';
import { parseCredentials, verifyCredential, type CredentialRecord } from './credentials.js';
import { createTokenBucketLimiter, type TokenBucketOptions } from './rate-limit.js';
import { statusForError, apiErrorEnvelope, channelErrorEnvelope } from './error-mapping.js';
import { resolveRoute, type RouteResult } from './routing.js';
import { handleSustainability } from './sustainability.js';
import { handleFeatureRoute } from './routes/feature-router.js';
import { streamTopic, type StreamDelta } from './routes/stream.js';
import { scanInjection } from '@/adapters/compliance/firewall.js';

const JSON_HEADERS: Readonly<Record<string, string>> = { 'content-type': 'application/json' };

/** Untrusted free-text carried by a command (report text / alert headline) — firewalled before the core. */
function freeText(command: Extract<RouteResult, { kind: 'command' }>['command']): readonly string[] {
  if (command.verb === 'report') return [command.text];
  if (command.verb === 'alert:draft') return [command.headline];
  return [];
}

// POST /reports + POST /alerts create (201); PATCH /reports transitions (202); reads are 200 — SPEC §2.3.
const SUCCESS_STATUS: Partial<Record<CommandVerb, number>> = { report: 201, 'alert:draft': 201, verify: 202 };

function json(status: number, body: unknown): HttpResponse {
  return { status, body, headers: JSON_HEADERS };
}

/**
 * The delta `type` published for each MUTATING verb (F-416). Read verbs are absent on purpose — a GET
 * changes nothing, and a delta for it would make every client refetch in a loop.
 */
const DELTA_TYPE: Partial<Record<CommandVerb, string>> = {
  report: 'report.created',
  verify: 'report.verified',
  'alert:draft': 'alert.drafted',
};

/**
 * Publish the region-keyed SSE delta for a successful mutation (F-416 — the missing half of the push
 * channel). `EventBusPort.publish` was implemented and called from NOWHERE, so `GET /api/v1/stream`
 * served `hello` + heartbeats forever and the COP refreshed only on the client's polling rung. This is the
 * call site that was absent — the sixth instance of "code exists, nothing runs it" in this project.
 *
 * Four properties, each load-bearing:
 *
 *  1. **Art. XII — no figure travels.** The frame carries exactly `{type, region, entity, at}`: what kind
 *     of thing changed, where, which one, and when. The client REFETCHES over REST, where provenance,
 *     freshness and RBAC all apply. A delta is a doorbell, never a delivery.
 *  2. **Region-keyed (THREAT T13.1).** Published to `region:<id>:delta`, so a subscriber only ever sees
 *     its own region. When the router could not attribute the change to a region (an SOS filed against no
 *     incident), NOTHING is published rather than broadcasting to a shared topic — and the client still
 *     picks the change up on its polling rung.
 *  3. **Never fails the write (Art. XVI).** The mutation is already committed by the time this runs.
 *     Notification is a side effect, never a precondition, so any failure is swallowed here: a subscriber
 *     problem must not turn a successful SOS submission into a 5xx.
 *  4. **Mutations only.** Keyed off `DELTA_TYPE`, so adding a read verb cannot accidentally start a
 *     refetch storm.
 */
async function publishDelta(verb: CommandVerb, envelope: Envelope, deps: HttpDeps): Promise<void> {
  const type = DELTA_TYPE[verb];
  if (type === undefined) return;
  const region = envelope.meta?.['regionId'];
  if (typeof region !== 'string' || region === '') return; // unattributable ⇒ polling rung covers it
  const entity = (envelope.data as { readonly id?: unknown } | null)?.id;
  const delta: StreamDelta = {
    type,
    region,
    entity: typeof entity === 'string' ? entity : '*', // '*' ⇒ refetch the whole region
    at: deps.clock(),
  };
  try {
    await deps.features.eventBus.publish(streamTopic(region), delta);
  } catch {
    // Deliberately swallowed — see property 3 above.
  }
}

/**
 * The `beacon-locale` cookie → InteractionRequest.locale. This is the connection the ports contract
 * DOCUMENTED from day one ("HTTP: the `beacon-locale` cookie", ports/interaction.ts) and nothing ever
 * implemented — so `NarrativeRequest.locale` and the whole i18n-narration chain behind it sat dark while
 * every SitRep narrated in English regardless of the UI language (found 2026-08-04; the claim-text class
 * again: a declared contract nothing honours). Presentation-only by construction: the value is coerced
 * through the locale allowlist downstream and never reaches the deterministic engine — which is also why
 * a malformed value (invalid percent-encoding would make decodeURIComponent THROW) degrades to
 * "no locale" instead of letting a hostile Cookie header turn into a 500.
 */
function localeFromCookie(headers: Record<string, string | undefined>): string | undefined {
  const cookie = headers['cookie'];
  if (cookie === undefined) return undefined;
  const match = /(?:^|;\s*)beacon-locale=([^;]+)/.exec(cookie);
  if (match?.[1] === undefined) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

/** Dispatch a resolved Command through the shared core and serialize the Envelope (or error). */
async function dispatchCommand(
  route: Extract<RouteResult, { kind: 'command' }>,
  principal: Principal,
  deps: HttpDeps,
  reqHeaders: Record<string, string | undefined>,
): Promise<HttpResponse> {
  // Input firewall (ADR-017): reject prompt-injection / blocked-command payloads in untrusted free-text
  // BEFORE the core — the per-channel invariant stated in ports/interaction.ts. 403 short-circuit.
  if (freeText(route.command).some((t) => scanInjection(t) !== null)) {
    return json(403, channelErrorEnvelope('FORBIDDEN', 'input rejected by content firewall'));
  }
  const request: InteractionRequest = {
    channel: 'http',
    actorRole: principal.role,
    command: route.command,
    receivedAt: deps.clock(),
    // Server-derived TRUE actor (verified JWT `sub`, else role key). Additive; the core already threads
    // the verb's own actorId to the audit trail — this correlates the whole request (Art. XIII).
    actorId: actorId(principal),
    ...((): { locale?: string } => {
      const locale = localeFromCookie(reqHeaders);
      return locale !== undefined ? { locale } : {};
    })(),
  };
  // The router returns Err for typed failures, but a driven adapter (e.g. the report state machine) may
  // THROW a DomainError. Catch both here so every failure is a mapped status + {code,message} — a non-domain
  // throw becomes an opaque 500 (never leak a stack/internal message beyond {code,message}).
  try {
    const res = await deps.interaction.handle(request);
    if (!res.ok) return json(statusForError(res.error.code), apiErrorEnvelope(res.error));
    await publishDelta(route.command.verb, res.value, deps);
    return json(SUCCESS_STATUS[route.command.verb] ?? 200, res.value);
  } catch (thrown) {
    if (thrown instanceof DomainError) {
      return json(statusForError(thrown.code), apiErrorEnvelope(thrown));
    }
    return json(500, channelErrorEnvelope('INTERNAL_ERROR', 'internal error'));
  }
}

/**
 * Dispatch a matched feature route (logistics / interop / map / queue) under the SAME failure contract
 * `dispatchCommand` has had all along. Returns `null` when no feature route matched.
 *
 * F-350 (general case). `handleFeatureRoute` was called bare — outside any try/catch — while the command
 * path directly below it was wrapped. A throw anywhere in `logistics.ts`, `interop.ts`, `map.ts` or
 * `queue.ts` therefore escaped `handleHttp` entirely and surfaced as a framework 500 with **no envelope**:
 * no `{code, message}`, no provenance, and a stack or internal message potentially rendered to the caller.
 * The concrete instance found by the audit was a malformed `provenance` row producing
 * `TypeError: Cannot read properties of null (reading 'id')` on the incident-summary export.
 *
 * The asymmetry was the whole bug — two sibling dispatch paths, one hardened and one not. A non-domain
 * throw becomes an opaque 500 carrying `{code, message}` ONLY: never a stack, never an internal message
 * (which could contain a connection string), and never a hint about internal structure.
 */
async function dispatchFeature(
  req: HttpRequest,
  role: AppUserRole,
  deps: HttpDeps,
  actor: string,
): Promise<HttpResponse | null> {
  try {
    // Inside the try on purpose: route MATCHING can throw too, not just the awaited handler.
    const feature = handleFeatureRoute(req, role, deps, actor);
    return feature === null ? null : await feature;
  } catch (thrown) {
    if (thrown instanceof DomainError) {
      return json(statusForError(thrown.code), apiErrorEnvelope(thrown));
    }
    return json(500, channelErrorEnvelope('INTERNAL_ERROR', 'internal error'));
  }
}

/** FEATURE_CITIZEN_STREAM (Live Views v1.2, ADR-029) off the RAW env — default off; gates POST /reports liveViewUrl. */
function citizenStreamOn(env: Record<string, string | undefined>): boolean {
  return (env.FEATURE_CITIZEN_STREAM ?? 'off').toLowerCase() === 'on';
}

/**
 * Handle one HTTP request against the shared core. Order: rate-limit → route → (system probe | command).
 * Never throws; every failure path is a typed status + {code,message} body (no internal detail leaks).
 */
export async function handleHttp(req: HttpRequest, deps: HttpDeps): Promise<HttpResponse> {
  // Real auth (ADR-017): verify a bearer JWT when AUTH_SECRET is set, else the fail-closed dev-header path.
  // The PRINCIPAL carries the RBAC role AND (for a verified JWT) the true per-user identity `sub`.
  const principal = await resolvePrincipal(req.headers, deps.env);
  const role = principal.role;

  // Rate-limit key stays the RESOLVED (trusted) role — never a per-user or client-chosen value (spoof-proof).
  if (!deps.rateLimiter.take(actorKey(role))) {
    // SPEC §2.3: 429 carries Retry-After (seconds) so clients back off deterministically.
    return {
      status: 429,
      body: channelErrorEnvelope('RATE_LIMITED', 'rate limit exceeded; retry later'),
      headers: { ...JSON_HEADERS, 'retry-after': '1' },
    };
  }

  // Feature routes (logistics/interop) are matched BEFORE the command/system routing; a null means no
  // feature route matched → fall through to resolveRoute (reports/alerts/status/…). RBAC lives in the handlers.
  const feature = await dispatchFeature(req, role, deps, actorId(principal));
  if (feature !== null) return feature;

  // FEATURE_CITIZEN_STREAM (Live Views v1.2, ADR-029) is read off the RAW env here (default off), same as
  // the other call-site feature reads — it gates the optional POST /reports `liveViewUrl` field in routing.
  const route = resolveRoute(req, actorId(principal), citizenStreamOn(deps.env));
  return dispatchRoute(route, principal, deps, req.headers);
}

/** The resolved-route switch, split out of handleHttp so each stays under the complexity ceiling. */
function dispatchRoute(
  route: RouteResult,
  principal: Principal,
  deps: HttpDeps,
  reqHeaders: Record<string, string | undefined>,
): Promise<HttpResponse> | HttpResponse {
  switch (route.kind) {
    case 'health':
      return json(200, { status: 'ok' });
    case 'me':
      // Optionally surface the verified per-user identity (sub) alongside the role.
      return json(200, { role: principal.role, ...(principal.sub !== undefined ? { sub: principal.sub } : {}) });
    case 'sustainability':
      return handleSustainability(deps.clock);
    case 'dev-login':
      return handleDevLogin(route, deps);
    case 'login':
      return handleLogin(route, deps);
    case 'command':
      return dispatchCommand(route, principal, deps, reqHeaders);
    case 'error':
      return json(route.status, channelErrorEnvelope(route.code, route.message));
  }
}

/**
 * POST /auth/dev-login — demo IdP only; NOT production issuance. Mints a short-lived HS256 bearer for
 * {role, userId} ONLY when AUTH_SECRET is configured. With NO secret (the offline/e2e posture) it is
 * disabled → 404, so those flows never receive a token and keep using the x-beacon-role dev header.
 */
async function handleDevLogin(
  route: Extract<RouteResult, { kind: 'dev-login' }>,
  deps: HttpDeps,
): Promise<HttpResponse> {
  // HARD-OFF in a production/cloud build (belt-and-suspenders, SECURITY): even a fully-configured
  // AUTH_SECRET + AUTH_DEV_LOGIN=on must NOT mint an arbitrary-role token when the profile is cloud/prod.
  // So a flag flipped (or leaked) in a cloud deploy still cannot expose the arbitrary-role minter — the
  // route stays 404 regardless. The demo IdP is only ever reachable in a local/dev profile.
  // When disabled, return the router's GENERIC 'no such route' body (SECURITY, PR#3): a 404 must not confirm
  // the route exists or reveal posture/config (prod/cloud, missing secret) — the feature stays hard-off either way.
  if (deps.env.NODE_ENV === 'production' || deps.env.DEPLOY_MODE === 'cloud') {
    return json(404, channelErrorEnvelope('NOT_FOUND', 'no such route'));
  }
  const secret = deps.env.AUTH_SECRET;
  // OPT-IN by default (least privilege): the demo IdP mints tokens ONLY when a secret is configured AND
  // AUTH_DEV_LOGIN=on is set explicitly. A secret alone is NOT enough — so a real cloud deployment that sets
  // AUTH_SECRET does not silently expose an arbitrary-role token minter (privilege-escalation surface). The
  // offline/e2e posture (no secret) never mints. Enable it deliberately for a demo profile only.
  const enabled = (deps.env.AUTH_DEV_LOGIN ?? '').toLowerCase() === 'on';
  if (secret === undefined || secret === '' || !enabled) {
    return json(404, channelErrorEnvelope('NOT_FOUND', 'no such route'));
  }
  const token = await signDevToken(route.role, secret, '1h', route.userId);
  return json(200, { token });
}

/**
 * Derive the configured named accounts. Extracted so createHttpDepsLive stays under the complexity ceiling
 * (the `?? ''` default is a branch); an unset AUTH_SECRET yields no usable accounts, and the login route
 * then 404s — the correct fail-closed posture rather than accounts secured by an empty secret.
 */
function loadCredentials(rawEnv: Record<string, string | undefined>): Promise<readonly CredentialRecord[]> {
  const secret = rawEnv.AUTH_SECRET;
  if (secret === undefined || secret === '') return Promise.resolve([]);
  return parseCredentials(rawEnv.AUTH_USERS, secret);
}

/**
 * Session lifetime for a real login. 12h ≈ one operational shift: long enough that an EM is not re-typing
 * a password during an incident, short enough that a token left on a shared EOC screen expires the same day.
 */
const AUTH_TOKEN_TTL = '12h';

/**
 * POST /auth/login — the REAL named-account login. Unlike `handleDevLogin` this is NOT hard-off in cloud:
 * it is exactly what a deployed BEACON needs, because it grants only the role its CONFIGURED account
 * already has (the request cannot ask for a role at all).
 *
 * Disabled — 404 with the router's GENERIC body, so the response never confirms posture — when the server
 * has no AUTH_SECRET or no configured accounts. A wrong credential is a flat 401 that distinguishes
 * neither "no such user" nor "wrong password" (verifyCredential also equalises the timing).
 */
async function handleLogin(
  route: Extract<RouteResult, { kind: 'login' }>,
  deps: HttpDeps,
): Promise<HttpResponse> {
  const secret = deps.env.AUTH_SECRET;
  if (secret === undefined || secret === '' || deps.credentials === undefined || deps.credentials.length === 0) {
    return json(404, channelErrorEnvelope('NOT_FOUND', 'no such route'));
  }
  const account = await verifyCredential(deps.credentials, route.userId, route.password, secret);
  if (account === undefined) {
    return json(401, channelErrorEnvelope('UNAUTHORIZED', 'invalid credentials'));
  }
  // `sub` is the REAL account id, so every downstream audit record names a person rather than `role:EM`.
  const token = await signDevToken(account.role, secret, AUTH_TOKEN_TTL, account.userId);
  return json(200, { token, role: account.role, userId: account.userId });
}

export interface CreateHttpDepsOptions {
  /** Core wiring (injected clock/newId/seed/env/ai). Built ONCE so report-store state survives requests. */
  readonly core?: BuildCoreOptions;
  /** Rate-limit tuning (capacity/refillPerSec). The clock is shared with the core. */
  readonly rateLimit?: Omit<TokenBucketOptions, 'clock'>;
  /** Offline feature dataset (logistics/hazards/DRAFT alerts). Defaults to the built-in CA + RO feature seed. */
  readonly featureSeed?: FeatureSeed;
  /** SSE heartbeat interval (ms); 0/omitted ⇒ disabled (deterministic tests). */
  readonly heartbeatMs?: number;
}

const RETENTION_DAYS = 30;
const DAY_MS = 86_400_000;

/** Local deterministic-ish id minter (prefix + boot epoch + counter) — matches build-core's default. */
function makeIdMinter(clock: () => string): (prefix: string) => string {
  const boot = Date.parse(clock());
  let n = 0;
  return (prefix) => `${prefix}-${boot}-${++n}`;
}

/**
 * Compose HttpDeps: build the InteractionPort + feature adapters ONCE, plus a clock-sharing rate limiter.
 * The report store is built HERE and SHARED into the core (so POST/PATCH /reports mutate it) and exposed
 * on `reports` (so GET /reports reads it) — a single source of truth for the verifier queue. It is seeded
 * with the offline demo queue so the decide leg is reachable out of the box (offline default, Art. XVI).
 */
export function createHttpDeps(options: CreateHttpDepsOptions = {}): HttpDeps {
  const clock = options.core?.clock ?? (() => new Date().toISOString());
  const newId = options.core?.newId ?? makeIdMinter(clock);
  const purgeAfter = new Date(Date.parse(clock()) + RETENTION_DAYS * DAY_MS).toISOString();
  const reportStore = new MemoryReportStore(clock, newId, RETENTION_DAYS, defaultReportQueueSeed(purgeAfter));
  const interaction = buildInteraction({ ...options.core, clock, newId, reportStore });
  const rateLimiter = createTokenBucketLimiter({ ...options.rateLimit, clock });
  const features = buildFeatureDeps({
    clock,
    newId,
    ...(options.featureSeed ? { seed: options.featureSeed } : {}),
    ...(options.heartbeatMs !== undefined ? { heartbeatMs: options.heartbeatMs } : {}),
  });
  return { interaction, clock, rateLimiter, env: options.core?.env ?? process.env, features, reports: reportStore };
}

/**
 * The durable-or-memory shared report store (parity with build-core's resolveStore): FEATURE_STORE=postgres
 * ⇒ the Postgres store (public reports + hash-chained triage audit survive restarts); else the in-memory
 * store seeded with the offline demo queue so the decide leg is reachable out of the box (Art. XVI).
 */
function makeReportStore(config: ReturnType<typeof loadConfig>, clock: () => string, newId: (p: string) => string) {
  if (config.FEATURE_STORE === 'postgres') return makePgPublicReportStore(makeDb(config.DATABASE_URL), clock, newId);
  const purgeAfter = new Date(Date.parse(clock()) + RETENTION_DAYS * DAY_MS).toISOString();
  return new MemoryReportStore(clock, newId, RETENTION_DAYS, defaultReportQueueSeed(purgeAfter));
}

/** Build the feature adapters, injecting the offline feature seed + (when live) the adapter-sourced map seed. */
function featureDepsFor(options: CreateHttpDepsOptions, clock: () => string, newId: (p: string) => string, mapSeed?: MapSeed) {
  return buildFeatureDeps({
    clock,
    newId,
    ...(options.featureSeed ? { seed: options.featureSeed } : {}),
    ...(mapSeed !== undefined ? { mapSeed } : {}),
    ...(options.heartbeatMs !== undefined ? { heartbeatMs: options.heartbeatMs } : {}),
  });
}

/**
 * Compose HttpDeps for a LIVE run (async): honours FEATURE_STORE=postgres (durable reports), AI_MODE=cloud|
 * local (real narration via the compliance proxy — wired in build-core's resolveAi), and
 * DATA_SOURCE_COMPOSITION=adapters (the engines compute over LIVE source-adapter geometry for the SitRep AND
 * the COP map). With no flags set it reduces to the offline default of createHttpDeps (same seeds, memory
 * store) — one path for every profile. The report store is built ONCE and SHARED into the core + `reports`.
 */
/**
 * The background-jobs wiring, extracted only to keep `createHttpDepsLive` under the complexity ceiling.
 * The notifier and audience are BOTH optional and BOTH come from the Telegram-live broadcast composition
 * (`makeBroadcastDeps`): with Telegram not live neither exists, and the watcher composes to no job at all
 * rather than to a job that ticks against a transport that cannot send.
 */
function backgroundJobsOptions(
  config: Env,
  clock: () => string,
  reports: object,
  features: HttpFeatureDeps,
): BackgroundJobsOptions {
  const { notifier, subscribers } = features.interop;
  return {
    config,
    clock,
    reports,
    ...(notifier !== undefined ? { notifier } : {}),
    ...(subscribers !== undefined ? { audience: subscribers.list() } : {}),
  };
}

export async function createHttpDepsLive(options: CreateHttpDepsOptions = {}): Promise<HttpDeps> {
  const rawEnv = options.core?.env ?? process.env;
  const config = loadConfig(rawEnv);
  const clock = options.core?.clock ?? (() => new Date().toISOString());
  const newId = options.core?.newId ?? makeIdMinter(clock);
  const reportStore = makeReportStore(config, clock, newId);
  const live = await assembleLiveSeeds(config, rawEnv, clock, newId);
  const interaction = buildInteraction({
    ...options.core,
    clock,
    newId,
    reportStore,
    ...(live ? { seed: live.coreSeed } : {}),
  });
  const rateLimiter = createTokenBucketLimiter({ ...options.rateLimit, clock });
  const features = featureDepsFor(options, clock, newId, live?.mapSeed);
  // Named accounts are derived ONCE here (scrypt is deliberately slow), and only on the LIVE path: the
  // sync/offline `createHttpDeps` deps carry none, so POST /auth/login stays 404 for e2e and air-gapped
  // runs, which keeps those flows on the dev header exactly as before.
  const credentials = await loadCredentials(rawEnv);
  // Background work starts HERE and only here (FR-LD-11/13). This is the LIVE composition root: reached
  // solely from the Next delegators, memoized as one promise per server process, so the jobs are started
  // once by the running server and never by the sync `createHttpDeps` the component/contract tests use.
  // `startBackgroundJobs` additionally refuses to create any timer under NODE_ENV=test, and creates none at
  // all when both features are off — which is the default and the pinned Playwright profile, so the gates
  // acquire no timer and behave exactly as they did before this call existed.
  // The watcher notifies through the SAME notifier as the approved-alert broadcast (Art. XIV redaction +
  // hash-chained audit) and reaches the same subscriber list; with Telegram not live both are absent and the
  // watcher composes to nothing rather than to a silent no-op transport.
  startBackgroundJobs(backgroundJobsOptions(config, clock, reportStore, features));
  return { interaction, clock, rateLimiter, env: rawEnv, features, reports: reportStore, credentials };
}

let cached: HttpDeps | undefined;

/** Lazy process-wide singleton for the Next delegators (build the core once per server process). */
export function getHttpDeps(): HttpDeps {
  cached ??= createHttpDeps();
  return cached;
}

let cachedAsync: Promise<HttpDeps> | undefined;

/**
 * Lazy process-wide async singleton for the Next delegators — the LIVE-aware entrypoint. Caches the PROMISE
 * (one build per process, no double-build race). The offline/default profile resolves to the same deps as
 * getHttpDeps(); postgres/live/AI profiles get the wired composition.
 */
export function getHttpDepsAsync(): Promise<HttpDeps> {
  cachedAsync ??= createHttpDepsLive();
  return cachedAsync;
}
