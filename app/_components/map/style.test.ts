// BEACON — basemap mode (air-gapped honesty finding, 2026-09-11).
//
// The defect this guards: the file documented an air-gapped swap that no code performed, so a deployment
// built and described as making no egress still asked tile.openstreetmap.org for every tile — and on a
// genuinely disconnected network showed a blank rectangle with nothing saying why. Two properties matter
// and both are pinned here: OFFLINE issues no request at all, and ONLINE is the default no typo can
// silently defeat.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  BASEMAP_CANDIDATES,
  OFFLINE_STYLE,
  OPEN_RASTER_STYLE,
  OSM_ATTRIBUTION,
  attributeSources,
  basemapMode,
  loadBasemapStyle,
  localizeLabels,
  pickBasemapStyle,
  pinnedBasemap,
  probeRasterHost,
  rasterStyle,
  resolveBasemapStyle,
  type Basemap,
} from './style.js';

describe('basemapMode', () => {
  it('is offline ONLY for the exact literal', () => {
    expect(basemapMode('offline')).toBe('offline');
  });

  it.each(['', 'online', 'Offline', 'OFFLINE', 'off', 'air-gapped', 'true'])(
    'falls back to online for %j — a misspelt flag must not blank a connected deployment',
    (value) => {
      // The asymmetry is deliberate. Getting this wrong in the offline direction costs an operator their
      // basemap on a network that could serve it; getting it wrong the other way is caught immediately by
      // the missing label. Fail toward the working map.
      expect(basemapMode(value)).toBe('online');
    },
  );
});

describe('the offline style makes no network request', () => {
  it('declares no sources at all', () => {
    // Not "a source that fails" — no source. MapLibre cannot request what is not declared, which is the
    // only form of this guarantee an air-gapped reviewer can verify by reading the object.
    expect(Object.keys(OFFLINE_STYLE.sources)).toEqual([]);
    expect(JSON.stringify(OFFLINE_STYLE)).not.toMatch(/https?:\/\//);
  });

  it('still paints a deliberate surface, so the canvas is a background and not a void', () => {
    expect(OFFLINE_STYLE.layers).toHaveLength(1);
    expect(OFFLINE_STYLE.layers[0]?.type).toBe('background');
  });

  it('the online style is the one that carries the tile host and its required attribution', () => {
    expect(JSON.stringify(OPEN_RASTER_STYLE)).toContain('tile.openstreetmap.org');
    expect(JSON.stringify(OPEN_RASTER_STYLE)).toContain('OpenStreetMap contributors');
  });
});

describe('resolveBasemapStyle', () => {
  it('starts online on the raster the operator has always had, and offline on nothing', () => {
    // Owner decision, 2026-09-12 evening: the raster is FIRST, exactly as before, and the vector hosts
    // are a fallback for a browser the raster host refuses. No tileless wait on the happy path.
    expect(resolveBasemapStyle('offline')).toBe(OFFLINE_STYLE);
    expect(resolveBasemapStyle('online')).toBe(OPEN_RASTER_STYLE);
  });
});

// ── "Access blocked" and the keyless ladder (2026-09-12) ──────────────────────────────────────────────
//
// The second silent failure of online mode: the OSMF servers refuse a request with 200 OK and an "Access
// blocked" image, so neither the status code nor the body length is dependable. What separates a refusal
// from a tile is the caching header, and that is what these tests fix in place. No network is touched —
// every probe runs against a fake fetch.

const SERVING = new Headers({ 'cache-control': 'max-age=88945, stale-while-revalidate=604800' });
const REFUSING = new Headers({ 'cache-control': 'no-cache' });

/** A minimal third-party style document — deliberately carrying NO attribution, which is exactly what
 *  OpenFreeMap publishes, and one symbol layer so the localization rewrite has something to act on. */
function styleDoc(): unknown {
  return {
    version: 8,
    sources: { openmaptiles: { type: 'vector', url: 'https://tiles.example/planet' } },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#000' } },
      {
        id: 'place',
        type: 'symbol',
        layout: { 'text-field': ['get', 'name:latin'], 'text-size': 12 },
      },
    ],
  };
}

type HostVerdict = 'tile' | 'blocked' | 'style' | 'not-a-style' | 'http-error' | 'network-error';

