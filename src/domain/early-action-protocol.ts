// BEACON — EARLY_ACTION_PROTOCOL entity + its per-episode state machine (D2; ADR-034 §1/§2/§6,
// FR-AA-1/FR-AA-3, FST-3/FST-4). Pure TS — no framework/HTTP/DB imports (F9), no clock read (every entry
// point takes an injected instant).
//
// An EAP is the IFRC Early Action Protocol structure as a validated value object: a two-stage trigger, a
// pre-agreed action list, a pre-arranged resource ceiling, an approval (roles) block, a geographic scope and
// a STOP mechanism. The STOP block is REQUIRED by the type and by `schemas/eap.schema.json` — an EAP that
// cannot be stopped is the dangerous case, so there is no way to construct one.
//
// The state machine follows the `public-report.ts` pattern (explicit adjacency map + documented terminal
// states). Per ADR-034 finding 4 the transition HISTORY is NOT kept on the aggregate: it is recorded as
// ledger entries (see `trigger-evaluation.ts`), because an entity-local array is not tamper-evident.
import type { Geometry, PolygonGeometry } from './value-objects/geo.js';
import type { AppUserRole } from './app-user.js';
import { roleRank } from './app-user.js';
import type { ApproverRole, SopChainConfig } from './governance.js';
import { APPROVER_ROLES, assertValidSopChain, isApproverRole } from './governance.js';
import type { LikelihoodClass } from './prediction.js';
import { LIKELIHOOD_CLASSES, likelihoodClassRank } from './prediction.js';
import type { ResourceKind } from './resource.js';
import { RESOURCE_KINDS } from './resource.js';
import { InvalidTransition, Unauthorized } from './errors.js';
import { invariant, definedOnly } from './shared/guard.js';

const MS_PER_HOUR = 3_600_000;

/** Hazards an EAP may be written for. Mirrors the closed enum in `schemas/eap.schema.json`. */
export const EAP_HAZARDS = ['FLOOD', 'WILDFIRE', 'STORM'] as const;
export type EapHazard = (typeof EAP_HAZARDS)[number];

/** The two IFRC trigger stages: READINESS is the longer-lead stage, ACTIVATION the shorter-lead one. */
export const EAP_STAGES = ['READINESS', 'ACTIVATION'] as const;
export type EapStage = (typeof EAP_STAGES)[number];

export const EAP_ACTION_KINDS = ['PREPOSITION', 'TASK', 'NOTIFY_INTERNAL'] as const;
export type EapActionKind = (typeof EAP_ACTION_KINDS)[number];

export const EAP_COMPARATORS = ['GTE', 'LTE'] as const;
export type EapComparator = (typeof EAP_COMPARATORS)[number];

/**
 * Roles that may authorize or stop a protocol. NOT a new vocabulary: it is lane D4's `APPROVER_ROLES`
 * (`./governance.js` — `VERIFIER`/`EM`), reused verbatim so "who may approve" has exactly one definition in
 * the system. `PUBLIC` and `RESPONDER` are absent from the TYPE rather than rejected at runtime, so an
 * unauthenticated or non-approving principal cannot even be written into an EAP.
 */
export { APPROVER_ROLES as EAP_AUTHORIZER_ROLES } from './governance.js';
export type { ApproverRole as EapAuthorizerRole } from './governance.js';

/**
 * The only admissible protocol status. Every shipped EAP is a demonstration artifact; there is deliberately
 * no `ENDORSED` value, because endorsing a protocol is a National-Society / authority act that BEACON does
 * not perform and must not be able to claim (ADR-034 honest limitation 2).
 */
export const EAP_STATUSES = ['ILLUSTRATIVE'] as const;
export type EapStatus = (typeof EAP_STATUSES)[number];

/** Slug shape shared by every id inside an EAP. Keeps an id from ever looking like a path segment. */
const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;

