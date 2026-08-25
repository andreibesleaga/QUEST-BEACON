// BEACON — map projection → MapData mapper (E8·map; Art. XII/XVI). PURE + framework-free: translates the
// DOMAIN-shaped GET /regions/:id/map envelope into the frontend MapData the deck.gl layer builders consume.
// The client only RENDERS these numbers/geometry — it never scores or invents them (Art. XII). Precise report
// geometry is already server-gated (present only for RESPONDER+, Art. XIV); this mapper just passes it through.
import type { Position, Geometry } from '@/domain/value-objects/geo.js';
import type { SourceRef } from '@/ports/interaction.js';
import { LAYER_IDS, type LayerId } from './types.js';
import type { MapProjectionData, ProjectedFeatureData } from './types.js';
import type {
  MapData,
  FireData,
  FirePoint,
  FloodData,
  GaugeFeature,
  InfraNode,
  InfraStatus,
  ExposureNode,
  ReportFeature,
  ShelterFeature,
  PredictionCone,
  RouteFeature,
  PolygonRings,
  StormData,
  LayerFreshness,
} from '../_components/map/types.js';

// MapData (app/_components/map/types.ts) declares the Phase-D fields `weather?`/`floodZones?` — the wire
// types here are structurally identical to the component vocabulary (pure Art. XII passthrough; the client
// never re-scores them), so the mapped slices assign directly.

/** Polygon rings from a Polygon (or the first polygon of a MultiPolygon), else undefined (skip). */
function ringsOf(geom: Geometry): PolygonRings | undefined {
  if (geom.type === 'Polygon') return geom.coordinates;
  if (geom.type === 'MultiPolygon') return geom.coordinates[0];
  return undefined;
}

/** A [lon,lat] position from a Point geometry, else undefined (non-plottable → skip). */
function pointOf(geom: Geometry): Position | undefined {
  return geom.type === 'Point' ? geom.coordinates : undefined;
}

/** Copy the RBAC-gated position pair (precisePosition present only for RESPONDER+ responses). */
function geoBase(f: ProjectedFeatureData): { readonly position: Position; readonly precisePosition?: Position } {
  return { position: f.position, ...(f.precisePosition !== undefined ? { precisePosition: f.precisePosition } : {}) };
}

/** Fire layer: HOTSPOT hazards → point hotspots, the first PERIMETER hazard → the perimeter polygon. */
function fireData(p: MapProjectionData): FireData | undefined {
  const hotspots: FirePoint[] = [];
  let perimeter: PolygonRings | undefined;
  for (const h of p.hazards) {
    if (h.kind === 'HOTSPOT') {
      const pos = pointOf(h.geometry);
      if (pos !== undefined) hotspots.push({ id: h.id, position: pos });
    } else if (h.kind === 'PERIMETER' && perimeter === undefined) {
      perimeter = ringsOf(h.geometry);
    }
  }
  if (hotspots.length === 0 && perimeter === undefined) return undefined;
  return { hotspots, ...(perimeter !== undefined ? { perimeter } : {}) };
}

/** Flood layer: FLOOD_REACH hazard → extent polygon, gauges → gauge points. */
function floodData(p: MapProjectionData): FloodData | undefined {
  const reach = p.hazards.find((h) => h.kind === 'FLOOD_REACH');
  const extent = reach !== undefined ? ringsOf(reach.geometry) : undefined;
  const gauges: GaugeFeature[] = p.gauges.map((g) => ({
    id: g.id,
    position: g.position,
    status: g.floodCategory,
    ...(g.stage !== undefined ? { stage: g.stage } : {}),
  }));
  if (gauges.length === 0 && extent === undefined) return undefined;
  return { gauges, ...(extent !== undefined ? { extent } : {}) };
}

/**
 * Storm layer (ADR-032): the wire slice is structurally identical to the component `StormData`, so this is a
 * pure Art. XII passthrough — the client never re-derives a track, a cone or a surge extent. An absent slice,
 * or one carrying no geometry at all, contributes nothing (the layer is absent, not empty — Art. XVI).
 */
function stormData(p: MapProjectionData): StormData | undefined {
  const s = p.storm;
  if (s === undefined) return undefined;
  if (s.track === undefined && s.cone === undefined && s.surge === undefined) return undefined;
  return s;
}

function infrastructure(p: MapProjectionData): readonly InfraNode[] {
  return p.infrastructure.map((n) => ({ id: n.id, ...geoBase(n), kind: n.kind, status: n.status as InfraStatus }));
}

function exposure(p: MapProjectionData): readonly ExposureNode[] {
  return p.exposure.map((e) => ({ id: e.id, ...geoBase(e), hazard: e.reason }));
}

function reports(p: MapProjectionData): readonly ReportFeature[] {
  return p.reports.map((r) => ({
    id: r.id,
    ...geoBase(r),
    status: r.status,
    ...(r.confidence !== undefined ? { confidence: r.confidence } : {}),
  }));
}

function shelters(p: MapProjectionData): readonly ShelterFeature[] {
  return p.shelters.map((s) => ({ id: s.id, ...geoBase(s), capacity: s.capacity, demand: s.demand }));
}

/**
 * Every plottable prediction cone, in wire order (ADR-033 §3.1). Each cone keeps its OWN method/inputs/
 * uncertainty — N predictions become N separately-labeled cones, never one merged polygon. A prediction whose
 * geometry is not a polygon contributes nothing (skip, never coerce), exactly as the singular mapper did.
 * Reads the plural field only: the deprecated singular `prediction` mirror exists for v1 API clients, and
 * consuming both would double-render the first cone.
 */
