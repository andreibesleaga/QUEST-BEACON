// BEACON — the anticipatory-action ENGINE: one cycle of one protocol (D2; ADR-034 §2/§4/§5/§6,
// FR-AA-3/FR-AA-4, FEV-10, FR-GOV-1/FR-GOV-2).
//
// It composes four things that already exist and adds no fifth: the pure evaluator (`trigger-evaluator.ts`),
// the protocol state machine (`@/domain/early-action-protocol.js`), the EXISTING pre-positioning suggester
// (`suggestPrePositioning`, `@/application/pre-positioning/pre-positioning.js`) and lane D4's governance
// vocabulary (`@/domain/governance.js` + `@/ports/governance.js`).
//
// ══ WHY THIS ENGINE CANNOT ACT (Art. XIII, structurally — not by convention) ════════════════════════════
//  1. It is a PURE FUNCTION over values. It holds no `AlertSinkPort`, no `ResourceLogisticsPort`, no
//     `GovernanceLedgerPort` — it RETURNS `LedgerAppendInput[]` for a caller to write. There is no writer to
//     misuse, so "the engine emitted/tasked something" is not a reachable state.
//  2. The only port it touches is `SpatialPort`, through `suggestPrePositioning`, which is a pure RANKING
//     function returning `PrePositioningSuggestion[]`. There is no code path from it to
//     `ResourceLogisticsPort.task`, and `src/application/**` cannot import an adapter at all
//     (`.dependency-cruiser.cjs` `application-no-adapters`, severity error).
//  3. `ANTICIPATORY_CANNOT_EMIT` below is a TYPE-LEVEL assertion, checked by `tsc`: if any field of
//     `AnticipatoryCycleOutcome` ever became assignable to `EmittableAlert` (`@/ports/logistics.js` — the
//     existing `'ACTUAL'`-literal + approver gate that `AlertSinkPort.emit` demands), the declaration below
//     stops compiling. The guarantee reuses the project's existing HITL gate rather than a parallel one, so
//     it cannot drift away from the real emit path.
//  4. Every suggestion carries `requiresApproval: true` as a LITERAL type and the roles that must approve, so
//     a consumer cannot render one as a decision without discarding type information.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
import type { EarlyActionProtocol, TriggerState } from '@/domain/early-action-protocol.js';
import {
  expireEpisode,
  recordForecastVintage,
  recordStageFired,
  transitionEap,
} from '@/domain/early-action-protocol.js';
import type { ApprovalAttempt, ApprovalOutcome, ApproverRole } from '@/domain/governance.js';
import { resolveApproval } from '@/domain/governance.js';
import type { TriggerEvaluation } from '@/domain/trigger-evaluation.js';
import { eapLedgerTarget } from '@/domain/trigger-evaluation.js';
import type { ResourceKind } from '@/domain/resource.js';
import type { DomainError } from '@/domain/errors.js';
import type { Result } from '@/domain/shared/result.js';
import { isErr, ok } from '@/domain/shared/result.js';
import type { EmittableAlert } from '@/ports/logistics.js';
import type { LedgerAppendInput } from '@/ports/governance.js';
import type { SpatialPort } from '@/ports/index.js';
import type {
  PrePositioningCandidates,
  PrePositioningResult,
  PrePositioningSuggestion,
} from '@/application/pre-positioning/pre-positioning.js';
import { suggestPrePositioning } from '@/application/pre-positioning/pre-positioning.js';
import type { EapEvaluationInput, TriggerForecast } from './trigger-evaluator.js';
import { evaluateEapTriggers } from './trigger-evaluator.js';

/**
 * A pre-positioning suggestion annotated with the pre-agreed EAP actions it would satisfy. `requiresApproval`
 * is the literal `true`: there is no value of this type that says otherwise.
 */
export interface AnticipatorySuggestion extends PrePositioningSuggestion {
  /** Ids from `eap.actions` this candidate would satisfy. Empty is possible and is not an error. */
  readonly satisfiesActionIds: readonly string[];
  readonly requiresApproval: true;
  /** Who may approve acting on it right now (the SOP chain, including a delegated fallback). */
  readonly authorizerRoles: readonly ApproverRole[];
}

/** What the pre-arranged ceiling did to the ranked list — stated, never silently applied. */
export interface CeilingApplication {
  readonly maxResources: number;
  readonly kept: number;
  /** Candidates dropped because the pre-arranged ceiling was reached (not because they were unsuitable). */
  readonly droppedByCeiling: number;
}

export interface AnticipatoryCycleInput extends EapEvaluationInput {
  /** Resource/shelter registry to rank. Absent ⇒ no suggestions (a labeled "not yet", never a faked one). */
  readonly candidates?: PrePositioningCandidates;
  /** Forwarded to `suggestPrePositioning`; its own documented default applies when absent. */
  readonly nearRadiusMeters?: number;
  /** A recorded human approval attempt, if one has been made this cycle (D4's SOP chain resolves it). */
  readonly approvalAttempt?: ApprovalAttempt;
}

