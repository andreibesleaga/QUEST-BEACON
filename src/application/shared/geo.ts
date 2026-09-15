// BEACON — deterministic geo helpers (E5). Pure typed-code geometry math (Art. XII allows
// "Turf.js / SQL / typed code" — the LLM never computes these). No framework/adapter imports (F9/§4).
// The SpatialPort covers pointInPolygon/buffer/intersect; these helpers cover the great-circle
// distance + directional projection the port does not expose, in pure reproducible code.
import type { Position, Geometry, PolygonGeometry } from '@/domain/value-objects/geo.js';

const EARTH_RADIUS_M = 6_371_008.8; // IUGG mean Earth radius
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** Great-circle (haversine) distance in metres between two [lon,lat] positions. Deterministic. */
export function haversineMeters(a: Position, b: Position): number {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLon = (lon2 - lon1) * DEG2RAD;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Forward geodesic: destination [lon,lat] at `distanceM` along `bearingDeg` (0=N, clockwise). */
export function destinationPoint(
  origin: Position,
  distanceM: number,
  bearingDeg: number,
): Position {
  const [lon, lat] = origin;
  const ang = distanceM / EARTH_RADIUS_M;
  const brg = bearingDeg * DEG2RAD;
  const lat1 = lat * DEG2RAD;
  const lon1 = lon * DEG2RAD;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(brg),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brg) * Math.sin(ang) * Math.cos(lat1),
      Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2),
    );
  return [lon2 * RAD2DEG, lat2 * RAD2DEG];
}

/** Representative [lon,lat] point of any geometry (first coordinate; a node's location anchor). */
export function representativePoint(geom: Geometry): Position {
  switch (geom.type) {
    case 'Point':
      return geom.coordinates;
    case 'LineString':
      return firstPosition(geom.coordinates);
    case 'Polygon':
      return firstPosition(geom.coordinates[0] ?? []);
    default:
      return firstPosition(geom.coordinates[0]?.[0] ?? []);
  }
}

function firstPosition(ring: readonly Position[]): Position {
  const p = ring[0];
  if (p === undefined) throw new Error('geometry has no coordinates');
  return p;
}

/** Decompose a hazard geometry into the Polygon rings usable by SpatialPort.pointInPolygon. */
export function polygonsOf(geom: Geometry): readonly PolygonGeometry[] {
  if (geom.type === 'Polygon') return [geom];
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates.map((coordinates) => ({ type: 'Polygon', coordinates }));
  }
  return [];
}

/** Clamp a number into the inclusive [0,1] unit interval. */
export function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
