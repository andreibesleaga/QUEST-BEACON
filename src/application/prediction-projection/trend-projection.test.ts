// BEACON — tests for the two TREND-DERIVED prediction kinds (C2.2; ADR-033 §4.1/§4.2, FEV-7, finding F-16).
//
// What these prove, beyond "it returns an object": both kinds carry method + inputs + uncertainty (the project
// invariant), both are geometry-LESS by design, both are PURE and clock-free (a fixed injected instant, no
// `Date.now()` anywhere in the module — asserted by reading the source), both label a null instead of guessing
// when the inputs are insufficient, and the ESCALATION slope is the SitRep classifier's own output rather than
// a second implementation of it. No live network, no wall clock.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { asId } from '@/domain/value-objects/ids.js';
import type { IncidentId, PredictionId, SourceId } from '@/domain/value-objects/ids.js';
import { classifyTrend, type TrendSample } from '@/application/escalation-trend/escalation-trend.js';
import { DEFAULT_TREND_CONFIG } from '@/application/shared/config.js';
import { DEFAULT_LIKELIHOOD_CONFIG } from '@/application/forecast-likelihood/likelihood-config.js';
import { gaugeLikelihoodSignal } from '@/application/forecast-likelihood/forecast-likelihood.js';
import {
  ESCALATION_METHOD,
  IMPACT_BASES,
  IMPACT_OVER_TIME_METHOD,
  projectEscalation,
  projectImpactOverTime,
  type EscalationInput,
  type ImpactCheckpoint,
  type ImpactOverTimeInput,
} from './trend-projection.js';
import { DEFAULT_TREND_PROJECTION_CONFIG } from './trend-projection-config.js';

const INC = asId<IncidentId>('inc-1');
const PID = asId<PredictionId>('p-esc');
const IID = asId<PredictionId>('p-imp');

/** The fixed clock every test injects — never read from the system (deterministic-tests rule). */
const NOW_ISO = '2026-07-05T22:00:00Z';
const NOW_MS = Date.parse(NOW_ISO);
const HOUR_S = 3600;

/** Rising: exactly +10 signal-units/hour, latest level 30 ⇒ a relative rate of exactly 1/3 per hour. */
const RISING: readonly TrendSample[] = [
  { t: 0, value: 10 },
  { t: HOUR_S, value: 20 },
  { t: 2 * HOUR_S, value: 30 },
];
/** Falling: −10/hour, latest level 10 ⇒ a relative rate of −1 per hour. */
const FALLING: readonly TrendSample[] = [
  { t: 0, value: 30 },
  { t: HOUR_S, value: 20 },
  { t: 2 * HOUR_S, value: 10 },
];
/** Flat ⇒ the classifier's dead-band absorbs it ⇒ STEADY. */
const FLAT: readonly TrendSample[] = [
  { t: 0, value: 12 },
  { t: HOUR_S, value: 12 },
  { t: 2 * HOUR_S, value: 12 },
];

const SIGNAL_LABEL = 'burned area (acres)';

function escalationInput(over: Partial<EscalationInput> = {}): EscalationInput {
  return { id: PID, incidentId: INC, signal: { samples: RISING }, signalLabel: SIGNAL_LABEL, ...over };
}

function impactInput(over: Partial<ImpactOverTimeInput> = {}): ImpactOverTimeInput {
  return {
    id: IID,
    incidentId: INC,
    basis: 'exposedPopulation',
    currentCount: 90,
    series: RISING,
    signalLabel: SIGNAL_LABEL,
    nowMs: NOW_MS,
    ...over,
  };
}

// ── ESCALATION (ADR-033 §4.1) ─────────────────────────────────────────────────────────────────────

