// BEACON — MAP-PROJECTION use-case (E8·map; SPEC §2.2, Art. XII/XIV). A PURE, deterministic assembly of a
// DOMAIN-shaped map projection (hazard geometries, gauges, infrastructure, exposure, shelters, verified
// reports, first-order prediction cone, evac route) from the seeded read-model. Numbers/geometry come from
// the domain — the client never invents them (Art. XII). Precise report/PII geometry is RESPONDER+ only and
// gated HERE, server-side, keyed on the actor role (Art. XIV). Imports PORTS + DOMAIN only — no adapters/
// framework (enforced by depcruise application-no-adapters + domain purity).
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { AppUserRole } from '@/domain/app-user.js';
import { isResponder } from '@/domain/app-user.js';
import { isLinkOnlyUrl } from '@/domain/shared/link-policy.js';
import type { Position, Geometry } from '@/domain/value-objects/geo.js';
import type { RegionId } from '@/domain/value-objects/ids.js';
import type { HazardGeometry, HazardKind } from '@/domain/hazard-geometry.js';
import type { Gauge, FloodCategory } from '@/domain/gauge.js';
import type { InfrastructureNode, InfraNodeType, InfraNodeStatus } from '@/domain/infrastructure-node.js';
import type { Exposure, ExposureReason } from '@/domain/exposure.js';
import type { Shelter, ShelterStatus } from '@/domain/shelter.js';
import type { PublicReport, PublicReportStatus } from '@/domain/public-report.js';
import type { Prediction } from '@/domain/prediction.js';
import type { EvacRoute } from '@/domain/evac-route.js';
import type { FloodZone } from '@/domain/flood-zone.js';
import type { CameraFeed } from '@/domain/camera-feed.js';
import type { SourceRef } from '@/ports/interaction.js';
import { roundPosition, roundRings, compass8 } from '@/application/shared/map-geometry.js';

// ── DOMAIN-shaped projection output (no frontend types; the app hook maps this → MapData) ─────────

/** A geolocated projected feature. `precisePosition` is present ONLY for RESPONDER+ (Art. XIV). */
export interface ProjectedFeature {
  readonly id: string;
  readonly position: Position;
  readonly precisePosition?: Position;
}

/** A hazard footprint carried through unchanged (the frontend routes it to fire/flood by kind). */
export interface ProjectedHazard {
  readonly id: string;
  readonly kind: HazardKind;
  readonly geometry: Geometry;
  readonly observedAt: string;
  readonly intensity?: number;
}

export interface ProjectedGauge extends ProjectedFeature {
  readonly floodCategory: FloodCategory;
  readonly stage?: number;
}

export interface ProjectedInfra extends ProjectedFeature {
  readonly kind: InfraNodeType;
  readonly status: InfraNodeStatus;
}

export interface ProjectedExposure extends ProjectedFeature {
  readonly reason: ExposureReason;
  readonly insideHazard: boolean;
}

export interface ProjectedShelter extends ProjectedFeature {
  readonly capacity: number;
  readonly demand: number;
  readonly status: ShelterStatus;
}

export interface ProjectedReport extends ProjectedFeature {
  readonly status: PublicReportStatus;
  readonly confidence?: number;
}

export interface ProjectedPrediction {
  readonly id: string;
  readonly geometry: Geometry;
  readonly method: string;
  readonly inputs: string; // labeled first-order (method + inputs + uncertainty, Art. XII)
  readonly uncertainty: string;
}

export interface ProjectedRoute {
  readonly id: string;
  readonly path: readonly Position[];
  readonly avoidsHazard: boolean;
}

/** A power-outage area (EAGLE-I-derived or ASSUMED-offline from hazard∩infra — always labelled honestly). */
export interface ProjectedOutage {
  readonly id: string;
  readonly polygon: readonly (readonly Position[])[]; // polygon rings
  readonly assumedOffline?: boolean; // inference, not observation
  readonly customersOut?: number;
}

