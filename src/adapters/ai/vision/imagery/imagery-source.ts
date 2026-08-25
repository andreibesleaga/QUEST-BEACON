// BEACON — imagery-fetch seam for the live vision ladder (S2·Lane V; ADR-008a, Art. XII/XIV/XVI).
// A `VisionRequest.imageRef` is a HANDLE, never pixels (ports/intel.ts:72). Something has to turn that
// handle into bytes before a model can look at anything, and until now nothing did: `MockVision` reads no
// pixels at all, so every documented imagery scheme was a claim with no reader. This module is that reader's
// contract — one tiny interface per scheme, resolved by prefix, with the size ceiling and the PII posture
// enforced in ONE place so no individual fetcher can forget them.
//
// Deliberately free of network defaults at this layer: `fetchImpl` is injected everywhere (tests never touch
// the network — plan §1.6), and each fetcher owns its own endpoint constant + env override.
import type { Env } from '@/config/index.js';

/** Bytes + the media type a model needs to be told, plus the attribution line the finding must carry (Art. XI). */
export interface VisionImage {
  readonly imageRef: string;
  readonly bytes: Uint8Array;
  readonly mediaType: string; // image/png | image/jpeg — sent verbatim in the data URI
  /** Human-readable provenance for the advisory finding + the audit record (source, licence, instrument). */
  readonly attribution: string;
}

/** One imagery scheme (`gibs:`, `cdse:`, `fixture:`). `fetch` REJECTS rather than returning a placeholder. */
export interface ImageryFetcher {
  readonly scheme: string;
  fetch(imageRef: string): Promise<VisionImage>;
}

/** The injected `fetch` seam. Identical shape to `adapters/ai/http-client.ts`'s FetchLike (binary here). */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const BYTES_PER_MB = 1024 * 1024;

/**
 * The size ceiling (`VISION_MAX_IMAGE_MB`). An oversized image is REFUSED, never downscaled or truncated:
 * a truncated image would produce a confident finding about pixels that were never sent, which is a worse
 * failure than no finding at all (the ladder degrades to a labelled MockVision rung instead).
 */
export function assertWithinSizeBudget(bytes: Uint8Array, maxImageMb: number, imageRef: string): void {
  if (bytes.byteLength > maxImageMb * BYTES_PER_MB) {
    throw new Error(`imagery ${imageRef} refused: ${bytes.byteLength} bytes exceeds VISION_MAX_IMAGE_MB=${maxImageMb}`);
  }
}

/** `data:<mediaType>;base64,<…>` — the transport every OpenAI-compatible vision endpoint accepts. */
export function toDataUri(image: VisionImage): string {
  return `data:${image.mediaType};base64,${Buffer.from(image.bytes).toString('base64')}`;
}

/**
 * A geographic bounding box in `minLon,minLat,maxLon,maxLat` order — the order WMS 1.1.1 and the Sentinel Hub
 * Process API both use, so no fetcher has to re-order axes (WMS 1.3.0's EPSG:4326 lat/lon flip is the classic
 * silent-wrong-tile bug; 1.1.1 is chosen in `gibs.ts` precisely to avoid it).
 */
export interface Bbox {
  readonly minLon: number;
  readonly minLat: number;
  readonly maxLon: number;
  readonly maxLat: number;
}

const LON_LIMIT = 180;
const LAT_LIMIT = 90;
const BBOX_PARTS = 4;

/** Parse + VALIDATE a bbox. An out-of-range or inverted box is rejected here, not silently sent upstream. */
export function parseBbox(raw: string): Bbox {
  const parts = raw.split(',').map((p) => Number(p.trim()));
  if (parts.length !== BBOX_PARTS || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`imagery bbox must be four finite numbers "minLon,minLat,maxLon,maxLat" (got "${raw}")`);
  }
  const [minLon, minLat, maxLon, maxLat] = parts as [number, number, number, number];
  const inRange =
    Math.abs(minLon) <= LON_LIMIT && Math.abs(maxLon) <= LON_LIMIT && Math.abs(minLat) <= LAT_LIMIT && Math.abs(maxLat) <= LAT_LIMIT;
  if (!inRange || minLon >= maxLon || minLat >= maxLat) {
    throw new Error(`imagery bbox out of range or inverted: "${raw}"`);
  }
  return { minLon, minLat, maxLon, maxLat };
}

export function bboxToString(bbox: Bbox): string {
  return `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`;
}

/** ISO calendar day (`YYYY-MM-DD`) — the acquisition-date granularity every imagery scheme here uses. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function assertIsoDate(raw: string, imageRef: string): string {
  if (!ISO_DATE.test(raw)) throw new Error(`imagery ${imageRef} has a non-ISO date "${raw}" (expected YYYY-MM-DD)`);
  return raw;
}

/**
 * Read an HTTP response as image bytes.
 *
 * WHY the content-type check is not optional: NASA GIBS answers a bad layer/date with **HTTP 200** and an
 * `application/vnd.ogc.se_xml` ServiceExceptionReport body (verified live 2026-08-08). A `res.ok`-only guard
 * would hand a model an XML error document as if it were imagery and get back a confident, meaningless
 * classification. The same shape protects the CDSE and fixture rungs at no extra cost.
 */
export async function readImageResponse(res: Response, imageRef: string): Promise<{ bytes: Uint8Array; mediaType: string }> {
  if (!res.ok) throw new Error(`imagery ${imageRef} fetch failed: HTTP ${res.status}`);
  const mediaType = (res.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
  if (!mediaType.startsWith('image/')) {
    throw new Error(`imagery ${imageRef} returned "${mediaType || 'no content-type'}", not an image (upstream error document)`);
  }
  return { bytes: new Uint8Array(await res.arrayBuffer()), mediaType };
}

/** The subset of parsed config the imagery layer reads (keeps fetchers testable without a whole Env). */
export type ImageryEnv = Pick<Env, 'VISION_MAX_IMAGE_MB' | 'VISION_PII_SCREEN' | 'COPERNICUS_CLIENT_ID' | 'COPERNICUS_CLIENT_SECRET'>;
