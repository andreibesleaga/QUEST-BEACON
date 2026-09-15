# ADR-032 — Storm hazard family: `STORM` incident type + `TRACK`/`CONE`/`STORM_SURGE` geometry kinds

- **Status:** Accepted (2026-07-26)
- **Deciders:** Entrant + prod-architect (master-plan wave MW-B / MW-C)
- **Relates to:** ADR-001 (hexagonal ports-and-adapters — a storm source is just another adapter family),
  ADR-010 (CAP/EDXL interop — storm/surge event+category mapping), ADR-011 (multi-region registry — the
  Philippines shipped zone is the reason this hazard exists), ADR-014 (threshold-rule engine — surge/track
  crossing rules reuse it unchanged), ADR-015 (confidence scoring — untouched, orthogonal), CONSTITUTION
  Art. XII (deterministic source of truth — geometry/exposure numbers never come from the LLM), Art. XIV
  (responsible data / honest limitations), Art. XVI (total redundancy / never a dead-end layer)
- **FR refs:** FR-STORM-1, FR-STORM-2, FR-STORM-3 (`docs/requirements/EARS_FINAL_VERSION.md:119-128`)

## Context

### Why now

`CURRENT-MASTER-PLAN.md` §2B (`CURRENT-MASTER-PLAN.md:83-84`) locks the shipped-core zone set at **five**
regions: US, Romania, **Philippines**, Spain, Greece, and states explicitly: **"STORM/TYPHOON first-class
hazard type + cyclone track/cone + STORM_SURGE kind (Philippines is coastal ⇒ in scope)."** The detail annex
(`CURRENT-PLAN-2-GLOBAL-PREDICTION.md:50-53`) is unambiguous: *"STORM/TYPHOON first-class hazard type — KEEP
(the Philippines zone needs it; it is the top global disaster type)... the Philippines core zone is coastal,
so STORM_SURGE HazardKind IS in scope for v1."* The Philippines is the #1-ranked country on the WorldRiskIndex
and its dominant hazard is tropical cyclone (typhoon), not fire or flood. Shipping the zone with only the
existing `WILDFIRE`/`FLOOD` incident types (`src/domain/incident.ts:7`) would misrepresent the zone's actual
risk profile and fail FEV-5/FEV-6 (`docs/requirements/EARS_FINAL_VERSION.md:125-128`). This decision is
therefore locked by the master plan, not optional scope.

### Current domain shape (verified)

`src/domain/incident.ts:7`:
```ts
export const INCIDENT_TYPES = ['WILDFIRE', 'FLOOD'] as const;
```
mirrored at `src/adapters/persistence/schema/core-tables.ts:87` (`chk_incident_type`, same two values).

`src/domain/hazard-geometry.ts:8`:
```ts
export const HAZARD_KINDS = ['HOTSPOT', 'PERIMETER', 'FLOOD_REACH', 'SPREAD_CONE'] as const;
```
mirrored at `src/adapters/persistence/schema/core-tables.ts:112-117` (`chk_hazard_geometry_kind`, same four
values). **Finding:** `SPREAD_CONE` already exists but is the wildfire spread-projection kind (consumed by
`projectFireCone`, `src/application/prediction-projection/prediction-projection.ts:38-64`) — it is NOT
available for reuse as the cyclone forecast cone; a storm needs its own `CONE` kind to avoid conflating a
first-order fire prediction with an authoritative cyclone-agency forecast cone (different provenance, different
uncertainty semantics, different geometry source).

`src/domain/value-objects/geo.ts:5-9` — the `Geometry` union already includes `LineStringGeometry`,
`PolygonGeometry`, and `MultiPolygonGeometry`. **No change needed here**: `TRACK` (line), `CONE` (polygon),
and `STORM_SURGE` (polygon/multipolygon) all fit the existing geometry vocabulary.

`src/domain/hazard-geometry.ts:31` — `GEOMETRY_TYPES = ['Point', 'LineString', 'Polygon', 'MultiPolygon']` —
already permits all three new kinds' geometry types. **No change needed here either.**

## Decision

