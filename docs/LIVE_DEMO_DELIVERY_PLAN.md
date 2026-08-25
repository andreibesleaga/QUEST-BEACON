> **Historical decision record.** Kept in the public repo because source comments trace locked decisions to this file. Process references to agent memory (`agents/`, RESUME_POINTER, AUDIT_LOG) describe the internal GABBE SDLC tooling, which is not part of this repository.

# BEACON — FINAL LIVE-DEMO DELIVERY PLAN (2026-08-07, v2 COMPRESSED) — THE PLAN OF RECORD

> Successor to `docs/FINAL_READINESS_PLAN.md` (fully executed 2026-08-06, see its §14).
> **v2 (same day): restructured on user order into 3 sessions + a short finalize session (3–4 max),
> aggressive sub-agent parallelization, simplified GABBE cadence, full testing batched at session
> gates. SCOPE IS UNCHANGED — every decided feature ships at full quality; only the process is
> compressed.** Executed by Opus/Sonnet or any agent; every session independently resumable.

---

## §0 LOCKED USER DECISIONS (2026-08-07 — verbatim authority; do NOT re-ask)

| # | Decision | Locked answer |
|---|---|---|
| 1 | Judge auth | **Named accounts via `AUTH_USERS` only** (no token-paste field) |
| 2 | Outlook panel | **ON** — `NEXT_PUBLIC_FEATURE_OUTLOOK_PANEL=on` for demo; baseline handled in S3 |
| 3 | Citizen live-view | **ON** for demo (`FEATURE_CITIZEN_STREAM` + `NEXT_PUBLIC_FEATURE_CITIZEN_STREAM`) |
| 4 | Repo scope | **Clean Phase3-only public repo** for judges (S3/S4) |
| 5 | Session persistence | **YES** — sessionStorage survive-reload for sign-in |
| 6 | Telegram target | **Use the EXISTING `TELEGRAM_ALERT_CHAT_IDS`** already in `.env` |
| 7 | RBAC matrix | **Confirmed as implemented** (PUBLIC/RESPONDER/VERIFIER/EM) — final |
| 8 | Open-Meteo | Free non-commercial tier OK for demo; **no self-host** |
| 9 | Threshold-rule defaults / priority weights | **Keep current config defaults** |
| 10 | Social source | **(a) AND (b)**: wire Bluesky AUTHED live mode (`BLUESKY_IDENTIFIER`/`BLUESKY_APP_PASSWORD` — BYO-account rung; user will NOT register) **and** add a **Mastodon keyless adapter** — Mastodon is the DEMO live social source |
| 11 | Vision imagery | **BOTH**: NASA GIBS (keyless, default) + Copernicus Data Space (free-account token, optional rung) |
| 12 | ReliefWeb | Appname never approved / doesn't work → **stays CACHED for demo + explicit judge note** in docs |
| 13 | Impossible-live sources | FloodHub = **MOCK + access instructions**; IPAWS = **documented FEMA-MOU gate**; GloFAS = **CACHED honestly** (upstream façade dead) |
| 14 | UNIMPLEMENTED_REGISTER | **Implement ALL proposed**: 5 GET routes, retention scheduler, forecast-rule seed, MapFeatureList×14, ShelterCapacityWidget, `FEATURE_EXTERNAL_VIEWS` wire, `CAPACITY_MATCH_DIRECTION` wire, all-clear in OpenAPI, full pg write paths (sitrep/citation/resource/resource_task/evac_route/shelter) |
| 15 | D4/D6 modules | **Mount 5**: shelter status, damage reports, EMS overlay, supplies, volunteer teams. **Keep 3 inert-but-registered**: rumor board, mutual aid, reunification links |
| 16 | Valhalla/OSRM | Stay **documented roadmap** (ORS live + heuristic ladder is enough) |
| 17 | Demo store | **`FEATURE_STORE=postgres`** in live demo (docker + Railway); memory stays the offline judge quickstart |
| 18 | Auto-report demo cron | **Confirmed** — env-gated automated Telegram MONITORING notification (labelled, non-CAP; Art. XIII preserved) |
| 19 | Always-live pair per region | **FIRMS (wildfire, global, key set) + GDACS (flood, global, keyless)** in every region's `enabled_adapters` |
| 20 | Cadence | **v2: aggressive batching — 3–4 sessions MAX**, specialized parallel sub-agents, simplified GABBE (see §1.8), full quality unchanged |