/** A fetch answering per host, covering every way a rung can fail. */
function fakeFetch(byHost: Record<string, HostVerdict>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const host = new URL(String(input)).host;
    const verdict = byHost[host];
    if (verdict === 'network-error') throw new Error('offline');
    if (verdict === 'http-error') return new Response('nope', { status: 404 });
    if (verdict === 'style') return Response.json(styleDoc());
    if (verdict === 'not-a-style') return Response.json({ hello: 'world' });
    return new Response(new Uint8Array([137, 80, 78, 71]), {
      status: 200,
      headers: verdict === 'tile' ? SERVING : REFUSING,
    });
  }) as typeof fetch;
}

const ALL_SERVING: Record<string, HostVerdict> = {
  'tiles.openfreemap.org': 'style',
  'tiles.versatiles.org': 'style',
  'tile.openstreetmap.org': 'tile',
};

describe('the keyless ladder', () => {
  it('starts on the raster the operator had, keeps exactly one raster rung, and falls back to vector', () => {
    // Owner decision, 2026-09-12 evening. The raster host was verified refusing THIS project's build
    // machine, but tiles are fetched by the OPERATOR'S browser and theirs was serving fine — so the raster
    // stays first (probed for the 200 OK refusal) and the vector hosts are the fallback for a browser that
    // IS refused. Every other keyless RASTER host is the same volunteer pool, so there is only one.
    expect(BASEMAP_CANDIDATES[0]?.kind).toBe('raster');
    const rasters = BASEMAP_CANDIDATES.filter((c) => c.kind === 'raster');
    expect(rasters).toHaveLength(1);
    expect(BASEMAP_CANDIDATES.slice(1).every((c) => c.kind === 'vector')).toBe(true);
  });

  it('credits OpenStreetMap on every rung', () => {
    // Art. XI. Every rung here renders OSM data under ODbL; a rung that shows it without the credit is
    // a licence breach, not a cosmetic omission.
    for (const candidate of BASEMAP_CANDIDATES) {
      expect(candidate.attribution).toContain('OpenStreetMap');
    }
    expect(rasterStyle(BASEMAP_CANDIDATES[0] as Basemap).sources.osm).toMatchObject({
      attribution: OSM_ATTRIBUTION,
    });
  });

  it('asks for no key on any rung', () => {
    for (const candidate of BASEMAP_CANDIDATES) {
      expect(candidate.url).not.toMatch(/key=|token=|apikey|access_token/i);
    }
  });

  it('uses the canonical OSM host, never the deprecated rotating subdomains', () => {
    // `{s}.tile.openstreetmap.org` has been deprecated for years and is a refusal trigger.
    expect(JSON.stringify(OPEN_RASTER_STYLE)).not.toMatch(/\{s\}\.tile\.openstreetmap\.org/);
  });

  it('keeps the Referrer-Policy the tile servers require', () => {
    // A tile request carrying no Referer is refused. `no-referrer` is what produces blocked tiles.
    const config = readFileSync(new URL('../../../next.config.mjs', import.meta.url), 'utf8');
    expect(config).toMatch(/'Referrer-Policy',\s*value:\s*'strict-origin-when-cross-origin'/);
    expect(config).not.toMatch(/value:\s*'no-referrer'/);
  });
});

describe('probeRasterHost', () => {
  const osm = BASEMAP_CANDIDATES[0] as Basemap;

  it('reads a long-cached response as a real tile', async () => {
    await expect(
      probeRasterHost(osm, fakeFetch({ 'tile.openstreetmap.org': 'tile' })),
    ).resolves.toBe(true);
  });

  it('reads a no-cache response as the "Access blocked" refusal', async () => {
    await expect(
      probeRasterHost(osm, fakeFetch({ 'tile.openstreetmap.org': 'blocked' })),
    ).resolves.toBe(false);
  });

  it('treats an unreachable host as serving, so a network blip costs nothing', async () => {
    const offline = fakeFetch({ 'tile.openstreetmap.org': 'network-error' });
    await expect(probeRasterHost(osm, offline)).resolves.toBe(true);
  });
});

describe('attributeSources', () => {
  it('stamps our own credit onto a document that declares none', async () => {
    // OpenFreeMap's style document carries no attribution field at all. Handing it to MapLibre unchanged
    // renders OSM data with no credit — an ODbL breach — which is why the fetch exists at all.
    const loaded = await loadBasemapStyle(
      BASEMAP_CANDIDATES[1] as Basemap,
      'en',
      fakeFetch(ALL_SERVING),
    );
    expect(loaded).not.toBeNull();
    for (const source of Object.values(loaded?.sources ?? {})) {
      expect((source as { attribution?: string }).attribution).toContain('OpenStreetMap');
    }
  });

  it('replaces whatever the third party declared, rather than appending to it', () => {
    // The credit shown is a string this repo controls. Third-party HTML arriving over the network is
    // what the MapLibre attribution sanitizer advisory (GHSA-jrc7-96c5-q579) was about.
    const hostile = {
      version: 8,
      sources: { a: { type: 'vector', attribution: '<img src=x onerror=alert(1)>' } },
      layers: [],
    } as unknown as Parameters<typeof attributeSources>[0];
    const out = attributeSources(hostile, OSM_ATTRIBUTION);
    expect(JSON.stringify(out)).not.toContain('onerror');
  });
});

