// BEACON — incident discovery from live hazard geometry (V3 §3.1). Pure application logic: no IO, no
// clock, no LLM (Art. XII — every figure in a headline below is counted, never narrated).
//
// THE GAP THIS CLOSES, stated plainly. Until now BEACON could show twenty live sources and still put the
// SAME seeded demo wildfire on the map, because live adapters only ever ENRICHED a hand-seeded incident —
// nothing in the system could create one. An operator watching California during a real fire saw live
// hotspots painted as a layer while the incident list, the SitRep and the alert path all still described
// the demo. The COP was live; the *picture* was not.
//
// The hook was already there. Every hazard ACL stamps its geometries with a per-source placeholder
// incident id (`firms-unassigned`, `gdacs-unassigned`, …) precisely because the upstream does not know
// which incident a footprint belongs to. Those are the unclaimed hazards, and this module turns them into
// incidents the rest of the product already knows how to handle.
//
// WHAT IT WILL NOT DO:
//   * invent a hazard — an incident here is a VIEW over geometries a source actually published;
//   * invent a figure — the headline's count is the cluster size and its coordinates are the cluster's
//     own centre, both computed here;
//   * invent an emergency — a single satellite pixel is not a fire, so a hotspot cluster must reach
//     `minHotspots` before it is called anything (an official perimeter or a published flood event needs
//     no such threshold: the publisher has already made that judgement);
//   * flood the board — the result is capped, and ordered so the cap keeps the LARGEST clusters.
import type {
  HazardGeometry,
  HazardKind,
  IncidentId,
  IncidentType,
  SourceId,
} from '@/domain/index.js';
import { asId } from '@/domain/index.js';
import type { BBox, Position } from '@/domain/value-objects/geo.js';

/** One incident BEACON inferred from live geometry, with everything it was inferred from. */
export interface DiscoveredIncident {
  readonly id: IncidentId;
  readonly type: IncidentType;
  readonly headline: string;
  /** The geometries this incident IS — the same objects, never copies with new ids. */
  readonly hazards: readonly HazardGeometry[];
  /** Every source that contributed, in first-seen order — the provenance the incident must carry. */
  readonly sourceIds: readonly SourceId[];
  /** The most recent observation in the cluster: the incident is exactly as fresh as its freshest input. */
  readonly observedAt: string;
  /** Cluster centre [lon, lat] — the map anchor and the coordinates quoted in the headline. */
  readonly center: Position;
}

export interface DiscoveryOptions {
  /** Clustering grid in degrees. Two hotspots in the same cell are one fire. Default 0.25° (~25 km). */
  readonly cellDeg?: number;
  /** How many hotspots make a fire. Default 3 — one or two pixels is a detection, not an incident. */
  readonly minHotspots?: number;
  /** Hard cap per region. Default 5: an operator reads a list, not a database. */
  readonly max?: number;
  /**
   * Namespace for the ids — the region the hazards were fetched for. Two configured regions that overlap
   * (or merely share a grid cell at a border) must not produce the same `discovered:` id, because the
   * composition merges incidents by id and the durable mirror keys on it globally (review, PR #29).
   * Absent ⇒ unscoped ids, for callers that clustered one region's hazards and key them themselves.
   */
  readonly scope?: string;
}

const DEFAULTS = { cellDeg: 0.25, minHotspots: 3, max: 5 } as const;

/**
 * Which hazard kinds can be the BASIS of an incident, and what kind of incident they make.
 *
 * Deliberately narrow. `SPREAD_CONE`, `TRACK` and `CONE` are BEACON's own projections and advisory
 * envelopes — discovering an incident from one would be the system reading its own forecast back as an
 * observation, which is the circularity ADR-032 §3 exists to prevent. `STORM_SURGE` is an impact extent
 * published against an advisory that this product does not yet model as its own incident type.
 */
