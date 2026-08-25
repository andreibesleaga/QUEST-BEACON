// BEACON — Outlook ranking tests (C2.3; ADR-033 §5, FEV-8).
//
// Two halves, both deliberate:
//   1. ORDERING LAWS. A comparator that is not a total order does not misplace one row — it silently
//      corrupts every ranking, and `Array.prototype.sort` is free to produce any permutation for an
//      inconsistent comparator. So the laws are asserted EXHAUSTIVELY over the comparator's whole declared
//      input space (every likelihood class × every ETA shape incl. the non-finite ones × every severity),
//      plus a seeded pseudo-random sample for the sort-level properties. `fast-check` is NOT a devDependency
//      of this repo and adding one is out of scope, so the generator is a 12-line LCG — deterministic by
//      construction, which a property runner would only have been configured to be anyway.
//   2. THE EXACT TIEBREAK CHAIN (class beats ETA beats severity), mirroring priority-ranking.test.ts's
//      tie-break style: laws prove the order is well-formed, these prove it is the ORDER ADR-033 SPECIFIES.
import { describe, it, expect } from 'vitest';
import { asId } from '@/domain/value-objects/ids.js';
import type { PredictionId, IncidentId, SourceId } from '@/domain/value-objects/ids.js';
import {
  makePrediction,
  likelihoodClassRank,
  LIKELIHOOD_CLASSES,
  type LikelihoodClass,
  type Prediction,
} from '@/domain/prediction.js';
import { ALERT_SEVERITIES, type AlertSeverity } from '@/domain/alert.js';
import { compareOutlookItems, rankOutlook, type OutlookItem } from './outlook.js';

// Fixed clock — no wall-clock read anywhere in this file (deterministic tests).
const NOW_ISO = '2026-07-05T22:00:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);

const INCIDENT = asId<IncidentId>('inc-ro-siret');

/** A labeled prediction; only the fields the Outlook reads vary. */
function prediction(
  id: string,
  extra: { readonly likelihoodClass?: LikelihoodClass; readonly etaHours?: number; readonly kind?: Prediction['kind'] } = {},
): Prediction {
  return makePrediction({
    id: asId<PredictionId>(id),
    incidentId: INCIDENT,
    kind: extra.kind ?? 'ESCALATION',
    method: `first-order projection (${id})`,
    inputs: { slopePerHour: 0.4, samples: 6 },
    uncertainty: 0.35,
    sourceId: asId<SourceId>('glofas'),
    ...(extra.likelihoodClass !== undefined ? { likelihoodClass: extra.likelihoodClass } : {}),
    ...(extra.etaHours !== undefined ? { etaHours: extra.etaHours } : {}),
  });
}

// ── The comparator's declared input space ─────────────────────────────────────────────────────────────
// Every optional field's absent case is included, because absent is the COMMON case here (ESCALATION and
// IMPACT_OVER_TIME are trend-derived and carry no class; no Prediction carries a severity at all).
const CLASSES: readonly (LikelihoodClass | undefined)[] = [undefined, ...LIKELIHOOD_CLASSES];
const ETAS: readonly (number | undefined)[] = [
  undefined,
  0,
  1.5,
  6,
  24,
  Number.POSITIVE_INFINITY,
  Number.NaN, // structurally possible on OutlookItem; must not break totality (makePrediction rejects it)
];
const SEVERITIES: readonly (AlertSeverity | undefined)[] = [undefined, ...ALERT_SEVERITIES];

function item(
  likelihoodClass: LikelihoodClass | undefined,
  etaHours: number | undefined,
  severity: AlertSeverity | undefined,
): OutlookItem {
  return {
    ...(likelihoodClass !== undefined ? { likelihoodClass } : {}),
    ...(etaHours !== undefined ? { etaHours } : {}),
    ...(severity !== undefined ? { severity } : {}),
  };
}

/** The full cross-product of the declared input space (4 × 7 × 5 = 140 rows). */
const ALL_ITEMS: readonly OutlookItem[] = CLASSES.flatMap((c) =>
  ETAS.flatMap((e) => SEVERITIES.map((s) => item(c, e, s))),
);

/** A reduced space for the O(n³) transitivity sweep (3 × 4 × 3 = 36 rows ⇒ 46 656 triples). */
const TRIPLE_ITEMS: readonly OutlookItem[] = [undefined, 'POSSIBLE' as const, 'VERY_LIKELY' as const].flatMap((c) =>
  [undefined, 0, 6, Number.NaN].flatMap((e) => [undefined, 'MINOR' as const, 'EXTREME' as const].map((s) => item(c, e, s))),
);

const sign = (n: number): number => (n < 0 ? -1 : n > 0 ? 1 : 0);

