# BEACON — Master Technical Specification (S03)

<!-- Derived from: docs/requirements/PRD.md (S01, approved) · docs/architecture/{C4_ARCHITECTURE,DOMAIN_MODEL,
     CONFIGURATION,THREAT_MODEL}.md + ADR-001..022 (+ADR-008a) (S02) · audit/CLARIFICATIONS.md (locked decisions). -->
<!-- Created by: prod-tech-lead (GABBE SDLC S03 — Specification) · Date: 2026-06-27 -->
<!-- Extended by: §12 "Phase-D delivery addendum" (2026-07-15) covers ADR-023..026 (+ADR-024's Phase-B rung),
     added post-S04 as the implementation caught up to the S03 spec of record; the original S03 body above
     is preserved verbatim per the golden-thread rule (no history rewrite) — see §12 for the current ADR range. -->
<!-- Extended by: §13 "Known limitations" (2026-07-31, MW-E/E1) — the consolidated, indexed limitations
     ledger NFR-F10 requires. Appended, nothing above rewritten; see §13 for the current honest-limitations
     list (supersedes any narrower "known limitations" reference elsewhere in this document). -->
<!-- This is the human-readable contract of record. The machine spec is docs/api/openapi.yaml; the
     interop/adapter JSON-Schemas live in schemas/. Where this SPEC and those files disagree, the SPEC's
     intent governs and the machine artifact is corrected to match. -->

> **BEACON** — Browser-based Emergency Awareness & Coordination Open Network. This document is the
> single, implementation-ready technical specification that binds the S01 requirements (EARS FR-1…FR-13)
> and the S02 architecture (hexagonal ports-and-adapters, ADR-001…022 +ADR-008a; **now ADR-001…029, see
> §12**) to concrete contracts: API,
> persistence, adapters, the deterministic engine, AI, interop, resilience, testing, and performance/
> security targets. It is the basis for the S04 task backlog and the S05 build. **PAUSED at S04**: no
> application code until the S04 gate is human-approved (AGENTS §14).

---

## 1. Overview & golden thread

**SDLC phase:** S03 — Specification. **Spec author:** `prod-tech-lead`. **Status:** PENDING (human gate at §13).

**Scope (in).** The four flagship features (PRD §4) end-to-end on the golden path: (1) Unified live
geospatial COP; (2) AI situational-intelligence fusion + cited SitRep; (3) responsible crowdsourced SOS
intake + evacuation routing; (4) responder comms/logistics + **full EDXL-RM mutual-aid round-trip**.
Cross-cutting: provenance/citations, deterministic→AI→human handshake, total redundancy/offline,
config-for-everything, advisory vision (stretch).

**Scope (out)** (PRD §12): additional hazards (hurricane/earthquake — adapter-extensible later); native
mobile (responsive PWA only); **live IPAWS-authority origination** (`IPAWS_ENABLED=off`); physics-grade
hazard simulation (first-order labeled projections only). Vision is in-scope but **advisory/stretch** —
the golden path must not depend on it.

### 1.1 Golden thread — FR → EARS → component → test (PRD §5.0)

Every functional requirement is traceable end-to-end. The "Component" column names the application
use-case (`src/application`, C4 L3) and the primary endpoint/port; "Test" names the verification layer
(see §9). One Gherkin scenario per FR is the BDD gate (Gate 7). **FR-1…FR-13** are the S01 PRD
requirements; **FR-14 / FR-15 / FR-16** are S03 additions traced to existing requirement codes
(EV12 / U7+EV11 / OP6) — FR-15 (the AI compliance gateway) is **CORE**, FR-14 (sustainability) and
FR-16 (CAMARA telecom) are **optional plugins**.

| FR | Requirement (PRD §5.0) | EARS | Component (use-case · endpoint/port) | Test artifact |
|---|---|---|---|---|
| **FR-1** | Select region → all relevant layers | EV1 | region resolver + ingestion → `GET /regions`, `GET /regions/:id/incidents` (P1–P5,P12,P13) | `region.feature`; integ `regions.api`; e2e golden |
| **FR-2** | Each layer shows source + last-updated; stale/unavailable marked | U4 | envelope serializer `provenance[]+freshness` (all data endpoints) | `provenance.contract` (F1); `freshness.feature` |
| **FR-3** | Exposure via hazard-geometry intersection | EV2 | `RiskIntersection`/`Exposure` (SpatialPort) → **served as `exposure[]` on `GET /regions/:id/map`** (`feature-router.ts:551` → `routes/map.ts:38` → `map-projection.ts:511`). ⚠️ **The dedicated `GET /incidents/:id/exposure` route named by this thread is NOT SERVED — it 404s** (`routing.ts:111,119-120`); see §13.11 | unit `risk-intersection`; `exposure.feature` |
| **FR-4** | Cited AI SitRep + ranked priorities + escalation trend | EV3, U2 | `SitRepSynthesis` + `PriorityRanking` (LLMPort) → `GET /incidents/:id/sitrep` | `citation.contract` (F2); `sitrep.feature` |
| **FR-5** | Public consented report → UNVERIFIED + confidence | EV4 | `ReportTriage` (PublicReportPort, LLMPort) → `POST /reports` | `report-triage.feature`; unit `confidence-blend` |
| **FR-6** | Verifier approves/rejects; approval may emit CAP | EV5, ST1 | report state machine + AlertSink → `PATCH /reports/:id`, `POST /alerts` | `hitl.contract` (F8); `verify.feature` |
| **FR-7** | Evac routes avoiding hazard + nearest shelters | EV7 | `EvacRouting` + `CapacityMatch` (RoutingPort) → `POST /routes` | unit `evac-routing`; `routing.feature` |
| **FR-8** | Register/locate/task resources; shelter capacity | EV9 | `ResourceAssignment` + `CapacityMatch` → `GET/POST /resources`, `POST /resource-tasks` | `resource-task.feature`; integ logistics |
| **FR-9** | CAP for events; EDXL for resources/sitreps (full mutual-aid) | EV10 | AlertSinkPort → `POST /alerts`, `POST /edxl/rm`, `GET /edxl/rm/:id`, `POST /edxl/sitrep` | `cap-edxl.conformance` (F15); `edxl-roundtrip.feature` |
| **FR-10** | Add sources as adapters via manifest, zero core change | OP2, OP3 | adapter registry/manifest (composition root) | `manifest.contract`; `adapter-registry` unit |
| **FR-11** | Threshold-triggered early-warning alerts (DRAFT) | EV6 | `ThresholdEval` (ADR-014) → DRAFT `ALERT` | unit `threshold-eval`; `threshold.feature` |
| **FR-12** | Predictive layer (labeled first-order; method+inputs+uncertainty) | EV8 | `PredictionProjection` (ADR Q8) | unit `prediction-cone`; `prediction.feature` |
| **FR-13** | Decision support (deterministic numbers + AI narration, human-approved) | U3, EV3 | engine + SitRep + HITL | `no-llm-numbers.contract` (F3); `decision.feature` |
| **FR-14** | Sustainability report (modeled/estimated, out-of-band) — *optional plugin* | EV12 | sustainability route → `GET /.well-known/sustainability` (ADR-020) | `sustainability.contract` (F18, schema-valid, non-blocking) |
| **FR-15** | AI compliance gateway in front of every LLM/Vision call (CORE) | U7, EV11 | `AICompliancePort` mandatory proxy (ADR-017/018/022) | `compliance-proxy.feature`; `compliance` contract (F16 stamp/fail-closed, F17 budget-HITL, F19 cost-attribution) |
| **FR-16** | CAMARA/GSMA telecom signal as a flag-to-live adapter — *plugin* | OP6 | `camara-gsma` adapter via registry/manifest (ADR-021); aggregate-only | `manifest.contract` (aggregate-only); `adapter-registry` unit |
| **(cross)** | Total redundancy / works-in-all-cases | UW1–UW4, OP1–OP4 | every port fallback ladder | F5/F6/F7 redundancy acceptance (§9.4) |

The contract/fitness functions **F1–F19** (C4 §"Quality / Fitness Functions") are the executable
backstop: an ungrounded, LLM-numbered, redundancy-broken, or **un-stamped** (compliance-proxy-bypassing)
build **fails CI**.

---

## 2. API contract overview (human-readable contract of record)

REST/JSON over HTTPS, OpenAPI 3.1. Base path **`/api/v1`** (frozen once published — Art. VIII). The full
machine spec is **`docs/api/openapi.yaml`** (authored separately); this section is the authoritative
human contract it must satisfy.

### 2.1 Universal response envelope

Every **data** response (success) is wrapped:

```jsonc
{
  "data":       /* resource or array (see per-endpoint schemas) */,
  "provenance": [ /* SourceRef[] — NON-EMPTY on every data response (U1, Art. XI) */
    { "sourceId": "uuid", "source": "NWS", "adapter": "nws-alerts",
      "fetchedAt": "2026-06-27T18:00:00Z", "license": "US-PD", "mode": "LIVE" }
  ],
  "freshness":  "2026-06-27T18:00:12Z",   /* most-stale contributing observation (U1/U4) — REQUIRED */
  "meta":       { "regionId": "uuid", "status": "ok", "degraded": false, "page": {...} },  /* optional */
  "errors":     [ /* present only on partial/degraded results — see §2.6 */ ]
}
```

- **`provenance[]`** is mandatory and non-empty on every data response, each entry referencing a real
  `SOURCE_RECORD` (Art. XI; enforced by **F1**). For a degraded layer, provenance still names the source
  + `mode` (`CACHED`/`MOCK`) and `freshness` reflects the cache/snapshot time (UW2/U4). At the API
  boundary the provenance field is **`sourceId`** and `mode` is **UPPERCASE** (`LIVE|CACHED|MOCK|DB`),
  matching `openapi.yaml` + `schemas/source-ref.schema.json`; the adapter-internal `SourceMode` is
  lowercase (`live|cached|mock`) and is mapped to the uppercase boundary form by the ACL/serializer (§4.1).
- **`DB` is a SERVED-provenance mode, not a ladder rung** (ADR-041 §3, V2·A12). It means *an
  operator-maintained record held in BEACON's own store* — a shelter occupancy or supply lot a duty officer
  keeps current. It makes **no claim about the outside world** and never implies upstream freshness: a `DB`
  entry's `fetchedAt` is that row's **last edit**. It is deliberately NOT available as a per-source
  configuration (`SOURCE_<NAME>_MODE`, `adapter-manifest.schema.json`, `regions.schema.json` keep exactly
  `LIVE|CACHED|MOCK`), because no adapter can fetch it. `MOCK` would understate an operator's real
  operational fact and `CACHED` would be false — it is defined as a last-known-good copy *of an upstream
  response*, and here there is no upstream.
- **Which surfaces can serve `DB`, and what they fall back to** (ADR-041 §1/§2, V2·A12): the five dock
  panels — `GET /supplies`, `/volunteer-teams`, `/shelter-status`, `/damage-reports`, `/ems-overlay` — and
  only under `FEATURE_STORE=postgres`. Their ladder is **DB → fixture**, labelled at every rung: a store
  that is unreachable, or that holds no rows for a panel, serves the recorded fixture as `MOCK` and adds
  `meta.status: 'degraded'` + a non-fatal `SOURCE_DEGRADED` entry to `errors[]` — never an empty board,
  because an empty shelter board and a board with no shelters look identical and mean opposite things
  (Art. XVI). With no store wired the fixture rung is the ONLY rung and the response is byte-identical to
  the pre-A12 one. Operator rows go through the same domain factories the fixture rows do, so a malformed
  row is refused with `422 VALIDATION_ERROR` rather than rendered as a plausible-looking number.
- **`freshness`** = the oldest contributing observation timestamp (the picture is only as fresh as its
  stalest input). UI marks stale (older than the source's refresh cadence ×2 — §8.4) and "unavailable".
- **SitRep additionally carries `citations[]`** (see §2.4) — one citation per generated field (U2, **F2**).
- Numbers, rankings, distances, exposures, confidence are **never** LLM-produced (U3/Art. XII, **F3**).

### 2.2 Endpoint catalog (canonical)

All responses use the envelope (§2.1) unless noted. Auth column = minimum RBAC role (CLARIF §B.Q6 /
THREAT_MODEL §7); `–` = public/anonymous.

> ⚠️ **"Canonical" here means DESIGNED, not necessarily SERVED (findings F-323 / F-401, 2026-08-01).**
> Five rows below are marked **🚫 NOT SERVED (v1)**: the running router has no match for them, so a `curl`
> gets `404 NOT_FOUND` from `routing.ts:57-59`. The rows are kept — deleting them would hide the gap — and
> each carries the `file:line` that proves the verdict. This matches the marker `docs/api/openapi.yaml`
> already carries on the same five paths (`x-status: planned` + "NOT YET SERVED (v1)"). The full served
> surface, read off the routing code, plus the method that produced these verdicts, is in **§13.11**.
>
> ✅ **RESOLVED (live-demo session S1, 2026-08-07 — recorded here 2026-08-10).** All five routes are now
> SERVED — `GET /incidents/:id` and `GET /incidents/:id/exposure` via `feature-router.ts`
> (`incidentGetRoute` / `incidentExposureRoute`, the exposure route reusing the same COP derivation);
> `GET /threshold-rules`, `GET /audit-events` and `GET /health/adapters` via their dedicated route
> modules — each RBAC-gated, and the `x-status: planned` markers are removed from `docs/api/openapi.yaml`
> (0 remain). The 🚫 markers on the five rows below are kept as the historical record of the design-first
> gap; read them with this note. Full resolution detail: §13.11.

| Method · Path | Purpose | EARS / FR | Auth | Notes |
|---|---|---|---|---|
| `GET /regions` | List configured regions (registry) | EV1 / FR-1 | – | from `REGIONS_CONFIG`; each carries `scope,bbox,enabled_adapters` |
| `GET /regions/:id/incidents` | Active incidents in a region | EV1 / FR-1 | – | paginated; filter `?type=WILDFIRE|FLOOD&status=ACTIVE` |
| `GET /incidents/:id` | Incident detail + hazard geometry, gauges, predictions | EV1/EV8 / FR-1,12 | – | **🚫 NOT SERVED (v1) — 404.** A 2-segment GET matches nothing: `matchGet` handles only 1- and 3-segment paths (`routing.ts:117-121`) and the feature router likewise (`feature-router.ts:559-563`). Design intent kept for a later version; the same data is reachable today via `GET /regions/:id/incidents` + `GET /regions/:id/map` |
| `GET /incidents/:id/sitrep` | Cited AI SitRep + ranked priorities + trend | EV3,U2 / FR-4,13 | – | `data` + **`citations[]`**; `ai_mode` echoes ladder rung used |
| `GET /incidents/:id/exposure` | Deterministic exposure (nodes in/near hazard) | EV2 / FR-3 | – (precise=RESPONDER+) | **🚫 NOT SERVED (v1) — 404.** `matchGetNested` accepts only `…/sitrep` as the 3rd segment (`routing.ts:111-113`); `matchGetTriple` accepts only `map` / `edxl/rm` / `summary` (`feature-router.ts:550-555`). ⚠️ **This row is inside the FR-3 golden thread (§1.1)** — the exposure ENGINE ships and is served as `exposure[]` on `GET /regions/:id/map` (`map-projection.ts:511`), but this dedicated route is not wired. See §13.11 |
| `POST /reports` | Submit consented public SOS report | EV4 / FR-5 | – | consent + PII-screen gate; returns `UNVERIFIED` + confidence components |
| `PATCH /reports/:id` | Triage/verify/reject a report | EV5,ST1 / FR-6 | VERIFIER | state transition (UNVERIFIED→TRIAGED→VERIFIED\|REJECTED); writes `AUDIT_EVENT`. Returns **202 Accepted** with the responder view; on VERIFIED with request field **`emitCap=true`** a DRAFT CAP alert is emitted and referenced in **`meta.emittedAlert`** (never auto-promoted to ACTUAL — Art. XIII) |
| `POST /routes` | Hazard-avoiding evac route + nearest shelters | EV7 / FR-7 | – | RoutingPort; returns route + shelter matches (capacity) |
| `GET /resources` | List resources (status+location) | EV9 / FR-8 | RESPONDER | org-scoped for RESPONDER; EM sees all in region |
| `POST /resources` | Register a resource | EV9 / FR-8 | RESPONDER (own org) | |
| `POST /resource-tasks` | Task a resource (lifecycle PROPOSED→…→CLEARED) | EV9 / FR-8 | RESPONDER (own org)/EM | only from `VERIFIED` source (ST1) |
| `POST /alerts` | Emit/compose a CAP v1.2 alert | EV10,EV5 / FR-9,6 | VERIFIER | DRAFT unless human-approved (Art. XIII); JSON-Schema validated |
| `POST /edxl/rm` | Import/initiate EDXL-RM mutual-aid message | EV10 / FR-9 | RESPONDER/EM | request/commit/response; org-ownership checked |
| `GET /edxl/rm/:id` | Fetch/export an EDXL-RM message (round-trip) | EV10 / FR-9 | RESPONDER/EM | returns canonical + serialized EDXL-RM |
| `POST /edxl/sitrep` | Emit an EDXL-SitRep situation summary | EV10 / FR-9 | VERIFIER/EM | derived from cited SitRep; PII-screened |
| `GET /stream` | SSE delta channel, **region-keyed** | EV2 / (all) | – | `?regionId=`; `text/event-stream`; see §2.5 |

**Configuration / governance reads** are out of the public golden-path catalog and specified in
`openapi.yaml` (not under an `/admin/*` prefix). Their paths/roles:

| Method · Path | Purpose | Auth | OpenAPI tag |
|---|---|---|---|
| `GET /threshold-rules` | List declarative early-warning rules (configuring rules is EM-only, CLARIF Q6). **🚫 NOT SERVED (v1) — 404**: not in `matchGetSingle` (`routing.ts:86-104`) nor the feature router's (`feature-router.ts:541-547`) | EM | Alerts |
| `GET /audit-events` | Read the append-only audit log (RBAC §B.Q6). **🚫 NOT SERVED (v1) — 404**: same two tables, same absence (`routing.ts:86-104`, `feature-router.ts:541-547`) | VERIFIER | Alerts |
| `GET /sources` | SOURCE_RECORD provenance catalog (effective mode + freshness, Art. XI) | – (PUBLIC) | Regions |
| `GET /health/adapters` | Per-adapter operational health (circuit-breaker state, effective mode, last-success freshness) — backs the stale/unavailable UI badge (FR-2/UW2) and the registry health aggregation (adapter-contract §3, ADR-009). Designed as an operational endpoint returning `AdaptersHealthReport`, **not** the data envelope (like `/stream`, `/.well-known/sustainability`). **🚫 NOT SERVED (v1) — 404.** Only the single-segment `/health` is wired (`routing.ts:88-89`); a 2-segment GET matches nothing (`routing.ts:117-121`). The former claim "always 200 while the service is up" was **FALSE** and is withdrawn (F-401). **Per-source mode + freshness ARE served today by `GET /sources`** (`routing.ts:94-95`) — use that endpoint, and see §13.11 | – (PUBLIC) | System |
| `GET /me` | Authenticated user (role + org) drives RBAC | RESPONDER | Regions |
| `GET /.well-known/sustainability` | Out-of-band energy/carbon disclosure — RFC-v05 modeled/estimated report (ADR-020, §7.4); heavily cached, no per-request overhead; validated vs `schemas/sustainability-v05.schema.json` (optional out-of-core plugin; basic alignment example; non-blocking) | – (PUBLIC) | Sustainability |

Region registry + per-source mode/adapter config remain config-seeded (`REGIONS_CONFIG`,
`SOURCE_*_MODE`), surfaced via `GET /regions` + `GET /sources`; there is no separate `/admin/*`
mutation surface in the S03 golden-path contract.

### 2.3 Status codes

| Code | When |
|---|---|
| `200 OK` | Successful read (may be `degraded:true` with `errors[]` for a fell-back layer — still 200, never a dead-end, UW2) |
| `201 Created` | `POST /reports`, `/resources`, `/resource-tasks`, `/alerts`, `/edxl/*` created a resource |
| `202 Accepted` | `PATCH /reports/:id` transition accepted (returns responder view; on VERIFIED+`emitCap=true` carries the emitted DRAFT alert in `meta.emittedAlert`); also async triage enqueued (report accepted; triage runs in worker) |
| `400 Bad Request` | Malformed body/params (Zod validation, §2.6) |
| `401 Unauthorized` | Missing/invalid session for a protected route |
| `403 Forbidden` | Authenticated but role/object/org not permitted (RBAC, BOLA/BFLA — THREAT §7) |
| `404 Not Found` | Unknown id (also returned instead of 403 where existence itself is sensitive) |
| `409 Conflict` | Illegal state transition (e.g. emit CAP from `UNVERIFIED` — ST1/UW5) |
| `413 Payload Too Large` | Oversized body / image > `VISION_MAX_IMAGE_MB` |
| `422 Unprocessable Entity` | Semantically invalid (e.g. consent absent on `POST /reports` — EV4) |
| `429 Too Many Requests` | Rate limit (intake abuse mitigation — THREAT T1.6); `Retry-After` header |
| `500/503` | Internal/upstream failure **only** when no fallback rung exists; data endpoints prefer `200 degraded` over `503` |

### 2.4 SitRep `citations[]` (FR-4/U2)

`GET /incidents/:id/sitrep` returns the envelope plus a top-level `citations[]`. Each generated field of
the SitRep (`summary`, each `priorities[]` item rationale, `trend`) maps to ≥1 citation:

```jsonc
"citations": [
  { "field": "priorities[0].rationale", "sourceId": "uuid",
    "claim": "3 hotspots within 1.2 km of Oak Ridge", "source": "FIRMS" }
]
```

100% field-citation coverage is required (**F2**). Numbers quoted in `summary`/`priorities` originate
from the deterministic engine (`data.priorities` is computed; the LLM only narrates them). On LLM
failure the SitRep degrades to deterministic-only (`ai_mode: "deterministic-only"`, `summary` omitted or
templated, `priorities[]` retained) — **UW3/F4**.

### 2.5 SSE `/stream` (ADR-006; Q7)

- `Content-Type: text/event-stream`; **region-keyed** via `?regionId=` (cross-region isolation — THREAT
  T13.1). Each event: `id:` (monotonic, for `Last-Event-ID` backfill), `event:` (`delta|heartbeat`),
  `data:` (a region delta envelope: changed entities + provenance + freshness).
- Pushes are **debounced** per region (`SSE_DEBOUNCE_MS`, default 1500 ms) and emitted on canonical-model
  delta (never UI-blocking on upstream). Heartbeat every `SSE_HEARTBEAT_SEC` (20 s) for liveness.
- Reconnect sends `Last-Event-ID`; server backfills missed deltas. If the stream drops, the client
  auto-falls-back to **polling** (`FEATURE_REALTIME=polling`) — same delta contract (OP2).

### 2.6 Error model & pagination

**Error body** (non-2xx, or `errors[]` inside a 200-degraded envelope):

```jsonc
{ "error": { "code": "VALIDATION_ERROR", "message": "consent is required",
  "details": [ { "field": "consent", "code": "REQUIRED", "message": "consent must be true" } ] } }
```

Codes (stable, machine-readable): `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`,
`STATE_CONFLICT`, `CONSENT_REQUIRED`, `RATE_LIMITED`, `PAYLOAD_TOO_LARGE`, `SOURCE_DEGRADED` (informational,
inside a 200), `UPSTREAM_UNAVAILABLE`. Adapters never throw raw upstream errors into the domain (AGENTS
§4); a degraded layer surfaces `SOURCE_DEGRADED` + freshness, not a 5xx.

**Pagination** (collection endpoints — `/regions/:id/incidents`, `/resources`): cursor-based.
`?limit=` (default 50, max 200) + `?cursor=`; `meta.page = { nextCursor, hasMore, limit }`. Stable sort
by `(updated_at desc, id)`.

---

## 3. Data / persistence spec

**Store:** PostgreSQL (canonical). **ORM:** Drizzle + drizzle-kit (ADR-013 — SQL-first, no engine binary,
fits the lean air-gapped image; behind `RepositoryPort`, never imported by domain — Art. II). **Spatial:**
Turf.js (default, `geometry` stored as GeoJSON in `jsonb` + lon/lat columns) ↔ **PostGIS** (flag
`FEATURE_SPATIAL=postgis`, `geometry(Geometry,4326)` columns) — both behind `SpatialPort` with identical
behaviour (ADR-005, OP2, **F11**). All geometry is **WGS84 / EPSG:4326**.

### 3.1 Entities (DOMAIN_MODEL §1–§2 is canonical; this is the persistence projection)

19 canonical tables, each mapped 1:1 to a `src/domain` entity. Field definitions are authoritative in
`DOMAIN_MODEL.md`; the DDL/migrations are generated from the Drizzle schema (`src/adapters/persistence/schema.ts`).

| Table | Key fields (see DOMAIN_MODEL) | Provenance anchor |
|---|---|---|
| `region` | scope, bbox(geom), enabled_adapters(jsonb), source_mode_overrides(jsonb) | — (config-seeded) |
| `incident` | region_id→region, type, status, updated_at | — |
| `hazard_geometry` | incident_id, kind, geom, intensity, observed_at, **source_id→source_record** | ✔ |
| `gauge` | geom, stage, flood_category, crest_forecast, crest_time, **source_id** | ✔ |
| `infrastructure_node` | type, geom, status (ONLINE/AT_RISK/OFFLINE), **source_id** | ✔ |
| `exposure` | incident_id, node_id, inside_hazard, distance_m, reason, computed_at *(deterministic)* | derived |
| `prediction` | incident_id, kind, geom, method, inputs(jsonb), uncertainty, horizon, **source_id→source_record** | derived (anchors to inputs' provenance) |
| `public_report` | incident_id, source, status, confidence, confidence_components(jsonb), geom_generalized, **geom_precise** (responder-only), consent, purge_after, **source_id** | ✔ |
| `sitrep` | incident_id, generated_at, summary, priorities(jsonb), trend, ai_mode | via citation |
| `citation` | sitrep_id, **source_id**, field, claim | ✔ |
| `source_record` | source, adapter, fetched_at, license, mode (LIVE/CACHED/MOCK/DB — SERVED provenance, §2.1) | — (is the anchor) |
| `alert` | incident_id, cap_status (DRAFT/ACTUAL), category, severity, area(geom), edxl_kind, sent_at, **approved_by→app_user**, **threshold_rule_id→threshold_rule** (set when threshold-fired, EV6) | provenance[] |
| `threshold_rule` | target, operator, value, scope, hysteresis, cooldown | — (config) |
| `resource` | kind, status, geom, org | agency-owned |
| `resource_task` | resource_id, incident_id, status (PROPOSED→…→CLEARED), target(geom), edxl_rm_ref | — |
| `shelter` | geom, capacity, occupancy, status, org *(agency-entered/seeded, U2)* | — |
| `evac_route` | incident_id, geom, avoids_hazard, suggested_start | derived |
| `app_user` | role (PUBLIC/RESPONDER/VERIFIER/EM), org | — |
| `audit_event` | actor_id, action, target, at *(append-only, hash-chained — THREAT §9)* | — |

**Structural invariants** (contract-tested): every datum row has a `source_id` → `source_record` (Art.
XI); every `citation` → a real `source_record`; no `alert` reaches `ACTUAL` without `approved_by` (Art.
XIII); `geom_precise` is never serialized to a non-RESPONDER role (Art. XIV/ST3).

### 3.2 Indexes

- **Spatial** (PostGIS path): GiST on every `geom` that is intersected/queried — `hazard_geometry.geom`,
  `infrastructure_node.geom`, `gauge.geom`, `shelter.geom`, `region.bbox`, `public_report.geom_*`. Turf
  path: a bounding-box (lon/lat) btree composite + in-process Turf intersection over the region-scoped
  candidate set (capped per §10).
- **Foreign-key / hot-path btree:** `incident(region_id, status)`, `hazard_geometry(incident_id, observed_at)`,
  `exposure(incident_id, node_id)`, `public_report(incident_id, status)`, `citation(sitrep_id)`,
  `*(source_id)` on all anchored tables, `resource(org, status)`, `audit_event(target, at)`.
- **Freshness/ordering:** `source_record(source, fetched_at desc)`; partial index
  `alert(incident_id) WHERE cap_status='DRAFT'` for the verifier queue.

### 3.3 Migration plan

- Drizzle migrations under `src/adapters/persistence/migrations/`, applied via `npx drizzle-kit migrate`
  (AGENTS §2). Migrations are **forward-only with an explicit down** per file; never edited after merge
  (immutable history). `0000_init` creates all 19 tables on the Turf default (jsonb geometry); a guarded
  `0001_postgis` migration (run only when `FEATURE_SPATIAL=postgis`) adds the PostGIS extension and
  `geometry` columns + GiST indexes, backfilling from jsonb. The two spatial paths satisfy the same
  `SpatialPort` contract (F11) so a deployment runs **one** path.
- Boot order: fail-fast config validation (U5/F10) → run pending migrations → seed (idempotent) → start
  workers. CI runs migrations against an ephemeral Postgres (Gate 4).

### 3.4 Seed data

Idempotent seed (`src/main/seed.ts`, keyed by stable ids) for a runnable demo with **zero network**:

- **Regions** (Art. XVI portability, U4): **California — flagship, LIVE** (`enabled_adapters`: FIRMS, NWS,
  NWPS, USGS, Overpass, ORS); **Romania (EU) flood region — CACHED** (GloFAS, Copernicus EFFIS, MeteoAlarm-RO,
  Open-Meteo, WorldPop) via `source_mode_overrides` (D-25; GloFAS seeded, EFAS is the European live upgrade).
  `DEFAULT_REGION_ID` = California.
- **Shelters:** a seeded demo shelter set with capacity/occupancy/status (U2 — no open national live
  feed; agency-owned + EDXL-RM import).
- **App users:** one per role (`AUTH_MODE=dev`) for the local demo.
- **Threshold rules:** a starter declarative rule set (gauge-category crossing + hazard-buffer entry).
- **Mock fixtures:** recorded snapshots colocated per adapter under
  `src/adapters/sources/<id>/__fixtures__/` so `SOURCE_*_MODE=mock` + air-gapped serves a full COP
  (offline acceptance test F5).

### 3.5 Localization, time & units (multi-region correctness — D-34; implemented in wave MW-A)

Cross-region correctness rules, enforced at the anti-corruption layer and at the presentation edge.
Architecture of record: **ADR-030**.

- **Shipped locales — 14:** `en zh-Hans hi es ar fr bn pt-BR id ur ru ro fil el` (**RTL: `ar`, `ur`**).
  The registry is deliberately two-part: `config/locales.json` is the **data** truth (endonym, English
  name, `dir`, `script`, `review`, `font`) and `src/config/locales.ts` `LOCALE_IDS` is the **type** truth
  (a literal union, so a bad locale id is a `tsc` error). A drift-guard test asserts the two agree
  exactly, and `schemas/locales.schema.json` validates the JSON. The `LOCALE_IDS` allowlist is also the
  **path-traversal guard**: a locale id reaches a catalog file path, so only fixed ids are accepted
  (NFR-F7).
- **Catalogs:** ICU message catalogs at `messages/<locale>.json`, each carrying a `_meta` block
  (`locale`, `review`, `machineTranslated`, provenance comment). English is the source catalog and the
  fallback at every level. `tests/i18n/catalog-parity.test.ts` enforces key parity, ICU-argument parity,
  per-locale ICU compilation, `_meta` honesty, and the absence of blank strings.
- **Access layer:** `app/_lib/i18n.tsx` uses next-intl's **core** `createTranslator` behind a React
  context whose DEFAULT value is the English catalog. Consequences, all deliberate: **no i18n routing, no
  middleware, no `[locale]` route segment, no `NextIntlClientProvider`, and `next.config.mjs` untouched**;
  a component renders identical English with or without a provider (every pre-existing component test and
  visual baseline stays valid); a provider-less render can never leak a raw key; and message keys are
  **compile-checked** against `messages/en.json`.
- **Locale resolution:** the reader's choice is the **`beacon-locale` cookie** (locale is UI state, never
  a URL segment), resolved **server-side in the async root layout** — so `<html lang>` / `dir` and the
  localized `generateMetadata` are correct **on the first byte**, with no flash and no hydration
  mismatch. There is **no locale env var**: the default locale is registry-driven
  (`config/locales.json` `defaultLocale` + `DEFAULT_LOCALE` in `src/config/locales.ts`, both `en`).
- **Fallback:** the active catalog is **deep-merged over English server-side**, plus a
  `getMessageFallback` backstop — so a lookup can never miss and a raw key can never render.
- **Adding a language** is one catalog + one registry row + one `LOCALE_IDS` id (+ a font entry if the
  script is new). **No other source change.**
- **Fonts:** bundled, self-hosted `@fontsource/noto-sans-{arabic,devanagari,bengali}` **script subsets**
  at weights 400 and 700 — exactly 6 CSS imports in `app/layout.tsx`
  (`arabic-400/700`, `devanagari-400/700`, `bengali-400/700`), **~300 KB of `woff2` on disk**. Each
  package's Latin/latin-ext/math/symbols subsets are deliberately **not** imported, because Inter already
  covers those ranges. All six sit behind **one** `--font-sans` stack that matches **per glyph** —
  Latin/Greek/Cyrillic resolve to Inter and only a glyph Inter lacks falls through to a Noto face, so a
  reader never downloads a script they are not reading. No CDN (Art. XVI offline-first).
- **RTL:** logical CSS only (`margin-inline`, `padding-inline`, `inset-inline`, `text-align: start`),
  enforced by `tests/architecture/rtl-logical-css.test.ts`. **The map canvas never mirrors** — geography
  is not a reading order.
- **Language:** every ingested text datum carries a `lang` tag (from CAP `<info xml:lang>`, feed metadata,
  or detection); Romanian-language inputs (ANM/MeteoAlarm-RO CAP, RO news RSS, RO citizen SOS) are
  **passed through with their language tag** — the SitRep LLM narrates in the requested UI language and
  **cites the original**; the deterministic engine never depends on language. Multi-language CAP `<info>`
  blocks: select by region language, fall back `en`. Classifier/geocoder treats non-English input as data
  (Art. XIV; no translation ever alters a number).
- **Multilingual CAP** (`src/adapters/interop/cap-mapper.ts`): `CapOptions.translations` +
  `capTranslationsFor()` emit one `<info>` block per language — **region language first, English
  ALWAYS**; a language with no copy is **skipped rather than mislabelled**. `capMachineValuesAgree()`
  asserts `category`/`urgency`/`severity`/`certainty`/`responseType`/`web`/`area` are **identical** across
  every block: enum tokens are machine values and are never translated. With no translations supplied the
  output is **byte-identical** to before.
- **Presentation-only locale plumbing:** `InteractionRequest.locale?`, `NarrativeRequest.locale?`,
  `SynthesizeSitRepInput.locale?`. English or absent ⇒ a **byte-identical prompt**; the LLM still emits
  no figure (Art. XII / F3 holds unchanged).
- **Closed vocabulary at the presentation edge:** `ProjectedWeather` ships a `compass` **token** (8-point
  `N`,`NE`,…) plus `observedAt`, and the wind label is composed **client-side** from the catalog with
  locale-correct compass abbreviations (Romanian `V`/`SV`/`NV`, Russian `С`/`СВ`/`З`…). The engine's
  English `label` remains the CLI/API fallback — the wire keeps a stable machine value and the UI owns
  the prose.
- **Time:** **store UTC everywhere** (`timestamptz`); render in the **region's IANA timezone** declared as
  the required `tz` field in `config/regions.json` (`America/Los_Angeles`, `Europe/Bucharest`); freshness
  badges compute age in UTC and display local. Cron cadences are UTC.
- **Units:** **normalize to SI at the adapter boundary** (ACL): gauge/crest feet→meters (NWPS/USGS),
  mph→m/s, °F→°C; `THRESHOLD_RULE` values are **always SI**. **The UI displays SI everywhere, always
  labelled** — there is no per-region imperial display mode and no `units` region field (the unused,
  misleading `units` key was removed from `config/regions.json` in MW-B). Mixing raw source units past
  the ACL is a contract violation (adapter contract test asserts SI).
- **Browser gates:** `e2e/i18n-rtl.spec.ts` — Arabic first-paint RTL (`<html dir="rtl">` before any
  client JS), a raw-key-leak scan across `ar`/`ro`/`zh-Hans`, axe under **both** Arabic and Chinese, and
  one RTL visual baseline per viewport project.

**Known limitations (localization — MW-A; these belong in the consolidated SPEC limitations ledger
scheduled for MW-E):**

1. **Machine-translated locales are unreviewed.** All 13 non-English catalogs — **including Romanian** —
   are machine-translated and carry `review: machine` / `machineTranslated: true` in `_meta`. Romanian
   stays machine-labelled until the entrant reviews it. The label is surfaced in the UI while the locale
   is active; it is not removed until a human review actually happens.
2. **Basemap place labels cannot be localized.** The default MapLibre style
   (`app/_components/map/style.ts`) is **raster** OpenStreetMap tiles, so place labels are baked into the
   bitmaps — there is no `text-field` to switch. Only BEACON's own chrome translates. (A vector style
   with a localizable `name:<lang>` field would reintroduce a token/key dependency, which the tokenless
   keyless-demo requirement forbids.)
3. **Deterministic fact claims remain English**, language-marked — a deliberate **Art. XII** boundary,
   not an oversight: translating an engine-generated claim would put a language model between the data
   and the number.
4. **CJK text uses the system font stack.** A usable Simplified-Chinese face is 5–10 MB even subsetted by
   `unicode-range`, which would blow both the font budget and the repo-size budget. Every system able to
   display Chinese already ships one, and a system font is local — so the air-gapped guarantee still
   holds — but BEACON does not control the CJK rendering.

---

## 4. Adapter contract (ports & adapters, ACL, registry)

Every external source is a swappable adapter behind a port, added via the registry/manifest with **zero
core change** (Art. XV, FR-10). The adapter owns its anti-corruption mapping, last-known-good cache,
recorded-mock fallback, and circuit breaker; it MUST NOT leak raw formats above the ACL (Art. II/VIII).

### 4.1 The `SourceAdapter` port interface (shape)

```typescript
// src/ports/source-adapter.port.ts — interface only; depends on domain types (Art. II)
// NOTE: SourceMode is adapter-INTERNAL lowercase. At the API boundary it is serialized UPPERCASE
// (LIVE|CACHED|MOCK) — see §2.1, openapi.yaml SourceRef.mode, schemas/source-ref.schema.json.
export type SourceMode = "live" | "cached" | "mock";
// Coverage is the tagged-object shape — `schemas/adapter-contract.md §3` is CANONICAL:
export type Coverage =
  | { kind: "GLOBAL" }
  | { kind: "BBOX"; bbox: [number, number, number, number] }
  | { kind: "COUNTRIES"; iso: string[] };   // ISO-3166-1 alpha-2

export interface FetchContext {
  regionId: string;
  bbox: BBox;            // region bounding box (WGS84)
  mode: SourceMode;      // resolved from SOURCE_<NAME>_MODE + region override
  since?: string;        // ISO; incremental fetch hint
  signal: AbortSignal;   // timeout/cancellation
}

// A normalized result carries canonical domain objects + provenance, never raw upstream shapes.
export interface AdapterResult<T extends DomainDatum> {
  items: T[];
  sourceRecord: SourceRecordInput;   // source, adapter, fetchedAt, license, mode → stamped by ACL
  freshness: string;                 // ISO; oldest observation in this batch
  degraded?: { rung: "secondary" | "cache" | "mock" | "unavailable"; reason: string };
}

export interface SourceAdapter<T extends DomainDatum = DomainDatum> {
  readonly id: string;               // e.g. "overpass" — stable manifest key
  readonly port: PortId;             // which capability port it implements (P1..P13)
  readonly coverage: Coverage;       // OP4 region matching
  readonly license: string;         // tracked in NOTICE (Art. XIV)
  fetch(ctx: FetchContext): Promise<Result<AdapterResult<T>, AdapterError>>;  // never throws upstream
  health?(): Promise<HealthStatus>;
}
```

The capability ports (P1 Hazard, P2 Weather, P3 FloodGauge, P4 Infrastructure, P5 Outage, P6 NewsIntel,
P7 PublicReport, P12 Population, P13 Telecom — and driving ports P8 Routing, P9 ResourceLogistics, P10
AlertSink, P11 LLM, VisionPort) extend/specialize this shape with their domain-typed `items` (DOMAIN_MODEL
§6). `fetch` returns a typed `Result` — failure descends the ladder (§4.3), it never throws into the
domain (AGENTS §4).

### 4.2 Registry / manifest format

The composition root (`src/main`) builds an adapter registry from the manifest **`config/adapters.json`**
(declarative; addable with zero core change — FR-10/OP2), validated at boot against
**`schemas/adapter-manifest.schema.json`** (F10 fail-fast). Per-adapter config is env-driven via the
`configPrefix` (`SOURCE_<PREFIX>_MODE`, optional key, optional `_INTERVAL_SEC` — CONFIGURATION §6). The
canonical entry shape (verbatim from `config/adapters.json`, the OSM-Overpass adapter) is:

```jsonc
// config/adapters.json (validated at boot vs schemas/adapter-manifest.schema.json; F10 fail-fast)
{
  "$schemaVersion": "1.0",
  "adapters": [
    {
      "id": "osm-overpass",                 // stable id == SourceAdapterPort.id == SourceRecord.adapter (kebab-case)
      "port": "Infrastructure",             // known port id (registry rejects unknown ports at boot)
      "entity": "InfrastructureNode",       // optional canonical entity produced
      "source": "OSM Overpass",             // display/canonical upstream name → SourceRecord.source
      "module": "@/adapters/osm-overpass-adapter",  // dynamic import; must export a SourceAdapterPort
      "coverage": { "kind": "GLOBAL" },     // tagged Coverage: GLOBAL | { kind:"COUNTRIES", iso:[...] } | { kind:"BBOX", bbox:[...] }
      "mode": "LIVE",                       // redundancy-ladder mode: LIVE | CACHED | MOCK (SOURCE_<PREFIX>_MODE override)
      "intervalSec": 600,                   // poll cadence (SOURCE_<PREFIX>_INTERVAL_SEC override)
      "configPrefix": "OVERPASS",           // env prefix the adapter reads
      "license": "ODbL",                    // → SourceRecord.license, tracked in NOTICE (Art. XIV)
      "attribution": "© OpenStreetMap contributors",
      "cache": { "ttlSec": 900 },           // last-known-good cache block
      "circuitBreaker": { "failureThreshold": 5, "cooldownSec": 120, "halfOpenTrials": 1 },
      "mock": { "fixture": "osm-overpass/lifelines.json" },  // recorded-mock fallback (enables F5 offline test)
      "verifiedTier": "LIVE"                 // verified verdict per audit/DATA_SOURCE_VERIFICATION.md
    }
  ]
}
```

The full, authoritative manifest (all registered adapters incl. the `camara-gsma` plugin, FR-16) lives in
**`config/adapters.json`**; its field set is canonical per `adapter-contract.md` §5 and
`schemas/adapter-manifest.schema.json`.

The region registry (`config/regions.json`, `REGIONS_CONFIG`) lists `enabled_adapters[]` + per-source
`source_mode_overrides`; the resolver matches each layer's adapter `coverage` to the region scope and, on
no match, marks the layer **"not available in this region"** and substitutes a global-equivalent where
one exists (OP4/Q9). **Full substitution table (D-32):** flood `NWPS/USGS ⇄ GloFAS/LANCE-NRT`; fire
`FIRMS/NIFC ⇄ EFFIS/GWIS/EONET`; weather `NWS ⇄ ANM/MeteoAlarm/Open-Meteo/met.no`; official alerts
`NWS-CAP ⇄ MeteoAlarm-CAP ⇄ worldwide CAP-aggregator (Alert-Hub/IFRC)`; population `Census/NRI ⇄
WorldPop/HDX`; air/smoke `AirNow ⇄ OpenAQ/Sensor.Community`; **outage `EAGLE-I ⇄ derived`** — outside the
US the outage layer carries ONLY the hazard∩infrastructure "assumed-offline" computation (labeled
"derived"), and **explicitly says "no live power-outage feed for this region"** (never an empty toggle;
this labeling is an acceptance criterion of the RO golden path, E8·T-364a). An internet-outage *proxy*
signal (Cloudflare Radar + Georgia Tech IODA) was built and tested but **dropped before registration**:
IODA serves every response under "Copyright © 2021-2025 Georgia Tech Research Corporation. All Rights
Reserved." with no open-licence grant, which fails the free/open-data rule (Art. IX, AGENTS §9). There is
therefore no proxy rung here — the RO outage layer is derived-or-nothing, and says so.

### 4.3 Resilience behaviour (per adapter — Art. XV/XVI)

Every adapter implements one degradation ladder, always labeling freshness, never a dead-end (UW2):

```
live (primary API) → secondary/global-equivalent → last-known-good cache → recorded mock → "unavailable (as of <freshness>)"
```

- **Last-known-good cache:** every successful `live` result is written to the cache (CachePort, TTL
  `CACHE_TTL_SEC`, default 900 s). On `live` failure/timeout, the adapter returns the cached batch with
  `degraded.rung="cache"` and the cache's original `freshness` (UW2).
- **Recorded-mock:** on cache miss (or `SOURCE_*_MODE=mock`), serve the adapter's colocated
  `__fixtures__/` snapshot, `degraded.rung="mock"`, freshness = fixture timestamp (OP3). Enables the
  air-gapped acceptance test (F5).
- **Circuit breaker:** see §8.1 for thresholds/backoff. An open breaker skips the live call and goes
  straight to cache/mock until half-open probe succeeds.
- **`SOURCE_*_MODE` lifecycle:** `live` → real API; `cached` → serve last-known-good/snapshot only (no
  egress for that source); `mock` → fixtures only (CONFIGURATION §6, OP3). A source's verified verdict is
  in `audit/DATA_SOURCE_VERIFICATION.md`; re-confirm live before flipping any `SOURCE_*_MODE=live` (PRD §13).

### 4.4 Worked example — OSM Overpass adapter (P4 Infrastructure)

- **Port:** `P4 InfrastructureSourcePort`. **Coverage:** `global`. **License:** ODbL (NOTICE). **Mode env:**
  `SOURCE_OVERPASS_MODE`. **Interval:** `SOURCE_OVERPASS_INTERVAL_SEC` (default `INGEST_DEFAULT_INTERVAL_SEC`
  = 300 s; infra is slow-changing — see §8.5).
- **Fetch (live):** POST an Overpass QL query bounded by `ctx.bbox` for the lifeline node types
  (`amenity=hospital`, `amenity=nursing_home`, `power=*`, `man_made=communications_tower`, highway/rail) →
  receives Overpass JSON (raw `elements[]` with `lat/lon`/`center`/`tags`).
- **ACL mapping:** normalize each element → `InfrastructureNode { type ∈ {HOSPITAL,NURSING_HOME,POWER,
  CELL,ROAD,RAIL,SHELTER}, geom (GeoJSON Point/Way centroid), status: ONLINE (default) }`; raw Overpass
  shapes are dropped at the ACL (no `tags`/`elements` above it — Art. VIII). The ACL stamps a
  `SOURCE_RECORD { source:"OVERPASS", adapter:"overpass", fetchedAt:now, license:"ODbL", mode }` and the
  batch `freshness`.
- **Degrade:** live timeout/`429` → cached infra (Overpass nodes change rarely, cache is high-value) →
  fixture (`fixtures/overpass/ca.json`) → "infrastructure unavailable (as of …)". Circuit breaker opens
  after the configured failure threshold (§8.1).
- **Downstream:** the normalized nodes feed `RiskIntersection`/`Exposure` (§5.1) which sets each node's
  `status` to `AT_RISK`/`OFFLINE` deterministically (DOMAIN_MODEL §4) — the adapter never decides exposure.

---

## 5. Deterministic engine spec (Art. XII — the LLM never computes these)

All numbers, rankings, distances, exposures, crest values, confidence, routes, and capacity math are
computed in `src/application` use-cases over `src/domain`, using Turf.js / SQL / typed code — pure,
reproducible, unit-tested (**F3** asserts no figure originates from the LLM).

### 5.1 Risk intersection / exposure (FR-3, EV2, ADR-005)

For an incident's `hazard_geometry[]` and the region's `infrastructure_node[]` (+ population), via
`SpatialPort` (Turf↔PostGIS):
- A node is `inside_hazard` iff its point is within any hazard polygon (`turf.booleanPointInPolygon` /
  PostGIS `ST_Within`) → `reason=IN_POLYGON`. Else compute `distance_m` to nearest hazard
  (`turf.pointToLineDistance`/`ST_Distance`); if `distance_m ≤ buffer` (config per node type) →
  `reason=IN_BUFFER`. An EAGLE-I/derived outage sets `reason=OUTAGE`.
- Node `status` transitions deterministically (DOMAIN_MODEL §4): `ONLINE → AT_RISK` (within buffer) →
  `OFFLINE` (inside high-intensity polygon or confirmed outage). Each `EXPOSURE` row stamps `computed_at`.
- People exposure = projected/known population (WorldPop/Census) ∩ hazard extent (impact-over-time at
  horizons — §5/FR-12).

### 5.2 Weighted priority ranking (FR-13, ADR — engine source of truth)

Ranked attention areas = a deterministic weighted score per exposed cluster/node:

```
priority_score = 0.45 · proximity     // normalized (1 − distance_m / buffer), clamped [0,1]; inside_hazard ⇒ 1.0
              + 0.35 · vulnerability   // node-type weight (HOSPITAL/NURSING_HOME high; ROAD low) × OFFLINE boost
              + 0.20 · population       // normalized exposed-population at the node/cluster
```

Weights live in config (config-for-everything, U5); the function is pure and unit-tested. The LLM
**narrates** the ranking (`priorities[].rationale`) but never reorders or invents it (Art. XII/F3).

### 5.3 Threshold-rule evaluation (FR-11, EV6, ADR-014, CLARIF Q5)

Declarative JSON rules (DOMAIN_MODEL `THRESHOLD_RULE`; schema `schemas/threshold-rule.schema.json`)
evaluated each ingestion cycle over the canonical model:

```jsonc
{ "id":"...", "target":"GAUGE_CATEGORY|HAZARD_BUFFER",
  "operator":"crosses|gte|enters", "value":"MODERATE|<meters>|<infra_type>",
  "scope":"<region_id>", "hysteresis":"<min_dwell>", "cooldown":"<minutes>" }
```

- **Edge-triggered:** fires on a transition **across** `value` (not on every cycle the condition holds).
  `hysteresis` requires the new state to dwell `min_dwell` before firing (anti-flap); `cooldown` de-dups
  repeat fires.
- On fire: create `ALERT(cap_status=DRAFT)` with `provenance[]` to the triggering `SOURCE_RECORD`, write
  an `AUDIT_EVENT`, surface for human review. **No CAP is emitted until a VERIFIER approves** (Art. XIII;
  **F8**). Evaluation is deterministic and unit-testable.

### 5.4 Confidence blend (FR-5, ADR-015, CLARIF Q4)

`PUBLIC_REPORT.confidence ∈ [0,1]` is a deterministic weighted blend (weights in config):

```
confidence = 0.40 · geocode_precision   // exact/street/area/centroid
          + 0.30 · source_authority    // official > consented web/SMS > public-social (assigned server-side, T1.9)
          + 0.20 · classifier_score    // LLM "in-danger" intent certainty (cited)
          + 0.10 · corroboration        // independent nearby/official corroboration
```

The LLM supplies **only** `geocode` + `classifier_score` (each cited); the blend is computed in code so
it is reproducible and testable (Art. XII). The API surfaces `confidence_components`, not just the number.

### 5.5 Hazard-avoiding routing (FR-7, EV7, ADR-016)

`EvacRouting` (RoutingPort ladder ORS → Valhalla/OSRM → straight-line+avoid heuristic — §8) requests a
route from the endangered point to the nearest open shelter(s), passing the hazard polygon as an
**avoidance constraint**. `CapacityMatch` ranks shelters deterministically by distance × available
capacity (`capacity − occupancy`, status `OPEN`). The result sets `EVAC_ROUTE.avoids_hazard`; if no
engine can avoid the hazard the heuristic returns a straight-line + nearest-safe-shelter with
`avoids_hazard=false` clearly labeled (never a dead-end, Art. XVI).

### 5.6 Predictions (FR-12, EV8, CLARIF Q8) — labeled first-order only

Each `PREDICTION` carries `method`, `inputs`, `uncertainty`, `horizon`: **fire cone** = directional
buffer from perimeter/hotspots along the NWS wind vector (bearing=wind dir, length ∝ wind speed × horizon)
labeled "first-order projection"; **flood inundation** = NWPS forecast-crest ∩ FEMA NFHL (+ terrain where
available) with lead-time + NFHL-effective-map caveat; **impact-over-time** = projected extent ∩
WorldPop/Census + infrastructure at horizons. No physics-grade claims (out of scope, PRD §12).

### 5.7 Escalation trend & suggested evacuation start time (FR-4/FR-7, EV3/EV7) — deterministic (Art. XII)

Both outputs are computed in `src/application` (Turf/SQL/typed code), never by the LLM (the LLM only
narrates the resulting label/time — F3). They have homes in the canonical model: `SITREP.trend`,
`PREDICTION(kind=ESCALATION)`, and `EVAC_ROUTE.suggested_start`.

**Escalation trend** (`SITREP.trend ∈ {ESCALATING, STEADY, DEESCALATING}`):

```
window  = the last TREND_WINDOW_SEC (config, default 3600 s) of the trend signal:
            wildfire → hotspot-count (FIRMS detections inside the incident footprint),
            flood    → gauge-stage (primary NWPS/USGS gauge for the incident).
slope   = least-squares linear-regression slope of signal vs. time over the window
            (≥ TREND_MIN_SAMPLES points, default 3; else STEADY — insufficient data).
trend   = ESCALATING    if slope > +TREND_DEADBAND
          DEESCALATING  if slope < −TREND_DEADBAND
          STEADY        otherwise            // dead-band absorbs noise / flat slopes
```

`TREND_DEADBAND` (config) is a per-signal threshold expressed in signal-units / hour so a flat-but-noisy
series reads STEADY, not flapping. The slope, window, sample count and dead-band are surfaced as the
`PREDICTION(kind=ESCALATION).inputs`/`method`/`uncertainty` (labeled first-order, §5.6) and cited in the
SitRep. Pure and unit-tested (edge cases: too-few samples, exactly-on-dead-band, monotonic vs noisy).

**Suggested evacuation start time** (`EVAC_ROUTE.suggested_start`):

```
suggested_start = projected_hazard_arrival − route_clearance_time − safety_margin
  projected_hazard_arrival = horizon at which the first-order projection (fire cone / flood inundation,
                             §5.6) reaches the endangered point/destination origin (null ⇒ suggested_start null)
  route_clearance_time     = deterministic travel/clearance estimate for the computed evac route
                             (RoutingPort duration, §5.5)
  safety_margin            = config buffer (EVAC_SAFETY_MARGIN_SEC, default 1800 s)
```

If `projected_hazard_arrival` is unknown (no projection / hazard not approaching the origin),
`suggested_start = null` and the route is returned without a suggested start (never a dead-end, Art. XVI;
the field is nullable in DDL/OpenAPI). All three terms are deterministic; the value is reproducible and
unit-tested.

---

## 6. AI spec (ADR-007/008; Art. XII/XIV)

### 6.1 LLMPort ladder (text — ADR-007)

`LLMPort` via LiteLLM. Each tier is fully env-configured (provider/model/API base/key — CONFIGURATION §4),
so any tier can point at any OpenAI-compatible endpoint. The ladder degrades:

```
AI_MODE=cloud: Groq (default) → OpenRouter/Claude Haiku → local Ollama → deterministic-only
AI_MODE=local: local Ollama → deterministic-only
AI_MODE=off:   deterministic-only (no narrative)
```

A tier is descended on timeout (`LLM_REQUEST_TIMEOUT_SEC`=30) or schema/citation failure. Input grounding
is capped at `LLM_MAX_INPUT_TOKENS` (8000), output at `LLM_MAX_OUTPUT_TOKENS` (1500), `LLM_TEMPERATURE`=0.1
(grounded, not creative). The LLM has **no tools/actions** — it emits a JSON narrative only (THREAT §10.2).

### 6.2 VisionPort ladder (ADR-008; OP1; Q11) — advisory/stretch

`VisionPort`: `cloud vision → local LLaVA → skip` (`FEATURE_VISION` default `off`; `VISION_MODE`). Use
cases: Sentinel-2 burn-area/NBR + optical/SAR flood-extent (labeled "estimated from imagery"); consented
SOS-photo scene/damage classification feeding triage confidence; map/scene assist. **Vision output is
advisory, cited, confidence-scored — it never auto-alerts and never overrides deterministic geometry**
(Art. XII; F3). Every image is consent-checked + PII-screened (`VISION_PII_SCREEN=on`, THREAT §11.3)
before any processing. Absent a vision model, the system skips it (advisory absent) — no golden-path dependency.

### 6.3 Grounding, JSON-schema validation & citation enforcement

- **Grounded-only:** the model sees only pre-computed, pre-screened, **cited** facts (the deterministic
  `priorities`/`exposure` + selected `SOURCE_RECORD` claims) passed as delimited data fields in a fixed
  template — never concatenated with raw source/user text (structural separation, THREAT §10.2, LLM01).
- **Schema-bound output:** the response MUST validate against the SitRep JSON-Schema (`schemas/sitrep.schema.json`)
  with a `citations[]` for every generated field. On parse/contract/citation failure → **reject + fall
  back to deterministic-only** (no free-form text) — UW3/F4. No numbers in the LLM output are trusted; the
  envelope's numbers come from `data` (the engine).
- **Egress constraints:** no free-form URLs / markdown image links in output (blocks exfiltration beacons,
  THREAT §10.2). PII/secrets never enter the prompt context (Art. IV).

### 6.4 Offline / AI-off path (UW1/UW3/UW4; Art. XII/XVI)

With the LLM down, schema-failing, or `AI_MODE=off`/`local` air-gapped (local Ollama or no-LLM), the
system still returns ranked priorities + exposure + the COP from the deterministic engine (the AI is an
amplifier, never a single point of failure). This is the **AI-disabled** redundancy acceptance test (F7).

### 6.5 AI Compliance Proxy — the mandatory gateway in front of every model call (ADR-017/018/022)

Every `LLMPort` (§6.1) and `VisionPort` (§6.2) call routes through one in-process `AICompliancePort`
reverse-proxy gateway **before** it reaches any provider adapter — controls are structural, not
per-adapter goodwill. The provider adapters refuse any request not stamped by the gateway, so the
chokepoint is unbypassable. Fixed pipeline:

```
JWT / role-scope → circuit-breaker → rate-limit (per-caller, config/policies.yml rate_limit; T1.6/LLM10) →
semantic firewall (prompt-injection / instruction-override / destructive-command / SSRF / secret-file-access
— regex + classifier pre-filter) → policy-as-code (config/policies.yml, validated at boot vs
schemas/policies.schema.json) → PII detect+redact → cost guardrails (§6.5.1) → hash-chained append-only
AUDIT_EVENT + OTel GenAI spans (§6.5.2) → upstream
```

- **Safety fail-closed:** PII-egress, prompt-injection, and blocked-command controls **block the call on
  any control error** (short-circuit `403`) regardless of budget or autonomy tier (ADR-017; §10.2,
  COMPLIANCE_MATRIX §3).
- **Availability degrades gracefully, never a dead-end:** a breaker-open / upstream failure descends the
  ADR-007/008 ladder (`503`/ladder-descent → local Ollama → deterministic-only — Art. XVI), it does not
  fail the request hard. In-prompt + provider-side controls survive only as inner defense-in-depth
  layers of this gateway, never as the authority.

**§6.5.1 Cost guardrails + budget posture (ADR-018).** Five harness-enforced deterministic-floor
guardrails the model cannot reason past — (1) consumption cap (token/USD per task & session), (2)
temporal/wall-clock boundary, (3) loop/pagination cap, (4) delegation-depth cap, (5) idempotency/dedup
keys — plus **pre-step cost reservation** (estimate worst case → `reserve()`/`can_afford()` → reject at
the gate → execute → reconcile actual vs reserved). Budget posture (LOCKED): **soft within budget**
(auto-proceed, per-call `AUDIT_EVENT`); **HARD-BLOCK + human approval only when a configurable
`escalation_threshold_usd` or a per-incident/region/org budget cap is exceeded** (Tier B — §10.2,
COMPLIANCE_MATRIX §3); safety
always fail-closed regardless of budget. A `degrade → escalate → terminate` breaker bounds runaways
(denial-of-wallet, THREAT T6.4/LLM10). Thresholds/caps live in `config/policies.yml` (`budget` block).

**§6.5.2 Observability + cost attribution (ADR-022).** Each AI-assisted operation emits a **5-level OTel
GenAI span tree** — `L0 execute (incident request) → L1 plan (synthesis orchestration) → L2 discover
(gather grounding facts) → L3 execute (the LLM/Vision call via the gateway) → L4 retrieve (citation/source
resolution)` — with `gen_ai.usage.input_tokens` / `…output_tokens` / `gen_ai.request.model` + a derived
deterministic `cost.usd` (tokens × tier rate, Art. XII). Guardrail, firewall, breaker, reservation, and
HITL events are trace-linked. The `AUDIT_EVENT` record is **cost-extended** with `cost_tokens_in`,
`cost_tokens_out`, `cost_usd`, `model_tier` (§3.1; schema.sql). An opt-in, critical-only **verifier-agent**
(a *different model family*) may cross-check critical outputs — advisory, never authoritative (the human +
deterministic engine remain the truth). **Privacy sampling:** prompt/response *content* capture is **off
in prod** (spans carry token counts/model/latency/cost/decision metadata only — no PII, no raw text);
content capture is a dev-only opt-in. OTLP export is optional (`OTEL_EXPORTER_OTLP_ENDPOINT`); the
hash-chained audit trail is authoritative without it.

The complete control→standard cross-walk (OWASP LLM Top-10 2025 / ASI01–ASI10, NIST AI RMF, ISO/IEC
42001, EU AI Act, MITRE ATLAS) and the Tiered Autonomy (A/B/C) governance are in
`docs/architecture/COMPLIANCE_MATRIX.md`; the proxy trust boundary is **TB11** in
`docs/architecture/THREAT_MODEL.md`.

---

## 7. Interop spec (ADR-010; FR-9/EV10) — CAP v1.2 + full EDXL-RM + EDXL-SitRep

`AlertSinkPort` (P10) serializes canonical entities to standards at the boundary; the JSON-Schemas are
authored in `schemas/` (CAP v1.2, EDXL-RM, EDXL-SitRep) by another agent. Every emitted message is
**validated against its JSON-Schema before send** (F15); the XML serializer has **XXE/entity-expansion
disabled** (THREAT T2.4). `EDXL_VERSION=1.0`; `CAP_SENDER` identity from config; `CAP_EMIT_MODE`
`draft`→`actual` only on human approval (Art. XIII); `IPAWS_ENABLED=off` (produce+validate only, no live
origination — C6).

### 7.1 CAP v1.2 (events → alerts; FR-9, EV5/EV10)

`ALERT` → CAP `alert/info/area`. `cap_status=DRAFT` maps to CAP `status=Draft`; promotion to `ACTUAL`
(human-approved) emits `status=Actual`. `category` (Fire/Met/Safety), `severity`
(Minor/Moderate/Severe/Extreme), `area` (polygon/circle) map directly. CAP payload is built from
**generalized/derived fields only** — no reporter PII (THREAT T2.6). `POST /alerts` composes + validates.

### 7.2 Full EDXL-RM mutual-aid round-trip (U1/Q2; request → commit → response)

Per CLARIF U1 this is the **full mutual-aid lifecycle**, not a subset. Canonical `RESOURCE`/`RESOURCE_TASK`
are the source of truth; EDXL-RM is a boundary serialization via the `EdxlPort` adapter. S03 defines the
field mapping (internal entity ↔ EDXL-RM element) and the JSON-Schemas for the full message set:

| EDXL-RM message | Direction | Maps to | Endpoint |
|---|---|---|---|
| **RequestResource** | inbound/outbound | creates/links a `RESOURCE_TASK(status=PROPOSED)`, `edxl_rm_ref` set | `POST /edxl/rm` |
| **ResponseToRequestResource** / **OfferUnsolicitedResource** | response | matches a `RESOURCE` (org-owned, BFLA-checked T2.8) → `PROPOSED→TASKED` | `POST /edxl/rm` |
| **CommitResource** | commit | `RESOURCE_TASK → TASKED/ENROUTE`; locks the resource to the requesting org | `POST /edxl/rm` |
| **ReleaseResource** / **RequestReturn** | close | `RESOURCE_TASK → CLEARED`; resource `AVAILABLE` | `POST /edxl/rm` |

`GET /edxl/rm/:id` returns the canonical task + its serialized EDXL-RM message (the **round-trip**: import
→ canonical → re-export, validated both directions — `edxl-roundtrip.feature`, F15). Org ownership is
enforced on every commit (RESPONDER own-org/EM only — THREAT T2.8/T7.3).

#### 7.2.1 `deploymentStatus` ↔ `RESOURCE_TASK.status` mapping (normative — F15)

The EDXL-RM `deploymentStatus` value (9 OASIS RM 1.0 values) maps to the canonical
`RESOURCE_TASK.status` (5 values: `PROPOSED|TASKED|ENROUTE|ONSCENE|CLEARED`) at the boundary, each EDXL
value to the **nearest** task state. Values with no task-state equivalent are **informational only** —
they are recorded on the message/audit trail but do not by themselves transition a `RESOURCE_TASK`.

| EDXL-RM `deploymentStatus` | `RESOURCE_TASK.status` | Notes |
|---|---|---|
| `Requested` | `PROPOSED` | request created/linked the task |
| `Committed` | `TASKED` | resource committed/locked to the requesting org |
| `Acknowledged` | `TASKED` | nearest active state (commitment acknowledged) |
| `EnRoute` | `ENROUTE` | direct |
| `Arrived` | `ONSCENE` | direct |
| `Demobilized` | `CLEARED` | stood down / released |
| `Returned` | `CLEARED` | resource returned → `AVAILABLE` (ReleaseResource/RequestReturn) |
| `Available` | — | *informational only* — describes resource readiness, not a task transition |
| `Unavailable` / `OutOfService` | — | *informational only* — resource OOS; no task-state change |

The mapping is deterministic and contract-tested as part of the EDXL-RM round-trip conformance (F15).

### 7.3 EDXL-SitRep (situation summaries; FR-9)

`POST /edxl/sitrep` serializes a (cited, PII-screened) situation summary derived from the deterministic
SitRep + exposure to EDXL-SitRep 1.0. No precise PII in the payload (THREAT §11). Validated against
`schemas/edxl-sitrep.schema.json` before send (F15).

> **Standards-status note (verified 2026-06-29):** **EDXL-RM 1.0 is a full OASIS Standard**, but
> **EDXL-SitRep 1.0 is an OASIS *Committee Specification* (CS02, 2016)** — a stable, citable committee
> deliverable, not an OASIS Standard. BEACON treats both as boundary serializations regardless of track;
> the distinction is documented here for accuracy.

### 7.4 Sustainability reporting (ADR-020) — `GET /.well-known/sustainability` (optional out-of-core plugin; basic alignment example; non-blocking)

A discoverable, machine-readable disclosure of BEACON's own aggregate energy/carbon impact, served
**out-of-band** per the public RFC draft `draft-besleaga-green-sustainability-wellknown-05` (RFC 8615
well-known URI, I-JSON). It adds **zero per-request overhead** to the crisis hot path (per-request
sustainability headers are explicitly rejected — rebound effect + real-time-telemetry privacy risk). The
document is heavily cached (`Cache-Control`/ETag), rate-limited on parameterized (`?period=&granularity=`)
requests, capped at ≤366 array objects, and **validated against `schemas/sustainability-v05.schema.json`**
before serve (**F18**). Values are **modeled/estimated** (`measurement-method: "third-party-modeled"`,
`methodology-uri` → `docs/SUSTAINABILITY.md`) with GHG-scope + GSF SCI optional fields and honest
"estimated/modeled (demo)" labeling (Art. XII — numbers are deterministic/modeled, the LLM never touches
them; honest-limitations). A thin App-Router route delegates to a use-case that emits the schema-valid
document. Methodology + the SFC engineering-profile C1–C4 checklist live in **`docs/SUSTAINABILITY.md`**.

> **Provenance note (verified 2026-06-29):** `draft-besleaga-green-sustainability-wellknown-05` is an
> **individual IETF Internet-Draft authored by the project author** (NOT an RFC, NOT an adopted IETF/WG
> standard) and **SFC profile 1.1 is the author's own profile** (not an adopted industry standard) — both
> are *author-originated alignment examples*. The recognized standards this surface maps to are **GSF SCI
> (ISO/IEC 21031:2024)**, **GHG Protocol**, **CSRD/ESRS-E1**, and **RFC 8615**. See ADR-020 for the full
> provenance. ("RFC draft / RFC v05" shorthand above = "Internet-Draft v05.")

---

## 8. Error / retry / circuit-breaker / cache policy + refresh cadence

### 8.1 Per-adapter circuit breaker & retry (Art. XV/XVI; UW2; THREAT T5.4)

| Parameter | Default | Notes |
|---|---|---|
| Per-call timeout | `LLM_REQUEST_TIMEOUT_SEC` (LLM, 30 s) / 15 s (data adapters) | abort via `AbortSignal` |
| Retry policy | up to 2 retries, **exponential backoff w/ jitter** (250 ms → 500 ms → 1 s, ±20%) | only on transient (5xx/timeout/`429` honoring `Retry-After`) |
| Breaker open threshold | 5 consecutive failures **or** 50% failures in a 10-call rolling window | per adapter id |
| Breaker open duration | 60 s, then **half-open** single probe | success closes; failure re-opens |
| On open | skip live → serve cache → mock → "unavailable + freshness" | never throws into domain |

### 8.2 LLM/Vision laddering

Descend a tier on timeout or schema/citation failure (no retry-storm on a hard schema failure — descend
immediately, §6.3). Final rung is always deterministic-only (UW1/UW3) or skip-vision (OP1).

### 8.3 Cache (CachePort; ADR-005)

Last-known-good cache (in-memory default ↔ Redis Streams flag, OP2/F11). `CACHE_TTL_SEC` default 900 s.
A cache entry stores the normalized batch + original `freshness`; serving from cache always preserves the
original freshness (never relabels a stale entry as fresh — THREAT T14.3/U4).

### 8.4 Staleness labeling

A layer is marked **stale** in the UI/envelope when `now − freshness > 2 × refresh_cadence` for that
source, and **unavailable** when even cache+mock are empty. `freshness` is always present; degradation is
always labeled (U4, never a silent stale map).

### 8.5 Data-refresh cadence (per source · `SOURCE_<NAME>_INTERVAL_SEC`)

Defaults below; all overridable per source/region (config). `INGEST_DEFAULT_INTERVAL_SEC` = 300 s.
This table is **cadence-only**: the LIVE/CACHED/MOCK tier verdicts are single-sourced to
`audit/DATA_SOURCE_VERIFICATION.md` (PRD §9) — do not duplicate the tier column here.

| Source | Default cadence | Notes |
|---|---|---|
| NASA FIRMS (hotspots) | 300 s | satellite revisit gaps stated openly (Art. XV) |
| NWS api.weather.gov (alerts/weather) | 120 s | `NWS_USER_AGENT` required |
| NOAA NWPS (flood gauges/forecast) | 300 s | crest forecast + lead time |
| USGS Water (gauge stage) | 300 s | |
| OSM Overpass (infrastructure) | 86400 s (daily) | slow-changing; high-value cache |
| GDELT (news intel) | 900 s | |
| ReliefWeb v2 (news intel) | 1800 s | `RELIEFWEB_APPNAME` |
| OpenRouteService (routing) | on-demand | `ORS_API_KEY`; not polled |
| GDACS / Open-Meteo (global secondary) | 900 s / 600 s | global-equivalents (OP4) |
| GloFAS / Copernicus EFFIS / MeteoAlarm | snapshot (nightly) | global-equivalents (EU region) |
| FEMA NFHL / WorldPop / EAGLE-I / OpenCelliD / HIFLD | snapshot (nightly/periodic) | EAGLE-I = derived "assumed-offline" (C4) |
| CAMARA/GSMA · IPAWS aggregate · Sentinel-2 NBR (vision) | n/a | gated/optional |

---

## 9. Testing & CI/CD strategy (SUMMARY — canonical plans govern)

> **This section is a summary.** The binding day-one matrix is specified in
> **`docs/TEST_PLAN.md`** (test layers + coverage), **`docs/EVAL_PLAN.md`** (AI evals), and
> **`docs/CI_CD.md`** (pipeline + supply-chain gates), adopted as **MANDATORY from S05 by ADR-019**.
> Where this summary and those plans disagree, the plans govern (do not duplicate their detail here).

**Spec → evals → test → code** (Art. I). No requirement without a test; the golden thread (§1.1) stays
intact. Tooling is the LOCKED stack: **Vitest** (`npm test`, `--coverage`), Gherkin/BDD per FR, contract
tests for the fitness functions, Playwright e2e for the golden path, plus property-based (fast-check),
metamorphic, mutation (Stryker), and a chaos/fault-injection harness. Coverage target **≥99% line**
overall (Gate 3); the **contract/redundancy fitness functions are mandatory regardless of layer**.

**Full day-one matrix (MANDATORY, ADR-019 — see the canonical plans for specifics):**

- **Test layers:** unit/TDD (domain+application, pure) · integration (adapters + ephemeral-Postgres
  migrations + API routes, both Turf and PostGIS spatial paths) · **contract = the fitness functions
  F1–F19** (executable architecture) · **BDD — one Gherkin `.feature` per FR** (Gate 7) · e2e golden-path
  · visual-regression · property-based · metamorphic (AI) · mutation (nightly) · chaos/fault-injection
  formalizing the 3 redundancy acceptance tests · **AI evals** (eval-driven, `docs/EVAL_PLAN.md`).
- **Three mandatory redundancy acceptance tests** (PRD §6; CLARIF Q12; S06): **(a)** offline/air-gapped
  (`AI_MODE=off` + all `SOURCE_*_MODE=mock` + `DEPLOY_MODE=local`, no network — **F5**); **(b)**
  primary-source-down (fall-through to secondary/global-equivalent → cache → mock with correct freshness
  — **F6**); **(c)** AI-disabled (deterministic engine alone produces ranked, usable decisions — **F7**).
- **Fitness functions F1–F19** are the contract backstop (full list + gates in C4 §"Quality / Fitness
  Functions"): **F1** provenance, **F2** citation, **F3** no-LLM-numbers, **F4** schema-fallback,
  **F5–F7** redundancy, **F8** HITL, **F9** boundaries, **F10** config fail-fast, **F11** port-parity,
  **F12** PII, **F13** a11y, **F14** TTTP, **F15** CAP/EDXL + EDXL-RM round-trip, **F16**
  compliance-proxy-enforced, **F17** budget-HITL-above-threshold, **F18** sustainability-report-schema-valid,
  **F19** per-step-cost-attribution-present (the last four added by §6.5 + ADR-017/018/020/022).
- **CI gates + supply-chain (OpenSSF-aligned, `docs/CI_CD.md`):** the 7 quality gates + BDD/eval gates on
  a **PR/nightly lane split** (deterministic gates block PRs; mutation/chaos/metamorphic/full-eval run
  nightly; noisy AI-judge evals stay advisory until calibrated — earn-the-right-to-block); lint + typecheck
  + coverage + gitleaks + OSV-Scanner + Semgrep/CodeQL + API-surface snapshot + micro-bench; release =
  **CycloneDX SBOM + SLSA L2 provenance + Sigstore cosign**; SHA-pinned actions; **pre-commit**
  (husky/lint-staged).

**E2E golden path:** COP open → cited SitRep → threshold DRAFT alert → insight flags N nursing homes in a
fire buffer (1 without power) → consented SOS → AI-triaged → human-verified → evac route around hazard +
resources tasked → CAP emitted. All four flagship features exercised; asserts TTTP < 10 s on live primary
sources (**F14**).

---

## 10. Performance targets + security posture

### 10.1 Performance (PRD §10; F14)

| Target | Value | Notes |
|---|---|---|
| **TTTP North-Star** | region open → cited SitRep + ranked priorities **< 10 s** | on live primary sources (F14, S06 perf) |
| SSE delta latency | UI delta within **seconds** of ingestion; debounce `SSE_DEBOUNCE_MS`=1500 ms | never blocks UI on upstream (Q7) |
| Turf feature-count limit | region-scoped candidate set capped (e.g. ≤ 5 000 infra nodes / ≤ 1 000 hazard vertices per intersection batch) before paging/flagging PostGIS | keeps in-process geo within budget; switch `FEATURE_SPATIAL=postgis` for larger regions (OP2) |
| Ingestion cadence | per-source (§8.5); workers async, non-blocking | CRON default ↔ BullMQ flag |
| LLM budget | input ≤ 8000 tok, output ≤ 1500 tok, timeout 30 s | bounds latency + cost (Art. X) |
| Cost | ≈ $0 local; near-$0 cloud free tiers | open-weight default tier |

### 10.2 Security posture (summary — full model in `docs/architecture/THREAT_MODEL.md`)

STRIDE per trust boundary (**TB1–TB11**, where TB11 = the AI Compliance Proxy), mapped to OWASP (Top 10,
API Top 10, **LLM Top 10 2025 + ASI01–ASI10**) + NIST AI RMF + ISO/IEC 42001 + EU AI Act + MITRE ATLAS.
The complete control→standard cross-walk (C1–C33) and the **Tiered Autonomy (A/B/C)** governance are in
**`docs/architecture/COMPLIANCE_MATRIX.md`** (the coverage map behind these boundaries). Crown jewels
(ranked): outbound **alert integrity**, **reporter PII**, **decision integrity**, **audit log**,
secrets/availability.

- **RBAC** (CLARIF §B.Q6, THREAT §7): PUBLIC/RESPONDER/VERIFIER/EM enforced **server-side per route AND
  per object** (BOLA/BFLA — API1/API5). Approve-CAP + triage = VERIFIER/EM; configure threshold/region/
  adapter = EM-only; resource/shelter/EDXL-RM mutations = RESPONDER own-org/EM; precise-PII fields gated
  to RESPONDER+ (ST3). Short-lived tokens, session expiry, **MFA for EM/admin**.
- **HITL / alert integrity** (Art. XIII, THREAT §12): `UNVERIFIED`/`TRIAGED` cannot emit CAP/EDXL or task
  (ST1/UW5 → `409 STATE_CONFLICT`); threshold fires = DRAFT only; no live IPAWS origination; every
  CAP/EDXL JSON-Schema-validated before send (XXE disabled); approval writes `AUDIT_EVENT` with the
  provenance chain.
- **PII / privacy** (Art. IV/XIV, THREAT §11): consent before intake (EV4 → `422 CONSENT_REQUIRED`); no
  PII in logs (UUID + generalized fields only); precise location responder-only; image consent + PII-screen
  + metadata strip + derived-only persistence; AES-256 at rest, **TLS 1.3** in transit (cloud);
  incident-close purge job (UW6).
- **LLM ingestion** (THREAT §10): all ingested NL/images are **untrusted data, never instructions**;
  structural separation; no LLM tools/actions; schema-bound output + citations (reject→deterministic
  fallback); input sanitation + token caps; **0 LLM-invented numbers** (F3).
- **AI Compliance Proxy + autonomy governance** (THREAT TB11, §6.5, COMPLIANCE_MATRIX): every LLM/Vision
  call traverses the mandatory `AICompliancePort` gateway (JWT→breaker→rate-limit→firewall→policy→PII→cost→audit);
  **safety controls fail closed**, availability degrades the ladder; adapters reject un-stamped calls so
  the chokepoint is unbypassable (F16). **Cost guardrails** soft-within-budget / **hard-block + HITL above
  threshold/cap** (ADR-018, F17). Actions are governed by **Tiered Autonomy A/B/C** (human-only /
  human-approval-before-execute / autonomous-within-policy; blast-radius-fixed, no silent demotion; budget
  crossing escalates to Tier B) — full table in COMPLIANCE_MATRIX §3.
- **Adapters / supply chain** (THREAT §5): ACL validates every feed (XXE/entity-expansion disabled, CSV
  sanitized); `npm audit --audit-level=high` no critical/high CVEs (Gate 5); TLS + cert validation on
  egress; circuit breaker + cache + mock per adapter.
- **Secrets** (THREAT §8): env-only, `.env` gitignored + `.env.example` documented; no secret in any
  client bundle or API envelope; least-privilege per-env keys; secret-scanning in CI.
- **Audit & isolation** (THREAT §9/§13): append-only, hash-chained `AUDIT_EVENT` (read = VERIFIER/EM);
  audit write fail-closed (no audit ⇒ no commit); region/org scoping on every query; SSE keyed by region;
  air-gapped no-egress acceptance test. Gate verification: THREAT §16 (S07).

---

## 11. References & approval

**Binding inputs:** `docs/requirements/PRD.md` (S01, approved) · `docs/architecture/{C4_ARCHITECTURE,
DOMAIN_MODEL,CONFIGURATION,THREAT_MODEL}.md` + `decisions/ADR-001..022 (+ADR-008a)` (S02) · `audit/CLARIFICATIONS.md`
(locked) · `agents/CONSTITUTION.md` (Art. I–XVI). **Sibling S03 artifacts (other authors):**
`docs/api/openapi.yaml` (machine API spec) · `schemas/` (CAP v1.2, EDXL-RM, EDXL-SitRep, adapter-manifest,
sitrep, threshold-rule JSON-Schemas). **Constitution articles cited:** I (test-first), II/VIII
(architecture integrity), IV/XIV (privacy), V (security), XI (provenance), XII (deterministic truth),
XIII (HITL), XV (adapter integrity), XVI (total redundancy).

| Role | Status | Date |
|---|---|---|
| Tech Lead (`prod-tech-lead`) | DRAFTED | 2026-06-27 |
| Security (`ops-security`) | PENDING | — |
| Human gate | **PENDING — required before S04 (Tasks)** | — |

*BEACON — IEEE Response Quest 2026, Phase 3 · GABBE SDLC S03 · prod-tech-lead · 2026-06-27.*

> **See §12 below for the Phase-D delivery addendum (2026-07-15)** — it adds ADR-023…026 to the binding
> ADR range above and is the current source of record for multi-channel interaction, per-user JWT identity,
> news/social grounding, pre-positioning, the Phase-D map layers, the ORS routing rung, and the vision
> advisory seam. The §1–§11 body above is preserved verbatim (golden-thread rule — no history rewrite).

---

## 12. Phase-D delivery addendum (2026-07-15)

> **Status: DELIVERED, gates green.** This section documents functionality built and shipped **after**
> the S03 spec of record above (§1–§11, dated 2026-06-27, ADR-001…022 +ADR-008a) — it does not amend that
> text, it extends it. Everything below is additive: new interfaces + invariants over the same hexagonal
> core (ADR-001), same envelope shape (§2), same deterministic→AI→human handshake (Art. XII/XIII), same
> total-redundancy discipline (Art. XVI). **Binding ADR range is now ADR-001…026** (adds ADR-023
> multi-channel interaction, ADR-024 Phase-B live composition + durable store, ADR-025 JWT identity +
> dev-login, ADR-026 Telegram alert broadcast + subscriber registry; ADR-008a unchanged). **`docs/api/
> openapi.yaml` remains the machine API spec of record** for every route named below — this section states
> intent/invariants at spec altitude; where the two disagree, openapi.yaml's shape governs.

### 12.1 Multi-channel interaction (ADR-023, ADR-026)

The web COP (E8) is one delivery channel over the hexagonal core, not the system. A channel-agnostic
`InteractionPort` (`src/ports/interaction.ts`) is the single contract every driving adapter maps into —
`{ actor(role, id), command, args, locale } → Envelope<T>` (same envelope shape as §2). A command router
(`src/application/interaction/command-router.ts`) is the one place a channel's request meets the core;
adding a channel is a new adapter, never a core change.

- **CLI** (`src/adapters/channels/cli/`, `CHANNEL_CLI_ENABLED`) — the `beacon` reference channel. Invoked
  today as **`npm run cli -- <args>`** (the `cli` script runs `bin.ts` via `tsx`; everything after `--` is
  forwarded to the binary), e.g. `npm run cli -- status --region us-ca`. It mirrors the API's read/act
  surface (`status`/`sitrep`/`incidents`/`sources`/`report`/`verify`/`alert:draft`) and runs fully offline
  against the same composition root as the API (ADR-003). Packaging it as a globally-installable `beacon`
  binary (a `package.json#bin` entry over an emitted `dist/`) remains a roadmap note — the repo is `noEmit`,
  so `tsx` runs the TypeScript directly rather than a compiled artifact.
- **`MessagingPort`** (`src/adapters/channels/messaging/messaging-port.ts`) — `send(to, text):
  Result<void, DomainError>`, never throws. **Telegram** has a REAL live rung (T-456): `CHANNEL_TELEGRAM_
  MODE=live` + `TELEGRAM_BOT_TOKEN` selects a Bot API `sendMessage` transport over an injected `fetch`;
  otherwise (and always for **WhatsApp**, a deliberate stub — T-457 not wired) a `RecordedTransport`
  captures sends in memory, MOCK-default, no egress. Inbound: `POST /channels/telegram/webhook` requires a
  constant-time-matched `X-Telegram-Bot-Api-Secret-Token` (`TELEGRAM_WEBHOOK_SECRET`); a verified update
  re-enters the SAME `handleInbound` trust pipeline (allow-list → replay → rate → firewall → parse,
  `trust.ts`) every channel uses. **Poller/webhook are mutually exclusive**: `scripts/telegram-poll.ts`
  refuses to start while `TELEGRAM_WEBHOOK_SECRET` is set (prevents a `getUpdates`-while-webhook-registered
  conflict / duplicate inbound path).
- **`NotificationPort`** (`src/adapters/channels/messaging/notification.ts`) — `notify(audience,
  envelope): Result<void, DomainError>`, the ONLY way an outbound broadcast can be constructed over a
  `MessagingPort`. Structurally enforces, in order: PII redaction (emails, phone numbers, precise lat/lng
  pairs — Art. XIV; lone deterministic figures like confidence/discharge/wind are left untouched, Art.
  XII), the output firewall (`scanInjection`), then a hash-chained audit append, then delivery. A handler
  cannot reach a raw `MessagingPort` and skip these controls.
- **HITL broadcast invariant (ADR-026, Art. XIII).** `TELEGRAM_ALERT_CHAT_IDS` seeds an in-memory
  `SubscriberRegistry` (opaque chat ids only, no PII). `broadcastApproval` fires **strictly as a post-emit
  side-effect** of `POST /alerts/{id}/approve` — called only *after* `sink.emit` has already succeeded on
  an approved `EmittableAlert` promoted from `DRAFT`; it is never an alternate/earlier path to `ACTUAL`.
  Each subscriber send is independently `try`/`catch`-wrapped — **audited-not-fatal** (Art. XVI): a
  per-chat-id failure never 5xx's the approve response and never blocks the remaining subscribers. The
  broadcast body is a concise PII-free digest (`"BEACON ALERT — {severity} {category} for incident {id}
  (alert {id})"`), redacted again by `NotificationPort` (defense-in-depth). **Accepted risk (THREAT_MODEL
  T7.11):** the same chat-id list is both the outbound broadcast fan-out and the inbound RESPONDER-role
  command allow-list — documented trust posture for the demo/field-ops model, not an oversight; every
  inbound command still traverses the full webhook-trust + RBAC pipeline regardless.

### 12.2 Per-user JWT identity + dev-login (ADR-025)

`resolvePrincipal` (`src/adapters/channels/http/rbac.ts`) verifies a bearer JWT with **jose**, a pinned
`algorithms:['HS256']` allow-list (rejects `alg=none` and RS↔HS confusion) and enforced `exp`. **Any**
verification failure fails **closed** to `{ role: 'PUBLIC' }` with no `sub` — never throws, never
downgrades to a higher-privilege default. `actorId(principal) = sub ?? actorKey(role)` is the single
source of the audit actor for every mutation; a client-supplied `actorId`/`sub` in a request body is
rejected `400` (never trusted). RBAC/rate-limiting stay keyed on the resolved **role** (spoof-proof).
`AUTH_DEV_TRUST_HEADER` remains the pre-existing offline-demo affordance (honoured only when explicitly
set; §10). `POST /auth/dev-login {role, userId}` mints a short-lived HS256 bearer carrying a real per-user
`sub` — **opt-in and double-gated**: only reachable when `AUTH_SECRET` is set **AND** `AUTH_DEV_LOGIN=on`
(a secret alone never exposes the minter), and **cloud-hard-off** (`NODE_ENV=production` or
`DEPLOY_MODE=cloud` ⇒ 404 regardless of the flags). Demo IdP only, never production issuance; a real
deployment plugs OIDC/an external IdP behind the same `resolvePrincipal` seam.

### 12.3 News/social grounding into `SitRepFacts` (deterministic, pre-LLM)

`groundNews` (`src/application/sitrep-synthesis/news-grounding.ts`) turns a region-scoped batch of
`NewsItem`s (GDELT/ReliefWeb/agency-RSS/vetted-social/MeteoAlarm) into cited `GroundedFact`s **before the
LLM is ever consulted** (Art. XII — the model narrates cited facts, it never invents a count or a
credibility score) and merges them into `SitRepFacts.facts` alongside the engine's own deterministic
facts. Semantics: (1) authority rank OFFICIAL(3) > MEDIA(2) > SOCIAL(1), unknown provenance treated as
SOCIAL; (2) corroboration clusters items by hazard-keyword class × time window and counts **distinct
authoritative outlets** (url host) — a single spammy outlet cannot fake multi-source corroboration; (3)
**flag-not-merge (Art. XIV)** — a SOCIAL item with no authoritative corroboration in its cluster is
emitted as a *separate*, clearly labeled "unverified social report" fact; it never merges into a
corroborated fact and never boosts a corroboration count. SOCIAL alone can never produce a non-flagged
fact.

### 12.4 Pre-positioning use-case (`GET /pre-positioning`)

`suggestPrePositioning` (`src/application/pre-positioning/pre-positioning.ts`) is a pure, deterministic
ranking (Art. XII) that, given a `Prediction.geom` projected hazard extent, ranks `AVAILABLE` resources and
`OPEN`-with-spare-capacity shelters that sit near — but not inside — that extent, by haversine distance to
the nearest sampled point on the extent boundary. Advisory only (Art. XIII — "engine suggests, human
decides"; never auto-tasks a resource or moves a shelter). No extent yet ⇒ `extentAvailable: false` and an
empty, honestly-labeled list, never a dead-end (Art. XVI). Exposed at `GET /pre-positioning`
(RESPONDER+, same RBAC gate as `/resources`); see `docs/api/openapi.yaml` for the wire schema.

### 12.5 Phase-D map layers + per-layer freshness

`MapProjection` (`src/application/map-projection/map-projection.ts`) gained four optional layers, each
present only when the region's composition supplies it (omitted, not faked, when absent — Art. XVI):
`outage` (derived AOI polygons with an honest `assumedOffline` inference label, never "confirmed"), `cell`
(telecom coverage sites, online/offline), `weather` (a deterministic wind glyph — observation numbers
only, never a synthesized grid, Art. XII), and `floodZones` (FEMA-NFHL-equivalent regulatory polygons,
labeled as regulatory reference, not a live extent). `layerSources` (`Readonly<Record<string, string>>`,
layer id → provenance `sourceId`) rides alongside so the UI can badge **per-layer** freshness instead of
one blended region-wide freshness — each layer honestly shows its own source's age. See `GET
/regions/{id}/map` in `docs/api/openapi.yaml`.

### 12.6 ORS routing ladder rung (ADR-016)

`ors-routing.ts` (`src/adapters/routing/`) implements `RoutingPort` against OpenRouteService's Directions
API (`FEATURE_ROUTING=ors` + `ORS_API_KEY`, refined fail-fast in `EnvSchema` — see CONFIGURATION.md §7).
Hazard avoidance carries no geometry over the port boundary: the adapter resolves the incident's hazard
footprint via an injected `hazardFor(incidentId)` lookup and sends it as `options.avoid_polygons` only
when it is a Polygon/MultiPolygon (a Point/LineString hazard is honestly skipped, never coerced). Typed
`Result`, never throws — any network/timeout/HTTP/parse failure returns `err(DomainError)`, and
`planEvacRoute` (§5.5) degrades to the existing labeled straight-line heuristic exactly as before (Art.
XVI; the ORS rung slots into the ladder without touching the fallback). `valhalla`/`osrm` remain the
documented future ladder rungs (self-hosted), not yet accepted `FEATURE_ROUTING` values.

### 12.7 Vision advisory seam (`visionAssist`)

When a VERIFIER attaches consented, PII-screened imagery to a `verify` command (`command.visionAssist =
{ imageRef, task, imageConsented, piiScreened }`) AND vision is wired (`FEATURE_VISION=on`,
`services.vision` present), `requestVisionAssist` (`src/application/interaction/command-router.ts`) routes
the request through the same `AICompliancePort` gateway as every other model call (§6.5) and attaches the
resulting `VisionFinding` to the verify response's `meta` — advisory, cited, confidence-scored, **never** a
state change on its own (Art. XII/XIII/XIV; consent + PII-screen are enforced upstream, unchanged from §6.2
`VisionPort` ladder). Absent vision wiring or a missing `visionAssist` block ⇒ the helper returns
`undefined` and `verify` proceeds exactly as before — vision stays a stretch layer the golden path never
depends on (ADR-008).

### 12.8 Live Views — cameras, external context links, citizen streams (E11; ADR-027/028/029)

E11 adds a **visual ground-truth modality** to the COP, entirely **link-only** (never embed/proxy/rehost;
the engine and LLM never read a pixel — Art. XII) and advisory. Three surfaces:

**(a) Live camera layer (ADR-027).** A new pure domain entity **`CameraFeed`**
(`src/domain/camera-feed.ts` — `{id, position, kind, title, provider, viewUrl, license, isLive,
observedAt?}`; `kind ∈ {FIRE_CAMERA, TRAFFIC_CCTV, WEBCAM, CITIZEN_STREAM}`) with a `makeCameraFeed`
**https-only `viewUrl` invariant** (the href-injection guard), plus one outward port **`CameraDirectoryPort`**
(`src/ports/cameras.ts`). **Five adapters** ship in v1 through the proven registry + manifest +
`RedundancyEngine` pattern (registry 22→27, **zero core change**): `caltrans-cctv` (LIVE keyless, US-CA),
`alertwildfire` (CACHED — keyless ArcGIS Living Atlas `ALERTCalifornia_Camera_Feed` FeatureServer; the
planned ALERTWest API was dead/404; per-camera `cameraURL` attribute is the view page; CC BY-NC-ND ⇒
link-only, `imageURL` not surfaced; credit "ALERTCalifornia | UC San Diego"), `windy-webcams` (CACHED,
`WINDY_WEBCAMS_API_KEY`, GLOBAL+RO, mandatory "Webcams provided by windy.com" badge), `dot511` (CACHED,
`DOT511_API_KEY` per-state, US), `cnadnr-ro` (MOCK, RO, no server egress). The **`cameras` COP layer** is
default-OFF (`FEATURE_CAMERAS`), map-only (not in `/status`), rendered as violet pins whose click opens the
`viewUrl` in a new tab (`window.open(...,'noopener,noreferrer')`); LIVE→cache→recorded-mock ladder + per-
layer freshness + attribution in the legend (Art. XVI). Exposed on `GET /regions/{id}/map` as the optional
`cameras` slice (`ProjectedCamera`).

**(b) External context links (ADR-028).** `buildExternalViews(position)`
(`src/application/external-views/external-views.ts`) is a **pure deterministic builder** — no adapter, no
key, no network, no state — returning 11 verified coordinate-templated deep-links (Google Maps/Satellite/
Street View/Earth-3D, Bing, OSM, Windy, Zoom Earth, NASA Worldview, NASA FIRMS active fires, Google Flood
Hub). Default-ON (`FEATURE_EXTERNAL_VIEWS`),
surfaced in the SitRep decision-support panel via a zero-network `positionForIncident`
(`app/_lib/incident-position.ts`); the map right-click context-menu is deliberately deferred (the panel
satisfies FR-VIEW-1). Link-only under the Google Maps AUP (which sanctions the Maps-URLs deep-link scheme).
EO Browser (sunset 2026-03-20) dropped.

**(c) Citizen live-view link (ADR-029).** Optional `PublicReport.liveViewUrl` (https / no-IP-literal /
≤2048, purge-covered) — a distinct `CITIZEN_STREAM` kind, **never merged with agency pins**. Intake enforces
a **STRICT host allow-list** (`youtube.com`/`www.` with a `/watch|/live` path, `youtu.be`, `twitch.tv`,
`facebook.com`/`www.` non-root; generic-https DEFERRED behind review), rejects userinfo/IP-literals, and is
**never fetched server-side**. Gated by `FEATURE_CITIZEN_STREAM` (default OFF ⇒ the field is rejected with a
**400**, honest, not a silent drop). Consent + HITL-reviewable + permanent **"Live Feed — Unofficial"**
badge + **2 h TTL** (`isLiveViewFresh`, fail-open) + existing rate bucket (Art. XIII/XIV). Persisted via
nullable `live_view_url`/`received_at` Postgres columns (CW5a).

**Open extensibility (locked, 2026-07-17).** The camera catalog is OPEN by design: ANY additional camera/
view source — including ones not supported/included today, and even the currently-excluded ones should
their rights later clear (EarthCam/Skyline with written permission, RO aggregators with a confirmed
chain-of-rights, a paid directory when a client pays) — is addable with ZERO core change via the same
`SourceAdapterPort<CameraFeed>` + `CameraDirectoryPort` pattern (one adapter dir + one `config/adapters.json`
row + one `ADAPTER_FACTORIES` entry + a `SOURCE_<PREFIX>_MODE` (+ optional key)). Mode/key gating ships a
gated/paid source MOCK/CACHED and flips it LIVE per-deployment. The ONLY permanent exclusion is the
constitutional one: unsecured/non-consenting camera aggregators (**Insecam-class**) are banned regardless of
technical feasibility. (Mirrored into `audit/DATA_SOURCE_VERIFICATION.md` §9a.)

---

*Addendum author: fixer-lane (docs/config parity pass) · Date: 2026-07-15; §12.8 added 2026-07-17 (E11
Live Views, CW5b) · Verified against the
implementation as of this pass (`src/adapters/channels/`, `src/application/{pre-positioning,
sitrep-synthesis,map-projection,evac-routing}`, `src/adapters/routing/ors-routing.ts`,
`src/application/interaction/command-router.ts`, ADR-023…026, `docs/api/openapi.yaml`).*

---

## 13. Known limitations (consolidated — NFR-F10; added MW-E/E1, 2026-07-31)

> **This is the one indexed place a reader goes for "what does BEACON honestly not do yet."**
> `NFR-F10` requires known limitations to be consolidated in one indexed SPEC section; before this section
> existed the only consolidated list was `CHANGELOG.md [0.1.0]`, and the localization limitations lived
> only as a labelled block inside §3.5 (finding F-41). This section does not repeat that block's prose —
> it indexes it (§13.9) — and otherwise states, in one place, every limitation this project's own findings
> register (`project/TASKS-FINAL-VERSION.md` §0–§0m, extended to **§0o** by the 2026-08-01 E3 re-audit —
see §13.11 and the new WebGL bullet in §13.8) and `docs/FINAL_LIVE_TEST_AND_DEMO.md` §5b already
> established through direct code inspection. **Stating a limitation openly is a graded rubric item, not a
> weakness to hide** (Art. XVI; AGENTS.md §14 "Honest limitations"). Every item below was verified against
> the code by this pass (file:line cited); none is carried over from a prior document on trust alone.

### 13.1 A scope correction that must not survive anywhere (F-150)

**FR-D4-5 is the Copernicus Emergency *Management* Service (EMS) damage/rapid-mapping overlay — it is
NOT an "EMS / casualty-transport" feature.** There is no patient, ambulance, or transport concept in it
anywhere in the domain or the requirement of record (ADR-036 §7, FEV-24). It is a **read-only ingest of
published delineation/grading products as an attributed COP layer**, labeled with its production date;
BEACON never requests an EMS activation (Authorised-User-gated, out of scope by design). This was an
orchestrator briefing error mid-build, which the implementing lane caught and refused rather than
building the wrong thing (`src/domain/damage-overlay.ts` and the EMS-overlay module both carry a header
warning so the misreading cannot recur). **Do not narrate this as "EMS/ambulances" on camera or in docs.**

### 13.2 Data-source & coverage limitations

- **No shelter source adapter (F-154/F-35).** The shelter board, its RFC-4180 CSV export, and its
  provenance labelling are all real and live-tested — but shelters are seeded fixtures
  (`src/adapters/persistence/seed.ts:66-68`), not fed by a live/cached `SourceAdapterPort`. The FEMA
  Open-Shelters ArcGIS feed was never wired. Every shelter's `SOURCE_RECORD` correctly reads `MOCK` —
  that is honest labelling of a real gap, not a bug to silently accept as "wired."
- **FIRMS hotspots are points, not fire perimeters** (`audit/DATA_SOURCE_VERIFICATION.md:76`) — thermal
  false positives exist, and native resolution is 375 m–1 km. NIFC/EFFIS perimeter polygons are merged
  alongside FIRMS specifically to give a real footprint where one is published; where only FIRMS answers,
  the map is showing detections, not a boundary.
- **EAGLE-I outage data is county-granular, and BEACON derives "ASSUMED offline"** from hazard∩infrastructure
  geometry rather than showing a live per-address outage feed — the live EAGLE-I feed is gov-operational,
  not public (`audit/DATA_SOURCE_VERIFICATION.md:114`). The UI must never claim a confirmed outage from it.
- **Satellite revisit gaps are real and stated openly** (Art. XV/XVI; `docs/SPEC.md:872`) — a fire or
  flood event between two satellite passes is invisible to FIRMS/GDACS/Sentinel-derived layers until the
  next pass; the freshness badge is the honest signal, not a guarantee of continuous coverage.
- **EFFIS ships CACHED-only** — its live endpoint is unconfirmed, stated as such rather than assumed live.
- **ITU and CAMARA/GSMA ship MOCK-only by design** — both are operator/data-gated with no reachable
  keyless or public-sandbox live route; they are registered and boot-validated plugins, not a gap to close
  before demo.
- **The UI does not distinguish an ORS-routed evacuation leg from the heuristic fallback** — `EvacRoute`
  carries no `method` field, so a route rendered from the real ORS engine and one from the offline
  geometric heuristic look identical on screen even though their quality differs materially.
- **`es`/`gr`/`ph` are demo-grade zones, not at `us-ca` parity** (`config/regions.json` `$comment` per
  region) — each is missing a national gauge/camera/outage source; `es` additionally has no AEMET-direct
  or DGT adapter and its bbox covers mainland Spain + the Balearics only (not the Canaries, Ceuta, or
  Melilla); `ph` has no floodplain layer. These are config-only zones (no region-specific application
  code), which is the intended genericity story, but the coverage gap is real and should be named if any
  of the three is demonstrated.
- **Two of the seven curated family-reunification URLs cannot be verified by automated fetch (F-177).**
  `familylinks.icrc.org` and the American Red Cross Restoring Family Links page
  (`src/application/aggregate/reunification-links.ts:59,73`) both return **HTTP 403** to automated
  requests (bot protection) — liveness is **unconfirmed, not disproven**. The ICRC one is corroborated
  indirectly (the verified ICRC RFL page links to it by name); **the Red Cross URL has no positive
  evidence at all.** `FEATURE_D6_REUNIFICATION_LINKS` defaults **on**, so these ship enabled pending a
  human eyeball. The other five (ICRC RFL, `crucearosie.ro`, `www2.cruzroja.es`, `redcross.gr`,
  `redcross.org.ph`) were fetch-verified 200.

### 13.3 Built, guarded, and tested — but not yet composed into the running app (F-152 / F-171–F-174)

The five D5 modules (rumor board, mutual-aid EDXL-RM board, shelter status, damage/needs reports, EMS
overlay — `FEATURE_D4_*`) and the five D6 modules (volunteer teams, supplies, reunification link-out,
incident-summary export, aggregate casualty tally — `FEATURE_D6_*`) are **implemented, unit-tested, and
guarded** (the four-layer no-person-identifying-field mechanism for D6; the consent→triage→verify path for
D5) — confirmed by a repo-wide search: no file under `app/_components/panels/` names any of rumor, mutual
aid, shelter status, damage reports, EMS overlay, volunteer teams, supplies, reunification, incident
summary, or casualty tally, and neither `src/main` nor `src/application/index.ts` composes them. **Both
flag families default `on`** (the entrant's decision, dated Resolution notes on ADR-035 and
ADR-036-warning-excellence-and-response-modules.md §7) **but the default is currently INERT** — nothing
imports these modules, so there is no panel, no route, and no way to reach them from a running browser.
Do not demonstrate or describe a D5/D6 surface as available in the shipped app until its seam lands.
Additionally: `'TEAM'` is still absent from `RESOURCE_KINDS`/the DB CHECK constraint/the logistics board's
icon map (F-171), and the FR-D6-4 export has no HTTP route consuming its otherwise route-ready
`buildIncidentSummary` beyond the one closed in MW-D (F-172, closed) — the remaining four D6 exports still
need their own `schemas/d6-*.schema.json` + guard call sites (F-142).

> **Precision correction — 2026-08-02 (lens-1 call-site recount).** The blanket sentence above — *"nothing
> imports these modules, so there is no panel, no route, and no way to reach them from a running browser"* —
> is **no longer true of all ten**, and the paragraph already half-concedes it when it says "beyond the one
> closed in MW-D (F-172, closed)". Stating it exactly, from a per-module import-site grep (`grep -rln "from
> '.*<module>.js'" src app`, excluding `*.test.*`):
>
> | Module | Production import sites | Reachable from a browser? |
> |---|---|---|
> | D5 rumor board · mutual aid · shelter status · damage assessment · EMS overlay | only their own barrel `src/application/coordination/index.ts`, which **nothing outside that folder imports** | **No** — the original finding stands |
> | D6 reunification links | **zero** | **No** |
> | D6 volunteer teams · supplies | `src/application/pre-positioning/pre-positioning.ts` — but **`import type` only** (they widen `PrePositioningCandidate`'s field union); no factory is ever called | **No** in the behavioural sense: the types ship, the modules do not run |
> | **D6 incident-summary export · casualty tally** | `src/adapters/channels/http/routes/incident-summary.ts` → reached from `feature-router.ts:553` | **YES** — `GET /api/v1/incidents/:id/summary` is served, gated by `FEATURE_D6_INCIDENT_EXPORT` (default `on`) |
>
> So the correct statement is **eight of ten inert, two live**. This is recorded rather than smoothed over
> because the direction of the error matters: an over-cautious limitation is still a false statement, it
> invites a reader to distrust the accurate parts, and here it would have led a presenter to skip a working
> export. *(It does not change the demo guidance: do not demonstrate the eight that are inert.)*
>
> **§2026-08-08 update (live-demo delivery S3) — now seven of ten live, three inert.** Five of the eight
> inert modules gained full panel + route composition: supplies, volunteer teams and shelter status render
> in the logistics dock, damage reports and the EMS (CEMS damage-overlay) panel in the SitRep dock —
> `src/adapters/channels/http/routes/panels.ts` GETs + connected panels mounted in `app/page.tsx`, each
> gated by its `FEATURE_D4_*`/`FEATURE_D6_*` mirror, each landing on a labelled error state (never a
> crashed dock) on a failed or malformed envelope. **Still inert, by plan: rumor board, mutual aid,
> reunification links** — the demo guidance now reads "do not demonstrate those three". HONEST LIMIT
> carried with the composition: the five new panel routes are **fixture-fed MOCK** and say so in their
> provenance — no supply/volunteer/shelter/EMS source adapter exists, and the damage buckets aggregate
> the fixture, not the live report store (`docs/audit/UNIMPLEMENTED_REGISTER.md` is current).
> **Corrected 2026-09-12:** three of the five — supplies, volunteer teams, damage reports — now serve `DB`
> under `FEATURE_STORE=postgres` once `npm run db:seed` has run: an operator starting set from
> `config/reference-data.json`, every row passed through the same domain factory that guards a Directus
> edit, labelled `DB` and never presented as an outside fact (no public feed publishes a county's pallet
> count). Shelter status is FEMA-live for California since 2026-09-11. EMS overlay stays fixture-fed on the
> merits — its table wants the publisher's own product id and the recorded Copernicus page carries only
> activation codes — and its provenance still says MOCK.

### 13.4 ✅ RESOLVED — a privacy guarantee that was implemented but not scheduled (F-280; closed S1, 2026-08-07)

> **Status: FIXED (live-demo session S1, 2026-08-07; recorded here 2026-08-10).** `src/main/scheduler.ts`
> (`startBackgroundJobs`) now invokes `runRetentionSweep` on an interval and is composed from
> `http-dispatcher.ts:449`, so the Art. XIV retention guarantee runs automatically in the shipped app —
> gated by `RETENTION_SWEEP_ENABLED` (**default `on`**, hourly via `RETENTION_SWEEP_INTERVAL_SEC=3600`),
> against the same `FEATURE_STORE` the app writes to, always off under `NODE_ENV=test`, and each sweep
> appends an aggregate-only `RETENTION_PURGE` audit event. The original finding follows verbatim.

**The Art. XIV retention-purge sweep exists and is correctly implemented, but nothing in the running
application ever calls it.** `runRetentionSweep` (`src/application/governance/retention-sweep.ts:66`) is a
pure, tested use-case; both `MemoryReportStore` (`src/adapters/memory/memory-core.ts:166`) and
`makePgRetentionStore` (`src/adapters/persistence/retention-store.ts:26`) correctly implement
`RetentionStorePort`, and the executor is exercised by its own test file
(`src/application/governance/retention-sweep.test.ts`). **But there is no scheduler.** A repo-wide search
found zero production call sites: no cron/queue job, no HTTP admin route, no CLI command
(`src/adapters/channels/cli/bin.ts` is 13 lines and does not mention it), and no npm script. So while the
code that WOULD enforce "no PII retention beyond the incident lifecycle" (Art. XIV) is real — closing the
original "stamped but never swept" defect (F-25) — the guarantee is **enforceable on demand, not
automatically enforced** in the shipped app today. A report whose `purgeAfter` has passed will sit in the
store, unswept, until an operator invokes the executor by hand (there is currently no supported way to do
so in production). This is the same "built but not composed" defect class as §13.3 (F-152), and this
SPEC previously stated F-25 as unconditionally closed; that statement is corrected here.

### 13.5 Deliberate behaviour change at the EDXL-RM ingest boundary (F-31 / F-156)

**Inbound EDXL-RM is now schema-validated before mapping** (`parseInboundEdxlRm`,
`src/adapters/interop/edxl-rm-mapper.ts:256-268`, called as the mapper's first statement), closing the
asymmetry with outbound emission. **This is a deliberate, breaking behaviour change at a partner-facing
boundary**: a partner sending a non-standard member, a malformed `sentDateTime`, or a message with no
`originatingMessageID` — all previously accepted — is now **rejected with a typed `PARSE_ERROR`**. This
belongs in `CHANGELOG.md` as a compatibility-relevant change (added there in this pass), not only here.

### 13.6 The AI narration boundary is closed weaker on translated output than on English (F-62)

The C1.4 likelihood-word guard (`output-validator.ts`) is **English-surface-only**: it polices the
deterministic-fact prose that the LLM must never turn into an invented probability word, but a
**translated** narration (`NarrativeRequest.locale`, ADR-030) is not re-validated in its target language —
a Romanian narration inventing *"foarte probabil"* would currently pass. This is a known blind spot, pinned
by an explicit test (`output-validator.test.ts`, `'KNOWN BLIND SPOT'`) so it is executable, not just prose.
Deterministic fact claims themselves always stay English by design (Art. XII) and are unaffected; only a
translated *narration* can carry the gap.

### 13.7 Forecast DRAFT-alert path — tested, unreachable from the running app (F-81)

The threshold-fire → forecast DRAFT-alert path is fully unit-tested but has no seeded rule, no alert
columns wired for it, and no UI surface reaching it in the composed application. It is real code with real
test coverage; a live demo cannot currently trigger or show it end-to-end.

### 13.8 Browser/test coverage gaps

- **🔴 The shipped WebGL map has ZERO browser coverage — every browser gate to date ran against the
  accessible FALLBACK, not the real map (F-322, added 2026-08-01).** All **11** Playwright spec files call
  `disableWebGL(context)` (`e2e/helpers.ts:19-29`), which makes `HTMLCanvasElement.getContext('webgl*')`
  return `null`, so `MapView`'s engine start throws and it renders the `failed` branch
  (`app/_components/map/MapView.tsx:53-54,75-89`) — the labelled `MapFeatureList`. The real
  MapLibre + deck.gl surface (`app/_components/map/map-engine.ts`, the only module where WebGL lives) is
  **never instantiated by any browser test**. Count derived, not asserted: `ls e2e/*.spec.ts` = 11 files,
  `grep -l disableWebGL e2e/*.spec.ts` = 11 files. Consequences, stated plainly:
  - the **axe WCAG 2.2 AA** result describes the fallback list's accessibility, not the map's;
  - the **visual baselines** in `e2e/visual.spec.ts-snapshots/` are pictures of the fallback;
  - the **TTTP < 10 s** number (F14) is the time to a fallback picture, not to a rendered map;
  - therefore **"Playwright 86 passed / 0 failed" is evidence that the FALLBACK works** — it is not, and
    has never been, evidence that the deck.gl/MapLibre COP renders in a browser.
  This was previously disclosed only in an internal gate audit; it is now stated here and in
  `README.md` as well. **Mitigation written, RUN, and it found a real defect (F-414) which is now fixed:** `e2e/webgl-smoke.spec.ts` (added by
  this pass) runs with WebGL **enabled** and asserts the real MapLibre canvas mounts inside
  `[data-testid="map-canvas"]`. It has **not been executed** — the browser lane owns Playwright
  exclusively — so until that lane reports a result, this bullet stands unchanged and the map's browser
  coverage must be described as **zero**.
- **`es`, `gr`, and `ph` browser coverage: in progress, not yet verified (F-72).** As of this pass,
  `e2e/helpers.ts` no longer hand-declares a two-entry region map — it now derives `SHIPPED_REGIONS` from
  `config/regions.json` (`e2e/helpers.ts:14,55-57`), and a new `e2e/zones.spec.ts` asserts the served
  region registry, the COP's region selector, and a non-empty provenanced truth picture agree across all
  five shipped zones. This is a live, in-flight fix by a sibling lane in this same session, editing
  `e2e/{helpers.ts,zones.spec.ts,capture-screenshots.spec.ts,golden-path.spec.ts,layers-phase-d.spec.ts,
  perf.spec.ts}`. **This SPEC does not claim F-72 closed**: this docs lane is barred from running
  Playwright while that lane owns it exclusively (concurrent runs corrupt each other's results), so no one
  has yet observed a passing run of `es`/`gr`/`ph` through a real browser. Re-check this bullet once that
  lane reports its gate numbers.
- **The accessible non-visual map alternative does not cover every overlay (F-46).** `MapFeatureList`
  (the WCAG 2.2 §2.5.7 keyboard/table alternative to the map) lists fire, gauge, infrastructure, exposure,
  report, and shelter rows — but **outage, cell coverage, weather, flood-zone, cameras, prediction, route,
  and storm** overlays have no non-visual equivalent. A screen-reader user reaches strictly less of the
  COP than a sighted mouse user today.

### 13.9 Localization limitations

See §3.5 for the full, currently-accurate block (machine-translated unreviewed catalogs including
Romanian; raster basemap place labels cannot be localized; deterministic fact claims stay English by
design, Art. XII; CJK rendering relies on the system font stack). Summarized: none of these are defects —
each is a stated, deliberate trade-off — but none should be described as fully resolved.

### 13.10 Internal documentation/contract debt worth naming (lower severity, kept for completeness)

- **`docs/api/openapi.yaml` understates two response shapes and omits rate-limit documentation (F-59):**
  `GET /regions/{id}/incidents` documents `data` as a bare `Incident[]` while the route returns
  `{regionId, incidents[]}`; `GET /sources` documents `SourceRecord[]` while the route returns
  `{regionId, sources:[{sourceId,mode,fetchedAt}]}`; and no route documents its `429`/`Retry-After`
  behaviour even though every route is token-bucket limited (`http-dispatcher.ts:91-98`).
- **Coordinate vertices carry float residue** (e.g. `45.400000000000006`) from bbox arithmetic —
  deliberately not "tidied," because rounding a geometry vertex (rather than a serialized display value)
  can flip a polygon-intersection result and silently change who is counted as exposed. If ever addressed,
  it must be at the serialization boundary only, guarded by the intersection tests.
- **Adapters have no `role` field** distinguishing a hazard-*footprint* source from an advisory/event feed;
  `HAZARD_FOOTPRINT_SOURCES` (`live-seed.ts:389`) is still a hardcoded 3-id list (`firms`/`nifc`/`effis`)
  rather than a manifest-driven classification. A new footprint-bearing hazard source defaults to
  advisory-only until this list is updated by hand.
- **`docs/architecture/decisions/ADR-036-response-coordination-tier.md` is an orphaned file** (new finding,
  F-281): it contains only a dated "Resolution note" with no original ADR body — the actual
  response-coordination-tier decision record (FR-D4-1…FR-D4-5) lives in
  `ADR-036-warning-excellence-and-response-modules.md` §7. Two files currently share the number 036; see
  that finding for detail. Not fixed in this pass (structural ADR-numbering decision, flagged for the
  entrant) beyond noting it here and in the findings register.

### 13.11 ✅ RESOLVED — five endpoints in the §2.2 catalog were NOT SERVED (F-323 / F-401; closed S1, 2026-08-07)

> **Status: FIXED (live-demo session S1, 2026-08-07; recorded here 2026-08-10).** All five routes are
> served and RBAC-gated (`feature-router.ts` + `routes/{adapter-health,threshold-rules,audit-events}.ts`),
> `x-status: planned` is gone from the OpenAPI, and the FR-3 golden thread is walkable with `curl`. The
> entry is kept, resolved rather than deleted, on the same principle as §13.12: the defect shape (a design
> catalog outrunning the served surface, then documents outvoting the router) is the instructive part.
> The original finding follows verbatim.

**Added 2026-08-01 by the E3 docs-truth lane.** The §2.2 catalog is a DESIGN contract; five of its rows
have no route in the running app. A judge following the spec with `curl` gets
`404 {"code":"NOT_FOUND","message":"no such route"}` (`src/adapters/channels/http/routing.ts:57-59`).
The rows are **kept, not deleted** — an absent capability that a document once promised is the limitation,
and deleting the row would erase the evidence.

**Method (so the verdicts are reproducible, not asserted).** BEACON has exactly two route tables, both
reached from the single Next catch-all delegator `app/api/v1/[...path]/route.ts:25-27` →
`handleHttp`: the feature table `handleFeatureRoute` (`feature-router.ts:595-601`) runs first and returns
`null` on no match, then `resolveRoute` (`routing.ts:394-408`) decides. Each path below was run through
**both** functions directly (`tsx`, no server) and through code inspection; both agree.

| Path (as §2.2 promises it) | Verdict | Proof (`file:line`) |
|---|---|---|
| `GET /incidents/:id` | **🚫 404** | 2 segments; `matchGet` handles only 1 or 3 (`routing.ts:117-121`), feature router likewise (`feature-router.ts:559-563`) |
| `GET /incidents/:id/exposure` | **🚫 404** | 3 segments but 3rd must be `sitrep` (`routing.ts:111-113`) or `map`/`edxl/rm`/`summary` (`feature-router.ts:550-555`) |
| `GET /threshold-rules` | **🚫 404** | absent from both single-segment tables (`routing.ts:86-104`; `feature-router.ts:541-547`) |
| `GET /audit-events` | **🚫 404** | absent from both single-segment tables (`routing.ts:86-104`; `feature-router.ts:541-547`) |
| `GET /health/adapters` | **🚫 404** | only `/health` is wired (`routing.ts:88-89`); 2 segments match nothing (`routing.ts:117-121`) |

**One of these is inside a golden thread, and that is said out loud rather than quietly dropped.**
`GET /incidents/:id/exposure` is the endpoint named by **FR-3** in the §1.1 requirement → spec → test →
code thread. The thread is not wholly broken — the deterministic exposure engine is real, tested, and
reaches users as `exposure[]` on `GET /regions/:id/map` (`feature-router.ts:551` → `routes/map.ts:38` →
`map-projection.ts:511`, rendered by the COP's exposure layer) — but **the specific route the golden
thread cites does not exist**, so the thread as written cannot be walked end-to-end by a reader with
`curl`. FR-3's row in §1.1 now carries that correction inline.

**Downstream corrections made in the same pass:**
- `GET /health/adapters` also claimed "**always 200 while the service is up**" — a positive availability
  claim about a route that 404s. Withdrawn in §2.2 (F-401).
- `docs/DEMO_SCRIPT.md` scripted an on-camera "adapter-health board (`/health/adapters`)" beat. There is
  no such component in `app/_components/**` and the route 404s, so the beat is **struck** and repointed at
  `GET /sources`, which really does serve per-source effective mode + freshness (`routing.ts:94-95`),
  and at the per-layer freshness badges already on the COP (F-324).
- `docs/requirements/PRD.md` §8's API sketch listed `GET /incidents/:id` and `GET /incidents/:id/exposure`
  with no marker; it now carries the same NOT-SERVED note.

**The surfaces that were already honest, and were therefore NOT changed:**
- `docs/api/openapi.yaml` carries `x-status: planned` plus a "**NOT YET SERVED (v1)**" description on all
  five paths (lines 279-283, 346-349, 1160-1164, 1186-1189, 1219-1222).
- `src/adapters/channels/http/README.md:55-58` names the same five as "**Still not served in v1**", with
  the note that exposure is reachable via `/map` + `/sitrep` — verified against the routers on 2026-07-27.

Where a document disagreed with those two, the document was wrong and the document changed. **Ground truth
is the routing code; a majority of agreeing documents does not outvote it.**

**One residual OpenAPI gap this lane does NOT own** (reported to the API lane, not edited here):
`POST /alerts/{id}/all-clear` **is served** (`feature-router.ts:586` → `handleAlertAllClear`) but has **no
path entry** in `docs/api/openapi.yaml` — the mirror image of the five above, an undocumented real route
rather than a documented absent one.

**Served GET surface, for contrast** (read off the same two tables): `/health`, `/me`, `/status`,
`/sources`, `/regions` (`routing.ts:86-104`); `/regions/:id/incidents`, `/incidents/:id/sitrep`
(`routing.ts:107-115`); `/resources`, `/reports`, `/alerts`, `/pre-positioning`
(`feature-router.ts:541-547`); `/regions/:id/map`, `/edxl/rm/:id`, `/incidents/:id/summary`
(`feature-router.ts:550-555`); plus `/.well-known/sustainability` (`routing.ts:401`) and `/stream`
(delegated outside these tables by `app/api/v1/stream/route.ts`, see `feature-router.ts:12-13`).

### 13.12 ✅ RESOLVED — the SSE delta channel had no server-side publisher (F-416, fixed 2026-08-01)

**This entry is kept, resolved rather than deleted, because the defect SHAPE is the most instructive one in
this document and the honest record of it is worth more than a tidy ledger.**

**Status: FIXED and browser-verified.** `publishDelta` (`src/adapters/channels/http/http-dispatcher.ts`)
publishes a region-keyed delta after every successful mutating command (`report` / `verify` /
`alert:draft`). Proven end-to-end with no stubs by `e2e/sse-push.spec.ts`: browser `EventSource` → Next
route → `handleStream` → the process-wide EventBus → a real HTTP mutation, **delta observed in ~1.7 s**.
Because the polling fallback is 15 s, that latency is itself the proof it was push and not a lucky poll.
Cross-region isolation (THREAT T13.1) is asserted in the same spec: a `ro` subscriber receives nothing from
a `us-ca` change. Art. XII holds on the wire — the frame carries exactly `{type, region, entity, at}`, and
the unit test asserts that key set exactly, so no figure can ever ride the channel.

One honest limit remains by design: a change that cannot be attributed to a region (an SOS filed against no
incident) publishes **nothing** rather than broadcasting to a shared topic. Those changes are still picked
up by the client's polling rung — the degraded path is the one that always works (Art. XVI).

<details>
<summary><strong>The original finding, preserved — why a fully green build hid it</strong></summary>

**The claim to avoid was "push, not poll". The claim that was true was "the COP updates itself."**

What exists and works: the region-keyed SSE endpoint (`GET /api/v1/stream`), its cross-region topic
isolation, its heartbeat, its `toDelta` projection (Art. XII — no figure can travel on the channel), its
connection cap (F-351), and — as of 2026-08-01 — a real browser client (`useRegionSync`, F-320) that maps a
delta onto precise TanStack Query invalidations and refetches over REST.

**What does not exist: anything that calls `EventBusPort.publish`.** The method is declared
(`src/ports/infra.ts:35`), implemented (`src/adapters/eventbus/in-memory-eventbus.ts`), and invoked from
**no production code path** — a repo-wide grep for `.publish(` outside tests returns nothing. So a connected
client receives `event: hello`, then heartbeats, indefinitely. The COP still stays current, because the
client's polling rung (15 s) drives the same refetch — which is exactly the Art. XVI fallback behaving as
designed, and it is labelled, not silent.

**This is the sixth instance of the project's second-worst defect class — "code exists, nothing runs it"**
(after F-53, F-152, F-280, F-328, F-320). It is recorded rather than hastily fixed: the publisher needs a
region for its topic, and the `report`/`verify` commands do not currently carry one (only `alert:draft`
resolves a region, via its incident). That is a real design decision, not a one-liner, and the seam is
mapped for whoever does it: `streamTopic(regionId)` is exported from `routes/stream.ts`, and
`deps.features.eventBus` is already in scope in `dispatchCommand`.

**Consequence for the video (at the time):** the shot-list-of-record told the entrant to film *"SSE delta
arriving live"* — a shot that could not happen. It was corrected to a truthful alternative, then restored
once the publisher landed and was browser-proven. **The near-miss is the lesson: a demo beat is a claim,
and claims decay silently unless something executes them.**

</details>

### 13.13 ✅ RESOLVED — the unit gate was RED: three Art. XIII approve-with-CAP tests (found 2026-08-02, lens-7; fixed same day as F-417)

**Every doc that says "gates green" is currently over-claiming, and this entry exists so that no one has to
discover it during a filmed demo.** Machine-run on 2026-08-02:

```
./node_modules/.bin/vitest run
  Test Files  1 failed | 303 passed (304)
       Tests  3 failed | 3737 passed | 2 skipped (3742)
```

All three failures are in `app/_lib/hooks.mutations.e2e.test.tsx` — the F-366 real-server hook tests over the
**Art. XIII CAP-emission path**, the single most consequential surface in the product. They fail **in
isolation as well as in the full suite**, so this is a genuine red, not order-dependence or flake.

**Root cause, reproduced directly against `handleHttp` (not inferred):** the offline verifier-queue seed
`defaultReportQueueSeed` (`src/adapters/memory/memory-core.ts:123-146`) mints `rep-demo-1` and `rep-demo-2`
with **no `incidentId`**. `PATCH /reports/:id {decision:'VERIFIED', emitCap:true}` on either of them
correctly answers **202** with:

```
"meta": { "decision": "VERIFIED",
          "capNotEmitted": "report is not linked to an incident — no alert was drafted" }
```

The server is behaving as specified — `emitCap` is genuinely wired (`command-router.ts:442-507`, closing
F-362) and a report with no incident cannot scope a CAP alert. The test asserts `meta.emittedAlert` instead.

**The product-level fact this exposes, which matters more than the red build:** with the shipped offline
seed, **"Approve + CAP" on either pre-seeded verifier-queue row emits nothing.** A DRAFT CAP is produced
only for a report that carries an `incidentId`, i.e. one submitted through the SOS form **while an incident
is selected** (`app/_components/panels/sos-form.tsx:41-54` sends `incidentId` only when one is set). The
`DEMO_SCRIPT.md` golden path is safe because its step 2 selects an incident before its step 5 files the SOS
— but a presenter who opens the verifier queue directly and clicks "Approve + CAP" will get
`capNotEmitted` and no alert. **Film the SOS→verify leg in order, or seed a linked report.**

### ✅ RESOLVED 2026-08-02 — finding **F-417**, fixed at the ROOT rather than in the test

**Both seeded queue rows are now linked to the canonical CA demo incident** (`memory-core.ts`
`defaultReportQueueSeed`). The choice mattered: the two available fixes were *(a)* change the tests to file
their own linked SOS, or *(b)* link the seed. **(a) would have turned the build green while leaving the
product defect exactly where it was** — a presenter clicking "Approve + CAP" on a pre-seeded row would still
have got nothing, and the test would no longer have been looking. **The red build was reporting a real
product fault, so the product was fixed.**

Linking is also the more truthful state, not a test accommodation: a report sitting in a verifier's queue
for a live incident *is* associated with that incident. The unlinked case remains reachable and meaningful
(a citizen reporting before any incident exists) and `capForVerifiedReport` still handles it honestly with
`capNotEmitted` — it is simply no longer what the demo seed ships.

**The pairing is pinned by a test**, because `memory-core.ts` cannot import the composition root (the
`adapters-never-import-main` boundary) and therefore declares the incident id as a literal:
`memory-core.test.ts` asserts every seeded report is linked AND that the id equals the canonical
`CA_INCIDENT` exported from `src/main/scenario-inputs.ts`. Plant/fail verified — removing the link fails
both assertions by name (*"rep-demo-1 is unlinked — Approve + CAP would emit nothing"*). A rename of the
canonical id now fails a test instead of silently re-orphaning the demo reports.

**Consequence for the video: the constraint in the paragraph above is lifted.** "Approve + CAP" now works on
a pre-seeded verifier-queue row, so the beat can be filmed directly without first walking the SOS leg.
(Walking it in order is still the better narrative.)

### 13.14 Documentation `file:line` citations decay silently (found 2026-08-02, lens-7)

§2.2, §13.11 and the FR-3 golden-thread row cited **nine** `feature-router.ts` / `routing.ts` line ranges to
prove which endpoints are and are not served. Re-checked mechanically on 2026-08-02, **every
`feature-router.ts` range was stale** — `497-503` (claimed `matchGetSingle`) landed on `edxlRmPostRoute`,
`515-519` (claimed `matchGet`) landed on closing braces, and `routing.ts:311` (claimed the
`/.well-known/sustainability` match) landed inside `parseLiveViewUrl`. They have been corrected to
`541-547` / `550-555` / `559-563` / `586` / `595-601` and `routing.ts:394-408` / `:401`, each re-read to
confirm it contains the named code.

**The conclusions were all still correct** — the five unserved endpoints are still exactly
`/incidents/{id}`, `/incidents/{id}/exposure`, `/threshold-rules`, `/audit-events`, `/health/adapters`,
independently re-derived by walking `resolveRoute` + `handleFeatureRoute` and cross-checked against the
`x-status: planned` markers in `openapi.yaml` (both give the same five). **The evidence had rotted while
the claim stayed true**, which is the more dangerous half: a reader who spot-checks one citation, finds
unrelated code, and concludes the section is untrustworthy discards a section that is right. A line number
is a claim with a short half-life; prefer citing a **symbol name** and use the line only as a hint.

---

*§13 author: E1 docs-truth-up lane · Date: 2026-07-31 · sourced from `project/TASKS-FINAL-VERSION.md`
§0–§0m and `docs/FINAL_LIVE_TEST_AND_DEMO.md` §5b; every item verified against the code directly by this
pass, not carried over on report alone.*

*§13.11 and the §13.8 WebGL bullet added by the **E3 docs-truth lane · 2026-08-01**, from
`project/TASKS-FINAL-VERSION.md` §0o findings **F-322 / F-323 / F-324 / F-401**. Both were verified against
the routing/e2e code directly (`resolveRoute` + `handleFeatureRoute` executed on each path; `disableWebGL`
call sites counted with `grep`), not carried over from a lane report.*