/** A cell-coverage site (CELL infrastructure / OpenCelliD / CAMARA-mock). */
export interface ProjectedCell {
  readonly id: string;
  readonly position: Position;
  readonly online?: boolean;
  readonly technology?: string;
}

/** The deterministic wind observation as a map glyph (observation POINT — never synthesized grids, Art. XII). */
export interface ProjectedWeather {
  readonly position: Position;
  readonly speedKmh: number;
  readonly directionDeg: number; // wind FROM bearing, degrees
  /**
   * 8-point compass TOKEN for the direction (`N`,`NE`,…). A closed vocabulary, not prose: the client
   * looks it up in its catalog so the glyph reads in the active language (ADR-030 — server closed
   * vocabularies are localized at the presentation edge, never in the engine).
   */
  readonly compass: string;
  /** ISO-8601 observation time, unformatted — the client renders it in the region's timezone. */
  readonly observedAt: string;
  /**
   * Pre-rendered ENGLISH label. Retained for non-UI consumers (CLI, exports, API clients that want one
   * string) and as the fallback when no translator is supplied. The web UI composes its own label from
   * the structured fields above.
   */
  readonly label: string;
}

/**
 * The STORM family as one wire slice (ADR-032 §4, FR-STORM-2/FEV-5): the cyclone centre TRACK (a line), the
 * agency forecast CONE (a polygon) and the STORM_SURGE impact extent (a polygon).
 *
 * These are INGESTED authoritative agency products (PAGASA/JTWC/NHC-class bulletins) rendered verbatim —
 * BEACON runs no cyclone track, wind or surge model (Art. XIV honesty boundary, ADR-032 §6). `agency` is the
 * provenance `sourceId` of the cone (else the track, else the surge) and `advisoryAt` that geometry's own
 * `observedAt`, so the cone's uncertainty label can name WHO issued it and WHEN — never a BEACON-computed
 * `uncertainty` number, because BEACON computed none.
 */
export interface ProjectedStorm {
  readonly track?: readonly Position[]; // LineString path — cyclone centre positions
  readonly cone?: readonly (readonly Position[])[]; // polygon rings — track-centre uncertainty envelope
  readonly surge?: readonly (readonly Position[])[]; // polygon rings — the impact-bearing kind (exposure input)
  readonly agency?: string; // issuing source's provenance id
  readonly advisoryAt?: string; // ISO-8601 issuance/observation instant of the labelled geometry
}

/** A FEMA-NFHL (or equivalent) regulatory flood-zone polygon (not a live extent — labelled). */
export interface ProjectedFloodZone {
  readonly id: string;
  readonly zone: string;
  readonly polygon: readonly (readonly Position[])[];
}

/** A live camera pin (E11 "Live Views") — link-only: the wire carries only the external https view PAGE url;
 *  no video bytes, role-independent (cameras are public). The client opens `viewUrl` in a new tab (Art. XII). */
export interface ProjectedCamera {
  readonly id: string;
  readonly position: Position;
  readonly kind: string;
  readonly title: string;
  readonly provider: string;
  readonly viewUrl: string;
  readonly isLive: boolean;
}