### 1. Domain: add `STORM` incident type + `TRACK`/`CONE`/`STORM_SURGE` hazard kinds

```ts
// src/domain/incident.ts:7
export const INCIDENT_TYPES = ['WILDFIRE', 'FLOOD', 'STORM'] as const;

// src/domain/hazard-geometry.ts:8
export const HAZARD_KINDS = ['HOTSPOT', 'PERIMETER', 'FLOOD_REACH', 'SPREAD_CONE', 'TRACK', 'CONE', 'STORM_SURGE'] as const;
```

Mirror both CHECK constraints:
- `src/adapters/persistence/schema/core-tables.ts:87` `chk_incident_type` → add `'STORM'`.
- `src/adapters/persistence/schema/core-tables.ts:112-117` `chk_hazard_geometry_kind` → add
  `'TRACK', 'CONE', 'STORM_SURGE'`.

No change to `HazardGeometry`'s interface shape or `makeHazardGeometry`'s invariants
(`src/domain/hazard-geometry.ts:33-55`) — the guard already validates `kind` against the (extended) array and
`geometry.type` against the (already-sufficient) `GEOMETRY_TYPES` list. `intensity?: number` is reused for
`CONE`/`TRACK` (e.g. central-pressure or category proxy) and left `undefined` where the source doesn't supply
one — same optionality pattern as today.

`Prediction.kind` (`src/domain/prediction.ts:8`, `PREDICTION_KINDS`) is **not** touched by this ADR — the
storm track/cone are *observed/forecast hazard geometry from an authoritative agency product* (PAGASA/JTWC/
NHC-class bulletins), not a BEACON first-order projection like `FIRE_CONE`/`FLOOD_INUNDATION`. Conflating them
would violate the "BEACON renders, it does not model cyclones" honesty boundary (§6 below).

### 2. Exhaustive `Record<…>` maps this forces a compile error in — the checklist

Every one of these is a `Record<LayerId, …>` or `Record<HazardKind/IncidentType, …>`-shaped exhaustive map.
Adding `TRACK`/`CONE`/`STORM_SURGE` to `HAZARD_KINDS` and a `storm` layer id to `LAYER_IDS` is *deliberately*
a compile error at every one of these sites until each is filled in — that is the intended TypeScript
safety net (a missed one fails `tsc --noEmit`, Gate 2), not a design flaw:

| # | File:line | Map | What must be added |
|---|---|---|---|
| 1 | `app/_lib/types.ts:15-29` | `LAYER_IDS` (const array, not `Record` but every downstream `Record<LayerId,…>` is keyed off it) | `'storm'` layer id |
| 2 | `app/_components/map/palette.ts:9` | `COLOR_BY_GROUP: Record<LayerId, RGBA>` | `storm` hue (see §4 palette) |
| 3 | `app/_components/map/build-layers.ts:56` | `LAYER_META: Record<LayerId, LayerMeta>` | label + uncertainty caveat for the storm layer |
| 4 | `app/_components/map/build-layers.ts:369` | `LAYER_BUILDERS: Record<LayerId, LayerBuilder>` | `buildStormLayers` (track line + cone polygon + surge polygon descriptors) |
| 5 | `app/_lib/map-data.ts:135` | `populated: Record<LayerId, boolean>` inside `presentLayers()` | `storm: md.storm !== undefined` |
| 6 | `app/_lib/store.ts:9-14` | `defaultLayers()` — not a literal `Record`, loops `LAYER_IDS`, but the on/off `Set` (`store.ts:10`) is the default-state decision point | decide default (see §4) |

Additionally, non-`Record` but exhaustive-by-convention sites that must be extended (not compile-enforced,
so listed as a manual checklist item — a missed one is a silent gap, not a `tsc` failure):
- `app/_lib/map-data.ts:98-103` `prediction()` mapper pattern — a parallel `storm()` mapper must be added
  (hazards of kind `TRACK`/`CONE`/`STORM_SURGE` → `StormData`), following the same
  `fireData()`/`floodData()` kind-filter idiom already used at `app/_lib/map-data.ts:48-61` and `:64-75`.
