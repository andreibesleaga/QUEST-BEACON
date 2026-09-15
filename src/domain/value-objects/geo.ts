// BEACON — GeoJSON value types (E1·T-040; RFC 7946). Structural; geometry math lives in SpatialPort.
export type Position = readonly [lon: number, lat: number];
export type BBox = readonly [minLon: number, minLat: number, maxLon: number, maxLat: number];

export interface PointGeometry {
  readonly type: 'Point';
  readonly coordinates: Position;
}
export interface LineStringGeometry {
  readonly type: 'LineString';
  readonly coordinates: readonly Position[];
}
export interface PolygonGeometry {
  readonly type: 'Polygon';
  readonly coordinates: readonly (readonly Position[])[];
}
export interface MultiPolygonGeometry {
  readonly type: 'MultiPolygon';
  readonly coordinates: readonly (readonly (readonly Position[])[])[];
}
export type Geometry = PointGeometry | LineStringGeometry | PolygonGeometry | MultiPolygonGeometry;

export const isPosition = (v: unknown): v is Position =>
  Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number';

/**
 * An UPPER BOUND on the area of a WGS-84 bbox, in km². Equirectangular with the WGS-84 maximum degree
 * lengths and the width taken at the latitude nearest the equator, so the figure is never below the true area —
 * which is what a "is this question too big for the source" gate needs when the source's limit is a hard
 * one: a box just over the limit must never pass. California's box comes out at ~1,030,000 km² against
 * the 964,477 WorldPop measured for it.
 */
export function bboxAreaKm2([west, south, east, north]: BBox): number {
  // ONE constant, the WGS-84 MAXIMUM, for both axes. A degree of latitude is longest at the poles
  // (~111.694 km). A degree of longitude is (π/180)·N(φ)·cos φ, where the prime-vertical radius N(φ) grows
  // from the equatorial radius (6,378.137 km) to a/√(1−e²) ≈ 6,399.594 km at the poles — so 111.32·cos φ,
  // the equatorial figure, UNDER-reports away from the equator by up to 0.34 %. (π/180)·6,399.594 = 111.694
  // bounds both from above at every latitude; rounded up to 111.7.
  const KM_PER_DEGREE_MAX = 111.7;
  const KM_PER_DEGREE_LONGITUDE_MAX = KM_PER_DEGREE_MAX;
  const KM_PER_DEGREE_LATITUDE_MAX = KM_PER_DEGREE_MAX;
  const lo = Math.min(south, north);
  const hi = Math.max(south, north);
  // The parallel nearest the equator: 0 when the box spans it, else the edge with the smaller |lat|.
  const widestLatitude = lo <= 0 && hi >= 0 ? 0 : Math.min(Math.abs(lo), Math.abs(hi));
  const width =
    Math.abs(east - west) *
    KM_PER_DEGREE_LONGITUDE_MAX *
    Math.cos(widestLatitude * (Math.PI / 180));
  const height = (hi - lo) * KM_PER_DEGREE_LATITUDE_MAX;
  return width * height;
}
