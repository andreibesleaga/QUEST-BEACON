// BEACON — COP derivation use-case (E5; FR-3/FR-4/FR-12/FR-13, Art. XII). The deterministic seam that
// turns RAW seeded INPUTS (hazard geometries, candidate lifeline nodes, gauges, wind/weather, readings
// history) into the COMPUTED common-operating-picture outputs the channels surface: exposure rows, the
// first-order prediction cone, the priority ranking, and the escalation trend. Every number here comes from
// the four engines (never the LLM); this module only orchestrates them + grounds the resulting claims.
// Pure application layer: imports PORTS + DOMAIN + sibling use-cases only — NO adapters/framework (F9/§4).
import type { SpatialPort } from '@/ports/index.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import { ok, isErr } from '@/domain/shared/result.js';
import type { InfrastructureNode, InfraNodeType } from '@/domain/infrastructure-node.js';
import type {
  IncidentId,
  InfrastructureNodeId,
  PredictionId,
  RegionId,
  SourceId,
  CitationId,
} from '@/domain/value-objects/ids.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { HazardGeometry } from '@/domain/hazard-geometry.js';
import { exposureBearingHazards } from '@/domain/hazard-geometry.js';
import type { Gauge } from '@/domain/gauge.js';
import type { Shelter } from '@/domain/shelter.js';
import type { PublicReport } from '@/domain/public-report.js';
import type { EvacRoute } from '@/domain/evac-route.js';
import type { Prediction } from '@/domain/prediction.js';
import type { SitRepTrend, RankedPriority } from '@/domain/sitrep.js';
import type { FloodZone } from '@/domain/flood-zone.js';
import type { CameraFeed } from '@/domain/camera-feed.js';
import type { SourceRef } from '@/ports/interaction.js';
import type { WeatherObservation } from '@/ports/data-sources.js';
import { AQI_CATEGORIES } from '@/ports/air-quality.js';
import type { AirQualityPollutant, AirQualityReading, AqiCategory } from '@/ports/air-quality.js';
import type {
  OutageRecord,
  TelecomCoverage,
  PopulationEstimate,
} from '@/ports/infrastructure-sources.js';
import type {
  ExposureSource,
  MapSource,
  OutageArea,
  CellSite,
  WeatherGlyph,
} from '@/application/map-projection/map-projection.js';
import type { GroundedFact } from '@/application/sitrep-synthesis/sitrep-synthesis.js';
import {
  computeExposures,
  type ExposureQuery,
} from '@/application/risk-intersection/risk-intersection.js';
import { bboxToRing } from '@/application/shared/map-geometry.js';
import {
  projectFireCone,
  projectFloodInundation,
  projectFloodZoneImpact,
  type FireConeInput,
  type FloodInundationInput,
} from '@/application/prediction-projection/prediction-projection.js';
import {
  projectEscalation,
  projectImpactOverTime,
  type EscalationInput,
  type ImpactOverTimeInput,
  type TrendProjectionOptions,
} from '@/application/prediction-projection/trend-projection.js';
import {
  gaugeLikelihoodSignal,
  type ForecastLikelihoodInput,
} from '@/application/forecast-likelihood/forecast-likelihood.js';
import {
  rankPriorities,
  type PriorityInput,
  type PriorityScore,
  type PriorityConfig,
  DEFAULT_PRIORITY_CONFIG,
} from '@/application/priority-ranking/priority-ranking.js';
import {
  classifyTrend,
  type TrendSample,
} from '@/application/escalation-trend/escalation-trend.js';
import { DEFAULT_TREND_CONFIG, type TrendConfig } from '@/application/shared/config.js';
import {
  affectedPopulationClaim,
  alertReachClaim,
  computePredictedImpact,
  shelterDemandClaim,
  type AffectedPopulationFigure,
  type ImpactParams,
  type PopulationGrid,
  type PredictedImpactResult,
} from '@/application/impact/index.js';

// ── Shared: exposure (FR-3) ─────────────────────────────────────────────────────────────────────

/**
 * Compute the incident's exposure rows via the risk-intersection engine and pair each with the node it
 * references (the node supplies the plottable geometry the map layer needs). A port error short-circuits.
 */
export function deriveExposures(
  query: ExposureQuery,
  spatial: SpatialPort,
): Result<readonly ExposureSource[], DomainError> {
  const res = computeExposures(query, spatial);
  if (isErr(res)) return res;
  const byId = new Map(query.nodes.map((n) => [String(n.id), n]));
  // Every exposure the engine emits references a node from `query.nodes`, so the lookup always hits.
  const out: ExposureSource[] = res.value.exposures.map((exposure) => ({
    exposure,
    node: byId.get(String(exposure.nodeId))!,
  }));
  return ok(out);
}

// ── Map source derivation (FR-3 exposure + FR-12 prediction) ──────────────────────────────────────

/**
 * Raw projection inputs, discriminated by prediction kind (the engine is chosen by `kind`). All FOUR kinds of
 * `PREDICTION_KINDS` are constructible here — the two trend-derived ones (C2.2, ADR-033 §4.1/§4.2) carry no
 * geometry by design, so they live in `predictions[]` and reach the SitRep/Outlook path while contributing NO
 * map descriptor (finding F-77); `projectMap` skips them exactly as it always skipped a geometry-less
 * prediction.
 */
export type PredictionSpec =
  | ({ readonly kind: 'FIRE_CONE' } & FireConeInput)
  | ({ readonly kind: 'FLOOD_INUNDATION' } & FloodInundationInput)
  | ({ readonly kind: 'ESCALATION' } & EscalationInput)
  | ({ readonly kind: 'IMPACT_OVER_TIME' } & ImpactOverTimeInput);

