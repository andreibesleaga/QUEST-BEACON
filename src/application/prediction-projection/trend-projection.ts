// BEACON — the two TREND-DERIVED prediction kinds: ESCALATION + IMPACT_OVER_TIME (C2.2; ADR-033 §4.1/§4.2,
// FEV-7, FR-PRED-4/5). Both were declared in `PREDICTION_KINDS` and in the DB CHECK constraint and
// constructed NOWHERE (finding F-16) — this module is where they become real.
//
// What makes them different from the projections next door in `prediction-projection.ts`:
//
//   · they carry NO GEOMETRY, by design (ADR-033 §4.1/§4.2). A trend and a count-over-time are TEMPORAL
//     statements, not shapes. `Prediction.geom` is optional, so the record is fully valid; `ProjectedPrediction`
//     (the map wire) requires a geometry, so `projectMap` skips these and they contribute NO map descriptor —
//     intended behaviour (finding F-77), not a gap. Their surface is the SitRep/Outlook path.
//   · every figure is REUSED, never re-derived: the slope comes from `classifyTrend` (the same classifier that
//     labels `SitRep.trend`), the count comes from the deterministic exposure/priority pipeline and is passed
//     in, and any likelihood class + lead time comes from the C1 classifier (`deriveForecastLikelihood`) off a
//     signal a SOURCE published. Nothing here invents a figure, and the LLM never touches one (Art. XII).
//   · they are PURE and clock-free: `projectImpactOverTime` takes an injected `nowMs` and refuses to project
//     without one; `projectEscalation` reads no clock at all unless a source lead time is supplied, and then
//     only through the injected `nowMs` inside `ForecastLikelihoodInput`.
//   · every labelling parameter is DATA (`config/trend-projection.json`, ADR-012) — this module holds no
//     uncertainty or checkpoint literal.
//
// Honest limitation (finding F-34, binding): the `uncertainty` these predictions carry is a LABEL on a
// first-order projection. It is not a probability of occurrence, and no ensemble member fraction is involved —
// BEACON has no wired live ensemble source. Insufficient inputs yield a labeled `null`, never a filled-in
// guess (Art. XVI, the same idiom as `projectFireCone`/`projectFloodInundation`).
import type { IncidentId, PredictionId, SourceId } from '@/domain/value-objects/ids.js';
import type { Prediction } from '@/domain/prediction.js';
import { makePrediction } from '@/domain/prediction.js';
import { definedOnly } from '@/domain/shared/guard.js';
import { clamp01 } from '@/application/shared/geo.js';
import { DEFAULT_TREND_CONFIG, type TrendConfig } from '@/application/shared/config.js';
import {
  classifyTrend,
  type TrendSample,
  type TrendSignal,
} from '@/application/escalation-trend/escalation-trend.js';
import {
  deriveForecastLikelihood,
  type ForecastLikelihoodFields,
  type ForecastLikelihoodInput,
} from '@/application/forecast-likelihood/forecast-likelihood.js';
import {
  DEFAULT_LIKELIHOOD_CONFIG,
  type LikelihoodConfig,
} from '@/application/forecast-likelihood/likelihood-config.js';
import {
  DEFAULT_TREND_PROJECTION_CONFIG,
  type EscalationUncertaintyConfig,
  type ImpactOverTimeConfig,
  type TrendProjectionConfig,
} from './trend-projection-config.js';

const MS_PER_HOUR = 3_600_000;
const SECONDS_PER_HOUR = 3600;

/**
 * The three injectable tables both projectors read. An options object rather than three positional `cfg`
 * arguments: a call site that wants only a different likelihood table should not have to restate the others.
 * Each entry defaults to the shipped, schema-validated table.
 */
export interface TrendProjectionOptions {
  readonly projection?: TrendProjectionConfig;
  readonly trend?: TrendConfig;
  readonly likelihood?: LikelihoodConfig;
}

/** Method strings are quoted verbatim from ADR-033 §4.1/§4.2 so the label and the spec cannot drift apart. */
export const ESCALATION_METHOD =
  'first-order projection: least-squares trend slope with dead-band (reused from SitRep trend classifier)';
