import { describe, it, expect } from 'vitest';
import { asId } from '@/domain/value-objects/ids.js';
import type {
  AlertId,
  GaugeId,
  IncidentId,
  SourceId,
  ThresholdRuleId,
} from '@/domain/value-objects/ids.js';
import { makeThresholdRule } from '@/domain/threshold-rule.js';
import type { ThresholdRule } from '@/domain/threshold-rule.js';
import type { EmittableAlert } from '@/ports/logistics.js';
import { definedOnly } from '@/domain/shared/guard.js';
import { makeGauge } from '@/domain/gauge.js';
import type { FloodCategory } from '@/domain/gauge.js';
import { classifyLikelihood } from '@/application/forecast-likelihood/forecast-likelihood.js';
import type { LikelihoodAssessment } from '@/application/forecast-likelihood/forecast-likelihood.js';
import {
  conditionMet,
  evaluateRule,
  buildDraftAlert,
  forecastReadingFromGauge,
  type RuleRuntimeState,
  type SignalReading,
} from './threshold-evaluation.js';
import {
  DEFAULT_FORECAST_TRIGGER_CONFIG,
  parseForecastTriggerConfig,
  type ForecastTriggerConfig,
} from './forecast-trigger-config.js';

function gaugeRule(over: Partial<Parameters<typeof makeThresholdRule>[0]> = {}): ThresholdRule {
  return makeThresholdRule({
    id: asId<ThresholdRuleId>('r1'),
    target: 'GAUGE_CATEGORY',
    operator: 'gte',
    value: 'MODERATE',
    ...over,
  });
}

// ---- FORECAST_GAUGE_CATEGORY fixtures (C2.4) ----------------------------------------------------------
// One fixed injected clock for every forecast test (project convention: no wall-clock, no live network).
const NOW = Date.parse('2026-07-05T22:00:00Z');
const FRESH_ISSUE = '2026-07-05T06:00:00Z'; // 16 h old — inside the shipped 24 h vintage window
const STALE_ISSUE = '2026-07-04T06:00:00Z'; // 40 h old — a run GloFAS has published over since

function forecastRule(over: Partial<Parameters<typeof makeThresholdRule>[0]> = {}): ThresholdRule {
  return makeThresholdRule({
    id: asId<ThresholdRuleId>('r-forecast'),
    target: 'FORECAST_GAUGE_CATEGORY',
    operator: 'gte',
    value: 'MODERATE',
    ...over,
  });
}

/** A likelihood produced by the C1 classifier — never hand-built, so the test cannot drift from the table. */
function likelihood(
  signalType: 'DERIVED_EXCEEDANCE_PROBABILITY' | 'ENSEMBLE_MEMBER_FRACTION',
  value: number,
): LikelihoodAssessment {
  const assessment = classifyLikelihood({ signalType, value });
  if (assessment === null) throw new Error('fixture must classify');
  return assessment;
}

/** Overrides may be explicitly `undefined` to REMOVE a field (definedOnly prunes it, as the engine sees it). */
type ReadingOverride = { readonly [K in keyof SignalReading]?: SignalReading[K] | undefined };

function forecastReading(over: ReadingOverride = {}): SignalReading {
  return definedOnly({
    forecastCategory: 'MAJOR' as FloodCategory,
    forecastEtaHours: 12,
    forecastIssuedAt: FRESH_ISSUE,
    forecastLikelihood: likelihood('DERIVED_EXCEEDANCE_PROBABILITY', 0.72), // VERY_LIKELY
    ...over,
  }) as SignalReading;
}

const at = { now: NOW } as const;

