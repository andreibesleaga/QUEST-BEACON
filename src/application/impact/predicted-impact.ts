// BEACON — the composed PREDICTED-IMPACT use-case (MW-D/D1; ADR-035 §1). One entry point that runs the four
// quantifications over ONE extent and returns their figures plus the deterministic CLAIM SENTENCES a
// grounded fact is built from.
//
// WHY THE CLAIMS ARE BUILT HERE AND THE FACTS ARE BUILT IN `derive-cop.ts`. A `GroundedFact` needs a
// `FactGrounding` (field + sourceId + citationId), which is derivation's type; importing it here would create
// an application-layer cycle (`no-circular`, `.dependency-cruiser.cjs:3`). So this module owns the WORDING —
// which is where the honesty lives, because the wording is what a reader believes — and derivation owns the
// attribution. That split is also what lets the claim text CHANGE WITH THE RUNG (finding F-23): a figure that
// could not be clipped says "region-wide estimate", never "within the exposed area".
//
// THE LLM NEVER PRODUCES ANY OF THIS (Art. XII / FUW-5). Every figure and every sentence below is typed
// deterministic code; the narrator receives them as already-computed cited facts, exactly as every other
// engine number does. The structural guarantee is the existing one: this module lives in `src/application/`
// and `.dependency-cruiser.cjs:8-10` forbids that layer from importing the adapters the model sits behind.
//
// AGGREGATE-ONLY (Art. XIV). No signature in this module names `PublicReport`, a person, a household or a
// precise location — the inputs are geometries, aggregate population cells, `TelecomCoverage`, `Shelter`
// capacity totals and config.
import type { Geometry } from '@/domain/value-objects/geo.js';
import type { Shelter } from '@/domain/shelter.js';
import type { Result } from '@/domain/shared/result.js';
import { ok, isErr } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { SpatialPort } from '@/ports/index.js';
import type { TelecomCoverage } from '@/ports/infrastructure-sources.js';
import type { ImpactParams } from './impact-params.js';
import type { PopulationCell } from './zonal-sum.js';
import {
  estimateAffectedPopulation,
  populationCellsOf,
  type AffectedPopulationFigure,
  type PopulationRung,
  type PopulationSourceInput,
} from './affected-population.js';
import {
  estimateAlertReach,
  type AlertReachFigure,
  type PopulationResolution,
} from './alert-reach.js';
import { projectShelterDemand, type ShelterDemandFigure } from './shelter-demand.js';

/** Which extent a figure describes. Drives the claim wording and nothing else. */
export const IMPACT_EXTENT_KINDS = ['CURRENT_HAZARD', 'PREDICTED_EXTENT'] as const;
export type ImpactExtentKind = (typeof IMPACT_EXTENT_KINDS)[number];

export interface PredictedImpactInput {
  readonly extentKind: ImpactExtentKind;
  /** How the extent is described in the published `inputs` (e.g. 'current hazard footprint'). */
  readonly extentLabel: string;
  readonly geometries: readonly Geometry[];
  readonly population: PopulationSourceInput;
  /** Cell sites for (b). Absent ⇒ no alert-reach figure at all, never a zero-loss figure. */
  readonly cellSites?: readonly TelecomCoverage[];
  /** Shelters for (d). Absent ⇒ no shelter figure: there is nothing to compare demand against. */
  readonly shelters?: readonly Shelter[];
  /** Already-computed hours of warning time for (d)'s feasibility verdict. */
  readonly leadTimeHours?: number;
  readonly params?: ImpactParams;
}

export interface PredictedImpactResult {
  readonly affected: AffectedPopulationFigure;
  readonly alertReach?: AlertReachFigure;
  readonly shelterDemand?: ShelterDemandFigure;
}

/**
 * Only a SHIPPED GRID is fine-grained enough to assign residents to individual cell sites. A served
 * region/county area total is one enormous cell, so assigning it to the site nearest its centre would be a
 * fabricated number wearing a method label — `alert-reach.ts` therefore withholds the resident limb unless
 * this returns `CELL_LEVEL` (ADR-035 §1(b) honest-limitation 4).
 */
export function populationResolutionOf(
  rung: PopulationRung,
  cells: readonly PopulationCell[],
): PopulationResolution {
  if (rung === 'SHIPPED_GRID' && cells.length > 0) return 'CELL_LEVEL';
  if (cells.length > 0) return 'AREA_LEVEL';
  return 'NONE';
}

/**
 * Run the quantifications that the supplied inputs actually support, in dependency order: (a)/(c) first
 * because (b) and (d) both consume its count, then (b) when cell sites exist, then (d) when shelters exist.
 *
 * An unsupported quantification is ABSENT from the result rather than present-and-zero (Art. XVI): a missing
 * figure reads as missing, while a zero reads as "no impact", and only one of those is true.
 */
export function computePredictedImpact(
  input: PredictedImpactInput,
  spatial: SpatialPort,
): Result<PredictedImpactResult, DomainError> {
  const affectedRes = estimateAffectedPopulation({
    geometries: input.geometries,
    extentLabel: input.extentLabel,
    population: input.population,
    ...(input.params !== undefined ? { params: input.params } : {}),
  });
  if (isErr(affectedRes)) return affectedRes;
  const affected = affectedRes.value;

  const reach = reachOf(input, affected, spatial);
  if (reach !== null && isErr(reach)) return reach;
  const shelter = shelterOf(input, affected);
  return ok({
    affected,
    ...(reach !== null ? { alertReach: reach.value } : {}),
    ...(shelter !== null ? { shelterDemand: shelter } : {}),
  });
}

