// BEACON — Result<T,E> tests (E1·T-045). The typed success/failure primitive; unwrap is boundary-only
// (throws), so both arms + the Error-vs-non-Error coercion must be exercised.
import { describe, it, expect } from 'vitest';
import { ok, err, isOk, isErr, unwrap } from './result.js';
import { InvariantViolation } from '../errors.js';

describe('Result', () => {
  it('ok is discriminated and carries its value', () => {
    const r = ok(42);
    expect(isOk(r)).toBe(true);
    expect(isErr(r)).toBe(false);
    if (isOk(r)) expect(r.value).toBe(42);
  });

  it('err is discriminated and carries its error', () => {
    const r = err(new InvariantViolation('bad'));
    expect(isErr(r)).toBe(true);
    expect(isOk(r)).toBe(false);
  });

  it('unwrap returns the value on ok', () => {
    expect(unwrap(ok('v'))).toBe('v');
  });

  it('unwrap throws the underlying Error on err', () => {
    expect(() => unwrap(err(new InvariantViolation('boom')))).toThrow(/boom/);
  });

  it('unwrap coerces a non-Error error into an Error before throwing', () => {
    expect(() => unwrap(err('plain-string' as unknown as Error))).toThrow('plain-string');
  });
});
