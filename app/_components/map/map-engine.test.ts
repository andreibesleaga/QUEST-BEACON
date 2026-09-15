// @vitest-environment happy-dom
// BEACON — the basemap ladder's WIRING, which is the half `style.test.ts` cannot reach.
//
// style.test.ts proves the ladder picks the right rung. This file proves the engine does the right thing
// with that answer: it swaps the style in, it reports an exhausted ladder so the surface can be labelled,
// and — the one that actually bites in production — it does not touch a map that has already been torn
// down. MapLibre and deck.gl are mocked; no GL context, no network, no GPU.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as StyleModule from './style.js';
import type { Basemap } from './style.js';

const { map, MapLibreMap, MapboxOverlay, pickBasemapStyle, setWorkerUrl } = vi.hoisted(() => {
  const map = {
    addControl: vi.fn(),
    easeTo: vi.fn(),
    getCenter: vi.fn(() => ({ lng: -120, lat: 38 })),
    getZoom: vi.fn(() => 6),
    on: vi.fn(),
    remove: vi.fn(),
    setStyle: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
  };
  const overlay = { setProps: vi.fn() };
  return {
    map,
    MapLibreMap: vi.fn(() => map),
    MapboxOverlay: vi.fn(() => overlay),
    setWorkerUrl: vi.fn(),
    pickBasemapStyle: vi.fn<() => Promise<{ basemap: Basemap; style: unknown } | null>>(),
  };
});

vi.mock('maplibre-gl', () => ({ Map: MapLibreMap, setWorkerUrl }));
vi.mock('@deck.gl/mapbox', () => ({ MapboxOverlay }));
vi.mock('./style.js', async (importOriginal) => {
  const actual = await importOriginal<typeof StyleModule>();
  return { ...actual, basemapMode: () => 'online', pickBasemapStyle };
});

import { createMapEngine } from './map-engine.js';
import { BASEMAP_CANDIDATES, OFFLINE_STYLE, OPEN_RASTER_STYLE, rasterStyle } from './style.js';

/** The raster rung answering — the happy path, and the one the map is already showing. */
const RASTER = { basemap: BASEMAP_CANDIDATES[0] as Basemap, style: OPEN_RASTER_STYLE as unknown };
/** A vector rung answering — the fallback, which DOES need a style swap. */
const SERVING = { basemap: BASEMAP_CANDIDATES[1] as Basemap, style: { version: 8 } as unknown };

describe('the MapLibre worker', () => {
  it('is pointed at the self-hosted copy, because MapLibre cannot find its own inside a Next bundle', () => {
    // The regression that took the map off mobile on 2026-09-12. MapLibre v6 resolves its worker with
    // `new URL('./maplibre-gl-worker.mjs', import.meta.url)`; in a webpack chunk that 404s, the SPA's HTML
    // comes back, and the module worker dies with nothing in the console. Raster tiles decode on the main
    // thread and survive it — vector tiles do not, so the map renders nothing at all.
    expect(setWorkerUrl).toHaveBeenCalledWith('/maplibre/maplibre-gl-worker.mjs');
  });
});

describe('createMapEngine and the basemap ladder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates the map on the raster the operator has always had', () => {
    pickBasemapStyle.mockResolvedValueOnce(RASTER);
    createMapEngine({ container: document.createElement('div') });
    expect(MapLibreMap).toHaveBeenCalledWith(expect.objectContaining({ style: OPEN_RASTER_STYLE }));
  });

  it('touches nothing when the raster it started on is the rung that answered', async () => {
    // No swap, no flicker: the operator's working map keeps working exactly as it did.
    pickBasemapStyle.mockResolvedValueOnce(RASTER);
    const onBasemapChange = vi.fn();
    createMapEngine({ container: document.createElement('div'), onBasemapChange });
    await vi.waitFor(() => expect(onBasemapChange).toHaveBeenCalledWith('osm'));
    expect(map.setStyle).not.toHaveBeenCalled();
  });

  it('swaps in the vector fallback when the raster is refused, and names it', async () => {
    pickBasemapStyle.mockResolvedValueOnce(SERVING);
    const onBasemapChange = vi.fn();

    createMapEngine({ container: document.createElement('div'), onBasemapChange });

    await vi.waitFor(() => expect(map.setStyle).toHaveBeenCalledWith(SERVING.style));
    expect(onBasemapChange).toHaveBeenCalledWith(SERVING.basemap.id);
  });

  it('clears the refused raster and reports an exhausted ladder, rather than leaving blocked tiles up', async () => {
    // Art. XVI: the surface must say there is no basemap. The map STARTED on the raster, so when every
    // rung refuses the blocked tiles are what is on screen — they must be replaced by the labelled
    // tileless style, not left there reading "Access blocked" across the incident.
    pickBasemapStyle.mockResolvedValueOnce(null);
    const onBasemapChange = vi.fn();

    createMapEngine({ container: document.createElement('div'), onBasemapChange });

    await vi.waitFor(() => expect(onBasemapChange).toHaveBeenCalledWith(null));
    expect(map.setStyle).toHaveBeenCalledWith(OFFLINE_STYLE);
  });

  it('does not touch the map after destroy when the ladder answers late', async () => {
    // A real failure mode, not a hypothetical: three keyless hosts probed in series can easily outlive a
    // route change, and `setStyle` on a removed MapLibre map throws inside a promise nobody is awaiting.
    let answer: ((value: { basemap: Basemap; style: unknown } | null) => void) | undefined;
    pickBasemapStyle.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const onBasemapChange = vi.fn();

    const engine = createMapEngine({ container: document.createElement('div'), onBasemapChange });
    engine.destroy();
    answer?.(SERVING);
    await Promise.resolve();
    await Promise.resolve();

    expect(map.setStyle).not.toHaveBeenCalled();
    expect(onBasemapChange).not.toHaveBeenCalled();
  });

  it('asks no host at all when the caller supplied its own style', async () => {
    // An air-gapped caller, or a test harness, has already chosen. The ladder must not second-guess it.
    createMapEngine({
      container: document.createElement('div'),
      style: rasterStyle(BASEMAP_CANDIDATES.at(-1) as Basemap) as unknown as Record<
        string,
        unknown
      >,
    });
    await Promise.resolve();
    expect(pickBasemapStyle).not.toHaveBeenCalled();
  });
});