/** One stage of the two-stage trigger. Both magnitude gates are required so no stage can ship ungated. */
export interface EapTrigger {
  /** What supplies the forecast, stated verbatim from the config (never a URL — the schema forbids one). */
  readonly source: string;
  readonly parameter: string;
  readonly unit: string;
  /** The physical threshold a forecast member must cross, in `unit`. */
  readonly threshold: number;
  readonly comparator: EapComparator;
  /** Gate for ENSEMBLE_MEMBER_COUNT evidence: the share of members over `threshold` that must be reached. */
  readonly minMembersFraction: number;
  /** Gate for SOURCE_DERIVED_PROBABILITY evidence, expressed in the ADR-033 classes (never converted). */
  readonly minLikelihoodClass: LikelihoodClass;
  /** The stage's lead-time horizon in hours. A stage fires only when remaining lead time is within it. */
  readonly leadTimeHours: number;
}

export interface EapAction {
  readonly id: string;
  readonly label: string;
  readonly kind: EapActionKind;
  /** Required for PREPOSITION/TASK, forbidden for NOTIFY_INTERNAL (an internal brief moves no resource). */
  readonly resourceKind?: ResourceKind;
}

/** The pre-arranged ceiling. No monetary/donor field exists anywhere — see ADR-035 §4 PERMANENTLY-OUT. */
export interface EapResourceCeiling {
  readonly maxResources: number;
  readonly maxByKind?: Readonly<Partial<Record<ResourceKind, number>>>;
  readonly basis: string;
}

/**
 * Roles / activation mechanism. This IS lane D4's `SopChainConfig` (`./governance.js`), not a parallel copy:
 * `responsibleRoles`/`resolveApproval` therefore operate on an EAP's approval block unchanged, and
 * `assertValidSopChain` validates it (both roles approver-capable, fallback ≠ primary, positive window).
 */
export type EapApproval = SopChainConfig;

export interface EapScope {
  readonly regionId: string;
  /** A closed Polygon — the extent handed to `suggestPrePositioning` on activation. */
  readonly geometry: PolygonGeometry;
}

export interface EapStopCondition {
  readonly id: string;
  readonly label: string;
}

/** The STOP mechanism (required). `maxDurationHours` is the machine-enforceable half. */
export interface EapStop {
  readonly conditions: readonly EapStopCondition[];
  readonly authorizerRole: ApproverRole;
  readonly maxDurationHours: number;
}

export interface EarlyActionProtocol {
  readonly id: string;
  readonly label: string;
  readonly hazard: EapHazard;
  readonly status: EapStatus;
  /** The file's own honesty statement — carried into every surface that shows the protocol. */
  readonly provenance: string;
  readonly scope: EapScope;
  readonly triggers: Readonly<Record<Lowercase<EapStage>, EapTrigger>>;
  readonly actions: readonly EapAction[];
  readonly resourceCeiling: EapResourceCeiling;
  readonly approval: EapApproval;
  readonly stop: EapStop;
}

// ---- protocol state machine ---------------------------------------------------------------------------
export const EAP_STATES = ['IDLE', 'READINESS', 'ACTIVATED', 'STOPPED'] as const;
export type EapState = (typeof EAP_STATES)[number];

/**
 * Legal transitions (ADR-034 §2). `IDLE→ACTIVATED` is legal because a sudden-onset forecast can satisfy
 * both stages in one cycle; `READINESS→IDLE` is de-escalation when the readiness condition clears before
 * activation; **STOPPED is terminal for the episode** — it accepts nothing, not even another STOPPED, so a
 * stopped protocol cannot silently resume. Resuming requires `beginEpisode` with a NEW episode id.
 */
export const EAP_TRANSITIONS: Readonly<Record<EapState, readonly EapState[]>> = Object.freeze({
  IDLE: ['READINESS', 'ACTIVATED'],
  READINESS: ['ACTIVATED', 'STOPPED', 'IDLE'],
  ACTIVATED: ['STOPPED'],
  STOPPED: [],
});

/**
 * The per-episode runtime state. Deliberately small: current state + the edge/vintage bookkeeping the
 * evaluator needs to stay pure. History lives in the ledger (ADR-034 finding 4).
 */
