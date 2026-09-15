// BEACON — live threshold signals (ADR-044). Every reading below is COMPUTED from geometry the test
// places; the assertions pin what fires, what never fires, and that the evaluator's state carries over.
import { describe, expect, it } from 'vitest';
import { makeHazardGeometry } from '@/domain/hazard-geometry.js';
import { makeInfrastructureNode } from '@/domain/infrastructure-node.js';
import { makeGauge } from '@/domain/gauge.js';
import { makeThresholdRule } from '@/domain/threshold-rule.js';
import { asId } from '@/domain/value-objects/ids.js';
import type {
  GaugeId,
  HazardGeometryId,
  IncidentId,
  InfrastructureNodeId,
  SourceId,
  ThresholdRuleId,
} from '@/domain/value-objects/ids.js';
import type { SpatialPort } from '@/ports/infra.js';
import type { InfraNodeType } from '@/domain/infrastructure-node.js';
import type { BBox, Geometry, Position } from '@/domain/value-objects/geo.js';
import { err, ok } from '@/domain/shared/result.js';
import { InvariantViolation } from '@/domain/errors.js';
import { deriveDraftAlertProposals } from '@/application/derivation/derive-alerts.js';
import {
  clusterFootprint,
  liveAlertId,
  liveThresholdSpecs,
  nextRuleStates,
} from './live-signals.js';

const NOW = '2026-09-14T10:00:00Z';

// A deterministic SpatialPort (the same shape derive-cop.test.ts uses): ray-cast inside, a degree-box
// buffer, bbox intersection. Application tests import ports only, never the Turf adapter.
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
  let [a, b, c, d] = [Infinity, Infinity, -Infinity, -Infinity];
  const visit = (n: unknown): void => {
    if (Array.isArray(n) && typeof n[0] === 'number' && typeof n[1] === 'number') {
      a = Math.min(a, n[0]);
      c = Math.max(c, n[0]);
      b = Math.min(b, n[1]);
      d = Math.max(d, n[1]);
    } else if (Array.isArray(n)) for (const child of n) visit(child);
  };
  visit(geom.coordinates);
  return [a, b, c, d];
}
const spatial: SpatialPort = {
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
    const A = bboxOf(x);
    const B = bboxOf(y);
    return ok(!(A[2] < B[0] || A[0] > B[2] || A[3] < B[1] || A[1] > B[3]));
  },
};
const BUFFERS: Readonly<Record<InfraNodeType, number>> = {
  HOSPITAL: 2000,
  NURSING_HOME: 2000,
  POWER: 1000,
  CELL: 1000,
  ROAD: 500,
  RAIL: 500,
  SHELTER: 1500,
};

const hotspot = (id: string, lon: number, lat: number) =>
  makeHazardGeometry({
    id: asId<HazardGeometryId>(id),
    incidentId: asId<IncidentId>('firms-unassigned'),
    sourceId: asId<SourceId>('sr-firms-1'),
    kind: 'HOTSPOT',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    observedAt: NOW,
  });
const node = (id: string, lon: number, lat: number) =>
  makeInfrastructureNode({
    id: asId<InfrastructureNodeId>(id),
    type: 'HOSPITAL',
    geom: { type: 'Point', coordinates: [lon, lat] },
  });
const rule = (
  id: string,
  target: 'HAZARD_BUFFER' | 'GAUGE_CATEGORY' | 'FORECAST_GAUGE_CATEGORY',
  operator: 'enters' | 'gte' | 'crosses',
  value: string,
) =>
  makeThresholdRule({
    id: asId<ThresholdRuleId>(id),
    scope: asId('us-ca'),
    target,
    operator,
    value,
  });

const fire = {
  id: asId<IncidentId>('discovered:us-ca:WILDFIRE:-487:158'),
  type: 'WILDFIRE',
  hazards: [hotspot('h1', -121.6, 39.7), hotspot('h2', -121.61, 39.71)],
  sourceId: asId<SourceId>('firms'),
};
const flood = {
  id: asId<IncidentId>('discovered:ro:FLOOD:112:181'),
  type: 'FLOOD',
  hazards: [hotspot('f1', 28.0, 45.4)],
  sourceId: asId<SourceId>('gdacs'),
};
const base = {
  buffers: BUFFERS,
  gauges: [],
  computedAt: NOW,
  spatial,
  previous: new Map(),
};

