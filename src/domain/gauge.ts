// BEACON — GAUGE entity (E1·T-053). Flood gauge reading with an ORDERED flood-category severity VO.
// Pure domain: no framework/HTTP/DB imports (F9).
import type { GaugeId, SourceId } from './value-objects/ids.js';
import type { PointGeometry } from './value-objects/geo.js';
import { invariant, definedOnly } from './shared/guard.js';

// ORDERED enum — mirrors schema.sql gauge.flood_category CHECK, least->most severe. Order is load-bearing:
// the array index IS the severity rank used by compareFloodCategory.
export const FLOOD_CATEGORIES = ['NONE', 'ACTION', 'MINOR', 'MODERATE', 'MAJOR'] as const;
export type FloodCategory = (typeof FLOOD_CATEGORIES)[number];

/** Severity rank (0=NONE … 4=MAJOR). */
export function floodCategoryRank(c: FloodCategory): number {
  return FLOOD_CATEGORIES.indexOf(c);
}

/** Compare by severity: <0 if a less severe than b, 0 if equal, >0 if a more severe. */
export function compareFloodCategory(a: FloodCategory, b: FloodCategory): number {
  return floodCategoryRank(a) - floodCategoryRank(b);
}

/**
 * ORDERED forecast tendency — the three terms a forecast source publishes for the direction of travel of
 * its own signal (GloFAS reporting points: increasing / decreasing / stagnant). A MACHINE value of record:
 * stored uppercase, never translated, never derived by BEACON. It is evidence shown beside a forecast, NOT
 * an input to any likelihood classification (a direction of travel is not a probability).
 */
export const GAUGE_TENDENCIES = ['DECREASING', 'STAGNANT', 'INCREASING'] as const;
export type GaugeTendency = (typeof GAUGE_TENDENCIES)[number];

export interface Gauge {
  readonly id: GaugeId;
  readonly geom: PointGeometry;
  readonly floodCategory: FloodCategory;
  readonly stage?: number;
  readonly crestForecast?: number;
  readonly crestTime?: string; // ISO-8601
  /**
   * Probability of exceeding the source's own threshold, as the SOURCE published it — a dimensionless
   * fraction in [0,1], never a percentage, never rescaled, never computed by BEACON (FR-PRED-1/FUW-3).
   * Optional: a source that does not publish one leaves it absent rather than defaulting to 0.
   */
  readonly exceedanceProbability?: number;
  readonly tendency?: GaugeTendency;
  readonly sourceId?: SourceId;
}

export interface MakeGaugeInput {
  readonly id: GaugeId;
  readonly geom: PointGeometry;
  readonly floodCategory?: FloodCategory; // schema default NONE
  readonly stage?: number;
  readonly crestForecast?: number;
  readonly crestTime?: string;
  readonly exceedanceProbability?: number;
  readonly tendency?: GaugeTendency;
  readonly sourceId?: SourceId;
}

/**
 * Invariants for the two source-published forecast signals. Extracted so makeGauge stays a flat list of
 * invariants under the complexity ceiling (Gate 6) without weakening either check.
 */
function assertForecastSignals(input: MakeGaugeInput): void {
  const p = input.exceedanceProbability;
  invariant(
    p === undefined || (typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1),
    `Gauge.exceedanceProbability must be a dimensionless fraction in [0,1] (never a percentage), got ${String(p)}`,
  );
  invariant(
    input.tendency === undefined || GAUGE_TENDENCIES.includes(input.tendency),
    `Gauge.tendency must be one of ${GAUGE_TENDENCIES.join('|')}, got ${String(input.tendency)}`,
  );
}

export function makeGauge(input: MakeGaugeInput): Gauge {
  invariant(input.geom !== undefined && input.geom.type === 'Point', 'Gauge.geom must be a GeoJSON Point');
  const floodCategory = input.floodCategory ?? 'NONE';
  invariant(
    FLOOD_CATEGORIES.includes(floodCategory),
    `Gauge.floodCategory must be one of ${FLOOD_CATEGORIES.join('|')}, got ${String(floodCategory)}`,
  );
  invariant(
    input.crestTime === undefined || !Number.isNaN(Date.parse(input.crestTime)),
    `Gauge.crestTime must be a valid ISO-8601 instant, got ${input.crestTime}`,
  );
  assertForecastSignals(input);
  return definedOnly({
    id: input.id,
    geom: input.geom,
    floodCategory,
    stage: input.stage,
    crestForecast: input.crestForecast,
    crestTime: input.crestTime,
    exceedanceProbability: input.exceedanceProbability,
    tendency: input.tendency,
    sourceId: input.sourceId,
  }) as Gauge;
}
