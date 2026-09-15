# Full verification — 2026-09-13

Every gate the project defines, run on the tree of PR #29 (merged to `main` as `d322258`), plus the
live deployment measured from outside, plus a lens-by-lens reading of the system. Numbers here were read
off the runs named beside them; nothing in this document was estimated.

Legend: **PASS** = ran and green · **FINDING** = a defect or gap, with what was done · **OWNER** = needs the
account, a pipeline change, or a decision that is not the engineer's to make.

## 1. Gates (AGENTS.md §6 — Gates 1–7)

| Gate | Command | Result |
|---|---|---|
| 1 Lint | `npx eslint .` | PASS — 0 errors, 0 warnings |
| 2 Types | `npx tsc --noEmit` | PASS |
| 3 Tests + coverage | `npx vitest run --coverage` | PASS — 396 files, 5,151 tests (6 skipped: the opt-in real-Postgres suites), floors held. Totals: 95.91 % statements · 90.70 % branches · 95.85 % functions · 95.91 % lines; `src/domain`, `src/application` ≥ 99 % (floor); `src/main` ≥ 97 %; `src/adapters` ≥ 90 %; `app` ≥ 89 % |
| 3b Real-database suites | `npm run test:integration`, `npm run test:pg` | **NOT RUN anywhere** — see F-9 |
| 4 Integration | CI `integration (postgres migrate)` | PASS — migrations apply, table set matches the SQL |
| 4b Browser | CI `browser (playwright e2e · axe · perf)` | PASS on the merged head (e2e, axe accessibility, perf budget) |
| 5 Security | `npm audit --audit-level=high`, gitleaks, OSV (CI) | PASS — 0 high/critical. 7 moderate, all dev-tooling (vitest, esbuild, drizzle-kit), fix available — see F-10 |
| 6 Complexity | ESLint `complexity ≤ 10` (in lint) | PASS |
| 7 EARS | requirement → test golden thread | Every change in #29 carries tests (10 test files touched; new: `region-clip.test.ts`, `geo.test.ts`, `seed.legacy-upgrade.pg.test.ts`) |
| Architecture boundaries | `npm run boundaries` (dependency-cruiser + madge) | PASS — no forbidden import, no circular dependency |
| Build | `npm run build` | PASS — `public/maplibre/{worker,shared}.mjs` emitted by `prebuild` |
| OpenAPI | `npx @redocly/cli lint docs/api/openapi.yaml` | PASS — valid, 6 warnings (unused components) |
| Formatting | `npm run format:check` | **716 files** fail under prettier 3.9 — CI deliberately non-blocking (see F-11) |
| Secrets in tree | pattern scan + tracked `.env*` | PASS — none |

## 2. Live deployment (measured from outside, 13:56 → 19:30 UTC)

