// BEACON — quantifications (a) PREDICTED-AFFECTED PEOPLE and (c) HAZARD-CLIPPED CURRENT POPULATION
// (MW-D/D1.1 + D1.3; ADR-035 §1(a)/§1(c); FR-PAP-1/FR-PAP-3, FEV-12/FU-15; findings F-23/F-26/F-27).
//
// ONE FUNCTION, TWO CALL SITES. (a) and (c) differ ONLY in the input geometry — a `Prediction.geom` versus
// the current `HazardGeometry` set — so they share one implementation. F-23 is the reason that matters: the
// two figures must not be able to drift apart, because the product shows them side by side.
//
// WHAT F-23 ACTUALLY WAS, and what this file changes. `blendPopulation` (derive-cop.ts, pre-D1) SUMMED every
// served `PopulationEstimate.count` and DISCARDED `PopulationEstimate.area` — no clipping of any kind — while
// the rendered claim read "Approximately N residents within the exposed area". The number was a whole-region
// total; the sentence claimed polygon-precise exposure. That is not an enhancement gap, it is a false claim,
// and FR-PAP-3 is therefore a CORRECTNESS FIX. From here on the figure is either genuinely clipped to the
// extent (and says which method clipped it) or it is labelled REGION-WIDE and the claim text changes with it.
//
// THE LADDER (Art. XVI — never a dead-end, always labelled). Every figure reports the rung that served it,
// because the arithmetic is the same on every rung and the MEANING is not:
//   POLYGON_SOURCE          the population source itself summed its own grid over our exact polygon (R1)
//   SHIPPED_GRID            in-process area-weighted zonal sum over a shipped, integrity-verified grid (R2)
//   CLIPPED_AREA_ESTIMATE   area-weighted share of served AREA totals — uniform density WITHIN each area (R3)
//   AREA_TOTAL              a served total, NOT clipped — the honest name for the pre-D1 behaviour (R4)
//   PLANNING_SEED           the hand-seeded planning estimate, NOT clipped (R5)
// R3 is an addition to ADR-035's four rungs, and it is the rung that fixes F-23 with data BEACON already
// has: `PopulationEstimate` carries the `area` the old code threw away, so clipping the extent against that
// area yields a defensible, clearly-assumption-labelled share instead of a whole-region total wearing a
// polygon-precise sentence. It sits BELOW the shipped grid because uniform density over a region bbox is a
// much stronger assumption than uniform density within a grid cell.
//
// PURE (Art. XII). No clock, no I/O, no randomness, no adapter import; the LLM never touches any of it.
// Coordinates are never rounded (F-98).
import type { Geometry } from '@/domain/value-objects/geo.js';
import type { Result } from '@/domain/shared/result.js';
import { ok, isErr } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import { hasArealGeometry } from './clip.js';
import { zonalSum, type PopulationCell, type ZonalSum } from './zonal-sum.js';
import { populationGridCells, populationGridTotal, type PopulationGrid } from './population-grid.js';
import { DEFAULT_IMPACT_PARAMS, type ImpactParams } from './impact-params.js';

export const POPULATION_RUNGS = [
  'POLYGON_SOURCE',
  'SHIPPED_GRID',
  'CLIPPED_AREA_ESTIMATE',
  'AREA_TOTAL',
  'PLANNING_SEED',
] as const;
export type PopulationRung = (typeof POPULATION_RUNGS)[number];

/** The METHOD label published with a figure from each rung. Exported so tests pin the exact wording. */
export const POPULATION_METHOD_LABELS: Readonly<Record<PopulationRung, string>> = {
  POLYGON_SOURCE:
    'zonal sum computed BY THE POPULATION SOURCE over the exact extent polygon (server-side; gridded modelled residential population)',
  SHIPPED_GRID:
    'area-weighted zonal sum over a shipped, integrity-verified population grid: each grid cell is clipped to the extent (Sutherland–Hodgman) and contributes its count times the clipped area fraction',
  CLIPPED_AREA_ESTIMATE:
    'area-weighted share of served area totals: the extent is clipped to each served estimate area and that area fraction of its total is taken — ASSUMES UNIFORM POPULATION DENSITY WITHIN EACH SERVED AREA',
  AREA_TOTAL:
    'served area total, NOT clipped to the extent — a region-wide figure reported as such because no rung able to clip it was available',
  PLANNING_SEED:
    'hand-seeded planning estimate, NOT clipped to the extent — the fallback rung, reported as such because no population source served',
};