/** Everything the map read-model needs to COMPUTE a region's MapSource from raw inputs. */
export interface MapDerivationInput {
  readonly regionId: RegionId;
  readonly incidentId: IncidentId;
  readonly incidentType: string;
  readonly hazards: readonly HazardGeometry[];
  readonly gauges: readonly Gauge[];
  readonly infrastructure: readonly InfrastructureNode[]; // candidate lifeline nodes (not pre-classified)
  readonly buffers: Readonly<Record<InfraNodeType, number>>;
  readonly outageNodeIds?: readonly InfrastructureNodeId[];
  /**
   * The region's prediction specs, in the order they should be derived (ADR-033 §3.1 — plural end-to-end).
   * Each spec runs its own engine and yields at most one labeled `Prediction`; a spec that projects nothing
   * contributes nothing. `[]` is legitimate: a region with no forecastable signal simply has no prediction
   * layer (Art. XVI — an absent layer, never a faked one).
   */
  readonly predictions: readonly PredictionSpec[];
  readonly shelters: readonly Shelter[];
  readonly reports: readonly PublicReport[];
  readonly route?: EvacRoute;
  // Phase-D RAW slices (optional; supplied by the seed / live adapters as port DTOs, DERIVED below into the
  // MapSource's honest map-layer slices — AOI polygons, coverage points, wind glyph, NFHL zones):
  readonly outages?: readonly OutageRecord[]; // EAGLE-I / global-equivalent: BBox area + assumed-offline
  readonly cellSites?: readonly TelecomCoverage[]; // OpenCelliD / CAMARA-mock: coverage point + status
  readonly weatherObservation?: WeatherObservation; // Open-Meteo/NWS: the wind glyph observation point
  readonly floodZones?: readonly FloodZone[]; // FEMA NFHL zones (also feed the flood-impact prediction)
  readonly cameras?: readonly CameraFeed[]; // E11 live cameras — link-out pins (no derivation; verbatim slice)
  readonly layerSources?: Readonly<Record<string, string>>;
  readonly provenance: readonly SourceRef[]; // MUST be non-empty (F1)
  readonly freshness?: string;
  readonly computedAt: string; // ISO-8601 — injected deterministic compute instant
}

/**
 * Run the engine the spec's discriminant names. The two geometry-bearing engines are unchanged; the two
 * trend-derived kinds (C2.2) are pure and clock-injected, so they need no port and cannot fail — they return a
 * labeled `null` when their inputs are insufficient, exactly like the cone does.
 */
function derivePrediction(
  spec: PredictionSpec,
  input: MapDerivationInput,
  spatial: SpatialPort,
): Result<Prediction | null, DomainError> {
  if (spec.kind === 'FIRE_CONE') return ok(projectFireCone(spec));
  if (spec.kind === 'ESCALATION') return ok(projectEscalation(spec));
  if (spec.kind === 'IMPACT_OVER_TIME') return ok(projectImpactOverTime(spec));
  return deriveFloodPrediction(spec, input, spatial);
}

/**
 * For a flood, when the raw NFHL flood-zones AND a crest forecast are BOTH present, project the real
 * NFHL∩crest impact geometry (deterministic, pure — makes PRD flagship-3 true); only if that yields no
 * intersection does it fall back to the SpatialPort reach∩NFHL rung (Art. XVI ladder). No zones/no crest ⇒
 * the SpatialPort rung as before.
 */
function deriveFloodPrediction(
  spec: { readonly kind: 'FLOOD_INUNDATION' } & FloodInundationInput,
  input: MapDerivationInput,
  spatial: SpatialPort,
): Result<Prediction | null, DomainError> {
  if (
    input.floodZones !== undefined &&
    input.floodZones.length > 0 &&
    spec.crestForecast !== undefined
  ) {
    const impact = projectFloodZoneImpact({
      id: spec.id,
      incidentId: spec.incidentId,
      floodZones: input.floodZones,
      reach: spec.reach,
      crestForecast: spec.crestForecast,
      floods: spec.floods,
      ...(spec.crestTime !== undefined ? { crestTime: spec.crestTime } : {}),
      ...(spec.sourceId !== undefined ? { sourceId: spec.sourceId } : {}),
    });
    if (impact !== null) return ok(impact);
  }
  return projectFloodInundation(spec, spatial);
}

/**
 * Run every spec's engine IN ORDER and collect the predictions that actually project (ADR-033 §3.1).
 * A spec whose engine yields `null` (no cone, crest that does not flood) contributes nothing — the same
 * "labeled null, never a faked geometry" idiom as the singular path it replaces. The first engine error
 * short-circuits to `Err`, exactly as before, so a SpatialPort failure can never be silently swallowed.
 */
function derivePredictions(
  input: MapDerivationInput,
  spatial: SpatialPort,
): Result<readonly Prediction[], DomainError> {
  const out: Prediction[] = [];
  for (const spec of input.predictions) {
    const res = derivePrediction(spec, input, spatial);
    if (isErr(res)) return res;
    if (res.value !== null) out.push(res.value);
  }
  return ok(out);
}

/**
 * The exposure query for the map read-model. `hazards` is filtered to the IMPACT-bearing kinds only
 * (ADR-032 §3): `STORM_SURGE` participates exactly like `FLOOD_REACH`, while `TRACK`/`CONE` — advisory
 * track-centre geometry — are excluded, because an exposure count computed from a positional-uncertainty
 * envelope is an invented figure (Art. XII). `risk-intersection.ts` stays kind-agnostic (F-18); the decision
 * is made HERE, at the one place the array is assembled. The MAP still receives every hazard, unfiltered.
 */
function exposureQueryOf(input: MapDerivationInput): ExposureQuery {
  return {
    incidentId: input.incidentId,
    hazards: exposureBearingHazards(input.hazards),
    nodes: input.infrastructure,
    buffers: input.buffers,
    computedAt: input.computedAt,
    ...(input.outageNodeIds !== undefined ? { outageNodeIds: input.outageNodeIds } : {}),
  };
}

