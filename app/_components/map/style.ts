// BEACON — Tokenless MapLibre base style (E8·T-358). NO vendor token, NO API key, on any rung.
//
// AIR-GAPPED HONESTY (2026-09-11 audit finding). The previous version of this file said "offline/
// air-gapped deployments swap this for cached/GIBS tiles via the `style` engine option" — and nothing
// did the swap. An operator who followed the air-gapped instructions got a map that silently requested
// tile.openstreetmap.org, which in a genuinely disconnected network means a blank grey rectangle with no
// explanation and, worse, egress attempted from a deployment documented as making none.
//
// That is exactly the failure Art. XVI forbids: degrade, LABEL, never dead-end. The basemap is now a
// declared mode. `offline` ships a valid tileless style — a plain background over which every
// operational layer still draws, because the deck.gl overlay never depended on the raster underneath —
// and the map surface says so in the operator's own language.
//
// Why a background rather than bundled world tiles: a low-zoom world raster is 10-40 MB of imagery to
// carry, licence, and keep current, for a backdrop that tells a responder nothing their own layers do
// not. Saying "no basemap here" costs nothing and lies about nothing.
//
// ACCESS BLOCKED (2026-09-12). Online mode had the mirror image of that defect. The OpenStreetMap
// Foundation's volunteer tile servers enforce their Tile Usage Policy, and a request they refuse comes
// back as *200 OK* carrying an "Access blocked" PNG: nothing errors, no tile event fires, and the
// operator simply reads "Access blocked" printed across the incident area. Verified against the live
// host on 2026-09-12 — `tile.openstreetmap.org` answered this project's own network with a 6,933-byte
// refusal PNG and `cache-control: no-cache`, with AND without a `Referer`. The default basemap was, in
// production, already blocked.
//
// THE FIX IS NOT ANOTHER VOLUNTEER RASTER HOST. `tile.openstreetmap.de` and `a.tile.openstreetmap.fr`
// serve today, but they are the same volunteer pool under the same policy (osm-fr additionally asks
// third-party applications not to use it), so a ladder built from them is three ways to be refused.
// The durable keyless options are the community VECTOR hosts, which publish terms permitting production
// use, ask only for attribution, and send `Access-Control-Allow-Origin: *`:
//
//   * OpenFreeMap  — https://openfreemap.org  (OpenMapTiles schema, planet tiles)
//   * VersaTiles   — https://versatiles.org
//
// They are also faster (vector tiles, CDN-served, one ~25 KB style document) and they carry real label
// data, which a raster PNG cannot: ADR-030 recorded "basemap labels cannot be localized" as an honest
// limitation of the raster style, and on a vector style they can — see `localizeLabels`.
//
// The online ladder (owner decision, 2026-09-12 evening — raster FIRST, vector as FALLBACK): the OSM
// raster the operator already had, probed for the 200 OK refusal because that host cannot report its own
// failure → OpenFreeMap → VersaTiles → no basemap, LABELLED. The raster was verified refused on THIS
// project's build machine, but tiles are fetched by the OPERATOR'S browser and theirs was serving fine;
// the vector hosts exist for a browser that is refused. Never a dead end, never a rung that lies.
//
// Sources: https://operations.osmfoundation.org/policies/tiles/ · https://openfreemap.org ·
// https://versatiles.org
import type { StyleSpecification } from 'maplibre-gl';

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

/** `online` (default) fetches a keyless basemap; `offline` draws none and labels its absence. */
export type BasemapMode = 'online' | 'offline';

/**
 * The declared basemap mode. Anything other than the literal `offline` means online — an unset or
 * misspelt value must not silently disable the basemap on a connected deployment.
 *
 * READ AS A STATIC MEMBER EXPRESSION, DELIBERATELY. `next build` inlines a client-side flag only when it
 * appears literally as `process.env.NEXT_PUBLIC_...`; it cannot follow a computed key, and it certainly
 * cannot follow one whose object arrived as a defaulted parameter. The first version of this function
 * took `env = process.env` and indexed it, which type-checked, passed its own tests (they inject the
 * object) and would have shipped a browser bundle where the value is simply `undefined` — so an
 * air-gapped build would have gone on requesting OSM tiles while every test said it did not.
 *
 * That is the exact defect class this file was written to close, reintroduced one layer down. Caught in
 * review by Copilot on PR #10, 2026-09-11. The test override is now a plain string parameter, which
 * cannot interfere with the inlining, and `vi.stubEnv` still drives the real expression in unit tests.
 */