**Also binding (user directive):** persistence must work for Logistics; SitRep issues all fixed;
Routing must work; shelters editable via config or DB (UI not required); everything in
`config/planned-sources.md` that is possible → LIVE, else CACHED, else MOCK **with access
instructions**, else the source AND its claims are removed; ≥1 live social source worldwide; ALL
`VISION_*` settings wired and working with ≥1 real vision source; all FINAL_LIVE_TEST scenarios
runnable live (incl. vision, live cameras) with fallbacks; full new-docs/code sweep + cleanup; all
under GABBE.

---

## §1 STANDING CONSTRAINTS (violating any is a plan failure)

1. **NO git writes by agents** (commit/push/tag/add) — hand the user exact commands. Never touch `.git`.
2. `agents/AGENTS.md` + `agents/CONSTITUTION.md` **FROZEN**.
3. **`package.json` + lockfiles PROTECTED — ZERO new npm dependencies.** Everything below is
   implementable with `fetch`, drizzle-orm (prod dep), and existing libs. A "needed dep" = STOP + escalate.
4. Secrets only in gitignored `.env` / `infra/.env.docker`; never print values (mask on grep);
   never write a real key into a tracked file. `.env.example` documents names only.
5. Art. XII deterministic→AI→human (LLM/vision never emit figures; vision advisory+cited+confidence,
   never auto-alerts). Art. XIII HITL before public action. Art. XIV no-PII/aggregate-only; consent +
   PII-screen every image. Art. XVI degrade-labelled, never dead-end (every adapter: live→cached→mock
   ladder + breaker).
6. Deterministic gates: fixed clock `2026-07-05T22:00:00Z`, no live network in vitest/Playwright,
   never weaken an assertion, coverage floors never lowered, complexity <10 (fix by extraction),
   Gate 3 runs with `--coverage`.
7. **Playwright gate profile stays OFFLINE/pinned**: every NEW `NEXT_PUBLIC_*`/server flag that
   changes UI is pinned at its baseline value in `playwright.config.ts` `webServer.env` (build AND
   start — NEXT_PUBLIC_* inlines at build). Live demo flips flags in `.env` only; gates never move.
   Unavoidable baseline movers (MapFeatureList rows, mounted ShelterCapacityWidget, any default-
   visible panel change) batch into **ONE re-mint at S3 end, run by the USER** (classifier blocks
   agents from `--update-snapshots`; agent eyeballs + verdicts every diff first).
8. **GABBE — SIMPLIFIED CADENCE (user-approved v2, decision 20).** Per SESSION (not per wave):
   ONE batched EARS addendum at session start (`docs/requirements/EARS_ADDENDUM_LIVE_DEMO.md`,
   appended per session — golden thread preserved: each FR names its test file); lane agents write
   tests WITH implementation (red-first not enforced per-file), but **Art. I holds at the session
   gate: no shipped behavior without a test**; ONE AUDIT_LOG entry + RESUME_POINTER refresh + episodic
   snapshot per session end (plus the §13 pre-cutoff flush rule — always save before limit);
   **ONE consolidated ADR-037 "Live-Demo Delivery Increment" (ADR-034 was already taken by the anticipatory-action engine)** (sections: pg persistence + shared
   store contract; scheduler seam; social-source policy + AirQuality port; live vision ladder +
   imagery schemes; demo watcher) written in S1 as a stub and completed per session — replaces the
   four separate ADRs of v1. TASKS.md: one epic "E12 — Live-Demo Delivery" with a per-session
   checklist. Skills/personas: preflight + state-preserve only; skip per-task ceremony.
