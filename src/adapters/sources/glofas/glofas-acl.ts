// BEACON — GloFAS anti-corruption layer (WP A11; adapter-contract §4, F1/Art. XII). Maps ONE Copernicus
// GloFAS reporting point, as the live OGC WMS 1.3.0 GetFeatureInfo response actually publishes it, to a
// canonical Gauge. This is the ONLY place the raw GloFAS shape exists; no GloFAS field escapes above this
// module (AGENTS.md §3). floodCategory is derived DETERMINISTICALLY from the published alert level —
// never by the LLM (Art. XII).
//
// ── THE REAL RESPONSE SHAPE (recorded live 2026-09-10; see __fixtures__/getfeatureinfo-*.html)
// The service answers GetFeatureInfo with `text/html` ONLY (its advertised GML format is rejected and its
// text/plain template is always an empty object — evidence in glofas-wms.ts). The body is a fragment
// containing two label-bearing tables per point:
//
//   <table class="tbl_info_point" summary="Point Information">
//     <tr><th>Station ID</th><th>Country</th><th>Basin</th><th>River</th><th>Station Name</th>
//         <th>Point ID</th><th>Drainage Area [km2]</th><th>Longitude [Deg]</th><th>Latitude [Deg]</th>…</tr>
//     <tr><td>G0041</td><td>United States of America</td><td>Kobuk</td>…<td>-160.134</td><td>66.973</td>…</tr>
//   <table class="tbl_info_point" summary="Point Forecast">
//     <tr><th>Forecast Date</th><th>Maximum probability (2 yr / 5 yr / 20 yr)</th><th>Alert level</th>
//         <th>Max probability step (earliest)</th><th>Discharge tendency</th><th>Peak forecasted</th></tr>
//     <tr><td>2026-09-10</td><td>9 / 1 / 0</td><td>Inactive</td><td>No Data</td>
//         <td><img src="…/viewer/RisingArrow.gif" alt="Discharge tendency"></td>
//         <td>in 3 days (on 2026-09-13)</td></tr>
//
// Parsing is LABEL-FIRST (header text → cell), not positional, so a column added upstream cannot silently
// shift a value into the wrong field. The remaining tables in the body (the ensemble "Forecasts Overview"
// grids) are ignored: they are a rendering of the same forecast, and BEACON derives no number from them.
//
// ── WHAT THE RESPONSE DOES AND DOES NOT CARRY (honest limitations, Art. XVI / §14)
//   · Alert level is a CLOSED vocabulary — the service's own GetCapabilities names the three alert layers
//     RPGM "Medium alert - T GT 2 years", RPGH "High alert - T GT 5 years", RPGS "Severe alert -
//     T GT 20 years"; "Inactive" is the recorded value for a point under every threshold. An unrecognised
//     level raises PARSE: silently downgrading an unknown level to NONE would hide a flood.
//   · "Maximum probability (2 yr / 5 yr / 20 yr)" is a PERCENTAGE of ensemble members — the layer abstract
//     states "Numbers denote the percentage of ensemble members exceeding the specific return period" and
//     that a point is raised when that percentage is "> 20 %". The canonical field is a dimensionless
//     fraction, so the published percentage is divided by 100 — the unit is documented by the source, not
//     guessed (contrast the legacy JSON path, where a bare `1` was ambiguous and therefore dropped).
//   · There is NO discharge value anywhere in the response, so `crestForecast` is always absent. The old
//     JSON façade claimed a forecast peak discharge; the real WMS service does not publish one, and BEACON
//     does not invent one.
//   · "Peak forecasted" is prose ("as currently ongoing", "No Data", "in 3 days (on 2026-09-13)"). Only the
//     explicit DATE is carried, as a date — no time of day is invented.
//   · Tendency is published only as a GLYPH (RisingArrow / FallingArrow / leftArrow — the last renders as a
//     horizontal arrow), matching the three tendencies the reporting-point layer abstract documents
//     ("rising … decreasing … stagnant"). An unrecognised glyph leaves the tendency ABSENT rather than
//     asserting a direction of travel the source never stated.
//   · GloFAS is a MODEL forecast, not an observed gauge: `stage` is always absent.
import type { Gauge, FloodCategory, GaugeId, GaugeTendency, SourceId } from '@/domain/index.js';
import { asId, makeGauge, definedOnly } from '@/domain/index.js';
import type { AntiCorruptionMapper, MapContext } from '@/adapters/_shared/index.js';
import { makeAdapterError } from '@/adapters/_shared/index.js';

/** One raw GloFAS reporting point, exactly as the two recorded tables publish it. Raw until mapped. */
export interface GlofasReportingPoint {
  readonly pointId?: string;
  readonly stationId?: string;
  readonly stationName?: string;
  readonly country?: string;
  readonly basin?: string;
  readonly river?: string;
  readonly lon?: number;
  readonly lat?: number;
  readonly forecastDate?: string;
  /** Verbatim "2yr / 5yr / 20yr" percentage triple, e.g. "9 / 1 / 0". */
  readonly maxProbabilityPct?: string;
  readonly alertLevel?: string;
  /** Basename of the tendency image, e.g. "RisingArrow" — the only tendency the response carries. */
  readonly tendencyGlyph?: string;
  readonly peakForecast?: string;
}

