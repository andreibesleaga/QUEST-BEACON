# BEACON — Judge Matrix (IEEE Response Quest 2026 · Phase 3 · Entry #5320)

**BEACON** — Browser-based Emergency Awareness & Coordination Open Network: an open-source,
local-first, near-real-time **common operating picture (COP)** for wildfires and floods, with cited AI
situational synthesis, human-gated alerting, evacuation routing and responder logistics.

| | |
|---|---|
| **Live deployment** | https://quest-beacon.up.railway.app (production posture; sign-in accounts provided with the submission, access on-request basis) |
| **Repository** | https://github.com/andreibesleaga/QUEST-BEACON (production repo, access on-request basis) |
| **Reproduce locally** | `npm run docker:up` → http://localhost:3000 — full COP with **zero keys, zero egress, ~$0** |
| **License / data** | Apache-2.0; 100 % open-source dependencies; free/open data sources only |
| **Phase-2 concept score** | **4.48 / 5** (Review Committee 1, 10 evaluators) — advanced to Phase 3 |
| **Entrant** | Andrei Nicolae Besleaga (individual entry, active IEEE member) |

> **Submission cut-off & living repository.** The product submitted to the contest is the repository
> state at the submission tag — everything the judges evaluate is frozen there and reproducible from it.
> This repository then continues as the project's open-source home: post-submission fixes, versions and
> the roadmap ([docs/features/ROADMAP-POST-V1.md](docs/features/ROADMAP-POST-V1.md)) land here, openly.
> Judges are welcome to look at both: the tag is the entry; the repo is the project's life after it.

---

## 1. At a glance (every figure machine-produced and reproducible from this repo)

| Dimension | Figure |
|---|---|
| Data-source adapters | **44 registered** (id↔factory match test-asserted) · 41 consumed · 3 deliberately not (2 MOCK-only by design, 1 held — §7) |
| Map layers | **14**, each with its own LIVE/CACHED/MOCK freshness badge; accessible list fallback covers all 14 |
| Regions / locales | **5 zones** (US-CA, RO, ES, GR, PH) · **14 locales** incl. RTL (ar, ur) — region/locale are config, not code |
| Tests | **4,536 unit/integration tests passed / 2 skipped** (exit 0, 2026-08-25) · Playwright e2e across **5 zones × 4 device projects** incl. axe WCAG 2.2 AA and visual baselines |
| Coverage floors (CI-enforced) | domain + application **99/99/99/99** · main 97/79/96/97 · adapters 90/83/93/90 — floors are never lowered |
| Architecture | Hexagonal ports & adapters, **0 boundary violations** (dependency-cruiser gate, 844+ modules) · **39 ADR records** (001–037 + 008a; two records share the 036 number — a recorded finding) |
| API | OpenAPI: **36 paths / 39 operations / 65 schemas**, zero `x-status: planned` — everything documented is served |
| Time-to-Trustworthy-Picture | **< 10 s budget, measured ~1 s** per zone, phone included (`e2e/perf.spec.ts`) |
| Real-time push | SSE delta in **~1.7 s** browser-proven (`e2e/sse-push.spec.ts`); 15 s polling is the labelled fallback |
| Interop | OASIS **CAP v1.2** + **EDXL-RM / EDXL-SitRep** round-trips, schema-validated with captured payloads |
| Security | scrypt credentials + HS256 JWT (fail-closed to PUBLIC), RBAC on every route, hash-chained audit ledger, CI: gitleaks/CodeQL/OSV |
| Cost to run | **≈ $0** — free data, open-source stack, one machine or free-tier cloud |

Reproduce the gates yourself: `npm install && npx tsc --noEmit && npx eslint . && npx vitest run`
(then `npm run docker:up` and the runbooks in §6).

---

## 2. The five official judging criteria — Phase-2 promise → Phase-3 delivery → evidence

*Phase-2 jury scores shown per criterion (Review Committee 1, 10 evaluators).*

### 2.1 Timeliness, Real-Time Responsiveness & Technical Reliability — Phase-2: 4.2

