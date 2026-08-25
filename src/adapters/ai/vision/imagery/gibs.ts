// BEACON — NASA GIBS imagery fetcher (S2·Lane V, plan §0 decision 11; ADR-008a, Art. XI/XVI).
// THE DEFAULT imagery rung, and deliberately the KEYLESS one: GIBS needs no account, no token and no quota,
// so the live-vision demo cannot be broken by a credential the operator never created. Copernicus
// (`copernicus.ts`) is the optional richer rung layered on top, never a prerequisite.
//
// Scheme: `gibs:<layer>:<minLon,minLat,maxLon,maxLat>:<YYYY-MM-DD>` (an empty <layer> means the default).
//
// WMS 1.1.1 GetMap, not WMTS, and not 1.3.0 — both choices are load-bearing:
//   • WMTS is tile-indexed (z/x/y); the caller here has a BBOX and a date, and converting one to the other
//     would put a tiling calculation (and its rounding) between the operator and the pixels they asked for.
//     GIBS exposes the same "best" visualizations over WMS, which is bbox-native.
//   • WMS **1.3.0** flips EPSG:4326 axis order to lat/lon, which fails silently — you get a real image of the
//     wrong place. 1.1.1 keeps BBOX as lon/lat, matching `parseBbox`, so a transposition cannot happen.
//
// Endpoint + default layer verified live against the official GIBS API docs on 2026-08-08
// (https://nasa-gibs.github.io/gibs-api-docs/access-basics/). GIBS answers a bad layer with HTTP 200 + an
// OGC ServiceException XML body, which is why `readImageResponse` insists on an `image/*` content type.
import {
  assertIsoDate,
  bboxToString,
  parseBbox,
  readImageResponse,
  type FetchLike,
  type ImageryFetcher,
  type VisionImage,
} from './imagery-source.js';

export const GIBS_SCHEME = 'gibs:';

/** EPSG:4326 "best" WMS endpoint (GIBS API docs, access-basics). Overridable via deps — never hardcoded downstream. */
const DEFAULT_GIBS_WMS = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';

/**
 * MODIS Terra corrected reflectance in bands 7-2-1 (SWIR/NIR/Red) — the standard wildfire false-colour
 * composite in which an active burn glows and a burn SCAR reads as dark red-brown against green vegetation.
 * True colour would hide exactly the signal a `burn-area` task is asking about, so the default is the
 * fire-relevant product, not the prettiest one. Global, daily, no key.
 */
export const GIBS_DEFAULT_LAYER = 'MODIS_Terra_CorrectedReflectance_Bands721';

/** Recommended layer per vision task — a caller that names no layer still gets a product that can answer it. */
export const GIBS_TASK_LAYERS: Readonly<Record<string, string>> = {
  'burn-area': GIBS_DEFAULT_LAYER,
  'flood-extent': 'MODIS_Terra_CorrectedReflectance_TrueColor',
};

const DEFAULT_PIXELS = 512;
const GIBS_ATTRIBUTION = 'NASA EOSDIS GIBS (Worldview) — NASA open data, attribution requested';

// Layer ids are `[A-Za-z0-9_-]` in the GIBS catalogue. Constraining the charset keeps a caller-supplied
// imageRef from smuggling extra query parameters into the GetMap URL (parameter-injection / SSRF hygiene,
// mirroring the imageRef allow-list already enforced at the HTTP edge in channels/http/routing.ts:277).
const LAYER_ID = /^[A-Za-z0-9_-]+$/;

export interface GibsDeps {
  readonly fetchImpl: FetchLike;
  /** `VISION_MAX_IMAGE_MB` is enforced centrally by the resolver; width/height bound the request instead. */
  readonly pixels?: number;
  readonly wmsBase?: string;
  /** Injected default so a `gibs::<bbox>:<date>` ref can pick a task-appropriate product. */
  readonly defaultLayer?: string;
}

interface GibsRef {
  readonly layer: string;
  readonly bbox: string;
  readonly date: string;
}

/**
 * Parse `gibs:<layer>:<bbox>:<date>`. The bbox itself contains commas but no colons, so a 3-way split on the
 * remainder is unambiguous. An empty layer segment is legal and means "use the configured default".
 */
export function parseGibsRef(imageRef: string, defaultLayer: string): GibsRef {
  if (!imageRef.startsWith(GIBS_SCHEME)) throw new Error(`not a gibs imageRef: ${imageRef}`);
  const parts = imageRef.slice(GIBS_SCHEME.length).split(':');
  const [rawLayer, rawBbox, rawDate] = parts;
  if (parts.length !== 3 || rawBbox === undefined || rawDate === undefined) {
    throw new Error(`imagery ${imageRef} malformed: expected gibs:<layer>:<bbox>:<YYYY-MM-DD>`);
  }
  const layer = rawLayer !== undefined && rawLayer.length > 0 ? rawLayer : defaultLayer;
  if (!LAYER_ID.test(layer)) throw new Error(`imagery ${imageRef} has an invalid GIBS layer id "${layer}"`);
  parseBbox(rawBbox); // validate now so a bad box fails before any egress
  return { layer, bbox: rawBbox, date: assertIsoDate(rawDate, imageRef) };
}

/** Build a `gibs:` handle from a bbox + calendar day (used by the UI's live-imagery trigger). */
export function gibsImageRef(bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number }, date: string, layer = ''): string {
  return `${GIBS_SCHEME}${layer}:${bboxToString(bbox)}:${date}`;
}

function getMapUrl(base: string, ref: GibsRef, pixels: number): string {
  const query = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.1.1',
    REQUEST: 'GetMap',
    LAYERS: ref.layer,
    SRS: 'EPSG:4326',
    BBOX: ref.bbox,
    WIDTH: String(pixels),
    HEIGHT: String(pixels),
    FORMAT: 'image/png',
    TIME: ref.date,
  });
  return `${base}?${query.toString()}`;
}

export function makeGibsFetcher(deps: GibsDeps): ImageryFetcher {
  const base = deps.wmsBase ?? DEFAULT_GIBS_WMS;
  const pixels = deps.pixels ?? DEFAULT_PIXELS;
  const defaultLayer = deps.defaultLayer ?? GIBS_DEFAULT_LAYER;
  return {
    scheme: GIBS_SCHEME,
    async fetch(imageRef: string): Promise<VisionImage> {
      const ref = parseGibsRef(imageRef, defaultLayer);
      const res = await deps.fetchImpl(getMapUrl(base, ref, pixels), { redirect: 'manual' });
      const { bytes, mediaType } = await readImageResponse(res, imageRef);
      return {
        imageRef,
        bytes,
        mediaType,
        attribution: `${GIBS_ATTRIBUTION} — layer ${ref.layer}, ${ref.date}, bbox ${ref.bbox}`,
      };
    },
  };
}
