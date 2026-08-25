// BEACON test harness — typed builders for the hazard & environment cluster (region, incident,
// hazard-geometry, gauge, infrastructure-node, exposure, prediction). Each `valid*` returns a valid
// entity via the real domain factory (so invariants stay authoritative) with sane defaults + overrides;
// each `invalid*Input` returns a deliberately invariant-breaking input for red-path tests (TEST_PLAN §4).
import { makeRegion, type MakeRegionInput, type Region } from '@/domain/region.js';
import { makeIncident, type MakeIncidentInput, type Incident } from '@/domain/incident.js';
import {
  makeHazardGeometry,
  type MakeHazardGeometryInput,
  type HazardGeometry,
} from '@/domain/hazard-geometry.js';
import { makeGauge, type MakeGaugeInput, type Gauge } from '@/domain/gauge.js';
import {
  makeInfrastructureNode,
  type MakeInfrastructureNodeInput,
  type InfrastructureNode,
} from '@/domain/infrastructure-node.js';
import { makeExposure, type MakeExposureInput, type Exposure } from '@/domain/exposure.js';
import { makePrediction, type MakePredictionInput, type Prediction } from '@/domain/prediction.js';
import type { PointGeometry, PolygonGeometry } from '@/domain/value-objects/geo.js';
import { FIXED_NOW_ISO } from '../clock.js';
import {
  regionId,
  incidentId,
  hazardGeometryId,
  gaugeId,
  infrastructureNodeId,
  predictionId,
  sourceId,
} from './ids.js';

const OBSERVED_AT = '2026-06-15T12:00:00.000Z';

export function validRegion(overrides: Partial<MakeRegionInput> = {}): Region {
  return makeRegion({
    id: regionId('us-ca'),
    name: 'California (Flagship)',
    scope: 'STATE',
    bbox: [-124.48, 32.53, -114.13, 42.01],
    enabledAdapters: ['firms', 'nws', 'osm-overpass'],
    ...overrides,
  });
}

export function validIncident(overrides: Partial<MakeIncidentInput> = {}): Incident {
  return makeIncident({
    id: incidentId('inc-ca-camp'),
    regionId: regionId('us-ca'),
    type: 'WILDFIRE',
    status: 'ACTIVE',
    ...overrides,
  });
}

/** A small square hazard footprint (default: a wildfire perimeter in the Sierra foothills). */
export function hazardPolygon(centerLon = -121.6, centerLat = 39.76, halfDeg = 0.05): PolygonGeometry {
  const [w, e, s, n] = [centerLon - halfDeg, centerLon + halfDeg, centerLat - halfDeg, centerLat + halfDeg];
  return { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] };
}

export function validHazardGeometry(overrides: Partial<MakeHazardGeometryInput> = {}): HazardGeometry {
  return makeHazardGeometry({
    id: hazardGeometryId('haz-ca-perimeter'),
    incidentId: incidentId('inc-ca-camp'),
    sourceId: sourceId('src-firms'),
    kind: 'PERIMETER',
    geometry: hazardPolygon(),
    observedAt: OBSERVED_AT,
    intensity: 0.8,
    ...overrides,
  });
}

export function point(lon: number, lat: number): PointGeometry {
  return { type: 'Point', coordinates: [lon, lat] };
}

export function validGauge(overrides: Partial<MakeGaugeInput> = {}): Gauge {
  return makeGauge({
    id: gaugeId('gauge-ca-1'),
    geom: point(-121.55, 39.72),
    floodCategory: 'MINOR',
    stage: 12.4,
    crestForecast: 15.1,
    crestTime: '2026-06-16T06:00:00.000Z',
    sourceId: sourceId('src-nwps'),
    ...overrides,
  });
}

export function validInfrastructureNode(
  overrides: Partial<MakeInfrastructureNodeInput> = {},
): InfrastructureNode {
  return makeInfrastructureNode({
    id: infrastructureNodeId('infra-ca-hospital'),
    type: 'HOSPITAL',
    geom: point(-121.6, 39.75),
    status: 'ONLINE',
    sourceId: sourceId('src-overpass'),
    ...overrides,
  });
}

export function validExposure(overrides: Partial<MakeExposureInput> = {}): Exposure {
  return makeExposure({
    incidentId: incidentId('inc-ca-camp'),
    nodeId: infrastructureNodeId('infra-ca-hospital'),
    reason: 'IN_POLYGON',
    insideHazard: true,
    computedAt: FIXED_NOW_ISO,
    distanceM: 0,
    ...overrides,
  });
}

export function validPrediction(overrides: Partial<MakePredictionInput> = {}): Prediction {
  return makePrediction({
    id: predictionId('pred-ca-cone'),
    incidentId: incidentId('inc-ca-camp'),
    kind: 'FIRE_CONE',
    method: 'wind-buffer first-order cone (NWS wind vector)',
    inputs: { windSpeedMs: 12, windDirDeg: 225 },
    uncertainty: 0.4,
    geom: hazardPolygon(-121.5, 39.8, 0.08),
    horizon: '2026-06-15T18:00:00.000Z',
    sourceId: sourceId('src-nws'),
    ...overrides,
  });
}

// ---- invalid variants (red-path fuel; each violates exactly one invariant) --------------------------
export function invalidRegionInputBadBBox(): MakeRegionInput {
  return { id: regionId('bad'), name: 'Bad', scope: 'STATE', bbox: [10, 10, 0, 0] };
}

export function invalidExposureInputNegativeDistance(): MakeExposureInput {
  return {
    incidentId: incidentId('inc-ca-camp'),
    nodeId: infrastructureNodeId('infra-ca-hospital'),
    reason: 'IN_BUFFER',
    computedAt: FIXED_NOW_ISO,
    distanceM: -5,
  };
}

export function invalidPredictionInputUncertaintyOutOfRange(): MakePredictionInput {
  return {
    id: predictionId('pred-bad'),
    incidentId: incidentId('inc-ca-camp'),
    kind: 'ESCALATION',
    method: 'x',
    inputs: {},
    uncertainty: 1.5,
  };
}