- `src/application/map-projection/map-projection.ts` — `ProjectedHazard`/`projectHazard`
  (`:36-42`, `:228-236`) already carry any `HazardKind` verbatim (no kind-specific branching there), so
  `TRACK`/`CONE`/`STORM_SURGE` pass through **unchanged**. This is the one seam that does NOT need a new
  case — confirmed by reading `projectHazard`: it switches on nothing, it just copies `kind`.
- `src/adapters/interop/cap-mapper.ts:92-105` `geometryToCapArea()` — already has a `default` branch
  (`:104`, `// LineString has no CAP area primitive — describe by text only`) that a `TRACK` (LineString)
  alert area falls into automatically. **No code change forced**, but see §6 (honest-limitation wording).
- `src/domain/alert.ts:12` `ALERT_CATEGORIES = ['Fire', 'Met', 'Safety']` — **no change needed**: a storm/
  surge `Alert.category` is `'Met'`, which already exists (CAP's own `<category>` vocabulary already has
  `Met` for meteorological hazards including tropical cyclones — `src/adapters/interop/cap-mapper.ts:84-85`
  passes `AlertCategory` straight through as the CAP category code).

**Explicitly NOT in the checklist** (verified, not assumed): `src/application/risk-intersection/
risk-intersection.ts` — `computeExposures()` (`:35-52`) loops every `HazardGeometry` in the incident's
`hazards` array with no `kind`-based branch (`isInsideAnyHazard`/`isWithinBuffer`, `:69-98`, iterate
`hazards` generically). It requires **no code change** — only a data-flow decision about *which* hazard
rows are included in the `hazards` array passed in (§3).

### 3. Exposure semantics — surge is exposure input, track/cone are advisory-only

`STORM_SURGE` polygons are passed into `ExposureQuery.hazards` (`src/application/risk-intersection/
risk-intersection.ts:18`) exactly like `FLOOD_REACH` — the function is kind-agnostic (confirmed §2), so this
is a data-wiring decision at the composition root (`src/main/`), not a new code path: the query builder
that assembles `hazards` for an incident includes `STORM_SURGE` rows the same way it includes
`FLOOD_REACH`/`PERIMETER` rows today.

`TRACK` and `CONE` are **excluded** from that `hazards` array. Rationale: a forecast cone is the cyclone
*agency's* uncertainty envelope for the storm center's future position — it is not a footprint of expected
impact (wind/rain/surge fields extend far beyond the cone, and the cone itself intentionally does not imply
uniform risk inside it — this is a standard, well-documented misreading NHC/PAGASA both warn against).
Feeding it into `computeExposures` would silently misclassify infrastructure as "inside a hazard" based on
a positional-uncertainty polygon, not an impact polygon — a Constitution Art. XII violation by proxy (an
engine number computed from the wrong semantic input is still an invented number). `TRACK`/`CONE` render as
advisory map geometry only (§4); `STORM_SURGE` is the impact-bearing kind and is the only one of the three
in the exposure/ranking pipeline (FR-STORM-3 / FEV-6).

### 4. Presentation

- **Layer id:** `storm` added to `LAYER_IDS` (`app/_lib/types.ts:15-29`), one combined toggleable layer
  carrying all three geometry kinds' descriptors (track line, cone polygon, surge polygon) — mirrors the
  existing `fire`/`flood` pattern where one layer id fans out to multiple `LayerDescriptor`s
  (`buildFireLayers`, `app/_components/map/build-layers.ts:74-101`, returns up to two descriptors).
- **Default state: OFF.** Justification: every other hazard-specific layer that isn't one of the two
  "primary" hazards defaults off (`app/_lib/store.ts:10`, `on = new Set(['fire', 'flood', 'reports'])` —
  `floodzone`, `outage`, `cell`, `weather`, `cameras`, `exposure`, `prediction`, `route`, `shelters` are all
  default-off overlays the user opts into). Storm is region-specific (only the Philippines zone populates
  it in v1) and, per §3, the cone specifically risks being *misread* as an impact area if shown
  unconditionally — defaulting it off, paired with the mandatory uncertainty label the moment it's toggled
  on, is the same discipline BEACON already applies to `prediction` (`LAYER_META.prediction`,
  `build-layers.ts:67`, no caveat shown until toggled).
