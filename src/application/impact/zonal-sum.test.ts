// BEACON — zonal-sum engine tests (MW-D/D1; ADR-035 §1 + V1/V2). Analytic fixtures only: a polygon covering
// exactly N whole cells sums to Σ, a half-covered cell contributes half its count, a polygon outside the
// cells contributes nothing AND says nothing was considered, and the result is invariant to the ORDER the
// cells arrive in (the reproducibility property acceptance test 5 requires).
import { describe, it, expect } from 'vitest';
import type { Geometry, Position } from '@/domain/value-objects/geo.js';
import { isErr, isOk } from '@/domain/shared/result.js';
import { zonalSum, type PopulationCell } from './zonal-sum.js';

const rect = (minX: number, minY: number, maxX: number, maxY: number): Geometry => ({
  type: 'Polygon',
  coordinates: [
    [
      [minX, minY],
      [maxX, minY],
      [maxX, maxY],
      [minX, maxY],
      [minX, minY],
    ] as readonly Position[],
  ],
});

/** A 2x2 lattice of unit cells over [0,2]x[0,2], 100 residents each. */
const GRID: readonly PopulationCell[] = [
  { bbox: [0, 0, 1, 1], count: 100 },
  { bbox: [1, 0, 2, 1], count: 100 },
  { bbox: [0, 1, 1, 2], count: 100 },
  { bbox: [1, 1, 2, 2], count: 100 },
];

function sum(cells: readonly PopulationCell[], geoms: readonly Geometry[]) {
  const res = zonalSum(cells, geoms);
  if (!isOk(res)) throw new Error(`expected ok, got ${res.error.message}`);
  return res.value;
}

describe('zonalSum', () => {
  it('a polygon covering exactly two whole cells sums to their counts', () => {
    const s = sum(GRID, [rect(0, 0, 2, 1)]);
    expect(s.weighted).toBeCloseTo(200, 9);
    expect(s.cellsContributing).toBe(2);
    expect(s.cellsConsidered).toBe(2); // the two upper cells do not even meet the extent bounds
    expect(s.cellTotal).toBe(200);
    expect(s.coveredFraction).toBeCloseTo(1, 9);
  });

  it('a half-covered cell contributes exactly half its count', () => {
    const s = sum(GRID, [rect(0, 0, 0.5, 1)]);
    expect(s.weighted).toBeCloseTo(50, 9);
    expect(s.coveredFraction).toBeCloseTo(0.5, 9);
  });

  it('a polygon entirely INSIDE one cell contributes that cell’s area share', () => {
    const s = sum(GRID, [rect(0.25, 0.25, 0.75, 0.75)]);
    expect(s.weighted).toBeCloseTo(25, 9);
    expect(s.cellsContributing).toBe(1);
  });

  it('a polygon covering the whole lattice sums to the whole population', () => {
    expect(sum(GRID, [rect(-10, -10, 10, 10)]).weighted).toBeCloseTo(400, 9);
  });

  it('SEVERAL geometries are pre-filtered by their UNION bounds, and combined without double counting', () => {
    // Two disjoint footprints, one over each lower cell ⇒ both cells considered, 200 residents in total.
    const two = sum(GRID, [rect(0, 0, 1, 1), rect(1, 0, 2, 1)]);
    expect(two.cellsConsidered).toBe(2);
    expect(two.weighted).toBeCloseTo(200, 9);
    // Two OVERLAPPING footprints over the same cell ⇒ still 100, not 200 (the max-combination rule).
    const overlapping = sum(GRID, [rect(0, 0, 1, 1), rect(0, 0, 0.5, 1)]);
    expect(overlapping.weighted).toBeCloseTo(100, 9);
    // A CORRUPT geometry among usable ones is a loud error, never a silent shrink of the extent: dropping it
    // would quietly reduce the number of people counted at risk.
    expect(
      isErr(
        zonalSum(GRID, [rect(Number.NaN, Number.NaN, Number.NaN, Number.NaN), rect(0, 0, 1, 1)]),
      ),
    ).toBe(true);
  });

  it('a polygon OUTSIDE the cells considers nothing — an unserved rung, not a confident zero', () => {
    const s = sum(GRID, [rect(50, 50, 51, 51)]);
    expect(s.weighted).toBe(0);
    expect(s.cellsConsidered).toBe(0);
    expect(s.coveredFraction).toBe(0);
  });

  it('no cells, no geometries, and a non-areal geometry all yield the empty sum', () => {
    expect(sum([], [rect(0, 0, 1, 1)]).cellsConsidered).toBe(0);
    expect(sum(GRID, []).cellsConsidered).toBe(0);
    expect(sum(GRID, [{ type: 'Point', coordinates: [0.5, 0.5] }]).cellsConsidered).toBe(0);
    // …but a geometry whose coordinates are non-finite is an ERROR, not an empty sum (see above).
    expect(isErr(zonalSum(GRID, [rect(Number.NaN, Number.NaN, Number.NaN, Number.NaN)]))).toBe(
      true,
    );
    // A polygon with NO coordinates at all is the same class of corrupt input.
    expect(isErr(zonalSum(GRID, [{ type: 'Polygon', coordinates: [] }]))).toBe(true);
  });

  it('skips unusable cells: a negative/NaN count and a zero-area cell', () => {
    const cells: readonly PopulationCell[] = [
      { bbox: [0, 0, 1, 1], count: -5 },
      { bbox: [0, 0, 1, 1], count: Number.NaN },
      { bbox: [0, 0, 0, 1], count: 999 },
      { bbox: [0, 0, 1, 1], count: 100 },
    ];
    const s = sum(cells, [rect(0, 0, 2, 2)]);
    expect(s.weighted).toBeCloseTo(100, 9);
    expect(s.cellsConsidered).toBe(1);
  });

  it('a cell inside the UNION bounds but touched by NO geometry is considered and contributes nothing', () => {
    // Two diagonal footprints: their union bounds cover the whole lattice, but the lower-right cell meets
    // each of them only along an edge, so it is consulted and then correctly weighted at zero.
    const s = sum(GRID, [rect(0, 0, 1, 1), rect(1, 1, 2, 2)]);
    expect(s.cellsConsidered).toBe(4);
    expect(s.cellsContributing).toBe(2);
    expect(s.weighted).toBeCloseTo(200, 9);
    expect(s.cellTotal).toBe(400);
    expect(s.coveredFraction).toBeCloseTo(0.5, 9);
  });

  it('propagates a clip error rather than returning a partial sum', () => {
    const badRing: Geometry = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 1],
        ] as readonly Position[],
      ],
    };
    expect(isErr(zonalSum(GRID, [badRing]))).toBe(true);
  });

  it('is REPRODUCIBLE: identical inputs and any permutation of the cell list give the identical figure', () => {
    const geoms = [rect(0.25, 0.25, 1.75, 1.75)];
    const a = sum(GRID, geoms).weighted;
    expect(sum(GRID, geoms).weighted).toBe(a);
    const permutations = [
      [GRID[3]!, GRID[2]!, GRID[1]!, GRID[0]!],
      [GRID[1]!, GRID[3]!, GRID[0]!, GRID[2]!],
    ];
    for (const perm of permutations) expect(sum(perm, geoms).weighted).toBeCloseTo(a, 9);
  });
});
