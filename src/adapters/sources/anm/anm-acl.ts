// BEACON — ANM (Administrația Națională de Meteorologie, Romania) anti-corruption layer (S2·Lane A3;
// adapter-contract §4, WeatherSourcePort P3, Art. XII). Maps one station feature of ANM's
// `wp-json/meteoapi/v2/starea-vremii` ("starea vremii" = current weather) FeatureCollection → a port-local
// WeatherObservation. This is the ONLY place the raw ANM shape (and its Romanian field names) exists; no ANM
// key escapes above this module (AGENTS.md §3). Numbers/geometry are produced deterministically here.
//
// RECORDED REAL SAMPLE (__fixtures__/starea-vremii.json) — provenance stated honestly: on 2026-08-08 the
// live host `www.meteoromania.ro` was UNREACHABLE from this build environment (TCP/443 handshake reset;
// other .ro hosts in the same run were reachable, so it is host-side filtering, not a local outage). The
// fixture is therefore a REAL ANM response recovered VERBATIM from the Internet Archive snapshot
// `web.archive.org/web/20260702031117id_/https://www.meteoromania.ro/wp-json/meteoapi/v2/starea-vremii`
// — i.e. the very 2026-07-02 response the audit's live-verification recorded — trimmed to 5 stations.
// Nothing in it is hand-authored. Observed shape:
//   { "success": true, "type": "FeatureCollection", "date": "2026-07-02T06:00:00+03:00",
//     "features": [ { "type":"feature",
//                     "geometry": {"type":"Point","coordinates":["3113115.070000","5479112.020000"],"zoom":0},
//                     "properties": {"nume":"ADAMCLISI","tempe":"20.5","umezeala":96,
//                                    "vant":"1.6 m/s, directia : VNV","presiunetext":"991.4 mb, variabila",
//                                    "actualizat":"02-07-2026&nbsp;ora&nbsp;06:00",
//                                    "fenomen_e":"indisponibil","zapada":"indisponibil", … } }, … ] }
//
// TWO RAW-FORMAT FACTS THIS LAYER EXISTS TO ABSORB:
//  1. COORDINATES ARE **EPSG:3857 (Web Mercator) METRES, AS STRINGS** — not WGS-84 degrees. They are
//     inverse-projected here (pure arithmetic, no dependency, no network). Verified against real geography:
//     ["3113115.07","5479112.02"] → 27.9656 E, 44.0883 N = Adamclisi, Constanța county. Passing these
//     numbers upward unconverted would place every Romanian station in the Atlantic.
//  2. VALUES ARE ROMANIAN, HUMAN-FORMATTED STRINGS — `vant` ("wind") is "1.6 m/s, directia : VNV", and any
//     unavailable variable is the literal word "indisponibil". `VNV` is *vest-nord-vest*: the Romanian
//     compass uses **V (vest) where English uses W**, so a naive English parse would read V as a missing
//     direction. The 16-point Romanian rose is mapped explicitly below.
//
// LENIENT by contract (S2 recipe): unknown/extra properties are ignored (ANM publishes `icon`, `zapada`,
// `nebulozitate`, `tempapa`, `presiunetext` … and may add more), and a structurally malformed feature is
// DROPPED **and COUNTED** (`AnmParseResult.skipped`) rather than thrown — one bad station must never blank
// the national picture (Art. XVI). Anything reaching the mapper unmappable raises a typed PARSE.
//
// HONEST LIMITATIONS: (a) these are STATION POINT observations on ANM's own publication cadence (the sample
// is a 06:00 local synoptic hour), not a gridded field and not a warning product — ANM warnings/nowcasts are
// separate feeds that carry hazard POLYGONS and belong on the alert/hazard ports, not on WeatherSourcePort
// (`meteoalarm-ro` already relays RO official warnings as CAP). (b) The whole FeatureCollection shares ONE
// `date`; ANM does not publish a per-station observation instant in this feed, so every mapped observation
// honestly carries that single collection instant rather than a fabricated per-station one.
import type { WeatherObservation } from '@/ports/data-sources.js';
import { definedOnly } from '@/domain/index.js';
import type { AntiCorruptionMapper } from '@/adapters/_shared/index.js';
import { makeAdapterError } from '@/adapters/_shared/index.js';

/** One raw ANM station feature, flattened with the collection-level observation instant. Raw until mapped. */
export interface AnmRaw {
  readonly at: string; // ISO-8601 UTC, from the FeatureCollection's single `date`
  readonly name: string; // `nume` — station name (kept for the PARSE message; no domain field for it yet)
  readonly easting: number; // EPSG:3857 X, metres
  readonly northing: number; // EPSG:3857 Y, metres
  readonly tempe?: string | number | null;
  readonly umezeala?: string | number | null;
  readonly vant?: string | null;
}

export interface AnmParseResult {
  readonly rows: readonly AnmRaw[];
  /** Features dropped for a malformed shape — DROPPED and COUNTED, never silently discarded. */
  readonly skipped: number;
}

/** ANM's literal marker for "no value published" — must map to `undefined`, never to 0. */
const UNAVAILABLE = 'indisponibil';

/**
 * The 16-point ROMANIAN compass rose (N/E/S/**V**=vest). Explicit table, not a computed rotation, so the
 * V↔W difference can never be silently mis-derived.
 */
