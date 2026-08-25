// BEACON — composed predicted-impact tests (MW-D/D1; ADR-035 §1/§2/§3). Covers the composition rules
// (an unsupported quantification is ABSENT, never zero), the resolution gate that protects the resident
// limb, and above all the CLAIM SENTENCES — which is where finding F-23's honesty defect lived.
import { describe, it, expect } from 'vitest';
import type { SpatialPort } from '@/ports/index.js';
import type { DomainError } from '@/domain/errors.js';
import { DomainError as DomainErrorClass } from '@/domain/errors.js';
import type { Result } from '@/domain/shared/result.js';
import { err, isErr, isOk, ok } from '@/domain/shared/result.js';
import type { Geometry, PolygonGeometry, Position } from '@/domain/value-objects/geo.js';
import { makeShelter } from '@/domain/shelter.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { ShelterId } from '@/domain/value-objects/ids.js';
import {
  affectedPopulationClaim,
  alertReachClaim,
  computePredictedImpact,
  populationResolutionOf,
  shelterDemandClaim,
  type PredictedImpactInput,
} from './predicted-impact.js';
import { estimateAffectedPopulation } from './affected-population.js';
import { DEFAULT_IMPACT_PARAMS } from './impact-params.js';
// The public barrel is the seam every consumer imports through — exercised here so it cannot rot unnoticed.
import * as impactBarrel from './index.js';
import { parsePopulationGrid, type PopulationGrid } from './population-grid.js';

/**
 * A deterministic even-odd ray-cast stand-in for the Turf-backed `SpatialPort` — the same local test double
 * `derive-cop.test.ts` uses, so inside/outside is real geometry rather than a stub returning a constant.
 */
