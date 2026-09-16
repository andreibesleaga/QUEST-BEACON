// BEACON — quantification (b) PREDICTED COMMS BLACKOUT / ALERT REACH (MW-D/D1.3; ADR-035 §1(b);
// FR-PAP-2 / FEV-13; finding F-28). This is the differentiator, and it is therefore the figure that carries
// the heaviest caveat load in the product.
//
// ⚠⚠ WHAT THIS FIGURE IS — read before changing anything here. It is a GEOMETRIC statement: which of the
// cell sites BEACON knows about fall inside a hazard/prediction footprint. It is NOT:
//   • NOT an outage prediction, and it CANNOT become one. `TelecomCoverage.online` is hardcoded `true` at the
//     ACL (`src/adapters/sources/opencellid/opencellid-acl.ts:82-86`, finding F-28), so BEACON provably does
//     not know any site's real state. Nothing in this module reads `online`, deliberately: a figure built on
//     a constant would be fabricated (Art. XII). See the test that pins that.
//   • NOT an RF propagation model — no terrain, no antenna pattern, no sector orientation, no frequency, no
//     link budget.
//   • NOT per-operator coverage truth — OpenCelliD is a crowdsourced, unevenly complete, mixed-vintage
//     observation database, not an operator's coverage map. `sitesInExtent` is a LOWER BOUND on sites.
//   • NOT a network model — no backhaul, no core, no capacity, no roaming, no generator runtime.
//   • NOT a substitute for the operator's or the regulator's own status reporting.
// Its value is triage: it tells an EM WHERE PHONE-BASED WARNING IS THE WRONG PLAN. `ALERT_REACH_CAVEAT` below
// travels with every figure and every fact this module produces, and a test asserts it is never dropped.
//
// PURE (Art. XII). The point-in-polygon test goes through the injected `SpatialPort` — the seam ADR-035 §1(b)
// names, and the intersection finding F-28/F9 says has never been performed. No clock, no I/O, no randomness;
// a port error short-circuits to `Err` rather than degrading into a guess. Coordinates are never rounded (F-98).
import type { Geometry, Position } from '@/domain/value-objects/geo.js';
import type { Result } from '@/domain/shared/result.js';
import { ok, isErr } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { SpatialPort } from '@/ports/index.js';
import type { TelecomCoverage } from '@/ports/infrastructure-sources.js';
import { haversineMeters, polygonsOf } from '@/application/shared/geo.js';
import type { PopulationCell } from './zonal-sum.js';
import { DEFAULT_IMPACT_PARAMS, type ImpactParams } from './impact-params.js';

/** The sentence that must accompany every alert-reach figure, everywhere it is rendered or exported. */
export const ALERT_REACH_CAVEAT =
  'Geometric proxy, not an outage prediction: this counts known cell sites inside the predicted footprint. ' +
  'BEACON has no signal of any site’s real state (the source reports every site as online), no RF ' +
  'propagation model and no per-operator coverage truth, so the site count is a lower bound and says nothing ' +
  'about whether a site will fail.';

export const ALERT_REACH_METHOD =
  'sites inside the extent by point-in-polygon (SpatialPort), then nearest-site assignment of population ' +
  'cells within a maximum radius — a coverage PROXY, not coverage';

/**
 * How good the population input is for a per-site assignment. Load-bearing, not decoration: nearest-site
 * assignment over a single region-sized area would assign an entire region to whichever site happens to sit
 * nearest that region's centre, which is a fabricated number wearing a method label. Resident figures are
 * therefore computed ONLY for `CELL_LEVEL` input.
 */
export const POPULATION_RESOLUTIONS = ['CELL_LEVEL', 'AREA_LEVEL', 'NONE'] as const;
export type PopulationResolution = (typeof POPULATION_RESOLUTIONS)[number];

export interface AlertReachInput {
  /** Cell sites as the telecom port serves them. `online` is never read (F-28). */
  readonly sites: readonly TelecomCoverage[];
  /** The extent(s) whose interior sites are counted in — a prediction geometry or the current hazards. */
  readonly geometries: readonly Geometry[];
  /** Aggregate population cells for the resident limb. Ignored unless `populationResolution` is CELL_LEVEL. */
  readonly populationCells?: readonly PopulationCell[];
  readonly populationResolution: PopulationResolution;
  readonly params?: ImpactParams;
}

