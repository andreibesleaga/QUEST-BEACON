import { describe, it, expect } from 'vitest';
import { makeIncident, transitionIncident, canTransitionIncident, INCIDENT_TYPES } from './incident.js';
import { InvariantViolation, InvalidTransition } from './errors.js';
import { asId } from './value-objects/ids.js';
import type { IncidentId, RegionId } from './value-objects/ids.js';

const id = asId<IncidentId>('22222222-2222-2222-2222-222222222222');
const regionId = asId<RegionId>('11111111-1111-1111-1111-111111111111');

describe('makeIncident', () => {
  it('builds a valid incident and defaults status to ACTIVE', () => {
    const i = makeIncident({ id, regionId, type: 'WILDFIRE' });
    expect(i.type).toBe('WILDFIRE');
    expect(i.status).toBe('ACTIVE');
  });

  it('rejects an invalid type', () => {
    // @ts-expect-error invalid enum
    expect(() => makeIncident({ id, regionId, type: 'EARTHQUAKE' })).toThrow(InvariantViolation);
  });

  it('rejects an invalid status', () => {
    // @ts-expect-error invalid enum
    expect(() => makeIncident({ id, regionId, type: 'FLOOD', status: 'PENDING' })).toThrow(InvariantViolation);
  });

  // ADR-032 / FR-STORM-1: tropical cyclone is a first-class incident type, not a flood in disguise.
  it('accepts every schema type, including STORM', () => {
    expect(INCIDENT_TYPES).toEqual(['WILDFIRE', 'FLOOD', 'STORM']);
    for (const type of INCIDENT_TYPES) {
      expect(makeIncident({ id, regionId, type }).type).toBe(type);
    }
  });

  it('runs a STORM incident through the same status machine as fire and flood', () => {
    const storm = makeIncident({ id, regionId, type: 'STORM' });
    expect(storm.status).toBe('ACTIVE');
    expect(transitionIncident(storm, 'CONTAINED').type).toBe('STORM');
    expect(canTransitionIncident('CLOSED', 'ACTIVE')).toBe(false);
  });
});

describe('incident status transitions', () => {
  it('allows ACTIVE -> CONTAINED and back (re-flare)', () => {
    const i = makeIncident({ id, regionId, type: 'WILDFIRE' });
    const contained = transitionIncident(i, 'CONTAINED');
    expect(contained.status).toBe('CONTAINED');
    expect(transitionIncident(contained, 'ACTIVE').status).toBe('ACTIVE');
  });

  it('allows ACTIVE -> CLOSED and CONTAINED -> CLOSED', () => {
    const i = makeIncident({ id, regionId, type: 'FLOOD' });
    expect(transitionIncident(i, 'CLOSED').status).toBe('CLOSED');
    expect(transitionIncident({ ...i, status: 'CONTAINED' }, 'CLOSED').status).toBe('CLOSED');
  });

  it('rejects reopening a CLOSED incident (CLOSED -> ACTIVE)', () => {
    const closed = makeIncident({ id, regionId, type: 'WILDFIRE', status: 'CLOSED' });
    expect(() => transitionIncident(closed, 'ACTIVE')).toThrow(InvalidTransition);
    expect(canTransitionIncident('CLOSED', 'ACTIVE')).toBe(false);
    expect(canTransitionIncident('CLOSED', 'CONTAINED')).toBe(false);
  });
});