describe('conditionMet', () => {
  it('is true when the gauge category reaches/exceeds the threshold', () => {
    expect(conditionMet(gaugeRule(), { floodCategory: 'MODERATE' })).toBe(true);
    expect(conditionMet(gaugeRule(), { floodCategory: 'MAJOR' })).toBe(true);
  });
  it('is false below the threshold or with no reading', () => {
    expect(conditionMet(gaugeRule(), { floodCategory: 'MINOR' })).toBe(false);
    expect(conditionMet(gaugeRule(), {})).toBe(false);
  });
  it('handles the HAZARD_BUFFER target via the boolean signal', () => {
    const rule = gaugeRule({ target: 'HAZARD_BUFFER', operator: 'enters', value: '500' });
    expect(conditionMet(rule, { hazardWithinBuffer: true })).toBe(true);
    expect(conditionMet(rule, { hazardWithinBuffer: false })).toBe(false);
    expect(conditionMet(rule, {})).toBe(false);
  });
});

describe('evaluateRule — edge trigger', () => {
  it('fires on the rising transition, not on every cycle it holds', () => {
    const rule = gaugeRule();
    const c1 = evaluateRule({ rule, reading: { floodCategory: 'MAJOR' }, now: 1000 });
    expect(c1.fired).toBe(true);
    const c2 = evaluateRule({
      rule,
      reading: { floodCategory: 'MAJOR' },
      now: 2000,
      previous: c1.state,
    });
    expect(c2.fired).toBe(false); // still held → no re-fire
  });

  it('does not fire while the condition is unmet and preserves cooldown anchor', () => {
    const rule = gaugeRule();
    const prev: RuleRuntimeState = { conditionMet: true, firedForEpisode: true, lastFiredAt: 500 };
    const out = evaluateRule({
      rule,
      reading: { floodCategory: 'MINOR' },
      now: 3000,
      previous: prev,
    });
    expect(out.fired).toBe(false);
    expect(out.state.conditionMet).toBe(false);
    expect(out.state.lastFiredAt).toBe(500);
  });

  it('re-arms after the condition drops then rises again (new episode)', () => {
    const rule = gaugeRule();
    const fired = evaluateRule({ rule, reading: { floodCategory: 'MAJOR' }, now: 0 });
    const dropped = evaluateRule({
      rule,
      reading: { floodCategory: 'NONE' },
      now: 10,
      previous: fired.state,
    });
    const rearmed = evaluateRule({
      rule,
      reading: { floodCategory: 'MAJOR' },
      now: 100_000,
      previous: dropped.state,
    });
    expect(rearmed.fired).toBe(true);
  });
});

describe('evaluateRule — candidateSince fallback', () => {
  it('anchors candidateSince to now when prev.conditionMet is true but candidateSince is undefined', () => {
    // Degenerate carried state: condition was met last cycle yet the dwell anchor is missing.
    // Covers the `prev.candidateSince ?? ctx.now` fallback with prev.conditionMet true.
    const rule = gaugeRule();
    const prev: RuleRuntimeState = { conditionMet: true, firedForEpisode: false };
    const out = evaluateRule({
      rule,
      reading: { floodCategory: 'MAJOR' },
      now: 4242,
      previous: prev,
    });
    expect(out.state.candidateSince).toBe(4242);
    expect(out.fired).toBe(true); // no hysteresis/cooldown → dwell trivially satisfied
  });
});

describe('evaluateRule — hysteresis dwell', () => {
  it('suppresses a fire until the state has dwelt the hysteresis window', () => {
    const rule = gaugeRule({ hysteresis: 5000 });
    const rise = evaluateRule({ rule, reading: { floodCategory: 'MAJOR' }, now: 1000 });
    expect(rise.fired).toBe(false); // sub-dwell — held < 5000ms
    const mid = evaluateRule({
      rule,
      reading: { floodCategory: 'MAJOR' },
      now: 3000,
      previous: rise.state,
    });
    expect(mid.fired).toBe(false);
    // exactly on the dead-band boundary (dwell == hysteresis) → fires (>=)
    const onBoundary = evaluateRule({
      rule,
      reading: { floodCategory: 'MAJOR' },
      now: 6000,
      previous: mid.state,
    });
    expect(onBoundary.fired).toBe(true);
  });
});

