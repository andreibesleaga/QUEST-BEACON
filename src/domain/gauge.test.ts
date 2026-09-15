import { describe, it, expect } from 'vitest';
import {
  makeGauge,
  compareFloodCategory,
  floodCategoryRank,
  FLOOD_CATEGORIES,
  GAUGE_TENDENCIES,
} from './gauge.js';
import { InvariantViolation } from './errors.js';
import { asId } from './value-objects/ids.js';
import type { GaugeId } from './value-objects/ids.js';
import type { PointGeometry } from './value-objects/geo.js';

const id = asId<GaugeId>('55555555-5555-5555-5555-555555555555');
const geom: PointGeometry = { type: 'Point', coordinates: [-90, 30] };

describe('makeGauge', () => {
  it('builds a valid gauge and defaults floodCategory to NONE', () => {
    expect(makeGauge({ id, geom }).floodCategory).toBe('NONE');
  });

  it('accepts every schema flood category', () => {
    for (const c of FLOOD_CATEGORIES) {
      expect(makeGauge({ id, geom, floodCategory: c }).floodCategory).toBe(c);
    }
  });

  it('keeps optional fields only when provided', () => {
    const g = makeGauge({
      id,
      geom,
      stage: 12.3,
      crestForecast: 15,
      crestTime: '2026-07-02T00:00:00Z',
    });
    expect(g.stage).toBe(12.3);
    expect(g.crestForecast).toBe(15);
    expect(makeGauge({ id, geom }).stage).toBeUndefined();
  });

  it('rejects a category outside the enum', () => {
    // @ts-expect-error invalid enum
    expect(() => makeGauge({ id, geom, floodCategory: 'CATASTROPHIC' })).toThrow(
      InvariantViolation,
    );
  });

  it('rejects a non-Point geom', () => {
    expect(() =>
      makeGauge({ id, geom: { type: 'LineString' } as unknown as PointGeometry }),
    ).toThrow(InvariantViolation);
  });

  it('rejects an invalid crestTime', () => {
    expect(() => makeGauge({ id, geom, crestTime: 'soon' })).toThrow(InvariantViolation);
  });
});

describe('makeGauge — source-published forecast signals (FR-PRED-1, finding F-15)', () => {
  it('carries the exceedance probability exactly as published, including the [0,1] bounds', () => {
    expect(makeGauge({ id, geom, exceedanceProbability: 0.74 }).exceedanceProbability).toBe(0.74);
    expect(makeGauge({ id, geom, exceedanceProbability: 0 }).exceedanceProbability).toBe(0);
    expect(makeGauge({ id, geom, exceedanceProbability: 1 }).exceedanceProbability).toBe(1);
  });

  it('accepts every tendency the sources publish', () => {
    for (const tendency of GAUGE_TENDENCIES) {
      expect(makeGauge({ id, geom, tendency }).tendency).toBe(tendency);
    }
  });

  it('omits both fields when the source published neither (never defaulted to 0/STAGNANT)', () => {
    const g = makeGauge({ id, geom });
    expect(g.exceedanceProbability).toBeUndefined();
    expect(g.tendency).toBeUndefined();
    expect('exceedanceProbability' in g).toBe(false);
    expect('tendency' in g).toBe(false);
  });

  it('rejects a probability outside [0,1] — a percentage would silently misread 100x', () => {
    expect(() => makeGauge({ id, geom, exceedanceProbability: 74 })).toThrow(InvariantViolation);
    expect(() => makeGauge({ id, geom, exceedanceProbability: -0.1 })).toThrow(InvariantViolation);
    expect(() => makeGauge({ id, geom, exceedanceProbability: NaN })).toThrow(InvariantViolation);
    expect(() =>
      makeGauge({ id, geom, exceedanceProbability: '0.5' as unknown as number }),
    ).toThrow(InvariantViolation);
  });

  it('rejects a tendency outside the enum', () => {
    // @ts-expect-error invalid enum
    expect(() => makeGauge({ id, geom, tendency: 'RISING' })).toThrow(InvariantViolation);
  });
});

describe('flood category severity ordering', () => {
  it('ranks NONE < ACTION < MINOR < MODERATE < MAJOR', () => {
    expect(floodCategoryRank('NONE')).toBe(0);
    expect(floodCategoryRank('MAJOR')).toBe(4);
  });

  it('compareFloodCategory orders by severity', () => {
    expect(compareFloodCategory('MINOR', 'MAJOR')).toBeLessThan(0);
    expect(compareFloodCategory('MAJOR', 'MINOR')).toBeGreaterThan(0);
    expect(compareFloodCategory('MODERATE', 'MODERATE')).toBe(0);
  });
});