9. Adapter recipe (unchanged): 1 dir `src/adapters/sources/<id>/` (`<id>-acl.ts`, `<id>-adapter.ts`,
   `__fixtures__/` recorded-real fixture, `<id>-acl.test.ts`, `<id>-adapter.test.ts` — clone
   `firms/`) + 1 `config/adapters.json` row + 1 `ADAPTER_FACTORIES` entry
   (`src/main/adapter-registry.ts`) + `EnvSchema` `SOURCE_<ID>_MODE` + `.env.example` +
   CONFIGURATION.md §6 row + NOTICE attribution. Zero core change.
10. Free/open data only, compatible licenses, no ToS-scraping. New sources get a live-checked
    verdict row in `audit/DATA_SOURCE_VERIFICATION.md` BEFORE any live flip.
11. **Parallelization contract (what makes 3–4 sessions possible).** Sub-agents are SPECIALIZED and
    own DISJOINT files. SHARED single-owner files are touched ONLY by the orchestrator (main session),
    which applies lane-delivered patch specs serially: `src/config/index.ts` (EnvSchema),
    `src/main/adapter-registry.ts`, `config/adapters.json`, `src/main/build-core.ts`/`feature-seed.ts`,
    `app/page.tsx`, `playwright.config.ts`, `.env`/`.env.example`, `docs/api/openapi.yaml`,
    `messages/*.json` (one i18n agent owns all 14 catalogs per session). Lane agents run
    `npx vitest run <own files>` + `npx tsc --noEmit` before reporting; the FULL battery runs once
    per session end. A lane that would touch a shared file instead RETURNS the exact edit spec.

---

## §2 SESSION PLAN (3 sessions + short finalize; each ends ALL GATES GREEN: tsc · eslint · vitest --coverage · depcruise · build · Playwright-pinned)

### SESSION 1 — BACKEND COMPLETE (v1 waves W0+W1+W2+W6 merged)
**Precondition (W0.1):** user has run the resume-48 3-baseline re-mint + full Playwright green.
If not: hand the command, continue S1 anyway (S1 touches no visual baseline), re-check at S1 end.

**Orchestrator (serial, ~first hour):** EARS addendum §S1; ADR-034 stub; `.env`/`.env.example`
additions (§3 names); Playwright pins for ALL flags of S1–S3 at baseline values
(`NEXT_PUBLIC_FEATURE_OUTLOOK_PANEL/CITIZEN_STREAM/D4_SHELTER_STATUS/D4_DAMAGE_REPORTS/
D4_EMS_OVERLAY/D6_SUPPLIES/D6_VOLUNTEER_TEAMS: 'off'`, `DEMO_AUTO_REPORT: 'off'`, new
`SOURCE_*_MODE: 'mock'|'cached'`, `FEATURE_EXTERNAL_VIEWS: 'on'`); EnvSchema entries for every S1
var in ONE edit (persistence, scheduler, watcher, CAPACITY_MATCH_DIRECTION,
RETENTION_SWEEP_INTERVAL_SEC, DEMO_AUTO_REPORT×4, NEXT_PUBLIC_FEATURE_EXTERNAL_VIEWS).

**Then 3 parallel specialized lane agents:**
- **Lane P — Persistence** (owns `src/adapters/logistics/pg-logistics.ts` NEW,
  `src/adapters/persistence/*` additions, `config/shelters.json` + `schemas/shelters.schema.json`
  NEW, contract-test files): PgLogisticsStore implementing `ResourceLogisticsPort`
  (`src/ports/logistics.ts:29`) over drizzle `resource`/`resource_task`/`shelter` tables, semantics
  identical to `memory-logistics.ts`; **ONE shared contract suite run against BOTH stores** (clone
  memory-logistics.test.ts; pg side mocked-drizzle per read-models.test.ts pattern); wire the
  EXISTING citation upsert (repositories.ts:146) + new sitrep history write + evac_route persistence
  (write-on-accept; UI reads stay engine-computed — document the semantics); shelters editable via
  `config/shelters.json` (boot-validated) + `db:seed` refresh + direct UPDATE, documented in
  OPERATOR_GUIDE; honest 5xx for pg schema errors (42P01/42703 at `repository.ts:30-43`);
  CAPACITY_MATCH_DIRECTION read in the shelter-ranking objective (test both directions).
  Returns patch specs for: build-core.ts `resolveStore` (FEATURE_STORE=postgres selects pg
  logistics too), ci.yml (DATABASE_URL_TEST lane so read-models.test.ts:310 finally runs).
