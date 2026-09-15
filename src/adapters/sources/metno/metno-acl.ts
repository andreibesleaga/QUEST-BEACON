// BEACON — MET Norway Locationforecast anti-corruption layer (S2·Lane A3; adapter-contract §4,
// WeatherSourcePort P3, Art. XII). Maps one step of an `api.met.no/weatherapi/locationforecast/2.0/compact`
// GeoJSON Feature → a port-local WeatherObservation. This is the ONLY place the raw met.no shape exists;
// no met.no field name escapes above this module (AGENTS.md §3). Numbers are produced deterministically
// here — never by the LLM.
//
// VERIFIED LIVE (2026-08-08, real GET against https://api.met.no with an identifying User-Agent):
//   GET /weatherapi/locationforecast/2.0/compact?lat=45.75&lon=27.15  → HTTP 200, application/json, ~41 kB
//   Body shape (recorded verbatim into __fixtures__/locationforecast.json, trimmed to 3 steps):
//     { "type":"Feature",
//       "geometry":{"type":"Point","coordinates":[27.15,45.75,78]},          ← [lon, lat, altitude_m]
//       "properties":{ "meta":{"updated_at":"…Z","units":{…}},
//                      "timeseries":[{"time":"2026-08-08T07:00:00Z",
//                                     "data":{"instant":{"details":{
//                                        "air_pressure_at_sea_level":1013.9,"air_temperature":26.1,
//                                        "cloud_area_fraction":4.7,"relative_humidity":61.9,
//                                        "wind_from_direction":339.8,"wind_speed":7.9}}, …}}, …]}}
//   The `units` block of that live response declares wind_speed in **m/s**, air_temperature in **celsius**,
//   relative_humidity in **%** and wind_from_direction in **degrees** — exactly the units WeatherObservation
//   expects, so this ACL performs NO unit conversion (and must not invent one).
//
// LENIENT by contract (S2 recipe): unknown/extra fields are ignored (met.no adds variables over time —
// `next_1_hours`, `precipitation_amount`, symbol codes … — and a new key must never break ingestion), and a
// structurally malformed step is DROPPED **and COUNTED** at parse time (`MetnoParseResult.skipped`) rather
// than thrown, so one bad step in a 90-step forecast can never dead-end the COP (Art. XVI). Anything that
// does reach the mapper and still cannot be mapped raises a typed PARSE — never a silent drop.
//
// HONEST LIMITATION: Locationforecast is a POINT model forecast (the bbox centre), not an official warning
// product and not an area observation. It corroborates Open-Meteo; it is not an authority on warnings
// (MeteoAlarm/NWS are). Step 0 is the nowcast-ish instant, later steps are forecast — every step carries its
// own `at`, so downstream code never has to guess which is which.
import type { WeatherObservation } from '@/ports/data-sources.js';
import { definedOnly } from '@/domain/index.js';
import type { AntiCorruptionMapper } from '@/adapters/_shared/index.js';
import { makeAdapterError } from '@/adapters/_shared/index.js';

/** The met.no `instant.details` block. Every member optional — met.no omits variables it has no value for. */
export interface MetnoInstantDetails {
  readonly air_temperature?: number | string | null;
  readonly relative_humidity?: number | string | null;
  readonly wind_speed?: number | string | null;
  readonly wind_from_direction?: number | string | null;
}

/** One raw met.no timeseries step, flattened with the Feature's site position. Raw until mapped. */
export interface MetnoRaw {
  readonly time: string;
  readonly position: readonly [lon: number, lat: number];
  readonly details: MetnoInstantDetails;
}

export interface MetnoParseResult {
  readonly rows: readonly MetnoRaw[];
  /** Steps dropped for a malformed shape — DROPPED and COUNTED, never silently discarded. */
  readonly skipped: number;
}

interface MetnoStep {
  readonly time?: unknown;
  readonly data?: { readonly instant?: { readonly details?: unknown } | null } | null;
}

/**
 * Parse a Locationforecast response into raw rows. A payload without a usable [lon,lat] geometry yields no
 * rows (every step is counted as skipped — the observations cannot be placed on the map, and a guessed
 * position would be worse than none). Invalid JSON yields an empty result rather than a throw, so the
 * redundancy ladder can degrade to cache/mock.
 */
export function parseMetnoForecast(text: string): MetnoParseResult {
  const doc = safeParse(text);
  const steps = extractSteps(doc);
  const position = extractPosition(doc);
  if (position === undefined) return { rows: [], skipped: steps.length };
  const rows: MetnoRaw[] = [];
  let skipped = 0;
  for (const step of steps) {
    const row = toRow(step, position);
    if (row === undefined) skipped += 1;
    else rows.push(row);
  }
  return { rows, skipped };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function extractSteps(doc: unknown): readonly MetnoStep[] {
  const series = (doc as { properties?: { timeseries?: unknown } } | undefined)?.properties
    ?.timeseries;
  return Array.isArray(series) ? (series as readonly MetnoStep[]) : [];
}

/** met.no returns GeoJSON `coordinates: [lon, lat, altitude]`; only the first two are used (WGS-84). */
function extractPosition(doc: unknown): readonly [number, number] | undefined {
  const coords = (doc as { geometry?: { coordinates?: unknown } } | undefined)?.geometry
    ?.coordinates;
  if (!Array.isArray(coords)) return undefined;
  const lon = num(coords[0]);
  const lat = num(coords[1]);
  return lon === undefined || lat === undefined ? undefined : [lon, lat];
}

/** A step is well-formed when it carries a parseable ISO instant and an `instant.details` object. */
function toRow(step: MetnoStep, position: readonly [number, number]): MetnoRaw | undefined {
  const time = typeof step.time === 'string' ? step.time.trim() : '';
  if (time === '' || Number.isNaN(Date.parse(time))) return undefined;
  const details = step.data?.instant?.details;
  if (typeof details !== 'object' || details === null) return undefined;
  return { time, position, details: details as MetnoInstantDetails };
}

export const metnoMapper: AntiCorruptionMapper<MetnoRaw, WeatherObservation> = {
  // `ctx` is intentionally omitted: WeatherObservation carries no sourceId field, and every step already
  // has its own upstream `time` — the fetch instant must not be substituted for the observation instant.
  toCanonical(raw: MetnoRaw): WeatherObservation {
    if (Number.isNaN(Date.parse(raw.time))) {
      // Defensive: parseMetnoForecast filters these first, but the ACL boundary itself must never accept a
      // step it cannot place in time (never-silently-dropped doctrine).
      throw makeAdapterError('PARSE', `met.no step has an unparseable time: '${raw.time}'`);
    }
    return definedOnly({
      at: raw.time,
      position: raw.position,
      windSpeedMs: num(raw.details.wind_speed),
      windDirDeg: num(raw.details.wind_from_direction),
      tempC: num(raw.details.air_temperature),
      humidityPct: num(raw.details.relative_humidity),
    }) as WeatherObservation;
  },
};

function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}
