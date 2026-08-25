import { describe, it, expect } from 'vitest';
import { makeExposure, EXPOSURE_REASONS } from './exposure.js';
import { InvariantViolation } from './errors.js';
import { asId } from './value-objects/ids.js';
import type { IncidentId, InfrastructureNodeId } from './value-objects/ids.js';

const incidentId = asId<IncidentId>('22222222-2222-2222-2222-222222222222');
const nodeId = asId<InfrastructureNodeId>('66666666-6666-6666-6666-666666666666');
const base = { incidentId, nodeId, reason: 'IN_POLYGON' as const, computedAt: '2026-07-01T00:00:00Z' };

describe('makeExposure', () => {
  it('builds a valid exposure and defaults insideHazard to false', () => {
    const e = makeExposure(base);
    expect(e.reason).toBe('IN_POLYGON');
    expect(e.insideHazard).toBe(false);
  });

  it('accepts every schema reason', () => {
    for (const reason of EXPOSURE_REASONS) {
      expect(makeExposure({ ...base, reason }).reason).toBe(reason);
    }
  });

  it('accepts a zero and positive distance', () => {
    expect(makeExposure({ ...base, distanceM: 0 }).distanceM).toBe(0);
    expect(makeExposure({ ...base, distanceM: 250.5 }).distanceM).toBe(250.5);
  });

  it('omits distanceM when not provided', () => {
    expect(makeExposure(base).distanceM).toBeUndefined();
  });

  it('rejects a reason outside the enum', () => {
    // @ts-expect-error invalid enum
    expect(() => makeExposure({ ...base, reason: 'NEARBY' })).toThrow(InvariantViolation);
  });

  it('rejects a negative distance', () => {
    expect(() => makeExposure({ ...base, distanceM: -1 })).toThrow(InvariantViolation);
  });

  it('rejects a missing/invalid computedAt', () => {
    expect(() => makeExposure({ ...base, computedAt: 'nope' })).toThrow(InvariantViolation);
  });
});
