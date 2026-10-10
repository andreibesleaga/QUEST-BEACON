# BEACON — Phase 3 Clarifications & Resolved Decisions

*Resolves every ambiguity/contradiction from [`PHASE2_AUDIT.md`](PHASE2_AUDIT.md) so the S00→S04 specs
inherit unambiguous inputs. Each item has a **recommended decision** + rationale. Items needing the
user's explicit confirmation are listed first.*

---

## A. User-decided items (confirmed 2026-06-27)

| # | Question | **DECISION (user)** |
|---|---|---|
| **W0** | **Work mode** for the S00→S04 spec run | **Strict serial gates** — draft S00 → pause for review → S01 → review → … → S04 → final review → PAUSE before build. Each phase incorporates prior-gate feedback before the next is written. (Parallel subagents are used for independent research only, e.g. data verification + market scan — not to look-ahead-draft phases.) |
| **U1** | **EDXL depth** | **Full EDXL-RM mutual-aid round-trip (request/commit/response lifecycle) + EDXL-SitRep + CAP v1.2.** Resources agency-owned (in-app or EDXL-RM import). Implemented to interoperate for real inter-agency mutual aid (upgraded from a subset). S03 defines the full EDXL-RM message set + JSON-Schemas. |
| **U2** | **Shelter-capacity source** | **Agency-entered in-app** (capacity/occupancy/status) + **seeded demo shelter set** + optional EDXL-RM import. (No reliable open national live shelter feed; agency-owned is correct.) |
| **U3** | **RBAC matrix** | Proceed with the **§B.Q6 matrix**; open to adjustment at the S01/S02 gate. |
| **U4** | **Demo region scope** | **California flagship region fully LIVE** (FIRMS + NWS + NWPS + USGS + Overpass) **+ one non-US region — Romania (EU)** flood, via **Copernicus EFAS/GloFAS + EFFIS + MeteoAlarm-RO + Open-Meteo + OSM/WorldPop** — on **CACHED** data to prove free-world/global portability. *(Romania confirmed by Entrant 2026-06-29; specific RO feeds finalized at S05.)* |

*Everything below (B) is resolved with a recommended decision; all remain open to override at a gate.*

---

## B. Resolved ambiguities (from PHASE2_AUDIT §4)

### Q1 — Live-vs-mock source set (per region)
**Decision:** Source tiering is governed by [`../DATA_SOURCE_VERIFICATION.md`](../DATA_SOURCE_VERIFICATION.md).
- **LIVE (golden path, US flagship):** NASA FIRMS, NWS api.weather.gov, OSM Overpass, NOAA NWPS, USGS
  Water, GDELT, ReliefWeb v2, OpenRouteService, **GDACS, Open-Meteo** (global secondary-LIVE).
- **CACHED (nightly/periodic snapshot):** FEMA NFHL, EAGLE-I (historical), WorldPop, OSM infra, HIFLD-Next
  archived layers, OpenCelliD.
- **MOCK (gated/impractical for demo):** CAMARA/GSMA, Sentinel-2 NBR (optional), IPAWS aggregate.
- Each source sits behind the **same port** with last-known-good cache + recorded-mock fallback, so live
  vs cached vs mock is a config flag, never a UI dead-end.

### Q2 — EDXL schema versions & resource model
**Decision:** EDXL-RM 1.0 + EDXL-SitRep 1.0 (see U1). Canonical internal `RESOURCE`/`RESOURCE_TASK`/
`SHELTER` entities (ARCH §7.1) are the source of truth; EDXL is a **boundary serialization** via an
`EdxlPort` adapter. **Per U1 (full mutual-aid round-trip) and ADR-010, S03 defines the field mapping
(internal entity ↔ EDXL element) and JSON-Schemas for the FULL EDXL-RM message set
(request/commit/response) + EDXL-SitRep** — not a reduced subset.

### Q3 — Shelter-capacity source
**Decision:** Agency-entered + optional import (see U2). `SHELTER` is operational data, not a scraped
feed — consistent with the "resource data is agency-owned" principle (CONCEPT §4).

### Q4 — SOS / AI confidence-scoring algorithm
**Decision:** `PUBLIC_REPORT.confidence ∈ [0,1]` = a transparent weighted blend computed **deterministically**
(not invented by the LLM):
```
confidence = 0.40 · geocode_precision     // address→point quality (exact/street/area/centroid)
           + 0.30 · source_authority      // official-account > consented-web/SMS > public-social
           + 0.20 · classifier_score      // LLM text-classification certainty for "in danger" intent
           + 0.10 · corroboration         // # of independent nearby reports / official corroboration
```
Weights live in config; the LLM supplies only `geocode` + `classifier_score` (with citations); the blend
is computed in code so it is reproducible and testable. Surface the **components**, not just the number.