export interface AlertReachFigure {
  /** Sites BEACON knows about in the queried area. Zero ⇒ no cell-site data, never a silent zero loss. */
  readonly sitesTotal: number;
  /** Sites whose position falls inside the extent. A GEOMETRIC count (see the file header). */
  readonly sitesInExtent: number;
  /** `sitesInExtent / sitesTotal`, or 0 when there is no site data. */
  readonly siteLossFraction: number;
  /**
   * Residents whose NEAREST known site is inside the extent. `undefined` — never 0 — when the population
   * input is too coarse for a per-site assignment, so an absent figure can never be mistaken for "nobody".
   */
  readonly residentsLosingCellularReach?: number;
  /**
   * Residents with NO known site inside the assignment radius. They are already outside BEACON's view of
   * cellular reach and are reported separately so they are never double-counted as reach lost to this hazard.
   */
  readonly residentsAlreadyUnserved?: number;
  /** Triage flag: phone-based warning alone is not a sufficient plan for this extent. */
  readonly requiresNonCellularDissemination: boolean;
  readonly siteDataAvailable: boolean;
  readonly populationResolution: PopulationResolution;
  readonly method: string;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly uncertainty: string;
  /** `ALERT_REACH_CAVEAT` — carried on the figure so no surface can render the number without it. */
  readonly caveat: string;
}

const ALERT_REACH_UNCERTAINTY =
  'Dominated by SOURCE COMPLETENESS, not by arithmetic, so no numeric interval is offered: OpenCelliD is ' +
  'crowdsourced and unevenly complete by country and operator, which makes the site count a lower bound with ' +
  'an unknown direction of error for the resident figure. Nearest-site assignment is a proxy — real coverage ' +
  'depends on terrain, antenna pattern, sector orientation, frequency and capacity, none of which BEACON has, ' +
  'so residents assigned to a site inside the extent may keep service from a site outside it and vice versa.';

const METRES_PER_KM = 1000;

/** The centre of a population cell — the assignment probe. Never rounded (F-98). */
function cellCentre(cell: PopulationCell): Position {
  const [minLon, minLat, maxLon, maxLat] = cell.bbox;
  return [(minLon + maxLon) / 2, (minLat + maxLat) / 2];
}

/** Whether a position falls inside ANY of the extent's polygons, via the sanctioned SpatialPort seam. */
function insideExtent(
  point: Position,
  polygons: readonly ReturnType<typeof polygonsOf>[number][],
  spatial: SpatialPort,
): Result<boolean, DomainError> {
  for (const polygon of polygons) {
    const res = spatial.pointInPolygon(point, polygon);
    if (isErr(res)) return res;
    if (res.value) return ok(true);
  }
  return ok(false);
}

interface SiteSplit {
  readonly inExtent: readonly Position[];
  readonly outsideExtent: readonly Position[];
}

/** Split every known site into inside/outside the extent — the one intersection F-28/F9 says never happened. */
function splitSites(input: AlertReachInput, spatial: SpatialPort): Result<SiteSplit, DomainError> {
  const polygons = input.geometries.flatMap((g) => polygonsOf(g));
  const inExtent: Position[] = [];
  const outsideExtent: Position[] = [];
  for (const site of input.sites) {
    const position: Position = site.position;
    const res = insideExtent(position, polygons, spatial);
    if (isErr(res)) return res;
    (res.value ? inExtent : outsideExtent).push(position);
  }
  return ok({ inExtent, outsideExtent });
}

/** Index of the nearest position and its distance in metres; `null` when there are no candidates. */
function nearest(point: Position, candidates: readonly Position[]): number | null {
  let best: number | null = null;
  for (const c of candidates) {
    const d = haversineMeters(point, c);
    if (best === null || d < best) best = d;
  }
  return best;
}

interface ResidentSplit {
  readonly losing: number;
  readonly alreadyUnserved: number;
  readonly cellsAssigned: number;
}

/**
 * Assign every population cell to its NEAREST known site and tally.
 *
 * A cell whose nearest site of ANY kind is farther than `maxAssignmentRadiusKm` is counted as
 * `alreadyUnserved` — outside BEACON's view of cellular reach before this hazard — and never as reach the
 * hazard took away. Otherwise the cell is attributed to whichever side its nearest site is on. The two
 * tallies are disjoint by construction, which is exactly what ADR-035 V5 requires.
 */
function assignResidents(
  cells: readonly PopulationCell[],
  split: SiteSplit,
  radiusM: number,
): ResidentSplit {
  let losing = 0;
  let alreadyUnserved = 0;
  let cellsAssigned = 0;
  for (const cell of cells) {
    if (!Number.isFinite(cell.count) || cell.count <= 0) continue;
    const centre = cellCentre(cell);
    const dIn = nearest(centre, split.inExtent);
    const dOut = nearest(centre, split.outsideExtent);
    const best = dIn === null ? dOut : dOut === null ? dIn : Math.min(dIn, dOut);
    if (best === null || best > radiusM) {
      alreadyUnserved += cell.count;
      continue;
    }
    cellsAssigned += 1;
    if (dIn !== null && dIn === best) losing += cell.count;
  }
  return { losing, alreadyUnserved, cellsAssigned };
}

