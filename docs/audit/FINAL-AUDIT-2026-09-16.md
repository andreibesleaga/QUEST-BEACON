# BEACON — Final audit of code and documentation (2026-09-16)

> **What this is.** The closing audit of the delivered product: an inventory of what is implemented and
> supported (§4), the method by which every documented claim was checked against the code (§2), every
> wrong or stale statement that was found and how it was corrected (§3), and what is honestly not
> done (§5). It was produced on the final commit of `main` after the last two merges (#39 final batch,
> #40 live hotfix) and before the product tree was exported to the judge repository. Everything here
> is reproducible from the repository; nothing is quoted from memory.

## 1. Verdict

The product is complete, gated and consistent with its documentation after this pass. Before it, the
current-truth documents disagreed with the code in **more than forty places** — all counts and status statements,
none a functional defect — and the AI-agent entry file (`llms.txt`) described a tree two months old.
All were corrected in the same commit as this audit. No claim of a working capability was found to be
false; the errors ran in both directions (stale under-claims such as "44 adapters" and "forecast
evidence not served", and three over-claims: SAST/DAST "in CI", a `FEATURE_TTS` variable, and "two
dock panels fixture-fed" where all five have a database rung). One code follow-up from the live
hotfix was closed (§3.3).

Gates on the final commit (machine-produced): tsc 0 · eslint 0 · dependency-cruiser 0 violations /
911 modules · madge 0 cycles · Prettier clean · vitest **5,378 passed / 6 skipped**, every coverage
floor met · `npm run docs` 7/7 · `next build` OK · Playwright 214 / 26 skipped / 0 failed (CI) · npm
audit 0 high / 0 critical.

## 2. Method

1. **Mechanical sweep** over every Markdown file, `llms.txt` and `.env.example` of the exported tree:
   every relative link and every back-ticked repository path checked for existence; every
   environment-variable name mentioned in prose checked against `src/config/index.ts` and the adapter
   `resolveSourceConfig` families and `.env.example`; every `npm run <script>` checked against
   `package.json`; every `ADR-NNN` reference checked against `docs/architecture/decisions/`; every
   `/api/v1/...` path checked against `docs/api/openapi.yaml`. False positives (URL hosts, package
   names, model ids, template strings, historical records) were discarded by hand; the rest is §3.
2. **Machine counts** re-derived from the tree and compared with every document that states them:
   adapters (`config/adapters.json` ↔ `ADAPTER_FACTORIES`), consumed adapters (union of
   `enabled_adapters`), live-capability classes (`docs/LIVE_PRODUCTION_GUIDE.md` §1 evidence), map
   layers (`LAYER_IDS`), zones, locales, ADR files, OpenAPI paths/operations/schemas, migrated tables
   (`drizzle/`), test counts, module counts (`depcruise src app`), visual baselines, CI jobs.
3. **Manual read** of every current-truth document — `README.md`, `JUDGE_MATRIX.md`, `llms.txt`,
   `docs/FINAL_HANDOFF.md`, `LIVE_STATUS_SOURCE_OF_TRUTH.md`, `QUICK_GUIDE.md`, `USER_GUIDE.md`,
   `OPERATOR_GUIDE.md`, `RELEASE_GUIDE.md`, `DEPLOYMENT.md`, `CLOUD_DEPLOY_RAILWAY.md`,
   `LIVE_PRODUCTION_GUIDE.md`, `DEVELOPER_HANDBOOK.md`, `SUMMARY.md`, `SECURITY_BASELINE.md`,
   `architecture/CONFIGURATION.md`, `audit/UNIMPLEMENTED_REGISTER.md`, `SPEC.md` §13 — checking each
   factual statement against the code path that executes it.
4. **Classification rule.** Current-truth documents are corrected in place. Dated records (ADRs,
   dated audits, plans, the spec delta, the EARS requirements, task ledgers) are preserved as written
   and receive a dated *as-built* note only where a statement would mislead a reader about the running
   product.

## 3. Findings and corrections

### 3.1 Counts and figures (stale, corrected)

| Claim as found | Where | Truth (final commit) | Action |
|---|---|---|---|
| 44 adapters, 44↔44 registry, "35 of 44 can serve live", "other nine" | `JUDGE_MATRIX.md` (six places), `docs/OPERATOR_GUIDE.md`, `docs/LIVE_PRODUCTION_GUIDE.md` header, `NOTICE`, `docs/SUMMARY.md`, `docs/FINAL_LIVE_TEST_AND_DEMO.md`, `audit/DATA_SOURCE_VERIFICATION.md` §0, `docs/architecture/CONFIGURATION.md` | **45 registered / 41 consumed / 4 not**; `shelters-fema` joined 2026-09-11; **38 can serve live** (29 keyless + 9 free-credential), seven cannot on free public routes | corrected; dated recount notes added to the two catalogues |
| "26 keyless" | `README.md`, `docs/FINAL_HANDOFF.md`, `JUDGE_MATRIX.md`, `docs/LIVE_PRODUCTION_GUIDE.md` | **29** (class A: 28 listed on 2026-09-10 + `shelters-fema`) | corrected; `shelters-fema` added to class A with a footnote |
| "all 30 wired sources listed" in NOTICE | `README.md`; `NOTICE` header said 44 and listed 44 ids | 45; `shelters-fema` was attributed (FEMA ESF#6 row) but missing from the id list and count | corrected |
| "48 ADR records" / "38 ADRs" / "39 ADR records" | `JUDGE_MATRIX.md` (two places), `docs/FINAL_HANDOFF.md`, `docs/SUMMARY.md` | **49 files** (001–047 + 008a; two files share the 036 number) | corrected |
| "844+ modules" | `JUDGE_MATRIX.md` (two places) | 911 (`depcruise src app`) | corrected |
| "5,373 tests" | README, JUDGE_MATRIX, FINAL_HANDOFF | 5,378 after the hotfix and outlet-licence tests | corrected |
| "visual baselines ×13" | `JUDGE_MATRIX.md` | 8 baseline files (`e2e/*-snapshots`) | corrected |
| "19-table assertion", "creates all 19 tables", "19-table schema" | `JUDGE_MATRIX.md`, `docs/LIVE_PRODUCTION_GUIDE.md`, `llms.txt` | 23 migrated tables, every one asserted by the CI integration job | corrected |
| OpenAPI "65 schemas"; vitest "4,536"; "39 ADR" in the *latest-run* block | `docs/SUMMARY.md` | 66 schemas · 5,378 · 49 | block rewritten with the final figures |
| `llms.txt` entirely (30 adapters, 27 dirs, 13 layers, 3,773 tests, 570 modules, 37 ADRs, a 2026-07-31 status, contest-portal mechanics, links to private memory files) | `llms.txt` | the final product | rewritten in full |

### 3.2 Status statements (wrong direction or overstated, corrected)

| Claim as found | Where | Truth | Action |
|---|---|---|---|
| "Two dock panels are fixture-fed MOCK — shelter status and EMS overlay" | `README.md`, `docs/FINAL_HANDOFF.md`, `docs/OPERATOR_GUIDE.md`, `JUDGE_MATRIX.md` §9 | All five panels resolve the same rung (`routes/panels.ts` `resolveRung`): the operator store under `FEATURE_STORE=postgres` (`DB`) or the recorded fixture (`MOCK`, with the reason on the wire). The seed provides supplies, volunteer teams, damage reports and the shelter roster; the EMS overlay has no seed rows on the merits | reworded everywhere |
| "Forecast evidence (lead time, likelihood) is computed but not yet served"; "`evac_route` and `sitrep`/`citation` stores not yet wired" | `JUDGE_MATRIX.md` §9 | Served (`likelihoodClass`, `forecast` in `openapi.yaml`); stores composed since ADR-039 (2026-09-10) | removed; §9 rewritten to the current list |
| "security (gitleaks, CodeQL, OSV, npm audit)" in the CI row; "Semgrep/CodeQL SAST · DAST (ZAP) in CI"; "CodeQL … PR-blocking" | `JUDGE_MATRIX.md` §6, `docs/SECURITY_BASELINE.md` §5–6, `docs/LIBRARIES.md` | `ci.yml` security lane = npm audit + gitleaks + OSV, **non-blocking**; no SAST/DAST job exists (`SECURITY.md` already said so) | corrected |
| "No shelter source adapter … FEMA Open-Shelters never wired" | `docs/SPEC.md` §13.2 | `shelters-fema` wired 2026-09-11 — but **US-only**: California's directory is live, the other four zones are still seeded fixtures | bullet rewritten to the partial closure (a dated note under the old text was not enough — the stale present tense stayed readable) |
| CI "pinned GitHub Actions" | `docs/SECURITY_BASELINE.md` §5 | Major-version tags as an interim measure; full SHA pinning is open (`.github/PINNING_CHECKLIST.md`) | qualified |
| `SOURCE_<PREFIX>_INTERVAL_SEC` presented as a working per-source cadence knob | `.env.example` (pattern block + the `shelters-fema` entry), `docs/LIVE_PRODUCTION_GUIDE.md` (footnote ² and the cadence block of the all-live profile), `docs/SPEC.md` §4.4 | Parsed by `resolveSourceConfig`, consumed by nothing; the live cadence is the global `LIVE_REINGEST_INTERVAL_SEC` | registered in `UNIMPLEMENTED_REGISTER.md`; every one of those places qualified. SPEC §4.4 also named the prefix `SOURCE_OVERPASS_*`, which is not the manifest prefix (`osm-overpass`) — corrected |
| `FEATURE_TTS`, `FEATURE_ANTICIPATORY`, `FEATURE_PREDICTION_IMPACT` presented as configuration | `docs/SPEC-FINAL-VERSION-DELTA.md` var table; ADR-034, ADR-035, ADR-036; EARS FOP-3 | None exists. TTS was never built; the panel flag is `FEATURE_ANTICIPATORY_PANEL` (default off); the D6 surfaces are the five `FEATURE_D6_*` flags | as-built notes; TTS and the two names registered in `UNIMPLEMENTED_REGISTER.md` |
| "Both [repo and live] are private during judging" | `README.md`, `JUDGE_MATRIX.md` | The repository is private; the deployment is public when online (PUBLIC role needs no account) and is brought up for the judging window | reworded |
| "Demo (as deployed)" posture row = `memory` | `docs/DEPLOYMENT.md` §0 | The reference deployment runs the *durable* row (`FEATURE_STORE=postgres`) | row relabelled |
| "The gates below ran offline" (gates are above) | `README.md` | — | fixed |
| Judge-matrix preamble said the figures were a frozen 2026-08-26 snapshot with "known drift 45/4864" while §1 carried 2026-09-15 figures | `JUDGE_MATRIX.md` | one document, one date | preamble rewritten: final state on `main`, the tag is the historical record |

### 3.3 Code follow-up closed in this pass

- **Cited news outlets were materialised without a licence.** `resolveSourceRowId` created a
  `source_record` row for every `news:<host>` a SitRep cited, with `license` NULL — the row class that
  made `/status` and `/sources` answer 422 on 2026-09-15 (hotfix #40 made the read tolerant; this
  closes the writer). An outlet row now carries `NEWS_OUTLET_LICENSE` (declared beside the id-minting
  function in `news-grounding.ts`, honest to what BEACON keeps: headline, link, summary, attributed to
  the outlet), a caller may supply a licence, and the upsert heals a NULL licence on conflict without
  ever overwriting a stored one. Tests added (`natural-keys.test.ts`).

### 3.4 Dangling references (public tree)

| Reference | Where | Action |
|---|---|---|
| `agents/*` memory files, `docs/SUBMISSION_CHECKLIST.md`, contest-portal mechanics | `llms.txt` | removed (rewrite) |
| `agents/memory/PROJECT_STATE.md`, "portal submission … the only remaining item" | `docs/SUMMARY.md` | reworded; checklist item closed |
| `../agents/memory/RESUME_POINTER.md`, `docs/LIVE_DEMO_DELIVERY_PLAN.md` | `project/TASKS.md` | historical-record note at the top; links left as authored |
| `../../../CURRENT-*.md` monorepo plans | `docs/features/LOCALIZATION_FEATURE_PLAN.md` | note added |
| `docs/ops/DEMO_SWITCH.md` | `docs/RELEASE_GUIDE.md` | pointed at `scripts/demo.mjs` |
| "AGENTS/CONSTITUTION frozen" (private files) in the iron rules | `docs/QUICK_GUIDE.md` | replaced with the coverage-floor rule |

Historical references inside ADRs, dated audits and the CI/CD standard (`docs/CI_CD.md` lists target
scripts that do not exist and says so in its as-built note) are preserved as records.

### 3.5 Verified correct (no change)

Region and locale counts (5 / 14, RTL `ar`,`ur`) · map layers (14 + 2 basemap themes) · OpenAPI
36 / 39 / 66 and the `/health` role exemption · every `SOURCE_<PREFIX>_MODE` and every schema key in
`.env.example` (test-asserted) · every `npm run` command in the current-truth guides · every ADR
reference · every `/api/v1` path quoted in the guides · the Cookie-Store requirement and the
anonymous-only cache in the PWA docs (ADR-047) · the `LIVE_PICTURE` demo switch · the Railway variable
table · the coverage floors · the offline read-only limitation · the honest-limitation lists in
`README.md` and `docs/FINAL_HANDOFF.md` (after the panel wording above).

### 3.6 Second pass (same change set) — found by the Copilot review of this audit

The first pass corrected the documents that *state* a count but missed three that *carry* one inside a
dated block, and it left two of the interval-knob's five mentions standing. All are now fixed, and the
rows above name every location rather than a sample:

| Left inconsistent by the first pass | Now |
|---|---|
| `docs/E2E_TESTING_PLAYBOOK.md` §6 heading: "45 adapters registered, **42** consumed" | 41; a dated 2026-09-16 recount note added above the preserved 2026-08-10 block |
| `docs/architecture/CONFIGURATION.md` §6 note presented 44/41/3 as *current* | current line (45/41/4) added; the 2026-08-10 note relabelled as the record of that day |
| `audit/DATA_SOURCE_VERIFICATION.md` still said "registry (44 rows)" below the new recount | the recount block now states the 45 rows / 45 factories explicitly and scopes every later "44" to its dated block |
| `docs/LIVE_PRODUCTION_GUIDE.md` §1 offered three ceilings (26/35-of-44 baseline, 37-of-44 correction, 38-of-45 footnote) | a current-ceiling box at the top of §1; the two older blocks explicitly labelled as the preserved baseline and its correction |
| `docs/SPEC.md` §13.2 kept the old present-tense "no shelter adapter" text above the closure note | bullet rewritten; the superseded sentence quoted at the end so the record survives |
| `docs/RELEASE_GUIDE.md` §4 replaced the demo runbook link with an implementation path | both: runbook `docs/ops/DEMO_SWITCH.md`, implementation `scripts/demo.mjs` |

*Lesson recorded: a correction that appends a note under a stale sentence leaves the stale sentence
readable. Where the old text states the opposite of the truth, it must be rewritten and the superseded
wording quoted — which is what §3.2 does everywhere else.*

## 4. Inventory — what is implemented and supported (final commit)

### 4.1 Product surfaces

| Surface | State | Where |
|---|---|---|
| Common operating picture: 14 layers (fire, flood, storm, flood zones, infrastructure, outage, cell, weather, cameras, exposure, reports, prediction, route, shelters) with per-layer LIVE/CACHED/MOCK/DB badges, tooltips, accessible fallback list | shipped | `app/_components/map`, `app/_lib/types.ts` |
| Situation report: deterministic grounding before the LLM, structural citations, news fusion with authority ranking, escalation trend, threshold-triggered DRAFT alerts, AI-off parity (F3) | shipped | `src/application/sitrep-synthesis`, `derive-alerts` |
| Prediction: fire spread cone, NFHL∩crest inundation, forecast likelihood/lead time, predicted impact (population, shelter demand) — each with method, inputs, uncertainty | shipped | `src/application/prediction-projection`, `impact` |
| Public SOS intake: consent at the type level, triage confidence, human verification, role-scoped precise position, retention purge | shipped | `src/domain/public-report.ts`, `routes/queue.ts` |
| Alerting: CAP v1.2 (profiles), all-clear, human approval only, Telegram broadcast after approval, multilingual CAP | shipped | `src/adapters/interop`, `alerting`, `channels/messaging` |
| Logistics: resource roster, forward-only tasking, shelter capacity-vs-demand, pre-positioning from predictions, EDXL-RM mutual-aid round-trip, EDXL-SitRep | shipped | `src/adapters/logistics`, `routes/logistics.ts`, `interop.ts` |
| Evacuation routing: ORS road routing with hazard avoid-polygons, labelled heuristic fallback | shipped | `src/adapters/routing` |
| Operator dock panels: supplies, volunteer teams, shelter status, damage reports, EMS overlay (operator store `DB` or fixtures `MOCK`); incident summary export; casualty tally | shipped | `routes/panels.ts`, `incident-summary.ts` |
| Anticipatory action: five illustrative Early Action Protocols as data, deterministic trigger engine, governance ledger, drill mode that cannot reach a channel | shipped (panel flag default off) | `config/eap`, `src/application/anticipatory`, `build-drill.ts` |
| AI compliance gateway: role scope → rate limit → breaker → firewall → policy → PII redaction → cost guardrails → hash-chained audit; capability seal; fail-closed | shipped | `src/adapters/compliance` |
| Vision (advisory, consent-gated, PII-screened) | shipped, flag default off | `src/adapters/ai/vision` |
| Channels: HTTP (36 paths), CLI, Telegram webhook/poller | shipped | `src/adapters/channels` |
| Auth: scrypt named accounts, HS256 session JWT, RBAC on every route, dev seams hard-off in cloud | shipped | `rbac.ts`, `credentials.ts` |
| Persistence: 23 migrated tables, self-seeding, durable reports/audit/logistics/SitRep history/provenance mirror/evac routes under `FEATURE_STORE=postgres` | shipped | `src/adapters/persistence` |
| Realtime: SSE push with polling fallback; live re-ingest every 300 s with never-half-built swap | shipped | `routes/stream.ts`, `live-composition.ts` |
| i18n: 14 locales (RTL ar, ur), server-resolved cookie, catalog parity tests | shipped | `app/_lib/i18n.tsx`, `messages/` |
| Installable offline COP (PWA, ADR-047): anonymous-only locale-keyed cache of PUBLIC reads, offline banner with the saved time | shipped, build flag default off | `public/sw.js`, `app/_lib/pwa` |
| Sustainability disclosure | shipped | `GET /.well-known/sustainability` |
| Deployment: Docker (multi-stage, non-root), compose, Railway reference, Kubernetes kustomize | shipped | `infra/` |

### 4.2 Data sources (45 registered, 41 consumed)

Live-capable on free credentials: **38** — 29 keyless (`nws`, `nwps`, `open-meteo`, `gdacs`, `gdelt`,
`agency-rss`, `eonet`, `openfema`, `nifc`, `nfhl`, `osm-overpass`, `meteoalarm-ro`, `meteoalarm-gr`,
`meteoalarm-es`, `wmo-swic`, `sensorcommunity`, `airnow`, `mastodon`, `caltrans-cctv`, `alertwildfire`,
`metno`, `cemsrm`, `hdxpop`, `caphub`, `nri`, `worldpop`, `glofas`, `anm`, `shelters-fema`) and 9 with
a free credential (`firms`, `census`, `reliefweb`, `opencellid`, `openaq`, `windy-webcams`, `dot511`,
`lanceflood`, `bluesky`). Cannot serve live on free public routes: **7** — `itu`, `camara-gsma`
(operator-gated by design), `usgs-water` (partial OGC migration), `hifld` (static 2019, held),
`cnadnr-ro` (no machine-readable feed), `eagle-i` (entitled endpoint), `effis` (WMS images only).
Not consumed by any zone: `itu`, `camara-gsma`, `hifld`, `dot511`. Every adapter is attributed in
`NOTICE`; per-source evidence is `docs/LIVE_PRODUCTION_GUIDE.md` §1 and
`audit/DATA_SOURCE_VERIFICATION.md`.

### 4.3 Configuration surface

Every variable the app reads is declared in `src/config/index.ts` or resolved per adapter as
`SOURCE_<PREFIX>_{MODE,URL,TIMEOUT_MS,INTERVAL_SEC,…}`; `.env.example` carries each with an example and
`src/config/env-example.test.ts` fails when the two disagree. Feature flags actually present: the
`FEATURE_*` and `NEXT_PUBLIC_FEATURE_*` families listed in `docs/RELEASE_GUIDE.md` §7 — including the
five `FEATURE_D4_*`, five `FEATURE_D6_*`, `FEATURE_ANTICIPATORY_PANEL`, `FEATURE_OUTLOOK_PANEL`,
`FEATURE_CAMERAS`, `FEATURE_EXTERNAL_VIEWS`, `FEATURE_CITIZEN_STREAM`, `FEATURE_VISION`,
`FEATURE_STORE`, `FEATURE_ROUTING`, `FEATURE_QUEUE`, `FEATURE_EVENTBUS`, `FEATURE_CACHE`,
`FEATURE_REALTIME`, `FEATURE_SPATIAL`, `NEXT_PUBLIC_PWA`, `DRILL_MODE`, `LIVE_PICTURE`. Variables
named in older documents that do **not** exist: `FEATURE_TTS`, `FEATURE_ANTICIPATORY`,
`FEATURE_PREDICTION_IMPACT`, `NEXT_PUBLIC_DEFAULT_LOCALE`, `NEXT_PUBLIC_DB_ADMIN_URL`, `VALHALLA_URL`,
`OSRM_URL` (the last two are documented as roadmap).

### 4.4 Quality gates and evidence

Unit/integration 5,378 tests with enforced coverage floors (domain + application 99/99/99/99, main
97/79/96/97, adapters 90/83/93/90, app 89/86/89/89); architecture tests (no-PII, served-mode
vocabulary, drill isolation, link policy, RTL logical CSS, i18n parity, `.env.example` completeness,
OpenAPI contract, service-worker policy); Playwright 214 across 4 device projects × 5 zones with axe
WCAG 2.2 AA, TTTP < 10 s (≈ 1 s measured), visual baselines, SSE, session persistence, i18n/RTL,
WebGL smoke, a real offline reload; CI: static, unit + coverage, build, integration (real Postgres,
23 tables asserted), browser, security lane (npm audit, gitleaks, OSV; non-blocking). Not wired:
SAST, DAST, container scan, SLSA provenance, Scorecard (planned; `SECURITY.md`).

## 5. Honestly not done (the ledger is `docs/audit/UNIMPLEMENTED_REGISTER.md` + `docs/SPEC.md` §13)

Rumor board, mutual aid and reunification links are built and tested but not composed (by plan) ·
seven adapters cannot serve live on free public routes (§4.2) · the outage layer is inference
("ASSUMED offline") · the likelihood-word guard is English-only · offline mode is read-only and
public · TTS playback (FOP-3) was never built · Valhalla/OSRM routing rungs, a production IdP, hifld
merge-not-replace and queued offline writes are roadmap · the EMS overlay has no seed rows · map
*contents* are not browser-asserted (WebGL disabled in the gates; one GL smoke spec).

## 6. Deployment state at audit time

The reference deployment (`https://quest-beacon.up.railway.app`) was verified on 2026-09-15 after
the hotfix deploy (`npm run check:live`: us-ca 12 passed / 2 warnings / 0 failed; ro 11 / 2 / 0) and
has since been **switched off by the operator** between judging windows (it answers "Application not
found"). It is brought up for the judging window; the verification steps to run on that day are
`docs/RELEASE_GUIDE.md` §5. Two operator-side items remain outside the repository: the staged Railway
variables (`SOURCE_OSM_OVERPASS_MIRRORS`, the Romania source overrides) were not present in the
running container on 2026-09-15 and need a redeploy after being set, and one provider key exposed in
an operator session is to be rotated.

## 7. Reproduce this audit

```bash
./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/eslint . --max-warnings 0
./node_modules/.bin/vitest run --coverage && npm run boundaries && npm run format:check
./node_modules/.bin/depcruise src app | tail -1            # 911 modules
node -e "console.log(require('./config/adapters.json').adapters.length)"   # 45
ls docs/architecture/decisions | wc -l                      # 49
grep -c 'CREATE TABLE' drizzle/*.sql                        # 23 tables across the migrations
npm run docs                                                # OpenAPI 36 / 39 / 66
```

*Prepared on the final commit of `main`, 2026-09-16. Every correction in §3 is in the same change set
as this file; the exported judge repository carries both.*
