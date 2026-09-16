// BEACON — RAW scenario inputs (E-main; ADR-016, Art. XVI/XII). The ONE source of truth for the offline
// demo's raw INPUTS — hazard footprints, candidate lifeline nodes, gauges, wind/weather, and escalation
// readings for the CA-wildfire + RO-flood scenarios. These are the ENGINE INPUTS; the exposure rows,
// prediction cones, priority ranking, and trend are all COMPUTED downstream by the derivation seam
// (src/application/derivation) — never hand-seeded here. Both the core seed (seed.ts → SitRep facts) and the
// map seed (map-seed.ts → map projection) build on these primitives, so "where the substation is" is defined
// once. A tiny air-gapped dataset with MOCK-mode provenance — never presented as live.
import { makeHazardGeometry } from '@/domain/hazard-geometry.js';
import { makeGauge } from '@/domain/gauge.js';
import { makeInfrastructureNode } from '@/domain/infrastructure-node.js';
import { makeCameraFeed } from '@/domain/camera-feed.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { CameraFeed } from '@/domain/camera-feed.js';
import type {
  RegionId,
  IncidentId,
  SourceId,
  HazardGeometryId,
  GaugeId,
  InfrastructureNodeId,
  CameraFeedId,
} from '@/domain/value-objects/ids.js';
import type { InfraNodeType } from '@/domain/infrastructure-node.js';
import type { HazardGeometry } from '@/domain/hazard-geometry.js';
import type { InfrastructureNode } from '@/domain/infrastructure-node.js';
import type { Gauge } from '@/domain/gauge.js';
import { makeFloodZone } from '@/domain/flood-zone.js';
import type { FloodZone } from '@/domain/flood-zone.js';
import type {
  PointGeometry,
  PolygonGeometry,
  LineStringGeometry,
  Position,
  BBox,
} from '@/domain/value-objects/geo.js';
import type { TrendSample } from '@/application/escalation-trend/escalation-trend.js';
import type { WeatherObservation } from '@/ports/data-sources.js';
import type { OutageRecord, TelecomCoverage } from '@/ports/infrastructure-sources.js';

// Fixed, safely-past timestamps for seeded geometry/provenance (validators reject future instants).
export const SEEDED_AT = '2026-07-05T22:00:00Z';
export const PURGE_AFTER = '2026-08-05T22:00:00Z';
export const NOW_MS = Date.parse(SEEDED_AT);
export const HORIZON_MS = 6 * 3_600_000; // 6-hour projection window
const HOUR_S = 3600;
const SEEDED_S = NOW_MS / 1000;

export const US_CA = asId<RegionId>('us-ca');
export const RO = asId<RegionId>('ro');
export const ES = asId<RegionId>('es');
export const GR = asId<RegionId>('gr');
export const PH = asId<RegionId>('ph');
export const CA_INCIDENT = asId<IncidentId>('us-ca-wildfire-demo');
export const RO_INCIDENT = asId<IncidentId>('ro-flood-demo');
export const ES_INCIDENT = asId<IncidentId>('es-wildfire-demo');
export const GR_INCIDENT = asId<IncidentId>('gr-wildfire-demo');
export const PH_INCIDENT = asId<IncidentId>('ph-flood-demo');

export const CA_CENTER: readonly [number, number] = [-121.6, 39.7]; // Butte County, CA
export const RO_CENTER: readonly [number, number] = [28.0, 45.45]; // Galați County, RO
export const ES_CENTER: readonly [number, number] = [-6.3, 41.9]; // Sierra de la Culebra, Zamora, ES
export const GR_CENTER: readonly [number, number] = [23.6, 38.85]; // northern Evia (Euboea), GR
export const PH_CENTER: readonly [number, number] = [124.42, 6.95]; // Maguindanao, BARMM, Mindanao, PH

export const point = (coordinates: PointGeometry['coordinates']): PointGeometry => ({
  type: 'Point',
  coordinates,
});
export const line = (coordinates: LineStringGeometry['coordinates']): LineStringGeometry => ({
  type: 'LineString',
  coordinates,
});

/** A square footprint (±d°) around a centroid — a labelled first-order buffer (honest, MOCK). */
export function box(center: readonly [number, number], d: number): PolygonGeometry {
  const [x, y] = center;
  return {
    type: 'Polygon',
    coordinates: [
      [
        [x - d, y - d],
        [x + d, y - d],
        [x + d, y + d],
        [x - d, y + d],
        [x - d, y - d],
      ],
    ],
  };
}

