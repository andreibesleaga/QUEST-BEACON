// BEACON — OpenAQ anti-corruption layer (S2 Lane A4; adapter-contract §4, AirQualityPort P17, Art. XII).
// Maps OpenAQ **v3** responses → canonical `AirQualityReading`. This is the ONLY place the raw
// `sensorsId`/`locationsId`/`datetime.utc` shape exists; none of it escapes above this module
// (AGENTS.md §3). Numbers are copied verbatim here — never produced by the LLM.
//
// SOURCE VERIFICATION (2026-08-08, against the OFFICIAL machine-readable spec `api.openaq.org/openapi.json`,
// `info.version: "3.0.0"` — v3 confirmed current — plus docs.openaq.org quick-start):
//  • Auth: header `X-API-Key`. Verified live: an unauthenticated GET returns HTTP 401
//    `{"message": "Unauthorized. A valid API key must be provided in the X-API-Key header."}`.
//  • `GET /v3/locations?bbox=…` — spec, verbatim: "geospatial bounding box of Min X, min Y, max X, max Y
//    in WGS 84 coordinates", i.e. lon/lat order, IDENTICAL to BEACON's BBox `[west,south,east,north]`
//    (unlike Sensor.Community's transposed box). Also supports `parameters_id`, `limit`, `page`.
//    Response `LocationsResponse{ meta, results: Location[] }`; `Location` carries `coordinates
//    {latitude, longitude}`, `name`, and `sensors: SensorBase[]{ id, name, parameter{id,name,units,
//    displayName} }` — but SensorBase carries NO value.
//  • `GET /v3/locations/{locations_id}/latest` — response `LatestResponse{ meta, results: Latest[] }`;
//    `Latest{ datetime{utc,local}, value, coordinates{latitude,longitude}, sensorsId, locationsId }`.
//
// WHY TWO CALLS (the honest cost of v3): there is NO bbox-scoped "latest measurements" endpoint. The spec
// shows `/v3/parameters/{id}/latest` takes only `limit`/`page`/`datetime_min` — no geospatial filter — and
// `/v3/locations` returns stations WITHOUT values. So a bbox query is necessarily stage 1 (stations in the
// box) + stage 2 (their latest values), joined on `sensorsId`. The fan-out is BOUNDED (see the adapter's
// `maxLocations`) rather than unbounded, because an unbounded fan-out on a continental bbox would be an
// accidental denial-of-service against a free community API.
//
// HONEST LIMITATION: OpenAQ AGGREGATES other people's networks (each `Location` carries its own upstream
// licence and attribution). Latency and quality are the contributing network's, not OpenAQ's. It publishes
// CONCENTRATIONS, not an AQI — so this ACL leaves `aqi`/`aqiCategory` undefined rather than converting.
import type { SourceId } from '@/domain/index.js';
import { asId } from '@/domain/index.js';
import type { AirQualityPollutant, AirQualityReading } from '@/ports/air-quality.js';
import type { AntiCorruptionMapper, MapContext } from '@/adapters/_shared/index.js';
import { makeAdapterError } from '@/adapters/_shared/index.js';

/** OpenAQ `parameter.name` → the pollutants BEACON models. Anything else is skipped (and counted). */
const PARAMETER_TO_POLLUTANT: Readonly<Record<string, AirQualityPollutant>> = {
  pm25: 'PM25',
  pm10: 'PM10',
  o3: 'O3',
  no2: 'NO2',
  so2: 'SO2',
  co: 'CO',
};

/** OpenAQ `parameters_id` for PM2.5 — the wildfire-smoke channel (spec: parameter id 2 == 'pm25'). */
export const OPENAQ_PM25_PARAMETER_ID = 2;

interface OpenAqCoordinates {
  readonly latitude?: number | null;
  readonly longitude?: number | null;
}

interface OpenAqParameterRaw {
  readonly id?: number;
  readonly name?: string | null;
  readonly units?: string | null;
  readonly displayName?: string | null;
}

interface OpenAqSensorRaw {
  readonly id?: number;
  readonly name?: string | null;
  readonly parameter?: OpenAqParameterRaw | null;
}

