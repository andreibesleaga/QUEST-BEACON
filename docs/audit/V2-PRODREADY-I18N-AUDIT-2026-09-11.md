# V2 — Production-Readiness & Internationalisation Audit

**Date** 2026-09-11 · **Branch** `feat/v2-live-production` · **Method** read-only, evidence-led (grep/rg sweeps, scripted catalogue analysis, one test run)
**Scope** the *runtime* (Part A) and the *14 locale catalogues + the surfaces that render them* (Part B).
**Out of scope by agreement (sibling audits own these):** `infra/**`, Dockerfile, compose, k8s, `.github/workflows/**`, `next.config.mjs`, Railway config; security/authz/PII/rate-limiting/dependencies; the `app/**` accessibility pass (ARIA, focus, keyboard, colour-only, headings, live regions, the map's non-visual equivalent).

Every finding is marked **PROVEN** (read directly from the cited lines, semantics unambiguous) or **SUSPECTED** (inferred; needs a runtime check to confirm).

---

# PART A — PRODUCTION READINESS

## A · Executive summary

The *internals* of this system are unusually well built for production. Every outbound source fetch is funnelled through one client with a bounded timeout (`resilient-http.ts`), wrapped in a per-source circuit breaker and a last-known-good cache; the redundancy ladder (LIVE → CACHED → MOCK) is real and the degradation is genuinely labelled in provenance rather than hidden; `handleHttp` itself has a correct, documented, symmetric failure contract in which both the command path and the feature path convert any throw into a typed `{code, message}` envelope with no internal detail leaked; the SSE channel caps concurrent connections and releases slots exactly once; the in-memory stores have a retention purge; the event bus unsubscribes and garbage-collects empty topics; the re-ingest swap is genuinely atomic and keeps the last good picture on failure. The config schema's cross-field `.refine()` chain is the best part of the codebase — it encodes exactly the misconfigurations that would otherwise be silent.

The problems are all at the **edges**, and they are the edges that matter on Railway.

Three of them compound into one failure mode. (1) The Next delegators — the *only* way a request reaches this system — have **no error boundary at all**; the hardened contract inside `handleHttp` begins one stack frame too late, so everything the composition root does happens outside it. (2) The composition root is invoked **lazily, on the first request**, and it performs the *entire* live assembly — 120 adapter consultations across five regions, sequentially, with no overall deadline — so the first request after a deploy pays a bill that is bounded only by `Σ(adapters × timeout × retries)`, which is two orders of magnitude past Railway's 60-second edge limit. (3) That composition is memoised with `??=`, so if it **rejects**, the rejected promise is cached **permanently**: the process serves unshaped 500s forever, and never retries, even after the underlying cause clears.

Alongside that, the system has **no request logging and no error logging whatsoever**. `pino` exists, but only inside the AI cost-attribution sink. The two `catch` blocks that produce `INTERNAL_ERROR` discard the caught exception without a single log line. If a region went blank in production tonight, the operator would have an opaque 500 and nothing else — and the one subsystem that *does* explain why a region fell back to the offline seed keeps its entire diagnostic vocabulary behind `LOG_LEVEL=debug`, which is not the default.

Graceful degradation, judged on its own terms, largely **holds**: all three outage scenarios degrade rather than dead-end, and two of the three are correctly labelled to the operator. The gap is not the degradation — it is that the operator cannot find out *why*.

**Counts — Part A:** 4 blocking · 6 should-fix · 4 nits.

---

## A1 · Error handling on every request path

### 🔴 BLOCKING A-1 — The Next delegators have no error boundary; `handleHttp`'s failure contract starts one frame too late

**PROVEN.**

`handleHttp` is documented and implemented as *"Never throws; every failure path is a typed status + {code,message} body"* (`src/adapters/channels/http/http-dispatcher.ts:221`), and that is true — `dispatchCommand` (`:168-179`) and `dispatchFeature` (`:202-211`) each convert any throw into a typed envelope. F-350 closed exactly this asymmetry *inside* the dispatcher. But the three route files that call it do not extend the same guarantee to their own work:

- `app/api/v1/[...path]/route.ts:20-23`
  ```ts
  async function delegate(req: Request): Promise<Response> {
    const res = await handleHttp(await toHttpRequest(req), await getHttpDepsAsync());
    return new Response(JSON.stringify(res.body), { status: res.status, headers: res.headers });
  }
  ```
  Three throwable operations sit outside any `try`: `toHttpRequest` (`await req.text()` rejects on an aborted or malformed body), `getHttpDepsAsync()` (see A-2 below), and `JSON.stringify(res.body)`.
- `app/api/v1/stream/route.ts:45-46` — `await getHttpDepsAsync()` with no guard; an SSE client gets a framework error page instead of a stream or a labelled 503.
- `app/.well-known/sustainability/route.ts:6-11` — identical shape, no guard.

Anything thrown here surfaces as Next's default 500: no `{code, message}`, no provenance, and — the reason F-350 was raised in the first place — potentially a stack or an internal message. `makeDb` throws `'DATABASE_URL is required to open the persistence adapter (ADR-012)'` (`src/adapters/persistence/client.ts:16-18`); `loadConfig` throws a message containing every failed field (`src/config/index.ts:551`). Neither should ever be rendered to a caller.

**Remedy.** Give `delegate` (and the two sibling routes) the same contract the dispatcher already has — a shared helper is better than three copies:
```ts
async function delegate(req: Request): Promise<Response> {
  try {
    const res = await handleHttp(await toHttpRequest(req), await getHttpDepsAsync());
    return new Response(JSON.stringify(res.body), { status: res.status, headers: res.headers });
  } catch (thrown) {
    logger.error({ err: thrown, path: new URL(req.url).pathname }, 'delegator_boundary');
    return new Response(
      JSON.stringify(channelErrorEnvelope('INTERNAL_ERROR', 'internal error')),
      { status: 500, headers: JSON_HEADERS },
    );
  }
}
```

---

### 🔴 BLOCKING A-2 — A failed composition is memoised **permanently**: the process 500s forever and never retries

**PROVEN.**

`src/adapters/channels/http/http-dispatcher.ts:691-693`:
```ts
export function getHttpDepsAsync(): Promise<HttpDeps> {
  cachedAsync ??= createHttpDepsLive();
  return cachedAsync;
}
```

`??=` assigns only when the left side is `undefined`. A **rejected promise is not `undefined`**. So if `createHttpDepsLive()` rejects — and it can, from at least four places — `cachedAsync` holds that rejected promise for the lifetime of the process. Every subsequent request on every route resolves the same rejection. Restarting the container is the only recovery, and on Railway nothing will restart it, because the app is "up".

Reachable rejection sources inside `createHttpDepsLive` (`:617-676`):
1. `loadConfig(rawEnv)` (`:618`) → `throw new Error('Invalid BEACON configuration (fail-fast at boot): …')` (`src/config/index.ts:546-551`).
2. `makeReportStore` → `makeDb(config.DATABASE_URL)` (`:451`) → throws on an empty/absent URL (`client.ts:16-18`).
3. `await loadCredentials(rawEnv)` (`:653`) → `parseCredentials(rawEnv.AUTH_USERS, secret)` on a malformed `AUTH_USERS` string.
4. `startBackgroundJobs(...)` (`:665`) — synchronous, inside the async function.

Combined with A-1, the observable behaviour of a single typo in `AUTH_USERS` is: container healthy, every request an unshaped 500, forever, with no log line naming the cause.

**Remedy.** Make the memo self-healing, and separate "boot failed" from "boot not attempted":
```ts
export function getHttpDepsAsync(): Promise<HttpDeps> {
  cachedAsync ??= createHttpDepsLive().catch((e: unknown) => {
    cachedAsync = undefined;  // let the next request retry rather than inherit the corpse
    throw e;
  });
  return cachedAsync;
}
```
Pair this with A-3 so a genuinely invalid configuration is caught at boot instead of being retried per-request.

---

### ✅ Sound — the dispatcher's own failure contract

`handleHttp`'s two dispatch legs both catch, both map `DomainError` → status, both fall through to an opaque `INTERNAL_ERROR` that leaks nothing. Route matching is deliberately *inside* the `try` (`:203-205`). Cookie and header parsing are individually guarded (`:111-113`, `:133-135`). The F-350 comment block (`:185-196`) is an exemplary record of why. No change needed here.

---

## A2 · Timeouts and the Railway 60-second edge limit

### ✅ Sound — every outbound call is individually bounded

| Path | Bound | Evidence |
|---|---|---|
| All 45 source adapters | `AbortSignal.timeout(8000)` default, per-source override via `SOURCE_<PREFIX>_TIMEOUT_MS` | `src/adapters/_shared/resilient-http.ts:12,16,20`; `src/adapters/_shared/source-config.ts:29,64-71` |
| LLM / vision providers | `AbortController` + `setTimeout`, 15 s default, `LLM_REQUEST_TIMEOUT_SEC` | `src/adapters/ai/http-client.ts:15-36` |
| ORS routing | inherits the AI `HttpClient` (injected JSON-POST client) | `src/adapters/routing/ors-routing.ts:33` |
| Per-attempt backstop | cockatiel `timeout(…, Aggressive)` | `src/adapters/_shared/circuit-breaker.ts:38,59` |
| SitRep narration | `Promise.race` against a 1500 ms deadline, loser's rejection pre-caught | `src/application/sitrep-synthesis/sitrep-synthesis.ts:149-163`; `src/main/build-core.ts:111-117` |

The `adapter-registry`/`source-config` layering means the ~43 adapters that appear to call bare `fetch` in fact route through `httpGetText`; I confirmed this on `nws-adapter.ts:106-110`. This is genuinely good, and the narration deadline in particular is a well-reasoned piece of engineering.

The **individual** bounds are not the problem. The **aggregate** is.

### 🔴 BLOCKING A-3 — The live composition has no overall deadline, runs inside the first request, and its worst case is far past 60 s

**PROVEN** (the structure and the constants; the wall-clock worst case is arithmetic over them).

The composition is three nested sequential loops, every level of which is sequential *on purpose*:

1. **Regions — sequential.** `src/main/live-composition.ts:184-190`:
   > *"Sequential per region (NOT `Promise.all`): that region's core + map assemblies fetch overlapping sources through its ONE `RedundancyEngine`, so a concurrent run would race the per-source breaker/last-known-good state."*
2. **A second sequential region pass for the map seed** — `live-composition.ts:200-204`.
3. **Adapters within a region — sequential.** `src/main/live-seed.ts:569-577`, `consult()`:
   > *"Fetch every planned adapter, IN PRECEDENCE ORDER. Sequential on purpose…"*

Fan-out, from `config/regions.json`: `us-ca` 31 enabled adapters, `ro` 25, `es` 22, `gr` 22, `ph` 20 — **120 adapter consultations in the core pass**, plus the map pass.

Per-adapter worst case: 8 s default timeout × `DEFAULT_MAX_RETRIES = 2` (`circuit-breaker.ts:39`) ≈ **16 s**, and `DEFAULT_BACKSTOP_TIMEOUT_MS = 60_000` (`circuit-breaker.ts:38`) applies when an adapter sets no `timeoutMs` — so a *single* adapter can consume the entire edge budget on its own. The repo already concedes the shape of this: `.env.example:201` documents that OSM Overpass *"× breaker retries — 3 mirrors can reach ~24s"*, and `.env.example:279` gives `SHELTERS_FEMA` a 15 s default for three sequential ArcGIS queries.

Three aggravating facts:
- **This runs inside a user request.** `getHttpDepsAsync()` → `createHttpDepsLive()` → `assembleLiveSeeds()` is awaited by every delegator (A-1). The first request after a deploy pays for all of it.
- **Breakers start CLOSED on a cold boot.** The per-region `RedundancyEngine`s are constructed fresh in `buildRegionRegistries` (`live-composition.ts:42-53`), so the breaker protection that would cap this cost *does not exist yet* on the very run that needs it most. It takes 5 consecutive failures (`config/adapters.json`, `failureThreshold: 5`) per adapter before one opens.
- **No route declares `maxDuration`.** Grep across `app/**` returns nothing. There is no framework-level cap either.

The ~17 s figure the project cites (`src/main/live-refresh.ts:14`) is the **happy path with every upstream responsive**. A handful of hung upstreams — the ordinary condition during a real regional emergency, when agency sites are under load — multiplies it without limit.

**Remedy** (two parts, both worth doing):
1. **Cap the whole assembly.** Wrap `assembleLiveSeeds` in an overall budget so it can only ever degrade, never hang:
   ```ts
   const BUDGET = config.LIVE_COMPOSITION_BUDGET_MS ?? 25_000;
   const seeds = await Promise.race([
     assembleLiveSeeds(...),
     new Promise<null>((r) => setTimeout(() => r(null), BUDGET).unref?.()),
   ]);
   ```
   `null` already means "keep the offline `DEFAULT_SEED`" (`live-composition.ts:139`), so the existing fail-open path absorbs this with no new semantics. Add the knob to `EnvSchema` with a documented floor, and **log** when the budget is hit (see A-5).
2. **Move the cost off the request path.** Add `instrumentation.ts` at the repo root:
   ```ts
   export async function register(): Promise<void> {
     if (process.env.NEXT_RUNTIME !== 'nodejs') return;
     const { getHttpDepsAsync } = await import('@/adapters/channels/http/http-dispatcher.js');
     await getHttpDepsAsync();
   }
   ```
   Next calls this once at server start. Boot then absorbs the composition, and no user request ever does. This also fixes A-4.

---

## A3 · Startup validation

### 🔴 BLOCKING A-4 — Nothing validates configuration at boot; the app starts healthy and fails per-request

**PROVEN.**

- There is **no `instrumentation.ts`** at the repo root, in `app/`, or in `src/`.
- `loadConfig` has exactly one runtime caller on the served path: `createHttpDepsLive` (`http-dispatcher.ts:618`) — reached lazily via `getHttpDepsAsync`. The other callers are `build-core.ts:214,232` (reached from the same place) and `scripts/demo-reset.ts:12` (a script).
- Therefore the excellent fail-fast chain in `src/config/index.ts` — `FEATURE_CACHE=redis` without `REDIS_URL` (`:449`), `FEATURE_QUEUE=bullmq` without `REDIS_URL` (`:453`), `FEATURE_STORE=postgres` still on the default URL (`:460`), `FEATURE_ROUTING=ors` without `ORS_API_KEY` (`:465`), `CHANNEL_TELEGRAM_MODE=live` without a token (`:469`), `VISION_MODE=local` without `VISION_API_BASE` (`:481`), the `DRILL_MODE`/`NEXT_PUBLIC_DRILL_MODE` mirror check (`:488`), and the `superRefine` block (`:499`) — **never runs until a request arrives.** Its own error string says *"fail-fast at boot"* (`:551`); today it is fail-late, per-request.
- `GET /health` returns a **static** `json(200, { status: 'ok' })` (`http-dispatcher.ts:~272`) — it never touches Postgres, the composition, or any upstream. Useful as a liveness probe, misleading as anything else.

Combined with A-2, a misconfigured deploy presents as: build succeeds, container starts, health is green, and every functional request is a permanent unshaped 500 with no log.

**Remedy.** The `instrumentation.ts` from A-3 covers this: calling `getHttpDepsAsync()` at boot runs `loadConfig` at boot, so an invalid configuration crashes the process at start with the schema's own message — which is what Railway's restart/deploy-failure signal is for. Separately, consider splitting `/health` (liveness, static) from `/ready` (readiness: composition resolved, and under `FEATURE_STORE=postgres` a `SELECT 1`).

---

## A4 · Observability

### 🔴 BLOCKING A-5 — There is no request logging, no error logging, and the `INTERNAL_ERROR` path discards the exception

**PROVEN.**

`pino` appears in exactly three non-test files, all of them the AI cost-attribution sink: `src/adapters/ai/observability.ts:41`, `src/main/build-ai.ts:60`, `src/main/build-vision.ts:63`. That sink logs `ai_call` and `ai_decision` events only (`observability.ts:40-49`). Outside it, the entire HTTP channel emits **six `console.*` calls in the whole of `src/`**, none of them on a request path.

The consequence is concentrated in two places:

```ts
// http-dispatcher.ts:173-178  (dispatchCommand)
} catch (thrown) {
  if (thrown instanceof DomainError) return json(statusForError(thrown.code), apiErrorEnvelope(thrown));
  return json(500, channelErrorEnvelope('INTERNAL_ERROR', 'internal error'));
}
// http-dispatcher.ts:206-211  (dispatchFeature) — identical
```

`thrown` is bound and then **dropped**. Not logged, not counted, not correlated. The caller gets `INTERNAL_ERROR`; the operator gets nothing. The comment above it correctly explains why the *response* must not carry the detail — but that is an argument for logging it server-side, not for destroying it. The concrete F-350 example the comment cites (`TypeError: Cannot read properties of null (reading 'id')` from a malformed provenance row) is exactly the class of bug that is now unreproducible from production evidence.

**Remedy.** Instantiate one process-wide `pino` at `LOG_LEVEL` in the composition root, put it on `HttpDeps`, and log both catch sites at `error` with the stack plus method/path/role. Mint a correlation id per request, log it, and return it in the envelope (`{code, message, correlationId}`) — an operator can then join a user's screenshot to a log line. Add one `info` line per request (method, path, status, duration) so latency regressions and the A-3 budget overruns are visible at all.

---

### 🟠 SHOULD-FIX A-6 — All live-composition fallback diagnostics are gated behind `LOG_LEVEL=debug`, which is not the default

**PROVEN.** `src/main/live-composition.ts:61-65`:
```ts
function makeDebugLive(config: Env, rawEnv) {
  return config.LOG_LEVEL === 'debug' || rawEnv.BEACON_DEBUG_LIVE === '1'
    ? (msg) => console.error(`[live-composition] ${msg} → falling back to offline seed`)
    : (): void => {};
}
```
`LOG_LEVEL` defaults to `'info'` (`src/config/index.ts:73`). So in the default posture, **every one of these is silent**: region registry failed to load (`:154`), a region's registry build failed (`:175`), the provenance sink rejected or threw (`:89`, `:91`), the incident sink rejected or threw (`:109`, `:111`), and the catch-all `live assembly threw` (`:213`).

This is precisely the failure the file's own comment says cost a full debugging session on 2026-08-04 — *"a silent one turned a one-row CONFIG error into 'every source is MOCK' with zero diagnostic"*. The fix was correct in substance and then set to a level nobody runs in production. **This is the single highest-value one-line change in Part A**: a region going blank is *the* scenario, and this is the only code that explains it.

**Remedy.** Emit these at `warn`/`error` on the shared logger unconditionally. Keep `BEACON_DEBUG_LIVE=1` for the extra-verbose per-row detail if desired, but the five fallback reasons above must be visible at `info`.

---

### 🟠 SHOULD-FIX A-7 — `fetchSlice` swallows every adapter throw with no record

**PROVEN.** `src/main/live-seed.ts:104-116`:
```ts
} catch {
  // Unexpected throw ⇒ treat as covered-but-unserved (primary down) → keep the seeded/cached slice.
  return { entities: [], covered: true, served: false };
}
```
The degradation behaviour is right (Art. XVI). The information loss is not: a parse failure, a schema drift, a `TypeError` in a mapper and a genuine upstream outage all collapse to the same silent `served: false`. This is the inner loop of "a region went blank" — run 120 times per composition — and it is the one place that knows *why*.

**Remedy.** Take a `debugLive`-style sink (or the shared logger) as a parameter and log `{ adapterId: id, regionId: region.id, err }` at `warn` before returning the degraded slice. The return value need not change.

---

### 🟠 SHOULD-FIX A-8 — The LLM ladder cannot distinguish "provider is 503ing" from "provider is off"

**PROVEN.** `src/adapters/ai/llm/llm-ladder.ts:66-75` — `#tryProvider` catches everything and returns `null`, dropping one rung. The `Observability` sink is composed in `build-ai.ts:60,80` but is never called on this path. So a provider that is rate-limited, unreachable, or returning malformed output produces *the same* observable trace as one that was never configured: none. See A5·Scenario 3 — the *user-facing* degradation is labelled correctly; it is the operator-facing signal that is missing.

**Remedy.** Call `observability.decision('llm_rung', 0, reasonFrom(e))` (or add an `aiFailure` method) in the catch, naming the provider and the error class.

---

### 🟡 SHOULD-FIX A-9 / A-10 — Two durable writes are fire-and-forget and silent

**PROVEN.**
- `src/adapters/channels/http/routes/logistics.ts:191` — `deps.routeStore?.accept(route).catch(() => undefined);` The **evacuation-route audit trail** is written without awaiting and without any failure signal. A route an operator dispatched can be absent from the durable record with nothing anywhere saying so.
- `src/application/interaction/command-router.ts:668` — `void history.record(report).catch(() => undefined);` SitRep history, same shape.

In both cases the fail-open *policy* is defensible (a storage outage must not block the operational action). Discarding the error is not — this is exactly the pattern `recordProvenance`/`recordIncidents` (`live-composition.ts:78-113`) gets right by awaiting and labelling.

**Remedy.** Keep them non-blocking, but `.catch((e) => logger.warn({ err: e, … }, 'route_store_write_failed'))`.

---

## A5 · Graceful degradation under a real outage

The project's rule — *degrade, LABEL the degradation, never dead-end* — is genuinely honoured on the data path. Traced end-to-end:

**Scenario 1 — Postgres unreachable (`FEATURE_STORE=postgres`).**
`postgres-js` connects lazily, so composition succeeds and the app serves. Every panel read is `tryResult`-wrapped (`src/adapters/persistence/panel-data.ts:126-141`) → typed `Result` → the panels render their error branch (`shelter-status-panel.tsx:86`, `supplies-panel.tsx:65`, `verifier-queue.tsx:488-493` with `role="alert"`). The provenance and incident mirrors fail open independently (`live-composition.ts:78-113`).
**Verdict: holds, and is labelled.** Two caveats: the labelling *reasons* are debug-only (A-6), and — see A-11 — the pool arithmetic means an *overloaded* Postgres and an *unreachable* one are reached by the same road.

**Scenario 2 — every upstream source down.**
Each adapter descends LIVE → CACHED → MOCK (`redundancy.ts:78-99`); `fetchSlice` degrades a hard failure to an unserved slice (`live-seed.ts:112-115`); `collectProvenance` (`live-seed.ts:120-135`) retains the seeded ref with a **degraded mode label**, so `/status` and the UI's `ui.mode.*` chips (`MOCK`/`CACHED`) show the operator that the picture is not live. If the whole assembly fails, `assembleLiveSeeds` returns `null` and the offline `DEFAULT_SEED` keeps serving (`live-composition.ts:139,211-214`). A failed *re-ingest* commits nothing and keeps the last good picture with its own `fetched_at` — explicitly not re-stamped (`live-refresh.ts:21-25`).
**Verdict: holds, and is labelled.** This is the best-engineered part of the system. The only gap is A-3's timing: with no overall budget, "every upstream down" is also the slowest possible composition.

**Scenario 3 — LLM provider 503ing.**
Ladder descends, then `deterministicOnly` (`llm-ladder.ts:64`). `data.aiMode === 'deterministic-only'` drives a visible badge and the AI narration is *hidden* while the deterministic priorities, trend and per-field citations all still render (`app/_components/panels/sitrep-panel.tsx:27,134-172`; catalogue key `sitrep.deterministicOnly`).
**Verdict: holds, and is labelled — exemplary.** Only the operator-side signal is missing (A-8).

**Where it does not hold:** the *request-boundary* scenarios, not the data ones — A-1 (unshaped 500), A-2 (permanent poisoning), A-4 (misconfig fails per-request, not at boot). Those three do dead-end.

---

## A6 · Resource exhaustion

### 🟠 SHOULD-FIX A-11 — Eight independent Postgres connection pools (~80 connections) are opened at boot, against an explicit in-repo warning

**PROVEN.** `src/adapters/persistence/client.ts:21-27` documents the hazard and provides the fix:
> *"`makeDb` opens a NEW connection pool on every call, and the composition root calls it from several independent seams… Each pool defaults to 10 connections, so a handful of seams can exhaust a free-tier Postgres connection ceiling at boot — a failure that looks like an outage, not a config bug."* — and exports `sharedDb()` / `getDb()` to memoise by URL.

`sharedDb`/`getDb` has **one** non-test caller (`src/adapters/persistence/seed.ts:99`, a script). Every seam in the live composition still calls `makeDb` directly:

| # | Call site | Reached from |
|---|---|---|
| 1 | `http-dispatcher.ts:451` | `makeReportStore` ← `createHttpDepsLive` |
| 2 | `build-core.ts:151` | `buildInteraction` ← `createHttpDepsLive` |
| 3 | `build-core.ts:269` | `provenanceSink` ← `createHttpDepsLive` |
| 4 | `build-core.ts:274` | `incidentSink` ← `createHttpDepsLive` |
| 5 | `build-core.ts:287` | `panelDataStore` ← `operatorPanelStore` ← `createHttpDepsLive` |
| 6 | `feature-seed.ts:394` | `buildFeatureDeps` ← `featureDepsFor` ← `createHttpDepsLive` |
| 7 | `feature-seed.ts:413` | `makePgEvacRouteStore`, same path |
| 8 | `scheduler.ts:253` | `makePgRetentionStore` ← `startBackgroundJobs` ← `createHttpDepsLive` |

Under `FEATURE_STORE=postgres` all eight are on the single composition path, so one process opens up to **80** connections. Railway's smaller Postgres plans and Neon's free tier both sit well below that, and A-3's re-ingest adds two more (`provenanceSink`/`incidentSink` are re-invoked per run in `liveReingestFor`, `http-dispatcher.ts:606-607`) **on every interval**, which is a slow leak of pools, not just a large constant.

**Remedy.** Mechanical: replace all eight `makeDb(` with `sharedDb(` — the signatures are identical and the memo is keyed by URL, so test seams passing an explicit URL stay honest. Then add a lint rule or a `dependency-cruiser` restriction so `makeDb` is only importable from `client.ts` itself. Consider passing `postgres(url, { max: … })` a deliberate pool size too.

### ✅ Sound — everything else I checked

- **SSE connections** — capped at `DEFAULT_MAX_STREAM_CONNECTIONS = 100` per process, operator-tunable via `SSE_MAX_CONNECTIONS` with a fail-closed parse, with a labelled 503 and a release-exactly-once slot (`routes/stream.ts:43,127,173,184`; `app/api/v1/stream/route.ts:29-38`).
- **Event bus** — `subscribe` returns an `Unsubscribe` that deletes the handler and garbage-collects the empty topic (`in-memory-eventbus.ts:25-34`).
- **Rate-limit buckets** — `Map` keyed by *resolved role* (`actorKey(role)`), a closed set, so it cannot grow per-caller (`rate-limit.ts:25-36`; `http-dispatcher.ts:230`). This is also the right security choice.
- **In-memory report store** — has a real retention sweep: `dueForPurge`/`purge` actually delete (`memory-core.ts:266-295`), closing F-25.
- **Breaker / last-known-good maps** — keyed by `adapterId` and `adapterId+regionId`, both bounded by config.
- **Re-ingest stacking** — the scheduler drops a tick arriving while the same job is in flight (`live-refresh.ts:13-14`), so a slow composition cannot pile up.

### 🔵 NIT A-12 — `scheduler.ts:160-162`, `live-refresh.ts:72-76`, `stream.ts:206`
Three `catch {}` blocks that are *correctly* silent by design (an audit sink failing must not resurrect the crash it contains; a doorbell failure must not fail a completed refresh; a closed SSE controller). Documented, justified, no change needed — noted only so a future sweep does not "fix" them.

---

# PART B — INTERNATIONALISATION

## B · Executive summary

The catalogue layer is **excellent** and the component layer has **two holes**.

Key parity is perfect: 393 leaf keys, 14 catalogues, **zero** missing and **zero** orphaned keys anywhere — verified independently of the test suite by a direct tree diff. `tests/i18n/catalog-parity.test.ts` passes 72/72 and enforces five real invariants that most projects do not bother with, including per-locale ICU compilation and argument-name parity. ICU plural correctness is genuinely right: Arabic declares all six CLDR categories, Russian declares `one/few/many/other`, Romanian `one/few/other`, Chinese `other` only — someone actually understood this. RTL is also right: `<html lang dir>` is server-rendered from the cookie so the first paint is correct with no flash (`app/layout.tsx:44-49`), logical properties are used essentially throughout, and a `cop-rtl.png` visual baseline exists. Across the whole of `app/**` there is exactly **one** physical direction class that would misbehave when mirrored.

The holes are elsewhere.

**First: two operator panels are not internationalised at all.** `routing-panel.tsx` and `verifier-queue.tsx` contain **zero** `useT` calls. Every string in them is hardcoded English, including accessible names (`aria-label="Nearest shelters"`, `aria-label="Route result"`, `aria-label="Confidence components"`) and `Panel title="Verification queue"`. These are not incidental surfaces: the verifier queue is where a human decides whether a citizen report becomes a public alert, and the routing panel is where an evacuation route is requested. A Romanian or Filipino EM operator running BEACON in their own locale gets the entire COP translated *except* the two panels on which they take irreversible action.

**Second: the `anticipatory.*` namespace — 29 keys of substantive English prose — is byte-identical across all 13 non-English catalogues.** This is not a loanword pattern; it is full sentences ("*The engine refused the input rather than showing a partial evaluation*", "*Suggestions only. Nothing on this panel dispatches a resource or emits a public alert; a named human must approve every early action*") that were added to `en.json`, mirrored structurally to satisfy the parity test, and never translated. The parity test cannot see this, because it has no untranslated-value check — which is its single most important blind spot. Filipino is separately the weakest catalogue at 111/393 (28%) identical to English, roughly double the next worst.

**Third: there is no `Intl` anywhere.** Zero `Intl.*`, zero `useFormatter`, zero `toLocaleString` in `app/**` or `src/**`. Most formatting rides on ICU `{x, number}` inside next-intl, which is correct — but 14 numeric placeholders were written as bare `{x}` while 15 use `{x, number}`, so a single Arabic or Bengali screen mixes Arabic-Indic and ASCII digits. And `routing-panel.tsx:89` renders a departure time with `new Date(...).toUTCString()`, which emits English weekday and month names in every one of the 14 locales.

**Counts — Part B:** 1 blocking · 4 should-fix · 3 nits.

---

## B1 · Key parity

### ✅ Sound — perfect parity, and a strong test

Independent verification (flatten every catalogue, diff key sets against `en.json`):

```
EN KEYS: 393
ar bn el es fil fr hi id pt-BR ro ru ur zh-Hans  →  missing = 0, extra = 0  (all 13)
```

`tests/i18n/catalog-parity.test.ts` passes **72/72** (`npx vitest run tests/i18n/catalog-parity.test.ts` — 1.93 s). It asserts: key parity (`:103`), ICU argument-name parity (`:110`), per-locale ICU compilation *and render* via `createTranslator` (`:119`), `_meta.machineTranslated` honesty against `config/locales.json` (`:1-10`, `:73-77`), no placeholder/key-shaped copy (`:65`), no stray catalogue for an unshipped locale (`:93`), and that `en.json` has no duplicate key paths (`:80`). The `_meta` honesty invariant is a genuinely unusual and correct thing to enforce — `ro.json` is the one catalogue marked `review: "human"` and `machineTranslated: false`, matching its comment naming the reviewer and date.

### 🟠 SHOULD-FIX B-1 — What the parity test does *not* assert

Four blind spots, in descending order of damage:

1. **No untranslated-value check.** A value byte-identical to English passes every assertion in the file. This is what lets B-2 (the whole `anticipatory.*` namespace) and B-3 (Filipino at 28%) sit in the repo with a green suite. **This is the gap to close first.**
2. **No plural-category completeness check.** `icuArgs` (`:44`) extracts argument *names* only. A translator who wrote `{count, plural, other {…}}` for Russian would pass `compiles and renders` — `createTranslator` is happy with `other` alone — while being grammatically wrong for three of Russian's four categories. Today every catalogue happens to be correct (see B4), but nothing holds them there.
3. **No catalogue↔code coverage check.** Nothing asserts that every `t('…')` key used in `app/**` exists, or that every catalogue key is used. A key deleted from a component leaves 14 dead entries; a typo'd key silently renders the key path.
4. **No directionality assertion.** No test pins `localeDir('ar') === 'rtl'` against the catalogue registry, nor guards against physical CSS.

**Remedy.** Add to the same file:
```ts
it('has no value byte-identical to English outside the allowed loanword list', () => {
  const allow = new Set(readFileSync('config/i18n-loanwords.txt','utf8').split('\n').filter(Boolean));
  const same = englishKeys.filter((k) => leafValue(catalog,k) === leafValue(english,k) && !allow.has(k));
  expect(same, `${locale}: untranslated`).toEqual([]);
});
it('declares every CLDR plural category this locale requires', () => { /* Intl.PluralRules(locale).resolvedOptions().pluralCategories */ });
```
The allow-list file is the right shape here: it makes each loanword a deliberate, reviewable decision rather than an accident, and it turns B-2/B-3 from invisible into a failing build.

---

## B2 · Untranslated values

Measured by byte-identity against `en.json`, per locale:

| Locale | identical / 393 | % | Locale | identical / 393 | % |
|---|---|---|---|---|---|
| **fil** | **111** | **28.2** | pt-BR | 52 | 13.2 |
| fr | 75 | 19.1 | id | 49 | 12.5 |
| ro | 58 | 14.8 | el | 46 | 11.7 |
| es | 52 | 13.2 | ru | 46 | 11.7 |
| ar | 45 | 11.5 | hi | 44 | 11.2 |
| ur | 44 | 11.2 | bn | 43 | 10.9 |
| zh-Hans | 43 | 10.9 | | | |

**42 keys are identical in all 13 locales.** Splitting them by judgement:

**Legitimate (13) — leave as they are.**
`logistics.transition.{PROPOSED,ASSIGNED,EN_ROUTE,ON_SCENE,CLEARED}` (protocol state tokens, and `en.json`'s own `_meta.comment` says *"Never translate: CAP/EDXL enum tokens, identifiers, units of record"*), `statusStrip.clock = "UTC"`, `content.originalLanguage = "EN"`, `toolbar.{devBadge,devLogin,devLoginUserPlaceholder,liveBadge}` (dev-only affordances), `warning.headline`/`warning.impacts` (pure `{arg}` passthrough with no prose).

### 🟠 SHOULD-FIX B-2 — The entire `anticipatory.*` namespace (29 keys) is untranslated in all 13 locales

**PROVEN.** Every key under `anticipatory.` is byte-identical to English in `ar bn el es fil fr hi id pt-BR ro ru ur zh-Hans`. These are not tokens; a representative sample:

| Key | Value (identical in all 14 files) |
|---|---|
| `anticipatory.title` | `Anticipatory action` |
| `anticipatory.noEmission` | `Suggestions only. Nothing on this panel dispatches a resource or emits a public alert; a named human must approve every early action.` |
| `anticipatory.engineRefusedBody` | `The engine refused the input rather than showing a partial evaluation.` |
| `anticipatory.noProtocolBody` | `BEACON ships no early action protocol whose scope names this region, so there is nothing to evaluate. Protocols are configuration (config/eap/), not code.` |
| `anticipatory.stageGate` | `Gate: at least {fraction, number} of forecast members over {threshold, number} {unit}, class {klass} or higher, within {hours, number} h lead time.` |
| `anticipatory.leadTime` | `{hours, number} h, as stated by the source. BEACON does not model hazard travel time.` |
| `anticipatory.stopMechanism` | `Stop mechanism: {role} may stop the activation on a pre-agreed condition, and the engine stops it automatically after {hours, number} h.` |

The signature is unmistakable: the namespace was added to `en.json` and mirrored key-for-key into 13 files to satisfy the parity test, with the values copied verbatim. Note that `anticipatory.noEmission` and `anticipatory.stopMechanism` are **safety disclaimers** — the text that tells an operator this panel does not dispatch anything and how an activation can be stopped. They are among the worst strings in the catalogue to leave in English.

**Remedy.** Machine-translate the 29 `anticipatory.*` keys into all 13 locales through whatever pipeline produced the rest (the `_meta` blocks already declare `review: "machine"`, so no honesty flag changes), then land B-1's untranslated-value test so a future namespace cannot repeat this.

### 🟠 SHOULD-FIX B-3 — Filipino is a materially weaker catalogue than the other twelve

**PROVEN.** `fil` has 111/393 (28.2%) identical — 69 beyond the 42-key universal set, against 33 for the next worst (`fr`) and 2–3 for `ar`/`ur`. The `fil` gap is not confined to tokens; it covers core navigation and panel furniture:

`app.title`, `sitrep.title` ("Situation Report"), `panels.sitrepTitle`, `panels.logisticsTitle`, `logistics.title`, `outlook.title`, `shell.sitrepDock`, `shell.logisticsDock`, `shell.region.ro` ("Romania (EU)"), `shell.region.us-ca` ("California (US)"), `tabs.resources`, `tabs.route` ("Evac route"), `toolbar.layers`, `toolbar.legend`, `toolbar.actingRole`, `toolbar.loginPasswordLabel`, `toolbar.loginUserLabel`, `commandPalette.dialogLabel` ("Command palette" — an accessible name), `shelterStatusPanel.occupancy`, `emsOverlayPanel.attribution`, `map.group.*`, `map.layer.*`, `map.detail.*`, `map.gibs.*`, `map.list.col*`, `locale.machineTranslatedShort`, `statusStrip.*`.

The Philippines is one of the five shipped regions (`ph`, 20 enabled adapters) and is among the most disaster-exposed countries on earth — this is the locale where a real adopting organisation is most likely to exist.

**Remedy.** Re-run the machine-translation pass for `fil` specifically and re-check; the other twelve sit in a consistent 10.9–19.1% band that is fully explained by the universal loanword set plus a handful of internationalisms (`Provenance`, `Citations`, `Satellite`, `3D`, compass points).

### 🔵 NIT B-4 — Compass points, `3D`, and `Provenance`
`map.compass.{N,NE,E,SE,S,SW,W,NW}` stay English in `fr`, `ro` and `fil`; `ui.externalViews.kind.3d = "3D"` stays in `fr`, `ro`, `ur`, `fil`; `Provenance` stays in `fr` (it is the correct French word). Compass abbreviations genuinely differ in French (`N/NE/E/SE/S/SO/O/NO`) and Romanian (`N/NE/E/SE/S/SV/V/NV`) — the `W`/`SW` entries are wrong for both, but this is a nit on a map rose. `3D` is a legitimate internationalism. Put all of these on the B-1 allow-list rather than "fixing" them.

---

## B3 · Hardcoded user-visible English in components

Swept all of `app/**` (147 `.ts`/`.tsx` files) three ways: accessible-name attributes, JSX text nodes, and bare capitalised string literals; then cross-checked each hit against its render site to separate genuine hardcoding from the project's deliberate *English-fallback* pattern.

### ✅ First, what is NOT a finding — the fallback pattern is sound

`build-layers.ts:108-123` (`LAYER_META`, 14 layer labels + 7 caveats), `RegionSelector.tsx:16-25` (`GIBS_OVERLAYS`, `GIBS_ATTRIBUTION`), `external-view-links.tsx:24-34` (`KIND_LABEL`), `legend.tsx:25-42` (`STATUS_ITEMS`) all *look* like hardcoded English but are module-level constants that cannot call a hook, and every render site translates through a catalogue key with the constant as `??` fallback — `MapFeatureList.tsx:140,180,209,225,241,253,273,286`, `LayerTogglePanel.tsx:48,64,76-78`. I verified the corresponding keys exist: `map.layer.*` (all 14), `map.caveat.*` (7), `map.gibs.*` (4), `map.group.*`, `ui.externalViews.kind.*`, `ui.legend.status.*`. This is correct and well-commented. Similarly `'HAZARD-AVOIDED'`/`'DIRECT-PATH'` (`MapFeatureList.tsx:289`) and `logistics.transition.*` are machine tokens, documented as such.

### 🔴 BLOCKING B-5 — `routing-panel.tsx` and `verifier-queue.tsx` contain **zero** `useT` calls; every string, including accessible names, is hardcoded English

**PROVEN.** `grep -c "useT\|useTranslations\|useFormatter"` → **0** for both files. These are the only two components in all of `app/**` with user-visible copy and no translation hook.

**`app/_components/panels/routing-panel.tsx`** — the evacuation-routing surface:

| Line | Kind | String |
|---|---|---|
| 26 | `EmptyState title=` | `No shelters matched` |
| 26 | `EmptyState description=` | `No shelters in range for this origin.` |
| 29 | **`aria-label=`** | `Nearest shelters` |
| 74 | body text | `Route avoids the incident hazard area.` |
| 75 | body text | `Direct path only — the hazard area could not be avoided (heuristic fallback). Treat with caution.` |
| 82 | body text | `Road routing (OpenRouteService)` |
| 83 | body text | `Hazard-avoiding heuristic (offline engine — not road-following)` |
| 138 | **`Panel title=`** | `Evacuation routing` |
| 139 | **`aria-label=`** | `Request an evacuation route` |
| 141 | body text | `Click the map to set the origin, or type coordinates.` |
| 172 | button label | `Routing…` / `Request route` |
| 188 | **`aria-label=`** | `Route result` |

Line 75 — *"Treat with caution"* — is a safety caveat on a route that may run through a hazard area.

**`app/_components/panels/verifier-queue.tsx`** — the report-triage surface where a human decides whether a citizen report becomes a public alert:

| Line | Kind | String |
|---|---|---|
| 95 | body text | `Live Feed — Unofficial (expired live link)` |
| 231 | body text | `Confidence` |
| 238 | **`aria-label=`** | `Confidence components` |
| 288 | body text | `No claim recorded (report predates text retention)` |
| 400 | **`title=`** (tooltip on the reject control) | `Reject as false / misinformation — no alert is emitted (Art. XIII/XIV)` |
| 487 | **`Panel title=`** | `Verification queue` |
| 495 | `EmptyState title=` | `Queue clear` |
| 496 | `EmptyState description=` | `No unverified reports awaiting triage.` |
| 525 | body text | `Alert` (capStatus fallback) |
| 488-493 | error text | the `role="alert"` decision-failure message |

Plus, rendered *from* this file: `app/_lib/mappers.ts:46-49` — `CONFIDENCE_COMPONENT_META` supplies `'Geocode'`, `'Source authority'`, `'Classifier'`, `'Corroboration'`, emitted raw at `verifier-queue.tsx:241` with no catalogue key anywhere. These are the four sub-scores an operator weighs when deciding whether to trust a report.

**Why this is blocking rather than should-fix.** Eight of these are **accessible names or panel titles** — they are what a screen-reader user hears and what the landmark is announced as, so a non-English screen-reader user gets an untranslatable island. And these two panels are the two irreversible-action surfaces in the product: publish an alert, dispatch an evacuation. An emergency-management organisation evaluating BEACON for adoption in a non-English jurisdiction will find the COP fully localised and the two decision surfaces not. The `_meta.comment` convention and the parity discipline everywhere else make this read as an oversight rather than a policy.

**Remedy.** Add a `routing.*` and extend the `verifier.*` namespace in `en.json` (≈22 keys), mirror them into the 13 catalogues through the existing machine pipeline, and convert both components to `useT`. Move `CONFIDENCE_COMPONENT_META` to the same `messageKey`-alongside-English-fallback pattern `legend.tsx:25-42` already uses, so the module-level constant stays legal and the render site translates.

### 🟡 SHOULD-FIX B-6 — `sos-form.tsx` is partially internationalised; its accessible names and placeholders are not

**PROVEN.** The file has 4 `t()` calls but leaves these hardcoded:

`app/_components/panels/sos-form.tsx` — `:117` `aria-label="Send an SOS report"`, `:130` `placeholder="Describe the emergency and any immediate needs."`, `:144`/`:149` `aria-label`+`placeholder` `"Latitude"`, `:152`/`:157` `"Longitude"`, `:163` `"Unofficial"`, `:202` `"Sending…"`/`"Send SOS"`, `:211` `"Report received"`, `:215` `aria-label="Confidence components"`.

This is the **citizen-facing** surface — the one component most likely to be used by someone who does not read English, since the operator at least chose the deployment. A partially-translated form is arguably worse than a wholly untranslated one: the user sees their own language and then hits an English placeholder at the field they must fill in.

**Remedy.** Same as B-5; ≈9 keys.

### 🔵 NIT B-7 — `db-admin-link.tsx` (deliberate, documented)

`app/_components/db-admin-link.tsx:23` — `const DB_ADMIN_LABEL = '⛁ DB Admin ↗';` The file documents it as a conscious PLAN-DELTA (*"Hardcoded English, NOT an i18n key: the V2 catalogs are frozen (plan §0·8)"*). It is EM-only, admin-console furniture, one string. Fold it into the B-5 catalogue work when the freeze lifts; it is not worth its own change.

### ✅ Everything else in `app/**` is clean
Every other component with user-visible copy uses `useT`. No other accessible name, panel title, placeholder or body string is hardcoded.

---

## B4 · ICU correctness

### ✅ Sound — plural rules are genuinely right

`en.json` contains exactly **one** message with plural syntax: `ui.provenance.triggerAria` = `{label} — {count, plural, one {# source} other {# sources}}`. Checked against each locale's CLDR categories:

| Locale | Required | Declared | |
|---|---|---|---|
| ar | zero one two few many other | `zero one two few many other` | ✅ all six, correct forms (`مصدران` dual, `مصادر` few) |
| ru | one few many other | `one few many other` | ✅ `источник/источника/источников` |
| ro | one few other | `one few other` | ✅ `sursă/surse/de surse` — the `de` in `other` is correct Romanian |
| hi, bn, ur, el, fil, id | one other / — | correct | ✅ |
| zh-Hans | other | `other` only | ✅ correct — `{# 个来源}` with the measure word |

Whoever produced these understood CLDR plural categories, which is rare. `ui.relativeTime.*` is also properly localised rather than pattern-copied: `ar` `منذ {value} ث`, `zh-Hans` `{value} 秒前` (suffix position moved), `ru` `{value} с назад`, `ro` `acum {value} s`.

### 🔵 NIT B-8 — `es`/`fr`/`pt-BR` omit the `many` category
Those three declare `one`/`other` only, and CLDR does list `many` for all three. In practice `many` in French, Spanish and Portuguese applies **only** to compact/large-number notation (1 000 000, 1c6) and is unreachable for an integer source count, so the rendered output is correct today. Worth adding for completeness if B-1's plural-category test is implemented; not a defect.

---

## B5 · RTL (Arabic, Urdu)

### ✅ Sound — the best-handled area in Part B

- `<html lang={locale} dir={dir}>` is **server-rendered from the cookie** (`app/layout.tsx:44-49`), so the first paint carries the correct direction with no flash and no hydration mismatch — the comment at `:47` says exactly why, and `app/_lib/i18n.tsx:39` corroborates.
- Direction is data, from the locale registry: `config/locales.json` → `src/config/locales.ts:33-34,94` (`localeDir`), with `useTextDirection()` (`i18n.tsx:70-71`) for the rare component that must branch.
- Logical properties are used throughout — `ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`/`text-start`/`text-end` appear across 15 component files, led by `MapFeatureList.tsx` (10 uses).
- An RTL visual baseline exists and is maintained (`cop-rtl.png`, referenced at `sitrep-panel.tsx:100`).
- The map canvas deliberately does **not** mirror (`locales.ts:33`) — correct: geography is not a reading direction.

### 🔵 NIT B-9 — One physical direction class
`app/_components/ui/dialog.tsx:37` — `className="absolute right-3 top-3 …"` on the dialog close button. In `dir="rtl"` it stays top-**right** where the convention is top-left. The only other physical hits in `app/**` are `left-1/2` at `dialog.tsx:28` and `command-palette.tsx:107`, both paired with `-translate-x-1/2` for centring — direction-neutral and correct.

**Remedy.** `right-3` → `end-3`. One character-class change; the `cop-rtl.png` baseline will need a recapture.

---

## B6 · Locale-sensitive formatting

### 🟠 SHOULD-FIX B-10 — No `Intl` anywhere; one date renders English month names in all 14 locales

**PROVEN.** `grep -rn "Intl\.\|toLocaleString\|toLocaleDate\|toLocaleTime\|useFormatter"` across `app/**` and `src/**` returns **zero non-comment hits**. (The only mention is `src/application/coordination/csv.ts:18` explaining that CSV export deliberately avoids `toLocaleString` for byte-determinism — correct.)

Most formatting rides on ICU `{x, number}` inside next-intl, which uses `Intl.NumberFormat` internally and is the right approach. Three places bypass it:

1. **`app/_components/panels/routing-panel.tsx:89`**
   ```tsx
   <time dateTime={route.suggestedStart}>{new Date(route.suggestedStart).toUTCString()}</time>
   ```
   `toUTCString()` is specified to emit `"Mon, 11 Sep 2026 14:30:00 GMT"` — **fixed English** weekday and month abbreviations, in every locale, with no way to localise. This is the departure time of an evacuation route. (It is also inside the B-5 file, so it is currently English-among-English; it will stand out once that panel is translated.)
2. **`app/_components/panels/logistics-board.tsx:305`** — `(item.distanceMeters / 1000).toFixed(1)` renders `12.5`, with an ASCII decimal point, in `ro`/`fr`/`es`/`pt-BR`/`ru`/`el`/`id` where the convention is `12,5`.
3. **14 numeric placeholders declared without a type**, against 15 that use `{x, number}`/`plural`:
   `statusStrip.minutesAgo` `{minutes} min` · `statusStrip.liveOfTotal` `{live}/{total} live` · `map.outage.withCount` `{count} customers out — {state}` · `volunteerTeamsPanel.headcount` `Headcount {count}` · `ui.relativeTime.{seconds,minutes,hours,days}` `{value}s ago` … · `map.detail.severity`/`map.detail.stage` · `warning.headline`/`warning.what` · `channels.alert.headline`.
   Under next-intl, `{x, number}` renders Arabic-Indic digits for `ar` and Bengali digits for `bn`; bare `{x}` renders ASCII. So an Arabic COP shows `٣ مصادر` from the plural message next to `5 د` from `statusStrip.minutesAgo` — **two digit systems on one status strip.**

**Remedy.**
- `routing-panel.tsx:89` → `useFormatter().dateTime(new Date(route.suggestedStart), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })`, keeping the machine-readable `dateTime` attribute as-is.
- `logistics-board.tsx:305` → pass the raw number into an ICU message with `{km, number, ::.0}` rather than pre-formatting with `.toFixed`.
- **Decide the digit policy once and apply it uniformly.** Either add `, number` to all 14 (locale digits everywhere) or strip it from the 15 (ASCII everywhere). For a crisis screen ASCII-everywhere is a defensible choice — what is not defensible is mixing them. Whichever is chosen, encode it as a test in `catalog-parity.test.ts` so it cannot drift.
- Note `status-strip.tsx:77` (`now.toISOString().slice(11, 19)`) is **correct** and should not be changed: it is a deliberate UTC operational clock, labelled by `statusStrip.clock = "UTC"`. Coordinate geometry (`MapFeatureList.tsx:42`, `sos-form.tsx:99`) is likewise correctly left ASCII.

---

# COMBINED PRIORITISED REMEDIATION BACKLOG

## 🔴 Blocking (5)

| # | Finding | Evidence | Remedy |
|---|---|---|---|
| 1 | **Composition rejection is memoised forever** — one bad env var ⇒ permanent unshaped 500s until restart | `http-dispatcher.ts:691-693` (`??=` over a rejected promise); throw sources at `config/index.ts:551`, `client.ts:16-18`, `:653`, `:665` | `.catch((e) => { cachedAsync = undefined; throw e; })` inside `getHttpDepsAsync` |
| 2 | **Next delegators have no error boundary** — unshaped 500s outside `handleHttp`'s contract, possibly leaking a config/DB message | `app/api/v1/[...path]/route.ts:20-23`; `app/api/v1/stream/route.ts:45-46`; `app/.well-known/sustainability/route.ts:6-11` | Wrap all three in `try/catch` → `channelErrorEnvelope('INTERNAL_ERROR', …)` + log |
| 3 | **Live composition has no overall deadline and runs on the first request** — worst case ≫ Railway's 60 s | `live-composition.ts:184-190,200-204`; `live-seed.ts:569-577`; `regions.json` 31/25/22/22/20; `resilient-http.ts:12`; `circuit-breaker.ts:38-39`; `.env.example:201` | `Promise.race` budget (`LIVE_COMPOSITION_BUDGET_MS`, default ~25 s) → `null` → offline seed; **and** move composition to `instrumentation.ts` |
| 4 | **No boot validation + no error logging** — config errors surface per-request, and `INTERNAL_ERROR` discards the exception | no `instrumentation.ts`; `loadConfig` only at `http-dispatcher.ts:618`; `http-dispatcher.ts:173-178`, `:206-211` drop `thrown`; pino only at `observability.ts:41` | `instrumentation.ts` → `getHttpDepsAsync()` at boot; process-wide pino on `HttpDeps`; log both catch sites with a correlation id returned in the envelope; add a request log line |
| 5 | **Two operator panels have zero i18n**, including 8 accessible names / panel titles | `routing-panel.tsx` and `verifier-queue.tsx` — `useT` count 0; strings tabulated in B-5; plus `mappers.ts:46-49` rendered raw at `verifier-queue.tsx:241` | ≈22 new keys × 14 catalogues; convert both to `useT`; move `CONFIDENCE_COMPONENT_META` to the `legend.tsx:25-42` `messageKey` pattern |

## 🟠 Should-fix (10)

| # | Finding | Evidence | Remedy |
|---|---|---|---|
| 6 | 8 Postgres pools (~80 conns) at boot, against an in-repo warning; 2 more leak per re-ingest | `http-dispatcher.ts:451`, `build-core.ts:151,269,274,287`, `feature-seed.ts:394,413`, `scheduler.ts:253` vs `client.ts:21-37` | `makeDb(` → `sharedDb(` (8 sites); lint-ban `makeDb` outside `client.ts`; set an explicit `max` |
| 7 | All live-composition fallback diagnostics are debug-only — the "region went blank" signal is off by default | `live-composition.ts:61-65`; `LOG_LEVEL` default `'info'` at `config/index.ts:73` | Emit the 5 fallback reasons at `warn`/`error` unconditionally |
| 8 | `fetchSlice` swallows every adapter throw — the inner loop of a blank region, run 120× per composition | `live-seed.ts:104-116` | Log `{adapterId, regionId, err}` at `warn` before degrading |
| 9 | LLM provider failures are invisible to the operator | `llm-ladder.ts:66-75`; `Observability` composed at `build-ai.ts:60,80` but never called here | Call `observability.decision(…)` in the catch |
| 10 | Two durable writes fire-and-forget, silently | `logistics.ts:191` (evac-route trail), `command-router.ts:668` (SitRep history) | Keep non-blocking, `.catch((e) => logger.warn(…))` |
| 11 | Parity test has no untranslated-value or plural-category check | `tests/i18n/catalog-parity.test.ts:44,103,110,119` | Add both assertions + a `config/i18n-loanwords.txt` allow-list |
| 12 | `anticipatory.*` (29 keys of prose, incl. two safety disclaimers) untranslated in all 13 locales | byte-identity across all catalogues; values tabulated in B-2 | Run the machine pipeline over the namespace; land #11 to prevent recurrence |
| 13 | Filipino catalogue 28.2% untranslated — ~2× the next worst; `ph` is a shipped region | 111/393; key list in B-3 | Re-run the `fil` pass |
| 14 | `sos-form.tsx` partially internationalised — accessible names + placeholders hardcoded on the citizen surface | `sos-form.tsx:117,130,144,149,152,157,163,202,211,215` | ≈9 keys; convert with #5 |
| 15 | No `Intl`; `toUTCString()` emits English months in 14 locales; digit systems mixed on one screen | `routing-panel.tsx:89`; `logistics-board.tsx:305`; 14 untyped vs 15 typed numeric placeholders (B-6) | `useFormatter().dateTime`; move `.toFixed` into ICU; pick one digit policy and test it |

## 🔵 Nits (7)

| # | Finding | Evidence |
|---|---|---|
| 16 | `right-3` on the dialog close button won't mirror in RTL | `app/_components/ui/dialog.tsx:37` → `end-3` (recapture `cop-rtl.png`) |
| 17 | `es`/`fr`/`pt-BR` omit the CLDR `many` plural category (unreachable for integer counts) | B-4 |
| 18 | Compass points left English in `fr`/`ro`/`fil`; `W`/`SW` genuinely differ in both languages | `map.compass.*` |
| 19 | `db-admin-link.tsx` label hardcoded (documented PLAN-DELTA, EM-only) | `db-admin-link.tsx:23` |
| 20 | Three deliberate `catch {}` blocks — correct by design, flagged so a future sweep doesn't "fix" them | `scheduler.ts:160`, `live-refresh.ts:72-76`, `stream.ts:206` |
| 21 | `GET /health` is static and never probes Postgres or the composition | `http-dispatcher.ts:~272` — consider splitting `/health` (liveness) from `/ready` |
| 22 | `ro._meta` is the one `review: "human"` catalogue; the honesty invariant is enforced — keep it that way when translations are refreshed | `messages/ro.json`, `catalog-parity.test.ts:73-77` |

---

## What I could not check, and why

1. **Actual wall-clock composition time under a degraded network.** The 60 s analysis (A-3) is arithmetic over proven constants and a proven sequential structure, not a measurement — running the live composition would require real network egress to 45 upstreams, which is outside a read-only audit. The **structure** (three nested sequential loops, no overall deadline, invoked on the first request) and the **constants** (8 s × 2 retries, 60 s backstop, 120 adapter slots) are PROVEN; the resulting worst-case total is arithmetic. The `.env.example:201` note about one adapter reaching ~24 s independently corroborates the order of magnitude.
2. **Whether a rejected `cachedAsync` is observed as an unhandled rejection.** It is `await`ed immediately by `delegate`, so it has a handler and should not crash the process — but if a future caller takes the promise without awaiting, Node's `unhandledRejection` default (`throw` since Node 15) would terminate the process. Not exercised today; flagged as SUSPECTED for whoever implements the A-2 fix.
3. **Translation *quality*** in the twelve machine-translated locales. I checked parity, ICU correctness, plural categories and byte-identity — all mechanical. Whether the Arabic or Bengali reads well to a native speaker is out of reach here, and the catalogues honestly declare `review: "machine"` and surface that in the UI (`locale.machineTranslatedShort`), which is the right posture.
4. **Runtime RTL rendering.** Verified statically (server-rendered `dir`, logical properties, one physical outlier) and the repo maintains a `cop-rtl.png` visual baseline, but I did not run Playwright — the visual gates belong to the browser-gate suite.
5. **Deployment-side timeout and health configuration** (Railway `healthcheckPath`/`healthcheckTimeout`, proxy limits, replica count) — out of scope by agreement; the sibling deployment audit owns it. A-3's 60 s conclusion assumes Railway's documented default edge limit.
6. **Whether `GET /reports` degrades acceptably *in the UI* under a Postgres outage.** The store returns a typed `Result` and the panel has an `isError` branch with `role="alert"` (`verifier-queue.tsx:488-493`) — but that copy is hardcoded English (B-5), and I did not run the scenario end-to-end to see the rendered text.
