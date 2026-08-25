// BEACON — FR-D6-5 aggregate CASUALTY TALLY (ADR-035 §4). A count and its mandatory caveat, never a record.
import { describe, it, expect } from 'vitest';
import casualtyTallySchema from '../../../schemas/d6-casualty-tally.schema.json';
import { findPersonIdentifyingRuntimeKeys } from '@/domain/shared/aggregate-only.js';
import { makeCasualtyTally, CASUALTY_TALLY_LABEL, type CasualtyTally } from './casualty-tally.js';

const AS_OF = '2026-07-05T22:00:00.000Z'; // fixed clock — no wall-clock dependence

function maximalCasualtyTally(): CasualtyTally {
  const res = makeCasualtyTally({ reportId: 'rep-1', count: 3, asOf: AS_OF });
  if (!res.ok) throw res.error;
  return res.value;
}

describe('makeCasualtyTally (FR-D6-5)', () => {
  it('builds the maximal aggregate shape, caveat included', () => {
    expect(maximalCasualtyTally()).toEqual({
      reportId: 'rep-1',
      count: 3,
      asOf: AS_OF,
      label: 'unverified — not authoritative',
      authoritative: false,
    });
  });

  it('the caveat is NOT optional — a minimal tally still carries label and authoritative', () => {
    const res = makeCasualtyTally({ count: 0 });
    expect(res.ok).toBe(true);
    expect(res.ok ? Object.keys(res.value).sort() : []).toEqual(['authoritative', 'count', 'label']);
    expect(res.ok ? res.value.label : '').toBe(CASUALTY_TALLY_LABEL);
    expect(res.ok ? res.value.authoritative : true).toBe(false);
  });

  it('the label is the schema\'s `const`, not a second copy of the string', () => {
    expect(CASUALTY_TALLY_LABEL).toBe(casualtyTallySchema.properties.label.const);
    expect(casualtyTallySchema.properties.authoritative.const).toBe(false);
  });

  it('a caller cannot supply, omit or soften the caveat through this factory', () => {
    // A JS caller passing a softened label: the extra key is simply not read — the factory sets its own.
    const res = makeCasualtyTally({ count: 1, label: 'approximate' } as never);
    expect(res.ok ? res.value.label : '').toBe(CASUALTY_TALLY_LABEL);
  });

  it('zero is preserved as a meaningful count ("none observed here"), never collapsed to absent', () => {
    const res = makeCasualtyTally({ count: 0 });
    expect(res.ok ? res.value.count : -1).toBe(0);
  });

  it('rejects a non-integer, negative or non-finite count', () => {
    expect(makeCasualtyTally({ count: -1 }).ok).toBe(false);
    expect(makeCasualtyTally({ count: 1.5 }).ok).toBe(false);
    expect(makeCasualtyTally({ count: Number.NaN }).ok).toBe(false);
    expect(makeCasualtyTally({ count: Number.POSITIVE_INFINITY }).ok).toBe(false);
  });

  it('rejects a blank reportId when one is supplied', () => {
    const res = makeCasualtyTally({ count: 1, reportId: '  ' });
    expect(res.ok).toBe(false);
    expect(res.ok ? '' : res.error.message).toMatch(/non-empty entity id/);
  });

  it('rejects an unparseable asOf', () => {
    const res = makeCasualtyTally({ count: 1, asOf: 'yesterday' });
    expect(res.ok).toBe(false);
    expect(res.ok ? '' : res.error.code).toBe('INVARIANT_VIOLATION');
  });

  // ── Layer C ────────────────────────────────────────────────────────────────────────────────────────────
  it('Layer C: the MAXIMAL factory output carries no person-identifying key', () => {
    expect(findPersonIdentifyingRuntimeKeys(maximalCasualtyTally())).toEqual([]);
  });

  it('Layer C: a triage-shaped spread over the maximal output IS caught (medical detail is PERMANENTLY OUT)', () => {
    const polluted = { ...maximalCasualtyTally(), triageTag: 'RED', age: 41, injuries: 'burns' };
    expect(findPersonIdentifyingRuntimeKeys(polluted)).toEqual(['triageTag', 'age', 'injuries']);
  });

  it('HONEST LIMITATION: the guard constrains the SHAPE; it cannot make the number true', () => {
    const wildlyWrong = makeCasualtyTally({ count: 999_999 });
    expect(wildlyWrong.ok).toBe(true); // nothing here validates the figure against reality…
    expect(wildlyWrong.ok ? wildlyWrong.value.label : '').toBe(CASUALTY_TALLY_LABEL); // …which is why the
    expect(wildlyWrong.ok ? wildlyWrong.value.authoritative : true).toBe(false); // caveat is structural.
  });
});