describe('compareOutlookItems is a total order (ADR-033 §5)', () => {
  it('is reflexive-equal: an item never precedes or follows itself', () => {
    expect(ALL_ITEMS).toHaveLength(140);
    for (const a of ALL_ITEMS) {
      expect(compareOutlookItems(a, a), JSON.stringify(a)).toBe(0);
    }
  });

  it('is irreflexive as a strict order: no item is STRICTLY before itself, and equals are mutual', () => {
    for (const a of ALL_ITEMS) {
      const clone = { ...a };
      expect(compareOutlookItems(a, clone)).toBe(0);
      expect(compareOutlookItems(clone, a)).toBe(0);
    }
  });

  it('is antisymmetric: sign(cmp(a,b)) === -sign(cmp(b,a)) for every pair', () => {
    for (const a of ALL_ITEMS) {
      for (const b of ALL_ITEMS) {
        const ab = compareOutlookItems(a, b);
        const ba = compareOutlookItems(b, a);
        expect(Number.isFinite(ab), `NaN/∞ comparison for ${JSON.stringify([a, b])}`).toBe(true);
        // sign(ab) + sign(ba) === 0 is antisymmetry without tripping over -0 vs +0 (Object.is).
        expect(sign(ab) + sign(ba), `${JSON.stringify(a)} vs ${JSON.stringify(b)}`).toBe(0);
      }
    }
  });

  it('is transitive: a ≤ b and b ≤ c ⇒ a ≤ c', () => {
    expect(TRIPLE_ITEMS).toHaveLength(36);
    for (const a of TRIPLE_ITEMS) {
      for (const b of TRIPLE_ITEMS) {
        if (compareOutlookItems(a, b) > 0) continue;
        for (const c of TRIPLE_ITEMS) {
          if (compareOutlookItems(b, c) > 0) continue;
          expect(
            compareOutlookItems(a, c),
            `transitivity broken: ${JSON.stringify([a, b, c])}`,
          ).toBeLessThanOrEqual(0);
        }
      }
    }
  });

  it('is transitive on EQUALITY: a = b and b = c ⇒ a = c (an incoherent tie shuffles unrelated rows)', () => {
    for (const a of TRIPLE_ITEMS) {
      for (const b of TRIPLE_ITEMS) {
        if (compareOutlookItems(a, b) !== 0) continue;
        for (const c of TRIPLE_ITEMS) {
          if (compareOutlookItems(b, c) !== 0) continue;
          expect(compareOutlookItems(a, c), `${JSON.stringify([a, b, c])}`).toBe(0);
        }
      }
    }
  });
});

// ── Sort-level properties over a deterministic pseudo-random sample ───────────────────────────────────

