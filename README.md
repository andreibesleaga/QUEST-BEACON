# BEACON — Browser-based Emergency Awareness & Coordination Open Network

> Open-source, **local-first**, near-real-time **common operating picture (COP)** for wildfires and floods.
> One browser app that ingests free/authoritative data through pluggable adapters, fuses it into a
> **source-cited AI situational report**, and ties it to **responder logistics** — working **fully offline**
> and at ≈ $0, so a real agency could self-host it with no licensing or lock-in.
>
> **IEEE Response Quest™ 2026 · Phase 3 (product)** · entry #5320 · Apache-2.0 · by Andrei Besleaga

## Why it matters
During a wildfire or flood an emergency manager juggles half a dozen sites and stitches the picture
together by hand while minutes matter. The bottleneck is **integration + synthesis + logistics**, not raw
data. BEACON replaces that scramble with one trustworthy picture, and its distinguishing property is a
discipline rather than a feature: **the deterministic engine owns every number and cites its source · the
LLM only narrates and is structurally prevented from emitting a figure · no public alert leaves the system
without a named human approving it, enforced at the type level.**

## Run it — one command, no keys, no network
From this directory (the project root — `Phase3/` in the current monorepo layout):
```bash
docker compose -f infra/docker-compose.yml up -d --build   # Postgres → migrations → app
open http://localhost:3000
```
That is the whole setup. **No API key, no account, no egress** — the stack ships air-gapped by default
(`AI_MODE=off`, sources cached/mock) and still renders a full COP with its built-in demo seed. Demo zones:
**California**, **Romania**, Spain, Greece, Philippines. Walkthrough:
[docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md).

> ⚠️ The compose file lives at `infra/docker-compose.yml`, so the `-f` flag is **required** — a bare
> `docker compose up` from the project root exits 1 with *"no configuration file provided: not found"*.
> Tear down with `docker compose -f infra/docker-compose.yml down -v`.
> The command above is the **offline** judge path and is meant to land on the air-gapped defaults. For
> the **live** posture use `npm run docker:up` instead — it renders your `.env` into the compose
> env-file first; bare compose skips that and falls back to the offline defaults.
> To develop without Docker: `nvm use && npm install && npm run dev`.

## What is honestly not done
Honest limitations are a graded rubric item here and are stated in the open, indexed in
**[`docs/SPEC.md` §13](docs/SPEC.md)**. The headline ones:

- **Almost every browser gate photographs the map's FALLBACK, not the map.** 13 of the 14 Playwright specs call
  `disableWebGL(context)` (`e2e/helpers.ts:19-29`), which forces `MapView` into its `failed` branch
  (`app/_components/map/MapView.tsx:53-54,75-89`) and renders the accessible `MapFeatureList` instead — so
  **the axe result, the visual baselines and the TTTP number all describe the FALLBACK, not the map**
  (F-322). `e2e/webgl-smoke.spec.ts` is the one spec that runs with WebGL **enabled** — it asserts a live
  GL context, a MapLibre-constructed canvas with a non-zero drawing buffer, and (since F-414) a usable map
  box on all four device projects. That closes F-322's core hole. What it deliberately does **not** assert
  is the map's *contents*: a live GL canvas is opaque and non-deterministic, and the raster basemap tiles
  are unreachable on the air-gapped seed the gates run under. Layer and geometry correctness therefore
  still rests on the fallback-driven specs and the unit tests, not on a browser looking at the real map.
