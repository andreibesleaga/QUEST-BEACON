// BEACON — deterministic forecast-likelihood classifier (C1.2/C1.3; ADR-033 §2.2/§3, FR-PRED-2/3).
//
// Art. XII in one file: a likelihood CLASS is a pure threshold lookup on a probability signal a SOURCE
// already published, read from the config table (`likelihood-config.ts`). This module
//   · never reads a clock (every entry point takes an injected `nowMs`),
//   · never holds a threshold literal (they are all config),
//   · never derives a class from anything other than the source-provided signal handed to it — not from
//     severity, not from tendency, not from a trend, not from an LLM (FUW-3),
//   · never returns a bare class: every assessment carries rawValue + sourceField + method + threshold, so
//     no surface can display a class without the evidence that produced it (FU-11).
//
// A signal that no band covers yields `null` — the labeled-null idiom used by the projection use-cases
// (`prediction-projection.ts`): no class is an honest answer, a manufactured one is not (Art. XVI: the
// record, its raw value and its geometry are still carried; only the class is absent).
import type { Gauge } from '@/domain/gauge.js';
import type { LikelihoodClass } from '@/domain/prediction.js';
import { definedOnly } from '@/domain/shared/guard.js';
import type {
  ContinuousLikelihoodRule,
  LikelihoodConfig,
  LikelihoodRule,
  LikelihoodSignalType,
  OrdinalLikelihoodRule,
} from './likelihood-config.js';
import { DEFAULT_LIKELIHOOD_CONFIG } from './likelihood-config.js';

const MS_PER_HOUR = 3_600_000;

/** One signal, exactly as the source published it. `value` is never rescaled or rounded on the way in. */
export interface LikelihoodSignal {
  readonly signalType: LikelihoodSignalType;
  readonly value: number | string;
}

/** A class plus the evidence that produced it — the only shape a class ever travels in (FU-11). */
export interface LikelihoodAssessment {
  readonly likelihoodClass: LikelihoodClass;
  readonly signalType: LikelihoodSignalType;
  /** The source value, verbatim. */
  readonly rawValue: number | string;
  readonly sourceField: string;
  readonly method: string;
  /** The inclusive band bound that selected the class (continuous rules) — makes the decision auditable. */
  readonly threshold?: number;
  /** The normalized source tier that selected the class (ordinal rules). */
  readonly sourceLevel?: string;
}

/**
 * Classify a source-provided signal. Returns `null` — not a default class — when the signal is missing, of
 * the wrong shape, outside the documented unit interval, below the rule's `unclassifiedBelow`, or an
 * unlisted ordinal tier.
 */
export function classifyLikelihood(
  signal: LikelihoodSignal,
  cfg: LikelihoodConfig = DEFAULT_LIKELIHOOD_CONFIG,
): LikelihoodAssessment | null {
  const rule: LikelihoodRule | undefined = cfg.signalTypes[signal.signalType];
  if (rule === undefined) return null;
  return rule.kind === 'CONTINUOUS'
    ? classifyContinuous(rule, signal)
    : classifyOrdinal(rule, signal);
}

function classifyContinuous(
  rule: ContinuousLikelihoodRule,
  signal: LikelihoodSignal,
): LikelihoodAssessment | null {
  const value = signal.value;
  // Out-of-range is refused rather than clamped: a 1.4 "probability" is an un-understood unit, not a certainty.
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) return null;
  if (rule.unclassifiedBelow !== undefined && value < rule.unclassifiedBelow) return null;
  // Bands ascend (enforced at parse time) — scan from the top so the first match is the highest that applies.
  const band = rule.bands.findLast((b) => value >= b.lowerBound);
  if (band === undefined) return null;
  return {
    likelihoodClass: band.class,
    signalType: signal.signalType,
    rawValue: value,
    sourceField: rule.sourceField,
    method: rule.method,
    threshold: band.lowerBound,
  };
}

function classifyOrdinal(
  rule: OrdinalLikelihoodRule,
  signal: LikelihoodSignal,
): LikelihoodAssessment | null {
  if (typeof signal.value !== 'string') return null;
  const level = signal.value.trim().toLowerCase();
  const cls = rule.levels[level];
  if (cls === undefined) return null;
  return {
    likelihoodClass: cls,
    signalType: signal.signalType,
    rawValue: signal.value,
    sourceField: rule.sourceField,
    method: rule.method,
    sourceLevel: level,
  };
}

/**
 * The ONLY bridge from a Gauge to a likelihood signal: the source-published exceedance probability. Severity
 * (`floodCategory`), crest values and `tendency` are deliberately NOT consulted — deriving a likelihood from
 * them would be an invented heuristic wearing a source's clothes (FUW-3).
 */