/** Seeded LCG (Numerical Recipes constants) — a reproducible generator, not a random one. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1_664_525, state) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function sample(count: number, seed: number): readonly (OutlookItem & { readonly tag: number })[] {
  const next = lcg(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!;
  return Array.from({ length: count }, (_, i) => ({
    ...item(pick(CLASSES), pick(ETAS), pick(SEVERITIES)),
    tag: i,
  }));
}

describe('sorting with compareOutlookItems', () => {
  it('produces a monotone sequence for 500 generated items (no pair out of order)', () => {
    const items = sample(500, 20_260_705);
    const sorted = [...items].sort(compareOutlookItems);
    expect(sorted).toHaveLength(items.length);
    for (let i = 0; i + 1 < sorted.length; i += 1) {
      expect(compareOutlookItems(sorted[i]!, sorted[i + 1]!)).toBeLessThanOrEqual(0);
    }
  });

  it('is STABLE: items that compare equal keep their input order (the derivation order survives)', () => {
    const items = sample(300, 7);
    const sorted = [...items].sort(compareOutlookItems);
    for (let i = 0; i + 1 < sorted.length; i += 1) {
      if (compareOutlookItems(sorted[i]!, sorted[i + 1]!) === 0) {
        expect(sorted[i]!.tag, 'equal items must not be reordered').toBeLessThan(sorted[i + 1]!.tag);
      }
    }
  });

  it('is idempotent: sorting an already-sorted array changes nothing', () => {
    const once = [...sample(200, 99)].sort(compareOutlookItems);
    const twice = [...once].sort(compareOutlookItems);
    expect(twice).toEqual(once);
  });

  it('is order-independent up to ties: a shuffled input yields the same SORT-KEY sequence', () => {
    const items = sample(200, 4242);
    const shuffled = [...items].reverse();
    // The comparator's own keys, with its documented defaults applied — two rows that differ only in an
    // ABSENT-vs-POSSIBLE class (or absent-vs-NaN ETA) are equal by design, so comparing raw fields here
    // would assert an order the rule deliberately does not impose.
    const keys = (xs: readonly OutlookItem[]): unknown[] =>
      xs.map((x) => [
        likelihoodClassRank(x.likelihoodClass ?? 'POSSIBLE'),
        Number.isFinite(x.etaHours ?? Number.NaN) ? x.etaHours : Number.POSITIVE_INFINITY,
        x.severity === undefined ? -1 : ALERT_SEVERITIES.indexOf(x.severity),
      ]);
    expect(keys([...shuffled].sort(compareOutlookItems))).toEqual(keys([...items].sort(compareOutlookItems)));
  });
});

// ── The exact rule ADR-033 §5 specifies ───────────────────────────────────────────────────────────────

describe('the ranking rule itself', () => {
  it('orders likelihood class DESC first', () => {
    expect(compareOutlookItems(item('VERY_LIKELY', undefined, undefined), item('LIKELY', undefined, undefined))).toBeLessThan(0);
    expect(compareOutlookItems(item('LIKELY', undefined, undefined), item('POSSIBLE', undefined, undefined))).toBeLessThan(0);
  });

  it('ranks an ABSENT class as POSSIBLE — never crashes, never sorts to an arbitrary position', () => {
    expect(compareOutlookItems(item(undefined, undefined, undefined), item('POSSIBLE', undefined, undefined))).toBe(0);
    expect(compareOutlookItems(item(undefined, undefined, undefined), item('LIKELY', undefined, undefined))).toBeGreaterThan(0);
  });

  it('lets class BEAT a sooner ETA (a VERY_LIKELY in 24 h outranks a POSSIBLE in 1 h)', () => {
    expect(compareOutlookItems(item('VERY_LIKELY', 24, undefined), item('POSSIBLE', 1, undefined))).toBeLessThan(0);
  });

  it('orders soonest ETA ASC within a class', () => {
    expect(compareOutlookItems(item('LIKELY', 1.5, undefined), item('LIKELY', 6, undefined))).toBeLessThan(0);
    expect(compareOutlookItems(item('LIKELY', 0, undefined), item('LIKELY', 1.5, undefined))).toBeLessThan(0);
  });

  it('puts an ABSENT ETA last within a class (a stated lead time always precedes an unstated one)', () => {
    expect(compareOutlookItems(item('LIKELY', 24, undefined), item('LIKELY', undefined, undefined))).toBeLessThan(0);
    expect(compareOutlookItems(item('LIKELY', undefined, undefined), item('LIKELY', undefined, undefined))).toBe(0);
  });

  it('treats a NON-FINITE ETA exactly like an absent one instead of returning NaN', () => {
    expect(compareOutlookItems(item('LIKELY', Number.NaN, undefined), item('LIKELY', undefined, undefined))).toBe(0);
    expect(compareOutlookItems(item('LIKELY', 6, undefined), item('LIKELY', Number.NaN, undefined))).toBeLessThan(0);
  });

  it('lets a sooner ETA BEAT a higher severity (severity is the LAST key)', () => {
    expect(compareOutlookItems(item('LIKELY', 1, 'MINOR'), item('LIKELY', 6, 'EXTREME'))).toBeLessThan(0);
  });

  it('breaks a full tie by severity DESC', () => {
    expect(compareOutlookItems(item('LIKELY', 6, 'EXTREME'), item('LIKELY', 6, 'SEVERE'))).toBeLessThan(0);
    expect(compareOutlookItems(item('LIKELY', 6, 'MODERATE'), item('LIKELY', 6, 'MINOR'))).toBeLessThan(0);
  });

  it('ranks an ABSENT severity below MINOR (an unstated severity never outranks a stated one)', () => {
    expect(compareOutlookItems(item('LIKELY', 6, 'MINOR'), item('LIKELY', 6, undefined))).toBeLessThan(0);
  });
});

// ── rankOutlook — the only builder of SitRep.outlook ──────────────────────────────────────────────────

describe('rankOutlook', () => {
  it('returns [] for no predictions (an incident with no forecastable signal has no Outlook)', () => {
    expect(rankOutlook([])).toEqual([]);
  });

  it('assigns 1-based ranks in the engine order and carries each prediction\'s own labelling', () => {
    const out = rankOutlook(
      [
        prediction('pred-possible-6h', { likelihoodClass: 'POSSIBLE', etaHours: 6 }),
        prediction('pred-very-24h', { likelihoodClass: 'VERY_LIKELY', etaHours: 24, kind: 'FLOOD_INUNDATION' }),
        prediction('pred-likely-2h', { likelihoodClass: 'LIKELY', etaHours: 2 }),
      ],
      { nowMs: NOW_MS },
    );
    expect(out.map((o) => [o.rank, o.predictionId])).toEqual([
      [1, 'pred-very-24h'],
      [2, 'pred-likely-2h'],
      [3, 'pred-possible-6h'],
    ]);
    expect(out[0]).toEqual({
      rank: 1,
      predictionId: 'pred-very-24h',
      kind: 'FLOOD_INUNDATION',
      method: 'first-order projection (pred-very-24h)',
      uncertainty: 0.35,
      likelihoodClass: 'VERY_LIKELY',
      etaHours: 24,
      hazardArrival: '2026-07-06T22:00:00.000Z', // NOW + 24 h, computed from the INJECTED instant
    });
  });

  it('never mutates or reorders its input array (the caller keeps derivation order)', () => {
    const input = [
      prediction('pred-a', { likelihoodClass: 'POSSIBLE' }),
      prediction('pred-b', { likelihoodClass: 'VERY_LIKELY' }),
    ];
    const before = input.map((p) => String(p.id));
    rankOutlook(input, { nowMs: NOW_MS });
    expect(input.map((p) => String(p.id))).toEqual(before);
  });

  it('keeps derivation order for rows that tie (deterministic, replayable output)', () => {
    const ids = ['pred-1', 'pred-2', 'pred-3'].map((id) => prediction(id, { likelihoodClass: 'LIKELY', etaHours: 6 }));
    expect(rankOutlook(ids, { nowMs: NOW_MS }).map((o) => o.predictionId)).toEqual(['pred-1', 'pred-2', 'pred-3']);
    expect(rankOutlook([...ids].reverse(), { nowMs: NOW_MS }).map((o) => o.predictionId)).toEqual([
      'pred-3',
      'pred-2',
      'pred-1',
    ]);
  });

  it('omits hazardArrival when the source supported no lead time (honest absence, not a guessed instant)', () => {
    const [row] = rankOutlook([prediction('pred-no-eta', { likelihoodClass: 'LIKELY' })], { nowMs: NOW_MS });
    expect(row).toBeDefined();
    expect(row!.etaHours).toBeUndefined();
    expect(row!.hazardArrival).toBeUndefined();
    expect(row!.likelihoodClass).toBe('LIKELY');
  });

  it('omits hazardArrival when no instant was injected, and when the instant is unparseable', () => {
    const preds = [prediction('pred-eta', { etaHours: 3 })];
    expect(rankOutlook(preds)[0]!.hazardArrival).toBeUndefined();
    expect(rankOutlook(preds, { nowMs: Number.NaN })[0]!.hazardArrival).toBeUndefined();
    expect(rankOutlook(preds, { nowMs: NOW_MS })[0]!.hazardArrival).toBe('2026-07-06T01:00:00.000Z');
  });

  it('omits an absent likelihood class instead of defaulting it into the OUTPUT (the default is sort-only)', () => {
    const [row] = rankOutlook([prediction('pred-unclassified')], { nowMs: NOW_MS });
    expect(row!.likelihoodClass).toBeUndefined();
    expect(Object.keys(row!)).not.toContain('likelihoodClass');
  });

  it('applies a CALLER-supplied severity as the tiebreak, and only for the ids it names', () => {
    const preds = [
      prediction('pred-minor', { likelihoodClass: 'LIKELY', etaHours: 6 }),
      prediction('pred-unstated', { likelihoodClass: 'LIKELY', etaHours: 6 }),
      prediction('pred-extreme', { likelihoodClass: 'LIKELY', etaHours: 6 }),
    ];
    const out = rankOutlook(preds, {
      nowMs: NOW_MS,
      severityByPredictionId: new Map([
        ['pred-minor', 'MINOR' as const],
        ['pred-extreme', 'EXTREME' as const],
      ]),
    });
    expect(out.map((o) => o.predictionId)).toEqual(['pred-extreme', 'pred-minor', 'pred-unstated']);
  });

  it('ranks a geometry-less ESCALATION exactly like a cone (the F-77 reason the Outlook is SitRep-sourced)', () => {
    const out = rankOutlook(
      [
        prediction('pred-cone', { kind: 'FIRE_CONE', likelihoodClass: 'POSSIBLE', etaHours: 3 }),
        prediction('pred-escalation', { kind: 'ESCALATION', likelihoodClass: 'VERY_LIKELY', etaHours: 12 }),
        prediction('pred-impact', { kind: 'IMPACT_OVER_TIME', likelihoodClass: 'LIKELY', etaHours: 24 }),
      ],
      { nowMs: NOW_MS },
    );
    expect(out.map((o) => o.kind)).toEqual(['ESCALATION', 'IMPACT_OVER_TIME', 'FIRE_CONE']);
    for (const row of out) {
      expect(row.method).not.toBe('');
      expect(row.uncertainty).toBeGreaterThan(0); // every row carries its own labelling (Art. XII/XIV)
    }
  });
});
