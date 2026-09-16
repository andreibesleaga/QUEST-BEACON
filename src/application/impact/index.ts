// BEACON — predicted-impact barrel (MW-D/D1; ADR-035). The four quantifications, their clipping primitive,
// the population-grid artifact and the config-driven parameter set. Pure application layer: PORTS + DOMAIN +
// sibling use-cases only, no adapters/framework (`.dependency-cruiser.cjs:8-10`).
export {
  clipPolygonToRect,
  clipAreaToRect,
  clipAreasToRect,
  hasArealGeometry,
  rectAreaDeg2,
  RECT_OVERLAP_RELATIONS,
  type RectOverlap,
  type RectOverlapRelation,
} from './clip.js';
export { zonalSum, type PopulationCell, type ZonalSum } from './zonal-sum.js';
export {
  canonicalGridBytes,
  parsePopulationGrid,
  populationGridCells,
  populationGridTotal,
  verifyPopulationGridIntegrity,
  type Digest,
  type PopulationGrid,
  type PopulationGridProvenance,
} from './population-grid.js';
export {
  DEFAULT_IMPACT_PARAMS,
  IMPACT_PARAMETER_IDS,
  assumptionsOf,
  parseImpactParams,
  type ImpactAssumption,
  type ImpactParameter,
  type ImpactParameterId,
  type ImpactParams,
} from './impact-params.js';
export {
  POPULATION_METHOD_LABELS,
  POPULATION_RUNGS,
  POPULATION_RUNG_IS_CLIPPED,
  POPULATION_UNCERTAINTY_LABELS,
  estimateAffectedPopulation,
  populationCellsOf,
  type AffectedPopulationFigure,
  type AffectedPopulationInput,
  type PopulationRung,
  type PopulationSourceInput,
} from './affected-population.js';
export {
  ALERT_REACH_CAVEAT,
  ALERT_REACH_METHOD,
  POPULATION_RESOLUTIONS,
  estimateAlertReach,
  type AlertReachFigure,
  type AlertReachInput,
  type PopulationResolution,
} from './alert-reach.js';
export {
  CLEARANCE_UNCERTAINTY,
  SHELTER_DEMAND_METHOD,
  projectShelterDemand,
  type ShelterDemandFigure,
  type ShelterDemandInput,
} from './shelter-demand.js';
export {
  IMPACT_EXTENT_KINDS,
  POPULATION_RUNG_CLAIM_PHRASES,
  affectedPopulationClaim,
  alertReachClaim,
  computePredictedImpact,
  populationResolutionOf,
  shelterDemandClaim,
  type ImpactExtentKind,
  type PredictedImpactInput,
  type PredictedImpactResult,
} from './predicted-impact.js';