- **Lane R — Routes** (owns new route modules + their tests): the 5 planned GETs —
  `/incidents/{id}`, `/incidents/{id}/exposure` (reuse the map-envelope exposure slice),
  `/health/adapters` (reuse `GET /sources` internals: per-adapter mode+freshness+breaker),
  `/threshold-rules`, `/audit-events` (RESPONDER+, paginated, hash-chain fields). Envelope
  `{data, provenance[], freshness}`, RBAC per matrix, dispatcher tests (http-dispatcher.test.ts
  pattern). Returns patch specs for feature-router.ts route table + openapi.yaml (5 routes de-planned
  + `POST /alerts/{id}/all-clear` documented — it already works, feature-router.ts:606).
- **Lane S — Scheduler + demo watcher** (owns `src/main/scheduler.ts` NEW + retention wiring +
  `src/application/demo-watch/` NEW + tests): injectable-timer loop started ONLY from server
  composition (never under test/gate); retention-sweep.ts invoked per `RETENTION_SWEEP_INTERVAL_SEC`
  + AUDIT_EVENT per sweep; **demo watcher** — `DEMO_AUTO_REPORT=on`, `DEMO_AUTO_REPORT_REGION`,
  `DEMO_AUTO_REPORT_INTERVAL_SEC` (120), `DEMO_AUTO_REPORT_ONCE=on`: per tick, evaluate the region's
  live slices with the EXISTING threshold/severity logic (no new judgment code, Art. XII); on first
  critical wildfire/flood signal send ONE Telegram message via the EXISTING `makeNotifier`
  (PII-redact+firewall+hash-chained audit) to `TELEGRAM_ALERT_CHAT_IDS`, prefixed
  `⚠️ AUTOMATED MONITORING (not an approved public alert)` + region/signal/citation/freshness.
  NEVER emits CAP/EDXL, NEVER touches the alert store. Tests: fake timer + fake notifier —
  once-latch, label text, no-alert-store. Also: seed ONE threshold rule (config/threshold-rules
  seam) so a DRAFT alert fires in the demo, + test. Returns patch spec for composition root startup.
- **Lane X (background doc agent, runs during the above):** `FEATURE_EXTERNAL_VIEWS` build-mirror
  wiring spec + CONFIGURATION.md/OPERATOR_GUIDE sections for everything S1 ships.

**S1 close (orchestrator):** apply patch specs serially → FULL battery → fix → AUDIT_LOG +
RESUME_POINTER + snapshot → hand user commit commands.

### SESSION 2 — ALL SOURCES + VISION LIVE (v1 W3+W4 merged)
**Orchestrator first:** EnvSchema batch-edit #2 (all new `SOURCE_*_MODE`, `MASTODON_INSTANCE`/
`MASTODON_TAGS`, `BLUESKY_IDENTIFIER`/`BLUESKY_APP_PASSWORD` refinement, 7 `VISION_*` vars with
`cloud`⇒key refinement, `COPERNICUS_CLIENT_ID/SECRET`); EARS §S2.

**Parallel lanes (each owns ONLY its adapter dirs; registry/manifest/env stay with orchestrator):**
- **Lane A1 — Social:** `mastodon` (keyless LIVE default — public instance
  `GET /api/v1/timelines/tag/:tag`, configurable instance+tags, corroboration-only semantics
  identical to bluesky: authority-low, never auto-trusted, flag-not-merge, Art. XIV) + bluesky
  AUTHED rung (`com.atproto.server.createSession` → `app.bsky.feed.searchPosts` when creds set;
  fail-fast live-without-creds; MOCK default).
