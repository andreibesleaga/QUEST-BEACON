// BEACON — threshold-rule evaluation use-case (E5·T-202/T-206/T-207; FR-11, ADR-014, SPEC §5.3) extended to
// FORECAST crossings (C2.4; ADR-033 §6, FEV-9). Edge-triggered evaluator with hysteresis (min dwell,
// anti-flap) + cooldown (de-dup). Firing yields a DRAFT alert ONLY (Art. XIII — never ACTUAL; promotion needs
// human approval), and `buildDraftAlert` now says so IN THE TYPE: it returns a `DraftAlert`, which carries the
// `'DRAFT'` literal and is therefore not assignable to `EmittableAlert` (`src/ports/logistics.ts`, the
// `'ACTUAL'`-literal type `AlertSinkPort.emit` demands). Handing a fire's output to the alert sink is a `tsc`
// error, not a runtime check. Pure & deterministic — every clock is injected.
import type { ThresholdRule } from '@/domain/threshold-rule.js';
import type { FloodCategory, Gauge } from '@/domain/gauge.js';
import type { AlertCategory, AlertSeverity, DraftAlert } from '@/domain/alert.js';
import type { AlertId, IncidentId, SourceId } from '@/domain/value-objects/ids.js';
import { compareFloodCategory } from '@/domain/gauge.js';
import { compareLikelihoodClass } from '@/domain/prediction.js';
import { makeAlert } from '@/domain/alert.js';
import { definedOnly } from '@/domain/shared/guard.js';
import type { LikelihoodAssessment } from '@/application/forecast-likelihood/forecast-likelihood.js';
import {
  classifyLikelihood,
  gaugeLikelihoodSignal,
  hazardArrival,
} from '@/application/forecast-likelihood/forecast-likelihood.js';
import type { LikelihoodConfig } from '@/application/forecast-likelihood/likelihood-config.js';
import type { ForecastTriggerConfig } from './forecast-trigger-config.js';
import { DEFAULT_FORECAST_TRIGGER_CONFIG } from './forecast-trigger-config.js';

const MS_PER_HOUR = 3_600_000;

/** The observed signal for a rule this cycle. Shape depends on the rule target. */
export interface SignalReading {
  readonly floodCategory?: FloodCategory; // GAUGE_CATEGORY target — the OBSERVED category
  readonly hazardWithinBuffer?: boolean; // HAZARD_BUFFER target
  // ---- FORECAST_GAUGE_CATEGORY target (ADR-033 §6) ----------------------------------------------------
  /** The source-published FORECAST flood category (e.g. a GloFAS reporting point's return-period severity). */
  readonly forecastCategory?: FloodCategory;
  /** Remaining lead time in hours, as the source supported it. Required to fire: the DRAFT must state one. */
  readonly forecastEtaHours?: number;
  /** The SOURCE's own forecast issue instant (ISO-8601) — the vintage a superseded reading is caught by. */
  readonly forecastIssuedAt?: string;
  /**
   * The likelihood class WITH its evidence, produced by the C1 classifier
   * (`classifyLikelihood`/`gaugeLikelihoodSignal`). Never re-derived here: this module classifies nothing,
   * it only compares an already-classified assessment against the configured floor.
   */
  readonly forecastLikelihood?: LikelihoodAssessment;
}

/**
 * Persisted per-rule runtime state carried between ingestion cycles. Times are in the SAME unit as
 * `now` (epoch ms). Edge detection + dwell + cooldown all live here so evaluation stays pure.
 */
export interface RuleRuntimeState {
  readonly conditionMet: boolean; // was the condition met last cycle
  readonly candidateSince?: number; // when the current met-episode began (dwell anchor)
  readonly lastFiredAt?: number; // last fire time (cooldown anchor)
  readonly firedForEpisode: boolean; // already fired within the current met-episode (edge de-dup)
  /**
   * FORECAST targets only: the newest forecast issue instant (epoch ms) this rule has ever seen. A reading
   * whose vintage is OLDER than this one is a superseded run arriving out of order (replay, cache
   * resurrection, a stale mirror) and must not fire as if it were current.
   */
  readonly latestForecastIssuedAt?: number;
}

export interface RuleEvalContext {
  readonly rule: ThresholdRule;
  readonly reading: SignalReading;
  readonly now: number; // epoch ms (injected — deterministic)
  readonly previous?: RuleRuntimeState;
  /** Forecast gate table (lead-time window, vintage window, likelihood floor). Defaults to the shipped one. */
  readonly forecastConfig?: ForecastTriggerConfig;
}

