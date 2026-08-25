// BEACON test harness — deterministic in-memory SpatialPort (TEST_PLAN §4 / F11 port-parity fixture).
// Pure geometry math (no Turf/PostGIS): ray-casting point-in-polygon, a degree-approx buffer, and a
// bbox-overlap intersect. Enough for exposure/routing use-cases to run against a stable oracle in tests;
// the real Turf and PostGIS adapters must satisfy the SAME SpatialPort contract (F11).
import type { SpatialPort } from '@/ports/infra.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { BBox, Geometry, PolygonGeometry, Position } from '@/domain/value-objects/geo.js';
import { ok } from '@/domain/shared/result.js';

const METERS_PER_DEGREE = 111_320;

/** Ray-casting test: is `pt` inside the polygon's outer ring? Deterministic, boundary-exclusive. */
function inRing(pt: Position, ring: readonly Position[]): boolean {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as Position;
    const [xj, yj] = ring[j] as Position;
    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Axis-aligned bounding box of any geometry (flattens nested coordinate arrays). */
function bboxOf(geom: Geometry): BBox {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  const visit = (node: unknown): void => {
    if (Array.isArray(node) && typeof node[0] === 'number' && typeof node[1] === 'number') {
      minLon = Math.min(minLon, node[0]);
      maxLon = Math.max(maxLon, node[0]);
      minLat = Math.min(minLat, node[1]);
      maxLat = Math.max(maxLat, node[1]);
    } else if (Array.isArray(node)) {
      for (const child of node) visit(child);
    }
  };
  visit(geom.coordinates);
  return [minLon, minLat, maxLon, maxLat];
}

function bboxesOverlap(a: BBox, b: BBox): boolean {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

export class FakeSpatial implements SpatialPort {
  pointInPolygon(pt: Position, polygon: PolygonGeometry): Result<boolean, DomainError> {
    const outer = polygon.coordinates[0] ?? [];
    return ok(inRing(pt, outer));
  }

  buffer(geom: Geometry, meters: number): Result<PolygonGeometry, DomainError> {
    const d = meters / METERS_PER_DEGREE;
    const [w, s, e, n] = bboxOf(geom);
    const ring: Position[] = [
      [w - d, s - d],
      [e + d, s - d],
      [e + d, n + d],
      [w - d, n + d],
      [w - d, s - d],
    ];
    return ok({ type: 'Polygon', coordinates: [ring] });
  }

  intersect(a: Geometry, b: Geometry): Result<boolean, DomainError> {
    return ok(bboxesOverlap(bboxOf(a), bboxOf(b)));
  }
}
