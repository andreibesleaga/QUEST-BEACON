// BEACON — FR-D6-4 INCIDENT SUMMARY EXPORT (ADR-035 §4). Closes F-143: this is `guardAggregateOnly`'s
// call site, and the Layer D tests below prove the guard is load-bearing here, not decorative.
// Fixed clock throughout (2026-07-05T22:00:00Z) — no wall-clock dependence, no live network.
import { describe, it, expect } from 'vitest';
import { findPersonIdentifyingRuntimeKeys } from '@/domain/shared/aggregate-only.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { SourceId } from '@/domain/value-objects/ids.js';
import type { SourceRecord } from '@/domain/source-record.js';
import { makeCasualtyTally, CASUALTY_TALLY_LABEL, type CasualtyTally } from './casualty-tally.js';
import { buildIncidentSummary, type BuildIncidentSummaryInput } from './incident-summary.js';

const GENERATED_AT = '2026-07-05T22:00:00.000Z';
const OLDER_FETCH = '2026-07-05T18:30:00.000Z';
const NEWER_FETCH = '2026-07-05T21:45:00.000Z';

function sourceRecord(over: Partial<SourceRecord> = {}): SourceRecord {
  return {
    id: asId<SourceId>('src-firms'),
    source: 'NASA FIRMS',
    adapter: 'firms-adapter',
    fetchedAt: NEWER_FETCH,
    license: 'NASA open data',
    mode: 'LIVE',
    ...over,
  };
}

function tally(): CasualtyTally {
  const res = makeCasualtyTally({ reportId: 'rep-1', count: 2, asOf: GENERATED_AT });
  if (!res.ok) throw res.error;
  return res.value;
}

/**
 * A per-case override. Explicitly allows `undefined` (which `Partial<T>` does not under
 * exactOptionalPropertyTypes) so a test can assert that an ABSENT optional is dropped from the export
 * rather than serialized as `undefined` — the behaviour `definedOnly` provides.
 */
type InputOverride = {
  [K in keyof BuildIncidentSummaryInput]?: BuildIncidentSummaryInput[K] | undefined;
};

function maximalInput(over: InputOverride = {}): BuildIncidentSummaryInput {
  return {
    incidentId: 'inc-1',
    regionId: 'us-ca',
    generatedAt: GENERATED_AT,
    closedAt: '2026-07-05T21:00:00.000Z',
    alertsIssued: 4,
    tasksCompleted: 7,
    tasksTotal: 9,
    sheltersOpen: 2,
    shelterOccupancyPeak: 118,
    shelterCapacityTotal: 200,
    affectedAreaKm2: 42.5,
    casualtyTally: tally(),
    provenance: [
      sourceRecord(),
      sourceRecord({ id: asId<SourceId>('src-nws'), fetchedAt: OLDER_FETCH }),
    ],
    ...over,
  } as BuildIncidentSummaryInput;
}

function built(over: InputOverride = {}) {
  const res = buildIncidentSummary(maximalInput(over));
  if (!res.ok) throw new Error(`unexpected err: ${JSON.stringify(res.error)}`);
  return res.value;
}

