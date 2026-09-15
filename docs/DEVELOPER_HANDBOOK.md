# BEACON — Developer Handbook (end to end)

> For a developer who has to understand, run, debug, fix, extend or optimise BEACON with no other
> help — and for a coding agent that needs the shortest path to the right file. It is a map with the
> reasoning attached; the reference documents it points at hold the detail and stay authoritative:
> `docs/architecture/C4_ARCHITECTURE.md` (diagrams, ADR index), `docs/SPEC.md` (contract of record),
> `docs/architecture/CONFIGURATION.md` (every variable), `docs/api/openapi.yaml` (the API),
> `docs/TEST_PLAN.md`, `docs/CI_CD.md`, `docs/architecture/THREAT_MODEL.md`, and the ADRs under
> `docs/architecture/decisions/`.

## 0. Ten facts to hold in your head

1. **Hexagonal.** `src/domain` (pure) → `src/application` (use-cases, pure) → `src/ports` (interfaces)
   → `src/adapters` (everything that touches the world) → `src/main` (composition root) → `app/`
   (Next.js UI + thin API delegators). Boundaries are machine-enforced (`.dependency-cruiser.cjs`,
   `eslint.config.js`, `tests/architecture/*`).
2. **One request path.** `app/api/v1/[...path]/route.ts` → `handleHttp()`
   (`src/adapters/channels/http/http-dispatcher.ts`) → `resolveRoute()` → either a canonical `Command`
   dispatched through the `InteractionPort` (`src/application/interaction/command-router.ts`, which owns
   RBAC) or a feature route (`routes/feature-router.ts` and siblings). Every answer is the envelope
   `{ data, provenance[], freshness }`.
3. **The picture is composed, not queried.** Under `DATA_SOURCE_COMPOSITION=adapters`,
   `assembleLiveSeeds()` (`src/main/live-composition.ts`) builds ONE adapter registry per region, fetches
   every enabled source through the redundancy ladder, and produces the seeds the deterministic engines
   derive the COP from. `runLiveReingest()` (`src/main/live-refresh.ts`) repeats that every
   `LIVE_REINGEST_INTERVAL_SEC` and swaps the whole picture in one statement.
4. **The ladder is everywhere.** Every source adapter runs inside `RedundancyEngine.run()`
   (`src/adapters/_shared/redundancy.ts`): LIVE → last-known-good CACHED → recorded MOCK → unavailable,
   with a circuit breaker, per-source timeouts, and a `[beacon] source degraded:` log line naming why.
5. **Numbers are deterministic; the LLM narrates.** `src/application/*` computes exposure, ranking,
   thresholds, projections, routes; `sitrep-synthesis` hands cited facts to `LLMPort` which may only
   narrate them, through the compliance proxy (`src/adapters/compliance/*`). AI off ⇒ same facts.
6. **A human approves every public action.** Alerts are DRAFT until `POST /alerts/{id}/approve` by
   VERIFIER+; every state change writes a hash-chained `audit_event`.
7. **Config is everything.** `src/config/index.ts` (`EnvSchema`, zod, fail-fast) + `config/*.json`
   (regions, adapters manifest, shelters, EAPs, thresholds). `.env.example` documents every variable and
   a test keeps it that way.
8. **Roles:** PUBLIC < RESPONDER < VERIFIER < EM. Identity is a verified HS256 JWT (`rbac.ts`, jose,
   fail-closed to PUBLIC). `x-beacon-role` is honoured only with `AUTH_DEV_TRUST_HEADER=on` and never in
   cloud/production.
9. **The UI reads the wire, never derives.** `app/_lib/api.ts` (typed client) → `hooks.ts` (TanStack
   Query) → panels/map. `app/_lib/map-data.ts` projects the served map envelope into deck.gl layers
   (`app/_components/map/build-layers.ts`). The status strip counts lists the server sent.
10. **Everything is verifiable offline.** `npm run dev` with no `.env` renders the full COP from the
    seed (`src/main/seed.ts`) with MOCK provenance; the gates run with zero keys and zero egress.

## 1. Repository map