describe('projectEscalation', () => {
  it('constructs a labeled ESCALATION prediction — the kind that was declared but never built (F-16)', () => {
    const p = projectEscalation(escalationInput({ sourceId: asId<SourceId>('firms') }));
    if (p === null) throw new Error('expected an ESCALATION prediction');
    expect(p.kind).toBe('ESCALATION');
    expect(p.id).toBe(PID);
    expect(p.incidentId).toBe(INC);
    expect(p.method).toBe(ESCALATION_METHOD);
    expect(p.method).toContain('first-order');
    expect(p.sourceId).toBe('firms');
    // Method + inputs + uncertainty — the invariant every predicted figure in BEACON must carry.
    expect(Object.keys(p.inputs).length).toBeGreaterThan(0);
    expect(p.uncertainty).toBeGreaterThan(0);
  });

  // F-96 REGRESSION GUARD. `0.4 + 3 * 0.1` is `0.7000000000000001` in IEEE-754, and that residue was
  // being published on `GET /incidents/{id}/sitrep` — invisible in the UI (ICU renders `0.7`), so it
  // survived precisely because nothing on screen showed it. False precision on a figure the project
  // explicitly labels as APPROXIMATE is a small honesty defect, and an unpinned fix is one refactor away
  // from returning. Every uncertainty BEACON publishes must therefore carry only the precision its config
  // inputs actually hold.
  it('publishes no floating-point residue on any uncertainty label (F-96)', () => {
    const atMostTwoDecimals = (n: number, where: string): void => {
      expect(Number.isFinite(n), where).toBe(true);
      // Exact: the value must equal its own 2-dp rounding, so 0.7000000000000001 fails and 0.7 passes.
      expect(n, `${where} carries more precision than its inputs do`).toBe(Math.round(n * 100) / 100);
    };

    // The exact shape that produced the residue: the escalation curve at the sample shortfall.
    const esc = projectEscalation(escalationInput());
    if (esc === null) throw new Error('expected an ESCALATION prediction');
    atMostTwoDecimals(esc.uncertainty, 'ESCALATION.uncertainty');

    // And every checkpoint of the impact curve, plus the prediction's own (the furthest checkpoint's).
    const imp = projectImpactOverTime(impactInput());
    if (imp === null) throw new Error('expected an IMPACT_OVER_TIME prediction');
    atMostTwoDecimals(imp.uncertainty, 'IMPACT_OVER_TIME.uncertainty');
    for (const cp of (imp.inputs as { checkpoints: readonly { horizonHours: number; uncertainty: number }[] }).checkpoints) {
      atMostTwoDecimals(cp.uncertainty, `checkpoint +${cp.horizonHours}h`);
    }

    // Rounding must not have flattened the curve into a constant — the labels still have to MEAN something.
    const spread = new Set(
      (imp.inputs as { checkpoints: readonly { uncertainty: number }[] }).checkpoints.map((c) => c.uncertainty),
    );
    expect(spread.size, 'checkpoint uncertainties must still differ by horizon').toBeGreaterThan(1);
  });

  it('carries the classifier\'s FULL TrendResult verbatim — no second implementation of the slope', () => {
    const p = projectEscalation(escalationInput());
    const expected = classifyTrend({ samples: RISING }, DEFAULT_TREND_CONFIG);
    const inputs = p?.inputs as { trend: string; slopePerHour: number; samples: number; deadbandPerHour: number };
    expect(inputs.trend).toBe(expected.trend);
    expect(inputs.slopePerHour).toBe(expected.slopePerHour);
    expect(inputs.samples).toBe(expected.samples);
    expect(inputs.deadbandPerHour).toBe(expected.deadbandPerHour);
    expect(inputs.slopePerHour).toBe(10); // +10 units/hour, computed by classifyTrend, not by this module
  });

  it('labels the signal units + the sample window, and states its caveat', () => {
    const inputs = projectEscalation(escalationInput())?.inputs as {
      signalLabel: string;
      windowHours: number;
      caveat: string;
    };
    expect(inputs.signalLabel).toBe(SIGNAL_LABEL);
    expect(inputs.windowHours).toBe(2);
    expect(inputs.caveat).toContain('DIRECTION');
    expect(inputs.caveat).toContain('no geometry');
  });

  it('carries NO geometry, by design (ADR-033 §4.1) — it is a temporal statement, not a footprint', () => {
    expect(projectEscalation(escalationInput())?.geom).toBeUndefined();
  });

  it('projects a DEESCALATING trend too (the kind states the direction, it does not judge it)', () => {
    const p = projectEscalation(escalationInput({ signal: { samples: FALLING } }));
    expect((p?.inputs as { trend: string }).trend).toBe('DEESCALATING');
    expect((p?.inputs as { slopePerHour: number }).slopePerHour).toBe(-10);
  });

  it('a STEADY trend yields a labeled null — never an invented direction (Art. XVI)', () => {
    expect(projectEscalation(escalationInput({ signal: { samples: FLAT } }))).toBeNull();
  });

  it('too few samples yields null (the classifier reports STEADY, and a refused slope is never projected)', () => {
    expect(projectEscalation(escalationInput({ signal: { samples: RISING.slice(0, 2) } }))).toBeNull();
  });

  it('uncertainty falls as the sample count rises, on the CONFIG curve (fewer samples ⇒ less certain)', () => {
    const cfg = DEFAULT_TREND_PROJECTION_CONFIG.escalation;
    const sparse = projectEscalation(escalationInput());
    const dense = projectEscalation(
      escalationInput({
        signal: { samples: Array.from({ length: cfg.referenceSamples }, (_, i) => ({ t: i * HOUR_S, value: 10 * (i + 1) })) },
      }),
    );
    expect(sparse?.uncertainty).toBeCloseTo(
      cfg.baseUncertainty + (cfg.referenceSamples - RISING.length) * cfg.uncertaintyPerMissingSample,
      10,
    );
    expect(dense?.uncertainty).toBeCloseTo(cfg.baseUncertainty, 10); // at/above the reference: no penalty
    expect(dense!.uncertainty).toBeLessThan(sparse!.uncertainty);
  });

  it('takes the sparsity curve from an INJECTED config (ADR-012 — the curve is data, not code)', () => {
    const p = projectEscalation(escalationInput(), {
      projection: {
        ...DEFAULT_TREND_PROJECTION_CONFIG,
        escalation: { referenceSamples: 3, baseUncertainty: 0.1, uncertaintyPerMissingSample: 0.5, basis: 'injected for the test' },
      },
    });
    expect(p?.uncertainty).toBeCloseTo(0.1, 10); // 3 samples = the injected reference ⇒ no penalty
  });

  it('honours an injected TrendConfig: a wider dead-band absorbs the same rise into STEADY', () => {
    expect(projectEscalation(escalationInput(), { trend: { minSamples: 3, deadbandPerHour: 25 } })).toBeNull();
  });

  it('omits horizon/likelihoodClass/etaHours/sourceId when no source supported them', () => {
    const p = projectEscalation(escalationInput());
    expect(p?.horizon).toBeUndefined();
    expect(p?.likelihoodClass).toBeUndefined();
    expect(p?.etaHours).toBeUndefined();
    expect(p?.sourceId).toBeUndefined();
    expect((p?.inputs as { hazardArrival?: string }).hazardArrival).toBeUndefined();
  });

  it('reuses the C1 classifier for a SOURCE-published probability: class + ETA + arrival, with evidence', () => {
    // The signal comes from a gauge the source published a derived exceedance probability on (C1.1/C1.2) —
    // it is never derived from the trend, which would be the invented heuristic FUW-3 forbids.
    const signal = gaugeLikelihoodSignal({ exceedanceProbability: 0.72 });
    const p = projectEscalation(
      escalationInput({ forecast: { nowMs: NOW_MS, etaHours: 12, ...(signal === undefined ? {} : { signal }) } }),
      { likelihood: DEFAULT_LIKELIHOOD_CONFIG },
    );
    expect(p?.likelihoodClass).toBe('VERY_LIKELY');
    expect(p?.etaHours).toBe(12);
    expect(p?.horizon).toBe('2026-07-06T10:00:00.000Z'); // hazardArrival = injected now + 12 h
    const inputs = p?.inputs as { likelihoodRawValue: number; likelihoodSourceField: string; hazardArrival: string };
    expect(inputs.likelihoodRawValue).toBe(0.72); // a class never travels without its raw value (FU-11)
    expect(inputs.likelihoodSourceField.length).toBeGreaterThan(0);
    expect(inputs.hazardArrival).toBe('2026-07-06T10:00:00.000Z');
  });

  it('a forecast the source did not support adds neither class nor ETA (an empty bag, not a default)', () => {
    const p = projectEscalation(escalationInput({ forecast: { nowMs: NOW_MS } }));
    expect(p?.likelihoodClass).toBeUndefined();
    expect(p?.etaHours).toBeUndefined();
    expect(p?.horizon).toBeUndefined();
  });
});

