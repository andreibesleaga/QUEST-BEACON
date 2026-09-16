// BEACON — pre-positioning-from-predictions tests (W2d; PRD flagship-4 logistics). Deterministic: fixed
// fixtures, injected SpatialPort (no network, no clock dependence — this use-case is clock-free).
import { describe, it, expect } from 'vitest';
import type { SpatialPort } from '@/ports/index.js';
import type { Geometry, Position } from '@/domain/value-objects/geo.js';
import { ok, err, isOk, isErr } from '@/domain/shared/result.js';
import { InvariantViolation } from '@/domain/errors.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { ResourceId, ShelterId, OrgId } from '@/domain/value-objects/ids.js';
import { makeResource, RESOURCE_KINDS } from '@/domain/resource.js';
import type { Resource } from '@/domain/resource.js';
import { makeShelter } from '@/domain/shelter.js';
import type { Shelter } from '@/domain/shelter.js';
import { suggestPrePositioning, PRE_POSITIONING_METHOD } from './pre-positioning.js';
import type { PrePositioningInput, RankableResource } from './pre-positioning.js';

const ORG = asId<OrgId>('org-1');
const point = (coordinates: Position) => ({ type: 'Point' as const, coordinates });

// A small square extent (the projected hazard footprint, e.g. Prediction.geom) centred on [0,0].
const EXTENT: Geometry = {
  type: 'Polygon',
  coordinates: [
    [
      [-0.01, -0.01],
      [0.01, -0.01],
      [0.01, 0.01],
      [-0.01, 0.01],
      [-0.01, -0.01],
    ],
  ],
};

/** A SpatialPort whose pointInPolygon answers from an explicit allow-list of "inside" positions (by ref). */
function fakeSpatial(insidePositions: readonly Position[] = []): SpatialPort {
  return {
    pointInPolygon: (p) => ok(insidePositions.some((ip) => ip[0] === p[0] && ip[1] === p[1])),
    buffer: () => ok(EXTENT as never),
    intersect: () => ok(true),
  };
}

function resource(id: string, over: Partial<Parameters<typeof makeResource>[0]> = {}): Resource {
  return makeResource({
    id: asId<ResourceId>(id),
    kind: 'ENGINE',
    status: 'AVAILABLE',
    orgId: ORG,
    geom: point([0.05, 0]), // ~5.5km east of the extent edge
    ...over,
  });
}

function shelter(id: string, over: Partial<Parameters<typeof makeShelter>[0]> = {}): Shelter {
  return makeShelter({
    id: asId<ShelterId>(id),
    geom: point([-0.05, 0]),
    capacity: 100,
    occupancy: 20,
    orgId: ORG,
    ...over,
  });
}

function input(over: Partial<PrePositioningInput> = {}): PrePositioningInput {
  return {
    candidates: { resources: [resource('res-1')], shelters: [shelter('sh-1')] },
    extent: EXTENT,
    ...over,
  };
}

/** Same default candidates, but with NO `extent` key at all (exactOptionalPropertyTypes-safe "absent"). */
function inputWithoutExtent(): PrePositioningInput {
  return { candidates: { resources: [resource('res-1')], shelters: [shelter('sh-1')] } };
}

describe('suggestPrePositioning — golden path', () => {
  it('ranks a resource and a shelter near (not inside) the extent, nearest first, with honest labeling', () => {
    const res = suggestPrePositioning(input(), fakeSpatial());
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.method).toBe(PRE_POSITIONING_METHOD);
    expect(res.value.extentAvailable).toBe(true);
    expect(res.value.suggestions).toHaveLength(2);
    const [r, s] = res.value.suggestions;
    expect(r).toMatchObject({ kind: 'RESOURCE', refId: 'res-1', resourceKind: 'ENGINE' });
    expect(r!.distanceMeters).toBeGreaterThan(0);
    expect(s).toMatchObject({ kind: 'SHELTER', refId: 'sh-1', capacity: 100, occupancy: 20 });
    expect(s!.distanceMeters).toBeGreaterThan(0);
  });

  it('ranks nearer candidates first within a category', () => {
    const near = resource('res-near', { geom: point([0.011, 0]) });
    const far = resource('res-far', { geom: point([0.15, 0]) }); // ~16km from the extent edge — still within the default 20km radius
    const res = suggestPrePositioning(
      input({ candidates: { resources: [far, near], shelters: [] } }),
      fakeSpatial(),
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.suggestions.map((s) => s.refId)).toEqual(['res-near', 'res-far']);
  });
});