/** The full DOMAIN-shaped map projection for one region (each slice may be empty — an absent layer is []). */
export interface MapProjection {
  readonly regionId: string;
  readonly incidentType: string;
  readonly hazards: readonly ProjectedHazard[];
  readonly gauges: readonly ProjectedGauge[];
  readonly infrastructure: readonly ProjectedInfra[];
  readonly exposure: readonly ProjectedExposure[];
  readonly shelters: readonly ProjectedShelter[];
  readonly reports: readonly ProjectedReport[];
  /**
   * Every map-plottable prediction, in derivation order (ADR-033 §3.1 — plural end-to-end). Always present;
   * `[]` when the region has none. Each entry keeps its OWN method + inputs + uncertainty, so N predictions
   * render as N separately-labeled cones — never one merged blob whose provenance has been averaged away.
   */
  readonly predictions: readonly ProjectedPrediction[];
  /**
   * @deprecated Use {@link MapProjection.predictions}. Retained as an ADDITIVE-compatibility mirror of
   * `predictions[0]` so a v1 client that never learned the plural field keeps rendering the first cone
   * exactly as before (SPEC-FINAL-VERSION-DELTA §1.1). Omitted when `predictions` is empty, which is
   * byte-identical to the pre-plural behaviour.
   */
  readonly prediction?: ProjectedPrediction;
  readonly route?: ProjectedRoute;
  // Phase-D layers (optional — emitted only when the source supplies them; W2b wires the logic):
  readonly outage?: readonly ProjectedOutage[];
  readonly cell?: readonly ProjectedCell[];
  readonly weather?: ProjectedWeather;
  readonly floodZones?: readonly ProjectedFloodZone[];
  readonly cameras?: readonly ProjectedCamera[];
  /** Storm family (ADR-032) — derived from the TRACK/CONE/STORM_SURGE hazards; absent when the region has none. */
  readonly storm?: ProjectedStorm;
  /** Per-layer source attribution (layer id → provenance sourceId) enabling per-layer freshness badges. */
  readonly layerSources?: Readonly<Record<string, string>>;
}

// ── Read-model source (raw domain entities; adapter-supplied via the composition root) ────────────

/** An exposure paired with the node it references (the node supplies the plottable position + kind). */
export interface ExposureSource {
  readonly exposure: Exposure;
  readonly node: InfrastructureNode;
}

// ── Phase-D DERIVED map-source slices (derive-cop turns raw port DTOs into these; projected below) ──────
// These carry the derivation's honest labels + source timestamps (raw upstream metadata that must NOT reach
// the wire); projectMap strips them down to the anonymous Projected* wire shapes.

/** A derived outage AREA: an AOI polygon (from the source's BBox) with an honest assumed-offline label. */
export interface OutageArea {
  readonly id: string;
  readonly polygon: readonly (readonly Position[])[];
  readonly assumedOffline: boolean; // inference (hazard∩grid / EAGLE-I historical) — never "confirmed"
  readonly observedAt: string; // source timestamp (freshness only — dropped from the wire)
  readonly customersOut?: number;
}

/** A derived cell/telecom coverage SITE (point + online status). */
export interface CellSite {
  readonly id: string;
  readonly position: Position;
  readonly online: boolean;
  readonly technology?: string;
}

/** A derived wind GLYPH: the deterministic observation numbers (never a synthesized grid, Art. XII). */
export interface WeatherGlyph {
  readonly position: Position;
  readonly speedKmh: number;
  readonly directionDeg: number; // wind FROM bearing, degrees
  readonly observedAt: string; // source timestamp (folded into the wire label)
}

/** Everything the projection needs for one region, as raw domain entities + its provenance (F1). */
export interface MapSource {
  readonly regionId: RegionId;
  readonly incidentType: string;
  readonly hazards: readonly HazardGeometry[];
  readonly gauges: readonly Gauge[];
  readonly infrastructure: readonly InfrastructureNode[];
  readonly exposure: readonly ExposureSource[];
  readonly shelters: readonly Shelter[];
  readonly reports: readonly PublicReport[];
  /** Derived predictions in derivation order (ADR-033 §3.1); `[]` when the region has none. */
  readonly predictions: readonly Prediction[];
  readonly route?: EvacRoute;
  // Phase-D DERIVED slices (optional; derive-cop computes these from raw port DTOs, projectMap wires them):
  readonly outages?: readonly OutageArea[];
  readonly cellSites?: readonly CellSite[];
  readonly weather?: WeatherGlyph;
  readonly floodZones?: readonly FloodZone[];
  readonly cameras?: readonly CameraFeed[];
  readonly layerSources?: Readonly<Record<string, string>>;
  readonly provenance: readonly SourceRef[]; // MUST be non-empty (F1)
  readonly freshness?: string;
}

/** The read-model port the projection reads through. Offline: memory-backed; live behind flags. */
export interface MapReadModel {
  sourceFor(regionId: RegionId): Promise<Result<MapSource | null, DomainError>>;
}