export interface TriggerState {
  readonly eapId: string;
  readonly episodeId: string;
  readonly state: EapState;
  /** When the CURRENT state was entered (ISO-8601) — the anchor the fallback-approver clock runs from. */
  readonly enteredAt: string;
  /** Stages already fired in this episode (edge de-dup, mirroring `firedForEpisode` in ADR-014's engine). */
  readonly firedStages: readonly EapStage[];
  /** When ACTIVATED was entered — the anchor `stop.maxDurationHours` is measured from. */
  readonly activatedAt?: string;
  /** Newest forecast issue instant ever seen (ISO-8601); an older run is a superseded replay. */
  readonly latestForecastIssuedAt?: string;
  /** The declared stop-condition id that closed the episode. */
  readonly stopConditionId?: string;
  readonly stoppedByRole?: ApproverRole;
}

function assertIso(at: string, what: string): void {
  invariant(
    at.length > 0 && !Number.isNaN(Date.parse(at)),
    `${what} must be a valid ISO-8601 instant: ${at}`,
  );
}

function assertSlug(value: string, what: string): void {
  invariant(SLUG.test(value), `${what} must match ${String(SLUG)}, got '${value}'`);
}

function assertUniqueIds(ids: readonly string[], what: string): void {
  invariant(new Set(ids).size === ids.length, `${what} must have unique ids`);
}

function assertFraction(value: number, what: string): void {
  invariant(
    Number.isFinite(value) && value >= 0 && value <= 1,
    `${what} must be a number in [0,1], got ${value}`,
  );
}

function assertPositiveInt(value: number, what: string): void {
  invariant(Number.isInteger(value) && value >= 1, `${what} must be an integer >= 1, got ${value}`);
}

function assertClosedPolygon(geometry: Geometry, what: string): void {
  invariant(geometry.type === 'Polygon', `${what} must be a GeoJSON Polygon, got ${geometry.type}`);
  const ring = (geometry as PolygonGeometry).coordinates[0];
  invariant(
    ring !== undefined && ring.length >= 4,
    `${what} outer ring must have at least 4 positions`,
  );
  const first = ring[0] as readonly [number, number];
  const last = ring[ring.length - 1] as readonly [number, number];
  invariant(
    first[0] === last[0] && first[1] === last[1],
    `${what} outer ring must be closed (first = last)`,
  );
}

function assertTrigger(trigger: EapTrigger, what: string): void {
  invariant(
    EAP_COMPARATORS.includes(trigger.comparator),
    `${what}.comparator must be one of ${EAP_COMPARATORS.join('|')}`,
  );
  invariant(
    LIKELIHOOD_CLASSES.includes(trigger.minLikelihoodClass),
    `${what}.minLikelihoodClass must be one of ${LIKELIHOOD_CLASSES.join('|')}`,
  );
  invariant(Number.isFinite(trigger.threshold), `${what}.threshold must be a finite number`);
  assertFraction(trigger.minMembersFraction, `${what}.minMembersFraction`);
  invariant(
    Number.isFinite(trigger.leadTimeHours) && trigger.leadTimeHours > 0,
    `${what}.leadTimeHours must be a positive number of hours, got ${trigger.leadTimeHours}`,
  );
  for (const [field, value] of [
    ['source', trigger.source],
    ['parameter', trigger.parameter],
    ['unit', trigger.unit],
  ] as const) {
    invariant(value.trim().length > 0, `${what}.${field} must be a non-empty string`);
  }
}

/**
 * The two stages must describe ONE trigger on ONE parameter, and ACTIVATION must be at least as strict as
 * READINESS in all three dimensions (shorter lead, higher member share, at-least-as-likely class). This is
 * the property a JSON-Schema cannot state and the one an accidental config edit is most likely to invert —
 * and inverting it would let a protocol activate before it was ever ready.
 */
