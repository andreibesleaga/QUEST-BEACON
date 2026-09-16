// BEACON — THRESHOLD_RULE invariant tests (E1·T-070). Non-negative hysteresis/cooldown + enums.
import { describe, it, expect } from 'vitest';
import { asId } from './value-objects/ids.js';
import type { RegionId, ThresholdRuleId } from './value-objects/ids.js';
import { InvariantViolation } from './errors.js';
import { makeThresholdRule, uniqueRules } from './threshold-rule.js';

const base = {
  id: asId<ThresholdRuleId>('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  scope: asId<RegionId>('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  target: 'GAUGE_CATEGORY',
  operator: 'crosses',
  value: 'MAJOR',
} as const;

describe('makeThresholdRule', () => {
  it('constructs a valid rule', () => {
    const rule = makeThresholdRule({ ...base, hysteresis: 0.5, cooldown: 300 });
    expect(rule.target).toBe('GAUGE_CATEGORY');
    expect(rule.hysteresis).toBe(0.5);
  });

  it('rejects a negative hysteresis', () => {
    expect(() => makeThresholdRule({ ...base, hysteresis: -1 })).toThrow(InvariantViolation);
  });

  it('rejects a negative cooldown', () => {
    expect(() => makeThresholdRule({ ...base, cooldown: -5 })).toThrow(InvariantViolation);
  });

  it('rejects an operator outside the enum', () => {
    // @ts-expect-error — runtime guard for an out-of-enum operator
    expect(() => makeThresholdRule({ ...base, operator: 'approximately' })).toThrow(
      InvariantViolation,
    );
  });

  it('rejects a target outside the enum', () => {
    // @ts-expect-error — runtime guard for an out-of-enum target
    expect(() => makeThresholdRule({ ...base, target: 'MOON_PHASE' })).toThrow(InvariantViolation);
  });

  it('rejects a missing value', () => {
    expect(() => makeThresholdRule({ ...base, value: '' })).toThrow(InvariantViolation);
  });

  it('allows an omitted scope, hysteresis and cooldown', () => {
    const rule = makeThresholdRule({
      id: base.id,
      target: 'HAZARD_BUFFER',
      operator: 'enters',
      value: '5000',
    });
    expect(rule.scope).toBeUndefined();
  });
});

describe('uniqueRules', () => {
  const rule = (id: string, value = '2000') =>
    makeThresholdRule({
      id: asId<ThresholdRuleId>(id),
      target: 'HAZARD_BUFFER',
      operator: 'enters',
      value,
    });

  it('keeps each id once, first occurrence wins, order kept', () => {
    const merged = uniqueRules([rule('a'), rule('b'), rule('a', '500'), rule('c')]);
    expect(merged.map((r) => String(r.id))).toEqual(['a', 'b', 'c']);
    expect(merged[0]!.value).toBe('2000');
  });

  it('an empty list stays empty', () => {
    expect(uniqueRules([])).toEqual([]);
  });
});