- **Legend entry:** `LAYER_META.storm` (`build-layers.ts:56-70`) gets a `label` ("Storm track, cone &
  surge") and a `caveat` string, following the existing `FIRE_CAVEAT`/`FLOODZONE_CAVEAT`/`WEATHER_CAVEAT`
  idiom (`build-layers.ts:30-36`) — plain-language, always visible in the toggle panel + legend
  (`Legend` component, `app/_components/ui/legend.tsx:76-88`, reads from the same meta maps so it can never
  drift from the live layer).
- **Uncertainty labeling on the cone specifically:** mirrors `predictionCaveat()`
  (`build-layers.ts:38-41`, `First-order {method}; inputs: {inputs}; uncertainty: {uncertainty}.`) — the
  storm builder emits a parallel `stormConeCaveat()` stating the issuing agency, advisory number/time, and
  the standard "the cone shows track-center uncertainty, not the extent of hazardous conditions" wording
  (FEV-5, `EARS_FINAL_VERSION.md:125-126`).
- **Palette (`app/_components/map/palette.ts:9-23`):** one new `RGBA` entry for `storm`, chosen to be
  visually distinct from every existing hue under a colour-blind (deuteranopia/protanopia) simulation and,
  per the file's own stated invariant (`palette.ts:3`, "Color is never the sole signal... these hues only
  reinforce"), meaning is carried redundantly by shape (line vs polygon) and the mandatory tooltip/caveat
  text — never by hue alone. Track/cone/surge sub-kinds within the one `storm` layer are further
  disambiguated by geometry type (LineString vs Polygon) and label text, not by three separate colours.

### 5. Visual-baseline cost

`CURRENT-MASTER-PLAN.md:203-204` (§5.3): *"exactly TWO regenerations allowed (after MW-B STORM layer; after
MW-A only if the switcher shifts layout) — every other visual diff is a defect, not a regen."* This ADR's
layer addition is the MW-B trigger for the **first** of those two budgeted regenerations of
`e2e/visual.spec.ts` (`e2e/visual.spec.ts:13-21`, `toHaveScreenshot('cop.png', …)`, currently first-run/
baseline-minting per its own header comment `visual.spec.ts:5`). **One regeneration only** — any visual
diff on this file after that single recapture is a regression to fix, not grounds for another regen.

### 6. Interop — CAP mapping and honest limitation

- `Alert.category = 'Met'` for both storm-track and storm-surge alerts (no domain enum change, §2).
- `Alert.area` for a `TRACK`-shaped alert is a `LineString`; `geometryToCapArea()`
  (`src/adapters/interop/cap-mapper.ts:92-105`) already falls to its `default` branch for any type other
  than `Polygon`/`MultiPolygon`/`Point`, returning `{ areaDesc }` with **no** `<polygon>`/`<circle>`
  element and the existing inline comment `cap-mapper.ts:104` (`// LineString has no CAP area primitive —
  describe by text only`) — this is a genuine CAP v1.2 spec limitation (the standard has no line-geometry
  area primitive), not a BEACON gap. The `areaDesc` text must therefore carry the track's descriptive
  location (station/landfall-area name) since geometry alone cannot. `CONE`/`STORM_SURGE` (both polygon
  kinds) map through the existing `Polygon`/`MultiPolygon` branches unchanged.
- **Honest limitation (mandatory UI + docs wording, Art. XIV):** BEACON **renders authoritative cyclone
  products** (an agency's own track/cone/surge bulletins, ingested via an adapter under the existing
  hexagonal port pattern, ADR-001) — it does **not** run a cyclone track or wind/surge model itself. This
  is the same honesty boundary already drawn for `FIRE_CONE`/`FLOOD_INUNDATION`
  ("no physics-grade claims", AGENTS.md §14) but stronger: those are BEACON *first-order projections* from
  simple deterministic rules; `TRACK`/`CONE`/`STORM_SURGE` are **not projected by BEACON at all** — they are
  ingested, provenance-stamped (`sourceId`, mandatory per `makeHazardGeometry`,
  `src/domain/hazard-geometry.ts:37-39`), and displayed verbatim. The distinction must be stated explicitly
  in the layer caveat and in the consolidated "Known limitations" section
  (`CURRENT-MASTER-PLAN.md:223-226`).

