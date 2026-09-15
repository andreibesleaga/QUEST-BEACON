// BEACON — a recording from elsewhere is not a fact about this region.
//
// WHAT WENT WRONG (live, 2026-09-13; the owner's words: "the points are in other countries"). The
// OpenCelliD and Overpass fixtures were recorded around Butte County, and both adapters declare GLOBAL
// coverage — so the ladder's coverage gate let every region's request through, and when the live rung
// degraded (a 400 from OpenCelliD; Overpass configured cached) the recorded answer was served to Romania,
// Spain, Greece and the Philippines as if it were theirs. EFFIS's cached burnt-area fixture spans Greece
// AND Romania and was served whole to both. A live 511 feed pointed at Georgia put Atlanta's cameras on
// California. Four sources, one shape: the request was scoped to a region and the answer was not.
//
// The coverage gate answers "could this source know about this region?". It cannot answer "is this
// particular record about it?". This module answers that, and it is deliberately narrow: it reads only
// the fields the domain uses to PLACE an entity — a GeoJSON `geometry`/`geom`, a `position`, a
// `bbox`/`area` — so a pair of numbers that happens to be a range is never mistaken for a coordinate, and
// an entity with no location at all (a weather reading, a population figure, a news item) is never judged.
//
// "Touches" is the test, not "inside": a perimeter that crosses the border, or a polygon that ENCLOSES the
// whole region, is about the region. Both reduce to "the entity's own bounds intersect the region's".
import type { BBox, Geometry, Position } from '@/domain/value-objects/geo.js';
import { isPosition } from '@/domain/value-objects/geo.js';

/**
 * What an entity is judged against. `bbox` is the fetch window; `boundary` (Polygon/MultiPolygon) is the
 * region's actual outline. With a boundary, a record is about the region when one of its positions lies
 * inside the outline (or it encloses the whole bbox); without one, when its bounds intersect the bbox —
 * which, for a country, attributes the neighbours inside the rectangle to it (2026-09-14: hotspots in
 * Serbia founded a "Romanian" incident).
 */
export interface RegionShape {
  readonly bbox: BBox;
  readonly boundary?: Geometry;
}

export interface Clipped<T> {
  /** Every entity without a location, plus every located entity that touches the region. */
  readonly kept: readonly T[];
  /** How many entities carried a location at all — zero means nothing here could be judged. */
  readonly spatial: number;
}

const GEOMETRY_FIELDS = ['geometry', 'geom'] as const;
const BOX_FIELDS = ['bbox', 'area'] as const;

/** Keep what is about the region. Order is preserved; entities are the same objects, never copies. */
export function clipToRegion<T>(entities: readonly T[], region: BBox | RegionShape): Clipped<T> {
  const shape: RegionShape = 'bbox' in region ? region : { bbox: region };
  const kept: T[] = [];
  let spatial = 0;
  for (const entity of entities) {
    const bounds = placementOf(entity);
    if (bounds === null) {
      kept.push(entity);
      continue;
    }
    spatial += 1;
    if (touches(entity, bounds, shape)) kept.push(entity);
  }
  return { kept, spatial };
}

/** Bbox rule when no boundary is configured; boundary rule otherwise (see RegionShape). */
function touches(entity: unknown, bounds: readonly BBox[], shape: RegionShape): boolean {
  if (shape.boundary === undefined) return bounds.some((b) => intersects(b, shape.bbox));
  const boundary = shape.boundary;
  if (positionsOf(entity).some((p) => inBoundary(p, boundary, NEAR_BORDER_DEG))) return true;
  // An entity whose bounds ENCLOSE the whole region (a continental outage area) is about it too.
  return bounds.some((b) => encloses(b, shape.bbox));
}

/**
 * Every position an entity places itself with: the vertices of its geometry, its `position`, and for a
 * `bbox`/`area` its four corners and its centre (a weather reading's box is the region's own; its centre
 * is inside the border even where the corners are not).
 */
export function positionsOf(entity: unknown): readonly Position[] {
  if (entity === null || typeof entity !== 'object' || Array.isArray(entity)) return [];
  const record = entity as Record<string, unknown>;
  const out: Position[] = [];
  for (const field of GEOMETRY_FIELDS) collectGeometryPositions(record[field], out);
  const position = record['position'];
  if (isPosition(position)) out.push(position);
  for (const field of BOX_FIELDS)
    if (isBBox(record[field])) out.push(...boxPositions(record[field] as BBox));
  return out;
}

function collectGeometryPositions(value: unknown, out: Position[]): void {
  if (value === null || typeof value !== 'object') return;
  const geometry = value as { readonly type?: unknown; readonly coordinates?: unknown };
  if (typeof geometry.type !== 'string' || !('coordinates' in geometry)) return;
  collectCoordinates(geometry.coordinates, out);
}

