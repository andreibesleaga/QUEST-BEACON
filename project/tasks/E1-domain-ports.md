# Epic E1 — Domain Core (19 entities + value objects) · Port interfaces (~20)

> Owner persona: **eng-backend** (tests **eng-qa**) · Wave W1 · IDs `E1·T-040…T-093`
> `src/domain` is PURE TS (no framework/HTTP/DB imports — fitness fn **F9**). Every entity task is
> TDD-first (invariant test → type). Change rule: keep each task's **Trace** on its entity/ADR so a
> DOMAIN_MODEL/schema change propagates here.

| ID | Task | Persona | Deps | Wave | Tags | Trace | Acceptance |
|---|---|---|---|---|---|---|---|
| T-040 | Create `src/domain/value-objects/geo.ts` (GeoJson, BBox, Coordinate branded types) | eng-backend | — | W1 | [PARALLEL] {secure-coding} | ADR-001 | tsc compiles; GeoJson rejects a non-GeoJSON literal |
| T-041 | Create `src/domain/value-objects/ids.ts` branded UUID types (RegionId, IncidentId, SourceId…) | eng-backend | — | W1 | [PARALLEL] {secure-coding} | ADR-001 | assigning a raw string to a branded Id fails typecheck |
| T-042 | Create `src/domain/value-objects/freshness.ts` (Timestamp/Freshness VO with fetchedAt) | eng-backend | — | W1 | [PARALLEL] {tdd-cycle} | SOURCE_RECORD/ADR-001 | Freshness rejects a future/NaN timestamp |
| T-043 | Write domain error taxonomy test (DomainError base, InvariantViolation subtypes) | eng-qa | — | W1 | [PARALLEL] {tdd-cycle} | ADR-001 | asserts each error carries typed `code`; Red |
| T-044 | Create `src/domain/errors.ts` typed DomainError hierarchy to green T-043 | eng-backend | T-043 | W1 | {tdd-cycle} | ADR-001 | T-043 passes; errors discriminated by `code` |
| T-045 | Create `src/domain/shared/result.ts` Result<T,E> (ok/err, last-known-good marker) | eng-backend | T-044 | W1 | {secure-coding} | ADR-001 | Result.err carries DomainError; exhaustive match compiles |
| T-046 | Write REGION invariant test (scope enum COMMUNITY/STATE/COUNTRY) | eng-qa | T-041 | W1 | [PARALLEL] {tdd-cycle} | REGION | rejects scope outside enum; Red |
| T-047 | Create `src/domain/region.ts` + factory to green T-046 | eng-backend | T-046 | W1 | {tdd-cycle} | REGION | scope constrained to union |
| T-048 | Write INCIDENT invariant test (type WILDFIRE/FLOOD, status ACTIVE/CONTAINED/CLOSED) | eng-qa | T-041 | W1 | [PARALLEL] {tdd-cycle} | INCIDENT | rejects invalid status; asserts allowed transitions; Red |
| T-049 | Create `src/domain/incident.ts` + status transition guard to green T-048 | eng-backend | T-048 | W1 | {tdd-cycle} | INCIDENT | CLOSED→ACTIVE rejected |
| T-050 | Write HAZARD_GEOMETRY invariant test (kind enum, observedAt, provenance required) | eng-qa | T-040 | W1 | [PARALLEL] {tdd-cycle} | HAZARD_GEOMETRY | rejects kind outside HOTSPOT/PERIMETER/FLOOD_REACH/SPREAD_CONE; Red |
| T-051 | Create `src/domain/hazard-geometry.ts` + factory to green T-050 | eng-backend | T-050 | W1 | {tdd-cycle} | HAZARD_GEOMETRY | sourceId + observedAt mandatory |
| T-052 | Write GAUGE invariant test (floodCategory ordered enum NONE..MAJOR) | eng-qa | T-040 | W1 | [PARALLEL] {tdd-cycle} | GAUGE | rejects category outside enum; ordering helper correct; Red |
| T-053 | Create `src/domain/gauge.ts` + floodCategory VO to green T-052 | eng-backend | T-052 | W1 | {tdd-cycle} | GAUGE | category comparable by severity |
| T-054 | Write INFRASTRUCTURE_NODE invariant test (status machine ONLINE/AT_RISK/OFFLINE) | eng-qa | T-040 | W1 | [PARALLEL] {tdd-cycle} | INFRASTRUCTURE_NODE | asserts legal transitions per DOMAIN_MODEL §4; Red |
| T-055 | Create `src/domain/infrastructure-node.ts` + transition guard to green T-054 | eng-backend | T-054 | W1 | {tdd-cycle} | INFRASTRUCTURE_NODE | illegal ONLINE→OFFLINE direct hop rejected |
| T-056 | Write EXPOSURE invariant test (reason enum, computedAt deterministic, distance ≥0) | eng-qa | T-041 | W1 | [PARALLEL] {tdd-cycle} | EXPOSURE | rejects negative distance_m; requires computedAt; Red |
| T-057 | Create `src/domain/exposure.ts` + factory to green T-056 | eng-backend | T-056 | W1 | {tdd-cycle} | EXPOSURE | reason ∈ IN_POLYGON/IN_BUFFER/OUTAGE |
| T-058 | Write PREDICTION invariant test (labeled: method+inputs+uncertainty required) | eng-qa | T-040 | W1 | [PARALLEL] {tdd-cycle} | PREDICTION | rejects prediction missing method or uncertainty; Red |
| T-059 | Create `src/domain/prediction.ts` + factory to green T-058 | eng-backend | T-058 | W1 | {tdd-cycle} | PREDICTION | kind enum enforced; uncertainty in [0,1] |
| T-060 | Write PUBLIC_REPORT invariant test (consent required, status machine, confidence 0..1) | eng-qa | T-040 | W1 | [PARALLEL] {tdd-cycle} | PUBLIC_REPORT | rejects consent=false; confidence>1; UNVERIFIED→VERIFIED direct hop; Red |
| T-061 | Create `src/domain/public-report.ts` + geomGeneralized/geomPrecise split to green T-060 | eng-backend | T-060 | W1 | {tdd-cycle}{secure-coding} | PUBLIC_REPORT/ArtXIV | geomPrecise typed responder-only; purgeAfter present |
| T-062 | Write SITREP invariant test (non-empty citations[] required per field, trend enum) | eng-qa | T-041 | W1 | [PARALLEL] {tdd-cycle} | SITREP/ArtXI | rejects SitRep field with empty citations; Red |
| T-063 | Create `src/domain/sitrep.ts` requiring citations[] to green T-062 | eng-backend | T-062 | W1 | {tdd-cycle} | SITREP | each cited field carries ≥1 CitationRef |
| T-064 | Write CITATION invariant test (field + claim + sourceId all required) | eng-qa | T-041 | W1 | [PARALLEL] {tdd-cycle} | CITATION | rejects citation missing field/claim/sourceId; Red |
| T-065 | Create `src/domain/citation.ts` + factory to green T-064 | eng-backend | T-064 | W1 | {tdd-cycle} | CITATION | sitrepId + sourceId mandatory |
| T-066 | Write SOURCE_RECORD invariant test (license, fetchedAt, mode LIVE/CACHED/MOCK) | eng-qa | T-042 | W1 | [PARALLEL] {tdd-cycle} | SOURCE_RECORD/ArtXI | rejects mode outside enum; requires fetchedAt; Red |
| T-067 | Create `src/domain/source-record.ts` + factory to green T-066 | eng-backend | T-066 | W1 | {tdd-cycle} | SOURCE_RECORD | source+adapter+mode mandatory |
| T-068 | Write ALERT invariant test (no ACTUAL without approvedBy; severity/category enums) | eng-qa | T-041 | W1 | [PARALLEL] {tdd-cycle} | ALERT/ArtXIII | rejects capStatus=ACTUAL when approvedBy null; Red |
| T-069 | Create `src/domain/alert.ts` + approval guard to green T-068 | eng-backend | T-068 | W1 | {tdd-cycle}{secure-coding} | ALERT | DRAFT→ACTUAL requires approvedBy |
| T-070 | Write THRESHOLD_RULE invariant test (hysteresis + cooldown non-negative, operator enum) | eng-qa | T-041 | W1 | [PARALLEL] {tdd-cycle} | THRESHOLD_RULE/ADR-014 | rejects negative hysteresis; operator ∈ crosses/gte/enters; Red |
| T-071 | Create `src/domain/threshold-rule.ts` + hysteresis VO to green T-070 | eng-backend | T-070 | W1 | {tdd-cycle} | THRESHOLD_RULE | target enum + hysteresis parsed |
| T-072 | Write RESOURCE invariant test (kind enum, status AVAILABLE/ASSIGNED/OOS) | eng-qa | T-041 | W1 | [PARALLEL] {tdd-cycle} | RESOURCE | rejects kind/status outside enum; Red |
| T-073 | Create `src/domain/resource.ts` + factory to green T-072 | eng-backend | T-072 | W1 | {tdd-cycle} | RESOURCE | kind ∈ CREW/ENGINE/AIRCRAFT/MEDICAL/SUPPLY |
| T-074 | Write RESOURCE_TASK invariant test (status machine PROPOSED..CLEARED) | eng-qa | T-041 | W1 | [PARALLEL] {tdd-cycle} | RESOURCE_TASK | forward-only transitions; PROPOSED→CLEARED skip rejected; Red |
| T-075 | Create `src/domain/resource-task.ts` + transition guard to green T-074 | eng-backend | T-074 | W1 | {tdd-cycle} | RESOURCE_TASK | edxlRmRef optional; status guarded |
| T-076 | Write SHELTER invariant test (occupancy ≤ capacity; status OPEN/FULL/CLOSED) | eng-qa | T-040 | W1 | [PARALLEL] {tdd-cycle} | SHELTER | rejects occupancy>capacity; negative occupancy; Red |
| T-077 | Create `src/domain/shelter.ts` + capacity invariant to green T-076 | eng-backend | T-076 | W1 | {tdd-cycle} | SHELTER | FULL implies occupancy==capacity |
| T-078 | Write EVAC_ROUTE invariant test (avoidsHazard flag, geom LineString) | eng-qa | T-040 | W1 | [PARALLEL] {tdd-cycle} | EVAC_ROUTE | rejects non-LineString geom; requires incidentId; Red |
| T-079 | Create `src/domain/evac-route.ts` + factory to green T-078 | eng-backend | T-078 | W1 | {tdd-cycle} | EVAC_ROUTE | avoidsHazard defaults true |
| T-080 | Write APP_USER invariant test (role PUBLIC/RESPONDER/VERIFIER/EM) | eng-qa | T-041 | W1 | [PARALLEL] {tdd-cycle} | APP_USER | rejects role outside enum; Red |
| T-081 | Create `src/domain/app-user.ts` + role VO to green T-080 | eng-backend | T-080 | W1 | {tdd-cycle}{secure-coding} | APP_USER | role drives RBAC helper isResponder() |
| T-082 | Write AUDIT_EVENT hash-chain invariant test (prevHash/hash chain, cost fields nullable) | eng-qa | T-042 | W1 | [PARALLEL] {tdd-cycle}{secure-coding} | AUDIT_EVENT/ADR-022 | rejects event whose hash breaks chain; modelTier enum; Red |
| T-083 | Create `src/domain/audit-event.ts` + hash-chain link helper to green T-082 | eng-backend | T-082 | W1 | {tdd-cycle}{secure-coding} | AUDIT_EVENT | hash derived deterministically from prevHash+payload |
| T-084 | Create `src/domain/index.ts` barrel re-exporting all 19 entities + value objects | eng-backend | T-047,T-049,T-051,T-053,T-055,T-057,T-059,T-061,T-063,T-065,T-067,T-069,T-071,T-073,T-075,T-077,T-079,T-081,T-083 | W1 | {secure-coding} | ADR-001 | all entity types importable via `@/domain` |
| T-085 | Create `src/ports/data-sources.ts` (HazardSourcePort, WeatherSourcePort, FloodGaugePort) | eng-backend | T-045,T-051,T-053 | W1 | [PARALLEL] {secure-coding} | ADR-001 P1–P3 | `<Name>Port` methods return Result<T,DomainError>; tsc clean |
| T-086 | Create `src/ports/infrastructure-sources.ts` (Infrastructure, Outage, Telecom, Population) | eng-backend | T-045,T-055,T-057 | W1 | [PARALLEL] {secure-coding} | ADR-001 P4/P5/P12/P13 | signatures return Result with freshness; no framework import |
| T-087 | Create `src/ports/intel.ts` (NewsIntelPort, LLMPort, VisionPort, AICompliancePort) | eng-backend | T-045,T-063,T-065 | W1 | [PARALLEL] {secure-coding} | ADR-001 P6/P11/Vision/ADR-017 | LLMPort exposes narrate-only (no number-producing) signature; tsc clean |
| T-088 | Create `src/ports/public-report.ts` (PublicReportPort intake/triage) | eng-backend | T-045,T-061 | W1 | [PARALLEL] {secure-coding} | ADR-001 P7 | intake signature requires consent flag; returns Result |
| T-089 | Create `src/ports/logistics.ts` (RoutingPort, ResourceLogisticsPort, AlertSinkPort[Edxl]) | eng-backend | T-045,T-069,T-075,T-079 | W1 | [PARALLEL] {secure-coding} | ADR-001 P8/P9/P10 | AlertSinkPort emit rejects non-ACTUAL at type level; tsc clean |
| T-090 | Create `src/ports/infra.ts` (RepositoryPort, EventBusPort, QueuePort, SpatialPort, CachePort) | eng-backend | T-045,T-084 | W1 | [PARALLEL] {secure-coding} | ADR-001 Infra | generic RepositoryPort<T> typed to domain entities; no DB import |
| T-091 | Create `src/ports/index.ts` barrel re-exporting all ~20 port interfaces | eng-backend | T-085,T-086,T-087,T-088,T-089,T-090 | W1 | {secure-coding} | ADR-001 | every port importable via `@/ports`; tsc clean |
| T-092 | Add F9 fitness test (domain imports no framework/HTTP/DB) | eng-qa | T-084 | W1 | {tdd-cycle}{secure-coding} | F9/ArtVIII | fails if any `src/domain/**` imports next/drizzle/http/adapters |
| T-093 | Add madge no-circular test for src/domain + src/ports | eng-qa | T-091,T-092 | W1 | {secure-coding} | F9/ArtVIII | `madge --circular src/domain src/ports` clean; test green |

**Cross-epic:** E3 needs the entity types + `RepositoryPort<T>` (T-090); E4 needs the source ports (T-085…T-089); E5 needs factories/guards + consumes ports as interfaces only.
**Open items (S05):** (a) ✅ RESOLVED (D-27): AUDIT_EVENT `prev_hash/hash` are now **persisted** in `schema.sql` (append-only tamper-evident chain, verified on read) — E1 domain hash-chain (T-082/T-083) maps to the DDL columns; E3 mirrors them in Drizzle (T-104). (b) `geom_precise` responder-only is app-layer RBAC (enforced in E7/E8), not a domain/DB constraint. (c) THRESHOLD_RULE hysteresis/cooldown string grammar — align with ADR-014/E5.
