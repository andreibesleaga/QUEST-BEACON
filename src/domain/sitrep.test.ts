// BEACON — SITREP invariant tests (E1·T-062). Non-empty citations[] per field + trend enum.
import { describe, it, expect } from 'vitest';
import { asId } from './value-objects/ids.js';
import type { IncidentId, SitRepId, SourceId } from './value-objects/ids.js';
import { InvariantViolation } from './errors.js';
import { makeSitRep } from './sitrep.js';
import type { RankedOutlookItem } from './sitrep.js';

const src = asId<SourceId>('55555555-5555-5555-5555-555555555555');
const base = {
  id: asId<SitRepId>('66666666-6666-6666-6666-666666666666'),
  incidentId: asId<IncidentId>('77777777-7777-7777-7777-777777777777'),
  generatedAt: '2020-06-01T12:00:00.000Z',
  fields: [{ field: 'summary', claim: 'stable', citations: [{ sourceId: src }] }],
} as const;

describe('makeSitRep', () => {
  it('constructs a SitRep whose every field is grounded', () => {
    const s = makeSitRep({ ...base });
    expect(s.aiMode).toBe('deterministic-only'); // schema default
    expect(s.fields).toHaveLength(1);
  });

  it('rejects a field with an empty citations[] (Art. XI grounding)', () => {
    expect(() => makeSitRep({ ...base, fields: [{ field: 'trend', citations: [] }] })).toThrow(InvariantViolation);
  });

  it('rejects a citation missing its sourceId', () => {
    expect(() =>
      makeSitRep({
        ...base,
        fields: [{ field: 'trend', citations: [{ sourceId: asId<SourceId>('') }] }],
      }),
    ).toThrow(InvariantViolation);
  });

  it('rejects a trend outside the enum', () => {
    // @ts-expect-error — runtime guard for an out-of-enum trend
    expect(() => makeSitRep({ ...base, trend: 'MELTDOWN' })).toThrow(InvariantViolation);
  });

  it('accepts a valid trend', () => {
    expect(makeSitRep({ ...base, trend: 'ESCALATING' }).trend).toBe('ESCALATING');
  });

  it('rejects an aiMode outside the enum', () => {
    // @ts-expect-error — runtime guard for an out-of-enum aiMode
    expect(() => makeSitRep({ ...base, aiMode: 'psychic' })).toThrow(InvariantViolation);
  });

  // Ranked Outlook (ADR-033 §5) — the `priorities` pattern applied to predictions: engine-ranked, always
  // present, defaulted to [] so no consumer has to branch on absence.
  it('defaults priorities and outlook to [] (an incident may have neither)', () => {
    const s = makeSitRep({ ...base });
    expect(s.priorities).toEqual([]);
    expect(s.outlook).toEqual([]);
  });

  it('carries the engine-ranked outlook VERBATIM (rank/method/uncertainty are never recomputed here)', () => {
    const outlook: readonly RankedOutlookItem[] = [
      {
        rank: 1,
        predictionId: 'pred-1',
        kind: 'ESCALATION',
        method: 'least-squares trend projection',
        uncertainty: 0.4,
        likelihoodClass: 'VERY_LIKELY',
        etaHours: 6,
        hazardArrival: '2020-06-01T18:00:00.000Z',
      },
    ];
    expect(makeSitRep({ ...base, outlook }).outlook).toEqual(outlook);
  });
});
