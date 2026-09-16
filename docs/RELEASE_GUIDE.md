# BEACON — Release & Deployment Guide (developers, deployers, release managers)

> The one page that says how a release is cut, what a live deployment must have set, what every
> supported variable does, and how a deployment is verified and switched. It points at the reference
> documents rather than duplicating them: `docs/architecture/CONFIGURATION.md` (every variable, in
> depth), `.env.example` (every variable, with an example), `docs/DEPLOYMENT.md` (every target),
> `docs/CLOUD_DEPLOY_RAILWAY.md` (the reference cloud), `docs/LIVE_PRODUCTION_GUIDE.md` (all sources live).

## 1. Postures

| Posture | What runs | Set |
|---|---|---|
| **Air-gapped / demo** (default) | Deterministic seed, every source MOCK/CACHED, AI off, in-memory store | nothing — `npm run dev` or `docker compose -f infra/docker-compose.yml up -d --build` |
| **Live, local** | Live adapters, Postgres, optional AI | `.env` from `.env.example`; `npm run docker:up` renders it for compose |
| **Live, cloud** (reference: Railway) | Same image, platform Postgres, named-account sign-in, live posture chip | the variables in §3 |

`NEXT_PUBLIC_*` variables are **inlined at build time**: they must reach the build (Docker `--build-arg`
via `infra/Dockerfile` `ARG`s, or the platform's build variables) and changing one needs a rebuild.
Everything else is read at process start; a variable change needs a restart/redeploy.

## 2. Cutting a release

1. **Green gates on the commit** (the same ones CI runs):
   ```bash
   npm run typecheck && npm run lint && npm run boundaries && npm run format:check
   npm run test:coverage            # floors in vitest.config.ts — never lowered
   npm run build && npx playwright test
   npm audit --audit-level=high && npm run docs
   ```
2. **Docs truth.** Re-produce every figure quoted in `README.md` § Gates and `JUDGE_MATRIX.md` §1 on the
   release commit (test count, coverage, module count, OpenAPI counts). A stale figure is a defect.
3. **Changelog + tag.** Add the entry to `CHANGELOG.md`; tag `vX.Y.Z` (the contest submission is
   `v1.0.0-submission`, immutable).
4. **Deploy** (§4), **verify** (§5), then announce.

The release workflow (`.github/workflows/release.yml`) builds the SBOM and signs the image on a tag; the
CI workflow (`ci.yml`) is the PR gate: static, unit+coverage, build, integration (real Postgres), browser
(Playwright), security (npm audit, gitleaks, OSV — non-blocking lane).

## 3. What a live deployment must set

The minimum for the live posture, in the order they matter (each line exists because its absence produced
a specific failure once):

| Variable | Live value | Why |
|---|---|---|
| `DATA_SOURCE_COMPOSITION` | `adapters` | Default `seed` consults **no adapter** whatever its mode says |
| `LIVE_REINGEST_INTERVAL_SEC` | `300` | Default `0` assembles the picture once at boot and never again |
| `FEATURE_STORE` | `postgres` | Reports, audit, regions, sources, logistics, panels become durable |
| `DATABASE_URL` | the platform's Postgres URL | The placeholder default is rejected under `postgres` |
| `DEPLOY_MODE` | `cloud` | Hard-offs the dev header/dev-login seams; anonymous = PUBLIC |
| `AUTH_SECRET` | a long random secret | Signs the session JWT; required in cloud |
| `AUTH_USERS` | the named accounts (id, scrypt hash, role) | The only sign-in in cloud; mint with `npm run auth:mint-tokens` / see `CLOUD_DEPLOY_RAILWAY.md` §1 |
| `NEXT_PUBLIC_AUTH_TOKEN_LOGIN` | `on` (build-time) | Shows the sign-in control |
| `NEXT_PUBLIC_DEPLOY_POSTURE` | `live` (build-time) | Green LIVE chip; hides the dev role switcher |
| `NEXT_PUBLIC_PWA` | `on` (build-time) if you want the installable/offline COP | Default off; ADR-047 |
| `SOURCE_<PREFIX>_MODE` | `live` for every source you want live | `cached` on a platform whose cache is in-memory means MOCK after every restart (the cache is written only by a live fetch) |
| `NWS_USER_AGENT`, `METNO_USER_AGENT` | a real contact address | met.no refuses the placeholder; NWS may |
| `SOURCE_GLOFAS_POINTS` | reporting points inside your regions (`lon,lat;lon,lat`) | GloFAS LIVE with no point inside a region enters at CACHED and says so in the log |
| `SOURCE_OSM_OVERPASS_MIRRORS` | `https://overpass-api.de/api/interpreter,https://lz4.overpass-api.de/api/interpreter` (+ a third if your host cannot reach them) | The default single endpoint is the busiest one; the ladder is tried in order inside one breaker |
| `SOURCE_OSM_OVERPASS_USER_AGENT` | your contact string | The public instances answer 406 to an anonymous client |
| `FEATURE_ROUTING` + `ORS_API_KEY` | `ors` + a free key | Road routing; otherwise the labelled heuristic |
| `AI_MODE` + `LLM_TIER_DEFAULT_*` | `cloud` + model/base/key | Narration; `off` keeps the deterministic facts only |
| `LIVE_PICTURE` | `auto` (live-only) or `hybrid` | §6 — the demo switch |
| `LOG_LEVEL` | `info` once stable (`debug` prints every degraded-source line per cycle) | |

**Pre-deploy command** (platform setting): `node scripts/migrate.mjs && node scripts/seed.mjs`. The app
also seeds itself when it finds the database unseeded (ADR-046), so the command is the belt to that brace.

**Never on a cloud deployment:** `AUTH_DEV_TRUST_HEADER`, `AUTH_DEV_LOGIN`, `NEXT_PUBLIC_AUTH_DEV_LOGIN`.
The code hard-offs them under `DEPLOY_MODE=cloud` / `NODE_ENV=production`, but do not set them at all.

**Secrets live only in the platform's variable store (or a local `.env`, gitignored).** Never in a
tracked file, never in a log, never pasted into a chat. Rotate on any exposure.

## 4. Deploy

- **Railway (reference):** `docs/CLOUD_DEPLOY_RAILWAY.md` §2 (steps) and §5 (every variable in order).
  Auto-deploy is off by design; `npm run demo:on` redeploys the latest build, `npm run demo:off` removes
  the deployment, `npm run demo:status` asks the URL (runbook: `docs/ops/DEMO_SWITCH.md`; implementation:
  `scripts/demo.mjs`). Point the CLI at the
  right service first (`railway status`) — being linked to the database service is a mistake this
  project has already made.
- **Any Docker host:** `docs/DEPLOYMENT.md` §2. **Kubernetes:** `infra/k8s/` (kustomize; migration Job,
  HPA). **Other clouds:** `docs/DEPLOYMENT.md` §5.

## 5. Verify a deployment (two minutes)

```bash
npm run check:live -- --region us-ca            # anonymous: posture, page, API, sources, freshness, seed, outline
npm run check:live -- --region ro --user <id> --pass <pw>   # signed-in: SitRep, resources, route, queue, report
railway logs --service Quest-BEACON | grep 'source degraded'  # one line per source that fell a rung, with why
curl -sI https://<host>/ | grep -iE 'content-security|strict-transport'
```

Read the deploy log for `[beacon] seeded …` (or `seed failed: …`), `[beacon] boot warm-up complete`,
and `[beacon] source degraded: <id> LIVE->CACHED — <reason>`. The reason names the rung it wanted, the
rung it got and why, with credentials redacted. A GloFAS line saying *no SOURCE_GLOFAS_POINTS reporting
point lies inside region 'x'* is a configuration statement, not an outage.

**The store-vs-process check.** A variable change on a platform is not always applied to the process
that is serving traffic. If `/api/v1/sources` reports a source in a mode the variable store does not say,
compare inside the container: `railway ssh --service Quest-BEACON -- sh -c 'env | grep ^SOURCE_GLOFAS_MODE='`.
If they differ, the change is staged and not deployed: redeploy.

## 6. The demo switch (`LIVE_PICTURE`)

- `auto` (default) = **live-only**: only incidents discovered from live hazards are drawn; a region with
  no live fire or flood shows no incident and says so. This is the production posture.
- `hybrid` = the **seeded demo scenario** is drawn beside whatever live sources serve, each item carrying
  its own provenance (the demo incident is labelled as the seed / MOCK). Use it to show the workflow when
  nothing is burning.
- Both are read at process start: set the variable, **redeploy**, verify with `check:live` (it prints the
  posture line first). Switch back to `auto` and redeploy to return to live-only. The
  `NEXT_PUBLIC_DEPLOY_POSTURE=live` chip is unaffected (build-time).

## 7. Every supported variable (catalogue)

Every variable the app reads is declared in `src/config/index.ts` (`EnvSchema`, validated fail-fast at
boot) or resolved per adapter from the `SOURCE_<PREFIX>_*` family; **every one of them appears in
`.env.example` with an example value**, and `src/config/env-example.test.ts` fails the build if the
example file and the schema disagree. This table is the map; the reference text is
`docs/architecture/CONFIGURATION.md` (section numbers below).

| Group (CONFIGURATION §) | Variables | Notes |
|---|---|---|
| Runtime / deploy (§1) | `NODE_ENV` `DEPLOY_MODE` `APP_PORT` `APP_BASE_URL` `LOG_LEVEL` `BEACON_WARMUP_DELAY_MS` `OTEL_EXPORTER_OTLP_ENDPOINT` `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` | `DEPLOY_MODE=cloud` hard-offs dev seams |
| Persistence (§2) | `DATABASE_URL` `DATABASE_URL_DEV` `FEATURE_STORE` `FEATURE_SPATIAL` `FEATURE_CACHE` `REDIS_URL` | `postgres` needs a real URL |
| Workers / realtime (§3) | `FEATURE_QUEUE` `FEATURE_EVENTBUS` `FEATURE_REALTIME` `INGEST_DEFAULT_INTERVAL_SEC` `SSE_DEBOUNCE_MS` `SSE_HEARTBEAT_SEC` `LIVE_REINGEST_INTERVAL_SEC` `LIVE_REGION_CONCURRENCY` `RETENTION_SWEEP_ENABLED` `RETENTION_SWEEP_INTERVAL_SEC` | re-ingest ≥ 60 s |
| Live picture (§6) | `DATA_SOURCE_COMPOSITION` `LIVE_PICTURE` `BEACON_DEBUG_LIVE` (diagnostic) | §6 above |
| AI text (§4, §4a) | `AI_MODE` `LLM_TIER_DEFAULT_MODEL/BASE/KEY` (+ the ladder tiers) `COMPLIANCE_PROXY_ENABLED` `COMPLIANCE_POLICIES_PATH` + budget knobs | every call goes through the compliance proxy |
| Vision (§5) | `FEATURE_VISION` `VISION_MODE` `VISION_MAX_IMAGE_MB` `VISION_PII_SCREEN` `NEXT_PUBLIC_FEATURE_VISION` `NEXT_PUBLIC_FEATURE_VISION_LIVE` | advisory only |
| Sources (§6, §6a–6f) | `SOURCE_<PREFIX>_MODE` for all 45 adapters, `SOURCE_<PREFIX>_URL/TIMEOUT_MS/INTERVAL_SEC`, keys (`FIRMS_MAP_KEY` `AIRNOW_API_KEY` `OPENCELLID_API_KEY` `CENSUS_API_KEY` …), `NWS_USER_AGENT` `METNO_USER_AGENT`, `SOURCE_GLOFAS_POINTS/LAYER`, `SOURCE_NWS_STATION`, `SOURCE_OSM_OVERPASS_MIRRORS/USER_AGENT`, `SOURCE_OPENCELLID_MAX_TILES/DAILY_BUDGET`, `SOURCE_DOT511_URL`, `BLUESKY_IDENTIFIER/APP_PASSWORD/SERVICE_URL` | a LIVE adapter missing its key is excluded from the registry and logged |
| Routing (§7) | `FEATURE_ROUTING` `ORS_API_KEY` | heuristic fallback is labelled |
| Alerting / interop (§8) | `CAP_EMIT_MODE` `CAP_PROFILE` `REQUIRE_HUMAN_ABOVE_THRESHOLD` | draft-only by law |
| Regions / locales (§9) | `REGIONS_CONFIG` `DEFAULT_REGION_ID` (locales: `config/locales.json`) | registry files under `config/` |
| Security / auth (§10) | `AUTH_SECRET` `AUTH_MODE` `AUTH_USERS` `AUTH_DEV_LOGIN` `AUTH_DEV_TRUST_HEADER` `DB_ADMIN_URL` `NEXT_PUBLIC_AUTH_TOKEN_LOGIN` `NEXT_PUBLIC_AUTH_DEV_LOGIN` `NEXT_PUBLIC_DEPLOY_POSTURE` `NEXT_PUBLIC_PWA` `NEXT_PUBLIC_BASEMAP_MODE` `NEXT_PUBLIC_BASEMAP_TILE_URL` `NEXT_PUBLIC_BASEMAP_ATTRIBUTION` | build-time ones need a rebuild |
| Operator panels D4/D6 (§3a) | `FEATURE_D4_*` `FEATURE_D6_*` and their `NEXT_PUBLIC_` mirrors | mirror must equal server flag (validated) |
| Anticipatory / outlook (§3b) | `FEATURE_ANTICIPATORY_PANEL` `NEXT_PUBLIC_FEATURE_ANTICIPATORY_PANEL` `NEXT_PUBLIC_FEATURE_OUTLOOK_PANEL` + EAP knobs | |
| Live views / channels (§6b, §6c) | `FEATURE_CAMERAS` `FEATURE_EXTERNAL_VIEWS` `NEXT_PUBLIC_FEATURE_EXTERNAL_VIEWS` `FEATURE_CITIZEN_STREAM` `NEXT_PUBLIC_FEATURE_CITIZEN_STREAM` `CHANNEL_TELEGRAM_MODE` `TELEGRAM_BOT_TOKEN` `CHANNEL_WHATSAPP_MODE` `CHANNEL_CLI_ENABLED` | Telegram live means real humans |
| Drill / demo (§3b, §6e) | `DRILL_MODE` `NEXT_PUBLIC_DRILL_MODE` `DEMO_AUTO_REPORT*` | never on a judged live deployment |
| Sustainability (§5a) | the `SUSTAINABILITY_*` disclosure fields | `GET /.well-known/sustainability` |
| Script-only | `CHECK_LIVE_USER/PASS`, `RAILWAY_SERVICE`, `BEACON_BASE_URL`, `TOKEN_TTL`, `PROBE_ROLE`, `DATABASE_URL_TEST`, `BEACON_PG_INTEGRATION`, `OLLAMA_LIVE/MODEL` | read by scripts/tests, never by the app |

## 8. Rotation and incident response

- Rotate `AUTH_SECRET` and every `AUTH_USERS` password on any suspicion of exposure; sessions are
  per-tab and expire with the token.
- Rotate a provider key (`FIRMS_MAP_KEY`, `ORS_API_KEY`, LLM keys) at the provider, then in the store,
  then redeploy. The degradation log tells you which source lost its key (`CONFIG` / excluded from
  registry).
- Vulnerability disclosure: `SECURITY.md`. Threat model: `docs/architecture/THREAT_MODEL.md`.

## 9. Rollback

Railway keeps previous deployments: redeploy the last good one from the dashboard, or `git revert` on
main and redeploy. Migrations are forward-only and additive; a rollback of the app never needs a schema
rollback. The seed is idempotent, so re-running it after a rollback is harmless.