/** Whether a rung's figure is genuinely bounded by the extent. Drives the CLAIM WORDING, not just a badge. */
export const POPULATION_RUNG_IS_CLIPPED: Readonly<Record<PopulationRung, boolean>> = {
  POLYGON_SOURCE: true,
  SHIPPED_GRID: true,
  CLIPPED_AREA_ESTIMATE: true,
  AREA_TOTAL: false,
  PLANNING_SEED: false,
};

/** The uncertainty statement published with a figure from each rung — prose, never a fake numeric interval. */
export const POPULATION_UNCERTAINTY_LABELS: Readonly<Record<PopulationRung, string>> = {
  POLYGON_SOURCE:
    'Dominated by the population product itself: a MODELLED, years-old estimate of RESIDENTIAL population — not present population, not daytime population, not visitors or commuters. BEACON performs no calibration against observed outcomes.',
  SHIPPED_GRID:
    'Three contributions, in order of size: (1) the population product is a MODELLED, years-old RESIDENTIAL estimate; (2) grid resolution — a cell straddling the boundary contributes area-weighted, which assumes uniform population WITHIN the cell; (3) below one cell the figure carries no information. BEACON performs no calibration against observed outcomes.',
  CLIPPED_AREA_ESTIMATE:
    'Dominated by the UNIFORM-DENSITY assumption over each served area, which is much stronger than a grid cell: population is concentrated in settlements, so the share can be badly wrong for a hazard that misses or targets a town. Read as an order-of-magnitude share, not a count. The underlying product is also a MODELLED, years-old RESIDENTIAL estimate.',
  AREA_TOTAL:
    'This figure is NOT bounded by the extent — it is the whole served area. It over-states exposure whenever the extent is smaller than that area, which is almost always. Treat it as an upper bound on the region, not as an exposure figure.',
  PLANNING_SEED:
    'A planning figure entered by hand for exercise purposes. It is not bounded by the extent and it is not sourced from a population product; it exists so the picture never dead-ends (Art. XVI).',
};

/** What the population ladder was offered. Every rung is optional: absence is what makes the ladder fall. */
export interface PopulationSourceInput {
  /**
   * R1 — a count the SOURCE computed over our exact polygon (`PopulationPort.estimatePopulationForPolygon`).
   * `sourceLabel` is the provenance string published with the figure.
   */
  readonly polygonServed?: { readonly count: number; readonly sourceLabel: string };
  /** R2 — a parsed, ALREADY INTEGRITY-VERIFIED grid. This module never verifies: verification is the loader's. */
  readonly grid?: PopulationGrid;
  /** R3/R4 — served area totals (a `PopulationEstimate` is one cell: its `area` plus its `count`). */
  readonly areaEstimates?: readonly PopulationCell[];
  /** Provenance label for the served area totals (e.g. 'US Census ACS' / 'WorldPop'). */
  readonly areaEstimateSourceLabel?: string;
  /** R5 — the seeded planning number. Always present, which is what makes the ladder total. */
  readonly planningSeed: number;
  /** Provenance label for the planning seed. */
  readonly planningSeedLabel?: string;
}

export interface AffectedPopulationInput {
  /** The extent(s) the population is counted inside — a prediction geometry (a) or the hazards (c). */
  readonly geometries: readonly Geometry[];
  /** How the extent is described in the published `inputs` (e.g. 'current hazard footprint'). */
  readonly extentLabel: string;
  readonly population: PopulationSourceInput;
  readonly params?: ImpactParams;
}