| Phase-2 form promise | Shipped in Phase 3 | Evidence |
|---|---|---|
| "Push, don't poll" — workers poll at native cadence, push deltas over WebSocket/SSE | Real **SSE push**: server-side publisher → browser `EventSource`, delta arrives ~1.7 s, no reload; deltas carry only `{type, region, entity, at}` — the client refetches over REST where provenance + RBAC apply | `e2e/sse-push.spec.ts` (real browser proof) · `src/adapters/channels/http/` |
| Freshness timestamp on every layer; honest latencies | **Per-layer** freshness badges from each source's own `fetchedAt` (not one shared stamp); honest LIVE/CACHED/MOCK labels everywhere | COP UI · `GET /api/v1/sources` |
| Retries, circuit-breakers, cached last-known-good, graceful degradation | Per-adapter redundancy ladder **live → secondary → cache → mock**, labelled at every rung; one source's outage marks its layer degraded, never breaks the picture; a malformed feed can never 5xx the COP | Art. XVI acceptance tests · scenario runbooks (§6) |
| Rate-limit budgets, backpressure | Per-adapter modes + rate handling; demo defaults are cached/mock so judges replaying the demo cannot exhaust free tiers | `docs/architecture/CONFIGURATION.md` |
| **Beyond the promise** | **TTTP measured ~1 s** (budget < 10 s) on all 5 zones incl. phone; fresh-server deterministic e2e; the whole app remains fully functional **air-gapped** | `e2e/perf.spec.ts` · scenario A (§6) |

### 2.2 Comprehensiveness, Use of Available Data & Novel Data Discovery — Phase-2: 4.7

| Phase-2 form promise | Shipped in Phase 3 | Evidence |
|---|---|---|
| Fire, flood, weather/alerts, infrastructure, outages, cell, population, news, crowdsourced | All families shipped through **44 port-conforming adapters**: FIRMS, NIFC, EFFIS, NWPS, USGS, GloFAS, FEMA NFHL, NWS CAP, Open-Meteo, OSM Overpass, EAGLE-I, OpenCelliD, WorldPop, Census, ReliefWeb, GDACS, InciWeb/agency RSS, GDELT, Bluesky/Mastodon, air quality (OpenAQ/AirNow/Sensor.Community), and more | `audit/DATA_SOURCE_VERIFICATION.md` (per-source verified table) · `src/main/adapter-registry.ts` |
| Novel/underutilized sources: NWPS crest, EAGLE-I, Sentinel-2 burn-area, GDELT, CAMARA/GSMA | NWPS crest × NFHL predicted flood impact **shipped**; EAGLE-I outage layer **shipped** (honestly labelled "ASSUMED offline" — county-granular inference); Sentinel-2 burn-area as consent-gated advisory **vision** finding; GDELT wired; CAMARA/GSMA modelled as a MOCK-only adapter awaiting operator agreements (honest) | COP layers · verifier vision chip · §7 |
| Derived layers no single source publishes | Risk intersections, NFHL∩crest predicted impact, assumed-offline inference, authority-ranked news corroboration | `src/application/` + prediction layer labels |
| Region coverage declared per adapter | **Region-generic composition**: 5 zones on 3 continents; a new zone is a config entry (test: `tests/zones/add-a-zone.test.ts`) | `config/regions.json` |
| **Beyond the promise** | **Live Views**: live fire/traffic/webcam cameras as map pins (ALERTCalifornia, Caltrans, 511, Windy) + 11 external deep-links per incident (Google Earth 3D, NASA FIRMS worldwide fires, Google Flood Hub) — novel data discovery delivered *on top of* the canonical COP with the same provenance discipline | ADR-027/028/029 · COP camera layer |

### 2.3 Integration, Synthesis Quality & Responsible Data Handling — Phase-2: 4.5

| Phase-2 form promise | Shipped in Phase 3 | Evidence |
|---|---|---|
| Anti-corruption layer → one canonical model; CAP/EDXL interchange | Hexagonal ACL: every source normalized into one domain model; **CAP v1.2 + EDXL-RM + EDXL-SitRep round-trips** schema-validated | dependency-cruiser gate (0 violations) · `POST /api/v1/edxl/*` |
| AI report where every claim links to its data; numbers from deterministic computation, LLM narrates, never invents | **Structurally enforced**: `citations[]` is required — an uncited SitRep field renders as an error; the news-fusion field is minted by a deterministic authority-ranked pass **before** the LLM; the **F3 contract** proves AI-on and AI-off produce identical numbers | AI probe (`npm run ai:probe`, F3 PASS) · SitRep UI |
| Provenance on every datum | Every API response is a `{ data, provenance[], freshness }` envelope; every datum carries source, fetch time, adapter | API envelope · provenance popovers |
| Consent, confidence, human-in-the-loop, no PII, flag-don't-merge | Consent at the **type level** (`consent: true` or the report cannot exist); confidence decomposed (geocode/authority/classifier/corroboration) and shown; **no CAP/EDXL from an unverified report**; misinformation flagged and rejectable with no outbound action; PII-free broadcasts; hash-chained audit | Art. XIII/XIV tests · verifier queue UI |
| **Beyond the promise** | Fail-closed **AI compliance proxy** (governance tier); DRILL_MODE structurally cannot reach a real channel; role-scoped geometry (public sees generalized positions, responders see precise) | `config/governance.json` · `src/main/build-drill.ts` |