| Check | Result |
|---|---|
| `npm run check:live` | 8 pass / 1 warn / 0 fail; composition 304 s; 25 of 38 sources LIVE; data 1 min old |
| `npm run demo:status` | ONLINE |
| MapLibre worker | `/maplibre/maplibre-gl-worker.mjs` 200 `application/javascript` — the blank-map fix (#28) is live |
| API envelope | `status`, `sources`, `regions/{id}/map` → `{data, provenance[], freshness}`; unknown route → `{data, errors[], provenance}` 404 |
| RBAC | anonymous `GET /threshold-rules` 403, `GET /audit-events` 403; `POST /reports` with an empty body 400 (validation) |
| Login path | 401 on a wrong password (expected) |
| Security headers | `x-content-type-options: nosniff`, `x-frame-options: DENY`, `referrer-policy: strict-origin-when-cross-origin` (this is what keeps OSM tiles served). **Absent:** `content-security-policy`, `strict-transport-security`; present: `x-powered-by: Next.js` — F-12 |
| Basemap host | `tile.openstreetmap.org` answers a Referer-bearing request from the build box with `cache-control: no-cache` (refusal) — the operator's browser is what matters, and the map is confirmed drawn there |
| **Points in other countries** (owner) | **CONFIRMED on live, fixed in #29, not yet deployed** — a bbox test over every region's map layers found California's cells and infrastructure on all five regions, EFFIS's Greece+Romania fixture on both, Atlanta 511 cameras on California. F-1 |
| **Discovered incidents** | **None served on live although 77 hotspots + 9 perimeters were unclaimed** — the composition dropped them. Fixed in #29. F-2 |

## 3. Findings by lens

### Data / provenance (Art. XI, XII, XVI)
- **F-1 (critical, FIXED in #29)** — a GLOBAL-coverage source's recording from elsewhere was served for every region. `src/application/shared/region-clip.ts` + `fetchSliceOnce`: a record must intersect the region; an answer entirely elsewhere is cited (consulted, mode-labelled) but not served, so the seeded slice stays. 15 characterisation snapshots changed — only the bleed left.
- **F-2 (critical, FIXED in #29)** — `live-composition.ts` rebuilt the incident list from the demo seed by id, dropping every discovered incident. Discovered ids are region-qualified; a discovered derivation is allowlisted (own hazards, region lifeline set, zero population, no inherited trend/crest/weather/AQ/outage/population) and cites the adapter that contributed its hazards.
- **F-3 (moderate, FIXED in #29)** — WorldPop was asked region-sized questions it refuses; now NOT_COVERED up front in LIVE and CACHED (explicit MOCK still serves), bbox-keyed cache, upper-bound area (WGS-84 maxima, both axes).
- **F-4 (moderate, FIXED in #29)** — the durable incident mirror overwrote status every composition (would reopen an operator's CLOSED). It now preserves CLOSED and refreshes `updated_at` (last seen); it never closes or reopens on its own.
- **F-5 (moderate, FIXED in #29)** — the four demo `source_record` rows were keyed by display name and could never be replaced by the live mirror; keyed by adapter id, with a transactional, retrying upgrade for existing databases (rename in place, or repoint six referencing tables and delete).
- **F-6 (moderate, FIXED in #29)** — on a database older than the pinned region UUIDs the seed inserted a second Spain/Greece/Philippines; it now claims the legacy row by name and remaps every region-keyed seed row to it.

### Architecture
- Hexagonal boundaries hold (dependency-cruiser, madge; domain imports no framework). Composition root is the only place adapters meet use-cases. PASS.
- **F-7 (low, documented)** — the per-adapter port path (`estimatePopulation`, `fetchHazards(query)` …) builds `Region { id: 'query' }` in all 30 adapters, so last-known-good entries collide across areas (`lkg:<adapter>:query`). Fixed for WorldPop (bbox-keyed) where it was made worse; the other 29 keep the pre-existing behaviour. Follow-up: key by bbox in the shared engine, once.
- **F-8 (low, documented)** — Kubernetes manifests run 2 replicas with the in-memory event bus/queue/cache; `docs/DEPLOYMENT.md §4` already says to switch the Redis flags beyond one instance. Railway runs one replica. No change.

### Tests / CI
- **F-9 (OWNER)** — the four real-Postgres integration suites (`tests/integration/*.integration.test.ts`, 18 tests) and the new `test:pg` suite are skipped without a database and **the CI integration job never runs them**; it migrates and asserts the table set only. One `run:` line each after `npm run migrate`. AGENTS.md §6 reserves pipeline edits for the owner.
- **F-10 (OWNER, low)** — 7 moderate advisories, all dev-only (vitest/esbuild/drizzle-kit), `npm audit fix` available; policy is high+, so not blocking. Patch/minor bumps are within the self-heal allowance; a major esbuild bump is not.
- **F-11 (OWNER, low)** — `format:check` fails on 716 files because the tree was formatted under prettier 3.4 and the lockfile moved to 3.9 (CI comment, MASTER_PLAN Phase A). Two honest resolutions: pin prettier to 3.4.x, or one formatting-only commit. Not a 716-file change inside a functional PR.

### Security
- **F-12 (moderate, OWNER-visible, recommended)** — no `Content-Security-Policy`, no `Strict-Transport-Security`, and `x-powered-by: Next.js` on every response. `poweredByHeader: false` is one line in `next.config.mjs`. HSTS is safe on the Railway domain. A CSP needs a deliberate allow-list (tile hosts, `blob:` workers, fonts) and a browser run before it ships — do it as its own PR with the e2e suite.
- Secrets: none in the tree; keys only in `.env`/Railway. `AUTH_DEV_*` not set on cloud. PASS.

### Documentation truth
- **F-13 (FIXED today)** — five operator documents said GloFAS live needs `GLOFAS_CDS_KEY`; the adapter is keyless and needs `SOURCE_GLOFAS_POINTS`. Corrected in `.env.example`, CONFIGURATION, CLOUD_DEPLOY_RAILWAY, VISUAL_LIVE_TEST_PLAN, LIVE_VERIFICATION, MASTER_SIGNOFF_PLAN, E2E_TESTING_PLAYBOOK, FINAL_LIVE_TEST_AND_DEMO.
- **F-14 (FIXED in the follow-up)** — `docs/audit/UNIMPLEMENTED_REGISTER.md` row "Postgres tables sitrep/citation/evac_route" still says the stores are "built but composed nowhere"; both are composed (`build-core.ts` → `makePgSitRepHistoryStore`, `feature-seed.ts` → `makePgEvacRouteStore`, ADR-039). Closure note appended.
- **F-15 (FIXED in the follow-up)** — `project/TASKS.md` E12 rows S2–S4 still read NEXT/TODO; a dated status line appended (S2/S3 delivered across 2026-08-08 → 09-13, S4 in progress: live verified, release gated on owner confirmation).
- `README.md` names the repository `andreibesleaga/QUEST-BEACON`; the public repository that exists is `andreibesleaga/Quest-BEACON` (case). Cosmetic until the public release; noted for the release checklist (V3 §5).
- `docs/CLOUD_DEPLOY_RAILWAY.md` still recommends `AI_MODE=off`; live runs `cloud`. V3 §3.8 already carries this as the owner's open item (AI works only for a signed-in EM; edge timeout risk on SitRep reads).

### GABBE / SDLC (AGENTS.md §5, §13)
- Workflow followed per change: failing test first for every defect (region clip, composition, WorldPop, seed, mirror); typecheck/lint/boundaries/tests before each push; Copilot review (8 passes on #29, every finding taken or refuted with evidence, every thread replied and resolved); ledgers (`AUDIT_LOG`, `RESUME_POINTER`, `CONTINUITY`, `PROJECT_STATE`) refreshed. PASS.
- Decision records: the region-clip rule is an architectural invariant that belongs in an ADR (**F-16**, written as ADR-042 in the follow-up).
- Cost: the review loop cost ~3 h of wall-clock on one PR. Recorded in CONTINUITY: cap review rounds at two before merging on green CI and taking residual findings as follow-ups.

### Product (V3 plan, owner's list)
| Item | State |
|---|---|
| §3.1 live picture / discovery | code fixed (#29); visible after the next redeploy |
| §3.2 EVAC route | ORS key set; route caveat merged (#24); road routes need visual confirmation |
| §3.3 / §3.8 / §3.9 / §3.10 SitRep, AI, language, second approval | need a signed-in EM on live — not exercisable from outside |
| §3.4 logistics, §3.5 verification queue, §3.13 rules | seeded (#22); the threshold engine still evaluates the feature seed, not the table (open engineering) |
| §3.7 composition ~300 s | regions serialised; the next real change (parallel regions) is open |
| §3.11 status strip, §3.12 labels | not re-verified today |

## 4. What the owner runs next
1. After #29 merges: `npm run demo:on` (redeploy; the pre-deploy command runs migrate + seed), then `npm run check:live` until "composition ready". Every map point should be in its own country; California should list `discovered:` incidents when FIRMS/NIFC report.
2. `docs/ops/OWNER-ACTIONS-2026-09-13.md`: `SOURCE_GLOFAS_POINTS`, `CENSUS_API_KEY`, `SOURCE_METNO_MODE=live`, the 511 host, and the CI decision (F-9).
3. Decide F-10, F-11, F-12.