## Verification

- **Domain invariants:** `src/domain/hazard-geometry.test.ts` — extend the existing `HAZARD_KINDS`
  parametrized invariant tests (kind-validation, geometry-type-validation) with `TRACK`/`CONE`/
  `STORM_SURGE` cases (LineString for TRACK, Polygon/MultiPolygon for CONE/STORM_SURGE), plus a `STORM`
  case added to `src/domain/incident.test.ts`'s `INCIDENT_TYPES` coverage.
- **Exhaustive-map compile safety:** no dedicated test needed beyond `tsc --noEmit` (Gate 2) — every
  `Record<LayerId, …>` in the §2 checklist is a TypeScript compile error until filled in; this is asserted
  structurally by the type system itself, not a unit test. Add one guard test that imports `LAYER_IDS` and
  asserts `Object.keys(LAYER_META).sort()` / `COLOR_BY_GROUP` / `LAYER_BUILDERS` cover it exactly (belt-and-
  suspenders against a future non-`Record`-typed refactor silently dropping the compile guarantee).
- **Layer toggle e2e:** extend `app/_components/map/build-layers.test.ts`-equivalent (or the file covering
  `buildFireLayers`/`buildFloodLayers`) with `buildStormLayers` unit tests (track-only, cone-only, surge-
  only, and combined inputs; default-off assertion against `defaultLayers()`).
  `e2e/golden-path.spec.ts` gets a Philippines-zone scenario that toggles the storm layer on and asserts
  the track/cone/surge descriptors render.
- **Legend a11y:** the existing axe pass over `Legend` (referenced generally in
  `CURRENT-MASTER-PLAN.md:221-222`, "axe run under `en` + `ar` + one CJK locale") is extended to assert the
  storm legend row has a non-empty text label (never colour-only) and the cone caveat is present in the
  accessible tree, not just visually.
- **Exposure test:** extend `src/application/risk-intersection/risk-intersection.test.ts` with a
  `STORM_SURGE`-kind hazard fixture proving it participates in `IN_POLYGON`/`IN_BUFFER` classification
  identically to `FLOOD_REACH`, and a `TRACK`/`CONE` fixture proving it is never passed into
  `computeExposures` from the composition-root query builder (a data-wiring assertion, not a
  `risk-intersection.ts` code assertion, since the function itself is kind-agnostic by design).

## Consequences

**Positive.** The Philippines zone's dominant hazard is represented honestly (rubric Cat 2/5); the domain/
geometry vocabulary needed no structural extension (`Geometry` union, `GEOMETRY_TYPES`) — only the two
closed enums (`INCIDENT_TYPES`, `HAZARD_KINDS`) and their exhaustive `Record<LayerId,…>` map consumers;
`risk-intersection.ts` needed zero code change because it was already kind-agnostic — a validation of the
ADR-001 hexagonal design paying off exactly as intended.

**Negative / accepted.** Six `Record<LayerId,…>`/config sites must be touched in lockstep (§2 table) — a
missed one is a `tsc` failure (caught by Gate 2, not silently shipped); the CAP-track LineString limitation
(§6) is a real, unfixable-by-BEACON CAP v1.2 spec gap, accepted and documented rather than worked around
with a non-standard extension.

## Alternatives considered

- **Reuse `SPREAD_CONE` for the cyclone forecast cone** — rejected: conflates a BEACON first-order wildfire
  projection (`projectFireCone`, deterministically computed, `uncertainty` from `FireConeConfig`) with an
  ingested authoritative agency product (no BEACON-computed uncertainty model); would corrupt the "renders,
  does not model" honesty boundary (§6) and make the wildfire cone's `PREDICTION_KINDS` semantics ambiguous.