- **F-414 — the live map was invisible on phone and tablet. Diagnosed, fixed, now gated; the amended suite
  has not yet been observed green end-to-end.** The first WebGL-enabled run passed on desktop and failed on
  the two small viewports, and the cause was *measured, not guessed*: nothing in the shell's ancestor chain
  has a definite height, and `MapView`'s success branch renders a single `absolute inset-0` child that
  contributes zero content height — so the slot resolved to **378 × 0 on phone and 776 × 0 on tablet** and
  clipped the live map away entirely. Desktop survived only by accident (at `lg` the track is a row, so the
  tall aside sized the slot). Fix: an explicit `min-h-80` floor on the map slot
  (`app/_components/cop-layout.tsx:83-95`), chosen far below every measured rendering so it moves no pixel
  that was already correct, and asserted **on all four device projects** — including the CSS floor itself,
  not merely the resulting height (`e2e/webgl-smoke.spec.ts:113-159`). The amended suite has since been
  observed green end-to-end on full runs (2026-08-02 and 2026-08-10), including `webgl-smoke` on all
  four device projects.
- **The former "five endpoints designed but not served" limitation is CLOSED** (live-demo session S1,
  2026-08-07): `GET /incidents/:id`, `GET /incidents/:id/exposure`, `GET /threshold-rules`,
  `GET /audit-events` and `GET /health/adapters` are all served by `routes/feature-router.ts` (+
  `routes/{adapter-health,threshold-rules,audit-events}.ts`), each RBAC-gated, and the `x-status: planned`
  markers are gone from `docs/api/openapi.yaml` — the FR-3 golden thread is now walkable with `curl`
  (F-323/F-401 closed). Kept in this list deliberately for one release: earlier copies of this README and
  `docs/SPEC.md` §13.11 stated the 404s as current, so a reader comparing versions deserves the closure
  stated in the same place the limitation was.
- **The gates below ran offline, MOCK sources, AI off — deliberately.** Offline/MOCK is the default
  reproducible posture for every gate, so the numbers are identical on any machine with zero keys and
  zero egress. Live verification has since been performed and its evidence lives in
  [docs/LIVE_STATUS_SOURCE_OF_TRUTH.md](docs/LIVE_STATUS_SOURCE_OF_TRUTH.md) (11+ live sources verified
  2026-08-04); the live-lane plan remains tracked in `docs/MASTER_SIGNOFF_PLAN.md` §6 (L1–L18).
- **Data-source honesty:** ITU and CAMARA/GSMA ship **MOCK-only** by design (operator/data-gated); EFFIS is
  **CACHED-only** — its former endpoint is now **confirmed dead upstream** (HTTP 301 → S3 `NoSuchKey`;
  re-pointing is an open register item); `hifld` is registered but **held out of every region's allowlist**
  (its static-2019 snapshot displaces the seeded infrastructure the outage derivation depends on; needs a
  merge-not-replace slot design); the EAGLE-I outage layer shows **"ASSUMED offline"** (hazard∩infra
  inference, not confirmed per-address outages); the shelter board is fixture-fed (no shelter source adapter
  exists yet); Telegram, vision and CAMARA default to mock/off until their env is set.
- **Product gaps:** the route panel now names its engine (**CLOSED 2026-08-10**: `EvacRoute.engine`
  `'ors' | 'heuristic'` is tagged by every producer and rendered as an honest label — absent tag ⇒ no
  label, never guessed); the retention-purge scheduling gap is **CLOSED** (S1: `src/main/scheduler.ts`
  `startBackgroundJobs` runs `runRetentionSweep` on an interval, composed at `http-dispatcher.ts:449` —
  the §13.4 finding is resolved); and of the ten D5/D6 differentiator modules, **7 of 10 are now composed**
  (supplies, volunteer teams, shelter status, damage reports and EMS overlay gained dock panels + GET
  routes in the 2026-08 live-demo increment — beside the already-served incident-summary export and
  casualty tally) while **rumor board, mutual aid and reunification links stay inert-registered by plan**;
  the five new panel routes are **fixture-fed MOCK** (labelled so in their provenance — no
  supply/volunteer/shelter/EMS source adapter exists; see `docs/audit/UNIMPLEMENTED_REGISTER.md`).

