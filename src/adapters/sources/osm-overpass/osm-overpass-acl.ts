// BEACON — OSM Overpass anti-corruption layer (E4·osm-overpass; adapter-contract §4, InfrastructurePort
// P4, DATA_SOURCE_VERIFICATION §4 OSM Overpass row). Maps an Overpass `out:json` node element → a
// canonical InfrastructureNode. This is the ONLY place the raw Overpass element shape exists; no Overpass
// tag escapes above this module (AGENTS.md §3). Geometry is produced deterministically here — never the LLM.
//
// Tag → InfraNodeType map (defensible, documented; see src/domain/infrastructure-node.ts INFRA_NODE_TYPES
// for the full enum — HOSPITAL/NURSING_HOME/POWER/CELL/ROAD/RAIL/SHELTER):
//   amenity=hospital                                        -> HOSPITAL
//   power=substation                                        -> POWER
//   man_made=mast AND (tower:type=communication OR any "communication" key present) -> CELL
// Honest limitation #1 (fire stations): the QL (osm-overpass-adapter.ts) also fetches amenity=fire_station
// nodes because they are operationally important lifeline facilities. BUT the domain INFRA_NODE_TYPES enum
// has no "emergency services" member, and mislabelling a fire station as HOSPITAL/SHELTER/etc. would be
// dishonest (it would corrupt downstream exposure/medical-capacity reasoning). There is no "nearest honest"
// type for it today, so fire-station nodes — and any other node whose tags don't hit the map above (e.g. a
// man_made=mast that is NOT a communications mast, such as a lighting mast) — are filtered out at PARSE
// time (parseOverpassElements), never silently smuggled into a wrong type. They are simply absent from the
// mapped output; a caller can diff raw element count vs. mapped record count to recover the skipped count
// (see osm-overpass-acl.test.ts for that assertion).
// Honest limitation #2 (status): OSM carries no live operational status for any of these nodes — status is
// always stamped ONLINE (the schema default). A node's true up/down state must come from hazard∩infra
// derivation (Article XVI) or another live source (e.g. EAGLE-I for POWER), never invented here.
// Honest limitation #3 (name): InfrastructureNode (src/domain/infrastructure-node.ts) has no `name` field
// today, so `resolveOsmName` below is exposed/tested as a ready-to-wire pure helper (tags.name, falling
// back to `${type}-${id}`) but is NOT attached to the entity until the domain model grows one — this is a
// domain-model gap, not a dropped requirement.
import type { InfraNodeType, InfrastructureNode, InfrastructureNodeId, SourceId } from '@/domain/index.js';
import { asId, makeInfrastructureNode } from '@/domain/index.js';
import type { AntiCorruptionMapper, MapContext } from '@/adapters/_shared/index.js';
import { makeAdapterError } from '@/adapters/_shared/index.js';

/** One raw Overpass `out:json` element (node-only for this adapter — see adapter QL). Raw until mapped. */
export interface OsmOverpassElement {
  readonly type?: string;
  readonly id?: number;
  readonly lat?: number;
  readonly lon?: number;
  readonly tags?: Readonly<Record<string, string>>;
}

/** Pure, defensible tag classifier — the ONLY place the tag set is decided (documented above). */
export function classifyInfraType(tags: Readonly<Record<string, string>> | undefined): InfraNodeType | undefined {
  if (tags === undefined) return undefined;
  if (tags.amenity === 'hospital') return 'HOSPITAL';
  if (tags.power === 'substation') return 'POWER';
  if (tags.man_made === 'mast' && (tags['tower:type'] === 'communication' || 'communication' in tags)) {
    return 'CELL';
  }
  return undefined;
}

/**
 * Parse an Overpass `out:json` response body, keeping only `node` elements whose tags classify to a
 * supported InfraNodeType. Elements the current domain enum cannot honestly represent (fire stations,
 * non-communication masts, etc.) are dropped HERE — an intentional scope decision, not data corruption —
 * so mapOne/mapRows never has to see them (mirrors gdacs-acl.ts's eventtype filter).
 */
export function parseOverpassElements(text: string): OsmOverpassElement[] {
  const doc = JSON.parse(text) as { elements?: OsmOverpassElement[] };
  const elements = Array.isArray(doc.elements) ? doc.elements : [];
  return elements.filter((el) => el.type === 'node' && classifyInfraType(el.tags) !== undefined);
}

export const osmOverpassMapper: AntiCorruptionMapper<OsmOverpassElement, InfrastructureNode> = {
  toCanonical(raw: OsmOverpassElement, ctx: MapContext): InfrastructureNode {
    const type = classifyInfraType(raw.tags);
    if (type === undefined) {
      // Defensive re-check — parseOverpassElements filters these first (mirrors gdacs-acl.ts).
      throw makeAdapterError(
        'PARSE',
        `OSM node ${String(raw.id)} tags do not map to a supported InfraNodeType: ${JSON.stringify(raw.tags ?? {})}`,
      );
    }
    if (typeof raw.id !== 'number' || typeof raw.lat !== 'number' || typeof raw.lon !== 'number' ||
        !Number.isFinite(raw.lat) || !Number.isFinite(raw.lon)) {
      throw makeAdapterError('PARSE', `OSM node missing/invalid id,lat,lon: ${JSON.stringify(raw)}`);
    }
    return makeInfrastructureNode({
      id: nodeId(raw.id),
      type,
      geom: { type: 'Point' as const, coordinates: [raw.lon, raw.lat] as const },
      status: 'ONLINE', // OSM carries no live status (honest-limitation #2 above)
      sourceId: asId<SourceId>(ctx.sourceRecordId),
    });
  },
};

/** Stable id from the OSM node id (dedup-friendly, matches upstream identity 1:1). */
function nodeId(id: number): InfrastructureNodeId {
  return asId<InfrastructureNodeId>(`osm:node:${id}`);
}

/**
 * tags.name, falling back to `${type}-${id}`. Not yet attached to InfrastructureNode (honest-limitation
 * #3 above) — exported/tested so it's ready the moment the domain entity grows a `name` field.
 */
export function resolveOsmName(raw: OsmOverpassElement, type: InfraNodeType): string {
  const name = raw.tags?.name?.trim();
  return name !== undefined && name.length > 0 ? name : `${type}-${String(raw.id)}`;
}
