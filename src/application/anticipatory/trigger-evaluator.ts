// BEACON — the anticipatory-action TRIGGER EVALUATOR (D2; ADR-034 §3, FR-AA-2/FR-AA-3, FU-14, FUW-4).
//
// Art. XII in one function: `evaluateEapTriggers` is PURE and CLOCK-FREE. Every instant is injected
// (`nowMs`), the forecast arrives as a value (a cached file or a source reading — never a fetch), and the
// thresholds come from the EAP data file. Identical `(eap, priorState, forecast, nowMs)` therefore yields a
// deep-equal result including the evidence object, which is what makes replay determinism a testable property
// rather than an aspiration (`tests/redundancy/trigger-replay.test.ts`).
//
// Art. XIII: the evaluator returns a DECISION and SUGGESTED ACTION IDS. It holds no port, builds no alert and
// tasks nothing — `suggestedActionIds` are ids from the protocol's pre-agreed list, for a human to act on.
// An activation is not an emission (FUW-4).
//
// The likelihood class is NOT computed here: it comes from the C1 classifier (`classifyLikelihood` over
// `config/likelihood-thresholds.json`), the same one the Outlook uses, so the anticipatory panel and the
// Outlook cannot disagree about how likely a crossing is. The `ENSEMBLE_MEMBER_FRACTION` row in that config
// is the row this evaluator finally consumes.
import type { EapStage, EapState, EarlyActionProtocol, EapTrigger, TriggerState } from '@/domain/early-action-protocol.js';
import { EAP_DURATION_STOP_ID, isDurationExpired, stageTrigger } from '@/domain/early-action-protocol.js';
import type {
  TriggerAppliedGate,
  TriggerEvaluation,
  TriggerEvidence,
  TriggerGate,
  TriggerLikelihood,
  TriggerOutcomeReason,
} from '@/domain/trigger-evaluation.js';
import { likelihoodClassRank } from '@/domain/prediction.js';
import { definedOnly } from '@/domain/shared/guard.js';
import type { LikelihoodSignalType } from '@/application/forecast-likelihood/likelihood-config.js';
import type { LikelihoodConfig } from '@/application/forecast-likelihood/likelihood-config.js';
import { classifyLikelihood } from '@/application/forecast-likelihood/forecast-likelihood.js';
import type { ForecastTriggerConfig } from '@/application/threshold-evaluation/forecast-trigger-config.js';
import { DEFAULT_FORECAST_TRIGGER_CONFIG } from '@/application/threshold-evaluation/forecast-trigger-config.js';
import type { EnsembleMemberFile, SourceProbabilityReading } from './ensemble-evidence.js';
import { ensembleEvidence, sourceProbabilityEvidence } from './ensemble-evidence.js';

const MS_PER_HOUR = 3_600_000;

/** What the caller managed to obtain. Both arms are VALUES — this module never fetches anything. */
export type TriggerForecast =
  | { readonly kind: 'ENSEMBLE_MEMBERS'; readonly file: EnsembleMemberFile }
  | { readonly kind: 'SOURCE_PROBABILITY'; readonly reading: SourceProbabilityReading };

export interface EapEvaluationInput {
  readonly eap: EarlyActionProtocol;
  readonly priorState: TriggerState;
  /** Absent ⇒ an honest no-op cycle (`NO_EVIDENCE`), never a guessed one. */
  readonly forecast?: TriggerForecast;
  /** Injected evaluation instant (epoch ms). This module never reads a wall clock. */
  readonly nowMs: number;
  /** Injectable likelihood table — defaults to the shipped `config/likelihood-thresholds.json`. */
  readonly likelihoodConfig?: LikelihoodConfig;
  /** Injectable vintage window — defaults to the shipped `config/forecast-trigger.json` (C2.4 reuse). */
  readonly forecastConfig?: ForecastTriggerConfig;
}