/** One raw `/v3/locations` result. Unknown fields (owner, provider, instruments, licences…) are ignored. */
export interface OpenAqLocationRaw {
  readonly id?: number;
  readonly name?: string | null;
  readonly coordinates?: OpenAqCoordinates | null;
  readonly sensors?: readonly OpenAqSensorRaw[] | null;
}

/** One raw `/v3/locations/{id}/latest` result. */
export interface OpenAqLatestRaw {
  readonly datetime?: { readonly utc?: string | null } | null;
  readonly value?: number | null;
  readonly coordinates?: OpenAqCoordinates | null;
  readonly sensorsId?: number;
  readonly locationsId?: number;
}

/** The joined row the mapper consumes: one sensor's latest value, carrying its station's identity. */
export interface OpenAqRow {
  readonly locationId: string;
  readonly locationName: string;
  readonly sensorId: string;
  readonly lon: number;
  readonly lat: number;
  readonly pollutant: AirQualityPollutant;
  readonly unit: string;
  readonly value: number;
  readonly observedAt: string; // ISO-8601 UTC
}

/** A station's sensors, keyed by sensor id — the stage-1 half of the join. */
export interface OpenAqSensorIndex {
  readonly bySensorId: ReadonlyMap<string, OpenAqSensorMeta>;
  /** Sensors dropped for a malformed id/parameter, or for a pollutant BEACON does not model. */
  readonly skipped: number;
}

export interface OpenAqSensorMeta {
  readonly locationId: string;
  readonly locationName: string;
  readonly lon: number;
  readonly lat: number;
  readonly pollutant: AirQualityPollutant;
  readonly unit: string;
}

export interface ParsedOpenAq {
  readonly rows: readonly OpenAqRow[];
  /** Latest values dropped for a malformed value/instant or for an unknown sensor id (data hygiene). */
  readonly skipped: number;
}

/** Parse a `/v3/locations` body into the sensor index. Lenient: malformed entries are skipped + counted. */
export function parseOpenAqLocations(text: string): OpenAqSensorIndex {
  const doc = JSON.parse(text) as { readonly results?: readonly OpenAqLocationRaw[] };
  const results = Array.isArray(doc.results) ? doc.results : [];
  const bySensorId = new Map<string, OpenAqSensorMeta>();
  let skipped = 0;
  for (const loc of results) {
    const indexed = indexLocation(loc, bySensorId);
    skipped += indexed;
  }
  return { bySensorId, skipped };
}

/** The station identity every sensor of one location shares. `undefined` ⇒ the location is unusable. */
interface OpenAqStation {
  readonly locationId: string;
  readonly locationName: string;
  readonly lon: number;
  readonly lat: number;
}

/** Extract + validate the location-level identity. Split out purely to keep complexity <10 (eslint gate). */
function stationOf(loc: OpenAqLocationRaw): OpenAqStation | undefined {
  const lat = num(loc.coordinates?.latitude);
  const lon = num(loc.coordinates?.longitude);
  const locationId = idStr(loc.id);
  if (lat === undefined || lon === undefined || locationId === undefined) return undefined;
  const name = typeof loc.name === 'string' ? loc.name.trim() : '';
  return {
    locationId,
    locationName: name === '' ? `OpenAQ location ${locationId}` : name,
    lon,
    lat,
  };
}

/** Index ONE location's sensors; returns how many it had to skip. Keeps the caller's complexity <10. */
function indexLocation(loc: OpenAqLocationRaw, into: Map<string, OpenAqSensorMeta>): number {
  const sensors = Array.isArray(loc.sensors) ? loc.sensors : [];
  const station = stationOf(loc);
  if (station === undefined) return Math.max(sensors.length, 1);
  let skipped = 0;
  for (const s of sensors) {
    const sensorId = idStr(s.id);
    const meta = sensorMetaOf(s, station);
    if (sensorId === undefined || meta === undefined) skipped += 1;
    else into.set(sensorId, meta);
  }
  return skipped;
}

