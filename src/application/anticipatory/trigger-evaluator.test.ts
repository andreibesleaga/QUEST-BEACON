// BEACON — trigger-evaluator tests (D2; ADR-034 §3, V3/V4). PURE and CLOCK-FREE: every instant below is
// injected, the forecast is a value read from a recorded fixture file, and there is no network anywhere.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { TriggerState } from '@/domain/early-action-protocol.js';
import { beginEpisode, transitionEap, recordStageFired } from '@/domain/early-action-protocol.js';
import { parseEnsembleMemberFile } from './ensemble-evidence.js';
import type { EnsembleMemberFile, SourceProbabilityReading } from './ensemble-evidence.js';
import type { TriggerForecast } from './trigger-evaluator.js';
import { evaluateEapTriggers } from './trigger-evaluator.js';
import { shippedEap } from './eap-config.js';

const CLOCK = '2026-07-05T22:00:00Z';
const NOW = Date.parse(CLOCK);
const HOUR = 3_600_000;

const EAP = shippedEap('ro-danube-flood')!;

const load = (name: string): EnsembleMemberFile =>
  parseEnsembleMemberFile(
    JSON.parse(
      readFileSync(
        fileURLToPath(new URL(`../../../fixtures/anticipatory/${name}.json`, import.meta.url)),
        'utf8',
      ),
    ),
  );

const RUN_1 = load('ro-danube-discharge-ensemble-run-1'); // issued 00:00Z, lead 110 h, 37/51 over 6500
const RUN_2 = load('ro-danube-discharge-ensemble-run-2'); // issued 18:00Z, lead  40 h, 36/51 over 7200

const members = (file: EnsembleMemberFile): TriggerForecast => ({ kind: 'ENSEMBLE_MEMBERS', file });

const PROBABILITY: SourceProbabilityReading = {
  forecastVersion: 'reporting-point-run-1',
  parameter: 'exceedance of the reporting point return period',
  unit: 'dimensionless probability fraction in [0,1]',
  issuedAt: '2026-07-05T18:00:00Z',
  leadTimeHours: 40,
  sourceTier: 'CACHED',
  sourceStatement:
    'Derived exceedance probability published by the source product itself, carried verbatim.',
  probability: 0.72,
};
const probability = (over: Partial<SourceProbabilityReading> = {}): TriggerForecast => ({
  kind: 'SOURCE_PROBABILITY',
  reading: { ...PROBABILITY, ...over },
});

const idle = (): TriggerState =>
  beginEpisode({ eapId: EAP.id, episodeId: 'ep-1', at: '2026-07-05T06:00:00Z' });
const readinessState = (): TriggerState =>
  recordStageFired(transitionEap(idle(), 'READINESS', '2026-07-05T08:00:00Z'), 'READINESS');
const activatedState = (at = '2026-07-05T20:00:00Z'): TriggerState =>
  recordStageFired(
    recordStageFired(transitionEap(idle(), 'ACTIVATED', at), 'READINESS'),
    'ACTIVATION',
  );

