// BEACON — deterministic forecast-likelihood classifier tests (C1.2/C1.3; ADR-033 §2.2/§3, FR-PRED-2/3).
//
// Boundary values are pinned EXACTLY (0.30 and 0.60 are inclusive lower bounds — the "pin the exactly-on-
// boundary case" discipline of escalation-trend.test.ts), the class is proven to come from nothing but the
// source-provided signal, and every clock is injected: the fixed instant below is the only "now" in the file.
import { describe, it, expect } from 'vitest';
import {
  classifyLikelihood,
  deriveForecastLikelihood,
  gaugeLikelihoodSignal,
  hazardArrival,
} from './forecast-likelihood.js';
import type { LikelihoodSignal } from './forecast-likelihood.js';
import { parseLikelihoodConfig } from './likelihood-config.js';
import { FLOOD_CATEGORIES, GAUGE_TENDENCIES, makeGauge } from '@/domain/gauge.js';
import { LIKELIHOOD_CLASSES, makePrediction } from '@/domain/prediction.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { GaugeId, IncidentId, PredictionId } from '@/domain/value-objects/ids.js';
import type { PointGeometry } from '@/domain/value-objects/geo.js';

/** Fixed clock — deterministic, never Date.now(). */
const NOW_ISO = '2026-07-05T22:00:00Z';
const NOW_MS = Date.parse(NOW_ISO);

const probability = (value: number): LikelihoodSignal => ({
  signalType: 'DERIVED_EXCEEDANCE_PROBABILITY',
  value,
});
const memberFraction = (value: number): LikelihoodSignal => ({ signalType: 'ENSEMBLE_MEMBER_FRACTION', value });
const tier = (value: string): LikelihoodSignal => ({ signalType: 'CATEGORICAL_ADVISORY_TIER', value });

describe('classifyLikelihood — derived exceedance probability (ADR-033 §2.2 row 1)', () => {
  const cases: readonly [number, string | null][] = [
    [0, null],
    [0.29, null],
    [0.2999999, null],
    [0.3, 'LIKELY'],
    [0.45, 'LIKELY'],
    [0.5999999, 'LIKELY'],
    [0.6, 'VERY_LIKELY'],
    [0.91, 'VERY_LIKELY'],
    [1, 'VERY_LIKELY'],
  ];

  for (const [value, expected] of cases) {
    it(`maps ${value} → ${expected ?? 'no class'}`, () => {
      expect(classifyLikelihood(probability(value))?.likelihoodClass ?? null).toBe(expected);
    });
  }

  it('below the table floor there is NO class, and no substitute either', () => {
    // ADR-033 §2.2 row 1: under 0.30 the point is still carried, it simply has no likelihood class.
    expect(classifyLikelihood(probability(0.12))).toBeNull();
  });

  it('carries the evidence with the class: raw value, source field, method and the deciding threshold', () => {
    const a = classifyLikelihood(probability(0.74));
    expect(a).not.toBeNull();
    expect(a?.likelihoodClass).toBe('VERY_LIKELY');
    expect(a?.rawValue).toBe(0.74); // verbatim — never rescaled, never rounded to a display %
    expect(a?.signalType).toBe('DERIVED_EXCEEDANCE_PROBABILITY');
    expect(a?.sourceField).toBe('Gauge.exceedanceProbability');
    expect(a?.threshold).toBe(0.6);
    expect(a?.method.length ?? 0).toBeGreaterThan(20);
    expect(a?.sourceLevel).toBeUndefined();
  });

  it('refuses a value outside the documented unit interval instead of clamping it', () => {
    expect(classifyLikelihood(probability(1.4))).toBeNull(); // 140 %? 1.4 %? unknown unit ⇒ no claim
    expect(classifyLikelihood(probability(-0.1))).toBeNull();
    expect(classifyLikelihood(probability(Number.NaN))).toBeNull();
    expect(classifyLikelihood(probability(Number.POSITIVE_INFINITY))).toBeNull();
  });

  it('refuses a string where the rule expects a number', () => {
    expect(classifyLikelihood({ signalType: 'DERIVED_EXCEEDANCE_PROBABILITY', value: '0.9' })).toBeNull();
  });
});