// ── Pure projection ───────────────────────────────────────────────────────────────────────────

/** A [lon,lat] position from a Point geometry, else undefined (non-point features are skipped, not faked). */
function pointOf(geom: Geometry): Position | undefined {
  return geom.type === 'Point' ? geom.coordinates : undefined;
}

/** Stringify a prediction's inputs deterministically (labeled first-order — method+inputs+uncertainty). */
function formatInputs(inputs: Readonly<Record<string, unknown>>): string {
  return Object.entries(inputs)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(', ');
}

function projectHazard(h: HazardGeometry): ProjectedHazard {
  return {
    id: String(h.id),
    kind: h.kind,
    geometry: h.geometry,
    observedAt: h.observedAt,
    ...(h.intensity !== undefined ? { intensity: h.intensity } : {}),
  };
}

function projectGauge(g: Gauge): ProjectedGauge {
  return {
    id: String(g.id),
    position: g.geom.coordinates,
    floodCategory: g.floodCategory,
    ...(g.stage !== undefined ? { stage: g.stage } : {}),
  };
}

function projectInfra(node: InfrastructureNode): ProjectedInfra | undefined {
  const position = pointOf(node.geom);
  if (position === undefined) return undefined;
  return { id: String(node.id), position, kind: node.type, status: node.status };
}

function projectExposure(item: ExposureSource): ProjectedExposure | undefined {
  const position = pointOf(item.node.geom);
  if (position === undefined) return undefined;
  return {
    id: String(item.exposure.nodeId),
    position,
    reason: item.exposure.reason,
    insideHazard: item.exposure.insideHazard,
  };
}

function projectShelter(s: Shelter): ProjectedShelter {
  return {
    id: String(s.id),
    position: s.geom.coordinates,
    capacity: s.capacity,
    demand: s.occupancy,
    status: s.status,
  };
}

/** Precise report geometry is revealed ONLY to RESPONDER+ (Art. XIV); PUBLIC sees the generalized position. */
function projectReport(report: PublicReport, precise: boolean): ProjectedReport | undefined {
  const generalized = report.geomGeneralized;
  const position = generalized !== undefined ? pointOf(generalized) : undefined;
  if (position === undefined) return undefined;
  const exact = report.geomPrecise !== undefined ? pointOf(report.geomPrecise) : undefined;
  return {
    id: String(report.id),
    position,
    status: report.status,
    ...(precise && exact !== undefined ? { precisePosition: exact } : {}),
    ...(report.confidence !== undefined ? { confidence: report.confidence } : {}),
  };
}

function projectPrediction(p: Prediction): ProjectedPrediction | undefined {
  if (p.geom === undefined) return undefined;
  return {
    id: String(p.id),
    geometry: p.geom,
    method: p.method,
    inputs: formatInputs(p.inputs),
    uncertainty: `±${Math.round(p.uncertainty * 100)}%`,
  };
}

function projectRoute(r: EvacRoute): ProjectedRoute {
  return { id: String(r.id), path: r.geom.coordinates, avoidsHazard: r.avoidsHazard };
}

// ── Phase-D wire projection (derived source slice → anonymous Projected* — no raw timestamps leak) ──────

/** Outage AREA → wire polygon. Drops the source timestamp (freshness rides on layerSources/provenance). */
function projectOutageArea(o: OutageArea): ProjectedOutage {
  return {
    id: o.id,
    polygon: roundRings(o.polygon),
    assumedOffline: o.assumedOffline,
    ...(o.customersOut !== undefined ? { customersOut: o.customersOut } : {}),
  };
}

function projectCellSite(c: CellSite): ProjectedCell {
  return {
    id: c.id,
    position: roundPosition(c.position),
    online: c.online,
    ...(c.technology !== undefined ? { technology: c.technology } : {}),
  };
}

