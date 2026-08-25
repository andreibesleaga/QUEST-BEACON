// BEACON — shelter-demand / evacuation-clearance tests (MW-D/D1.4; ADR-035 §1(d) + V7).
// The arithmetic is pinned against hand-computable values, and so is the honesty contract: every figure
// carries its parameter set and its assumptions, and a feasibility verdict is only stated when a lead time
// actually exists.
import { describe, it, expect } from 'vitest';
import { makeShelter } from '@/domain/shelter.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { ShelterId } from '@/domain/value-objects/ids.js';
import { CLEARANCE_UNCERTAINTY, SHELTER_DEMAND_METHOD, projectShelterDemand, type ShelterDemandInput } from './shelter-demand.js';
import { DEFAULT_IMPACT_PARAMS } from './impact-params.js';

const shelter = (id: string, capacity: number, occupancy: number) =>
  makeShelter({ id: asId<ShelterId>(id), geom: { type: 'Point', coordinates: [0, 0] }, capacity, occupancy });

const SHELTERS = [shelter('s-1', 500, 100), shelter('s-2', 300, 300)]; // spare = 400 + 0

function project(over: Partial<ShelterDemandInput> = {}) {
  return projectShelterDemand({ affectedCount: 10_000, shelters: SHELTERS, ...over });
}

const P = DEFAULT_IMPACT_PARAMS.parameters;

describe('shelter demand', () => {
  it('is affected x the shelter-seeking share, compared against Σ(capacity − occupancy)', () => {
    const f = project();
    expect(f.shelterSeeking).toBe(Math.round(10_000 * P.shelterSeekingFraction.value));
    expect(f.spareCapacity).toBe(400);
    expect(f.shelterDeficit).toBe(Math.max(0, f.shelterSeeking - 400));
    expect(f.sheltersConsidered).toBe(2);
    expect(f.method).toBe(SHELTER_DEMAND_METHOD);
    expect(f.uncertainty).toBe(CLEARANCE_UNCERTAINTY);
  });

  it('a deficit never goes negative when capacity exceeds demand', () => {
    expect(project({ affectedCount: 10 }).shelterDeficit).toBe(0);
  });

  it('no shelters ⇒ zero spare capacity and a deficit equal to the whole demand', () => {
    const f = project({ shelters: [] });
    expect(f.spareCapacity).toBe(0);
    expect(f.shelterDeficit).toBe(f.shelterSeeking);
  });
});

describe('evacuation clearance', () => {
  it('is loading time plus vehicles ÷ egress capacity, with vehicles rounded UP', () => {
    const f = project();
    const vehicles = Math.ceil((10_000 * P.participationFraction.value) / P.occupantsPerVehicle.value);
    expect(f.evacuatingVehicles).toBe(vehicles);
    expect(f.clearanceHours).toBeCloseTo(
      Math.round((P.loadingTimeHours.value + vehicles / P.egressCapacityVehPerHour.value) * 10) / 10,
      9,
    );
  });

  it('states a feasibility verdict ONLY when a lead time exists', () => {
    expect(project().evacuationFeasible).toBeUndefined();
    expect(project().leadTimeHours).toBeUndefined();
    expect(project({ leadTimeHours: 48 }).evacuationFeasible).toBe(true);
    expect(project({ leadTimeHours: 0 }).evacuationFeasible).toBe(false);
    // A malformed lead time is treated as absent rather than as "0 hours of warning".
    expect(project({ leadTimeHours: Number.NaN }).evacuationFeasible).toBeUndefined();
    expect(project({ leadTimeHours: -1 }).evacuationFeasible).toBeUndefined();
  });

  it('a non-finite or negative affected count degrades to zero rather than propagating NaN', () => {
    for (const affectedCount of [Number.NaN, -50]) {
      const f = project({ affectedCount });
      expect(f.shelterSeeking).toBe(0);
      expect(f.evacuatingVehicles).toBe(0);
      expect(Number.isFinite(f.clearanceHours)).toBe(true);
    }
  });
});

describe('the assumptions travel WITH the figure (ADR-035 §1(d) / V7)', () => {
  it('publishes the parameter set id and every parameter it used, with unit, label, citation and verdict', () => {
    const f = project();
    expect(f.parameterSetId).toBe(DEFAULT_IMPACT_PARAMS.parameterSetId);
    expect(f.assumptions.map((a) => a.id)).toEqual([
      'shelterSeekingFraction',
      'participationFraction',
      'occupantsPerVehicle',
      'egressCapacityVehPerHour',
      'loadingTimeHours',
    ]);
    for (const a of f.assumptions) {
      expect(a.unit.length).toBeGreaterThan(0);
      expect(a.citation.length).toBeGreaterThan(0);
      expect(a.verified).toBe(false); // none of the shipped values is a literature value
    }
    expect(f.inputs).toMatchObject({ allParametersVerified: false });
  });

  it('the clearance figure is described as a FLOOR, because the formulation is linear', () => {
    expect(project().uncertainty).toMatch(/FLOOR/);
    expect(SHELTER_DEMAND_METHOD).toMatch(/LINEAR/);
  });

  it('the parameters are injectable: a different set gives a different, still-labelled figure', () => {
    const params = {
      ...DEFAULT_IMPACT_PARAMS,
      parameterSetId: 'local-study-2026',
      parameters: {
        ...DEFAULT_IMPACT_PARAMS.parameters,
        shelterSeekingFraction: { ...P.shelterSeekingFraction, value: 0.5, verified: true },
      },
    };
    const f = project({ params });
    expect(f.parameterSetId).toBe('local-study-2026');
    expect(f.shelterSeeking).toBe(5000);
    expect(f.assumptions[0]!.verified).toBe(true);
  });
});