export const IMPACT_OVER_TIME_METHOD =
  'first-order projection: exposure-basis count projected along the least-squares trend slope at fixed horizon checkpoints';

const ESCALATION_CAVEAT =
  'a DIRECTION over the sample window, not a magnitude and not an arrival time; no geometry (this kind is a temporal statement, not a footprint)';
const IMPACT_CAVEAT =
  'the exposure-basis count is scaled by the hazard signal’s OWN relative growth rate (slopePerHour / latest signal level) — it is NOT a re-computed intersection against a future hazard footprint, NOT a demographic forecast, and not physics-grade';

/** No source signal at all ⇒ no class, no lead time, empty evidence bag (never a default class). */
const NO_FORECAST: ForecastLikelihoodFields = { inputs: {} };

/** The C1 likelihood/lead-time fields, when (and only when) a source published a signal to classify. */
function forecastFields(
  forecast: ForecastLikelihoodInput | undefined,
  cfg: LikelihoodConfig,
): ForecastLikelihoodFields {
  return forecast === undefined ? NO_FORECAST : deriveForecastLikelihood(forecast, cfg);
}

/**
 * The optional labelled fields, present only when something real supports them (`exactOptionalPropertyTypes`
 * is on, so an explicit `undefined` is a type error — absence has to be absence, which is also exactly the
 * discipline `definedOnly` enforces on the domain factory's output).
 */
function optionalFields(
  forecast: ForecastLikelihoodFields,
  horizon: string | undefined,
  sourceId: SourceId | undefined,
): Partial<Pick<Prediction, 'horizon' | 'likelihoodClass' | 'etaHours' | 'sourceId'>> {
  return {
    ...(horizon !== undefined ? { horizon } : {}),
    ...(forecast.likelihoodClass !== undefined
      ? { likelihoodClass: forecast.likelihoodClass }
      : {}),
    ...(forecast.etaHours !== undefined ? { etaHours: forecast.etaHours } : {}),
    ...(sourceId !== undefined ? { sourceId } : {}),
  };
}

/** Span of the sample window in hours — the evidence behind "this slope was fitted to N samples over H h". */
function windowHours(samples: readonly TrendSample[]): number {
  const times = samples.map((s) => s.t);
  return (Math.max(...times) - Math.min(...times)) / SECONDS_PER_HOUR;
}

/**
 * Decimal places every uncertainty LABEL is composed to (finding F-96). The uncertainty curves are sums and
 * products of config decimals (`config/trend-projection.json`: 0.4, 0.1, 0.02) over integer sample counts and
 * integer horizon hours, so no value here can carry more than two decimal places of actual information — but
 * IEEE-754 addition does: `0.4 + 3 * 0.1` composes to `0.7000000000000001`, and that is what a JSON/interop
 * consumer of `GET /incidents/{id}/sitrep` saw. The UI was never affected (ICU `{value, number}` renders
 * `0.7`), which is exactly why it survived: false precision on a figure the project explicitly labels as
 * approximate (Art. XIV), visible only off-screen. Two places is the precision of the inputs — rounding
 * further would discard the +24 h checkpoint's real 0.88, and rounding less would keep publishing residue.
 */
const UNCERTAINTY_DECIMALS = 2;
const UNCERTAINTY_SCALE = 10 ** UNCERTAINTY_DECIMALS;

/** Compose a labelled uncertainty at the precision its config inputs actually carry (F-96). Pure. */
function composeUncertainty(value: number): number {
  return Math.round(clamp01(value) * UNCERTAINTY_SCALE) / UNCERTAINTY_SCALE;
}

/**
 * Fewer samples ⇒ higher uncertainty, on the documented config curve (ADR-033 §4.1): the floor for a
 * well-sampled slope, plus one penalty per sample short of the reference count. Never computed per-call.
 */
function escalationUncertainty(samples: number, cfg: EscalationUncertaintyConfig): number {
  const shortfall = Math.max(0, cfg.referenceSamples - samples);
  return composeUncertainty(cfg.baseUncertainty + shortfall * cfg.uncertaintyPerMissingSample);
}