### 2.4 Usability, Clarity & Operational Readiness — Phase-2: 4.3

| Phase-2 form promise | Shipped in Phase 3 | Evidence |
|---|---|---|
| Three users: EM, responder/IC, public reporter | Role-based UI: PUBLIC / RESPONDER / VERIFIER / EM — RBAC-gated panels, named-account sign-in, audit trail names **who** acted | login + RBAC e2e (`e2e/logistics-tasking.spec.ts`) |
| Crisis-first UX: low cognitive load, one meaning per colour, trust cues everywhere | Layer toggles default to the hazard's needs; severity vocabulary tested; freshness + "Unverified" badges pervasive | UI test suites · `docs/UI_UX_DESIGN.md` |
| monitor → assess → decide → act, "act" one click from the map | Act menu on the COP: route, alert, task — one click; command palette for keyboard operators | `app/_components/act-menu.tsx` |
| Responsive (EOC → tablet → field phone), dark ops mode, WCAG 2.1 AA, throttled networks, run locally | **WCAG 2.2 AA** (exceeds the promised 2.1) with an **axe CI gate**; dark/light × desktop/tablet/phone Playwright matrix; keyboard-only operation incl. map zoom/re-center controls; fully offline-capable | axe gate in e2e · visual baselines ×13 |
| **Beyond the promise** | **14 locales incl. RTL**; accessible map fallback lists all 14 layers when WebGL is absent (never a dead-end); session survives reload mid-incident; `docs/OPERATOR_GUIDE.md` is a judge-readable workflow guide | i18n suite · `e2e/i18n-rtl.spec.ts` |

### 2.5 Scenario Fit, Insightfulness, Innovation & Technical/Data Creativity — Phase-2: 4.7

| Phase-2 form promise | Shipped in Phase 3 | Evidence |
|---|---|---|
| Fire modelled as track/direction/speed/intensity; flood as stage vs category, rate of rise, crest | Both shipped, plus storm track/cone/surge as a third modelled hazard family | domain model · COP layers |
| Prediction layer: spread cone, crest × NFHL inundation, impact-over-time, escalation trend, suggested evacuation start — each with method, inputs, uncertainty | Shipped as a **first-order, honestly-labelled** prediction layer: every figure names its method, inputs and uncertainty; NFHL∩crest predicted impact; escalation trend; anticipatory triggers are fixture-fed and replayable — **no LLM produces any number** | prediction layer UI labels · trigger evaluator tests |
| Ranked "areas needing immediate attention"; hazard-avoiding routing; shelter capacity vs demand | Deterministic weighted priority ranking (0.45/0.35/0.20); ORS road routing with hazard avoid-polygons + labelled offline heuristic fallback (the UI names its engine); shelter capacity widget + CSV export | SitRep priorities · route panel · logistics board |
| Innovation: modular adapter core + classic-plus-AI decision intelligence with provenance and a human gate + local-first ~$0 deployment | All three delivered and **combined**, which is the white space: cited deterministic-AI synthesis × offline local-first × responder logistics × free data — reproducible by a judge with one command | this whole repo |
| **Beyond the promise** | **Pre-positioning from predictions** (advisory, human decides); real **Telegram** broadcast channel post-approval; governance drill mode; `.well-known/sustainability` disclosure; live-camera + external-context views | logistics board · ADR-020 · scenario runbooks |

---

## 3. The four flagship capabilities from the accepted entry — delivery state

| # | Flagship (Phase-2 form, verbatim scope) | State |
|---|---|---|
| 1 | Unified live geospatial COP — region selector, toggleable timestamped layers (fire, perimeters, gauges, forecasts, weather, alerts, infrastructure, outages, cell) | ✅ Shipped — 14 layers, per-layer freshness, 5 regions, accessible fallback |
| 2 | AI situational-intelligence fusion — ranked, cited SitRep + escalation trend + threshold early-warning; misinformation flagged, never auto-trusted | ✅ Shipped — deterministic-first citations, F3 no-LLM-numbers contract, flag-not-merge, threshold → **DRAFT-only** alerts |
| 3 | Responsible crowdsourced SOS + evacuation routing — consent → AI geocode/triage/confidence → human verification → CAP; hazard-avoidance routes + shelters | ✅ Shipped — consent at type level, confidence components, HITL verify, CAP v1.2 export, ORS + labelled fallback routing |
| 4 | Responder comms, logistics & resource management — live registry, tasking, shelter capacity-vs-demand, pre-positioning, EDXL-RM/SitRep/CAP interop | ✅ Shipped — forward-only tasking lifecycle, capacity widget, pre-positioning advisories, full interop round-trips, durable under Postgres |