describe('classifyLikelihood — ensemble member fraction (ADR-033 §2.2 row 2)', () => {
  const cases: readonly [number, string][] = [
    [0, 'POSSIBLE'],
    [0.29, 'POSSIBLE'],
    [0.3, 'LIKELY'],
    [0.59, 'LIKELY'],
    [0.6, 'VERY_LIKELY'],
    [1, 'VERY_LIKELY'],
  ];

  for (const [value, expected] of cases) {
    it(`maps ${value} → ${expected}`, () => {
      expect(classifyLikelihood(memberFraction(value))?.likelihoodClass).toBe(expected);
    });
  }

  it('reports the fraction as the share of members it is, never as a chance of occurrence', () => {
    const a = classifyLikelihood(memberFraction(35 / 51));
    expect(a?.likelihoodClass).toBe('VERY_LIKELY');
    expect(a?.rawValue).toBe(35 / 51);
    // The method string shown beside the class must name the signal for what it is AND disclaim the
    // reading a percentage invites: model spread is not a probability of occurrence (finding F-34).
    expect(a?.method).toMatch(/share of forecast members/i);
    expect(a?.method).toMatch(/never as a chance of occurrence/i);
  });
});

describe('classifyLikelihood — ordinal advisory tier (ADR-033 §2.2 row 3)', () => {
  it('maps the source tiers one-to-one', () => {
    expect(classifyLikelihood(tier('low'))?.likelihoodClass).toBe('POSSIBLE');
    expect(classifyLikelihood(tier('medium'))?.likelihoodClass).toBe('LIKELY');
    expect(classifyLikelihood(tier('high'))?.likelihoodClass).toBe('VERY_LIKELY');
  });

  it('normalizes case/whitespace but keeps the raw source value verbatim', () => {
    const a = classifyLikelihood(tier('  High '));
    expect(a?.likelihoodClass).toBe('VERY_LIKELY');
    expect(a?.rawValue).toBe('  High ');
    expect(a?.sourceLevel).toBe('high');
    expect(a?.threshold).toBeUndefined();
  });

  it('refuses an unlisted tier rather than guessing where it sits', () => {
    expect(classifyLikelihood(tier('extreme'))).toBeNull();
    expect(classifyLikelihood({ signalType: 'CATEGORICAL_ADVISORY_TIER', value: 3 })).toBeNull();
  });
});

describe('classifyLikelihood — configuration is the authority, not the code', () => {
  const shifted = parseLikelihoodConfig({
    version: 1,
    authority: 'test table: a region whose operator moved the bands'.padEnd(30, '.'),
    boundaryConvention: 'lowerBound inclusive, evaluated highest-first'.padEnd(30, '.'),
    signalTypes: {
      DERIVED_EXCEEDANCE_PROBABILITY: {
        kind: 'CONTINUOUS',
        sourceField: 'Gauge.exceedanceProbability',
        unit: 'dimensionless fraction in [0,1] as published by the source',
        source: 'test injection standing in for a per-region table',
        method: 'deterministic threshold lookup on the source-published value (test table)',
        bands: [{ lowerBound: 0.8, class: 'VERY_LIKELY' }],
      },
    },
  });

  it('moving the band in config moves the class — nothing is hardcoded in the classifier', () => {
    expect(classifyLikelihood(probability(0.74), shifted)).toBeNull();
    expect(classifyLikelihood(probability(0.85), shifted)?.likelihoodClass).toBe('VERY_LIKELY');
    // …and the shipped table is unaffected by the injected one.
    expect(classifyLikelihood(probability(0.74))?.likelihoodClass).toBe('VERY_LIKELY');
  });

  it('a signal type the table does not declare yields no class', () => {
    expect(classifyLikelihood(memberFraction(0.9), shifted)).toBeNull();
  });
});