/**
 * Which stages may fire from a given state — the IFRC ladder as data. This is what keeps a READINESS
 * crossing from DOWN-transitioning an already-ACTIVATED protocol (`ACTIVATED→READINESS` is not a legal
 * transition, so allowing that fire would throw at the state machine instead of being refused here).
 */
const CANDIDATE_STAGES: Readonly<Record<EapState, readonly EapStage[]>> = Object.freeze({
  IDLE: ['ACTIVATION', 'READINESS'],
  READINESS: ['ACTIVATION'],
  ACTIVATED: [],
  STOPPED: [],
});

/**
 * The next rung of the ladder — the stage whose gate the operator is waiting on, and therefore the stage
 * whose evidence and gate a non-firing cycle reports. Taken from the state the cycle ENDS in: an idle (or
 * de-escalated) protocol is waiting on READINESS; anything above it is waiting on ACTIVATION.
 */
function nextRung(state: EapState): EapStage {
  return state === 'IDLE' ? 'READINESS' : 'ACTIVATION';
}

interface StageOutcome {
  readonly stage: EapStage;
  readonly evidence: TriggerEvidence;
  readonly likelihood?: TriggerLikelihood;
  readonly gate: TriggerGate;
  readonly met: boolean;
  readonly reason: TriggerOutcomeReason;
}

const SIGNAL_TYPE: Readonly<Record<TriggerEvidence['kind'], LikelihoodSignalType>> = Object.freeze({
  ENSEMBLE_MEMBER_COUNT: 'ENSEMBLE_MEMBER_FRACTION',
  SOURCE_DERIVED_PROBABILITY: 'DERIVED_EXCEEDANCE_PROBABILITY',
});

const APPLIED_GATE: Readonly<Record<TriggerEvidence['kind'], TriggerAppliedGate>> = Object.freeze({
  ENSEMBLE_MEMBER_COUNT: 'MEMBER_FRACTION',
  SOURCE_DERIVED_PROBABILITY: 'LIKELIHOOD_CLASS',
});

/** The number the likelihood table is looked up with: a member SHARE, or the source's own probability. */
function signalValue(evidence: TriggerEvidence): number {
  return evidence.kind === 'ENSEMBLE_MEMBER_COUNT' ? evidence.memberFraction : evidence.probability;
}

/** Build evidence for one stage's threshold. Two stages of one EAP yield two counts — see `ensembleEvidence`. */
function evidenceFor(forecast: TriggerForecast, trigger: EapTrigger): TriggerEvidence {
  return forecast.kind === 'ENSEMBLE_MEMBERS'
    ? ensembleEvidence(forecast.file, trigger.threshold, trigger.comparator)
    : sourceProbabilityEvidence(forecast.reading);
}

/** Classify through the C1 table. `undefined` when no band covers the signal — an honest absence (FUW-3). */
function classify(evidence: TriggerEvidence, cfg: LikelihoodConfig | undefined): TriggerLikelihood | undefined {
  const value = signalValue(evidence);
  const assessment = classifyLikelihood({ signalType: SIGNAL_TYPE[evidence.kind], value }, cfg);
  if (assessment === null) return undefined;
  return definedOnly({
    likelihoodClass: assessment.likelihoodClass,
    rawValue: value,
    sourceField: assessment.sourceField,
    method: assessment.method,
    threshold: assessment.threshold,
  }) as TriggerLikelihood;
}

function gateFor(stage: EapStage, trigger: EapTrigger, evidence: TriggerEvidence): TriggerGate {
  return {
    stage,
    threshold: trigger.threshold,
    comparator: trigger.comparator,
    minMembersFraction: trigger.minMembersFraction,
    minLikelihoodClass: trigger.minLikelihoodClass,
    leadTimeHours: trigger.leadTimeHours,
    appliedGate: APPLIED_GATE[evidence.kind],
  };
}

/**
 * The magnitude gate, selected by the evidence KIND — the two are never combined and never converted
 * (ADR-034 §3). A member share is measured against `minMembersFraction`; a source-published probability is
 * measured against `minLikelihoodClass` through the shared classifier, and an unclassifiable probability
 * fails closed rather than defaulting to a class.
 */
