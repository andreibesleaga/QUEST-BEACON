// BEACON test harness — deterministic clock + id/uuid generators (TEST_PLAN §4 "in-memory builders").
// Tests must be reproducible: no wall-clock, no random uuid. These give a frozen instant and a
// monotonic, seedable id source so provenance ids / audit chains are byte-stable across runs.

/** A frozen "now" for the whole suite. All fixture timestamps sit at or before this instant. */
export const FIXED_NOW_ISO = '2026-07-01T00:00:00.000Z';
export const FIXED_NOW_MS = Date.parse(FIXED_NOW_ISO);

/** Injectable clock returning the frozen instant (matches RedundancyEngineDeps.nowIso). */
export function fixedNowIso(): string {
  return FIXED_NOW_ISO;
}

/**
 * Deterministic, monotonic id generator. `seq('src')` → `src-0000`, `src-0001`, … so provenance and
 * entity ids are stable and human-readable in a failure diff (never a random uuid).
 */
export function makeSeqIdGen(prefix = 'id'): () => string {
  let n = 0;
  return () => `${prefix}-${String(n++).padStart(4, '0')}`;
}

/**
 * A stable RFC-4122-shaped string derived from a counter — for ports that expect a uuid-looking id
 * without needing real randomness (deterministic provenance ids in RedundancyEngineDeps.idGen).
 */
export function makeSeqUuidGen(): () => string {
  let n = 0;
  return () => {
    const hex = (n++).toString(16).padStart(12, '0');
    return `00000000-0000-4000-8000-${hex}`;
  };
}
