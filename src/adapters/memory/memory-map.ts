// BEACON — in-memory MapReadModel (E8·map; Art. XVI offline-first). The DEFAULT, air-gapped wiring for the
// map-projection read-model: a region-keyed table of RAW map INPUTS, from which the exposure layer + prediction
// cone are COMPUTED on each read via the derivation seam (src/application/derivation) — numbers come from the
// engines, never hand-seeded (Art. XII). Zero infra. The Postgres/live equivalents plug in behind flags
// (config switch, not a rewrite). Adapters may import application use-cases (only application→adapters is
// forbidden); the SpatialPort defaults to Turf.js (offline) but is injectable by the composition root.
import type { Result } from '@/domain/shared/result.js';
import { ok } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { SpatialPort } from '@/ports/infra.js';
import type { RegionId } from '@/domain/value-objects/ids.js';
import type { MapReadModel, MapSource } from '@/application/map-projection/map-projection.js';
import { deriveMapSource, type MapDerivationInput } from '@/application/derivation/derive-cop.js';
import { makeTurfSpatialPort } from '@/adapters/spatial/turf-spatial.js';

/** Offline map dataset: regionId → the region's RAW derivation inputs. */
export type MapInputsSeed = Readonly<Record<string, MapDerivationInput>>;

/** Backwards-compatible alias (the seed is now raw INPUTS, not a pre-baked MapSource). */
export type MapSeed = MapInputsSeed;

function sourceFor(
  seed: MapInputsSeed,
  spatial: SpatialPort,
  regionId: RegionId,
): Result<MapSource | null, DomainError> {
  const input = seed[String(regionId)];
  if (input === undefined) return ok(null); // unknown region → null (→ 404 upstream)
  return deriveMapSource(input, spatial);
}

/**
 * A MapReadModel over a static input seed. Pure derivation — no IO, no clock. Exposure/prediction are computed
 * per read through the injected SpatialPort (defaults to Turf.js offline). Unknown region → null (→ 404).
 */
export function makeMemoryMapReadModel(
  seed: MapInputsSeed,
  spatial: SpatialPort = makeTurfSpatialPort(),
): MapReadModel {
  return {
    sourceFor: (regionId: RegionId): Promise<Result<MapSource | null, DomainError>> =>
      Promise.resolve(sourceFor(seed, spatial, regionId)),
  };
}