/** Wind glyph → wire. Builds the human label (with compass + observed-at) so the raw timestamp never leaks alone. */
function projectWeatherGlyph(w: WeatherGlyph): ProjectedWeather {
  return {
    position: roundPosition(w.position),
    speedKmh: w.speedKmh,
    directionDeg: w.directionDeg,
    compass: compass8(w.directionDeg),
    observedAt: w.observedAt,
    label: `Wind ${w.speedKmh} km/h from ${compass8(w.directionDeg)} (${w.directionDeg}°), obs ${w.observedAt}`,
  };
}

/** FEMA-NFHL domain zone → wire polygon (zone code preserved; rounded rings; regulatory-extent caveat is a UI label). */
function projectFloodZone(z: FloodZone): ProjectedFloodZone {
  return { id: z.id, zone: z.zone, polygon: roundRings(z.geom.coordinates) };
}

/** Polygon rings of a Polygon (or the first polygon of a MultiPolygon), else undefined (skipped, not faked). */
function ringsOf(geom: Geometry): readonly (readonly Position[])[] | undefined {
  if (geom.type === 'Polygon') return geom.coordinates;
  if (geom.type === 'MultiPolygon') return geom.coordinates[0];
  return undefined;
}

/** The path of a LineString, else undefined (a non-line TRACK is skipped rather than coerced). */
function lineOf(geom: Geometry): readonly Position[] | undefined {
  return geom.type === 'LineString' ? geom.coordinates : undefined;
}

/**
 * Derive the STORM wire slice from the incident's TRACK/CONE/STORM_SURGE hazards (ADR-032 §4). PURE: the
 * geometry is copied from the ingested agency product verbatim (only wire-rounded) — no track model, no
 * wind field, no surge model, and no BEACON-computed uncertainty figure (ADR-032 §6, Art. XII/XIV).
 *
 * The first hazard of each kind wins: an agency advisory carries one track, one cone and one surge footprint.
 * The attribution (`agency`/`advisoryAt`) is taken from the CONE when present — the cone is the geometry whose
 * uncertainty label must name its issuer — else the track, else the surge. Returns undefined when the region
 * has no storm geometry at all, so the layer is simply absent rather than empty (Art. XVI).
 */
function projectStorm(hazards: readonly HazardGeometry[]): ProjectedStorm | undefined {
  const track = hazards.find((h) => h.kind === 'TRACK');
  const cone = hazards.find((h) => h.kind === 'CONE');
  const surge = hazards.find((h) => h.kind === 'STORM_SURGE');
  const attribution = cone ?? track ?? surge;
  if (attribution === undefined) return undefined;
  const geometry = stormGeometry(track, cone, surge);
  if (Object.keys(geometry).length === 0) return undefined; // nothing plottable — omit, never fake
  return { ...geometry, agency: String(attribution.sourceId), advisoryAt: attribution.observedAt };
}

/**
 * Each storm kind's plottable geometry, wire-rounded. A kind whose geometry type does not match what it must
 * be (a TRACK that is not a line, a CONE/surge that is not a polygon) is OMITTED rather than coerced — the
 * same "skip, don't fake" rule the infra/report projectors already follow.
 */
function stormGeometry(
  track: HazardGeometry | undefined,
  cone: HazardGeometry | undefined,
  surge: HazardGeometry | undefined,
): Pick<ProjectedStorm, 'track' | 'cone' | 'surge'> {
  const path = track !== undefined ? lineOf(track.geometry) : undefined;
  const coneRings = cone !== undefined ? ringsOf(cone.geometry) : undefined;
  const surgeRings = surge !== undefined ? ringsOf(surge.geometry) : undefined;
  return {
    ...(path !== undefined ? { track: path.map((p) => roundPosition(p)) } : {}),
    ...(coneRings !== undefined ? { cone: roundRings(coneRings) } : {}),
    ...(surgeRings !== undefined ? { surge: roundRings(surgeRings) } : {}),
  };
}