const RO_COMPASS_DEG: Readonly<Record<string, number>> = {
  N: 0,
  NNE: 22.5,
  NE: 45,
  ENE: 67.5,
  E: 90,
  ESE: 112.5,
  SE: 135,
  SSE: 157.5,
  S: 180,
  SSV: 202.5,
  SV: 225,
  VSV: 247.5,
  V: 270,
  VNV: 292.5,
  NV: 315,
  NNV: 337.5,
};

/** Earth radius used by EPSG:3857 (spherical Mercator), metres. */
const MERCATOR_R = 6378137;

/**
 * Parse an ANM `starea-vremii` payload into raw rows. Invalid JSON, a missing/unparseable `date`, or a
 * non-array `features` all yield an empty result rather than a throw, so the redundancy ladder degrades to
 * cache/mock instead of dead-ending.
 */
export function parseAnmObservations(text: string): AnmParseResult {
  const doc = safeParse(text);
  const features = Array.isArray((doc as { features?: unknown })?.features)
    ? (doc as { features: readonly unknown[] }).features
    : [];
  const at = collectionInstant(doc);
  if (at === undefined) return { rows: [], skipped: features.length };
  const rows: AnmRaw[] = [];
  let skipped = 0;
  for (const feature of features) {
    const row = toRow(feature, at);
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

/** ANM publishes the instant as local Romanian time with an explicit offset; normalize to UTC. */
function collectionInstant(doc: unknown): string | undefined {
  const raw = (doc as { date?: unknown } | undefined)?.date;
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  const ms = Date.parse(raw.trim());
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

function toRow(feature: unknown, at: string): AnmRaw | undefined {
  if (typeof feature !== 'object' || feature === null) return undefined;
  const props = (feature as { properties?: unknown }).properties;
  if (typeof props !== 'object' || props === null) return undefined;
  const coords = (feature as { geometry?: { coordinates?: unknown } }).geometry?.coordinates;
  if (!Array.isArray(coords)) return undefined;
  const easting = num(coords[0]);
  const northing = num(coords[1]);
  if (easting === undefined || northing === undefined) return undefined;
  const p = props as Record<string, unknown>;
  return definedOnly({
    at,
    name: typeof p.nume === 'string' ? p.nume : '',
    easting,
    northing,
    tempe: str(p.tempe),
    umezeala: str(p.umezeala),
    vant: str(p.vant),
  }) as AnmRaw;
}

export const anmMapper: AntiCorruptionMapper<AnmRaw, WeatherObservation> = {
  // `ctx` is intentionally omitted: WeatherObservation carries no sourceId field, and the observation
  // instant comes from ANM's own `date` — the fetch instant must never be substituted for it.
  toCanonical(raw: AnmRaw): WeatherObservation {
    if (!Number.isFinite(raw.easting) || !Number.isFinite(raw.northing)) {
      // Defensive: parseAnmObservations filters these first, but the ACL boundary itself must never accept
      // a station it cannot place (never-silently-dropped doctrine).
      throw makeAdapterError(
        'PARSE',
        `ANM station '${raw.name}' has invalid EPSG:3857 coordinates`,
      );
    }
    const wind = parseVant(raw.vant);
    return definedOnly({
      at: raw.at,
      position: webMercatorToWgs84(raw.easting, raw.northing),
      windSpeedMs: wind.speedMs,
      windDirDeg: wind.dirDeg,
      tempC: value(raw.tempe),
      humidityPct: value(raw.umezeala),
    }) as WeatherObservation;
  },
};

/** EPSG:3857 metres → WGS-84 [lon, lat] degrees, rounded to 6 dp (~0.1 m) for deterministic output. */
export function webMercatorToWgs84(
  easting: number,
  northing: number,
): readonly [lon: number, lat: number] {
  const lon = (easting / MERCATOR_R) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(northing / MERCATOR_R)) - Math.PI / 2) * (180 / Math.PI);
  return [round6(lon), round6(lat)];
}

/** `"1.6 m/s, directia : VNV"` → `{ speedMs: 1.6, dirDeg: 292.5 }`; either half may be absent. */
export function parseVant(raw: string | null | undefined): {
  readonly speedMs?: number;
  readonly dirDeg?: number;
} {
  if (typeof raw !== 'string' || raw.trim() === '' || raw.trim().toLowerCase() === UNAVAILABLE)
    return {};
  const speedMatch = /(-?\d+(?:[.,]\d+)?)\s*m\/s/i.exec(raw);
  const dirMatch = /directia\s*:?\s*([NSEV]+)/i.exec(raw);
  const speedMs =
    speedMatch === undefined || speedMatch === null
      ? undefined
      : num(speedMatch[1]?.replace(',', '.'));
  const dirDeg = dirMatch === null ? undefined : RO_COMPASS_DEG[(dirMatch[1] ?? '').toUpperCase()];
  return definedOnly({ speedMs, dirDeg }) as { speedMs?: number; dirDeg?: number };
}

/** ANM value → number, treating the literal "indisponibil" (and any non-numeric text) as "not published". */
function value(v: string | number | null | undefined): number | undefined {
  if (typeof v === 'string' && v.trim().toLowerCase() === UNAVAILABLE) return undefined;
  return num(v);
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function str(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}
