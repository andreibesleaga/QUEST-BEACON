// BEACON — deterministic in-process LLM provider (E6·T-244/T-246; ADR-007).
// Used in test and when AI_MODE=cloud|local with no tier configured: no network, no egress, fully
// deterministic. Mirrors the shape a real LiteLLM provider returns AND the behaviour the output validator
// now requires: a COMPLIANT narrator emits no figure at all (Art. XII, finding F-340). It therefore narrates
// only the claims that are themselves figure-free, and says so plainly when none are — restating a claim's
// numbers would make this rung fail `isValidNarration` and silently collapse every ladder test onto the
// deterministic-only rung.
import type { NarrativeRequest } from '@/ports/intel.js';
import { estimateTokens } from '../cost-rates.js';
import { narrationIsFigureFree } from './output-validator.js';

/**
 * What a compliant narrator says when every cited claim carries a figure (the normal BEACON case — engine
 * claims are numeric). Deliberately figure-free itself, and honest about where the numbers actually are.
 */
const FIGURE_FREE_FALLBACK =
  'Narrated from the cited facts; every figure is shown in the cited fields, not in this prose.';

export interface ProviderNarration {
  readonly text: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface LlmProvider {
  readonly name: string; // gen_ai.request.model id
  narrate(request: NarrativeRequest): Promise<ProviderNarration>;
}

/**
 * A deterministic narrator. `failing` simulates a provider outage (throws) so ladder-descent tests can
 * drive the fallback path without network.
 */
export function makeMockProvider(name = 'mock-deterministic', failing = false): LlmProvider {
  return {
    name,
    narrate(request: NarrativeRequest): Promise<ProviderNarration> {
      if (failing) return Promise.reject(new Error(`provider ${name} unavailable`));
      const style = request.style ?? 'sitrep';
      const claims = request.facts.map((f) => f.claim).join(' ');
      // A whole claim is dropped if it carries a figure — never partially redacted, which would leave
      // maimed prose ("crest cfs at :") on a crisis screen.
      const narratable = request.facts.map((f) => f.claim).filter((c) => narrationIsFigureFree(c));
      const prose = narratable.length > 0 ? narratable.join(' ') : FIGURE_FREE_FALLBACK;
      const text = `[${style}] ${prose}`.trim();
      const inputTokens = estimateTokens(claims);
      return Promise.resolve({ text, inputTokens, outputTokens: estimateTokens(text) });
    },
  };
}
