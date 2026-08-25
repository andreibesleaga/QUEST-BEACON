// BEACON — DRILL recorder (MW-D/D4; ADR-034 §7 Layer 2, FR-GOV-3 / FOP-4).
//
// Where an EXERCISE artifact goes INSTEAD of a channel. It records the artifact and appends a
// `DRILL_ARTIFACT` link to the governance ledger, and that is all it can do:
//  • it accepts `DrillAlert`, which is NOT assignable to `EmittableAlert`, so it can never be handed a real
//    approved alert and `AlertSinkPort.emit` can never be handed an exercise (both directions fail `tsc`);
//  • it imports nothing from `src/adapters/channels/**` — enforced by the `.dependency-cruiser.cjs` rule
//    `drill-never-reaches-a-live-channel` and asserted on the module graph by
//    `tests/architecture/drill-isolation.test.ts`;
//  • it performs no I/O of any kind. There is no `fetch`, no transport and no socket in this file's
//    reachable graph, which is why the architecture test's throwing-`fetch` spy is never called.
//
// `sink: 'DRILL_RECORDER'` is honest labelling in the same spirit as `alert-sink.ts`'s `sink: 'MOCK'`: the
// record states what actually happened rather than implying a delivery.
import type { DrillAlert } from '@/domain/drill.js';
import { EXERCISE_LABEL, isDrillArtifact } from '@/domain/drill.js';
import { DomainError } from '@/domain/errors.js';
import type { Result } from '@/domain/shared/result.js';
import { err, ok } from '@/domain/shared/result.js';
import type { DrillRecord, DrillRecorderPort, GovernanceLedgerPort } from '@/ports/governance.js';

export interface DrillRecorderDeps {
  readonly ledger: GovernanceLedgerPort;
}

export interface DrillRecorder extends DrillRecorderPort {
  readonly records: readonly DrillRecord[];
}

/** Build the drill recorder. Append-only: records are never updated or removed. */
export function makeDrillRecorder(deps: DrillRecorderDeps): DrillRecorder {
  const records: DrillRecord[] = [];

  function record(artifact: DrillAlert, at: string): Result<DrillRecord, DomainError> {
    // Fail-closed re-check of the type-level guarantee, mirroring `makeAlertSink.emit`'s posture (F-79):
    // the compiler already makes a non-exercise value unpassable, but a cast or a JS caller must not be able
    // to route a REAL alert into the exercise recorder, where it would be recorded as a drill and dropped.
    if (!isDrillArtifact(artifact)) {
      return err(
        new DomainError(
          'CONFLICT',
          `drill recorder refused ${String(artifact.id)}: cap_status must be EXERCISE (ADR-034 §7)`,
        ),
      );
    }
    const appended = deps.ledger.append({
      action: 'DRILL_ARTIFACT',
      target: `alert:${String(artifact.id)}`,
      at,
      incidentId: artifact.incidentId,
      ...(artifact.exerciseApprovedBy !== undefined ? { actorId: artifact.exerciseApprovedBy } : {}),
      evidence: {
        alertId: String(artifact.id),
        capStatus: artifact.capStatus,
        category: artifact.category,
        severity: artifact.severity,
        edxlKind: artifact.edxlKind,
        exercise: true,
        label: EXERCISE_LABEL,
      },
    });
    if (!appended.ok) return appended;
    const recorded: DrillRecord = {
      alertId: String(artifact.id),
      capStatus: 'EXERCISE',
      label: artifact.label,
      recordedAt: at,
      ledgerHash: appended.value.hash,
      sink: 'DRILL_RECORDER',
    };
    records.push(recorded);
    return ok(recorded);
  }

  return {
    record,
    get records(): readonly DrillRecord[] {
      return records;
    },
  };
}