/**
 * Assemble the DOMAIN-shaped MapSource with COMPUTED exposure + prediction (FR-3/FR-12). The projection
 * shape is unchanged — only its exposure/prediction values are now engine-derived, not hand-seeded.
 */
export function deriveMapSource(
  input: MapDerivationInput,
  spatial: SpatialPort,
): Result<MapSource, DomainError> {
  const exposures = deriveExposures(exposureQueryOf(input), spatial);
  if (isErr(exposures)) return exposures;
  const predRes = derivePredictions(input, spatial);
  if (isErr(predRes)) return predRes;
  return ok({
    regionId: input.regionId,
    incidentType: input.incidentType,
    hazards: input.hazards,
    gauges: input.gauges,
    infrastructure: input.infrastructure,
    exposure: exposures.value,
    shelters: input.shelters,
    reports: input.reports,
    predictions: predRes.value,
    ...(input.route !== undefined ? { route: input.route } : {}),
    ...phaseDSlices(input),
    provenance: input.provenance,
    ...(input.freshness !== undefined ? { freshness: input.freshness } : {}),
  });
}

const KMH_PER_MS = 3.6;

/**
 * Derive an outage AREA from each raw OutageRecord: its county-granular BBox → an AOI rectangle ring, always
 * labelled `assumedOffline` (inference, never a confirmed observation — Art. honest-limitations) and carrying
 * the source timestamp for freshness. Ids are deterministic (index-stable).
 */
function deriveOutageAreas(records: readonly OutageRecord[]): readonly OutageArea[] {
  return records.map((r, i) => ({
    id: `outage-${i}`,
    polygon: [bboxToRing(r.area)],
    assumedOffline: true,
    observedAt: r.observedAt,
    ...(r.customersOut !== undefined ? { customersOut: r.customersOut } : {}),
  }));
}

/** Derive a cell/telecom coverage SITE from each raw TelecomCoverage record (deterministic index-stable ids). */
function deriveCellSites(records: readonly TelecomCoverage[]): readonly CellSite[] {
  return records.map((c, i) => ({
    id: `cell-${i}`,
    position: c.position,
    online: c.online,
    ...(c.technology !== undefined ? { technology: c.technology } : {}),
  }));
}

/**
 * Derive the wind GLYPH from the deterministic weather observation (Art. XII — the numbers ARE the reading,
 * never a synthesized grid). Requires BOTH speed and direction; an observation missing either can't be drawn
 * as a vector, so it yields no glyph (honest omission, not a faked zero).
 */
function deriveWeatherGlyph(obs: WeatherObservation): WeatherGlyph | undefined {
  if (obs.windSpeedMs === undefined || obs.windDirDeg === undefined) return undefined;
  return {
    position: obs.position,
    speedKmh: Math.round(obs.windSpeedMs * KMH_PER_MS),
    directionDeg: obs.windDirDeg,
    observedAt: obs.at,
  };
}

/** DERIVE the honest Phase-D map-layer slices (AOI outages, coverage sites, wind glyph, NFHL zones). */
function phaseDSlices(input: MapDerivationInput): Partial<MapSource> {
  const weather =
    input.weatherObservation !== undefined
      ? deriveWeatherGlyph(input.weatherObservation)
      : undefined;
  return {
    ...(input.outages !== undefined ? { outages: deriveOutageAreas(input.outages) } : {}),
    ...(input.cellSites !== undefined ? { cellSites: deriveCellSites(input.cellSites) } : {}),
    ...(weather !== undefined ? { weather } : {}),
    ...(input.floodZones !== undefined ? { floodZones: input.floodZones } : {}),
    // Cameras need NO derivation — they are link-out pins, sliced verbatim like floodZones (Art. XII).
    ...(input.cameras !== undefined ? { cameras: input.cameras } : {}),
    ...(input.layerSources !== undefined ? { layerSources: input.layerSources } : {}),
  };
}

// ── Incident SitRep facts derivation (FR-3 exposure + FR-4 trend + FR-13 priorities) ──────────────

/** How a computed claim is grounded to a SOURCE_RECORD (F2). The claim text is filled by the engine. */
export interface FactGrounding {
  readonly field: string;
  readonly sourceId: SourceId;
  readonly citationId: CitationId;
}

/** Raw wind/weather input surfaced as a cited fact (the numbers are the seeded input, not the LLM's). */
export interface WeatherFactInput {
  readonly input: {
    readonly speedKmh: number;
    readonly fromLabel: string;
    readonly spreadLabel: string;
  };
  readonly grounding: FactGrounding;
}

/**
 * The gauge/crest reading a cited crest fact states. Only `floodCategory` is required: every other field is
 * a figure some flood sources publish and others do not, so absence is absence rather than a default
 * (Art. XVI — an unserved figure is omitted, never filled in).
 *
 * `readingUnitLabel` is load-bearing, not decoration: `Gauge.stage`/`Gauge.crestForecast` are plain numbers
 * whose unit differs per source (NWPS/USGS publish feet of stage; GloFAS publishes a forecast PEAK DISCHARGE
 * in m³/s — glofas-acl.ts header), and the entity carries no unit. `crestFact` therefore states a stage or a
 * crest ONLY when its unit is stated too — a figure without its unit is not a labeled figure (Art. XII), the
 * same rule `trendSignalLabel` already applies to a slope. The unit is per-ADAPTER config
 * (`config/adapters.json` `gaugeUnit`, ADR-012), never a literal in a use-case.
 */
