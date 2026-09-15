// BEACON — RESOURCE_TASK entity (E1·T-075). Tasking lifecycle PROPOSED→…→CLEARED (EV9).
// Pure domain: no framework/HTTP/DB imports (F9).
import type { ResourceTaskId, ResourceId, IncidentId, ShelterId } from './value-objects/ids.js';
import type { Geometry } from './value-objects/geo.js';
import { InvariantViolation, InvalidTransition } from './errors.js';

// Enum + ORDER mirror schema.sql resource_task.status. Order is the forward-only progression;
// a task advances one step at a time (no skips) and never moves backward (EV9).
export const RESOURCE_TASK_STATUSES = [
  'PROPOSED',
  'TASKED',
  'ENROUTE',
  'ONSCENE',
  'CLEARED',
] as const;
export type ResourceTaskStatus = (typeof RESOURCE_TASK_STATUSES)[number];

const STATUS_INDEX: Readonly<Record<ResourceTaskStatus, number>> = Object.freeze(
  Object.fromEntries(RESOURCE_TASK_STATUSES.map((s, i) => [s, i])) as Record<
    ResourceTaskStatus,
    number
  >,
);

export interface ResourceTask {
  readonly id: ResourceTaskId;
  readonly resourceId: ResourceId;
  readonly incidentId: IncidentId;
  readonly status: ResourceTaskStatus;
  // Optional in the DDL (nullable): staffing shelter, geo target, mutual-aid round-trip id (EDXL-RM, EV10).
  readonly shelterId?: ShelterId;
  readonly target?: Geometry;
  readonly edxlRmRef?: string;
}

export interface MakeResourceTaskInput {
  readonly id: ResourceTaskId;
  readonly resourceId: ResourceId;
  readonly incidentId: IncidentId;
  readonly status?: ResourceTaskStatus; // defaults to PROPOSED (schema default / lifecycle start)
  readonly shelterId?: ShelterId;
  readonly target?: Geometry;
  readonly edxlRmRef?: string;
}

export function makeResourceTask(input: MakeResourceTaskInput): ResourceTask {
  const status = input.status ?? 'PROPOSED';
  if (!RESOURCE_TASK_STATUSES.includes(status)) {
    throw new InvariantViolation(
      `ResourceTask.status must be one of ${RESOURCE_TASK_STATUSES.join('|')}, got ${String(status)}`,
    );
  }
  return {
    id: input.id,
    resourceId: input.resourceId,
    incidentId: input.incidentId,
    status,
    ...(input.shelterId !== undefined ? { shelterId: input.shelterId } : {}),
    ...(input.target !== undefined ? { target: input.target } : {}),
    ...(input.edxlRmRef !== undefined ? { edxlRmRef: input.edxlRmRef } : {}),
  };
}

/** True only for a single forward hop (PROPOSED→TASKED→…→CLEARED). Backward hops and skips are illegal. */
export function canTransitionResourceTask(
  from: ResourceTaskStatus,
  to: ResourceTaskStatus,
): boolean {
  return STATUS_INDEX[to] === STATUS_INDEX[from] + 1;
}

/** Advance a task by exactly one lifecycle step; throws InvalidTransition on any skip/backward move. */
export function transitionResourceTask(task: ResourceTask, to: ResourceTaskStatus): ResourceTask {
  if (!RESOURCE_TASK_STATUSES.includes(to)) {
    throw new InvariantViolation(
      `ResourceTask.status must be one of ${RESOURCE_TASK_STATUSES.join('|')}`,
    );
  }
  if (!canTransitionResourceTask(task.status, to)) {
    throw new InvalidTransition(
      `ResourceTask cannot move ${task.status} → ${to} (forward-only, no skips)`,
    );
  }
  return { ...task, status: to };
}
