// BEACON — Layer D: fail-closed guard immediately before a D6 payload serializes (ADR-035 §4;
// FR-D6-6/FU-18/FUW-8). "The type makes it impossible" is only true INSIDE the type system — the project's
// own lesson from F-79 (`src/adapters/alerting/alert-sink.ts:121`, where `emit` re-checks `asEmittable` at
// runtime immediately before serializing a CAP document, because a cast/DB-narrowed value/JS caller can
// reach the boundary without ever passing through the typed factory). This module is that same pattern
// applied to the D6 "no person-identifying field" boundary: the ONE place D6 data physically LEAVES the
// system needs a runtime re-check independent of the three build-time layers (A: tsc, B: schema walk,
// C: factory-output walk — all in `src/domain/shared/aggregate-only.ts` / `tests/architecture/d6-no-pii.test.ts`).
//
// `buildIncidentSummary` (FR-D6-4, ADR-035 §4 "the incident summary export") DOES NOT EXIST YET — no D6
// lane has built it. This guard is a STANDALONE, already-tested export that AWAITS ITS CALL SITE: whoever
// builds `buildIncidentSummary` must call `guardAggregateOnly(payload)` immediately before returning or
// serializing the summary and propagate the error branch rather than the payload, exactly as
// `alert-sink.ts:121` calls `asEmittable` immediately before `alertToCap` and returns `CONFLICT` rather than
// emitting. Do NOT stub a fake `buildIncidentSummary` here — that would misrepresent D6-4 as built.
import {
  findPersonIdentifyingRuntimeKeys,
  type DenylistWalkOptions,
} from '@/domain/shared/aggregate-only.js';
import type { Result } from '@/domain/shared/result.js';
import { ok, err } from '@/domain/shared/result.js';

export interface PersonIdentifyingFieldError {
  readonly code: 'PII_FIELD_FOUND';
  /** Dot/bracket paths into the payload, e.g. `"team.callsign"`, `"reports[2].reporterId"`. */
  readonly keys: readonly string[];
}

/**
 * Fail-closed pre-serialization gate. Returns the payload UNCHANGED (`ok`) only when no key anywhere in its
 * object graph is person-identifying by the shared denylist (`src/domain/shared/aggregate-only.ts`);
 * otherwise a typed, actionable error listing every offending path. A caller MUST treat the error branch as
 * terminal — log/report it, never serialize or export the value (Art. XIV: aggregate-only, no PII beyond
 * the incident lifecycle).
 */
export function guardAggregateOnly<T>(
  payload: T,
  opts: DenylistWalkOptions = {},
): Result<T, PersonIdentifyingFieldError> {
  const keys = findPersonIdentifyingRuntimeKeys(payload, opts);
  return keys.length === 0 ? ok(payload) : err({ code: 'PII_FIELD_FOUND', keys });
}