/** Per-type proximity buffers (metres) — INJECTED into the exposure/priority engines (never hardcoded). */
export const DEFAULT_BUFFERS: Readonly<Record<InfraNodeType, number>> = {
  HOSPITAL: 2000,
  NURSING_HOME: 2000,
  POWER: 1000,
  CELL: 1000,
  ROAD: 500,
  RAIL: 500,
  SHELTER: 1500,
};

// ── California — WILDFIRE (raw inputs) ────────────────────────────────────────────────────────────

export const CA_SUB_N = asId<InfrastructureNodeId>('ca-substation-north');
export const CA_SUB_S = asId<InfrastructureNodeId>('ca-substation-south');

/** Candidate lifeline nodes — both within the perimeter box, so exposure COMPUTES to 2 (not asserted here). */
export const CA_NODES: readonly InfrastructureNode[] = [
  makeInfrastructureNode({
    id: CA_SUB_N,
    type: 'POWER',
    status: 'AT_RISK',
    geom: point([-121.61, 39.72]),
    sourceId: asId<SourceId>('overpass'),
  }),
  makeInfrastructureNode({
    id: CA_SUB_S,
    type: 'POWER',
    status: 'OFFLINE',
    geom: point([-121.58, 39.68]),
    sourceId: asId<SourceId>('overpass'),
  }),
];

// SOURCE HONESTY (Art. XVI honest-limitations): FIRMS provides fire HOTSPOTS, never perimeters — so the
// PERIMETER is attributed to NIFC/WFIGS (the official US interagency perimeter source), NOT FIRMS. The two
// HOTSPOTS stay 'firms'. The live bridge (live-seed.ts) merges FIRMS hotspots + NIFC perimeters, so this
// seed mirrors the live provenance split (hotspots←firms, perimeter←nifc) even in the offline default.
export const CA_HAZARDS: readonly HazardGeometry[] = [
  makeHazardGeometry({
    id: asId<HazardGeometryId>('ca-perimeter-1'),
    incidentId: CA_INCIDENT,
    sourceId: asId<SourceId>('nifc'),
    kind: 'PERIMETER',
    geometry: box(CA_CENTER, 0.05),
    observedAt: SEEDED_AT,
  }),
  makeHazardGeometry({
    id: asId<HazardGeometryId>('ca-hotspot-1'),
    incidentId: CA_INCIDENT,
    sourceId: asId<SourceId>('firms'),
    kind: 'HOTSPOT',
    geometry: point([-121.6, 39.7]),
    observedAt: SEEDED_AT,
    intensity: 340,
  }),
  makeHazardGeometry({
    id: asId<HazardGeometryId>('ca-hotspot-2'),
    incidentId: CA_INCIDENT,
    sourceId: asId<SourceId>('firms'),
    kind: 'HOTSPOT',
    geometry: point([-121.59, 39.71]),
    observedAt: SEEDED_AT,
    intensity: 310,
  }),
];

/** Fire-cone origin (the active hotspot anchor) + wind input (25 km/h from NE ⇒ blows toward SW=225°). */
export const CA_FIRE_ORIGIN: Position = [-121.6, 39.7];
export const CA_WIND_DIR_DEG = 225; // bearing the wind blows TOWARD (from NE → toward SW)
export const CA_WIND_SPEED_MPS = 25 / 3.6; // 25 km/h
export const CA_WIND_SPEED_KMH = 25;

/**
 * What CA's trend series MEASURES, in the unit the seed authored it in. Stated as DATA next to the readings
 * so the label and the numbers can never drift apart: a slope whose unit lives in another file is one edit
 * away from being mislabelled (finding F-83 — every zone used to fall back to the generic "units as
 * published by the source"). Acreage is NIFC's published incident measure, which is also where CA's
 * PERIMETER geometry comes from, so `CA_TREND_SOURCE` names it rather than the hotspot feed.
 */
export const CA_TREND_SIGNAL_LABEL = 'burned area (acres)';
export const CA_TREND_SOURCE = asId<SourceId>('nifc');

/** Rising fire-signal history (acreage over the last 2h) ⇒ classifyTrend COMPUTES ESCALATING. */
export const CA_TREND_READINGS: readonly TrendSample[] = [
  { t: SEEDED_S - 2 * HOUR_S, value: 100 },
  { t: SEEDED_S - 1 * HOUR_S, value: 150 },
  { t: SEEDED_S, value: 210 },
];

