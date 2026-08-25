// BEACON — application-layer tunables (E5). Every weight/buffer/margin is INJECTED into the pure
// use-cases (never hardcoded inside a computation — U5/§4). These DEFAULT_* constants mirror the
// documented spec values (SPEC §5.2/§5.4/§5.7); the composition root passes config-derived values.
import type { InfraNodeType } from '@/domain/infrastructure-node.js';

/** Priority weights (SPEC §5.2). Sum MUST equal 1 so the blended score stays in [0,1]. */
export interface PriorityWeights {
  readonly proximity: number;
  readonly vulnerability: number;
  readonly population: number;
}

export const DEFAULT_PRIORITY_WEIGHTS: PriorityWeights = {
  proximity: 0.45,
  vulnerability: 0.35,
  population: 0.2,
};

/** Vulnerability model: per-type base weight, OFFLINE boost, population normalization basis. */
export interface VulnerabilityConfig {
  readonly typeWeights: Readonly<Record<InfraNodeType, number>>;
  readonly offlineBoost: number;
  readonly populationBasis: number;
}

export const DEFAULT_VULNERABILITY_CONFIG: VulnerabilityConfig = {
  typeWeights: {
    HOSPITAL: 1.0,
    NURSING_HOME: 1.0,
    SHELTER: 0.8,
    POWER: 0.7,
    CELL: 0.6,
    RAIL: 0.5,
    ROAD: 0.3,
  },
  offlineBoost: 1.5,
  populationBasis: 10_000,
};

/** Confidence blend weights (SPEC §5.4 / ADR-015). Sum MUST equal 1. */
export interface ConfidenceWeights {
  readonly geocode: number;
  readonly authority: number;
  readonly classifier: number;
  readonly corroboration: number;
}

export const DEFAULT_CONFIDENCE_WEIGHTS: ConfidenceWeights = {
  geocode: 0.4,
  authority: 0.3,
  classifier: 0.2,
  corroboration: 0.1,
};

/** Escalation-trend classifier config (SPEC §5.7). */
export interface TrendConfig {
  readonly minSamples: number; // TREND_MIN_SAMPLES (default 3)
  readonly deadbandPerHour: number; // TREND_DEADBAND in signal-units / hour
}

export const DEFAULT_TREND_CONFIG: TrendConfig = {
  minSamples: 3,
  deadbandPerHour: 0.5,
};

/** Fire-cone projection config (SPEC §5.6). */
export interface FireConeConfig {
  readonly halfAngleDeg: number; // spread half-angle of the cone
  readonly spreadFactor: number; // multiplier on windSpeed×horizon → cone length (metres)
  readonly baseUncertainty: number; // uncertainty at horizon≈0
  readonly uncertaintyPerHour: number; // added uncertainty per projection hour
}

export const DEFAULT_FIRE_CONE_CONFIG: FireConeConfig = {
  halfAngleDeg: 30,
  spreadFactor: 1,
  baseUncertainty: 0.2,
  uncertaintyPerHour: 0.1,
};

/** Suggested-evacuation-start config (SPEC §5.7). */
export const DEFAULT_EVAC_SAFETY_MARGIN_SEC = 1800;

/** Default evacuation convoy speed (m/s) for the deterministic route-clearance estimate (SPEC §5.7 — ≈32 km/h). */
export const DEFAULT_EVAC_SPEED_MPS = 8.94;