/** The service's own placeholder for "this point publishes no such value". */
const NOT_AVAILABLE = 'NA';

const INFO_SUMMARY = 'Point Information';

const TABLE_RE =
  /<table[^>]*\bsummary="(Point Information|Point Forecast)"[^>]*>([\s\S]*?)<\/table>/gi;
const ROW_RE = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
const CELL_RE = /<t([hd])[^>]*>([\s\S]*?)<\/t\1>/gi;
const IMG_SRC_RE = /<img[^>]*\bsrc="[^"]*\/([^/"]+)\.gif"/i;
const PEAK_DATE_RE = /\(on\s+(\d{4}-\d{2}-\d{2})\)/;

/** Alert level → the return period (years) it names. 0 = no threshold exceeded. */
const ALERT_RETURN_PERIOD_YEARS: Readonly<Record<string, 0 | 2 | 5 | 20>> = {
  INACTIVE: 0,
  MEDIUM: 2,
  HIGH: 5,
  SEVERE: 20,
};

/** Published tendency glyph → the canonical machine value. */
const TENDENCY_BY_GLYPH: Readonly<Record<string, GaugeTendency>> = {
  risingarrow: 'INCREASING',
  fallingarrow: 'DECREASING',
  leftarrow: 'STAGNANT', // renders as a horizontal arrow = the documented "stagnant" tendency
};

/**
 * Parse a WMS GetFeatureInfo `text/html` body into its reporting points. A body with no point (the
 * service answers the literal string "No content") yields `[]` — an empty answer, not a failure.
 */
export function parseGlofasFeatureInfo(html: string): GlofasReportingPoint[] {
  const points: GlofasReportingPoint[] = [];
  for (const [summary, body] of tables(html)) {
    const cells = labelled(body);
    if (summary === INFO_SUMMARY) points.push(fromInfo(cells));
    else mergeForecast(points, cells);
  }
  return points;
}

/** Alert level → the ORDERED domain FloodCategory. Throws PARSE outside the closed vocabulary. */
export function categoryFromAlertLevel(level: string): FloodCategory {
  return categoryFromReturnPeriod(returnPeriodYearsFromAlertLevel(level));
}

/** Alert level → return period in years (Medium=2, High=5, Severe=20, Inactive=0). PARSE otherwise. */
export function returnPeriodYearsFromAlertLevel(level: string): 0 | 2 | 5 | 20 {
  const years = ALERT_RETURN_PERIOD_YEARS[level.trim().toUpperCase()];
  if (years === undefined) {
    throw makeAdapterError(
      'PARSE',
      `GloFAS alert level outside the published vocabulary (${Object.keys(ALERT_RETURN_PERIOD_YEARS).join('|')}): '${level}'`,
    );
  }
  return years;
}

/**
 * GloFAS return-period severity → ordered domain FloodCategory. GloFAS exposes three exceedance
 * thresholds (2/5/20-yr); the US-specific ACTION advisory has no GloFAS equivalent, so it is unused.
 */
export function categoryFromReturnPeriod(years: number): FloodCategory {
  if (years >= 20) return 'MAJOR';
  if (years >= 5) return 'MODERATE';
  if (years >= 2) return 'MINOR';
  return 'NONE';
}

export const glofasMapper: AntiCorruptionMapper<GlofasReportingPoint, Gauge> = {
  toCanonical(raw: GlofasReportingPoint, ctx: MapContext): Gauge {
    const [lon, lat] = requirePoint(raw);
    const years = returnPeriodYearsFromAlertLevel(requireAlertLevel(raw));
    return makeGauge(
      definedOnly({
        id: pointId(raw, lon, lat),
        geom: { type: 'Point', coordinates: [lon, lat] },
        floodCategory: categoryFromReturnPeriod(years),
        sourceId: asId<SourceId>(ctx.sourceRecordId),
        crestTime: peakDate(raw.peakForecast),
        exceedanceProbability: probabilityFraction(raw.maxProbabilityPct, years),
        tendency: tendencyFromGlyph(raw.tendencyGlyph),
      }) as Parameters<typeof makeGauge>[0],
    );
  },
};

// ── HTML → labelled cells ───────────────────────────────────────────────────────────────────────────

function* tables(html: string): Generator<readonly [string, string]> {
  for (const m of html.matchAll(TABLE_RE)) yield [m[1] ?? '', m[2] ?? ''] as const;
}

/** Header label → raw cell HTML, taken from the first header row and the first data row of a table. */
function labelled(table: string): ReadonlyMap<string, string> {
  const headers: string[] = [];
  const values: string[] = [];
  for (const row of table.matchAll(ROW_RE)) {
    for (const cell of (row[1] ?? '').matchAll(CELL_RE)) {
      (cell[1]?.toLowerCase() === 'h' ? headers : values).push(cell[2] ?? '');
    }
  }
  const out = new Map<string, string>();
  headers.forEach((h, i) => out.set(text(h), values[i] ?? ''));
  return out;
}

function fromInfo(cells: ReadonlyMap<string, string>): GlofasReportingPoint {
  // `definedOnly` strips the absent keys; the cast re-states that for exactOptionalPropertyTypes.
  return definedOnly({
    pointId: value(cells, 'Point ID'),
    stationId: value(cells, 'Station ID'),
    stationName: value(cells, 'Station Name'),
    country: value(cells, 'Country'),
    basin: value(cells, 'Basin'),
    river: value(cells, 'River'),
    lon: num(value(cells, 'Longitude [Deg]')),
    lat: num(value(cells, 'Latitude [Deg]')),
  }) as GlofasReportingPoint;
}

/** A "Point Forecast" table always follows the "Point Information" table of the same point. */
function mergeForecast(points: GlofasReportingPoint[], cells: ReadonlyMap<string, string>): void {
  const last = points.length - 1;
  const point = points[last];
  if (point === undefined) return; // a forecast table with no preceding point: nothing to attach it to
  points[last] = {
    ...point,
    ...definedOnly({
      forecastDate: value(cells, 'Forecast Date'),
      maxProbabilityPct: value(cells, 'Maximum probability (2 yr / 5 yr / 20 yr)'),
      alertLevel: value(cells, 'Alert level'),
      tendencyGlyph: glyph(cells.get('Discharge tendency')),
      peakForecast: value(cells, 'Peak forecasted'),
    } as Partial<GlofasReportingPoint>),
  };
}

/** A labelled cell's text, with the source's own "NA" placeholder normalised to absent. */
function value(cells: ReadonlyMap<string, string>, label: string): string | undefined {
  const v = text(cells.get(label) ?? '');
  return v === '' || v.toUpperCase() === NOT_AVAILABLE ? undefined : v;
}

function glyph(cell: string | undefined): string | undefined {
  return cell === undefined ? undefined : (IMG_SRC_RE.exec(cell)?.[1] ?? undefined);
}

/** Strip tags + entities and collapse whitespace, so a label matches however the template wrapped it. */
function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── raw → canonical ─────────────────────────────────────────────────────────────────────────────────

/** Require a finite [lon,lat]; a reporting point without one cannot be placed on the COP. */
function requirePoint(raw: GlofasReportingPoint): [number, number] {
  const { lon, lat } = raw;
  if (lon === undefined || lat === undefined) {
    throw makeAdapterError(
      'PARSE',
      `GloFAS point missing/invalid coordinates: lon=${String(lon)} lat=${String(lat)}`,
    );
  }
  return [lon, lat];
}

function requireAlertLevel(raw: GlofasReportingPoint): string {
  if (raw.alertLevel === undefined) {
    throw makeAdapterError(
      'PARSE',
      'GloFAS point published no alert level; severity cannot be derived',
    );
  }
  return raw.alertLevel;
}

function pointId(raw: GlofasReportingPoint, lon: number, lat: number): GaugeId {
  return asId<GaugeId>(`glofas:${raw.pointId ?? raw.stationId ?? `${lon},${lat}`}`);
}

/**
 * "9 / 1 / 0" (percent of ensemble members exceeding the 2-/5-/20-year return period) → the canonical
 * dimensionless fraction for the threshold that produced the reported category, so the number always
 * describes the SAME event the category describes. For an inactive point (no threshold exceeded) the
 * mildest published threshold — the 2-year column — is carried, which is what "no alert" is measured
 * against. A triple that is not three percentages in [0,100] is left absent rather than rescaled.
 */
function probabilityFraction(
  triple: string | undefined,
  years: 0 | 2 | 5 | 20,
): number | undefined {
  if (triple === undefined) return undefined;
  const parts = triple.split('/').map((p) => Number(p.trim()));
  if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p) || p < 0 || p > 100))
    return undefined;
  const pct = parts[years === 20 ? 2 : years === 5 ? 1 : 0];
  return pct === undefined ? undefined : pct / 100;
}

/** "in 3 days (on 2026-09-13)" → "2026-09-13". Prose without an explicit date carries nothing. */
function peakDate(peakForecast: string | undefined): string | undefined {
  return peakForecast === undefined
    ? undefined
    : (PEAK_DATE_RE.exec(peakForecast)?.[1] ?? undefined);
}

function tendencyFromGlyph(glyphName: string | undefined): GaugeTendency | undefined {
  return glyphName === undefined ? undefined : TENDENCY_BY_GLYPH[glyphName.toLowerCase()];
}

function num(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v.replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}