describe('localizeLabels', () => {
  it('prefers the operator language, then the latin name, then the local name', async () => {
    // ADR-030 recorded that raster basemap labels cannot be localized — true of a PNG, not of vector
    // tiles. This is the rewrite that makes the basemap speak Romanian in Romania.
    const ro = await loadBasemapStyle(
      BASEMAP_CANDIDATES[1] as Basemap,
      'ro',
      fakeFetch(ALL_SERVING),
    );
    const symbol = ro?.layers.find((l) => l.type === 'symbol') as unknown as {
      layout: { 'text-field': unknown[] };
    };
    expect(symbol.layout['text-field']).toEqual([
      'coalesce',
      ['get', 'name:ro'],
      ['get', 'name:latin'],
      ['get', 'name'],
    ]);
  });

  it('takes the base language of a regional tag', () => {
    const style = JSON.parse(JSON.stringify(styleDoc())) as Parameters<typeof localizeLabels>[0];
    const out = localizeLabels(style, 'pt-BR');
    expect(JSON.stringify(out)).toContain('name:pt');
  });

  it('leaves right-to-left languages on the latin label, because MapLibre cannot shape them here', () => {
    // Deliberate, not an omission: RTL shaping needs setRTLTextPlugin, fetched from a CDN at runtime,
    // which this project does not take. Unshaped Arabic in the wrong visual order is worse than the
    // transliteration. Remove this and an Arabic operator's basemap gets worse, not better.
    const style = JSON.parse(JSON.stringify(styleDoc())) as Parameters<typeof localizeLabels>[0];
    expect(localizeLabels(style, 'ar')).toBe(style);
    expect(localizeLabels(style, 'ur')).toBe(style);
  });

  it('leaves English alone, and never touches a non-label layer', () => {
    const style = JSON.parse(JSON.stringify(styleDoc())) as Parameters<typeof localizeLabels>[0];
    expect(localizeLabels(style, 'en')).toBe(style);
    const out = localizeLabels(style, 'ro');
    expect(out.layers[0]).toMatchObject({ id: 'bg', type: 'background' });
  });
});

describe('loadBasemapStyle', () => {
  const vector = BASEMAP_CANDIDATES[1] as Basemap;

  it('refuses a rung that answers with an HTTP error', async () => {
    const res = await loadBasemapStyle(
      vector,
      'en',
      fakeFetch({ 'tiles.openfreemap.org': 'http-error' }),
    );
    expect(res).toBeNull();
  });

  it('refuses a rung that answers with something that is not a style document', async () => {
    // A captive portal, a proxy error page or a rewritten CDN response all arrive as 200 OK with JSON
    // that MapLibre would throw on. The ladder must read that as "not serving", not crash the map.
    const res = await loadBasemapStyle(
      vector,
      'en',
      fakeFetch({ 'tiles.openfreemap.org': 'not-a-style' }),
    );
    expect(res).toBeNull();
  });

  it('refuses a rung that cannot be reached at all', async () => {
    const res = await loadBasemapStyle(
      vector,
      'en',
      fakeFetch({ 'tiles.openfreemap.org': 'network-error' }),
    );
    expect(res).toBeNull();
  });
});

