// BEACON — EXTERNAL VIEWS deep-link builder (E11 "Live Views" · CW0; ADR-028, Art. XII). A PURE function of a
// coordinate → a set of third-party CONTEXT deep-links: 3D/satellite/street/weather (Google Maps/Satellite/
// Street View, Google Earth 3D, Bing Aerial, OpenStreetMap, Windy, Zoom Earth, NASA Worldview) plus the two
// HAZARD views this product exists for — NASA FIRMS active fires and Google Flood Hub. NO network, NO API
// key, NO clock, NO state — so it is trivially correct, offline, cost-free, and 100% unit-testable.
// Link-only + advisory (ADR-028): every url opens the provider's own site in a new tab; no engine or AI
// component ever reads content from a linked view or derives a fact from it.
// Templates verified 2026-07-17; the two hazard links verified against each provider's own code 2026-08-11.
import type { Position } from '@/domain/value-objects/geo.js';

/** The context category of an external view (drives its icon/grouping in the UI). */
export const EXTERNAL_VIEW_KINDS = ['map', 'satellite', 'street', '3d', 'weather', 'imagery', 'fire', 'flood'] as const;
export type ExternalViewKind = (typeof EXTERNAL_VIEW_KINDS)[number];

export interface ExternalViewLink {
  readonly label: string;
  readonly provider: string;
  readonly kind: ExternalViewKind;
  readonly url: string;
}

export interface ExternalViewsOptions {
  /** Google Maps/Satellite zoom level (default 14). Other providers use their own fixed context zoom. */
  readonly zoom?: number;
}

/** Fixed coordinate precision (5 dp ≈ 1.1 m) — deterministic, so every url is exact-match testable. */
const DECIMALS = 5;
const DEFAULT_ZOOM = 14;
/**
 * Hazard-context zooms. Both are deliberately WIDER than DEFAULT_ZOOM: a fire-detection or flood-forecast
 * view is only useful with its surroundings in frame, where a 14 street-level zoom shows a handful of
 * pixels of a regional event. FIRMS validates zoom against its own 0..22 bounds (verified in its parser).
 */
const FIRE_ZOOM = 8;
const FLOOD_ZOOM = 10;
/** Half-width of the ~1° bounding box NASA Worldview expects (minLon,minLat,maxLon,maxLat). */
const BBOX_HALF_DEG = 0.5;

const fmt = (n: number): string => n.toFixed(DECIMALS);

/**
 * Build the deterministic external-context deep-links for a [lon,lat] point. Coordinates are formatted to a
 * fixed 5 decimals and comma-encoded (%2C) exactly where the provider's verified template requires it. NASA
 * Worldview receives a ~1° bbox centred on the point. Pure + total: the same input always yields the same
 * list — no provider is contacted.
 */