describe('the class derives ONLY from source-provided signals (FUW-3, Art. XII)', () => {
  const id = asId<GaugeId>('55555555-5555-5555-5555-555555555555');
  const geom: PointGeometry = { type: 'Point', coordinates: [27.9457, 45.4353] };

  it('no exceedanceProbability ⇒ no signal ⇒ no class, whatever the severity, crest or tendency says', () => {
    for (const floodCategory of FLOOD_CATEGORIES) {
      for (const tendency of GAUGE_TENDENCIES) {
        const gauge = makeGauge({ id, geom, floodCategory, tendency, stage: 99, crestForecast: 71_200, crestTime: NOW_ISO });
        const signal = gaugeLikelihoodSignal(gauge);
        expect(signal, `${floodCategory}/${tendency}`).toBeUndefined();
        const fields = deriveForecastLikelihood({
          ...(signal === undefined ? {} : { signal }),
          nowMs: NOW_MS,
          forecastInstant: gauge.crestTime ?? NOW_ISO, // a lead time is still reported; only the class is absent
        });
        expect(fields.likelihoodClass, `${floodCategory}/${tendency}`).toBeUndefined();
        expect(fields.etaHours, `${floodCategory}/${tendency}`).toBe(0);
      }
    }
  });

  it('the ONLY gauge field that can produce a signal is the source-published probability', () => {
    const gauge = makeGauge({ id, geom, floodCategory: 'MODERATE', exceedanceProbability: 0.74, tendency: 'INCREASING' });
    const signal = gaugeLikelihoodSignal(gauge);
    expect(signal).toEqual({ signalType: 'DERIVED_EXCEEDANCE_PROBABILITY', value: 0.74 });
    expect(classifyLikelihood(signal!)?.likelihoodClass).toBe('VERY_LIKELY');
  });

  it('tendency never lifts or lowers the class (a direction of travel is not a probability)', () => {
    const classes = GAUGE_TENDENCIES.map((tendency) => {
      const gauge = makeGauge({ id, geom, exceedanceProbability: 0.35, tendency });
      return classifyLikelihood(gaugeLikelihoodSignal(gauge)!)?.likelihoodClass;
    });
    expect(new Set(classes)).toEqual(new Set(['LIKELY']));
  });

  it('is clock-free: the class does not move when the wall clock does', () => {
    const original = Date.now;
    try {
      Date.now = () => 0;
      const a = classifyLikelihood(probability(0.61));
      Date.now = () => 4_102_444_800_000; // 2100-01-01
      const b = classifyLikelihood(probability(0.61));
      expect(a).toEqual(b);
      expect(a?.likelihoodClass).toBe('VERY_LIKELY');
    } finally {
      Date.now = original;
    }
  });

  it('is monotonic across the whole unit interval: a higher source value never means a less likely class', () => {
    const rank = (v: number) => {
      const c = classifyLikelihood(memberFraction(v))?.likelihoodClass;
      return c === undefined ? -1 : LIKELIHOOD_CLASSES.indexOf(c);
    };
    for (let v = 0; v <= 1.0000001; v += 0.01) {
      expect(rank(Math.min(v, 1)), `at ${v}`).toBeGreaterThanOrEqual(rank(Math.max(0, v - 0.01)));
    }
  });
});

