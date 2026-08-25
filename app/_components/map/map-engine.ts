'use client';
// BEACON — Real MapEngine (E8·T-358/T-359). The ONE place WebGL lives: MapLibre GL + a deck.gl
// MapboxOverlay, behind the thin `MapEngine` seam so every other map module stays unit-testable without a
// GPU. NEVER imported by a unit test (MapView loads it lazily / tests inject a fake) — Playwright covers it.
import maplibregl from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Layer, PickingInfo } from '@deck.gl/core';
import type { Position } from '@/domain/value-objects/geo.js';
import { COLOR_BY_GROUP, LABEL_COLOR, type RGBA } from './palette.js';
import { OPEN_RASTER_STYLE } from './style.js';
import type { LayerDatum, LayerDescriptor, MapEngine, MapEngineFactory } from './types.js';

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

/** Create the real MapLibre + deck.gl engine. Tokenless: defaults to the open raster style, no vendor key. */
export const createMapEngine: MapEngineFactory = (opts) => {
  const map = new maplibregl.Map({
    container: opts.container,
    style: (opts.style as StyleSpecification | undefined) ?? OPEN_RASTER_STYLE,
    center: opts.center ? xy(opts.center) : DEFAULT_CENTER,
    zoom: opts.zoom ?? DEFAULT_ZOOM,
  });
  const overlay = new MapboxOverlay({ interleaved: false, layers: [] });
  map.addControl(overlay);

  // Basemap click → ground coordinate. MapLibre reports lngLat, which is already the [lon, lat] order the
  // domain uses, so it is passed straight through with no axis flip to get wrong. deck.gl's own feature
  // picking runs on the overlay above and is unaffected: a click that hits a feature fires BOTH, which is
  // what we want (select the feature AND remember where the operator pointed).
  if (opts.onMapClick !== undefined) {
    const handler = opts.onMapClick;
    map.on('click', (e) => handler([e.lngLat.lng, e.lngLat.lat]));
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
      try {
        map.remove();
      } catch {
        /* map already torn down — nothing to do */
      }
    },
  } satisfies MapEngine;
};
