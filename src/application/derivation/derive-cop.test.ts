// BEACON — COP derivation tests (E5; FR-3/FR-4/FR-12/FR-13, Art. XII). Proves the outputs are COMPUTED from
// raw inputs, not seeded literals: move a node out of the hazard → exposure count drops; raise the wind →
// the fire cone lengthens; add a rising reading → the trend flips to ESCALATING. A SpatialPort error always
// short-circuits to Err (never a partial/guessed result). Deterministic: no clock/net, injected fixtures.
import { describe, it, expect } from 'vitest';
import type { SpatialPort } from '@/ports/index.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import { ok, err, isOk, isErr } from '@/domain/shared/result.js';
import { InvariantViolation } from '@/domain/errors.js';
import { asId } from '@/domain/value-objects/ids.js';
import type {
  IncidentId,
  InfrastructureNodeId,
  RegionId,
  SourceId,
  CitationId,
  PredictionId,
} from '@/domain/value-objects/ids.js';
import type { InfraNodeType, InfrastructureNode } from '@/domain/infrastructure-node.js';
import { makeInfrastructureNode } from '@/domain/infrastructure-node.js';
import { makeHazardGeometry } from '@/domain/hazard-geometry.js';
import { makeShelter } from '@/domain/shelter.js';
import { makeEvacRoute } from '@/domain/evac-route.js';
import type { HazardGeometry } from '@/domain/hazard-geometry.js';
import type { BBox, Geometry, PolygonGeometry, Position } from '@/domain/value-objects/geo.js';
import { makeFloodZone } from '@/domain/flood-zone.js';
import { makeCameraFeed } from '@/domain/camera-feed.js';
import type { CameraFeedId, ShelterId } from '@/domain/value-objects/ids.js';
import type { WeatherObservation } from '@/ports/data-sources.js';
import type { AirQualityReading } from '@/ports/air-quality.js';
import type {
  OutageRecord,
  TelecomCoverage,
  PopulationEstimate,
} from '@/ports/infrastructure-sources.js';
import type { TrendSample } from '@/application/escalation-trend/escalation-trend.js';
import { projectMap } from '@/application/map-projection/map-projection.js';
import {
  deriveExposures,
  deriveMapSource,
  deriveIncidentFacts,
  type MapDerivationInput,
  type IncidentDerivationInput,
} from './derive-cop.js';

// ── A deterministic ray-cast SpatialPort (real inside/outside so counts respond to node position) ─────