| Path | What lives there |
|---|---|
| `src/domain/` | Entities, value objects, invariants, pure functions (`alert`, `incident`, `threshold-rule`, `citation`, `value-objects/geo`, …). Imports nothing framework-ish (lint rule) |
| `src/application/` | Use-cases: `derivation` (derive-cop, derive-alerts), `risk-intersection`, `priority-ranking`, `threshold-evaluation` (+ `live-signals`), `prediction-projection`, `escalation-trend`, `evac-routing`, `sitrep-synthesis`, `forecast-likelihood`, `outlook`, `anticipatory`, `impact`, `pre-positioning`, `coordination` (D4/D6 panels), `aggregate`, `governance` (retention sweep), `privacy`, `interaction` (command router = the one InteractionPort) |
| `src/ports/` | The interfaces adapters implement: data sources, infrastructure sources, cameras, air quality, intel (LLM/Vision/compliance), public reports, logistics/routing/shelters, panels, interaction (Envelope, Command), infra (repository, cache, spatial, event bus, provenance sink, incident snapshot) |
| `src/adapters/_shared/` | The adapter framework: `redundancy.ts` (ladder), `circuit-breaker.ts`, `resilient-http.ts` (timeouts, manual redirects, SSRF guard), `last-known-good-cache.ts`, `recorded-mock.ts`, `source-config.ts` (`SOURCE_<PREFIX>_*` resolution), `coverage.ts`, `manifest.ts`, `provenance.ts`, `anti-corruption.ts` |
| `src/adapters/sources/<id>/` | One directory per data source (45). Each has `<id>-adapter.ts` (factory + class implementing `SourceAdapterPort<T>` and the outward domain port), `__fixtures__/` (recorded upstream responses = the MOCK rung), tests |
| `src/adapters/channels/` | Driving adapters: `http/` (dispatcher, routing, rbac, credentials, rate limit, routes/*), `cli/`, `messaging/` (Telegram webhook/poll) |
| `src/adapters/persistence/` | Drizzle schema (`schema/*.ts`), `client.ts`, read-models, repositories, seed, region/reference/shelter registries, provenance sink, incident snapshot, threshold rules, retention store; SQL migrations in `drizzle/` |
| `src/adapters/{ai,compliance,alerting,interop,routing,logistics,spatial,cache,eventbus,memory,governance}/` | LLM/vision ladder + observability; the compliance proxy (firewall, PII, budget, audit chain, gate token); CAP/EDXL mappers + schema validation; ORS/heuristic routing; logistics stores; Turf/PostGIS; caches; event bus; the in-memory core read-models; drill recorder |
| `src/main/` | Composition: `build-core.ts` (sync offline core + async live core), `build-ai.ts`, `build-vision.ts`, `build-drill.ts`, `adapter-registry.ts` (manifest → wired adapters per region), `live-seed.ts` / `map-seed.ts` / `live-composition.ts` (registry → seeds), `feature-seed.ts` (feature deps: rules, routing, logistics, panels), `live-refresh.ts`, `scheduler.ts` (background loop), `seed.ts` (offline demo seed) |
| `app/` | Next.js App Router. `page.tsx` = the COP orchestrator; `layout.tsx` = fonts, i18n, PWA bridge; `_components/` (map, panels, ui, status strip, controls, pwa); `_lib/` (api client, hooks, store, i18n, map-data, mappers, query client, pwa); `api/v1/**/route.ts` delegators; `globals.css` tokens |
| `config/` | `regions.json` (zones, bbox, tz, enabled_adapters, source_mode_overrides), `adapters.json` (manifest: id, prefix, mode, coverage, port), `shelters.json`, `reference-data.json` (resource roster), `eap/*.json`, thresholds/likelihood/trend/impact params, `policies.yml` (compliance), `locales.json` |
| `schemas/` | JSON Schemas (adapter manifest, regions, CAP 1.2, EDXL-RM/SitRep, SitRep, source-ref, D5/D6 rows, policies…) + `adapter-contract.md` |
| `messages/` | 14 locale catalogues; `en.json` is the schema; parity is tested |
| `scripts/` | `migrate.mjs`, `build-seed.mjs` → `seed.mjs` (runtime image), `check-live.mjs`, `demo.mjs`, `live-probe.ts`, `ai-probe.ts`, `pg-probe.ts`, `telegram-poll.ts`, `mint-judge-tokens.ts`, `demo-reset.ts`, `capture-playbook.ts`, `copy-maplibre-worker.mjs` (prebuild), `build-pwa-icons.mjs` |
| `e2e/` | Playwright: golden path, logistics tasking, zones, layers, SSE push, session persistence, a11y (axe), perf (TTTP), visual baselines, i18n/RTL, WebGL smoke, PWA offline |
| `tests/` | Cross-cutting: `architecture/` fitness functions, `i18n/` catalog parity, `redundancy/` acceptance harness, `zones/`, `geo/`, `integration/` (real Postgres, opt-in), `fixtures/` |
| `infra/` | `Dockerfile` (multi-stage; runtime image carries migrator + seed), `docker-compose.yml`, `env-for-docker.sh`, `k8s/` (kustomize) |
| `docs/` | Everything above plus guides: USER, OPERATOR, RELEASE, DEPLOYMENT, CLOUD_DEPLOY_RAILWAY, LIVE_PRODUCTION, SECURITY_BASELINE, RESPONSIBLE_DATA, audits of record under `docs/audit/` |

## 2. Run it

```bash
nvm use && npm install
npm run dev                     # http://localhost:3000 — offline seed, no keys, MOCK sources
cp .env.example .env            # then set what you need (see docs/RELEASE_GUIDE.md §3)
npm run docker:up               # renders .env for compose: Postgres → migrate → seed → app
npm run cli -- status --region us-ca   # the same core over the CLI channel
```

Gates (identical to CI): `npm run typecheck`, `npm run lint`, `npm run boundaries`, `npm run format:check`,
`npm run test:coverage`, `npm run build`, `npx playwright test`, `npm audit --audit-level=high`,
`npm run docs` (OpenAPI contract test). `npm run test:integration` needs `DATABASE_URL_TEST`.

## 3. How a request flows (read this once with the files open)

1. Browser → `GET /api/v1/regions/us-ca/incidents` with `authorization: Bearer …` (or nothing).
2. `app/api/v1/[...path]/route.ts` converts the `Request` to the transport-neutral `HttpRequest` and calls
   `handleHttp(req, await getHttpDepsAsync())`. `getHttpDepsAsync` memoises the composition (built once
   per process; warmed at boot by `instrumentation.ts`).
3. `handleHttp`: `resolvePrincipal` (JWT → `{role, sub}` or PUBLIC) → rate limit (token bucket per actor)
   → `scanInjection` on text bodies → `resolveRoute` (path → `Command` or feature route) → dispatch.
4. Core commands go through `createCommandRouter` → `MIN_ROLE` gate → use-case → `Envelope`. Feature
   routes (`routes/*.ts`) do the same with their own deps (`HttpFeatureDeps`: threshold rules, routing,
   logistics, panels, map projection, streams).
5. `error-mapping.ts` turns a `DomainError.code` into a status; nothing leaks a stack.
6. The UI (`hooks.ts`) caches per query key; `RegionStream` (SSE `/stream`, polling fallback) invalidates
   keys on deltas, so the UI refetches grounded data rather than trusting a pushed payload.

## 4. How the live picture is built

- `config/adapters.json` lists every adapter (id, `configPrefix`, default mode, coverage, port).
  `buildAdapterRegistry()` (`src/main/adapter-registry.ts`) calls each factory with a mode-resolved env
  (**env `SOURCE_<PREFIX>_MODE` > region `source_mode_overrides` > manifest mode**), keeps only the
  region's `enabled_adapters`, and **excludes** any adapter whose factory refuses (missing key, bad URL)
  with a `[beacon] source excluded from registry:` line.
- `assembleLiveSeeds()` fetches every registry entry (concurrency `LIVE_REGION_CONCURRENCY`), maps
  results into `CoreSeed` (SitRep inputs) + `MapInputsSeed` (geometry), discovers incidents from live
  hazards (`discovered:<region>:…`, ADR-043), applies focus areas (ADR-045), clips records to the region
  (ADR-042), mirrors provenance and incidents to Postgres (ADR-039), and evaluates live threshold rules
  from the `threshold_rule` table (ADR-044). `LIVE_PICTURE=hybrid` keeps the seeded demo beside it.
- `withLiveOverlay()` / `reingestedDeps()` in the dispatcher merge the overlay into the feature deps
  and refresh derived lookups on every re-ingest.
- If anything fails, the caller keeps the last complete picture (never a half-built one, never blank).

## 5. Adding things (the "plugin" points)

**A data source.** Copy the nearest adapter directory (`src/adapters/sources/<similar>/`), implement the
factory (`resolveSourceConfig({ prefix, env, defaultMode, defaultUrl })`) and the class (`fetch()` →
`engine.run({...})` with `fetchLive`, `loadMockRaw`, a mapper into the domain entity, `coverage`), record
a real response into `__fixtures__/` (the MOCK rung; never invent it), register it in
`config/adapters.json`, add it to the regions it covers in `config/regions.json` (**only** regions it
covers — a structural test checks "consulted == enabled"), document `SOURCE_<PREFIX>_*` in `.env.example`
and `CONFIGURATION.md` §6, add its licence to `NOTICE`, and write the mode-switch tests every adapter
has (MOCK/CACHED/LIVE, degradation, coverage). The redundancy acceptance harness
(`tests/redundancy/`) and `src/main/adapter-registry.test.ts` pick it up.

**A region.** One object in `config/regions.json` (id, name, bbox, iso, tz, languages, enabled_adapters,
optional overrides and focus). Seeds, e2e zone specs and the selector derive from it.

**A locale.** `config/locales.json` + `messages/<locale>.json` mirroring `en.json` (parity test), with an
honest `_meta` (machine vs reviewed). Fonts: `app/layout.tsx` if a new script.

**An API route.** Add the path to `docs/api/openapi.yaml` first (with `x-required-role`), then the route
module under `src/adapters/channels/http/routes/`, wire it in `feature-router.ts`, add the client function
in `app/_lib/api.ts` and a hook. If it is a PUBLIC GET the service worker may cache it — the policy test
will tell you.

**A threshold rule.** A row in `threshold_rule` (EM edits it in Directus, or `config`/seed); rules are
loaded at composition and on every re-ingest; DRAFT alerts only.

**A dock panel.** `src/application/coordination/*` (pure), `routes/panels.ts`, a JSON Schema under
`schemas/`, `app/_components/panels/*.tsx`, a `FEATURE_D4_*`/`D6_*` flag + `NEXT_PUBLIC_` mirror.

## 6. Debugging playbook

**Start with the log.** Every line the app emits is prefixed `[beacon]`:

| Line | Meaning | Do |
|---|---|---|
| `boot warm-up scheduled/started/complete` | composition ran at boot (`instrumentation.ts`) | if `failed`, the first request retries |
| `seeded N regions, …` / `seed failed: …` | ADR-046 self-seed | on failure the SQLSTATE is in the line; run the pre-deploy command |
| `database not seeded (…)` | region rows without natural keys | let the app seed, or run `node scripts/seed.mjs` |
| `source excluded from registry: <id> — <reason>` | factory refused (missing key, bad URL) | fix the variable; the region composes without it |
| `source degraded: <id> LIVE->CACHED/MOCK — <kind>: <reason>` | the ladder fell a rung | read the reason: 406 = no User-Agent, 429 = rate limit/budget, `network/timeout: fetch failed` = DNS/egress from that host, `no … reporting point lies inside region` = config, `NOT_COVERED` = wrong region |
| `routing degraded: ors -> heuristic — <code>` | ORS unreachable or keyless | set `ORS_API_KEY`; the heuristic is labelled |
| `unhandled request failure` | a non-domain throw became a 500 | the stack is in stderr; the body never carries it |

`LOG_LEVEL=debug` (or `BEACON_DEBUG_LIVE=1`) names why a region's registry fell back to the seed.

**Probes and checkers.**

```bash
npm run check:live -- --region ro [--user id --pass pw]   # 11–17 checks against a deployment
BEACON_DEBUG_LIVE=1 npm run live:probe                    # per-source LIVE/CACHED/MOCK from this machine
PROBE_ROLE=EM npm run ai:probe                            # one real narration through the proxy
npm run pg:probe                                          # durability round-trip on a real Postgres
curl -s $B/api/v1/sources?regionId=us-ca | jq '.data.sources[]|{sourceId,mode,fetchedAt}'
curl -s $B/api/v1/health                                  # startedAtMs vs fetchedAt = "did the process restart?"
```

**Common failures and where the fix is.**

| Symptom | Cause | Fix |
|---|---|---|
| Everything MOCK on a live deploy | `DATA_SOURCE_COMPOSITION` is `seed` | set `adapters` + `LIVE_REINGEST_INTERVAL_SEC` (RELEASE_GUIDE §3) |
| A source CACHED although the store says `live` | the running process has the old env (staged, undeployed) — or a region override; env wins in code (`resolveEntryEnv`) | compare `railway ssh … env`; redeploy |
| `cached` source shows MOCK after restart | in-memory LKG cache is cold and `cached` never fetches | use `live` |
| Overpass `406` | no User-Agent | default header since 2026-09-15; set `SOURCE_OSM_OVERPASS_USER_AGENT` |
| Overpass `fetch failed` from the cloud host | egress/DNS to that mirror | `SOURCE_OSM_OVERPASS_MIRRORS` with a mirror the host can reach; raise `SOURCE_OSM_OVERPASS_TIMEOUT_MS` |
| OpenCelliD 429 | free-tier quota | `SOURCE_OPENCELLID_MAX_TILES`, `SOURCE_OPENCELLID_DAILY_BUDGET`; needs a focus area |
| GloFAS CACHED with mode live | no `SOURCE_GLOFAS_POINTS` inside that region | add a reporting point in the bbox |
| Login hangs after deploy | first request paid the whole composition (pre-2026-09-11) | fixed by boot warm-up; check `boot warm-up` lines |
| 403 on `/reports` as EM | token not verified (wrong `AUTH_SECRET`, expired) → PUBLIC | `/api/v1/me` shows the resolved role |
| Map blank rectangle | basemap host refused (200 + "Access blocked" image) | ladder walks OpenFreeMap → VersaTiles → OSM; `NEXT_PUBLIC_BASEMAP_TILE_URL` to pin |
| Panel shows fixtures under postgres | table empty / DB read failed → labelled fallback (ADR-041) | seed or fill rows in Directus |
| A `NEXT_PUBLIC_*` change has no effect | build-time variable | rebuild (Docker ARG / platform build vars) |
| `/status` and `/sources` answer 422 `SourceRecord.license is required` (postgres posture) | a `source_record` row with a NULL licence (written before 2026-09-11) reached a SourceRecord factory | fixed 2026-09-15: the read model projects views without the factory and the sink heals the column on the next poll; on an older build, set the licence on that row |
| Offline app never caches | first visit installs the worker; PWA flag off retires it | second visit; `NEXT_PUBLIC_PWA=on`; HTTPS |
| Offline banner never appears | it renders only while a worker controls the page (`navigator.serviceWorker.controller`) | reload once after install; check DevTools → Application → Service Workers |
| Offline picture in the wrong language | impossible by construction: saved copies are keyed by URL + `beacon-locale` (`localizedKey` in `public/sw.js`); without the Cookie Store API the worker saves and serves no page or data at all | switch language online once so that language is saved |
| No offline picture at all in one browser | it lacks the Cookie Store API (`self.cookieStore`: Chrome 87+, Firefox 132+, Safari 18.4+) — the worker then passes pages and data through | use a current browser; build assets are still cached |
| CI red on coverage | a floor in `vitest.config.ts` | add tests; **never lower a floor** |
| `docker compose up` "no configuration file" | compose file lives in `infra/` | `-f infra/docker-compose.yml` |

**Reading a degraded line's redaction:** URLs keep scheme + host; paths, query strings, userinfo and
anything that looks like a key are redacted before logging (`redactSecrets`).

## 7. Persistence

Tables (Drizzle, `src/adapters/persistence/schema/*.ts`; SQL in `drizzle/`): `region`, `incident`,
`hazard_geometry`, `exposure`, `infrastructure_node`, `gauge`, `prediction`, `public_report`, `alert`,
`audit_event`, `citation`, `sitrep`, `source_record`, `resource`, `resource_task`, `shelter`, `evac_route`,
`threshold_rule`, `app_user`, `supply_lot`, `volunteer_team`, `damage_assessment_entry`,
`ems_overlay_product`. Migrations are forward-only; `scripts/migrate.mjs` applies them; the CI integration
job asserts the table set and the latest columns. The incident COP itself is always derived in memory
per read; Postgres holds the durable records (reports, audit, provenance mirror, logistics, panels, rules).
Natural keys (`domain_id`) make the seed idempotent (`natural-keys.ts`). Retention: the scheduler runs the
Art. XIV purge (`RETENTION_SWEEP_*`).

## 8. Frontend

- `app/page.tsx` orchestrates: region, role, incident selection, the toolbar, the COP shell
  (`cop-layout.tsx`), the map (`MapView` → `map-engine.ts` MapLibre + deck.gl; `MapFeatureList` is the
  accessible fallback when WebGL is absent), the docks (SitRep, logistics, panels).
- State: Zustand (`store.ts`; auth slice mirrored to sessionStorage), TanStack Query (`query-client.ts`).
- i18n: next-intl without routing; locale cookie resolved server-side (`messages.server.ts`);
  `useT('namespace')` is compile-checked against `en.json`; times formatted in the region's tz.
- Tokens: `globals.css` (dark default, light theme, WCAG 7:1 body text, severity/status colours never the
  only signal). Tailwind utilities map to tokens.
- Security headers/CSP: `next.config.mjs` (`securityHeaders`, tested against the basemap ladder).
- PWA: `public/sw.js`, `app/_lib/pwa/*`, `app/_components/pwa/*` (ADR-047).
- Tests: component tests in happy-dom next to the component; contract tests against a real in-process
  server (`app/_lib/__testing__/real-server-fetch.ts`).

## 9. Security model (short)

JWT identity fail-closed to PUBLIC; RBAC in the command router (one gate for every channel); precise PII
geometry only to RESPONDER+; consent required at the type level (`PublicReportPort`); every AI/vision call
through the compliance proxy (firewall, PII screen, budget, gate token, audit chain); manual redirects and
host allow-lists on outbound HTTP (SSRF); CSP + HSTS; secrets only in env; gitleaks/OSV/npm audit in CI.
Threat model and residual risks: `docs/architecture/THREAT_MODEL.md`; baseline: `docs/SECURITY_BASELINE.md`.

## 10. Testing strategy and what each gate protects

| Gate | Protects |
|---|---|
| `tsc` strict + `exactOptionalPropertyTypes` | contracts (a missing field is a compile error) |
| ESLint (complexity ≤ 10, no `any`, domain purity) | readability, boundaries |
| dependency-cruiser + madge | hexagonal direction, no cycles |
| Vitest unit (≈5,300 tests) with floors (domain/application 99 %, main 97/79, adapters 90/83, app 89/86) | behaviour; **floors ratchet up only** |
| Snapshot tests (`src/main/__snapshots__`) | the composed registry per region (which adapter, which mode) |
| Architecture tests (`tests/architecture`) | D6 no-PII, served-mode vocabulary, enum pins, link policy, RTL CSS |
| Catalog parity (`tests/i18n`) | 14 locales × every key, ICU validity, honest `_meta` |
| `.env.example` tests | every documented value boots; every schema key documented |
| OpenAPI contract tests (`npm run docs`, `sw-policy.test.ts`, mode vocabulary) | the API document and the code agree |
| Playwright (5 zones × 4 devices; axe; perf TTTP < 10 s; visual baselines; offline) | the product in a browser |
| Integration (real Postgres) | migrations and the durable paths |
| Security lane (non-blocking) | advisories, secrets, lockfile CVEs (`osv-scanner.toml` records accepted dev-only items) |

Determinism rules: fixed clocks (`nowIso` injected), no live network in tests (fetch stubbed), recorded
fixtures, fresh server per Playwright run, serial browser workers.

## 11. Performance notes

- Composition cost is per region and per re-ingest (five regions ≈ 15–20 s on the cloud host, bounded by
  the slowest adapter's timeout); tune `LIVE_REGION_CONCURRENCY`, per-source `_TIMEOUT_MS`, and keep the
  Overpass ladder ≤ 3. The picture is served from memory between re-ingests (sub-second).
- Narration is synchronous on the read path with `AI_MODE=cloud` (30–90 s first call per fact set;
  memoised after) — behind a 60 s edge use `AI_MODE=off/local` or the async narration seam (ADR-038).
- The browser measures TTTP in `e2e/perf.spec.ts` (< 10 s budget, ≈ 1 s measured on the offline seed).
- Build assets are hashed and immutable; the PWA makes repeat loads local.

## 12. Questions a judge or reviewer will ask — and the file that answers

| Question | Answer / evidence |
|---|---|
| Does the AI ever produce a number? | No: `sitrep-synthesis` passes computed, cited facts; the F3 guard rejects numeric tokens in narration; AI-off equals AI-on numerically (tests in `src/application/sitrep-synthesis`) |
| What happens when a source is down? | The ladder: cached, then recorded mock, labelled; `[beacon] source degraded:` names it; the UI badge shows the mode (`redundancy.test.ts`, `tests/redundancy/`) |
| Can a report become a public alert automatically? | No: `alert` is DRAFT until `POST /alerts/{id}/approve` by VERIFIER+; `CAP_EMIT_MODE` draft-only; audit chain (`routes/queue.ts`, `audit-chain.ts`) |
| Where does precise location go? | Only to RESPONDER+ (`toReportItem(r, role)`); PUBLIC gets the generalised position; the PWA cache stores only anonymous answers |
| Is it really offline-capable? | `npm run dev` with no `.env`; the Playwright gates run with zero egress; `NEXT_PUBLIC_BASEMAP_MODE=offline`; `NEXT_PUBLIC_PWA=on` for the browser |
| How do you know the data is real? | `audit/DATA_SOURCE_VERIFICATION.md` per source; `docs/audit/LIVE_VERIFICATION.md`; `check:live` on the deployment; provenance on every envelope |
| How portable to a new region? | `config/regions.json` + adapters with `coverage`; Romania, Spain, Greece, the Philippines shipped that way; `tests/zones` |
| How is misinformation handled? | Social sources are corroboration-only and flagged, never merged (`Art. XIV`, `bluesky`/`mastodon` adapters, `sitrep-synthesis` grounding order) |
| What is not done? | `docs/SPEC.md` §13, `docs/audit/UNIMPLEMENTED_REGISTER.md` — read before claiming anything |
| What does it cost to run? | ≈ $0: free data, open-source stack, one container + Postgres; `GET /.well-known/sustainability` |

## 13. For a coding agent: the shortest paths

- "Source X is wrong on the map" → `src/adapters/sources/X/X-adapter.ts` (mapper) → `app/_lib/map-data.ts`
  → `app/_components/map/build-layers.ts`. Fixture in `__fixtures__/`; snapshot in `src/main/__snapshots__`.
- "Add a variable" → `src/config/index.ts` (schema) → `.env.example` (documented, or the test fails) →
  `docs/architecture/CONFIGURATION.md` row → (if `NEXT_PUBLIC_`) `infra/Dockerfile` ARG + compose args.
- "A route returns the wrong status" → `routing.ts` / `routes/feature-router.ts` → `error-mapping.ts`;
  the OpenAPI is the contract — change it in the same commit.
- "A text is wrong" → `messages/en.json` first; keys additive-only; all 14 catalogues; parity test.
- "Change a threshold / rule" → `threshold_rule` table (postgres) or `src/main/feature-seed.ts`
  (`DEFAULT_FEATURE_SEED`); evaluation in `src/application/threshold-evaluation`.
- "Something only happens on the live deploy" → `scripts/check-live.mjs` first, then the deploy log,
  then `railway ssh … env` to compare the store with the process.
- "Make it faster" → `LIVE_REGION_CONCURRENCY`, per-source timeouts, the Overpass ladder length,
  `AI_MODE`, the narration memo; measure with `perf.spec.ts` and `check:live` timings.
- Do not: rename public identifiers, lower a coverage floor, add a dependency without a decision, put a
  secret in a tracked file, or edit `.github/workflows/ci.yml` without the owner.

## 14. Glossary

COP common operating picture · TTTP time-to-trustworthy-picture · LKG last-known-good cache · CAP OASIS
Common Alerting Protocol 1.2 · EDXL-RM / SitRep OASIS resource-messaging and situation-report standards ·
HITL human in the loop · ACL anti-corruption layer · ADR architecture decision record · PWA progressive
web app · SSE server-sent events · EAP early-action protocol · GABBE the governed agentic SDLC kit the
project was built with (not part of the product).
