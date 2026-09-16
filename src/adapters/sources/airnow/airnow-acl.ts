// BEACON — AirNow anti-corruption layer (S2 Lane A4; adapter-contract §4, AirQualityPort P17, Art. XII).
// Maps a row of the US EPA AirNow "Hourly AQ Obs" file → canonical `AirQualityReading`. This is the ONLY
// place the raw `PM25_AQI`/`ValidDate`/`AQSID` column names exist; none escapes above this module
// (AGENTS.md §3). Every number is copied verbatim — never produced by the LLM.
//
// SOURCE VERIFICATION (2026-08-08, official EPA fact sheet + a real recorded fetch):
//  • Product: "Hourly AQ Obs File", fact sheet https://docs.airnowapi.org/docs/HourlyAQObsFactSheet.pdf.
//  • Location: `https://files.airnowtech.org/airnow/YYYY/YYYYMMDD/HourlyAQObs_yyyymmddhh.dat` — KEYLESS
//    (verified with a real unauthenticated GET returning HTTP 200 / 4432 rows). Field delimiter `,`,
//    every field double-quoted; the ReportingArea field uses a `|` SUB-delimiter (hence the quote-aware
//    splitter below, not a bare `split(',')` as in firms-acl.ts).
//  • Header, verbatim from the fact sheet AND the live file:
//    AQSID,SiteName,Status,EPARegion,Latitude,Longitude,Elevation,GMTOffset,CountryCode,StateName,
//    ValidDate,ValidTime,DataSource,ReportingArea_PipeDelimited,OZONE_AQI,PM10_AQI,PM25_AQI,NO2_AQI,
//    OZONE_Measured,PM10_Measured,PM25_Measured,NO2_Measured,PM25,PM25_Unit,OZONE,OZONE_Unit,NO2,NO2_Unit,
//    CO,CO_Unit,SO2,SO2_Unit,PM10,PM10_Unit
//  • "The date and hour specification in the filename and within the file are in GMT/UTC" — ValidDate is
//    MM/DD/YYYY and ValidTime is HH:MM, both UTC, so no offset arithmetic is needed (and none is done).
//  • Updated ~:35 past each hour; the preceding 72 hours of files are re-published for completeness.
//
// WHY THE FILE PRODUCT AND NOT THE `aq/data` WEB SERVICE: EPA's own guidance is "We typically recommend
// the use of file products over the Web Services when an AirNow user needs to extract data across a large
// time period and/or geographic area" (fact sheet, File Products). It is also KEYLESS and its response
// shape is PUBLICLY documented, whereas the web-service parameter/response docs sit behind a login — so
// this choice is the one whose contract we can actually verify, and it works with `AIRNOW_API_KEY` unset.
//
// HONEST LIMITATION (fact sheet, verbatim): "These data are not fully verified or validated; they should
// be considered preliminary and are subject to change… they should not be used to formulate or support
// regulation, trends, guidance, or any other government or public decision making." Coverage is the US
// plus parts of Canada and Mexico — not global.
import type { SourceId } from '@/domain/index.js';
import { asId } from '@/domain/index.js';
import type { AirQualityPollutant, AirQualityReading, AqiCategory } from '@/ports/air-quality.js';
import type { AntiCorruptionMapper, MapContext } from '@/adapters/_shared/index.js';
import { makeAdapterError } from '@/adapters/_shared/index.js';

/**
 * The AQI→category breakpoints, verbatim from EPA's "Air Quality 101" table (docs.airnowapi.org/aq101,
 * verified 2026-08-08): 0–50 Good · 51–100 Moderate · 101–150 Unhealthy for Sensitive Groups ·
 * 151–200 Unhealthy · 201–300 Very Unhealthy · 301–500 Hazardous. Upper-bound-inclusive, ascending.
 */
const AQI_BREAKPOINTS: readonly (readonly [max: number, category: AqiCategory])[] = [
  [50, 'GOOD'],
  [100, 'MODERATE'],
  [150, 'UNHEALTHY_SENSITIVE'],
  [200, 'UNHEALTHY'],
  [300, 'VERY_UNHEALTHY'],
];

/** The pollutant channels BEACON reads, as (canonical, AQI column, value column, unit column) tuples. */
const CHANNELS: readonly {
  readonly pollutant: AirQualityPollutant;
  readonly aqiCol: string;
  readonly valueCol: string;
  readonly unitCol: string;
}[] = [
  { pollutant: 'PM25', aqiCol: 'PM25_AQI', valueCol: 'PM25', unitCol: 'PM25_Unit' },
  { pollutant: 'PM10', aqiCol: 'PM10_AQI', valueCol: 'PM10', unitCol: 'PM10_Unit' },
];

/** One parsed HourlyAQObs record (header-keyed). All values are raw strings until mapped. */
export type AirNowRecord = Readonly<Record<string, string>>;

/** ONE pollutant channel of one monitoring site at one instant — the flattened row the mapper consumes. */
export interface AirNowRow {
  readonly siteId: string;
  readonly siteName: string;
  readonly lon: number;
  readonly lat: number;
  readonly pollutant: AirQualityPollutant;
  readonly value: number;
  readonly unit: string;
  readonly aqi: number;
  readonly observedAt: string; // ISO-8601 UTC
}

export interface ParsedAirNow {
  readonly rows: readonly AirNowRow[];
  /** Records dropped for a malformed position/timestamp, or carrying no readable PM channel at all. */
  readonly skipped: number;
}