function inRing(pt: Position, ring: readonly Position[]): boolean {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}
function bboxOf(geom: Geometry): BBox {
  let a = Infinity,
    b = Infinity,
    c = -Infinity,
    d = -Infinity;
  const visit = (node: unknown): void => {
    if (Array.isArray(node) && typeof node[0] === 'number' && typeof node[1] === 'number') {
      a = Math.min(a, node[0]);
      c = Math.max(c, node[0]);
      b = Math.min(b, node[1]);
      d = Math.max(d, node[1]);
    } else if (Array.isArray(node)) for (const child of node) visit(child);
  };
  visit(geom.coordinates);
  return [a, b, c, d];
}
const realSpatial: SpatialPort = {
  pointInPolygon: (pt, poly) => ok(inRing(pt, poly.coordinates[0] ?? [])),
  buffer: (geom, meters) => {
    const dd = meters / 111_320;
    const [w, s, e, n] = bboxOf(geom);
    return ok({
      type: 'Polygon',
      coordinates: [
        [
          [w - dd, s - dd],
          [e + dd, s - dd],
          [e + dd, n + dd],
          [w - dd, n + dd],
          [w - dd, s - dd],
        ],
      ],
    });
  },
  intersect: (x, y) => {
    const A = bboxOf(x),
      B = bboxOf(y);
    return ok(!(A[2] < B[0] || A[0] > B[2] || A[3] < B[1] || A[1] > B[3]));
  },
};
/** A port that fails on the named method — proves short-circuit-to-Err (never a partial result). */
function failingOn(method: keyof SpatialPort): SpatialPort {
  const boom = (): Result<never, DomainError> => err(new InvariantViolation(`${method} boom`));
  return { ...realSpatial, [method]: boom };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────────────────────────

const INC = asId<IncidentId>('inc-1');
const REGION = asId<RegionId>('r1');
const CENTER: readonly [number, number] = [-121.6, 39.7];
const box = (c: readonly [number, number], dd: number): PolygonGeometry => ({
  type: 'Polygon',
  coordinates: [
    [
      [c[0] - dd, c[1] - dd],
      [c[0] + dd, c[1] - dd],
      [c[0] + dd, c[1] + dd],
      [c[0] - dd, c[1] + dd],
      [c[0] - dd, c[1] - dd],
    ],
  ],
});
const HAZARDS: readonly HazardGeometry[] = [
  makeHazardGeometry({
    id: asId('hz-1'),
    incidentId: INC,
    sourceId: asId<SourceId>('firms'),
    kind: 'PERIMETER',
    geometry: box(CENTER, 0.05),
    observedAt: '2026-07-05T22:00:00Z',
  }),
];
const BUFFERS: Readonly<Record<InfraNodeType, number>> = {
  HOSPITAL: 2000,
  NURSING_HOME: 2000,
  POWER: 1000,
  CELL: 1000,
  ROAD: 500,
  RAIL: 500,
  SHELTER: 1500,
};
const inside = (id: string, status: InfrastructureNode['status'] = 'AT_RISK'): InfrastructureNode =>
  makeInfrastructureNode({
    id: asId<InfrastructureNodeId>(id),
    type: 'POWER',
    status,
    geom: { type: 'Point', coordinates: [-121.61, 39.72] },
    sourceId: asId<SourceId>('overpass'),
  });
const outside = (id: string): InfrastructureNode =>
  makeInfrastructureNode({
    id: asId<InfrastructureNodeId>(id),
    type: 'POWER',
    status: 'ONLINE',
    geom: { type: 'Point', coordinates: [-100, 10] },
    sourceId: asId<SourceId>('overpass'),
  });

const COMPUTED_AT = '2026-07-05T22:00:00Z';
const NOW_MS = Date.parse(COMPUTED_AT);
const rising: readonly TrendSample[] = [
  { t: NOW_MS / 1000 - 7200, value: 100 },
  { t: NOW_MS / 1000 - 3600, value: 150 },
  { t: NOW_MS / 1000, value: 220 },
];
const flat: readonly TrendSample[] = [
  { t: NOW_MS / 1000 - 7200, value: 4 },
  { t: NOW_MS / 1000 - 3600, value: 4 },
  { t: NOW_MS / 1000, value: 4 },
];

function mapInput(
  over: Partial<MapDerivationInput> = {},
  dropFreshness = false,
): MapDerivationInput {
  const full: MapDerivationInput = {
    regionId: REGION,
    incidentId: INC,
    incidentType: 'WILDFIRE',
    hazards: HAZARDS,
    gauges: [],
    infrastructure: [inside('n-in'), outside('n-out')],
    buffers: BUFFERS,
    predictions: [
      {
        kind: 'FIRE_CONE',
        id: asId<PredictionId>('cone-1'),
        incidentId: INC,
        origin: [-121.6, 39.7],
        windDirDeg: 225,
        windSpeedMps: 5,
        nowMs: NOW_MS,
        horizonMs: 3_600_000,
        sourceId: asId<SourceId>('firms'),
      },
    ],
    shelters: [],
    reports: [],
    provenance: [{ sourceId: 'firms', mode: 'MOCK', fetchedAt: COMPUTED_AT }],
    freshness: COMPUTED_AT,
    computedAt: COMPUTED_AT,
    ...over,
  };
  if (dropFreshness) delete (full as { freshness?: string }).freshness;
  return full;
}

function grounding(field: string, id: string) {
  return { field, sourceId: asId<SourceId>('firms'), citationId: asId<CitationId>(id) };
}
function incidentInput(over: Partial<IncidentDerivationInput> = {}): IncidentDerivationInput {
  return {
    incidentId: INC,
    hazards: HAZARDS,
    infrastructure: [inside('n-north'), inside('n-south', 'OFFLINE')],
    buffers: BUFFERS,
    exposedPopulation: 3200,
    assetLabel: 'electrical substations',
    trendReadings: rising,
    grounding: {
      exposure: grounding('exposure', 'c-exp'),
      priorities: grounding('priorities', 'c-prio'),
    },
    computedAt: COMPUTED_AT,
    ...over,
  };
}

// ── deriveExposures (FR-3) ──────────────────────────────────────────────────────────────────────

describe('deriveExposures', () => {
  it('pairs each computed exposure with its node; only in-hazard nodes count', () => {
    const res = deriveExposures(
      {
        incidentId: INC,
        hazards: HAZARDS,
        nodes: [inside('a'), outside('b')],
        buffers: BUFFERS,
        computedAt: COMPUTED_AT,
      },
      realSpatial,
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value).toHaveLength(1);
    expect(String(res.value[0]!.node.id)).toBe('a');
    expect(res.value[0]!.exposure.reason).toBe('IN_POLYGON');
  });

  it('short-circuits to Err on a SpatialPort failure', () => {
    const res = deriveExposures(
      {
        incidentId: INC,
        hazards: HAZARDS,
        nodes: [inside('a')],
        buffers: BUFFERS,
        computedAt: COMPUTED_AT,
      },
      failingOn('pointInPolygon'),
    );
    expect(isErr(res)).toBe(true);
  });
});

// ── deriveMapSource (FR-3 exposure + FR-12 prediction) ────────────────────────────────────────────

describe('deriveMapSource', () => {
  it('computes the exposure layer + fire cone; carries route/freshness through', () => {
    const route = makeEvacRoute({
      id: asId('rt-1'),
      incidentId: INC,
      geom: {
        type: 'LineString',
        coordinates: [
          [-121.6, 39.7],
          [-121.4, 39.75],
        ],
      },
      avoidsHazard: true,
    });
    const res = deriveMapSource(
      mapInput({ route, outageNodeIds: [asId<InfrastructureNodeId>('none')] }),
      realSpatial,
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.exposure).toHaveLength(1); // only the in-hazard node
    expect(res.value.predictions[0]?.kind).toBe('FIRE_CONE');
    expect(res.value.route?.id).toBe('rt-1');
    expect(res.value.freshness).toBe(COMPUTED_AT);
  });

  it('raising the wind lengthens the fire cone (proves the geometry is COMPUTED)', () => {
    const nose = (mps: number): number => {
      const r = deriveMapSource(
        mapInput({
          predictions: [
            {
              kind: 'FIRE_CONE',
              id: asId<PredictionId>('c'),
              incidentId: INC,
              origin: [-121.6, 39.7],
              windDirDeg: 225,
              windSpeedMps: mps,
              nowMs: NOW_MS,
              horizonMs: 3_600_000,
            },
          ],
        }),
        realSpatial,
      );
      if (!isOk(r) || r.value.predictions[0]?.geom?.type !== 'Polygon') throw new Error('no cone');
      const ring = r.value.predictions[0]!.geom.coordinates[0]!;
      const [ox, oy] = ring[0]!;
      const [nx, ny] = ring[2]!; // origin → nose
      return Math.hypot(nx - ox, ny - oy);
    };
    expect(nose(10)).toBeGreaterThan(nose(5));
  });

  it('omits the prediction when the fire cone cannot be projected (no origin)', () => {
    const res = deriveMapSource(
      mapInput({
        predictions: [
          {
            kind: 'FIRE_CONE',
            id: asId<PredictionId>('c'),
            incidentId: INC,
            windDirDeg: 225,
            windSpeedMps: 5,
            nowMs: NOW_MS,
            horizonMs: 3_600_000,
          },
        ],
      }),
      realSpatial,
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.predictions).toEqual([]);
    expect(res.value.route).toBeUndefined();
  });

  it('computes a flood-inundation prediction when the crest floods and reaches the NFHL', () => {
    const res = deriveMapSource(
      mapInput({
        incidentType: 'FLOOD',
        predictions: [
          {
            kind: 'FLOOD_INUNDATION',
            id: asId<PredictionId>('fi'),
            incidentId: INC,
            reach: box(CENTER, 0.05),
            nfhl: box(CENTER, 0.06),
            floods: true,
            crestForecast: 4.2,
            crestTime: COMPUTED_AT,
          },
        ],
      }),
      realSpatial,
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.predictions[0]?.kind).toBe('FLOOD_INUNDATION');
  });

  it('yields no prediction when the crest does not flood, and omits absent freshness', () => {
    const res = deriveMapSource(
      mapInput(
        {
          predictions: [
            {
              kind: 'FLOOD_INUNDATION',
              id: asId<PredictionId>('fi'),
              incidentId: INC,
              reach: box(CENTER, 0.05),
              nfhl: box(CENTER, 0.06),
              floods: false,
            },
          ],
        },
        true,
      ),
      realSpatial,
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.predictions).toEqual([]);
    expect(res.value.freshness).toBeUndefined();
  });

  it('derives EVERY spec, in order, each keeping its own engine + method (ADR-033 §3.1)', () => {
    const res = deriveMapSource(
      mapInput({
        incidentType: 'FLOOD',
        infrastructure: [inside('a'), inside('b')], // both inside → exposure never calls intersect
        predictions: [
          {
            kind: 'FIRE_CONE',
            id: asId<PredictionId>('c-1'),
            incidentId: INC,
            origin: [-121.6, 39.7],
            windDirDeg: 225,
            windSpeedMps: 5,
            nowMs: NOW_MS,
            horizonMs: 3_600_000,
          },
          {
            kind: 'FLOOD_INUNDATION',
            id: asId<PredictionId>('fi-1'),
            incidentId: INC,
            reach: box(CENTER, 0.05),
            nfhl: box(CENTER, 0.06),
            floods: true,
            crestForecast: 4.2,
          },
        ],
      }),
      realSpatial,
    );
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.predictions.map((p) => String(p.id))).toEqual(['c-1', 'fi-1']);
    expect(res.value.predictions.map((p) => p.kind)).toEqual(['FIRE_CONE', 'FLOOD_INUNDATION']);
    // Each prediction keeps ITS OWN method + inputs + uncertainty — never one merged figure (Art. XII).
    expect(res.value.predictions[0]?.method).not.toBe(res.value.predictions[1]?.method);
    expect(res.value.predictions.every((p) => Object.keys(p.inputs).length > 0)).toBe(true);
    expect(res.value.predictions.every((p) => p.uncertainty > 0)).toBe(true);
  });

  it('a spec that projects nothing is DROPPED without displacing the ones that do', () => {
    const res = deriveMapSource(
      mapInput({
        predictions: [
          {
            kind: 'FIRE_CONE',
            id: asId<PredictionId>('no-origin'),
            incidentId: INC,
            windDirDeg: 225,
            windSpeedMps: 5,
            nowMs: NOW_MS,
            horizonMs: 3_600_000,
          },
          {
            kind: 'FIRE_CONE',
            id: asId<PredictionId>('c-2'),
            incidentId: INC,
            origin: [-121.6, 39.7],
            windDirDeg: 225,
            windSpeedMps: 5,
            nowMs: NOW_MS,
            horizonMs: 3_600_000,
          },
        ],
      }),
      realSpatial,
    );
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.predictions.map((p) => String(p.id))).toEqual(['c-2']);
  });

  it('no specs at all ⇒ predictions: [] (an absent layer, never a faked cone — Art. XVI)', () => {
    const res = deriveMapSource(mapInput({ predictions: [] }), realSpatial);
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.predictions).toEqual([]);
  });

  it('propagates a SpatialPort error from the exposure step', () => {
    expect(isErr(deriveMapSource(mapInput(), failingOn('pointInPolygon')))).toBe(true);
  });

  it('propagates a SpatialPort error from the flood-inundation step (exposure succeeds first)', () => {
    // Both nodes sit inside the hazard, so exposure never calls intersect — the error must come from prediction.
    const res = deriveMapSource(
      mapInput({
        infrastructure: [inside('a'), inside('b')],
        predictions: [
          {
            kind: 'FLOOD_INUNDATION',
            id: asId<PredictionId>('fi'),
            incidentId: INC,
            reach: box(CENTER, 0.05),
            nfhl: box(CENTER, 0.06),
            floods: true,
          },
        ],
      }),
      failingOn('intersect'),
    );
    expect(isErr(res)).toBe(true);
  });
});