- **Lane A2 — Hazard/event adapters:** `eonet` (keyless LIVE), `cemsrm` (CACHED), `lanceflood`
  (CACHED→LIVE, EARTHDATA_TOKEN set), `openfema` (keyless LIVE-capable), `caphub` (CACHED→LIVE),
  `nri` (CACHED).
- **Lane A3 — Weather/pop/infra adapters:** `anm` (keyless LIVE), `metno` (LIVE, UA set),
  `hdxpop` (CACHED), `hifld` (CACHED), `outageproxy` (CACHED→LIVE, Cloudflare token set).
- **Lane A4 — AirQuality:** new `AirQualityPort` (P16) + `openaq` + `airnow` (keys set) +
  `sensorcommunity` (keyless); consumption = ONE deterministic cited SitRep fact on AQI threshold
  (small seam in derive-cop facts); map layer stays roadmap.
- **Lane V — Vision (one specialized agent):** OpenRouterVisionProvider
  (`src/adapters/ai/vision/openrouter-vision.ts`, implements the 4-line `VisionProvider` of
  mock-vision.ts:6-9; chat-completions + base64 image; classification-only prompt; numeric claims
  DISCARDED by validator — Art. XII); imagery fetchers `imagery/gibs.ts` (keyless WMTS snapshot,
  `imageRef gibs:<layer>:<bbox>:<date>`, DEFAULT) + `imagery/copernicus.ts` (CDSE OAuth,
  `cdse:<bbox>:<date>`, optional rung) + `fixture:` unchanged; ladder in build-vision.ts
  (`VISION_MODE=cloud`→OpenRouter, `local`→`VISION_API_BASE` Ollama-shape, off/fail→MockVision
  labelled); `VISION_MAX_IMAGE_MB` + `VISION_PII_SCREEN` enforced (satellite = no PII; SOS photo
  screen stays mandatory); verifier-queue "live imagery" trigger variant (server-truth mirrored,
  default-off/pinned); create real tiny `fixtures/vision/*.png`; injected-fetch tests only.
- **Lane D (background docs):** DATA_SOURCE_VERIFICATION rows for all new sources;
  planned-sources.md rewrite (only ipaws/floodhub remain, with access instructions); ReliefWeb
  CACHED judge note; NOTICE attributions; CONFIGURATION §5 vision-real + §6 rows.

> ## ✅ S2 CLOSED 2026-08-08 — all gates green, entrant to commit
>
> **Gates:** tsc 0 · eslint 0 · depcruise 0 violations (830 modules) · vitest **353 files / 4409 passed /
> 2 skipped** · Playwright **194 passed / 26 skipped / exit 0 — no baseline moved**.
>
> **Delivered:** adapters 30 → 41; vision live end-to-end (NASA GIBS → OpenRouter), Art. XII enforced
> structurally; `.env.example` / `NOTICE` / DSV / `planned-sources.md` / CONFIGURATION §6a all trued up.
>
> **Deviations from this plan's S2 text, each with its reason:**
> 1. **IODA/`outageproxy` dropped, not shipped** (entrant ruling, D-37) — no open-licence grant. Line 164
>    of this plan listed it as "CACHED→LIVE, Cloudflare token set"; that is now void. The adapter was
>    deleted, its env flags removed, and its claims scrubbed. Non-US outage is derived-only, stated openly.
> 2. **Zero of the four keyless LIVE flips happened.** The instruction below is "flip only what passes" —
>    all four were live-probed and none passed: `effis`'s endpoint is **dead** (301 → S3 `NoSuchKey` 404),
>    `worldpop` is an **async task API** (16.7 s → `taskid`), `usgs-water` is blocked by **our own** legacy
>    query params, `eagle-i`'s base is a dataset page, not an API. Evidence in DSV §0.
> 3. **`config/regions.json` got firms into all five zones (decision 19 satisfied — gdacs was already
>    there), but the 11 new adapters were NOT enabled.** Tried and reverted: `hifld` displaced the seeded
>    infrastructure and silently broke the derived "ASSUMED offline" outage marking. Enablement needs
>    per-slot precedence design and moves to session 3 (D-38). **41 registered ≠ 41 consumed; 28 consumed.**
> 4. **AirQuality trio built but unregistered** (F-52 — no consumer until session 3), as planned.
>
> **Bonus fix (not in plan):** three hand-maintained manifest mirrors that force sources MOCK in offline
> tests now DERIVE from `loadManifest()`. One (`http-dispatcher.test.ts`) had never been updated for S2 and
> two had silently missed the July B3 aggregators — invisible rot, because a missing row only bites when
> that adapter defaults LIVE. `adapter-registry.test.ts` keeps its hardcoded list deliberately: it is the
> inventory pin.