describe('HAZARD_BUFFER — hotspots against lifeline nodes', () => {
  const within = rule('ca-hazard-buffer', 'HAZARD_BUFFER', 'enters', '2000');

  it('reads true when a node is inside the rule’s distance of the incident’s hazards, false when it is not', () => {
    const near = liveThresholdSpecs({
      ...base,
      rules: [within],
      incidents: [fire],
      infrastructure: [node('n-near', -121.605, 39.704)],
    });
    expect(near).toHaveLength(1);
    expect(near[0]!.reading.hazardWithinBuffer).toBe(true);
    expect(String(near[0]!.alertId)).toBe(`live:ca-hazard-buffer:${String(fire.id)}`);
    expect(near[0]!.category).toBe('Fire');
    expect(near[0]!.severity).toBe('SEVERE');
    expect(String(near[0]!.sourceId)).toBe('firms');
    const far = liveThresholdSpecs({
      ...base,
      rules: [within],
      incidents: [fire],
      infrastructure: [node('n-far', -121.9, 39.9)],
    });
    expect(far[0]!.reading.hazardWithinBuffer).toBe(false);
  });

  it('a true reading proposes a DRAFT through the existing evaluator; a false one does not', () => {
    const near = liveThresholdSpecs({
      ...base,
      rules: [within],
      incidents: [fire],
      infrastructure: [node('n', -121.605, 39.704)],
    });
    const proposals = deriveDraftAlertProposals({ specs: near, now: Date.parse(NOW) });
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.alert.capStatus).toBe('DRAFT'); // Art. XIII: never more than a draft from here
    expect(String(proposals[0]!.alert.incidentId)).toBe(String(fire.id));
    const far = liveThresholdSpecs({
      ...base,
      rules: [within],
      incidents: [fire],
      infrastructure: [node('n', -121.9, 39.9)],
    });
    expect(deriveDraftAlertProposals({ specs: far, now: Date.parse(NOW) })).toHaveLength(0);
  });

  it('no lifeline nodes, no hazards, or a rule value that is not a distance ⇒ no spec (nothing to read)', () => {
    expect(
      liveThresholdSpecs({ ...base, rules: [within], incidents: [fire], infrastructure: [] }),
    ).toHaveLength(0);
    expect(
      liveThresholdSpecs({
        ...base,
        rules: [within],
        incidents: [{ ...fire, hazards: [] }],
        infrastructure: [node('n', -121.6, 39.7)],
      }),
    ).toHaveLength(0);
    // The live table holds `1000m`; a kilometre value converts; a value that overflows is not a distance.
    const near = node('n', -121.605, 39.704);
    const metres = rule('r-m', 'HAZARD_BUFFER', 'enters', '1000m');
    expect(
      liveThresholdSpecs({
        ...base,
        rules: [metres],
        incidents: [fire],
        infrastructure: [near],
      })[0]!.reading.hazardWithinBuffer,
    ).toBe(true);
    const km = rule('r-km', 'HAZARD_BUFFER', 'enters', '2 km');
    expect(
      liveThresholdSpecs({ ...base, rules: [km], incidents: [fire], infrastructure: [near] })[0]!
        .reading.hazardWithinBuffer,
    ).toBe(true);
    const huge = rule('r-huge', 'HAZARD_BUFFER', 'enters', '1' + '0'.repeat(400) + ' km');
    expect(
      liveThresholdSpecs({ ...base, rules: [huge], incidents: [fire], infrastructure: [near] }),
    ).toHaveLength(0);
    const bad = rule('r-bad', 'HAZARD_BUFFER', 'enters', 'near');
    expect(
      liveThresholdSpecs({
        ...base,
        rules: [bad],
        incidents: [fire],
        infrastructure: [node('n', -121.6, 39.7)],
      }),
    ).toHaveLength(0);
  });
});

describe('GAUGE_CATEGORY — the region’s worst observed gauge, for floods', () => {
  const moderate = rule('ro-gauge-moderate', 'GAUGE_CATEGORY', 'gte', 'MODERATE');
  const gauges = [
    makeGauge({
      id: asId<GaugeId>('g1'),
      geom: { type: 'Point', coordinates: [28.0, 45.4] },
      floodCategory: 'MINOR',
    }),
    makeGauge({
      id: asId<GaugeId>('g2'),
      geom: { type: 'Point', coordinates: [28.1, 45.5] },
      floodCategory: 'MODERATE',
    }),
  ];

  it('reads the highest category for a FLOOD incident and none for a WILDFIRE', () => {
    const specs = liveThresholdSpecs({
      ...base,
      rules: [moderate],
      incidents: [flood, fire],
      infrastructure: [],
      gauges,
    });
    expect(specs).toHaveLength(1);
    expect(String(specs[0]!.incidentId)).toBe(String(flood.id));
    expect(specs[0]!.reading.floodCategory).toBe('MODERATE');
    expect(specs[0]!.category).toBe('Met');
    expect(specs[0]!.severity).toBe('SEVERE');
  });

  it('MAJOR is EXTREME, anything below MODERATE is MODERATE; no gauges ⇒ no spec', () => {
    const major = rule('r-major', 'GAUGE_CATEGORY', 'gte', 'MAJOR');
    const minor = rule('r-minor', 'GAUGE_CATEGORY', 'gte', 'MINOR');
    const specs = liveThresholdSpecs({
      ...base,
      rules: [major, minor],
      incidents: [flood],
      infrastructure: [],
      gauges,
    });
    expect(specs.map((s) => s.severity)).toEqual(['EXTREME', 'MODERATE']);
    expect(
      liveThresholdSpecs({
        ...base,
        rules: [major],
        incidents: [flood],
        infrastructure: [],
        gauges: [],
      }),
    ).toHaveLength(0);
  });
});