/** AQI number → EPA category. Deterministic table lookup; >300 is Hazardous (the open-ended top band). */
export function aqiCategory(aqi: number): AqiCategory {
  for (const [max, category] of AQI_BREAKPOINTS) {
    if (aqi <= max) return category;
  }
  return 'HAZARDOUS';
}

/**
 * Quote-aware CSV splitter (no new dependency). Required because SiteName legitimately contains commas
 * (e.g. "Long Beach, Signal Hill") — a bare comma split would shift every later column silently.
 */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ',' && !inQuotes) {
      cells.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

/**
 * Parse a HourlyAQObs file into flattened PM rows, SKIPPING (and COUNTING) records without a usable
 * position/timestamp or without any readable PM channel. Lenient by design (adapter-contract §4): a
 * single bad monitor must never fail the batch, and the count is the trace that nothing vanished silently.
 * `keep` is the caller's spatial predicate — the file is nationwide, the query is a bbox.
 */
export function parseAirNow(
  text: string,
  keep?: (lon: number, lat: number) => boolean,
): ParsedAirNow {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const headerLine = lines[0];
  if (headerLine === undefined) return { rows: [], skipped: 0 };
  const header = splitCsvLine(headerLine).map((h) => h.replace(/"/g, ''));
  const rows: AirNowRow[] = [];
  let skipped = 0;
  for (const line of lines.slice(1)) {
    const record = recordFromCells(header, splitCsvLine(line));
    const produced = rowsFromRecord(record, keep);
    if (produced.length === 0) skipped += 1;
    else rows.push(...produced);
  }
  return { rows, skipped };
}

function recordFromCells(header: readonly string[], cells: readonly string[]): AirNowRecord {
  const record: Record<string, string> = {};
  header.forEach((key, i) => {
    record[key] = (cells[i] ?? '').replace(/"/g, '').trim();
  });
  return record;
}

/** The identity both PM channels of one site record share. `undefined` ⇒ the record is unusable. */
interface AirNowSite {
  readonly siteId: string;
  readonly siteName: string;
  readonly lon: number;
  readonly lat: number;
  readonly observedAt: string;
}

/** Extract + validate the record-level identity. Split out purely to keep complexity <10 (eslint gate). */
function siteOf(record: AirNowRecord): AirNowSite | undefined {
  const lat = num(record.Latitude);
  const lon = num(record.Longitude);
  const observedAt = airNowObservedAt(record);
  const siteId = (record.AQSID ?? '').trim();
  if (lat === undefined || lon === undefined || observedAt === undefined || siteId === '')
    return undefined;
  const rawName = (record.SiteName ?? '').trim();
  return {
    siteId,
    siteName: rawName === '' ? `AirNow site ${siteId}` : rawName,
    lon,
    lat,
    observedAt,
  };
}

/** Flatten ONE site record into 0..2 PM rows. Split out to keep `parseAirNow` complexity <10. */
function rowsFromRecord(
  record: AirNowRecord,
  keep?: (lon: number, lat: number) => boolean,
): AirNowRow[] {
  const site = siteOf(record);
  if (site === undefined) return [];
  if (keep !== undefined && !keep(site.lon, site.lat)) return [];
  return CHANNELS.flatMap((c) => {
    const aqi = num(record[c.aqiCol]);
    const value = num(record[c.valueCol]);
    const unit = (record[c.unitCol] ?? '').trim();
    if (aqi === undefined || value === undefined || unit === '') return [];
    return [{ ...site, pollutant: c.pollutant, value, unit, aqi }];
  });
}

export const airNowMapper: AntiCorruptionMapper<AirNowRow, AirQualityReading> = {
  toCanonical(raw: AirNowRow, ctx: MapContext): AirQualityReading {
    if (!Number.isFinite(raw.aqi) || !Number.isFinite(raw.value)) {
      throw makeAdapterError(
        'PARSE',
        `AirNow row ${raw.siteId}: invalid AQI/value '${raw.aqi}'/'${raw.value}'`,
      );
    }
    return {
      stationId: `airnow:${raw.siteId}`,
      stationName: raw.siteName,
      position: [raw.lon, raw.lat],
      pollutant: raw.pollutant,
      value: raw.value,
      unit: raw.unit, // VERBATIM ('UG/M3' as published) — the port forbids silent unit conversion.
      // AirNow is the ONE source here that publishes the official US EPA index, so it is the only one that
      // fills these in; the category is a table lookup of the SOURCE's number, not a BEACON computation.
      aqi: raw.aqi,
      aqiCategory: aqiCategory(raw.aqi),
      observedAt: raw.observedAt,
      sourceId: asId<SourceId>(ctx.sourceRecordId),
    };
  },
};

/** Combine ValidDate (MM/DD/YYYY) + ValidTime (HH:MM), both GMT/UTC per the fact sheet, into ISO-8601. */
export function airNowObservedAt(record: AirNowRecord): string | undefined {
  const date = (record.ValidDate ?? '').trim();
  const time = (record.ValidTime ?? '').trim();
  const dm = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date);
  const tm = /^(\d{2}):(\d{2})$/.exec(time);
  if (dm === null || tm === null) return undefined;
  return `${dm[3]}-${dm[1]}-${dm[2]}T${tm[1]}:${tm[2]}:00Z`;
}

function num(v: unknown): number | undefined {
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}
