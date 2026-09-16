// BEACON — forecast-evidence labelling tests (WP A8 / F-301; Art. XII/XVI). Pure, clock-free, no IO.
import { describe, it, expect } from 'vitest';
import type { ForecastDraftContext } from '@/application/threshold-evaluation/threshold-evaluation.js';
import {
  FORECAST_EVIDENCE_METHOD,
  FORECAST_EVIDENCE_UNCERTAINTY,
  toForecastEvidence,
} from './forecast-evidence.js';

const CONTEXT: ForecastDraftContext = {
  leadTimeHours: 18,
  expectedCrossingAt: '2026-07-06T16:00:00.000Z',
  forecastCategory: 'MODERATE',
  forecastIssuedAt: '2026-07-05T16:00:00.000Z',
  likelihoodClass: 'LIKELY',
  likelihoodRawValue: 0.72,
  likelihoodSourceField: 'exceedanceProbability',
  likelihoodMethod: 'threshold lookup over the source-published exceedance probability',
};

describe('toForecastEvidence', () => {
  it('carries every context field through UNCHANGED — it labels, it never recomputes', () => {
    const evidence = toForecastEvidence(CONTEXT);
    // Compared as a whole rather than field by field: a field added upstream must arrive here untouched,
    // and a test that listed the fields would silently stop covering the new one.
    expect(evidence).toMatchObject(CONTEXT);
  });

  it('attaches the method and uncertainty labels every served figure must carry (predictions law)', () => {
    const evidence = toForecastEvidence(CONTEXT);
    expect(evidence?.method).toBe(FORECAST_EVIDENCE_METHOD);
    expect(evidence?.uncertainty).toBe(FORECAST_EVIDENCE_UNCERTAINTY);
  });

  it('states plainly that BEACON does not model the hazard and publishes no confidence interval', () => {
    // The labels are the honesty guarantee, so their CLAIM is asserted, not merely their presence.
    expect(FORECAST_EVIDENCE_METHOD).toMatch(/first-order/);
    expect(FORECAST_EVIDENCE_METHOD).toMatch(/models no hazard travel time/);
    expect(FORECAST_EVIDENCE_UNCERTAINTY).toMatch(/no confidence interval/);
    expect(FORECAST_EVIDENCE_UNCERTAINTY).toMatch(/not a calibrated chance of occurrence/);
  });

  it('returns undefined for an absent context — an unavailable figure is never manufactured (Art. XVI)', () => {
    expect(toForecastEvidence(undefined)).toBeUndefined();
  });

  it('does not invent a likelihood when the source published no probability signal', () => {
    const {
      likelihoodClass,
      likelihoodRawValue,
      likelihoodSourceField,
      likelihoodMethod,
      ...bare
    } = CONTEXT;
    void likelihoodClass;
    void likelihoodRawValue;
    void likelihoodSourceField;
    void likelihoodMethod;
    const evidence = toForecastEvidence(bare);
    expect(evidence?.likelihoodClass).toBeUndefined();
    // …while the lead time it DOES have is still served, with both labels.
    expect(evidence?.leadTimeHours).toBe(CONTEXT.leadTimeHours);
    expect(evidence?.uncertainty).toBe(FORECAST_EVIDENCE_UNCERTAINTY);
  });
});