// ── deriveMapSource — Phase-D slices (raw port DTOs → derived honest map-layer slices) ─────────────────

const OUTAGE_REC: OutageRecord = {
  area: [-121.7, 39.6, -121.5, 39.8],
  customersOut: 1200,
  observedAt: COMPUTED_AT,
};
const CELL_REC: TelecomCoverage = { position: [-121.6, 39.7], technology: 'LTE', online: false };
const WX_OBS: WeatherObservation = {
  at: COMPUTED_AT,
  position: [-121.6, 39.7],
  windSpeedMs: 5,
  windDirDeg: 225,
};
const NFHL_ZONE = makeFloodZone({ id: 'z-ae', zone: 'AE', geom: box(CENTER, 0.06) });

describe('deriveMapSource — Phase-D slice derivation', () => {
  it('derives outage AOIs (assumed-offline + source timestamp), cell sites, wind glyph, NFHL zones', () => {
    const res = deriveMapSource(
      mapInput({
        outages: [OUTAGE_REC],
        cellSites: [CELL_REC],
        weatherObservation: WX_OBS,
        floodZones: [NFHL_ZONE],
        layerSources: { outage: 'eagle-i' },
      }),
      realSpatial,
    );
    if (!isOk(res)) throw new Error('expected ok');
    const s = res.value;
    expect(s.outages).toEqual([
      {
        id: 'outage-0',
        polygon: [
          [
            [-121.7, 39.6],
            [-121.5, 39.6],
            [-121.5, 39.8],
            [-121.7, 39.8],
            [-121.7, 39.6],
          ],
        ],
        assumedOffline: true,
        observedAt: COMPUTED_AT,
        customersOut: 1200,
      },
    ]);
    expect(s.cellSites).toEqual([
      { id: 'cell-0', position: [-121.6, 39.7], online: false, technology: 'LTE' },
    ]);
    expect(s.weather).toEqual({
      position: [-121.6, 39.7],
      speedKmh: 18,
      directionDeg: 225,
      observedAt: COMPUTED_AT,
    });
    expect(s.floodZones).toEqual([NFHL_ZONE]);
    expect(s.layerSources).toEqual({ outage: 'eagle-i' });
  });

  it('omits an outage customersOut / cell technology when the raw record lacks them', () => {
    const res = deriveMapSource(
      mapInput({
        outages: [{ area: [-121.7, 39.6, -121.5, 39.8], observedAt: COMPUTED_AT }],
        cellSites: [{ position: [-121.6, 39.7], online: true }],
      }),
      realSpatial,
    );
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.outages?.[0]).not.toHaveProperty('customersOut');
    expect(res.value.cellSites?.[0]).not.toHaveProperty('technology');
  });

  it('yields no wind glyph when the observation lacks direction or speed (honest omission)', () => {
    const noDir = deriveMapSource(
      mapInput({ weatherObservation: { at: COMPUTED_AT, position: [0, 0], windSpeedMs: 5 } }),
      realSpatial,
    );
    const noSpeed = deriveMapSource(
      mapInput({ weatherObservation: { at: COMPUTED_AT, position: [0, 0], windDirDeg: 90 } }),
      realSpatial,
    );
    if (!isOk(noDir) || !isOk(noSpeed)) throw new Error('expected ok');
    expect(noDir.value.weather).toBeUndefined();
    expect(noSpeed.value.weather).toBeUndefined();
  });

  it('passes live cameras through VERBATIM (no derivation — link-out pins, E11)', () => {
    const cam = makeCameraFeed({
      id: asId<CameraFeedId>('caltrans:cctv-9'),
      position: [-121.6, 39.7],
      kind: 'TRAFFIC_CCTV',
      title: 'SR-70 @ Jarbo Gap',
      provider: 'Caltrans',
      viewUrl: 'https://cwwp2.dot.ca.gov/vm/loc/d3/cctv-9.htm',
      license: 'Caltrans (public domain)',
      isLive: true,
    });
    const res = deriveMapSource(mapInput({ cameras: [cam] }), realSpatial);
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.cameras).toEqual([cam]);
  });

  it('preserves empty Phase-D slices (absent layer = [] passthrough)', () => {
    const res = deriveMapSource(mapInput({ outages: [], cellSites: [] }), realSpatial);
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.outages).toEqual([]);
    expect(res.value.cellSites).toEqual([]);
    expect(res.value.weather).toBeUndefined();
    expect(res.value.floodZones).toBeUndefined();
    expect(res.value.cameras).toBeUndefined();
  });

  it('projects the REAL NFHL∩crest impact when flood zones + a crest are present (flagship-3)', () => {
    const res = deriveMapSource(
      mapInput({
        incidentType: 'FLOOD',
        floodZones: [NFHL_ZONE],
        predictions: [
          {
            kind: 'FLOOD_INUNDATION',
            id: asId<PredictionId>('fi'),
            incidentId: INC,
            reach: box(CENTER, 0.05),
            nfhl: box(CENTER, 0.06),
            floods: true,
            crestForecast: 4.2,
            crestTime: COMPUTED_AT,
            sourceId: asId<SourceId>('nfhl'),
          },
        ],
      }),
      realSpatial,
    );
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.predictions[0]?.kind).toBe('FLOOD_INUNDATION');
    expect(res.value.predictions[0]?.geom?.type).toBe('MultiPolygon');
    expect(res.value.predictions[0]?.sourceId).toBe('nfhl');
    expect(res.value.predictions[0]?.method).toContain('NFHL flood-zones ∩ crest-driven extent');
  });

  it('falls back to the SpatialPort reach∩NFHL rung when the NFHL∩crest intersection is empty', () => {
    // Flood zone lives far from the reach → NFHL∩crest yields null → legacy projectFloodInundation runs.
    const farZone = makeFloodZone({ id: 'z-far', zone: 'X', geom: box([10, 10], 0.05) });
    const res = deriveMapSource(
      mapInput({
        incidentType: 'FLOOD',
        infrastructure: [inside('a'), inside('b')], // both inside → exposure never calls intersect
        floodZones: [farZone],
        predictions: [
          {
            kind: 'FLOOD_INUNDATION',
            id: asId<PredictionId>('fi'),
            incidentId: INC,
            reach: box(CENTER, 0.05),
            nfhl: box(CENTER, 0.06),
            floods: true,
            crestForecast: 4.2,
          },
        ],
      }),
      realSpatial,
    );
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.predictions[0]?.geom?.type).toBe('Polygon'); // legacy rung returns the whole NFHL polygon
    expect(res.value.predictions[0]?.method).toContain('NWPS forecast-crest ∩ FEMA NFHL');
  });

  it('uses the legacy flood rung when a crest is present but no flood zones are supplied', () => {
    const res = deriveMapSource(
      mapInput({
        incidentType: 'FLOOD',
        infrastructure: [inside('a'), inside('b')],
        predictions: [
          {
            kind: 'FLOOD_INUNDATION',
            id: asId<PredictionId>('fi'),
            incidentId: INC,
            reach: box(CENTER, 0.05),
            nfhl: box(CENTER, 0.06),
            floods: true,
            crestForecast: 4.2,
          },
        ],
      }),
      realSpatial,
    );
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.predictions[0]?.method).toContain('NWPS forecast-crest ∩ FEMA NFHL');
  });
});