/** (b), or `null` when no cell-site input was supplied — an absent figure, never a zero-loss figure. */
function reachOf(
  input: PredictedImpactInput,
  affected: AffectedPopulationFigure,
  spatial: SpatialPort,
): Result<AlertReachFigure, DomainError> | null {
  if (input.cellSites === undefined) return null;
  const cells = populationCellsOf(input.population);
  return estimateAlertReach(
    {
      sites: input.cellSites,
      geometries: input.geometries,
      populationCells: cells,
      populationResolution: populationResolutionOf(affected.rung, cells),
      ...(input.params !== undefined ? { params: input.params } : {}),
    },
    spatial,
  );
}

/**
 * (d), or `null` when no shelters were supplied — there is nothing to compare demand against.
 * `projectShelterDemand` has no failure mode (see its doc comment), so there is no error path to thread here.
 */
function shelterOf(
  input: PredictedImpactInput,
  affected: AffectedPopulationFigure,
): ShelterDemandFigure | null {
  if (input.shelters === undefined) return null;
  return projectShelterDemand({
    affectedCount: affected.count,
    shelters: input.shelters,
    ...(input.leadTimeHours !== undefined ? { leadTimeHours: input.leadTimeHours } : {}),
    ...(input.params !== undefined ? { params: input.params } : {}),
  });
}

// ── The deterministic claim sentences ──────────────────────────────────────────────────────────────────

/** The short rung phrase a claim carries, so a reader sees HOW the figure was bounded inside the sentence. */
export const POPULATION_RUNG_CLAIM_PHRASES: Readonly<Record<PopulationRung, string>> = {
  POLYGON_SOURCE: 'polygon zonal sum computed by the population source',
  SHIPPED_GRID: 'area-weighted zonal sum over the shipped population grid',
  CLIPPED_AREA_ESTIMATE:
    'area-weighted share of the served area total, assuming uniform density within it',
  AREA_TOTAL: 'served area total, not clipped',
  PLANNING_SEED: 'planning estimate, not clipped',
};

/**
 * The population claim — THE SENTENCE FINDING F-23 IS ABOUT.
 *
 * Before D1 this always read "Approximately N residents within the exposed area", while N was an unclipped
 * whole-region sum. Now the sentence is chosen by whether the serving rung could actually clip: a clipped
 * rung keeps "within the exposed area" and states the method that bounded it; an unclipped rung says
 * "region-wide estimate, not clipped to the exposed area" in those words. The claim can no longer over-state
 * what was computed, because the wording is derived from the rung rather than written beside it.
 */
export function affectedPopulationClaim(
  figure: AffectedPopulationFigure,
  kind: ImpactExtentKind,
): string {
  const where = kind === 'CURRENT_HAZARD' ? 'the exposed area' : 'the predicted extent';
  const how = `${figure.populationSource}; ${POPULATION_RUNG_CLAIM_PHRASES[figure.rung]}`;
  return figure.clipped
    ? `Approximately ${figure.displayCount} residents within ${where} (${how}).`
    : `Approximately ${figure.displayCount} residents in the affected region — a region-wide estimate, NOT clipped to ${where} (${how}).`;
}

/**
 * The alert-reach claim. The caveat is part of the SENTENCE, not a tooltip beside it: this figure is the one
 * most likely to be over-read, so "geometric proxy, not an outage prediction" travels wherever the number
 * travels — including into the deterministic-only SitRep summary (ADR-035 V6).
 */
export function alertReachClaim(figure: AlertReachFigure): string {
  if (!figure.siteDataAvailable) {
    return 'No cell-site data is available for this area, so predicted alert reach cannot be assessed — this is an absent figure, not an absence of risk.';
  }
  const head = `${figure.sitesInExtent} of ${figure.sitesTotal} known cell sites fall inside the extent.`;
  const residents =
    figure.residentsLosingCellularReach === undefined
      ? 'Residents losing cellular reach are not quantified: the available population data is too coarse to assign residents to individual sites.'
      : `Approximately ${figure.residentsLosingCellularReach} residents have their nearest known site inside the extent.`;
  const flag = figure.requiresNonCellularDissemination
    ? 'Non-cellular dissemination (sirens / door-to-door) is flagged as required.'
    : 'Non-cellular dissemination is not flagged by the configured thresholds.';
  return `${head} ${residents} ${flag} ${figure.caveat}`;
}

/**
 * The shelter/clearance claim. It names the parameter set in the sentence, because the figure is only as good
 * as the assumptions and every one of them is an operator default rather than a literature value.
 */
export function shelterDemandClaim(figure: ShelterDemandFigure): string {
  const demand = `Predicted shelter demand approximately ${figure.shelterSeeking} people against ${figure.spareCapacity} spare places in ${figure.sheltersConsidered} shelters (deficit ${figure.shelterDeficit}).`;
  const clearance = `Estimated evacuation clearance ${figure.clearanceHours} hours${
    figure.leadTimeHours === undefined
      ? ', with no lead time available so feasibility is not stated'
      : ` against ${figure.leadTimeHours} hours of lead time — ${figure.evacuationFeasible === true ? 'clearance fits the lead time' : 'clearance does NOT fit the lead time'}`
  }.`;
  return `${demand} ${clearance} Parameter set ${figure.parameterSetId}: every value is a BEACON operator default, not a published literature value, and the clearance formulation is linear so the hours are a floor.`;
}