describe('deriveForecastLikelihood — labeled fields for a Prediction (C1.3, FU-12)', () => {
  it('derives class + etaHours + computed hazardArrival from a source instant', () => {
    const fields = deriveForecastLikelihood({
      signal: probability(0.74),
      nowMs: NOW_MS,
      forecastInstant: '2026-07-07T12:00:00Z', // GloFAS time-to-peak from the recorded fixture
    });
    expect(fields.likelihoodClass).toBe('VERY_LIKELY');
    expect(fields.etaHours).toBe(38); // 2026-07-05T22:00Z → 2026-07-07T12:00Z
    expect(fields.hazardArrival).toBe('2026-07-07T12:00:00.000Z');
    expect(fields.inputs).toEqual({
      likelihoodSignalType: 'DERIVED_EXCEEDANCE_PROBABILITY',
      likelihoodRawValue: 0.74,
      likelihoodSourceField: 'Gauge.exceedanceProbability',
      likelihoodThreshold: 0.6,
      likelihoodMethod: expect.stringContaining('deterministic threshold lookup'),
      etaHours: 38,
      etaBasis: 'source-provided forecast instant',
    });
  });

  it('prefers a source-stated lead time and labels the basis accordingly', () => {
    const fields = deriveForecastLikelihood({ signal: memberFraction(0.4), nowMs: NOW_MS, etaHours: 72 });
    expect(fields.likelihoodClass).toBe('LIKELY');
    expect(fields.etaHours).toBe(72);
    expect(fields.hazardArrival).toBe('2026-07-08T22:00:00.000Z');
    expect((fields.inputs as { etaBasis?: string }).etaBasis).toBe('source-stated lead time');
  });

  it('accepts a zero-hour source lead time (arriving now is a real forecast)', () => {
    const fields = deriveForecastLikelihood({ nowMs: NOW_MS, etaHours: 0 });
    expect(fields.etaHours).toBe(0);
    expect(fields.hazardArrival).toBe('2026-07-05T22:00:00.000Z');
  });

  it('reports no lead time for a stale forecast instant already in the past', () => {
    const fields = deriveForecastLikelihood({ nowMs: NOW_MS, forecastInstant: '2026-07-04T00:00:00Z' });
    expect(fields.etaHours).toBeUndefined();
    expect(fields.hazardArrival).toBeUndefined();
    expect(fields.inputs).toEqual({});
  });

  it('reports no lead time for an unparseable or negative source value', () => {
    expect(deriveForecastLikelihood({ nowMs: NOW_MS, forecastInstant: 'soon' }).etaHours).toBeUndefined();
    expect(deriveForecastLikelihood({ nowMs: NOW_MS, etaHours: -3 }).etaHours).toBeUndefined();
    expect(deriveForecastLikelihood({ nowMs: NOW_MS, etaHours: Number.NaN }).hazardArrival).toBeUndefined();
  });

  it('a source with neither a probability nor a lead time yields an empty, honest result', () => {
    const fields = deriveForecastLikelihood({ nowMs: NOW_MS });
    expect(fields).toEqual({ inputs: {} });
  });

  it('keeps the lead-time evidence when the signal is unclassifiable', () => {
    const fields = deriveForecastLikelihood({ signal: probability(0.12), nowMs: NOW_MS, etaHours: 12 });
    expect(fields.likelihoodClass).toBeUndefined();
    expect(fields.etaHours).toBe(12);
    expect(fields.inputs).toEqual({ etaHours: 12, etaBasis: 'source-stated lead time' });
  });

  it('is replayable: identical inputs and identical injected now ⇒ identical output', () => {
    const input = { signal: probability(0.6), nowMs: NOW_MS, forecastInstant: '2026-07-09T06:00:00Z' };
    expect(deriveForecastLikelihood(input)).toEqual(deriveForecastLikelihood(input));
  });
});

describe('hazardArrival', () => {
  it('is now + lead time, from the injected clock only', () => {
    expect(hazardArrival(NOW_MS, 6)).toBe('2026-07-06T04:00:00.000Z');
    expect(hazardArrival(NOW_MS, 0.5)).toBe('2026-07-05T22:30:00.000Z');
  });
});

describe('the derived fields fit a labeled Prediction (C1.3)', () => {
  it('spreads into makePrediction and survives, with the evidence in inputs', () => {
    const fields = deriveForecastLikelihood({
      signal: probability(0.74),
      nowMs: NOW_MS,
      forecastInstant: '2026-07-07T12:00:00Z',
    });
    const p = makePrediction({
      id: asId<PredictionId>('77777777-7777-7777-7777-777777777777'),
      incidentId: asId<IncidentId>('22222222-2222-2222-2222-222222222222'),
      kind: 'FLOOD_INUNDATION',
      method: 'source-published exceedance probability mapped to an ordered likelihood class',
      inputs: fields.inputs,
      uncertainty: 0.4,
      ...(fields.hazardArrival === undefined ? {} : { horizon: fields.hazardArrival }),
      ...(fields.likelihoodClass === undefined ? {} : { likelihoodClass: fields.likelihoodClass }),
      ...(fields.etaHours === undefined ? {} : { etaHours: fields.etaHours }),
    });
    expect(p.likelihoodClass).toBe('VERY_LIKELY');
    expect(p.etaHours).toBe(38);
    expect(p.horizon).toBe('2026-07-07T12:00:00.000Z');
    expect((p.inputs as { likelihoodRawValue?: number }).likelihoodRawValue).toBe(0.74);
    // hazardArrival is application-computed, never stored on the entity (ADR-033 §3).
    expect('hazardArrival' in p).toBe(false);
  });
});
