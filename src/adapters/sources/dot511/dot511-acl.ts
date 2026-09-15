// BEACON — 511 DOT anti-corruption layer (E11 "Live Views" · CW1; adapter-contract §4, CameraDirectoryPort
// P16, ADR-027/028, Art. XII link-only doctrine). Maps a raw state 511 traveler-info `get/cameras` response
// (LIVE_VIEWS_FEATURE_PLAN §3.3 dot511 row — verified GA schema, apiary-style API shape shared by many
// states: NY/UT/ID/AZ/LA/...) → the canonical CameraFeed domain entity (kind TRAFFIC_CCTV). This is the
// ONLY place the raw `Id/Source/Roadway/Direction/Latitude/Longitude/Location/Views[]` shape exists (AGENTS
// §3); no field name escapes above this module.
//
// VERIFIED SOURCE (2026-07-17): `https://511ga.org/api/v2/get/cameras?key=<key>&format=json` — a keyless
// curl (`curl -sS 'https://511ga.org/api/v2/get/cameras?format=json'`) returned HTTP 400
// `<Error><Message>Invalid Key</Message></Error>` (developer key required; free registration) — so the
// fixture below is SCHEMA-CRAFTED from the documented response shape (array of camera objects, each with a
// `Views[]` of `{Id, Url, Status, Description}`), not a captured live response. The API is state-generic:
// base URL is config (`SOURCE_DOT511_URL`), key via `DOT511_API_KEY` — the same shape is documented to run
// on many states' 511 traveler-info systems, so this ACL makes no GA-specific assumption beyond the shape.
//
// DROP RULES (Art. XVI — never surface a dead link): a camera with NO `Views[]` entry, or whose every view
// is disabled/non-https, cannot honor the CameraFeed.viewUrl https-only link-out invariant — it is SKIPPED
// and COUNTED at parse time (never silently dropped without a trace, never PARSE-fails the whole batch: one
// camera with no usable view must not blank the rest of the state's camera list). A structurally malformed
// camera (missing/invalid Id or Latitude/Longitude) is skipped+counted the same way (mirrors
// opencellid-acl.ts / nifc-acl.ts). The mapper itself still throws a defensive typed PARSE if it is ever
// called directly with a shape parseDot511Cameras would have rejected.
import type { CameraFeed, CameraFeedId } from '@/domain/index.js';
import { asId, makeCameraFeed } from '@/domain/index.js';
import type { LinkOnlyUrl } from '@/domain/shared/link-policy.js';
import { isLinkOnlyUrl } from '@/domain/shared/link-policy.js';
import type { AntiCorruptionMapper, MapContext } from '@/adapters/_shared/index.js';
import { makeAdapterError } from '@/adapters/_shared/index.js';

/** One raw `Views[]` entry on a 511 camera (raw until mapped). */
export interface Dot511RawView {
  readonly Id?: number | string | null;
  readonly Url?: string | null;
  readonly Status?: string | null; // e.g. 'Enabled' | 'Disabled'
  readonly Description?: string | null;
}

/** One raw 511 `get/cameras` element (raw until mapped). */
export interface Dot511RawCamera {
  readonly Id?: number | string | null;
  readonly Source?: string | null;
  readonly Roadway?: string | null;
  readonly Direction?: string | null;
  readonly Latitude?: number | string | null;
  readonly Longitude?: number | string | null;
  readonly Location?: string | null;
  readonly Views?: readonly Dot511RawView[] | null;
}

export interface ParsedDot511Cameras {
  readonly rows: readonly Dot511RawCamera[];
  /** Count of raw entries dropped for a malformed id/position, or no enabled+https view (drop rules above). */
  readonly skipped: number;
}

// Kept simple by design (LIVE_VIEWS_FEATURE_PLAN §3.3): the same apiary-style API shape runs on many
// states, so the adapter is state-generic — a single generic attribution string rather than deriving a
// per-deployment label from the configured host (which would need plumbing a config value through the
// AntiCorruptionMapper's fixed (raw, ctx) signature, unlike every other mapper in this codebase).
export const DOT511_PROVIDER = '511 DOT (state traveler info)';
export const DOT511_LICENSE = 'State DOT open data (developer key)';

