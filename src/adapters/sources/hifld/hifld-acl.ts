// BEACON — HIFLD lifelines anti-corruption layer (S2·Lane A3; adapter-contract §4, InfrastructurePort P4,
// Art. XII). Maps one ArcGIS-served GeoJSON feature of a HIFLD (Homeland Infrastructure Foundation-Level
// Data) lifeline layer → a canonical InfrastructureNode. This is the ONLY place the raw HIFLD/ArcGIS shapes
// exist; no HIFLD attribute name escapes above this module (AGENTS.md §3). Geometry is produced
// deterministically here — never by the LLM.
//
// ⚠ THE HIFLD OPEN PORTAL IS GONE — WHAT IS ACTUALLY REACHABLE TODAY (verified 2026-08-08, this repo):
//   • `hifld-geoplatform.opendata.arcgis.com` still answers 200 but serves only a generic ArcGIS Hub
//     JavaScript shell — no dataset catalogue, no data. DATA_SOURCE_VERIFICATION §4 already records
//     "HIFLD Open portal closed 2025".
//   • The AGOL item that used to back HIFLD hospitals — "Hospitals (Deprecated HIFLDS)", pointing at
//     `services1.arcgis.com/Hp6G80Pky0om7QvQ/…/Hospitals_gdb/FeatureServer` — is DEAD: the service itself
//     returns `{"error":{"code":400,"message":"Invalid URL"}}`. The catalogue entry outlived the service.
//   • WHAT DOES WORK, and is what this adapter uses: FEMA Region 9's public republication of the 2019 HIFLD
//     lifeline package — AGOL item "Lifeline - All Lifelines - Static - Package - 2019 / Critical
//     Infrastructure (HIFLD/R9)", owner `FEMA_Region9_GIS`, access `public`, at
//     `services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/Critical_Infrastructure_Map_Service/FeatureServer`.
//     Verified live: the service metadata lists 15 lifeline layers, and a real bbox query
//     (`/{layer}/query?geometry=-121.95,39.40,-121.35,39.90&geometryType=esriGeometryEnvelope&inSR=4326&
//      outFields=*&outSR=4326&f=geojson`) returned HTTP 200 GeoJSON with features for every layer this
//     adapter consumes. Those bodies are recorded VERBATIM in __fixtures__/lifelines-<layer>.geojson.
//
// HONEST LIMITATION — VINTAGE (this is why the adapter's verdict is CACHED, not LIVE): the reachable
// service is a STATIC 2019 SNAPSHOT package, and the recorded rows carry HIFLD-era `SOURCE_DATE`/`VAL_DATE`
// values from 2012–2014. It is a reference layer for "what lifeline assets exist here", NOT a current
// operational feed. Nothing in BEACON may present it as live status.
//
// LAYER → TYPE, DECIDED BY CONFIG NOT BY ATTRIBUTES: each HIFLD layer IS one asset class, and the five
// layers consumed here are exactly the ones the domain enum can represent honestly (see
// src/domain/infrastructure-node.ts INFRA_NODE_TYPES):
//     layer 10 Hospitals                        → HOSPITAL
//     layer  9 Nursing Homes                    → NURSING_HOME   ← not derivable from OSM tags at all
//     layer  5 Electric Power Generation Plants → POWER          ← generation, complementing OSM substations
//     layer  4 Cellular Towers                  → CELL
//     layer  0 National Shelter System Facilities → SHELTER      ← no OSM equivalent
// The other ten layers (schools, colleges, EOCs, law enforcement, fire stations, EMS stations, dams,
// wastewater, state buildings) are deliberately NOT consumed: the domain enum has no honest member for
// them, and mislabelling a fire station as HOSPITAL would corrupt downstream medical-capacity reasoning —
// the same call `osm-overpass` already documents. They are absent, never smuggled in under a wrong type.
//
// HONEST LIMITATION — STATUS: HIFLD carries no live operational state, so every node is stamped ONLINE
// (the schema default). A node's true up/down state must come from hazard∩infra derivation (Art. XVI) or
// another live source (e.g. EAGLE-I for POWER), never invented here.
//
// LENIENT by contract (S2 recipe): the five layers have DIFFERENT attribute schemas (hospitals publish
// NAME/BEDS/TRAUMA, cell towers publish LICENSEE/CALLSIGN/LAT_DMS …), so this ACL reads only what all of
// them share — a Point geometry and a feature id — and IGNORES every other attribute. A feature that is
// structurally unusable is DROPPED **and COUNTED** (`HifldParseResult.skipped`), never thrown, so one bad
// record can never blank a lifeline layer. Anything that reaches the mapper unmappable raises a typed PARSE.
import type {
  InfraNodeType,
  InfrastructureNode,
  InfrastructureNodeId,
  SourceId,
} from '@/domain/index.js';
import { asId, makeInfrastructureNode } from '@/domain/index.js';
import type { AntiCorruptionMapper, MapContext } from '@/adapters/_shared/index.js';
import { makeAdapterError } from '@/adapters/_shared/index.js';

