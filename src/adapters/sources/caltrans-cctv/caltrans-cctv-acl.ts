// BEACON — Caltrans District CCTV anti-corruption layer (E11 "Live Views" · CW1; adapter-contract §4,
// CameraDirectoryPort, Art. XII/link-only doctrine). Maps a raw Caltrans CWWP2 per-district CCTV status
// JSON row → the canonical CameraFeed (kind TRAFFIC_CCTV). This is the ONLY place the raw Caltrans field
// shape exists (AGENTS.md §3).
//
// VERIFIED SOURCE (recorded 2026-07-17, `curl -sS
// https://cwwp2.dot.ca.gov/data/d3/cctv/cctvStatusD03.json`): the live payload is `{ "data": [ { "cctv":
// {...} } ] }` — one row per camera, nested one level under `cctv`. District 3 (Sacramento Valley/Northern
// CA, covers Butte County — the BEACON CA flagship scenario area) returned 272 cameras spanning Sacramento,
// El Dorado, Placer, Yolo, Nevada, Butte, Colusa, Yuba, Sutter and Alameda counties. Fields actually used
// here: `location.{longitude,latitude,locationName,nearbyPlace,county,route,direction,district}` (decimal
// strings), `inService` ('true'/'false' string), `imageData.streamingVideoURL` (m3u8, may be `''`) and
// `imageData.static.currentImageURL` (jpg still, always populated when present in the live sample). Every
// `currentImageURL`/`streamingVideoURL` observed in the live sample was already `https://` — no non-https
// URL was seen — but the guard below is still enforced defensively (Art. XII href-injection guard).
//
// LENIENT-ACL DOCTRINE (matches eagle-i-acl.ts/opencellid-acl.ts): a business-level reason a row cannot
// become a plottable, link-safe CameraFeed — out of service, no usable https view-link candidate, or an
// unparseable position — is not a hard PARSE failure (one bad camera must never fail the whole district
// fetch, Art. XVI). Such rows are SKIPPED and COUNTED at parse time, never silently vanished.
import type { CameraFeed } from '@/domain/index.js';
import { makeCameraFeed } from '@/domain/index.js';
import type { Position } from '@/domain/value-objects/geo.js';
import type { CameraFeedId } from '@/domain/value-objects/ids.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { LinkOnlyUrl } from '@/domain/shared/link-policy.js';
import { isLinkOnlyUrl } from '@/domain/shared/link-policy.js';
import type { AntiCorruptionMapper } from '@/adapters/_shared/index.js';

export const CALTRANS_CCTV_PROVIDER = 'Caltrans';
// DATA_SOURCE_VERIFICATION §"Caltrans QuickMap/CWWP": "public data files, 5-min updates, keyless" — no
// separate DSV license clause beyond that; the plan's manifest wording is used verbatim for attribution.
export const CALTRANS_CCTV_LICENSE = 'Caltrans open data';

/** Raw `imageData.static` — only the still-image URL is read; reference-image history is not used. */
interface CaltransRawImageStatic {
  readonly currentImageURL?: string | null;
}

/** Raw `imageData` — the still (`static.currentImageURL`) and/or live (`streamingVideoURL`) candidates. */
interface CaltransRawImageData {
  readonly streamingVideoURL?: string | null;
  readonly static?: CaltransRawImageStatic | null;
}

/** Raw `location` — decimal-string lat/lon plus the human-facing place fields used for `title`. */
interface CaltransRawLocation {
  readonly district?: string | number | null;
  readonly locationName?: string | null;
  readonly nearbyPlace?: string | null;
  readonly longitude?: string | number | null;
  readonly latitude?: string | number | null;
  readonly county?: string | null;
  readonly route?: string | null;
  readonly direction?: string | null;
}

/** One raw `data[].cctv` element, before validation/normalization. */
export interface CaltransRawCctv {
  readonly index?: string | number | null;
  readonly location?: CaltransRawLocation | null;
  readonly inService?: string | boolean | null;
  readonly imageData?: CaltransRawImageData | null;
}

/** One raw `data[]` element — the CWWP2 status JSON nests every camera one level under `cctv`. */
export interface CaltransRawRow {
  readonly cctv?: CaltransRawCctv | null;
}

interface CaltransRawRoot {
  readonly data?: readonly CaltransRawRow[];
}

/** One row ready for the mapper: already validated position/viewUrl/liveness, still needs `makeCameraFeed`. */
export interface CaltransCameraRow {
  readonly id: string;
  readonly title: string;
  readonly position: Position; // [lon,lat]
  // F-153: branded — the ONLY way to fill this field is a value narrowed by the shared link policy, so a
  // re-declared private https predicate would fail `tsc --noEmit` here instead of diverging silently.
  readonly viewUrl: LinkOnlyUrl; // https, named host, ≤2048 — streamingVideoURL when present, else currentImageURL
  readonly isLive: boolean; // true only when viewUrl came from streamingVideoURL
}

export interface ParsedCaltransCameras {
  readonly rows: readonly CaltransCameraRow[];
  /** Rows dropped for out-of-service / no https view-link candidate / unparseable position / missing id
   *  or title — SKIPPED and COUNTED, never silently vanished (Art. XII). */
  readonly skipped: number;
}