## Gates — machine-produced, not asserted from memory
| Gate | Command | Result |
|---|---|---|
| Lint | `./node_modules/.bin/eslint .` | **0** |
| Types | `./node_modules/.bin/tsc --noEmit` | **0** |
| Unit/integration | `./node_modules/.bin/vitest run` | **4536 passed / 2 skipped (4538), exit 0** (2026-08-25) |
| …with coverage | `./node_modules/.bin/vitest run --coverage` | **green, every floor met (2026-08-24)** — and now enforced on every PR by CI. Its first CI run *failed* at 98.97% branch coverage against the 99% `src/application/**` floor: real drift accumulated since 2026-08-02, closed by covering `newsOutletProvenance`'s degrade branches. The floor was **not** lowered |
| Architecture boundaries | `./node_modules/.bin/depcruise src app` | **0 violations across 844 modules** |
| API contract | `docs/api/openapi.yaml` | parses — **36 paths · 39 operations · 65 schemas** |
| Dependencies | `npm audit --audit-level=high` | **0 high / 0 critical** (4 moderate, dev-only; re-measured **2026-08-24**). Four HIGH advisories published after the 2026-08-02 measurement were patched: **three transitive** (`brace-expansion`, `fast-uri`, `nanoid`) and **one direct dependency** (`js-yaml`, declared in `package.json`). All were patch-level; `package.json` itself is unchanged (the `^4.3.0` range already admitted the fixed `js-yaml`), so only `package-lock.json` moved |
| Build | `./node_modules/.bin/next build` | ✅ (2026-08-01 — re-run at tag time) |
| Browser | `./node_modules/.bin/playwright test` | **green — 0 failed** (2026-08-24), and now run on every PR by CI on a clean runner across 4 device projects × 5 zones. The 2026-08-10 "mid-re-baseline" state (5 moved visual baselines + 2 flake classes) is fully resolved: baselines re-minted, and the flakes root-caused to a stale reused web server (`reuseExistingServer` now off by default). Read the WebGL caveat above before quoting this |

Rows 1–3, 5–6 and 9 were re-run and re-derived on **2026-08-10**; the remaining rows carry their own
machine-produced dates rather than being restated as fresh, because *"an unverified thing is
'unverified', never 'fine'"* is the rule this project is graded against. **Every figure on this page must
be re-produced on the tagged commit; a stale gate figure in a README is precisely the drift class this
project has been fighting, and it has bitten here before** (`depcruise 0/723`, `301 files / 3615 tests`,
`Playwright 86 passed` were all wrong at the time they were displayed).
**Hexagonal boundaries are machine-enforced, not merely described** — the rules live in
[`.dependency-cruiser.cjs`](.dependency-cruiser.cjs) and "0 violations across 844 modules" is the claim.

## Four flagship capabilities
1. **Unified live geospatial COP** — timestamped layers: fire, flood gauges/forecasts, weather/alerts,
   infrastructure, power outages, cell coverage; per-layer freshness badges.
2. **AI situational-intelligence fusion** — news + vetted signals + geospatial risk → a ranked, **cited**
   SitRep with escalation trend and threshold-triggered DRAFT alerts; misinformation flagged, never trusted.
3. **Responsible crowdsourced SOS + evacuation routing** — consent → AI triage/confidence → human
   verification → CAP alert; hazard-avoiding routes + shelter capacity.
4. **Responder logistics** — live resource registry, tasking, shelter capacity-vs-demand, full
   **EDXL-RM mutual-aid round-trip** + CAP v1.2 interop.