// ── IMPACT_OVER_TIME (ADR-033 §4.2) ───────────────────────────────────────────────────────────────

describe('projectImpactOverTime', () => {
  it('constructs a labeled IMPACT_OVER_TIME prediction at the config checkpoints (F-16)', () => {
    const p = projectImpactOverTime(impactInput({ sourceId: asId<SourceId>('glofas') }));
    if (p === null) throw new Error('expected an IMPACT_OVER_TIME prediction');
    expect(p.kind).toBe('IMPACT_OVER_TIME');
    expect(p.method).toBe(IMPACT_OVER_TIME_METHOD);
    expect(p.geom).toBeUndefined(); // geometry-less by design (ADR-033 §4.2)
    expect(p.sourceId).toBe('glofas');
    const inputs = p.inputs as { basis: string; currentCount: number; checkpoints: readonly ImpactCheckpoint[] };
    expect(inputs.basis).toBe('exposedPopulation');
    expect(IMPACT_BASES).toContain(inputs.basis);
    expect(inputs.currentCount).toBe(90); // the count comes IN from the exposure pipeline, never re-derived
    expect(inputs.checkpoints.map((c) => c.horizonHours)).toEqual([
      ...DEFAULT_TREND_PROJECTION_CONFIG.impactOverTime.checkpointHours,
    ]);
  });

  it('projects the count along the trend\'s RELATIVE rate — exact, reproducible arithmetic', () => {
    // +10 units/h at a latest level of 30 ⇒ +1/3 per hour; 90 exposed ⇒ 270 / 450 / 810 at +6/+12/+24 h.
    const inputs = projectImpactOverTime(impactInput())?.inputs as {
      slopePerHour: number;
      referenceLevel: number;
      relativeRatePerHour: number;
      checkpoints: readonly ImpactCheckpoint[];
    };
    expect(inputs.slopePerHour).toBe(10);
    expect(inputs.referenceLevel).toBe(30);
    expect(inputs.relativeRatePerHour).toBeCloseTo(1 / 3, 12);
    expect(inputs.checkpoints.map((c) => c.projectedCount)).toEqual([270, 450, 810]);
    expect(inputs.checkpoints.map((c) => c.at)).toEqual([
      '2026-07-06T04:00:00.000Z',
      '2026-07-06T10:00:00.000Z',
      '2026-07-06T22:00:00.000Z',
    ]);
  });

  it('takes the LATEST sample as the reference level even when the series is unsorted', () => {
    const shuffled: readonly TrendSample[] = [RISING[2]!, RISING[0]!, RISING[1]!];
    const inputs = projectImpactOverTime(impactInput({ series: shuffled }))?.inputs as { referenceLevel: number };
    expect(inputs.referenceLevel).toBe(30);
  });

  it('uncertainty compounds with horizon distance; the prediction carries the FURTHEST (worst) case', () => {
    const cfg = DEFAULT_TREND_PROJECTION_CONFIG.impactOverTime;
    const p = projectImpactOverTime(impactInput());
    const checkpoints = (p?.inputs as { checkpoints: readonly ImpactCheckpoint[] }).checkpoints;
    const rising = checkpoints.map((c) => c.uncertainty);
    expect(rising).toEqual([...rising].sort((a, b) => a - b));
    expect(rising[0]).toBeLessThan(rising[rising.length - 1]!);
    expect(p?.uncertainty).toBe(checkpoints[checkpoints.length - 1]!.uncertainty);
    expect(p?.uncertainty).toBeCloseTo(
      cfg.baseUncertainty + cfg.checkpointHours[cfg.checkpointHours.length - 1]! * cfg.uncertaintyPerHour,
      10,
    );
    // The horizon is the furthest checkpoint's instant — the span the prediction actually covers.
    expect(p?.horizon).toBe(checkpoints[checkpoints.length - 1]!.at);
  });

  it('a falling signal projects DOWN and is floored at 0 — never a negative count', () => {
    const inputs = projectImpactOverTime(impactInput({ series: FALLING }))?.inputs as {
      relativeRatePerHour: number;
      checkpoints: readonly ImpactCheckpoint[];
    };
    expect(inputs.relativeRatePerHour).toBe(-1);
    expect(inputs.checkpoints.map((c) => c.projectedCount)).toEqual([0, 0, 0]);
  });

  it('a STEADY series still projects — a flat count over 24 h is an honest statement', () => {
    const inputs = projectImpactOverTime(impactInput({ series: FLAT }))?.inputs as {
      slopePerHour: number;
      checkpoints: readonly ImpactCheckpoint[];
    };
    expect(inputs.slopePerHour).toBe(0);
    expect(inputs.checkpoints.map((c) => c.projectedCount)).toEqual([90, 90, 90]);
  });

  it('states its caveat: a scaled exposure count, NOT a re-computed future intersection', () => {
    const inputs = projectImpactOverTime(impactInput())?.inputs as { caveat: string; projection: string };
    expect(inputs.caveat).toContain('NOT a re-computed intersection');
    expect(inputs.caveat).toContain('not physics-grade');
    expect(inputs.projection).toContain('floored at 0');
  });

  it('returns null with no injected clock — a projection with no base instant is not a projection', () => {
    expect(projectImpactOverTime(impactInput({ nowMs: Number.NaN }))).toBeNull();
  });

  it('returns null on an unusable count (negative or non-finite)', () => {
    expect(projectImpactOverTime(impactInput({ currentCount: -1 }))).toBeNull();
    expect(projectImpactOverTime(impactInput({ currentCount: Number.POSITIVE_INFINITY }))).toBeNull();
  });

  it('returns null on insufficient time-series data (fewer samples than the classifier itself requires)', () => {
    expect(projectImpactOverTime(impactInput({ series: RISING.slice(0, 2) }))).toBeNull();
    expect(projectImpactOverTime(impactInput({ series: [] }))).toBeNull();
  });

  it('returns null when the latest signal level is not positive — no relative rate can be formed', () => {
    const zeroed: readonly TrendSample[] = [
      { t: 0, value: 5 },
      { t: HOUR_S, value: 2 },
      { t: 2 * HOUR_S, value: 0 },
    ];
    expect(projectImpactOverTime(impactInput({ series: zeroed }))).toBeNull();
    // And with an EMPTY series admitted by a permissive minSamples: still null, never a divide-by-nothing.
    expect(
      projectImpactOverTime(impactInput({ series: [] }), { trend: { minSamples: 0, deadbandPerHour: 0.5 } }),
    ).toBeNull();
  });

  it('honours injected checkpoints (ADR-012 — the horizons are data, not code)', () => {
    const p = projectImpactOverTime(impactInput(), {
      projection: {
        ...DEFAULT_TREND_PROJECTION_CONFIG,
        impactOverTime: {
          checkpointHours: [3],
          baseUncertainty: 0.5,
          uncertaintyPerHour: 0.1,
          basis: 'injected for the test',
        },
      },
    });
    const checkpoints = (p?.inputs as { checkpoints: readonly ImpactCheckpoint[] }).checkpoints;
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]!.horizonHours).toBe(3);
    expect(p?.uncertainty).toBeCloseTo(0.8, 10);
  });

  it('reuses the C1 classifier for a source-published signal, and omits it otherwise', () => {
    const withSignal = projectImpactOverTime(
      impactInput({
        forecast: { nowMs: NOW_MS, signal: { signalType: 'CATEGORICAL_ADVISORY_TIER', value: 'medium' }, forecastInstant: '2026-07-06T04:00:00Z' },
      }),
      { likelihood: DEFAULT_LIKELIHOOD_CONFIG },
    );
    expect(withSignal?.likelihoodClass).toBe('LIKELY');
    expect(withSignal?.etaHours).toBe(6); // derived from the source's own forecast instant, injected clock
    const bare = projectImpactOverTime(impactInput());
    expect(bare?.likelihoodClass).toBeUndefined();
    expect(bare?.etaHours).toBeUndefined();
  });
});