const TYPE_BY_KIND: Partial<Record<HazardKind, IncidentType>> = {
  HOTSPOT: 'WILDFIRE',
  PERIMETER: 'WILDFIRE',
  FLOOD_REACH: 'FLOOD',
};

/** The kinds an incident can be discovered from — the keys of the table above (ADR-045 reads it too). */
export const INCIDENT_FORMING_KINDS: ReadonlySet<HazardKind> = new Set<HazardKind>(
  Object.keys(TYPE_BY_KIND) as HazardKind[],
);

/** Kinds a publisher has already judged significant — one is enough to be an incident. */
const SELF_SUFFICIENT: ReadonlySet<HazardKind> = new Set<HazardKind>(['PERIMETER', 'FLOOD_REACH']);

/**
 * A hazard nobody has claimed yet.
 *
 * Every hazard ACL uses the same `<source>-unassigned` convention for "the upstream did not say which
 * incident this belongs to" — six sources, six constants, one shape. Matching on the suffix keeps this
 * module from having to import (and stay in step with) all six. The last suite in
 * `discover-incidents.test.ts` reads the ACLs and asserts the convention still holds, rather than asking
 * anyone to trust this comment.
 */
export function isUnassignedIncidentId(id: IncidentId): boolean {
  return String(id).endsWith('-unassigned');
}