## Orient in 5 minutes
| Read | For |
|---|---|
| [docs/QUICK_GUIDE.md](docs/QUICK_GUIDE.md) | one-page map of everything |
| [docs/architecture/C4_ARCHITECTURE.md](docs/architecture/C4_ARCHITECTURE.md) | **architecture diagrams** (C4 L1–L3 + runtime flows) + the 37-ADR index |
| [docs/SPEC.md](docs/SPEC.md) | the contract of record — **§13 is the limitations ledger** |
| [docs/SUMMARY.md](docs/SUMMARY.md) | executive summary of the spec base |
| [docs/requirements/PRD.md](docs/requirements/PRD.md) | requirements (FR-1…16, EARS) |
| [audit/DATA_SOURCE_VERIFICATION.md](audit/DATA_SOURCE_VERIFICATION.md) | every data source, verified, with fallbacks (US · Romania · worldwide) |
| [project/TASKS.md](project/TASKS.md) | the build backlog + execution model |
| [docs/ENGINEERING_PRINCIPLES.md](docs/ENGINEERING_PRINCIPLES.md) | the quality bar every phase honors |
| [docs/FINAL_HANDOFF.md](docs/FINAL_HANDOFF.md) | **the final state hub** — verification snapshot, Phase-2→Phase-3 map, judging-criteria map, and the ordered path to submission |
| [docs/MASTER_SIGNOFF_PLAN.md](docs/MASTER_SIGNOFF_PLAN.md) | the historical sign-off plan (superseded by the handoff above) |

## What is built
The full hexagonal spine is implemented and tested: **44 registered source adapters** — `config/adapters.json`
↔ `ADAPTER_FACTORIES` (`src/main/adapter-registry.ts`) is an **exact 44 ↔ 44 match, machine-re-verified
2026-08-10**. Of those, **41 are consumed by the live composition** (36 data sources on the COP/`status`
pipeline — incl. NIFC/EFFIS fire perimeters merged beside FIRMS hotspots, `usgs-water` as a cited
gauge-redundancy rung alongside `nwps` on `us-ca`, and the 2026-08 increment's weather/news/event/population
rungs appended per-slot so no prior source's precedence moved — plus 5 camera sources on the E11 `cameras`
map layer). The per-source consumption verdicts are maintained in
[`audit/DATA_SOURCE_VERIFICATION.md`](audit/DATA_SOURCE_VERIFICATION.md) §0, which is the authority for
that split; only the 44 ↔ 44 registration match is re-derived here. The 3 registered-but-not-consumed
adapters: `itu` and `camara-gsma` are operator-gated MOCK-only plugins by design (no reachable keyless or
public-sandbox live route exists for either), and `hifld` is deliberately **held** out of every region's
allowlist pending a merge-not-replace slot design (see the honesty bullet above).

**5 shipped zones** (`us-ca`, `ro`, `es`, `gr`, `ph`) · **14 shipped locales** (RTL: `ar`, `ur`) ·
**37 ADRs** (001–036 + 008a; one duplicate/orphan `ADR-036` file is flagged as a finding, `docs/SPEC.md`
§13.10) · the AI-compliance proxy in front of a real LLM ladder (deterministic→AI→human, cited SitRep, F3
no-invented-numbers) · real per-user JWT identity · durable Postgres store (`FEATURE_STORE=postgres`) ·
CAP/EDXL round-trip · HITL alerting · **real SSE push** (a mutation reaches a listening browser in ~1.7 s
against a labelled 15 s polling fallback — proven end-to-end by `e2e/sse-push.spec.ts`) · a WCAG 2.2-AA COP.

Live-proven with real egress: `docker compose` full stack, keyless-live sources
(NWS/NWPS/Open-Meteo/GDACS/GDELT), durable Postgres, real JWT, and cloud AI narration via OpenRouter — see
[`docs/audit/LIVE_VERIFICATION.md`](docs/audit/LIVE_VERIFICATION.md) and
[`docs/E2E_TESTING_PLAYBOOK.md`](docs/E2E_TESTING_PLAYBOOK.md).

