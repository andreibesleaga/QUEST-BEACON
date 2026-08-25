// BEACON test harness — golden-dataset loader (TEST_PLAN §4; E9·T-400/T-401a). Reads a region scenario
// JSON from tests/fixtures/<slug>/scenario.json and builds it into validated domain entities via the
// REAL domain factories — so a malformed fixture fails loudly (the factories are the authority) and every
// consumer (redundancy suites, e2e, fake sources) shares one deterministic dataset per demo region.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeRegion, type Region, type RegionScope } from '@/domain/region.js';
import { makeIncident, type Incident, type IncidentType, type IncidentStatus } from '@/domain/incident.js';
import { makeSourceRecord, type SourceRecord } from '@/domain/source-record.js';
import { makeHazardGeometry, type HazardGeometry, type HazardKind } from '@/domain/hazard-geometry.js';
import { makeGauge, type Gauge, type FloodCategory } from '@/domain/gauge.js';
import {
  makeInfrastructureNode,
  type InfrastructureNode,
  type InfraNodeType,
  type InfraNodeStatus,
} from '@/domain/infrastructure-node.js';
import { makeExposure, type Exposure, type ExposureReason } from '@/domain/exposure.js';
import {
  makePublicReport,
  type PublicReport,
  type PublicReportSource,
  type PublicReportStatus,
  type ConfidenceComponents,
} from '@/domain/public-report.js';
import type { SourceMode } from '@/domain/source-record.js';
import type { BBox, Geometry, Position } from '@/domain/value-objects/geo.js';
import {
  regionId,
  incidentId,
  sourceId,
  hazardGeometryId,
  gaugeId,
  infrastructureNodeId,
  publicReportId,
} from '../builders/ids.js';

// ---- raw fixture shape (every optional populated so the loader stays branch-free) --------------------
interface RawSource {
  id: string;
  source: string;
  adapter: string;
  fetchedAt: string;
  license: string;
  mode: SourceMode;
}
interface RawHazard {
  id: string;
  kind: HazardKind;
  sourceId: string;
  observedAt: string;
  intensity: number;
  geometry: Geometry;
}
interface RawGauge {
  id: string;
  lon: number;
  lat: number;
  floodCategory: FloodCategory;
  stage: number;
  crestForecast: number;
  crestTime: string;
  sourceId: string;
}
interface RawInfra {
  id: string;
  type: InfraNodeType;
  lon: number;
  lat: number;
  status: InfraNodeStatus;
  sourceId: string;
}
interface RawReport {
  id: string;
  source: PublicReportSource;
  status: PublicReportStatus;
  confidence: number;
  components: ConfidenceComponents;
  generalized: Position;
  precise: Position;
  purgeAfter: string;
}
interface RawExposure {
  nodeId: string;
  reason: ExposureReason;
  insideHazard: boolean;
  distanceM: number;
}
interface RawScenario {
  regionId: string;
  regionName: string;
  scope: RegionScope;
  bbox: BBox;
  enabledAdapters: string[];
  mode: SourceMode;
  incident: { id: string; type: IncidentType; status: IncidentStatus };
  sources: RawSource[];
  hazards: RawHazard[];
  gauges: RawGauge[];
  infrastructure: RawInfra[];
  report: RawReport;
  expectedExposures: RawExposure[];
}

export interface LoadedScenario {
  readonly slug: string;
  readonly mode: SourceMode;
  readonly region: Region;
  readonly incident: Incident;
  readonly sources: readonly SourceRecord[];
  readonly hazards: readonly HazardGeometry[];
  readonly gauges: readonly Gauge[];
  readonly infrastructure: readonly InfrastructureNode[];
  readonly report: PublicReport;
  readonly expectedExposures: readonly Exposure[];
}

export const SCENARIO_SLUGS = ['california-wildfire', 'romania-flood'] as const;
export type ScenarioSlug = (typeof SCENARIO_SLUGS)[number];

function readScenario(slug: ScenarioSlug): RawScenario {
  const url = new URL(`../../fixtures/${slug}/scenario.json`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as RawScenario;
}

function toSource(s: RawSource): SourceRecord {
  return makeSourceRecord({ ...s, id: sourceId(s.id) });
}

function toHazard(h: RawHazard, incId: string): HazardGeometry {
  return makeHazardGeometry({
    id: hazardGeometryId(h.id),
    incidentId: incidentId(incId),
    sourceId: sourceId(h.sourceId),
    kind: h.kind,
    geometry: h.geometry,
    observedAt: h.observedAt,
    intensity: h.intensity,
  });
}

function toGauge(g: RawGauge): Gauge {
  return makeGauge({
    id: gaugeId(g.id),
    geom: { type: 'Point', coordinates: [g.lon, g.lat] },
    floodCategory: g.floodCategory,
    stage: g.stage,
    crestForecast: g.crestForecast,
    crestTime: g.crestTime,
    sourceId: sourceId(g.sourceId),
  });
}

function toInfra(n: RawInfra): InfrastructureNode {
  return makeInfrastructureNode({
    id: infrastructureNodeId(n.id),
    type: n.type,
    geom: { type: 'Point', coordinates: [n.lon, n.lat] },
    status: n.status,
    sourceId: sourceId(n.sourceId),
  });
}

function toReport(r: RawReport, incId: string): PublicReport {
  return makePublicReport({
    id: publicReportId(r.id),
    incidentId: incidentId(incId),
    source: r.source,
    status: r.status,
    confidence: r.confidence,
    confidenceComponents: r.components,
    geomGeneralized: { type: 'Point', coordinates: r.generalized },
    geomPrecise: { type: 'Point', coordinates: r.precise },
    consent: true,
    purgeAfter: r.purgeAfter,
  });
}

function toExposure(e: RawExposure, incId: string): Exposure {
  return makeExposure({
    incidentId: incidentId(incId),
    nodeId: infrastructureNodeId(e.nodeId),
    reason: e.reason,
    insideHazard: e.insideHazard,
    computedAt: '2026-06-15T12:05:00.000Z',
    distanceM: e.distanceM,
  });
}

/** Load one demo region's golden dataset into validated domain entities. */
export function loadScenario(slug: ScenarioSlug): LoadedScenario {
  const raw = readScenario(slug);
  const incId = raw.incident.id;
  return {
    slug,
    mode: raw.mode,
    region: makeRegion({
      id: regionId(raw.regionId),
      name: raw.regionName,
      scope: raw.scope,
      bbox: raw.bbox,
      enabledAdapters: raw.enabledAdapters,
    }),
    incident: makeIncident({
      id: incidentId(incId),
      regionId: regionId(raw.regionId),
      type: raw.incident.type,
      status: raw.incident.status,
    }),
    sources: raw.sources.map(toSource),
    hazards: raw.hazards.map((h) => toHazard(h, incId)),
    gauges: raw.gauges.map(toGauge),
    infrastructure: raw.infrastructure.map(toInfra),
    report: toReport(raw.report, incId),
    expectedExposures: raw.expectedExposures.map((e) => toExposure(e, incId)),
  };
}

export const loadCaliforniaWildfire = (): LoadedScenario => loadScenario('california-wildfire');
export const loadRomaniaFlood = (): LoadedScenario => loadScenario('romania-flood');