/** Representative [lon, lat] for any geometry: a point is itself, anything else is its bbox centre. */
export function representativePoint(geometry: HazardGeometry['geometry']): Position | null {
  const box = boundsOf(geometry.coordinates as unknown);
  if (box === null) return null;
  return [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
}

/** Walk any nesting depth of GeoJSON coordinates and return [west, south, east, north], or null. */
function boundsOf(coordinates: unknown): BBox | null {
  const positions: Position[] = [];
  collect(coordinates, positions);
  if (positions.length === 0) return null;
  let west = positions[0]![0];
  let south = positions[0]![1];
  let east = west;
  let north = south;
  for (const [lon, lat] of positions) {
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return [west, south, east, north];
}

function collect(node: unknown, out: Position[]): void {
  if (!Array.isArray(node)) return;
  if (node.length >= 2 && typeof node[0] === 'number' && typeof node[1] === 'number') {
    if (Number.isFinite(node[0]) && Number.isFinite(node[1])) out.push([node[0], node[1]]);
    return;
  }
  for (const child of node) collect(child, out);
}

interface Cluster {
  readonly type: IncidentType;
  readonly key: string;
  readonly hazards: HazardGeometry[];
  readonly points: Position[];
  significant: boolean;
}

/**
 * Group the unclaimed hazards of one region into incidents.
 *
 * Deterministic end to end: the same inputs in any order produce the same incidents with the same ids,
 * because the grid cell (not an arrival order or a clock) decides membership and the output is sorted.
 * That matters more than it sounds — this runs on every reingest, and an id that moved between runs would
 * make the same fire arrive as a new incident every five minutes.
 */
export function discoverIncidents(
  hazards: readonly HazardGeometry[],
  opts: DiscoveryOptions = {},
): readonly DiscoveredIncident[] {
  const cellDeg = opts.cellDeg ?? DEFAULTS.cellDeg;
  const minHotspots = opts.minHotspots ?? DEFAULTS.minHotspots;
  const max = opts.max ?? DEFAULTS.max;
  const clusters = new Map<string, Cluster>();
  for (const hazard of hazards) addToCluster(clusters, hazard, cellDeg);

  const prefix = opts.scope === undefined ? 'discovered' : `discovered:${opts.scope}`;
  return [...clusters.values()]
    .filter((c) => c.significant || c.hazards.length >= minHotspots)
    .map((c) => toIncident(c, prefix))
    .sort(byWeightThenId)
    .slice(0, max);
}

/** Place one hazard in its cluster, or ignore it — the three reasons to ignore are stated in the header. */
function addToCluster(
  clusters: Map<string, Cluster>,
  hazard: HazardGeometry,
  cellDeg: number,
): void {
  if (!isUnassignedIncidentId(hazard.incidentId)) return; // already belongs to a real incident
  const type = TYPE_BY_KIND[hazard.kind];
  if (type === undefined) return; // not a kind that can found an incident (projections, advisories)
  const point = representativePoint(hazard.geometry);
  if (point === null) return; // no usable coordinates — it cannot be placed, so it is not placed
  const key = `${type}:${cell(point[0], cellDeg)}:${cell(point[1], cellDeg)}`;
  const existing = clusters.get(key);
  const cluster = existing ?? { type, key, hazards: [], points: [], significant: false };
  cluster.hazards.push(hazard);
  cluster.points.push(point);
  if (SELF_SUFFICIENT.has(hazard.kind)) cluster.significant = true;
  if (existing === undefined) clusters.set(key, cluster);
}

/** Snap to the grid. `Math.floor` (not rounding) so a cell's bounds are stable and never straddle. */
function cell(value: number, cellDeg: number): number {
  return Math.floor(value / cellDeg);
}

function toIncident(c: Cluster, prefix: string): DiscoveredIncident {
  const center = meanPoint(c.points);
  const sourceIds = firstSeen(c.hazards.map((h) => h.sourceId));
  const observedAt = c.hazards.reduce(
    (latest, h) => (h.observedAt > latest ? h.observedAt : latest),
    c.hazards[0]!.observedAt,
  );
  return {
    id: asId<IncidentId>(`${prefix}:${c.key}`),
    type: c.type,
    headline: headlineOf(c, center),
    hazards: [...c.hazards].sort((a, b) => String(a.id).localeCompare(String(b.id))),
    sourceIds,
    observedAt,
    center,
  };
}

/**
 * The headline an operator reads in the incident list.
 *
 * Every part of it is derived: the count is `hazards.length`, the place is the cluster's own centre in
 * degrees, and the attribution is the sources that contributed. No adjective, no severity word, no
 * "major" — BEACON has not measured any of those, and a headline is exactly where an unearned adjective
 * would do the most damage.
 */
function headlineOf(c: Cluster, center: Position): string {
  const count = c.hazards.length;
  const what = c.type === 'WILDFIRE' ? describeFire(c, count) : describeFlood(count);
  return `${what} near ${degrees(center[1], 'N', 'S')} ${degrees(center[0], 'E', 'W')}`;
}

function describeFire(c: Cluster, count: number): string {
  const perimeters = c.hazards.filter((h) => h.kind === 'PERIMETER').length;
  if (perimeters > 0) return `Wildfire perimeter${perimeters > 1 ? `s (${perimeters})` : ''}`;
  return `Wildfire — ${count} hotspot${count === 1 ? '' : 's'}`;
}

function describeFlood(count: number): string {
  return `Flood — ${count} reported reach${count === 1 ? '' : 'es'}`;
}

function degrees(value: number, positive: string, negative: string): string {
  return `${Math.abs(value).toFixed(2)}°${value >= 0 ? positive : negative}`;
}

function meanPoint(points: readonly Position[]): Position {
  const lon = points.reduce((sum, p) => sum + p[0], 0) / points.length;
  const lat = points.reduce((sum, p) => sum + p[1], 0) / points.length;
  return [lon, lat];
}

function firstSeen(ids: readonly SourceId[]): readonly SourceId[] {
  const seen = new Set<string>();
  const out: SourceId[] = [];
  for (const id of ids) {
    if (seen.has(String(id))) continue;
    seen.add(String(id));
    out.push(id);
  }
  return out;
}

/** Biggest cluster first; ties broken by id so the order — and therefore the cap — is deterministic. */
function byWeightThenId(a: DiscoveredIncident, b: DiscoveredIncident): number {
  if (b.hazards.length !== a.hazards.length) return b.hazards.length - a.hazards.length;
  return String(a.id).localeCompare(String(b.id));
}
