// BEACON — HTTP dispatcher (E7·T-334; ADR-023). The framework-agnostic driving adapter over the shared
// core: it resolves the actor role (stub RBAC, ADR-017), rate-limits per actor, maps the route → a
// canonical Command, stamps receivedAt from the injected clock, dispatches through buildInteraction()'s
// InteractionPort, and serializes the universal Envelope. ZERO core change — the router owns RBAC + logic.
import { DomainError } from '@/domain/errors.js';
import type { AppUserRole } from '@/domain/app-user.js';
import type { CommandVerb, Envelope, InteractionRequest } from '@/ports/interaction.js';
import type { PanelDataPort } from '@/ports/panels.js';
import type { PublicReportPort } from '@/ports/public-report.js';
import { buildInteraction, type BuildCoreOptions } from '@/main/build-core.js';
import { buildFeatureDeps, type FeatureSeed } from '@/main/feature-seed.js';
import { DEFAULT_FEATURE_SEED } from '@/main/feature-seed.js';
import { assembleLiveSeeds } from '@/main/live-composition.js';
import { deriveDraftAlertProposals } from '@/application/derivation/derive-alerts.js';
import type {
  LiveFeatureOverlay,
  LiveSeeds,
  ThresholdRulesSource,
} from '@/main/live-composition.js';
import { runLiveReingest } from '@/main/live-refresh.js';
import { incidentSink, panelDataStore, provenanceSink } from '@/main/build-core.js';
import { startBackgroundJobs, type BackgroundJobsOptions } from '@/main/scheduler.js';
import { MemoryReportStore, defaultReportQueueSeed } from '@/adapters/memory/memory-core.js';
import { loadConfig, type Env } from '@/config/index.js';
import { makeDb, sharedDb } from '@/adapters/persistence/client.js';
import { needsSeed } from '@/adapters/persistence/natural-keys.js';
import { loadThresholdRules } from '@/adapters/persistence/threshold-rules.js';
import { uniqueRules } from '@/domain/threshold-rule.js';
import { makePgPublicReportStore } from '@/adapters/persistence/read-models.js';
import type { HttpDeps, HttpFeatureDeps, HttpRequest, HttpResponse } from './http-types.js';
import type { PrePositioningTuning } from './routes/logistics.js';
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
function freeText(
  command: Extract<RouteResult, { kind: 'command' }>['command'],
): readonly string[] {
  if (command.verb === 'report') return [command.text];
  if (command.verb === 'alert:draft') return [command.headline];
  return [];
}

// POST /reports + POST /alerts create (201); PATCH /reports transitions (202); reads are 200 — SPEC §2.3.
const SUCCESS_STATUS: Partial<Record<CommandVerb, number>> = {
  report: 201,
  'alert:draft': 201,
  verify: 202,
};

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
 * The delta a completed live re-ingest publishes (V2·A12). Deliberately an EXISTING vocabulary term — the
 * one `stream.ts` already documents on the contract — paired with the existing `entity: '*'` convention
 * ("refetch the whole region"). A refresh changes the region's incidents wholesale, which is exactly what
 * those two already mean together; inventing a `region.refreshed` frame would make every subscriber learn a
 * new word to be told the same thing.
 */
const REFRESH_DELTA_TYPE = 'incident.updated';

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
  await publishOnRegion(deps, delta);
}

/**
 * Publish ONE already-built delta on its own region topic, swallowing any failure (property 3 above).
 * Extracted so the periodic re-ingest (V2·A12, `announceRefresh` below) rings the SAME doorbell through the
 * SAME code path rather than growing a second, subtly different publisher.
 */
