// BEACON — pre-positioning-from-predictions use-case (E5·W2d; PRD flagship-4 logistics claim: "logistics
// decision-support" was missing pre-positioning). Deterministic: given the projected hazard extent (the
// prediction-projection OUTPUT — a `Prediction.geom`, e.g. the fire-cone polygon or the NWPS∩NFHL flood
// polygon) and the resource/shelter registry, rank AVAILABLE resources and OPEN-with-spare-capacity
// shelters that sit NEAR — but NOT inside — the projected extent as pre-positioning SUGGESTIONS.
//
// Art. XII: every ranking/distance/number here is deterministic typed code — never the LLM. Art. XIII: this
// module NEVER tasks a resource, moves a shelter, or takes any public/committing action — it only ranks
// candidates for a human to act on ("engine suggests, human decides"). Art. XVI: no projected extent (no
// prediction yet) ⇒ an empty, honestly-labeled result — never a dead-end. Imports PORTS + DOMAIN + the
// existing shared geo helpers only (§4 boundary; no adapters/framework).
import type { SpatialPort } from '@/ports/index.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { Geometry, Position } from '@/domain/value-objects/geo.js';
import type { Resource, ResourceKind } from '@/domain/resource.js';
import type { Shelter } from '@/domain/shelter.js';
import { ok, isErr } from '@/domain/shared/result.js';
import { haversineMeters, polygonsOf } from '@/application/shared/geo.js';
// FR-D6-1/2 aggregate field SHAPES are IMPORTED, never re-declared here (ADR-035 §4; the F-24/F-140/F-141
// "derive, don't retype" lesson). Every D6 field this module carries is typed by indexed access into these
// interfaces, so a change there is a compile-time event here rather than a silent divergence. This module is
// in `src/application`, so it may import both the domain entity and these application-layer field modules —
// which is precisely why the carry-through lives here and not on the domain `Resource`.
import type { VolunteerTeamFields } from '@/application/aggregate/volunteer-team.js';
import type { SupplyFields } from '@/application/aggregate/supplies.js';

/**
 * The honest method label attached to every result (Art. XII — a ranking is never presented unlabeled).
 * Distance is a SAMPLED-EDGE haversine approximation (the extent boundary is subdivided into short chords
 * and the nearest sample is taken) — not exact polygon-edge distance, but bounded and reproducible; stated
 * plainly rather than implying physics-grade precision.
 */
export const PRE_POSITIONING_METHOD =
  'first-order ranking: haversine distance from each asset to the nearest sampled point on the projected-' +
  'extent boundary; assets already inside the extent are excluded (already in the hazard footprint, not a ' +
  '"near" pre-positioning target)';

// V2·A9 made "caller/config may override" true in the running app rather than only in the type: these two
// are now the DEFAULTS behind `PREPOSITION_RADIUS_KM` / `PREPOSITION_TOP_N` (CONFIGURATION.md §12), resolved
// at the HTTP composition root and passed in on the input below. Nothing changed here — this module stays
// pure and injected — but the numbers are no longer unreachable, so keep them in step with the doc.
const DEFAULT_NEAR_RADIUS_M = 20_000; // 20km — labeled default; caller/config may override
const DEFAULT_MAX_PER_CATEGORY = 5; // keeps the board scannable; never silently drops data the caller widened for
const EDGE_SAMPLE_STEPS = 16; // boundary-chord subdivisions per edge — bounds the approximation error

/**
 * A `Resource` as the ranker sees it: the domain entity, OPTIONALLY carrying the FR-D6-1/FR-D6-2 aggregate
 * fields for its kind. Widening, not replacing — a plain `Resource` is still assignable, so every existing
 * caller (`handlePrePositioning`, `anticipatory-engine`) compiles and behaves identically.
 *
 * WHY THE FIELDS RIDE HERE RATHER THAN ON `Resource`: `.dependency-cruiser.cjs`'s `domain-is-pure` rule
 * forbids `src/domain` → `src/application`, and the FR-D6-1/2 field modules live in `src/application/aggregate`
 * (they must, because their guard type `AggregateOnly<>` is what keeps a person's name out of them). So the
 * domain entity carries the KIND and this application-layer view carries the kind's aggregate fields. The
 * shapes are taken by `Omit<…, 'kind'>` from the real interfaces — there is no second declaration to drift.
 */
export type RankableResource = Resource &
  Partial<Omit<VolunteerTeamFields, 'kind'>> &
  Partial<Omit<SupplyFields, 'kind'>>;

export interface PrePositioningCandidates {
  readonly resources: readonly RankableResource[];
  readonly shelters: readonly Shelter[];
}

