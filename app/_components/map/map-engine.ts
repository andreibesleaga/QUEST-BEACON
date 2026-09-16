'use client';
// BEACON — Real MapEngine (E8·T-358/T-359). The ONE place WebGL lives: MapLibre GL + a deck.gl
// MapboxOverlay, behind the thin `MapEngine` seam so every other map module stays unit-testable without a
// GPU. MapView loads it lazily and unit tests inject a fake, so it stays out of their module graph;
// `map-engine.test.ts` is the one exception and mocks MapLibre + deck outright to pin the basemap
// ladder's wiring. Everything GL-real is Playwright's.
// maplibre-gl v6 removed the default export (bumped from v5 on 2026-09-11 to clear the CRITICAL XSS
// advisory GHSA-jrc7-96c5-q579 in `DOM.sanitize()`, which was failing the project's own Gate 5).
// `Map` is a named export now; nothing else in this file used the namespace.
import { Map as MapLibreMap, setWorkerUrl } from 'maplibre-gl';
import type { MapMouseEvent, StyleSpecification } from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Layer, PickingInfo } from '@deck.gl/core';
import type { Position } from '@/domain/value-objects/geo.js';
import { COLOR_BY_GROUP, LABEL_COLOR, type RGBA } from './palette.js';
import {
  OFFLINE_STYLE,
  basemapChain,
  basemapMode,
  pickBasemapStyle,
  resolveBasemapStyle,
} from './style.js';
import type { LayerDatum, LayerDescriptor, MapEngine, MapEngineFactory } from './types.js';

/**
 * Tell MapLibre where its worker actually lives, because it cannot work that out inside a Next bundle.
 *
 * v6 resolves the worker at runtime with `new URL('./maplibre-gl-worker.mjs', import.meta.url)`. In a
 * webpack chunk that resolves to `/_next/static/chunks/maplibre-gl-worker.mjs`, which webpack never
 * emits — `next.config.mjs` disables the `new URL(…, import.meta.url)` asset parser on purpose (the live
 * source adapters resolve a fixtures DIRECTORY that way and the parser chokes on it). The request 404s,
 * the SPA's HTML comes back, and the module worker dies silently.
 *
 * A RASTER basemap survives that, because raster tiles decode on the main thread. A VECTOR one does not:
 * every vector tile is parsed in the worker, so the map renders NOTHING, with an empty console. That is
 * exactly what happened when the basemap ladder became vector-first on 2026-09-12 — the map disappeared on
 * mobile and nothing in the build or the test suite said a word.
 *
 * `scripts/copy-maplibre-worker.mjs` puts the worker and the shared chunk it imports into
 * `public/maplibre/` at prebuild, and this points MapLibre at them. Self-hosted, same-origin, no CDN —
 * the same posture as every other asset here.
 */
setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');

const DEFAULT_CENTER: [number, number] = [-120, 38];
const DEFAULT_ZOOM = 6;

const xy = (p: Position): [number, number] => [p[0], p[1]];
const rgba = (c: RGBA): [number, number, number, number] => [c[0], c[1], c[2], c[3]];
const emptyPos: [number, number] = [0, 0];

function ringsToArray(rings: LayerDatum['polygon']): [number, number][][] {
  if (rings === undefined) return [];
  return rings.map((ring) => ring.map((p): [number, number] => [p[0], p[1]]));
}

function pathToArray(path: LayerDatum['path']): [number, number][] {
  if (path === undefined) return [];
  return path.map((p): [number, number] => [p[0], p[1]]);
}

function scatterLayer(d: LayerDescriptor): Layer {
  const onClick = d.onClick;
  return new ScatterplotLayer<LayerDatum>({
    id: d.id,
    data: d.data as LayerDatum[],
    pickable: d.pickable ?? false,
    getPosition: (o: LayerDatum) => (o.position ? xy(o.position) : emptyPos),
    getFillColor: rgba(COLOR_BY_GROUP[d.group]),
    getRadius: 80,
    radiusMinPixels: 5,
    radiusMaxPixels: 18,
    // E11 cameras: forward a deck.gl pick to the descriptor's click seam (link-out). Additive — layers
    // without an onClick descriptor field register no handler, so every other layer is untouched.
    ...(onClick !== undefined
      ? {
          onClick: (info: PickingInfo<LayerDatum>): void => {
            if (info.object) onClick(info.object);
          },
        }
      : {}),
  });
}

function polygonLayer(d: LayerDescriptor): Layer {
  const c = COLOR_BY_GROUP[d.group];
  return new PolygonLayer<LayerDatum>({
    id: d.id,
    data: d.data as LayerDatum[],
    pickable: d.pickable ?? false,
    stroked: true,
    filled: true,
    getPolygon: (o: LayerDatum) => ringsToArray(o.polygon),
    getFillColor: [c[0], c[1], c[2], 90],
    getLineColor: rgba(c),
    getLineWidth: 2,
    lineWidthMinPixels: 1,
  });
}

function pathLayer(d: LayerDescriptor): Layer {
  return new PathLayer<LayerDatum>({
    id: d.id,
    data: d.data as LayerDatum[],
    pickable: d.pickable ?? false,
    widthMinPixels: 4,
    getPath: (o: LayerDatum) => pathToArray(o.path),
    getColor: rgba(COLOR_BY_GROUP[d.group]),
  });
}