export function basemapMode(override?: string | undefined): BasemapMode {
  const declared = override ?? process.env.NEXT_PUBLIC_BASEMAP_MODE;
  return declared === 'offline' ? 'offline' : 'online';
}

/** `vector` hosts a style document (labels are data); `raster` hosts pre-drawn PNG tiles. */
export type BasemapKind = 'vector' | 'raster';

/** One keyless basemap: where it lives, what kind it is, and the credit its licence requires. */
export interface Basemap {
  readonly id: string;
  readonly kind: BasemapKind;
  /** `vector`: the style document URL. `raster`: a `{z}/{x}/{y}` tile template. */
  readonly url: string;
  readonly attribution: string;
  readonly maxzoom: number;
}

/** The canonical OSM raster — kept as the LAST rung, never the first. See the header note. */
const OSM_STANDARD: Basemap = {
  id: 'osm',
  kind: 'raster',
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: OSM_ATTRIBUTION,
  maxzoom: 19,
};

/**
 * The online ladder, most preferred first. Both vector rungs permit production use without a key and
 * require only attribution; the raster rung is the community fallback and is probed before it is shown.
 * A deployment that needs a basemap it controls pins one with `NEXT_PUBLIC_BASEMAP_TILE_URL`, or goes
 * `offline`.
 */
export const BASEMAP_CANDIDATES: readonly Basemap[] = [
  // FIRST, AS IT ALWAYS WAS (owner decision, 2026-09-12 evening). The raster host was verified to refuse
  // THIS PROJECT'S build machine — but tiles are fetched by the OPERATOR'S browser, not by the server,
  // and the operator's browser was getting them fine. Moving vector first cost the map on mobile for a
  // reason that had nothing to do with the tiles (the MapLibre worker, see map-engine.ts). So: the raster
  // the operator had is the raster the operator keeps, probed for the 200 OK refusal; the vector hosts
  // are the fallback for a browser that IS refused.
  OSM_STANDARD,
  {
    id: 'openfreemap',
    kind: 'vector',
    // `fiord` is the dark style: the COP surface is dark, and a light basemap under bright operational
    // layers costs contrast exactly where an operator is reading severity.
    url: 'https://tiles.openfreemap.org/styles/fiord',
    attribution: `${OSM_ATTRIBUTION} · © OpenMapTiles · OpenFreeMap`,
    maxzoom: 20,
  },
  {
    id: 'versatiles',
    kind: 'vector',
    url: 'https://tiles.versatiles.org/assets/styles/eclipse/style.json',
    attribution: `${OSM_ATTRIBUTION} · VersaTiles`,
    maxzoom: 20,
  },
];

const CANDIDATE_HOSTS = new Set(
  BASEMAP_CANDIDATES.map((candidate) => {
    try {
      return new URL(candidate.url).host;
    } catch {
      return '';
    }
  }),
);

/**
 * What to credit a pinned host with when the operator named no attribution.
 *
 * Defaulting to OpenStreetMap's name for ANY pinned URL was wrong in the direction that matters: it would
 * print "© OpenStreetMap contributors" under a commercial or agency basemap that has nothing to do with
 * OSM — a false credit, which is its own licence problem. A pinned host we recognise keeps the OSM credit;
 * anything else contributes no string of ours, and `attributeSources` then leaves whatever the style
 * document itself declares. Raised in review by Copilot on PR #18.
 */
function defaultPinnedAttribution(url: string): string {
  try {
    return CANDIDATE_HOSTS.has(new URL(url).host) ? OSM_ATTRIBUTION : '';
  } catch {
    return '';
  }
}

/**
 * A pinned basemap — a self-hosted or cached server, or a commercial one — wins over every candidate and
 * disables the failover, because an operator who named a host does not want BEACON quietly reaching for a
 * different one. A URL containing `{z}` is a raster tile template; anything else is a style document.
 * Read as a static member expression for the same inlining reason as `basemapMode`.
 */
