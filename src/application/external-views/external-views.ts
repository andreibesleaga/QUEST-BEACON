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
export const EXTERNAL_VIEW_KINDS = [
  'map',
  'satellite',
  'street',
  '3d',
  'weather',
  'imagery',
  'fire',
  'flood',
] as const;
export type ExternalViewKind = (typeof EXTERNAL_VIEW_KINDS)[number];

export interface ExternalViewLink {
  readonly label: string;
  readonly provider: string;
  readonly kind: ExternalViewKind;
  readonly url: string;
}

export interface ExternalViewsOptions {
  /**
   * The OPERATOR'S OWN map zoom (default 14). Every provider's framing is derived from it — see
   * ZOOM_OFFSET below — so an external view opens on the same ground the COP camera is showing.
   */
  readonly zoom?: number;
}

/** Fixed coordinate precision (5 dp ≈ 1.1 m) — deterministic, so every url is exact-match testable. */
const DECIMALS = 5;
const DEFAULT_ZOOM = 14;
/**
 * Per-provider zoom, expressed as an OFFSET from the operator's own map zoom rather than as a constant
 * (2026-09-11; owner-reported: "the current view on the COP map must be kept with all the other sources
 * and external sources ... for all the external links").
 *
 * THE DEFECT. Only the two Google links read `opts.zoom`; the other nine were pinned to literals. An
 * operator zoomed into a single street opened Windy at a whole-region 10 and Zoom Earth at a continental
 * 8 — a different place, in practice, from the one they were looking at. Worse, nothing carried the
 * viewport at all (see the call site), so even the Google pair got the default.
 *
 * WHY OFFSETS, NOT THE RAW ZOOM. The hazard and weather views are deliberately WIDER than the operator's
 * framing, and that judgement is still right: a fire-detection or flood-forecast view zoomed to a street
 * shows a handful of pixels of a regional event. What was wrong was freezing the width instead of
 * anchoring it. Each offset below is calibrated so that AT THE DEFAULT ZOOM OF 14 every url is
 * byte-identical to the verified template it replaces — the provider templates themselves are unchanged
 * and their existing exact-match tests still pass — and so that the whole set now MOVES TOGETHER with the
 * COP camera, keeping the relative context each provider was chosen for.
 *
 * Every result is clamped to the provider's own accepted range, so an extreme COP zoom degrades to that
 * provider's nearest valid view rather than emitting an out-of-range value it would reject or misparse.
 */
const ZOOM_OFFSET = {
  /** OpenStreetMap `#map=z/lat/lon` — slippy-map tile zoom, same scale as ours. Range 0..19. */
  osm: 0,
  /** Bing `lvl=` runs one level tighter than the equivalent slippy zoom. Range 1..20. */
  bing: +1,
  /** Windy's weather model resolution is regional; 4 levels out keeps the synoptic picture. Range 3..18. */
  windy: -4,
  /** Zoom Earth serves whole-disc satellite imagery — 6 out is its useful storm-scale view. Range 2..15. */
  zoomEarth: -6,
  /** FIRMS validates 0..22 in its own hash parser; 6 out frames a fire complex and its surroundings. */
  firms: -6,
  /** Flood Hub reasons about river reaches, not addresses; 4 out shows the basin. Range 1..15. */
  floodHub: -4,
} as const;

/** The accepted zoom range of each provider, as verified against that provider's own parser/UI. */
const ZOOM_RANGE = {
  osm: [0, 19],
  bing: [1, 20],
  windy: [3, 18],
  zoomEarth: [2, 15],
  firms: [0, 22],
  floodHub: [1, 15],
} as const satisfies Record<keyof typeof ZOOM_OFFSET, readonly [number, number]>;

type ZoomKey = keyof typeof ZOOM_OFFSET;

/** The operator zoom translated into one provider's scale, clamped to what that provider accepts. */
function zoomFor(key: ZoomKey, zoom: number): number {
  const [lo, hi] = ZOOM_RANGE[key];
  return Math.round(Math.min(hi, Math.max(lo, zoom + ZOOM_OFFSET[key])));
}

