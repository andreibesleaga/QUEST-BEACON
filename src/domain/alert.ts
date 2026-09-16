// BEACON — ALERT entity (E1·T-068/T-069). CAP/EDXL alert (DOMAIN_MODEL §5).
// Art. XIII: no ACTUAL alert without a human approver. Pure TS — no framework/HTTP/DB imports (F9).
import type { AlertId, AppUserId, IncidentId, ThresholdRuleId } from './value-objects/ids.js';
import type { Geometry } from './value-objects/geo.js';
import { InvariantViolation, InvalidTransition } from './errors.js';
import { invariant, definedOnly } from './shared/guard.js';

// Enums mirror schema.sql CHECK constraints exactly (alert).
export const CAP_STATUSES = ['DRAFT', 'ACTUAL'] as const;
export type CapStatus = (typeof CAP_STATUSES)[number];

export const ALERT_CATEGORIES = ['Fire', 'Met', 'Safety'] as const;
export type AlertCategory = (typeof ALERT_CATEGORIES)[number];

export const ALERT_SEVERITIES = ['MINOR', 'MODERATE', 'SEVERE', 'EXTREME'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const EDXL_KINDS = ['CAP', 'EDXL_RM', 'EDXL_SITREP'] as const;
export type EdxlKind = (typeof EDXL_KINDS)[number];

// ── CAP message lifecycle (ADR-036 §2; finding F-29) ──────────────────────────────────────────────
//
// Before this, `msgType` existed ONLY as a CAP boundary option defaulted to `Alert`, and the entity had no
// `references` — so an Update, a Cancel or an all-clear was literally unconstructible even though
// schemas/cap-v1.2.schema.json ALREADY requires `references` for msgType ∈ {Update, Cancel}. The lifecycle
// therefore had to become domain state, not a serializer flag.
//
// The tokens below are the DOMAIN spelling (SCREAMING_SNAKE, like every other domain enum here); the CAP
// wire spelling (`Alert`/`Update`/`Cancel`) is produced by the boundary mapper. `responseType`, `urgency`
// and `certainty` are the exception on purpose: those are CAP CLOSED VOCABULARIES that BEACON neither
// renames nor translates (Art. spec-delta §1.3), so the canonical token IS the CAP token.

/** CAP <msgType> subset BEACON originates. `Ack`/`Error` are protocol replies BEACON does not author. */
export const ALERT_MSG_TYPES = ['ALERT', 'UPDATE', 'CANCEL'] as const;
export type AlertMsgType = (typeof ALERT_MSG_TYPES)[number];

/** CAP <responseType> closed vocabulary (CAP v1.2 §3.2.2) — canonical tokens, never localized. */
export const ALERT_RESPONSE_TYPES = [
  'Shelter',
  'Evacuate',
  'Prepare',
  'Execute',
  'Avoid',
  'Monitor',
  'Assess',
  'AllClear',
  'None',
] as const;
export type AlertResponseType = (typeof ALERT_RESPONSE_TYPES)[number];

/** CAP <urgency> closed vocabulary. Was hardcoded to `Expected` in the mapper before ADR-036. */
export const ALERT_URGENCIES = ['Immediate', 'Expected', 'Future', 'Past', 'Unknown'] as const;
export type AlertUrgency = (typeof ALERT_URGENCIES)[number];

/** CAP <certainty> closed vocabulary. Was hardcoded to `Likely` in the mapper before ADR-036. */
export const ALERT_CERTAINTIES = ['Observed', 'Likely', 'Possible', 'Unlikely', 'Unknown'] as const;
export type AlertCertainty = (typeof ALERT_CERTAINTIES)[number];

/** The msgTypes CAP requires a `references` list for (schemas/cap-v1.2.schema.json allOf/if-then). */
const MSG_TYPES_REQUIRING_REFERENCES: readonly AlertMsgType[] = ['UPDATE', 'CANCEL'];

export interface Alert {
  readonly id: AlertId;
  readonly incidentId: IncidentId;
  readonly thresholdRuleId?: ThresholdRuleId; // rule that fired (EV6 traceability)
  readonly capStatus: CapStatus;
  readonly category: AlertCategory;
  readonly severity: AlertSeverity;
  readonly area?: Geometry;
  readonly edxlKind: EdxlKind;
  readonly sentAt?: string; // ISO-8601 UTC
  readonly approvedBy?: AppUserId; // Art. XIII — REQUIRED when capStatus=ACTUAL
  // ── CAP lifecycle + warning content (ADR-036 §2). ALL OPTIONAL: spec-delta §1.1 (additive only) — a
  // pre-ADR-036 Alert literal still type-checks, and an absent field maps to today's exact CAP output.
  /** Absent ⇒ `ALERT` (the pre-ADR-036 behaviour). UPDATE/CANCEL REQUIRE a non-empty `references`. */
  readonly msgType?: AlertMsgType;
  /** The identifier(s) of the earlier alert(s) this message updates or cancels (CAP <references>). */
  readonly references?: readonly AlertId[];
  readonly responseType?: readonly AlertResponseType[];
  readonly urgency?: AlertUrgency;
  readonly certainty?: AlertCertainty;
  /** Human-readable warning text (English source of record). Localized per `<info>` at the boundary. */
  readonly headline?: string;
  readonly description?: string;
  readonly instruction?: string;
}

/**
 * Type-level proof that an alert is a DRAFT and therefore NOT publishable (Art. XIII). The exact mirror of
 * `EmittableAlert` (`src/ports/logistics.ts`), which requires the `'ACTUAL'` literal plus an approver: the
 * two literal types are disjoint, so a `DraftAlert` is not assignable to `EmittableAlert` and
 * `AlertSinkPort.emit(draft)` is a `tsc` error rather than a runtime check. `approvedBy?: undefined`
 * additionally makes the property uninhabited by any AppUserId, so a DRAFT cannot be widened into an
 * approved alert by spreading an approver onto it — approval goes through `approveAlert` and a human.
 */
export type DraftAlert = Alert & {
  readonly capStatus: 'DRAFT';
  readonly approvedBy?: undefined;
};

export interface MakeAlertInput {
  readonly id: AlertId;
  readonly incidentId: IncidentId;
  readonly thresholdRuleId?: ThresholdRuleId;
  readonly capStatus?: CapStatus; // defaults to DRAFT (schema default)
  readonly category: AlertCategory;
  readonly severity: AlertSeverity;
  readonly area?: Geometry;
  readonly edxlKind?: EdxlKind; // defaults to CAP (schema default)
  readonly sentAt?: string;
  readonly approvedBy?: AppUserId;
  readonly msgType?: AlertMsgType;
  readonly references?: readonly AlertId[];
  readonly responseType?: readonly AlertResponseType[];
  readonly urgency?: AlertUrgency;
  readonly certainty?: AlertCertainty;
  readonly headline?: string;
  readonly description?: string;
  readonly instruction?: string;
}

/**
 * Validate the CAP-lifecycle half of the input (ADR-036 §2). Split out of `makeAlert` so the factory stays
 * inside the cyclomatic-complexity gate and so "what the lifecycle requires" is one readable block.
 *
 * The load-bearing rule is the LAST one: an UPDATE or a CANCEL without `references` is rejected HERE, at
 * authoring time with a sentence that names the missing input — rather than at emit time as an Ajv
 * `must have required property 'references'` from schemas/cap-v1.2.schema.json. Both gates exist; this one
 * is the helpful one, and it is the reason an all-clear cannot silently forget the alert it clears (ADR-036
 * §2, V3).
 */
function checkAlertLifecycle(input: MakeAlertInput): AlertMsgType {
  const msgType = input.msgType ?? 'ALERT';
  invariant(ALERT_MSG_TYPES.includes(msgType), `Alert.msgType invalid: ${String(msgType)}`);
  for (const rt of input.responseType ?? []) {
    invariant(ALERT_RESPONSE_TYPES.includes(rt), `Alert.responseType invalid: ${String(rt)}`);
  }
  invariant(
    input.urgency === undefined || ALERT_URGENCIES.includes(input.urgency),
    `Alert.urgency invalid: ${String(input.urgency)}`,
  );
  invariant(
    input.certainty === undefined || ALERT_CERTAINTIES.includes(input.certainty),
    `Alert.certainty invalid: ${String(input.certainty)}`,
  );
  invariant(
    !MSG_TYPES_REQUIRING_REFERENCES.includes(msgType) || (input.references ?? []).length > 0,
    `Alert.msgType=${msgType} requires references to the alert(s) it ${msgType === 'CANCEL' ? 'cancels' : 'updates'} (CAP v1.2 <references>)`,
  );
  return msgType;
}

/** Construct an Alert. Art. XIII / schema chk_alert_actual_approved: ACTUAL requires approvedBy. */
export function makeAlert(input: MakeAlertInput): Alert {
  invariant(input.incidentId, 'Alert.incidentId is required');
  invariant(
    ALERT_CATEGORIES.includes(input.category),
    `Alert.category invalid: ${String(input.category)}`,
  );
  invariant(
    ALERT_SEVERITIES.includes(input.severity),
    `Alert.severity invalid: ${String(input.severity)}`,
  );
  const capStatus = input.capStatus ?? 'DRAFT';
  invariant(CAP_STATUSES.includes(capStatus), `Alert.capStatus invalid: ${String(capStatus)}`);
  const edxlKind = input.edxlKind ?? 'CAP';
  invariant(EDXL_KINDS.includes(edxlKind), `Alert.edxlKind invalid: ${String(edxlKind)}`);
  // Art. XIII: an ACTUAL alert MUST be human-approved. DRAFT may exist without an approver.
  invariant(
    capStatus !== 'ACTUAL' || input.approvedBy,
    'Alert cannot be ACTUAL without approvedBy (Art. XIII)',
  );
  return definedOnly({
    id: input.id,
    incidentId: input.incidentId,
    capStatus,
    category: input.category,
    severity: input.severity,
    edxlKind,
    thresholdRuleId: input.thresholdRuleId,
    area: input.area,
    sentAt: input.sentAt,
    approvedBy: input.approvedBy,
    ...lifecycleFields(input, checkAlertLifecycle(input)),
  }) as Alert;
}

/** A copy of the list, or `undefined` when it is empty — so an absent list is absent, not `[]`. */
function nonEmpty<T>(items: readonly T[] | undefined): readonly T[] | undefined {
  return (items ?? []).length > 0 ? [...(items ?? [])] : undefined;
}

/**
 * The CAP-lifecycle half of the entity. `msgType` is written ONLY when it is not the ALERT default, so a
 * plain alert's persisted/serialized shape stays byte-identical to the pre-ADR-036 one (spec-delta §1.1 —
 * a v1 consumer sees no new field at all).
 */
function lifecycleFields(input: MakeAlertInput, msgType: AlertMsgType): Partial<Alert> {
  return {
    msgType: msgType === 'ALERT' ? undefined : msgType,
    references: nonEmpty(input.references) as readonly AlertId[] | undefined,
    responseType: nonEmpty(input.responseType) as readonly AlertResponseType[] | undefined,
    urgency: input.urgency,
    certainty: input.certainty,
    headline: input.headline,
    description: input.description,
    instruction: input.instruction,
  } as Partial<Alert>;
}

/** The msgType an alert carries, with the documented default made explicit for a reader/consumer. */
export function alertMsgType(alert: Alert): AlertMsgType {
  return alert.msgType ?? 'ALERT';
}

export interface FollowUpAlertInput {
  /** The identifier of the NEW message. A follow-up is a new alert, never a mutation of the original. */
  readonly id: AlertId;
  /** The already-emitted alert this message updates or cancels. Its identifier becomes `references[0]`. */
  readonly original: Alert;
  readonly msgType: 'UPDATE' | 'CANCEL';
  readonly severity?: AlertSeverity;
  readonly responseType?: readonly AlertResponseType[];
  readonly urgency?: AlertUrgency;
  readonly certainty?: AlertCertainty;
  readonly headline?: string;
  readonly description?: string;
  readonly instruction?: string;
}

/**
 * Build the follow-up (UPDATE / CANCEL) to an already-emitted alert.
 *
 * TWO things this function exists to make impossible:
 *
 * 1. **A forgotten reference.** `references` is derived from `original.id` and cannot be passed in, so the
 *    CAP conditional rule (`msgType ∈ {Update,Cancel} ⇒ references`, schemas/cap-v1.2.schema.json) is
 *    satisfied by construction instead of being discovered at emit time (ADR-036 §2).
 * 2. **A follow-up that skips the human.** The result is a **DRAFT** — `capStatus: 'DRAFT'` with
 *    `approvedBy` provably absent (`DraftAlert`), so it is unassignable to `EmittableAlert` and
 *    `AlertSinkPort.emit()` will not compile for it. A cancel and an all-clear are PUBLIC ACTIONS, so they
 *    travel the SAME `approveAlert` → HITL route → sink path as the original warning (Art. XIII).
 *    ADR-036 §2 sketches `buildAllClear(original, approver, now)`; taking an approver here would have let a
 *    caller mint a pre-approved public message, so the approver parameter is deliberately NOT accepted —
 *    the HITL gate stays the only way to reach ACTUAL.
 *
 * The original's `incidentId`, `category` and `area` are carried over: a cancel must describe the same
 * incident and the same footprint, or recipients cannot match it to the warning it clears. `severity`
 * defaults to the original's — an all-clear overrides it via ALL_CLEAR defaults below.
 */
export function buildFollowUpAlert(input: FollowUpAlertInput): DraftAlert {
  const { original } = input;
  if (original.capStatus !== 'ACTUAL') {
    throw new InvalidTransition(
      `Alert ${original.id} cannot be ${input.msgType === 'CANCEL' ? 'cancelled' : 'updated'}: only an emitted ACTUAL alert has been made public (was ${original.capStatus})`,
    );
  }
  return makeAlert(
    definedOnly({
      id: input.id,
      incidentId: original.incidentId,
      capStatus: 'DRAFT' as CapStatus,
      category: original.category,
      severity: input.severity ?? original.severity,
      edxlKind: original.edxlKind,
      msgType: input.msgType as AlertMsgType,
      references: [original.id],
      area: original.area,
      thresholdRuleId: original.thresholdRuleId,
      responseType: input.responseType,
      urgency: input.urgency,
      certainty: input.certainty,
      headline: input.headline,
      description: input.description,
      instruction: input.instruction,
    }) as MakeAlertInput,
  ) as DraftAlert;
}

/**
 * Build a first-class ALL-CLEAR for an emitted alert (ADR-036 §2; FR-WARN-2).
 *
 * CAP already expresses "it's over" and BEACON uses CAP's expression rather than inventing a status:
 * `msgType=CANCEL` + `responseType=['AllClear']` + `references=[original]`. `urgency: 'Past'` and
 * `certainty: 'Observed'` are the honest machine values for a hazard that has ENDED and been observed to
 * have ended; a caller may override them (e.g. an all-clear issued on a forecast rather than an
 * observation). Severity is deliberately NOT lowered to MINOR: the message still concerns a SEVERE event,
 * and rewriting the severity would misfile the message for every downstream consumer that routes on it.
 *
 * Returns a DRAFT — an all-clear is a public message and needs the same approver as the warning did.
 */
export function buildAllClear(
  input: Omit<FollowUpAlertInput, 'msgType' | 'responseType'>,
): DraftAlert {
  return buildFollowUpAlert({
    ...input,
    msgType: 'CANCEL',
    responseType: ['AllClear'],
    urgency: input.urgency ?? 'Past',
    certainty: input.certainty ?? 'Observed',
  });
}

/** True when this alert is an all-clear: a CANCEL/UPDATE carrying the CAP `AllClear` response type. */
export function isAllClear(alert: Alert): boolean {
  return (alert.responseType ?? []).includes('AllClear');
}

/** Approve a DRAFT alert into ACTUAL (DOMAIN_MODEL §5). Requires a human approver (Art. XIII). */
export function approveAlert(alert: Alert, approvedBy: AppUserId): Alert {
  if (alert.capStatus !== 'DRAFT') {
    throw new InvalidTransition(`Alert can only be approved from DRAFT, was ${alert.capStatus}`);
  }
  if (!approvedBy) {
    throw new InvariantViolation('Alert approval requires approvedBy (Art. XIII)');
  }
  return { ...alert, capStatus: 'ACTUAL', approvedBy };
}
