// BEACON — LLM ladder adapter implementing LLMPort (E6·T-244…T-254; ADR-007/F3/CM-C5-C16).
// NARRATE-ONLY (no tools, no numbers). Env-configured provider ladder (Groq → OpenRouter/Claude Haiku →
// Ollama → deterministic-only) — reachable ONLY through the AICompliancePort gateway: the public narrate()
// refuses any un-stamped call (F16/D-29); the gateway calls sealed(token).narrate(). Each rung's output is
// schema + citation + no-number validated (output-validator); an invalid/failed rung descends. The final
// deterministic-only rung never dead-ends (Art. XVI) and echoes only the already-cited facts.
import { err, ok } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import { DomainError } from '@/domain/errors.js';
import type { LLMPort, Narrative, NarrativeRequest } from '@/ports/intel.js';
import type { GateSeal } from '@/adapters/compliance/gate-token.js';
import type { LlmProvider } from './mock-provider.js';
import { isValidNarration } from './output-validator.js';

/** LLMPort extended with the in-memory seal handshake used by the gateway. */
export interface SealableLLM extends LLMPort {
  sealed(token: string): LLMPort;
}

const REFUSED_UNSTAMPED = 'LLM call refused: missing gateway stamp — route via AICompliancePort (FR-15)';
const REFUSED_INVALID = 'LLM call refused: invalid/expired gateway stamp';

function buildNarrative(text: string, request: NarrativeRequest): Narrative {
  return { text, citations: request.facts.map((f) => f.citation) };
}

// The deterministic-only rung: no model, numbers retained, degradation clearly labeled (F3/Art. XVI).
function deterministicOnly(request: NarrativeRequest): Narrative {
  const claims = request.facts.map((f) => f.claim).join('; ');
  return buildNarrative(`[deterministic-only — AI narration unavailable] Cited facts: ${claims}`, request);
}

export class LlmLadder implements SealableLLM {
  readonly #providers: readonly LlmProvider[];
  readonly #seal: GateSeal;

  constructor(providers: readonly LlmProvider[], seal: GateSeal) {
    this.#providers = providers;
    this.#seal = seal;
  }

  /** Public port method — always refuses without a gateway stamp (adapters cannot be reached directly). */
  narrate(): Promise<Result<Narrative, DomainError>> {
    return Promise.resolve(err(new DomainError('INVARIANT_VIOLATION', REFUSED_UNSTAMPED)));
  }

  /** Gateway-only entry: verifies the stamp, then descends the ladder. */
  sealed(token: string): LLMPort {
    return {
      narrate: async (request: NarrativeRequest): Promise<Result<Narrative, DomainError>> => {
        const claims = await this.#seal.verify(token);
        if (!claims) return err(new DomainError('INVARIANT_VIOLATION', REFUSED_INVALID));
        return ok(await this.#descend(request));
      },
    };
  }

  // Try each configured rung; accept the first that produces a VALID narration; else deterministic-only.
  async #descend(request: NarrativeRequest): Promise<Narrative> {
    for (const provider of this.#providers) {
      const narrative = await this.#tryProvider(provider, request);
      if (narrative) return narrative;
    }
    return deterministicOnly(request);
  }

  async #tryProvider(provider: LlmProvider, request: NarrativeRequest): Promise<Narrative | null> {
    try {
      const out = await provider.narrate(request);
      const narrative = buildNarrative(out.text, request);
      return isValidNarration(narrative, request.facts) ? narrative : null;
    } catch {
      return null; // provider outage / rate-limit → descend one rung (availability degrade)
    }
  }
}

export function makeLlmLadder(providers: readonly LlmProvider[], seal: GateSeal): LlmLadder {
  return new LlmLadder(providers, seal);
}