/** Parse a `get/cameras` JSON body (bare array) into raw camera rows, skipping+counting drop-worthy ones. */
export function parseDot511Cameras(text: string): ParsedDot511Cameras {
  const doc = JSON.parse(text) as unknown;
  const raw = Array.isArray(doc) ? doc : [];
  const rows: Dot511RawCamera[] = [];
  let skipped = 0;
  for (const entry of raw) {
    if (isWellFormedCamera(entry) && hasUsableView(entry)) rows.push(entry);
    else skipped += 1;
  }
  return { rows, skipped };
}

export const dot511Mapper: AntiCorruptionMapper<Dot511RawCamera, CameraFeed> = {
  toCanonical(raw: Dot511RawCamera, ctx: MapContext): CameraFeed {
    const lat = num(raw.Latitude);
    const lon = num(raw.Longitude);
    if (lat === undefined || lon === undefined) {
      throw makeAdapterError(
        'PARSE',
        `511 DOT camera missing/invalid Latitude,Longitude: '${String(raw.Latitude)},${String(raw.Longitude)}'`,
      );
    }
    const view = firstUsableView(raw.Views);
    if (view === undefined) {
      throw makeAdapterError(
        'PARSE',
        `511 DOT camera '${String(raw.Id)}' has no enabled https view`,
      );
    }
    return makeCameraFeed({
      id: asId<CameraFeedId>(`dot511-${cameraKey(raw)}`),
      position: [lon, lat],
      kind: 'TRAFFIC_CCTV',
      title: buildTitle(raw),
      provider: DOT511_PROVIDER,
      viewUrl: view.Url,
      license: DOT511_LICENSE,
      isLive: true,
      observedAt: ctx.fetchedAt,
    });
  },
};

/** A view already proven Enabled AND link-policy-clean: `Url` is narrowed to the branded {@link LinkOnlyUrl},
 *  so the mapper below reads it with no `as` cast, and a future private https predicate could not produce a
 *  value of this type (F-153 — the divergence becomes a tsc error, Gate 2). */
export type Dot511UsableView = Dot511RawView & { readonly Url: LinkOnlyUrl };

/** First view that is both Status 'Enabled' (case-insensitive) and a link-policy-valid Url — the link-out
 *  target. The URL rule is the SHARED `isLinkOnlyUrl` (absolute https, NAMED host — never an IP literal —
 *  ≤2048 chars); this ACL no longer carries its own copy of it. */
function firstUsableView(
  views: readonly Dot511RawView[] | null | undefined,
): Dot511UsableView | undefined {
  if (!Array.isArray(views)) return undefined;
  return views.find(isEnabledUsableView);
}

function isEnabledUsableView(v: unknown): v is Dot511UsableView {
  if (typeof v !== 'object' || v === null) return false;
  const view = v as Dot511RawView;
  return isEnabledStatus(view.Status) && isLinkOnlyUrl(view.Url);
}

function isEnabledStatus(status: unknown): boolean {
  return typeof status === 'string' && status.trim().toLowerCase() === 'enabled';
}

function hasUsableView(cam: Dot511RawCamera): boolean {
  return firstUsableView(cam.Views) !== undefined;
}

function isWellFormedCamera(entry: unknown): entry is Dot511RawCamera {
  if (typeof entry !== 'object' || entry === null) return false;
  const cam = entry as Dot511RawCamera;
  return hasId(cam.Id) && num(cam.Latitude) !== undefined && num(cam.Longitude) !== undefined;
}

function hasId(id: unknown): boolean {
  return (
    (typeof id === 'string' && id.trim() !== '') || (typeof id === 'number' && Number.isFinite(id))
  );
}

/** Human-facing title: prefer the upstream Location string; fall back to Roadway+Direction, then a generic. */
function buildTitle(raw: Dot511RawCamera): string {
  const location = strOrUndef(raw.Location);
  if (location !== undefined) return location;
  const roadway = strOrUndef(raw.Roadway);
  const direction = strOrUndef(raw.Direction);
  if (roadway !== undefined) return direction !== undefined ? `${roadway} ${direction}` : roadway;
  return `511 Camera ${String(raw.Id ?? '')}`.trim();
}

function strOrUndef(v: string | null | undefined): string | undefined {
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  return trimmed === '' ? undefined : trimmed;
}

function cameraKey(raw: Dot511RawCamera): string {
  return String(raw.Id ?? `${String(raw.Latitude)},${String(raw.Longitude)}`);
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}