export function gaugeLikelihoodSignal(
  gauge: Pick<Gauge, 'exceedanceProbability'>,
): LikelihoodSignal | undefined {
  const value = gauge.exceedanceProbability;
  return value === undefined ? undefined : { signalType: 'DERIVED_EXCEEDANCE_PROBABILITY', value };
}

export interface ForecastLikelihoodInput {
  /** The source-provided probability signal, if the source published one. */
  readonly signal?: LikelihoodSignal;
  /** Injected projection base time (epoch ms). This module never reads the wall clock. */
  readonly nowMs: number;
  /** A source-provided lead time in hours, when the source states hours directly. */
  readonly etaHours?: number;
  /** A source-provided forecast instant (ISO-8601), e.g. GloFAS time-to-peak, to derive the lead time from. */
  readonly forecastInstant?: string;
}

/**
 * The forecast-likelihood fields of a Prediction, ready to spread into `makePrediction` alongside its
 * `method`/`inputs`/`uncertainty`. `hazardArrival` is computed HERE, from the injected clock, and is
 * intentionally not a domain field: storing it would drag a wall-clock read into a pure value-object
 * factory (ADR-033 §3).
 */
export interface ForecastLikelihoodFields {
  readonly likelihoodClass?: LikelihoodClass;
  readonly etaHours?: number;
  /** ISO-8601 instant = nowMs + etaHours. Absent whenever no source-supported lead time exists. */
  readonly hazardArrival?: string;
  /** Evidence for `Prediction.inputs` — present keys only; empty when the source supported nothing. */
  readonly inputs: Readonly<Record<string, unknown>>;
}

/**
 * Lead time in hours from whatever the source supported: an explicit hours value wins, otherwise it is the
 * gap to a source-provided forecast instant. A NEGATIVE gap yields `undefined`, not 0 — a forecast instant
 * already in the past is a stale-vintage signal, and reporting "arriving now" would be a claim the data
 * does not make.
 */
function resolveEtaHours(input: ForecastLikelihoodInput): number | undefined {
  const stated = input.etaHours;
  if (stated !== undefined) return Number.isFinite(stated) && stated >= 0 ? stated : undefined;
  if (input.forecastInstant === undefined) return undefined;
  const at = Date.parse(input.forecastInstant);
  if (Number.isNaN(at)) return undefined;
  const hours = (at - input.nowMs) / MS_PER_HOUR;
  return hours >= 0 ? hours : undefined;
}

function etaBasis(
  etaHours: number | undefined,
  input: ForecastLikelihoodInput,
): string | undefined {
  if (etaHours === undefined) return undefined;
  return input.etaHours !== undefined
    ? 'source-stated lead time'
    : 'source-provided forecast instant';
}

function evidence(
  assessment: LikelihoodAssessment | null,
  etaHours: number | undefined,
  input: ForecastLikelihoodInput,
): Readonly<Record<string, unknown>> {
  return definedOnly({
    likelihoodSignalType: assessment?.signalType,
    likelihoodRawValue: assessment?.rawValue,
    likelihoodSourceField: assessment?.sourceField,
    likelihoodThreshold: assessment?.threshold,
    likelihoodSourceLevel: assessment?.sourceLevel,
    likelihoodMethod: assessment?.method,
    etaHours,
    etaBasis: etaBasis(etaHours, input),
  });
}

/**
 * Derive the labeled forecast-likelihood fields of a prediction from source-provided signals only.
 * Everything is optional on purpose: a source that publishes no probability and no lead time yields a
 * prediction with neither, plus an empty evidence bag — never a filled-in guess.
 */
export function deriveForecastLikelihood(
  input: ForecastLikelihoodInput,
  cfg: LikelihoodConfig = DEFAULT_LIKELIHOOD_CONFIG,
): ForecastLikelihoodFields {
  const assessment = input.signal === undefined ? null : classifyLikelihood(input.signal, cfg);
  const etaHours = resolveEtaHours(input);
  return definedOnly({
    likelihoodClass: assessment?.likelihoodClass,
    etaHours,
    hazardArrival: etaHours === undefined ? undefined : hazardArrival(input.nowMs, etaHours),
    inputs: evidence(assessment, etaHours, input),
  }) as ForecastLikelihoodFields;
}

/** Computed hazard-arrival instant (ISO-8601) = injected now + lead time. Pure; the clock is an argument. */
export function hazardArrival(nowMs: number, etaHours: number): string {
  return new Date(nowMs + etaHours * MS_PER_HOUR).toISOString();
}
