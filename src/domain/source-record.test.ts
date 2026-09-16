// BEACON — SOURCE_RECORD invariant tests (E1·T-066). license + fetchedAt + mode enum.
import { describe, it, expect } from 'vitest';
import { asId } from './value-objects/ids.js';
import type { SourceId } from './value-objects/ids.js';
import { InvariantViolation } from './errors.js';
import { makeSourceRecord } from './source-record.js';

const id = asId<SourceId>('22222222-2222-2222-2222-222222222222');
const base = {
  id,
  source: 'NASA FIRMS',
  adapter: 'firms-adapter',
  fetchedAt: '2020-01-01T00:00:00.000Z',
  license: 'CC-BY-4.0',
  mode: 'LIVE',
} as const;

describe('makeSourceRecord', () => {
  it('constructs a complete provenance record', () => {
    const rec = makeSourceRecord({ ...base });
    expect(rec.source).toBe('NASA FIRMS');
    expect(rec.mode).toBe('LIVE');
  });

  it('rejects a mode outside the enum', () => {
    // @ts-expect-error — runtime guard for an out-of-enum mode
    expect(() => makeSourceRecord({ ...base, mode: 'STREAMING' })).toThrow(InvariantViolation);
  });

  it('rejects a missing source', () => {
    expect(() => makeSourceRecord({ ...base, source: '  ' })).toThrow(InvariantViolation);
  });

  it('rejects a missing adapter', () => {
    expect(() => makeSourceRecord({ ...base, adapter: '' })).toThrow(InvariantViolation);
  });

  it('rejects a missing license', () => {
    expect(() => makeSourceRecord({ ...base, license: '' })).toThrow(InvariantViolation);
  });

  it('rejects a NaN fetchedAt', () => {
    expect(() => makeSourceRecord({ ...base, fetchedAt: 'not-a-date' })).toThrow(
      InvariantViolation,
    );
  });

  it('rejects a future fetchedAt (clock-skew guard)', () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    expect(() => makeSourceRecord({ ...base, fetchedAt: future })).toThrow(InvariantViolation);
  });

  it('accepts CACHED and MOCK modes', () => {
    expect(makeSourceRecord({ ...base, mode: 'CACHED' }).mode).toBe('CACHED');
    expect(makeSourceRecord({ ...base, mode: 'MOCK' }).mode).toBe('MOCK');
  });
});
