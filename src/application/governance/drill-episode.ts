// BEACON — DRILL episode use-case (MW-D/D4; ADR-034 §7, FR-GOV-3 / FOP-4).
// Pure: ports + domain only. Every instant comes from the injected clock, so a drill is REPLAYABLE — the
// same episode re-run against the same clock yields byte-identical ledger entries (which is also what makes
// it a repeatable on-camera demo, ADR-034 §7 "drill mode doubles as the demo engine").
//
// An episode goes: DRILL_START → build the EXERCISE artifact → run the real SOP approval chain →
// (only if a human approved) record the artifact with the drill recorder → DRILL_END. The artifact is a
// `DrillAlert`, which is not assignable to `EmittableAlert`, so there is no branch in this file — or in any
// file — where an exercise could be handed to `AlertSinkPort.emit`: it would not compile.
import type { Result } from '@/domain/shared/result.js';
import { ok } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { AlertCategory, AlertSeverity } from '@/domain/alert.js';
import type { DrillAlert } from '@/domain/drill.js';
import { makeDrillAlert } from '@/domain/drill.js';
import type { ApprovalAttempt, ApprovalOutcome, SopChainConfig } from '@/domain/governance.js';
// (ApprovalOutcome is used by the artifact helper below as well as by the episode result.)
import type { Geometry } from '@/domain/value-objects/geo.js';
import type { AlertId, IncidentId } from '@/domain/value-objects/ids.js';
import type { DrillRecord, DrillRecorderPort, GovernanceLedgerPort } from '@/ports/governance.js';
import { decideSopApproval } from './sop-chain.js';

export interface DrillEpisodeDeps {
  readonly ledger: GovernanceLedgerPort;
  readonly recorder: DrillRecorderPort;
  /** Injected clock — called once per governance step, never a wall-clock read. */
  readonly clock: () => string;
  readonly sopChain?: SopChainConfig;
}

export interface DrillEpisodeInput {
  readonly episodeId: string;
  readonly incidentId: IncidentId;
  readonly alertId: AlertId;
  readonly category: AlertCategory;
  readonly severity: AlertSeverity;
  readonly area?: Geometry;
  /** A human approval attempt for the exercise. Absent ⇒ the exercise ends with nothing recorded. */
  readonly approvalAttempt?: ApprovalAttempt;
}

export interface DrillEpisodeResult {
  readonly episodeId: string;
  readonly artifact: DrillAlert;
  readonly approval: ApprovalOutcome;
  /** Present only when a human approved the exercise — no approval, no artifact (Art. XIII, in a drill too). */
  readonly record?: DrillRecord;
  /** The chain links this episode appended, in order (DRILL_START … DRILL_END). */
  readonly ledgerHashes: readonly string[];
}

/** Build the EXERCISE artifact, carrying the approver only into the exercise-only fields. */
function artifactFor(input: DrillEpisodeInput, at: string, outcome: ApprovalOutcome): DrillAlert {
  return makeDrillAlert({
    id: input.alertId,
    incidentId: input.incidentId,
    category: input.category,
    severity: input.severity,
    at,
    ...(input.area !== undefined ? { area: input.area } : {}),
    ...(outcome.state === 'APPROVED'
      ? {
          exerciseApprovedBy: outcome.approval.approvedBy,
          exerciseApprovedByRole: outcome.approval.approvedByRole,
        }
      : {}),
  });
}

/** The chain links this episode appended, in order — approval and artifact links only when they happened. */
function hashesOf(
  startHash: string,
  approvalHash: string | undefined,
  recordHash: string | undefined,
  endHash: string,
): readonly string[] {
  return [
    startHash,
    ...(approvalHash !== undefined ? [approvalHash] : []),
    ...(recordHash !== undefined ? [recordHash] : []),
    endHash,
  ];
}

/** Run the REAL SOP approval chain for the exercise — a drill rehearses the actual approval, not a stub. */
function approveEpisode(
  deps: DrillEpisodeDeps,
  input: DrillEpisodeInput,
  target: string,
  requestedAt: string,
): ReturnType<typeof decideSopApproval> {
  return decideSopApproval(deps, {
    target,
    requestedAt,
    now: deps.clock(),
    incidentId: input.incidentId,
    ...(input.approvalAttempt !== undefined ? { attempt: input.approvalAttempt } : {}),
    ...(deps.sopChain !== undefined ? { config: deps.sopChain } : {}),
  });
}

/** Run a full exercise episode. Any governance-write failure fails the whole episode closed. */
export function runDrillEpisode(
  deps: DrillEpisodeDeps,
  input: DrillEpisodeInput,
): Result<DrillEpisodeResult, DomainError> {
  const target = `drill:${input.episodeId}`;
  const startedAt = deps.clock();
  const started = deps.ledger.append({
    action: 'DRILL_START',
    target,
    at: startedAt,
    incidentId: input.incidentId,
    evidence: { episodeId: input.episodeId, alertId: String(input.alertId), exercise: true },
  });
  if (!started.ok) return started;

  const approved = approveEpisode(deps, input, target, startedAt);
  if (!approved.ok) return approved;
  const outcome = approved.value.outcome;
  const artifact = artifactFor(input, startedAt, outcome);

  // No approval, no artifact — Art. XIII holds inside an exercise exactly as it does outside one.
  const recorded = outcome.state === 'APPROVED' ? deps.recorder.record(artifact, deps.clock()) : undefined;
  if (recorded !== undefined && !recorded.ok) return recorded;

  const ended = deps.ledger.append({
    action: 'DRILL_END',
    target,
    at: deps.clock(),
    incidentId: input.incidentId,
    evidence: {
      episodeId: input.episodeId,
      approvalState: outcome.state,
      artifactRecorded: recorded !== undefined,
      exercise: true,
    },
  });
  if (!ended.ok) return ended;

  return ok({
    episodeId: input.episodeId,
    artifact,
    approval: outcome,
    ...(recorded !== undefined ? { record: recorded.value } : {}),
    ledgerHashes: hashesOf(
      started.value.hash,
      approved.value.ledgerHash,
      recorded?.value.ledgerHash,
      ended.value.hash,
    ),
  });
}