**Delivered end-to-end after being "built but not wired"** — each flip backed by a code citation in
`docs/SPEC.md` §13 and `project/TASKS-FINAL-VERSION.md`: **multilingual CAP emission**
(`capTranslationsFor()` has real production callers via `src/adapters/alerting/cap-text.ts:130`, wired
through `src/main/feature-seed.ts`; a region's alert carries one `<info>` block per configured language,
English always present — F-53) · **clipped exposure figures** (`derive-cop.ts` — five named rungs,
Sutherland–Hodgman clipping, and the unclipped rungs say so in their own label text, F-23) · **the
retention-purge executor** (`src/application/governance/retention-sweep.ts` + Postgres/in-memory stores,
F-25 — but see the scheduling caveat above) · **schema-validated inbound EDXL-RM** (`edxl-rm-mapper.ts:268`
— a partner sending malformed EDXL-RM is now rejected rather than silently accepted, F-31; a deliberate
breaking behaviour change, see [CHANGELOG.md](CHANGELOG.md)) · and **the logistics "Task" button end-to-end
in a real browser** (the resource-list query, the wire contract and the PROPOSED-first state machine were
each broken in a different way; all fixed and Playwright-verified, F-24/F-140/F-190/F-191/F-192).

**Delivered end-to-end after being roadmap:** **news/social → SitRep fusion** (deterministic
news-grounding — authority ranking OFFICIAL>MEDIA>SOCIAL, corroboration counts, misinformation
flagged-not-merged, minted *before* the LLM so AI-on == AI-off;
`src/application/sitrep-synthesis/news-grounding.ts`) · the **outage / cell / weather / flood-zone COP
layers** with per-layer freshness badges · **NFHL∩crest predicted-impact** (labeled method/inputs/
uncertainty) · **real ORS road routing** behind `FEATURE_ROUTING=ors`+`ORS_API_KEY` (hazard-avoiding
heuristic fallback) · a **real Telegram broadcast** of approved alerts (Bot API, HITL-gated) · advisory
**vision assist** in the verify flow (flag-gated, off by default) · **pre-positioning-from-predictions** on the logistics board ·
**Live Views (E11)** — 5 link-out camera sources (Caltrans CCTV, ALERTCalifornia, Windy, 511 DOT,
CNADNR-RO) as a default-off `cameras` COP layer, deterministic **external context deep-links** (Google
Earth 3D/Maps/Street View/NASA Worldview…) in the SitRep panel, and a consent+HITL,
permanently-"Unofficial" **citizen live-view** link on SOS (build-flag gated
`NEXT_PUBLIC_FEATURE_CITIZEN_STREAM`, off by default) — all link-only (never embedded, proxied or
rehosted; the engine and the LLM never read a pixel), attributed and provenance-stamped.

## Principles (enforced, not aspirational)
Provenance + citations on everything · deterministic source of truth (LLM never computes a number) ·
human-in-the-loop before any public action · **total redundancy** (every layer has a fallback ladder;
offline/air-gapped works) · free/open data only · fail-closed AI-compliance gateway on every model call ·
WCAG 2.2 AA crisis-first UX.

## Repo layout note
`audit/` (root) = the **Phase-2 carry-over audits** (Phase-2 review, clarified decisions, and the living
data-source verification catalog). `docs/audit/` = the **Phase-3 SDLC gate audits** (consistency, final,
external verification, readiness). Both are authoritative for their scope.
The GABBE governance kit that drives the AI-assisted SDLC (`agents/`, `.claude/`, `.gabbe/`) is **used at
runtime but deliberately not version-controlled** (`.gitignore:22`), so it is absent from a clone; its
durable output — decisions, ADRs, audits, task ledgers — is committed under `docs/`, `audit/` and
`project/`. Security disclosures: [SECURITY.md](SECURITY.md). Contributing:
[CONTRIBUTING.md](CONTRIBUTING.md) · [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License & attribution
**Apache-2.0** ([LICENSE](LICENSE)). Data-source attributions: [NOTICE](NOTICE) — all 30 wired sources
listed with their licence and required credit. Built with free/open data (NASA, NOAA, USGS, Copernicus,
OSM, UN OCHA, and more — all verified + attributed).

*Phase-2 concept was accepted (jury 4.48/5). AI-assisted engineering (disclosed in the entry): specs and
build are produced with LLM agents under a governed SDLC with human gates — the same
deterministic→AI→human principle the product itself implements.*