**S2 close (orchestrator):** registry+manifest+`.env.example` integration in one pass;
`config/regions.json`: firms+gdacs into ALL five zones; mode truth-up + riskier keyless flips
(usgs-water OGC, effis, worldpop, eagle-i) — live-verify each off-gate with real curl, flip only
what passes; **off-gate live proofs**: one real GIBS+OpenRouter vision round-trip + mastodon live
fetch + live-probe provenance for every flipped source → evidence into LIVE_STATUS_SOURCE_OF_TRUTH.
FULL battery → AUDIT_LOG/RESUME_POINTER/snapshot → user commits.

### SESSION 3 — UI COMPLETE + DOCS + BATTERY (v1 W5+W7+W8.1-2 merged)
**Parallel lanes:**
- **Lane U1 — Logistics-dock panels:** supplies, volunteer teams, shelter status (modules exist:
  `src/application/aggregate/supplies.ts`/`volunteer-team.ts`, `coordination/shelter-status.ts`) —
  panels behind their EXISTING `NEXT_PUBLIC_FEATURE_D4_*`/`D6_*` + server flags; envelope-fed,
  provenance-labelled, role-gated; tests per panel (verifier-queue.test.tsx pattern).
- **Lane U2 — SitRep-dock panels:** damage reports (`coordination/damage-assessment.ts`), EMS
  overlay (`coordination/ems-overlay.ts`) — same recipe. Rumor board/mutual aid/reunification stay
  inert-registered.
- **Lane U3 — Map/UI completion:** MapFeatureList rows for all 14 LAYER_IDS (storm, floodzone,
  outage, cell, weather, cameras, prediction, route added); ShelterCapacityWidget mounted
  (`shelters` prop into LogisticsBoard at app/page.tsx:379 — patch spec); sessionStorage session
  persistence (auth store rehydrate; NOT localStorage; one non-visual Playwright reload spec).
- **Lane I — i18n:** ALL new keys × 14 catalogs (single owner, node-script edits).
- **Lane W — Docs/cleanup sweep (background Explore agents → fixes):** UNIMPLEMENTED_REGISTER
  refresh (implemented rows → "implemented <date>, <path>"; honest remainder: 3 inert D4/D6,
  likelihood-word i18n guard, Valhalla/OSRM roadmap, ipaws/floodhub); README/SUMMARY/OPERATOR_GUIDE/
  FINAL_LIVE_TEST_AND_DEMO (new scenarios: vision live, mastodon, postgres persistence, auto-Telegram
  beat; per-scenario FALLBACK: vision GIBS→fixture, mastodon→cached, ORS→heuristic,
  cloud-AI→deterministic-only);
  **grep-the-READER sweep** over everything S1–S3 declared (the recurring defect class) + orphan
  keys/dead exports/stale claims — fix all; judge-repo MANIFEST (in/out file list) for the
  Phase3-only public repo (USER executes all git/GitHub steps).
- **SitRep issue sweep (orchestrator):** re-verify full SitRep chain post-S1/S2 (every field cited,
  EN chips, deterministic-only rung, outlook renders, persisted history row, new-source facts
  cited); fix residuals.

**S3 close:** demo env files set (outlook+citizen-stream+vision+watcher ON in `.env` +
`infra/.env.docker` regenerated + Railway vars doc; gates stay pinned) → FULL battery → **eyeball
every visual diff, write verdicts → hand USER the single batched `--update-snapshots` command →
user re-runs full Playwright green** → AUDIT_LOG/RESUME_POINTER/snapshot → user commits.

