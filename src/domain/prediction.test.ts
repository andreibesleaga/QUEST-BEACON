import { describe, it, expect } from 'vitest';
import {
  makePrediction,
  PREDICTION_KINDS,
  LIKELIHOOD_CLASSES,
  likelihoodClassRank,
  compareLikelihoodClass,
} from './prediction.js';
import { InvariantViolation } from './errors.js';
import { asId } from './value-objects/ids.js';
import type { PredictionId, IncidentId } from './value-objects/ids.js';

const id = asId<PredictionId>('77777777-7777-7777-7777-777777777777');
const incidentId = asId<IncidentId>('22222222-2222-2222-2222-222222222222');
const base = {
  id,
  incidentId,
  kind: 'FIRE_CONE' as const,
  method: 'wind-buffer first-order cone',
  inputs: { windDeg: 270, windKts: 15 },
  uncertainty: 0.3,
};

describe('makePrediction', () => {
  it('builds a valid labeled prediction', () => {
    const p = makePrediction(base);
    expect(p.kind).toBe('FIRE_CONE');
    expect(p.uncertainty).toBe(0.3);
    expect(p.inputs).toEqual({ windDeg: 270, windKts: 15 });
  });

  it('accepts every schema kind', () => {
    for (const kind of PREDICTION_KINDS) {
      expect(makePrediction({ ...base, kind }).kind).toBe(kind);
    }
  });

  it('accepts uncertainty at the [0,1] bounds', () => {
    expect(makePrediction({ ...base, uncertainty: 0 }).uncertainty).toBe(0);
    expect(makePrediction({ ...base, uncertainty: 1 }).uncertainty).toBe(1);
  });

  it('rejects a kind outside the enum', () => {
    // @ts-expect-error invalid enum
    expect(() => makePrediction({ ...base, kind: 'QUAKE' })).toThrow(InvariantViolation);
  });

  it('rejects a missing method', () => {
    expect(() => makePrediction({ ...base, method: '  ' })).toThrow(InvariantViolation);
  });

  it('rejects missing inputs', () => {
    expect(() => makePrediction({ ...base, inputs: undefined as unknown as Record<string, unknown> })).toThrow(
      InvariantViolation,
    );
  });

  it('rejects a missing/NaN uncertainty', () => {
    expect(() => makePrediction({ ...base, uncertainty: NaN })).toThrow(InvariantViolation);
  });

  it('rejects uncertainty outside [0,1]', () => {
    expect(() => makePrediction({ ...base, uncertainty: 1.5 })).toThrow(InvariantViolation);
    expect(() => makePrediction({ ...base, uncertainty: -0.1 })).toThrow(InvariantViolation);
  });

  it('rejects an invalid horizon', () => {
    expect(() => makePrediction({ ...base, horizon: 'later' })).toThrow(InvariantViolation);
  });
});

describe('forecast-likelihood fields (FR-PRED-3, ADR-033 §3)', () => {
  it('carries every likelihood class and a non-negative etaHours', () => {
    for (const likelihoodClass of LIKELIHOOD_CLASSES) {
      expect(makePrediction({ ...base, likelihoodClass }).likelihoodClass).toBe(likelihoodClass);
    }
    expect(makePrediction({ ...base, etaHours: 0 }).etaHours).toBe(0);
    expect(makePrediction({ ...base, etaHours: 38.5 }).etaHours).toBe(38.5);
  });

  it('omits both when the source supported neither (no default class, no default ETA)', () => {
    const p = makePrediction(base);
    expect('likelihoodClass' in p).toBe(false);
    expect('etaHours' in p).toBe(false);
  });

  it('rejects a class outside the enum', () => {
    // @ts-expect-error invalid enum
    expect(() => makePrediction({ ...base, likelihoodClass: 'CERTAIN' })).toThrow(InvariantViolation);
  });

  it('rejects a negative or non-finite etaHours', () => {
    expect(() => makePrediction({ ...base, etaHours: -1 })).toThrow(InvariantViolation);
    expect(() => makePrediction({ ...base, etaHours: NaN })).toThrow(InvariantViolation);
    expect(() => makePrediction({ ...base, etaHours: Number.POSITIVE_INFINITY })).toThrow(InvariantViolation);
    expect(() => makePrediction({ ...base, etaHours: '3' as unknown as number })).toThrow(InvariantViolation);
  });

  it('never stores hazardArrival — it is application-computed from an injected clock (ADR-033 §3)', () => {
    expect('hazardArrival' in makePrediction({ ...base, etaHours: 6 })).toBe(false);
  });
});

describe('likelihood class ordering (ADR-033 §2.1)', () => {
  it('ranks POSSIBLE < LIKELY < VERY_LIKELY', () => {
    expect(likelihoodClassRank('POSSIBLE')).toBe(0);
    expect(likelihoodClassRank('LIKELY')).toBe(1);
    expect(likelihoodClassRank('VERY_LIKELY')).toBe(2);
  });

  it('compareLikelihoodClass orders by likelihood', () => {
    expect(compareLikelihoodClass('POSSIBLE', 'VERY_LIKELY')).toBeLessThan(0);
    expect(compareLikelihoodClass('VERY_LIKELY', 'LIKELY')).toBeGreaterThan(0);
    expect(compareLikelihoodClass('LIKELY', 'LIKELY')).toBe(0);
  });
});
