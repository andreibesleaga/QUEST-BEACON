// BEACON — Sensor.Community anti-corruption layer (S2 Lane A4; adapter-contract §4, AirQualityPort P17,
// Art. XII). Maps a raw `data.sensor.community/airrohr/v1/filter/box=…` response → the canonical
// `AirQualityReading`. This is the ONLY place the raw `sensordatavalues`/`value_type`/`P1`/`P2` shape
// exists; no upstream field name escapes above this module (AGENTS.md §3). Numbers are copied verbatim
// here — never produced by the LLM.
//
// SOURCE VERIFICATION (2026-08-08, live GET + official docs):
//  • Endpoint (opendata-stuttgart/meta wiki "APIs" — the project's own GitHub org):
//    `https://data.sensor.community/airrohr/v1/filter/box={lat1,lon1,lat2,lon2}` — "alle Messwerte der
//    letzten 5 Minuten" (last 5 minutes). NOTE the LAT-FIRST corner order, the opposite of BEACON's
//    BBox `[west,south,east,north]` — the adapter transposes; getting this wrong silently returns the
//    wrong continent, so it is asserted in the adapter test.
//  • The same wiki: "Der Client muss bei Anfragen einen User-Agent mitschicken" (since 2022-11-04) — a
//    contact User-Agent is MANDATORY, not politeness. Sent by the adapter.
//  • `value_type` codes, verbatim from that wiki: "P1 (PM10), P2 (PM2.5)". Units are µg/m³. A station may
//    also report temperature/pressure/humidity/P0/P4/N05… — those are NOT air-quality pollutants BEACON
//    models and are skipped (and counted), never coerced.
//
// LICENCE (verified against the official opendata-stuttgart org, `feinstaub-api/archive/00disclamer.md`):
// "The archive.luftdaten.info data is made available under the Open Database License:
// http://opendatacommons.org/licenses/odbl/1.0/. Any rights in individual contents of the database are
// licensed under the Database Contents License: http://opendatacommons.org/licenses/dbcl/1.0/". ODbL §4.3
// makes the attribution notice a LICENCE OBLIGATION, not a courtesy — it is therefore carried in
// SourceRecord.license on every record (see sensorcommunity-adapter.ts) and mirrored in NOTICE.
//
// HONEST LIMITATION (Art. — honest limitations): these are CITIZEN low-cost optical PM sensors (SDS011 &
// co.), not reference-grade regulatory monitors. They are un-calibrated, humidity-sensitive, and may be
// sited indoors or beside a road. They are CORROBORATION for a smoke signal — never an authoritative AQI,
// which is why this ACL never derives an `aqi`/`aqiCategory` from a raw concentration.
import type { SourceId } from '@/domain/index.js';
import { asId } from '@/domain/index.js';
import type { AirQualityPollutant, AirQualityReading } from '@/ports/air-quality.js';
import type { AntiCorruptionMapper, MapContext } from '@/adapters/_shared/index.js';
import { makeAdapterError } from '@/adapters/_shared/index.js';

/** µg/m³ — the unit both PM channels are published in. Carried VERBATIM, never converted (port contract). */
const PM_UNIT = 'µg/m³';

/** The only `value_type` codes that are pollutants BEACON models (wiki: "P1 (PM10), P2 (PM2.5)"). */
const VALUE_TYPE_TO_POLLUTANT: Readonly<Record<string, AirQualityPollutant>> = {
  P1: 'PM10',
  P2: 'PM25',
};

/** One raw `sensordatavalues[]` element. Values are raw strings/numbers until mapped. */
export interface SensorCommunityValueRaw {
  readonly value?: string | number | null;
  readonly value_type?: string | null;
  readonly id?: number | string | null;
}

/** One raw `location` object. */
export interface SensorCommunityLocationRaw {
  readonly id?: number | string | null;
  readonly latitude?: string | number | null;
  readonly longitude?: string | number | null;
  readonly country?: string | null;
  readonly indoor?: number | null;
}

/** One raw measurement entry (array element of the filter response). Unknown fields are ignored. */
export interface SensorCommunityEntryRaw {
  readonly id?: number | string | null;
  readonly timestamp?: string | null;
  readonly location?: SensorCommunityLocationRaw | null;
  readonly sensor?: { readonly id?: number | string | null } | null;
  readonly sensordatavalues?: readonly SensorCommunityValueRaw[] | null;
}

/**
 * ONE pollutant channel of one sensor at one instant — the flattened row the mapper consumes. Flattening
 * happens at parse time (not in the mapper) because one upstream entry legitimately carries BOTH PM
 * channels, and the canonical `AirQualityReading` is one-pollutant-per-reading.
 */
