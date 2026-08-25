// BEACON — RESOURCE_TASK invariant tests (E1·T-074). Forward-only status machine; edxlRmRef optional.
import { describe, it, expect } from 'vitest';
import {
  makeResourceTask,
  transitionResourceTask,
  canTransitionResourceTask,
  RESOURCE_TASK_STATUSES,
} from './resource-task.js';
import { asId } from './value-objects/ids.js';
import type { ResourceTaskId, ResourceId, IncidentId } from './value-objects/ids.js';
import { InvariantViolation, InvalidTransition } from './errors.js';

const id = asId<ResourceTaskId>('t-1');
const resourceId = asId<ResourceId>('r-1');
const incidentId = asId<IncidentId>('i-1');
const base = { id, resourceId, incidentId };

describe('makeResourceTask', () => {
  it('defaults status to PROPOSED and omits optional edxlRmRef', () => {
    const t = makeResourceTask(base);
    expect(t.status).toBe('PROPOSED');
    expect(t.edxlRmRef).toBeUndefined();
  });

  it('keeps the optional edxlRmRef mutual-aid reference when supplied', () => {
    const t = makeResourceTask({ ...base, edxlRmRef: 'RM-42' });
    expect(t.edxlRmRef).toBe('RM-42');
  });

  it('rejects a status outside the enum', () => {
    expect(() => makeResourceTask({ ...base, status: 'DONE' as never })).toThrow(InvariantViolation);
  });
});

describe('transitionResourceTask', () => {
  it('advances one step at a time through the whole lifecycle', () => {
    let t = makeResourceTask(base);
    for (let i = 1; i < RESOURCE_TASK_STATUSES.length; i++) {
      const next = RESOURCE_TASK_STATUSES[i]!;
      t = transitionResourceTask(t, next);
      expect(t.status).toBe(next);
    }
  });

  it('rejects skipping a step (PROPOSED → CLEARED)', () => {
    const t = makeResourceTask(base);
    expect(() => transitionResourceTask(t, 'CLEARED')).toThrow(InvalidTransition);
  });

  it('rejects a backward transition (TASKED → PROPOSED)', () => {
    const t = transitionResourceTask(makeResourceTask(base), 'TASKED');
    expect(() => transitionResourceTask(t, 'PROPOSED')).toThrow(InvalidTransition);
  });

  it('rejects an unknown target status', () => {
    const t = makeResourceTask(base);
    expect(() => transitionResourceTask(t, 'NOPE' as never)).toThrow(InvariantViolation);
  });

  it('canTransitionResourceTask allows only the immediate next hop', () => {
    expect(canTransitionResourceTask('PROPOSED', 'TASKED')).toBe(true);
    expect(canTransitionResourceTask('PROPOSED', 'ENROUTE')).toBe(false);
    expect(canTransitionResourceTask('CLEARED', 'ONSCENE')).toBe(false);
  });
});
