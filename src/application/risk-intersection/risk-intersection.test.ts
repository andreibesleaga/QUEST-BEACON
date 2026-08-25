import { describe, it, expect } from 'vitest';
import type { SpatialPort } from '@/ports/index.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { Geometry, PolygonGeometry, Position } from '@/domain/value-objects/geo.js';
import { ok, err, isOk, isErr } from '@/domain/shared/result.js';
import { InvariantViolation } from '@/domain/errors.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { IncidentId, InfrastructureNodeId, SourceId } from '@/domain/value-objects/ids.js';
import { makeInfrastructureNode } from '@/domain/infrastructure-node.js';
import { makeHazardGeometry, exposureBearingHazards } from '@/domain/hazard-geometry.js';
import type { HazardKind } from '@/domain/hazard-geometry.js';
import { computeExposures } from './risk-intersection.js';
import type { ExposureQuery } from './risk-intersection.js';

const INCIDENT = asId<IncidentId>('inc-1');
const SRC = asId<SourceId>('src-1');
const AT = '2026-07-07T00:00:00.000Z';

const HAZARD_POLY: PolygonGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ],
  ],
};

function hazard(geometry: Geometry = HAZARD_POLY) {
  return makeHazardGeometry({
    id: asId('hz-1'),
    incidentId: INCIDENT,
    sourceId: SRC,
    kind: 'PERIMETER',
    geometry,
    observedAt: AT,
  });
}

function node(id: string, coords: Position = [0.5, 0.5], type: 'HOSPITAL' | 'ROAD' = 'HOSPITAL') {
  return makeInfrastructureNode({
    id: asId<InfrastructureNodeId>(id),
    type,
    geom: { type: 'Point', coordinates: coords },
  });
}

/** Configurable fake SpatialPort — each op returns a fixed answer or an injected error. */
function fakeSpatial(overrides: Partial<SpatialPort> = {}): SpatialPort {
  const buffered: PolygonGeometry = { type: 'Polygon', coordinates: [[[0, 0]]] as never };
  return {
    pointInPolygon: () => ok(false),
    buffer: () => ok(buffered),
    intersect: () => ok(false),
    ...overrides,
  };
}

function baseQuery(over: Partial<ExposureQuery> = {}): ExposureQuery {
  return {
    incidentId: INCIDENT,
    hazards: [hazard()],
    nodes: [node('n1')],
    buffers: { HOSPITAL: 500, ROAD: 100 } as ExposureQuery['buffers'],
    computedAt: AT,
    ...over,
  };
}

