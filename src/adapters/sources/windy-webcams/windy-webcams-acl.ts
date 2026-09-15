// BEACON — Windy Webcams anti-corruption layer (E11 "Live Views" · CW1 windy-webcams lane; ADR-027,
// FR-CAM-1/2/3, LIVE_VIEWS_FEATURE_PLAN §3.3 Windy row). Maps a raw Windy Webcams API v3
// `GET /webcams/api/v3/webcams` response → the canonical `CameraFeed` (kind WEBCAM). This is the ONLY
// place the raw Windy shape exists; no `webcamId`/`urls`/`location` field name escapes above this module
// (AGENTS.md §3). Positions/urls are produced deterministically here — never by the LLM.
//
// SOURCE VERIFICATION (2026-07-17, via api.windy.com/webcams/api/v3/docs, api.windy.com/webcams/
// version-transfer, community.windy.com): base `https://api.windy.com/webcams/api/v3/webcams`; auth
// header `x-windy-api-key`; `bbox` query param format `{north_lat},{east_lon},{south_lat},{west_lon}`;
// `include=location,urls` (+images/player/categories); response webcam object: `webcamId` (number),
// `title`, `status` ('active'|'inactive'), `lastUpdatedOn` (ISO), `location{latitude,longitude,city,
// region,country,continent,...}`, `urls{detail,edit}`. `urls.detail` is the windy.com human view page
// (documented pattern `https://www.windy.com/webcams/{webcamId}`, confirmed against a live v3 API example
// URL in Windy community docs) — used verbatim when present/https, else constructed from the id per that
// same documented pattern (never dropped for a missing `urls.detail` alone, since the id-based pattern is
// verified). A row is only DROPPED (never a fabricated URL) if even the id-constructed URL fails the
// https-only guard (e.g. an empty/malformed id) — see buildViewUrl.
//
// LINK-ONLY doctrine (Art. XII, CameraFeed.viewUrl invariant): only ever the windy.com view PAGE, never a
// direct image/stream URL — no embedding, no proxying, no rehosting Windy's tokened image URLs.
//
// Mapping decision — inactive webcams (documented, FR-CAM-2 honest-degrade): Windy's `status: 'inactive'`
// means the camera is not currently refreshing its feed, but its windy.com view page (typically showing
// the last captured image) remains a valid, useful link-out target. We therefore KEEP inactive webcams
// and map `isLive: false` (never silently dropping them) — consistent with Art. XVI ("never a dead-end",
// label degradation honestly rather than hide it).
//
// A raw webcam missing/invalid id, or missing/invalid location.lat/lon, cannot be placed on the map or
// linked; per the adapter-contract pattern (mirrors opencellid-acl.ts/nifc-acl.ts) those rows are SKIPPED
// + COUNTED at parse time (parseWindyWebcams), never silently dropped without a trace, and never fail the
// whole batch. The mapper itself still honors the generic AntiCorruptionMapper contract and throws a
// typed PARSE if it is ever handed such a malformed row directly.
import type { CameraFeed, CameraFeedId } from '@/domain/index.js';
import { asId, makeCameraFeed } from '@/domain/index.js';
import type { LinkOnlyUrl } from '@/domain/shared/link-policy.js';
import { isLinkOnlyUrl } from '@/domain/shared/link-policy.js';
import type { AntiCorruptionMapper, MapContext } from '@/adapters/_shared/index.js';
import { makeAdapterError } from '@/adapters/_shared/index.js';

const PROVIDER = 'windy.com';
const LICENSE = 'Windy Webcams API ToS (link-only; attribution required)';

/** One raw Windy Webcams API v3 `location` object (webcam sub-shape). Raw until mapped. */
export interface WindyWebcamLocation {
  readonly latitude?: number | string | null;
  readonly longitude?: number | string | null;
  readonly city?: string | null;
  readonly region?: string | null;
  readonly country?: string | null;
  readonly continent?: string | null;
}

/** One raw Windy Webcams API v3 `urls` object (webcam sub-shape). Raw until mapped. */
export interface WindyWebcamUrls {
  readonly detail?: string | null;
  readonly edit?: string | null;
}

/** One raw Windy Webcams API v3 webcam record (`webcams[]` element, `include=location,urls`). */
export interface WindyWebcamRaw {
  readonly webcamId?: number | string;
  readonly title?: string | null;
  readonly status?: string | null; // 'active' | 'inactive'
  readonly lastUpdatedOn?: string | null; // ISO-8601
  readonly location?: WindyWebcamLocation | null;
  readonly urls?: WindyWebcamUrls | null;
}