/** Parse a Caltrans CWWP2 `cctvStatusD{NN}.json` body into mapper-ready rows. */
export function parseCaltransCameras(text: string): ParsedCaltransCameras {
  const doc = JSON.parse(text) as CaltransRawRoot;
  const data = Array.isArray(doc.data) ? doc.data : [];
  const rows: CaltransCameraRow[] = [];
  let skipped = 0;
  for (const raw of data) {
    const row = toRow(raw.cctv);
    if (row === undefined) {
      skipped += 1;
      continue;
    }
    rows.push(row);
  }
  return { rows, skipped };
}

/** Assemble one mapper-ready row, or `undefined` if any lenient-drop condition applies (module header):
 *  out-of-service, no stable id, no title, unparseable position, or no usable https view-link candidate.
 *  Split into two small functions (the service-status gate, then field extraction) so neither exceeds the
 *  complexity floor (Gate 6, <10). */
function toRow(cctv: CaltransRawCctv | null | undefined): CaltransCameraRow | undefined {
  if (cctv === null || cctv === undefined) return undefined;
  if (!isInService(cctv.inService)) return undefined; // out-of-service camera — drop (never a dead-link pin)
  return buildRow(cctv);
}

function buildRow(cctv: CaltransRawCctv): CaltransCameraRow | undefined {
  const index = extractIndex(cctv.index);
  if (index === undefined) return undefined;

  const title = buildTitle(cctv.location);
  if (title === undefined) return undefined;

  const position = parsePosition(cctv.location?.longitude, cctv.location?.latitude);
  if (position === undefined) return undefined; // unparseable/out-of-range coordinate — never plottable

  const viewUrl = pickViewUrl(cctv.imageData);
  if (viewUrl === undefined) return undefined; // neither streamingVideoURL nor currentImageURL is a usable https URL

  return {
    id: buildId(cctv.location?.district, index),
    title,
    position,
    viewUrl: viewUrl.url,
    isLive: viewUrl.isLive,
  };
}

function extractIndex(raw: string | number | null | undefined): string | undefined {
  return trimmedOrUndefined(nullableToString(raw));
}

function buildId(rawDistrict: string | number | null | undefined, index: string): string {
  const district = trimmedOrUndefined(nullableToString(rawDistrict));
  return `caltrans-cctv:${district ?? 'd0'}:${index}`;
}

function nullableToString(v: string | number | null | undefined): string | undefined {
  return v === null || v === undefined ? undefined : String(v);
}

/** Caltrans stamps `inService` as the STRING `'true'`/`'false'` (verified live) — a boolean is also accepted
 *  defensively. Anything else (missing/malformed) is treated as NOT in service (the safe default — never
 *  pin a camera the feed didn't affirmatively mark serviceable). */
function isInService(raw: string | boolean | null | undefined): boolean {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') return raw.trim().toLowerCase() === 'true';
  return false;
}

function buildTitle(loc: CaltransRawLocation | null | undefined): string | undefined {
  const name = trimmedOrUndefined(loc?.locationName ?? undefined);
  if (name === undefined) return undefined;
  const place = trimmedOrUndefined(loc?.nearbyPlace ?? undefined);
  return place === undefined ? name : `${name} (${place})`;
}

function parsePosition(rawLon: string | number | null | undefined, rawLat: string | number | null | undefined): Position | undefined {
  const lon = toFiniteNumber(rawLon);
  const lat = toFiniteNumber(rawLat);
  if (lon === undefined || lat === undefined) return undefined;
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return undefined;
  return [lon, lat];
}

function toFiniteNumber(v: string | number | null | undefined): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

interface ViewUrlPick {
  readonly url: LinkOnlyUrl;
  readonly isLive: boolean;
}

/** Prefer the live m3u8 stream; fall back to the still image; either must satisfy the SHARED link-only policy
 *  (`@/domain/shared/link-policy` — absolute https, named host, ≤2048 chars). F-153: this ACL no longer owns a
 *  private copy of that rule; `makeCameraFeed` enforces the very same policy again, defense in depth. */
function pickViewUrl(imageData: CaltransRawImageData | null | undefined): ViewUrlPick | undefined {
  const stream = trimmedOrUndefined(imageData?.streamingVideoURL ?? undefined);
  if (stream !== undefined && isLinkOnlyUrl(stream)) return { url: stream, isLive: true };
  const still = trimmedOrUndefined(imageData?.static?.currentImageURL ?? undefined);
  if (still !== undefined && isLinkOnlyUrl(still)) return { url: still, isLive: false };
  return undefined;
}

function trimmedOrUndefined(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  const trimmed = v.trim();
  return trimmed === '' ? undefined : trimmed;
}

// A row that fails makeCameraFeed's invariants should not happen — toRow() already validated position/
// viewUrl/title above; mapRows (the anti-corruption runner) auto-wraps any non-AdapterError throw as a
// typed PARSE regardless, so this mapper does not need its own try/catch (adapter-contract §4).
export const caltransCctvMapper: AntiCorruptionMapper<CaltransCameraRow, CameraFeed> = {
  // `ctx` intentionally omitted from this implementation's arity — TS structurally allows a mapper with
  // fewer parameters than the AntiCorruptionMapper interface declares (see nfhl-acl.ts/eagle-i-acl.ts).
  toCanonical(raw: CaltransCameraRow): CameraFeed {
    return makeCameraFeed({
      id: asId<CameraFeedId>(raw.id),
      position: raw.position,
      kind: 'TRAFFIC_CCTV',
      title: raw.title,
      provider: CALTRANS_CCTV_PROVIDER,
      viewUrl: raw.viewUrl,
      license: CALTRANS_CCTV_LICENSE,
      isLive: raw.isLive,
    });
  },
};