export interface CrestReading {
  /** The source's flood category, in prose (e.g. 'minor') — the one figure every flood source states. */
  readonly floodCategory: string;
  /** The return-period threshold, when the source publishes one (e.g. '2-year'). No `Gauge` carries it. */
  readonly returnPeriodLabel?: string;
  /** Observed gauge stage, in `readingUnitLabel` units. */
  readonly stage?: number;
  /** Forecast crest (stage or peak discharge, per the source), in `readingUnitLabel` units. */
  readonly crestForecast?: number;
  /** The unit the SOURCE publishes `stage`/`crestForecast` in, verbatim (e.g. 'ft', 'm³/s'). */
  readonly readingUnitLabel?: string;
  /**
   * Source-published forecast crest instant (ISO-8601). Deliberately NOT rendered into the fact's claim: the
   * output-validator's cited-number set is tokenised out of the claim STRINGS, so an embedded timestamp
   * would silently add '2026', '07', '12' … to the numbers a narration is allowed to assert. It travels as
   * evidence and as the C1 lead-time signal instead (`trendPredictions`), neither of which the LLM sees.
   */
  readonly crestTime?: string;
  /**
   * The source's own DERIVED exceedance probability, a dimensionless fraction in [0,1] exactly as published
   * (GloFAS reporting points). BEACON computes no probability and has no wired ensemble source, so this is
   * never a member fraction and never a chance of occurrence (finding F-34, binding).
   */
  readonly exceedanceProbability?: number;
}

/** Raw gauge/crest input surfaced as a cited fact. */
export interface CrestFactInput {
  readonly input: CrestReading;
  readonly grounding: FactGrounding;
}

/**
 * The WINNING AirQuality source's served readings, surfaced as a cited threshold fact (S3 Lane A — the
 * consumer that let the `openaq`/`airnow`/`sensorcommunity` trio register, closing F-52 for P17).
 *
 * Unlike `weather`/`crest` there is NO seeded fact behind this input: the seeds carry no air-quality data,
 * so the field is simply absent offline and the SitRep renders exactly as before. When adapters serve, the
 * fact is emitted ONLY when a reading crosses the fixed alert threshold below — clean air is silence, not a
 * "GOOD" row (degrade silently at the fact level; the consulted slice stays cited in provenance either way).
 */
export interface AirQualityFactInput {
  /** The served readings of the winning (first-serving, precedence-ordered) AirQuality adapter. */
  readonly readings: readonly AirQualityReading[];
  readonly grounding: FactGrounding;
}

/** Everything the core read-model needs to COMPUTE an incident's grounded facts + escalation trend. */
export interface IncidentDerivationInput {
  readonly incidentId: IncidentId;
  readonly hazards: readonly HazardGeometry[];
  readonly infrastructure: readonly InfrastructureNode[];
  readonly buffers: Readonly<Record<InfraNodeType, number>>;
  readonly outageNodeIds?: readonly InfrastructureNodeId[];
  readonly exposedPopulation: number; // seeded planning estimate — the fallback rung (Art. XVI)
  readonly assetLabel: string; // descriptive noun for the exposure claim, e.g. 'electrical substations'
  readonly trendReadings: readonly TrendSample[]; // the escalation signal (acreage / gauge stage over time)
  /**
   * What `trendReadings` MEASURE, in the source's own units (e.g. 'burned area (acres)', 'gauge stage (m)').
   * Optional only because it is additive over existing construction sites; when absent the projections say so
   * rather than implying a unit (Art. XII — a figure without its unit is not a labeled figure).
   */
  readonly trendSignalLabel?: string;
  /**
   * Which source published `trendReadings`. Optional for the same additive reason as `trendSignalLabel`;
   * when present it becomes the trend predictions' `sourceId`, so a projected slope names the source whose
   * readings it was fitted to instead of arriving unattributed (finding F-83).
   */
  readonly trendSourceId?: SourceId;
  readonly grounding: { readonly exposure: FactGrounding; readonly priorities: FactGrounding };
  readonly weather?: WeatherFactInput;
  readonly crest?: CrestFactInput;
  /**
   * Served air-quality readings (P17 trio). Absent ⇒ no fact at all; present ⇒ a fact ONLY when a reading
   * crosses the fixed alert threshold (`airQualityFact`). Never seeded — adapter data or nothing.
   */
  readonly airQuality?: AirQualityFactInput;
  /**
   * Served WorldPop/census AREA totals. Each carries its own `area` — and **that area is now used**.
   *
   * ⚠ Finding F-23 (a live honesty defect, fixed in D1): the pre-D1 `blendPopulation` summed `count` and
   * DISCARDED `area`, so the figure was a whole-region rectangle total while the rendered claim read
   * "residents within the exposed area". These estimates now feed the zonal-sum ladder in
   * `@/application/impact`, which clips the extent against each estimate's area and states which rung served.
   */
  readonly populationEstimates?: readonly PopulationEstimate[];
  /**
   * Which source served `populationEstimates`, in prose, for the claim text (e.g. 'US Census ACS').
   *
   * ⚠ Finding F-66(b): a served census/WorldPop number used to travel with no citation of its own while
   * `grounding.exposure` cited `firms`/`glofas` — a wrong citation on a right number is a provenance failure
   * (the F-64 class). The number's PROVENANCE now rides this label and its CITATION rides
   * `populationGrounding`, whose `sourceId` must name the adapter that actually served (never the hazard
   * source). `grounding.exposure` keeps citing the hazard source for what it really grounds: the
   * asset-intersection claim.
   */
  readonly populationSourceLabel?: string;
  /** R1 rung: a count the population source computed over our EXACT hazard polygon (ADR-035 §1, rung R1). */
  readonly populationPolygonServed?: { readonly count: number; readonly sourceLabel: string };
  /** R2 rung: a parsed, ALREADY INTEGRITY-VERIFIED shipped population grid (verification is the loader's). */
  readonly populationGrid?: PopulationGrid;
  readonly populationGrounding?: FactGrounding;
  /**
   * Cell sites for the predicted alert-reach figure (ADR-035 §1(b)). Absent ⇒ no alert-reach fact at all;
   * `TelecomCoverage.online` is never read (finding F-28 — it is hardcoded `true`, so it is not evidence).
   */
  readonly cellSites?: readonly TelecomCoverage[];
  /** Shelters for the shelter-demand/clearance figure (ADR-035 §1(d)). Absent ⇒ no shelter fact. */
  readonly shelters?: readonly Shelter[];
  /** Already-computed hours of warning time for the clearance feasibility verdict. Absent ⇒ no verdict. */
  readonly leadTimeHours?: number;
  /** Citations for the two additional impact facts. A figure with no citation is not published (F2). */
  readonly impactGrounding?: {
    readonly alertReach?: FactGrounding;
    readonly shelterDemand?: FactGrounding;
  };
  /** Injectable impact parameter set — defaults to the shipped `config/impact-params.json` (ADR-012). */
  readonly impactParams?: ImpactParams;
  readonly computedAt: string;
  readonly priorityConfig?: PriorityConfig;
  readonly trendConfig?: TrendConfig;
}

