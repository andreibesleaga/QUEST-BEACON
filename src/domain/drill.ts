// BEACON — DRILL (exercise) artifacts (MW-D/D4; ADR-034 §7, FR-GOV-3 / FOP-4 / FUW-7).
// Pure TS — no framework/HTTP/DB imports (F9).
//
// LAYER 1 OF THE THREE-LAYER DRILL GUARANTEE, and it is a TYPE, not a runtime `if`.
// `EmittableAlert` (`src/ports/logistics.ts:41-44`) requires the `'ACTUAL'` literal plus an approver, so a
// value whose `capStatus` is `'EXERCISE'` is not assignable to it and `AlertSinkPort.emit(exercise)` is a
// `tsc --noEmit` error (Gate 2). At runtime the SAME guard the HITL path already uses catches it:
// `asEmittable` returns null for anything that is not ACTUAL, and `makeAlertSink.emit` re-checks
// `asEmittable` before ANY serialization or audit append (`src/adapters/alerting/alert-sink.ts:79`, the
// F-79 fix) — so an EXERCISE artifact forced through by a cast is rejected with a typed CONFLICT and is
// never serialized and never recorded as an emission. That guard is REUSED here, never duplicated.
//
// WHY `DrillAlert` IS NOT `Alert & { capStatus: 'EXERCISE' }`:
// ADR-034 §7 proposed widening `CAP_STATUSES` (`./alert.ts:9`) with `EXERCISE`. That file belongs to a
// concurrent lane (D3, CAP lifecycle) so this lane did not touch it — and on inspection the narrower
// mechanism is the STRONGER one: keeping `EXERCISE` out of `CapStatus` means an exercise artifact is not an
// `Alert` at all, so it cannot flow into ANY existing Alert-typed function (store, mapper, projection)
// merely because that function forgot a new enum member. Widening the shared enum would have made every
// `Alert` consumer silently accept an exercise value. Cost, stated honestly: the exercise artifact does not
// traverse the real CAP serializer, because `cap-mapper.ts`'s `CapStatusValue` cannot express `Exercise`
// until that same D3-owned widening lands (see the D4 report, F-131).
import type { Alert, AlertCategory, AlertSeverity, EdxlKind } from './alert.js';
import { makeAlert } from './alert.js';
import type { AlertId, AppUserId, IncidentId } from './value-objects/ids.js';
import type { Geometry } from './value-objects/geo.js';

/** The prefix every exercise-labelled human-readable artifact carries (FOP-4). Never translated. */
export const EXERCISE_LABEL = 'EXERCISE — NOT A REAL EMERGENCY';

/** The exercise-mode vocabulary. Owned by the domain so config, env and composition share ONE spelling. */
export const DRILL_MODES = ['off', 'on'] as const;
export type DrillMode = (typeof DRILL_MODES)[number];

/** CAP v1.2 `status` value an exercise artifact would carry if it were ever serialized (informational). */
export const EXERCISE_CAP_STATUS = 'EXERCISE' as const;

/**
 * A drill artifact. Structurally an Alert EXCEPT for the two fields the emit gate reads:
 *  - `capStatus: 'EXERCISE'` — disjoint from `'ACTUAL'`, so `emit(drill)` does not compile;
 *  - `approvedBy?: undefined` — the property is uninhabited by any `AppUserId`, so even
 *    `{ ...drill, capStatus: 'ACTUAL' }` cannot produce an `EmittableAlert` (the same trick `DraftAlert`
 *    uses, `./alert.ts:42-45`). Who approved the EXERCISE is recorded in `exerciseApprovedBy`, which no
 *    emit path reads.
 */
export type DrillAlert = Omit<Alert, 'capStatus' | 'approvedBy'> & {
  readonly capStatus: typeof EXERCISE_CAP_STATUS;
  readonly approvedBy?: undefined;
  readonly exercise: true;
  readonly label: string;
  readonly exerciseApprovedBy?: AppUserId;
  readonly exerciseApprovedByRole?: string;
};

export interface MakeDrillAlertInput {
  readonly id: AlertId;
  readonly incidentId: IncidentId;
  readonly category: AlertCategory;
  readonly severity: AlertSeverity;
  readonly area?: Geometry;
  readonly edxlKind?: EdxlKind;
  /** ISO-8601 UTC from the INJECTED clock — a drill is replayable, so it never reads a wall clock. */
  readonly at: string;
  readonly exerciseApprovedBy?: AppUserId;
  readonly exerciseApprovedByRole?: string;
}

/**
 * Construct a drill artifact. Every `Alert` invariant is enforced by delegating to `makeAlert` (category,
 * severity, edxlKind, incidentId) — the exercise artifact is held to the same validity bar as a real one, so
 * a drill exercises the real rules. The DRAFT status it is built with is then replaced by `EXERCISE`.
 */
export function makeDrillAlert(input: MakeDrillAlertInput): DrillAlert {
  // Validate against EVERY real Alert invariant by building one. The validated value is then read field by
  // field rather than spread, so the exercise artifact cannot inherit `approvedBy` — the one field the emit
  // gate reads — even if `makeAlert` ever started defaulting it.
  const validated = makeAlert({
    id: input.id,
    incidentId: input.incidentId,
    category: input.category,
    severity: input.severity,
    capStatus: 'DRAFT',
    sentAt: input.at,
    ...(input.area !== undefined ? { area: input.area } : {}),
    ...(input.edxlKind !== undefined ? { edxlKind: input.edxlKind } : {}),
  });
  return Object.freeze({
    id: validated.id,
    incidentId: validated.incidentId,
    category: validated.category,
    severity: validated.severity,
    edxlKind: validated.edxlKind,
    sentAt: input.at,
    capStatus: EXERCISE_CAP_STATUS,
    exercise: true,
    label: EXERCISE_LABEL,
    ...(validated.area !== undefined ? { area: validated.area } : {}),
    ...(input.exerciseApprovedBy !== undefined
      ? { exerciseApprovedBy: input.exerciseApprovedBy }
      : {}),
    ...(input.exerciseApprovedByRole !== undefined
      ? { exerciseApprovedByRole: input.exerciseApprovedByRole }
      : {}),
  });
}

/** Runtime tell for an exercise artifact (for JS callers / boundary reads; the type is the real guard). */
export function isDrillArtifact(value: { readonly capStatus?: unknown }): boolean {
  return value.capStatus === EXERCISE_CAP_STATUS;
}

/** Prefix a human-readable exercise document so no reader can mistake it for a real emergency (FOP-4). */
export function exerciseLabelled(text: string): string {
  return `${EXERCISE_LABEL} — ${text}`;
}
