// BEACON — weighted priority ranking use-case (E5·T-195/T-199; FR-13, SPEC §5.2).
// Pure deterministic function — the engine source of truth for ranked attention (Art. XII/F3).
// The LLM narrates the ranking but never reorders/invents it. Weights are INJECTED (never hardcoded).
import type { InfraNodeType } from '@/domain/infrastructure-node.js';
import type { InfrastructureNodeId } from '@/domain/value-objects/ids.js';
import {
  DEFAULT_PRIORITY_WEIGHTS,
  DEFAULT_VULNERABILITY_CONFIG,
  type PriorityWeights,
  type VulnerabilityConfig,
} from '@/application/shared/config.js';
import { clamp01 } from '@/application/shared/geo.js';

export interface PriorityInput {
  readonly nodeId: InfrastructureNodeId;
  readonly nodeType: InfraNodeType;
  readonly insideHazard: boolean;
  readonly distanceM?: number; // distance to nearest hazard (undefined when not computed)
  readonly bufferM: number; // the node-type buffer used for proximity normalization
  readonly exposedPopulation: number;
  readonly offline: boolean; // OFFLINE status boosts vulnerability
}

export interface PriorityScore {
  readonly nodeId: InfrastructureNodeId;
  readonly score: number; // blended, in [0,1]
  readonly proximity: number;
  readonly vulnerability: number;
  readonly population: number;
  readonly tieBreakKey: string; // stable deterministic sort key
}

export interface PriorityConfig {
  readonly weights: PriorityWeights;
  readonly vulnerability: VulnerabilityConfig;
}

export const DEFAULT_PRIORITY_CONFIG: PriorityConfig = {
  weights: DEFAULT_PRIORITY_WEIGHTS,
  vulnerability: DEFAULT_VULNERABILITY_CONFIG,
};

/** Proximity ∈ [0,1]: 1.0 when inside the hazard, else 1 − distance/buffer clamped (SPEC §5.2). */
function proximityScore(input: PriorityInput): number {
  if (input.insideHazard) return 1.0;
  if (input.distanceM === undefined || input.bufferM <= 0) return 0;
  return clamp01(1 - input.distanceM / input.bufferM);
}

/** Vulnerability ∈ [0,1]: node-type base weight × OFFLINE boost, clamped (SPEC §5.2). */
function vulnerabilityScore(input: PriorityInput, cfg: VulnerabilityConfig): number {
  const base = cfg.typeWeights[input.nodeType] ?? 0;
  return clamp01(base * (input.offline ? cfg.offlineBoost : 1));
}

/** Population ∈ [0,1]: exposed population normalized against the config basis (SPEC §5.2). */
function populationScore(input: PriorityInput, cfg: VulnerabilityConfig): number {
  if (cfg.populationBasis <= 0) return 0;
  return clamp01(input.exposedPopulation / cfg.populationBasis);
}

/** Score one node deterministically. */
export function scoreNode(input: PriorityInput, cfg: PriorityConfig = DEFAULT_PRIORITY_CONFIG): PriorityScore {
  const proximity = proximityScore(input);
  const vulnerability = vulnerabilityScore(input, cfg.vulnerability);
  const population = populationScore(input, cfg.vulnerability);
  const w = cfg.weights;
  const score = w.proximity * proximity + w.vulnerability * vulnerability + w.population * population;
  return { nodeId: input.nodeId, score, proximity, vulnerability, population, tieBreakKey: String(input.nodeId) };
}

/**
 * Rank exposed nodes by descending blended score; ties break by the stable `tieBreakKey` (node id)
 * so ordering is fully deterministic and reproducible (Art. XII).
 */
export function rankPriorities(
  inputs: readonly PriorityInput[],
  cfg: PriorityConfig = DEFAULT_PRIORITY_CONFIG,
): readonly PriorityScore[] {
  return inputs
    .map((i) => scoreNode(i, cfg))
    .sort((a, b) => b.score - a.score || (a.tieBreakKey < b.tieBreakKey ? -1 : a.tieBreakKey > b.tieBreakKey ? 1 : 0));
}