// ── deriveIncidentFacts (FR-3 exposure + FR-4 trend + FR-13 priorities) ───────────────────────────

describe('deriveIncidentFacts', () => {
  it('computes exposure count + top priority + ESCALATING trend + weather (CA-like)', () => {
    const res = deriveIncidentFacts(
      incidentInput({
        weather: {
          input: { speedKmh: 25, fromLabel: 'NE', spreadLabel: 'south-westward' },
          grounding: grounding('weather', 'c-w'),
        },
      }),
      realSpatial,
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    const byField = new Map(res.value.facts.map((f) => [f.field, f.claim]));
    expect(byField.get('exposure')).toContain('2 electrical substations');
    // OFFLINE node gets the vulnerability boost → it ranks highest (deterministic).
    expect(byField.get('priorities')).toContain('n-south');
    expect(byField.get('weather')).toContain('25 km/h');
    expect(res.value.trend).toBe('ESCALATING');
    expect(res.value.facts).toHaveLength(3);
  });

  it('drops the exposure count when a node moves OUT of the hazard (proves COMPUTED, not seeded)', () => {
    const res = deriveIncidentFacts(
      incidentInput({ infrastructure: [inside('n-north'), outside('n-far')] }),
      realSpatial,
    );
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.facts.find((f) => f.field === 'exposure')!.claim).toContain(
      '1 electrical substations',
    );
  });

  it('computes crest + STEADY trend with no weather (RO-like), honouring a custom config', () => {
    const res = deriveIncidentFacts(
      incidentInput({
        trendReadings: flat,
        assetLabel: 'lifeline facilities',
        crest: {
          input: { returnPeriodLabel: '2-year', floodCategory: 'minor' },
          grounding: grounding('crest', 'c-c'),
        },
        priorityConfig: {
          weights: { proximity: 1, vulnerability: 0, population: 0 },
          vulnerability: {
            typeWeights: {
              HOSPITAL: 1,
              NURSING_HOME: 1,
              SHELTER: 1,
              POWER: 1,
              CELL: 1,
              RAIL: 1,
              ROAD: 1,
            },
            offlineBoost: 1,
            populationBasis: 1,
          },
        },
        trendConfig: { minSamples: 3, deadbandPerHour: 0.5 },
      }),
      realSpatial,
    );
    if (!isOk(res)) throw new Error('expected ok');
    const fields = res.value.facts.map((f) => f.field);
    expect(fields).toContain('crest');
    expect(fields).not.toContain('weather');
    expect(res.value.trend).toBe('STEADY');
  });

  // F-93: once a SERVED gauge can replace the seeded crest, the headline has two legitimate wordings and
  // the wrong one is a false claim, not a style choice. A return-period model may state its threshold; an
  // observed gauge publishes only a category and must NOT inherit some other source's return period.
  it('states the return-period threshold ONLY when the source actually published one', () => {
    const withReturnPeriod = deriveIncidentFacts(
      incidentInput({
        crest: {
          input: { returnPeriodLabel: '2-year', floodCategory: 'minor' },
          grounding: grounding('crest', 'c-c'),
        },
      }),
      realSpatial,
    );
    if (!isOk(withReturnPeriod)) throw new Error('expected ok');
    const modelled = withReturnPeriod.value.facts.find((f) => f.field === 'crest')!.claim;
    expect(modelled).toContain('2-year return period');

    // A served gauge: category only, no return period anywhere in the sentence.
    const gaugeOnly = deriveIncidentFacts(
      incidentInput({
        crest: { input: { floodCategory: 'moderate' }, grounding: grounding('crest', 'c-c') },
      }),
      realSpatial,
    );
    if (!isOk(gaugeOnly)) throw new Error('expected ok');
    const observed = gaugeOnly.value.facts.find((f) => f.field === 'crest')!.claim;
    expect(observed).toContain('moderate flood category');
    expect(observed).not.toContain('return period');
  });

  // A number without its unit is not a fact, it is a rumour with digits. The served-reading sentences are
  // therefore each gated on the source having published BOTH the figure and the unit it is expressed in —
  // a gauge that gives a stage but no unit gets a category sentence and nothing else.
  it('states no stage or crest figure when the source published no unit for it', () => {
    const res = deriveIncidentFacts(
      incidentInput({
        crest: {
          input: {
            floodCategory: 'moderate',
            stage: 3.1,
            crestForecast: 2650,
            exceedanceProbability: 0.74,
          },
          grounding: grounding('crest', 'c-c'),
        },
      }),
      realSpatial,
    );
    if (!isOk(res)) throw new Error('expected ok');
    const claim = res.value.facts.find((f) => f.field === 'crest')!.claim;
    expect(claim).not.toContain('3.1');
    expect(claim).not.toContain('2650');
    // The unitless probability is still stateable — it is dimensionless — and keeps its provenance caveat.
    expect(claim).toContain('0.74');
    expect(claim).toContain('not an ensemble member fraction');
  });

  it('flips the trend to ESCALATING when a rising reading is added (input → output)', () => {
    const steady = deriveIncidentFacts(incidentInput({ trendReadings: flat }), realSpatial);
    const climbing = deriveIncidentFacts(incidentInput({ trendReadings: rising }), realSpatial);
    if (!isOk(steady) || !isOk(climbing)) throw new Error('expected ok');
    expect(steady.value.trend).toBe('STEADY');
    expect(climbing.value.trend).toBe('ESCALATING');
  });

  it('omits the priorities fact when nothing is exposed (top is undefined)', () => {
    const res = deriveIncidentFacts(
      incidentInput({
        infrastructure: [outside('a'), outside('b')],
        outageNodeIds: [asId<InfrastructureNodeId>('none')],
      }),
      realSpatial,
    );
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.facts.map((f) => f.field)).toEqual(['exposure']);
    expect(res.value.facts[0]!.claim).toContain('0 electrical substations');
  });

  it('short-circuits to Err on a SpatialPort failure', () => {
    expect(isErr(deriveIncidentFacts(incidentInput(), failingOn('pointInPolygon')))).toBe(true);
  });
});

// ── deriveIncidentFacts — WorldPop/census population blend (Art. XVI fallback rung + provenance label) ──

const POP_EST: readonly PopulationEstimate[] = [
  { area: [-121.7, 39.6, -121.5, 39.8], count: 4100 },
  { area: [-121.5, 39.6, -121.3, 39.8], count: 900 },
];

