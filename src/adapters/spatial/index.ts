// BEACON — SpatialPort adapter selector (FEATURE_SPATIAL: Turf.js default ↔ PostGIS flag; ADR-005).
import type { SpatialPort } from '@/ports/infra.js';
import { makeTurfSpatialPort } from './turf-spatial.js';
import { makePostgisSpatialPort } from './postgis-spatial.js';

export { makeTurfSpatialPort, TurfSpatialPort } from './turf-spatial.js';
export { makePostgisSpatialPort, PostgisSpatialPort } from './postgis-spatial.js';

/**
 * Build the active SpatialPort. Reads `process.env.FEATURE_SPATIAL` when `mode` is omitted;
 * `'postgis'` selects the (stubbed) PostGIS flag path, anything else falls back to Turf.js (default).
 */
export function makeSpatialPort(mode?: string): SpatialPort {
  const selected = mode ?? process.env.FEATURE_SPATIAL ?? 'turf';
  return selected === 'postgis' ? makePostgisSpatialPort() : makeTurfSpatialPort();
}