### SESSION 4 (SHORT, user present) — LIVE DRY-RUN + SUBMIT-READY
Live dry-run of EVERY FINAL_LIVE_TEST scenario on the demo profile (`npm run docker:up`,
FEATURE_STORE=postgres, DATA_SOURCE_COMPOSITION=adapters, AI cloud, vision cloud, telegram live,
watcher on): all regions, **US first with ALL capabilities**; every fallback REHEARSED, not
assumed; evidence (screenshots + provenance JSON) → LIVE_STATUS_SOURCE_OF_TRUTH + FINAL_LIVE_AUDIT
refresh; rubric matrix final refresh; Railway deploy check (pre-deploy `node scripts/migrate.mjs`);
judge-repo creation (user runs git); final memory + commit commands. Buffer for any S1–S3 spillover.

---

## §3 ENV / KEYS TABLE (user actions marked 👤; all free tiers)

| Var | Status | Action |
|---|---|---|
| FIRMS, ORS, OPENCELLID, CENSUS, GLOFAS_CDS, EARTHDATA_TOKEN, METNO_USER_AGENT, WINDY_WEBCAMS, DOT511, OPENROUTER, GROQ, TELEGRAM_BOT_TOKEN, TELEGRAM_ALERT_CHAT_IDS | **already set in `.env`** | none |
| ⚠️ `OPENAQ_API_KEY`, `AIRNOW_API_KEY`, `CLOUDFLARE_RADAR_TOKEN` | **EMPTY — this table wrongly listed them as set** (corrected 2026-08-08 by direct inspection, after two lanes had already been briefed on the wrong information) | Sources that need them ship CACHED and flip to LIVE the moment a key is set. 👤 optional free signups: openaq.org, docs.airnowapi.org, Cloudflare Radar. **AirNow needs no key** in the end — Lane A4 used the keyless `files.airnowtech.org` file product instead of the keyed web service |
| RELIEFWEB_APPNAME | set, upstream never approved | keep `SOURCE_RELIEFWEB_MODE=cached` + judge note (decision 12) |
| `MASTODON_INSTANCE` / `MASTODON_TAGS` | new, no key | agent adds defaults (mastodon.social; wildfire,flood) |
| `BLUESKY_IDENTIFIER` / `BLUESKY_APP_PASSWORD` | new, optional | BYO-account rung; user will NOT register — MOCK default |
| `COPERNICUS_CLIENT_ID` / `COPERNICUS_CLIENT_SECRET` | new | 👤 free account at dataspace.copernicus.eu → OAuth creds (optional rung; GIBS works without it) |
| 7 `VISION_*` vars | wired S2 | agent sets demo values (reuses OpenRouter key — no new key) |
| `DEMO_AUTO_REPORT` ×4, `RETENTION_SWEEP_INTERVAL_SEC`, `CAPACITY_MATCH_DIRECTION`, `NEXT_PUBLIC_FEATURE_EXTERNAL_VIEWS` | new, wired S1 | agent; user flips `DEMO_AUTO_REPORT=on` before filming |

## §4 VERIFICATION (batched, uncompromised)
Per session end: full battery (tsc · eslint · vitest --coverage floors · depcruise · build ·
Playwright pinned) + session-specific proof — S1: shared store contract green on BOTH stores +
DATABASE_URL_TEST CI lane + watcher once-latch/label/no-alert-store tests; S2: off-gate live
evidence (vision GIBS+OpenRouter round-trip, mastodon fetch, per-flip live-probe provenance);
S3: axe + i18n×14 on new panels + eyeballed-diff report + user re-mint green; S4: full live
dry-run evidence per scenario incl. fallbacks. Nothing claimed in docs without its executable
check named beside it.

## §5 RESUMABILITY
Each session ends: TASKS.md epic checklist, ONE AUDIT_LOG entry, RESUME_POINTER "next action",
episodic snapshot; pre-cutoff flush at any limit warning. A fresh agent resumes from
RESUME_POINTER + this file alone. THE USER RUNS ALL GIT COMMITS between sessions (hand exact
conventional-commit commands).