export const CA_EXPOSED_POPULATION = 3200;

// ── California — Phase-D MAP layers (outage / cell / weather; MOCK-seeded so the offline default renders
//    them). The CELL nodes are placed OUTSIDE the fire perimeter+proximity buffer ON PURPOSE: they enrich
//    the infra/cell map layers without changing the COMPUTED wildfire exposure count (still the 2 in-perimeter
//    substations). These are map-only — the CORE SitRep seed (seed.ts) keeps CA_NODES untouched (Art. XII).
export const CA_CELL_N = asId<InfrastructureNodeId>('ca-cell-north');
export const CA_CELL_S = asId<InfrastructureNodeId>('ca-cell-south');

/** OpenCelliD-style cell sites, positioned clear of the hazard footprint (see note above). */
export const CA_CELL_NODES: readonly InfrastructureNode[] = [
  makeInfrastructureNode({
    id: CA_CELL_N,
    type: 'CELL',
    status: 'AT_RISK',
    geom: point([-121.52, 39.79]),
    sourceId: asId<SourceId>('opencellid'),
  }),
  makeInfrastructureNode({
    id: CA_CELL_S,
    type: 'CELL',
    status: 'ONLINE',
    geom: point([-121.49, 39.61]),
    sourceId: asId<SourceId>('opencellid'),
  }),
];

/** The map's full candidate-node set = core substations + the extra CELL sites (map layer only). */
export const CA_MAP_NODES: readonly InfrastructureNode[] = [...CA_NODES, ...CA_CELL_NODES];

/** The OFFLINE POWER node's location — the anchor for the ASSUMED-offline outage AOI below. */
export const CA_OFFLINE_POWER: readonly [number, number] = [-121.58, 39.68];

/** A small raw outage record (county-granular BBox around the OFFLINE substation). W2b derives its AOI
 *  polygon + the ASSUMED-offline label — honest: an INFERENCE (hazard∩power), not an observed live cut. */
export const CA_OUTAGES: readonly OutageRecord[] = [
  { area: [-121.6, 39.66, -121.56, 39.7] as BBox, customersOut: 4200, observedAt: SEEDED_AT },
];

/** Raw OpenCelliD-style coverage points for the `cell` layer (one shown offline near the fire edge). */
export const CA_CELL_SITES: readonly TelecomCoverage[] = [
  { position: [-121.52, 39.79], technology: 'LTE', online: true },
  { position: [-121.49, 39.61], technology: '5G', online: false },
];

/** The raw deterministic wind observation (observation POINT — never a synthesized grid); W2b glyphs it. */
export const CA_WEATHER: WeatherObservation = {
  at: SEEDED_AT,
  position: CA_FIRE_ORIGIN,
  windSpeedMs: CA_WIND_SPEED_MPS,
  windDirDeg: CA_WIND_DIR_DEG,
};

/** Per-layer source attribution (layer id → manifest source id) for per-layer freshness badges (W3a).
 *  ONE source per layer. The `fire` layer renders BOTH FIRMS hotspots and the NIFC perimeter, but its
 *  freshness badge cites 'firms' — the near-real-time hotspot feed is the freshest driver of the layer,
 *  whereas NIFC perimeters lag hours/days. NIFC attribution is preserved at the geometry level (the
 *  PERIMETER's own sourceId is 'nifc' above), so nothing is mislabelled. */
export const CA_LAYER_SOURCES: Readonly<Record<string, string>> = {
  fire: 'firms',
  infra: 'osm-overpass',
  outage: 'eagle-i',
  cell: 'opencellid',
  weather: 'open-meteo',
  cameras: 'caltrans-cctv', // multi-source layer badge cites the primary; each pin carries its own provider
};

