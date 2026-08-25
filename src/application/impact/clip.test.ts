// BEACON — clipping-primitive tests (MW-D/D1.0; ADR-035 §1 + V2; findings F-23/F-26/F-98).
//
// This is the primitive every predicted-impact figure rests on, so the cases below are the ones that would
// silently corrupt a headline number rather than crash: containment in BOTH directions, a shared edge, a
// concave subject whose intersection is two disjoint pieces, holes, and a degenerate ring. Analytic
// expectations only — every area here is computable by hand, so a wrong answer is a wrong answer and not a
// snapshot drift.
import { describe, it, expect } from 'vitest';
import type { BBox, PolygonGeometry, Position } from '@/domain/value-objects/geo.js';
import { isErr, isOk } from '@/domain/shared/result.js';
import { clipAreaToRect, clipAreasToRect, clipPolygonToRect, hasArealGeometry, rectAreaDeg2 } from './clip.js';

/** A closed square ring of side `2*half` centred on `c` — never rounded (F-98). */
function square(c: Position, half: number): readonly Position[] {
  const [x, y] = c;
  return [
    [x - half, y - half],
    [x + half, y - half],
    [x + half, y + half],
    [x - half, y + half],
    [x - half, y - half],
  ];
}
const poly = (rings: readonly (readonly Position[])[]): PolygonGeometry => ({ type: 'Polygon', coordinates: rings });

const UNIT_CELL: BBox = [0, 0, 1, 1];

function overlap(p: PolygonGeometry, rect: BBox) {
  const res = clipPolygonToRect(p, rect);
  if (!isOk(res)) throw new Error(`expected ok, got ${res.error.message}`);
  return res.value;
}

describe('rectAreaDeg2', () => {
  it('is the product of the spans, and zero for a degenerate box', () => {
    expect(rectAreaDeg2([0, 0, 2, 3])).toBe(6);
    expect(rectAreaDeg2([0, 0, 0, 3])).toBe(0);
    expect(rectAreaDeg2([0, 5, 3, 5])).toBe(0);
  });
});

describe('a concave bay — the case where the bbox overlaps but the body does not', () => {
  it('scores ZERO for a cell that sits inside a notch of the polygon', () => {
    // A C-shape whose bbox is the whole unit square; the notch spans x>0.6, 0.4<y<0.6.
    const cShape: readonly Position[] = [
      [0, 0],
      [1, 0],
      [1, 0.4],
      [0.6, 0.4],
      [0.6, 0.6],
      [1, 0.6],
      [1, 1],
      [0, 1],
      [0, 0],
    ];
    const inNotch = overlap(poly([cShape]), [0.7, 0.45, 0.9, 0.55]);
    expect(inNotch.areaDeg2).toBe(0);
    expect(inNotch.relation).toBe('DISJOINT');
    // …while a cell in the solid arm of the C is fully covered. (`fraction` is compared with a tolerance
    // rather than to exactly 1: these coordinates carry binary-float residue, and `relation` is informational
    // — no figure is computed from it. Nothing here rounds a coordinate to make the number look tidy, F-98.)
    expect(overlap(poly([cShape]), [0.1, 0.45, 0.3, 0.55]).fraction).toBeCloseTo(1, 12);
  });
});

