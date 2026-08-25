// BEACON — DRAFT-alert derivation tests (FR-11, Art. XIII). Proves the ONE demo DRAFT alert is now COMPUTED
// from threshold rules + readings, not hand-seeded: a below-threshold reading fires NOTHING; lifting the
// reading across the threshold makes a DRAFT alert appear. Every emitted alert is cap_status=DRAFT (never
// ACTUAL — a fire cannot self-approve). Deterministic over an injected `now`.
import { describe, it, expect } from 'vitest';
import { asId } from '@/domain/value-objects/ids.js';
import type { AlertId, IncidentId, SourceId, ThresholdRuleId } from '@/domain/value-objects/ids.js';
import { makeThresholdRule } from '@/domain/threshold-rule.js';
import { forecastReadingFromGauge } from '@/application/threshold-evaluation/threshold-evaluation.js';
import { parseForecastTriggerConfig } from '@/application/threshold-evaluation/forecast-trigger-config.js';
import { makeGauge } from '@/domain/gauge.js';
import type { GaugeId } from '@/domain/value-objects/ids.js';
import {
  deriveDraftAlerts,
  deriveDraftAlertProposals,
  type ThresholdAlertSpec,
} from './derive-alerts.js';

const NOW = Date.parse('2026-07-05T22:00:00Z');
const INCIDENT = asId<IncidentId>('inc-1');

function hazardSpec(hazardWithinBuffer: boolean): ThresholdAlertSpec {
  return {
    rule: makeThresholdRule({ id: asId<ThresholdRuleId>('r-hazard'), target: 'HAZARD_BUFFER', operator: 'enters', value: '1000m' }),
    reading: { hazardWithinBuffer },
    incidentId: INCIDENT,
    alertId: asId<AlertId>('draft-hazard-1'),
    category: 'Fire',
    severity: 'SEVERE',
    sourceId: asId<SourceId>('firms'),
  };
}

function gaugeSpec(floodCategory: 'MINOR' | 'MODERATE' | 'MAJOR'): ThresholdAlertSpec {
  return {
    rule: makeThresholdRule({ id: asId<ThresholdRuleId>('r-gauge'), target: 'GAUGE_CATEGORY', operator: 'gte', value: 'MODERATE' }),
    reading: { floodCategory },
    incidentId: INCIDENT,
    alertId: asId<AlertId>('draft-gauge-1'),
    category: 'Met',
    severity: 'MODERATE',
    sourceId: asId<SourceId>('glofas'),
  };
}

describe('deriveDraftAlerts — computed, not seeded (FR-11)', () => {
  it('produces NO alert when the reading is below the threshold', () => {
    const alerts = deriveDraftAlerts({ specs: [hazardSpec(false), gaugeSpec('MINOR')], now: NOW });
    expect(alerts).toEqual([]);
  });

  it('produces a DRAFT alert once the reading crosses the threshold (input → output)', () => {
    const alerts = deriveDraftAlerts({ specs: [hazardSpec(true)], now: NOW });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.id).toBe('draft-hazard-1');
    expect(alerts[0]?.capStatus).toBe('DRAFT'); // never ACTUAL — Art. XIII
    expect(alerts[0]?.category).toBe('Fire');
    expect(alerts[0]?.thresholdRuleId).toBe('r-hazard'); // rule→alert traceability (EV6)
  });

  it('fires the gauge rule only when the observed category meets/exceeds the threshold', () => {
    expect(deriveDraftAlerts({ specs: [gaugeSpec('MINOR')], now: NOW })).toEqual([]);
    const fired = deriveDraftAlerts({ specs: [gaugeSpec('MAJOR')], now: NOW });
    expect(fired).toHaveLength(1);
    expect(fired[0]?.capStatus).toBe('DRAFT');
  });

  it('does not re-fire a rule already fired within its met-episode (edge de-dup via previous state)', () => {
    const spec: ThresholdAlertSpec = { ...hazardSpec(true), previous: { conditionMet: true, firedForEpisode: true } };
    expect(deriveDraftAlerts({ specs: [spec], now: NOW })).toEqual([]);
  });

  it('computes each firing spec independently (multiple DRAFT alerts)', () => {
    const alerts = deriveDraftAlerts({ specs: [hazardSpec(true), gaugeSpec('MAJOR')], now: NOW });
    expect(alerts.map((a) => a.id).sort()).toEqual(['draft-gauge-1', 'draft-hazard-1']);
  });
});