export interface SensorCommunityRow {
  readonly sensorId: string;
  readonly locationId: string;
  readonly lon: number;
  readonly lat: number;
  readonly pollutant: AirQualityPollutant;
  readonly value: number;
  readonly observedAt: string; // ISO-8601 UTC
}

export interface ParsedSensorCommunity {
  readonly rows: readonly SensorCommunityRow[];
  /** Entries/channels dropped for a malformed position, timestamp, value, or a non-PM `value_type`. */
  readonly skipped: number;
}

/**
 * Parse a filter-endpoint JSON body into flattened PM rows, SKIPPING (and COUNTING) anything malformed or
 * non-PM. Lenient by design (adapter-contract §4, mirrors windy-webcams/opencellid): one bad citizen
 * sensor must never fail the whole batch, but a silent drop with no trace is equally unacceptable — the
 * count is the trace, surfaced by the adapter.
 */
export function parseSensorCommunity(text: string): ParsedSensorCommunity {
  const doc: unknown = JSON.parse(text);
  const entries = Array.isArray(doc) ? doc : [];
  const rows: SensorCommunityRow[] = [];
  let skipped = 0;
  for (const entry of entries) {
    const parsed = rowsFromEntry(entry as SensorCommunityEntryRaw);
    rows.push(...parsed.rows);
    skipped += parsed.skipped;
  }
  return { rows, skipped };
}

/** The identity every row of one entry shares. `undefined` ⇒ the whole entry is unusable. */
interface SensorCommunityStation {
  readonly sensorId: string;
  readonly locationId: string;
  readonly lon: number;
  readonly lat: number;
  readonly observedAt: string;
}

/** Extract + validate the entry-level identity. Split out purely to keep complexity <10 (eslint gate). */
function stationOf(entry: SensorCommunityEntryRaw): SensorCommunityStation | undefined {
  const lat = num(entry.location?.latitude);
  const lon = num(entry.location?.longitude);
  const observedAt = isoFromTimestamp(entry.timestamp);
  const sensorId = idStr(entry.sensor?.id);
  const locationId = idStr(entry.location?.id);
  if (lat === undefined || lon === undefined || observedAt === undefined) return undefined;
  if (sensorId === undefined || locationId === undefined) return undefined;
  return { sensorId, locationId, lon, lat, observedAt };
}

/** Flatten ONE entry into 0..n PM rows. Split out to keep `parseSensorCommunity` complexity <10. */
function rowsFromEntry(entry: SensorCommunityEntryRaw): ParsedSensorCommunity {
  const values = Array.isArray(entry.sensordatavalues) ? entry.sensordatavalues : [];
  const station = stationOf(entry);
  if (station === undefined) {
    // The whole entry is unusable: count every channel it carried (at least one) so nothing vanishes.
    return { rows: [], skipped: Math.max(values.length, 1) };
  }
  const rows: SensorCommunityRow[] = [];
  let skipped = 0;
  for (const v of values) {
    const pollutant = VALUE_TYPE_TO_POLLUTANT[String(v.value_type ?? '')];
    const value = num(v.value);
    if (pollutant === undefined || value === undefined) skipped += 1;
    else rows.push({ ...station, pollutant, value });
  }
  return { rows, skipped };
}

export const sensorCommunityMapper: AntiCorruptionMapper<SensorCommunityRow, AirQualityReading> = {
  toCanonical(raw: SensorCommunityRow, ctx: MapContext): AirQualityReading {
    if (!Number.isFinite(raw.value) || !Number.isFinite(raw.lat) || !Number.isFinite(raw.lon)) {
      throw makeAdapterError(
        'PARSE',
        `Sensor.Community row ${raw.sensorId}: invalid value/position '${raw.value}' @ '${raw.lon},${raw.lat}'`,
      );
    }
    return {
      stationId: `sensorcommunity:${raw.sensorId}`,
      stationName: `Sensor.Community ${raw.sensorId}`,
      position: [raw.lon, raw.lat],
      pollutant: raw.pollutant,
      value: raw.value,
      unit: PM_UNIT,
      // No `aqi`/`aqiCategory`: this network publishes raw concentrations only. Deriving an AQI here would
      // be BEACON inventing a regulatory figure from an un-calibrated citizen sensor (Art. XII).
      observedAt: raw.observedAt,
      sourceId: asId<SourceId>(ctx.sourceRecordId),
    };
  },
};

/** Upstream `timestamp` is UTC 'YYYY-MM-DD HH:MM:SS' (no zone designator) → ISO-8601 Z. */
export function isoFromTimestamp(raw: string | null | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) return undefined;
  return `${trimmed.replace(' ', 'T')}Z`;
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