/**
 * Google Earth's `…d` term is a CAMERA DISTANCE IN METRES, not a zoom level, so it cannot take an offset.
 * Halving it per zoom level is the standard slippy-map relation, anchored on the verified 20000d at zoom
 * 14. Clamped to Earth's own practical range so a far-out COP view does not ask for a camera in orbit.
 */
const EARTH_DISTANCE_AT_DEFAULT = 20_000;
const EARTH_DISTANCE_RANGE: readonly [number, number] = [150, 10_000_000];

function earthDistance(zoom: number): number {
  const raw = EARTH_DISTANCE_AT_DEFAULT * Math.pow(2, DEFAULT_ZOOM - zoom);
  const [lo, hi] = EARTH_DISTANCE_RANGE;
  return Math.round(Math.min(hi, Math.max(lo, raw)));
}

/**
 * Half-width of the bounding box NASA Worldview expects (minLon,minLat,maxLon,maxLat). Worldview takes an
 * EXTENT, not a zoom, so the viewport is carried as a box that halves per zoom level — anchored, again, on
 * the verified ~1° box at zoom 14. Clamped so the box stays a box: never larger than a hemisphere, never
 * so small that Worldview's own imagery has nothing to resample.
 */
const BBOX_HALF_AT_DEFAULT = 0.5;
const BBOX_HALF_RANGE: readonly [number, number] = [0.005, 45];

function bboxHalfDeg(zoom: number): number {
  const raw = BBOX_HALF_AT_DEFAULT * Math.pow(2, DEFAULT_ZOOM - zoom);
  const [lo, hi] = BBOX_HALF_RANGE;
  return Math.min(hi, Math.max(lo, raw));
}

const fmt = (n: number): string => n.toFixed(DECIMALS);

/**
 * Build the deterministic external-context deep-links for a [lon,lat] point. Coordinates are formatted to a
 * fixed 5 decimals and comma-encoded (%2C) exactly where the provider's verified template requires it. NASA
 * Worldview receives a bbox centred on the point, sized from the same zoom. Pure + total: the same input
 * always yields the same list — no provider is contacted.
 */
export function buildExternalViews(
  position: Position,
  opts?: ExternalViewsOptions,
): readonly ExternalViewLink[] {
  const [lon, lat] = position;
  const latS = fmt(lat);
  const lonS = fmt(lon);
  const zoom = opts?.zoom ?? DEFAULT_ZOOM;
  // Clamp the bbox corners to valid geographic ranges so a point near the antimeridian/poles never emits
  // an out-of-range lon (±180) / lat (±90) into the Worldview `v=` extent (in-range coords are untouched).
  const half = bboxHalfDeg(zoom);
  const minLon = fmt(Math.max(-180, lon - half));
  const minLat = fmt(Math.max(-90, lat - half));
  const maxLon = fmt(Math.min(180, lon + half));
  const maxLat = fmt(Math.min(90, lat + half));
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
      url: `https://earth.google.com/web/@${latS},${lonS},700a,${earthDistance(zoom)}d,35y,0h,0t,0r`,
    },
    {
      label: 'Bing Aerial',
      provider: 'Bing',
      kind: 'satellite',
      url: `https://www.bing.com/maps/default.aspx?cp=${latS}~${lonS}&style=a&lvl=${zoomFor('bing', zoom)}`,
    },
    {
      label: 'OpenStreetMap',
      provider: 'OpenStreetMap',
      kind: 'map',
      url: `https://www.openstreetmap.org/?mlat=${latS}&mlon=${lonS}#map=${zoomFor('osm', zoom)}/${latS}/${lonS}`,
    },
    {
      label: 'Windy',
      provider: 'Windy',
      kind: 'weather',
      url: `https://www.windy.com/?${latS},${lonS},${zoomFor('windy', zoom)}`,
    },
    {
      label: 'Zoom Earth',
      provider: 'Zoom Earth',
      kind: 'satellite',
      url: `https://zoom.earth/maps/satellite/#view=${latS},${lonS},${zoomFor('zoomEarth', zoom)}z`,
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
      url: `https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@${lonS},${latS},${zoomFor('firms', zoom)}z`,
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
      url: `https://sites.research.google/floods/l/${latS}/${lonS}/${zoomFor('floodHub', zoom)}`,
    },
  ];
}