export function pinnedBasemap(
  overrideUrl?: string | undefined,
  overrideAttribution?: string | undefined,
): Basemap | null {
  const url = overrideUrl ?? process.env.NEXT_PUBLIC_BASEMAP_TILE_URL;
  if (url === undefined || url === '') return null;
  const attribution = overrideAttribution ?? process.env.NEXT_PUBLIC_BASEMAP_ATTRIBUTION;
  return {
    id: 'pinned',
    kind: url.includes('{z}') ? 'raster' : 'vector',
    url,
    attribution: attribution ?? defaultPinnedAttribution(url),
    maxzoom: 19,
  };
}

/** The ladder this deployment walks: the pinned host alone, or the candidate list. */
export function basemapChain(pinned: Basemap | null = pinnedBasemap()): readonly Basemap[] {
  return pinned === null ? BASEMAP_CANDIDATES : [pinned];
}

/** Build a MapLibre style for one raster basemap. */
export function rasterStyle(basemap: Basemap): StyleSpecification {
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: [basemap.url],
        tileSize: 256,
        maxzoom: basemap.maxzoom,
        attribution: basemap.attribution,
      },
    },
    layers: [{ id: 'osm-tiles', type: 'raster', source: 'osm' }],
  };
}

/** The raster fallback style, kept as a named export because the ADRs and task ledger cite it. */
export const OPEN_RASTER_STYLE: StyleSpecification = rasterStyle(OSM_STANDARD);

/**
 * Is this raster host actually serving tiles to us?
 *
 * The refusal arrives as 200 OK with an "Access blocked" image, so the status code says nothing. What
 * does separate the two is the caching header: a real tile carries a long `max-age`, a refusal carries
 * `no-cache`. Verified against the live host, both ways round, on 2026-09-12. Deliberately conservative:
 * anything it cannot classify counts as serving, so a transient network fault never costs the basemap.
 */
export async function probeRasterHost(
  basemap: Basemap,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const url = basemap.url.replace('{z}', '6').replace('{x}', '33').replace('{y}', '22');
  try {
    const response = await fetchImpl(url, { method: 'GET', mode: 'cors', cache: 'no-store' });
    if (!response.ok) return false;
    return !/no-cache|no-store/i.test(response.headers.get('cache-control') ?? '');
  } catch {
    return true;
  }
}

/** The subset of a style document this module rewrites. Kept local: MapLibre's own layer union is a
 *  discriminated type over every layer kind, and narrowing it here would buy nothing but casts. */
interface MutableLayer {
  type: string;
  layout?: Record<string, unknown>;
}

/** A fetched style document is third-party input: it is a style only if it says so in the shape. */
function isStyleDocument(value: unknown): value is StyleSpecification {
  if (typeof value !== 'object' || value === null) return false;
  const doc = value as { version?: unknown; sources?: unknown; layers?: unknown };
  return doc.version === 8 && typeof doc.sources === 'object' && Array.isArray(doc.layers);
}

/**
 * Stamp OUR attribution onto every source of a fetched style, replacing whatever the document carried.
 *
 * Two reasons, and the licence one is the reason this is not optional: OpenFreeMap's style document
 * declares NO attribution at all, so handing it to MapLibre unchanged renders a map of OSM data with no
 * credit — an ODbL breach and an Art. XI failure. The second is the MapLibre attribution sanitizer
 * advisory (GHSA-jrc7-96c5-q579, the reason this project is on v6): the credit shown is now a plain
 * string this repo controls, never third-party HTML that arrived over the network.
 */
export function attributeSources(
  style: StyleSpecification,
  attribution: string,
): StyleSpecification {
  // An empty credit means "we have nothing to say about this host" — a pinned third-party style, whose
  // own document carries its own terms. Overwriting it with nothing would strip a credit the operator is
  // obliged to show, which is the same failure this function exists to prevent, pointing the other way.
  if (attribution === '') return style;
  const sources = Object.fromEntries(
    Object.entries(style.sources).map(([id, source]) => [id, { ...source, attribution }]),
  );
  return { ...style, sources } as StyleSpecification;
}

