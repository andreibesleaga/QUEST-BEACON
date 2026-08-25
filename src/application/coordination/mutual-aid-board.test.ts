// BEACON — mutual-aid board tests (MW-D/D5.2; FR-D4-2, FEV-21, V13).
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { makeResourceTask, RESOURCE_TASK_STATUSES } from '@/domain/resource-task.js';
import type { ResourceTask, ResourceTaskStatus } from '@/domain/resource-task.js';
import type { IncidentId, ResourceId, ResourceTaskId, ShelterId } from '@/domain/value-objects/ids.js';
import { asId } from '@/domain/value-objects/ids.js';
import { findPersonIdentifyingRuntimeKeys } from '@/domain/shared/aggregate-only.js';
import { MUTUAL_AID_BOARD_CAVEAT, buildMutualAidBoard } from './mutual-aid-board.js';

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateBoard = ajv.compile(
  JSON.parse(readFileSync('schemas/d5-mutual-aid-board.schema.json', 'utf8')) as object,
);

interface TaskSpec {
  readonly id: string;
  readonly resourceId: string;
  readonly incidentId?: string;
  readonly status: ResourceTaskStatus;
  readonly edxlRmRef?: string;
  readonly shelterId?: string;
}

function task(spec: TaskSpec): ResourceTask {
  return makeResourceTask({
    id: asId<ResourceTaskId>(spec.id),
    resourceId: asId<ResourceId>(spec.resourceId),
    incidentId: asId<IncidentId>(spec.incidentId ?? 'inc-1'),
    status: spec.status,
    ...(spec.edxlRmRef !== undefined ? { edxlRmRef: spec.edxlRmRef } : {}),
    ...(spec.shelterId !== undefined ? { shelterId: asId<ShelterId>(spec.shelterId) } : {}),
  });
}

// One correlated chain (request → commit → en-route), one single-message chain, one purely local tasking.
const TASKS: readonly ResourceTask[] = [
  task({ id: 'task-3', resourceId: 'res-engine-7', status: 'ENROUTE', edxlRmRef: 'urn:rm:corr-a', shelterId: 'shelter-1' }),
  task({ id: 'task-1', resourceId: 'res-engine-7', status: 'PROPOSED', edxlRmRef: 'urn:rm:corr-a', shelterId: 'shelter-1' }),
  task({ id: 'task-2', resourceId: 'res-medic-2', status: 'TASKED', edxlRmRef: 'urn:rm:corr-a' }),
  task({ id: 'task-4', resourceId: 'res-crew-9', status: 'ONSCENE', edxlRmRef: 'urn:rm:corr-b', shelterId: 'shelter-2' }),
  task({ id: 'task-5', resourceId: 'res-local-1', status: 'PROPOSED' }),
];

describe('buildMutualAidBoard', () => {
  const board = buildMutualAidBoard(TASKS);

  it('groups taskings into correlation chains, ascending by EDXL-RM ref', () => {
    expect(board.requests.map((r) => r.edxlRmRef)).toEqual(['urn:rm:corr-a', 'urn:rm:corr-b']);
    expect(board.requests[0]!.taskIds).toEqual(['task-1', 'task-2', 'task-3']);
    expect(board.requests[0]!.resourceIds).toEqual(['res-engine-7', 'res-medic-2']);
    expect(board.requests[0]!.taskCount).toBe(3);
  });

  it('reports the FURTHEST-ADVANCED state of a chain, using the domain order (never a re-typed one)', () => {
    expect(board.requests[0]!.status).toBe('ENROUTE');
    expect(RESOURCE_TASK_STATUSES.indexOf('ENROUTE')).toBeGreaterThan(RESOURCE_TASK_STATUSES.indexOf('TASKED'));
  });

  it('names a chain shelter only when every tasking agrees', () => {
    // corr-a: task-1/task-3 name shelter-1, task-2 names none ⇒ the single distinct shelter is shelter-1.
    expect(board.requests[0]!.shelterId).toBe('shelter-1');
    // A chain whose taskings disagree carries no shelter rather than picking one.
    const disagreeing = buildMutualAidBoard([
      task({ id: 't1', resourceId: 'r1', status: 'PROPOSED', edxlRmRef: 'urn:rm:x', shelterId: 'shelter-1' }),
      task({ id: 't2', resourceId: 'r2', status: 'TASKED', edxlRmRef: 'urn:rm:x', shelterId: 'shelter-2' }),
    ]);
    expect('shelterId' in disagreeing.requests[0]!).toBe(false);
  });

  it('surfaces uncorrelated taskings as local instead of dropping them', () => {
    expect(board.local).toEqual([
      { taskId: 'task-5', resourceId: 'res-local-1', incidentId: 'inc-1', status: 'PROPOSED' },
    ]);
  });

  it('accounts for EVERY supplied tasking exactly once (nothing is silently lost)', () => {
    const seen = [
      ...board.requests.flatMap((r) => r.taskIds),
      ...board.local.map((l) => l.taskId),
      ...board.conflicts.flatMap((c) => c.taskIds),
    ];
    expect([...seen].sort()).toEqual([...TASKS.map((t) => t.id)].sort());
  });

  it('counts tasks per lifecycle state with every state key present', () => {
    expect(board.taskCountsByStatus).toEqual({ PROPOSED: 2, TASKED: 1, ENROUTE: 1, ONSCENE: 1, CLEARED: 0 });
    expect(Object.keys(board.taskCountsByStatus).sort()).toEqual([...RESOURCE_TASK_STATUSES].sort());
  });

  it('FLAGS a correlation id spanning two incidents instead of merging it into one row', () => {
    const crossed = buildMutualAidBoard([
      task({ id: 'x1', resourceId: 'r1', incidentId: 'inc-1', status: 'PROPOSED', edxlRmRef: 'urn:rm:crossed' }),
      task({ id: 'x2', resourceId: 'r2', incidentId: 'inc-2', status: 'TASKED', edxlRmRef: 'urn:rm:crossed' }),
    ]);
    expect(crossed.requests).toEqual([]);
    expect(crossed.conflicts).toEqual([
      {
        edxlRmRef: 'urn:rm:crossed',
        reason: 'CORRELATION_ID_SPANS_MULTIPLE_INCIDENTS',
        incidentIds: ['inc-1', 'inc-2'],
        taskIds: ['x1', 'x2'],
      },
    ]);
  });

  it('states the honest model limitation on the board itself (no ResourceRequest entity exists)', () => {
    expect(board.caveat).toBe(MUTUAL_AID_BOARD_CAVEAT);
    expect(MUTUAL_AID_BOARD_CAVEAT).toMatch(/no separate request entity/);
  });

  it('is deterministic and total — an empty store yields an empty, labelled board', () => {
    expect(buildMutualAidBoard(TASKS)).toEqual(board);
    const empty = buildMutualAidBoard([]);
    expect(empty.requests).toEqual([]);
    expect(empty.local).toEqual([]);
    expect(empty.taskCountsByStatus).toEqual({ PROPOSED: 0, TASKED: 0, ENROUTE: 0, ONSCENE: 0, CLEARED: 0 });
  });

  it('validates against schemas/d5-mutual-aid-board.schema.json and carries no person-identifying key', () => {
    expect(validateBoard(board), JSON.stringify(validateBoard.errors)).toBe(true);
    expect(findPersonIdentifyingRuntimeKeys(board)).toEqual([]);
  });
});
