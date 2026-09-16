// BEACON — CNADNR-RO anti-corruption layer (CameraDirectoryPort P16; adapter-contract §4, Art. XII, E11
// "Live Views" CW1). Maps one HAND-CURATED CNADNR/CNAIR traffic-camera catalog row -> a canonical
// CameraFeed. The ONLY place this raw row shape exists; no fixture field escapes above this module
// (AGENTS.md §3).
//
// HAND-CURATED SOURCE, NOT SCRAPED: CNADNR/CNAIR ("Compania Nationala de Administrare a Infrastructurii
// Rutiere" — the Romanian national road authority) publishes live traffic-camera PAGES at
// https://www.cnadnr.ro/ro/trafic-live/<location> with no API and no machine-readable lat/lon. There is
// nothing to page through or scrape live — the __fixtures__/cameras.json file IS the catalog, curated by
// hand and verified (each href curl-checked HTTP 200) on 2026-07-17. See that file's header for the full
// honesty note (5 official camera pages; coordinates are curated town-level approximations, not scraped).
import type { CameraFeed } from '@/domain/camera-feed.js';
import { makeCameraFeed } from '@/domain/camera-feed.js';
import { asId } from '@/domain/value-objects/ids.js';
import { isLinkOnlyUrl } from '@/domain/shared/link-policy.js';
import type { CameraFeedId } from '@/domain/value-objects/ids.js';
import type { AntiCorruptionMapper } from '@/adapters/_shared/index.js';
import { makeAdapterError } from '@/adapters/_shared/index.js';

const CNADNR_PROVIDER = 'CNAIR (cnadnr.ro)';
const CNADNR_LICENSE = 'Official public agency pages (link-only)';
/** The ONE host this hand-curated catalog may link to — an allow-list, stricter than the shared policy. */
const CNADNR_HOST_PREFIX = 'https://www.cnadnr.ro/';

/** One hand-curated row from __fixtures__/cameras.json (raw until mapped). */
export interface CnadnrCameraRow {
  readonly id?: string;
  readonly title?: string;
  readonly href?: string;
  readonly lat?: number;
  readonly lon?: number;
  readonly note?: string;
}

interface CnadnrFixtureDoc {
  readonly cameras?: readonly CnadnrCameraRow[];
}

/** Parse the curated fixture JSON text into raw rows (top-level `{ cameras: [...] }` document). */
export function parseCnadnrRows(text: string): CnadnrCameraRow[] {
  const doc = JSON.parse(text) as CnadnrFixtureDoc;
  return Array.isArray(doc.cameras) ? [...doc.cameras] : [];
}

export const cnadnrRoMapper: AntiCorruptionMapper<CnadnrCameraRow, CameraFeed> = {
  toCanonical(raw: CnadnrCameraRow, ctx): CameraFeed {
    const id = requireNonEmptyString(raw.id, 'id');
    const title = requireNonEmptyString(raw.title, 'title');
    const href = requireHref(raw.href, id);
    const lat = requireFiniteCoord(raw.lat, 'lat', id);
    const lon = requireFiniteCoord(raw.lon, 'lon', id);
    return makeCameraFeed({
      id: asId<CameraFeedId>(id),
      position: [lon, lat],
      kind: 'TRAFFIC_CCTV',
      title,
      provider: CNADNR_PROVIDER,
      viewUrl: href,
      license: CNADNR_LICENSE,
      isLive: true,
      observedAt: ctx.fetchedAt,
    });
  },
};

function requireNonEmptyString(value: string | undefined, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw makeAdapterError(
      'PARSE',
      `CNADNR-RO row missing/invalid ${field}: ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/**
 * F-153 note — this ACL's href rule is STRICTER than, not a copy of, the shared link policy: it pins one
 * HOST (`https://www.cnadnr.ro/`), because the catalog is hand-curated from that one authority's pages.
 * Converging it to `isLinkOnlyUrl` ALONE would have LOOSENED it into "any named https host", so the
 * allow-list is kept and the shared policy is applied IN ADDITION (it contributes the ≤2048-char cap the
 * prefix check never had). Order matters only for the message; both must hold.
 */
function requireHref(href: string | undefined, id: string): string {
  if (!isLinkOnlyUrl(href) || !href.startsWith(CNADNR_HOST_PREFIX)) {
    throw makeAdapterError(
      'PARSE',
      `CNADNR-RO row '${id}' missing/invalid href (expected ${CNADNR_HOST_PREFIX}...): ${JSON.stringify(href)}`,
    );
  }
  return href;
}

function requireFiniteCoord(value: number | undefined, field: string, id: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw makeAdapterError('PARSE', `CNADNR-RO row '${id}' invalid ${field}: ${String(value)}`);
  }
  return value;
}