function textLayer(d: LayerDescriptor): Layer {
  return new TextLayer<LayerDatum>({
    id: d.id,
    data: d.data as LayerDatum[],
    getPosition: (o: LayerDatum) => (o.position ? xy(o.position) : emptyPos),
    getText: (o: LayerDatum) => o.label ?? '',
    getColor: rgba(LABEL_COLOR),
    getSize: 14,
    getPixelOffset: [0, 16],
  });
}

const KIND_BUILDERS: Record<LayerDescriptor['kind'], (d: LayerDescriptor) => Layer> = {
  scatterplot: scatterLayer,
  polygon: polygonLayer,
  path: pathLayer,
  text: textLayer,
};

function toDeckLayer(d: LayerDescriptor): Layer {
  return KIND_BUILDERS[d.kind](d);
}

/** The operator's language, as the document declares it — Next stamps the active locale onto <html lang>.
 *  Read here rather than threaded through MapEngineOptions: the basemap is the only consumer, and a map
 *  created before hydration still gets the server-rendered value. */
function documentLocale(): string {
  if (typeof document === 'undefined') return 'en';
  const lang = document.documentElement.lang;
  return lang === '' ? 'en' : lang;
}

/** Create the real MapLibre + deck.gl engine. Tokenless on every rung of the basemap ladder — no key. */
export const createMapEngine: MapEngineFactory = (opts) => {
  const map = new MapLibreMap({
    container: opts.container,
    style: (opts.style as StyleSpecification | undefined) ?? resolveBasemapStyle(),
    center: opts.center ? xy(opts.center) : DEFAULT_CENTER,
    zoom: opts.zoom ?? DEFAULT_ZOOM,
  });
  // The map is created ON the raster the operator has always had, and the ladder runs beside it. The
  // raster host can refuse without saying so — 200 OK carrying an "Access blocked" image (see style.ts) —
  // so it is probed, and only a browser that IS refused is moved down to the vector hosts. Left alone:
  // `offline` mode (which must make no request at all) and a caller that passed its own `style` — each
  // of those already chose its basemap.
  let destroyed = false;
  if (opts.style === undefined && basemapMode() === 'online') {
    const onBasemap = opts.onBasemapChange;
    const startedOn = basemapChain()[0];
    void pickBasemapStyle(documentLocale())
      .then((picked) => {
        if (destroyed) return;
        if (picked === null) {
          map.setStyle(OFFLINE_STYLE); // every rung refused — no basemap, and the surface says so (Art. XVI)
          onBasemap?.(null);
          return;
        }
        // The map was created ON the first rung. If that is the rung that answered, there is nothing to
        // swap and no flicker to cause — the operator's map simply keeps working as it did.
        if (startedOn !== undefined && picked.basemap.id === startedOn.id) {
          onBasemap?.(picked.basemap.id);
          return;
        }
        map.setStyle(picked.style);
        onBasemap?.(picked.basemap.id);
      })
      .catch(() => {
        /* A basemap ladder must never be able to take the map down. */
        if (!destroyed) onBasemap?.(null);
      });
  }

  const overlay = new MapboxOverlay({ interleaved: false, layers: [] });
  map.addControl(overlay);

  // Basemap click → ground coordinate. MapLibre reports lngLat, which is already the [lon, lat] order the
  // domain uses, so it is passed straight through with no axis flip to get wrong. deck.gl's own feature
  // picking runs on the overlay above and is unaffected: a click that hits a feature fires BOTH, which is
  // what we want (select the feature AND remember where the operator pointed).
  if (opts.onMapClick !== undefined) {
    const handler = opts.onMapClick;
    map.on('click', (e: MapMouseEvent) => handler([e.lngLat.lng, e.lngLat.lat]));
  }

  // Camera → the outside world. `moveend` fires once a pan/zoom/easeTo SETTLES (MapLibre coalesces the
  // intermediate frames), so this is one update per gesture, not one per frame. `getCenter()` returns a
  // LngLat, which is already the [lon, lat] order the domain uses — passed straight through, no flip.
  if (opts.onViewChange !== undefined) {
    const onView = opts.onViewChange;
    const publish = (): void => {
      const c = map.getCenter();
      onView({ center: [c.lng, c.lat], zoom: map.getZoom() });
    };
    map.on('moveend', publish);
    // And once the style is up, so the FIRST view is published without waiting for the operator to move.
    // A responder who never touches the camera is exactly the case that was broken before.
    map.on('load', publish);
  }

  // The creation-time framing is the "home" view recenter() restores — the region's own center/zoom,
  // not a hardcoded constant, so the control is correct for every zone.
  const homeCenter: [number, number] = opts.center ? xy(opts.center) : DEFAULT_CENTER;
  const homeZoom: number = opts.zoom ?? DEFAULT_ZOOM;

  return {
    setLayers(descriptors: readonly LayerDescriptor[]): void {
      overlay.setProps({ layers: descriptors.map(toDeckLayer) });
    },
    zoomIn(): void {
      map.zoomIn();
    },
    zoomOut(): void {
      map.zoomOut();
    },
    recenter(): void {
      map.easeTo({ center: homeCenter, zoom: homeZoom });
    },
    destroy(): void {
      destroyed = true;
      try {
        map.remove();
      } catch {
        /* map already torn down — nothing to do */
      }
    },
  } satisfies MapEngine;
};