export interface EscalationInput {
  readonly id: PredictionId;
  readonly incidentId: IncidentId;
  /** The SAME trend signal the SitRep trend classifier reads (acreage, gauge stage, …). */
  readonly signal: TrendSignal;
  /** What the sample values MEASURE, in the source's own units — a slope without a unit is not a label. */
  readonly signalLabel: string;
  /** Optional source-published probability/lead-time signal (C1). Absent ⇒ no class, no ETA. */
  readonly forecast?: ForecastLikelihoodInput;
  readonly sourceId?: SourceId;
}

/**
 * ESCALATION (ADR-033 §4.1): WRAP `classifyTrend` — never reimplement it — and turn a non-STEADY trend into a
 * labeled `Prediction` carrying the full `TrendResult` verbatim as its inputs. `STEADY` (including the
 * too-few-samples case the classifier itself reports as STEADY) yields a labeled `null`: "no escalation" is an
 * answer, an invented direction is not.
 */
export function projectEscalation(
  input: EscalationInput,
  opts: TrendProjectionOptions = {},
): Prediction | null {
  const cfg = opts.projection ?? DEFAULT_TREND_PROJECTION_CONFIG;
  const result = classifyTrend(input.signal, opts.trend ?? DEFAULT_TREND_CONFIG);
  if (result.trend === 'STEADY') return null;
  const forecast = forecastFields(input.forecast, opts.likelihood ?? DEFAULT_LIKELIHOOD_CONFIG);
  return makePrediction({
    id: input.id,
    incidentId: input.incidentId,
    kind: 'ESCALATION',
    method: ESCALATION_METHOD,
    inputs: definedOnly({
      // The full TrendResult, verbatim (ADR-033 §4.1) — the reader can re-run the classifier from this alone.
      trend: result.trend,
      slopePerHour: result.slopePerHour,
      samples: result.samples,
      deadbandPerHour: result.deadbandPerHour,
      signalLabel: input.signalLabel,
      windowHours: windowHours(input.signal.samples),
      caveat: ESCALATION_CAVEAT,
      ...forecast.inputs,
      hazardArrival: forecast.hazardArrival,
    }),
    uncertainty: escalationUncertainty(result.samples, cfg.escalation),
    // `geom` is deliberately ABSENT (ADR-033 §4.1) — see the module header.
    ...optionalFields(forecast, forecast.hazardArrival, input.sourceId),
  });
}

/** What the projected count COUNTS. Both come from the deterministic exposure/priority pipeline. */
export const IMPACT_BASES = ['exposedPopulation', 'exposedNodes'] as const;
export type ImpactBasis = (typeof IMPACT_BASES)[number];

/** One horizon checkpoint of an IMPACT_OVER_TIME projection, each with its OWN uncertainty. */
export interface ImpactCheckpoint {
  readonly horizonHours: number;
  readonly projectedCount: number;
  /** ISO-8601 instant = injected now + horizonHours. */
  readonly at: string;
  readonly uncertainty: number;
}

export interface ImpactOverTimeInput {
  readonly id: PredictionId;
  readonly incidentId: IncidentId;
  readonly basis: ImpactBasis;
  /** The count as the deterministic pipeline computed it — this module NEVER re-derives an exposure. */
  readonly currentCount: number;
  /** The same trend series ESCALATION reads; the slope is taken from it, never invented. */
  readonly series: readonly TrendSample[];
  readonly signalLabel: string;
  /** Injected projection base time (epoch ms). No clock read: no `nowMs`, no projection. */
  readonly nowMs: number;
  readonly forecast?: ForecastLikelihoodInput;
  readonly sourceId?: SourceId;
}

/** Uncertainty compounds with horizon distance — the same shape `projectFireCone` already uses. Composed at
 *  the config's own precision (F-96), so a per-checkpoint label carries no float residue either. */
function checkpointUncertainty(horizonHours: number, cfg: ImpactOverTimeConfig): number {
  return composeUncertainty(cfg.baseUncertainty + horizonHours * cfg.uncertaintyPerHour);
}