// ── Determinism / Art. XII ────────────────────────────────────────────────────────────────────────

describe('both kinds are deterministic, replayable and clock-free (Art. XII)', () => {
  const source = readFileSync(fileURLToPath(new URL('./trend-projection.ts', import.meta.url)), 'utf8');

  it('the module reads NO wall clock: no Date.now(), no argument-less new Date()', () => {
    expect(source).not.toMatch(/Date\.now\s*\(/);
    expect(source).not.toMatch(/new Date\s*\(\s*\)/);
    expect(source).toContain('new Date(input.nowMs'); // the only clock is the injected one
  });

  it('holds no uncertainty or checkpoint literal — every parameter comes from the config table (ADR-012)', () => {
    const code = source.replace(/^\s*(\/\/|\*|\/\*).*$/gm, ''); // ignore prose in comments
    for (const literal of ['0.4', '0.02', '0.1', '[6', '24']) expect(code).not.toContain(literal);
  });

  it('the same inputs replayed twice yield byte-identical predictions', () => {
    expect(JSON.stringify(projectEscalation(escalationInput()))).toBe(
      JSON.stringify(projectEscalation(escalationInput())),
    );
    expect(JSON.stringify(projectImpactOverTime(impactInput()))).toBe(
      JSON.stringify(projectImpactOverTime(impactInput())),
    );
  });

  it('the injected clock is the ONLY thing that moves the projected instants', () => {
    const later = projectImpactOverTime(impactInput({ nowMs: NOW_MS + 3_600_000 }));
    const base = projectImpactOverTime(impactInput());
    const at = (p: typeof base): readonly string[] =>
      (p?.inputs as { checkpoints: readonly ImpactCheckpoint[] }).checkpoints.map((c) => c.at);
    expect(at(later)).not.toEqual(at(base));
    // Everything that is not an instant is identical — the clock shifts times, never counts.
    const counts = (p: typeof base): readonly number[] =>
      (p?.inputs as { checkpoints: readonly ImpactCheckpoint[] }).checkpoints.map((c) => c.projectedCount);
    expect(counts(later)).toEqual(counts(base));
  });
});
