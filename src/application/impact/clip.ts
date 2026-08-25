// BEACON — the polygon∩rectangle CLIPPING PRIMITIVE the predicted-impact quantifications are built on
// (MW-D/D1.0; ADR-035 §1 "the zonal-sum engine both (a) and (c) use"; findings F-23/F-26).
//
// WHY THIS FILE EXISTS. F-26 verified that BEACON had no clipping primitive at all: `SpatialPort.intersect`
// returns a BOOLEAN (`src/ports/infra.ts:52`), the PostGIS implementation is a documented stub
// (`src/adapters/spatial/postgis-spatial.ts`), and the only geometry-returning clip in the repo is
// `clipRingToRect` (`src/application/shared/map-geometry.ts:95`) — a single-ring Sutherland–Hodgman pass.
// A polygon-precise population count needs an AREA of intersection, not a predicate, so the area primitive
// is built HERE, in pure application-layer typed code, exactly like the geometry helpers it composes
// (Art. XII allows "Turf.js / SQL / typed code"; the LLM never computes any of this).
//
// WHY NOT A `SpatialPort` EXTENSION (ADR-035 "Alternatives considered", 4th bullet). Adding `clip`/`area` to
// the port would have to be implemented TWICE — once in Turf and once in a PostGIS adapter that is a stub —
// for a precision gain that grid-cell resolution dominates anyway. The port stays untouched; this module is
// deterministic arithmetic over the domain value objects, with no I/O, no clock and no adapter import.
//
// WHY SUTHERLAND–HODGMAN IS SOUND HERE, AND WHERE IT WOULD NOT BE. `clipRingToRect` clips the SUBJECT ring
// against the four half-planes of the rectangle. S–H is exact for a CONVEX CLIP WINDOW, and a rectangle is
// convex — including in the two cases that look like they should break it and do not (both are pinned by
// tests): the rectangle lying strictly INSIDE the polygon (clipping the polygon against the four half-planes
// yields the rectangle itself), and a CONCAVE subject whose intersection is several disjoint pieces (S–H
// emits one ring with connecting edges that run along the clip boundary in both directions, so their net
// contribution to the shoelace sum is zero and the AREA is still exact). What S–H does NOT give is a usable
// ring topology for those concave cases — which is why this module returns AREAS and never hands the clipped
// ring back to a caller.
//
// ⚠ F-98 IS BINDING HERE. Nothing in this module rounds a coordinate. A rounded vertex can flip a polygon
// intersection and silently change who is counted at-risk, so `roundPosition`/`roundRings` are deliberately
// NOT imported: every clip runs on the vertices exactly as the source published them.
//
// UNITS. Areas are in square DEGREES (unprojected WGS-84). That is sound for the only thing they are used
// for — a RATIO of two areas over the same small rectangle, where the cos(latitude) scale factor cancels.
// A square-degree number is never reported as an area to a reader; `areaDeg2` exists to be divided.
import type { BBox, Geometry, PolygonGeometry, Position } from '@/domain/value-objects/geo.js';
import type { Result } from '@/domain/shared/result.js';
import { ok, err, isErr } from '@/domain/shared/result.js';
import { DomainError } from '@/domain/errors.js';
import { clipRingToRect, ringArea, boundsOf } from '@/application/shared/map-geometry.js';

/**
 * How a rectangle relates to a clipping geometry, judged BY AREA — which is the only thing the zonal sum
 * can act on. A polygon that merely touches the rectangle along a shared edge or at a corner has a
 * zero-area intersection and is therefore `DISJOINT` here: it contributes no population, which is the
 * honest answer (a boundary line contains no residents).
 */
export const RECT_OVERLAP_RELATIONS = ['DISJOINT', 'PARTIAL', 'COVERED'] as const;
export type RectOverlapRelation = (typeof RECT_OVERLAP_RELATIONS)[number];

/** The clip primitive's output: the overlap area, the fraction of the rectangle it covers, and which case. */
export interface RectOverlap {
  /** Intersection area in square degrees (unprojected). Exists to be divided, never to be displayed. */
  readonly areaDeg2: number;
  /** `areaDeg2 / rectangleArea`, clamped to [0,1] — the area weight a cell's count is multiplied by. */
  readonly fraction: number;
  readonly relation: RectOverlapRelation;
}

const ZERO_OVERLAP: RectOverlap = { areaDeg2: 0, fraction: 0, relation: 'DISJOINT' };

/** Area of an axis-aligned box in square degrees. Zero for a degenerate (zero-width or zero-height) box. */
export function rectAreaDeg2(rect: BBox): number {
  const [minX, minY, maxX, maxY] = rect;
  return Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
}

/** Whether two axis-aligned boxes overlap with POSITIVE area (touching boxes share no area). */
function boxesOverlap(a: BBox, b: BBox): boolean {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

/**
 * The area (deg²) of ONE ring's intersection with the rectangle. An empty clip means the ring and the
 * rectangle share no area at all — a polygon that contains the rectangle clips to the rectangle rather than
 * to nothing (see the file header), so "empty ⇒ zero" is exact and not an approximation.
 */
function ringOverlapArea(ring: readonly Position[], rect: BBox): number {
  return ringArea(clipRingToRect(ring, rect));
}

/** Every coordinate finite, and enough vertices to bound an area — otherwise the clip would yield NaN. */
function ringProblem(ring: readonly Position[], at: string): string | null {
  if (ring.length < 3) return `${at} must have at least 3 positions, got ${ring.length}`;
  for (const p of ring) {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
      return `${at} contains a non-finite coordinate [${String(p[0])},${String(p[1])}]`;
    }
  }
  return null;
}