/** The computed SitRep inputs: grounded facts (F2) + ranked priorities (FR-13) + the escalation trend (FR-4). */
export interface IncidentFactsResult {
  readonly facts: readonly GroundedFact[];
  readonly priorities: readonly RankedPriority[];
  readonly trend: SitRepTrend;
  /**
   * The incident's trend-derived predictions (C2.2; ADR-033 §4.1/§4.2) — `ESCALATION` and
   * `IMPACT_OVER_TIME`, each labeled with method + inputs + uncertainty. Built from the SAME classifier output
   * `trend` above is read from and the SAME exposure/population figure the grounded facts state; nothing is
   * re-derived. Geometry-less by design, so this is the path they reach a reader by (the SitRep/Outlook, not
   * the map layer — finding F-77). `[]` when neither projects: a STEADY trend and a too-short series are both
   * honest answers (Art. XVI).
   */
  readonly predictions: readonly Prediction[];
  /**
   * The predicted-impact quantifications for the incident's CURRENT hazard footprint (ADR-035 §1; MW-D/D1):
   * the clipped population figure that ALWAYS serves, plus the alert-reach and shelter/clearance figures when
   * their inputs were supplied. Returned as figures — each with its own method, inputs and uncertainty — so a
   * panel can render the labels rather than re-deriving anything, and so the number a fact states and the
   * number a badge shows are provably the same number.
   */
  readonly impact: PredictedImpactResult;
}

/** The exposure query behind the grounded facts + ranked priorities — same impact-only filter (ADR-032 §3). */
function incidentExposureQuery(input: IncidentDerivationInput): ExposureQuery {
  return {
    incidentId: input.incidentId,
    hazards: exposureBearingHazards(input.hazards),
    nodes: input.infrastructure,
    buffers: input.buffers,
    computedAt: input.computedAt,
    ...(input.outageNodeIds !== undefined ? { outageNodeIds: input.outageNodeIds } : {}),
  };
}

function exposureFact(
  input: IncidentDerivationInput,
  exposures: readonly ExposureSource[],
): GroundedFact {
  const g = input.grounding.exposure;
  return {
    field: g.field,
    claim: `${exposures.length} ${input.assetLabel} intersect the current hazard footprint (of ${input.infrastructure.length} assessed).`,
    sourceId: g.sourceId,
    citationId: g.citationId,
  };
}

function priorityInputsOf(
  input: IncidentDerivationInput,
  exposures: readonly ExposureSource[],
  population: number,
): readonly PriorityInput[] {
  return exposures.map(({ exposure, node }) => ({
    nodeId: node.id,
    nodeType: node.type,
    insideHazard: exposure.insideHazard,
    bufferM: input.buffers[node.type],
    exposedPopulation: population,
    offline: node.status === 'OFFLINE',
  }));
}

/**
 * Run the predicted-impact quantifications for the incident's CURRENT hazard footprint (ADR-035 §1(c)) —
 * the replacement for the pre-D1 `blendPopulation`, and the fix for finding F-23.
 *
 * WHAT CHANGED, PRECISELY. `blendPopulation` summed every served `PopulationEstimate.count` and discarded
 * `PopulationEstimate.area`, so the figure was a whole-region rectangle total; the claim beside it
 * nevertheless said "residents within the exposed area". The engine now CLIPS: the impact-bearing hazard
 * geometries are intersected with each population cell/area and the count is area-weighted, and every figure
 * reports the rung that served it. When only an unclipped rung can serve, the figure says so and
 * `affectedPopulationClaim` changes the sentence — "region-wide estimate, NOT clipped to the exposed area".
 *
 * The hazard filter is `exposureBearingHazards` (ADR-032 §3), the SAME filter the asset-intersection uses: an
 * advisory `TRACK`/`CONE` positional-uncertainty envelope must not bound a population figure any more than it
 * may bound an exposure count.
 */
function deriveImpact(
  input: IncidentDerivationInput,
  spatial: SpatialPort,
): Result<PredictedImpactResult, DomainError> {
  return computePredictedImpact(
    {
      extentKind: 'CURRENT_HAZARD',
      extentLabel: 'current hazard footprint',
      geometries: exposureBearingHazards(input.hazards).map((h) => h.geometry),
      population: {
        planningSeed: input.exposedPopulation,
        planningSeedLabel: 'seeded planning estimate',
        ...(input.populationPolygonServed !== undefined
          ? { polygonServed: input.populationPolygonServed }
          : {}),
        ...(input.populationGrid !== undefined ? { grid: input.populationGrid } : {}),
        ...(input.populationEstimates !== undefined
          ? {
              areaEstimates: input.populationEstimates.map((e) => ({
                bbox: e.area,
                count: e.count,
              })),
              areaEstimateSourceLabel: input.populationSourceLabel ?? 'served population estimate',
            }
          : {}),
      },
      ...(input.cellSites !== undefined ? { cellSites: input.cellSites } : {}),
      ...(input.shelters !== undefined ? { shelters: input.shelters } : {}),
      ...(input.leadTimeHours !== undefined ? { leadTimeHours: input.leadTimeHours } : {}),
      ...(input.impactParams !== undefined ? { params: input.impactParams } : {}),
    },
    spatial,
  );
}