describe('deriveIncidentFacts — population blend', () => {
  // ⚠ F-23 was a LIVE HONESTY DEFECT: the pre-D1 `blendPopulation` summed every served estimate's `count` and
  // DISCARDED its `area`, so the number was a whole-region rectangle total (5000 here) while the sentence beside
  // it read "residents within the exposed area". D1 makes the sentence true by clipping. The hazard box
  // (0.1° x 0.1° = 0.01 deg²) sits wholly inside POP_EST[0]'s 0.2° x 0.2° area (0.04 deg²), so exactly a quarter
  // of its 4100 residents are inside the footprint, and POP_EST[1] does not overlap the hazard at all.
  it('CLIPS the served area total to the hazard footprint and names the rung that bounded it (F-23)', () => {
    const res = deriveIncidentFacts(
      incidentInput({
        populationEstimates: POP_EST,
        populationSourceLabel: 'US Census ACS',
        populationGrounding: grounding('population', 'c-pop'),
      }),
      realSpatial,
    );
    if (!isOk(res)) throw new Error('expected ok');
    const pop = res.value.facts.find((f) => f.field === 'population')!;
    expect(pop.claim).toContain('1025'); // 4100 x (0.01 / 0.04); POP_EST[1] contributes nothing
    expect(pop.claim).toContain('within the exposed area');
    expect(pop.claim).toContain('US Census ACS');
    expect(pop.claim).toContain('area-weighted share');
    // V3: the clipped figure is STRICTLY LESS than the unclipped total the old code published.
    expect(res.value.impact.affected.count).toBeLessThan(5000);
    expect(res.value.impact.affected.count).toBe(1025);
    expect(res.value.impact.affected.rung).toBe('CLIPPED_AREA_ESTIMATE');
    expect(res.value.impact.affected.clipped).toBe(true);
  });

  it('falls back to the seeded planning estimate — and then REFUSES to say "within the exposed area"', () => {
    const empty = deriveIncidentFacts(
      incidentInput({
        populationEstimates: [],
        populationGrounding: grounding('population', 'c-pop'),
      }),
      realSpatial,
    );
    const zeroSum = deriveIncidentFacts(
      incidentInput({
        populationEstimates: [{ area: [0, 0, 1, 1], count: 0 }],
        populationGrounding: grounding('population', 'c-pop'),
      }),
      realSpatial,
    );
    const absent = deriveIncidentFacts(
      incidentInput({ populationGrounding: grounding('population', 'c-pop') }),
      realSpatial,
    );
    for (const res of [empty, zeroSum, absent]) {
      if (!isOk(res)) throw new Error('expected ok');
      const pop = res.value.facts.find((f) => f.field === 'population')!;
      expect(pop.claim).toContain('3200'); // the seeded exposedPopulation
      expect(pop.claim).toContain('planning estimate, not clipped');
      expect(pop.claim).toContain('NOT clipped to the exposed area');
      expect(pop.claim).not.toContain('residents within the exposed area');
      expect(res.value.impact.affected.rung).toBe('PLANNING_SEED');
      expect(res.value.impact.affected.clipped).toBe(false);
    }
  });

  it('adds no population fact when no populationGrounding is supplied (the figure still drives priorities)', () => {
    const res = deriveIncidentFacts(incidentInput({ populationEstimates: POP_EST }), realSpatial);
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.facts.map((f) => f.field)).not.toContain('population');
    // The figure is still computed and still drives the scores — only its CITED publication is withheld.
    expect(res.value.impact.affected.count).toBe(1025);
  });

  // F-66(b): the population claim's citation must name the source that SERVED the number. `grounding.exposure`
  // (firms here) grounds a different claim — the asset intersection — and must never end up citing a census
  // figure. This pins the two citations apart on the same derivation.
  it('cites the POPULATION source for the population claim and the HAZARD source for the exposure claim', () => {
    const res = deriveIncidentFacts(
      incidentInput({
        populationEstimates: POP_EST,
        populationSourceLabel: 'US Census ACS',
        populationGrounding: {
          field: 'population',
          sourceId: asId<SourceId>('census'),
          citationId: asId<CitationId>('cit-population'),
        },
      }),
      realSpatial,
    );
    if (!isOk(res)) throw new Error('expected ok');
    const pop = res.value.facts.find((f) => f.field === 'population')!;
    const exposure = res.value.facts.find((f) => f.field === 'exposure')!;
    expect(String(pop.sourceId)).toBe('census');
    expect(String(exposure.sourceId)).toBe('firms');
    expect(String(pop.citationId)).toBe('cit-population');
  });
});

// ── deriveIncidentFacts — the two OPTIONAL impact facts (ADR-035 §1(b)/(d); MW-D/D1) ──────────────
//
// Both are emitted ONLY when the figure was computed AND a citation for it was supplied: a figure with no
// citation is not published (F2). These pin that gate in both directions, plus the caveat that must ride the
// alert-reach sentence wherever it goes (ADR-035 V6).

const CELL_SITES: readonly TelecomCoverage[] = [
  { position: [-121.61, 39.72], online: true }, // inside the hazard box
  { position: [-100, 10], online: true }, // far outside it
];
const SHELTERS = [
  makeShelter({
    id: asId<ShelterId>('sh-1'),
    geom: { type: 'Point', coordinates: [-121.6, 39.7] },
    capacity: 400,
    occupancy: 50,
  }),
];

