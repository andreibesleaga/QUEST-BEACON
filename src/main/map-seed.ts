// BEACON — offline map-input seed (E-main; ADR-016, Art. XVI/XII/XIV). Assembles the RAW per-region inputs
// the GET /regions/:id/map projection reads. The exposure layer (FR-3) and the first-order prediction cone
// (FR-12) are NOT hand-seeded here — they are COMPUTED at read time by the derivation seam
// (src/application/derivation, invoked inside the memory MapReadModel) from the raw hazard geometry, candidate
// nodes, and wind/crest inputs below. A tiny air-gapped dataset (CA wildfire + RO flood) with MOCK-mode
// provenance — never presented as live. Real deployments swap the seed / adapters via config; the projection
// + route stay identical. All numbers/geometry are DOMAIN-built (Art. XII) — the client never invents them.
import { makeShelter } from '@/domain/shelter.js';
import { makePublicReport } from '@/domain/public-report.js';
import { makeEvacRoute } from '@/domain/evac-route.js';
import { asId } from '@/domain/value-objects/ids.js';
import type {
  SourceId,
  PredictionId,
  EvacRouteId,
  ShelterId,
  PublicReportId,
} from '@/domain/value-objects/ids.js';
import type { MapDerivationInput } from '@/application/derivation/derive-cop.js';
import type { MapInputsSeed } from '@/adapters/memory/memory-map.js';
import {
  SEEDED_AT,
  PURGE_AFTER,
  NOW_MS,
  HORIZON_MS,
  US_CA,
  RO,
  CA_INCIDENT,
  RO_INCIDENT,
  CA_HAZARDS,
  CA_MAP_NODES,
  CA_FIRE_ORIGIN,
  CA_WIND_DIR_DEG,
  CA_WIND_SPEED_MPS,
  CA_OUTAGES,
  CA_CELL_SITES,
  CA_WEATHER,
  CA_LAYER_SOURCES,
  CA_CAMERAS,
  RO_HAZARDS,
  RO_NODES,
  RO_GAUGE,
  RO_REACH,
  RO_NFHL,
  RO_FLOOD_ZONES,
  RO_CELL_SITES,
  RO_LAYER_SOURCES,
  RO_CAMERAS,
  ES,
  GR,
  PH,
  ES_INCIDENT,
  GR_INCIDENT,
  PH_INCIDENT,
  ES_HAZARDS,
  ES_NODES,
  ES_FIRE_ORIGIN,
  ES_WIND_DIR_DEG,
  ES_WIND_SPEED_MPS,
  ES_WEATHER,
  ES_LAYER_SOURCES,
  GR_HAZARDS,
  GR_NODES,
  GR_FIRE_ORIGIN,
  GR_WIND_DIR_DEG,
  GR_WIND_SPEED_MPS,
  GR_WEATHER,
  GR_LAYER_SOURCES,
  PH_HAZARDS,
  PH_NODES,
  PH_GAUGE,
  PH_REACH,
  PH_LAYER_SOURCES,
  DEFAULT_BUFFERS,
  point,
  line,
} from './scenario-inputs.js';

// ── California — WILDFIRE (raw map inputs; exposure + fire-cone COMPUTED downstream) ────────────────

const CA_INPUT: MapDerivationInput = {
  regionId: US_CA,
  incidentId: CA_INCIDENT,
  incidentType: 'WILDFIRE',
  hazards: CA_HAZARDS,
  gauges: [],
  infrastructure: CA_MAP_NODES,
  buffers: DEFAULT_BUFFERS,
  outages: CA_OUTAGES,
  cellSites: CA_CELL_SITES,
  weatherObservation: CA_WEATHER,
  cameras: CA_CAMERAS,
  layerSources: CA_LAYER_SOURCES,
  predictions: [
    {
      kind: 'FIRE_CONE',
      id: asId<PredictionId>('ca-cone-1'),
      incidentId: CA_INCIDENT,
      origin: CA_FIRE_ORIGIN,
      windDirDeg: CA_WIND_DIR_DEG,
      windSpeedMps: CA_WIND_SPEED_MPS,
      nowMs: NOW_MS,
      horizonMs: HORIZON_MS,
      sourceId: asId<SourceId>('firms'),
    },
  ],
  shelters: [makeShelter({ id: asId<ShelterId>('ca-shelter-1'), geom: point([-121.4, 39.75]), capacity: 200, occupancy: 20 })],
  reports: [
    makePublicReport({
      id: asId<PublicReportId>('ca-report-1'),
      source: 'WEB',
      status: 'VERIFIED',
      consent: true,
      confidence: 0.82,
      geomGeneralized: point([-121.55, 39.7]), // coarsened public location
      geomPrecise: point([-121.552, 39.703]), // responder-only precise location (Art. XIV)
      purgeAfter: PURGE_AFTER,
    }),
  ],
  route: makeEvacRoute({
    id: asId<EvacRouteId>('ca-route-1'),
    incidentId: CA_INCIDENT,
    geom: line([[-121.6, 39.7], [-121.52, 39.72], [-121.4, 39.75]]),
    avoidsHazard: true,
  }),
  provenance: [
    { sourceId: 'firms', mode: 'MOCK', fetchedAt: SEEDED_AT }, // fire HOTSPOTS
    { sourceId: 'nifc', mode: 'MOCK', fetchedAt: SEEDED_AT }, // fire PERIMETER (FIRMS ≠ perimeters)
    { sourceId: 'open-meteo', mode: 'MOCK', fetchedAt: SEEDED_AT },
    { sourceId: 'osm-overpass', mode: 'MOCK', fetchedAt: SEEDED_AT },
    { sourceId: 'eagle-i', mode: 'MOCK', fetchedAt: SEEDED_AT },
    { sourceId: 'opencellid', mode: 'MOCK', fetchedAt: SEEDED_AT },
    { sourceId: 'caltrans-cctv', mode: 'MOCK', fetchedAt: SEEDED_AT }, // E11 TRAFFIC_CCTV pins (map-only)
    { sourceId: 'alertwildfire', mode: 'MOCK', fetchedAt: SEEDED_AT }, // E11 FIRE_CAMERA pin (map-only)
  ],
  freshness: SEEDED_AT,
  computedAt: SEEDED_AT,
};