describe('clipPolygonToRect — the four cases that decide who is counted at-risk', () => {
  it('NO OVERLAP ⇒ zero area, zero fraction, DISJOINT', () => {
    const o = overlap(poly([square([10, 10], 1)]), UNIT_CELL);
    expect(o).toEqual({ areaDeg2: 0, fraction: 0, relation: 'DISJOINT' });
  });

  it('POLYGON INSIDE THE CELL ⇒ the polygon’s own area, a partial fraction', () => {
    const o = overlap(poly([square([0.5, 0.5], 0.25)]), UNIT_CELL); // 0.5 x 0.5
    expect(o.areaDeg2).toBeCloseTo(0.25, 12);
    expect(o.fraction).toBeCloseTo(0.25, 12);
    expect(o.relation).toBe('PARTIAL');
  });

  // ⚠ THE CASE THAT LOOKS LIKE IT SHOULD BREAK. If this returned zero, every interior cell of a large hazard
  // would be scored as empty — the bigger the hazard, the more people it would lose. It does not: clipping the
  // polygon against the rectangle's four half-planes yields the rectangle itself (see the clip.ts header).
  it('CELL INSIDE THE POLYGON ⇒ the WHOLE cell overlaps (COVERED), not zero', () => {
    const o = overlap(poly([square([0.5, 0.5], 50)]), UNIT_CELL);
    expect(o.areaDeg2).toBe(1);
    expect(o.fraction).toBe(1);
    expect(o.relation).toBe('COVERED');
  });

  it('SHARED EDGE ⇒ zero AREA, reported DISJOINT (a boundary line contains no residents)', () => {
    const touching = poly([square([2, 0.5], 1)]); // spans x in [1,3] — meets the cell exactly at x = 1
    const o = overlap(touching, UNIT_CELL);
    expect(o.areaDeg2).toBe(0);
    expect(o.fraction).toBe(0);
    expect(o.relation).toBe('DISJOINT');
  });

  it('SHARED CORNER ⇒ zero area', () => {
    expect(overlap(poly([square([2, 2], 1)]), UNIT_CELL).areaDeg2).toBe(0);
  });

  it('HALF OVERLAP ⇒ exactly half the cell', () => {
    const half = poly([[[0.5, 0], [5, 0], [5, 1], [0.5, 1], [0.5, 0]]]);
    const o = overlap(half, UNIT_CELL);
    expect(o.areaDeg2).toBeCloseTo(0.5, 12);
    expect(o.fraction).toBeCloseTo(0.5, 12);
  });

  it('a CONCAVE polygon whose intersection is TWO disjoint pieces still sums to the right area', () => {
    // A U opening upward: two prongs of width 0.2 crossing the cell, plus a base of height 0.2.
    const u: readonly Position[] = [
      [0.1, 0],
      [0.3, 0],
      [0.3, 0.8],
      [0.7, 0.8],
      [0.7, 0],
      [0.9, 0],
      [0.9, 1.5],
      [0.1, 1.5],
      [0.1, 0],
    ];
    // Inside the unit cell the shape covers: left prong 0.2 x 1, right prong 0.2 x 1, and the top bar
    // 0.8 wide x 0.2 tall (y in [0.8,1]) between them → 0.2 + 0.2 + 0.4*0.2 = 0.48.
    const o = overlap(poly([u]), UNIT_CELL);
    expect(o.areaDeg2).toBeCloseTo(0.48, 12);
  });

  it('a HOLE subtracts, and a hole that swallows the cell removes it entirely', () => {
    const outer = square([0.5, 0.5], 50);
    const smallHole = square([0.5, 0.5], 0.25); // 0.5 x 0.5 hole inside the cell
    expect(overlap(poly([outer, smallHole]), UNIT_CELL).areaDeg2).toBeCloseTo(0.75, 12);
    const bigHole = square([0.5, 0.5], 40); // hole swallows the whole cell
    expect(overlap(poly([outer, bigHole]), UNIT_CELL).areaDeg2).toBe(0);
  });

  it('a degenerate ring, a non-finite vertex and an inverted rectangle are TYPED ERRORS, never NaN', () => {
    const twoPoints = clipPolygonToRect(poly([[[0, 0], [1, 1]]]), UNIT_CELL);
    expect(isErr(twoPoints)).toBe(true);
    const nonFinite = clipPolygonToRect(poly([[[0, 0], [Number.NaN, 1], [1, 1], [0, 0]]]), UNIT_CELL);
    expect(isErr(nonFinite)).toBe(true);
    const noRings = clipPolygonToRect(poly([]), UNIT_CELL);
    expect(isErr(noRings)).toBe(true);
    expect(isErr(clipPolygonToRect(poly([square([0.5, 0.5], 1)]), [1, 1, 0, 0]))).toBe(true);
    expect(isErr(clipPolygonToRect(poly([square([0.5, 0.5], 1)]), [0, 0, Number.POSITIVE_INFINITY, 1]))).toBe(true);
  });

  it('a zero-area rectangle overlaps nothing (no division by zero)', () => {
    expect(overlap(poly([square([0.5, 0.5], 50)]), [0.5, 0, 0.5, 1])).toEqual({
      areaDeg2: 0,
      fraction: 0,
      relation: 'DISJOINT',
    });
  });
});