// ---- FORECAST_GAUGE_CATEGORY through the derivation seam (C2.4, ADR-033 §6, FEV-9) ---------------------

const FRESH_ISSUE = '2026-07-05T06:00:00Z'; // 16 h before NOW — inside the shipped 24 h vintage window

function forecastSpec(etaHours: number, probability = 0.72): ThresholdAlertSpec {
  const gauge = makeGauge({
    id: asId<GaugeId>('g-forecast'),
    geom: { type: 'Point', coordinates: [25.1, 45.2] },
    floodCategory: 'MAJOR',
    exceedanceProbability: probability,
  });
  return {
    rule: makeThresholdRule({
      id: asId<ThresholdRuleId>('r-forecast'),
      target: 'FORECAST_GAUGE_CATEGORY',
      operator: 'gte',
      value: 'MODERATE',
    }),
    reading: forecastReadingFromGauge(gauge, { etaHours, issuedAt: FRESH_ISSUE }),
    incidentId: INCIDENT,
    alertId: asId<AlertId>('draft-forecast-1'),
    category: 'Met',
    severity: 'SEVERE',
    sourceId: asId<SourceId>('glofas'),
  };
}

describe('deriveDraftAlertProposals — a FORECAST crossing produces a DRAFT that states its lead time', () => {
  it('fires on the forecast crossing and carries the lead time + crossing instant + class evidence', () => {
    const proposals = deriveDraftAlertProposals({ specs: [forecastSpec(12)], now: NOW });
    expect(proposals).toHaveLength(1);
    const proposal = proposals[0]!;
    expect(proposal.alert.capStatus).toBe('DRAFT'); // Art. XIII — a forecast fire is no more publishable
    expect(proposal.alert.thresholdRuleId).toBe('r-forecast');
    expect(proposal.forecast?.leadTimeHours).toBe(12);
    expect(proposal.forecast?.expectedCrossingAt).toBe('2026-07-06T10:00:00.000Z');
    expect(proposal.forecast?.forecastIssuedAt).toBe(FRESH_ISSUE);
    expect(proposal.forecast?.likelihoodClass).toBe('VERY_LIKELY');
    expect(proposal.forecast?.likelihoodRawValue).toBe(0.72); // the source's own number, verbatim
  });

  it('does not fire when the source published a probability below the likelihood floor', () => {
    // 0.10 is under the derived-probability table's unclassifiedBelow → no class → no anticipatory DRAFT.
    expect(deriveDraftAlertProposals({ specs: [forecastSpec(12, 0.1)], now: NOW })).toEqual([]);
  });

  it('does not fire when the lead time is outside the configured window', () => {
    expect(deriveDraftAlertProposals({ specs: [forecastSpec(999)], now: NOW })).toEqual([]);
  });

  it('honours an injected per-region gate table', () => {
    const tight = parseForecastTriggerConfig({
      version: 1,
      authority: 'test table with a deliberately narrow lead-time window',
      firePolicy: 'test table: only a crossing within six hours may raise a DRAFT',
      leadTime: { minHours: 0, maxHours: 6, basis: 'test basis long enough for the parser' },
      vintage: { maxForecastAgeHours: 24, basis: 'test basis long enough for the parser' },
      minLikelihood: { class: 'LIKELY', basis: 'test basis long enough for the parser' },
    });
    expect(deriveDraftAlertProposals({ specs: [forecastSpec(12)], now: NOW })).toHaveLength(1);
    expect(
      deriveDraftAlertProposals({ specs: [forecastSpec(12)], now: NOW, forecastConfig: tight }),
    ).toEqual([]);
  });

  it('leaves the observed-crossing proposals with no forecast context', () => {
    const proposals = deriveDraftAlertProposals({ specs: [gaugeSpec('MAJOR')], now: NOW });
    expect(proposals[0]?.forecast).toBeUndefined();
  });
});