describe('evaluateRule — cooldown', () => {
  it('suppresses a repeat fire in a new episode within the cooldown window', () => {
    const rule = gaugeRule({ cooldown: 10_000 });
    const fire1 = evaluateRule({ rule, reading: { floodCategory: 'MAJOR' }, now: 0 });
    expect(fire1.fired).toBe(true);
    const drop = evaluateRule({
      rule,
      reading: { floodCategory: 'NONE' },
      now: 1000,
      previous: fire1.state,
    });
    const fire2 = evaluateRule({
      rule,
      reading: { floodCategory: 'MAJOR' },
      now: 2000,
      previous: drop.state,
    });
    expect(fire2.fired).toBe(false); // within cooldown (2000 < 10000)
    const drop2 = evaluateRule({
      rule,
      reading: { floodCategory: 'NONE' },
      now: 3000,
      previous: fire2.state,
    });
    const fire3 = evaluateRule({
      rule,
      reading: { floodCategory: 'MAJOR' },
      now: 20_000,
      previous: drop2.state,
    });
    expect(fire3.fired).toBe(true); // cooldown elapsed
  });
});

describe('evaluateRule — flap-free under noise (property)', () => {
  it('never fires for a noisy signal that stays below threshold', () => {
    const rule = gaugeRule();
    let state: RuleRuntimeState | undefined;
    for (let i = 0; i < 100; i++) {
      const cat = i % 2 === 0 ? 'ACTION' : 'MINOR'; // both below MODERATE
      const out = evaluateRule({
        rule,
        reading: { floodCategory: cat },
        now: i * 1000,
        ...(state !== undefined ? { previous: state } : {}),
      });
      expect(out.fired).toBe(false);
      state = out.state;
    }
  });
});

describe('buildDraftAlert', () => {
  it('always yields a DRAFT alert with provenance and rule linkage, never ACTUAL', () => {
    const rule = gaugeRule();
    const proposal = buildDraftAlert({
      rule,
      incidentId: asId<IncidentId>('inc-1'),
      alertId: asId<AlertId>('a-1'),
      category: 'Met',
      severity: 'SEVERE',
      sourceId: asId<SourceId>('src-9'),
    });
    expect(proposal.alert.capStatus).toBe('DRAFT');
    expect(proposal.alert.approvedBy).toBeUndefined();
    expect(proposal.alert.thresholdRuleId).toBe(rule.id);
    expect(proposal.provenanceSourceId).toBe('src-9');
    expect(proposal.forecast).toBeUndefined(); // an OBSERVED crossing carries no lead time
  });
});

// =========================================================================================================
// FORECAST_GAUGE_CATEGORY — a FORECAST crossing fires (ADR-033 §6, FEV-9, C2.4)
// =========================================================================================================

