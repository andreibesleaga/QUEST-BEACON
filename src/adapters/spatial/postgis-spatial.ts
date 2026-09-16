// BEACON — PostGIS SpatialPort adapter (FLAG path; FEATURE_SPATIAL=postgis; ADR-005).
//
// STUB — NOT wired to a live database in this build. A real implementation needs a running
// PostGIS instance and would push the geometry math into SQL via Drizzle's `sql`` tag, e.g.:
//   pointInPolygon → SELECT ST_Contains(ST_GeomFromGeoJSON($poly), ST_GeomFromGeoJSON($pt))
//   buffer         → SELECT ST_AsGeoJSON(ST_Buffer(ST_GeomFromGeoJSON($geom)::geography, $m))
//   intersect      → SELECT ST_Intersects(ST_GeomFromGeoJSON($a), ST_GeomFromGeoJSON($b))
//              (or ST_DWithin for radius queries).
// Until a DB is provisioned every method returns a typed INVARIANT_VIOLATION so the flag path is
// fail-safe and never silently returns wrong numbers (Art. XII). Set FEATURE_SPATIAL=turf to run.
import { err } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import { DomainError } from '@/domain/errors.js';
import type { Geometry, PolygonGeometry, Position } from '@/domain/value-objects/geo.js';
import type { SpatialPort } from '@/ports/infra.js';

const NOT_IMPLEMENTED =
  'PostGIS SpatialPort not implemented in this build — set FEATURE_SPATIAL=turf';

// Consumes (and discards) the call arguments so the fail-safe error is symmetric across methods.
const notImplemented = <T>(...args: readonly unknown[]): Result<T, DomainError> => {
  void args;
  return err(new DomainError('INVARIANT_VIOLATION', NOT_IMPLEMENTED));
};

export class PostgisSpatialPort implements SpatialPort {
  pointInPolygon(point: Position, polygon: PolygonGeometry): Result<boolean, DomainError> {
    return notImplemented(point, polygon);
  }

  buffer(geom: Geometry, meters: number): Result<PolygonGeometry, DomainError> {
    return notImplemented(geom, meters);
  }

  intersect(a: Geometry, b: Geometry): Result<boolean, DomainError> {
    return notImplemented(a, b);
  }
}

/** Factory for the PostGIS-backed SpatialPort (ADR-005 flag path; stub until a live DB exists). */
export const makePostgisSpatialPort = (): SpatialPort => new PostgisSpatialPort();