/** Decode ONE sensor's pollutant + unit onto its station. Split out to keep complexity <10 (eslint gate). */
function sensorMetaOf(s: OpenAqSensorRaw, station: OpenAqStation): OpenAqSensorMeta | undefined {
  const pollutant = PARAMETER_TO_POLLUTANT[String(s.parameter?.name ?? '').toLowerCase()];
  const rawUnit = s.parameter?.units;
  const unit = typeof rawUnit === 'string' ? rawUnit.trim() : '';
  if (pollutant === undefined || unit === '') return undefined;
  return { ...station, pollutant, unit };
}

/**
 * Join `/v3/locations/{id}/latest` bodies onto the stage-1 sensor index. A latest value whose `sensorsId`
 * is not in the index cannot be attributed to a station/pollutant, so it is skipped + counted (never
 * emitted with a guessed identity).
 */
export function joinOpenAqLatest(
  index: OpenAqSensorIndex,
  latestTexts: readonly string[],
): ParsedOpenAq {
  const rows: OpenAqRow[] = [];
  let skipped = index.skipped;
  for (const text of latestTexts) {
    const doc = JSON.parse(text) as { readonly results?: readonly OpenAqLatestRaw[] };
    for (const latest of Array.isArray(doc.results) ? doc.results : []) {
      const row = rowFrom(index, latest);
      if (row === undefined) skipped += 1;
      else rows.push(row);
    }
  }
  return { rows, skipped };
}

function rowFrom(index: OpenAqSensorIndex, latest: OpenAqLatestRaw): OpenAqRow | undefined {
  const sensorId = idStr(latest.sensorsId);
  const meta = sensorId === undefined ? undefined : index.bySensorId.get(sensorId);
  const value = num(latest.value);
  const observedAt = isoOrUndefined(latest.datetime?.utc);
  if (sensorId === undefined || meta === undefined) return undefined;
  if (value === undefined || observedAt === undefined) return undefined;
  const [lon, lat] = positionOf(latest, meta);
  return { ...meta, sensorId, lon, lat, value, observedAt };
}

/**
 * Prefer the per-measurement coordinates when present (OpenAQ carries MOBILE monitors, which move between
 * readings); else fall back to the station's. Split out to keep `rowFrom` complexity <10 (eslint gate).
 */
function positionOf(latest: OpenAqLatestRaw, meta: OpenAqSensorMeta): readonly [number, number] {
  return [
    num(latest.coordinates?.longitude) ?? meta.lon,
    num(latest.coordinates?.latitude) ?? meta.lat,
  ];
}

export const openAqMapper: AntiCorruptionMapper<OpenAqRow, AirQualityReading> = {
  toCanonical(raw: OpenAqRow, ctx: MapContext): AirQualityReading {
    if (!Number.isFinite(raw.value) || !Number.isFinite(raw.lat) || !Number.isFinite(raw.lon)) {
      throw makeAdapterError(
        'PARSE',
        `OpenAQ sensor ${raw.sensorId}: invalid value/position '${raw.value}' @ '${raw.lon},${raw.lat}'`,
      );
    }
    return {
      stationId: `openaq:${raw.locationId}:${raw.sensorId}`,
      stationName: raw.locationName,
      position: [raw.lon, raw.lat],
      pollutant: raw.pollutant,
      value: raw.value,
      unit: raw.unit, // VERBATIM ('µg/m³', 'ppm', …) — the port forbids silent unit conversion.
      // No `aqi`/`aqiCategory`: OpenAQ publishes concentrations only (see the header).
      observedAt: raw.observedAt,
      sourceId: asId<SourceId>(ctx.sourceRecordId),
    };
  },
};

/** Location ids the adapter must call `/latest` for, in stable ascending order (deterministic fan-out). */
export function locationIdsOf(index: OpenAqSensorIndex): readonly string[] {
  const ids = new Set<string>();
  for (const meta of index.bySensorId.values()) ids.add(meta.locationId);
  return [...ids].sort((a, b) => Number(a) - Number(b));
}

function isoOrUndefined(raw: string | null | undefined): string | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  return Number.isNaN(Date.parse(raw)) ? undefined : raw.trim();
}

function idStr(v: number | string | null | undefined): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  return undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}