describe('conditionMet — FORECAST_GAUGE_CATEGORY crossing', () => {
  it('is true when the forecast category reaches the threshold and every gate is satisfied', () => {
    expect(conditionMet(forecastRule(), forecastReading(), at)).toBe(true);
    expect(
      conditionMet(forecastRule(), forecastReading({ forecastCategory: 'MODERATE' }), at),
    ).toBe(true);
  });

  it('FAILS CLOSED with no injected clock — a forecast whose vintage cannot be checked never fires', () => {
    // Deliberate: the same reading that passes above must not pass without an evaluation instant.
    expect(conditionMet(forecastRule(), forecastReading())).toBe(false);
  });

  it('is false below the threshold, or with no forecast category at all', () => {
    expect(conditionMet(forecastRule(), forecastReading({ forecastCategory: 'MINOR' }), at)).toBe(
      false,
    );
    expect(conditionMet(forecastRule(), forecastReading({ forecastCategory: undefined }), at)).toBe(
      false,
    );
  });

  it('does NOT fire off the OBSERVED category — the two targets read different fields', () => {
    // A gauge observing MAJOR right now says nothing about the forecast target, and vice versa.
    expect(conditionMet(forecastRule(), { floodCategory: 'MAJOR' }, at)).toBe(false);
    expect(conditionMet(gaugeRule(), { forecastCategory: 'MAJOR' })).toBe(false);
  });

  describe('lead-time gate (FEV-9: the DRAFT must STATE an expected crossing time)', () => {
    it('is false with no lead time, a negative one, or a non-finite one', () => {
      expect(
        conditionMet(forecastRule(), forecastReading({ forecastEtaHours: undefined }), at),
      ).toBe(false);
      expect(conditionMet(forecastRule(), forecastReading({ forecastEtaHours: -1 }), at)).toBe(
        false,
      );
      expect(
        conditionMet(forecastRule(), forecastReading({ forecastEtaHours: Number.NaN }), at),
      ).toBe(false);
    });

    it('holds exactly ON the configured window bounds and fails one hour past the top', () => {
      const { minHours, maxHours } = DEFAULT_FORECAST_TRIGGER_CONFIG.leadTime;
      expect(
        conditionMet(forecastRule(), forecastReading({ forecastEtaHours: minHours }), at),
      ).toBe(true);
      expect(
        conditionMet(forecastRule(), forecastReading({ forecastEtaHours: maxHours }), at),
      ).toBe(true);
      expect(
        conditionMet(forecastRule(), forecastReading({ forecastEtaHours: maxHours + 1 }), at),
      ).toBe(false);
    });
  });

  describe('vintage gate (a superseded forecast must not fire as if it were current)', () => {
    it('is false for a run older than the configured window, and for a missing/unparseable instant', () => {
      expect(
        conditionMet(forecastRule(), forecastReading({ forecastIssuedAt: STALE_ISSUE }), at),
      ).toBe(false);
      expect(
        conditionMet(forecastRule(), forecastReading({ forecastIssuedAt: undefined }), at),
      ).toBe(false);
      expect(
        conditionMet(forecastRule(), forecastReading({ forecastIssuedAt: 'yesterday' }), at),
      ).toBe(false);
    });

    it('is false for an issue instant in the FUTURE — a bad timestamp cannot buy freshness', () => {
      expect(
        conditionMet(
          forecastRule(),
          forecastReading({ forecastIssuedAt: '2026-07-06T06:00:00Z' }),
          at,
        ),
      ).toBe(false);
    });

    it('holds exactly ON the configured age bound', () => {
      const ageMs = DEFAULT_FORECAST_TRIGGER_CONFIG.vintage.maxForecastAgeHours * 3_600_000;
      const onBound = new Date(NOW - ageMs).toISOString();
      const justPast = new Date(NOW - ageMs - 1000).toISOString();
      expect(conditionMet(forecastRule(), forecastReading({ forecastIssuedAt: onBound }), at)).toBe(
        true,
      );
      expect(
        conditionMet(forecastRule(), forecastReading({ forecastIssuedAt: justPast }), at),
      ).toBe(false);
    });
  });

  describe('likelihood floor (reuses the C1 classifier — this engine classifies nothing)', () => {
    it('is false with no classified likelihood, and false below the configured floor', () => {
      expect(
        conditionMet(forecastRule(), forecastReading({ forecastLikelihood: undefined }), at),
      ).toBe(false);
      // 0.10 of the forecast members over threshold → POSSIBLE, below the shipped LIKELY floor.
      const possible = likelihood('ENSEMBLE_MEMBER_FRACTION', 0.1);
      expect(possible.likelihoodClass).toBe('POSSIBLE');
      expect(
        conditionMet(forecastRule(), forecastReading({ forecastLikelihood: possible }), at),
      ).toBe(false);
    });

    it('is true exactly AT the floor', () => {
      const atFloor = likelihood('DERIVED_EXCEEDANCE_PROBABILITY', 0.3);
      expect(atFloor.likelihoodClass).toBe('LIKELY');
      expect(
        conditionMet(forecastRule(), forecastReading({ forecastLikelihood: atFloor }), at),
      ).toBe(true);
    });

    it('skips the gate entirely when a config omits the floor (config, not code, decides)', () => {
      const noFloor: ForecastTriggerConfig = parseForecastTriggerConfig({
        version: 1,
        authority: 'test table with no likelihood floor configured at all',
        firePolicy: 'test table: the likelihood gate is simply not applied here',
        leadTime: { minHours: 0, maxHours: 48, basis: 'test basis long enough for the parser' },
        vintage: { maxForecastAgeHours: 24, basis: 'test basis long enough for the parser' },
      });
      expect(noFloor.minLikelihood).toBeUndefined();
      const reading = forecastReading({ forecastLikelihood: undefined });
      expect(conditionMet(forecastRule(), reading, { now: NOW, config: noFloor })).toBe(true);
      expect(conditionMet(forecastRule(), reading, at)).toBe(false); // shipped table still refuses it
    });
  });
});

