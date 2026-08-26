# BEACON — Judge Matrix (IEEE Response Quest 2026 · Phase 3 · Entry #5320)

**BEACON** — Browser-based Emergency Awareness & Coordination Open Network: an open-source,
local-first, near-real-time **common operating picture (COP)** for wildfires and floods, with cited AI
situational synthesis, human-gated alerting, evacuation routing and responder logistics.

| | |
|---|---|
| **Live deployment** | https://quest-beacon.up.railway.app — production posture; **access on request** (sign-in accounts provided with it) |
| **Repository** | https://github.com/andreibesleaga/QUEST-BEACON — **access on request**; not required — the uploaded archive is the complete, self-contained product |
| **Reproduce locally** | `npm run docker:up` → http://localhost:3000 — full COP with **zero keys, zero egress, ~$0** |
| **License / data** | Apache-2.0; 100 % open-source dependencies; free/open data sources only |
| **Phase-2 concept score** | **4.48 / 5** (Review Committee 1, 10 evaluators) — advanced to Phase 3 |
| **Entrant** | Andrei Nicolae Besleaga (individual entry, active IEEE member) |

> **Access.** Repository: https://github.com/andreibesleaga/QUEST-BEACON · Live deployment: https://quest-beacon.up.railway.app. Both are private during judging; **access is granted on request** (the sign-in accounts come with it). No access is needed to evaluate: **the uploaded archive is the complete, self-contained product** — `docker compose -f infra/docker-compose.yml up -d --build` reproduces the full COP with zero keys and zero network.

> **Submission cut-off & living repository.** The product submitted to the contest is the repository
> state at the submission tag — everything the judges evaluate is frozen there and reproducible from it.
> This repository then continues as the project's open-source home: post-submission fixes, versions and
> the roadmap ([docs/features/ROADMAP-POST-V1.md](docs/features/ROADMAP-POST-V1.md)) land here, openly.
> Judges are welcome to look at both: the tag is the entry; the repo is the project's life after it.

---

## Why this exceeds the brief

Every row below is **promise → what actually shipped**, and every one is verifiable in this repository or
on the live deployment right now.

| The Phase-2 concept promised | What is running today |
|---|---|
| A concept, to be built in Phase 3 | A **live, signed-in deployment** plus one-command local reproduction with **zero keys and zero egress** |
| "Some sources live, some cached or mocked" | **44 adapters**, honestly tiered — **35 can serve live**, 26 with no key at all |
| Demonstrated on US data | **5 regions on 3 continents · 14 locales** incl. RTL — a new region is a config entry, proven by a test |
| WCAG 2.1 AA | **WCAG 2.2 AA** with an **axe gate in CI** |
| AI-fused, cited situational report | Cited SitRep where the LLM is **structurally unable to emit a number** — provable in one toggle (AI-on == AI-off) |
| Human-in-the-loop before action | Enforced **at the type level**, behind a **fail-closed AI-compliance gateway** no adapter can bypass |
| CAP / EDXL interoperability | **CAP v1.2 + EDXL-RM + EDXL-SitRep round-trips**, schema-validated |
| Push, don't poll | Real **SSE push ~1.7 s**; time-to-trustworthy-picture **~1 s** against a < 10 s budget |
| Runs locally at near-zero cost | Runs **fully air-gapped** on one machine — the *same artifact* runs in the cloud |
| Modular adapter core | Hexagonal boundaries **machine-enforced**, 0 violations across 844+ modules |

**And several things the brief never asked for**, each working in the live demo: early-warning,
COP, cited synthesis and responder logistics on **one canonical model** (normally three or four separate
systems) · **anticipatory-action protocols** in the IFRC Early-Action-Protocol shape, as replaceable
config · **live camera layers and external context deep-links** (novel data with no scraping, no
embedding, no key) · **cross-domain corroboration** (air quality corroborating fire) · a **governance
drill mode that structurally cannot reach a real alert channel** · **role-scoped geometry** enforced
server-side · and a **`.well-known/sustainability` disclosure** an agency can audit programmatically.