The Phase-2 disclaimer explicitly allowed source substitution and mock/cache tiers; §7 lists exactly
which sources run in which tier — every tier is honestly labelled in the running product.

---

## 4. Decision support: the promised two-engine design, delivered

The accepted entry promised: *deterministic algorithms own the facts and rankings; the LLM owns
synthesis and explanation; a human owns the decision; if the AI is unavailable the deterministic layer
still produces usable, ranked decisions.* This is the shipped architecture, machine-enforced:

- **Deterministic engine** — risk intersection, weighted priority ranking, threshold rules,
  constraint-based routing, capacity/resource matching, news corroboration counting. All figures.
- **LLM (narrate-only)** — cited prose over deterministic facts. The **F3 contract test** proves the
  numbers are identical with AI on and off; `AI_MODE=off` is the default and the product is complete.
- **Human gate** — alerts are DRAFT until a named, authenticated role approves; SOS reports influence
  nothing until a human verifies; vision findings are advisory chips, never decisions.

---

## 5. Engineering method — full SDLC, AI-assisted, human-gated (GABBE)

The product was built under **GABBE**, the author's agentic-SDLC governance framework — the same
*deterministic → AI → human* principle the product itself enforces, applied to its own construction:

- **Structured SDLC**: S00 discovery → requirements (EARS) → architecture (C4 + 38 ADRs) → spec →
  task decomposition (~500 atomic tasks, `project/TASKS*.md`) → test-first build waves → audits →
  go-live — the full golden thread *requirement → ADR → spec → test → code* is preserved in this repo.
- **AI-assisted, never AI-trusted**: agents wrote code under frozen operational law, with quality gates
  (types, lint, 99 % coverage floors, boundary checks, golden tests) that no change may weaken; every
  external fact was verified against the real provider (per-row verdicts in
  `audit/DATA_SOURCE_VERIFICATION.md`; zero fabricated facts — `docs/audit/EXTERNAL_VERIFICATION.md`).
- **Human-gated**: every commit, baseline, release and public action was taken by the human author;
  audits (`docs/audit/`) record findings *and their resolutions* rather than hiding them.
- **Honesty as a gate**: the register of everything declared-but-not-real
  (`docs/audit/UNIMPLEMENTED_REGISTER.md`) is maintained and re-verified like code. See §7.

Principles of record: [docs/ENGINEERING_PRINCIPLES.md](docs/ENGINEERING_PRINCIPLES.md) ·
architecture: [docs/architecture/](docs/architecture/) · CI/CD standard: [docs/CI_CD.md](docs/CI_CD.md).

---

## 6. Production readiness — run it, test it, operate it

| Surface | Where |
|---|---|
| **Live cloud deployment** | https://quest-beacon.up.railway.app — production posture (dev seams hard-off), named-account sign-in, Postgres-durable |
| One-command local reproduction | `npm run docker:up` (Postgres + migrations + seeds + app); air-gapped mode works with zero config |
| Cloud deploy runbook | [docs/CLOUD_DEPLOY_RAILWAY.md](docs/CLOUD_DEPLOY_RAILWAY.md) |
| CI (blocking) | `.github/workflows/ci.yml` — static, unit (+coverage floors), build, integration (real Postgres, 19-table assertion), browser (Playwright), security (gitleaks, CodeQL, OSV, npm audit) |
| Operator guide | [docs/OPERATOR_GUIDE.md](docs/OPERATOR_GUIDE.md) — the monitor→assess→decide→act workflow |
| Live-test runbooks | [docs/FINAL_LIVE_TEST_AND_DEMO.md](docs/FINAL_LIVE_TEST_AND_DEMO.md) (scenarios A–Y incl. every key needed) · [docs/E2E_TESTING_PLAYBOOK.md](docs/E2E_TESTING_PLAYBOOK.md) · [docs/VISUAL_LIVE_TEST_PLAN.md](docs/VISUAL_LIVE_TEST_PLAN.md) |
| Security & threat model | [SECURITY.md](SECURITY.md) · [docs/SECURITY_BASELINE.md](docs/SECURITY_BASELINE.md) · [docs/architecture/THREAT_MODEL.md](docs/architecture/THREAT_MODEL.md) |
| Responsible data & AI | [docs/RESPONSIBLE_DATA.md](docs/RESPONSIBLE_DATA.md) · compliance matrix in `docs/architecture/` |
| Sustainability | `GET /.well-known/sustainability` (ADR-020) · [docs/SUSTAINABILITY.md](docs/SUSTAINABILITY.md) |