export function buildExternalViews(position: Position, opts?: ExternalViewsOptions): readonly ExternalViewLink[] {
  const [lon, lat] = position;
  const latS = fmt(lat);
  const lonS = fmt(lon);
  const zoom = opts?.zoom ?? DEFAULT_ZOOM;
  // Clamp the ~1° bbox corners to valid geographic ranges so a point near the antimeridian/poles never emits
  // an out-of-range lon (±180) / lat (±90) into the Worldview `v=` extent (in-range coords are untouched).
  const minLon = fmt(Math.max(-180, lon - BBOX_HALF_DEG));
  const minLat = fmt(Math.max(-90, lat - BBOX_HALF_DEG));
  const maxLon = fmt(Math.min(180, lon + BBOX_HALF_DEG));
  const maxLat = fmt(Math.min(90, lat + BBOX_HALF_DEG));
  return [
    {
      label: 'Google Maps',
      provider: 'Google',
      kind: 'map',
      url: `https://www.google.com/maps/@?api=1&map_action=map&center=${latS}%2C${lonS}&zoom=${zoom}`,
    },
    {
      label: 'Google Satellite',
      provider: 'Google',
      kind: 'satellite',
      url: `https://www.google.com/maps/@?api=1&map_action=map&center=${latS}%2C${lonS}&zoom=${zoom}&basemap=satellite`,
    },
    {
      label: 'Street View',
      provider: 'Google',
      kind: 'street',
      url: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${latS}%2C${lonS}`,
    },
    {
      label: 'Google Earth 3D',
      provider: 'Google',
      kind: '3d',
      url: `https://earth.google.com/web/@${latS},${lonS},700a,20000d,35y,0h,0t,0r`,
    },
    {
      label: 'Bing Aerial',
      provider: 'Bing',
      kind: 'satellite',
      url: `https://www.bing.com/maps/default.aspx?cp=${latS}~${lonS}&style=a&lvl=15`,
    },
    {
      label: 'OpenStreetMap',
      provider: 'OpenStreetMap',
      kind: 'map',
      url: `https://www.openstreetmap.org/?mlat=${latS}&mlon=${lonS}#map=14/${latS}/${lonS}`,
    },
    {
      label: 'Windy',
      provider: 'Windy',
      kind: 'weather',
      url: `https://www.windy.com/?${latS},${lonS},10`,
    },
    {
      label: 'Zoom Earth',
      provider: 'Zoom Earth',
      kind: 'satellite',
      url: `https://zoom.earth/maps/satellite/#view=${latS},${lonS},8z`,
    },
    {
      label: 'NASA Worldview',
      provider: 'NASA',
      kind: 'imagery',
      url: `https://worldview.earthdata.nasa.gov/?v=${minLon},${minLat},${maxLon},${maxLat}`,
    },
    // ── Hazard-specific context, added 2026-08-11 ──────────────────────────────────────────────────────
    // NOTE THE COORDINATE ORDER — the two below are OPPOSITE EACH OTHER. Precisely: Google Flood Hub is
    // LATITUDE-first, the same order as Google Maps' `center=lat,lon` above; NASA FIRMS is the sole
    // LONGITUDE-first provider in this list. (An earlier version of this note also claimed Flood Hub was
    // opposite Google Maps — it is not, and the false half was caught in review before it could mislead
    // an edit into inverting a working URL.)
    // Each template below was verified against the provider's OWN code, not documentation or a guess —
    // neither publishes a deep-link spec, so an assumed order would have silently pointed responders at
    // the wrong place (a transposed lat/lon is a plausible-looking link to another continent).
    {
      // Active fire detections worldwide (MODIS + VIIRS, last 24 h) — the live global fire picture, and
      // the SAME upstream that feeds BEACON's own `firms` adapter, so the link corroborates the COP's fire
      // layer against its source rather than introducing an unrelated third party.
      // VERIFIED: FIRMS' own hash parser (dist/firms_map.*.js) splits on '@', then validates
      // `checkValidLatLon(parts[0], false)` = ±180 and `checkValidLatLon(parts[1], true)` = ±90 ⇒
      // **LONGITUDE first**, latitude second, zoom third with a literal 'z' suffix and 0..22 bounds.
      // `d:24hrs` is one of the tokens that parser accepts (6hrs|12hrs|24hrs|48hrs|7days).
      label: 'NASA FIRMS (active fires)',
      provider: 'NASA FIRMS',
      kind: 'fire',
      url: `https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@${lonS},${latS},${FIRE_ZOOM}z`,
    },
    {
      // Google Flood Hub — AI river-flood forecasts up to 7 days ahead, 150+ countries. Advisory context
      // beside BEACON's own gauge/NFHL layers; the engine never reads it (Art. XII).
      // VERIFIED: the route is server-rendered — `/l/39.76/-121.62/10` returns the app with its own state
      // as `[39.76,-121.62],10` (center pair, then zoom) and emits `<link rel="canonical">` for that exact
      // url, while a malformed path (`/l/nonsense`, or only two segments) 404s ⇒ **LATITUDE first**.
      label: 'Google Flood Hub',
      provider: 'Google',
      kind: 'flood',
      url: `https://sites.research.google/floods/l/${latS}/${lonS}/${FLOOD_ZOOM}`,
    },
  ];
}