export interface AnticipatoryCycleOutcome {
  readonly evaluation: TriggerEvaluation;
  /** The state AFTER the cycle. Produced only by the domain state machine, never assembled here. */
  readonly state: TriggerState;
  /** The suggester's own method label + `extentAvailable`, carried so a surface cannot show an unlabeled list. */
  readonly prePositioning?: PrePositioningResult;
  readonly suggestions: readonly AnticipatorySuggestion[];
  readonly ceiling?: CeilingApplication;
  /** Governance records to append. The engine WRITES NOTHING — see the header. */
  readonly ledger: readonly LedgerAppendInput[];
  /** Who must approve, per D4's SOP chain applied to `eap.approval`. Never `APPROVED` without a human. */
  readonly approval: ApprovalOutcome;
}

/**
 * `true` iff no field of `AnticipatoryCycleOutcome` is assignable to `EmittableAlert`. Evaluates to `never`
 * (and therefore fails `tsc`) the moment that stops holding — see header point 3.
 */
type NoEmittableField<T> = [Extract<T[keyof T], EmittableAlert>] extends [never] ? true : never;

/** THE GUARANTEE. Asserted at compile time here and read back by a test so its meaning stays visible. */
export const ANTICIPATORY_CANNOT_EMIT: NoEmittableField<AnticipatoryCycleOutcome> = true;

/**
 * Apply an evaluation to the prior state using ONLY the domain state machine. A STOPPED outcome routes
 * through `expireEpisode` (the duration-enforced stop) — a human stop is `stopEpisode`, which is a separate,
 * explicitly-authorized call and never something an evaluation cycle performs on its own.
 */
function applyEvaluation(prior: TriggerState, evaluation: TriggerEvaluation): TriggerState {
  const at = evaluation.evaluatedAt;
  let next = prior;
  if (evaluation.to !== prior.state) {
    next =
      evaluation.to === 'STOPPED'
        ? expireEpisode(prior, at)
        : transitionEap(prior, evaluation.to, at);
  }
  if (evaluation.fired !== null) next = recordStageFired(next, evaluation.fired);
  const issuedAt = evaluation.evidence?.issuedAt;
  // Only a reading that PASSED the vintage gate advances the high-water mark: recording a future or stale
  // vintage would let one bad timestamp buy unlimited freshness (the guard C2.4 already documents).
  return issuedAt === undefined ? next : recordForecastVintage(next, issuedAt);
}

/**
 * The action ids a ranked candidate would satisfy. A RESOURCE matches PREPOSITION actions declaring its kind;
 * a SHELTER is a DESTINATION, so it matches every PREPOSITION action (a cache is pre-positioned AT a
 * shelter). `TASK` actions are deliberately never matched: tasking is not pre-positioning and requires a
 * human acting against a VERIFIED incident.
 */
function satisfiedActions(
  eap: EarlyActionProtocol,
  suggestion: PrePositioningSuggestion,
): readonly string[] {
  return eap.actions
    .filter(
      (a) =>
        a.kind === 'PREPOSITION' &&
        (suggestion.kind === 'SHELTER' || a.resourceKind === suggestion.resourceKind),
    )
    .map((a) => a.id);
}

/**
 * Enforce the PRE-ARRANGED ceiling on the ranked list: at most `maxResources` in total and at most
 * `maxByKind[k]` of any resource kind. Applied in rank order, so what survives is the best-ranked subset the
 * protocol actually pre-arranged — and what was dropped is REPORTED, because a silently shortened list looks
 * like "there is nothing else nearby".
 */
function applyCeiling(
  suggestions: readonly PrePositioningSuggestion[],
  eap: EarlyActionProtocol,
): { readonly kept: readonly PrePositioningSuggestion[]; readonly ceiling: CeilingApplication } {
  const { maxResources, maxByKind } = eap.resourceCeiling;
  const perKind = new Map<string, number>();
  const kept: PrePositioningSuggestion[] = [];
  for (const suggestion of suggestions) {
    if (kept.length >= maxResources) break;
    const kind = suggestion.resourceKind;
    const cap = kind === undefined ? undefined : maxByKind?.[kind as ResourceKind];
    const used = kind === undefined ? 0 : (perKind.get(kind) ?? 0);
    if (cap !== undefined && used >= cap) continue;
    if (kind !== undefined) perKind.set(kind, used + 1);
    kept.push(suggestion);
  }
  return {
    kept,
    ceiling: {
      maxResources,
      kept: kept.length,
      droppedByCeiling: suggestions.length - kept.length,
    },
  };
}

interface SuggestionBundle {
  readonly prePositioning: PrePositioningResult;
  readonly suggestions: readonly AnticipatorySuggestion[];
  readonly ceiling: CeilingApplication;
}