Full detail: **§7 What is genuinely new** · evidence per criterion: **§2**.

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
| AI report where every claim links to its data; numbers from deterministic computation, LLM narrates, never invents | **Structurally enforced**: `citations[]` is required — an uncited SitRep field renders as an error; the news-fusion field is minted by a deterministic authority-ranked pass **before** the LLM; the **F3 contract** proves AI-on and AI-off produce identical numbers | AI probe against a **real cloud model** 2026-08-25: 28 citations, prose carries no figure, **F3 PASS** ([docs/audit/LIVE_VERIFICATION.md](docs/audit/LIVE_VERIFICATION.md)) · SitRep UI |
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
| **Live cloud deployment** | https://quest-beacon.up.railway.app — production posture (dev seams hard-off), named-account sign-in; runs the demo posture (in-memory seed) beside a migrated, seeded Postgres browsable in a Directus admin UI |
| One-command local reproduction | `npm run docker:up` (Postgres + migrations + seeds + app); air-gapped mode works with zero config |
| **Deploy anywhere** | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — local, any Docker host, Railway (reference: [docs/CLOUD_DEPLOY_RAILWAY.md](docs/CLOUD_DEPLOY_RAILWAY.md)), **Kubernetes manifests** (`infra/k8s/`, kustomize: migration Job, HPA, SSE-aware Ingress), Cloud Run / ECS / Fly |
| CI (blocking) | `.github/workflows/ci.yml` — static, unit (+coverage floors), build, integration (real Postgres, 19-table assertion), browser (Playwright), security (gitleaks, CodeQL, OSV, npm audit) |
| Operator guide | [docs/OPERATOR_GUIDE.md](docs/OPERATOR_GUIDE.md) — the monitor→assess→decide→act workflow |
| **Full-live production guide** | [docs/LIVE_PRODUCTION_GUIDE.md](docs/LIVE_PRODUCTION_GUIDE.md) — how to run BEACON as a real EWS: every live-capable source live, real PostgreSQL behind logistics/reports/audit, real AI, real alert delivery, real road routing, any region worldwide. **States the honest ceiling: 35 of 44 adapters can serve live** (26 keyless, 9 on free credentials); the other nine are named individually with their upstream evidence |
| Live-test runbooks | [docs/FINAL_LIVE_TEST_AND_DEMO.md](docs/FINAL_LIVE_TEST_AND_DEMO.md) (scenarios A–Y incl. every key needed) · [docs/E2E_TESTING_PLAYBOOK.md](docs/E2E_TESTING_PLAYBOOK.md) · [docs/VISUAL_LIVE_TEST_PLAN.md](docs/VISUAL_LIVE_TEST_PLAN.md) |
| Security & threat model | [SECURITY.md](SECURITY.md) · [docs/SECURITY_BASELINE.md](docs/SECURITY_BASELINE.md) · [docs/architecture/THREAT_MODEL.md](docs/architecture/THREAT_MODEL.md) |
| Responsible data & AI | [docs/RESPONSIBLE_DATA.md](docs/RESPONSIBLE_DATA.md) · compliance matrix in `docs/architecture/` |
| Sustainability | `GET /.well-known/sustainability` (ADR-020) · [docs/SUSTAINABILITY.md](docs/SUSTAINABILITY.md) |

**Demo posture vs production posture**: the public demo deliberately runs a mixed ladder (some
sources CACHED/MOCK) so it is reproducible offline, costs nothing, and cannot be broken by an upstream
outage mid-judging. `docs/LIVE_PRODUCTION_GUIDE.md` turns that ladder all the way up and documents
exactly where the ceiling is and why — the same honesty discipline applied to our own capability claims.

**Maintainability**: hexagonal boundaries are machine-enforced, every adapter is swappable behind a
port, configuration covers every knob (12-factor), and the coverage floors + golden tests make
regressions loud. Adding a hazard, region, locale or source is configuration plus one adapter — the
extension path the Phase-2 entry promised.

---

## 7. What is genuinely new here (innovation summary — each item verifiable in this repo)

**The one-sentence case.** Individually, several ideas below exist somewhere in the emergency-tech
landscape. What does not exist — and what this repository contains — is **all of them in one coherent
product**: a system that spans *early warning → common operating picture → cited synthesis → responder
logistics* on **one canonical domain model**, where every number is deterministic, every claim is
citable, every AI call passes a fail-closed governance proxy, every degradation is labelled on screen,
and the whole thing runs air-gapped on one machine at ≈ $0. The integration **is** the invention.

### 7.0 Scan table