// ── Romania — FLOOD (raw map inputs; exposure + inundation COMPUTED downstream) ─────────────────────

const RO_INPUT: MapDerivationInput = {
  regionId: RO,
  incidentId: RO_INCIDENT,
  incidentType: 'FLOOD',
  hazards: RO_HAZARDS,
  gauges: [RO_GAUGE],
  infrastructure: RO_NODES,
  buffers: DEFAULT_BUFFERS,
  cellSites: RO_CELL_SITES,
  floodZones: RO_FLOOD_ZONES,
  cameras: RO_CAMERAS,
  layerSources: RO_LAYER_SOURCES,
  predictions: [
    {
      kind: 'FLOOD_INUNDATION',
      id: asId<PredictionId>('ro-inundation-1'),
      incidentId: RO_INCIDENT,
      reach: RO_REACH,
      nfhl: RO_NFHL,
      floods: true,
      crestForecast: 4.2,
      crestTime: SEEDED_AT,
      sourceId: asId<SourceId>('glofas'),
    },
  ],
  shelters: [makeShelter({ id: asId<ShelterId>('ro-shelter-1'), geom: point([28.2, 45.5]), capacity: 120, occupancy: 0 })],
  reports: [
    makePublicReport({
      id: asId<PublicReportId>('ro-report-1'),
      source: 'SMS',
      status: 'VERIFIED',
      consent: true,
      confidence: 0.74,
      geomGeneralized: point([28.05, 45.45]),
      geomPrecise: point([28.051, 45.452]),
      purgeAfter: PURGE_AFTER,
    }),
  ],
  route: makeEvacRoute({
    id: asId<EvacRouteId>('ro-route-1'),
    incidentId: RO_INCIDENT,
    geom: line([[28.0, 45.45], [28.1, 45.48], [28.2, 45.5]]),
    avoidsHazard: true,
  }),
  provenance: [
    { sourceId: 'glofas', mode: 'MOCK', fetchedAt: SEEDED_AT },
    { sourceId: 'nfhl', mode: 'MOCK', fetchedAt: SEEDED_AT },
    { sourceId: 'osm-overpass', mode: 'MOCK', fetchedAt: SEEDED_AT },
    { sourceId: 'cnadnr-ro', mode: 'MOCK', fetchedAt: SEEDED_AT }, // E11 TRAFFIC_CCTV pins (map-only)
  ],
  freshness: SEEDED_AT,
  computedAt: SEEDED_AT,
};

// ── B3.5 — the three DEMO-GRADE zones' map inputs (es · gr · ph) ────────────────────────────────────
// Deliberately THINNER than CA/RO and honest about it: no `outages` (EAGLE-I is US-only and no global
// outage source is wired), no `cellSites` (OpenCelliD is enabled but ships no recorded ES/GR/PH extract),
// no `cameras` (no national camera directory covers them and windy-webcams ships no recorded pin for them —
// seeding one would mean inventing a live-view URL), and no `floodZones` (FEMA NFHL is US-only). Those
// slices are ABSENT rather than empty: a rendered-but-empty layer is a claim, a missing one is a gap the UI
// can state. `shelters`/`reports` are likewise empty — no consented report or agency shelter roster exists
// for these zones, and fabricating either would be a Responsible-Data violation, not a nicer demo.

