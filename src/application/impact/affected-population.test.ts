// BEACON — affected-population tests (MW-D/D1.1+D1.3; ADR-035 §1(a)/§1(c) + V1/V2/V3/V10; F-23/F-27).
//
// The ladder is walked rung by rung, and each rung is pinned on THREE things, not one: the number, the
// method/uncertainty labels it publishes, and whether it may be described as clipped. The last of those is
// what finding F-23 was about — an unclipped figure wearing a polygon-precise sentence.
import { describe, it, expect } from 'vitest';
import type { Geometry, Position } from '@/domain/value-objects/geo.js';
import { isOk, isErr } from '@/domain/shared/result.js';
import {
  POPULATION_METHOD_LABELS,
  POPULATION_RUNGS,
  POPULATION_RUNG_IS_CLIPPED,
  POPULATION_UNCERTAINTY_LABELS,
  estimateAffectedPopulation,
  populationCellsOf,
  type AffectedPopulationInput,
} from './affected-population.js';
import { parsePopulationGrid, type PopulationGrid } from './population-grid.js';
import type { PopulationCell } from './zonal-sum.js';
import { parseImpactParams } from './impact-params.js';
import paramsJson from '../../../config/impact-params.json';

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
    quantumPersons: 100,
    counts: [1, 1, 1, 1], // 100 residents per unit cell, 400 total
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

function figure(over: Partial<AffectedPopulationInput> = {}) {
  const res = estimateAffectedPopulation({
    geometries: [rect(0, 0, 1, 1)],
    extentLabel: 'current hazard footprint',
    population: { planningSeed: 3200 },
    ...over,
  });
  if (!isOk(res)) throw new Error(`expected ok, got ${res.error.message}`);
  return res.value;
}

