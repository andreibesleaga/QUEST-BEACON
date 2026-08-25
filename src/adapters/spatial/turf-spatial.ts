// BEACON — Turf.js SpatialPort adapter (DEFAULT; FEATURE_SPATIAL=turf; ADR-005).
// Deterministic geometry math (Art. XII): every number/exposure comes from HERE, never the LLM.
// Turf never mutates its inputs; our value objects are `readonly`, so we cast the frozen GeoJSON
// to Turf's mutable-typed shape at the boundary (structurally identical, no copy needed).
import { booleanIntersects, booleanPointInPolygon, buffer, point } from '@turf/turf';
import type {
  Feature,
  Geometry as GeoJsonGeometry,
  LineString,
  MultiPolygon,
  Point as GeoJsonPoint,
  Polygon,
} from 'geojson';
import { err, ok } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import { DomainError } from '@/domain/errors.js';
import type {
  Geometry,
  PolygonGeometry,
  Position,
} from '@/domain/value-objects/geo.js';
import type { SpatialPort } from '@/ports/infra.js';

/** Cast a readonly domain geometry to Turf's mutable GeoJSON type (structural, no mutation occurs). */
const toGeoJson = (geom: Geometry): GeoJsonGeometry => geom as unknown as GeoJsonGeometry;

// Turf's `buffer` overloads reject the full GeoJSON union (it excludes GeometryCollection). Our domain
// `Geometry` never carries a collection, so we cast to exactly the members `buffer` accepts.
type BufferableGeometry = GeoJsonPoint | LineString | Polygon | MultiPolygon;
const toBufferable = (geom: Geometry): BufferableGeometry => geom as unknown as BufferableGeometry;

/** Cast a readonly position to Turf's mutable coordinate tuple. */
const toCoord = (p: Position): GeoJsonPoint['coordinates'] =>
  p as unknown as GeoJsonPoint['coordinates'];

export class TurfSpatialPort implements SpatialPort {
  pointInPolygon(pt: Position, polygon: PolygonGeometry): Result<boolean, DomainError> {
    try {
      const inside = booleanPointInPolygon(point(toCoord(pt)), toGeoJson(polygon) as Polygon);
      return ok(inside);
    } catch (cause) {
      return err(new DomainError('PARSE_ERROR', `pointInPolygon failed: ${describe(cause)}`));
    }
  }

  buffer(geom: Geometry, meters: number): Result<PolygonGeometry, DomainError> {
    if (!Number.isFinite(meters) || meters < 0) {
      return err(new DomainError('INVARIANT_VIOLATION', `buffer distance must be finite and >= 0, got ${meters}`));
    }
    try {
      const buffered = buffer(toBufferable(geom), meters, { units: 'meters' });
      return extractPolygon(buffered);
    } catch (cause) {
      return err(new DomainError('PARSE_ERROR', `buffer failed: ${describe(cause)}`));
    }
  }

  intersect(a: Geometry, b: Geometry): Result<boolean, DomainError> {
    try {
      return ok(booleanIntersects(toGeoJson(a), toGeoJson(b)));
    } catch (cause) {
      return err(new DomainError('PARSE_ERROR', `intersect failed: ${describe(cause)}`));
    }
  }
}

/** Narrow a Turf buffer result (Feature<Polygon|MultiPolygon>|undefined) to the port's PolygonGeometry. */
function extractPolygon(
  feature: Feature<GeoJsonGeometry> | undefined,
): Result<PolygonGeometry, DomainError> {
  const geometry = feature?.geometry;
  if (!geometry) {
    return err(new DomainError('PARSE_ERROR', 'buffer produced no geometry'));
  }
  if (geometry.type !== 'Polygon') {
    return err(new DomainError('PARSE_ERROR', `buffer produced non-polygon (${geometry.type})`));
  }
  return ok(geometry as unknown as PolygonGeometry);
}

const describe = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/** Factory for the default Turf-backed SpatialPort. */
export const makeTurfSpatialPort = (): SpatialPort => new TurfSpatialPort();