describe('the two-stage ladder (FR-AA-2 / FU-14)', () => {
  it('fires READINESS from IDLE on the long-lead run, and does NOT reach activation', () => {
    const result = evaluateEapTriggers({
      eap: EAP,
      priorState: idle(),
      forecast: members(RUN_1),
      nowMs: NOW,
    });
    expect(result.fired).toBe('READINESS');
    expect(result.from).toBe('IDLE');
    expect(result.to).toBe('READINESS');
    expect(result.reason).toBe('FIRED');
    expect(result.gate?.stage).toBe('READINESS');
    expect(result.gate?.appliedGate).toBe('MEMBER_FRACTION');
  });

  it('shows the arithmetic that produced the decision, not just the decision', () => {
    const { evidence } = evaluateEapTriggers({
      eap: EAP,
      priorState: idle(),
      forecast: members(RUN_1),
      nowMs: NOW,
    });
    expect(evidence?.kind).toBe('ENSEMBLE_MEMBER_COUNT');
    if (evidence?.kind !== 'ENSEMBLE_MEMBER_COUNT')
      return expect.unreachable('expected member-count evidence');
    expect(evidence.membersOverThreshold).toBe(37);
    expect(evidence.memberTotal).toBe(51);
    expect(evidence.threshold).toBe(6500);
    expect(evidence.forecastVersion).toBe(RUN_1.forecastVersion);
    expect(evidence.issuedAt).toBe(RUN_1.issuedAt);
    expect(evidence.leadTimeHours).toBe(110);
  });

  it('maps the member share onto an ADR-033 class through the shared classifier, with its method', () => {
    const { likelihood } = evaluateEapTriggers({
      eap: EAP,
      priorState: idle(),
      forecast: members(RUN_1),
      nowMs: NOW,
    });
    expect(likelihood?.likelihoodClass).toBe('VERY_LIKELY'); // 37/51 = 0.725 -> the >=0.6 band
    expect(likelihood?.rawValue).toBeCloseTo(37 / 51, 12);
    expect(likelihood?.method).toMatch(/never as a chance of occurrence/i);
    expect(likelihood?.sourceField).toMatch(/cached forecast file/i);
  });

  it('fires ACTIVATION from READINESS once the converged short-lead run arrives', () => {
    const result = evaluateEapTriggers({
      eap: EAP,
      priorState: readinessState(),
      forecast: members(RUN_2),
      nowMs: NOW,
    });
    expect(result.fired).toBe('ACTIVATION');
    expect(result.to).toBe('ACTIVATED');
    expect(result.gate?.stage).toBe('ACTIVATION');
    expect(result.gate?.threshold).toBe(7200);
  });

  it('fires ACTIVATION straight from IDLE when one run satisfies both stages (sudden onset)', () => {
    const result = evaluateEapTriggers({
      eap: EAP,
      priorState: idle(),
      forecast: members(RUN_2),
      nowMs: NOW,
    });
    expect(result.fired).toBe('ACTIVATION');
    expect(result.from).toBe('IDLE');
    expect(result.to).toBe('ACTIVATED');
  });

  it('suggests only pre-positioning and internal briefing at READINESS; tasking only at ACTIVATION', () => {
    const readiness = evaluateEapTriggers({
      eap: EAP,
      priorState: idle(),
      forecast: members(RUN_1),
      nowMs: NOW,
    });
    expect(readiness.suggestedActionIds).toEqual([
      'preposition-dewatering-supplies',
      'preposition-medical-cache',
      'brief-branch-duty-officer',
    ]);
    const activation = evaluateEapTriggers({
      eap: EAP,
      priorState: idle(),
      forecast: members(RUN_2),
      nowMs: NOW,
    });
    expect(activation.suggestedActionIds).toContain('stage-standby-crew');
  });

  it('never DOWN-transitions an activated protocol on a readiness crossing', () => {
    const result = evaluateEapTriggers({
      eap: EAP,
      priorState: activatedState(),
      forecast: members(RUN_2),
      nowMs: NOW,
    });
    expect(result.fired).toBeNull();
    expect(result.to).toBe('ACTIVATED');
    expect(result.reason).toBe('STAGE_ALREADY_FIRED');
  });

  it('de-escalates READINESS→IDLE when the readiness condition clears before activation', () => {
    const cleared = { ...RUN_1, members: RUN_1.members.map(() => 10) }; // every member far below 6500
    const result = evaluateEapTriggers({
      eap: EAP,
      priorState: readinessState(),
      forecast: members(cleared),
      nowMs: NOW,
    });
    expect(result.fired).toBeNull();
    expect(result.to).toBe('IDLE');
    expect(result.reason).toBe('MAGNITUDE_GATE_NOT_MET');
    expect(result.gate?.stage).toBe('READINESS');
  });
});

describe('the member-fraction gate is a boundary, tested at the boundary (V4)', () => {
  // The readiness stage needs 0.3 of the members over 6500. A 10-member file makes the fraction exact.
  const ten = (over: number): EnsembleMemberFile => ({
    ...RUN_1,
    leadTimeHours: 100,
    members: [
      ...Array.from({ length: over }, () => 9000),
      ...Array.from({ length: 10 - over }, () => 10),
    ],
  });

  it.each([
    [2, 0.2, false],
    [3, 0.3, true],
    [4, 0.4, true],
  ])('%s of 10 members over the threshold = %s ⇒ fired: %s', (over, fraction, fires) => {
    const result = evaluateEapTriggers({
      eap: EAP,
      priorState: idle(),
      forecast: members(ten(over)),
      nowMs: NOW,
    });
    const evidence = result.evidence;
    if (evidence?.kind !== 'ENSEMBLE_MEMBER_COUNT')
      return expect.unreachable('expected member-count evidence');
    expect(evidence.memberFraction).toBeCloseTo(fraction, 12);
    expect(result.fired === 'READINESS').toBe(fires);
  });

  it('reports MAGNITUDE_GATE_NOT_MET, never a fire, when the share is one member short', () => {
    const result = evaluateEapTriggers({
      eap: EAP,
      priorState: idle(),
      forecast: members(ten(2)),
      nowMs: NOW,
    });
    expect(result.fired).toBeNull();
    expect(result.reason).toBe('MAGNITUDE_GATE_NOT_MET');
    expect(result.to).toBe('IDLE');
  });
});