describe('evaluateRule — FORECAST_GAUGE_CATEGORY', () => {
  it('fires on the rising forecast edge and not again while the same crossing holds', () => {
    const rule = forecastRule();
    const c1 = evaluateRule({ rule, reading: forecastReading(), now: NOW });
    expect(c1.fired).toBe(true);
    expect(c1.state.latestForecastIssuedAt).toBe(Date.parse(FRESH_ISSUE));
    const c2 = evaluateRule({
      rule,
      reading: forecastReading(),
      now: NOW + 1000,
      previous: c1.state,
    });
    expect(c2.fired).toBe(false);
  });

  it('does NOT fire on a superseded run arriving out of order, then fires on the newer one', () => {
    const rule = forecastRule();
    const newer = '2026-07-05T18:00:00Z';
    // Cycle 1: the newest run is seen but the condition is not met (category still below threshold).
    const seen = evaluateRule({
      rule,
      reading: forecastReading({ forecastIssuedAt: newer, forecastCategory: 'MINOR' }),
      now: NOW,
    });
    expect(seen.fired).toBe(false);
    expect(seen.state.latestForecastIssuedAt).toBe(Date.parse(newer));
    // Cycle 2: an OLDER run (a cache resurrection / replayed mirror) now crosses — it must not fire.
    const stale = evaluateRule({
      rule,
      reading: forecastReading({ forecastIssuedAt: FRESH_ISSUE }),
      now: NOW + 1000,
      previous: seen.state,
    });
    expect(stale.fired).toBe(false);
    expect(stale.state.conditionMet).toBe(true); // the episode state stays honest…
    expect(stale.state.latestForecastIssuedAt).toBe(Date.parse(newer)); // …and the newest vintage is kept
    // Cycle 3: the current run crosses — now it fires.
    const current = evaluateRule({
      rule,
      reading: forecastReading({ forecastIssuedAt: newer }),
      now: NOW + 2000,
      previous: stale.state,
    });
    expect(current.fired).toBe(true);
  });

  it('carries the newest seen vintage across a cycle whose reading has none', () => {
    const rule = forecastRule();
    const c1 = evaluateRule({ rule, reading: forecastReading(), now: NOW });
    const c2 = evaluateRule({
      rule,
      reading: { forecastCategory: 'MAJOR' }, // no issue instant → cannot fire, must not forget
      now: NOW + 1000,
      previous: c1.state,
    });
    expect(c2.fired).toBe(false);
    expect(c2.state.conditionMet).toBe(false);
    expect(c2.state.latestForecastIssuedAt).toBe(Date.parse(FRESH_ISSUE));
  });

  it('is replay-deterministic: the same cached reading at the same injected now decides identically', () => {
    // ADR-033 "Verification": same cached forecast reading replayed twice → identical fire + identical state.
    const rule = forecastRule({ hysteresis: 1000, cooldown: 5000 });
    const previous: RuleRuntimeState = {
      conditionMet: true,
      firedForEpisode: false,
      candidateSince: NOW - 9000,
    };
    const a = evaluateRule({ rule, reading: forecastReading(), now: NOW, previous });
    const b = evaluateRule({ rule, reading: forecastReading(), now: NOW, previous });
    expect(a).toEqual(b);
    expect(a.fired).toBe(true);
  });

  it('honours a per-region gate table injected through the context', () => {
    const tight: ForecastTriggerConfig = parseForecastTriggerConfig({
      version: 1,
      authority: 'test table with a deliberately narrow lead-time window',
      firePolicy: 'test table: only a crossing within six hours may raise a DRAFT',
      leadTime: { minHours: 0, maxHours: 6, basis: 'test basis long enough for the parser' },
      vintage: { maxForecastAgeHours: 24, basis: 'test basis long enough for the parser' },
      minLikelihood: { class: 'LIKELY', basis: 'test basis long enough for the parser' },
    });
    const rule = forecastRule();
    expect(evaluateRule({ rule, reading: forecastReading(), now: NOW }).fired).toBe(true); // 12 h, shipped 168 h
    expect(
      evaluateRule({ rule, reading: forecastReading(), now: NOW, forecastConfig: tight }).fired,
    ).toBe(false); // 12 h exceeds this region's 6 h window
  });
});

