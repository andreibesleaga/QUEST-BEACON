// BEACON — geo value-object tests: the bbox area gate that keeps a region-sized question away from a
// source with a 100,000 km² allowance (WorldPop, live log 2026-09-13).
import { describe, it, expect } from 'vitest';
import { bboxAreaKm2, isPosition } from './geo.js';

describe('bboxAreaKm2', () => {
  it('never under-reports: California’s box bounds the 964,477 km² WorldPop measured for it from above', () => {
    const area = bboxAreaKm2([-124.5, 32.5, -114.1, 42.0]);
    expect(area).toBeGreaterThan(964_477);
    expect(area).toBeLessThan(1_100_000);
  });

  it('takes the width at the parallel nearest the equator — a box spanning it is measured at 0°', () => {
    const equatorial = bboxAreaKm2([0, -1, 1, 1]); // 1° × 2° at the equator
    expect(equatorial).toBeCloseTo(111.7 * 2 * 111.7, 0);
    const northern = bboxAreaKm2([0, 60, 1, 61]); // width at 60°N, cos = 0.5
    expect(northern).toBeCloseTo(111.7 * 0.5 * 111.7, 0);
    const southern = bboxAreaKm2([0, -61, 1, -60]); // symmetric
    expect(southern).toBeCloseTo(northern, 6);
  });

  it('bounds a polar-cap box from above — the meridional constant is the WGS-84 maximum, not the mean', () => {
    // 1° × 1° at 80°N: true meridional length there is ~111.66 km/deg; an average constant would under-report.
    const polar = bboxAreaKm2([0, 80, 1, 81]);
    // The true WGS-84 figure: meridional ~111.66 km/deg at 80°, longitudinal (π/180)·N(80°)·cos 80° with
    // N(80°) ≈ 6,398.9 km — both strictly below what the bound uses.
    const trueLongitudeKm = (Math.PI / 180) * 6398.9 * Math.cos((80 * Math.PI) / 180);
    expect(polar).toBeGreaterThanOrEqual(111.66 * trueLongitudeKm);
  });

  it('a county-sized box is well under the allowance, and a degenerate box is zero', () => {
    expect(bboxAreaKm2([-121.9, 39.4, -121.35, 39.85])).toBeLessThan(5_000);
    expect(bboxAreaKm2([10, 10, 10, 10])).toBe(0);
  });

  it('is symmetric in the order of the corners', () => {
    expect(bboxAreaKm2([-114.1, 42.0, -124.5, 32.5])).toBeCloseTo(
      bboxAreaKm2([-124.5, 32.5, -114.1, 42.0]),
      6,
    );
  });
});

describe('isPosition', () => {
  it('wants exactly two numbers', () => {
    expect(isPosition([1, 2])).toBe(true);
    expect(isPosition([1])).toBe(false);
    expect(isPosition([1, '2'])).toBe(false);
    expect(isPosition({ lon: 1, lat: 2 })).toBe(false);
  });
});