describe('the population ladder (Art. XVI — every rung labelled, never a dead-end)', () => {
  it('R1 POLYGON_SOURCE: uses the count the SOURCE computed over our polygon, clipped', () => {
    const f = figure({ population: { planningSeed: 3200, polygonServed: { count: 777, sourceLabel: 'WorldPop (polygon)' } } });
    expect(f.count).toBe(777);
    expect(f.rung).toBe('POLYGON_SOURCE');
    expect(f.clipped).toBe(true);
    expect(f.populationSource).toBe('WorldPop (polygon)');
    expect(f.method).toBe(POPULATION_METHOD_LABELS.POLYGON_SOURCE);
    expect(f.uncertainty).toBe(POPULATION_UNCERTAINTY_LABELS.POLYGON_SOURCE);
  });

  it('R1 is skipped when the served count is not a usable number', () => {
    for (const count of [Number.NaN, -1]) {
      const f = figure({ population: { planningSeed: 3200, polygonServed: { count, sourceLabel: 'x' } } });
      expect(f.rung).toBe('PLANNING_SEED');
    }
  });

  it('R2 SHIPPED_GRID: area-weighted zonal sum over the grid, with the grid’s provenance as evidence', () => {
    const f = figure({ geometries: [rect(0, 0, 1, 1)], population: { planningSeed: 3200, grid: GRID } });
    expect(f.count).toBe(100); // exactly one whole cell
    expect(f.rung).toBe('SHIPPED_GRID');
    expect(f.clipped).toBe(true);
    expect(f.inputs).toMatchObject({ gridId: 'fixture-grid', gridVintage: '2020', gridTotalPopulation: 400 });
    // Half a cell contributes half its residents — the area weighting, not all-or-nothing.
    expect(figure({ geometries: [rect(0, 0, 0.5, 1)], population: { planningSeed: 3200, grid: GRID } }).count).toBe(50);
  });

  it('R2 falls through when the extent is entirely OUTSIDE the grid — never a confident zero', () => {
    const f = figure({
      geometries: [rect(50, 50, 51, 51)],
      population: { planningSeed: 3200, grid: GRID, areaEstimates: [{ bbox: [40, 40, 60, 60], count: 9000 }], areaEstimateSourceLabel: 'Census' },
    });
    expect(f.rung).toBe('CLIPPED_AREA_ESTIMATE');
    expect(f.count).toBeGreaterThan(0);
  });

  it('R3 CLIPPED_AREA_ESTIMATE: an area-weighted SHARE of a served area total, uniform density stated', () => {
    const f = figure({
      geometries: [rect(0, 0, 1, 1)],
      population: { planningSeed: 3200, areaEstimates: [{ bbox: [0, 0, 2, 2], count: 4000 }], areaEstimateSourceLabel: 'US Census ACS' },
    });
    expect(f.count).toBe(1000); // a quarter of the 2x2 area
    expect(f.rung).toBe('CLIPPED_AREA_ESTIMATE');
    expect(f.clipped).toBe(true);
    expect(f.populationSource).toBe('US Census ACS');
    expect(f.method).toMatch(/ASSUMES UNIFORM POPULATION DENSITY/);
    expect(f.inputs).toMatchObject({ uniformDensityAssumedWithinEachArea: true });
  });

  it('a clipping rung with NO cells serves nothing and the ladder falls through', () => {
    // An EMPTY served list, and a grid whose every cell is zero (so it yields no cells at all): both are
    // "the source answered, with nothing in it", which must not be published as "nobody lives here".
    expect(figure({ population: { planningSeed: 3200, areaEstimates: [] } }).rung).toBe('PLANNING_SEED');
    const emptyGrid = parsePopulationGrid({
      version: 1, id: 'empty-grid', bbox: [0, 0, 2, 2], cellSizeDeg: 1, cols: 2, rows: 2,
      quantumPersons: 100, counts: [0, 0, 0, 0], provenance: GRID.provenance,
    });
    if (!isOk(emptyGrid)) throw new Error('expected ok');
    expect(figure({ population: { planningSeed: 3200, grid: emptyGrid.value } }).rung).toBe('PLANNING_SEED');
  });

  it('R3 labels an unnamed source honestly rather than inventing one', () => {
    const f = figure({ population: { planningSeed: 3200, areaEstimates: [{ bbox: [0, 0, 2, 2], count: 4000 }] } });
    expect(f.populationSource).toBe('unlabelled population source');
  });

  // ⚠ V3 / F-23: this is the assertion that the fix is real. A hazard smaller than its region must yield a
  // STRICTLY SMALLER figure than the region total the pre-D1 code published.
  it('R3 is STRICTLY LESS than the unclipped area total for a hazard smaller than its area', () => {
    const areaEstimates: readonly PopulationCell[] = [{ bbox: [0, 0, 2, 2], count: 4000 }];
    const clipped = figure({ geometries: [rect(0, 0, 1, 1)], population: { planningSeed: 3200, areaEstimates } });
    const unclipped = figure({ geometries: [], population: { planningSeed: 3200, areaEstimates } });
    expect(clipped.count).toBeLessThan(unclipped.count);
    expect(unclipped.count).toBe(4000);
    expect(unclipped.rung).toBe('AREA_TOTAL');
    expect(unclipped.clipped).toBe(false);
    expect(unclipped.method).toMatch(/NOT clipped/);
  });

  it('R4 AREA_TOTAL: reached when there is no areal extent to clip against, and it says it is not clipped', () => {
    const f = figure({
      geometries: [{ type: 'Point', coordinates: [0.5, 0.5] }],
      population: { planningSeed: 3200, areaEstimates: [{ bbox: [0, 0, 2, 2], count: 4000 }], areaEstimateSourceLabel: 'Census' },
    });
    expect(f.rung).toBe('AREA_TOTAL');
    expect(f.count).toBe(4000);
    expect(f.inputs).toMatchObject({ clippedToExtent: false, areasSummed: 1 });
  });

  it('R4 ignores unusable area counts, and degrades to the seed when nothing positive is served', () => {
    const f = figure({
      geometries: [],
      population: { planningSeed: 3200, areaEstimates: [{ bbox: [0, 0, 2, 2], count: 0 }, { bbox: [0, 0, 1, 1], count: Number.NaN }] },
    });
    expect(f.rung).toBe('PLANNING_SEED');
    expect(f.count).toBe(3200);
  });

  it('R5 PLANNING_SEED: the total rung — always available, never described as clipped', () => {
    const f = figure();
    expect(f.rung).toBe('PLANNING_SEED');
    expect(f.count).toBe(3200);
    expect(f.clipped).toBe(false);
    expect(f.populationSource).toBe('seeded planning estimate');
    const relabelled = figure({ population: { planningSeed: 3200, planningSeedLabel: 'exercise planning figure' } });
    expect(relabelled.populationSource).toBe('exercise planning figure');
    const noSeed = figure({ population: { planningSeed: Number.NaN } });
    expect(noSeed.count).toBe(0);
  });

  it('every rung has a method label, an uncertainty label and a clipped verdict — no rung can ship unlabelled', () => {
    for (const rung of POPULATION_RUNGS) {
      expect(POPULATION_METHOD_LABELS[rung].length).toBeGreaterThan(20);
      expect(POPULATION_UNCERTAINTY_LABELS[rung].length).toBeGreaterThan(20);
      expect(typeof POPULATION_RUNG_IS_CLIPPED[rung]).toBe('boolean');
    }
  });

  it('propagates a clip error rather than publishing a partial figure', () => {
    const badRing: Geometry = { type: 'Polygon', coordinates: [[[0, 0], [1, 1]] as readonly Position[]] };
    const res = estimateAffectedPopulation({
      geometries: [badRing],
      extentLabel: 'x',
      population: { planningSeed: 100, areaEstimates: [{ bbox: [0, 0, 2, 2], count: 4000 }] },
    });
    expect(isErr(res)).toBe(true);
  });
});