/** One HIFLD lifeline layer: its FeatureServer layer id and the domain type every feature in it has. */
export interface HifldLayer {
  readonly layerId: number;
  readonly type: InfraNodeType;
}

/**
 * The five lifeline layers this adapter consumes, and ONLY those (rationale in the module header). Ordered
 * hospital-first so the most exposure-relevant assets lead the mapped output.
 */
export const HIFLD_LAYERS: readonly HifldLayer[] = [
  { layerId: 10, type: 'HOSPITAL' },
  { layerId: 9, type: 'NURSING_HOME' },
  { layerId: 5, type: 'POWER' },
  { layerId: 4, type: 'CELL' },
  { layerId: 0, type: 'SHELTER' },
];

/** One raw HIFLD feature, flattened with the layer identity that decides its domain type. Raw until mapped. */
export interface HifldRaw {
  readonly layerId: number;
  readonly type: InfraNodeType;
  readonly featureId: string;
  readonly lon: number;
  readonly lat: number;
}

export interface HifldParseResult {
  readonly rows: readonly HifldRaw[];
  /** Features dropped for a malformed shape — DROPPED and COUNTED, never silently discarded. */
  readonly skipped: number;
}

/**
 * Parse one layer's ArcGIS `f=geojson` response. Invalid JSON, an ArcGIS `{"error":…}` envelope, or a
 * non-array `features` all yield an empty result rather than a throw, so the redundancy ladder degrades to
 * cache/mock instead of dead-ending (Art. XVI).
 */
export function parseHifldLayer(text: string, layer: HifldLayer): HifldParseResult {
  const doc = safeParse(text);
  const features = (doc as { features?: unknown } | undefined)?.features;
  if (!Array.isArray(features)) return { rows: [], skipped: 0 };
  const rows: HifldRaw[] = [];
  let skipped = 0;
  for (const feature of features) {
    const row = toRow(feature, layer);
    if (row === undefined) skipped += 1;
    else rows.push(row);
  }
  return { rows, skipped };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * A feature is usable when it has a Point geometry with finite [lon, lat] and SOME stable identifier. HIFLD
 * layers disagree on where that identifier lives — hospitals/shelters/nursing homes publish `ID`, power
 * plants and cell towers do not — so the GeoJSON feature `id` (ArcGIS emits the OBJECTID there) is the
 * fallback. Non-Point geometries are skipped: BEACON models lifelines as nodes, and reducing a polygon to a
 * point here would invent a location the source never published.
 */
function toRow(feature: unknown, layer: HifldLayer): HifldRaw | undefined {
  if (typeof feature !== 'object' || feature === null) return undefined;
  const f = feature as {
    id?: unknown;
    geometry?: { type?: unknown; coordinates?: unknown };
    properties?: unknown;
  };
  if (f.geometry?.type !== 'Point' || !Array.isArray(f.geometry.coordinates)) return undefined;
  const lon = num(f.geometry.coordinates[0]);
  const lat = num(f.geometry.coordinates[1]);
  if (lon === undefined || lat === undefined) return undefined;
  const featureId = identify(f.properties, f.id);
  if (featureId === undefined) return undefined;
  return { layerId: layer.layerId, type: layer.type, featureId, lon, lat };
}

function identify(properties: unknown, fallbackId: unknown): string | undefined {
  const props =
    typeof properties === 'object' && properties !== null
      ? (properties as Record<string, unknown>)
      : {};
  for (const candidate of [props.ID, props.OBJECTID, fallbackId]) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim();
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return String(candidate);
  }
  return undefined;
}

export const hifldMapper: AntiCorruptionMapper<HifldRaw, InfrastructureNode> = {
  toCanonical(raw: HifldRaw, ctx: MapContext): InfrastructureNode {
    if (!Number.isFinite(raw.lon) || !Number.isFinite(raw.lat)) {
      // Defensive: parseHifldLayer filters these first, but the ACL boundary itself must never accept a
      // node it cannot place (never-silently-dropped doctrine).
      throw makeAdapterError('PARSE', `HIFLD feature '${raw.featureId}' has invalid coordinates`);
    }
    return makeInfrastructureNode({
      id: nodeId(raw),
      type: raw.type,
      geom: { type: 'Point', coordinates: [raw.lon, raw.lat] },
      // HIFLD publishes no live operational state — ONLINE is the schema default, never an assertion.
      status: 'ONLINE',
      sourceId: asId<SourceId>(ctx.sourceRecordId),
    });
  },
};

/** Stable, layer-scoped id: HIFLD feature ids are unique within a layer, not across the service. */
function nodeId(raw: HifldRaw): InfrastructureNodeId {
  return asId<InfrastructureNodeId>(`hifld:${raw.layerId}:${raw.featureId}`);
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}