function predictions(p: MapProjectionData): readonly PredictionCone[] {
  const cones: PredictionCone[] = [];
  for (const pr of p.predictions) {
    const polygon = ringsOf(pr.geometry);
    if (polygon === undefined) continue;
    cones.push({ id: pr.id, polygon, method: pr.method, inputs: pr.inputs, uncertainty: pr.uncertainty });
  }
  return cones;
}

function route(p: MapProjectionData): RouteFeature | undefined {
  if (p.route === undefined) return undefined;
  return { id: p.route.id, path: p.route.path, hazardAvoided: p.route.avoidsHazard };
}

/**
 * Resolve each populated layer's freshness PER LAYER (Art. XVI honest labelling). For a layer whose id maps
 * (via the envelope `layerSources`: layerId → provenance sourceId) to a `SourceRef` in `provenance[]`, the
 * stamp is THAT source's own `fetchedAt` + `mode`. When `layerSources` has no entry for the layer, or the
 * referenced sourceId is not in `provenance[]` (older/degraded envelope), the layer falls back to the shared
 * envelope stamp (`mode`/`fetchedAt`) — the previous single-stamp behaviour, never a break (degraded rung).
 */
function freshnessFor(
  present: readonly LayerId[],
  mode: SourceRef['mode'],
  fetchedAt: string | null,
  layerSources: MapProjectionData['layerSources'],
  provenance: readonly SourceRef[],
): Partial<Record<LayerId, LayerFreshness>> {
  const out: Partial<Record<LayerId, LayerFreshness>> = {};
  for (const id of present) {
    const sourceId = layerSources?.[id];
    const ref = sourceId !== undefined ? provenance.find((r) => r.sourceId === sourceId) : undefined;
    out[id] = ref !== undefined ? { fetchedAt: ref.fetchedAt, mode: ref.mode } : { fetchedAt, mode };
  }
  return out;
}

/** The toggleable layers actually populated in this MapData (drives which FreshnessBadges show). */
function presentLayers(md: MapData): LayerId[] {
  const populated: Record<LayerId, boolean> = {
    fire: md.fire !== undefined,
    flood: md.flood !== undefined,
    storm: md.storm !== undefined,
    floodzone: md.floodZones !== undefined,
    infra: md.infrastructure !== undefined,
    outage: md.outage !== undefined,
    cell: md.cell !== undefined,
    weather: md.weather !== undefined,
    cameras: md.cameras !== undefined,
    exposure: md.exposure !== undefined,
    reports: md.reports !== undefined,
    prediction: md.predictions !== undefined,
    route: md.route !== undefined,
    shelters: md.shelters !== undefined,
  };
  return LAYER_IDS.filter((id) => populated[id]);
}

/**
 * The Phase-D layer slices (outage/cell/weather/floodzone) as a MapData partial. Their wire shapes pass
 * straight through — the client only RENDERS them (Art. XII), and the outage/cell wire fields
 * (customersOut/online) ride along structurally so W3b loses nothing. An empty/absent slice is omitted.
 */
function phaseDLayers(p: MapProjectionData): Partial<MapData> {
  return {
    ...(p.outage !== undefined && p.outage.length > 0 ? { outage: p.outage } : {}),
    ...(p.cell !== undefined && p.cell.length > 0 ? { cell: p.cell } : {}),
    ...(p.weather !== undefined ? { weather: p.weather } : {}),
    ...(p.floodZones !== undefined && p.floodZones.length > 0 ? { floodZones: p.floodZones } : {}),
    // Live cameras pass straight through — the wire shape (ProjectedCameraData) is structurally identical to
    // the component CameraPin, and the client only RENDERS them as link-out pins (Art. XII).
    ...(p.cameras !== undefined && p.cameras.length > 0 ? { cameras: p.cameras } : {}),
  };
}

/** Assemble the populated MapData slices (an absent/empty layer is simply omitted — never a dead-end, Art. XVI). */
function assembleLayers(p: MapProjectionData): MapData {
  const fire = fireData(p);
  const flood = floodData(p);
  const infra = infrastructure(p);
  const exp = exposure(p);
  const reps = reports(p);
  const shel = shelters(p);
  const preds = predictions(p);
  const rt = route(p);
  const storm = stormData(p);
  return {
    ...(fire !== undefined ? { fire } : {}),
    ...(flood !== undefined ? { flood } : {}),
    ...(storm !== undefined ? { storm } : {}),
    ...(infra.length > 0 ? { infrastructure: infra } : {}),
    ...(exp.length > 0 ? { exposure: exp } : {}),
    ...(reps.length > 0 ? { reports: reps } : {}),
    ...(shel.length > 0 ? { shelters: shel } : {}),
    ...(preds.length > 0 ? { predictions: preds } : {}),
    ...(rt !== undefined ? { route: rt } : {}),
    ...phaseDLayers(p),
  };
}

/**
 * Translate the map-projection envelope into the frontend MapData. Per-layer freshness is resolved from the
 * envelope `layerSources` (layerId → sourceId) against `provenance[]` (each ref's own `fetchedAt`/`mode`),
 * falling back to the shared `mode`/`fetchedAt` when a layer has no mapped/known source (degraded rung).
 * An absent layer contributes nothing — the COP never dead-ends (Art. XVI). `provenance` defaults to empty so
 * pre-Phase-D callers keep the original single-stamp behaviour.
 */
export function projectionToMapData(
  p: MapProjectionData,
  mode: SourceRef['mode'],
  fetchedAt: string | null,
  provenance: readonly SourceRef[] = [],
): MapData {
  const layers = assembleLayers(p);
  return { ...layers, freshness: freshnessFor(presentLayers(layers), mode, fetchedAt, p.layerSources, provenance) };
}
