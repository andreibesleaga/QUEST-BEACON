// BEACON — GloFAS strict-WMS transport (WP A11; adapter-contract §3.1, FloodGaugePort P2). Builds ONE
// OGC WMS 1.3.0 GetFeatureInfo request that interrogates ONE Copernicus GloFAS reporting point. No
// parsing, no domain types — the anti-corruption mapping lives in glofas-acl.ts.
//
// ── LIVE-PROBE EVIDENCE (recorded 2026-09-10 against the production service; no credentials of any kind)
// [1] GetCapabilities — HTTP 200, `text/xml; charset=UTF-8`, 147 665 bytes:
//     https://ows.globalfloods.eu/glofas-ows/ows.py?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities
//     → `<WMS_Capabilities version="1.3.0">`, `<Service><Name>WMS</Name><Title>GLOFAS WMS</Title>`,
//       `<MaxWidth>6144</MaxWidth><MaxHeight>6144</MaxHeight>` (the canvas bound enforced below).
// [2] Queryable reporting-point layer — `<Layer queryable="1"><Name>RPG_U_GLOFAS_3_3</Name>
//     <Title>Reporting Points - Internal</Title>`, `<CRS>EPSG:4326</CRS>`, and a time dimension
//     `2011-01-01T00:00Z/<today>T00:00Z/PT24H` whose `default` is today — so TIME is OMITTED and the
//     service serves the current forecast run. The GLOFAS_WMS root advertises EPSG:3857/900913/4326/66666.
//     The sibling group layer `reportingPoints` is `queryable="0"` and answers GetFeatureInfo with a
//     ServiceException; the RPGM/RPGH/RPGS alert layers are the pre-2015 EFAS series and render
//     "not available for this date". RPG_U_GLOFAS_3_3 is the layer that carries today's global points.
// [3] INFO_FORMAT reality vs advertisement — `<GetFeatureInfo>` advertises text/html,
//     application/vnd.ogc.gml and text/plain, but ONLY `text/html` returns data:
//       · application/vnd.ogc.gml → HTTP 200 body `INFO_FORMAT application/vnd.ogc.gml invalid.`
//       · text/plain              → HTTP 200 body `{ "Reporting Points - Internal": {} }` (always empty)
//       · text/html              → HTTP 200, ~26 KB, the two `tbl_info_point` tables parsed by the ACL.
//     Hence GLOFAS_INFO_FORMAT is text/html; we do NOT "prefer JSON and fall back", because no JSON exists.
// [4] Verified request recipe (3/3 hits on three real points, HTTP 200 each):
//     …?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo&LAYERS=RPG_U_GLOFAS_3_3
//       &QUERY_LAYERS=RPG_U_GLOFAS_3_3&STYLES=&CRS=EPSG%3A4326
//       &BBOX=29.874%2C97.174%2C29.876%2C97.176&WIDTH=512&HEIGHT=512&I=256&J=256
//       &INFO_FORMAT=text%2Fhtml&FEATURE_COUNT=10
//     → Point ID DM001736 (China / Salween, alert "Medium"). Percent-encoded parameters are accepted.
// [5] PROTOCOL LIMIT, measured — GetFeatureInfo here is a CLICK protocol, not an enumeration protocol:
//     it returns AT MOST ONE point per call whatever FEATURE_COUNT says (tested 1/10/50), the vendor
//     tolerance extensions BUFFER/RADIUS are ignored, and the hit tolerance is a fixed ~0.02° in map
//     units (a 3 px offset at 0.0078°/px already misses), NOT a fraction of the canvas — a 3×3 grid over
//     Romania and Bangladesh at four canvas sizes returned 0–1 points out of 9 probes. There is no WFS
//     (SERVICE=WFS → ServiceException) and GetMap FORMAT=application/json is rejected. THEREFORE the
//     adapter interrogates a CONFIGURED LIST of reporting-point coordinates rather than pretending to
//     sweep a bbox; see glofas-adapter.ts (SOURCE_GLOFAS_POINTS).
import { makeAdapterError } from '@/adapters/_shared/index.js';

/** The only INFO_FORMAT this service actually answers with data (evidence [3]). */
export const GLOFAS_INFO_FORMAT = 'text/html';

/** WMS 1.3.0 names the pixel CRS parameter `CRS`; for EPSG:4326 the axis order is lat,lon. */
export const GLOFAS_CRS = 'EPSG:4326';

/** Service-advertised `<MaxWidth>`/`<MaxHeight>` (evidence [1]); 2 is the smallest canvas with a centre. */
export const GLOFAS_MAX_CANVAS_PX = 6144;
const MIN_CANVAS_PX = 2;

const DEFAULT_CANVAS_PX = 512;
const DEFAULT_HALF_SPAN_DEG = 0.001;
const DEFAULT_FEATURE_COUNT = 10;

