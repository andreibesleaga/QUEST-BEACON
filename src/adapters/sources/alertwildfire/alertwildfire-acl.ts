// BEACON — ALERTWildfire/ALERTCalifornia anti-corruption layer (E11 "Live Views" · CW1; adapter-contract
// §4, ADR-027, Art. XII). Maps one ALERTCalifornia camera GeoJSON feature → a canonical CameraFeed
// (kind FIRE_CAMERA). This is the ONLY place the raw ArcGIS/Esri camera shape exists; no upstream field
// name (siteId/cameraURL/imageURL/…) escapes above this module (AGENTS.md §3).
//
// SPIKE (2026-07-17, recorded in the adapter header): the ALERTWest OpenAPI at docs.alertwest.org 404s and
// its api host is unreachable keyless, so the LIVE + fixture source is the KEYLESS ArcGIS Living Atlas
// "ALERTCalifornia Live Cameras" FeatureServer (item 0c1c1166688f4f2db938194799337be4, owner
// ALERTCaliforniaProcess). Its per-camera `cameraURL` attribute IS the human live-view page
// (e.g. https://cameras.alertcalifornia.org/?id=Axis-BaldMtnButte1 — camera-specific, host verified 200),
// so BEACON never guesses a URL: viewUrl comes straight from the authoritative layer attribute, https-only.
//
// LINK-ONLY (ADR-027, plan Q3): a CameraFeed carries only the external view PAGE url (cameraURL); the raw
// `imageURL` frame jpg is deliberately NOT surfaced (CC BY-NC-ND 4.0 forbids image rehosting — link, don't
// rehost). A feature missing a Point geometry, a name, or an https `cameraURL` is malformed and SKIPPED at
// parse (counted, never silently vanished — Art. XII).
import type { CameraFeed } from '@/domain/index.js';
import { asId, makeCameraFeed } from '@/domain/index.js';
import type { CameraFeedId } from '@/domain/value-objects/ids.js';
import type { Position } from '@/domain/value-objects/geo.js';
import { isPosition } from '@/domain/value-objects/geo.js';
import type { LinkOnlyUrl } from '@/domain/shared/link-policy.js';
import { isLinkOnlyUrl } from '@/domain/shared/link-policy.js';
import type { AntiCorruptionMapper } from '@/adapters/_shared/index.js';
import { makeAdapterError } from '@/adapters/_shared/index.js';

// Plan §3.3 ALERT row + Locked decision Q3: the mandatory credit string is the provider; the license is the
// CC BY-NC-ND 4.0 link-only reading. Both are constants so no upstream string can weaken the attribution.
export const ALERT_PROVIDER = 'ALERTCalifornia | UC San Diego';
export const ALERT_LICENSE = 'CC BY-NC-ND 4.0 (imagery; link-only use)';

interface AlertRawGeometry {
  readonly type?: string;
  readonly coordinates?: unknown;
}

interface AlertRawProperties {
  readonly OBJECTID?: number | string | null;
  readonly cameraName?: string | null;
  readonly siteId?: string | null;
  readonly county?: string | null;
  readonly cameraURL?: string | null; // per-camera human view page (the verified viewUrl)
  readonly viewTime?: string | null; // last frame time, e.g. '2026-07-16 13:23:42-07:00'
}

/** One raw ALERTCalifornia camera GeoJSON feature (Point), before validation. Raw until mapped. */
export interface AlertRawFeature {
  readonly geometry?: AlertRawGeometry | null;
  readonly properties?: AlertRawProperties | null;
}

/** One validated, mapper-ready camera row (structurally sound Point + name + https view page). */
export interface AlertCameraRow {
  readonly objectId: string;
  readonly title: string;
  readonly position: Position; // [lon,lat]
  // F-153: branded — only a value narrowed by the SHARED link policy can fill this field, so a future
  // private https predicate is a tsc error (Gate 2) rather than a silent divergence from the one rule.
  readonly viewUrl: LinkOnlyUrl; // link-policy-validated cameraURL (https, named host, ≤2048)
  readonly observedAt?: string; // ISO-8601 UTC-offset (from viewTime), when parseable
}