async function publishOnRegion(deps: HttpDeps, delta: StreamDelta): Promise<void> {
  try {
    await deps.features.eventBus.publish(streamTopic(delta.region), delta);
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

/**
 * V2·A7 (ADR-040) — the role-gated operator links carried on the authenticated session read.
 *
 * `dbAdminUrl` (the Directus console) is returned ONLY when the SERVER-resolved principal is EM and the
 * deployment configured one. For every other role, and for the anonymous caller, the field is ABSENT —
 * not empty, not null — so the string never enters a response a non-EM client could keep. The principal
 * is already fail-closed upstream (`resolvePrincipal`: a forged/expired/alg-confused bearer verifies to
 * PUBLIC), so "EM" here means the server proved it rather than the client claimed it.
 *
 * Read off the RAW env at the call site, exactly like `AUTH_SECRET` / `AUTH_DEV_LOGIN` above — `EnvSchema`
 * declares `DB_ADMIN_URL` so a non-URL value is a boot error instead of a dead link handed to the one role
 * trusted to click it. It is DELIBERATELY not a `NEXT_PUBLIC_` mirror: `next build` inlines those into the
 * bundle every anonymous visitor downloads, which would make the role check a rendering decision about a
 * string everybody already holds. That is the whole defect this work package exists to avoid.
 */
function operatorLinks(
  principal: Principal,
  env: Record<string, string | undefined>,
): { readonly dbAdminUrl?: string } {
  const dbAdminUrl = env.DB_ADMIN_URL;
  if (principal.role !== 'EM' || dbAdminUrl === undefined || dbAdminUrl === '') return {};
  return { dbAdminUrl };
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
      // Optionally surface the verified per-user identity (sub) alongside the role, plus any operator link
      // this principal has earned (A7 — EM only; see operatorLinks). Both are additive and absent-by-default,
      // so every existing caller's body is unchanged.
      return json(200, {
        role: principal.role,
        ...(principal.sub !== undefined ? { sub: principal.sub } : {}),
        ...operatorLinks(principal, deps.env),
      });
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
function loadCredentials(
  rawEnv: Record<string, string | undefined>,
): Promise<readonly CredentialRecord[]> {
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
  if (
    secret === undefined ||
    secret === '' ||
    deps.credentials === undefined ||
    deps.credentials.length === 0
  ) {
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

/** Metres in a kilometre. Named so the ONE conversion below reads as a unit change, not a magic factor. */
const METRES_PER_KM = 1_000;

/**
 * V2·A9 — resolve the pre-positioning bounds from validated config into the units the engine speaks.
 *
 * THE UNIT CHANGE HAPPENS HERE AND NOWHERE ELSE. `PREPOSITION_RADIUS_KM` is kilometres because that is what
 * an operator reasons in and what CONFIGURATION.md documents; `suggestPrePositioning` takes metres because
 * that is what a haversine returns. Converting at the composition boundary keeps both sides honest in their
 * own unit and leaves exactly one line that can ever be wrong about it — a factor applied in two places is a
 * factor that will eventually be applied twice, or not at all.
 *
 * The schema defaults ARE today's hardcoded constants (20 km / 5), so an environment that sets neither
 * produces the same suggestions this endpoint produced before A9.
 */
export function prePositioningTuning(config: Env): PrePositioningTuning {
  return {
    nearRadiusMeters: config.PREPOSITION_RADIUS_KM * METRES_PER_KM,
    maxPerCategory: config.PREPOSITION_TOP_N,
  };
}

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
  const reportStore = new MemoryReportStore(
    clock,
    newId,
    RETENTION_DAYS,
    defaultReportQueueSeed(purgeAfter),
  );
  const interaction = buildInteraction({ ...options.core, clock, newId, reportStore });
  const rateLimiter = createTokenBucketLimiter({ ...options.rateLimit, clock });
  const features = buildFeatureDeps({
    clock,
    newId,
    ...(options.featureSeed ? { seed: options.featureSeed } : {}),
    ...(options.heartbeatMs !== undefined ? { heartbeatMs: options.heartbeatMs } : {}),
  });
  return {
    interaction,
    clock,
    rateLimiter,
    env: options.core?.env ?? process.env,
    features,
    reports: reportStore,
  };
}

/**
 * The durable-or-memory shared report store (parity with build-core's resolveStore): FEATURE_STORE=postgres
 * ⇒ the Postgres store (public reports + hash-chained triage audit survive restarts); else the in-memory
 * store seeded with the offline demo queue so the decide leg is reachable out of the box (Art. XVI).
 */
function makeReportStore(
  config: ReturnType<typeof loadConfig>,
  clock: () => string,
  newId: (p: string) => string,
) {
  if (config.FEATURE_STORE === 'postgres')
    return makePgPublicReportStore(makeDb(config.DATABASE_URL), clock, newId);
  const purgeAfter = new Date(Date.parse(clock()) + RETENTION_DAYS * DAY_MS).toISOString();
  return new MemoryReportStore(clock, newId, RETENTION_DAYS, defaultReportQueueSeed(purgeAfter));
}

/** Build the feature adapters, injecting the offline feature seed + (when live) the adapter-sourced map seed. */
/**
 * The feature seed the live picture runs on (ADR-044). Live-only: the DISCOVERED incidents' threshold
 * specs, hazard footprints and regions REPLACE the demo incidents' — the demo's specs would propose drafts
 * for incidents the COP no longer serves. Hybrid (`overlay.keepSeeded`): the demo incident is still served,
 * so its specs and forecast triggers keep running and the live specs are ADDED. Everything else in the seed
 * (logistics, arrival estimates) stays. The rule catalogue is the overlay's in both pictures — what the
 * live rules were read from (the table under Postgres) is what GET /threshold-rules lists.
 */
export function withLiveOverlay(base: FeatureSeed, overlay: LiveFeatureOverlay): FeatureSeed {
  const { forecastThresholds: seededForecast, ...rest } = base;
  const merged = {
    ...rest,
    thresholds: overlay.keepSeeded
      ? [...base.thresholds, ...overlay.thresholds]
      : overlay.thresholds,
    hazards: new Map([...base.hazards, ...overlay.hazards]),
    incidentRegions: new Map([...(base.incidentRegions ?? []), ...overlay.incidentRegions]),
    // What GET /threshold-rules lists = what runs: under hybrid the seeded specs' rules still run, so the
    // catalogue carries them ahead of the live rules (each id once; forecast triggers are appended where
    // the catalogue is read, since they are a function of the clock).
    ruleCatalogue: overlay.keepSeeded
      ? uniqueRules([...base.thresholds.map((spec) => spec.rule), ...overlay.thresholdRules])
      : overlay.thresholdRules,
  };
  return overlay.keepSeeded && seededForecast !== undefined
    ? { ...merged, forecastThresholds: seededForecast }
    : merged;
}

/**
 * ADR-044 follow-up — under Postgres the live composition evaluates the rules operators see and edit in
 * `threshold_rule`; every other posture evaluates the configuration file. Read on every cycle, so an edit
 * takes effect at the next reingest without a restart.
 */
function thresholdRulesSource(config: Env): ThresholdRulesSource | undefined {
  return config.FEATURE_STORE === 'postgres'
    ? () => loadThresholdRules(sharedDb(config.DATABASE_URL))
    : undefined;
}

function featureDepsFor(
  options: CreateHttpDepsOptions,
  clock: () => string,
  newId: (p: string) => string,
  live: LiveSeeds | null,
) {
  const mapSeed = live?.mapSeed;
  const overlay = live?.overlay;
  const base = options.featureSeed ?? DEFAULT_FEATURE_SEED;
  const seed = overlay !== undefined ? withLiveOverlay(base, overlay) : options.featureSeed;
  return buildFeatureDeps({
    clock,
    newId,
    ...(seed !== undefined ? { seed } : {}),
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
  /** V2·A12 — the periodic live re-ingest, absent (⇒ no job, no timer) unless an interval was configured. */
  reingest?: () => Promise<void>,
): BackgroundJobsOptions {
  const { notifier, subscribers } = features.interop;
  return {
    config,
    clock,
    reports,
    ...(notifier !== undefined ? { notifier } : {}),
    ...(subscribers !== undefined ? { audience: subscribers.list() } : {}),
    ...(reingest !== undefined ? { reingest } : {}),
  };
}

/**
 * ADR-041 — the OPERATOR-MAINTAINED panel store, present only under `FEATURE_STORE=postgres`.
 *
 * Extracted rather than spread inline for the reason `backgroundJobsOptions` and `evacRouteTrail` were:
 * the composition root is exactly where "one more conditional" accumulates past the complexity ceiling.
 * `{}` in the memory posture is the point — the five dock panels then serve their fixture rung and the
 * offline/air-gapped/Playwright profiles acquire no database dependency at all (Art. XVI).
 */
function operatorPanelStore(config: Env): { panelData?: PanelDataPort } {
  const panelData = panelDataStore(config);
  return panelData === undefined ? {} : { panelData };
}

// ── V2·A12 — PERIODIC LIVE RE-INGEST ────────────────────────────────────────────────────────────────────
//
// THE DEFECT THIS CLOSES. `getHttpDepsAsync` memoises this composition behind ONE promise per server
// process, so `assembleLiveSeeds` ran at the first request and NEVER AGAIN: the COP served a BOOT-TIME
// snapshot, `fetched_at` re-stamped per boot rather than per fetch, and a wildfire that started after boot
// could not appear until somebody restarted the process. `LIVE_REINGEST_INTERVAL_SEC` (default 0 = off) is
// what re-runs the composition; the three functions below are what compose, announce and install the
// result. The RUN itself — build fully, then swap in one statement, keep the last good picture on failure —
// belongs to `runLiveReingest` (src/main/live-refresh.ts), and the CADENCE to the existing scheduler loop.

/** Everything a re-ingest needs that does NOT come from the picture it is refreshing (`reingestedDeps`). */
export interface ReingestContext {
  readonly options: CreateHttpDepsOptions;
  readonly clock: () => string;
  readonly newId: (prefix: string) => string;
  /** The SAME store the boot composition built — a refresh must never orphan reports filed since boot. */
  readonly reportStore: PublicReportPort;
}

/**
 * Compose the picture a re-ingest serves: the two halves derived from the LIVE SEEDS rebuilt, everything
 * stateful kept BY REFERENCE.
 *
 * WHAT IS REBUILT is exactly what the boot composition derives from `assembleLiveSeeds` — the core
 * `interaction` (the incidents and readings every REST read and the SitRep compute over) and the map
 * read-model (the COP geometry) — through the SAME calls boot makes, so a refreshed picture and a rebooted
 * one are the same object graph. A second composition path here would be a second thing to drift.
 *
 * WHAT IS KEPT is not convenience; each one is a defect avoided:
 *  • `features.eventBus` — a new bus would ORPHAN every open SSE subscription, and the doorbell below would
 *    then ring where nobody is listening. The refresh would become invisible to the very clients it exists
 *    to reach.
 *  • `rateLimiter` — a fresh token bucket every interval is a rate limit a caller can simply wait out.
 *  • `reports` (and `ctx.reportStore` feeding the core) — the memory posture holds citizen reports there.
 *  • `features.interop` / `features.logistics` and the rest of `features` — approved alerts, the subscriber
 *    registry and logistics assignments are in-memory state a data refresh has no business resetting.
 *
 * `featureDepsFor` is called for its MAP and nothing else: going through the boot helper costs a few object
 * constructions and keeps ONE code path, where calling `makeMemoryMapReadModel` directly would be a second
 * place that has to remember which spatial engine the map read-model is built over.
 *
 * KNOWN AND DELIBERATE (memory posture only): rebuilding `interaction` re-seeds the in-memory core, so core
 * state that is NOT the shared report store — an alert approved since boot, a stored SitRep — does not
 * survive a refresh. Under `FEATURE_STORE=postgres` (the live-production posture) those live in the
 * database and are untouched. Re-seeding is inherent: the seed IS the incident picture being refreshed.
 */
export function reingestedDeps(
  seeds: LiveSeeds,
  previous: HttpDeps,
  ctx: ReingestContext,
): HttpDeps {
  const fresh = featureDepsFor(ctx.options, ctx.clock, ctx.newId, seeds);
  return {
    ...previous,
    interaction: buildInteraction({
      ...ctx.options.core,
      clock: ctx.clock,
      newId: ctx.newId,
      reportStore: ctx.reportStore,
      seed: seeds.coreSeed,
    }),
    features: {
      ...previous.features,
      ...seedDerivedLookups(fresh),
      map: fresh.map,
    },
  };
}

/**
 * The feature deps that are pure functions of the refreshed picture — no store, no subscription, nothing
 * an operator's action lives in — so a reingest replaces them while every stateful singleton (bus,
 * limiter, reports, interop, logistics) is carried over by reference. Until 2026-09-14 (Copilot, #37) only
 * the map read-model followed the picture: an operator's rule edit was read every cycle and listed never,
 * and routes kept starting from the boot-time footprints.
 */
function seedDerivedLookups(fresh: HttpFeatureDeps): Partial<HttpFeatureDeps> {
  return {
    ...(fresh.thresholdRules !== undefined ? { thresholdRules: fresh.thresholdRules } : {}),
    ...(fresh.hazardArrivalFor !== undefined ? { hazardArrivalFor: fresh.hazardArrivalFor } : {}),
    ...(fresh.originFor !== undefined ? { originFor: fresh.originFor } : {}),
    ...(fresh.projectedExtentFor !== undefined
      ? { projectedExtentFor: fresh.projectedExtentFor }
      : {}),
    ...(fresh.forecastEvidenceFor !== undefined
      ? { forecastEvidenceFor: fresh.forecastEvidenceFor }
      : {}),
  };
}

/**
 * Ring the doorbell for a completed re-ingest — EXISTING vocabulary, EXISTING publisher: one
 * `{type:'incident.updated', region, entity:'*', at}` per region the refreshed seed attributes, on that
 * region's own topic (THREAT T13.1). Art. XII is unchanged because nothing about the frame changed: no
 * figure travels, and the client refetches over REST where provenance, freshness and RBAC apply.
 *
 * EVERY attributed region is announced rather than only the ones whose values moved, because a successful
 * re-ingest re-stamps the freshness the COP displays: "nothing changed except when we last looked" is still
 * a change to what is on screen, and is the one an operator watching a quiet region most wants to see.
 */
export async function announceRefresh(next: HttpDeps, seeds: LiveSeeds): Promise<void> {
  const at = next.clock();
  // Every MAP region, not only every region with an incident: under the live-only picture (ADR-043) a
  // quiet region has no incident at all, and "nothing is happening, as of now" is still a refresh worth
  // announcing.
  const regions = new Set([
    ...Object.keys(seeds.mapSeed),
    ...seeds.coreSeed.incidents.map((incident) => String(incident.regionId)),
  ]);
  for (const region of regions) {
    await publishOnRegion(next, { type: REFRESH_DELTA_TYPE, region, entity: '*', at });
  }
}

/**
 * The DRAFT alerts the live threshold specs propose this cycle, added to the alert store the operators
 * are working in (ADR-044). The store is kept across refreshes on purpose (an approval must survive a data
 * refresh), so new drafts are ADDED and an alert that already exists — approved, declined or still a
 * draft — is never touched: the evaluator's cooldown state decides re-firing, not this loop.
 */
export async function adoptLiveDrafts(next: HttpDeps, seeds: LiveSeeds): Promise<number> {
  if (seeds.overlay === undefined) return 0;
  const proposals = deriveDraftAlertProposals({
    specs: seeds.overlay.thresholds,
    now: Date.parse(next.clock()),
  });
  let added = 0;
  for (const proposal of proposals) {
    const existing = await next.features.interop.alerts.get(proposal.alert.id);
    if (existing !== null) continue;
    await next.features.interop.alerts.save(proposal.alert);
    added += 1;
  }
  return added;
}

/**
 * The re-ingest runner handed to `startBackgroundJobs`, or `undefined` when the interval is 0 (off) — with
 * no runner the scheduler registers no job and creates no timer, so every profile that leaves this unset is
 * byte-identical to before this seam existed.
 *
 * `current` is `getHttpDepsAsync` ITSELF: the memoised promise IS the served picture, so each run composes
 * over the LATEST one (successive refreshes chain rather than fork off the boot picture) and `commit` is the
 * single statement that replaces it.
 */
function liveReingestFor(
  config: Env,
  rawEnv: Record<string, string | undefined>,
  ctx: ReingestContext,
): (() => Promise<void>) | undefined {
  if (config.LIVE_REINGEST_INTERVAL_SEC === 0) return undefined;
  return async (): Promise<void> => {
    await runLiveReingest<HttpDeps, LiveSeeds>({
      current: getHttpDepsAsync,
      assemble: () =>
        assembleLiveSeeds(
          config,
          rawEnv,
          ctx.clock,
          ctx.newId,
          provenanceSink(config),
          incidentSink(config),
          thresholdRulesSource(config),
        ),
      compose: (seeds, previous) => reingestedDeps(seeds, previous, ctx),
      commit: swapHttpDepsAsync,
      announce: async (next, seeds) => {
        await adoptLiveDrafts(next, seeds);
        await announceRefresh(next, seeds);
      },
    });
  };
}

/**
 * ADR-046 — the app seeds its own database when it finds it unseeded. The pre-deploy command
 * (`node scripts/migrate.mjs && node scripts/seed.mjs`) remains the documented path, but the live
 * deployment had it configured and still carried region rows without a natural key after two redeploys —
 * every mirror and operator table stayed empty with no error anywhere. The seed is idempotent (every
 * insert is do-nothing on conflict; operator-edited rows are never reverted), so running it from the
 * composition root when `needsSeed` says so is safe, and awaited so the incident mirror that follows can
 * resolve regions. A failure is logged and never blocks the COP (Art. XVI).
 */
export async function seedIfNeeded(
  config: Env,
  probe: () => Promise<boolean> = () => needsSeed(sharedDb(config.DATABASE_URL)),
  run: () => Promise<string> = async () => {
    const { seed } = await import('@/adapters/persistence/seed.js');
    const d = await seed(sharedDb(config.DATABASE_URL));
    return `${d.regions.length} regions, ${d.resources.length} resources, ${d.shelters.length} shelters, ${d.thresholdRules.length} threshold rules, ${d.appUsers.length} users`;
  },
  write: (line: string) => void = (line) => process.stderr.write(line),
): Promise<void> {
  if (config.FEATURE_STORE !== 'postgres') return;
  try {
    if (!(await probe())) return;
    write(
      '[beacon] database not seeded (region rows without a natural key, or no resources): seeding now\n',
    );
    write(`[beacon] seeded ${await run()}\n`);
  } catch (e) {
    write(
      `[beacon] seed failed: ${e instanceof Error ? e.message : String(e)} — set the Railway pre-deploy command to "node scripts/migrate.mjs && node scripts/seed.mjs" and read its log\n`,
    );
  }
}

export async function createHttpDepsLive(options: CreateHttpDepsOptions = {}): Promise<HttpDeps> {
  const rawEnv = options.core?.env ?? process.env;
  const config = loadConfig(rawEnv);
  await seedIfNeeded(config);
  const clock = options.core?.clock ?? (() => new Date().toISOString());
  const newId = options.core?.newId ?? makeIdMinter(clock);
  const reportStore = makeReportStore(config, clock, newId);
  // ADR-039 — the durable mirrors MUST be passed here, not only in `buildCoreLive`. This function is the
  // ONLY live composition the deployed app reaches: every Next route delegator resolves its deps through
  // `getHttpDepsAsync` → here, and `buildCoreLive` has no non-test caller. Omitting the two sinks (defect
  // B1, found by the A2 all-lens review 2026-09-10) left `assembleLiveSeeds` returning on its first line,
  // so `/sources` stayed empty under FEATURE_STORE=postgres — the exact symptom ADR-039 was written to fix —
  // and, because no `incident` row was ever mirrored, every SitRep and every evacuation route then took the
  // "parent cannot be resolved, skip" branch. Three empty tables, silently, by construction.
  const live = await assembleLiveSeeds(
    config,
    rawEnv,
    clock,
    newId,
    provenanceSink(config),
    incidentSink(config),
    thresholdRulesSource(config),
  );
  const interaction = buildInteraction({
    ...options.core,
    clock,
    newId,
    reportStore,
    ...(live ? { seed: live.coreSeed } : {}),
  });
  const rateLimiter = createTokenBucketLimiter({ ...options.rateLimit, clock });
  const features = featureDepsFor(options, clock, newId, live);
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
  // V2·A12 — and the periodic live re-ingest, so the served picture stops being a boot-time snapshot. The
  // runner is `undefined` unless LIVE_REINGEST_INTERVAL_SEC is non-zero, which is why the default profile
  // acquires no third job.
  const reingest = liveReingestFor(config, rawEnv, { options, clock, newId, reportStore });
  startBackgroundJobs(backgroundJobsOptions(config, clock, reportStore, features, reingest));
  return {
    interaction,
    clock,
    rateLimiter,
    env: rawEnv,
    features,
    reports: reportStore,
    credentials,
    // A9 — read from the VALIDATED config (an out-of-range value already failed the boot above), so the
    // endpoint honours the deployment's own bounds instead of two constants nobody could reach.
    prePositioning: prePositioningTuning(config),
    // ADR-041 — the operator-maintained panel store, absent unless FEATURE_STORE=postgres. Composed HERE
    // for the reason the two ADR-039 sinks are: this is the ONLY live composition the deployed app reaches
    // (every Next delegator resolves through getHttpDepsAsync), so a seam wired anywhere else is a seam the
    // running product does not have.
    ...operatorPanelStore(config),
  };
}

let cached: HttpDeps | undefined;

/** Lazy process-wide singleton for the Next delegators (build the core once per server process). */
export function getHttpDeps(): HttpDeps {
  cached ??= createHttpDeps();
  return cached;
}

/**
 * How long a READ may wait for the live composition before it is served from the offline seed instead.
 *
 * Five seconds because the number that matters is the edge's, not ours: Railway cuts a request at 60 s,
 * and a cold container's live composition measured 247 s on 2026-09-12. Anything in between is a hang
 * followed by a 502 — which is what a judge saw if they opened the demo in the first minutes after it was
 * switched on.
 */
export const WARMUP_READ_DEADLINE_MS = 5_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // Never hold the process open for a warm-up timer. `unref` exists on Node's Timeout and not in every
    // runtime this may one day be built for, hence the guard rather than a cast.
    (timer as unknown as { unref?: () => void }).unref?.();
  });
}

/**
 * The deps a READ should use right now: the live composition when it is ready, the offline seed while it
 * is still building.
 *
 * WHY ONLY READS. A write during warm-up would land in the memory store and be discarded the moment the
 * live composition took over — a report filed into nothing, which is far worse than waiting. So the
 * delegator applies this to GET/HEAD only; everything that mutates still waits for the real store.
 *
 * Nothing is cancelled and nothing is rebuilt: the live build carries on in its own promise and every
 * later request gets it. The seeded answer an operator sees in the meantime is not a lie either — its
 * provenance is labelled MOCK by the same envelope that labels everything else, which is exactly what
 * Art. XVI asks for: degrade, label, never dead-end.
 *
 * Pure in its dependencies so a test can drive it without a four-minute composition.
 */
export async function depsWithin(
  live: Promise<HttpDeps>,
  fallback: () => HttpDeps,
  deadlineMs: number,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<HttpDeps> {
  // `then(ok, err)` rather than `await`: a live build that REJECTS must fall back to the seed too, and
  // attaching both handlers here is also what keeps a slow rejection from surfacing as an unhandled one.
  const settled = await Promise.race([
    live.then(
      () => true,
      () => false,
    ),
    wait(deadlineMs).then(() => null),
  ]);
  return settled === true ? live : fallback();
}

/** The production wiring of {@link depsWithin}: the one live build, the offline profile, the deadline. */
export function getHttpDepsForRead(
  deadlineMs: number = WARMUP_READ_DEADLINE_MS,
): Promise<HttpDeps> {
  return depsWithin(getHttpDepsAsync(), getHttpDeps, deadlineMs);
}

/**
 * Memoise a SUCCESSFUL async build; clear the slot when it fails.
 *
 * Extracted rather than inlined so the real policy is what a test drives (production-readiness audit,
 * 2026-09-11). The defect it fixes: `cached ??= build()` caches a REJECTED promise for the life of the
 * process, because a rejected promise is not `undefined`. One recoverable fault at the moment of the
 * first request — a typo in `AUTH_USERS`, a database still accepting no connections, a config refinement
 * — then meant: the container reports healthy (the health endpoint never touches the composition), every
 * subsequent request 500s, and NOTHING EVER RETRIES, not even after the operator fixes the cause. Only a
 * restart cleared it.
 *
 * Two properties, both load-bearing and both tested:
 *  • success is cached exactly once — the live composition is ~17 s of real work across five regions, so
 *    rebuilding per request would be a worse defect than the one being fixed;
 *  • concurrent first callers share ONE in-flight build, so a boot-time herd does not multiply it.
 * The `.catch` re-throws, so a caller always sees the real error rather than a silent retry.
 */
export function memoizeSuccess<T>(
  read: () => Promise<T> | undefined,
  write: (p: Promise<T> | undefined) => void,
  build: () => Promise<T>,
): Promise<T> {
  const existing = read();
  if (existing !== undefined) return existing;
  const started = build().catch((e: unknown) => {
    write(undefined);
    throw e;
  });
  write(started);
  return started;
}

let cachedAsync: Promise<HttpDeps> | undefined;

/**
 * THE COMPOSITION'S STATE, OBSERVABLE WITHOUT AWAITING IT (2026-09-12).
 *
 * Why this exists: on 2026-09-12 one mistyped Railway variable (`FEATURE_CACHE=postgres`, a value that
 * flag has never accepted) made `loadConfig` throw at boot, and because every route — health included —
 * awaited the composition first, the entire API returned an opaque `INTERNAL_ERROR` 500. The operator
 * could see the site was down and nothing else; the one sentence naming the bad variable was in stderr,
 * reachable only by someone who already knew to look for it and had Railway log access.
 *
 * A readiness probe that can only answer by doing the very thing that is broken is not a probe. This
 * records the outcome as a plain value the health route can READ, never await, so the health endpoint
 * stays up precisely when the composition is down — which is the only time anyone needs it.
 *
 * The message is deliberately carried. `loadConfig` names the offending variable and its accepted values,
 * and that sentence is the difference between a five-minute fix and an evening of log archaeology. It is
 * exposed only to an authenticated operator (see the health route), never to an anonymous caller.
 */
export type CompositionState =
  | { readonly status: 'idle' }
  | { readonly status: 'building'; readonly startedAtMs: number }
  | { readonly status: 'ready'; readonly startedAtMs: number; readonly settledAtMs: number }
  | {
      readonly status: 'failed';
      readonly startedAtMs: number;
      readonly settledAtMs: number;
      readonly error: string;
    };

let compositionState: CompositionState = { status: 'idle' };

/** The composition's current state. Synchronous and side-effect free — it never starts a build. */
export function getCompositionState(): CompositionState {
  return compositionState;
}

const asyncTiming = new WeakMap<
  Promise<HttpDeps>,
  {
    startedAtMs: number;
    settledAtMs: number | undefined;
  }
>();

export function getHttpDepsAsyncTiming(promise: Promise<HttpDeps>): {
  readonly startedAtMs: number | undefined;
  readonly settledAtMs: number | undefined;
} {
  const timing = asyncTiming.get(promise);
  return { startedAtMs: timing?.startedAtMs, settledAtMs: timing?.settledAtMs };
}

/**
 * Lazy process-wide async singleton for the Next delegators — the LIVE-aware entrypoint. Caches the PROMISE
 * (one build per process, no double-build race). The offline/default profile resolves to the same deps as
 * getHttpDeps(); postgres/live/AI profiles get the wired composition.
 */
export function getHttpDepsAsync(): Promise<HttpDeps> {
  return memoizeSuccess(
    () => cachedAsync,
    (p) => {
      cachedAsync = p;
    },
    () => {
      const startedAtMs = Date.now();
      const timing = { startedAtMs, settledAtMs: undefined as number | undefined };
      compositionState = { status: 'building', startedAtMs };
      const started = createHttpDepsLive()
        .then((deps) => {
          compositionState = { status: 'ready', startedAtMs, settledAtMs: Date.now() };
          return deps;
        })
        .catch((e: unknown) => {
          compositionState = {
            status: 'failed',
            startedAtMs,
            settledAtMs: Date.now(),
            error: e instanceof Error ? e.message : String(e),
          };
          throw e;
        })
        .finally(() => {
          timing.settledAtMs = Date.now();
        });
      asyncTiming.set(started, timing);
      return started;
    },
  );
}

/**
 * V2·A12 — replace the memoised live picture. THE ATOMICITY IS THIS ONE STATEMENT, not a lock.
 *
 * `getHttpDepsAsync` reads `cachedAsync` synchronously and hands back whatever promise is there, so a caller
 * that already took the old promise keeps resolving to the OLD, COMPLETE deps and every caller after this
 * assignment gets the NEW, COMPLETE deps. There is no window in which a reader can observe half of either,
 * because the new picture is fully built BEFORE this is called (`runLiveReingest`, src/main/live-refresh.ts).
 *
 * Exported for the re-ingest job and its test and nothing else: the only caller in the running app is
 * `liveReingestFor`, which does not exist unless an operator configured a non-zero interval.
 */
export function swapHttpDepsAsync(next: HttpDeps): void {
  cachedAsync = Promise.resolve(next);
}