function rectProblem(rect: BBox): string | null {
  if (rect.some((n) => !Number.isFinite(n))) return `rectangle contains a non-finite bound [${rect.join(',')}]`;
  if (rect[0] > rect[2] || rect[1] > rect[3]) return `rectangle bounds are inverted [${rect.join(',')}]`;
  return null;
}

/**
 * Classify by area, and keep `fraction` inside [0,1] so a float residue can never over-weight a cell.
 *
 * PRECONDITION: a positive `areaDeg2` implies a positive `rectArea` — a zero-area rectangle cannot intersect
 * anything, and both callers return `ZERO_OVERLAP` before reaching here in that case. The division is
 * therefore safe without a guard, and there is deliberately no unreachable `rectArea > 0 ? … : 0` branch
 * pretending otherwise.
 */
function overlapOf(areaDeg2: number, rectArea: number): RectOverlap {
  if (areaDeg2 <= 0) return ZERO_OVERLAP;
  const raw = areaDeg2 / rectArea;
  const fraction = raw >= 1 ? 1 : raw;
  return { areaDeg2, fraction, relation: fraction >= 1 ? 'COVERED' : 'PARTIAL' };
}

/**
 * Clip ONE polygon (outer ring minus holes) against an axis-aligned rectangle and report the overlap.
 *
 * Holes subtract: `area(outer ∩ rect) − Σ area(hole ∩ rect)`, each ring measured by `ringOverlapArea`, so a
 * hole that swallows the rectangle removes it entirely and a hole crossing the rectangle removes exactly its
 * share. The result is clamped at zero — a valid polygon can never have negative overlap, and clamping means
 * a malformed ring order degrades to "no population here" instead of subtracting people from a neighbour.
 *
 * Returns a typed error (never `NaN`) for a degenerate ring or an inverted/non-finite rectangle: ADR-035 V2
 * requires that a bad geometry is loud, because a NaN would propagate into a headline figure.
 */
export function clipPolygonToRect(polygon: PolygonGeometry, rect: BBox): Result<RectOverlap, DomainError> {
  const bad = rectProblem(rect);
  if (bad !== null) return err(new DomainError('INVARIANT_VIOLATION', `clipPolygonToRect: ${bad}`));
  const rings = polygon.coordinates;
  const outer = rings[0];
  if (outer === undefined) return err(new DomainError('INVARIANT_VIOLATION', 'clipPolygonToRect: polygon has no rings'));
  for (const [i, ring] of rings.entries()) {
    const problem = ringProblem(ring, `clipPolygonToRect: ring[${i}]`);
    if (problem !== null) return err(new DomainError('INVARIANT_VIOLATION', problem));
  }
  const rectArea = rectAreaDeg2(rect);
  if (rectArea <= 0 || !boxesOverlap(boundsOf(polygon), rect)) return ok(ZERO_OVERLAP);
  let area = ringOverlapArea(outer, rect);
  for (const hole of rings.slice(1)) area -= ringOverlapArea(hole, rect);
  return ok(overlapOf(Math.max(0, area), rectArea));
}

/**
 * Clip an AREAL geometry (`Polygon` or `MultiPolygon`) against a rectangle. MultiPolygon parts are disjoint
 * by the GeoJSON contract (RFC 7946 §3.1.7), so their overlaps ADD; the sum is re-clamped through
 * `overlapOf`, which means even a source that ships overlapping parts cannot push a cell above 100 %.
 *
 * A `Point`/`LineString` has no area and yields `DISJOINT` with a zero fraction — an honest "this geometry
 * cannot bound a population", not an error, because hazard slices legitimately carry hotspot points and a
 * zonal sum simply has nothing to weight with. Callers that need to distinguish "no people" from "not an
 * areal hazard" test the geometry type themselves; `hasArealGeometry` below is that test.
 */
export function clipAreaToRect(geom: Geometry, rect: BBox): Result<RectOverlap, DomainError> {
  if (geom.type === 'Polygon') return clipPolygonToRect(geom, rect);
  if (geom.type !== 'MultiPolygon') return ok(ZERO_OVERLAP);
  const rectArea = rectAreaDeg2(rect);
  let area = 0;
  for (const coordinates of geom.coordinates) {
    const part = clipPolygonToRect({ type: 'Polygon', coordinates }, rect);
    if (isErr(part)) return part;
    area += part.value.areaDeg2;
  }
  return ok(overlapOf(area, rectArea));
}

/** Whether a geometry can bound an area at all (the precondition for any zonal sum). */
export function hasArealGeometry(geom: Geometry): boolean {
  return geom.type === 'Polygon' || geom.type === 'MultiPolygon';
}

/**
 * The union-safe overlap of a rectangle against SEVERAL geometries (e.g. all of an incident's hazard
 * footprints, or every predicted extent).
 *
 * Overlaps are combined by MAXIMUM, not by sum. That is deliberate and it is the conservative direction:
 * two hazard footprints that overlap each other would double-count the residents in the overlap if the
 * fractions were added, and BEACON has no polygon-union primitive to compute the true union with. The
 * maximum is a documented LOWER BOUND on the union's coverage, which is the error direction that cannot
 * invent people (Art. XII). It is exact whenever the geometries are disjoint or nested.
 */
export function clipAreasToRect(
  geoms: readonly Geometry[],
  rect: BBox,
): Result<RectOverlap, DomainError> {
  let best: RectOverlap = ZERO_OVERLAP;
  for (const geom of geoms) {
    const res = clipAreaToRect(geom, rect);
    if (isErr(res)) return res;
    if (res.value.fraction > best.fraction) best = res.value;
  }
  return ok(best);
}