export interface ParsedAlertCameras {
  readonly rows: readonly AlertCameraRow[];
  readonly skipped: number; // malformed/urlless features dropped at parse (counted — Art. XII)
}

/**
 * Parse an ALERTCalifornia camera FeatureServer `f=geojson` FeatureCollection into mapper-ready rows. A
 * feature without a valid Point geometry, a non-empty name, or an https `cameraURL` is dropped and counted
 * (link-only: no https view page ⇒ no plottable link-out pin). Only `features` is read (fixture meta keys
 * are ignored).
 */
export function parseAlertCameras(text: string): ParsedAlertCameras {
  const doc = JSON.parse(text) as { features?: AlertRawFeature[] };
  const features = Array.isArray(doc.features) ? doc.features : [];
  const rows: AlertCameraRow[] = [];
  let skipped = 0;
  features.forEach((feature, i) => {
    const row = toRow(feature, i);
    if (row === undefined) {
      skipped += 1;
      return;
    }
    rows.push(row);
  });
  return { rows, skipped };
}

function toRow(feature: AlertRawFeature, i: number): AlertCameraRow | undefined {
  const props: AlertRawProperties = feature.properties ?? {};
  const position = pointOf(feature.geometry);
  const title = (props.cameraName ?? '').trim();
  const viewUrl = (props.cameraURL ?? '').trim();
  if (position === undefined || title === '' || !isLinkOnlyUrl(viewUrl)) return undefined;
  const objectId = String(props.OBJECTID ?? props.siteId ?? `row${i}`);
  const observedAt = toIsoUtc(props.viewTime);
  return {
    objectId,
    title,
    position,
    viewUrl,
    ...(observedAt !== undefined ? { observedAt } : {}),
  };
}

/** Extract a valid [lon,lat] from a GeoJSON Point geometry; anything else yields undefined. */
function pointOf(geom: AlertRawGeometry | null | undefined): Position | undefined {
  if (geom?.type !== 'Point') return undefined;
  const c = geom.coordinates;
  return isPosition(c) ? c : undefined;
}

// F-153: the link guard is the SHARED `isLinkOnlyUrl` (rejects http:/javascript:/empty/unparseable AND an
// IP-literal host AND an over-long link) — the private `isHttpsUrl` this file used to declare is gone.

/** ALERT `viewTime` is 'YYYY-MM-DD HH:MM:SS±HH:MM'; normalize the space→'T' to ISO-8601. Unparseable ⇒ drop. */
export function toIsoUtc(viewTime: string | null | undefined): string | undefined {
  if (viewTime === null || viewTime === undefined || viewTime.trim() === '') return undefined;
  const iso = viewTime.trim().replace(' ', 'T');
  return Number.isNaN(Date.parse(iso)) ? undefined : iso;
}

// A row that ever fails makeCameraFeed's invariants (should not happen — toRow already validated geometry,
// name and https url) throws InvariantViolation; mapRows auto-wraps any non-AdapterError throw as a typed
// PARSE, so this mapper needs no try/catch (adapter-contract §4). The defensive re-check keeps the mapper
// honest if it is ever called directly with an unvalidated row.
export const alertWildfireMapper: AntiCorruptionMapper<AlertCameraRow, CameraFeed> = {
  toCanonical(raw: AlertCameraRow): CameraFeed {
    if (!isPosition(raw.position)) {
      throw makeAdapterError('PARSE', 'ALERT camera row missing a valid Point position');
    }
    return makeCameraFeed({
      id: asId<CameraFeedId>(`alertwildfire:${raw.objectId}`),
      position: raw.position,
      kind: 'FIRE_CAMERA',
      title: raw.title,
      provider: ALERT_PROVIDER,
      viewUrl: raw.viewUrl,
      license: ALERT_LICENSE,
      isLive: true,
      ...(raw.observedAt !== undefined ? { observedAt: raw.observedAt } : {}),
    });
  },
};
