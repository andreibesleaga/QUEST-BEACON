// BEACON — trend-projection labelling parameters: TYPES + fail-fast parser (C2.2; ADR-033 §4.1/§4.2, ADR-012).
//
// The curves and checkpoints live in `config/trend-projection.json` and are validated by
// `schemas/trend-projection.schema.json` — this module holds NO parameter literal. Same discipline, and the
// same reasons, as `likelihood-config.ts` (C1.2), `forecast-trigger-config.ts` (C2.4) and the policy loader:
// the uncertainty a responder reads beside a projected count must be a reviewable data edit.
//
// Why a hand-written parser instead of Ajv here: this module is imported by PURE application use-cases, so it
// may not read the filesystem (the schema lives on disk, the config is a static import). The JSON-Schema is
// enforced against the shipped file by `trend-projection-config.test.ts` — the same split the region registry,
// the likelihood table and the forecast-trigger gates already use. The parser additionally enforces the one
// property a JSON-Schema cannot express: the horizon checkpoints must strictly ASCEND, which is what makes
// "the furthest checkpoint carries the highest uncertainty" true by construction rather than by convention.
//
// NOTE (finding F-33/F-80): `schemas/threshold-rule.schema.json` is DEAD and was deliberately not touched.
import trendProjectionJson from '../../../config/trend-projection.json';

/** ESCALATION uncertainty curve: fewer samples ⇒ higher uncertainty (ADR-033 §4.1). */
export interface EscalationUncertaintyConfig {
  /** Sample count at or above which no sparsity penalty is applied. */
  readonly referenceSamples: number;
  /** The floor uncertainty a well-sampled first-order slope keeps. */
  readonly baseUncertainty: number;
  /** Added uncertainty for each sample short of `referenceSamples`. */
  readonly uncertaintyPerMissingSample: number;
  /** What grounds the numbers above (required by the schema — a value cannot ship unexplained). */
  readonly basis: string;
}

/** IMPACT_OVER_TIME horizon checkpoints + horizon-compounding uncertainty curve (ADR-033 §4.2). */
export interface ImpactOverTimeConfig {
  /** Fixed horizon marks, in hours, strictly ascending (enforced at parse time). */
  readonly checkpointHours: readonly number[];
  readonly baseUncertainty: number;
  readonly uncertaintyPerHour: number;
  readonly basis: string;
}

export interface TrendProjectionConfig {
  readonly version: number;
  readonly authority: string;
  readonly escalation: EscalationUncertaintyConfig;
  readonly impactOverTime: ImpactOverTimeConfig;
}

/** Config-validation failure. Fail fast: a wrong curve silently relabels every projection it produces. */
function requireConfig(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid config/trend-projection.json: ${message}`);
}

// Permissive views of the raw file — mirrors the RawRule approach in likelihood-config.ts.
interface RawBlock {
  readonly referenceSamples?: unknown;
  readonly baseUncertainty?: unknown;
  readonly uncertaintyPerMissingSample?: unknown;
  readonly checkpointHours?: unknown;
  readonly uncertaintyPerHour?: unknown;
  readonly basis?: unknown;
}
interface RawConfig {
  readonly version?: unknown;
  readonly authority?: unknown;
  readonly escalation?: unknown;
  readonly impactOverTime?: unknown;
}

function text(v: unknown, what: string): string {
  requireConfig(typeof v === 'string' && v.trim().length > 0, `${what} must be a non-empty string`);
  return v as string;
}

function unitInterval(v: unknown, what: string): number {
  requireConfig(
    typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1,
    `${what} must be a number in [0,1], got ${String(v)}`,
  );
  return v as number;
}

function positiveInteger(v: unknown, what: string): number {
  requireConfig(
    typeof v === 'number' && Number.isInteger(v) && v >= 1,
    `${what} must be an integer >= 1, got ${String(v)}`,
  );
  return v as number;
}

function block(v: unknown, what: string): RawBlock {
  requireConfig(typeof v === 'object' && v !== null, `${what} must be an object`);
  return v as RawBlock;
}

function parseEscalation(raw: unknown): EscalationUncertaintyConfig {
  const b = block(raw, 'escalation');
  return {
    referenceSamples: positiveInteger(b.referenceSamples, 'escalation.referenceSamples'),
    baseUncertainty: unitInterval(b.baseUncertainty, 'escalation.baseUncertainty'),
    uncertaintyPerMissingSample: unitInterval(
      b.uncertaintyPerMissingSample,
      'escalation.uncertaintyPerMissingSample',
    ),
    basis: text(b.basis, 'escalation.basis'),
  };
}

/**
 * Horizon checkpoints, strictly ascending and positive. The ascent is the property no JSON-Schema can state
 * and the one an accidental edit is most likely to break: the whole-prediction uncertainty is taken from the
 * LAST checkpoint as the worst case, so an out-of-order list would quietly label a 24 h projection with a 6 h
 * uncertainty.
 */
function parseCheckpointHours(v: unknown): readonly number[] {
  requireConfig(
    Array.isArray(v) && v.length > 0,
    'impactOverTime.checkpointHours must be a non-empty array',
  );
  const hours = (v as readonly unknown[]).map((h, i) => {
    requireConfig(
      typeof h === 'number' && Number.isFinite(h) && h > 0,
      `impactOverTime.checkpointHours[${i}] must be a finite number > 0, got ${String(h)}`,
    );
    return h as number;
  });
  hours.forEach((h, i) => {
    const prev = hours[i - 1];
    requireConfig(
      prev === undefined || h > prev,
      `impactOverTime.checkpointHours must strictly ascend (offending index ${i})`,
    );
  });
  return hours;
}

function parseImpactOverTime(raw: unknown): ImpactOverTimeConfig {
  const b = block(raw, 'impactOverTime');
  return {
    checkpointHours: parseCheckpointHours(b.checkpointHours),
    baseUncertainty: unitInterval(b.baseUncertainty, 'impactOverTime.baseUncertainty'),
    uncertaintyPerHour: unitInterval(b.uncertaintyPerHour, 'impactOverTime.uncertaintyPerHour'),
    basis: text(b.basis, 'impactOverTime.basis'),
  };
}

/**
 * Parse + validate the trend-projection parameters. Throws on any violation — a half-valid curve is worse
 * than none, because every uncertainty it prints looks equally deliberate.
 */
export function parseTrendProjectionConfig(raw: unknown): TrendProjectionConfig {
  requireConfig(typeof raw === 'object' && raw !== null, 'the file must contain a JSON object');
  const cfg = raw as RawConfig;
  requireConfig(cfg.version === 1, `version must be 1, got ${String(cfg.version)}`);
  return {
    version: 1,
    authority: text(cfg.authority, 'authority'),
    escalation: parseEscalation(cfg.escalation),
    impactOverTime: parseImpactOverTime(cfg.impactOverTime),
  };
}

/**
 * The SHIPPED parameters, parsed at import time (fail-fast: a bad config breaks the build's first test, not a
 * responder's screen). Injectable exactly like `DEFAULT_LIKELIHOOD_CONFIG` — every projector takes a
 * `TrendProjectionConfig` and only DEFAULTS to this one, so a region running different planning horizons
 * supplies its own table rather than editing the projector.
 */
export const DEFAULT_TREND_PROJECTION_CONFIG: TrendProjectionConfig =
  parseTrendProjectionConfig(trendProjectionJson);
