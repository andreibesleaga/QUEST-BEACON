// BEACON — MUTUAL-AID REQUEST BOARD (MW-D/D5.2; FR-D4-2 `FEATURE_D4_MUTUAL_AID`, FEV-21, ADR-036 §7).
// Pure application layer: PORTS + DOMAIN only (F9/ADR-001) — the EDXL-RM serialization itself lives in the
// interop ADAPTER (`src/adapters/interop/edxl-rm-mapper.ts`) and is deliberately not imported here.
//
// HONEST MODEL STATEMENT (ADR-036 §7's G12, stated rather than implied): **there is no `ResourceRequest`
// entity in BEACON.** A "mutual-aid request" is a CORRELATION CHAIN of `ResourceTask` rows sharing one
// `edxlRmRef` (`src/domain/resource-task.ts:24`) — the EDXL-RM `OriginatingMessageID` that a
// request→commit→response round-trip carries end to end. This board is a VIEW over that seam. It invents no
// requester, no quantity and no fulfilment state the store does not hold.
//
// NOTHING IS RE-DERIVED HERE:
//   • the lifecycle vocabulary and its ORDER come from `RESOURCE_TASK_STATUSES` (imported) — the F-24 defect
//     was a UI re-typing exactly this union and getting 3 of 5 tokens wrong;
//   • capacity/distance MATCHING already exists (`listAvailable` + the distance ranking in
//     `src/application/pre-positioning/pre-positioning.ts:118`) and is NOT re-implemented — FEV-21's matching
//     clause is satisfied by that use-case, which this board deliberately does not duplicate.
//
// FLAG, NEVER MERGE (the same doctrine as the rumor board): when one correlation id spans MORE THAN ONE
// incident, the chain is NOT collapsed into a single row that would have to invent which incident it belongs
// to. It is excluded from `requests` and listed in `conflicts` with its reason (Art. XVI: labelled
// degradation, never a silently-wrong precise-looking row).
import type { IncidentId, ResourceId, ResourceTaskId, ShelterId } from '@/domain/value-objects/ids.js';
import type { ResourceTask, ResourceTaskStatus } from '@/domain/resource-task.js';
import { RESOURCE_TASK_STATUSES } from '@/domain/resource-task.js';

export const MUTUAL_AID_BOARD_CAVEAT =
  'A mutual-aid request is a correlation chain of resource taskings sharing one EDXL-RM ' +
  'OriginatingMessageID. BEACON holds no separate request entity: quantities, requester identity and ' +
  'fulfilment percentages are not modelled and are not shown.';

/** Why a correlation chain could not be rendered as one request row. Closed vocabulary. */
export const MUTUAL_AID_CONFLICT_REASONS = ['CORRELATION_ID_SPANS_MULTIPLE_INCIDENTS'] as const;
export type MutualAidConflictReason = (typeof MUTUAL_AID_CONFLICT_REASONS)[number];

export interface MutualAidRequestRow {
  /** The EDXL-RM OriginatingMessageID correlating every tasking in this chain. */
  readonly edxlRmRef: string;
  readonly incidentId: IncidentId;
  /** Every tasking in the chain, ascending by id (deterministic). */
  readonly taskIds: readonly ResourceTaskId[];
  /** Distinct resources in the chain, ascending (a chain may re-task the same resource). */
  readonly resourceIds: readonly ResourceId[];
  /** The FURTHEST-ADVANCED lifecycle state in the chain, by `RESOURCE_TASK_STATUSES` order. */
  readonly status: ResourceTaskStatus;
  readonly taskCount: number;
  /** Present only when every tasking in the chain names the SAME shelter (else the chain has no one shelter). */
  readonly shelterId?: ShelterId;
}

/** A tasking with no EDXL-RM correlation id — surfaced as local, never dropped and never invented into one. */
export interface MutualAidLocalRow {
  readonly taskId: ResourceTaskId;
  readonly resourceId: ResourceId;
  readonly incidentId: IncidentId;
  readonly status: ResourceTaskStatus;
}

export interface MutualAidConflict {
  readonly edxlRmRef: string;
  readonly reason: MutualAidConflictReason;
  readonly incidentIds: readonly IncidentId[];
  readonly taskIds: readonly ResourceTaskId[];
}

