// BEACON — CITATION invariant tests (E1·T-064). field + claim + sourceId + sitrepId all required.
import { describe, it, expect } from 'vitest';
import { asId } from './value-objects/ids.js';
import type { CitationId, SitRepId, SourceId } from './value-objects/ids.js';
import { InvariantViolation } from './errors.js';
import { makeCitation } from './citation.js';

const base = {
  id: asId<CitationId>('33333333-3333-3333-3333-333333333333'),
  sitrepId: asId<SitRepId>('44444444-4444-4444-4444-444444444444'),
  sourceId: asId<SourceId>('55555555-5555-5555-5555-555555555555'),
  field: 'perimeter_area',
  claim: 'Fire perimeter grew to 1,200 ha',
} as const;

describe('makeCitation', () => {
  it('constructs a grounded citation', () => {
    expect(makeCitation({ ...base }).field).toBe('perimeter_area');
  });

  it('rejects a missing field', () => {
    expect(() => makeCitation({ ...base, field: '' })).toThrow(InvariantViolation);
  });

  it('rejects a missing claim', () => {
    expect(() => makeCitation({ ...base, claim: '   ' })).toThrow(InvariantViolation);
  });

  it('rejects a missing sourceId', () => {
    expect(() => makeCitation({ ...base, sourceId: asId<SourceId>('') })).toThrow(InvariantViolation);
  });

  it('rejects a missing sitrepId', () => {
    expect(() => makeCitation({ ...base, sitrepId: asId<SitRepId>('') })).toThrow(InvariantViolation);
  });
});