function assertStageLadder(readiness: EapTrigger, activation: EapTrigger): void {
  invariant(
    readiness.parameter === activation.parameter &&
      readiness.unit === activation.unit &&
      readiness.comparator === activation.comparator,
    'triggers.readiness and triggers.activation must describe the same parameter, unit and comparator',
  );
  invariant(
    activation.leadTimeHours <= readiness.leadTimeHours,
    `triggers.activation.leadTimeHours (${activation.leadTimeHours}) must not exceed triggers.readiness.leadTimeHours (${readiness.leadTimeHours})`,
  );
  invariant(
    activation.minMembersFraction >= readiness.minMembersFraction,
    'triggers.activation.minMembersFraction must be at least triggers.readiness.minMembersFraction',
  );
  invariant(
    likelihoodClassRank(activation.minLikelihoodClass) >=
      likelihoodClassRank(readiness.minLikelihoodClass),
    'triggers.activation.minLikelihoodClass must be at least as likely as triggers.readiness.minLikelihoodClass',
  );
}

function assertActions(actions: readonly EapAction[]): void {
  invariant(
    actions.length > 0,
    'EarlyActionProtocol.actions must declare at least one pre-agreed action',
  );
  assertUniqueIds(
    actions.map((a) => a.id),
    'EarlyActionProtocol.actions',
  );
  for (const action of actions) {
    assertSlug(action.id, `actions[${action.id}].id`);
    invariant(
      action.label.trim().length > 0,
      `actions[${action.id}].label must be a non-empty string`,
    );
    invariant(
      EAP_ACTION_KINDS.includes(action.kind),
      `actions[${action.id}].kind must be one of ${EAP_ACTION_KINDS.join('|')}`,
    );
    const needsKind = action.kind !== 'NOTIFY_INTERNAL';
    invariant(
      needsKind === (action.resourceKind !== undefined),
      `actions[${action.id}]: ${action.kind} ${needsKind ? 'requires' : 'must not declare'} a resourceKind`,
    );
    invariant(
      action.resourceKind === undefined || RESOURCE_KINDS.includes(action.resourceKind),
      `actions[${action.id}].resourceKind must be one of ${RESOURCE_KINDS.join('|')}`,
    );
  }
}

function assertCeiling(ceiling: EapResourceCeiling): void {
  assertPositiveInt(ceiling.maxResources, 'resourceCeiling.maxResources');
  invariant(
    ceiling.basis.trim().length > 0,
    'resourceCeiling.basis must state how the ceiling was arrived at',
  );
  for (const [kind, cap] of Object.entries(ceiling.maxByKind ?? {})) {
    invariant(
      RESOURCE_KINDS.includes(kind as ResourceKind),
      `resourceCeiling.maxByKind key must be a ResourceKind, got '${kind}'`,
    );
    assertPositiveInt(cap as number, `resourceCeiling.maxByKind.${kind}`);
    invariant(
      (cap as number) <= ceiling.maxResources,
      `resourceCeiling.maxByKind.${kind} (${String(cap)}) must not exceed maxResources (${ceiling.maxResources})`,
    );
  }
}

function assertStop(stop: EapStop): void {
  invariant(
    stop.conditions.length > 0,
    'stop.conditions must declare at least one stop condition (the STOP mechanism is required)',
  );
  assertUniqueIds(
    stop.conditions.map((c) => c.id),
    'stop.conditions',
  );
  for (const condition of stop.conditions) {
    assertSlug(condition.id, `stop.conditions[${condition.id}].id`);
    invariant(
      condition.label.trim().length > 0,
      `stop.conditions[${condition.id}].label must be a non-empty string`,
    );
  }
  invariant(
    isApproverRole(stop.authorizerRole),
    `stop.authorizerRole must be one of ${APPROVER_ROLES.join('|')}`,
  );
  assertPositiveInt(stop.maxDurationHours, 'stop.maxDurationHours');
}

/**
 * Construct an EAP, enforcing every invariant a JSON-Schema cannot express. Throws `InvariantViolation` —
 * a half-valid protocol is worse than none, because every activation it produces looks equally authoritative.
 */
