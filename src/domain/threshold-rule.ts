// BEACON — THRESHOLD_RULE entity (E1·T-070/T-071). Early-warning trigger config (ADR-014).
// Firing creates DRAFT alerts only (Art. XIII). Pure TS — no framework/HTTP/DB imports (F9).
import type { RegionId, ThresholdRuleId } from './value-objects/ids.js';
import { invariant, definedOnly } from './shared/guard.js';

// Enums mirror schema.sql CHECK constraints exactly (threshold_rule).
// FORECAST_GAUGE_CATEGORY (C2.4, ADR-033 §6, FEV-9) is the FORECAST counterpart of GAUGE_CATEGORY: it
// compares a source-published FORECAST flood category, not an observed one, and its extra gates (lead time,
// forecast vintage, likelihood floor) live in config/forecast-trigger.json. It fires DRAFT alerts on exactly
// the same Art. XIII terms as every other target — a forecast crossing is not a licence to warn the public.
export const THRESHOLD_TARGETS = [
  'GAUGE_CATEGORY',
  'HAZARD_BUFFER',
  'FORECAST_GAUGE_CATEGORY',
] as const;
export type ThresholdTarget = (typeof THRESHOLD_TARGETS)[number];

export const THRESHOLD_OPERATORS = ['crosses', 'gte', 'enters'] as const;
export type ThresholdOperator = (typeof THRESHOLD_OPERATORS)[number];

export interface ThresholdRule {
  readonly id: ThresholdRuleId;
  readonly scope?: RegionId; // region_id scope (nullable FK in schema)
  readonly target: ThresholdTarget;
  readonly operator: ThresholdOperator;
  readonly value: string; // comparison value (e.g. "MAJOR", "5000m") — schema stores as text
  readonly hysteresis?: number; // debounce band — non-negative
  readonly cooldown?: number; // re-fire suppression window — non-negative
}

export interface MakeThresholdRuleInput {
  readonly id: ThresholdRuleId;
  readonly scope?: RegionId;
  readonly target: ThresholdTarget;
  readonly operator: ThresholdOperator;
  readonly value: string;
  readonly hysteresis?: number;
  readonly cooldown?: number;
}

/** Construct a ThresholdRule; enum-checks target/operator and rejects negative hysteresis/cooldown. */
export function makeThresholdRule(input: MakeThresholdRuleInput): ThresholdRule {
  invariant(
    THRESHOLD_TARGETS.includes(input.target),
    `ThresholdRule.target invalid: ${String(input.target)}`,
  );
  invariant(
    THRESHOLD_OPERATORS.includes(input.operator),
    `ThresholdRule.operator invalid: ${String(input.operator)}`,
  );
  invariant(input.value?.trim(), 'ThresholdRule.value is required');
  // Hysteresis/cooldown are debounce magnitudes — a negative window is meaningless (ADR-014).
  invariant(
    input.hysteresis === undefined || (!Number.isNaN(input.hysteresis) && input.hysteresis >= 0),
    `ThresholdRule.hysteresis must be non-negative: ${input.hysteresis}`,
  );
  invariant(
    input.cooldown === undefined || (!Number.isNaN(input.cooldown) && input.cooldown >= 0),
    `ThresholdRule.cooldown must be non-negative: ${input.cooldown}`,
  );
  return definedOnly({
    id: input.id,
    target: input.target,
    operator: input.operator,
    value: input.value,
    scope: input.scope,
    hysteresis: input.hysteresis,
    cooldown: input.cooldown,
  }) as ThresholdRule;
}

/** The rules of several catalogues as one list, each id once (first occurrence wins, order kept). */
export function uniqueRules(rules: readonly ThresholdRule[]): readonly ThresholdRule[] {
  const seen = new Set<string>();
  return rules.filter((rule) => {
    const id = String(rule.id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
