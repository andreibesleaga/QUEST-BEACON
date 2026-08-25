# ADR-035 — Predicted-impact methods: four reproducible quantifications + the D6 basic-aggregate tier

- **Status:** Accepted (2026-07-26)
- **Deciders:** Entrant + prod-architect + ops-security (master-plan wave MW-D)
- **Relates to:** ADR-001 (hexagonal — population/telecom stay behind ports), ADR-005 (Turf/PostGIS spatial
  flag), ADR-009/ADR-024 (total redundancy — the population ladder), ADR-012 (config-for-everything — every
  literature parameter is config), ADR-015 (confidence scoring — uncertainty labeling precedent), ADR-021
  (CAMARA telecom adapter — the other telecom source), ADR-022 (observability), ADR-032 (STORM geometry — new
  extents these methods consume), ADR-033 (likelihood/Outlook — where the figures are ranked), ADR-034
  (anticipatory action — an activation shows these figures), ADR-036 (warning excellence — the D4 modules'
  sibling record), CONSTITUTION Art. XII (deterministic source of truth — **the LLM never produces a
  number**), Art. XIII (HITL), Art. XIV (responsible data / aggregate-only / honest limitations), Art. XV
  (adapter discipline + labeled predictions), Art. XVI (fallback ladder, never a dead-end)
- **FR refs:** FR-PAP-1…FR-PAP-5 (`docs/requirements/EARS_FINAL_VERSION.md:193-197`; FU-15, FU-16, FEV-12,
  FEV-13, FEV-14, FUW-5 at `:199-212`) and FR-D6-1…FR-D6-6
  (`docs/requirements/EARS_FINAL_VERSION.md:292-297`; FU-18, FEV-25…FEV-29, FUW-8 at `:299-316`)
- **Threat model:** new rows required at S03 — **population-grid supply chain** (a shipped grid file is a
  build-time artifact: integrity hash verified at load, per master plan §5.8
  `CURRENT-MASTER-PLAN.md:218-219`), new egress host `api.worldpop.org` (extends TB4), and a
  **statistical-disclosure** row under §11 (small-count suppression on every aggregate figure)

## Context

### What is being added, and why it is the sharpest differentiator

`CURRENT-MASTER-PLAN.md:100-104` locks **D2 Predicted-impact quantification**: predicted-affected people,
predicted comms-blackout + alert-reach, hazard-clipped current population, predicted shelter demand +
evacuation-clearance flag — "All aggregate-only, no PII." `CURRENT-MASTER-PLAN.md:119-131` locks the **D6
basic-aggregate tier** with a **HARD BOUNDARY**: "no person-identifying field may exist on any D6 entity",
enforced by a structural test "like the no-LLM-numbers contract". Both land in wave MW-D
(`CURRENT-MASTER-PLAN.md:154-158`).

The annex's gap-audit conclusion is the design premise: all four quantifications are "one deterministic
use-case away from data already ingested" because **neither pending plan computes exposure against PREDICTED
extents** (`CURRENT-PLAN-3-DIFFERENTIATORS.md:59-60`). And the second one — cell sites ∩ predicted extent →
towers likely lost → **estimated residents who cannot be reached by phone-based warnings** → flagged
"needs sirens/door-to-door" zones — is called out as having no published turnkey equivalent
(`CURRENT-PLAN-3-DIFFERENTIATORS.md:68-71`). That is the novel claim of this ADR, and §1(b) is deliberately
blunt about its limits, because an overclaimed novel number is worse than no number.

### Findings from the codebase — several plan assumptions are wrong and change the design