export interface MutualAidBoard {
  /** Correlated mutual-aid chains, ascending by `edxlRmRef`. */
  readonly requests: readonly MutualAidRequestRow[];
  /** Taskings carrying no correlation id (purely local taskings), ascending by task id. */
  readonly local: readonly MutualAidLocalRow[];
  /** Chains that could not be rendered as one row — flagged, never merged. */
  readonly conflicts: readonly MutualAidConflict[];
  /** TASK counts per lifecycle state over every supplied tasking. Every state key is present (zeros incl.). */
  readonly taskCountsByStatus: Readonly<Record<ResourceTaskStatus, number>>;
  readonly caveat: string;
}

function emptyCounts(): Record<ResourceTaskStatus, number> {
  // Derived from the domain union: a new lifecycle state appears here automatically, never silently missing.
  return Object.fromEntries(RESOURCE_TASK_STATUSES.map((s) => [s, 0])) as Record<ResourceTaskStatus, number>;
}

/** Furthest-advanced of two states by the domain's forward-only order (`resource-task.ts:9-10`). */
function furthest(a: ResourceTaskStatus, b: ResourceTaskStatus): ResourceTaskStatus {
  return RESOURCE_TASK_STATUSES.indexOf(b) > RESOURCE_TASK_STATUSES.indexOf(a) ? b : a;
}

function distinctSorted<T extends string>(values: readonly T[]): readonly T[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

/** The single shelter of a chain, or undefined when the taskings name none or disagree. */
function chainShelter(tasks: readonly ResourceTask[]): ShelterId | undefined {
  const shelters = distinctSorted(tasks.map((t) => t.shelterId).filter((s): s is ShelterId => s !== undefined));
  return shelters.length === 1 ? shelters[0] : undefined;
}

function groupByRef(tasks: readonly ResourceTask[]): ReadonlyMap<string, ResourceTask[]> {
  const byRef = new Map<string, ResourceTask[]>();
  for (const task of tasks) {
    if (task.edxlRmRef === undefined) continue;
    const group = byRef.get(task.edxlRmRef);
    if (group === undefined) byRef.set(task.edxlRmRef, [task]);
    else group.push(task);
  }
  return byRef;
}

function requestRow(ref: string, chain: readonly ResourceTask[], incidentId: IncidentId): MutualAidRequestRow {
  const shelterId = chainShelter(chain);
  const row: MutualAidRequestRow = {
    edxlRmRef: ref,
    incidentId,
    taskIds: distinctSorted(chain.map((t) => t.id)),
    resourceIds: distinctSorted(chain.map((t) => t.resourceId)),
    status: chain.map((t) => t.status).reduce(furthest, RESOURCE_TASK_STATUSES[0]),
    taskCount: chain.length,
  };
  return shelterId === undefined ? row : { ...row, shelterId };
}

function localRow(task: ResourceTask): MutualAidLocalRow {
  return { taskId: task.id, resourceId: task.resourceId, incidentId: task.incidentId, status: task.status };
}

/**
 * Project the tasking store into the mutual-aid board. Deterministic and total: same input ⇒ same output,
 * no clock, no I/O, no model. Every supplied tasking appears exactly once across `requests`, `local` and
 * `conflicts` (asserted by test — nothing is silently dropped).
 */
export function buildMutualAidBoard(tasks: readonly ResourceTask[]): MutualAidBoard {
  const taskCountsByStatus = emptyCounts();
  for (const task of tasks) taskCountsByStatus[task.status] += 1;

  const requests: MutualAidRequestRow[] = [];
  const conflicts: MutualAidConflict[] = [];
  for (const [ref, chain] of [...groupByRef(tasks).entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const incidentIds = distinctSorted(chain.map((t) => t.incidentId));
    if (incidentIds.length > 1) {
      conflicts.push({
        edxlRmRef: ref,
        reason: 'CORRELATION_ID_SPANS_MULTIPLE_INCIDENTS',
        incidentIds,
        taskIds: distinctSorted(chain.map((t) => t.id)),
      });
      continue;
    }
    requests.push(requestRow(ref, chain, incidentIds[0]!));
  }

  const local = tasks
    .filter((t) => t.edxlRmRef === undefined)
    .map(localRow)
    .sort((a, b) => a.taskId.localeCompare(b.taskId));

  return { requests, local, conflicts, taskCountsByStatus, caveat: MUTUAL_AID_BOARD_CAVEAT };
}