export function makeEarlyActionProtocol(input: EarlyActionProtocol): EarlyActionProtocol {
  assertSlug(input.id, 'EarlyActionProtocol.id');
  invariant(input.label.trim().length > 0, 'EarlyActionProtocol.label must be a non-empty string');
  invariant(
    EAP_HAZARDS.includes(input.hazard),
    `EarlyActionProtocol.hazard must be one of ${EAP_HAZARDS.join('|')}`,
  );
  invariant(
    EAP_STATUSES.includes(input.status),
    `EarlyActionProtocol.status must be one of ${EAP_STATUSES.join('|')}`,
  );
  invariant(
    input.provenance.trim().length >= 80,
    'EarlyActionProtocol.provenance must state, in the protocol itself, what it is and is not endorsed by',
  );
  assertSlug(input.scope.regionId, 'scope.regionId');
  assertClosedPolygon(input.scope.geometry, 'scope.geometry');
  assertTrigger(input.triggers.readiness, 'triggers.readiness');
  assertTrigger(input.triggers.activation, 'triggers.activation');
  assertStageLadder(input.triggers.readiness, input.triggers.activation);
  assertActions(input.actions);
  assertCeiling(input.resourceCeiling);
  assertValidSopChain(input.approval, 'approval');
  assertStop(input.stop);
  return input;
}

/** The trigger for one stage. Pure lookup — keeps `'READINESS' → triggers.readiness` in one place. */
export function stageTrigger(eap: EarlyActionProtocol, stage: EapStage): EapTrigger {
  return stage === 'ACTIVATION' ? eap.triggers.activation : eap.triggers.readiness;
}

/**
 * Open a NEW episode at IDLE. This is the ONLY way a protocol run comes into being, and the only way a
 * stopped protocol ever runs again: the previous episode must be STOPPED (an open episode may not be
 * abandoned silently) and the new episode id must differ from it. That pairing is what makes "a stopped
 * protocol cannot re-activate without an explicit new activation" structural rather than conventional.
 */
export function beginEpisode(input: {
  readonly eapId: string;
  readonly episodeId: string;
  readonly at: string;
  readonly previous?: TriggerState;
}): TriggerState {
  assertSlug(input.eapId, 'TriggerState.eapId');
  assertSlug(input.episodeId, 'TriggerState.episodeId');
  assertIso(input.at, 'TriggerState.enteredAt');
  const previous = input.previous;
  if (previous !== undefined) {
    if (previous.state !== 'STOPPED') {
      throw new InvalidTransition(
        `EAP ${previous.eapId} episode ${previous.episodeId} is still open in state ${previous.state} — stop it before beginning a new episode`,
      );
    }
    if (previous.episodeId === input.episodeId) {
      throw new InvalidTransition(
        `EAP ${previous.eapId} episode ${previous.episodeId} is STOPPED and cannot be reopened under the same id`,
      );
    }
  }
  return {
    eapId: input.eapId,
    episodeId: input.episodeId,
    state: 'IDLE',
    enteredAt: input.at,
    firedStages: [],
  };
}

/**
 * Guard one transition against the adjacency map. Throws `InvalidTransition` on any illegal hop — including
 * every hop out of STOPPED, which is terminal for the episode.
 *
 * NOTE: reaching STOPPED through this function alone is not how the engine stops a protocol. A stop is
 * either human-authorized (`stopEpisode`, which validates the declared condition and the authorizer's rank)
 * or duration-enforced (`expireEpisode`). Both funnel through here, so the adjacency map stays the single
 * authority on legality.
 */
export function transitionEap(state: TriggerState, next: EapState, at: string): TriggerState {
  assertIso(at, 'transitionEap(at)');
  if (!EAP_TRANSITIONS[state.state].includes(next)) {
    throw new InvalidTransition(
      `EAP ${state.eapId} episode ${state.episodeId} cannot go ${state.state}→${next}`,
    );
  }
  return definedOnly({
    ...state,
    state: next,
    enteredAt: at,
    activatedAt: next === 'ACTIVATED' ? at : state.activatedAt,
    // Returning to IDLE ends the met-episode, so a stage may fire again on the next crossing — the same
    // semantics as `firedForEpisode` clearing when a threshold rule's condition clears (ADR-014). Without
    // this, one de-escalation would silently disarm the protocol for the rest of the episode.
    firedStages: next === 'IDLE' ? [] : state.firedStages,
  }) as TriggerState;
}

