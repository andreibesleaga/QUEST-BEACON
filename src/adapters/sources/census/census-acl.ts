// BEACON — US Census / ACS anti-corruption layer (E4·T-1xx; adapter-contract §4, PopulationPort P12,
// Art. XII). Maps a Census ACS 5-year `array-of-arrays` JSON response (header row + data rows:
// [population, name, state, county]) → a canonical PopulationEstimate. This is the ONLY place the raw
// Census array shape exists; no column-index knowledge escapes above this module (AGENTS.md §3).
//
// Honest limitation / documented simplification (Art. — honest limitations): Census does not return
// county geometry in this endpoint (TIGER/Line shapefiles would be a separate fetch we do not make here).
// For this demo we keep a tiny BUILTIN CA-county fips→centroid map (hand-picked, approximate — NOT an
// authoritative geocoder) and represent each county's "area" as a small deterministic box around its
// centroid. `estimatePopulation` (census-adapter.ts) later does a point-in-bbox membership test of each
// county's centroid against the caller's query bbox and sums the matching counties' populations. Rows for
// counties outside the builtin map, or with a non-numeric population, or with the wrong column count, are
// skipped at PARSE time (never silently dropped past this layer — they simply never reach the mapper).
import type { BBox } from '@/domain/index.js';
import type { PopulationEstimate } from '@/ports/infrastructure-sources.js';
import type { AntiCorruptionMapper } from '@/adapters/_shared/index.js';
import { makeAdapterError } from '@/adapters/_shared/index.js';

/** One parsed+validated ACS row: total population (B01003_001E) + county identity. */
export interface CensusRow {
  readonly population: number;
  readonly name: string;
  readonly state: string;
  readonly county: string; // 3-digit county FIPS, e.g. '007' (Butte)
}

/**
 * Tiny builtin CA-county fips → centroid map (hand-picked approximate lon/lat — NOT authoritative
 * geocoding; a real TIGER/Line centroid or polygon fetch is out of scope for this demo adapter). Covers
 * ~5 Sacramento-Valley CA counties including Butte (007), enough to demo a bbox-scoped population sum.
 */
export const CA_COUNTY_CENTROIDS: Readonly<Record<string, readonly [lon: number, lat: number]>> = {
  '007': [-121.6, 39.66], // Butte
  '021': [-122.4, 39.6], // Glenn
  '101': [-121.75, 39.15], // Sutter
  '067': [-121.35, 38.57], // Sacramento
  '113': [-121.9, 38.7], // Yolo
};

/** Half-width (degrees) of the deterministic box drawn around each county centroid. */
const CENTROID_BOX_DEG = 0.1;

/** Parse the Census array-of-arrays JSON: skip the header row and any malformed/out-of-scope row. */
export function parseCensusAcsRows(text: string): CensusRow[] {
  const doc: unknown = JSON.parse(text);
  if (!Array.isArray(doc) || doc.length === 0) return [];
  const rows: CensusRow[] = [];
  for (const raw of doc.slice(1)) {
    const row = parseOneRow(raw);
    if (row !== undefined) rows.push(row);
  }
  return rows;
}

function parseOneRow(raw: unknown): CensusRow | undefined {
  if (!Array.isArray(raw) || raw.length !== 4) return undefined; // wrong shape → skip
  const [popRaw, nameRaw, stateRaw, countyRaw] = raw as readonly unknown[];
  const population = Number(popRaw);
  if (!Number.isFinite(population)) return undefined; // non-numeric population → skip
  const county = String(countyRaw);
  if (!(county in CA_COUNTY_CENTROIDS)) return undefined; // outside the builtin demo set → skip
  return { population, name: String(nameRaw), state: String(stateRaw), county };
}

export const censusMapper: AntiCorruptionMapper<CensusRow, PopulationEstimate> = {
  toCanonical(raw: CensusRow): PopulationEstimate {
    const centroid = CA_COUNTY_CENTROIDS[raw.county];
    if (centroid === undefined) {
      // Defensive: parseCensusAcsRows already filters to known counties, but the ACL boundary itself
      // must never silently accept a row it cannot place (never-silently-dropped doctrine).
      throw makeAdapterError('PARSE', `Census row references unknown CA county fips '${raw.county}'`);
    }
    return { area: centroidBox(centroid), count: raw.population };
  },
};

function centroidBox([lon, lat]: readonly [number, number]): BBox {
  return [lon - CENTROID_BOX_DEG, lat - CENTROID_BOX_DEG, lon + CENTROID_BOX_DEG, lat + CENTROID_BOX_DEG];
}

/** Center point of a BBox (used to recover a per-county centroid from its stored area). */
export function bboxCenter(bbox: BBox): readonly [lon: number, lat: number] {
  return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
}

/** Point-in-bbox membership test (inclusive bounds), used to scope county sub-estimates to a query bbox. */
export function pointInBBox(point: readonly [lon: number, lat: number], bbox: BBox): boolean {
  const [lon, lat] = point;
  return lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}