| # | Innovation | Why it is unusual | Verify at |
|---|---|---|---|
| 1 | EWS + COP + SitRep + Logistics as **one model** | These are normally 3–4 separate procurements that integrate over brittle exports | §7.1 |
| 2 | AI compliance proxy with an **unforgeable capability seal** | AI governance as *running code that refuses*, not a policy PDF | §7.2 |
| 3 | **Citations as a structural type** | An uncited field renders as an error — grounding enforced by the compiler, not by prompting | §7.3 |
| 4 | **F3 contract**: AI-on == AI-off numbers | One toggle proves the LLM has no arithmetic authority | §7.3 |
| 5 | **Telecom-network signals as a domain port** (CAMARA/GSMA, OpenCelliD, ITU) | Operator-gated telco APIs modelled as first-class emergency data with an honest MOCK rung | §7.4 |
| 6 | **Channel-agnostic core** — one router, N channels | Same RBAC + provenance guarantees over HTTP, CLI and messaging | §7.5 |
| 7 | **Anticipatory action encoded as replaceable protocol config** (IFRC EAP shape) | Humanitarian doctrine as data, not hardcoded logic | §7.6 |
| 8 | **Role-scoped geometry**, server-side | Privacy-preserving spatial disclosure by actor role | §7.7 |
| 9 | **Cross-domain corroboration** (air quality corroborating fire) | Independent physical signals raising confidence without inventing a category | §7.8 |
| 10 | **Region portability proven by a test**, not claimed | Adding a zone on another continent is a config entry | §7.9 |
| 11 | **Honesty engineering** — machine-enforced | Architecture, drill isolation and unimplemented claims are all CI-gated | §7.10 |
| 12 | **Live Views** + external context deep-links | Novel data discovery with zero scraping and zero embedding | §7.11 |
| 13 | **Sustainability disclosure** in emergency software | `.well-known/sustainability` — a footprint an agency can audit | §7.12 |
| 14 | **Local-first ≈ $0**, cloud-identical | The same artifact runs air-gapped and in production | §7.13 |
| 15 | **Agentic SDLC with a human gate on every action** | The build method demonstrates the pattern the product enforces | §7.14 |

---

### 7.1 One model spanning early warning, COP, synthesis and logistics

In practice an agency buys an alerting/COP platform, a GIS stack, and a resource-management system
separately, then integrates them over exports — which is exactly the fragmentation the Phase-2 entry
identified. BEACON collapses that into **one canonical domain model and one response envelope**:

- the *same* hazard geometry that paints the COP feeds the prediction cone,
- the *same* prediction feeds the anticipatory trigger and the pre-positioning suggestion,
- the *same* exposure computation feeds the SitRep priority ranking,
- the *same* verified report is the only thing that can produce a CAP alert or task a resource,
- and the *same* provenance/freshness discipline applies to all of it.

There is no export step, no schema drift between subsystems, and no place for a number to change meaning
as it crosses a boundary — because it never crosses one. Outward interoperability is then a **choice**
(CAP v1.2, EDXL-RM, EDXL-SitRep round-trips), not a dependency.

**Why it matters operationally:** the chain *forecast → warning → picture → decision → tasking* is
traceable end-to-end for an after-action review, in one system, with one audit ledger.

### 7.2 AI governance that is running code, not a document

`src/adapters/compliance/` is a **mandatory reverse-proxy chokepoint in front of every LLM and Vision
call**, with a fixed pipeline: role-scope → rate-limit → circuit-breaker → semantic firewall → policy-as-code
→ PII detect/redact → cost guardrails → hash-chained audit → upstream → output firewall.

Three properties make it more than middleware:

1. **Safety stages fail CLOSED.** A detector error blocks the call. Availability stages (breaker,
   upstream) degrade down the AI ladder instead. The distinction is deliberate and tested.
2. **An adapter cannot bypass it.** The gateway mints an in-process **capability seal** (short-lived
   HS256 JWT under a process-local random secret, never sent over the wire); provider adapters refuse
   an unstamped call. This closes the "just call the SDK directly" bypass that defeats most AI policies.
3. **No audit write ⇒ no upstream call.** Every AI decision is committed to a tamper-evident
   hash-chained ledger (`hash = linkHash(prevHash, payload)`) *before* the model is reached, storing
   UUIDs and generalized fields only — no PII, no raw content. This is EU-AI-Act-Article-12-shaped
   record-keeping implemented as an enforced code path.

Add per-incident and per-region **hard cost ceilings** with a soft escalation threshold, and the result
is an AI integration an agency's risk officer can actually sign off on.

