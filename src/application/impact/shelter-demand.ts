// BEACON — quantification (d) PREDICTED SHELTER DEMAND + EVACUATION-CLEARANCE FEASIBILITY
// (MW-D/D1.4; ADR-035 §1(d); FR-PAP-4 / FEV-14).
//
// ⚠ EVERY PARAMETER IS LITERATURE-BASED *METHOD*, CONFIG-CITED *VALUE* — NOT A LOCAL MEASUREMENT.
// The formulation (shelter-seeking share; vehicles = evacuees / occupancy; clearance = loading + vehicles /
// egress capacity) comes from evacuation trigger-buffer and clearance-time research recorded in
// `docs/features/DIFFERENTIATORS_RESEARCH.md:48-49` (Cova & Dennison 2005; Li/Cova/Dennison 2019;
// Kuligowski 2020). The NUMBERS are BEACON operator defaults in `config/impact-params.json`, every one of them
// shipped `verified: false`, because the same research record flags the exact participation/clearance
// percentages as UNVERIFIED (`:82`). Every figure therefore publishes `parameterSetId` plus the full
// `assumptions[]` — value, unit, label and citation — so a reader sees precisely what was assumed. The
// uncertainty here is dominated ENTIRELY by those assumptions, which is why the figure carries them rather
// than a numeric band.
//
// ⚠ A KNOWN DIRECTIONAL BIAS, STATED. The clearance term is LINEAR in demand. Li/Cova/Dennison 2019 measured
// clearance rising SUPER-linearly (160 → 292 minutes at 2× demand). This figure therefore UNDERSTATES
// clearance time at high demand and must be read as a FLOOR, never as a schedule. `CLEARANCE_UNCERTAINTY`
// says so and travels with the figure.
//
// PURE (Art. XII). No clock, no I/O, no randomness. `leadTimeHours` is supplied by the caller from an
// already-computed lead time (the crest/ETA signal or an EAP horizon), never read from a wall clock here.
//
// AGGREGATE-ONLY (Art. XIV). Inputs are a population count and shelter capacity/occupancy totals. No
// individual, no household, no shelter-resident record exists in any signature — and `Shelter` itself gains
// nothing: a projected demand is an ESTIMATE, not a shelter attribute (ADR-035 §1(d), finding F12).
import type { Shelter } from '@/domain/shelter.js';
import {
  DEFAULT_IMPACT_PARAMS,
  assumptionsOf,
  type ImpactAssumption,
  type ImpactParams,
  type ImpactParameterId,
} from './impact-params.js';

export const SHELTER_DEMAND_METHOD =
  'shelter demand = affected residents × shelter-seeking share, compared against Σ(capacity − occupancy) of ' +
  'the shelters supplied; evacuation clearance = loading time + (affected × participation ÷ occupants per ' +
  'vehicle) ÷ egress capacity — a LINEAR clearance formulation, so the hours are a floor';

export const CLEARANCE_UNCERTAINTY =
  'Dominated ENTIRELY by the parameters, which is why every one of them travels with this figure: all are ' +
  'BEACON operator defaults, none is a published literature value, and road capacity, loading time, vehicle ' +
  'occupancy and especially participation are population- and place-specific. The clearance term is LINEAR ' +
  'while measured clearance rises super-linearly with demand (160 → 292 minutes at 2× demand, ' +
  'Li/Cova/Dennison 2019), so the hours are a FLOOR, not a schedule. Shelter capacity is compared against ' +
  'hand-seeded shelter data, not a live shelter feed, so the comparison is illustrative rather than ' +
  'operational.';

/** The parameters (d) consumes, in the order they are published on the figure. */
const SHELTER_DEMAND_PARAMETER_IDS: readonly ImpactParameterId[] = [
  'shelterSeekingFraction',
  'participationFraction',
  'occupantsPerVehicle',
  'egressCapacityVehPerHour',
  'loadingTimeHours',
];