function magnitudeMet(
  evidence: TriggerEvidence,
  trigger: EapTrigger,
  likelihood: TriggerLikelihood | undefined,
): { readonly met: boolean; readonly reason: TriggerOutcomeReason } {
  if (evidence.kind === 'ENSEMBLE_MEMBER_COUNT') {
    const met = evidence.memberFraction >= trigger.minMembersFraction;
    return { met, reason: met ? 'FIRED' : 'MAGNITUDE_GATE_NOT_MET' };
  }
  if (likelihood === undefined) return { met: false, reason: 'UNCLASSIFIED_SIGNAL' };
  const met = likelihoodClassRank(likelihood.likelihoodClass) >= likelihoodClassRank(trigger.minLikelihoodClass);
  return { met, reason: met ? 'FIRED' : 'MAGNITUDE_GATE_NOT_MET' };
}

/** Evaluate one stage completely: evidence, class, gate, and whether every gate is satisfied. */
function evaluateStage(stage: EapStage, input: EapEvaluationInput, forecast: TriggerForecast): StageOutcome {
  const trigger = stageTrigger(input.eap, stage);
  const evidence = evidenceFor(forecast, trigger);
  const likelihood = classify(evidence, input.likelihoodConfig);
  const gate = gateFor(stage, trigger, evidence);
  const base = { stage, evidence, gate, ...(likelihood === undefined ? {} : { likelihood }) };
  if (evidence.leadTimeHours <= 0 || evidence.leadTimeHours > trigger.leadTimeHours) {
    return { ...base, met: false, reason: 'LEAD_TIME_OUTSIDE_STAGE_HORIZON' };
  }
  const magnitude = magnitudeMet(evidence, trigger, likelihood);
  return { ...base, met: magnitude.met, reason: magnitude.reason };
}

/** Vintage + ordering refusals, in the order that makes the most specific reason win. */
function vintageRefusal(
  forecast: TriggerForecast,
  prior: TriggerState,
  nowMs: number,
  cfg: ForecastTriggerConfig,
): TriggerOutcomeReason | undefined {
  const issuedAt = forecast.kind === 'ENSEMBLE_MEMBERS' ? forecast.file.issuedAt : forecast.reading.issuedAt;
  const issuedMs = Date.parse(issuedAt);
  if (Number.isNaN(issuedMs)) return 'UNPARSEABLE_VINTAGE';
  if (issuedMs > nowMs) return 'FUTURE_VINTAGE';
  if ((nowMs - issuedMs) / MS_PER_HOUR > cfg.vintage.maxForecastAgeHours) return 'STALE_VINTAGE';
  const seen = prior.latestForecastIssuedAt;
  if (seen !== undefined && issuedMs < Date.parse(seen)) return 'SUPERSEDED_RUN';
  return undefined;
}

/** The pre-agreed action ids a fire SUGGESTS. A READINESS fire suggests no tasking — that is the ladder. */
function suggestedActionIds(eap: EarlyActionProtocol, fired: EapStage | null): readonly string[] {
  if (fired === null) return [];
  const kinds = fired === 'ACTIVATION' ? ['PREPOSITION', 'TASK', 'NOTIFY_INTERNAL'] : ['PREPOSITION', 'NOTIFY_INTERNAL'];
  return eap.actions.filter((a) => kinds.includes(a.kind)).map((a) => a.id);
}

function noFire(input: EapEvaluationInput, to: EapState, reason: TriggerOutcomeReason): TriggerEvaluation {
  return {
    eapId: input.eap.id,
    episodeId: input.priorState.episodeId,
    from: input.priorState.state,
    to,
    fired: null,
    reason,
    evaluatedAt: new Date(input.nowMs).toISOString(),
    suggestedActionIds: [],
  };
}

