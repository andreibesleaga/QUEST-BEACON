// BEACON — deterministic map/prediction geometry helpers (E5/E8·W2b). Pure typed-code geometry math
// (Art. XII allows "Turf.js / SQL / typed code" — the LLM never computes these). No framework/adapter
// imports (F9/§4). Complements application/shared/geo.ts (great-circle + directional projection) with the
// BBox→AOI-ring, axis-aligned convex clip (Sutherland–Hodgman), shoelace area, and wire-rounding helpers the
// Phase-D map layers (outage AOIs) and the NFHL∩crest flood-impact projection need — all reproducible.
import type { Position, BBox, Geometry } from '@/domain/value-objects/geo.js';

/** Closed rectangle ring (5 positions, first == last) from an axis-aligned [minLon,minLat,maxLon,maxLat] box. */
export function bboxToRing(bbox: BBox): readonly Position[] {
  const [minX, minY, maxX, maxY] = bbox;
  return [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
    [minX, minY],
  ];
}

/** Grow a box outward by `marginDeg` on every side (used to size the crest-driven flood extent). */
export function expandBbox(bbox: BBox, marginDeg: number): BBox {
  const [minX, minY, maxX, maxY] = bbox;
  return [minX - marginDeg, minY - marginDeg, maxX + marginDeg, maxY + marginDeg];
}

/** Axis-aligned bounding box of any geometry's coordinates (recursive over the nested position arrays). */
export function boundsOf(geom: Geometry): BBox {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const visit = (node: unknown): void => {
    if (Array.isArray(node) && typeof node[0] === 'number' && typeof node[1] === 'number') {
      minX = Math.min(minX, node[0]);
      maxX = Math.max(maxX, node[0]);
      minY = Math.min(minY, node[1]);
      maxY = Math.max(maxY, node[1]);
    } else if (Array.isArray(node)) {
      for (const child of node) visit(child);
    }
  };
  visit(geom.coordinates);
  return [minX, minY, maxX, maxY];
}

/** Absolute shoelace area of a ring (degrees²) — used only to reject sliver/empty clip results, not for reporting. */
export function ringArea(ring: readonly Position[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(sum) / 2;
}

type Keep = (p: Position) => boolean;
type Cross = (a: Position, b: Position) => Position;

/** One Sutherland–Hodgman pass: keep vertices inside a half-plane, inserting edge-crossing points. */
function clipHalfPlane(pts: readonly Position[], keep: Keep, cross: Cross): readonly Position[] {
  const out: Position[] = [];
  for (let i = 0; i < pts.length; i++) {
    const cur = pts[i]!;
    const prev = pts[(i + pts.length - 1) % pts.length]!;
    const curIn = keep(cur);
    const prevIn = keep(prev);
    if (curIn) {
      if (!prevIn) out.push(cross(prev, cur));
      out.push(cur);
    } else if (prevIn) {
      out.push(cross(prev, cur));
    }
  }
  return out;
}

/** Drop a ring's duplicated closing vertex (if present) to an open vertex list. */
function openRing(ring: readonly Position[]): readonly Position[] {
  if (ring.length < 2) return ring;
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  return first[0] === last[0] && first[1] === last[1] ? ring.slice(0, -1) : ring;
}

const crossAtX = (a: Position, b: Position, x: number): Position => {
  const t = (x - a[0]) / (b[0] - a[0]);
  return [x, a[1] + t * (b[1] - a[1])];
};
const crossAtY = (a: Position, b: Position, y: number): Position => {
  const t = (y - a[1]) / (b[1] - a[1]);
  return [a[0] + t * (b[0] - a[0]), y];
};

/**
 * Clip a (simple) polygon ring against an axis-aligned rectangle via Sutherland–Hodgman (the rectangle is
 * convex, so the algorithm is exact for it). Returns a CLOSED ring, or [] when the ring falls fully outside
 * the rectangle. Deterministic, pure — the deterministic stand-in for a Turf polygon∩polygon.
 */
export function clipRingToRect(ring: readonly Position[], rect: BBox): readonly Position[] {
  const [minX, minY, maxX, maxY] = rect;
  let pts = openRing(ring);
  pts = clipHalfPlane(
    pts,
    (p) => p[0] >= minX,
    (a, b) => crossAtX(a, b, minX),
  );
  pts = clipHalfPlane(
    pts,
    (p) => p[0] <= maxX,
    (a, b) => crossAtX(a, b, maxX),
  );
  pts = clipHalfPlane(
    pts,
    (p) => p[1] >= minY,
    (a, b) => crossAtY(a, b, minY),
  );
  pts = clipHalfPlane(
    pts,
    (p) => p[1] <= maxY,
    (a, b) => crossAtY(a, b, maxY),
  );
  if (pts.length < 3) return [];
  return [...pts, pts[0]!];
}

const DEFAULT_ROUND_DP = 6; // ~0.1 m — tightens wire payloads without moving any real coordinate.

/** Round a position to `dp` decimals (deterministic wire tidy-up; the default is sub-metre, so a no-op on seed data). */
export function roundPosition(p: Position, dp: number = DEFAULT_ROUND_DP): Position {
  const f = 10 ** dp;
  return [Math.round(p[0] * f) / f, Math.round(p[1] * f) / f];
}

/** Round every position of every ring (polygon coordinates) to `dp` decimals. */
export function roundRings(
  rings: readonly (readonly Position[])[],
  dp: number = DEFAULT_ROUND_DP,
): readonly (readonly Position[])[] {
  return rings.map((ring) => ring.map((p) => roundPosition(p, dp)));
}

/** 8-point compass label for a bearing in degrees (deterministic; used to describe wind FROM direction). */
export function compass8(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
  const idx = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return dirs[idx]!;
}