describe('deriveIncidentFacts — predicted-impact facts', () => {
  it('emits the alert-reach fact with its own citation, and the geometric-proxy caveat inside the claim', () => {
    const res = deriveIncidentFacts(
      incidentInput({
        cellSites: CELL_SITES,
        impactGrounding: {
          alertReach: {
            field: 'alertReach',
            sourceId: asId<SourceId>('opencellid'),
            citationId: asId<CitationId>('cit-alert-reach'),
          },
        },
      }),
      realSpatial,
    );
    if (!isOk(res)) throw new Error('expected ok');
    const fact = res.value.facts.find((f) => f.field === 'alertReach')!;
    expect(fact.claim).toContain('1 of 2 known cell sites');
    expect(fact.claim).toMatch(/not an outage prediction/i);
    expect(String(fact.sourceId)).toBe('opencellid'); // the telecom source, not the hazard source
    expect(res.value.impact.alertReach!.sitesInExtent).toBe(1);
  });

  it('emits the shelter/clearance fact naming its parameter set and its operator-default caveat', () => {
    const res = deriveIncidentFacts(
      incidentInput({
        shelters: SHELTERS,
        leadTimeHours: 6,
        impactGrounding: {
          shelterDemand: {
            field: 'shelterDemand',
            sourceId: asId<SourceId>('beacon-seed'),
            citationId: asId<CitationId>('cit-shelter-demand'),
          },
        },
      }),
      realSpatial,
    );
    if (!isOk(res)) throw new Error('expected ok');
    const fact = res.value.facts.find((f) => f.field === 'shelterDemand')!;
    expect(fact.claim).toContain('Predicted shelter demand');
    expect(fact.claim).toContain('operator default, not a published literature value');
    expect(res.value.impact.shelterDemand!.leadTimeHours).toBe(6);
  });

  it('COMPUTES both figures but publishes NEITHER fact when no citation is supplied for them', () => {
    const res = deriveIncidentFacts(
      incidentInput({ cellSites: CELL_SITES, shelters: SHELTERS }),
      realSpatial,
    );
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.facts.map((f) => f.field)).not.toContain('alertReach');
    expect(res.value.facts.map((f) => f.field)).not.toContain('shelterDemand');
    expect(res.value.impact.alertReach).toBeDefined();
    expect(res.value.impact.shelterDemand).toBeDefined();
  });

  it('publishes NEITHER fact when the citations exist but the inputs do not — no faked figure', () => {
    const res = deriveIncidentFacts(
      incidentInput({
        impactGrounding: {
          alertReach: {
            field: 'alertReach',
            sourceId: asId<SourceId>('opencellid'),
            citationId: asId<CitationId>('cit-alert-reach'),
          },
          shelterDemand: {
            field: 'shelterDemand',
            sourceId: asId<SourceId>('beacon-seed'),
            citationId: asId<CitationId>('cit-shelter-demand'),
          },
        },
      }),
      realSpatial,
    );
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.impact.alertReach).toBeUndefined();
    expect(res.value.impact.shelterDemand).toBeUndefined();
    expect(res.value.facts.map((f) => f.field)).toEqual(['exposure', 'priorities']);
  });

  it('a CORRUPT hazard geometry short-circuits to Err — never a partial or silently shrunken figure', () => {
    // `makeHazardGeometry` validates the geometry TYPE but not its ring contents, so a footprint with no
    // coordinates is constructible and reaches the clip. Counting people against it must fail loudly rather
    // than quietly dropping the extent and under-reporting who is at risk.
    const empty = makeHazardGeometry({
      id: asId('hz-empty'),
      incidentId: INC,
      sourceId: asId<SourceId>('firms'),
      kind: 'PERIMETER',
      geometry: { type: 'Polygon', coordinates: [] },
      observedAt: COMPUTED_AT,
    });
    const res = deriveIncidentFacts(
      incidentInput({
        hazards: [empty],
        populationEstimates: POP_EST,
        populationGrounding: grounding('population', 'c-pop'),
      }),
      realSpatial,
    );
    expect(isErr(res)).toBe(true);
  });

  // ADR-032 §3 again, now for the POPULATION figure: an advisory CONE is a positional-uncertainty envelope,
  // not an impact footprint, so it must not bound a count of who is at risk any more than it may bound an
  // asset-exposure count. Same filter, one place.
  it('clips against IMPACT-bearing hazards only — an advisory CONE never bounds a population figure', () => {
    const cone = makeHazardGeometry({
      id: asId('hz-cone'),
      incidentId: INC,
      sourceId: asId<SourceId>('firms'),
      kind: 'CONE',
      geometry: box(CENTER, 0.05),
      observedAt: COMPUTED_AT,
    });
    const res = deriveIncidentFacts(
      incidentInput({
        hazards: [cone],
        populationEstimates: POP_EST,
        populationGrounding: grounding('population', 'c-pop'),
      }),
      realSpatial,
    );
    if (!isOk(res)) throw new Error('expected ok');
    // No impact-bearing hazard ⇒ nothing to clip against ⇒ the honest unclipped rung, said out loud.
    expect(res.value.impact.affected.rung).toBe('AREA_TOTAL');
    expect(res.value.impact.affected.clipped).toBe(false);
    expect(res.value.facts.find((f) => f.field === 'population')!.claim).toContain('NOT clipped');
  });
});

// ── Storm family wiring (ADR-032 §3; FR-STORM-3 / FEV-6, F-18) ────────────────────────────────────
//
// `risk-intersection.ts` is kind-agnostic by design, so the "which hazards count as exposure" decision is
// made HERE, in the two query builders. These tests pin both halves of it against real ray-cast geometry:
// a STORM_SURGE footprint produces exposure and ranked priorities exactly like a fire perimeter, while a
// TRACK/CONE covering the very same ground produces none — and the map still receives all three verbatim.

const STORM_INC = asId<IncidentId>('inc-storm');
const stormHazard = (
  kind: 'TRACK' | 'CONE' | 'STORM_SURGE',
  geometry: Geometry = box(CENTER, 0.05),
) =>
  makeHazardGeometry({
    id: asId(`hz-${kind}`),
    incidentId: STORM_INC,
    sourceId: asId<SourceId>('pagasa-tcb'),
    kind,
    geometry,
    observedAt: COMPUTED_AT,
  });
const TRACK_GEOM: Geometry = {
  type: 'LineString',
  coordinates: [
    [-121.64, 39.68],
    [-121.58, 39.73],
  ],
};

describe('deriveMapSource — storm exposure wiring (ADR-032 §3)', () => {
  it('counts a node inside the STORM_SURGE extent, exactly as a fire perimeter would', () => {
    const res = deriveMapSource(
      mapInput({ incidentType: 'STORM', hazards: [stormHazard('STORM_SURGE')] }),
      realSpatial,
    );
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.exposure.map((e) => e.exposure.reason)).toEqual(['IN_POLYGON']);
    expect(res.value.exposure[0]?.node.id).toBe('n-in');
  });

  it('counts NOTHING from a TRACK or a CONE over the same ground (advisory, not impact)', () => {
    const res = deriveMapSource(
      mapInput({
        incidentType: 'STORM',
        hazards: [stormHazard('TRACK', TRACK_GEOM), stormHazard('CONE')],
      }),
      realSpatial,
    );
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.exposure).toEqual([]);
  });

  it('keeps only the surge in exposure while the MAP still receives all three geometries verbatim', () => {
    const hazards = [
      stormHazard('TRACK', TRACK_GEOM),
      stormHazard('CONE'),
      stormHazard('STORM_SURGE'),
    ];
    const res = deriveMapSource(mapInput({ incidentType: 'STORM', hazards }), realSpatial);
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.exposure).toHaveLength(1);
    expect(res.value.hazards.map((h) => h.kind)).toEqual(['TRACK', 'CONE', 'STORM_SURGE']);
  });
});

// ── C2.2 — the two never-built kinds, ESCALATION + IMPACT_OVER_TIME (F-16; ADR-033 §4.1/§4.2) ─────────
//
// Both are geometry-LESS by design, so the point of these tests is that they are CONSTRUCTED, labeled and
// carried in `predictions[]` — and that they never displace or corrupt the geometry-bearing predictions the
// map depends on. The plural array is the seam C2.1 built; this is what now flows through it.

const ESC_SPEC = {
  kind: 'ESCALATION' as const,
  id: asId<PredictionId>('esc-1'),
  incidentId: INC,
  signal: { samples: rising },
  signalLabel: 'burned area (acres)',
};
const IMPACT_SPEC = {
  kind: 'IMPACT_OVER_TIME' as const,
  id: asId<PredictionId>('imp-1'),
  incidentId: INC,
  basis: 'exposedPopulation' as const,
  currentCount: 3200,
  series: rising,
  signalLabel: 'burned area (acres)',
  nowMs: NOW_MS,
};

