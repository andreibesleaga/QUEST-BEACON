// BEACON — GloFAS anti-corruption layer (E4·T-173; adapter-contract §4, F1/Art. XII). Maps one Copernicus
// GloFAS (Global Flood Awareness System) reporting point → a canonical Gauge. The ONLY place the raw GloFAS
// shape exists; no GloFAS field escapes above this module (AGENTS.md §3). floodCategory is derived
// DETERMINISTICALLY from the point's return-period severity — never the LLM (Art. XII).
//
// VERIFIED SOURCE (2026-07-07, DATA_SOURCE_VERIFICATION.md row 36 — tier CACHED, account-gated):
//   · Product: "GloFAS flood reporting points" — key locations where the 30-day ensemble forecast shows a
//     high probability of exceeding the 2-/5-/20-year return period. Defined by the MOST severe flood
//     signal in the 30-day horizon (severity: 2-yr = yellow, 5-yr = red, 20-yr = purple).
//     https://confluence.ecmwf.int/display/CEMS/GloFAS+Reporting+Points
//     https://data.jrc.ec.europa.eu/dataset/c5d56e48-42a7-4ffb-af7b-3f422b987603
//   · Transport: the operational GloFAS OGC WMS-T (global-flood.emergency.copernicus.eu). A point is read via
//     WMS GetFeatureInfo with INFO_FORMAT=application/json → a GeoJSON FeatureCollection (GloFAS v3.1+ adds
//     geojson output). The service is PASSWORD-PROTECTED (free Copernicus EWDS/CDS account) — there is NO
//     keyless public JSON, so the honest live tier requires a key (requireKeyForLive) and default is CACHED.
//   · Verified reporting-point attributes (per the pages above + lucernae/glofas-api-helper `station_name`,
//     `country`, `basin`, `coord.lon/lat`, ALERT_LEVEL): station coordinates, station name, river, basin,
//     country, catchment area, forecast issue date, return period / severity, exceedance probability,
//     tendency (increasing/decreasing/stagnant) and time to peak. The exact underlying JSON keys are behind
//     the account gate and not published verbatim; this ACL/fixture use those DOCUMENTED attribute names —
//     no field is invented beyond the cited product shape.
//
// The published exceedance probability and tendency are CARRIED, not dropped (finding F-15): they map to
// `Gauge.exceedanceProbability` (dimensionless fraction, exactly as published) and `Gauge.tendency`
// (uppercased machine value). GloFAS reporting points expose a DERIVED probability — BEACON has no ensemble
// members and computes no probability of its own (finding F-34); the value is source evidence, nothing more.
//
// Honest limitation: GloFAS is a MODEL forecast, not an observed gauge — there is no measured river stage, so
// `stage` is left undefined; `crestForecast` carries the forecast PEAK DISCHARGE (m³/s, not a stage height)
// and `crestTime` the forecast time-to-peak. Reporting points are corroborating global context, not a
// physics-grade local prediction.
import type { Gauge, FloodCategory, GaugeId, GaugeTendency, SourceId } from '@/domain/index.js';
import { asId, makeGauge, definedOnly, GAUGE_TENDENCIES } from '@/domain/index.js';
import type { AntiCorruptionMapper, MapContext } from '@/adapters/_shared/index.js';
import { makeAdapterError } from '@/adapters/_shared/index.js';

/** Raw GloFAS reporting-point properties (documented attributes; raw until mapped). */
interface GlofasProps {
  readonly pointId?: string | number | null;
  readonly stationName?: string | null;
  readonly river?: string | null;
  readonly basin?: string | null;
  readonly country?: string | null;
  readonly catchmentArea?: number | null;
  readonly issuedOn?: string | null;
  readonly returnPeriod?: number | string | null; // most-severe exceeded threshold, years: 2|5|20 (0/absent = none)
  readonly probability?: number | null;
  readonly tendency?: string | null;
  readonly peakForecast?: number | string | null; // forecast peak discharge (m³/s) — NOT a stage height
  readonly timeToPeak?: string | null;
}

interface GlofasGeometry {
  readonly type?: string;
  readonly coordinates?: readonly number[] | null;
}

