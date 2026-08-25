// BEACON — SHELTER invariant tests (E1·T-076). occupancy ≤ capacity; FULL ⇒ occupancy == capacity.
import { describe, it, expect } from 'vitest';
import { makeShelter } from './shelter.js';
import { asId } from './value-objects/ids.js';
import type { ShelterId } from './value-objects/ids.js';
import type { PointGeometry } from './value-objects/geo.js';
import { InvariantViolation } from './errors.js';

const id = asId<ShelterId>('s-1');
const geom: PointGeometry = { type: 'Point', coordinates: [26.1, 44.4] };

describe('makeShelter', () => {
  it('defaults occupancy to 0 and status to OPEN', () => {
    const s = makeShelter({ id, geom, capacity: 100 });
    expect(s.occupancy).toBe(0);
    expect(s.status).toBe('OPEN');
  });

  it('allows occupancy up to capacity', () => {
    const s = makeShelter({ id, geom, capacity: 50, occupancy: 50, status: 'FULL' });
    expect(s.occupancy).toBe(50);
    expect(s.status).toBe('FULL');
  });

  it('rejects occupancy greater than capacity', () => {
    expect(() => makeShelter({ id, geom, capacity: 10, occupancy: 11 })).toThrow(InvariantViolation);
  });

  it('rejects negative occupancy', () => {
    expect(() => makeShelter({ id, geom, capacity: 10, occupancy: -1 })).toThrow(InvariantViolation);
  });

  it('rejects negative capacity', () => {
    expect(() => makeShelter({ id, geom, capacity: -5 })).toThrow(InvariantViolation);
  });

  it('rejects FULL status when occupancy is below capacity', () => {
    expect(() => makeShelter({ id, geom, capacity: 100, occupancy: 40, status: 'FULL' })).toThrow(InvariantViolation);
  });

  it('rejects a status outside the enum', () => {
    expect(() => makeShelter({ id, geom, capacity: 10, status: 'PACKED' as never })).toThrow(InvariantViolation);
  });

  it('rejects a geom that is not a Point', () => {
    const bad = { type: 'LineString', coordinates: [] } as unknown as PointGeometry;
    expect(() => makeShelter({ id, geom: bad, capacity: 10 })).toThrow(InvariantViolation);
  });
});