/**
 * Live camera → wire pin, VERBATIM (cameras are public installations — role-independent, no PII, so nothing
 * is stripped or generalized). Defends the link-out invariant a second time: a feed whose viewUrl fails the
 * link-only policy is DROPPED rather than emitted (the domain factory already guarantees it; belt-and-
 * suspenders so an unsafe url can never reach an href, ADR-028). Returns undefined for a dropped feed
 * (filtered by `present`).
 *
 * F-153: this was a SEVENTH private copy of the rule (`/^https:\/\//i`) — weaker than the factory it was
 * meant to back up, since it waved through an IP-literal host and any length. It now derives from the one
 * shared policy, so this last-mile guard cannot be weaker than the invariant it double-checks.
 */
function projectCamera(c: CameraFeed): ProjectedCamera | undefined {
  if (!isLinkOnlyUrl(c.viewUrl)) return undefined;
  return {
    id: String(c.id),
    position: c.position,
    kind: c.kind,
    title: c.title,
    provider: c.provider,
    viewUrl: c.viewUrl,
    isLive: c.isLive,
  };
}

/** Drop the undefined skips a `map` can produce (non-point features), keeping the layer type-tight. */
function present<T>(items: readonly (T | undefined)[]): readonly T[] {
  return items.filter((x): x is T => x !== undefined);
}

export interface ProjectMapInput {
  readonly source: MapSource;
  readonly role: AppUserRole;
}

/**
 * The OVERLAY slices of the projection: the Phase-D layers plus the storm family. All carry aggregate/
 * anonymous geometry (no role-gated precision), and each is projected to its wire shape here so no raw
 * upstream field (source timestamps) leaks. `layerSources` passes through for per-layer freshness.
 *
 * Storm geometry is DERIVED from the same `hazards` array the map renders in full — it needs no new
 * `MapSource` field, and carries no exposure implication: the exposure filter lives in the query builder
 * (ADR-032 §3). Split out of `projectMap` so each function stays inside the complexity gate.
 */
function overlaySlices(source: MapSource): Partial<MapProjection> {
  const storm = projectStorm(source.hazards);
  return {
    ...(source.outages !== undefined ? { outage: source.outages.map(projectOutageArea) } : {}),
    ...(source.cellSites !== undefined ? { cell: source.cellSites.map(projectCellSite) } : {}),
    ...(source.weather !== undefined ? { weather: projectWeatherGlyph(source.weather) } : {}),
    ...(source.floodZones !== undefined ? { floodZones: source.floodZones.map(projectFloodZone) } : {}),
    ...(source.cameras !== undefined ? { cameras: present(source.cameras.map(projectCamera)) } : {}),
    ...(storm !== undefined ? { storm } : {}),
    ...(source.layerSources !== undefined ? { layerSources: source.layerSources } : {}),
  };
}

/**
 * Assemble the DOMAIN-shaped MapProjection from the seeded source. PURE + deterministic: no clock, no IO, no
 * client scoring. Precise report geometry is included only when the actor is RESPONDER+ (server-side gate,
 * Art. XIV). An absent optional layer (route) is simply omitted; empty lists (`predictions` included) are
 * preserved.
 */
export function projectMap(input: ProjectMapInput): MapProjection {
  const { source } = input;
  const precise = isResponder(input.role);
  // A prediction with no geometry is not map-plottable and is skipped (never coerced) — the same rule the
  // infra/report projectors follow. `prediction` mirrors the first survivor for v1 clients (see the field doc).
  const predictions = present(source.predictions.map(projectPrediction));
  const first = predictions[0];
  return {
    regionId: String(source.regionId),
    incidentType: source.incidentType,
    hazards: source.hazards.map(projectHazard),
    gauges: source.gauges.map(projectGauge),
    infrastructure: present(source.infrastructure.map(projectInfra)),
    exposure: present(source.exposure.map(projectExposure)),
    shelters: source.shelters.map(projectShelter),
    reports: present(source.reports.map((r) => projectReport(r, precise))),
    predictions,
    ...(first !== undefined ? { prediction: first } : {}),
    ...(source.route !== undefined ? { route: projectRoute(source.route) } : {}),
    ...overlaySlices(source),
  };
}