describe('pickBasemapStyle', () => {
  it('stays on the raster the operator had while it serves', async () => {
    const picked = await pickBasemapStyle('en', fakeFetch(ALL_SERVING));
    expect(picked?.basemap.id).toBe('osm');
  });

  it('moves to the first vector host when the raster answers with the "Access blocked" refusal', async () => {
    const picked = await pickBasemapStyle(
      'en',
      fakeFetch({ ...ALL_SERVING, 'tile.openstreetmap.org': 'blocked' }),
    );
    expect(picked?.basemap.id).toBe('openfreemap');
  });

  it('falls to the second vector host when the first is down too', async () => {
    const picked = await pickBasemapStyle(
      'en',
      fakeFetch({
        'tile.openstreetmap.org': 'blocked',
        'tiles.openfreemap.org': 'http-error',
        'tiles.versatiles.org': 'style',
      }),
    );
    expect(picked?.basemap.id).toBe('versatiles');
  });

  it('reports null rather than a blocked map when every rung refuses', async () => {
    // This is the case the whole change exists for: on 2026-09-12 the raster rung answered 200 OK with
    // an "Access blocked" image. Reporting null is what puts the label on the map instead of a lie.
    const picked = await pickBasemapStyle(
      'en',
      fakeFetch({
        'tiles.openfreemap.org': 'http-error',
        'tiles.versatiles.org': 'http-error',
        'tile.openstreetmap.org': 'blocked',
      }),
    );
    expect(picked).toBeNull();
  });

  it('honours a pinned host and does NOT fail over from it', async () => {
    // An operator who named a host does not want BEACON quietly reaching for a different one.
    const pinned = pinnedBasemap('https://tiles.internal/style.json', '© Agency');
    const picked = await pickBasemapStyle(
      'en',
      fakeFetch({ 'tiles.internal': 'style', ...ALL_SERVING }),
      pinned === null ? [] : [pinned],
    );
    expect(picked?.basemap.id).toBe('pinned');
    expect(JSON.stringify(picked?.style)).toContain('© Agency');
  });
});

describe('pinnedBasemap', () => {
  it('is null when no tile URL is declared, so the candidates apply', () => {
    expect(pinnedBasemap('')).toBeNull();
  });

  it('reads a {z}/{x}/{y} template as raster and anything else as a style document', () => {
    expect(pinnedBasemap('https://tiles.internal/{z}/{x}/{y}.png')?.kind).toBe('raster');
    expect(pinnedBasemap('https://tiles.internal/style.json')?.kind).toBe('vector');
  });

  it('takes the declared URL and attribution verbatim', () => {
    expect(pinnedBasemap('https://tiles.internal/{z}/{x}/{y}.png', '© Agency')).toMatchObject({
      id: 'pinned',
      url: 'https://tiles.internal/{z}/{x}/{y}.png',
      attribution: '© Agency',
    });
  });

  it('credits OpenStreetMap for a pinned OSM host that declares no attribution', () => {
    expect(pinnedBasemap('https://tile.openstreetmap.org/{z}/{x}/{y}.png')?.attribution).toBe(
      OSM_ATTRIBUTION,
    );
  });

  it("never puts OpenStreetMap's name under a host that is not OpenStreetMap", () => {
    // A false credit is its own licence problem. An unrecognised pinned host contributes no string of
    // ours, and the style document it serves keeps whatever credit it declares. Copilot, PR #18.
    const pinned = pinnedBasemap('https://tiles.internal/style.json');
    expect(pinned?.attribution).toBe('');
    const own = {
      version: 8,
      sources: { a: { type: 'vector', attribution: '© Agency' } },
      layers: [],
    };
    const kept = attributeSources(own as unknown as Parameters<typeof attributeSources>[0], '');
    expect(JSON.stringify(kept)).toContain('© Agency');
  });
});

// ── The worker files the copy script depends on (2026-09-12) ──────────────────────────────────────────
//
// `scripts/copy-maplibre-worker.mjs` copies two named files out of `node_modules/maplibre-gl/dist`. If
// MapLibre renames or restructures them in a future version, that script silently copies nothing useful
// and the map goes blank again — in a BUILD, which no unit test sees. This asserts the two file names it
// depends on, and that the worker still imports its shared chunk by the relative specifier that makes
// copying both of them necessary.
describe("MapLibre's worker files are where the copy script expects", () => {
  const dist = new URL('../../../node_modules/maplibre-gl/dist/', import.meta.url);

  it('ships the worker and the shared chunk it imports', () => {
    const worker = readFileSync(new URL('maplibre-gl-worker.mjs', dist), 'utf8');
    expect(worker.length).toBeGreaterThan(0);
    // The relative specifier is the reason BOTH files must land in the same served directory.
    expect(worker).toContain('./maplibre-gl-shared.mjs');
    expect(readFileSync(new URL('maplibre-gl-shared.mjs', dist), 'utf8').length).toBeGreaterThan(0);
  });

  it('still resolves its worker relative to import.meta.url, which is why setWorkerUrl is needed', () => {
    // The day this stops being true, the copy + setWorkerUrl can go. Until then it is load-bearing: in a
    // Next chunk that expression resolves to a path webpack never emitted.
    const main = readFileSync(new URL('maplibre-gl.mjs', dist), 'utf8');
    expect(main).toContain('maplibre-gl-worker.mjs');
    expect(main).toContain('import.meta.url');
  });
});
