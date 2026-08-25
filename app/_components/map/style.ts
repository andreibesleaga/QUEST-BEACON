// BEACON — Tokenless MapLibre base style (E8·T-358). An open raster style object — NO vendor token, NO
// API key. OpenStreetMap raster tiles with the required attribution. Offline/air-gapped deployments swap
// this for cached/GIBS tiles via the `style` engine option; the demo default is fully keyless.
import type { StyleSpecification } from 'maplibre-gl';

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

export const OPEN_RASTER_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: OSM_ATTRIBUTION,
    },
  },
  layers: [{ id: 'osm-tiles', type: 'raster', source: 'osm' }],
};