/** A quantified population figure, carrying everything a reader needs to judge it (ADR-035 §2). */
export interface AffectedPopulationFigure {
  /**
   * The SUPPRESSION-SAFE figure. Below the disclosure floor this is the FLOOR ITSELF, not the exact small
   * count, so no consumer — renderer, exporter, narrator — can publish a small exact number by reading a
   * different field (ADR-035 §3.3, statistical-disclosure control applied at the use-case boundary).
   */
  readonly count: number;
  /** What every surface renders and exports: either the figure, or a `<N` bucket. */
  readonly displayCount: string;
  readonly suppressed: boolean;
  readonly rung: PopulationRung;
  /** false ⇒ the figure is REGION-WIDE and must NOT be described as being "within the exposed area". */
  readonly clipped: boolean;
  readonly populationSource: string;
  readonly method: string;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly uncertainty: string;
}

const UNKNOWN_SOURCE_LABEL = 'unlabelled population source';
const SEED_SOURCE_LABEL = 'seeded planning estimate';

/** Apply the disclosure floor. A zero stays zero: "nobody in the extent" is not a disclosure risk. */
function suppress(raw: number, floor: number): { count: number; displayCount: string; suppressed: boolean } {
  const rounded = Math.round(raw);
  if (rounded > 0 && rounded < floor) return { count: floor, displayCount: `<${floor}`, suppressed: true };
  return { count: rounded, displayCount: String(rounded), suppressed: false };
}

/** The evidence a zonal-sum rung publishes — the numbers a reader needs to re-derive the figure. */
function sumEvidence(sum: ZonalSum): Readonly<Record<string, unknown>> {
  return {
    cellsConsidered: sum.cellsConsidered,
    cellsContributing: sum.cellsContributing,
    consultedPopulation: Math.round(sum.cellTotal),
    coveredFraction: sum.coveredFraction,
  };
}

interface RungResult {
  readonly rung: PopulationRung;
  readonly raw: number;
  readonly source: string;
  readonly evidence: Readonly<Record<string, unknown>>;
}

/** R1: the source did the zonal sum itself. Only a finite non-negative count counts as served. */
function tryPolygonServed(pop: PopulationSourceInput): RungResult | null {
  const served = pop.polygonServed;
  if (served === undefined || !Number.isFinite(served.count) || served.count < 0) return null;
  return {
    rung: 'POLYGON_SOURCE',
    raw: served.count,
    source: served.sourceLabel,
    evidence: { servedBySourceOverPolygon: true },
  };
}

/**
 * R2/R3: the in-process area-weighted zonal sum. `cellsConsidered === 0` means the extent fell entirely
 * OUTSIDE the supplied cells, so the rung served nothing and the ladder must fall through — reporting 0
 * there would state "nobody lives in the fire" on the strength of a grid that does not cover the fire.
 */
function tryZonalRung(
  cells: readonly PopulationCell[],
  geometries: readonly Geometry[],
  rung: 'SHIPPED_GRID' | 'CLIPPED_AREA_ESTIMATE',
  source: string,
  extra: Readonly<Record<string, unknown>>,
): Result<RungResult | null, DomainError> {
  if (cells.length === 0) return ok(null);
  const sum = zonalSum(cells, geometries);
  if (isErr(sum)) return sum;
  if (sum.value.cellsConsidered === 0) return ok(null);
  return ok({ rung, raw: sum.value.weighted, source, evidence: { ...extra, ...sumEvidence(sum.value) } });
}

/** R4: a served total with no clipping — named honestly rather than presented as exposure. */
function tryAreaTotal(pop: PopulationSourceInput): RungResult | null {
  const estimates = pop.areaEstimates;
  if (estimates === undefined || estimates.length === 0) return null;
  const total = estimates.reduce((acc, c) => (Number.isFinite(c.count) && c.count > 0 ? acc + c.count : acc), 0);
  if (total <= 0) return null;
  return {
    rung: 'AREA_TOTAL',
    raw: total,
    source: pop.areaEstimateSourceLabel ?? UNKNOWN_SOURCE_LABEL,
    evidence: { areasSummed: estimates.length, clippedToExtent: false },
  };
}

/** R5: the seed. Always available — this is the rung that makes the ladder total (Art. XVI). */
function seedRung(pop: PopulationSourceInput): RungResult {
  const seed = Number.isFinite(pop.planningSeed) && pop.planningSeed > 0 ? pop.planningSeed : 0;
  return {
    rung: 'PLANNING_SEED',
    raw: seed,
    source: pop.planningSeedLabel ?? SEED_SOURCE_LABEL,
    evidence: { clippedToExtent: false },
  };
}