describe('a SOURCE_DERIVED_PROBABILITY is gated by its CLASS and never becomes a member count', () => {
  it('applies the likelihood-class gate, not the member-fraction gate', () => {
    const result = evaluateEapTriggers({
      eap: EAP,
      priorState: readinessState(),
      forecast: probability(),
      nowMs: NOW,
    });
    expect(result.gate?.appliedGate).toBe('LIKELIHOOD_CLASS');
    expect(result.likelihood?.likelihoodClass).toBe('VERY_LIKELY'); // 0.72 -> the >=0.6 band
    expect(result.fired).toBe('ACTIVATION');
  });

  it('NEVER yields a memberTotal in the result (the two kinds are disjoint — ADR-034 §3)', () => {
    const result = evaluateEapTriggers({
      eap: EAP,
      priorState: idle(),
      forecast: probability(),
      nowMs: NOW,
    });
    expect(result.evidence?.kind).toBe('SOURCE_DERIVED_PROBABILITY');
    expect(JSON.stringify(result.evidence)).not.toMatch(
      /memberTotal|membersOverThreshold|memberFraction/,
    );
  });

  it('refuses to fire on a probability no band classifies, rather than defaulting to a class', () => {
    const result = evaluateEapTriggers({
      eap: EAP,
      priorState: readinessState(),
      forecast: probability({ probability: 0.1 }),
      nowMs: NOW,
    });
    expect(result.fired).toBeNull();
    expect(result.reason).toBe('UNCLASSIFIED_SIGNAL');
    expect(result.likelihood).toBeUndefined();
  });

  it('refuses to fire when the class is below the stage floor', () => {
    // 0.45 classifies LIKELY; the ACTIVATION stage floor is VERY_LIKELY.
    const result = evaluateEapTriggers({
      eap: EAP,
      priorState: readinessState(),
      forecast: probability({ probability: 0.45 }),
      nowMs: NOW,
    });
    expect(result.likelihood?.likelihoodClass).toBe('LIKELY');
    expect(result.fired).toBeNull();
    expect(result.reason).toBe('MAGNITUDE_GATE_NOT_MET');
  });
});

describe('the gates that keep an anticipatory decision honest', () => {
  it('refuses a lead time outside the stage horizon', () => {
    // RUN_1 is a 110 h horizon: inside READINESS (120 h) but far outside ACTIVATION (48 h).
    const result = evaluateEapTriggers({
      eap: EAP,
      priorState: readinessState(),
      forecast: members(RUN_1),
      nowMs: NOW,
    });
    expect(result.fired).toBeNull();
    expect(result.reason).toBe('LEAD_TIME_OUTSIDE_STAGE_HORIZON');
    expect(result.to).toBe('READINESS');
  });

  it('refuses a zero or negative lead time — a crossing already upon us is not anticipatory', () => {
    for (const leadTimeHours of [0]) {
      const result = evaluateEapTriggers({
        eap: EAP,
        priorState: idle(),
        forecast: members({ ...RUN_1, leadTimeHours }),
        nowMs: NOW,
      });
      expect(result.reason).toBe('LEAD_TIME_OUTSIDE_STAGE_HORIZON');
    }
  });

  it('refuses an unparseable vintage', () => {
    const result = evaluateEapTriggers({
      eap: EAP,
      priorState: idle(),
      forecast: probability({ issuedAt: 'sometime' }),
      nowMs: NOW,
    });
    expect(result.reason).toBe('UNPARSEABLE_VINTAGE');
    expect(result.evidence).toBeUndefined();
  });

  it('refuses a vintage in the FUTURE — a bad timestamp must not buy unlimited freshness', () => {
    const result = evaluateEapTriggers({
      eap: EAP,
      priorState: idle(),
      forecast: probability({ issuedAt: '2026-07-06T06:00:00Z' }),
      nowMs: NOW,
    });
    expect(result.reason).toBe('FUTURE_VINTAGE');
  });

  it('refuses a run older than the configured vintage window (24 h)', () => {
    const result = evaluateEapTriggers({
      eap: EAP,
      priorState: idle(),
      forecast: members(RUN_1),
      nowMs: NOW + 26 * HOUR,
    });
    expect(result.reason).toBe('STALE_VINTAGE');
  });

  it('refuses a SUPERSEDED run arriving out of order', () => {
    const seen: TriggerState = { ...idle(), latestForecastIssuedAt: '2026-07-05T18:00:00Z' };
    const result = evaluateEapTriggers({
      eap: EAP,
      priorState: seen,
      forecast: members(RUN_1),
      nowMs: NOW,
    });
    expect(result.reason).toBe('SUPERSEDED_RUN');
    expect(result.to).toBe('IDLE');
  });

  it('accepts a run at exactly the newest vintage already seen (not older ⇒ not superseded)', () => {
    const seen: TriggerState = { ...idle(), latestForecastIssuedAt: RUN_2.issuedAt };
    expect(
      evaluateEapTriggers({ eap: EAP, priorState: seen, forecast: members(RUN_2), nowMs: NOW })
        .fired,
    ).toBe('ACTIVATION');
  });

  it('reports NO_EVIDENCE — never a guess — when no forecast arrived at all', () => {
    const result = evaluateEapTriggers({ eap: EAP, priorState: idle(), nowMs: NOW });
    expect(result.reason).toBe('NO_EVIDENCE');
    expect(result.fired).toBeNull();
    expect(result.evidence).toBeUndefined();
    expect(result.suggestedActionIds).toEqual([]);
  });

  it('honours an injected vintage window instead of the shipped one', () => {
    const wide = evaluateEapTriggers({
      eap: EAP,
      priorState: idle(),
      forecast: members(RUN_1),
      nowMs: NOW + 26 * HOUR,
      forecastConfig: {
        version: 1,
        authority: 'test',
        firePolicy: 'test',
        leadTime: { minHours: 0, maxHours: 168, basis: 'test' },
        vintage: { maxForecastAgeHours: 72, basis: 'test' },
      },
    });
    expect(wide.reason).toBe('FIRED');
  });
});