| # | Assumption | Verified reality |
|---|---|---|
| F1 | WorldPop does a local zonal sum / a raster ships in-repo | **False.** `src/adapters/sources/worldpop/worldpop-adapter.ts:55` — `DEFAULT_BASE_URL = 'https://api.worldpop.org/v1/services/stats'`; dataset `wpgppop` `:56`, year `2020` `:57`, default mode CACHED `:194`. A repo-wide search for `*.tif/*.tiff/*.asc/*.vrt/*.nc/*.mbtiles` outside `node_modules` returns **zero files**. There is no raster reader dependency and no zonal-statistics code. |
| F2 | WorldPop is already queried with a polygon | **False in effect.** The adapter does send a GeoJSON polygon (`worldpop-adapter.ts:158`) but it manufactures a **rectangle** from the bbox first — `bboxToPolygonGeoJson` (`worldpop-adapter.ts:170`, 5-point closed ring `:171-183`). The API itself accepts an arbitrary polygon; only our call site forces the rectangle. |
| F3 | "`PopulationPort.estimatePopulation` is today only ever called with the region bbox at `live-seed.ts:214`" | **False on both counts.** `estimatePopulation` has **zero production call sites** — only its two implementations (`worldpop-adapter.ts:120`, `src/adapters/sources/census/census-adapter.ts:110`) and tests. `src/main/live-seed.ts:214` is the declaration of `choosePopulation`, not a call. Production instead goes through the generic framework path `fetchSlice(registry,'worldpop',region)` (`src/main/live-seed.ts:325`, `:358`), consumed at `src/main/live-seed.ts:306`. |
| F4 | A bbox approximation exists in the exposure math | **True — and worse than the plan says.** `blendPopulation` (`src/application/derivation/derive-cop.ts:329-336`) sums `e.count` and **discards `e.area` entirely** — there is no clipping *at all*, so the figure is a whole-region rectangle total. The rendered claim string at `src/application/derivation/derive-cop.ts:343` nevertheless reads *"Approximately N residents within the exposed area"*. **That sentence is not currently true, which makes FU-15 (`docs/requirements/EARS_FINAL_VERSION.md:199-200`) a correctness fix, not an enhancement.** |
| F5 | `PopulationPort` can take a polygon | **False.** `estimatePopulation(area: BBox)` — `src/ports/infrastructure-sources.ts:46`; DTO `PopulationEstimate {area: BBox; count: number}` `:24-27`. A port widening is required. |
| F6 | `Exposure` can carry a population figure | **False.** `src/domain/exposure.ts:10-17` is strictly `{incidentId, nodeId, reason, insideHazard, computedAt, distanceM?}`. No population/area/geometry field. A polygon-precise population figure has no home in the domain model today. |
| F7 | `SpatialPort` can clip or measure area | **False.** Exactly three methods — `pointInPolygon`, `buffer`, `intersect` — `src/ports/infra.ts:49-53`, and **`intersect` returns a `boolean` predicate, not a geometry**. `TurfSpatialPort` imports only `booleanIntersects, booleanPointInPolygon, buffer, point` (`src/adapters/spatial/turf-spatial.ts:5`); `PostgisSpatialPort` is a documented **stub** (`src/adapters/spatial/postgis-spatial.ts:26-41`). The only clipping in the codebase is `clipRingToRect` (Sutherland–Hodgman, **axis-aligned rect only**) at `src/application/shared/map-geometry.ts:95`, used by `projectFloodZoneImpact` and honestly labeled `'convex-window clip'` (`src/application/prediction-projection/prediction-projection.ts:150-165`, `:188`). True polygon∩polygon clipping is **missing**. |
| F8 | OpenCelliD yields `InfrastructureNode{kind:'CELL'}` | **False.** It yields the port DTO `TelecomCoverage` (`src/adapters/sources/opencellid/opencellid-acl.ts:83-87`; DTO at `src/ports/infrastructure-sources.ts:18-22`) — no id, no kind, no status. `'CELL'` `InfraNodeType` values come only from OSM (`src/adapters/sources/osm-overpass/osm-overpass-acl.ts:46-48`). Critically, **`online` is hardcoded `true`** (`opencellid-acl.ts:82-86`). |
| F9 | Cell sites are ingested but never intersected | **True, both cited lines exact.** `src/application/derivation/derive-cop.ts:103` declares `cellSites?: readonly TelecomCoverage[]`; `deriveCellSites` at `:193-201` only re-shapes them for the map layer (`:223`). They never enter `ExposureQuery.nodes` and are never passed to a `SpatialPort` method. |
| F10 | `Prediction` has what we need | Partly. `geom?: Geometry` **exists** (`src/domain/prediction.ts:18`), and `method`/`inputs`/`uncertainty` are **required** (`:15-17`) — the labeling contract is already structural. `likelihoodClass` and `etaHours` are **missing** (ADR-033's job); `horizon?` is an absolute ISO instant (`:19`), not a relative hour count. |
| F11 | `PublicReport` has a `category` | **Missing.** Only `source: 'WEB'\|'SMS'\|'SOCIAL'` (`src/domain/public-report.ts:9`) — a channel, not a category. `consent: true` **is** a literal-typed field (`:32`), the triage machine is `:62-67`, `transitionPublicReport` `:138-146`. |
| F12 | Shelter data has a source | **Missing.** No shelter adapter exists among the 30 source directories; shelters are hardcoded (`src/adapters/persistence/seed.ts:66`) and served in-memory (`src/adapters/logistics/memory-logistics.ts:19`, `:40`, `:94`). `Shelter` has `capacity`/`occupancy` (`src/domain/shelter.ts:15-16`) but **no `demand`** — `demand` exists only on the wire type `ProjectedShelter` (`src/application/map-projection/map-projection.ts:59-62`). |
| F13 | A CSV/JSON export precedent exists | **Missing.** Zero `Content-Disposition`, zero `text/csv` anywhere outbound; every CSV mention is *inbound* parsing (`src/adapters/sources/firms/firms-acl.ts:25`). Nearest precedents: `handleEdxlRmGet` (`src/adapters/channels/http/routes/interop.ts:219`) and `geometriesToFeatureCollection` (`src/adapters/interop/geojson-mapper.ts:77`). |
| F14 | `Resource` kinds are extensible cheaply | **True, and two of the D6 kinds partly exist.** `RESOURCE_KINDS = ['CREW','ENGINE','AIRCRAFT','MEDICAL','SUPPLY']` (`src/domain/resource.ts:9`) — `SUPPLY` already exists; the DB mirror is `src/adapters/persistence/schema/logistics-tables.ts:32`. **`Resource.kind` is never switched on anywhere** — a new kind renders as its raw token with a hardcoded `Truck` icon (`app/_components/panels/logistics-board.tsx:70-71`). |
| F15 | The logistics board can task a new kind today | **Pre-existing defect.** `TRANSITIONS` at `app/_components/panels/logistics-board.tsx:25` is `['PROPOSED','ASSIGNED','EN_ROUTE','ON_SCENE','CLEARED']`, which **drifts from the domain machine** `['PROPOSED','TASKED','ENROUTE','ONSCENE','CLEARED']` (`src/domain/resource-task.ts:9`). Three of the five values are rejected by `makeResourceTask` (`:39-43`). Any "taskable via the existing logistics board" claim is false until this is fixed. |
| F16 | Retention/purge is implemented | **Partly.** `purgeAfter` is stamped (`src/adapters/memory/memory-core.ts:187`, `src/adapters/persistence/read-models.ts:174-177`) and indexed (`src/adapters/persistence/schema/intel-tables.ts:42`), but **no sweep executor exists** — nothing deletes or filters on it. Relevant here because D6's privacy posture must not lean on a purge that does not run. |

## Decision

### 1. Four quantifications, each a METHOD SPEC (inputs → algorithm → output → uncertainty → citation)

All four live in one new pure use-case directory `src/application/predicted-impact/` (no clock, no I/O, no
adapter imports — `.dependency-cruiser.cjs:8-10`). (a) and (c) are **the same function with a different input
geometry**, which is the whole point of F4: one zonal-sum implementation, two call sites.

#### The zonal-sum engine both (a) and (c) use

Given F1/F2/F5/F7, a polygon-precise count needs a source of gridded population that works **offline**. The
decision is a **shipped, pre-clipped, integrity-hashed population GRID plus a live polygon rung**, as a
four-rung Art. XVI ladder — every figure reports which rung served it:

| Rung | Source | Geometry precision | Availability |
|---|---|---|---|
| R1 | WorldPop `services/stats` with the **actual polygon** as `geojson` (removing the `bboxToPolygonGeoJson` rectangle at `worldpop-adapter.ts:170`) | exact polygon, server-side zonal sum | LIVE only (egress `api.worldpop.org`) |
| R2 | **shipped population grid**, in-process area-weighted zonal sum | grid-cell precision, labeled | always, incl. air-gapped |
| R3 | region-bbox estimate (today's behaviour) | none — labeled **"region total, not clipped"** | always |
| R4 | seeded planning estimate (`src/application/derivation/derive-cop.ts:260`) | none — labeled "planning seed" | always |

**Grid format: a quantized integer grid in JSON/NDJSON, not a GeoTIFF.** Rationale: no raster reader exists in
the repo (F1) and adding one costs bundle budget (NFR-F2, `docs/requirements/EARS_FINAL_VERSION.md:325`),
a license review, and a native-dependency risk in the air-gapped image — for a job that is a sum over cells.
One file per shipped zone bbox (US, RO, PH, ES, GR), produced by a committed, re-runnable
`scripts/build-population-grid.ts` that documents the clip step, exactly as master plan §5.2 requires
(`CURRENT-MASTER-PLAN.md:200-202`), with cell size chosen so all five fit well inside the <~50 MB repo budget.
Each file's SHA-256 is recorded in a manifest and **verified at load, fail-closed** (master plan §5.8,
`CURRENT-MASTER-PLAN.md:218-219`). Provenance (WorldPop/GHS-POP, vintage, resolution, licence) rides the
manifest and lands in `provenance[]` on every response.

**Algorithm (pure).** For polygon `P` and grid `G`: for each cell `c` whose bbox intersects `bounds(P)`
(`boundsOf`, `src/application/shared/map-geometry.ts:27`), compute the overlap fraction `f(c,P)` and
accumulate `count(c) × f(c,P)`. Overlap uses the existing rect-clip primitive in the honest direction — the
cell is the rectangle, `clipRingToRect` (`src/application/shared/map-geometry.ts:95`) clips `P`'s ring to it,
and `ringArea` (`:42`) gives the fraction — so **no new polygon∩polygon engine and no `SpatialPort` extension
is needed** (F7). Iteration order is grid order and accumulation is in a fixed sequence, so the float result
is bit-reproducible; the reported figure is rounded and, per §3, suppressed below a threshold.

**Port widening (F5):** `PopulationPort.estimatePopulation(area: BBox | PolygonGeometry)`
(`src/ports/infrastructure-sources.ts:46`) — additive union, both implementations updated.
`WorldPopAdapter` (`worldpop-adapter.ts:120`) serves polygons; `CensusAdapter`
(`src/adapters/sources/census/census-adapter.ts:110`) stays bbox-only and returns a typed error for a
polygon, because it sums whole counties from centroid membership
(`src/adapters/sources/census/census-acl.ts:10`) and a polygon would imply a precision it does not have.
Honest degradation, not a silent lie.

#### (a) Predicted-affected people — FR-PAP-1 / FEV-12

| | |
|---|---|
| **Inputs** | `Prediction.geom` (`src/domain/prediction.ts:18`) for a `FIRE_CONE`/`FLOOD_INUNDATION`/storm extent; the population source (rung R1–R4) |
| **Algorithm** | zonal sum of population over the prediction polygon (engine above) |
| **Output** | `{ count, method: 'zonal-sum/polygon', populationSource, vintage, resolutionMeters, rung, suppressed? }` |
| **Uncertainty** | reported as a band from (i) grid resolution — a cell straddling the boundary contributes area-weighted, not all-or-nothing; (ii) population vintage (2020 for `wpgppop`, `worldpop-adapter.ts:57`); (iii) the rung that served. Never a single unqualified integer |
| **Citation** | the GDACS/GloFAS/PDC operational recipe — hazard ∩ open population grid, GHS-POP cross-check — as recorded at `CURRENT-PLAN-3-DIFFERENTIATORS.md:62-66`; sources listed at `:170` |

#### (b) Predicted comms blackout / alert-reach — FR-PAP-2 / FEV-13 — **the novel one**

| | |
|---|---|
| **Inputs** | cell sites as `TelecomCoverage[]` (`src/application/derivation/derive-cop.ts:103`; produced by `src/adapters/sources/opencellid/opencellid-acl.ts:83-87`), the prediction polygon, the population grid, and `config/impact-params.json` |
| **Algorithm** | (1) `sitesInExtent` = sites whose position is inside the polygon via the **existing** `SpatialPort.pointInPolygon` (`src/ports/infra.ts:50`) — this is the intersection F9 says has never been performed; (2) assign every population grid cell to its **nearest** cell site within `maxAssignmentRadiusKm` (cells with no site inside that radius are counted separately as `residentsAlreadyUnserved`, never as a loss we caused); (3) `residentsLosingCellularReach` = Σ population of cells whose nearest site is in `sitesInExtent`; (4) raise `requiresNonCellularDissemination` when `residentsLosingCellularReach ≥ minResidentsForSirenFlag` **or** `sitesInExtent / sitesTotal ≥ minSiteLossFraction` |
| **Output** | `{ sitesTotal, sitesInExtent, residentsLosingCellularReach, residentsAlreadyUnserved, requiresNonCellularDissemination, method: 'nearest-site-assignment', assumptions: […param ids] }` |
| **Uncertainty** | nearest-site assignment is a **coverage proxy**, not coverage. The uncertainty is dominated by OpenCelliD completeness, not by arithmetic, and is reported qualitatively ("proxy — lower bound on sites, direction of error unknown") rather than as a false numeric interval |
| **Citation** | concept validated via FCC DIRS reporting and the CRS wildfire cell-site analysis as recorded at `CURRENT-PLAN-3-DIFFERENTIATORS.md:68-71`, sources `:170` |

**What this is NOT — stated in the UI caption, the SitRep fact and SPEC, not only here.**
It is **not an RF propagation model** (no terrain, no antenna pattern, no frequency, no link budget).
It is **not per-operator coverage truth** — OpenCelliD is a crowdsourced, incomplete, mixed-vintage
observation database, not an operator's coverage map, and BEACON has no operator feed except the MOCK-only
CAMARA adapter (ADR-021). It is **not a network model** — no backhaul, no core, no capacity, no roaming, no
generator runtime. It is **not an outage prediction and cannot become one**: `TelecomCoverage.online` is
hardcoded `true` at the ACL (`opencellid-acl.ts:82-86`), so BEACON provably does not know any site's real
state; "sites in the predicted extent" is a **geometric** statement about which sites are inside a hazard
footprint, not a claim that they will fail. And it is **not a substitute for the operator's or regulator's
own status reporting**. The value is triage: it tells an EM *where phone-based warning is the wrong plan*.

#### (c) Hazard-clipped current population — FR-PAP-3 / FU-15

Same engine, input geometry = the **current** `HazardGeometry`. This replaces `blendPopulation`
(`src/application/derivation/derive-cop.ts:329-336`) and makes the existing claim string at
`src/application/derivation/derive-cop.ts:343` true for the first time (F4). Method label changes from a
silent region total to `'zonal-sum/polygon'` + rung, and when only R3/R4 can serve, the claim text itself
changes to say "region-wide estimate" rather than "within the exposed area". **The figure does not go on
`Exposure`** (F6): `Exposure` is per-node and adding a population field would corrupt it. It is returned by the
use-case, surfaced as a `GroundedFact` with citations through the existing SitRep path
(`src/application/sitrep-synthesis/sitrep-synthesis.ts:17`) and as a `DecisionFigure` in the decision panel
(`app/_components/panels/index.ts:32`).

#### (d) Predicted shelter demand + evacuation-clearance feasibility — FR-PAP-4 / FEV-14

| | |
|---|---|
| **Inputs** | (a)'s `count`; shelters' `capacity`/`occupancy` (`src/domain/shelter.ts:15-16`) for shelters in or near the extent; the lead time (from the prediction/ADR-034 EAP); parameters from `config/impact-params.json` |
| **Algorithm** | `shelterSeeking = affected × shelterSeekingFraction`; `spareCapacity = Σ(capacity − occupancy)`; `shelterDeficit = max(0, shelterSeeking − spareCapacity)`. Clearance: `vehicles = affected × participationFraction / occupantsPerVehicle`; `clearanceHours = loadingTimeHours + vehicles / egressCapacityVehPerHour`; `evacuationFeasible = clearanceHours ≤ leadTimeHours` |
| **Output** | `{ shelterSeeking, spareCapacity, shelterDeficit, clearanceHours, leadTimeHours, evacuationFeasible, parameterSetId, assumptions[] }` |
| **Uncertainty** | dominated entirely by the parameters, so the output carries `parameterSetId` and every figure renders with its parameter values visible — the reader can see what was assumed |
| **Citation** | trigger-buffer / clearance-time research (Cova & Dennison 2005; Li/Cova/Dennison 2019; Kuligowski 2020) as recorded at `CURRENT-PLAN-3-DIFFERENTIATORS.md:74-78` and `:171` |

**Every parameter is labeled config, never a literal in code** (Art. XV / ADR-012):
`config/impact-params.json`, schema-validated at load like `config/policies.yml`
(`src/adapters/compliance/policy-loader.ts:34-47`), each entry carrying `{ value, unit, label, citation,
verified: boolean }`. Note the annex flags **exact evacuation-participation percentages as UNVERIFIED**
(`CURRENT-PLAN-3-DIFFERENTIATORS.md:174-175`) — so `participationFraction` ships with `verified:false` and a
`label` that says "operator assumption, not a literature value", and the UI renders it distinctly from the
cited parameters. This feeds `suggestPrePositioning`, whose own code comment records that "no
demand-projection source exists in the current logistics model"
(`src/application/pre-positioning/pre-positioning.ts:59-60`); demand rides the projection/wire type
(`ProjectedShelter.demand`, `src/application/map-projection/map-projection.ts:59-62`), **not** the `Shelter`
domain entity (F12) — an estimate is not a shelter attribute.

### 2. Determinism, and the LLM's exact role (FR-PAP-5 / FU-16 / FUW-5, Art. XII)

All four are **pure functions** in `src/application/predicted-impact/`: no clock read, no I/O, no randomness,
no `Date.now()`, fixed iteration order. Identical inputs ⇒ identical output, asserted as a hard test
(acceptance test 5, `docs/requirements/EARS_FINAL_VERSION.md:341`). Every result carries `method`, `inputs`,
population-source vintage and uncertainty — which is why the numbers ride the existing labeled-prediction
contract rather than a new one: `Prediction` already **requires** `method`, `inputs` and `uncertainty`
(`src/domain/prediction.ts:15-17`).

**The LLM narrates and never produces.** The figures reach the narrator only as already-computed
`GroundedFact`s with citations (`src/application/sitrep-synthesis/sitrep-synthesis.ts:17`, merged at `:80`),
exactly as every other engine number does today. FUW-5 forbids the LLM producing any impact number
(`docs/requirements/EARS_FINAL_VERSION.md:211-212`); the structural guarantee is the same one the project
already relies on — the impact use-cases sit in `src/application/`, the LLM sits behind the compliance
gateway in `src/adapters/`, and `.dependency-cruiser.cjs:8-10` forbids the former importing the latter, so
there is no code path by which a model output could become an impact figure.

### 3. Aggregate-only privacy posture, and how it is enforced (Art. XIV / FUW-5)

Four layers, each independently checkable:

1. **No individual data can enter.** The four use-cases' input types name only geometries, grid cells,
   `TelecomCoverage`, `Shelter` and config. There is no `PublicReport` in any signature — and that is made
   structural with a new `.dependency-cruiser.cjs` forbidden rule beside the existing three
   (`.dependency-cruiser.cjs:4-10`): `from ^src/application/predicted-impact` → `to ^src/domain/public-report`
   is an **error**, so a future edit that reaches for report data fails `npm run boundaries`, not review.
2. **The source data is already aggregate.** A population grid cell is a count, not a person; the grid's cell
   size is never finer than the upstream product's resolution, so no sub-cell precision is implied or
   implementable.
3. **Small-count suppression.** Any zonal figure below `minReportableCount` (config, default 10) renders as
   `"<10"` and exports as a bucket, never an exact small number — standard statistical-disclosure control,
   applied at the use-case boundary so it cannot be bypassed by a different renderer.
4. **No new retention.** These methods store nothing about people; they read geometry and grids. This matters
   because F16 shows `purgeAfter` has no sweep executor — the privacy posture here deliberately does **not**
   depend on a purge that does not run. (The missing sweep is a separate pre-existing defect and is recorded
   as such, not fixed by this ADR.)

### 4. The D6 basic-aggregate tier: five thin extensions + one hard boundary

Each module is a thin extension of a **named existing seam**, behind its **own** flag
(`src/config/index.ts` + a `NEXT_PUBLIC_` mirror per the finding that no `FEATURE_*` currently reaches the
browser — `src/config/index.ts:89-90` are declared and never read; only `app/page.tsx:54`, `:60` cross).

| FR | Module | Existing seam it extends (`file:line`) | Delta |
|---|---|---|---|
| FR-D6-1 `FEATURE_D6_VOLUNTEER_TEAMS` | volunteer **TEAMS** as a `Resource` kind | `src/domain/resource.ts:9` (`RESOURCE_KINDS`), DB mirror `src/adapters/persistence/schema/logistics-tables.ts:32`, task lifecycle `src/domain/resource-task.ts:9`/`:56-69`, port `src/ports/logistics.ts:32`, board rows `app/_components/panels/logistics-board.tsx:66-81` (label `:71`) | add `'TEAM'` to the kind union + DB CHECK; optional aggregate fields `callsign?`, `headcount?`, `skills?`, `availability?` on `Resource`. **Never individual names** (§4 boundary). Per F14 `kind` is never switched on, so the only UI work is an icon-map entry beside `logistics-board.tsx:70`. **Blocked on fixing F15** (`logistics-board.tsx:25` state drift) — otherwise "taskable via the existing board" is false |
| FR-D6-2 `FEATURE_D6_SUPPLIES` | **supplies** as a `Resource` kind | same seams; `SUPPLY` **already exists** at `src/domain/resource.ts:9` | add optional `quantity?`, `unit?`, `expiresAt?`; include in the existing distance ranking `rankByExtent` (`src/application/pre-positioning/pre-positioning.ts:118`). **Honest scope note:** there is no generic resource "capacity-vs-demand matcher" in the codebase — matching today is distance ranking plus (d)'s shelter arithmetic. **No donor field, no payment field, ever** |
| FR-D6-3 `FEATURE_D6_REUNIFICATION_LINKS` | family-reunification **LINK-OUT** | `src/application/external-views/external-views.ts:39` (`buildExternalViews`), kinds `:10`, label pattern `:52-70`; region metadata `config/regions.json` | a new pure link builder returning `{label, provider, url}` for the region's official ICRC RFL / national society service. **Zero data handled**: the panel has no input, no form, no POST, no fetch — link-only doctrine (ADR-028). Handling zero data is what makes it constitutional; a registry would not be (§4 PERMANENTLY-OUT) |
| FR-D6-4 `FEATURE_D6_INCIDENT_EXPORT` | **incident summary export** at close | nearest precedents `src/adapters/channels/http/routes/interop.ts:219` (`handleEdxlRmGet`), `src/adapters/interop/geojson-mapper.ts:77` | per F13 there is **no export precedent at all** — this is a new pure `buildIncidentSummary` in `src/application/` + one route returning CSV/JSON with `Content-Disposition`. It reads **only already-held aggregates** (alerts issued, tasks completed, shelter usage, affected-area figures) with `provenance[]`; it collects nothing new (FEV-28, `docs/requirements/EARS_FINAL_VERSION.md:308-310`) |
| FR-D6-5 `FEATURE_D6_CASUALTY_TALLY` | aggregate **casualty tally** on the D4 damage report | `src/domain/public-report.ts:23-42` + the `category` field ADR-036 §7 adds for FR-D4-4 | one optional non-negative integer, **site-level aggregate**, labeled `"unverified — not authoritative"` at **every** render and export site (asserted by a test that enumerates those sites). No names, no ages, no medical detail — a count |

#### The HARD BOUNDARY: no person-identifying field on any D6 entity (FR-D6-6 / FU-18 / FUW-8)

`CURRENT-MASTER-PLAN.md:128-129` demands a structural test "like the no-LLM-numbers contract". Four
enforcement layers, concretely:

**Layer A — type-level, fails `tsc --noEmit` (Gate 2).** In `src/domain/shared/aggregate-only.ts`:

```ts
export const PERSON_IDENTIFYING_KEYS = [
  'name','firstName','lastName','fullName','givenName','familyName','initials',
  'email','phone','phoneNumber','mobile','contact','contactName','address','street','postcode',
  'dob','dateOfBirth','age','gender','nationalId','ssn','passport','driverLicence',
  'patientId','medicalRecord','diagnosis','triageTag','injuries','bloodType',
  'donor','donorId','payment','amount','cardNumber','iban','account',
  'photoUrl','faceId','biometric','deviceId','imei','ipAddress','userId','personId','reporterId',
] as const;
type PersonIdentifyingKey = (typeof PERSON_IDENTIFYING_KEYS)[number];

/** Resolves to T only when T has NO person-identifying key; otherwise to an error-carrying type. */
export type AggregateOnly<T> =
  Extract<keyof T, PersonIdentifyingKey> extends never
    ? T
    : { readonly __PII_FIELD_FOUND__: Extract<keyof T, PersonIdentifyingKey> };
```

Each D6 entity/DTO then carries a compile-time assertion (`const _check: AggregateOnly<VolunteerTeamFields> =
…`). Adding `contactName` to a D6 type turns the assertion into a type error naming the offending key. This is
the same trick the project already uses to make an invariant a compile error rather than a convention —
`EmittableAlert`'s `capStatus:'ACTUAL'` literal (`src/ports/logistics.ts:41-44`).

**Layer B — schema-level, catches nesting and near-misses.** Every D6 entity gets
`schemas/d6-*.schema.json` with `additionalProperties:false` (the posture
`schemas/cap-v1.2.schema.json` already takes). A test walks each schema's `properties` **recursively** and
fails if any property name (a) matches `PERSON_IDENTIFYING_KEYS` exactly, or (b) matches the
case-insensitive substring set `/name|mail|phone|contact|addr|ssn|dob|birth|patient|medical|diagnos|donor|
pay|card|iban|account|passport|nationalid|person|reporter/`, **unless** it appears in a small
`JUSTIFIED_COLLISIONS` allowlist whose every entry carries a written reason in the test file. This is the layer
that stops `contactName`/`reporterPhone` from ever being added, and the allowlist is where a benign collision
(e.g. `orgId` — an organisation, not a person) is argued in the open rather than assumed.

**Layer C — runtime key enumeration.** A test constructs each D6 factory's output with **every** optional
field supplied, walks the resulting object graph with `Object.keys()` recursively, and asserts the same
denylist. This catches a key that exists at runtime but not in the declared type (a spread, a mapper, a DB
row) — the failure mode Layer A cannot see.

**Layer D — export-time fail-closed guard.** `buildIncidentSummary` (FR-D6-4) runs the same denylist walk over
its output object before serializing and returns a typed error rather than emitting an unknown key. The one
place D6 data physically leaves the system is guarded independently of the three build-time layers.

**Honest residual risk, stated because structure cannot fix it:** field-level structure cannot stop a human
typing a person's name into a free-text `callsign`. Mitigation is a schema `pattern` constraining `callsign` to
an uppercase unit designator (`^[A-Z0-9][A-Z0-9 \-/]{1,23}$`) plus a `maxLength`, and the UI's placeholder/help
text ("unit designator, e.g. `TEAM ALPHA 3` — never a person's name"). The residual risk is accepted and
recorded rather than papered over.

#### PERMANENTLY OUT — and why each one

Restated from `CURRENT-MASTER-PLAN.md:130-131` and FUW-8
(`docs/requirements/EARS_FINAL_VERSION.md:313-316`), with the reason, so it cannot creep back as "we already
have most of it":

| Out of scope | Why |
|---|---|
| Individual medical / triage data | Directly person-identifying and health-category; would demand a lawful basis, clinical governance and a retention regime BEACON has none of, and Art. XIV forbids the retention. A COP does not need it to coordinate |
| Safe-and-well / reunification **registries** | The single highest-harm dataset in disaster response: family-linkage data whose leak endangers the people it lists. The annex's own audit found it conflicts with the no-PII-retention constitution and recommended deferral (`CURRENT-PLAN-3-DIFFERENTIATORS.md:134-137`). D6-3 ships the **link-out**, which is the useful 90% at 0% of the data risk |
| Donor / payment handling | Financial PII plus PCI-class obligations plus a fraud-target surface, for zero coordination value. `CURRENT-MASTER-PLAN.md:123-124` says "NO payments ever". The `resourceCeiling` in an ADR-034 EAP is deliberately unit-count-only, with no currency field |
| Full RECOVER-stage accounting | A different domain (loss assessment, entitlement, audit) on a different timescale, needing individual-level records. D6-4's aggregate incident summary is the honest "after-action seed" instead (`CURRENT-MASTER-PLAN.md:125-127`) |
| Public information portal | A public-facing authoritative publishing surface implies 24/7 editorial ownership and legal responsibility for public messaging that BEACON explicitly does not claim (no IPAWS origination, ADR-010; not a CBE, ADR-036 §6). CAP/EDXL output feeds the authorities who *do* own it |

## Verification

| # | What is verified | Concrete test / gate |
|---|---|---|
| V1 | **Reproducibility** (acceptance test 5, `docs/requirements/EARS_FINAL_VERSION.md:341`) | `tests/redundancy/predicted-affected-reproducibility.test.ts` (beside `tests/redundancy/redundancy-acceptance.test.ts`) — identical polygon + grid ⇒ identical count across runs and across iteration-order permutations of the input cell list |
| V2 | Zonal sum is correct, not merely stable | `src/application/predicted-impact/*.test.ts` — analytic fixtures: polygon exactly covering N whole cells ⇒ Σ; a half-covered cell ⇒ half its count; a polygon entirely inside one cell; a polygon outside the grid ⇒ 0 with a `rung`/`served:false` label; degenerate/self-touching ring ⇒ typed error, never `NaN` |
| V3 | Polygon-precise ≠ bbox (the F4 fix) | a test asserting the clipped count is **strictly less** than the region-bbox count for a hazard smaller than its region, and that when only R3/R4 serves, the claim text says "region-wide estimate" rather than "within the exposed area" (guarding `src/application/derivation/derive-cop.ts:343`) |
| V4 | Grid integrity | load-time SHA-256 mismatch ⇒ fail-closed typed error and the R3 rung is used with an honest label; manifest-vs-file drift test |
| V5 | Alert-reach arithmetic | table-driven `(sites, extent, grid) → (sitesInExtent, residentsLosingCellularReach, flag)`; a site exactly on the boundary; zero sites ⇒ no flag and an explicit "no cell-site data" label, never a silent 0; `residentsAlreadyUnserved` never double-counted into the loss figure |
| V6 | The blackout figure cannot be read as an outage claim | a test asserting every emitted alert-reach fact carries the "geometric proxy / not an outage prediction" caveat string, and that no code path reads `TelecomCoverage.online` as evidence (it is hardcoded `true`, `src/adapters/sources/opencellid/opencellid-acl.ts:82-86`) |
| V7 | Clearance/shelter parameters are config and labeled | `config/impact-params.json` schema test: every parameter has `unit`, `label`, `citation`, `verified`; a test asserting `participationFraction.verified === false` and that unverified parameters render distinctly; a grep test asserting no numeric literal for these parameters exists in `src/application/predicted-impact/` |
| V8 | Determinism / Art. XII | `npm run boundaries` (`.dependency-cruiser.cjs:8-10`) plus a test asserting the four use-cases read no clock and perform no I/O (no `Date`, no `fetch`, no `fs` in the module graph) |
| V9 | No PII can enter the impact path | the new `predicted-impact-never-imports-public-report` depcruise rule failing `npm run boundaries` if violated |
| V10 | Small-count suppression | figures below `minReportableCount` render/export as a bucket in **every** surface (API envelope, SitRep fact, decision figure, CSV export) — one test per surface |
| V11 | **No person-identifying field on any D6 entity** (acceptance test 6, `docs/requirements/EARS_FINAL_VERSION.md:342`) | `tests/architecture/d6-no-pii.test.ts` (beside the existing structural test `tests/architecture/f9-domain-purity.test.ts`) — Layer A: a `@ts-expect-error` fixture proving a type with `contactName` fails `AggregateOnly<>`; Layer B: recursive schema-property walk against the exact + substring denylists with the justified-collision allowlist; Layer C: runtime `Object.keys()` walk over maximal factory output; Layer D: `buildIncidentSummary` rejects an injected unknown key |
| V12 | Callsign residual risk is mitigated as claimed | schema `pattern`/`maxLength` unit test rejecting `"John Smith"` as a callsign |
| V13 | Each D6/impact surface is flag-isolated | with every `FEATURE_D6_*` and `FEATURE_PREDICTION_IMPACT` off, all gates stay green and no surface renders (NFR-F5, `docs/requirements/EARS_FINAL_VERSION.md:328`) |
| V14 | Perf budget holds with the grid | `e2e/perf.spec.ts` — TTTP < 10 s with the impact layers on (NFR-F1, `:324`); zonal sums precomputed/tiled so map interaction stays 60 fps (master plan §5.1, `CURRENT-MASTER-PLAN.md:196-199`) |
| V15 | Repo/data budget | documented MW-E check that the five grid files plus fonts and catalogs keep repo growth under ~50 MB (NFR-F3, `:326`; master plan §5.2, `CURRENT-MASTER-PLAN.md:200-202`) |

## Consequences

**Positive.** The headline number every EM asks first becomes real and reproducible, and the existing
"within the exposed area" claim stops being false (F4). One zonal-sum implementation serves both the
predicted and the current-hazard case. The novel alert-reach figure needs **no new spatial primitive** — it
rides `pointInPolygon` (`src/ports/infra.ts:50`), which is why it is cheap despite being the differentiator.
The whole set works air-gapped from a shipped grid, and the D6 tier costs five thin deltas on seams that
already exist, four of which are a single enum value or an optional field.

**Negative / accepted.** (a) A shipped population grid is the first substantial binary-ish data asset in the
repo, with a build script, an integrity manifest and a budget to police at MW-E; (b) `PopulationPort` widens,
touching both implementations, and `CensusAdapter` gains an honest "polygon unsupported" path; (c)
grid-resolution error is real — a coarse grid over a small hazard is a weak estimate, which is why the
uncertainty band and the rung label are mandatory rather than decorative; (d) the alert-reach figure is the
most likely to be over-read by an audience, so it carries the heaviest caveat load in the product;
(e) `logistics-board.tsx:25`'s state drift (F15) must be fixed before D6-1 can honestly claim taskability —
a pre-existing defect that this wave inherits; (f) the missing purge executor (F16) remains unfixed and must
be tracked separately, because a privacy story with a dormant retention sweep is only as good as its
"we store nothing new" claim.

**Honest limitations (all must appear in the consolidated SPEC "Known limitations" index,
`CURRENT-MASTER-PLAN.md:223-226`).**

1. **Population vintage and resolution.** The wired dataset is `wpgppop` for **2020**
   (`src/adapters/sources/worldpop/worldpop-adapter.ts:56-57`). Every figure is a modelled, years-old
   estimate of *residential* population — not present population, not daytime population, not tourists, not
   commuters. GHS-POP is a cross-check, not an independent truth.
2. **Grid-cell precision.** Below one cell the number is meaningless; area-weighted partial cells assume
   population is uniform **within** a cell, which it is not.
3. **OpenCelliD completeness.** Crowdsourced, unevenly complete by country and operator, mixed vintage, and
   `online` is stamped `true` at the ACL (`src/adapters/sources/opencellid/opencellid-acl.ts:82-86`).
   `sitesInExtent` is therefore a lower bound on sites and says nothing about whether a site will fail.
4. **Nearest-site assignment is a proxy.** Real coverage depends on terrain, antenna pattern, frequency,
   sector orientation and capacity — none of which BEACON has. Residents assigned to a site inside the extent
   may retain service from a site outside it, and vice versa.
5. **Clearance-time parameters are literature, not local truth** (already named at
   `CURRENT-MASTER-PLAN.md:225`). Road capacity, loading time, occupants per vehicle and especially
   participation are population- and place-specific; the shipped values are defaults to be replaced by local
   study, and `participationFraction` is explicitly **not** a literature value
   (`CURRENT-PLAN-3-DIFFERENTIATORS.md:174-175`).
6. **Shelter data is seeded, not sourced** (F12). Until a shelter feed exists (ADR-036 §7, FR-D4-3), demand
   is compared against hand-seeded capacity — an illustrative comparison, not an operational one.
7. **No calibration or verification.** BEACON does not validate any of these figures against observed
   outcomes; "calibrated probabilistic modelling of our own" is explicitly out of scope
   (`docs/requirements/EARS_FINAL_VERSION.md:348`).
8. **Aggregate means aggregate.** These numbers can never answer "who" or "which household", by design, and
   no amount of zooming will make them.

## Alternatives considered

- **Ship GeoTIFF rasters + a raster reader** — rejected: no raster dependency exists today (F1), it would cost
  bundle budget (NFR-F2), a licence review and a native-dependency risk in the air-gapped image, for a task
  that is a weighted sum over cells. A quantized integer grid is inspectable, diffable and dependency-free.
- **Call the live WorldPop polygon API only** — rejected: it makes the flagship figure disappear in the
  air-gapped/offline path that Art. XVI makes a required acceptance test, and puts the headline number behind
  a third-party uptime. It is kept as rung R1 where egress exists.
- **Extend `SpatialPort` with `clip`/`area` and do true polygon∩polygon** — considered, not chosen for v1:
  `intersect` currently returns a boolean (`src/ports/infra.ts:52`) and the PostGIS implementation is a stub
  (`src/adapters/spatial/postgis-spatial.ts:26-41`), so the extension would have to be implemented twice, one
  of them properly, for a precision gain that grid-cell resolution dominates anyway. The cell-as-rectangle
  formulation reuses `clipRingToRect` (`src/application/shared/map-geometry.ts:95`) exactly as
  `projectFloodZoneImpact` already does (`src/application/prediction-projection/prediction-projection.ts:150-165`).
  Recorded as the extension point if a finer grid ever makes it the dominant error term.
- **Put the population figure on `Exposure`** — rejected (F6): `Exposure` is an incident↔node relation
  (`src/domain/exposure.ts:10-17`); a polygon-level aggregate is a different concept and would make every
  existing consumer of `Exposure` carry a field it cannot fill.
- **Derive comms blackout from `TelecomCoverage.online`** — rejected: that field is hardcoded `true`
  (`src/adapters/sources/opencellid/opencellid-acl.ts:82-86`), so any "offline sites" figure built on it would
  be fabricated (Art. XII). The geometric formulation is honest about being geometric.
- **Proportional blackout estimate (`affected × sitesInExtent/sitesTotal`)** — rejected: a plausible-looking
  number with no defensible mechanism. Nearest-site assignment is explainable cell-by-cell, which is what
  makes the figure auditable rather than merely presentable.
- **Hardcode clearance parameters in the use-case** — rejected (Art. XV / ADR-012). If the assumption is not
  visible and swappable, the figure is not honest.
- **A full volunteer-management module (individual sign-up, credentials, shifts)** — rejected: it is the
  rejected-outright scope the annex records (`CURRENT-PLAN-3-DIFFERENTIATORS.md:138-140`) and it necessarily
  holds person-level data. The TEAM-as-`Resource` form keeps every coordination benefit with a headcount
  instead of a roster.
- **A single `FEATURE_D6` flag for all five modules** — rejected: master plan §5.4 requires per-surface flags
  so one misbehaving module can be switched off without reverting the merge
  (`CURRENT-MASTER-PLAN.md:206-208`), and EARS assigns each module its own flag
  (`docs/requirements/EARS_FINAL_VERSION.md:292-296`).
- **Enforce the no-PII boundary with a lint rule only** — rejected: an ESLint rule is per-file and easy to
  disable inline. Layers A–D make the boundary a type error, a schema test, a runtime enumeration and a
  fail-closed export guard, and only Layer B is a text-matching heuristic.

## Implementation status

Not started — this ADR is the S02 architecture record for wave MW-D (`CURRENT-MASTER-PLAN.md:154-158`).
S03 delivers `schemas/d6-*.schema.json`, `config/impact-params.json` + its schema, the population-grid
manifest format, the `PopulationPort` polygon widening, `CONFIGURATION.md`/`.env.example` rows for
`FEATURE_PREDICTION_IMPACT` and the five `FEATURE_D6_*` flags (plus `NEXT_PUBLIC_` mirrors), and the new
THREAT_MODEL rows. S04/S05+ implement under the golden-thread requirement→spec→test→code discipline.
Sibling records: ADR-034 (the activation these figures accompany), ADR-036 (the D4 tier, including the
`PublicReport.category` field FR-D6-5 depends on and the shelter feed FR-PAP-4 needs).

---

## Resolution note — 2026-07-31: the five `FEATURE_D6_*` flags default `on` (F-170)

**Appended, not rewritten.** Everything above stands as originally decided; this records a later
entrant decision and the reasoning behind it.

**The conflict.** `docs/SPEC-FINAL-VERSION-DELTA.md:131` stated the five `FEATURE_D6_*` flags default
`on`; the D6 build brief stated `off`. The implementing lane shipped `off` — the safe reading when two
authorities disagree — and raised it as finding **F-170** rather than picking silently. That was the
right call: when two surfaces disagree, find ground truth, do not let the majority or the convenient
reading win (the lesson of F-58, where two aspirational surfaces outvoted one true one).

**The decision.** The entrant resolved it to **`on`**, on 2026-07-31. These five modules are the
demonstrable coordination surfaces of a contest entry, and a capability nobody can see scores nothing.

**Why this is defensible rather than merely convenient.** The argument for `off` was that each module is
a new surface carrying a new privacy boundary (Art. XIV aggregate-only). That argument is **answered
structurally, not waived**: no D6 entity can carry a person-identifying field at all, enforced at four
independent layers — (A) `AggregateOnly<T>` at `tsc`, (B) a recursive walk of every
`schemas/d6-*.schema.json`, (C) a runtime key walk over maximal factory output, (D) `guardAggregateOnly`
fail-closed at the export boundary. Each layer was proven by planting a violation and observing the
failure, not by inspection. **A flag default cannot leak what the type system cannot express.** Had the
guarantee been a runtime filter rather than a structural one, `off` would have remained the correct
default and this note would say so.

**What did NOT change.** Acceptance criterion **V13 still binds**: with every `FEATURE_D6_*` explicitly
set `off`, all gates stay green and no surface renders. That is a property of the off state, not a
statement about the default, and its test must keep passing. Operators wanting the most conservative
deployment set all five to `off`.

**Known, accepted, documented risk (F-177 — still open).** `FEATURE_D6_REUNIFICATION_LINKS` defaulting
`on` means the link-out ships with two curated URLs whose liveness is **unconfirmed**:
`familylinks.icrc.org` and the American Red Cross RFL page both answer automated requests with HTTP 403
bot protection. They are unverified, **not disproven** — and the Red Cross entry has no positive evidence
at all. The module handles zero data and always emits the GLOBAL rung, so an unreachable link
degrades-and-labels rather than dead-ending. **The entrant verifies both by hand before submission.**
Until then this is an accepted risk recorded in the open, not an oversight. A 403 is never a pass.

**Carried forward.** The identical conflict exists for the five `FEATURE_D4_*` flags
(`SPEC-FINAL-VERSION-DELTA.md:130` says `on`; they currently ship `off`). It was NOT resolved here only
because the owning lane held those files at the time — see F-193.