// ── California — E11 CAMERA pins (Live Views; map-only, MOCK-seeded so the offline demo shows link-out pins).
//    Each viewUrl is copied VERBATIM from a REAL adapter fixture (alertwildfire/caltrans-cctv __fixtures__), so a
//    seeded pin opens a REAL live-view page/stream. LINK-ONLY (Art. XII): BEACON never rehosts a video byte —
//    the pin only carries the external https page url. Positions are the fixtures' own Butte-County coordinates.
export const CA_CAMERAS: readonly CameraFeed[] = [
  makeCameraFeed({
    id: asId<CameraFeedId>('alertwildfire:concow'),
    position: [-121.538696, 39.771301], // Concow Mtn. (Butte County) — ALERTCalifornia PTZ fire camera
    kind: 'FIRE_CAMERA',
    title: 'Concow Mtn.',
    provider: 'ALERTCalifornia | UC San Diego',
    viewUrl: 'https://cameras.alertcalifornia.org/?id=Axis-Concow',
    license: 'CC BY-NC-ND 4.0 (imagery; link-only use)',
    isLive: true,
    observedAt: SEEDED_AT,
  }),
  makeCameraFeed({
    id: asId<CameraFeedId>('caltrans-cctv:hwy32-main-chico'),
    position: [-121.834856, 39.725615], // Hwy 32 at Main St, Chico (Butte County) — Caltrans D3 CCTV
    kind: 'TRAFFIC_CCTV',
    title: 'Hwy 32 at Main St Chico',
    provider: 'Caltrans',
    viewUrl: 'https://wzmedia.dot.ca.gov/D3/32_Main_St_Chico_BUT32_EB.stream/playlist.m3u8',
    license: 'Caltrans open data',
    isLive: true,
    observedAt: SEEDED_AT,
  }),
  makeCameraFeed({
    id: asId<CameraFeedId>('caltrans-cctv:hwy99-neal'),
    position: [-121.74011, 39.6622], // Hwy 99 at Neal, Durham (Butte County) — Caltrans D3 CCTV
    kind: 'TRAFFIC_CCTV',
    title: 'Hwy 99 at Neal',
    provider: 'Caltrans',
    viewUrl: 'https://wzmedia.dot.ca.gov/D3/99_Neal_Rd_JSO_BUT99_SB.stream/playlist.m3u8',
    license: 'Caltrans open data',
    isLive: true,
    observedAt: SEEDED_AT,
  }),
];

// ── Romania — FLOOD (raw inputs) ───────────────────────────────────────────────────────────────────

export const RO_HOSPITAL = asId<InfrastructureNodeId>('ro-hospital-galati');

export const RO_NODES: readonly InfrastructureNode[] = [
  makeInfrastructureNode({
    id: RO_HOSPITAL,
    type: 'HOSPITAL',
    status: 'AT_RISK',
    geom: point([28.03, 45.46]),
    sourceId: asId<SourceId>('overpass'),
  }),
];

export const RO_HAZARDS: readonly HazardGeometry[] = [
  makeHazardGeometry({
    id: asId<HazardGeometryId>('ro-reach-1'),
    incidentId: RO_INCIDENT,
    sourceId: asId<SourceId>('glofas'),
    kind: 'FLOOD_REACH',
    geometry: box(RO_CENTER, 0.05),
    observedAt: SEEDED_AT,
  }),
];

/**
 * The seeded RO forecast signals (finding F-84). BOTH are AUTHORED OFFLINE-DEMO DATA, not readings — every
 * ref that carries them is mode-labelled `MOCK` (seed.ts provenance + `sources.ro`), and nothing in the
 * offline profile ever presents them as LIVE. They exist because the C1 likelihood seam had no seeded signal
 * to read, so the ranked Outlook shipped every offline row at its `POSSIBLE` default with an empty class and
 * ETA — a feature with no on-camera moment. With `DATA_SOURCE_COMPOSITION=adapters` the recorded GloFAS
 * reporting point supplies the real numbers instead and these are replaced wholesale (live-seed `updateCrest`).
 *
 * 0.45 is deliberately MID-BAND (`config/likelihood-thresholds.json`: LIKELY ≥ 0.3, VERY_LIKELY ≥ 0.6): the
 * RO scenario is a 2-year/minor event whose gauge history is FLAT (`RO_TREND_READINGS` ⇒ STEADY), so seeding
 * a very-likely probability beside a river that is not rising would be an incoherent demo.
 *
 * The crest instant mirrors the projected flood-crest arrival the feature seed already carries for this same
 * incident (`feature-seed.ts` hazardArrival, `ro-flood-demo` → 2026-07-06T06:00:00Z) rather than inventing a
 * second, disagreeing instant — 8 h after the seeded `computedAt`.
 */
export const RO_CREST_TIME = '2026-07-06T06:00:00Z';
export const RO_EXCEEDANCE_PROBABILITY = 0.45;

export const RO_GAUGE: Gauge = makeGauge({
  id: asId<GaugeId>('ro-gauge-1'),
  geom: point([28.02, 45.44]),
  floodCategory: 'MINOR',
  stage: 4.2,
  crestTime: RO_CREST_TIME,
  exceedanceProbability: RO_EXCEEDANCE_PROBABILITY,
  sourceId: asId<SourceId>('glofas'),
});