### 7.3 Grounding enforced by types, provable by a toggle

- **Citations are structural.** A SitRep field carries `citations[]` or it renders as an error. Grounding
  is a type-system and renderer guarantee — not a prompt asking a model to behave.
- **The news-fusion field is minted deterministically *before* the LLM** by an authority-ranked pass
  (OFFICIAL > MEDIA > SOCIAL, corroboration counted).
- **The F3 contract** — every number is identical with AI on and AI off — is verified by a shipped
  probe (`npm run ai:probe`) and provable live in one toggle in front of judges.

The LLM narrates. It has no arithmetic authority anywhere in the system. That is a deployable answer to
the single biggest objection to AI in crisis tooling, and it is falsifiable in ten seconds.

### 7.4 Telecom-network signals as a first-class emergency layer (CAMARA/GSMA)

The Phase-2 entry named CAMARA/GSMA Open Gateway as a novel source. It is delivered as a **real,
port-conforming adapter** (`TelecomPort` P13) beside OpenCelliD and ITU — and this is where the honesty
discipline shows its engineering value:

- CAMARA/GSMA APIs are **operator-gated**; there is no public keyless endpoint.
- So the adapter **refuses `SOURCE_CAMARA_GSMA_MODE=live` with a CONFIG error at boot** — fail-fast,
  never a silent no-op that fakes coverage data.
- The day an operator sandbox agreement exists, it serves through the *same port*, with **no core
  change** — the plugin claim, demonstrated rather than asserted.

Around it sits derived telecom intelligence no single feed publishes: cell coverage joined against the
hazard footprint, and a power-outage layer that produces an **"ASSUMED offline"** inference — explicitly
labelled as inference, at county granularity, never as observation. Naming the epistemic status of a
derived layer *in the UI* is rare, and it is what makes such a layer safe to act on.

### 7.5 A channel-agnostic core: one router, many ways in

Every channel — HTTP, CLI, and messaging (Telegram/WhatsApp) — funnels through **one command router**
that authorizes by RBAC rank, dispatches to the use-case, and returns **one universal Envelope**. The
router imports ports and domain only; adapter imports are blocked by lint *and* dependency-cruiser.

The consequence is operational, not architectural vanity: an emergency manager on a degraded connection
can drive the same authorized, audited, provenance-carrying core from a messaging app that a full EOC
drives from a browser — with identical guarantees, because it is literally the same code path. Public
alert broadcast rides the same seam, only ever *after* a human approves DRAFT → ACTUAL.

### 7.6 Anticipatory action encoded as replaceable protocol config

`config/eap/` carries five Early Action Protocols (US-CA, RO, ES, GR, PH) **structurally faithful to the
six IFRC EAP elements** — trigger thresholds, early actions, lead times, roles, ceilings, durations — as
*data*, evaluated by a deterministic trigger engine.

Each file is explicitly stamped `"status": "ILLUSTRATIVE"` with a provenance note stating that the
thresholds are invented for demonstration and **not approved by any National Society or hydromet
service**, and that a real deployment replaces the file with its own signed-off protocol. Encoding
humanitarian anticipatory-action doctrine as swappable configuration — and refusing to imply
endorsement — is both the technical and the ethical design.

### 7.7 Role-scoped geometry, enforced server-side

Precise report and PII-bearing geometry is **RESPONDER+ only, gated in the application layer**, not in
the client. The public COP shows generalized positions; responders see precise ones; the decision is
made once, server-side, keyed on the actor's role. A privacy control that lives in the browser is not a
privacy control — this one cannot be bypassed by reading the network tab.

### 7.8 Cross-domain corroboration between independent physical signals

Air-quality readings (OpenAQ / AirNow / Sensor.Community) corroborate fire activity — an *independent
physical measurement* raising or tempering confidence in a thermal hotspot. The discipline around it is
the interesting part: the system will surface a **source-published AQI** at or above a threshold, or a
**concentration** at or above a fixed constant, but it will **never derive an AQI category from a raw
concentration** — that would be inventing an official classification. Corroboration strengthens
confidence; it never manufactures authority.

### 7.9 Region portability proven by a test

Five zones across three continents (US-CA, RO, ES, GR, PH) run on the same engine. A region is a
`config/regions.json` entry — bbox plus an **ordered** `enabled_adapters` list where order *is*
precedence (first adapter to serve a slot wins it; all consulted are cited in order). US-only sources
report `NOT_COVERED` outside their coverage instead of fabricating.

