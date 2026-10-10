# BEACON — Product Requirements Document (S01)

*IEEE Response Quest 2026 · Phase 3 · GABBE SDLC S01 (Requirements). Spec-driven: these requirements
drive evals → tests → code. Supersedes the concept-level `../../../Phase2/submission/PRD.md` with locked,
testable requirements. Inputs: S00 discovery + `../../audit/{PHASE2_AUDIT,CLARIFICATIONS,
DATA_SOURCE_VERIFICATION}.md`. Gate: HUMAN APPROVAL before S02.*

---

## 1. Feature summary (the product)

BEACON is an open-source, local-first, near-real-time **common operating picture** for wildfires and
floods. It unifies free/authoritative data behind a pluggable adapter spine, computes exposure/risk
deterministically, narrates it as a **source-cited** AI situational report, and ties it to **responder
logistics** — with **total redundancy** (works offline/local and when any provider/API is down) at
essentially zero cost, portable to any region.

## 2. Problem statement

See `../discovery/PROBLEM_STATEMENT.md`. In one line: decision-makers under time pressure have no single,
trustworthy, real-time picture — the bottleneck is **integration + synthesis + decision-support +
logistics**, not raw data.

## 3. Personas & user stories

| Persona | Story |
|---|---|
| **Emergency Manager (EOC)** | *As an EM, I want a synthesized, cited situational picture with ranked priorities and resource posture, so I can make defensible decisions fast without juggling six tools.* |
| **First Responder / IC** | *As an IC, I want precise hazard geometry, exposed assets, and a hazard-avoiding route on any device — even offline — so I can act and keep crews safe.* |
| **Public reporter** | *As an affected resident, I want a simple, consented way to report I'm in danger and trust it reaches responders, so I can get help.* |
| **Integrator (another agency)** | *As an integrator, I want to add a regional data source as an adapter and consume CAP/EDXL, so BEACON fits my region and tools.* |

## 4. Scope — flagship features (v1, golden path)

1. **Unified Live Geospatial COP** — region select (community/state/country); toggleable timestamped
   layers: active fire + perimeters, flood gauges/forecasts, weather/alerts, infrastructure, power
   outages (derived), cell coverage; freshness on every layer; responsive desktop/tablet/phone.
2. **AI Situational-Intelligence Fusion + Insight Engine ⭐** — fuse authoritative news + vetted social +
   geospatial risk-intersection → ranked, **cited** SitRep + escalation trend; misinformation flagged;
   threshold-triggered early-warning alerts.
3. **Responsible Crowdsourced SOS Intake + Evacuation Routing** — consented web/SMS report → AI
   geocode/triage/confidence → human verify → CAP; hazard-avoidance routing + nearest shelters.
4. **Responder Comms, Logistics & Resource Management ⭐** — resource registry (crews, apparatus,
   aircraft, medical, shelters, supplies) with status+location; tasking lifecycle; shelter
   capacity-vs-demand; **full EDXL-RM mutual-aid round-trip** + EDXL-SitRep + CAP.

Cross-cutting (apply to all four): **provenance/citations**, **deterministic→AI→human handshake**,
**total redundancy/offline**, **multi-modal/vision (advisory, stretch)**, **config-for-everything**.

### 4.1 Delivery status (Phase-D "deliver the over-claims", 2026-07) — flagship claims now TRUE

All four flagship features are **built and verified end-to-end** (gates green; see
`../E2E_TESTING_PLAYBOOK.md`). The two capabilities previously scoped as
roadmap are now **delivered**, with their honest caveats kept:

- **Flagship 2 — AI fusion (news/social) is REAL.** `src/application/sitrep-synthesis/news-grounding.ts`
  mints deterministic `GroundedFact[]` from authoritative news + vetted social (GDELT, ReliefWeb, agency-RSS,
  Bluesky, MeteoAlarm-RO) **before the LLM runs**: authority-ranked (OFFICIAL > MEDIA > SOCIAL; unknown
  provenance treated as SOCIAL), corroboration-counted across distinct authoritative outlets, and
  **misinformation flagged, not merged** (an uncorroborated/low-authority SOCIAL claim is surfaced as a flag,
  never trusted or counted — Art. XIV). Because facts are deterministic, **AI-on == AI-off** (F3). The
  verifier queue renders the confidence components + the misinfo-reject affordance
  (`app/_components/panels/verifier-queue.tsx`). *(Caveat kept: Bluesky is MOCK-by-default — LIVE-capable,
  corroboration-only; X/Twitter excluded, Art. XIV.)*
- **Flagship 3 — hazard-avoiding evacuation routing is REAL road routing.** `src/adapters/routing/ors-routing.ts`
  implements `RoutingPort` against OpenRouteService `POST /v2/directions` with `avoid_polygons` from the hazard
  footprint, selected by `FEATURE_ROUTING=ors` + `ORS_API_KEY` (`src/main/feature-seed.ts`), degrading to the
  hazard-avoiding heuristic on any ORS failure (Art. XVI). *(Caveat kept: the UI does not yet distinguish an
  ORS route from the heuristic one — `EvacRoute` carries no method field.)*
- **Prediction (EV8) — NFHL∩crest is REAL.** `projectFloodZoneImpact` (`src/application/derivation/derive-cop.ts`)
  intersects FEMA NFHL flood zones with the NWPS crest-driven extent, labeled method/inputs/uncertainty, with
  the fallback ladder intact — making the flagship-3 prediction claim true.
- **COP layers (Flagship 1)** — outage ("ASSUMED offline" honest labels), cell, weather (wind glyph at the
  observation point, never a synthesized grid), and flood-zone (NFHL regulatory-zone caveat) render
  end-to-end with **per-layer freshness badges** (`app/_lib/map-data.ts`,
  `app/_components/map/build-layers.ts`).