/**
 * Grounded fact stating the exposed-population figure, its serving source and the method that bounded it.
 *
 * F-66(b): `g.sourceId` is the citation this claim carries, and it must name the source that actually served
 * the figure — never the hazard source, which grounds a different claim (the asset intersection). The claim
 * text additionally NAMES the serving source and the rung in prose, so a mismatch between the cited source
 * and the source the sentence credits is visible to a reader rather than buried in a field.
 */
function populationFact(g: FactGrounding, figure: AffectedPopulationFigure): GroundedFact {
  return {
    field: g.field,
    claim: affectedPopulationClaim(figure, 'CURRENT_HAZARD'),
    sourceId: g.sourceId,
    citationId: g.citationId,
  };
}

/**
 * The two additional impact facts, each emitted ONLY when its figure was computed AND a citation for it was
 * supplied (F2 — a figure with no citation is not published). Order is fixed for reproducibility.
 */
function impactFacts(
  input: IncidentDerivationInput,
  impact: PredictedImpactResult,
): readonly GroundedFact[] {
  const out: GroundedFact[] = [];
  const reach = impact.alertReach;
  const reachGrounding = input.impactGrounding?.alertReach;
  if (reach !== undefined && reachGrounding !== undefined) {
    out.push({
      field: reachGrounding.field,
      claim: alertReachClaim(reach),
      sourceId: reachGrounding.sourceId,
      citationId: reachGrounding.citationId,
    });
  }
  const shelter = impact.shelterDemand;
  const shelterGrounding = input.impactGrounding?.shelterDemand;
  if (shelter !== undefined && shelterGrounding !== undefined) {
    out.push({
      field: shelterGrounding.field,
      claim: shelterDemandClaim(shelter),
      sourceId: shelterGrounding.sourceId,
      citationId: shelterGrounding.citationId,
    });
  }
  return out;
}

function priorityFact(
  input: IncidentDerivationInput,
  topNodeId: InfrastructureNodeId,
  score: number,
): GroundedFact {
  const g = input.grounding.priorities;
  return {
    field: g.field,
    claim: `Highest-priority asset: ${String(topNodeId)} (blended risk score ${score.toFixed(2)}).`,
    sourceId: g.sourceId,
    citationId: g.citationId,
  };
}

/**
 * Project the engine's ranked scores into the SitRep's structured `priorities[]` (SPEC §2.4/§5.2). rank is
 * the deterministic 1-based order; label is the ranked asset id; detail carries the blended risk score.
 * ALL numbers are engine outputs — the LLM never reorders or invents them (Art. XII/F3).
 */
function rankedToPriorities(ranked: readonly PriorityScore[]): readonly RankedPriority[] {
  return ranked.map((r, i) => ({
    rank: i + 1,
    label: String(r.nodeId),
    detail: `blended risk score ${r.score.toFixed(2)}`,
  }));
}

function weatherFact(w: WeatherFactInput): GroundedFact {
  return {
    field: w.grounding.field,
    claim: `Surface winds ${w.input.speedKmh} km/h from the ${w.input.fromLabel}, favouring ${w.input.spreadLabel} spread.`,
    sourceId: w.grounding.sourceId,
    citationId: w.grounding.citationId,
  };
}

/**
 * The crest fact's opening sentence. A source that publishes a return-period threshold gets the original
 * wording verbatim; one that publishes only a category (an observed gauge, not a return-period model) states
 * the category alone rather than inheriting some other source's threshold.
 */
function crestHeadline(r: CrestReading): string {
  return r.returnPeriodLabel !== undefined
    ? `Modelled river discharge exceeds the ${r.returnPeriodLabel} return period (${r.floodCategory} flood category).`
    : `Gauge reports a ${r.floodCategory} flood category.`;
}

/**
 * The served reading's own sentences — each one present only when the source actually published the figure
 * AND (for the two unit-bearing ones) the unit it is published in. The probability is stated with its
 * provenance in the sentence itself: it is the SOURCE's derived number, not a BEACON computation and not an
 * ensemble member fraction (F-34), so the claim cannot be read as a chance of occurrence.
 */
function crestReadingSentences(r: CrestReading): readonly string[] {
  const unit = r.readingUnitLabel;
  const out: string[] = [];
  if (unit !== undefined && r.stage !== undefined) out.push(`Observed stage ${r.stage} ${unit}.`);
  if (unit !== undefined && r.crestForecast !== undefined)
    out.push(`Forecast crest ${r.crestForecast} ${unit}.`);
  if (r.exceedanceProbability !== undefined) {
    out.push(
      `Source-published exceedance probability ${r.exceedanceProbability} (derived by the source; not an ensemble member fraction).`,
    );
  }
  return out;
}

function crestFact(c: CrestFactInput): GroundedFact {
  return {
    field: c.grounding.field,
    claim: [crestHeadline(c.input), ...crestReadingSentences(c.input)].join(' '),
    sourceId: c.grounding.sourceId,
    citationId: c.grounding.citationId,
  };
}

// ── Air-quality threshold fact (S3 Lane A; Art. XII) ───────────────────────────────────────────────
// The threshold table is FIXED IN CODE (the fact-local-constant style of KMH_PER_MS and the crest
// wording tables above — not a new config surface). Two rungs, strictly source-honest:
//   1. A SOURCE-PUBLISHED index (AirNow): the fact states the source's own AQI number + category,
//      verbatim, when that category is at/above UNHEALTHY_SENSITIVE (AQI ≥ 101 on the US EPA table —
//      the threshold the S2 hold specified, docs/audit/UNIMPLEMENTED_REGISTER.md).
//   2. A CONCENTRATION-ONLY source (OpenAQ / Sensor.Community): compared against a fixed PM2.5 µg/m³
//      constant. The claim states the measured value + its verbatim unit + BEACON's threshold — and
//      NEVER an AQI category, because deriving a category from a raw concentration is exactly the
//      invented conversion `ports/air-quality.ts` forbids. A non-µg/m³ unit is never thresholded
//      (no cross-unit conversion), so it can suppress a fact but never fabricate one.