describe('deriveMapSource — the trend-derived kinds in the plural predictions[] (C2.2)', () => {
  it('constructs BOTH kinds alongside the cone, in spec order, each with its own method + uncertainty', () => {
    const res = deriveMapSource(
      mapInput({ predictions: [ESC_SPEC, mapInput().predictions[0]!, IMPACT_SPEC] }),
      realSpatial,
    );
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.predictions.map((p) => p.kind)).toEqual([
      'ESCALATION',
      'FIRE_CONE',
      'IMPACT_OVER_TIME',
    ]);
    expect(res.value.predictions.map((p) => String(p.id))).toEqual(['esc-1', 'cone-1', 'imp-1']);
    // Every one carries method + inputs + uncertainty — the project invariant, per prediction, never merged.
    expect(res.value.predictions.every((p) => p.method.length > 0)).toBe(true);
    expect(res.value.predictions.every((p) => Object.keys(p.inputs).length > 0)).toBe(true);
    expect(res.value.predictions.every((p) => p.uncertainty > 0)).toBe(true);
    expect(new Set(res.value.predictions.map((p) => p.method)).size).toBe(3);
  });

  it('the two trend kinds carry NO geometry — so the map projection drops them WITHOUT displacing the cone', () => {
    const res = deriveMapSource(
      mapInput({ predictions: [ESC_SPEC, mapInput().predictions[0]!, IMPACT_SPEC] }),
      realSpatial,
    );
    if (!isOk(res)) throw new Error('expected ok');
    const trendKinds = res.value.predictions.filter((p) => p.kind !== 'FIRE_CONE');
    expect(trendKinds).toHaveLength(2);
    expect(trendKinds.every((p) => p.geom === undefined)).toBe(true);
    // The map wire requires a geometry (F-77): exactly one descriptor, and it is the cone — unchanged.
    const projected = projectMap({ source: res.value, role: 'PUBLIC' });
    expect(projected.predictions.map((p) => p.id)).toEqual(['cone-1']);
    expect(projected.prediction?.id).toBe('cone-1');
    // …while the DOMAIN read-model still carries all three, so the SitRep/Outlook path can see them.
    expect(res.value.predictions).toHaveLength(3);
  });

  it('a STEADY signal projects no ESCALATION and is dropped without displacing the ones that do', () => {
    const res = deriveMapSource(
      mapInput({
        predictions: [
          { ...ESC_SPEC, signal: { samples: flat } },
          mapInput().predictions[0]!,
          IMPACT_SPEC,
        ],
      }),
      realSpatial,
    );
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.predictions.map((p) => String(p.id))).toEqual(['cone-1', 'imp-1']);
  });

  it('an IMPACT_OVER_TIME spec with no usable clock is dropped, leaving the cone intact', () => {
    const res = deriveMapSource(
      mapInput({
        predictions: [{ ...IMPACT_SPEC, nowMs: Number.NaN }, mapInput().predictions[0]!],
      }),
      realSpatial,
    );
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.predictions.map((p) => String(p.id))).toEqual(['cone-1']);
  });
});

describe('deriveIncidentFacts — the SitRep path constructs both kinds (C2.2, F-16/F-77)', () => {
  it('emits ESCALATION + IMPACT_OVER_TIME with deterministic, incident-scoped ids', () => {
    const res = deriveIncidentFacts(incidentInput(), realSpatial);
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.predictions.map((p) => p.kind)).toEqual(['ESCALATION', 'IMPACT_OVER_TIME']);
    expect(res.value.predictions.map((p) => String(p.id))).toEqual([
      'inc-1-escalation',
      'inc-1-impact-over-time',
    ]);
    expect(res.value.predictions.every((p) => String(p.incidentId) === 'inc-1')).toBe(true);
    expect(res.value.predictions.every((p) => p.geom === undefined)).toBe(true);
    expect(res.value.predictions.every((p) => p.uncertainty > 0 && p.uncertainty <= 1)).toBe(true);
  });

  it('reuses the figures the SitRep already states — the SAME trend label and the SAME exposure count', () => {
    const res = deriveIncidentFacts(
      incidentInput({
        populationEstimates: POP_EST,
        populationGrounding: grounding('population', 'c-pop'),
      }),
      realSpatial,
    );
    if (!isOk(res)) throw new Error('expected ok');
    const escalation = res.value.predictions[0]!;
    expect((escalation.inputs as { trend: string }).trend).toBe(res.value.trend); // no second trend classifier
    const impact = res.value.predictions[1]!;
    // 1025 = the CLIPPED figure the population fact states (D1/F-23) — never re-derived here, and never the
    // unclipped 5000 region total the pre-D1 code projected from.
    expect((impact.inputs as { currentCount: number }).currentCount).toBe(1025);
    expect((impact.inputs as { currentCount: number }).currentCount).toBe(
      res.value.impact.affected.count,
    );
    expect(res.value.facts.find((f) => f.field === 'population')!.claim).toContain('1025');
  });

  it('a STEADY trend drops the ESCALATION without displacing the impact projection', () => {
    const res = deriveIncidentFacts(incidentInput({ trendReadings: flat }), realSpatial);
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.trend).toBe('STEADY');
    expect(res.value.predictions.map((p) => p.kind)).toEqual(['IMPACT_OVER_TIME']);
  });

  it('too short a series yields NO predictions at all — an absent projection, never a faked one', () => {
    const res = deriveIncidentFacts(
      incidentInput({ trendReadings: rising.slice(0, 2) }),
      realSpatial,
    );
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.predictions).toEqual([]);
  });

  it('labels the signal with the seeded units, and says so honestly when none were supplied', () => {
    const labelled = deriveIncidentFacts(
      incidentInput({ trendSignalLabel: 'gauge stage (m)' }),
      realSpatial,
    );
    const unlabelled = deriveIncidentFacts(incidentInput(), realSpatial);
    if (!isOk(labelled) || !isOk(unlabelled)) throw new Error('expected ok');
    expect((labelled.value.predictions[0]!.inputs as { signalLabel: string }).signalLabel).toBe(
      'gauge stage (m)',
    );
    expect(
      (unlabelled.value.predictions[0]!.inputs as { signalLabel: string }).signalLabel,
    ).toContain('units as published by the source');
  });

  it('projects the exposure count forward at the config checkpoints, along the SAME slope (Art. XII)', () => {
    const res = deriveIncidentFacts(incidentInput(), realSpatial);
    if (!isOk(res)) throw new Error('expected ok');
    const impact = res.value.predictions[1]!.inputs as {
      basis: string;
      currentCount: number;
      slopePerHour: number;
      checkpoints: readonly { horizonHours: number; projectedCount: number; at: string }[];
    };
    expect(impact.basis).toBe('exposedPopulation');
    expect(impact.currentCount).toBe(3200); // the seeded planning estimate the exposure fact uses
    expect(impact.slopePerHour).toBe(60); // +60 acres/h, computed by classifyTrend from `rising`
    expect(impact.checkpoints.map((c) => c.horizonHours)).toEqual([6, 12, 24]);
    // A rising signal projects a rising count, anchored on the injected computedAt instant (no wall clock).
    const counts = impact.checkpoints.map((c) => c.projectedCount);
    expect(counts[0]).toBeGreaterThan(impact.currentCount);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    expect(impact.checkpoints[0]!.at).toBe('2026-07-06T04:00:00.000Z'); // COMPUTED_AT + 6 h
  });

  it('honours an injected TrendConfig for the predictions too, not only for the SitRep trend label', () => {
    const res = deriveIncidentFacts(
      incidentInput({ trendConfig: { minSamples: 3, deadbandPerHour: 1000 } }),
      realSpatial,
    );
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.trend).toBe('STEADY'); // the wide dead-band absorbs the rise…
    expect(res.value.predictions.map((p) => p.kind)).toEqual(['IMPACT_OVER_TIME']); // …so no ESCALATION
  });

  it('replays byte-identically — the derivation reads no clock of its own', () => {
    const a = deriveIncidentFacts(incidentInput(), realSpatial);
    const b = deriveIncidentFacts(incidentInput(), realSpatial);
    if (!isOk(a) || !isOk(b)) throw new Error('expected ok');
    expect(JSON.stringify(a.value.predictions)).toBe(JSON.stringify(b.value.predictions));
  });
});