describe('what is deliberately not read', () => {
  it('FORECAST_GAUGE_CATEGORY has no live reading — a forecast category is not derived from a crest figure', () => {
    const forecast = rule('ro-forecast-major', 'FORECAST_GAUGE_CATEGORY', 'crosses', 'MAJOR');
    expect(
      liveThresholdSpecs({
        ...base,
        rules: [forecast],
        incidents: [flood],
        infrastructure: [],
        gauges: [],
      }),
    ).toHaveLength(0);
  });
});

describe('runtime state across cycles', () => {
  it('nextRuleStates returns the evaluator’s state per alert, and a second cycle carries it as previous', () => {
    const within = rule('ca-hazard-buffer', 'HAZARD_BUFFER', 'enters', '2000');
    const first = liveThresholdSpecs({
      ...base,
      rules: [within],
      incidents: [fire],
      infrastructure: [node('n', -121.605, 39.704)],
    });
    const state = nextRuleStates(first, Date.parse(NOW));
    expect(state.has(String(liveAlertId(within, fire.id)))).toBe(true);
    const second = liveThresholdSpecs({
      ...base,
      previous: state,
      rules: [within],
      incidents: [fire],
      infrastructure: [node('n', -121.605, 39.704)],
    });
    expect(second[0]!.previous).toBeDefined();
    // Still inside: an `enters` rule does not fire again on the same episode.
    expect(
      deriveDraftAlertProposals({ specs: second, now: Date.parse(NOW) + 60_000 }),
    ).toHaveLength(0);
    // The third cycle's state is derived from the second's (firedForEpisode carried, not reset).
    const later = nextRuleStates(second, Date.parse(NOW) + 60_000);
    expect(later.get(String(liveAlertId(within, fire.id)))?.firedForEpisode).toBe(true);
  });
});

describe('clusterFootprint', () => {
  it('is the bounding rectangle of every vertex, padded when the cluster is a point', () => {
    const fp = clusterFootprint([hotspot('a', -121.6, 39.7), hotspot('b', -121.5, 39.8)]);
    expect(fp?.coordinates[0]).toEqual([
      [-121.6, 39.7],
      [-121.5, 39.7],
      [-121.5, 39.8],
      [-121.6, 39.8],
      [-121.6, 39.7],
    ]);
    const dot = clusterFootprint([hotspot('a', -121.6, 39.7)]);
    expect(dot?.coordinates[0]?.[0]?.[0]).toBeCloseTo(-121.601, 9);
    expect(dot?.coordinates[0]?.[0]?.[1]).toBeCloseTo(39.699, 9);
    expect(clusterFootprint([])).toBeUndefined();
  });

  it('takes every vertex of a perimeter polygon, not only points', () => {
    const perimeter = makeHazardGeometry({
      id: asId<HazardGeometryId>('p'),
      incidentId: asId<IncidentId>('firms-unassigned'),
      sourceId: asId<SourceId>('sr-nifc-1'),
      kind: 'PERIMETER',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-121.7, 39.6],
            [-121.5, 39.6],
            [-121.5, 39.8],
            [-121.7, 39.8],
            [-121.7, 39.6],
          ],
        ],
      },
      observedAt: NOW,
    });
    expect(clusterFootprint([perimeter, hotspot('a', -121.4, 39.7)])?.coordinates[0]).toEqual([
      [-121.7, 39.6],
      [-121.4, 39.6],
      [-121.4, 39.8],
      [-121.7, 39.8],
      [-121.7, 39.6],
    ]);
  });
});

describe('a failing spatial port', () => {
  it('yields no spec rather than a guessed reading', () => {
    const within = rule('ca-hazard-buffer', 'HAZARD_BUFFER', 'enters', '2000');
    const broken: SpatialPort = {
      ...spatial,
      intersect: () => err(new InvariantViolation('intersect boom')),
    };
    expect(
      liveThresholdSpecs({
        ...base,
        spatial: broken,
        rules: [within],
        incidents: [fire],
        infrastructure: [node('n', -121.605, 39.704)],
      }),
    ).toHaveLength(0);
  });
});