export interface ShelterDemandInput {
  /**
   * The affected-population figure's `count` (quantification (a) or (c)) — already suppression-safe, so a
   * small-count figure cannot leak through the shelter arithmetic either.
   */
  readonly affectedCount: number;
  /** Shelters in or near the extent. Only `capacity`/`occupancy` are read; no shelter identity is published. */
  readonly shelters: readonly Shelter[];
  /**
   * Hours of usable warning time before hazard arrival, from an ALREADY-COMPUTED lead time (a source-published
   * crest instant, an ETA, or an EAP horizon). Absent ⇒ no feasibility verdict is stated: a feasibility claim
   * without a lead time would be a guess about how much time exists.
   */
  readonly leadTimeHours?: number;
  readonly params?: ImpactParams;
}

export interface ShelterDemandFigure {
  readonly shelterSeeking: number;
  readonly spareCapacity: number;
  readonly shelterDeficit: number;
  readonly sheltersConsidered: number;
  /** Vehicles the participation assumption implies — published because it is the clearance driver. */
  readonly evacuatingVehicles: number;
  readonly clearanceHours: number;
  readonly leadTimeHours?: number;
  /** `undefined` when no lead time was supplied — an absent verdict, never a false "feasible". */
  readonly evacuationFeasible?: boolean;
  readonly parameterSetId: string;
  readonly assumptions: readonly ImpactAssumption[];
  readonly method: string;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly uncertainty: string;
}

/** Σ(capacity − occupancy) over the shelters supplied, floored per shelter so a bad row cannot go negative. */
function spareCapacityOf(shelters: readonly Shelter[]): number {
  return shelters.reduce((sum, s) => sum + Math.max(0, s.capacity - s.occupancy), 0);
}

/** Round to one decimal — a presentation choice for HOURS only. No coordinate is ever rounded (F-98). */
function hours(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Project shelter demand and evacuation-clearance feasibility (ADR-035 §1(d)).
 *
 * Returns the figure DIRECTLY rather than a `Result`, unlike its two sibling quantifications: this one has no
 * failure mode to report. There is no geometry to clip and no port to call — the parameters are validated at
 * load by `parseImpactParams`, and a non-finite or negative `affectedCount` is coerced to zero rather than
 * propagating a `NaN` into a published figure. A `Result` here would advertise an error path that can never
 * occur, and every caller would carry dead handling for it.
 *
 * Deterministic: identical inputs give an identical figure.
 */
export function projectShelterDemand(input: ShelterDemandInput): ShelterDemandFigure {
  const params = input.params ?? DEFAULT_IMPACT_PARAMS;
  const p = params.parameters;
  const affected =
    Number.isFinite(input.affectedCount) && input.affectedCount > 0 ? input.affectedCount : 0;
  const shelterSeeking = Math.round(affected * p.shelterSeekingFraction.value);
  const spareCapacity = spareCapacityOf(input.shelters);
  const evacuatingVehicles = Math.ceil(
    (affected * p.participationFraction.value) / p.occupantsPerVehicle.value,
  );
  const clearanceHours = hours(
    p.loadingTimeHours.value + evacuatingVehicles / p.egressCapacityVehPerHour.value,
  );
  const lead = input.leadTimeHours;
  const leadKnown = lead !== undefined && Number.isFinite(lead) && lead >= 0;
  return {
    shelterSeeking,
    spareCapacity,
    shelterDeficit: Math.max(0, shelterSeeking - spareCapacity),
    sheltersConsidered: input.shelters.length,
    evacuatingVehicles,
    clearanceHours,
    ...(leadKnown ? { leadTimeHours: lead, evacuationFeasible: clearanceHours <= lead } : {}),
    parameterSetId: params.parameterSetId,
    assumptions: assumptionsOf(params, SHELTER_DEMAND_PARAMETER_IDS),
    method: SHELTER_DEMAND_METHOD,
    inputs: {
      affectedCount: affected,
      sheltersConsidered: input.shelters.length,
      spareCapacity,
      evacuatingVehicles,
      leadTimeHoursSupplied: leadKnown,
      parameterSetId: params.parameterSetId,
      allParametersVerified: SHELTER_DEMAND_PARAMETER_IDS.every((id) => p[id].verified),
    },
    uncertainty: CLEARANCE_UNCERTAINTY,
  };
}