describe('computeExposures', () => {
  it('marks a node inside a hazard polygon as IN_POLYGON + insideHazard', () => {
    const res = computeExposures(baseQuery(), fakeSpatial({ pointInPolygon: () => ok(true) }));
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.exposures).toHaveLength(1);
    expect(res.value.exposures[0]?.reason).toBe('IN_POLYGON');
    expect(res.value.exposures[0]?.insideHazard).toBe(true);
  });

  it('marks a node whose buffer intersects a hazard as IN_BUFFER (not inside)', () => {
    const res = computeExposures(
      baseQuery(),
      fakeSpatial({ pointInPolygon: () => ok(false), intersect: () => ok(true) }),
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.exposures[0]?.reason).toBe('IN_BUFFER');
    expect(res.value.exposures[0]?.insideHazard).toBe(false);
  });

  it('emits no exposure row for a node outside polygon and buffer', () => {
    const res = computeExposures(baseQuery(), fakeSpatial());
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.exposures).toHaveLength(0);
  });

  it('marks a declared outage node as OUTAGE without any geometry test', () => {
    let called = false;
    const spatial = fakeSpatial({
      pointInPolygon: () => {
        called = true;
        return ok(true);
      },
    });
    const res = computeExposures(baseQuery({ outageNodeIds: [asId('n1')] }), spatial);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.exposures[0]?.reason).toBe('OUTAGE');
    expect(called).toBe(false);
  });

  it('returns an empty result for no nodes', () => {
    const res = computeExposures(baseQuery({ nodes: [] }), fakeSpatial());
    expect(isOk(res) && res.value.exposures).toHaveLength(0);
  });

  it('decomposes a MultiPolygon hazard into polygons for the containment test', () => {
    const multi: Geometry = {
      type: 'MultiPolygon',
      coordinates: [HAZARD_POLY.coordinates],
    };
    const seen: string[] = [];
    const spatial = fakeSpatial({
      pointInPolygon: (_p: Position, poly: PolygonGeometry) => {
        seen.push(poly.type);
        return ok(true);
      },
    });
    const res = computeExposures(baseQuery({ hazards: [hazard(multi)] }), spatial);
    expect(isOk(res)).toBe(true);
    expect(seen).toEqual(['Polygon']);
  });

  it('propagates a pointInPolygon port error', () => {
    const boom: Result<boolean, DomainError> = err(new InvariantViolation('pip'));
    const res = computeExposures(baseQuery(), fakeSpatial({ pointInPolygon: () => boom }));
    expect(isErr(res)).toBe(true);
  });

  it('propagates a buffer port error', () => {
    const boom = err(new InvariantViolation('buf'));
    const res = computeExposures(baseQuery(), fakeSpatial({ buffer: () => boom }));
    expect(isErr(res)).toBe(true);
  });

  it('propagates an intersect port error', () => {
    const boom: Result<boolean, DomainError> = err(new InvariantViolation('int'));
    const res = computeExposures(baseQuery(), fakeSpatial({ intersect: () => boom }));
    expect(isErr(res)).toBe(true);
  });

  it('handles non-polygon hazards (no polygons to contain) then buffer-classifies', () => {
    const line: Geometry = {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [1, 1],
      ],
    };
    const res = computeExposures(
      baseQuery({ hazards: [hazard(line)] }),
      fakeSpatial({ intersect: () => ok(true) }),
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.exposures[0]?.reason).toBe('IN_BUFFER');
  });
});

// ── Storm family (ADR-032 §3; FR-STORM-3 / FEV-6) ─────────────────────────────────────────────────
//
// Two separate claims, deliberately tested with a GEOMETRY-HONEST spatial port (real ray-cast + real bbox
// overlap) rather than the fixed-answer fake above, so the surge extent itself decides the outcome:
//
//   (a) STORM_SURGE is classified exactly like FLOOD_REACH. `computeExposures` never branches on `kind`
//       (F-18), so this needed no engine change — and this test is what keeps it that way.
//   (b) TRACK/CONE never reach the engine. The engine's kind-agnosticism means it CANNOT defend itself
//       here: passing a cone in would happily produce an IN_POLYGON row from a positional-uncertainty
//       envelope. The guard therefore lives in `exposureBearingHazards`, at every query builder — and the
//       last case below pins the wrong answer the filter is there to prevent.

/** A ray-cast / bbox-overlap SpatialPort: real inside/outside, so a geometry change moves the result. */
function geometrySpatial(): SpatialPort {
  const inRing = (pt: readonly [number, number], ring: readonly Position[]): boolean => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      const crosses = yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi;
      if (crosses) inside = !inside;
    }
    return inside;
  };
  const bounds = (geom: Geometry): [number, number, number, number] => {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    const visit = (node: unknown): void => {
      if (Array.isArray(node) && typeof node[0] === 'number' && typeof node[1] === 'number') {
        a = Math.min(a, node[0]); c = Math.max(c, node[0]);
        b = Math.min(b, node[1]); d = Math.max(d, node[1]);
      } else if (Array.isArray(node)) for (const child of node) visit(child);
    };
    visit(geom.coordinates);
    return [a, b, c, d];
  };
  return {
    pointInPolygon: (pt, poly) => ok(inRing(pt, poly.coordinates[0] ?? [])),
    buffer: (geom, meters) => {
      const dd = meters / 111_320;
      const [w, s, e, n] = bounds(geom);
      return ok({
        type: 'Polygon',
        coordinates: [[[w - dd, s - dd], [e + dd, s - dd], [e + dd, n + dd], [w - dd, n + dd], [w - dd, s - dd]]],
      });
    },
    intersect: (x, y) => {
      const A = bounds(x), B = bounds(y);
      return ok(!(A[2] < B[0] || A[0] > B[2] || A[3] < B[1] || A[1] > B[3]));
    },
  };
}

