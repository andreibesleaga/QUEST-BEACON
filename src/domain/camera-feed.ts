// BEACON — CAMERA_FEED entity (E11 "Live Views" · CW0). A location-pinned LIVE camera surfaced on the COP
// as a link-out pin: fire-spotting PTZ (ALERTWildfire/ALERTCalifornia), traffic CCTV (Caltrans/511/CNADNR),
// webcams (Windy) and consent-gated citizen streams. Pure domain: no framework/HTTP/DB imports (F9).
//
// LINK-ONLY doctrine (ADR-027/028, Art. XII): BEACON never takes possession of third-party video bytes — a
// CameraFeed only ever carries the external live-view PAGE url, which the UI opens in a new tab. The engine
// and the LLM never read a pixel from it (advisory-not-fact). The `viewUrl` link-only invariant is the
// href-injection / open-redirect guard: an adapter must construct the url from a fixed host + typed
// coordinates, never echo a raw upstream string that could carry `javascript:`/`data:`/`http:` into an href.
// That rule has exactly ONE implementation — `shared/link-policy.ts` (F-153); this file imports it.
import type { CameraFeedId } from './value-objects/ids.js';
import type { Position } from './value-objects/geo.js';
import { isPosition } from './value-objects/geo.js';
import { invariant, definedOnly } from './shared/guard.js';
import { assertLinkOnlyUrl } from './shared/link-policy.js';

/** The closed set of camera kinds. CITIZEN_STREAM is the consent-gated "Unofficial" category (never merged
 *  visually with agency cameras; ships behind FEATURE_CITIZEN_STREAM, wave CW4). */
export const CAMERA_FEED_KINDS = [
  'FIRE_CAMERA',
  'TRAFFIC_CCTV',
  'WEBCAM',
  'CITIZEN_STREAM',
] as const;
export type CameraFeedKind = (typeof CAMERA_FEED_KINDS)[number];

export interface CameraFeed {
  readonly id: CameraFeedId;
  readonly position: Position; // [lon,lat] of the camera installation
  readonly kind: CameraFeedKind;
  readonly title: string; // human-facing camera name (e.g. 'Colby Fire — Camera 2')
  readonly provider: string; // attribution source, e.g. 'ALERTCalifornia' | 'Caltrans' | 'windy.com'
  readonly viewUrl: string; // the external live-view PAGE (https, host-validated) — link-out only
  readonly license: string; // for the mandatory attribution badge/credit
  readonly isLive: boolean; // false ⇒ periodic snapshot, labelled honestly
  readonly observedAt?: string; // last camera-list refresh (ISO-8601)
}

export interface MakeCameraFeedInput {
  readonly id: CameraFeedId;
  readonly position: Position;
  readonly kind: CameraFeedKind;
  readonly title: string;
  readonly provider: string;
  readonly viewUrl: string;
  readonly license: string;
  readonly isLive: boolean;
  readonly observedAt?: string;
}

/** A finite [lon,lat] within WGS84 bounds — a NaN/Infinity or out-of-range coordinate is never plottable. */
function isValidPosition(p: Position): boolean {
  return (
    isPosition(p) &&
    Number.isFinite(p[0]) &&
    Number.isFinite(p[1]) &&
    p[0] >= -180 &&
    p[0] <= 180 &&
    p[1] >= -90 &&
    p[1] <= 90
  );
}

/** Construct a CameraFeed, enforcing the link-only + attribution + plottable-position invariants. */
export function makeCameraFeed(input: MakeCameraFeedInput): CameraFeed {
  invariant(
    typeof input.id === 'string' && input.id.trim().length > 0,
    'CameraFeed.id must be a non-empty string',
  );
  invariant(
    isValidPosition(input.position),
    'CameraFeed.position must be a finite [lon,lat] within [-180,180]/[-90,90]',
  );
  invariant(
    CAMERA_FEED_KINDS.includes(input.kind),
    `CameraFeed.kind invalid: ${String(input.kind)}`,
  );
  invariant(
    typeof input.title === 'string' && input.title.trim().length > 0,
    'CameraFeed.title must be a non-empty string',
  );
  invariant(
    typeof input.provider === 'string' && input.provider.trim().length > 0,
    'CameraFeed.provider must be a non-empty string',
  );
  invariant(
    typeof input.license === 'string' && input.license.trim().length > 0,
    'CameraFeed.license must be a non-empty string (attribution is mandatory)',
  );
  // F-153: the link-out href-injection guard is DERIVED from the one shared policy, never re-declared here.
  // Converging this site also STRENGTHENED it: the old private `isHttpsUrl` accepted an IP-literal host and
  // an unbounded length, which the shared policy rejects (SSRF/metadata pivot + storage/log-injection cap).
  assertLinkOnlyUrl(input.viewUrl, 'CameraFeed.viewUrl');
  invariant(typeof input.isLive === 'boolean', 'CameraFeed.isLive must be a boolean');
  // exactOptionalPropertyTypes: definedOnly drops an absent observedAt rather than setting it undefined.
  return definedOnly({
    id: input.id,
    position: input.position,
    kind: input.kind,
    title: input.title,
    provider: input.provider,
    viewUrl: input.viewUrl,
    license: input.license,
    isLive: input.isLive,
    observedAt: input.observedAt,
  }) as CameraFeed;
}