`tests/zones/add-a-zone.test.ts` asserts the property directly: adding a zone requires **no code
change**. "Portable to any region" is the kind of claim that is usually asserted in a slide; here it is
a failing test if it stops being true.

### 7.10 Honesty engineering — enforced by machines, not good intentions

The rarest thing in this repository may be that **it is hard to lie in it**:

- **Hexagonal boundaries** are machine-enforced (dependency-cruiser, 0 violations across 844+ modules).
- **Drill mode structurally cannot reach a live channel** — a dependency-cruiser rule fails the build if
  exercise/anticipatory code so much as imports a messaging transport. Practice without risk, by
  construction rather than by discipline.
- **The unimplemented register** tracks everything declared-but-not-real and is re-verified against code
  like a test — the register itself once caught documentation that had gone *stale in the optimistic
  direction*, and that correction is recorded.
- **Coverage floors** (99/99/99/99 on domain and application) are never lowered; CI caught a real drift
  to 98.97% and it was fixed with tests, not by moving the floor.
- **Adapter registry integrity** is a test: `config/adapters.json` ↔ factories must match exactly, 44↔44.
- **The API cannot document what it does not serve** — zero `x-status: planned` in OpenAPI.

### 7.11 Live Views and external context — novel data without scraping

Live fire, traffic and webcam feeds (ALERTCalifornia, Caltrans, state 511, Windy) appear as
provenance-disciplined **map pins that open the provider's own page**, plus 11 coordinate deep-links per
incident (Google Earth 3D, NASA FIRMS worldwide fires, Google Flood Hub). No embedding, no scraping, no
key, no egress, no re-hosting of anyone's imagery — and no engine or AI ever reads a pixel from them
(advisory-not-fact). Novel data discovery that is also licence-clean is a harder problem than it looks,
and the deep-link coordinate order for each provider was verified against the provider's own client code
rather than its documentation.

### 7.12 Sustainability disclosure in emergency software

`GET /.well-known/sustainability` (ADR-020) publishes the deployment's own environmental disclosure at a
machine-readable well-known URI. Emergency systems essentially never report their own footprint; making
it auditable — in a product whose ≈$0, single-machine profile is already a resource-efficiency argument —
turns a claim into something a procuring agency can verify programmatically.

### 7.13 Local-first ≈ $0 infrastructure, cloud-identical

The complete product — COP, prediction, SitRep, routing, logistics, interop — runs **air-gapped on one
machine** with `AI_MODE=off` and every source on fixtures, and the *same artifact* runs in the cloud
with everything live (see `docs/LIVE_PRODUCTION_GUIDE.md`, which documents both postures and states the
honest live ceiling: **35 of 44** adapters can serve live, with the other nine named individually). For
an under-resourced agency, a disconnected field deployment and a funded EOC are the same software.

### 7.14 An agentic SDLC with a human gate on every action

The product was built through a governed agentic SDLC (deterministic → AI → human) in which **no agent
ever committed, pushed, published or re-minted a baseline** — every such action was taken by the human
entrant. The build process embodies the same deterministic-first, human-gated pattern the product
enforces at runtime, and its durable outputs are the committed ADRs, audits and ledgers in this repo.

## 8. Roadmap (post-submission, in the open)

Tracked in [docs/features/ROADMAP-POST-V1.md](docs/features/ROADMAP-POST-V1.md); near-term:
hifld merge-not-replace integration · sitrep/citation FK-safe persistence wiring · evac-route
persistence · EFFIS endpoint re-point · forecast evidence on the wire · multilingual likelihood
guard · Valhalla/OSRM self-hosted routing rung · production IdP integration. None blocks the
submitted product; saying so openly is part of the honesty posture above.

---

*Every claim in this document is traceable to a file, test, gate or runbook in this repository, and
the running product at the live URL. Where a capability is partial, §7 says so. Nothing here is
aspirational: if it is listed as shipped, it is in the code, gated, and reproducible.*

---

## 9. Honest limitations (stated last, on purpose — and stated openly)

Everything in §1–§8 is built, tested and running. This closing section is the short list of what is
**not**, because a system meant for emergencies must never overstate itself — and because the discipline
of saying so is itself part of what is being submitted. None of it blocks the delivered product.

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