describe('buildDraftAlert — the forecast DRAFT carries its lead time (FEV-9)', () => {
  function proposeForecast(
    reading?: SignalReading,
    now?: number,
  ): ReturnType<typeof buildDraftAlert> {
    return buildDraftAlert({
      rule: forecastRule(),
      incidentId: asId<IncidentId>('inc-f'),
      alertId: asId<AlertId>('a-f'),
      category: 'Met',
      severity: 'SEVERE',
      sourceId: asId<SourceId>('src-glofas'),
      ...(reading === undefined ? {} : { reading }),
      ...(now === undefined ? {} : { now }),
    });
  }

  it('states the lead time, the expected crossing instant, the forecast vintage and the class evidence', () => {
    const proposal = proposeForecast(forecastReading(), NOW);
    const assessment = likelihood('DERIVED_EXCEEDANCE_PROBABILITY', 0.72);
    expect(proposal.alert.capStatus).toBe('DRAFT');
    expect(proposal.forecast).toEqual({
      leadTimeHours: 12,
      expectedCrossingAt: '2026-07-06T10:00:00.000Z', // NOW + 12 h, from the shared C1 hazardArrival helper
      forecastCategory: 'MAJOR',
      forecastIssuedAt: FRESH_ISSUE,
      likelihoodClass: 'VERY_LIKELY',
      likelihoodRawValue: 0.72, // the SOURCE's own number, verbatim — never a re-derived percentage
      likelihoodSourceField: 'Gauge.exceedanceProbability',
      likelihoodMethod: assessment.method, // the classifier's own caveat text, carried not re-worded
    });
  });

  it('omits the forecast context when the reading is incomplete or no instant was injected', () => {
    expect(proposeForecast(undefined, NOW).forecast).toBeUndefined();
    expect(proposeForecast(forecastReading()).forecast).toBeUndefined();
    expect(
      proposeForecast(forecastReading({ forecastEtaHours: undefined }), NOW).forecast,
    ).toBeUndefined();
    expect(
      proposeForecast(forecastReading({ forecastCategory: undefined }), NOW).forecast,
    ).toBeUndefined();
    expect(
      proposeForecast(forecastReading({ forecastIssuedAt: undefined }), NOW).forecast,
    ).toBeUndefined();
  });

  it('still yields a forecast context when the source published no likelihood signal', () => {
    // No class, no evidence keys — an absent likelihood is reported as absent, never defaulted to POSSIBLE.
    const proposal = proposeForecast(forecastReading({ forecastLikelihood: undefined }), NOW);
    expect(proposal.forecast?.leadTimeHours).toBe(12);
    expect(proposal.forecast?.likelihoodClass).toBeUndefined();
    expect(proposal.forecast?.likelihoodRawValue).toBeUndefined();
  });
});