### Q5 — Threshold-rule engine (FR-11)
**Decision:** Declarative JSON rules over the canonical model, evaluated each ingestion cycle:
```json
{ "id":"...", "target":"GAUGE_CATEGORY|HAZARD_BUFFER",
  "operator":"crosses|gte|enters", "value":"MODERATE|<meters>|<infra_type>",
  "scope":"<region_id>", "hysteresis":"<min_dwell>", "cooldown":"<minutes>" }
```
Semantics: a rule fires when its target transitions across `value` (edge-triggered with `hysteresis` to
avoid flap), creating a **draft** `ALERT` with provenance to the triggering `SOURCE_RECORD`; **no CAP is
emitted until a VERIFIER approves** (ARCH §7.2 Gherkin). `cooldown` de-dups repeat fires. Evaluation is
deterministic and unit-testable.

### Q6 — RBAC matrix
**Decision (proposed for U3 confirmation):**

| Capability | PUBLIC | RESPONDER | VERIFIER | EM |
|---|:---:|:---:|:---:|:---:|
| View public COP (generalized locations) | ✓ | ✓ | ✓ | ✓ |
| Submit consented SOS report | ✓ | ✓ | ✓ | ✓ |
| View **precise** PII location / contact | – | ✓ | ✓ | ✓ |
| Triage / edit report status | – | – | ✓ | ✓ |
| Approve report → **emit CAP** | – | – | ✓ | ✓ |
| Register / task resources, shelters | – | ✓ (own org) | – | ✓ |
| Configure threshold rules / regions / adapters | – | – | – | ✓ |
| View audit log | – | – | ✓ | ✓ |

Every state-changing action writes an `AUDIT_EVENT` (actor, action, target, time) — satisfies
RESPONSIBLE_DATA §5/§6.

### Q7 — Real-time push policy
**Decision:** Transport = **SSE** (locked). Push trigger = **on canonical-model delta**, debounced per
region (coalesce within a short window, e.g. 1–2 s) + a periodic heartbeat for liveness; client
reconnect uses `Last-Event-ID` to backfill missed deltas. No UI blocking on upstream calls (workers
push; UI subscribes).

### Q8 — Prediction methods (FR-12), honestly bounded
**Decision:**
- **Fire spread cone** = directional buffer from current perimeter/hotspots along NWS wind vector
  (bearing = wind direction, length ∝ wind speed × horizon), labeled "first-order projection," **not** a
  physics model. Uncertainty = a widening cone / confidence band.
- **Flood inundation** = NWPS forecast-crest stage ∩ FEMA NFHL zones (+ terrain where available) →
  expected-damage polygons, labeled with the forecast lead time + NFHL effective-map caveat.
- **Impact-over-time** = projected hazard extent ∩ WorldPop/Census population + infrastructure, sampled
  at horizons.
- Every `PREDICTION` row carries `method`, `inputs`, `uncertainty`, `horizon` (already in the §7 model).
- Physics-grade (FARSITE/Rothermel/hydraulic) = documented adapter extension, **out of demo scope**.

### Q9 — Multi-region definition & registration
**Decision:** A **region registry** (config/seed table): each region = `{id, name, scope, bbox,
enabled_adapters[], source_mode_overrides}`. Adapters declare `coverage` (US / global / specific
country); when a region selects a source whose coverage doesn't apply, the layer is **marked
"not available in this region"** (graceful, not broken) and a global-equivalent adapter is used where one
exists (e.g. GloFAS for flood, Copernicus EFFIS for fire, MeteoAlarm/Open-Meteo for weather outside US).
Demo ships one live flagship region + ≥1 cached non-US region (U4).

### Q10 — LLM model/version + budget
**Decision:** Default `default`-tier model via LiteLLM = an open-weight Llama-3-class model on Groq;
`sota` fallback = Claude Haiku; **offline** = local Ollama (same Llama-3-class). Per-SitRep token budget
capped (input grounding facts truncated to a configured max; output JSON-schema-bounded). Cost NFR met by
defaulting to the cheap open-weight tier and only escalating on failure. Exact pin set at S02 against the
**latest Node LTS + compatible package** baseline and the current LiteLLM provider matrix.

---

### Q11 — Multi-modal / vision AI scope (user direction)
**Decision:** Vision/multi-modal models are **first-class**, behind a `VisionPort` + a LiteLLM `vision`
tier (cloud) with a `vision_offline` local fallback (e.g. LLaVA on Ollama). Demo use cases:
1. **Satellite imagery analysis** — Sentinel-2 burn-area / NBR delta for fire scar extent; optical/SAR
   flood-extent estimation (advisory layer, labeled "estimated from imagery").
2. **Consented SOS photo analysis** — scene/damage/severity classification + hazard cues to enrich
   triage confidence (Q4); image is consent-checked + PII-screened first.
3. **Scene/map understanding** — optional assist for operators.
**Guardrails (constitutional, Art. XII/XIV):** vision output is **advisory, cited, confidence-scored**;
it feeds the human-verify pipeline, **never auto-triggers an alert**, and **never overrides deterministic
geometry**. System degrades gracefully with no vision model (skip → advisory absent). Treated as a
**stretch layer** in the demo (mock/cached imagery acceptable) so it never blocks the golden path.