/**
 * The machine-enforced half of the STOP mechanism. Checked BEFORE the forecast, because it is pure clock
 * arithmetic and must hold even on a cycle where no forecast arrived: an activation cannot outlive its
 * declared `stop.maxDurationHours` merely because the data stopped flowing.
 */
function durationStop(input: EapEvaluationInput): TriggerEvaluation | undefined {
  if (!isDurationExpired(input.eap, input.priorState, input.nowMs)) return undefined;
  return {
    ...noFire(input, 'STOPPED', 'MAX_DURATION_ELAPSED'),
    stop: {
      conditionId: EAP_DURATION_STOP_ID,
      authorizerRole: input.eap.stop.authorizerRole,
      durationEnforced: true,
    },
  };
}

/** Which stage fired, if any: the highest rung this state may climb whose every gate is satisfied. */
function firedStage(state: TriggerState, outcomes: Readonly<Record<EapStage, StageOutcome>>): EapStage | null {
  for (const stage of CANDIDATE_STAGES[state.state]) {
    if (!state.firedStages.includes(stage) && outcomes[stage].met) return stage;
  }
  return null;
}

function stateAfter(fired: EapStage | null, prior: TriggerState, readinessMet: boolean): EapState {
  if (fired === 'ACTIVATION') return 'ACTIVATED';
  if (fired === 'READINESS') return 'READINESS';
  // De-escalation: the readiness condition cleared before activation (ADR-034 §2 `READINESS→IDLE`).
  return prior.state === 'READINESS' && !readinessMet ? 'IDLE' : prior.state;
}

/**
 * Evaluate one cycle of one protocol. Pure, clock-free, I/O-free.
 *
 * The result carries the ARITHMETIC that produced it — the counted members, the total, the threshold, the
 * comparator, the forecast version, the vintage and the lead time — because that single object is
 * simultaneously the panel's chart input, the ledger's evidence and the replay fixture (ADR-034 §3). One
 * artifact, three consumers, nothing restated.
 */
export function evaluateEapTriggers(input: EapEvaluationInput): TriggerEvaluation {
  const prior = input.priorState;
  // A STOPPED episode is terminal: it is not re-evaluated, it cannot fire, and it produces no transition.
  // Running again requires `beginEpisode` with a NEW episode id (an explicit new activation).
  if (prior.state === 'STOPPED') return noFire(input, 'STOPPED', 'EPISODE_STOPPED');
  const expired = durationStop(input);
  if (expired !== undefined) return expired;
  const forecast = input.forecast;
  if (forecast === undefined) return noFire(input, prior.state, 'NO_EVIDENCE');
  const cfg = input.forecastConfig ?? DEFAULT_FORECAST_TRIGGER_CONFIG;
  const refusal = vintageRefusal(forecast, prior, input.nowMs, cfg);
  if (refusal !== undefined) return noFire(input, prior.state, refusal);

  const outcomes: Readonly<Record<EapStage, StageOutcome>> = {
    READINESS: evaluateStage('READINESS', input, forecast),
    ACTIVATION: evaluateStage('ACTIVATION', input, forecast),
  };
  const fired = firedStage(prior, outcomes);
  const to = stateAfter(fired, prior, outcomes.READINESS.met);
  const concluded = outcomes[fired ?? nextRung(to)];
  // Every gate satisfied yet nothing fired ⇒ this rung is already behind us (edge de-dup, not a new fire).
  const stalled: TriggerOutcomeReason = concluded.met ? 'STAGE_ALREADY_FIRED' : concluded.reason;
  return definedOnly({
    eapId: input.eap.id,
    episodeId: prior.episodeId,
    from: prior.state,
    to,
    fired,
    reason: fired === null ? stalled : 'FIRED',
    evaluatedAt: new Date(input.nowMs).toISOString(),
    evidence: concluded.evidence,
    likelihood: concluded.likelihood,
    gate: concluded.gate,
    suggestedActionIds: suggestedActionIds(input.eap, fired),
  }) as TriggerEvaluation;
}
