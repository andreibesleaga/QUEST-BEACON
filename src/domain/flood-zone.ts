// BEACON — FLOOD_ZONE entity (E1, NFHL exemplar). A FEMA National Flood Hazard Layer (NFHL) regulatory
// floodplain-zone polygon (e.g. 'AE' 1%-annual-chance, 'X' minimal-risk, 'VE' coastal high-hazard, 'D'
// undetermined). Pure domain: no framework/HTTP/DB imports (F9).
//
// Honest limitation (Art. — honest limitations): this is the REGULATORY effective-map boundary (the
// FIRM) — a slow-changing legal/insurance zone, NOT a live/observed flood EXTENT. It does not move with
// today's rainfall or river stage. Pair it with Gauge (current stage/crest) or HazardGeometry(kind
// FLOOD_REACH) for present conditions; FloodZone only answers "is this parcel in a mapped floodplain".
import type { PolygonGeometry, Position } from './value-objects/geo.js';
import { isPosition } from './value-objects/geo.js';
import { invariant } from './shared/guard.js';

export interface FloodZone {
  readonly id: string;
  readonly zone: string; // FEMA FLD_ZONE code, e.g. 'AE', 'X', 'A', 'AO', 'VE', 'D'
  readonly geom: PolygonGeometry;
}

export interface MakeFloodZoneInput {
  readonly id: string;
  readonly zone: string;
  readonly geom: PolygonGeometry;
}

export function makeFloodZone(input: MakeFloodZoneInput): FloodZone {
  invariant(typeof input.id === 'string' && input.id.trim().length > 0, 'FloodZone.id must be a non-empty string');
  invariant(
    typeof input.zone === 'string' && input.zone.trim().length > 0,
    'FloodZone.zone must be a non-empty string',
  );
  invariant(input.geom !== undefined && input.geom.type === 'Polygon', 'FloodZone.geom must be a GeoJSON Polygon');
  invariant(
    isValidPolygon(input.geom),
    'FloodZone.geom must have at least one ring of >=4 closed, valid [lon,lat] positions',
  );
  return { id: input.id, zone: input.zone, geom: input.geom };
}

function isValidPolygon(geom: PolygonGeometry): boolean {
  const rings = geom.coordinates;
  return Array.isArray(rings) && rings.length > 0 && rings.every(isValidRing);
}

/** A GeoJSON linear ring: >=4 positions (closed triangle minimum), every position valid, first == last. */
function isValidRing(ring: readonly Position[]): boolean {
  if (!Array.isArray(ring) || ring.length < 4 || !ring.every(isPosition)) return false;
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first !== undefined && last !== undefined && first[0] === last[0] && first[1] === last[1];
}