/** R2: the shipped grid rung, with the grid's own provenance published as the figure's evidence. */
function tryGridRung(
  grid: PopulationGrid,
  geoms: readonly Geometry[],
): Result<RungResult | null, DomainError> {
  return tryZonalRung(populationGridCells(grid), geoms, 'SHIPPED_GRID', `${grid.provenance.product} (${grid.id})`, {
    gridId: grid.id,
    gridVintage: grid.provenance.vintage,
    gridResolution: grid.provenance.resolutionLabel,
    gridDisaggregation: grid.provenance.disaggregation,
    gridTotalPopulation: Math.round(populationGridTotal(grid)),
  });
}

/** The two clipping rungs, in precedence order. `null` ⇒ neither could serve, so the ladder falls further. */
function tryClippingRungs(
  pop: PopulationSourceInput,
  geoms: readonly Geometry[],
): Result<RungResult | null, DomainError> {
  if (geoms.length === 0) return ok(null);
  if (pop.grid !== undefined) {
    const res = tryGridRung(pop.grid, geoms);
    if (isErr(res) || res.value !== null) return res;
  }
  if (pop.areaEstimates !== undefined) {
    return tryZonalRung(
      pop.areaEstimates,
      geoms,
      'CLIPPED_AREA_ESTIMATE',
      pop.areaEstimateSourceLabel ?? UNKNOWN_SOURCE_LABEL,
      { uniformDensityAssumedWithinEachArea: true },
    );
  }
  return ok(null);
}

/** Walk the ladder in precedence order, stopping at the first rung that actually served. */
function serveRung(input: AffectedPopulationInput): Result<RungResult, DomainError> {
  const pop = input.population;
  const served = tryPolygonServed(pop);
  if (served !== null) return ok(served);
  const clipped = tryClippingRungs(pop, input.geometries.filter(hasArealGeometry));
  if (isErr(clipped)) return clipped;
  if (clipped.value !== null) return ok(clipped.value);
  return ok(tryAreaTotal(pop) ?? seedRung(pop));
}

/**
 * The aggregate cells a population source offers, grid first — the input the alert-reach assignment needs.
 * Returns `[]` when only an unclipped total or the planning seed is available, which is exactly the case in
 * which a per-site resident assignment must NOT be attempted.
 */
export function populationCellsOf(pop: PopulationSourceInput): readonly PopulationCell[] {
  if (pop.grid !== undefined) return populationGridCells(pop.grid);
  return pop.areaEstimates ?? [];
}

/**
 * Quantify the population inside an extent (ADR-035 §1(a) and §1(c)).
 *
 * Deterministic and reproducible: the ladder is walked in a fixed order, the zonal sum accumulates in the
 * caller's cell order, and no clock or random source is read. Identical inputs give a bit-identical figure
 * (acceptance test 5, ADR-035 §2).
 */
export function estimateAffectedPopulation(
  input: AffectedPopulationInput,
): Result<AffectedPopulationFigure, DomainError> {
  const params = input.params ?? DEFAULT_IMPACT_PARAMS;
  const rung = serveRung(input);
  if (isErr(rung)) return rung;
  const { rung: served, raw, source, evidence } = rung.value;
  const floor = params.parameters.minReportableCount.value;
  const { count, displayCount, suppressed } = suppress(raw, floor);
  return ok({
    count,
    displayCount,
    suppressed,
    rung: served,
    clipped: POPULATION_RUNG_IS_CLIPPED[served],
    populationSource: source,
    method: POPULATION_METHOD_LABELS[served],
    inputs: {
      extent: input.extentLabel,
      extentGeometries: input.geometries.length,
      arealExtentGeometries: input.geometries.filter(hasArealGeometry).length,
      populationRung: served,
      populationSource: source,
      minReportableCount: floor,
      parameterSetId: params.parameterSetId,
      ...evidence,
    },
    uncertainty: POPULATION_UNCERTAINTY_LABELS[served],
  });
}