describe('the STOP mechanism inside the evaluator', () => {
  it('does not re-evaluate a STOPPED episode, and produces no transition', () => {
    const stopped: TriggerState = { ...activatedState(), state: 'STOPPED' };
    const result = evaluateEapTriggers({
      eap: EAP,
      priorState: stopped,
      forecast: members(RUN_2),
      nowMs: NOW,
    });
    expect(result.fired).toBeNull();
    expect(result.from).toBe('STOPPED');
    expect(result.to).toBe('STOPPED');
    expect(result.reason).toBe('EPISODE_STOPPED');
    expect(result.evidence).toBeUndefined();
  });

  it('closes an activation that outlived its declared maximum duration, even with no forecast', () => {
    const state = activatedState('2026-07-05T20:00:00Z');
    const result = evaluateEapTriggers({
      eap: EAP,
      priorState: state,
      nowMs: Date.parse('2026-07-05T20:00:00Z') + 168 * HOUR,
    });
    expect(result.to).toBe('STOPPED');
    expect(result.reason).toBe('MAX_DURATION_ELAPSED');
    expect(result.stop).toEqual({
      conditionId: 'system-max-duration-elapsed',
      authorizerRole: 'EM',
      durationEnforced: true,
    });
  });

  it('checks the duration BEFORE the forecast, so fresh data cannot keep an expired activation alive', () => {
    const state = activatedState('2026-07-05T20:00:00Z');
    const result = evaluateEapTriggers({
      eap: EAP,
      priorState: state,
      forecast: members(RUN_2),
      nowMs: Date.parse('2026-07-05T20:00:00Z') + 200 * HOUR,
    });
    expect(result.reason).toBe('MAX_DURATION_ELAPSED');
    expect(result.to).toBe('STOPPED');
  });
});

describe('purity and determinism (the property the replay test proves end-to-end)', () => {
  it('returns a deep-equal result for identical inputs, evidence object included', () => {
    const input = { eap: EAP, priorState: idle(), forecast: members(RUN_1), nowMs: NOW };
    expect(evaluateEapTriggers(input)).toEqual(evaluateEapTriggers(input));
  });

  it('stamps the evaluation instant from the INJECTED clock only', () => {
    expect(evaluateEapTriggers({ eap: EAP, priorState: idle(), nowMs: NOW }).evaluatedAt).toBe(
      '2026-07-05T22:00:00.000Z',
    );
    expect(evaluateEapTriggers({ eap: EAP, priorState: idle(), nowMs: 0 }).evaluatedAt).toBe(
      '1970-01-01T00:00:00.000Z',
    );
  });

  it('mutates neither the prior state nor the forecast file', () => {
    const prior = idle();
    const snapshot = JSON.stringify({ prior, file: RUN_1 });
    evaluateEapTriggers({ eap: EAP, priorState: prior, forecast: members(RUN_1), nowMs: NOW });
    expect(JSON.stringify({ prior, file: RUN_1 })).toBe(snapshot);
  });
});