### Q12 — Total redundancy / "works in all cases" (user direction → CONSTITUTION Article XVI)
**Decision:** Every layer implements an explicit **fallback ladder** and always labels degradation
(freshness / "estimated" / "unavailable"), never a dead-end. The per-layer ladders (data, AI text/vision,
geo, queue, cache/bus, realtime, routing, deploy) are single-sourced in
**`docs/architecture/CONFIGURATION.md §11`** (flag → degrade-left→right table) — not re-enumerated here.
The principle: data degrades to global-equivalents → cache → mock → "unavailable + freshness"; AI degrades
to deterministic-only (numbers/geometry retained); identical artifacts run fully local/air-gapped (no
egress) and on cloud, config-driven.
**Acceptance tests (mandatory, S06):** (a) offline/air-gapped, (b) every primary source blocked
(fall-through verified), (c) AI fully disabled (deterministic engine still produces ranked decisions).
This is now a graded operational-readiness requirement, carried into S01 NFRs and S02 ADRs.

### Q13 — First-class free-world data (user direction)
**Decision:** Source policy prefers authoritative **open, free** data from world-class public providers —
**UN** (OCHA ReliefWeb, HDX/HAPI, GDACS), **ESA/Copernicus** (EFFIS/GWIS, GloFAS, Sentinel-2), **NASA**
(FIRMS), **NOAA/USGS/NWS/FEMA/NIFC**, **OpenStreetMap**, **WorldPop**. Global-equivalent adapters give
non-US regions genuine coverage (supports the broad multi-region scope, U4). No paid/proprietary data;
no scraping ToS-protected platforms. Verified catalog + LIVE/CACHED/MOCK verdicts in
[`../DATA_SOURCE_VERIFICATION.md`](../DATA_SOURCE_VERIFICATION.md).

---

## C. Resolved contradictions (from PHASE2_AUDIT §2)

| Ref | Decision |
|---|---|
| **C1** (NestJS stray) | **Void.** Stack is **Next.js/TypeScript** front+API; NestJS not used. AUDIT.md §4's "NestJS+PostGIS+BullMQ" is a Phase-2 editing slip, superseded here. |
| **C2/C3** (flexible stack, PostGIS-vs-Turf) | **Locked:** Next.js/TS; **CRON default ↔ BullMQ flag**; **Postgres + Turf.js default ↔ PostGIS flag**; **SSE**; in-memory cache ↔ Redis flag. Flexibility preserved as adapters/feature-flags, one concrete default committed at S02. |
| **C4** (EAGLE-I live) | Outages shown as a **derived "assumed-offline" layer** + historical context, **not** a live national feed. PRD wording corrected in S01. |
| **C5** (duplicate mockups/docs) | **`Phase2/submission/` is authoritative.** Phase 3 ignores `Phase2/project/` except as historical context. |
| **C6** (CAP scope) | BEACON **produces + validates CAP v1.2**, ready for IPAWS; **no live IPAWS origination** (needs FEMA approval) — documented integration point. |
| **C7** (BullMQ in diagrams) | Diagrams `05-sequence` + `11-deployment` re-captioned in Phase 3 to "CRON default; BullMQ/Redis optional." |
| **C8** (persona count) | Use the **PRD 4-persona** set (EM, Responder, Public reporter, Integrator). |

---

## D. Locked technology decisions (carried into S02)

| Layer | Locked default | Flagged scale adapter |
|---|---|---|
| Runtime | **Latest Node LTS** (exact version pinned at S02; all packages verified compatible) | — |
| Frontend | Next.js + MapLibre GL JS + deck.gl + Tailwind + Zustand + TanStack Query | — |
| Backend/API | TypeScript, Next.js API routes | — |
| Workers/queue | **CRON / interval** | **Redis + BullMQ** (`QueuePort` flag) |
| Store / geocompute | **Postgres + client/server Turf.js** | **PostGIS** (`SpatialPort` flag) |
| Cache / event bus | **In-memory** | **Redis Streams** (`EventBusPort` flag) |
| Realtime push | **SSE** (delta + heartbeat, `Last-Event-ID` backfill) | WebSocket (future) |
| AI (text) | LiteLLM → Groq (open-weight Llama-3-class) → Claude Haiku → local Ollama → **deterministic-only** | — |
| AI (vision/multi-modal) | `VisionPort` → cloud vision tier → local LLaVA (Ollama) → skip (advisory only) | — |
| Redundancy | **Article XVI fallback ladders** on every layer; offline/air-gapped + cloud; 3 mandatory acceptance tests | — |
| Data policy | First-class **free-world** open data (UN/Copernicus/NASA/NOAA/USGS/OSM/WorldPop); global-equivalents for non-US | — |
| Routing | OpenRouteService (hosted) | self-host **Valhalla/OSRM** → straight-line+avoid heuristic |
| Protocols | GeoJSON/OGC, CAP v1.2, EDXL-RM/SitRep 1.0, GLIDE | — |
| Deploy | Docker Compose (local, air-gapped, ~$0, no egress) → same images to cloud free tiers | — |

This table is the authoritative stack-of-record for Phase 3 and supersedes every "or/flexible/illustrative"
phrasing in the Phase-2 docs.
