// BEACON — GeoJSON value types (E1·T-040; RFC 7946). Structural; geometry math lives in SpatialPort.
export type Position = readonly [lon: number, lat: number];
export type BBox = readonly [minLon: number, minLat: number, maxLon: number, maxLat: number];

export interface PointGeometry { readonly type: 'Point'; readonly coordinates: Position }
export interface LineStringGeometry { readonly type: 'LineString'; readonly coordinates: readonly Position[] }
export interface PolygonGeometry { readonly type: 'Polygon'; readonly coordinates: readonly (readonly Position[])[] }
export interface MultiPolygonGeometry { readonly type: 'MultiPolygon'; readonly coordinates: readonly (readonly (readonly Position[])[])[] }
export type Geometry = PointGeometry | LineStringGeometry | PolygonGeometry | MultiPolygonGeometry;

export const isPosition = (v: unknown): v is Position =>
  Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number';