export interface RuleEvalOutcome {
  readonly fired: boolean;
  readonly state: RuleRuntimeState;
}

const INITIAL_STATE: RuleRuntimeState = { conditionMet: false, firedForEpisode: false };

/** The clock + gate table a FORECAST target needs. Absent ⇒ a forecast rule fails closed (see below). */
export interface ForecastEvalContext {
  readonly now: number; // epoch ms (injected)
  readonly config?: ForecastTriggerConfig;
}

/**
 * Whether the rule's condition is currently satisfied by the reading (deterministic).
 *
 * A `FORECAST_GAUGE_CATEGORY` rule additionally needs `at` — a forecast can only be judged against the
 * instant it is being read at. Calling without it FAILS CLOSED (returns false): a forecast whose vintage
 * cannot be checked is not a forecast anyone should be warned on.
 */
export function conditionMet(
  rule: ThresholdRule,
  reading: SignalReading,
  at?: ForecastEvalContext,
): boolean {
  if (rule.target === 'GAUGE_CATEGORY') {
    if (reading.floodCategory === undefined) return false;
    return compareFloodCategory(reading.floodCategory, rule.value as FloodCategory) >= 0;
  }
  if (rule.target === 'FORECAST_GAUGE_CATEGORY') {
    return at === undefined ? false : forecastConditionMet(rule, reading, at);
  }
  return reading.hazardWithinBuffer === true;
}

/**
 * The forecast crossing itself, plus the three gates that keep an anticipatory DRAFT honest: the reading must
 * carry a lead time inside the configured window, a source-issued vintage inside the configured window, and
 * (when configured) a classified likelihood at or above the floor. Every bound is config, never a literal.
 */
function forecastConditionMet(
  rule: ThresholdRule,
  reading: SignalReading,
  at: ForecastEvalContext,
): boolean {
  const cfg = at.config ?? DEFAULT_FORECAST_TRIGGER_CONFIG;
  const category = reading.forecastCategory;
  if (category === undefined) return false;
  if (compareFloodCategory(category, rule.value as FloodCategory) < 0) return false;
  if (!leadTimeInWindow(reading.forecastEtaHours, cfg)) return false;
  if (!vintageIsCurrent(reading.forecastIssuedAt, at.now, cfg)) return false;
  return likelihoodMeetsFloor(reading.forecastLikelihood, cfg);
}

/** A missing lead time never passes: FEV-9 requires the DRAFT to STATE the expected crossing time. */
function leadTimeInWindow(etaHours: number | undefined, cfg: ForecastTriggerConfig): boolean {
  if (etaHours === undefined || !Number.isFinite(etaHours)) return false;
  return etaHours >= cfg.leadTime.minHours && etaHours <= cfg.leadTime.maxHours;
}

/**
 * Vintage gate. No issue instant ⇒ false: absence of a vintage is not evidence of freshness. An instant in
 * the FUTURE relative to the injected clock is also refused — that is a corrupt or mis-parsed reading, and
 * silently accepting it would let a bad timestamp buy unlimited freshness.
 */
function vintageIsCurrent(
  issuedAt: string | undefined,
  now: number,
  cfg: ForecastTriggerConfig,
): boolean {
  const issuedMs = parseIssuedAt(issuedAt);
  if (issuedMs === undefined) return false;
  const ageHours = (now - issuedMs) / MS_PER_HOUR;
  return ageHours >= 0 && ageHours <= cfg.vintage.maxForecastAgeHours;
}