export interface PrePositioningInput {
  readonly candidates: PrePositioningCandidates;
  /** The projected hazard extent (prediction-projection output). Absent ⇒ no suggestions (labeled, not faked). */
  readonly extent?: Geometry;
  /** Only candidates within this many metres of the extent are surfaced. Default 20km. */
  readonly nearRadiusMeters?: number;
  /** Cap on suggestions per category (RESOURCE / SHELTER) so the board stays scannable. Default 5. */
  readonly maxPerCategory?: number;
}

export type PrePositioningKind = 'RESOURCE' | 'SHELTER';

export interface PrePositioningSuggestion {
  readonly kind: PrePositioningKind;
  readonly refId: string;
  readonly distanceMeters: number;
  /** RESOURCE only. The DOMAIN union, not `string`: a widened re-declaration of a closed vocabulary is the
   *  same defect as a retyped one — it lets a token the domain rejects travel as if it were valid. */
  readonly resourceKind?: ResourceKind;
  // ── FR-D6-2 SUPPLY stock, carried so a pre-positioning decision can be made on more than distance. ──
  // HONEST SCOPE (ADR-035 §4, restated at the code): these figures are CARRIED, not MATCHED. There is no
  // generic capacity-vs-demand matcher in this codebase and this module does not add one — matching today is
  // this distance ranking plus the shelter arithmetic below. A human reads the stock figure and decides.
  readonly quantity?: SupplyFields['quantity'];
  readonly unit?: SupplyFields['unit'];
  // ── FR-D6-1 volunteer TEAM strength/duty state. An aggregate tally, never a roster (Art. XIV). ──
  readonly headcount?: VolunteerTeamFields['headcount'];
  readonly availability?: VolunteerTeamFields['availability'];
  readonly capacity?: number; // SHELTER only
  /** SHELTER only — CURRENT occupancy. NOT a projected future demand: no demand-projection source exists in
   *  the current logistics model (checked; only `Shelter.occupancy` — Art. XVI honest-limitation labeling). */
  readonly occupancy?: number;
}

export interface PrePositioningResult {
  readonly method: string;
  /** False when no projected extent was supplied — the empty `suggestions` is a labeled "not yet", not a bug. */
  readonly extentAvailable: boolean;
  readonly suggestions: readonly PrePositioningSuggestion[];
}

interface RankedCandidate<T> {
  readonly item: T;
  readonly distanceMeters: number;
}