function inRing(pt: Position, ring: readonly Position[]): boolean {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const spatial: SpatialPort = {
  pointInPolygon: (pt: Position, polygon: PolygonGeometry): Result<boolean, DomainError> =>
    ok(inRing(pt, polygon.coordinates[0] ?? [])),
  buffer: () => err(new DomainErrorClass('INVARIANT_VIOLATION', 'not used')),
  intersect: () => err(new DomainErrorClass('INVARIANT_VIOLATION', 'not used')),
};

const rect = (minX: number, minY: number, maxX: number, maxY: number): Geometry => ({
  type: 'Polygon',
  coordinates: [[[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY]] as readonly Position[]],
});

const GRID: PopulationGrid = (() => {
  const res = parsePopulationGrid({
    version: 1,
    id: 'fixture-grid',
    bbox: [0, 0, 2, 2],
    cellSizeDeg: 1,
    cols: 2,
    rows: 2,
    quantumPersons: 1000,
    counts: [1, 1, 1, 1],
    provenance: {
      product: 'WorldPop wpgppop',
      vintage: '2020',
      resolutionLabel: '~100 m',
      licence: 'CC BY 4.0',
      disaggregation: 'native product cells area-summed to the grid cell',
      limitation: 'Modelled residential population.',
    },
  });
  if (!isOk(res)) throw new Error('fixture grid must parse');
  return res.value;
})();

const BASE: PredictedImpactInput = {
  extentKind: 'PREDICTED_EXTENT',
  extentLabel: 'predicted extent (FIRE_CONE)',
  geometries: [rect(0, 0, 1, 1)],
  population: { planningSeed: 3200, grid: GRID },
};

function impact(over: Partial<PredictedImpactInput> = {}) {
  const res = computePredictedImpact({ ...BASE, ...over }, spatial);
  if (!isOk(res)) throw new Error(`expected ok, got ${res.error.message}`);
  return res.value;
}

describe('composition — an unsupported quantification is ABSENT, never present-and-zero', () => {
  it('always produces the affected figure, and nothing else without its inputs', () => {
    const r = impact();
    expect(r.affected.count).toBe(1000);
    expect(r.alertReach).toBeUndefined();
    expect(r.shelterDemand).toBeUndefined();
  });

  it('adds alert reach only when cell sites are supplied, and shelter demand only when shelters are', () => {
    expect(impact({ cellSites: [] }).alertReach).toBeDefined();
    expect(impact({ shelters: [] }).shelterDemand).toBeDefined();
  });

  it('the shelter figure consumes the AFFECTED figure, so the two can never disagree', () => {
    const r = impact({ shelters: [] });
    expect(r.shelterDemand!.inputs).toMatchObject({ affectedCount: r.affected.count });
  });

  it('propagates an error from any stage rather than publishing a partial result', () => {
    const badRing: Geometry = { type: 'Polygon', coordinates: [[[0, 0], [1, 1]] as readonly Position[]] };
    expect(isErr(computePredictedImpact({ ...BASE, geometries: [badRing] }, spatial))).toBe(true);
    const failing: SpatialPort = { ...spatial, pointInPolygon: () => err(new DomainErrorClass('PARSE_ERROR', 'down')) };
    expect(isErr(computePredictedImpact({ ...BASE, cellSites: [{ position: [0.5, 0.5], online: true }] }, failing))).toBe(true);
  });

  it('threads an injected parameter set through EVERY quantification', () => {
    const params = { ...DEFAULT_IMPACT_PARAMS, parameterSetId: 'local-study-2026' };
    const r = impact({ shelters: [], cellSites: [], leadTimeHours: 12, params });
    expect(r.affected.inputs['parameterSetId']).toBe('local-study-2026');
    expect(r.alertReach!.inputs['parameterSetId']).toBe('local-study-2026');
    expect(r.shelterDemand!.parameterSetId).toBe('local-study-2026');
    expect(r.shelterDemand!.leadTimeHours).toBe(12);
    // …and without one, every quantification falls back to the SAME shipped set.
    const shipped = impact({ shelters: [], cellSites: [] });
    expect(shipped.shelterDemand!.parameterSetId).toBe(shipped.affected.inputs['parameterSetId']);
  });
});

describe('populationResolutionOf — the gate that protects the resident limb', () => {
  it('only a shipped GRID is CELL_LEVEL; served areas are AREA_LEVEL; nothing is NONE', () => {
    const cell = [{ bbox: [0, 0, 1, 1] as const, count: 1 }];
    expect(populationResolutionOf('SHIPPED_GRID', cell)).toBe('CELL_LEVEL');
    expect(populationResolutionOf('SHIPPED_GRID', [])).toBe('NONE');
    expect(populationResolutionOf('CLIPPED_AREA_ESTIMATE', cell)).toBe('AREA_LEVEL');
    expect(populationResolutionOf('AREA_TOTAL', cell)).toBe('AREA_LEVEL');
    expect(populationResolutionOf('PLANNING_SEED', [])).toBe('NONE');
  });

  it('an AREA-served figure therefore publishes NO resident-loss number', () => {
    const r = impact({
      population: { planningSeed: 3200, areaEstimates: [{ bbox: [0, 0, 2, 2], count: 4000 }] },
      cellSites: [{ position: [0.5, 0.5], online: true }],
    });
    expect(r.alertReach!.populationResolution).toBe('AREA_LEVEL');
    expect(r.alertReach!.residentsLosingCellularReach).toBeUndefined();
  });
});

// ── The claim sentences — where finding F-23 actually lived ──────────────────────────────────────────

function affected(over: Parameters<typeof estimateAffectedPopulation>[0]) {
  const res = estimateAffectedPopulation(over);
  if (!isOk(res)) throw new Error('expected ok');
  return res.value;
}

describe('affectedPopulationClaim (F-23)', () => {
  const clipped = () => affected({ geometries: [rect(0, 0, 1, 1)], extentLabel: 'x', population: { planningSeed: 3200, grid: GRID } });
  const unclipped = () => affected({ geometries: [], extentLabel: 'x', population: { planningSeed: 3200 } });

  it('a CLIPPED figure may say "within the exposed area", and names the method that bounded it', () => {
    const claim = affectedPopulationClaim(clipped(), 'CURRENT_HAZARD');
    expect(claim).toContain('1000 residents within the exposed area');
    expect(claim).toContain('area-weighted zonal sum over the shipped population grid');
    expect(claim).not.toContain('NOT clipped');
  });

  it('an UNCLIPPED figure says REGION-WIDE, in those words, and never "within the exposed area"', () => {
    const claim = affectedPopulationClaim(unclipped(), 'CURRENT_HAZARD');
    expect(claim).toContain('a region-wide estimate, NOT clipped to the exposed area');
    expect(claim).not.toMatch(/residents within the exposed area/);
  });

  it('a PREDICTED extent says "the predicted extent", not "the exposed area"', () => {
    expect(affectedPopulationClaim(clipped(), 'PREDICTED_EXTENT')).toContain('within the predicted extent');
    expect(affectedPopulationClaim(unclipped(), 'PREDICTED_EXTENT')).toContain('NOT clipped to the predicted extent');
  });

  it('a SUPPRESSED figure publishes the bucket in the sentence, never the exact small count', () => {
    const small = affected({
      geometries: [rect(0, 0, 0.05, 0.05)],
      extentLabel: 'x',
      population: { planningSeed: 3200, areaEstimates: [{ bbox: [0, 0, 2, 2], count: 4000 }] },
    });
    expect(affectedPopulationClaim(small, 'CURRENT_HAZARD')).toContain('Approximately <10 residents');
  });
});

describe('alertReachClaim (ADR-035 V6 — the caveat is part of the sentence)', () => {
  it('carries the geometric-proxy caveat inside the claim, so no renderer can drop it', () => {
    const r = impact({ cellSites: [{ position: [0.5, 0.5], online: true }, { position: [5, 5], online: true }] });
    const claim = alertReachClaim(r.alertReach!);
    expect(claim).toContain('1 of 2 known cell sites');
    expect(claim).toContain(r.alertReach!.caveat);
    expect(claim).toMatch(/not an outage prediction/i);
  });

  it('says the resident figure is UNQUANTIFIED rather than zero when the data is too coarse', () => {
    const r = impact({
      population: { planningSeed: 3200, areaEstimates: [{ bbox: [0, 0, 2, 2], count: 4000 }] },
      cellSites: [{ position: [0.5, 0.5], online: true }],
    });
    expect(alertReachClaim(r.alertReach!)).toContain('not quantified');
  });

  it('reports the resident figure and the raised flag when a grid serves', () => {
    const r = impact({
      geometries: [rect(0, 0, 1, 1)],
      cellSites: [{ position: [0.5, 0.5], online: true }],
    });
    const claim = alertReachClaim(r.alertReach!);
    expect(claim).toMatch(/Approximately \d+ residents have their nearest known site inside the extent/);
    expect(claim).toContain('flagged as required');
  });

  it('with no site data at all it says the figure is ABSENT, not that there is no risk', () => {
    const claim = alertReachClaim(impact({ cellSites: [] }).alertReach!);
    expect(claim).toContain('cannot be assessed');
    expect(claim).toContain('absent figure, not an absence of risk');
  });

  it('states when the thresholds did NOT raise the flag', () => {
    const sites = [{ position: [0.5, 0.5] as Position, online: true }, ...Array.from({ length: 9 }, (_, i) => ({ position: [5 + i, 5] as Position, online: true }))];
    const claim = alertReachClaim(impact({ population: { planningSeed: 10 }, cellSites: sites }).alertReach!);
    expect(claim).toContain('not flagged by the configured thresholds');
  });
});

describe('shelterDemandClaim', () => {
  const shelters = [makeShelter({ id: asId<ShelterId>('s-1'), geom: { type: 'Point', coordinates: [0, 0] }, capacity: 500, occupancy: 100 })];

  it('names the parameter set and says every value is an operator default', () => {
    const claim = shelterDemandClaim(impact({ shelters }).shelterDemand!);
    expect(claim).toContain('Predicted shelter demand');
    expect(claim).toContain('spare places in 1 shelters');
    expect(claim).toContain('operator default, not a published literature value');
    expect(claim).toContain('the hours are a floor');
  });

  it('states the feasibility verdict only when a lead time exists, in both directions', () => {
    expect(shelterDemandClaim(impact({ shelters }).shelterDemand!)).toContain('no lead time available');
    expect(shelterDemandClaim(impact({ shelters, leadTimeHours: 72 }).shelterDemand!)).toContain('clearance fits the lead time');
    expect(shelterDemandClaim(impact({ shelters, leadTimeHours: 0 }).shelterDemand!)).toContain('clearance does NOT fit the lead time');
  });
});

describe('the public barrel', () => {
  it('re-exports every entry point a consumer needs, so nothing is reachable only by deep import', () => {
    for (const name of [
      'clipPolygonToRect',
      'zonalSum',
      'parsePopulationGrid',
      'verifyPopulationGridIntegrity',
      'DEFAULT_IMPACT_PARAMS',
      'estimateAffectedPopulation',
      'estimateAlertReach',
      'projectShelterDemand',
      'computePredictedImpact',
      'affectedPopulationClaim',
      'alertReachClaim',
      'shelterDemandClaim',
      'ALERT_REACH_CAVEAT',
    ]) {
      expect(impactBarrel, name).toHaveProperty(name);
    }
  });
});
