// BEACON — the shelter-matching objective (SPEC §5.5; CONFIGURATION.md §12 `CAPACITY_MATCH_DIRECTION`).
//
// ONE definition of "which shelter should these evacuees be sent to", shared by every
// ResourceLogisticsPort implementation. It used to live inside `memory-logistics.rankShelters`, and that is
// precisely why the documented knob could not be honoured: a second store would have had to RE-TYPE the
// comparison, and a configured objective is only trustworthy when exactly one comparator reads it. Same
// defect class as the enum copies called out in `schema/logistics-tables.ts` — two declarations of one
// contract, drifting silently while `tsc` stays at 0.
//
// The ranking is DETERMINISTIC and server-side (Art. XII): the LLM never orders shelters and the client
// never re-sorts what it is handed.
import type { Shelter } from '@/domain/shelter.js';
import type { Position } from '@/domain/value-objects/geo.js';
import type { Env } from '@/config/index.js';

/**
 * DERIVED from EnvSchema, never retyped: the adapter cannot offer an objective the validated config is
 * unable to express, and adding a direction is one edit rather than two that must agree.
 */
export type CapacityMatchDirection = Env['CAPACITY_MATCH_DIRECTION'];

/** The EnvSchema default, restated as a value so a store built without config behaves exactly as today. */
export const DEFAULT_CAPACITY_MATCH_DIRECTION = 'maximize_availability_per_distance' satisfies CapacityMatchDirection;

/** Squared planar distance — comparison-only, so the square root (and its cost) is never needed. */
const dist2 = (a: Position, b: Position): number => {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
};

/**
 * Eligibility, shared by BOTH objectives and BOTH stores: OPEN and able to take at least one more person.
 * A FULL or CLOSED shelter is not a destination, and neither is one whose capacity is unknown — the
 * Postgres `shelter.capacity` column is nullable and a NULL hydrates to 0 here, so an unrecorded capacity
 * excludes the shelter instead of routing people to a building nobody has counted (Art. XVI: degrade
 * honestly). `pre-positioning.ts` mirrors this rule for its advisory ranking.
 */
export const hasSpareCapacity = (s: Shelter): boolean =>
  s.status === 'OPEN' && s.capacity - s.occupancy > 0;

interface Ranked {
  readonly s: Shelter;
  readonly key: number;
  readonly avail: number;
}

/**
 * The comparator for one objective.
 *
 * `maximize_availability_per_distance` (default) is TODAY'S behaviour, byte-for-byte: nearest first, and
 * where two shelters are equally far, the one with more headroom — so a convoy is not split across a site
 * that is about to fill. `minimize_distance` drops the second term entirely: the nearest eligible shelter
 * wins and equal-distance candidates keep their registry order.
 */
function comparatorFor(direction: CapacityMatchDirection): (a: Ranked, b: Ranked) => number {
  return direction === 'minimize_distance'
    ? (a, b) => a.key - b.key
    : (a, b) => a.key - b.key || b.avail - a.avail;
}

/** Eligible shelters for `near`, ordered by the configured objective. */
export function rankShelters(
  shelters: readonly Shelter[],
  near: Position,
  direction: CapacityMatchDirection = DEFAULT_CAPACITY_MATCH_DIRECTION,
): readonly Shelter[] {
  return shelters
    .filter(hasSpareCapacity)
    .map((s): Ranked => ({ s, key: dist2(near, s.geom.coordinates), avail: s.capacity - s.occupancy }))
    .sort(comparatorFor(direction))
    .map((x) => x.s);
}