/** The storm's surge / cone footprint: the unit square [0,1]² (same extent as HAZARD_POLY). */
const STORM_EXTENT: PolygonGeometry = HAZARD_POLY;
const STORM_TRACK: Geometry = { type: 'LineString', coordinates: [[0.2, 0.2], [0.8, 0.8]] };

function kinded(kind: HazardKind, geometry: Geometry = STORM_EXTENT) {
  return makeHazardGeometry({
    id: asId(`hz-${kind}`),
    incidentId: INCIDENT,
    sourceId: SRC,
    kind,
    geometry,
    observedAt: AT,
  });
}

function reasonsFor(hazards: readonly ReturnType<typeof kinded>[], at: Position): readonly string[] {
  const res = computeExposures(baseQuery({ hazards, nodes: [node('n1', at)] }), geometrySpatial());
  return isOk(res) ? res.value.exposures.map((e) => e.reason) : ['<err>'];
}

describe('STORM_SURGE exposure — identical to FLOOD_REACH (FEV-6)', () => {
  it('classifies a node inside the surge extent as IN_POLYGON, exactly as a flood reach does', () => {
    expect(reasonsFor([kinded('STORM_SURGE')], [0.5, 0.5])).toEqual(['IN_POLYGON']);
    expect(reasonsFor([kinded('STORM_SURGE')], [0.5, 0.5])).toEqual(reasonsFor([kinded('FLOOD_REACH')], [0.5, 0.5]));
  });

  it('classifies a node just outside the surge extent as IN_BUFFER, exactly as a flood reach does', () => {
    // 0.004° ≈ 445 m beyond the extent — inside the 500 m HOSPITAL buffer, so buffered, not contained.
    const query = (kind: HazardKind): readonly string[] => {
      const res = computeExposures(
        baseQuery({ hazards: [kinded(kind)], nodes: [node('n1', [1.004, 0.5])] }),
        geometrySpatial(),
      );
      return isOk(res) ? res.value.exposures.map((e) => e.reason) : ['<err>'];
    };
    expect(query('STORM_SURGE')).toEqual(['IN_BUFFER']);
    expect(query('STORM_SURGE')).toEqual(query('FLOOD_REACH'));
  });

  it('emits no row for a node far from the surge extent (the surge, not the kind, decides)', () => {
    expect(reasonsFor([kinded('STORM_SURGE')], [40, 40])).toEqual([]);
  });

  it('survives the exposure filter — surge is impact-bearing, so the query builder keeps it', () => {
    const kept = exposureBearingHazards([kinded('STORM_SURGE')]);
    expect(kept).toHaveLength(1);
    expect(reasonsFor([...kept], [0.5, 0.5])).toEqual(['IN_POLYGON']);
  });
});

describe('TRACK / CONE exposure — advisory geometry is excluded (ADR-032 §3, Art. XII)', () => {
  it('yields NO exposure for a node inside the forecast cone once the query builder has filtered', () => {
    const advisoryOnly = exposureBearingHazards([kinded('TRACK', STORM_TRACK), kinded('CONE')]);
    expect(advisoryOnly).toEqual([]);
    expect(reasonsFor([...advisoryOnly], [0.5, 0.5])).toEqual([]);
  });

  it('keeps only the surge when an advisory ships all three geometries together', () => {
    const all = [kinded('TRACK', STORM_TRACK), kinded('CONE'), kinded('STORM_SURGE')];
    const filtered = exposureBearingHazards(all);
    expect(filtered.map((h) => h.kind)).toEqual(['STORM_SURGE']);
    // The node is geometrically inside all three, yet exactly ONE row is produced — from the surge.
    expect(reasonsFor([...filtered], [0.5, 0.5])).toEqual(['IN_POLYGON']);
  });

  it('documents the wrong answer the filter prevents: unfiltered, the engine would count the cone', () => {
    // `computeExposures` is kind-agnostic BY DESIGN (F-18) — it cannot reject a cone itself. Handing it one
    // produces an exposure row derived from a track-centre uncertainty envelope: a number computed from the
    // wrong semantic input. This is precisely why the exclusion lives in the query builder, not here.
    expect(reasonsFor([kinded('CONE')], [0.5, 0.5])).toEqual(['IN_POLYGON']);
  });
});