- **Sources** — **30 adapters are wired**; **28 are consumed**. *(Recounted 2026-08-02, lens-7 F-411 class;
  this bullet read `27 wired / 24 consumed`, which predated the three B3 aggregators `meteoalarm-es`,
  `meteoalarm-gr`, `wmo-swic` and carried a stale consumed-set.)* **How to re-derive:** wired =
  `config/adapters.json → adapters.length` = 30 = the entry count of `ADAPTER_FACTORIES`
  (`src/main/adapter-registry.ts:56-94`; equality asserted in `adapter-registry.test.ts:54`). Consumed = the
  union of `enabled_adapters` over the five shipped zones in `config/regions.json` = **28** — that allowlist
  is the thing `buildAdapterRegistry` filters on (`adapter-registry.ts:151-155,182`), so it, not prose, is
  the definition of "consumed". Composition entry points: `src/main/live-seed.ts`, `src/main/adapter-registry.ts`.
  The set includes NIFC/WFIGS + EFFIS fire **perimeters** merged beside FIRMS hotspots (closing the "FIRMS ≠
  perimeters" gap). **Not consumed — exactly two: ITU and CAMARA/GSMA**, the operator/data-gated
  **MOCK-only plugins**, wired and mock-consumable **by design**, not on the COP. `usgs-water` is **no longer**
  in that list — the region-generic engine now consults it for `us-ca`'s gauge slot, and it appears in the
  `us-ca` allowlist. Honest tiers kept: EFFIS is **CACHED-only** (endpoint unconfirmed); each has a
  documented flag-to-live path (`SOURCE_*_MODE`).
- **Interop/logistics** — a **real Telegram broadcast** of approved-ACTUAL alerts (Bot API, HITL-gated,
  subscriber registry, secret-verified webhook + poller; mock default) and **pre-positioning-from-predictions**
  advisory suggestions on the logistics board (`GET /pre-positioning`).

## 5. EARS requirements

> Notation: **U**=ubiquitous, **EV**=event-driven, **ST**=state-driven, **OP**=optional/feature-flag,
> **UW**=unwanted-behavior. Each FR maps to ≥1 EARS line and gets ≥1 Gherkin scenario at S03 (BDD gate).
>
> **Extension (2026-07-26):** the requirements for the FINAL COMPLETE VERSION feature (localization,
> global zones + storm hazard, prediction probability, and the innovation differentiators) live in
> [`EARS_FINAL_VERSION.md`](./EARS_FINAL_VERSION.md) — namespaced FR groups (`FR-I18N/ZONE/STORM/PRED/
> AA/PAP/WARN/GOV/D4/D6-*`) with their own `FU/FEV/FST/FOP/FUW` EARS lines. That file extends this one;
> nothing in §5 below is superseded. Master plan: `../../../CURRENT-MASTER-PLAN.md`.

### 5.0 Canonical functional requirements (FR-1…FR-13) → EARS → feature (golden thread)

| FR | Requirement | EARS | Flagship | Rubric |
|---|---|---|---|---|
| FR-1 | Select a region and see all relevant layers | EV1 | COP | 1,4 |
| FR-2 | Each layer shows source + last-updated; stale/unavailable marked | U4 | COP | 1 |
| FR-3 | Compute infrastructure/people exposure via hazard-geometry intersection | EV2 | COP/AI | 3 |
| FR-4 | Generate a cited AI SitRep + ranked priorities + escalation trend | EV3, U2 | AI SitRep | 3,5 |
| FR-5 | Public submits consented report → Unverified + confidence | EV4 | SOS | 3 |
| FR-6 | Verifier approves/rejects; approval may emit CAP | EV5, ST1 | SOS | 3 |
| FR-7 | Suggest evacuation routes avoiding hazard + nearest shelters | EV7 | SOS/Logistics | 5 |
| FR-8 | Register/locate/task resources; track shelter capacity | EV9 | Logistics | 5 |
| FR-9 | Express events as CAP; resources/sitreps as EDXL (full mutual-aid) | EV10 | Logistics | 3,5 |
| FR-10 | Add data sources as adapters via manifest with zero core change | OP2, OP3 | (all) | 2 |
| FR-11 | Threshold-triggered early-warning alerts (DRAFT) | EV6 | AI SitRep | 1,5 |
| FR-12 | Predictive/modeling layer (labeled first-order, method+inputs+uncertainty) | EV8 | AI SitRep | 5 |
| FR-13 | Decision support (deterministic numbers + AI narration, human-approved) | U3, EV3 | AI SitRep | 3,5 |
| FR-15 | AI compliance proxy + tiered governance — every LLM/vision call gated through the `AICompliancePort` (firewall/PII/policy/audit, fail-closed); budget HITL-above-threshold | U7, EV11 | (all AI) | 3,5 |
| (cross) | Total redundancy / works-in-all-cases | UW1–UW4, OP1–OP4 | (all) | 1,4 |

**Core FRs = FR-1…FR-13 + FR-15** (these define the demo's acceptance). The two items below are
**OUT-OF-CORE, OPTIONAL PLUGINS — basic/summarized *alignment examples*, NON-BLOCKING** for the demo
(they ride BEACON's hexagonal adapter/plugin spine and exist to demonstrate alignment, not as built-in
features or acceptance gates):

| Plugin (out-of-core, non-blocking) | What it demonstrates | EARS | Status |
|---|---|---|---|
| **FR-14 · Sustainability-reporting plugin** — a minimal `GET /.well-known/sustainability` example (author's Internet-Draft v05 + author's SFC profile 1.1; recognized standards GSF SCI / CSRD), **modeled/estimated** energy+carbon | compliance + **sustainability** alignment (GSF SCI / CSRD), UN-SDG fit | EV12 (opt) | basic example only; not core; I-D/profile are author-originated (ADR-020) |
| **FR-16 · CAMARA `TelecomPort` plugin** — aggregate-only telecom signal; **MOCK now**, flag-to-live | **adapter/plugin extensibility** + innovative **mobile-API** usage (population density / connectivity), UN-SDG fit | OP6 | mock example only; live = post-v1 |

### 5.1 Ubiquitous (always applies)
- **U1** THE SYSTEM SHALL attach `provenance[]` (→ SOURCE_RECORD: source, adapter, fetched_at, license)
  and a `freshness` timestamp to every data response.
- **U2** THE SYSTEM SHALL attach `citations[]` (→ SOURCE_RECORD) to every field of a generated SITREP.
- **U3** THE SYSTEM SHALL compute all numbers, rankings, distances, exposures, and scores
  deterministically (Turf/SQL/typed code), never via the LLM.
- **U4** THE SYSTEM SHALL display each layer's source and last-updated time, marking stale/unavailable
  layers explicitly.
- **U5** THE SYSTEM SHALL read all models, providers, API bases, keys, feature flags, per-source modes,
  and regions from configuration (no hardcoding); invalid/missing required config SHALL fail fast at boot.
- **U6** THE SYSTEM SHALL meet WCAG 2.2 AA (contrast, keyboard nav, screen-reader labels, no
  color-only meaning) and be responsive across desktop/tablet/phone.
- **U7** THE SYSTEM SHALL route every LLM and vision call through the mandatory `AICompliancePort`
  compliance proxy (JWT/role-scope → breaker → semantic firewall → policy-as-code → PII detect+redact →
  hash-chained audit → upstream); PII-egress and prompt-injection controls SHALL be **fail-closed** (a
  control failure blocks the call), while availability degrades down the AI ladder. *(FR-15; ADR-017)*

### 5.2 Event-driven (triggered by an event)
- **EV1** WHEN a region is selected, THE SYSTEM SHALL load all relevant layers for that region with
  freshness timestamps. *(FR-1)*
- **EV2** WHEN new hazard/exposure data arrives, THE SYSTEM SHALL recompute exposure (infrastructure/
  people inside hazard geometry) and push deltas to subscribed clients. *(FR-3)*
- **EV3** WHEN a SitRep is requested/refreshed, THE SYSTEM SHALL generate a cited SitRep + ranked
  priorities + escalation trend. *(FR-4)*
- **EV4** WHEN a public report is submitted with consent, THE SYSTEM SHALL store it as `UNVERIFIED`,
  AI-triage it (geocode, urgency, confidence with components), and surface it badged "Unverified". *(FR-5)*
- **EV5** WHEN a VERIFIER approves a report, THE SYSTEM SHALL allow a CAP alert to be emitted; WHEN
  rejected, THE SYSTEM SHALL mark it Rejected/misinformation. *(FR-6)*
- **EV6** WHEN a gauge crosses a configured flood category, or a hazard polygon enters an infrastructure
  buffer, THE SYSTEM SHALL fire a THRESHOLD_RULE creating a **DRAFT** ALERT with provenance. *(FR-11)*
- **EV7** WHEN an evacuation route is requested, THE SYSTEM SHALL return a route that avoids the hazard
  polygon plus the nearest shelter(s). *(FR-7)*
- **EV8** WHEN authoritative forecasts arrive, THE SYSTEM SHALL produce labeled first-order projections
  (wind-buffer fire cone; NWPS-crest ∩ FEMA NFHL inundation; impact-over-time), each with method,
  inputs, and uncertainty. *(FR-12)*
- **EV9** WHEN a resource is registered/tasked, THE SYSTEM SHALL track its status+location through the
  RESOURCE_TASK lifecycle (PROPOSED→TASKED→ENROUTE→ONSCENE→CLEARED). *(FR-8)*
- **EV10** WHEN a mutual-aid resource request/commit/response is exchanged, THE SYSTEM SHALL import/export
  it as **EDXL-RM**; situation summaries as **EDXL-SitRep**; alerts as **CAP v1.2**. *(FR-9, U1 decision)*
- **EV11** WHEN the cumulative reserved AI cost for a call meets/exceeds `BUDGET_ESCALATION_THRESHOLD_USD`
  (or would exceed a per-incident/per-region cap), THE SYSTEM SHALL block the call and require human
  approval before dispatch (soft-within-budget, HARD-BLOCK over threshold/cap; safety always fail-closed).
  *(FR-15; ADR-018)*
- **EV12 (optional plugin — out-of-core, non-blocking)** WHERE the sustainability plugin is enabled
  (`SUSTAINABILITY_ENABLED`), WHEN `GET /.well-known/sustainability` is requested, THE SYSTEM SHALL return
  a v05-conformant, schema-validated, **modeled/estimated** energy+carbon report (`measurement-method:
  third-party-modeled`, `methodology-uri` → docs/SUSTAINABILITY.md) — a single object, or an array for a
  `granularity` trend — heavily cached, zero per-request overhead. *(FR-14; ADR-020 — basic alignment
  example only, not a core acceptance gate.)*

### 5.3 State-driven (while in a state)
- **ST1** WHILE a report is `UNVERIFIED` or `TRIAGED`, THE SYSTEM SHALL NOT emit any outbound CAP/EDXL or
  task any resource from it.
- **ST2** WHILE an infrastructure node's relationship to a hazard is AT_RISK/OFFLINE, THE SYSTEM SHALL
  reflect it on the COP and in exposure rankings.
- **ST3** WHILE precise personal location/contact exists, THE SYSTEM SHALL expose it only in the
  responder-authenticated view; public views SHALL show generalized location only.

### 5.4 Optional / feature-flag (redundancy ladders — Constitution XVI)
- **OP1** WHERE `FEATURE_VISION=on`, THE SYSTEM SHALL run advisory, cited, confidence-scored vision
  analysis (satellite burn-area/flood-extent; consented SOS-photo classification) feeding the verify
  pipeline; vision SHALL never auto-alert or override deterministic geometry.
- **OP2** WHERE `FEATURE_QUEUE=bullmq`/`FEATURE_SPATIAL=postgis`/`FEATURE_CACHE=redis`/
  `FEATURE_REALTIME=polling`/`FEATURE_ROUTING=ors|heuristic` (ORS road routing delivered; self-host
  Valhalla/OSRM is the documented no-limits ladder), THE SYSTEM SHALL use the selected implementation behind
  the same port with identical behavior contracts.
- **OP3** WHERE `SOURCE_<NAME>_MODE=cached|mock`, THE SYSTEM SHALL serve last-known-good or recorded
  fixtures for that source, labeled with freshness.
- **OP4** WHERE a region selects a source whose coverage does not apply, THE SYSTEM SHALL mark the layer
  "not available in this region" and use a global-equivalent adapter where one exists.
- **OP5** WHERE a vision/LLM provider and model are configured (`VISION_PROVIDER`/`VISION_MODEL`,
  `LLM_TIER_*`), THE SYSTEM SHALL switch provider/model/base/key entirely via environment with zero code
  change — including a **Google Gemma** vision/text profile and local Gemma/PaliGemma/LLaVA on Ollama —
  preserving the cloud → local → skip ladder. *(ADR-008a)*
- **OP6** WHERE `SOURCE_CAMARA_MODE=live` and a GSMA Open Gateway agreement exists, THE SYSTEM SHALL use a
  live operator sandbox for aggregate-only telecom signals (no individual tracking); the **default is
  `mock`** (free/offline demo), live→cached→mock ladder. *(FR-16; ADR-021)*

### 5.5 Unwanted behaviors (negative requirements)
- **UW1** IF the configured LLM provider is unavailable, THEN THE SYSTEM SHALL descend the AI ladder
  (cloud → alt → local Ollama → deterministic-only) and SHALL still return ranked priorities.
- **UW2** IF a primary data source is unreachable, THEN THE SYSTEM SHALL fall through to secondary/
  global-equivalent → cache → mock → "unavailable + freshness" — never a UI dead-end.
- **UW3** IF the LLM returns output failing JSON-schema/citation validation, THEN THE SYSTEM SHALL reject
  it and fall back to the deterministic insight layer (no ungrounded free-form text).
- **UW4** IF there is no internet/cloud (air-gapped), THEN THE SYSTEM SHALL still serve the COP,
  deterministic insights, and cached/mock layers using local Ollama (or AI-off).
- **UW5** IF a report is unverified, THEN no automated outbound action SHALL occur (reinforces ST1).
- **UW6** THE SYSTEM SHALL NOT retain reporter PII beyond the incident lifecycle, log PII, or perform
  IPAWS-authority origination.

## 6. Acceptance criteria (product-level; per-FR Gherkin at S03)

- **North-Star:** Time-to-Trustworthy-Picture < 10s on live primary sources (region open → cited SitRep +
  ranked priorities).
- **Golden path** (demo): COP open → cited SitRep → threshold alert fires (DRAFT) → insight flags N
  nursing homes in fire buffer, 1 without power → consented SOS arrives → AI-triaged → human-verified →
  evac route drawn around hazard + resources tasked → CAP emitted. All 4 flagship features exercised.
- **Coverage:** 100% citation coverage on SITREP; 100% provenance+freshness on data responses; **0
  LLM-invented numbers**; ≥99% test line coverage.
- **Redundancy (3 mandatory acceptance tests):** (a) offline/air-gapped, (b) every primary source
  blocked, (c) AI disabled — each still serves a usable COP + ranked decisions.
- **Multi-region:** California flagship region LIVE + one non-US (EU flood) region on CACHED data.

## 7. Data model (sketch)

Canonical entities (canonical ER now in `../architecture/DOMAIN_MODEL.md`; DDL at S03):
`REGION, INCIDENT, HAZARD_GEOMETRY, GAUGE, INFRASTRUCTURE_NODE, EXPOSURE, PREDICTION, PUBLIC_REPORT,
SITREP, CITATION, SOURCE_RECORD, ALERT, THRESHOLD_RULE, RESOURCE, RESOURCE_TASK, SHELTER, EVAC_ROUTE,
APP_USER, AUDIT_EVENT`. Every datum anchors to `SOURCE_RECORD`; every SITREP field to `CITATION`.

## 8. API surface (sketch)

REST (OpenAPI 3.1 at S03): `GET /regions/:id/incidents`, `GET /incidents/:id`,
`GET /incidents/:id/sitrep`, `GET /incidents/:id/exposure`, `POST /reports`, `PATCH /reports/:id`,
`POST /routes`, `GET|POST /resources`, `POST /resource-tasks`, `POST /alerts` (CAP v1.2),
EDXL-RM import/export endpoints, `GET /stream` (SSE delta channel, keyed by region). Every response
carries `provenance[]` + `freshness`; SitRep carries `citations[]`.

> ⚠️ **Implementation note appended 2026-08-01 (findings F-323 / F-401) — this sketch is DESIGN intent,
> and two of the paths above are NOT SERVED by the shipped v1 app.** `GET /incidents/:id` and
> `GET /incidents/:id/exposure` both return `404 NOT_FOUND`: the router matches only 1- and 3-segment
> GET paths (`src/adapters/channels/http/routing.ts:117-121`), and the only 3rd segments it accepts are
> `sitrep` (`routing.ts:111-113`) and `map` / `edxl/rm` / `summary`
> (`src/adapters/channels/http/routes/feature-router.ts:507-509`). Three further catalog paths outside
> this sketch are unserved for the same reason (`GET /threshold-rules`, `GET /audit-events`,
> `GET /health/adapters`). **`GET /incidents/:id/exposure` is the endpoint named by the FR-3 golden
> thread**, so that thread cannot be walked end-to-end with `curl` as written — the exposure ENGINE does
> ship and reaches users as `exposure[]` on `GET /regions/:id/map`
> (`feature-router.ts:507` → `routes/map.ts:38` → `src/application/map-projection/map-projection.ts:511`).
> Nothing above is deleted, because the promise itself is the limitation worth recording. Full ledger with
> the served-surface contrast: **`docs/SPEC.md` §13.11**; the honest per-path markers are already in
> `docs/api/openapi.yaml` (`x-status: planned`).

## 9. Data scope (sources by tier — see `docs/audit/DATA_SOURCE_VERIFICATION.md`)

> First-class **free-world** data only (Constitution XI). The per-source **LIVE/CACHED/MOCK** tier
> verdicts are single-sourced (verified) in
> [`docs/audit/DATA_SOURCE_VERIFICATION.md`](../audit/DATA_SOURCE_VERIFICATION.md) — the full
> source-by-source enumeration is **not duplicated here**. Headline: a **LIVE** golden-path set for the
> California flagship (FIRMS/NWS/NWPS/USGS/Overpass/GDELT/ReliefWeb/ORS + GDACS/Open-Meteo global
> secondary-LIVE), a **CACHED** tier for snapshot/periodic and non-US sources (incl. Copernicus
> EFFIS/GloFAS for the EU flood region), and a **MOCK** tier for gated/optional sources.

- **Hazard-specific fields:** wildfire — track, location, direction, speed, intensity; flood — stage vs
  flood levels, rate of rise/fall, expected crest & time, expected-damage areas.

## 10. Non-functional requirements

| Attribute | Target |
|---|---|
| Latency | UI deltas pushed within seconds of ingestion (SSE); no UI block on upstream; TTTP < 10s |
| Reliability | Per-adapter retries/circuit-breaker + last-known-good cache; total-redundancy ladders per `../architecture/CONFIGURATION.md §11` (XVI) |
| Offline | Fully functional air-gapped/local (local Ollama, cached layers, no egress); `docker compose up` — ladders defined in `../architecture/CONFIGURATION.md §11` |
| Usability | No training; WCAG 2.2 AA; responsive; works on throttled connections |
| Portability | Identical artifacts local & cloud; region-portable (US + global) |
| Cost | ≈ $0 local; near-$0 cloud free tiers; cheap open-weight LLM default |
| Security/privacy | Data minimization; no PII retention; audit trail; TLS 1.3 in cloud; Apache-2.0 |
| Observability | Decision/cost traces (OTel GenAI semconv); per-step attribution; AUDIT_LOG authoritative |
| Compliance | Mandatory AI compliance proxy in front of every LLM/vision call (ADR-017); policy-as-code (`config/policies.yml`, fail-fast at boot); fail-closed safety; hash-chained append-only audit; EU AI Act Art.12 retention. Coverage map: `../architecture/COMPLIANCE_MATRIX.md` |
| Observability / cost-attribution | OTel GenAI traces (`gen_ai.usage.*`), per-step cost attribution to `AUDIT_EVENT` (cost tokens-in/out/USD/model-tier); content capture off in prod (privacy); `OTEL_EXPORTER_OTLP_ENDPOINT` recommended in prod (ADR-022) |
| Sustainability | Modeled energy/carbon disclosure at `GET /.well-known/sustainability` (ADR-020; author's Internet-Draft v05 + author's SFC profile 1.1 — *not adopted standards*; recognized standards GSF SCI / CSRD); estimated/modeled labeled, schema-validated, heavily cached, zero hot-path overhead; methodology `../SUSTAINABILITY.md` |
| Browser support | Chrome, Edge, Safari, Firefox |

## 11. Security & privacy considerations

RBAC (PUBLIC/RESPONDER/VERIFIER/EM — matrix in `docs/audit/v1/CLARIFICATIONS.md` §B.Q6); consent before
intake; PII screened (incl. SOS images) and never logged/retained beyond incident; precise location
responder-only; every state change → AUDIT_EVENT; full threat model at S02. CAP produced+validated, **no
live IPAWS origination**.

## 12. Out of scope (v1)

Additional hazards (hurricane/earthquake/tsunami — adapter-extensible later); native mobile apps
(responsive PWA); live IPAWS-authority origination (FEMA authority); physics-grade hazard simulation
(FARSITE/Rothermel/hydraulic — labeled first-order only). Vision/multi-modal is in-scope but **advisory/
stretch** (golden path must not depend on it).

**Out-of-core OPTIONAL PLUGINS / basic alignment examples (FR-14 sustainability, FR-16 CAMARA, SFC
profile 1.1) — NON-BLOCKING for the v1 demo.** These are *not* core features or acceptance gates; they
are deliberately **basic, summarized examples** that ride BEACON's hexagonal adapter/plugin spine to
**demonstrate alignment** — compliance + sustainability reporting (the `.well-known/sustainability`
Internet-Draft v05 + the author's SFC profile 1.1; recognized standards GSF SCI / CSRD), adapter/plugin
**extensibility**, innovative **mobile-API** usage (CAMARA population-density/connectivity), and
**UN-SDG** fit. The demo passes its rubric/acceptance with the core FRs (FR-1…13 + FR-15 compliance proxy)
alone; these plugins, if disabled, change nothing. (Contrast: the **AI compliance proxy + security/audit/
governance matrix (FR-15)** and the **full test/CI matrix** are **core**, not examples.)

> **Provenance (verified 2026-06-29):** the `.well-known/sustainability` **v05** spec
> (`draft-besleaga-green-sustainability-wellknown-05`) is an **individual IETF Internet-Draft authored by
> the project author** — *not an RFC, not an adopted IETF/WG standard* — and **SFC profile 1.1 is the
> author's own profile**, not an adopted industry standard. They are included only as *author-originated
> alignment examples*; the recognized standards BEACON actually maps to are **GSF SCI (ISO/IEC
> 21031:2024)**, **GHG Protocol**, **CSRD/ESRS-E1**, and **RFC 8615**. Any "RFC v05" shorthand in this PRD
> means "Internet-Draft v05." See ADR-020 for the authoritative provenance.

**Post-v1 (v1.1) — wired but not live in the v1 demo:** **live CAMARA / GSMA Open Gateway telecom
integration** (FR-16/OP6) ships as a MOCK-by-default `TelecomPort` plugin proving the zero-core-change
plugin path; the live rung needs a commercial GSMA Open Gateway operator agreement and stays
`SOURCE_CAMARA_MODE=mock` for v1 (ADR-021). **Real-metering sustainability** is also post-v1: the v1
`GET /.well-known/sustainability` document is `third-party-modeled` (estimated); a deployment with
authoritative datacenter metering can flip `measurement-method` to `hardware-metered` later (ADR-020).

**De-scoped from the Phase-2 optional-insights list (recorded honestly, not silently dropped):**
the two distinct insights *"weather impact on operations"* and *"radio/TV broadcast outage"* are **out of
scope for v1** (not built; adapter-extensible later). Note this is a scope record, not a functionality
loss elsewhere: **road access IS covered** via `INFRASTRUCTURE_NODE.type=ROAD` transitioning to `OFFLINE`
in the deterministic exposure engine (§5.1 SPEC), surfaced on the COP and in exposure rankings (ST2).

## 13. Open questions (carried to S02/S03)

- RBAC matrix final sign-off (proposed in CLARIFICATIONS §B.Q6) — confirm at S02.
- Exact non-US flagship region (EU country) for the cached portability demo.
- ~~Final per-source verdicts pending~~ — **DONE: verified in `docs/audit/DATA_SOURCE_VERIFICATION.md`** (re-confirm live status at S05 before flipping any `SOURCE_*_MODE=live`).
- ~~ORM choice (Prisma vs Drizzle)~~ — **RESOLVED at S02: Drizzle (ADR-013).**

## 14. Approval (S01 gate)

> **HUMAN APPROVAL required before S02.** Approve these requirements/EARS/scope, or request changes?