describe('DRAFT-only guarantee is STRUCTURAL (Art. XIII)', () => {
  it('a threshold fire produces a DraftAlert that the alert-sink port cannot even be handed', () => {
    const proposal = buildDraftAlert({
      rule: forecastRule(),
      incidentId: asId<IncidentId>('inc-f'),
      alertId: asId<AlertId>('a-f'),
      category: 'Met',
      severity: 'EXTREME',
      sourceId: asId<SourceId>('src-glofas'),
      reading: forecastReading(),
      now: NOW,
    });
    // THE PROOF: `DraftAlert` carries the 'DRAFT' literal, `EmittableAlert` (src/ports/logistics.ts) carries
    // the 'ACTUAL' literal plus a required approver. The two are DISJOINT, so this assignment — and therefore
    // `AlertSinkPort.emit(fire.alert)` — cannot compile. If Art. XIII were ever weakened at the type level
    // this @ts-expect-error would itself become an unused-directive tsc ERROR, so the guarantee cannot rot
    // silently.
    // @ts-expect-error — Art. XIII: a threshold fire is structurally unpublishable.
    const leaked: EmittableAlert = proposal.alert;
    expect(leaked.capStatus).toBe('DRAFT'); // and at runtime it is still, only, a DRAFT
    expect(proposal.alert.approvedBy).toBeUndefined(); // no approver appears out of a computation
  });
});

describe('forecastReadingFromGauge — the single seam to the C1 likelihood work', () => {
  const gauge = (probability?: number) =>
    makeGauge({
      id: asId<GaugeId>('g-1'),
      geom: { type: 'Point', coordinates: [25.1, 45.2] },
      floodCategory: 'MAJOR',
      ...(probability === undefined ? {} : { exceedanceProbability: probability }),
    });

  it('classifies the gauge probability with the SHARED classifier and carries the evidence', () => {
    const reading = forecastReadingFromGauge(gauge(0.72), { etaHours: 12, issuedAt: FRESH_ISSUE });
    expect(reading.forecastCategory).toBe('MAJOR');
    expect(reading.forecastEtaHours).toBe(12);
    expect(reading.forecastIssuedAt).toBe(FRESH_ISSUE);
    expect(reading.forecastLikelihood).toEqual(likelihood('DERIVED_EXCEEDANCE_PROBABILITY', 0.72));
    // …and the whole reading is accepted by the engine it was built for.
    expect(conditionMet(forecastRule(), reading, at)).toBe(true);
  });

  it('leaves the likelihood ABSENT when the source published no probability, so the rule cannot fire', () => {
    const reading = forecastReadingFromGauge(gauge(), { etaHours: 12, issuedAt: FRESH_ISSUE });
    expect(reading.forecastLikelihood).toBeUndefined();
    expect(conditionMet(forecastRule(), reading, at)).toBe(false);
  });

  it('leaves the likelihood absent for an unclassifiable probability and defaults its optional inputs', () => {
    // 0.10 is below the derived-probability table's unclassifiedBelow — no class is the honest answer.
    const low = forecastReadingFromGauge(gauge(0.1), { etaHours: 12, issuedAt: FRESH_ISSUE });
    expect(low.forecastLikelihood).toBeUndefined();
    // No lead time / no vintage supplied at all: the reading carries the category and nothing invented.
    const bare = forecastReadingFromGauge(gauge(0.72));
    expect(bare).toEqual({
      forecastCategory: 'MAJOR',
      forecastLikelihood: likelihood('DERIVED_EXCEEDANCE_PROBABILITY', 0.72),
    });
  });
});
