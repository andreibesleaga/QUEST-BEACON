// BEACON — Coverage gating (E4·T-143; adapter-contract §3 Coverage, OP4). Decides whether an adapter has
// data for a region so the redundancy ladder can return NOT_COVERED (not empty) → the UI renders
// "not available in this region" instead of a silent blank layer.
import type { Coverage, Region } from './contract.js';

export function isCovered(coverage: Coverage, region: Region): boolean {
  if (coverage.kind === 'GLOBAL') return true;
  if (coverage.kind === 'BBOX') return bboxIntersects(coverage.bbox, region.bbox);
  return region.iso !== undefined && coverage.iso.includes(region.iso);
}

/** Axis-aligned bbox overlap ([minLon,minLat,maxLon,maxLat]). */
function bboxIntersects(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
): boolean {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}
