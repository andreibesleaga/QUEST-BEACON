// BEACON — Copernicus Data Space Ecosystem (CDSE) imagery fetcher (S2·Lane V, plan §0 decision 11).
// The OPTIONAL richer rung: Sentinel-2 L2A true colour at 10 m, versus GIBS's 250 m MODIS. It is optional in
// the strong sense — `COPERNICUS_CLIENT_ID`/`_SECRET` come from a free account the operator may never have
// created, so ABSENT CREDENTIALS MUST DEGRADE TO GIBS (handled in `resolver.ts`), never fail the demo.
//
// Scheme: `cdse:<minLon,minLat,maxLon,maxLat>:<YYYY-MM-DD>` (no layer segment — the evalscript below fixes
// the product to Sentinel-2 L2A true colour, so there is nothing for a caller to choose).
//
// Endpoints verified against the official CDSE documentation on 2026-08-08:
//   token   https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token
//   process https://sh.dataspace.copernicus.eu/api/v1/process
// (documentation.dataspace.copernicus.eu → APIs/SentinelHub/Overview/Authentication + Process.)
import {
  assertIsoDate,
  parseBbox,
  readImageResponse,
  type Bbox,
  type FetchLike,
  type ImageryFetcher,
  type VisionImage,
} from './imagery-source.js';

export const CDSE_SCHEME = 'cdse:';

const DEFAULT_TOKEN_URL = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
const DEFAULT_PROCESS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/process';
const DEFAULT_PIXELS = 512;
const CDSE_ATTRIBUTION = 'Copernicus Sentinel-2 L2A (ESA / Copernicus Data Space Ecosystem) — free & open, attribution required';

/** Widen a single acquisition day into the ±N-day window Sentinel-2's ~5-day revisit actually needs. */
const REVISIT_WINDOW_DAYS = 5;
const MS_PER_DAY = 86_400_000;

/** Refresh a token this many ms before it expires — a token that dies mid-flight looks like an outage. */
const TOKEN_SKEW_MS = 30_000;

// //VERSION=3 evalscript: bands B04/B03/B02 scaled to 8-bit, i.e. the documented true-colour composite.
// Kept as a CONSTANT rather than a caller input: an evalscript is executable code sent to a remote engine,
// and a caller-supplied one would be an arbitrary-code seam reachable from an `imageRef` string.
const TRUE_COLOUR_EVALSCRIPT =
  '//VERSION=3\nfunction setup() {\n  return { input: ["B02", "B03", "B04"], output: { bands: 3, sampleType: "AUTO" } };\n}\n' +
  'function evaluatePixel(s) {\n  return [2.5 * s.B04, 2.5 * s.B03, 2.5 * s.B02];\n}';

export interface CopernicusCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface CopernicusDeps {
  readonly fetchImpl: FetchLike;
  readonly credentials: CopernicusCredentials;
  readonly pixels?: number;
  readonly tokenUrl?: string;
  readonly processUrl?: string;
  /** Injected clock (plan §1.6 — no wall-clock dependence in tests). */
  readonly now?: () => number;
}

interface TokenResponse {
  readonly access_token?: string;
  readonly expires_in?: number;
}

export function parseCdseRef(imageRef: string): { bbox: Bbox; date: string } {
  if (!imageRef.startsWith(CDSE_SCHEME)) throw new Error(`not a cdse imageRef: ${imageRef}`);
  const parts = imageRef.slice(CDSE_SCHEME.length).split(':');
  const [rawBbox, rawDate] = parts;
  if (parts.length !== 2 || rawBbox === undefined || rawDate === undefined) {
    throw new Error(`imagery ${imageRef} malformed: expected cdse:<bbox>:<YYYY-MM-DD>`);
  }
  return { bbox: parseBbox(rawBbox), date: assertIsoDate(rawDate, imageRef) };
}

function timeRange(date: string): { from: string; to: string } {
  const centre = Date.parse(`${date}T00:00:00Z`);
  return {
    from: new Date(centre - REVISIT_WINDOW_DAYS * MS_PER_DAY).toISOString(),
    to: new Date(centre + MS_PER_DAY).toISOString(),
  };
}

function processBody(bbox: Bbox, date: string, pixels: number): unknown {
  return {
    input: {
      bounds: {
        bbox: [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat],
        properties: { crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84' },
      },
      data: [{ type: 'sentinel-2-l2a', dataFilter: { timeRange: timeRange(date) } }],
    },
    output: { width: pixels, height: pixels, responses: [{ identifier: 'default', format: { type: 'image/png' } }] },
    evalscript: TRUE_COLOUR_EVALSCRIPT,
  };
}

/**
 * Client-credentials token with an in-memory cache.
 *
 * The cache is NOT an optimization: CDSE's own documentation states token requests are rate limited and warns
 * against fetching a new one per API call ("if you are getting an HTTP 429 … you are requesting too many
 * tokens"). Minting per image would turn a working credential into an intermittent 429 outage.
 */
function makeTokenSource(deps: CopernicusDeps): () => Promise<string> {
  const url = deps.tokenUrl ?? DEFAULT_TOKEN_URL;
  const clock = deps.now ?? Date.now;
  let cached: { token: string; expiresAt: number } | undefined;
  return async (): Promise<string> => {
    if (cached !== undefined && clock() < cached.expiresAt) return cached.token;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: deps.credentials.clientId,
      client_secret: deps.credentials.clientSecret,
    });
    const res = await deps.fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      redirect: 'manual',
    });
    if (!res.ok) throw new Error(`CDSE token request failed: HTTP ${res.status}`);
    const json = (await res.json()) as TokenResponse;
    if (typeof json.access_token !== 'string' || json.access_token.length === 0) {
      throw new Error('CDSE token response carried no access_token');
    }
    const ttlMs = (json.expires_in ?? 0) * 1000;
    cached = { token: json.access_token, expiresAt: clock() + Math.max(ttlMs - TOKEN_SKEW_MS, 0) };
    return json.access_token;
  };
}

export function makeCopernicusFetcher(deps: CopernicusDeps): ImageryFetcher {
  const processUrl = deps.processUrl ?? DEFAULT_PROCESS_URL;
  const pixels = deps.pixels ?? DEFAULT_PIXELS;
  const tokenSource = makeTokenSource(deps);
  return {
    scheme: CDSE_SCHEME,
    async fetch(imageRef: string): Promise<VisionImage> {
      const { bbox, date } = parseCdseRef(imageRef);
      const token = await tokenSource();
      const res = await deps.fetchImpl(processUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'image/png', authorization: `Bearer ${token}` },
        body: JSON.stringify(processBody(bbox, date, pixels)),
        redirect: 'manual',
      });
      const { bytes, mediaType } = await readImageResponse(res, imageRef);
      return { imageRef, bytes, mediaType, attribution: `${CDSE_ATTRIBUTION} — ${date}, bbox ${imageRef.slice(CDSE_SCHEME.length).split(':')[0]}` };
    },
  };
}