/**
 * Right-to-left languages are DELIBERATELY left on the latin label.
 *
 * MapLibre shapes RTL text only with `setRTLTextPlugin`, whose build is fetched from a CDN at runtime —
 * an external dependency this project does not take (ADR-030 §5 takes the same position on fonts). Asking
 * for `name:ar` without it renders Arabic unshaped and in the wrong visual order, which is worse than the
 * transliteration an Arabic-speaking operator gets today. The UI chrome around the map is fully localized
 * and mirrored either way; this is the basemap's own labels only.
 */
const RTL_LABEL_SCRIPTS = new Set(['ar', 'he', 'fa', 'ur', 'ckb', 'ps', 'dv', 'yi']);

/**
 * Rewrite every label layer to prefer the operator's own language.
 *
 * ADR-030 recorded, truthfully, that the raster basemap's labels could not be localized: they are baked
 * into the PNG. OpenMapTiles vector tiles carry `name:<lang>` per feature, so on a vector rung the
 * basemap can finally speak Romanian in Romania — the coalesce falls back to the latin transliteration
 * and then the local name, so a language the tiles do not carry degrades to exactly today's behaviour
 * rather than to an empty label.
 */
export function localizeLabels(style: StyleSpecification, locale: string): StyleSpecification {
  const lang = locale.split('-')[0]?.toLowerCase() ?? '';
  if (lang === '' || lang === 'en' || RTL_LABEL_SCRIPTS.has(lang)) return style;
  const layers = (style.layers as unknown as MutableLayer[]).map((layer) => {
    if (layer.type !== 'symbol' || layer.layout?.['text-field'] === undefined) return layer;
    return {
      ...layer,
      layout: {
        ...layer.layout,
        'text-field': ['coalesce', ['get', `name:${lang}`], ['get', 'name:latin'], ['get', 'name']],
      },
    };
  });
  return { ...style, layers } as unknown as StyleSpecification;
}

/**
 * The style for one rung, or null if that rung is not serving.
 *
 * Vector rungs are fetched here rather than handed to MapLibre as a URL, which is what makes the ladder
 * work: the fetch IS the probe (a host that cannot answer returns no document), the attribution can be
 * corrected before the document is ever rendered, and the labels can be localized. It costs no extra
 * request — MapLibre would have made exactly this one.
 */
export async function loadBasemapStyle(
  basemap: Basemap,
  locale: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StyleSpecification | null> {
  if (basemap.kind === 'raster') {
    return (await probeRasterHost(basemap, fetchImpl)) ? rasterStyle(basemap) : null;
  }
  try {
    const response = await fetchImpl(basemap.url, { method: 'GET', mode: 'cors' });
    if (!response.ok) return null;
    const doc: unknown = await response.json();
    if (!isStyleDocument(doc)) return null;
    return localizeLabels(attributeSources(doc, basemap.attribution), locale);
  } catch {
    return null;
  }
}

/** The first rung that is actually serving, with its style — or null when every rung refused. */
export async function pickBasemapStyle(
  locale: string,
  fetchImpl: typeof fetch = fetch,
  chain: readonly Basemap[] = basemapChain(),
): Promise<{ basemap: Basemap; style: StyleSpecification } | null> {
  for (const basemap of chain) {
    const style = await loadBasemapStyle(basemap, locale, fetchImpl);
    if (style !== null) return { basemap, style };
  }
  return null;
}

/**
 * The air-gapped style: no sources at all, so MapLibre issues NO network request of any kind, and one
 * background layer so the canvas is a deliberate surface rather than an empty void. Operational layers
 * (fire, gauges, routes, shelters) are deck.gl overlays and render exactly as they do online.
 */
export const OFFLINE_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'no-basemap', type: 'background', paint: { 'background-color': '#10151c' } }],
};

/**
 * The style this build starts from. Explicit, so the air-gapped path is a choice and not an accident.
 * Online starts on the raster IMMEDIATELY — exactly as it did before 2026-09-12 — and the ladder only
 * moves it if the probe finds that raster refusing. No tileless wait, no change for the operator whose
 * map was working.
 */
export function resolveBasemapStyle(mode: BasemapMode = basemapMode()): StyleSpecification {
  return mode === 'offline' ? OFFLINE_STYLE : OPEN_RASTER_STYLE;
}