/** Record that a stage fired in this episode (edge de-dup: a stage fires at most once per episode). */
export function recordStageFired(state: TriggerState, stage: EapStage): TriggerState {
  return state.firedStages.includes(stage)
    ? state
    : { ...state, firedStages: [...state.firedStages, stage] };
}

/** Carry the newest forecast vintage forward. An older instant never overwrites a newer one. */
export function recordForecastVintage(state: TriggerState, issuedAt: string): TriggerState {
  const seen = state.latestForecastIssuedAt;
  if (seen !== undefined && Date.parse(issuedAt) <= Date.parse(seen)) return state;
  return { ...state, latestForecastIssuedAt: issuedAt };
}

export interface StopEpisodeInput {
  readonly conditionId: string;
  readonly actorRole: AppUserRole;
  readonly at: string;
}

/**
 * Stop an episode on a DECLARED condition, authorized by a role of at least `stop.authorizerRole`'s rank.
 * An undeclared condition id is an `InvariantViolation` (the stop reasons are pre-agreed data, not free
 * text); an under-ranked actor is `Unauthorized`. Both refusals happen BEFORE the transition, so a rejected
 * stop leaves the episode exactly as it was.
 */
export function stopEpisode(
  eap: EarlyActionProtocol,
  state: TriggerState,
  input: StopEpisodeInput,
): TriggerState {
  invariant(
    eap.stop.conditions.some((c) => c.id === input.conditionId),
    `stop condition '${input.conditionId}' is not declared by EAP ${eap.id} (declared: ${eap.stop.conditions.map((c) => c.id).join(', ')})`,
  );
  if (roleRank(input.actorRole) < roleRank(eap.stop.authorizerRole)) {
    throw new Unauthorized(
      `role ${input.actorRole} may not stop EAP ${eap.id} (requires ${eap.stop.authorizerRole} or above)`,
    );
  }
  const stopped = transitionEap(state, 'STOPPED', input.at);
  // Sound: the rank check above cannot pass for PUBLIC/RESPONDER, because stop.authorizerRole is an
  // ApproverRole (VERIFIER=2 or EM=3) and both of those rank strictly below it.
  return {
    ...stopped,
    stopConditionId: input.conditionId,
    stoppedByRole: input.actorRole as ApproverRole,
  };
}

/**
 * True when an ACTIVATED episode has run past `stop.maxDurationHours`. Pure clock arithmetic on the injected
 * instant — this is the machine-enforceable half of the STOP mechanism: an activation cannot outlive its
 * declared maximum duration even if nobody stops it.
 */
export function isDurationExpired(
  eap: EarlyActionProtocol,
  state: TriggerState,
  nowMs: number,
): boolean {
  if (state.state !== 'ACTIVATED' || state.activatedAt === undefined) return false;
  return nowMs - Date.parse(state.activatedAt) >= eap.stop.maxDurationHours * MS_PER_HOUR;
}

/**
 * The reserved condition id for a duration-enforced stop. It is NOT a declared config condition (a machine
 * stop is not a human judgement), and it is namespaced so it can never collide with a config slug.
 */
export const EAP_DURATION_STOP_ID = 'system-max-duration-elapsed';

/** Stop an episode because its declared maximum duration elapsed. No human authorizer is recorded. */
export function expireEpisode(state: TriggerState, at: string): TriggerState {
  return { ...transitionEap(state, 'STOPPED', at), stopConditionId: EAP_DURATION_STOP_ID };
}

// Who may approve an activation RIGHT NOW is NOT computed here: it is lane D4's `responsibleRoles` /
// `resolveApproval` (`./governance.js`) applied to `eap.approval`, which is a `SopChainConfig` by type. One
// delegation algebra, one place, one set of tests — the anticipatory engine calls it and adds nothing.
