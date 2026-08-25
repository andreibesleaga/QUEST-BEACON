// BEACON — deterministic per-tier cost model (E6·F19; ADR-022/ADR-007; Art. XII).
// Cost math is DETERMINISTIC (never the LLM): usd = tokensIn*rateIn + tokensOut*rateOut. Rates are the
// conservative published ceilings (Claude Haiku 4.5 = $1/$5 per 1M in/out, ADR-007) so estimates never
// under-reserve; local/deterministic rungs cost $0 (no egress). Rates are a config-tunable constant here.
import type { ModelTier } from '@/domain/audit-event.js';

interface TierRate {
  readonly inPerToken: number;
  readonly outPerToken: number;
}

const RATES: Readonly<Record<ModelTier, TierRate>> = {
  CLOUD: { inPerToken: 1 / 1_000_000, outPerToken: 5 / 1_000_000 },
  VISION: { inPerToken: 1 / 1_000_000, outPerToken: 5 / 1_000_000 },
  LOCAL: { inPerToken: 0, outPerToken: 0 },
  DETERMINISTIC: { inPerToken: 0, outPerToken: 0 },
};

const round6 = (n: number): number => Math.round(n * 1_000_000) / 1_000_000;

/** Deterministic token estimate from text length (~4 chars/token floor). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Actual per-call cost from measured usage (deterministic; Art. XII). */
export function computeCostUsd(tier: ModelTier, tokensIn: number, tokensOut: number): number {
  const r = RATES[tier];
  return round6(tokensIn * r.inPerToken + tokensOut * r.outPerToken);
}

/** Worst-case reservation estimate: full input + the role's max output tokens at the tier rate. */
export function estimateReservationUsd(tier: ModelTier, inputTokens: number, maxOutputTokens: number): number {
  return computeCostUsd(tier, inputTokens, maxOutputTokens);
}