function parseIssuedAt(issuedAt: string | undefined): number | undefined {
  if (issuedAt === undefined) return undefined;
  const parsed = Date.parse(issuedAt);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** Likelihood floor. No floor configured ⇒ the gate is not applied; a floor with no assessment ⇒ no fire. */
function likelihoodMeetsFloor(
  assessment: LikelihoodAssessment | undefined,
  cfg: ForecastTriggerConfig,
): boolean {
  const floor = cfg.minLikelihood;
  if (floor === undefined) return true;
  if (assessment === undefined) return false;
  return compareLikelihoodClass(assessment.likelihoodClass, floor.class) >= 0;
}

/**
 * Evaluate one rule for one cycle. Fires at most once per met-episode (edge), only after the state
 * has dwelt `hysteresis` (anti-flap), and only if `cooldown` since the last fire has elapsed. A forecast
 * target additionally never fires on a run older than the newest one already seen (`latestForecastIssuedAt`).
 */
export function evaluateRule(ctx: RuleEvalContext): RuleEvalOutcome {
  const prev = ctx.previous ?? INITIAL_STATE;
  const vintage = forecastVintage(ctx, prev);
  const met = conditionMet(ctx.rule, ctx.reading, forecastEvalContext(ctx));
  if (!met) {
    return {
      fired: false,
      state: definedOnly({
        conditionMet: false,
        firedForEpisode: false,
        lastFiredAt: prev.lastFiredAt,
        latestForecastIssuedAt: vintage.latest,
      }) as RuleRuntimeState,
    };
  }
  const candidateSince = prev.conditionMet ? (prev.candidateSince ?? ctx.now) : ctx.now;
  const fired = !vintage.superseded && isFiring(prev, ctx, candidateSince);
  return {
    fired,
    state: definedOnly({
      conditionMet: true,
      candidateSince,
      firedForEpisode: prev.firedForEpisode || fired,
      lastFiredAt: fired ? ctx.now : prev.lastFiredAt,
      latestForecastIssuedAt: vintage.latest,
    }) as RuleRuntimeState,
  };
}

function forecastEvalContext(ctx: RuleEvalContext): ForecastEvalContext {
  return definedOnly({ now: ctx.now, config: ctx.forecastConfig }) as ForecastEvalContext;
}

interface ForecastVintage {
  /** The newest forecast issue instant (epoch ms) seen so far, carried forward into the next cycle. */
  readonly latest?: number;
  readonly superseded: boolean;
}

/**
 * Out-of-order / superseded-run detection. `latest` is the newest issue instant ever seen for this rule;
 * `superseded` is true when THIS reading is strictly older than that. A superseded reading is evaluated
 * normally (so the episode state stays honest) but is not allowed to fire — it is a replay of a run the
 * source has already replaced.
 */
function forecastVintage(ctx: RuleEvalContext, prev: RuleRuntimeState): ForecastVintage {
  const issuedMs = parseIssuedAt(ctx.reading.forecastIssuedAt);
  const seen = prev.latestForecastIssuedAt;
  if (issuedMs === undefined)
    return definedOnly({ latest: seen, superseded: false }) as ForecastVintage;
  if (seen === undefined) return { latest: issuedMs, superseded: false };
  return { latest: Math.max(seen, issuedMs), superseded: issuedMs < seen };
}

/** True only on the rising edge: not already fired this episode, dwelt past hysteresis, cooldown elapsed. */
function isFiring(prev: RuleRuntimeState, ctx: RuleEvalContext, candidateSince: number): boolean {
  const dwellOk = ctx.now - candidateSince >= (ctx.rule.hysteresis ?? 0);
  const cooldownOk =
    prev.lastFiredAt === undefined || ctx.now - prev.lastFiredAt >= (ctx.rule.cooldown ?? 0);
  return !prev.firedForEpisode && dwellOk && cooldownOk;
}

export interface DraftAlertRequest {
  readonly rule: ThresholdRule;
  readonly incidentId: IncidentId;
  readonly alertId: AlertId;
  readonly category: AlertCategory;
  readonly severity: AlertSeverity;
  readonly sourceId: SourceId; // provenance → the triggering SOURCE_RECORD (F8/Art. XI)
  /** The reading that fired — supplies the forecast lead time/vintage/evidence for a FORECAST target. */
  readonly reading?: SignalReading;
  /** Injected evaluation instant (epoch ms) — turns the lead time into an expected-crossing instant. */
  readonly now?: number;
}

/**
 * The anticipatory context a FORECAST_GAUGE_CATEGORY fire carries into its DRAFT alert (FEV-9). Every field
 * is a source-supported value or a pure function of one — nothing here is narrated, estimated or modelled.
 */
export interface ForecastDraftContext {
  readonly leadTimeHours: number;
  /** ISO-8601 = injected now + lead time. Computed by the C1 `hazardArrival` helper, not re-implemented. */
  readonly expectedCrossingAt: string;
  readonly forecastCategory: FloodCategory;
  /** The source's own forecast issue instant — the vintage this DRAFT is grounded in. */
  readonly forecastIssuedAt: string;
  readonly likelihoodClass?: string;
  /** The source value that produced the class, verbatim — a class never travels without its evidence. */
  readonly likelihoodRawValue?: number | string;
  readonly likelihoodSourceField?: string;
  /** The classifier's own method string, verbatim: what BEACON did, and what it does not claim. */
  readonly likelihoodMethod?: string;
}

export interface DraftAlertProposal {
  /**
   * ALWAYS cap_status=DRAFT — and `DraftAlert` says so in the TYPE, so this value can never be passed to
   * `AlertSinkPort.emit` (which demands the disjoint `EmittableAlert`). Art. XIII is a compile error here,
   * not a convention.
   */
  readonly alert: DraftAlert;
  readonly provenanceSourceId: SourceId;
  /** Present only for a FORECAST_GAUGE_CATEGORY proposal with a complete forecast reading. */
  readonly forecast?: ForecastDraftContext;
}

/**
 * Build the DRAFT alert a fired rule proposes. cap_status is hardcoded DRAFT (a fire can NEVER produce
 * an ACTUAL/approved alert — that requires a human — Art. XIII/F8); provenance links the source record.
 */
export function buildDraftAlert(req: DraftAlertRequest): DraftAlertProposal {
  const alert = makeAlert({
    id: req.alertId,
    incidentId: req.incidentId,
    thresholdRuleId: req.rule.id,
    capStatus: 'DRAFT',
    category: req.category,
    severity: req.severity,
  });
  return definedOnly({
    // Sound: makeAlert was just called with the 'DRAFT' literal and no approver.
    alert: alert as DraftAlert,
    provenanceSourceId: req.sourceId,
    forecast: forecastContext(req),
  }) as DraftAlertProposal;
}

/** The forecast context, or undefined when this is not a forecast fire / the reading lacks the essentials. */
function forecastContext(req: DraftAlertRequest): ForecastDraftContext | undefined {
  if (
    req.rule.target !== 'FORECAST_GAUGE_CATEGORY' ||
    req.reading === undefined ||
    req.now === undefined
  ) {
    return undefined;
  }
  return forecastEvidence(req.reading, req.now);
}

/**
 * The anticipatory evidence, assembled from the reading only. An incomplete reading yields `undefined`
 * rather than a partially-filled context: a DRAFT that cannot state its lead time, its forecast category and
 * the vintage it rests on has no business claiming to be a forecast alert (FEV-9).
 */
function forecastEvidence(reading: SignalReading, now: number): ForecastDraftContext | undefined {
  const leadTimeHours = reading.forecastEtaHours;
  const forecastCategory = reading.forecastCategory;
  const forecastIssuedAt = reading.forecastIssuedAt;
  if (
    leadTimeHours === undefined ||
    forecastCategory === undefined ||
    forecastIssuedAt === undefined
  ) {
    return undefined;
  }
  const likelihood = reading.forecastLikelihood;
  return definedOnly({
    leadTimeHours,
    expectedCrossingAt: hazardArrival(now, leadTimeHours),
    forecastCategory,
    forecastIssuedAt,
    likelihoodClass: likelihood?.likelihoodClass,
    likelihoodRawValue: likelihood?.rawValue,
    likelihoodSourceField: likelihood?.sourceField,
    likelihoodMethod: likelihood?.method,
  }) as ForecastDraftContext;
}

/** What a forecast Gauge contributes to a reading, beyond the gauge itself. */
export interface ForecastReadingInput {
  /** Remaining lead time in hours, as the source supported it (e.g. from `deriveForecastLikelihood`). */
  readonly etaHours?: number;
  /** The source's own forecast issue instant (ISO-8601). */
  readonly issuedAt?: string;
  /** Injectable likelihood threshold table — defaults to the shipped `config/likelihood-thresholds.json`. */
  readonly likelihoodConfig?: LikelihoodConfig;
}

/**
 * Build a FORECAST_GAUGE_CATEGORY `SignalReading` from a forecast Gauge. The single seam between the C1
 * likelihood work and the threshold engine: the likelihood class comes from `gaugeLikelihoodSignal` +
 * `classifyLikelihood` — the same classifier every other surface uses — so the engine can never disagree with
 * the Outlook about how likely a crossing is, and holds no classification logic of its own.
 */
export function forecastReadingFromGauge(
  gauge: Pick<Gauge, 'floodCategory' | 'exceedanceProbability'>,
  input: ForecastReadingInput = {},
): SignalReading {
  const signal = gaugeLikelihoodSignal(gauge);
  const assessment =
    signal === undefined ? null : classifyLikelihood(signal, input.likelihoodConfig);
  return definedOnly({
    forecastCategory: gauge.floodCategory,
    forecastEtaHours: input.etaHours,
    forecastIssuedAt: input.issuedAt,
    forecastLikelihood: assessment ?? undefined,
  }) as SignalReading;
}