/** The NWPS forecast-crest reach ∩ FEMA-NFHL polygon inputs for the flood-inundation projection. */
export const RO_REACH: PolygonGeometry = box(RO_CENTER, 0.05);
export const RO_NFHL: PolygonGeometry = box(RO_CENTER, 0.06);

/** RO's trend signal IS the gauge stage above, in metres (F-83). GloFAS is the source of RO's flood
 *  evidence, so it is also the source of the series a projected slope is fitted to. */
export const RO_TREND_SIGNAL_LABEL = 'gauge stage (m)';
export const RO_TREND_SOURCE = asId<SourceId>('glofas');

/** Flat gauge-stage history ⇒ classifyTrend COMPUTES STEADY (no rise beyond the dead-band). */
export const RO_TREND_READINGS: readonly TrendSample[] = [
  { t: SEEDED_S - 2 * HOUR_S, value: 4.2 },
  { t: SEEDED_S - 1 * HOUR_S, value: 4.2 },
  { t: SEEDED_S, value: 4.2 },
];

export const RO_RETURN_PERIOD_LABEL = '2-year';
export const RO_FLOOD_CATEGORY_LABEL = 'minor';
export const RO_EXPOSED_POPULATION = 8000;

// ── Romania — Phase-D MAP layers (floodzone / cell; MOCK-seeded so the RO flood default renders them too).
//    The NFHL polygon is a REGULATORY floodplain boundary (a legal/insurance zone, not a live extent) — the
//    frontend labels it honestly. Cell sites here are map-only and do not affect the COMPUTED RO exposure.
export const RO_FLOOD_ZONES: readonly FloodZone[] = [
  makeFloodZone({ id: 'ro-nfhl-ae', zone: 'AE', geom: RO_NFHL }),
];

export const RO_CELL_SITES: readonly TelecomCoverage[] = [
  { position: [28.03, 45.46], technology: 'LTE', online: true },
];

/** Per-layer source attribution for the RO layers (per-layer freshness, W3a). */
export const RO_LAYER_SOURCES: Readonly<Record<string, string>> = {
  flood: 'glofas',
  infra: 'osm-overpass',
  floodzone: 'nfhl',
  cell: 'opencellid',
  cameras: 'cnadnr-ro', // RO camera layer badge cites CNADNR (primary); Windy is the GLOBAL secondary
};

// ── Romania — E11 CAMERA pins (Live Views; map-only, MOCK-seeded). viewUrl copied VERBATIM from the cnadnr-ro
//    HAND-CURATED fixture (each href curl-verified HTTP 200, 2026-07-17). Town-level positions (Fetești A2 /
//    Giurgiu DN5 Danube crossings) — link-only official CNADNR/CNAIR Trafic-Live pages (Art. XII).
export const RO_CAMERAS: readonly CameraFeed[] = [
  makeCameraFeed({
    id: asId<CameraFeedId>('cnadnr-ro:fetesti-a2-camera-1'),
    position: [27.83, 44.38], // Fetești — A2 motorway Danube crossing (Bucureşti↔Constanţa)
    kind: 'TRAFFIC_CCTV',
    title: 'Fetesti: Bucuresti-Constanta (Camera 1)',
    provider: 'CNAIR (cnadnr.ro)',
    viewUrl: 'https://www.cnadnr.ro/ro/trafic-live/fetesti-bucuresti-constanta-camera-1',
    license: 'Official public agency pages (link-only)',
    isLive: true,
    observedAt: SEEDED_AT,
  }),
  makeCameraFeed({
    id: asId<CameraFeedId>('cnadnr-ro:giurgiu-iesire'),
    position: [25.97, 43.9], // Giurgiu — DN5 Danube border crossing into Bulgaria
    kind: 'TRAFFIC_CCTV',
    title: 'Giurgiu: Iesire',
    provider: 'CNAIR (cnadnr.ro)',
    viewUrl: 'https://www.cnadnr.ro/ro/trafic-live/giurgiu-iesire',
    license: 'Official public agency pages (link-only)',
    isLive: true,
    observedAt: SEEDED_AT,
  }),
];

