// BEACON — prediction projection use-case (E5·T-210/T-213/T-215; FR-12, SPEC §5.6).
// Labeled FIRST-ORDER projections only (method+inputs+uncertainty+horizon). Geometry is deterministic
// typed code / SpatialPort — never physics-grade, never LLM (Art. XII). Returns null (no projection)
// rather than dead-ending when inputs are insufficient (Art. XVI).
import type { SpatialPort } from '@/ports/index.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type {
  Geometry,
  PolygonGeometry,
  MultiPolygonGeometry,
  Position,
} from '@/domain/value-objects/geo.js';
import type { IncidentId, PredictionId, SourceId } from '@/domain/value-objects/ids.js';
import type { Prediction } from '@/domain/prediction.js';
import type { FloodZone } from '@/domain/flood-zone.js';
import { ok, isErr } from '@/domain/shared/result.js';
import { makePrediction } from '@/domain/prediction.js';
import { destinationPoint, clamp01 } from '@/application/shared/geo.js';
import {
  boundsOf,
  expandBbox,
  clipRingToRect,
  ringArea,
} from '@/application/shared/map-geometry.js';
import { DEFAULT_FIRE_CONE_CONFIG, type FireConeConfig } from '@/application/shared/config.js';

const MS_PER_HOUR = 3_600_000;

export interface FireConeInput {
  readonly id: PredictionId;
  readonly incidentId: IncidentId;
  readonly origin?: Position; // hotspot/perimeter anchor; absent ⇒ no projection
  readonly windDirDeg: number; // direction the wind blows TOWARD (bearing, 0=N)
  readonly windSpeedMps: number;
  readonly nowMs: number; // projection base time (epoch ms, injected)
  readonly horizonMs: number; // lead-time window in ms
  readonly sourceId?: SourceId;
}

/**
 * First-order wildfire spread cone: a directional wedge from the origin along the wind bearing,
 * length ∝ windSpeed × horizon (SPEC §5.6). No hotspots or zero wind ⇒ labeled null (no dead-end).
 */
export function projectFireCone(
  input: FireConeInput,
  cfg: FireConeConfig = DEFAULT_FIRE_CONE_CONFIG,
): Prediction | null {
  if (input.origin === undefined || input.windSpeedMps <= 0 || input.horizonMs <= 0) return null;
  const horizonHours = input.horizonMs / MS_PER_HOUR;
  const lengthM = input.windSpeedMps * (input.horizonMs / 1000) * cfg.spreadFactor;
  const geom = coneGeometry(input.origin, input.windDirDeg, lengthM, cfg.halfAngleDeg);
  const uncertainty = clamp01(cfg.baseUncertainty + horizonHours * cfg.uncertaintyPerHour);
  return makePrediction({
    id: input.id,
    incidentId: input.incidentId,
    kind: 'FIRE_CONE',
    method:
      'first-order projection: directional wind-buffer cone (bearing=wind dir, length∝speed×horizon)',
    inputs: {
      windDirDeg: input.windDirDeg,
      windSpeedMps: input.windSpeedMps,
      horizonHours,
      halfAngleDeg: cfg.halfAngleDeg,
      lengthM,
    },
    uncertainty,
    geom,
    horizon: new Date(input.nowMs + input.horizonMs).toISOString(),
    ...(input.sourceId !== undefined ? { sourceId: input.sourceId } : {}),
  });
}

function coneGeometry(
  origin: Position,
  bearingDeg: number,
  lengthM: number,
  halfAngleDeg: number,
): PolygonGeometry {
  const left = destinationPoint(origin, lengthM, bearingDeg - halfAngleDeg);
  const nose = destinationPoint(origin, lengthM, bearingDeg);
  const right = destinationPoint(origin, lengthM, bearingDeg + halfAngleDeg);
  return { type: 'Polygon', coordinates: [[origin, left, nose, right, origin]] };
}

export interface FloodInundationInput {
  readonly id: PredictionId;
  readonly incidentId: IncidentId;
  readonly reach: Geometry; // NWPS forecast-crest reach geometry
  readonly nfhl: Geometry; // FEMA NFHL flood-hazard polygon
  readonly floods: boolean; // deterministic gate: does the crest indicate flooding (category ≥ MINOR)
  readonly crestForecast?: number;
  readonly crestTime?: string; // ISO-8601 lead-time
  readonly sourceId?: SourceId;
}

/**
 * First-order flood inundation: NWPS forecast-crest reach ∩ FEMA NFHL (SPEC §5.6). Only projected when
 * the crest indicates flooding AND the reach intersects the NFHL layer (via SpatialPort). Carries the
 * lead-time + "NFHL-effective-map" caveat. No intersection / not flooding ⇒ labeled null (no dead-end).
 */
