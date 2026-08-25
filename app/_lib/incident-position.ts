// BEACON — position-for-incident accessor (E11 "Live Views" · CW3b). The domain `Incident` (src/domain/
// incident.ts) and its wire projection (`IncidentSummary`/`IncidentView`) carry NO point geometry — an
// incident is a fire/flood EVENT, not a coordinate (its footprint is the hazard geometry). External Views
// (ADR-028) need SOME representative [lon,lat] to build deep-links from, so this is a best-effort, HONEST
// approximation: it scans the already-fetched region `MapData` (GET /regions/:id/map, the same data the COP
// map renders) for the first geolocated feature, preferring the ones most tightly coupled to the ACTIVE
// hazard (exposure → hazard-type hotspots/gauges) before falling back to any other pinned feature. Pure,
// synchronous, no network of its own — additive glue only (does not change any wire contract).
import type { Position } from '@/domain/value-objects/geo.js';
import type { MapData } from '../_components/map/types.js';

/**
 * Best-effort representative position for "the incident currently in view", derived from the region's
 * already-loaded map data. Returns `undefined` when the map data carries no geolocated feature at all
 * (e.g. still loading, or a genuinely empty region) — callers must treat that as "no position available"
 * rather than guessing a coordinate.
 */
/** The position of the first entry in an (optional) list of geolocated features, or undefined. */
function firstPosition(features: readonly { readonly position: Position }[] | undefined): Position | undefined {
  return features?.[0]?.position;
}

export function positionForIncident(mapData: MapData): Position | undefined {
  // Priority order: features most tightly coupled to the active hazard first (exposure, then the
  // type-specific hazard glyph), then any other pinned feature already on the map. Each candidate is a
  // separate low-complexity lookup (firstPosition) so this stays well under the cyclomatic-complexity gate.
  const candidates: readonly (Position | undefined)[] = [
    firstPosition(mapData.exposure),
    firstPosition(mapData.fire?.hotspots),
    firstPosition(mapData.flood?.gauges),
    firstPosition(mapData.reports),
    firstPosition(mapData.shelters),
    firstPosition(mapData.infrastructure),
    firstPosition(mapData.cell),
    firstPosition(mapData.cameras),
    mapData.weather?.position,
  ];
  return candidates.find((p): p is Position => p !== undefined);
}