describe('small-count suppression (ADR-035 §3.3 / V10)', () => {
  it('a figure below the floor publishes a BUCKET, and `count` is the floor — not the exact small number', () => {
    const f = figure({
      // 0.05° x 0.05° of a 2° x 2° area holding 4000 residents ⇒ 2.5 people, i.e. a disclosive small count.
      geometries: [rect(0, 0, 0.05, 0.05)],
      population: { planningSeed: 3200, areaEstimates: [{ bbox: [0, 0, 2, 2], count: 4000 }] },
    });
    expect(f.suppressed).toBe(true);
    expect(f.displayCount).toBe('<10');
    expect(f.count).toBe(10); // the floor, so no renderer can publish an exact small count
  });

  it('a ZERO stays zero — "nobody in the extent" is not a disclosure risk', () => {
    const f = figure({ population: { planningSeed: 0 } });
    expect(f.suppressed).toBe(false);
    expect(f.displayCount).toBe('0');
  });

  it('the floor is CONFIG, not code: raising it in an injected parameter set suppresses more', () => {
    // Re-parsed from the SHIPPED file with one value overridden, so the injected set is a real, validated
    // parameter set rather than a hand-built object that could drift from the schema.
    const shipped = paramsJson as unknown as { readonly parameters: Readonly<Record<string, unknown>> };
    const strict = parseImpactParams({
      ...(paramsJson as unknown as Record<string, unknown>),
      parameters: {
        ...shipped.parameters,
        minReportableCount: { ...(shipped.parameters['minReportableCount'] as object), value: 5000 },
      },
    });
    const f = figure({ params: strict });
    expect(f.suppressed).toBe(true);
    expect(f.displayCount).toBe('<5000');
    expect(f.inputs).toMatchObject({ minReportableCount: 5000 });
  });
});

describe('populationCellsOf', () => {
  it('prefers the grid, falls back to area estimates, and is empty when neither exists', () => {
    expect(populationCellsOf({ planningSeed: 1, grid: GRID })).toHaveLength(4);
    expect(populationCellsOf({ planningSeed: 1, areaEstimates: [{ bbox: [0, 0, 1, 1], count: 2 }] })).toHaveLength(1);
    expect(populationCellsOf({ planningSeed: 1 })).toEqual([]);
  });
});

describe('reproducibility (acceptance test 5)', () => {
  it('identical inputs give a bit-identical figure', () => {
    const input: AffectedPopulationInput = {
      geometries: [rect(0.13, 0.17, 1.31, 1.71)],
      extentLabel: 'current hazard footprint',
      population: { planningSeed: 3200, grid: GRID },
    };
    const a = estimateAffectedPopulation(input);
    const b = estimateAffectedPopulation(input);
    if (!isOk(a) || !isOk(b)) throw new Error('expected ok');
    expect(a.value).toEqual(b.value);
  });
});