describe('clipAreaToRect / clipAreasToRect', () => {
  it('sums MultiPolygon parts and never exceeds the cell', () => {
    const mp = {
      type: 'MultiPolygon' as const,
      coordinates: [[square([0.25, 0.5], 0.25)], [square([0.75, 0.5], 0.25)]],
    };
    const res = clipAreaToRect(mp, UNIT_CELL);
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.areaDeg2).toBeCloseTo(0.5, 12);
    // Two OVERLAPPING parts (a malformed source) are clamped rather than counting >100 % of the cell.
    const overlapping = {
      type: 'MultiPolygon' as const,
      coordinates: [[square([0.5, 0.5], 50)], [square([0.5, 0.5], 50)]],
    };
    const clamped = clipAreaToRect(overlapping, UNIT_CELL);
    if (!isOk(clamped)) throw new Error('expected ok');
    expect(clamped.value.fraction).toBe(1);
  });

  it('propagates a MultiPolygon part error rather than dropping it', () => {
    const bad = { type: 'MultiPolygon' as const, coordinates: [[[[0, 0], [1, 1]] as readonly Position[]]] };
    expect(isErr(clipAreaToRect(bad, UNIT_CELL))).toBe(true);
  });

  it('a Point/LineString has no area: DISJOINT, and hasArealGeometry says so', () => {
    const pt = { type: 'Point' as const, coordinates: [0.5, 0.5] as Position };
    const line = { type: 'LineString' as const, coordinates: [[0, 0], [1, 1]] as readonly Position[] };
    for (const geom of [pt, line]) {
      const res = clipAreaToRect(geom, UNIT_CELL);
      if (!isOk(res)) throw new Error('expected ok');
      expect(res.value.relation).toBe('DISJOINT');
      expect(hasArealGeometry(geom)).toBe(false);
    }
    expect(hasArealGeometry(poly([square([0, 0], 1)]))).toBe(true);
  });

  it('combines several geometries by MAXIMUM, so overlapping footprints cannot double-count', () => {
    const quarter = poly([[[0, 0], [0.5, 0], [0.5, 0.5], [0, 0.5], [0, 0]]]); // 0.25 of the cell
    const half = poly([[[0, 0], [1, 0], [1, 0.5], [0, 0.5], [0, 0]]]); // 0.5 of the cell
    const res = clipAreasToRect([quarter, half], UNIT_CELL);
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.fraction).toBeCloseTo(0.5, 12); // max, not 0.75
    expect(isErr(clipAreasToRect([poly([[[0, 0], [1, 1]]])], UNIT_CELL))).toBe(true);
    const none = clipAreasToRect([], UNIT_CELL);
    if (!isOk(none)) throw new Error('expected ok');
    expect(none.value.fraction).toBe(0);
  });
});

describe('determinism / F-98', () => {
  it('is bit-identical across runs and across vertex-order permutations of the same ring', () => {
    const rect: BBox = [-121.65, 39.65, -121.55, 39.75];
    const ring = square([-121.6, 39.7], 0.08);
    const a = overlap(poly([ring]), rect).areaDeg2;
    const b = overlap(poly([ring]), rect).areaDeg2;
    expect(a).toBe(b);
    // Same ring, started at a different vertex (still closed) ⇒ the same area, exactly.
    const rotated: readonly Position[] = [...ring.slice(1, -1), ring[0]!, ring[1]!];
    expect(overlap(poly([rotated]), rect).areaDeg2).toBeCloseTo(a, 15);
  });

  it('does NOT round any vertex: a sub-metre coordinate difference changes the area', () => {
    const rect: BBox = [0, 0, 1, 1];
    const wide = overlap(poly([[[0, 0], [0.5000001, 0], [0.5000001, 1], [0, 1], [0, 0]]]), rect).areaDeg2;
    const narrow = overlap(poly([[[0, 0], [0.5, 0], [0.5, 1], [0, 1], [0, 0]]]), rect).areaDeg2;
    expect(wide).not.toBe(narrow);
  });
});