/** The source-published category at/above which rung 1 fires (index comparison on the ordered table). */
const AQI_ALERT_CATEGORY: AqiCategory = 'UNHEALTHY_SENSITIVE';
const AQI_ALERT_INDEX = AQI_CATEGORIES.indexOf(AQI_ALERT_CATEGORY);
/**
 * Rung-2 PM2.5 alert threshold, µg/m³ — 35.5 is where the US EPA 2024-revised PM2.5 breakpoint table
 * enters "Unhealthy for Sensitive Groups" (the same band as AQI 101), i.e. the two rungs fire at the
 * same severity. BEACON's fixed alerting constant, stated as such in the claim — never a derived AQI.
 */
const PM25_ALERT_UGM3 = 35.5;
/** Verbatim-unit spellings (lowercased) accepted as µg/m³ — AirNow 'UG/M3', OpenAQ 'µg/m³', SC 'µg/m³'. */
const UGM3_SPELLINGS: ReadonlySet<string> = new Set([
  'ug/m3',
  'ug/m³',
  'µg/m3',
  'µg/m³',
  'μg/m3',
  'μg/m³',
]);
/** US EPA category names, verbatim from the AirNow "Air Quality 101" table (ports/air-quality.ts). */
const AQI_CATEGORY_LABELS: Readonly<Record<AqiCategory, string>> = {
  GOOD: 'Good',
  MODERATE: 'Moderate',
  UNHEALTHY_SENSITIVE: 'Unhealthy for Sensitive Groups',
  UNHEALTHY: 'Unhealthy',
  VERY_UNHEALTHY: 'Very Unhealthy',
  HAZARDOUS: 'Hazardous',
};
const POLLUTANT_LABELS: Readonly<Record<AirQualityPollutant, string>> = {
  PM25: 'PM2.5',
  PM10: 'PM10',
  O3: 'ozone',
  NO2: 'NO2',
  SO2: 'SO2',
  CO: 'CO',
};

function stationLabel(r: AirQualityReading): string {
  return r.stationName ?? r.stationId;
}

/** Worst reading whose SOURCE-published category is at/above the alert category (rung 1 — AirNow path). */
function worstPublishedIndexReading(
  readings: readonly AirQualityReading[],
): AirQualityReading | undefined {
  let worst: AirQualityReading | undefined;
  for (const r of readings) {
    if (r.aqi === undefined || r.aqiCategory === undefined) continue;
    if (AQI_CATEGORIES.indexOf(r.aqiCategory) < AQI_ALERT_INDEX) continue;
    if (worst === undefined || r.aqi > worst.aqi!) worst = r;
  }
  return worst;
}

/**
 * Worst PM2.5 µg/m³ reading at/above the fixed constant (rung 2 — CONCENTRATION-ONLY readings). A reading
 * that carries a source-published index is deliberately excluded here: if the source's own category says
 * "below alert", BEACON must not overrule it from the raw concentration (their index uses their averaging
 * window; second-guessing it would be a derived judgement, the F-34/Art. XII class).
 */
function worstPm25Reading(readings: readonly AirQualityReading[]): AirQualityReading | undefined {
  let worst: AirQualityReading | undefined;
  for (const r of readings) {
    if (r.aqi !== undefined || r.aqiCategory !== undefined) continue; // index-bearing ⇒ rung 1's, never rung 2's
    if (
      r.pollutant !== 'PM25' ||
      !UGM3_SPELLINGS.has(r.unit.toLowerCase()) ||
      r.value < PM25_ALERT_UGM3
    )
      continue;
    if (worst === undefined || r.value > worst.value) worst = r;
  }
  return worst;
}

/**
 * The air-quality threshold fact, or `undefined` when nothing served crosses the threshold (no fact — clean
 * air is silence, Art. XVI degrade-at-the-fact-level). Rung 1 (a source-published index) wins over rung 2
 * when both are present, because the source's own category is the stronger, more official statement. Every
 * figure in the claim is either the reading verbatim or the fixed constant — never an LLM's (Art. XII).
 */
function airQualityFact(a: AirQualityFactInput | undefined): GroundedFact | undefined {
  if (a === undefined) return undefined; // absent input (nothing served) ⇒ no fact — the guard lives HERE
  const g = a.grounding;
  const indexed = worstPublishedIndexReading(a.readings);
  if (indexed !== undefined) {
    // aqi/aqiCategory are guaranteed present here (worstPublishedIndexReading filters on both).
    const category = AQI_CATEGORY_LABELS[indexed.aqiCategory!];
    return {
      field: g.field,
      claim: `${POLLUTANT_LABELS[indexed.pollutant]} AQI ${indexed.aqi} (${category}) at ${stationLabel(indexed)} — source-published index at or above the ${AQI_CATEGORY_LABELS[AQI_ALERT_CATEGORY]} threshold.`,
      sourceId: g.sourceId,
      citationId: g.citationId,
    };
  }
  const pm = worstPm25Reading(a.readings);
  if (pm === undefined) return undefined;
  return {
    field: g.field,
    claim: `PM2.5 ${pm.value} ${pm.unit} at ${stationLabel(pm)} — at or above BEACON's fixed ${PM25_ALERT_UGM3} µg/m³ fine-particle alert threshold (no source-published AQI; no category derived).`,
    sourceId: g.sourceId,
    citationId: g.citationId,
  };
}

/**
 * The honest label for a trend signal whose units the seed did not state. It says exactly that instead of
 * naming a unit the input never supplied.
 */
const UNSTATED_TREND_SIGNAL_LABEL = 'hazard trend signal (units as published by the source)';