/**
 * Rank the registry against the EAP's own scope geometry using the EXISTING suggester. The extent handed in
 * is `eap.scope.geometry` — the protocol's pre-agreed geographic scope (ADR-034 §4's exact receiving seam).
 */
function buildSuggestions(
  input: AnticipatoryCycleInput,
  candidates: PrePositioningCandidates,
  spatial: SpatialPort,
  roles: readonly ApproverRole[],
): Result<SuggestionBundle, DomainError> {
  const ranked = suggestPrePositioning(
    {
      candidates,
      extent: input.eap.scope.geometry,
      ...(input.nearRadiusMeters === undefined ? {} : { nearRadiusMeters: input.nearRadiusMeters }),
    },
    spatial,
  );
  if (isErr(ranked)) return ranked;
  const capped = applyCeiling(ranked.value.suggestions, input.eap);
  return ok({
    prePositioning: ranked.value,
    ceiling: capped.ceiling,
    suggestions: capped.kept.map((s) => ({
      ...s,
      satisfiesActionIds: satisfiedActions(input.eap, s),
      requiresApproval: true as const,
      authorizerRoles: roles,
    })),
  });
}

/** The roles that may approve right now, from D4's SOP chain applied to the EAP's own approval block. */
function approvalOutcome(
  input: AnticipatoryCycleInput,
  state: TriggerState,
  evaluatedAt: string,
): ApprovalOutcome {
  return resolveApproval(input.eap.approval, state.enteredAt, evaluatedAt, input.approvalAttempt);
}

function pendingRoles(approval: ApprovalOutcome): readonly ApproverRole[] {
  return approval.state === 'PENDING'
    ? approval.responsibleRoles
    : [approval.approval.approvedByRole];
}

/**
 * The governance records this cycle produces (FR-GOV-1 / FEV-19). `EAP_EVAL` carries the FULL evaluation as
 * its evidence, so the ledger's digest content-addresses exactly the object the panel and the replay fixture
 * use — the same bytes, or the digest does not match.
 */
function ledgerFor(
  input: AnticipatoryCycleInput,
  evaluation: TriggerEvaluation,
): readonly LedgerAppendInput[] {
  const target = eapLedgerTarget(evaluation.eapId, evaluation.episodeId);
  const base = { target, at: evaluation.evaluatedAt, regionId: input.eap.scope.regionId } as const;
  const entries: LedgerAppendInput[] = [{ ...base, action: 'EAP_EVAL', evidence: evaluation }];
  if (evaluation.to !== evaluation.from) {
    entries.push({
      ...base,
      action: 'EAP_TRANSITION',
      evidence: { from: evaluation.from, to: evaluation.to, reason: evaluation.reason },
    });
  }
  if (evaluation.fired === 'ACTIVATION') {
    entries.push({
      ...base,
      action: 'EAP_ACTIVATE',
      evidence: {
        gate: evaluation.gate,
        evidence: evaluation.evidence,
        suggestedActionIds: evaluation.suggestedActionIds,
      },
    });
  }
  if (evaluation.stop !== undefined) {
    entries.push({
      ...base,
      action: 'EAP_STOP',
      actorRole: evaluation.stop.authorizerRole,
      evidence: evaluation.stop,
    });
  }
  return entries;
}

/**
 * Run one evaluation cycle: evaluate → transition → suggest → record. Deterministic and clock-free (`nowMs`
 * is injected all the way down), so replaying the same event sequence reproduces the same state, the same
 * suggestions and the same ledger inputs byte-for-byte.
 *
 * Suggestions are produced only while the protocol is ACTIVATED and only when a registry AND a `SpatialPort`
 * are supplied; otherwise `suggestions` is empty and `prePositioning` is absent — a labeled "not yet"
 * (Art. XVI), never an invented list.
 */
export function runAnticipatoryCycle(
  input: AnticipatoryCycleInput,
  spatial?: SpatialPort,
): Result<AnticipatoryCycleOutcome, DomainError> {
  const evaluation = evaluateEapTriggers(input);
  const state = applyEvaluation(input.priorState, evaluation);
  const approval = approvalOutcome(input, state, evaluation.evaluatedAt);
  const ledger = ledgerFor(input, evaluation);
  const { candidates } = input;
  if (state.state !== 'ACTIVATED' || candidates === undefined || spatial === undefined) {
    return ok({ evaluation, state, suggestions: [], ledger, approval });
  }
  const bundle = buildSuggestions(input, candidates, spatial, pendingRoles(approval));
  if (isErr(bundle)) return bundle;
  return ok({
    evaluation,
    state,
    prePositioning: bundle.value.prePositioning,
    suggestions: bundle.value.suggestions,
    ceiling: bundle.value.ceiling,
    ledger,
    approval,
  });
}

export type { TriggerForecast };