/**
 * The signal LEVEL the slope was measured at: the value of the LATEST sample (greatest `t`, so an unsorted
 * series cannot silently pick the wrong level). It is what turns a slope in signal-units/hour into a
 * dimensionless relative rate that may legitimately scale a COUNT — multiplying a count by a signal-unit
 * slope would be an invented figure wearing a unit it does not have.
 */
function latestLevel(series: readonly TrendSample[]): number | undefined {
  let latest: TrendSample | undefined;
  for (const s of series) if (latest === undefined || s.t > latest.t) latest = s;
  return latest?.value;
}

/**
 * The four conditions a projection needs, each yielding a labeled `null` rather than a guess: an injected
 * clock, a non-negative finite current count, at least as many samples as the trend classifier itself
 * requires (a slope it refused to compute must never be projected), and a positive latest signal level to
 * form the relative rate from.
 */
function relativeRatePerHour(
  input: ImpactOverTimeInput,
  trendCfg: TrendConfig,
): {
  readonly rate: number;
  readonly level: number;
  readonly slopePerHour: number;
  readonly samples: number;
} | null {
  if (!Number.isFinite(input.nowMs)) return null;
  if (!Number.isFinite(input.currentCount) || input.currentCount < 0) return null;
  if (input.series.length < trendCfg.minSamples) return null;
  const level = latestLevel(input.series);
  if (level === undefined || level <= 0) return null;
  const result = classifyTrend({ samples: input.series }, trendCfg);
  return {
    rate: result.slopePerHour / level,
    level,
    slopePerHour: result.slopePerHour,
    samples: result.samples,
  };
}

/** Linear (first-order) projection of the count, floored at 0 and rounded to whole units. */
function projectedCount(currentCount: number, rate: number, horizonHours: number): number {
  return Math.max(0, Math.round(currentCount * (1 + rate * horizonHours)));
}

/**
 * IMPACT_OVER_TIME (ADR-033 §4.2): project the deterministic exposure-basis COUNT forward along the same
 * least-squares trend ESCALATION uses, at the config's fixed horizon checkpoints. Each checkpoint carries its
 * own uncertainty; the prediction's own `uncertainty` is the FURTHEST checkpoint's — the worst case, never an
 * average. Insufficient time-series data (or no injected clock) ⇒ labeled `null`.
 */
export function projectImpactOverTime(
  input: ImpactOverTimeInput,
  opts: TrendProjectionOptions = {},
): Prediction | null {
  const cfg = (opts.projection ?? DEFAULT_TREND_PROJECTION_CONFIG).impactOverTime;
  const basis = relativeRatePerHour(input, opts.trend ?? DEFAULT_TREND_CONFIG);
  if (basis === null) return null;
  const checkpoints: readonly ImpactCheckpoint[] = cfg.checkpointHours.map((horizonHours) => ({
    horizonHours,
    projectedCount: projectedCount(input.currentCount, basis.rate, horizonHours),
    at: new Date(input.nowMs + horizonHours * MS_PER_HOUR).toISOString(),
    uncertainty: checkpointUncertainty(horizonHours, cfg),
  }));
  const furthest = checkpoints[checkpoints.length - 1] as ImpactCheckpoint; // non-empty by config parse
  const forecast = forecastFields(input.forecast, opts.likelihood ?? DEFAULT_LIKELIHOOD_CONFIG);
  return makePrediction({
    id: input.id,
    incidentId: input.incidentId,
    kind: 'IMPACT_OVER_TIME',
    method: IMPACT_OVER_TIME_METHOD,
    inputs: definedOnly({
      basis: input.basis,
      currentCount: input.currentCount,
      signalLabel: input.signalLabel,
      slopePerHour: basis.slopePerHour,
      referenceLevel: basis.level,
      relativeRatePerHour: basis.rate,
      samples: basis.samples,
      checkpoints,
      projection:
        'count × (1 + relativeRatePerHour × horizonHours), floored at 0, rounded to whole units',
      caveat: IMPACT_CAVEAT,
      ...forecast.inputs,
      hazardArrival: forecast.hazardArrival,
    }),
    uncertainty: furthest.uncertainty,
    // `geom` is deliberately ABSENT (ADR-033 §4.2) — see the module header.
    ...optionalFields(forecast, furthest.at, input.sourceId),
  });
}