/**
 * The C1 forecast signal an incident's CITED crest fact supports (ADR-033 §2.2, FUW-3; closes finding F-84).
 *
 * The ONLY two things read are the ones a flood source PUBLISHES: its derived exceedance probability
 * (→ `gaugeLikelihoodSignal`, the single sanctioned Gauge→likelihood bridge) and its forecast crest instant
 * (→ the lead time). The flood category, the return period and the trend slope are deliberately NOT read:
 * turning a severity or a direction of travel into a likelihood would be precisely the invented heuristic
 * FUW-3 forbids. No signal and no crest instant ⇒ `undefined`, i.e. no class and no ETA — the honest answer
 * for the three wildfire zones, which have no gauge at all.
 *
 * The clock is `computedAt`, the same injected instant every other figure in this module is computed at.
 */
function crestForecastSignal(input: IncidentDerivationInput): ForecastLikelihoodInput | undefined {
  const reading = input.crest?.input;
  if (reading === undefined) return undefined;
  const signal =
    reading.exceedanceProbability === undefined
      ? undefined
      : gaugeLikelihoodSignal({ exceedanceProbability: reading.exceedanceProbability });
  if (signal === undefined && reading.crestTime === undefined) return undefined;
  return {
    nowMs: Date.parse(input.computedAt),
    ...(signal !== undefined ? { signal } : {}),
    ...(reading.crestTime !== undefined ? { forecastInstant: reading.crestTime } : {}),
  };
}

/**
 * Construct the incident's two trend-derived predictions (C2.2; ADR-033 §4.1/§4.2) from figures that are
 * ALREADY computed: the trend series the SitRep trend is classified from, and the exposure-basis count the
 * grounded population fact states. Ids are deterministic and incident-scoped, so the same incident replayed
 * twice yields byte-identical records. `projectImpactOverTime` gets its clock from `computedAt` — the same
 * injected instant every other figure here is computed at, never `Date.now()`.
 *
 * A `likelihoodClass`/`etaHours` appears on both kinds only when the incident's crest fact carries a
 * SOURCE-published probability or crest instant (`crestForecastSignal`); nothing here derives one from the
 * trend. Both kinds read the SAME signal because both are statements about the same incident — so an
 * incident's Outlook rows agree on the class rather than disagreeing by construction.
 */
function trendPredictions(
  input: IncidentDerivationInput,
  exposedCount: number,
): readonly Prediction[] {
  const opts: TrendProjectionOptions =
    input.trendConfig === undefined ? {} : { trend: input.trendConfig };
  const signalLabel = input.trendSignalLabel ?? UNSTATED_TREND_SIGNAL_LABEL;
  const incidentId = input.incidentId;
  const forecast = crestForecastSignal(input);
  // Labels shared by both kinds: the trend's own source (F-83) and the C1 signal, spread only when present
  // (`exactOptionalPropertyTypes` — an explicit `undefined` is a type error, and absence must be absence).
  const shared = {
    ...(forecast !== undefined ? { forecast } : {}),
    ...(input.trendSourceId !== undefined ? { sourceId: input.trendSourceId } : {}),
  };
  const candidates = [
    projectEscalation(
      {
        id: asId<PredictionId>(`${String(incidentId)}-escalation`),
        incidentId,
        signal: { samples: input.trendReadings },
        signalLabel,
        ...shared,
      },
      opts,
    ),
    projectImpactOverTime(
      {
        id: asId<PredictionId>(`${String(incidentId)}-impact-over-time`),
        incidentId,
        basis: 'exposedPopulation',
        currentCount: exposedCount,
        series: input.trendReadings,
        signalLabel,
        nowMs: Date.parse(input.computedAt),
        ...shared,
      },
      opts,
    ),
  ];
  // A kind that projects nothing is DROPPED without displacing the one that does — same idiom as the map path.
  return candidates.filter((p): p is Prediction => p !== null);
}

/**
 * Compute an incident's grounded SitRep facts + escalation trend from raw inputs (FR-3/FR-4/FR-13). The
 * exposure count, top-priority asset, and trend label are ALL engine outputs — change an input (move a node,
 * add a rising reading) and the output changes. A SpatialPort error short-circuits to Err (never a guess).
 */
export function deriveIncidentFacts(
  input: IncidentDerivationInput,
  spatial: SpatialPort,
): Result<IncidentFactsResult, DomainError> {
  const exposuresRes = deriveExposures(incidentExposureQuery(input), spatial);
  if (isErr(exposuresRes)) return exposuresRes;
  const exposures = exposuresRes.value;

  const impactRes = deriveImpact(input, spatial);
  if (isErr(impactRes)) return impactRes;
  const impact = impactRes.value;
  // The population figure that feeds priority scoring and the IMPACT_OVER_TIME basis is the SUPPRESSION-SAFE
  // count from the ladder, so a small-count figure cannot leak out through a score or a projection either.
  const population = impact.affected.count;
  const facts: GroundedFact[] = [exposureFact(input, exposures)];
  const ranked = rankPriorities(
    priorityInputsOf(input, exposures, population),
    input.priorityConfig ?? DEFAULT_PRIORITY_CONFIG,
  );
  const top = ranked[0];
  if (top !== undefined) facts.push(priorityFact(input, top.nodeId, top.score));
  if (input.populationGrounding !== undefined)
    facts.push(populationFact(input.populationGrounding, impact.affected));
  if (input.weather !== undefined) facts.push(weatherFact(input.weather));
  if (input.crest !== undefined) facts.push(crestFact(input.crest));
  const aqFact = airQualityFact(input.airQuality); // undefined when absent OR below threshold ⇒ no filler row
  if (aqFact !== undefined) facts.push(aqFact);
  facts.push(...impactFacts(input, impact));

  const trend = classifyTrend(
    { samples: input.trendReadings },
    input.trendConfig ?? DEFAULT_TREND_CONFIG,
  ).trend;
  return ok({
    facts,
    priorities: rankedToPriorities(ranked),
    trend,
    predictions: trendPredictions(input, population),
    impact,
  });
}
