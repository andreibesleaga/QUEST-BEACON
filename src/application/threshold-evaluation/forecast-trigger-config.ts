// BEACON — forecast-crossing trigger gates: TYPES + fail-fast parser (C2.4; ADR-033 §6, ADR-012, FEV-9).
//
// The gate numbers live in `config/forecast-trigger.json` and are validated by
// `schemas/forecast-trigger.schema.json` — this module holds NO gate literal. Same discipline, and the same
// reasons, as `likelihood-config.ts` (C1.2) and the policy loader (`policy-loader.ts:34-47`): when a DRAFT
// alert appears must be a reviewable data edit, not a number buried in a use-case.
//
// Why a hand-written parser instead of Ajv here: this module is imported by a PURE application use-case, so
// it may not read the filesystem (the schema lives on disk, the config is a static import). The JSON-Schema
// is enforced against the shipped file by `forecast-trigger-config.test.ts` — the same split the region
// registry and the likelihood table already use. The parser additionally enforces the one property a
// JSON-Schema cannot express: the lead-time window must be non-empty (min <= max).
//
// NOTE (finding F-33): `schemas/threshold-rule.schema.json` is DEAD — zero code references and drifted from
// `src/domain/threshold-rule.ts`. It was deliberately NOT extended for this feature; the live schema above is
// new. Fixing or deleting the dead file is an MW-E item.
import type { LikelihoodClass } from '@/domain/prediction.js';
import { LIKELIHOOD_CLASSES } from '@/domain/prediction.js';
import triggerJson from '../../../config/forecast-trigger.json';

/** The likelihood floor a forecast reading must reach to fire. Absent ⇒ the likelihood gate is not applied. */
export interface MinLikelihoodGate {
  readonly class: LikelihoodClass;
  readonly basis: string;
}

/** The window of remaining lead time, in hours, in which a forecast crossing is actionable. */
export interface LeadTimeGate {
  readonly minHours: number;
  readonly maxHours: number;
  readonly basis: string;
}

/** How old the source's own forecast issue instant may be before the reading counts as superseded. */
export interface VintageGate {
  readonly maxForecastAgeHours: number;
  readonly basis: string;
}

export interface ForecastTriggerConfig {
  readonly version: number;
  readonly authority: string;
  readonly firePolicy: string;
  readonly minLikelihood?: MinLikelihoodGate;
  readonly leadTime: LeadTimeGate;
  readonly vintage: VintageGate;
}

/** Config-validation failure. Fail fast: a wrong gate silently changes when responders get warned. */
function requireConfig(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid config/forecast-trigger.json: ${message}`);
}

// Permissive views of the raw file — mirrors the RawRule approach in likelihood-config.ts.
interface RawGate {
  readonly class?: unknown;
  readonly minHours?: unknown;
  readonly maxHours?: unknown;
  readonly maxForecastAgeHours?: unknown;
  readonly basis?: unknown;
}
interface RawConfig {
  readonly version?: unknown;
  readonly authority?: unknown;
  readonly firePolicy?: unknown;
  readonly minLikelihood?: RawGate;
  readonly leadTime?: RawGate;
  readonly vintage?: RawGate;
}

function text(v: unknown, what: string): string {
  requireConfig(typeof v === 'string' && v.trim().length > 0, `${what} must be a non-empty string`);
  return v as string;
}

function hours(v: unknown, what: string, min: number): number {
  requireConfig(
    typeof v === 'number' && Number.isFinite(v) && v >= min,
    `${what} must be a finite number >= ${min}, got ${String(v)}`,
  );
  return v as number;
}

function gateObject(v: unknown, what: string): RawGate {
  requireConfig(typeof v === 'object' && v !== null, `${what} must be an object`);
  return v as RawGate;
}

function parseMinLikelihood(raw: RawGate | undefined): MinLikelihoodGate | undefined {
  if (raw === undefined) return undefined;
  const gate = gateObject(raw, 'minLikelihood');
  requireConfig(
    typeof gate.class === 'string' &&
      (LIKELIHOOD_CLASSES as readonly string[]).includes(gate.class),
    `minLikelihood.class must be one of ${LIKELIHOOD_CLASSES.join('|')}, got ${String(gate.class)}`,
  );
  return { class: gate.class as LikelihoodClass, basis: text(gate.basis, 'minLikelihood.basis') };
}

/**
 * The lead-time window. `minHours <= maxHours` is the property a JSON-Schema cannot state and the one an
 * accidental edit is most likely to break — an inverted window would silently suppress every forecast fire.
 */
function parseLeadTime(raw: RawGate | undefined): LeadTimeGate {
  const gate = gateObject(raw, 'leadTime');
  const minHours = hours(gate.minHours, 'leadTime.minHours', 0);
  const maxHours = hours(gate.maxHours, 'leadTime.maxHours', 0);
  requireConfig(
    maxHours > 0 && minHours <= maxHours,
    `leadTime window must be non-empty and positive: minHours ${minHours} <= maxHours ${maxHours}`,
  );
  return { minHours, maxHours, basis: text(gate.basis, 'leadTime.basis') };
}

function parseVintage(raw: RawGate | undefined): VintageGate {
  const gate = gateObject(raw, 'vintage');
  const maxForecastAgeHours = hours(gate.maxForecastAgeHours, 'vintage.maxForecastAgeHours', 0);
  requireConfig(maxForecastAgeHours > 0, 'vintage.maxForecastAgeHours must be greater than 0');
  return { maxForecastAgeHours, basis: text(gate.basis, 'vintage.basis') };
}

/**
 * Parse + validate the forecast-trigger gates. Throws on any violation — a half-valid gate table is worse
 * than none, because every DRAFT it raises (or silently withholds) looks equally deliberate.
 */
export function parseForecastTriggerConfig(raw: unknown): ForecastTriggerConfig {
  requireConfig(typeof raw === 'object' && raw !== null, 'the file must contain a JSON object');
  const cfg = raw as RawConfig;
  requireConfig(cfg.version === 1, `version must be 1, got ${String(cfg.version)}`);
  const minLikelihood = parseMinLikelihood(cfg.minLikelihood);
  return {
    version: 1,
    authority: text(cfg.authority, 'authority'),
    firePolicy: text(cfg.firePolicy, 'firePolicy'),
    ...(minLikelihood === undefined ? {} : { minLikelihood }),
    leadTime: parseLeadTime(cfg.leadTime),
    vintage: parseVintage(cfg.vintage),
  };
}

/**
 * The SHIPPED gate table, parsed at import time (fail-fast: a bad config breaks the build's first test, not a
 * responder's screen). Injectable exactly like `DEFAULT_LIKELIHOOD_CONFIG` — every entry point takes a
 * `ForecastTriggerConfig` and only DEFAULTS to this one, so a region running a different early-action
 * protocol supplies its own table rather than editing the evaluator.
 */
export const DEFAULT_FORECAST_TRIGGER_CONFIG: ForecastTriggerConfig =
  parseForecastTriggerConfig(triggerJson);