/** Linearly-interpolated sample points along one boundary edge (endpoints inclusive). */
function edgeSamples(a: Position, b: Position, steps: number): readonly Position[] {
  const samples: Position[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    samples.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return samples;
}

/**
 * Nearest-boundary-sample haversine distance from a point to any ring of any polygon making up the extent.
 * Each edge is subdivided (EDGE_SAMPLE_STEPS chords) so long edges (typical of hazard/flood polygons) still
 * yield a reasonable "near the extent" distance — a plain vertex-only distance would badly overstate distance
 * to a point abeam a long edge's midpoint.
 */
function minDistanceToExtentM(point: Position, extent: Geometry): number {
  let best = Infinity;
  for (const poly of polygonsOf(extent)) {
    for (const ring of poly.coordinates) {
      for (let i = 0; i < ring.length - 1; i++) {
        for (const sample of edgeSamples(ring[i]!, ring[i + 1]!, EDGE_SAMPLE_STEPS)) {
          const d = haversineMeters(point, sample);
          if (d < best) best = d;
        }
      }
    }
  }
  return best;
}

/** True when the point falls inside any polygon ring of the extent (SpatialPort — Art. XII). */
function isInsideExtent(
  point: Position,
  extent: Geometry,
  spatial: SpatialPort,
): Result<boolean, DomainError> {
  for (const poly of polygonsOf(extent)) {
    const hit = spatial.pointInPolygon(point, poly);
    if (isErr(hit)) return hit;
    if (hit.value) return ok(true);
  }
  return ok(false);
}

/** Filter + distance-rank one candidate pool against the extent; inside-extent and out-of-radius are dropped. */
function rankByExtent<T>(
  items: readonly T[],
  positionOf: (item: T) => Position | undefined,
  extent: Geometry,
  spatial: SpatialPort,
  radiusM: number,
): Result<readonly RankedCandidate<T>[], DomainError> {
  const ranked: RankedCandidate<T>[] = [];
  for (const item of items) {
    const point = positionOf(item);
    if (point === undefined) continue; // no known location — cannot rank; not faked (Art. XVI-adjacent honesty)
    const inside = isInsideExtent(point, extent, spatial);
    if (isErr(inside)) return inside;
    if (inside.value) continue; // already in the hazard footprint — not a pre-positioning target
    const distanceMeters = minDistanceToExtentM(point, extent);
    if (distanceMeters > radiusM) continue;
    ranked.push({ item, distanceMeters });
  }
  return ok([...ranked].sort((a, b) => a.distanceMeters - b.distanceMeters));
}

const resourcePosition = (r: RankableResource): Position | undefined => r.geom?.coordinates;
const shelterPosition = (s: Shelter): Position => s.geom.coordinates;

/**
 * AVAILABLE only — a resource already committed (ASSIGNED/OOS) is not a pre-positioning candidate.
 *
 * NOTE (verified, not assumed): there is NO kind filter here and never was, so every `ResourceKind` —
 * including FR-D6-2 `SUPPLY` and the new FR-D6-1 `TEAM` — is ranked by `rankByExtent` by construction.
 * Adding a kind filter to "support" a kind would be the bug, not the feature; what was actually missing is
 * the aggregate FIELDS below, which had nowhere to travel. Pinned by the kind-coverage test.
 */
const eligibleResources = (resources: readonly RankableResource[]): readonly RankableResource[] =>
  resources.filter((r) => r.status === 'AVAILABLE');

/** OPEN with spare capacity only (mirrors the memory-logistics `rankShelters` eligibility, SPEC §5.5). */
const eligibleShelters = (shelters: readonly Shelter[]): readonly Shelter[] =>
  shelters.filter((s) => s.status === 'OPEN' && s.capacity - s.occupancy > 0);

/**
 * The D6 aggregate fields to surface for ONE candidate, gated on the DOMAIN kind — a supply figure can never
 * be attached to an engine, and a headcount can never be attached to a supply lot, because the discriminator
 * is the entity's own `kind` rather than which optional fields happen to be populated. Absent fields stay
 * absent (`exactOptionalPropertyTypes`): a resource with no known stock reports no stock, never a `0` that
 * would read as "none left" (Art. XVI — degrade honestly, never fabricate a figure).
 */
function d6FieldsOf(r: RankableResource): Partial<PrePositioningSuggestion> {
  if (r.kind === 'SUPPLY') {
    return {
      ...(r.quantity !== undefined ? { quantity: r.quantity } : {}),
      ...(r.unit !== undefined ? { unit: r.unit } : {}),
    };
  }
  if (r.kind === 'TEAM') {
    return {
      ...(r.headcount !== undefined ? { headcount: r.headcount } : {}),
      ...(r.availability !== undefined ? { availability: r.availability } : {}),
    };
  }
  return {};
}

function toResourceSuggestion(c: RankedCandidate<RankableResource>): PrePositioningSuggestion {
  return {
    kind: 'RESOURCE',
    refId: String(c.item.id),
    distanceMeters: Math.round(c.distanceMeters),
    resourceKind: c.item.kind,
    ...d6FieldsOf(c.item),
  };
}

function toShelterSuggestion(c: RankedCandidate<Shelter>): PrePositioningSuggestion {
  return {
    kind: 'SHELTER',
    refId: String(c.item.id),
    distanceMeters: Math.round(c.distanceMeters),
    capacity: c.item.capacity,
    occupancy: c.item.occupancy,
  };
}

/**
 * Rank resources + shelters near (not inside) the projected hazard extent as advisory pre-positioning
 * suggestions (SPEC flagship-4 logistics; Art. XII/XIII — deterministic, advisory-only). Each category is
 * independently distance-ranked and capped at `maxPerCategory`. No extent ⇒ `extentAvailable:false` and an
 * empty list (never a dead-end, Art. XVI). A SpatialPort failure short-circuits to Err (never a partial/
 * guessed result, mirroring `computeExposures`/`projectFloodInundation`).
 */
export function suggestPrePositioning(
  input: PrePositioningInput,
  spatial: SpatialPort,
): Result<PrePositioningResult, DomainError> {
  const { extent } = input;
  if (extent === undefined) {
    return ok({ method: PRE_POSITIONING_METHOD, extentAvailable: false, suggestions: [] });
  }
  const radiusM = input.nearRadiusMeters ?? DEFAULT_NEAR_RADIUS_M;
  const maxPer = input.maxPerCategory ?? DEFAULT_MAX_PER_CATEGORY;

  const resources = rankByExtent(
    eligibleResources(input.candidates.resources),
    resourcePosition,
    extent,
    spatial,
    radiusM,
  );
  if (isErr(resources)) return resources;
  const shelters = rankByExtent(
    eligibleShelters(input.candidates.shelters),
    shelterPosition,
    extent,
    spatial,
    radiusM,
  );
  if (isErr(shelters)) return shelters;

  const suggestions: readonly PrePositioningSuggestion[] = [
    ...resources.value.slice(0, maxPer).map(toResourceSuggestion),
    ...shelters.value.slice(0, maxPer).map(toShelterSuggestion),
  ];
  return ok({ method: PRE_POSITIONING_METHOD, extentAvailable: true, suggestions });
}
