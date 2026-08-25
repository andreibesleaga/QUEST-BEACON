// BEACON — the ZONAL-SUM ENGINE (MW-D/D1; ADR-035 §1). ONE implementation, used by BOTH predicted-affected
// people (ADR-035 §1(a) — geometry = a `Prediction.geom`) and hazard-clipped current population
// (§1(c)/FR-PAP-3 — geometry = the current `HazardGeometry`). That "same function, different input geometry"
// is the whole point of finding F-23: the two figures must not be allowed to drift apart.
//
// PURE. No clock, no I/O, no randomness, no adapter import. Iteration order is the caller's cell order and
// accumulation is a single fixed-order pass, so identical inputs give a bit-identical result (ADR-035 §2,
// acceptance test 5). Coordinates are never rounded (F-98).
//
// AGGREGATE-ONLY (Art. XIV). The engine's only population input is `PopulationCell` = an area plus a COUNT.
// There is no identifier, no household, no point location and no `PublicReport` anywhere in this module's
// signatures — the figures it produces are tallies by construction, not summaries of records.
import type { BBox, Geometry } from '@/domain/value-objects/geo.js';
import type { Result } from '@/domain/shared/result.js';
import { ok, err, isErr } from '@/domain/shared/result.js';
import { DomainError } from '@/domain/errors.js';
import { boundsOf } from '@/application/shared/map-geometry.js';
import { clipAreasToRect, hasArealGeometry, rectAreaDeg2 } from './clip.js';

/**
 * One aggregate population cell: an axis-aligned area and the number of residents modelled inside it.
 *
 * A single served `PopulationEstimate` (`src/ports/infrastructure-sources.ts`) IS a one-cell grid — which is
 * why the engine takes cells rather than a grid type. That keeps the served-bbox rung and the shipped-grid
 * rung on the SAME arithmetic instead of two code paths that could disagree.
 */
export interface PopulationCell {
  readonly bbox: BBox;
  /** Modelled residents inside `bbox`. Non-negative; an aggregate count, never a person record. */
  readonly count: number;
}

/** What a zonal sum produced, before any presentation/suppression policy is applied. */
export interface ZonalSum {
  /** Area-weighted population inside the geometry — unrounded, so the caller owns the rounding policy. */
  readonly weighted: number;
  /** The total of every cell consulted, clipped or not — the denominator behind `coveredFraction`. */
  readonly cellTotal: number;
  /** How many cells contributed a positive weight (0 ⇒ the geometry missed the population data entirely). */
  readonly cellsContributing: number;
  /** How many cells were consulted at all (their bbox overlapped the geometry's bounds). */
  readonly cellsConsidered: number;
  /** `weighted / cellTotal`, clamped — the share of the consulted population the geometry covers. */
  readonly coveredFraction: number;
}

const EMPTY_SUM: ZonalSum = {
  weighted: 0,
  cellTotal: 0,
  cellsContributing: 0,
  cellsConsidered: 0,
  coveredFraction: 0,
};

/** Whether two axis-aligned boxes overlap with positive area (the cheap reject before any clipping). */
function boxesOverlap(a: BBox, b: BBox): boolean {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

/**
 * The bounds enclosing every supplied geometry — the cell pre-filter (`boundsOf`, map-geometry.ts).
 *
 * A geometry whose bounds are NOT finite (non-finite vertices, or no coordinates at all) is a TYPED ERROR
 * rather than a silent skip. Silently dropping it would shrink the extent — and therefore the number of
 * people counted at risk — on the strength of corrupt input, which is the one failure mode a who-is-at-risk
 * figure must never have. `clipPolygonToRect` rejects the same input for the same reason.
 */
function unionBounds(geoms: readonly Geometry[]): Result<BBox | null, DomainError> {
  let out: BBox | null = null;
  for (const [i, g] of geoms.entries()) {
    const b = boundsOf(g);
    if (b.some((n) => !Number.isFinite(n))) {
      return err(new DomainError('INVARIANT_VIOLATION', `zonalSum: geometry[${i}] has non-finite bounds [${b.join(',')}]`));
    }
    out =
      out === null
        ? b
        : [Math.min(out[0], b[0]), Math.min(out[1], b[1]), Math.max(out[2], b[2]), Math.max(out[3], b[3])];
  }
  return ok(out); // null ⇒ nothing areal was supplied; the caller degrades to the empty sum
}

/**
 * Area-weighted zonal sum of `cells` over `geoms`.
 *
 * For every cell whose bbox meets the geometries' bounds, the geometries are clipped TO THE CELL and the
 * cell's count is multiplied by the resulting area fraction (`clipAreasToRect`). A cell straddling the
 * boundary therefore contributes proportionally rather than all-or-nothing — the single largest source of
 * error in a naive "cell centre inside?" test, and the reason ADR-035's uncertainty band leads with grid
 * resolution.
 *
 * THE ASSUMPTION, STATED: area weighting assumes population is distributed UNIFORMLY WITHIN a cell. It is
 * not. This is why a figure from a coarse cell (a whole-region bbox) must be labelled differently from a
 * figure from a fine grid — the arithmetic is identical, the meaning is not, and `affected-population.ts`
 * carries that distinction in the rung label rather than hiding it here.
 *
 * A geometry with no area (a hotspot `Point`, a `LineString`) cannot bound a population; it is skipped, and
 * when NO supplied geometry is areal the sum is empty (`cellsConsidered: 0`) so the caller can degrade
 * honestly instead of reporting a confident zero.
 */
export function zonalSum(cells: readonly PopulationCell[], geoms: readonly Geometry[]): Result<ZonalSum, DomainError> {
  const areal = geoms.filter(hasArealGeometry);
  if (cells.length === 0) return ok(EMPTY_SUM);
  const boundsRes = unionBounds(areal);
  if (isErr(boundsRes)) return boundsRes;
  const bounds = boundsRes.value;
  if (bounds === null) return ok(EMPTY_SUM);
  const acc = { weighted: 0, cellTotal: 0, cellsContributing: 0, cellsConsidered: 0 };
  for (const cell of cells) {
    if (!usableCell(cell, bounds)) continue;
    acc.cellsConsidered += 1;
    acc.cellTotal += cell.count;
    const overlap = clipAreasToRect(areal, cell.bbox);
    if (isErr(overlap)) return overlap;
    if (overlap.value.fraction <= 0) continue;
    acc.cellsContributing += 1;
    acc.weighted += cell.count * overlap.value.fraction;
  }
  const coveredFraction = acc.cellTotal > 0 ? Math.min(1, acc.weighted / acc.cellTotal) : 0;
  return ok({ ...acc, coveredFraction });
}

/** A cell worth clipping: a real non-negative count, a positive area, and a bbox meeting the extent bounds. */
function usableCell(cell: PopulationCell, bounds: BBox): boolean {
  if (!Number.isFinite(cell.count) || cell.count < 0) return false;
  return rectAreaDeg2(cell.bbox) > 0 && boxesOverlap(cell.bbox, bounds);
}