/**
 * Quantify predicted alert reach for an extent (ADR-035 §1(b)).
 *
 * Two limbs raise `requiresNonCellularDissemination`, and either is enough: the resident figure crossing
 * `minResidentsForSirenFlag`, or the SITE-LOSS FRACTION crossing `minSiteLossFraction`. The second limb is why
 * the flag still works where BEACON has no cell-level population — the geometric statement stands on its own.
 * With NO site data at all the flag is false and `siteDataAvailable` says why: an absent input must read as
 * absent, never as "no risk" (Art. XVI).
 */
export function estimateAlertReach(
  input: AlertReachInput,
  spatial: SpatialPort,
): Result<AlertReachFigure, DomainError> {
  const params = input.params ?? DEFAULT_IMPACT_PARAMS;
  const p = params.parameters;
  const radiusKm = p.maxAssignmentRadiusKm.value;
  const splitRes = splitSites(input, spatial);
  if (isErr(splitRes)) return splitRes;
  const split = splitRes.value;
  const sitesTotal = input.sites.length;
  const sitesInExtent = split.inExtent.length;
  const siteLossFraction = sitesTotal > 0 ? sitesInExtent / sitesTotal : 0;
  const residents = residentSplitOf(input, split, radiusKm * METRES_PER_KM);
  const losing = residents === null ? undefined : Math.round(residents.losing);
  const flag = disseminationFlag(losing, sitesTotal, siteLossFraction, params);
  return ok({
    sitesTotal,
    sitesInExtent,
    siteLossFraction,
    ...(losing !== undefined ? { residentsLosingCellularReach: losing } : {}),
    ...(residents !== null
      ? { residentsAlreadyUnserved: Math.round(residents.alreadyUnserved) }
      : {}),
    requiresNonCellularDissemination: flag.raised,
    siteDataAvailable: sitesTotal > 0,
    populationResolution: input.populationResolution,
    method: ALERT_REACH_METHOD,
    inputs: {
      sitesTotal,
      sitesInExtent,
      extentGeometries: input.geometries.length,
      populationResolution: input.populationResolution,
      populationCellsAssigned: residents?.cellsAssigned ?? 0,
      maxAssignmentRadiusKm: radiusKm,
      minResidentsForSirenFlag: p.minResidentsForSirenFlag.value,
      minSiteLossFraction: p.minSiteLossFraction.value,
      flagRaisedBy: flag.raisedBy,
      parameterSetId: params.parameterSetId,
      onlineFieldRead: false, // F-28: `TelecomCoverage.online` is hardcoded true and is never consulted.
    },
    uncertainty: ALERT_REACH_UNCERTAINTY,
    caveat: ALERT_REACH_CAVEAT,
  });
}

/**
 * The resident tallies, or `null` when the population input is too coarse for a per-site assignment. The
 * guard is the whole honesty of the resident limb: an AREA_LEVEL input would assign a whole region to
 * whichever site sits nearest its centre, which is a fabricated number wearing a method label.
 */
function residentSplitOf(
  input: AlertReachInput,
  split: SiteSplit,
  radiusM: number,
): ResidentSplit | null {
  const cells = input.populationCells ?? [];
  if (input.populationResolution !== 'CELL_LEVEL' || cells.length === 0) return null;
  return assignResidents(cells, split, radiusM);
}

/**
 * The dissemination flag and WHICH LIMB raised it. Either limb is enough: the resident figure crossing
 * `minResidentsForSirenFlag`, or the site-loss fraction crossing `minSiteLossFraction`. `raisedBy` is
 * published so the triage decision is explainable rather than merely asserted.
 */
function disseminationFlag(
  losing: number | undefined,
  sitesTotal: number,
  siteLossFraction: number,
  params: ImpactParams,
): { readonly raised: boolean; readonly raisedBy: string } {
  const p = params.parameters;
  if (losing !== undefined && losing >= p.minResidentsForSirenFlag.value) {
    return { raised: true, raisedBy: 'residents' };
  }
  if (sitesTotal > 0 && siteLossFraction >= p.minSiteLossFraction.value) {
    return { raised: true, raisedBy: 'siteLossFraction' };
  }
  return { raised: false, raisedBy: 'none' };
}
