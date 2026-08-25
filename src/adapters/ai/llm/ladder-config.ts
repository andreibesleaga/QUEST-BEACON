// BEACON — env-driven LLM ladder resolver (E6·T-246…T-250; ADR-007/ADR-008a; 12-factor).
// Assembles the provider ladder (default=Groq → fallback=OpenRouter/Claude Haiku → local=Ollama) purely
// from environment — provider/model/base/key per tier, nothing hardcoded. AI_MODE=off (or test) yields an
// EMPTY ladder → the LlmLadder degrades straight to the deterministic-only rung (AI-off acceptance path,
// Art. XVI). Reads a passed-in env record so it is deterministic + testable.
import type { HttpClient } from '../http-client.js';
import type { LlmProvider } from './mock-provider.js';
import { makeOpenAiCompatibleProvider } from './openai-compatible-provider.js';

export type AiEnv = Readonly<Record<string, string | undefined>>;

interface TierEnv {
  readonly nameKey: string;
  readonly baseKey: string;
  readonly keyKey: string;
}

// ADR-007 ladder: default (Groq) → fallback (OpenRouter/Claude Haiku) → local (Ollama). All env-driven.
const TIERS: readonly TierEnv[] = [
  { nameKey: 'LLM_TIER_DEFAULT_MODEL', baseKey: 'LLM_TIER_DEFAULT_BASE', keyKey: 'LLM_TIER_DEFAULT_KEY' },
  { nameKey: 'LLM_TIER_FALLBACK_MODEL', baseKey: 'LLM_TIER_FALLBACK_BASE', keyKey: 'LLM_TIER_FALLBACK_KEY' },
  { nameKey: 'LLM_TIER_LOCAL_MODEL', baseKey: 'LLM_TIER_LOCAL_BASE', keyKey: 'LLM_TIER_LOCAL_KEY' },
];

function resolveTier(env: AiEnv, tier: TierEnv, http: HttpClient, maxOutputTokens: number): LlmProvider | null {
  const name = env[tier.nameKey];
  const apiBase = env[tier.baseKey];
  if (!name || !apiBase) return null; // an unconfigured rung is simply skipped (ladder still valid)
  const apiKey = env[tier.keyKey];
  return makeOpenAiCompatibleProvider({ name, apiBase, maxOutputTokens, ...(apiKey ? { apiKey } : {}) }, http);
}

/** Build the ordered provider ladder from env. Empty when AI_MODE=off → deterministic-only rung. */
export function resolveLadder(env: AiEnv, http: HttpClient, maxOutputTokens = 800): readonly LlmProvider[] {
  if (env.AI_MODE === 'off') return [];
  return TIERS.map((t) => resolveTier(env, t, http, maxOutputTokens)).filter((p): p is LlmProvider => p !== null);
}