**Maintainability**: hexagonal boundaries are machine-enforced, every adapter is swappable behind a
port, configuration covers every knob (12-factor), and the coverage floors + golden tests make
regressions loud. Adding a hazard, region, locale or source is configuration plus one adapter — the
extension path the Phase-2 entry promised.

---

## 7. Honest limitations (stated openly — this ledger is part of the product's integrity)

The authoritative ledgers are `docs/SPEC.md` §13 and `docs/audit/UNIMPLEMENTED_REGISTER.md`. Headlines:

- Five dock panels (supplies, volunteer teams, shelter status, damage reports, CEMS damage overlay)
  are **fixture-fed** — no source adapter exists for them; their provenance honestly says MOCK.
- Three coordination modules are **not composed by plan**: rumor board, mutual aid, reunification links.
- `hifld` infrastructure is registered but **held** out of every region (2019 snapshot would displace
  fresher seeded data; needs merge-not-replace).
- **EFFIS is CACHED-only** (its former endpoint is confirmed dead upstream); **ITU and CAMARA/GSMA are
  MOCK-only by design** (operator/data agreements required).
- The EAGLE-I outage layer is an **inference** ("ASSUMED offline"), county-granular — not per-address.
- Forecast evidence (lead time, likelihood) is computed but **not yet served** over the API.
- The LLM likelihood-word guard covers **English narration only**.
- `evac_route` and `sitrep`/`citation` Postgres stores exist but are **not yet wired** into the
  serving path (two recorded FK defects block naive wiring); logistics durability requires
  `FEATURE_STORE=postgres`.

Each limitation is labelled **in the running product** wherever it surfaces — the app never claims
LIVE for CACHED/MOCK, and no figure appears without its method and unit.

---

## 8. What is genuinely new here (innovation summary — each item verifiable in this repo)

1. **Citations as a structural type, not a style** — a SitRep field without `citations[]` renders as an
   error. Grounding is enforced by the compiler and the renderer, not by prompt engineering.
2. **The F3 contract**: AI-on == AI-off for every number, provable in one toggle. The LLM is a
   narrator with no arithmetic authority — a deployable answer to AI hallucination in crisis tooling.
3. **Honesty as a first-class UI element** — per-layer freshness, per-rung degradation labels,
   "ASSUMED", "Unverified", "not clipped to extent", engine naming on routes: the interface tells the
   operator what the system does *not* know.
4. **A register of everything declared-but-not-real**, maintained and re-verified like code — the
   opposite of demo-ware.
5. **Local-first ≈ $0 emergency infrastructure**: the full COP — prediction, routing, logistics,
   interop — runs air-gapped on one machine on free data, and identically in the cloud.
6. **Live Views**: live cameras and provider deep-links (Google Earth 3D, NASA FIRMS, Google Flood
   Hub) as first-class, provenance-disciplined map data — a novel-data-discovery layer delivered
   without embedding or scraping anyone's feeds.
7. **Governance drill mode** that *structurally* cannot reach a real alert channel — practice without
   risk, by construction.
8. **An agentic-SDLC-built product with a human gate on every action** — the build process itself
   demonstrates the responsible human-AI collaboration pattern the challenge asks products to embody.

---

## 9. Roadmap (post-submission, in the open)

Tracked in [docs/features/ROADMAP-POST-V1.md](docs/features/ROADMAP-POST-V1.md); near-term:
hifld merge-not-replace integration · sitrep/citation FK-safe persistence wiring · evac-route
persistence · EFFIS endpoint re-point · forecast evidence on the wire · multilingual likelihood
guard · Valhalla/OSRM self-hosted routing rung · production IdP integration. None blocks the
submitted product; saying so openly is part of the honesty posture above.

---

*Every claim in this document is traceable to a file, test, gate or runbook in this repository, and
the running product at the live URL. Where a capability is partial, §7 says so. Nothing here is
aspirational: if it is listed as shipped, it is in the code, gated, and reproducible.*