interface WindyWebcamsResponse {
  readonly webcams?: readonly unknown[];
}

export interface ParsedWindyWebcams {
  readonly rows: readonly WindyWebcamRaw[];
  /** Count of raw entries dropped for missing/invalid webcamId or location lat/lon (data hygiene). */
  readonly skipped: number;
}

/** Parse a `webcams/api/v3/webcams` JSON body into raw webcam rows, skipping (and counting) malformed entries. */
export function parseWindyWebcams(text: string): ParsedWindyWebcams {
  const doc = JSON.parse(text) as WindyWebcamsResponse;
  const raw = Array.isArray(doc.webcams) ? doc.webcams : [];
  const rows: WindyWebcamRaw[] = [];
  let skipped = 0;
  for (const entry of raw) {
    if (isWellFormedWebcam(entry)) rows.push(entry);
    else skipped += 1;
  }
  return { rows, skipped };
}

function isWellFormedWebcam(entry: unknown): entry is WindyWebcamRaw {
  if (typeof entry !== 'object' || entry === null) return false;
  const w = entry as WindyWebcamRaw;
  return (
    webcamIdStr(w.webcamId) !== undefined &&
    num(w.location?.latitude) !== undefined &&
    num(w.location?.longitude) !== undefined
  );
}

interface ValidatedWebcam {
  readonly id: string;
  readonly lat: number;
  readonly lon: number;
  readonly viewUrl: string;
}

/** Validate + extract the fields a canonical CameraFeed cannot do without; throws a typed PARSE on the
 *  first missing/invalid one (id, then position, then a constructible https view URL). Split out of
 *  `toCanonical` purely to keep that method's cyclomatic complexity low (complexity<10 gate). */
function validate(raw: WindyWebcamRaw): ValidatedWebcam {
  const id = webcamIdStr(raw.webcamId);
  if (id === undefined) {
    throw makeAdapterError(
      'PARSE',
      `Windy webcam missing/invalid webcamId: '${String(raw.webcamId)}'`,
    );
  }
  const lat = num(raw.location?.latitude);
  const lon = num(raw.location?.longitude);
  if (lat === undefined || lon === undefined) {
    throw makeAdapterError(
      'PARSE',
      `Windy webcam '${id}' missing/invalid location.latitude,longitude: '${String(raw.location?.latitude)},${String(raw.location?.longitude)}'`,
    );
  }
  const viewUrl = buildViewUrl(id, raw.urls?.detail);
  if (viewUrl === undefined) {
    throw makeAdapterError(
      'PARSE',
      `Windy webcam '${id}': no valid https view URL could be constructed`,
    );
  }
  return { id, lat, lon, viewUrl };
}

export const windyWebcamsMapper: AntiCorruptionMapper<WindyWebcamRaw, CameraFeed> = {
  toCanonical(raw: WindyWebcamRaw, ctx: MapContext): CameraFeed {
    const { id, lat, lon, viewUrl } = validate(raw);
    return makeCameraFeed({
      id: asId<CameraFeedId>(`windy:${id}`),
      position: [lon, lat],
      kind: 'WEBCAM',
      title: title(raw.title, id),
      provider: PROVIDER,
      viewUrl,
      license: LICENSE,
      isLive: raw.status === 'active',
      observedAt: isoOrUndefined(raw.lastUpdatedOn) ?? ctx.fetchedAt,
    });
  },
};

/** Prefer the upstream `urls.detail` page when it satisfies the SHARED link-only policy (F-153:
 *  `@/domain/shared/link-policy` — absolute https, NAMED host, ≤2048 chars; this ACL no longer declares its
 *  own copy of that rule); else construct the documented `https://www.windy.com/webcams/{id}` pattern; drop
 *  (undefined) only if neither passes. The branded return type means a value that did NOT pass the policy
 *  cannot be returned from here without an explicit, greppable cast. */
function buildViewUrl(id: string, detail: string | null | undefined): LinkOnlyUrl | undefined {
  if (typeof detail === 'string' && isLinkOnlyUrl(detail)) return detail;
  const constructed = `https://www.windy.com/webcams/${id}`;
  return isLinkOnlyUrl(constructed) ? constructed : undefined;
}

function title(raw: string | null | undefined, id: string): string {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed === '' ? `Windy webcam ${id}` : trimmed;
}

function isoOrUndefined(raw: string | null | undefined): string | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  return Number.isNaN(Date.parse(raw)) ? undefined : raw;
}

function webcamIdStr(v: number | string | null | undefined): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  return undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}