export function projectFloodInundation(
  input: FloodInundationInput,
  spatial: SpatialPort,
): Result<Prediction | null, DomainError> {
  if (!input.floods) return ok(null);
  const hit = spatial.intersect(input.reach, input.nfhl);
  if (isErr(hit)) return hit;
  if (!hit.value) return ok(null);
  const prediction = makePrediction({
    id: input.id,
    incidentId: input.incidentId,
    kind: 'FLOOD_INUNDATION',
    method:
      'first-order projection: NWPS forecast-crest ∩ FEMA NFHL (caveat: NFHL effective-map extent)',
    inputs: {
      ...(input.crestForecast !== undefined ? { crestForecast: input.crestForecast } : {}),
      caveat: 'NFHL effective-map extent; not physics-grade',
    },
    uncertainty: 0.5,
    geom: input.nfhl,
    ...(input.crestTime !== undefined ? { horizon: input.crestTime } : {}),
    ...(input.sourceId !== undefined ? { sourceId: input.sourceId } : {}),
  });
  return ok(prediction);
}

// ── NFHL flood-zones ∩ crest-driven extent (FR-12; makes PRD flagship-3 real) ──────────────────────────

/** Tuning for the crest-driven flood extent + the labelled uncertainty (config-injectable, deterministic). */
export interface FloodImpactConfig {
  readonly baseMarginDeg: number; // reach half-width at zero crest (degrees)
  readonly marginPerCrestUnit: number; // extra half-width per crest unit (stage/discharge)
  readonly baseUncertainty: number; // [0,1] labelled first-order uncertainty
  readonly minAreaDeg2: number; // reject sub-sliver clip results (numeric noise)
}

export const DEFAULT_FLOOD_IMPACT_CONFIG: FloodImpactConfig = {
  baseMarginDeg: 0.01,
  marginPerCrestUnit: 0.002,
  baseUncertainty: 0.5,
  minAreaDeg2: 1e-9,
};

export interface FloodZoneImpactInput {
  readonly id: PredictionId;
  readonly incidentId: IncidentId;
  readonly floodZones: readonly FloodZone[]; // FEMA NFHL regulatory zone polygons
  readonly reach: Geometry; // NWPS/GloFAS forecast-crest reach geometry
  readonly crestForecast: number; // crest stage/discharge (drives the extent width)
  readonly floods: boolean; // deterministic gate: crest indicates flooding (category ≥ MINOR)
  readonly floodCategory?: string;
  readonly crestTime?: string; // ISO-8601 lead-time
  readonly sourceId?: SourceId;
}

/** One impacted zone: the NFHL zone code + the clipped ring that fell inside the crest extent. */
interface ZoneClip {
  readonly zone: string;
  readonly ring: readonly Position[];
}

/** Clip every NFHL zone's outer ring to the crest-extent rectangle; keep only non-sliver intersections. */
function clipZones(
  zones: readonly FloodZone[],
  extent: readonly [number, number, number, number],
  minAreaDeg2: number,
): readonly ZoneClip[] {
  const out: ZoneClip[] = [];
  for (const z of zones) {
    const outer = z.geom.coordinates[0];
    if (outer === undefined) continue;
    const clipped = clipRingToRect(outer, extent);
    if (clipped.length >= 4 && ringArea(clipped) > minAreaDeg2)
      out.push({ zone: z.zone, ring: clipped });
  }
  return out;
}

/**
 * First-order flood IMPACT geometry: intersect the FEMA-NFHL regulatory flood-zone polygons with a
 * crest-driven extent (the forecast-crest reach grown by a crest-scaled margin — a convex clip window, so
 * the intersection is exact and deterministic, no SpatialPort/Turf needed). The predicted-impact geometry is
 * the union of the clipped zone rings (a MultiPolygon), labelled with method + inputs + uncertainty
 * (Art. XII). Not flooding, no zones, or an empty intersection ⇒ labelled null (no dead-end, Art. XVI).
 */
export function projectFloodZoneImpact(
  input: FloodZoneImpactInput,
  cfg: FloodImpactConfig = DEFAULT_FLOOD_IMPACT_CONFIG,
): Prediction | null {
  if (!input.floods || input.floodZones.length === 0) return null;
  const margin = cfg.baseMarginDeg + Math.max(0, input.crestForecast) * cfg.marginPerCrestUnit;
  const extent = expandBbox(boundsOf(input.reach), margin);
  const clips = clipZones(input.floodZones, extent, cfg.minAreaDeg2);
  if (clips.length === 0) return null;
  const geom: MultiPolygonGeometry = {
    type: 'MultiPolygon',
    coordinates: clips.map((c) => [c.ring]),
  };
  const impactedZones = [...new Set(clips.map((c) => c.zone))].sort().join('|');
  return makePrediction({
    id: input.id,
    incidentId: input.incidentId,
    kind: 'FLOOD_INUNDATION',
    method:
      'first-order projection: FEMA NFHL flood-zones ∩ crest-driven extent (convex-window clip; NFHL effective-map extent; not physics-grade)',
    inputs: {
      crestForecast: input.crestForecast,
      ...(input.floodCategory !== undefined ? { floodCategory: input.floodCategory } : {}),
      zonesAssessed: input.floodZones.length,
      zonesImpacted: clips.length,
      impactedZones,
      caveat: 'NFHL effective-map extent clipped to crest reach; not physics-grade',
    },
    uncertainty: clamp01(cfg.baseUncertainty),
    geom,
    ...(input.crestTime !== undefined ? { horizon: input.crestTime } : {}),
    ...(input.sourceId !== undefined ? { sourceId: input.sourceId } : {}),
  });
}
