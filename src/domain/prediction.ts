// BEACON — PREDICTION entity (E1·T-059). Labeled first-order projection: method+inputs+uncertainty required.
// Pure domain: no framework/HTTP/DB imports (F9). Predictions must always be labeled (Art. XII, §14).
import type { PredictionId, IncidentId, SourceId } from './value-objects/ids.js';
import type { Geometry } from './value-objects/geo.js';
import { invariant, definedOnly } from './shared/guard.js';

// Enum mirrors schema.sql prediction.kind CHECK constraint.
export const PREDICTION_KINDS = ['FIRE_CONE', 'FLOOD_INUNDATION', 'IMPACT_OVER_TIME', 'ESCALATION'] as const;
export type PredictionKind = (typeof PREDICTION_KINDS)[number];

/**
 * ORDERED likelihood class (ADR-033 §2.1; FU-11). Array index IS the rank — the same load-bearing
 * ordering contract as FLOOD_CATEGORIES in gauge.ts.
 *
 * A class is BEACON's presentation of a probability signal a SOURCE already published, mapped by a
 * documented threshold table (config/likelihood-thresholds.json). It is never a model output, never
 * interpolated, and it is never rendered as a percentage chance of occurrence (FUW-3, Art. XII). The
 * class is always displayed together with the raw source value and the method that produced it.
 */
export const LIKELIHOOD_CLASSES = ['POSSIBLE', 'LIKELY', 'VERY_LIKELY'] as const;
export type LikelihoodClass = (typeof LIKELIHOOD_CLASSES)[number];

/** Likelihood rank (0=POSSIBLE, 1=LIKELY, 2=VERY_LIKELY). */
export function likelihoodClassRank(c: LikelihoodClass): number {
  return LIKELIHOOD_CLASSES.indexOf(c);
}

/** Compare by likelihood: <0 if a less likely than b, 0 if equal, >0 if a more likely. */
export function compareLikelihoodClass(a: LikelihoodClass, b: LikelihoodClass): number {
  return likelihoodClassRank(a) - likelihoodClassRank(b);
}

export interface Prediction {
  readonly id: PredictionId;
  readonly incidentId: IncidentId;
  readonly kind: PredictionKind;
  readonly method: string; // human-readable label of the first-order method used
  readonly inputs: Readonly<Record<string, unknown>>; // the inputs the projection was derived from
  readonly uncertainty: number; // [0,1] — every prediction is labeled with its uncertainty
  readonly geom?: Geometry;
  readonly horizon?: string; // ISO-8601
  /**
   * Likelihood class derived ONLY from a source-provided probability signal (ADR-033 §2.2). Absent when
   * no source signal supports one — a prediction without a class is honest, an invented class is not.
   * The evidence (raw source value, source field, threshold, method) always travels in `inputs`.
   */
  readonly likelihoodClass?: LikelihoodClass;
  /** Source-supported lead time in hours (>= 0). SI-adjacent unit of record; never rounded for display here. */
  readonly etaHours?: number;
  readonly sourceId?: SourceId;
}

export interface MakePredictionInput {
  readonly id: PredictionId;
  readonly incidentId: IncidentId;
  readonly kind: PredictionKind;
  readonly method: string;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly uncertainty: number;
  readonly geom?: Geometry;
  readonly horizon?: string;
  readonly likelihoodClass?: LikelihoodClass;
  readonly etaHours?: number;
  readonly sourceId?: SourceId;
}

/**
 * Invariants for the forecast-likelihood fields. Extracted so makePrediction stays a flat list of
 * invariants under the complexity ceiling (Gate 6) without weakening either check.
 *
 * `hazardArrival` is deliberately NOT a field here: it is `now + etaHours`, so storing it would force a
 * wall-clock read into a pure value-object factory (ADR-033 §3 + Alternatives). It is computed at the
 * application layer from an injected clock, exactly as `horizon` already is.
 */
function assertLikelihoodFields(input: MakePredictionInput): void {
  invariant(
    input.likelihoodClass === undefined || LIKELIHOOD_CLASSES.includes(input.likelihoodClass),
    `Prediction.likelihoodClass must be one of ${LIKELIHOOD_CLASSES.join('|')}, got ${String(input.likelihoodClass)}`,
  );
  const eta = input.etaHours;
  invariant(
    eta === undefined || (typeof eta === 'number' && Number.isFinite(eta) && eta >= 0),
    `Prediction.etaHours must be a finite lead time in hours >= 0, got ${String(eta)}`,
  );
}

export function makePrediction(input: MakePredictionInput): Prediction {
  invariant(
    PREDICTION_KINDS.includes(input.kind),
    `Prediction.kind must be one of ${PREDICTION_KINDS.join('|')}, got ${String(input.kind)}`,
  );
  // A prediction is only trustworthy if it is labeled — method, inputs, uncertainty are all mandatory.
  invariant(
    typeof input.method === 'string' && input.method.trim().length > 0,
    'Prediction.method is required (labeled first-order)',
  );
  invariant(
    input.inputs !== undefined && input.inputs !== null && typeof input.inputs === 'object',
    'Prediction.inputs is required (labeled first-order)',
  );
  invariant(
    typeof input.uncertainty === 'number' && !Number.isNaN(input.uncertainty),
    'Prediction.uncertainty is required (labeled first-order)',
  );
  invariant(
    input.uncertainty >= 0 && input.uncertainty <= 1,
    `Prediction.uncertainty must be in [0,1], got ${input.uncertainty}`,
  );
  invariant(
    input.horizon === undefined || !Number.isNaN(Date.parse(input.horizon)),
    `Prediction.horizon must be a valid ISO-8601 instant, got ${input.horizon}`,
  );
  assertLikelihoodFields(input);
  return definedOnly({
    id: input.id,
    incidentId: input.incidentId,
    kind: input.kind,
    method: input.method,
    inputs: input.inputs,
    uncertainty: input.uncertainty,
    geom: input.geom,
    horizon: input.horizon,
    likelihoodClass: input.likelihoodClass,
    etaHours: input.etaHours,
    sourceId: input.sourceId,
  }) as Prediction;
}