// ── B3.3/B3.5 — the three DEMO-GRADE zones (es · gr · ph) ─────────────────────────────────────────────
//
// READ THIS BEFORE EXTENDING THESE THREE. They are the offline (MOCK) counterpart of three region rows that
// were added to config/regions.json with ZERO application code (B1.8/FR-ZONE-3). Nothing below dispatches on
// a region id — it is DATA, in exactly the shape `us-ca`/`ro` already use, so the same generic composition
// picks it up. What is deliberately THINNER than the flagship, and must stay stated rather than papered over
// (Art. XVI honest limitations; the S03 delta's "three new zones are demo-grade, not full parity"):
//   • no camera pins — none of these zones has a national camera directory in this build, and `windy-webcams`
//     ships no recorded ES/GR/PH pin, so seeding one would mean inventing a live-view URL (Art. XII);
//   • no outage / cell / flood-zone layers — no outage source covers them (EAGLE-I is US-only) and no
//     regulatory floodplain layer exists for them (FEMA NFHL is US-only), so those slices are ABSENT, not
//     zero-filled: an empty layer that renders is a claim, a missing one is an honest gap;
//   • population figures are seeded PLANNING numbers (the Art. XVI fallback rung), replaced by WorldPop the
//     moment that source serves — identical to `us-ca`/`ro`.
// Every provenance ref below is MOCK, and the incident headlines name ILLUSTRATIVE events (the `Bear Ridge
// Fire` precedent) over REAL geography: a seeded scenario must never read as a real, current incident.

// ── Spain — WILDFIRE (raw inputs). Sierra de la Culebra, Zamora: real fire country, illustrative event. ──

export const ES_SUB = asId<InfrastructureNodeId>('es-substation-tabara');
export const ES_HOSPITAL = asId<InfrastructureNodeId>('es-hospital-benavente');

export const ES_NODES: readonly InfrastructureNode[] = [
  makeInfrastructureNode({
    id: ES_SUB,
    type: 'POWER',
    status: 'AT_RISK',
    geom: point([-6.31, 41.91]),
    sourceId: asId<SourceId>('overpass'),
  }),
  makeInfrastructureNode({
    id: ES_HOSPITAL,
    type: 'HOSPITAL',
    status: 'AT_RISK',
    geom: point([-6.28, 41.88]),
    sourceId: asId<SourceId>('overpass'),
  }),
];

// SOURCE HONESTY: the PERIMETER is attributed to EFFIS (the Copernicus EU fire-perimeter service), the
// HOTSPOT to FIRMS — the same hotspot/perimeter split `us-ca` makes with FIRMS/NIFC. `es` enables no
// US-only perimeter source, so EFFIS is its perimeter rung and FIRMS its hotspot rung.
export const ES_HAZARDS: readonly HazardGeometry[] = [
  makeHazardGeometry({
    id: asId<HazardGeometryId>('es-perimeter-1'),
    incidentId: ES_INCIDENT,
    sourceId: asId<SourceId>('effis'),
    kind: 'PERIMETER',
    geometry: box(ES_CENTER, 0.05),
    observedAt: SEEDED_AT,
  }),
  makeHazardGeometry({
    id: asId<HazardGeometryId>('es-hotspot-1'),
    incidentId: ES_INCIDENT,
    sourceId: asId<SourceId>('firms'),
    kind: 'HOTSPOT',
    geometry: point([-6.3, 41.9]),
    observedAt: SEEDED_AT,
    intensity: 335,
  }),
];

/** Fire-cone origin + wind input (30 km/h from the west ⇒ blows toward the east, bearing 90°). */
export const ES_FIRE_ORIGIN: Position = [-6.3, 41.9];
export const ES_WIND_DIR_DEG = 90;
export const ES_WIND_SPEED_MPS = 30 / 3.6;
export const ES_WIND_SPEED_KMH = 30;

/** ES's trend signal is HECTARES, not acres — EFFIS is the EU burned-area authority and it publishes in
 *  hectares. Stated here so the label travels with the readings (F-83). */
export const ES_TREND_SIGNAL_LABEL = 'burned area (hectares)';
export const ES_TREND_SOURCE = asId<SourceId>('effis');

/** Rising fire-signal history (hectares over the last 2 h) ⇒ classifyTrend COMPUTES ESCALATING. */
export const ES_TREND_READINGS: readonly TrendSample[] = [
  { t: SEEDED_S - 2 * HOUR_S, value: 60 },
  { t: SEEDED_S - 1 * HOUR_S, value: 95 },
  { t: SEEDED_S, value: 140 },
];

export const ES_EXPOSED_POPULATION = 1400;