const ES_INPUT: MapDerivationInput = {
  regionId: ES,
  incidentId: ES_INCIDENT,
  incidentType: 'WILDFIRE',
  hazards: ES_HAZARDS,
  gauges: [],
  infrastructure: ES_NODES,
  buffers: DEFAULT_BUFFERS,
  weatherObservation: ES_WEATHER,
  layerSources: ES_LAYER_SOURCES,
  predictions: [
    {
      kind: 'FIRE_CONE',
      id: asId<PredictionId>('es-cone-1'),
      incidentId: ES_INCIDENT,
      origin: ES_FIRE_ORIGIN,
      windDirDeg: ES_WIND_DIR_DEG,
      windSpeedMps: ES_WIND_SPEED_MPS,
      nowMs: NOW_MS,
      horizonMs: HORIZON_MS,
      sourceId: asId<SourceId>('firms'),
    },
  ],
  shelters: [],
  reports: [],
  provenance: [
    { sourceId: 'firms', mode: 'MOCK', fetchedAt: SEEDED_AT }, // fire HOTSPOTS
    { sourceId: 'effis', mode: 'MOCK', fetchedAt: SEEDED_AT }, // fire PERIMETER
    { sourceId: 'open-meteo', mode: 'MOCK', fetchedAt: SEEDED_AT },
    { sourceId: 'osm-overpass', mode: 'MOCK', fetchedAt: SEEDED_AT },
  ],
  freshness: SEEDED_AT,
  computedAt: SEEDED_AT,
};

const GR_INPUT: MapDerivationInput = {
  regionId: GR,
  incidentId: GR_INCIDENT,
  incidentType: 'WILDFIRE',
  hazards: GR_HAZARDS,
  gauges: [],
  infrastructure: GR_NODES,
  buffers: DEFAULT_BUFFERS,
  weatherObservation: GR_WEATHER,
  layerSources: GR_LAYER_SOURCES,
  predictions: [
    {
      kind: 'FIRE_CONE',
      id: asId<PredictionId>('gr-cone-1'),
      incidentId: GR_INCIDENT,
      origin: GR_FIRE_ORIGIN,
      windDirDeg: GR_WIND_DIR_DEG,
      windSpeedMps: GR_WIND_SPEED_MPS,
      nowMs: NOW_MS,
      horizonMs: HORIZON_MS,
      sourceId: asId<SourceId>('firms'),
    },
  ],
  shelters: [],
  reports: [],
  provenance: [
    { sourceId: 'firms', mode: 'MOCK', fetchedAt: SEEDED_AT },
    { sourceId: 'effis', mode: 'MOCK', fetchedAt: SEEDED_AT },
    { sourceId: 'open-meteo', mode: 'MOCK', fetchedAt: SEEDED_AT },
    { sourceId: 'osm-overpass', mode: 'MOCK', fetchedAt: SEEDED_AT },
  ],
  freshness: SEEDED_AT,
  computedAt: SEEDED_AT,
};

// PHILIPPINES — the ONE place this zone's thinness is structural rather than cosmetic, so it is spelled out:
// `FloodInundationInput` REQUIRES an `nfhl` geometry, a field named after the FEMA National Flood Hazard
// Layer, which is a US-only regulatory dataset. The Philippines has NO equivalent layer in this build, so
// there is no defensible first-order inundation projection to make — and inventing one (or passing some
// other polygon off as a regulatory floodplain) would be exactly the wrong-but-plausible failure F-06 and
// F-48 are about. The deterministic `floods` gate is therefore FALSE: `projectFloodInundation` short-circuits
// to `null` BEFORE the `nfhl` geometry is ever read, so the COP shows the observed GloFAS flood reach and
// the gauge, and NO projected inundation. `nfhl` is set to the reach purely to satisfy the required field;
// it is provably unreachable. (Recorded as a finding: the port type cannot currently express "this region
// has no regulatory flood-hazard layer" other than by closing the gate.)
const PH_INPUT: MapDerivationInput = {
  regionId: PH,
  incidentId: PH_INCIDENT,
  incidentType: 'FLOOD',
  hazards: PH_HAZARDS,
  gauges: [PH_GAUGE],
  infrastructure: PH_NODES,
  buffers: DEFAULT_BUFFERS,
  layerSources: PH_LAYER_SOURCES,
  predictions: [
    {
      kind: 'FLOOD_INUNDATION',
      id: asId<PredictionId>('ph-inundation-1'),
      incidentId: PH_INCIDENT,
      reach: PH_REACH,
      nfhl: PH_REACH, // unreachable — see the note above; `floods: false` returns null first
      floods: false,
      sourceId: asId<SourceId>('glofas'),
    },
  ],
  shelters: [],
  reports: [],
  provenance: [
    { sourceId: 'glofas', mode: 'MOCK', fetchedAt: SEEDED_AT },
    { sourceId: 'osm-overpass', mode: 'MOCK', fetchedAt: SEEDED_AT },
  ],
  freshness: SEEDED_AT,
  computedAt: SEEDED_AT,
};

/**
 * The built-in offline map-INPUT dataset: the CA wildfire + RO flood flagships plus the three DEMO-GRADE
 * B3.3 zones (es/gr wildfire, ph flood). MOCK-mode throughout; honest labelling (Art. XVI). Keyed by the
 * SAME ids as config/regions.json — no code reads these keys as literals, the composition iterates them.
 */
export const DEFAULT_MAP_SEED: MapInputsSeed = {
  'us-ca': CA_INPUT,
  ro: RO_INPUT,
  es: ES_INPUT,
  gr: GR_INPUT,
  ph: PH_INPUT,
};