export interface GlofasFeatureInfoRequest {
  /** Configured WMS endpoint (SOURCE_GLOFAS_URL). An existing query string is preserved. */
  readonly baseUrl: string;
  /** Configured queryable layer (SOURCE_GLOFAS_LAYER). */
  readonly layer: string;
  readonly lon: number;
  readonly lat: number;
  /** Half-width of the square interrogation box, in degrees (default 0.001 — the verified recipe). */
  readonly halfSpanDeg?: number;
  /** Square canvas edge in pixels (default 512 — the verified recipe). */
  readonly canvasPx?: number;
  readonly featureCount?: number;
}

/**
 * Build the GetFeatureInfo URL that interrogates (lon, lat).
 *
 * The point is placed on the CENTRE PIXEL of a tiny square box centred on it, which is what makes the
 * call deterministic: the service's hit tolerance is a fixed ~0.02° (evidence [5]), so a box of
 * ±0.001° guarantees the click lands on the point rather than on whatever neighbour happens to be
 * nearest. Throws a typed CONFIG AdapterError rather than emitting a request that would silently
 * interrogate the wrong pixel.
 */
export function buildGlofasFeatureInfoUrl(req: GlofasFeatureInfoRequest): string {
  const halfSpan = req.halfSpanDeg ?? DEFAULT_HALF_SPAN_DEG;
  const canvas = req.canvasPx ?? DEFAULT_CANVAS_PX;
  assertSpan(halfSpan);
  assertCanvas(canvas);
  assertCoordinate(req.lon, req.lat, halfSpan);

  const url = new URL(req.baseUrl);
  const p = url.searchParams;
  p.set('SERVICE', 'WMS');
  p.set('VERSION', '1.3.0');
  p.set('REQUEST', 'GetFeatureInfo');
  p.set('LAYERS', req.layer);
  p.set('QUERY_LAYERS', req.layer);
  // STYLES is part of the GetMap parameter subset a 1.3.0 GetFeatureInfo inherits (OGC 06-042 §7.4.3):
  // present but empty = "use each layer's default style". GetMap on this server 400s without it.
  p.set('STYLES', '');
  p.set('CRS', GLOFAS_CRS);
  // EPSG:4326 axis order is LAT,LON in WMS 1.3.0 — the transpose of BEACON's [west,south,east,north].
  p.set('BBOX', bbox(req.lon, req.lat, halfSpan));
  p.set('WIDTH', String(canvas));
  p.set('HEIGHT', String(canvas));
  // I/J (1.3.0), never X/Y (1.1.1). Integer division puts the interrogated point on the centre pixel.
  const centre = String(Math.floor(canvas / 2));
  p.set('I', centre);
  p.set('J', centre);
  p.set('INFO_FORMAT', GLOFAS_INFO_FORMAT);
  p.set('FEATURE_COUNT', String(req.featureCount ?? DEFAULT_FEATURE_COUNT));
  return url.toString();
}

/**
 * minLat,minLon,maxLat,maxLon — WMS 1.3.0 EPSG:4326 axis order. Each edge is rounded to 9 decimals so
 * binary-float noise (29.875 - 0.001 = 29.874000000000002) never widens the box or bloats the URL.
 */
function bbox(lon: number, lat: number, halfSpan: number): string {
  const at = (v: number, d: number): string => String(Number((v + d * halfSpan).toFixed(9)));
  return `${at(lat, -1)},${at(lon, -1)},${at(lat, 1)},${at(lon, 1)}`;
}

function assertSpan(halfSpan: number): void {
  if (!Number.isFinite(halfSpan) || halfSpan <= 0 || halfSpan > 1) {
    throw makeAdapterError(
      'CONFIG',
      `GloFAS WMS: halfSpanDeg must be in (0,1], got ${String(halfSpan)}`,
    );
  }
}

function assertCanvas(canvas: number): void {
  if (!Number.isInteger(canvas) || canvas < MIN_CANVAS_PX || canvas > GLOFAS_MAX_CANVAS_PX) {
    throw makeAdapterError(
      'CONFIG',
      `GloFAS WMS: canvasPx must be an integer in [${MIN_CANVAS_PX},${GLOFAS_MAX_CANVAS_PX}], got ${String(canvas)}`,
    );
  }
}

function assertCoordinate(lon: number, lat: number, halfSpan: number): void {
  const ok =
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    Math.abs(lon) <= 180 - halfSpan &&
    Math.abs(lat) <= 90 - halfSpan;
  if (!ok) {
    throw makeAdapterError(
      'CONFIG',
      `GloFAS WMS: point (${String(lon)}, ${String(lat)}) is outside EPSG:4326 by more than ±${halfSpan}°`,
    );
  }
}