export const ES_WEATHER: WeatherObservation = {
  at: SEEDED_AT,
  position: ES_FIRE_ORIGIN,
  windSpeedMs: ES_WIND_SPEED_MPS,
  windDirDeg: ES_WIND_DIR_DEG,
};

/** Per-layer source attribution. Only the THREE layers `es` can actually back are listed — no camera,
 *  outage, cell or floodzone badge, because no enabled source paints those layers for Spain. */
export const ES_LAYER_SOURCES: Readonly<Record<string, string>> = {
  fire: 'firms',
  infra: 'osm-overpass',
  weather: 'open-meteo',
};

// ── Greece — WILDFIRE (raw inputs). Northern Evia (Euboea): real fire country, illustrative event. ──────

export const GR_SUB = asId<InfrastructureNodeId>('gr-substation-limni');
export const GR_HOSPITAL = asId<InfrastructureNodeId>('gr-hospital-istiaia');

export const GR_NODES: readonly InfrastructureNode[] = [
  makeInfrastructureNode({
    id: GR_SUB,
    type: 'POWER',
    status: 'AT_RISK',
    geom: point([23.61, 38.86]),
    sourceId: asId<SourceId>('overpass'),
  }),
  makeInfrastructureNode({
    id: GR_HOSPITAL,
    type: 'HOSPITAL',
    status: 'AT_RISK',
    geom: point([23.58, 38.83]),
    sourceId: asId<SourceId>('overpass'),
  }),
];

export const GR_HAZARDS: readonly HazardGeometry[] = [
  makeHazardGeometry({
    id: asId<HazardGeometryId>('gr-perimeter-1'),
    incidentId: GR_INCIDENT,
    sourceId: asId<SourceId>('effis'),
    kind: 'PERIMETER',
    geometry: box(GR_CENTER, 0.05),
    observedAt: SEEDED_AT,
  }),
  makeHazardGeometry({
    id: asId<HazardGeometryId>('gr-hotspot-1'),
    incidentId: GR_INCIDENT,
    sourceId: asId<SourceId>('firms'),
    kind: 'HOTSPOT',
    geometry: point([23.6, 38.85]),
    observedAt: SEEDED_AT,
    intensity: 350,
  }),
];

/** Fire-cone origin + wind input (40 km/h meltemi from the north ⇒ blows toward the south, bearing 180°). */
export const GR_FIRE_ORIGIN: Position = [23.6, 38.85];
export const GR_WIND_DIR_DEG = 180;
export const GR_WIND_SPEED_MPS = 40 / 3.6;
export const GR_WIND_SPEED_KMH = 40;

/**
 * GR's trend series shipped with NO unit stated anywhere (F-83's "available and unstated" case, in its
 * strongest form: even the seed comment was silent). It is authored demo data grounded on EFFIS — the same
 * EU burned-area authority `es` uses, in the same magnitude band — so the unit is STATED here as hectares
 * and the series is now labelled rather than left to the generic fallback. Nothing was recomputed: only the
 * label the numbers always had implicitly is now written down.
 */
export const GR_TREND_SIGNAL_LABEL = 'burned area (hectares)';
export const GR_TREND_SOURCE = asId<SourceId>('effis');

/** Rising fire-signal history (hectares over the last 2 h) ⇒ classifyTrend COMPUTES ESCALATING. */
export const GR_TREND_READINGS: readonly TrendSample[] = [
  { t: SEEDED_S - 2 * HOUR_S, value: 80 },
  { t: SEEDED_S - 1 * HOUR_S, value: 130 },
  { t: SEEDED_S, value: 205 },
];

export const GR_EXPOSED_POPULATION = 2100;

export const GR_WEATHER: WeatherObservation = {
  at: SEEDED_AT,
  position: GR_FIRE_ORIGIN,
  windSpeedMs: GR_WIND_SPEED_MPS,
  windDirDeg: GR_WIND_DIR_DEG,
};

export const GR_LAYER_SOURCES: Readonly<Record<string, string>> = {
  fire: 'firms',
  infra: 'osm-overpass',
  weather: 'open-meteo',
};

// ── Philippines — FLOOD (raw inputs). Maguindanao / BARMM: the province PAGASA's real `gfa` General Flood
//    Advisory CAP names in the shipped wmo-swic fixture, so the offline scenario sits where the live alert
//    source actually speaks. Illustrative event, real geography. ─────────────────────────────────────────

export const PH_HOSPITAL = asId<InfrastructureNodeId>('ph-hospital-cotabato');

