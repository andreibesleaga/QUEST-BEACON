// BEACON — Map module barrel (E8·T-358…T-391). The single import surface for the COP orchestrator (page.tsx)
// to compose the MapLibre + deck.gl common operating picture. GL lives behind MapEngine; everything exported
// here is unit-tested against a fake engine (the real one is Playwright-covered).

// Components
export { MapView } from './MapView.js';
export type { MapViewProps } from './MapView.js';
export { LayerManager } from './LayerManager.js';
export type { LayerManagerProps } from './LayerManager.js';
export { LayerTogglePanel } from './LayerTogglePanel.js';
export type { LayerTogglePanelProps } from './LayerTogglePanel.js';
export { RegionSelector, GIBS_OVERLAYS, GIBS_ATTRIBUTION } from './RegionSelector.js';
export type { RegionSelectorProps, RegionOption, GibsOverlayId } from './RegionSelector.js';
export { MapFeatureList, toFeatureRows } from './MapFeatureList.js';
export type { MapFeatureListProps, FeatureRow } from './MapFeatureList.js';
export { MapTooltip } from './MapTooltip.js';
export type { MapTooltipProps } from './MapTooltip.js';

// Pure logic (data → deck descriptors, RBAC, metadata)
export {
  buildLayers,
  LAYER_META,
  predictionCaveat,
  stormConeCaveat,
  shelterCapacityLabel,
  OUTAGE_CAVEAT,
  CELL_CAVEAT,
  FIRE_CAVEAT,
  STORM_CAVEAT,
} from './build-layers.js';
export type { LayerMeta } from './build-layers.js';
export { visibleGeometry, isPreciseVisible } from './geometry.js';
export { createMapEngine } from './map-engine.js';

// Types
export type {
  MapData,
  MapEngine,
  MapEngineFactory,
  MapEngineOptions,
  MapLayerState,
  LayerDescriptor,
  LayerDatum,
  LayerKind,
  LayerFreshness,
  GeoFeature,
  FireData,
  FirePoint,
  FloodData,
  StormData,
  GaugeFeature,
  InfraNode,
  InfraStatus,
  OutageArea,
  CellCoverage,
  ExposureNode,
  ReportFeature,
  PredictionCone,
  RouteFeature,
  ShelterFeature,
  PolygonRings,
} from './types.js';