describe('deriveIncidentFacts — storm exposure wiring (FR-STORM-3 ranked priorities)', () => {
  it('surges into the exposure fact + ranked priorities like any other impact footprint', () => {
    const res = deriveIncidentFacts(
      incidentInput({ hazards: [stormHazard('STORM_SURGE')] }),
      realSpatial,
    );
    if (!isOk(res)) throw new Error('expected ok');
    const byField = new Map(res.value.facts.map((f) => [f.field, f.claim]));
    expect(byField.get('exposure')).toContain('2 electrical substations');
    expect(byField.get('priorities')).toContain('n-south');
  });

  it('reports zero exposure — and therefore no priorities — from a cone alone', () => {
    const res = deriveIncidentFacts(incidentInput({ hazards: [stormHazard('CONE')] }), realSpatial);
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.facts.map((f) => f.field)).toEqual(['exposure']);
    expect(res.value.facts[0]!.claim).toContain('0 electrical substations');
  });
});

// ── Air-quality threshold fact (S3 Lane A — the P17 trio's consumer, closing F-52) ─────────────────
//
// Art. XII, both rungs: rung 1 states a SOURCE-published AQI + category verbatim (AirNow) when the
// category is at/above UNHEALTHY_SENSITIVE (AQI ≥ 101); rung 2 compares a raw PM2.5 µg/m³ concentration
// (OpenAQ / Sensor.Community) to a FIXED constant (35.5 µg/m³ — the same severity band) and states value +
// verbatim unit + the constant, WITHOUT ever deriving a category from the concentration. Below threshold
// (or absent input) ⇒ no fact at all — clean air is silence, never a filler row.

function aqReading(over: Partial<AirQualityReading> = {}): AirQualityReading {
  return {
    stationId: 'openaq:1592',
    stationName: 'Omak-Colville Tribe',
    position: [-119.52, 48.4],
    pollutant: 'PM25',
    value: 12,
    unit: 'µg/m³',
    observedAt: COMPUTED_AT,
    sourceId: asId<SourceId>('sr-aq-1'),
    ...over,
  };
}
const aqGrounding = (source: string) => ({
  field: 'airQuality',
  sourceId: asId<SourceId>(source),
  citationId: asId<CitationId>(`cit-air-quality-${source}`),
});
const aqInput = (readings: readonly AirQualityReading[], source = 'openaq') =>
  incidentInput({ airQuality: { readings, grounding: aqGrounding(source) } });

describe('deriveIncidentFacts — air-quality threshold fact (P17 consumer, Art. XII)', () => {
  it('emits NO fact when no airQuality input is supplied (absent data = silence, not a filler row)', () => {
    const res = deriveIncidentFacts(incidentInput(), realSpatial);
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.facts.map((f) => f.field)).not.toContain('airQuality');
  });

  it('emits NO fact below threshold — neither a low concentration nor a MODERATE source index fires', () => {
    const res = deriveIncidentFacts(
      aqInput([
        aqReading({ value: 35.4 }), // one decimal under the 35.5 µg/m³ constant — boundary is exact
        // Concentration 55 > 35.5, but the SOURCE'S OWN index says MODERATE — rung 2 must never overrule a
        // published index from the raw concentration (their averaging window, their judgement).
        aqReading({
          stationId: 'airnow:1',
          value: 55,
          unit: 'UG/M3',
          aqi: 98,
          aqiCategory: 'MODERATE',
        }),
      ]),
      realSpatial,
    );
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.facts.map((f) => f.field)).not.toContain('airQuality');
  });

  it('states the SOURCE-published AQI + category verbatim when the category is at/above the threshold', () => {
    const res = deriveIncidentFacts(
      aqInput(
        [
          aqReading({
            stationId: 'airnow:530470013',
            value: 205,
            unit: 'UG/M3',
            aqi: 284,
            aqiCategory: 'VERY_UNHEALTHY',
          }),
        ],
        'airnow',
      ),
      realSpatial,
    );
    if (!isOk(res)) throw new Error('expected ok');
    const fact = res.value.facts.find((f) => f.field === 'airQuality')!;
    expect(fact.claim).toContain('PM2.5 AQI 284 (Very Unhealthy)');
    expect(fact.claim).toContain('Omak-Colville Tribe'); // cited to the station, not asserted bare
    expect(fact.claim).toContain('source-published index');
    expect(String(fact.sourceId)).toBe('airnow'); // the serving AQ adapter, never the hazard source
    expect(String(fact.citationId)).toBe('cit-air-quality-airnow');
  });

  it('states value + verbatim unit + the fixed constant for a concentration-only source — and NO category', () => {
    const res = deriveIncidentFacts(
      aqInput([aqReading({ value: 116.9 })], 'sensorcommunity'),
      realSpatial,
    );
    if (!isOk(res)) throw new Error('expected ok');
    const fact = res.value.facts.find((f) => f.field === 'airQuality')!;
    expect(fact.claim).toContain('PM2.5 116.9 µg/m³');
    expect(fact.claim).toContain('35.5 µg/m³'); // BEACON's fixed constant, named as BEACON's
    expect(fact.claim).toContain("BEACON's fixed");
    // Deriving a category from a raw concentration is the invented conversion ports/air-quality.ts forbids.
    for (const label of ['Unhealthy', 'Hazardous', 'Moderate', 'Good'])
      expect(fact.claim).not.toContain(label);
    expect(String(fact.sourceId)).toBe('sensorcommunity');
  });

  it('the WORST reading wins within a slice (max source-published AQI; max concentration on rung 2)', () => {
    const indexed = deriveIncidentFacts(
      aqInput(
        [
          aqReading({
            stationId: 'airnow:a',
            stationName: 'A',
            value: 96.6,
            unit: 'UG/M3',
            aqi: 200,
            aqiCategory: 'UNHEALTHY',
          }),
          aqReading({
            stationId: 'airnow:b',
            stationName: 'B',
            value: 205,
            unit: 'UG/M3',
            aqi: 284,
            aqiCategory: 'VERY_UNHEALTHY',
          }),
        ],
        'airnow',
      ),
      realSpatial,
    );
    if (!isOk(indexed)) throw new Error('expected ok');
    expect(indexed.value.facts.find((f) => f.field === 'airQuality')!.claim).toContain('AQI 284');
    expect(indexed.value.facts.find((f) => f.field === 'airQuality')!.claim).toContain('at B');

    const conc = deriveIncidentFacts(
      aqInput([
        aqReading({ value: 40.1 }),
        aqReading({ stationId: 'sc:2', stationName: 'C', value: 116.9 }),
      ]),
      realSpatial,
    );
    if (!isOk(conc)) throw new Error('expected ok');
    expect(conc.value.facts.find((f) => f.field === 'airQuality')!.claim).toContain('116.9');
  });

  it('a source-published index outranks a co-served raw concentration (the official statement wins)', () => {
    const res = deriveIncidentFacts(
      aqInput(
        [
          aqReading({ value: 300 }), // huge raw concentration, no published index
          aqReading({
            stationId: 'airnow:x',
            stationName: 'X',
            value: 60,
            unit: 'UG/M3',
            aqi: 153,
            aqiCategory: 'UNHEALTHY',
          }),
        ],
        'airnow',
      ),
      realSpatial,
    );
    if (!isOk(res)) throw new Error('expected ok');
    const claim = res.value.facts.find((f) => f.field === 'airQuality')!.claim;
    expect(claim).toContain('AQI 153');
    expect(claim).not.toContain('300');
  });

  it('never thresholds a non-µg/m³ unit — no cross-unit conversion, so no fact (honest omission)', () => {
    const res = deriveIncidentFacts(
      aqInput([aqReading({ pollutant: 'O3', value: 900, unit: 'ppb' })]),
      realSpatial,
    );
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.facts.map((f) => f.field)).not.toContain('airQuality');
  });
});