export const PH_NODES: readonly InfrastructureNode[] = [
  makeInfrastructureNode({
    id: PH_HOSPITAL,
    type: 'HOSPITAL',
    status: 'AT_RISK',
    geom: point([124.43, 6.96]),
    sourceId: asId<SourceId>('overpass'),
  }),
];

// The flood reach is attributed to GloFAS: F-51 recorded that NO Philippine gauge network was verified, so
// PH's flood evidence is the global Copernicus service and is labelled as such. PAGASA's own CAP reaches the
// SitRep as ALERT/NEWS intel through `wmo-swic`, which never constructs a HazardGeometry at all (F-48) — so
// no PAGASA polygon can appear here even by accident.
export const PH_HAZARDS: readonly HazardGeometry[] = [
  makeHazardGeometry({
    id: asId<HazardGeometryId>('ph-reach-1'),
    incidentId: PH_INCIDENT,
    sourceId: asId<SourceId>('glofas'),
    kind: 'FLOOD_REACH',
    geometry: box(PH_CENTER, 0.05),
    observedAt: SEEDED_AT,
  }),
];

/**
 * The seeded PH forecast signals (finding F-84) — AUTHORED OFFLINE-DEMO DATA on the same terms as RO's
 * above: MOCK-labelled everywhere it surfaces, replaced by the real reporting point in the adapters profile,
 * never presented as LIVE.
 *
 * 0.68 sits in the VERY_LIKELY band (≥ 0.6) where RO's 0.45 sits in LIKELY, so the offline demo exercises
 * BOTH populated bands rather than one. It is the coherent value for this scenario: PH's gauge history is
 * the one that is actually RISING (+0.25 m/h — inside the classifier's dead band, so the trend label stays
 * STEADY per finding F-82, but the water is going up), whereas RO's is flat.
 *
 * The crest instant is +12 h from the seeded `computedAt` — one operational planning mark out, matching the
 * `config/trend-projection.json` checkpoint grid the same incident's impact projection reports against.
 */
export const PH_CREST_TIME = '2026-07-06T10:00:00Z';
export const PH_EXCEEDANCE_PROBABILITY = 0.68;

export const PH_GAUGE: Gauge = makeGauge({
  id: asId<GaugeId>('ph-gauge-1'),
  geom: point([124.41, 6.94]),
  floodCategory: 'MINOR',
  stage: 3.1,
  crestTime: PH_CREST_TIME,
  exceedanceProbability: PH_EXCEEDANCE_PROBABILITY,
  sourceId: asId<SourceId>('glofas'),
});

/** PH's trend signal IS the gauge stage above, in metres (F-83); GloFAS supplies PH's flood evidence. */
export const PH_TREND_SIGNAL_LABEL = 'gauge stage (m)';
export const PH_TREND_SOURCE = asId<SourceId>('glofas');

/** The forecast-crest reach. There is NO `PH_NFHL` counterpart on purpose — see DEFAULT_MAP_SEED. */
export const PH_REACH: PolygonGeometry = box(PH_CENTER, 0.05);

/**
 * Slowly rising gauge-stage history. VERIFIED (finding F-82): `classifyTrend` computes a slope of
 * +0.25 m/h, which the 0.5-unit dead-band absorbs ⇒ the trend label is **STEADY**, not ESCALATING — the
 * comment here previously claimed the opposite. The readings are left exactly as seeded: a 0.5 m rise over
 * two hours genuinely is inside the classifier's noise band, and editing the data to make the prose true
 * would be inventing a trend. Consequence downstream (C2.2): `ph` gets an `IMPACT_OVER_TIME` prediction but
 * no `ESCALATION` one, which is the honest reading of this series.
 */
export const PH_TREND_READINGS: readonly TrendSample[] = [
  { t: SEEDED_S - 2 * HOUR_S, value: 2.6 },
  { t: SEEDED_S - 1 * HOUR_S, value: 2.9 },
  { t: SEEDED_S, value: 3.1 },
];

export const PH_RETURN_PERIOD_LABEL = '2-year';
export const PH_FLOOD_CATEGORY_LABEL = 'minor';
export const PH_EXPOSED_POPULATION = 5200;

/** Per-layer source attribution. `flood` is badged by GloFAS (PH's only gauge rung); there is no fire,
 *  outage, cell, floodzone or camera badge because no source `ph` enables paints those layers. */
export const PH_LAYER_SOURCES: Readonly<Record<string, string>> = {
  flood: 'glofas',
  infra: 'osm-overpass',
};