/** A box's four corners and its centre. */
function boxPositions(box: BBox): readonly Position[] {
  return [
    [box[0], box[1]],
    [box[2], box[1]],
    [box[2], box[3]],
    [box[0], box[3]],
    [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2],
  ];
}

/**
 * A coastline outline is land. A webcam on a bridge, a gauge on a pier, a hotspot on a reef sit a few
 * hundred metres off the polygon and are still the region's. Anything within this many degrees of the
 * outline (~3 km) counts as inside; a hotspot 3 km over the Serbian border reads as "near the border",
 * which is what an operator would call it.
 */
export const NEAR_BORDER_DEG = 0.03;

/**
 * Point-in-polygon by ray casting; a hole excludes; a MultiPolygon is any of its polygons. With a
 * tolerance, a point at most that far (in degrees, planar) from any outline edge also counts.
 */
export function inBoundary(point: Position, boundary: Geometry, toleranceDeg = 0): boolean {
  const polygons =
    boundary.type === 'Polygon'
      ? [boundary.coordinates]
      : boundary.type === 'MultiPolygon'
        ? boundary.coordinates
        : [];
  if (polygons.some((rings) => inPolygon(point[0], point[1], rings))) return true;
  if (toleranceDeg <= 0) return false;
  return polygons.some((rings) => rings.some((ring) => nearRing(point, ring, toleranceDeg)));
}

/** True when the point is within `tol` of any edge of the ring (planar degrees; fine at this scale). */
function nearRing([x, y]: Position, ring: readonly Position[], tol: number): boolean {
  const tol2 = tol * tol;
  for (let i = 1; i < ring.length; i++) {
    const [ax, ay] = ring[i - 1]!;
    const [bx, by] = ring[i]!;
    // Skip edges whose bounding box is farther than the tolerance — the common case.
    if (Math.min(ax, bx) - tol > x || Math.max(ax, bx) + tol < x) continue;
    if (Math.min(ay, by) - tol > y || Math.max(ay, by) + tol < y) continue;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    const ex = ax + t * dx - x;
    const ey = ay + t * dy - y;
    if (ex * ex + ey * ey <= tol2) return true;
  }
  return false;
}

function inPolygon(lon: number, lat: number, rings: readonly (readonly Position[])[]): boolean {
  const outer = rings[0];
  if (outer === undefined || !inRing(lon, lat, outer)) return false;
  return !rings.slice(1).some((hole) => inRing(lon, lat, hole));
}

function inRing(lon: number, lat: number, ring: readonly Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const crosses = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** `a` contains `b` entirely. */
export function encloses(a: BBox, b: BBox): boolean {
  return a[0] <= b[0] && a[1] <= b[1] && a[2] >= b[2] && a[3] >= b[3];
}

/**
 * Where an entity says it is, as one bounding box per placing field — or null when it says nothing.
 * Only the domain's own placing fields are read; nothing is inferred from an unnamed pair of numbers.
 */
export function placementOf(entity: unknown): readonly BBox[] | null {
  if (entity === null || typeof entity !== 'object' || Array.isArray(entity)) return null;
  const record = entity as Record<string, unknown>;
  const boxes: BBox[] = [];
  for (const field of GEOMETRY_FIELDS) {
    const bounds = geometryBounds(record[field]);
    if (bounds !== null) boxes.push(bounds);
  }
  const position = record['position'];
  if (isPosition(position)) boxes.push([position[0], position[1], position[0], position[1]]);
  for (const field of BOX_FIELDS) {
    const box = record[field];
    if (isBBox(box)) boxes.push(box);
  }
  return boxes.length === 0 ? null : boxes;
}

/** Bounds of a GeoJSON geometry of any nesting depth, or null when the value is not one (or is empty). */
function geometryBounds(value: unknown): BBox | null {
  if (value === null || typeof value !== 'object') return null;
  const geometry = value as { readonly type?: unknown; readonly coordinates?: unknown };
  if (typeof geometry.type !== 'string' || !('coordinates' in geometry)) return null;
  const positions: Position[] = [];
  collectCoordinates(geometry.coordinates, positions);
  return boundsOf(positions);
}

function collectCoordinates(node: unknown, out: Position[]): void {
  if (!Array.isArray(node)) return;
  if (isPosition(node)) {
    out.push(node);
    return;
  }
  for (const child of node) collectCoordinates(child, out);
}

function boundsOf(positions: readonly Position[]): BBox | null {
  const first = positions[0];
  if (first === undefined) return null;
  let [west, south, east, north] = [first[0], first[1], first[0], first[1]];
  for (const [lon, lat] of positions) {
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return [west, south, east, north];
}

export function isBBox(value: unknown): value is BBox {
  return Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === 'number');
}

/** Closed-interval overlap on both axes. Touching edges count: a shelter on the border is in the region. */
export function intersects(a: BBox, b: BBox): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}