- **Fold `TRACK`/`CONE`/`STORM_SURGE` into `Prediction` instead of `HazardGeometry`** — rejected: a
  `Prediction` (`src/domain/prediction.ts:11-21`) requires `method`+`inputs`+`uncertainty` as a *BEACON-
  computed* first-order label (Art. XII framing, `prediction.ts:1-2` comment); an ingested agency track/cone
  has no BEACON method to label — it is observed/forecast *hazard geometry* from the source, which is
  exactly what `HazardGeometry` already models (`sourceId` mandatory, no method/uncertainty fields).
- **Include `TRACK`/`CONE` in exposure computation with a reduced weight** — rejected (§3): any numeric
  weighting of a positional-uncertainty envelope as an impact signal is itself an invented figure, not a
  configuration nuance; the binary in/out decision keeps the deterministic pipeline honest.
- **Three separate layer ids (`storm-track`, `storm-cone`, `storm-surge`)** — considered, not chosen for v1:
  would let a user show surge without the cone, but triples the `Record<LayerId,…>` surface (§2) for a
  distinction the caveat text + geometry-type-based rendering already communicates. Left as a documented
  extension point if UX testing later shows a need to decouple them (add-by-config discipline, ADR-011
  precedent).

## Implementation status

Not started — this ADR is the S02 architecture record for wave MW-B (`CURRENT-MASTER-PLAN.md:143-147`);
implementation happens at S04/S05+ under the golden-thread requirement→spec→test→code discipline.

**Update (wave MW-B/B2, 2026-07-27) — implemented as decided, with three deltas worth recording:**

- **B2.1–B2.4 done.** Domain enums + both CHECK constraints (Drizzle schema, reference DDL, and a new
  additive migration `drizzle/0003_storm_hazard_family.sql` — `0000_init.sql` was not rewritten); all six
  exhaustive `Record<LayerId,…>` sites (§2 table) filled; `storm` layer default OFF with legend label +
  caveat and a colour-blind-safe hue; CAP category/event mapping. `risk-intersection.ts` was **not**
  changed, exactly as §2/F-18 predicted.
- **Delta 1 — the exposure filter is compile-enforced, not conventional.** §3 describes the surge-in /
  track-and-cone-out decision as pure data wiring. It is now expressed as
  `EXPOSURE_BEARING_BY_KIND: Record<HazardKind, boolean>` + `exposureBearingHazards()`
  (`src/domain/hazard-geometry.ts`), applied at BOTH exposure query builders
  (`src/application/derivation/derive-cop.ts` — `exposureQueryOf` and `incidentExposureQuery`, which is
  where the array is actually assembled, not `src/main/`). A future `HazardKind` therefore fails Gate 2
  until its exposure semantics are declared, rather than being silently included.
- **Delta 2 — the wire carries a derived `storm` slice.** §2 is right that `projectHazard` needs no case,
  and the full hazard array still passes through verbatim. But the cone's mandatory uncertainty label
  (FEV-5) needs the ISSUER and the ADVISORY INSTANT, so `projectMap` additionally derives
  `ProjectedStorm { track?, cone?, surge?, agency?, advisoryAt? }` from the TRACK/CONE/STORM_SURGE hazards.
  It carries no `method`/`uncertainty` field by design — BEACON computes neither (§6).
- **Delta 3 — the CAP LineString gap is now assertable.** §6's behaviour is preserved byte-for-byte; the
  limitation is additionally exposed as `capAreaIsTextOnly(geometry)` so the "areaDesc must carry the
  track's descriptive location" obligation is checked by a test rather than only stated in a comment.
- **Not done here:** the consolidated "Known limitations" entry (§6, last bullet) — `docs/SPEC.md` was
  outside this wave's writable scope. Carried to the MW-E docs-truth lens.
- **Still outstanding:** the budgeted visual-baseline regeneration (§5) and the Philippines-zone
  `e2e/golden-path.spec.ts` scenario — both Playwright, both handled centrally (B2.5).