describe('suggestPrePositioning — edge cases', () => {
  it('returns an empty, labeled result when there is no projected extent (no prediction yet)', () => {
    const res = suggestPrePositioning(inputWithoutExtent(), fakeSpatial());
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.extentAvailable).toBe(false);
    expect(res.value.suggestions).toEqual([]);
    expect(res.value.method).toBe(PRE_POSITIONING_METHOD);
  });

  it('returns an empty result for an empty registry (no resources, no shelters)', () => {
    const res = suggestPrePositioning(
      input({ candidates: { resources: [], shelters: [] } }),
      fakeSpatial(),
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.extentAvailable).toBe(true);
    expect(res.value.suggestions).toEqual([]);
  });

  it('excludes a resource that is already INSIDE the extent (not "near")', () => {
    const inside = resource('res-inside', { geom: point([0, 0]) });
    const spatial = fakeSpatial([[0, 0]]);
    const res = suggestPrePositioning(
      input({ candidates: { resources: [inside], shelters: [] } }),
      spatial,
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.suggestions).toEqual([]);
  });

  it('excludes a shelter that is already INSIDE the extent', () => {
    const inside = shelter('sh-inside', { geom: point([0, 0]) });
    const spatial = fakeSpatial([[0, 0]]);
    const res = suggestPrePositioning(
      input({ candidates: { resources: [], shelters: [inside] } }),
      spatial,
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.suggestions).toEqual([]);
  });

  it('excludes a resource with no known location (cannot rank, not faked)', () => {
    const noGeom = resource('res-nogeom');
    delete (noGeom as { geom?: unknown }).geom;
    const res = suggestPrePositioning(
      input({ candidates: { resources: [noGeom], shelters: [] } }),
      fakeSpatial(),
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.suggestions).toEqual([]);
  });

  it('excludes a non-AVAILABLE resource (already committed)', () => {
    const assigned = resource('res-assigned', { status: 'ASSIGNED' });
    const res = suggestPrePositioning(
      input({ candidates: { resources: [assigned], shelters: [] } }),
      fakeSpatial(),
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.suggestions).toEqual([]);
  });

  it('excludes a FULL shelter (no spare capacity)', () => {
    const full = shelter('sh-full', { capacity: 50, occupancy: 50, status: 'FULL' });
    const res = suggestPrePositioning(
      input({ candidates: { resources: [], shelters: [full] } }),
      fakeSpatial(),
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.suggestions).toEqual([]);
  });

  it('excludes a CLOSED shelter', () => {
    const closed = shelter('sh-closed', { status: 'CLOSED', occupancy: 0 });
    const res = suggestPrePositioning(
      input({ candidates: { resources: [], shelters: [closed] } }),
      fakeSpatial(),
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.suggestions).toEqual([]);
  });

  it('excludes a candidate beyond the near-radius', () => {
    const distant = resource('res-far', { geom: point([5, 0]) }); // far outside any reasonable radius
    const res = suggestPrePositioning(
      input({ candidates: { resources: [distant], shelters: [] }, nearRadiusMeters: 1000 }),
      fakeSpatial(),
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.suggestions).toEqual([]);
  });

  it('caps suggestions per category at maxPerCategory', () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      resource(`res-${i}`, { geom: point([0.02 + i * 0.001, 0]) }),
    );
    const res = suggestPrePositioning(
      input({ candidates: { resources: many, shelters: [] }, maxPerCategory: 3 }),
      fakeSpatial(),
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.suggestions).toHaveLength(3);
  });

  it('propagates a SpatialPort pointInPolygon error (never a partial/guessed result)', () => {
    const failing: SpatialPort = {
      pointInPolygon: () => err(new InvariantViolation('spatial failure')),
      buffer: () => ok(EXTENT as never),
      intersect: () => ok(true),
    };
    const res = suggestPrePositioning(input(), failing);
    expect(isErr(res)).toBe(true);
  });

  it('propagates a SpatialPort error from the SHELTER ranking pass too (both call sites)', () => {
    let calls = 0;
    const failsOnSecondCall: SpatialPort = {
      pointInPolygon: () => {
        calls += 1;
        return calls > 1 ? err(new InvariantViolation('spatial failure')) : ok(false);
      },
      buffer: () => ok(EXTENT as never),
      intersect: () => ok(true),
    };
    const res = suggestPrePositioning(input(), failsOnSecondCall);
    expect(isErr(res)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// FR-D6-1 / FR-D6-2 (ADR-035 §4; finding F-171): supplies and volunteer TEAMS in the distance ranking.
//
// HONEST SCOPE, asserted rather than claimed: these tests prove the ranking COVERS every resource kind and
// CARRIES each kind's aggregate figures. They do not prove — and this module does not implement — any
// capacity-vs-demand matching. There is no generic matcher in this codebase; matching today is this distance
// ranking plus the shelter arithmetic.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('suggestPrePositioning — resource-kind coverage (FR-D6-1/2)', () => {
  it('ranks EVERY kind in RESOURCE_KINDS: there is no kind filter, and adding one would be the bug', () => {
    const resources = RESOURCE_KINDS.map((kind, i) =>
      resource(`res-${kind}`, { kind, geom: point([0.05, i / 1000]) }),
    );
    const res = suggestPrePositioning(
      input({ candidates: { resources, shelters: [] } }),
      fakeSpatial(),
    );
    expect(isOk(res)).toBe(true);
    const kinds = isOk(res) ? res.value.suggestions.map((s) => s.resourceKind) : [];
    // maxPerCategory defaults to 5 and there are more kinds than that — widen the cap so coverage is the
    // thing under test rather than the cap.
    const uncapped = suggestPrePositioning(
      input({ candidates: { resources, shelters: [] }, maxPerCategory: RESOURCE_KINDS.length }),
      fakeSpatial(),
    );
    expect(isOk(uncapped)).toBe(true);
    const allKinds = isOk(uncapped) ? uncapped.value.suggestions.map((s) => s.resourceKind) : [];
    expect([...allKinds].sort()).toEqual([...RESOURCE_KINDS].sort());
    expect(kinds.length).toBe(5); // the documented default cap still applies
  });

  it('carries FR-D6-2 stock figures on a SUPPLY suggestion (quantity + unit), so distance is not the only input', () => {
    const supply: RankableResource = {
      ...resource('res-supply', { kind: 'SUPPLY' }),
      quantity: 12,
      unit: 'PALLET',
    };
    const res = suggestPrePositioning(
      input({ candidates: { resources: [supply], shelters: [] } }),
      fakeSpatial(),
    );
    expect(isOk(res)).toBe(true);
    const s = isOk(res) ? res.value.suggestions[0] : undefined;
    expect(s?.resourceKind).toBe('SUPPLY');
    expect(s?.quantity).toBe(12);
    expect(s?.unit).toBe('PALLET');
    expect(s?.headcount).toBeUndefined(); // team fields never attach to a supply lot
  });

  it('carries FR-D6-1 team figures on a TEAM suggestion (headcount + availability) — a tally, never a roster', () => {
    const team: RankableResource = {
      ...resource('res-team', { kind: 'TEAM' }),
      headcount: 8,
      availability: 'AVAILABLE',
    };
    const res = suggestPrePositioning(
      input({ candidates: { resources: [team], shelters: [] } }),
      fakeSpatial(),
    );
    const s = isOk(res) ? res.value.suggestions[0] : undefined;
    expect(s?.resourceKind).toBe('TEAM');
    expect(s?.headcount).toBe(8);
    expect(s?.availability).toBe('AVAILABLE');
    expect(s?.quantity).toBeUndefined(); // supply fields never attach to a team
  });

  it('gates the fields on the DOMAIN kind, not on which optional fields happen to be populated', () => {
    // An ENGINE row that somehow carries stray D6 fields must NOT surface them: the discriminator is the
    // entity's own `kind`, so a mislabelled record cannot leak a headcount onto an engine.
    const mislabelled: RankableResource = {
      ...resource('res-engine', { kind: 'ENGINE' }),
      quantity: 99,
      unit: 'CASE',
      headcount: 99,
      availability: 'COMMITTED',
    };
    const res = suggestPrePositioning(
      input({ candidates: { resources: [mislabelled], shelters: [] } }),
      fakeSpatial(),
    );
    const s = isOk(res) ? res.value.suggestions[0] : undefined;
    expect(s?.resourceKind).toBe('ENGINE');
    expect(s?.quantity).toBeUndefined();
    expect(s?.unit).toBeUndefined();
    expect(s?.headcount).toBeUndefined();
    expect(s?.availability).toBeUndefined();
  });

  it('omits an unknown figure rather than defaulting it to 0 (a fabricated "none left" is worse than silence)', () => {
    const bare: RankableResource = { ...resource('res-supply-bare', { kind: 'SUPPLY' }) };
    const team: RankableResource = { ...resource('res-team-bare', { kind: 'TEAM' }) };
    const res = suggestPrePositioning(
      input({ candidates: { resources: [bare, team], shelters: [] } }),
      fakeSpatial(),
    );
    const suggestions = isOk(res) ? res.value.suggestions : [];
    for (const s of suggestions) {
      expect(Object.keys(s)).not.toContain('quantity');
      expect(Object.keys(s)).not.toContain('headcount');
    }
  });

  it('a plain domain Resource is still a valid candidate (the widening is additive, callers unchanged)', () => {
    const plain: Resource = resource('res-plain');
    const res = suggestPrePositioning(
      input({ candidates: { resources: [plain], shelters: [] } }),
      fakeSpatial(),
    );
    expect(isOk(res) && res.value.suggestions.length).toBe(1);
  });
});