describe('buildIncidentSummary (FR-D6-4) — the document', () => {
  it('builds the MAXIMAL document with every optional field populated', () => {
    expect(built()).toMatchObject({
      incidentId: 'inc-1',
      regionId: 'us-ca',
      generatedAt: GENERATED_AT,
      closedAt: '2026-07-05T21:00:00.000Z',
      alertsIssued: 4,
      tasksCompleted: 7,
      tasksTotal: 9,
      sheltersOpen: 2,
      shelterOccupancyPeak: 118,
      shelterCapacityTotal: 200,
      affectedAreaKm2: 42.5,
      casualtyTally: { count: 2, label: CASUALTY_TALLY_LABEL, authoritative: false },
    });
  });

  it('maps each SOURCE_RECORD to a provenance row, carrying `id` as `sourceId` (Art. XI)', () => {
    expect(built().provenance).toEqual([
      {
        sourceId: 'src-firms',
        source: 'NASA FIRMS',
        adapter: 'firms-adapter',
        fetchedAt: NEWER_FETCH,
        license: 'NASA open data',
        mode: 'LIVE',
      },
      {
        sourceId: 'src-nws',
        source: 'NASA FIRMS',
        adapter: 'firms-adapter',
        fetchedAt: OLDER_FETCH,
        license: 'NASA open data',
        mode: 'LIVE',
      },
    ]);
  });

  it('freshness is the OLDEST fetchedAt — the document is only as fresh as its stalest input', () => {
    expect(built().freshness).toEqual({ fetchedAt: OLDER_FETCH });
    // …and order of the provenance rows cannot change the answer.
    const reversed = built({
      provenance: [
        sourceRecord({ fetchedAt: OLDER_FETCH }),
        sourceRecord({ fetchedAt: NEWER_FETCH }),
      ],
    });
    expect(reversed.freshness).toEqual({ fetchedAt: OLDER_FETCH });
  });

  it('freshness is never NEWER than generatedAt, even if a provenance row claims the future', () => {
    const future = built({ provenance: [sourceRecord({ fetchedAt: '2027-01-01T00:00:00.000Z' })] });
    expect(future.freshness).toEqual({ fetchedAt: GENERATED_AT });
  });

  it('omits absent optionals entirely rather than exporting them as undefined', () => {
    const minimal = built({
      regionId: undefined,
      closedAt: undefined,
      tasksTotal: undefined,
      sheltersOpen: undefined,
      shelterOccupancyPeak: undefined,
      shelterCapacityTotal: undefined,
      affectedAreaKm2: undefined,
      casualtyTally: undefined,
    });
    expect(Object.keys(minimal).sort()).toEqual([
      'alertsIssued',
      'caveats',
      'freshness',
      'generatedAt',
      'incidentId',
      'provenance',
      'tasksCompleted',
    ]);
  });

  it('is DETERMINISTIC and clock-free: the same input yields an identical document (Art. XII)', () => {
    expect(built()).toEqual(built());
  });
});

describe('buildIncidentSummary — caveats are DERIVED from the document, never written beside it', () => {
  it('always states the aggregate-only guarantee AND how it was verified', () => {
    expect(built().caveats.at(-1)).toMatch(/Aggregate-only.*fail-closed runtime key walk/s);
  });

  it('names every non-LIVE rung that contributed, and never relabels one LIVE (Art. XVI)', () => {
    const mixed = built({
      provenance: [
        sourceRecord({ mode: 'MOCK' }),
        sourceRecord({ mode: 'CACHED' }),
        sourceRecord({ mode: 'MOCK' }),
      ],
    });
    expect(mixed.caveats[0]).toMatch(/Not fully LIVE: CACHED\/MOCK/);
    expect(mixed.provenance.map((p) => p.mode)).toEqual(['MOCK', 'CACHED', 'MOCK']);
  });

  it('emits no degradation caveat when every input is LIVE', () => {
    expect(built().caveats.some((c) => c.includes('Not fully LIVE'))).toBe(false);
  });

  it('carries the FR-D6-5 caveat to the EXPORT site whenever a tally is present, and not otherwise', () => {
    expect(built().caveats.some((c) => c.includes(CASUALTY_TALLY_LABEL))).toBe(true);
    expect(
      built({ casualtyTally: undefined }).caveats.some((c) => c.includes(CASUALTY_TALLY_LABEL)),
    ).toBe(false);
  });

  it('states the seeded-shelter-capacity limitation (F12) only when a capacity figure is exported', () => {
    expect(built().caveats.some((c) => c.includes('hand-seeded'))).toBe(true);
    expect(
      built({ shelterCapacityTotal: undefined }).caveats.some((c) => c.includes('hand-seeded')),
    ).toBe(false);
  });

  it('states that the affected area is a modelled extent only when an area is exported', () => {
    expect(built().caveats.some((c) => c.includes('modelled extent'))).toBe(true);
    expect(
      built({ affectedAreaKm2: undefined }).caveats.some((c) => c.includes('modelled extent')),
    ).toBe(false);
  });
});