/** One raw GloFAS reporting-point GeoJSON feature. Raw until mapped. */
export interface GlofasFeature {
  readonly geometry?: GlofasGeometry | null;
  readonly properties?: GlofasProps | null;
}

/** Parse a GloFAS reporting-point GeoJSON FeatureCollection (WMS GetFeatureInfo INFO_FORMAT=application/json). */
export function parseGlofasReportingPoints(text: string): GlofasFeature[] {
  const doc = JSON.parse(text) as { features?: GlofasFeature[] };
  return Array.isArray(doc.features) ? doc.features : [];
}

/**
 * GloFAS return-period severity → ordered domain FloodCategory. GloFAS exposes three exceedance thresholds
 * (2/5/20-yr); the US-specific ACTION advisory has no GloFAS equivalent, so it is intentionally unused.
 */
export function categoryFromReturnPeriod(years: number | string | null | undefined): FloodCategory {
  const rp = num(years) ?? 0;
  if (rp >= 20) return 'MAJOR';
  if (rp >= 5) return 'MODERATE';
  if (rp >= 2) return 'MINOR';
  return 'NONE';
}

export const glofasMapper: AntiCorruptionMapper<GlofasFeature, Gauge> = {
  toCanonical(raw: GlofasFeature, ctx: MapContext): Gauge {
    const [lon, lat] = requirePoint(raw.geometry);
    const props: GlofasProps = raw.properties ?? {};
    return makeGauge(
      definedOnly({
        id: pointId(props, lon, lat),
        geom: { type: 'Point', coordinates: [lon, lat] },
        floodCategory: categoryFromReturnPeriod(props.returnPeriod),
        sourceId: asId<SourceId>(ctx.sourceRecordId),
        crestForecast: num(props.peakForecast),
        crestTime: str(props.timeToPeak),
        exceedanceProbability: probabilityFraction(props.probability),
        tendency: tendencyFrom(props.tendency),
      }) as Parameters<typeof makeGauge>[0],
    );
  },
};

/** Require a finite [lon,lat] station location; a reporting point without one can't be placed on the COP. */
function requirePoint(geom: GlofasGeometry | null | undefined): [number, number] {
  const lon = geom?.coordinates?.[0];
  const lat = geom?.coordinates?.[1];
  if (typeof lon !== 'number' || typeof lat !== 'number' || !Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw makeAdapterError('PARSE', `GloFAS point missing/invalid coordinates: ${JSON.stringify(geom?.coordinates)}`);
  }
  return [lon, lat];
}

function pointId(props: GlofasProps, lon: number, lat: number): GaugeId {
  const raw = props.pointId;
  const id = raw !== undefined && raw !== null && String(raw).trim() !== '' ? String(raw) : `${lon},${lat}`;
  return asId<GaugeId>(`glofas:${id}`);
}

/**
 * GloFAS reporting-point exceedance probability → the canonical dimensionless fraction (finding F-15: this
 * value used to be parsed and then dropped on the floor).
 *
 * The recorded reporting-point shape expresses it as a fraction in [0,1] (see __fixtures__), and that is the
 * ONLY range accepted. A value outside [0,1] is NOT rescaled: a bare `1` would be indistinguishable between
 * "1 %" and "100 %", and guessing the unit could turn a quiet river into a certainty. Out-of-range values are
 * therefore left absent rather than carried wrong — an honest gap, not a silent drop of a value we could map.
 *
 * Honest limitation (inherited, not weakened): GloFAS publishes a DERIVED probability per reporting point.
 * BEACON reads that published number; it has no access to ensemble members and computes no probability itself.
 */
function probabilityFraction(v: number | null | undefined): number | undefined {
  const p = num(v);
  return p !== undefined && p >= 0 && p <= 1 ? p : undefined;
}

/**
 * GloFAS tendency wording (increasing/decreasing/stagnant) → the canonical uppercase GaugeTendency. Any
 * other wording is left absent: an unrecognized term is not silently coerced to STAGNANT, which would assert
 * a direction of travel the source never stated.
 */
function tendencyFrom(v: string | null | undefined): GaugeTendency | undefined {
  const raw = str(v)?.trim().toUpperCase();
  const known: readonly string[] = GAUGE_TENDENCIES;
  return raw !== undefined && known.includes(raw) ? (raw as GaugeTendency) : undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}