describe('buildIncidentSummary — input invariants (a figure with no source is not exportable)', () => {
  const cases: ReadonlyArray<readonly [string, InputOverride, RegExp]> = [
    ['a blank incidentId', { incidentId: '  ' }, /incidentId is required/],
    ['empty provenance', { provenance: [] }, /at least one SOURCE_RECORD/],
    ['an unparseable generatedAt', { generatedAt: 'soon' }, /generatedAt must be an ISO-8601/],
    ['an unparseable closedAt', { closedAt: 'later' }, /closedAt must be an ISO-8601/],
    [
      'a negative alertsIssued',
      { alertsIssued: -1 },
      /alertsIssued must be a non-negative integer/,
    ],
    [
      'a fractional tasksCompleted',
      { tasksCompleted: 1.5 },
      /tasksCompleted must be a non-negative integer/,
    ],
    ['a negative tasksTotal', { tasksTotal: -2 }, /tasksTotal must be a non-negative integer/],
    [
      'a fractional sheltersOpen',
      { sheltersOpen: 0.5 },
      /sheltersOpen must be a non-negative integer/,
    ],
    ['a negative shelterOccupancyPeak', { shelterOccupancyPeak: -3 }, /shelterOccupancyPeak/],
    ['a negative shelterCapacityTotal', { shelterCapacityTotal: -4 }, /shelterCapacityTotal/],
    ['a negative affectedAreaKm2', { affectedAreaKm2: -0.1 }, /affectedAreaKm2 must be a finite/],
    [
      'a non-finite affectedAreaKm2',
      { affectedAreaKm2: Number.NaN },
      /affectedAreaKm2 must be a finite/,
    ],
  ];

  it.each(cases)('rejects %s', (_label, over, message) => {
    const res = buildIncidentSummary(maximalInput(over));
    expect(res.ok).toBe(false);
    expect(res.ok ? '' : res.error.code).toBe('INVARIANT_VIOLATION');
    expect(res.ok ? '' : (res.error as Error).message).toMatch(message);
  });

  it('accepts a zero-everything incident (nothing happened is a valid, exportable after-action fact)', () => {
    const res = buildIncidentSummary(
      maximalInput({ alertsIssued: 0, tasksCompleted: 0, tasksTotal: 0, affectedAreaKm2: 0 }),
    );
    expect(res.ok).toBe(true);
  });
});

describe('buildIncidentSummary — LAYER D is wired here and is load-bearing (F-143 closed)', () => {
  // The concrete bypass: `casualtyTally` is re-emitted BY REFERENCE, so a caller that reached this boundary
  // without going through `makeCasualtyTally` (a cast, a DB row, a JS caller, a mapper spread) carries its
  // extra keys into the export. Layers A/B/C cannot see this — only the runtime walk at the export can.
  const pollutedTally = {
    ...tally(),
    patientId: 'p-77',
    contactPhone: '555-0100',
  } as unknown as CasualtyTally;

  it('fires on a person-identifying key that reached the boundary without passing the typed factory', () => {
    const res = buildIncidentSummary(maximalInput({ casualtyTally: pollutedTally }));
    expect(res.ok).toBe(false);
    expect(res.ok ? '' : res.error.code).toBe('PII_FIELD_FOUND');
  });

  it('names EVERY offending path, so the fix is actionable rather than a bare rejection', () => {
    const res = buildIncidentSummary(maximalInput({ casualtyTally: pollutedTally }));
    expect(res.ok ? [] : (res.error as { keys: readonly string[] }).keys).toEqual([
      'casualtyTally.patientId',
      'casualtyTally.contactPhone',
    ]);
  });

  it('PROPAGATES the error branch and NEVER the payload — a caller cannot serialize by ignoring the branch', () => {
    const res = buildIncidentSummary(maximalInput({ casualtyTally: pollutedTally }));
    expect(res.ok).toBe(false);
    expect(Object.keys(res)).toEqual(['ok', 'error']); // no `value` alongside the error
    expect(res).not.toHaveProperty('value');
  });

  it('the two error shapes are discriminable on `code` without instanceof', () => {
    const invalid = buildIncidentSummary(maximalInput({ alertsIssued: -1 }));
    const pii = buildIncidentSummary(maximalInput({ casualtyTally: pollutedTally }));
    const codes = [invalid, pii].map((r) => (r.ok ? 'ok' : r.error.code));
    expect(codes).toEqual(['INVARIANT_VIOLATION', 'PII_FIELD_FOUND']);
  });

  it('lets the clean document through unchanged — the guard returns the same object, it does not launder it', () => {
    expect(findPersonIdentifyingRuntimeKeys(built())).toEqual([]);
  });
});
