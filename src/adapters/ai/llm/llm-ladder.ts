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

const REFUSED_UNSTAMPED =
  'LLM call refused: missing gateway stamp — route via AICompliancePort (FR-15)';
const REFUSED_INVALID = 'LLM call refused: invalid/expired gateway stamp';

function buildNarrative(text: string, request: NarrativeRequest): Narrative {
  return { text, citations: request.facts.map((f) => f.citation) };
}

// The deterministic-only rung: no model, degradation clearly labelled (F3/Art. XVI) AND flagged
// (`degraded`). The echo is built from the claims this ladder was handed — figure-free by design since
// F-418 — so it is a last resort for a caller with nothing better, never a summary to show beside the
// record: the SitRep synthesis reads the flag and renders its own full claims instead (2026-11-21).
function deterministicOnly(request: NarrativeRequest): Narrative {
  const claims = request.facts.map((f) => f.claim).join('; ');
  return {
    ...buildNarrative(
      `[deterministic-only — AI narration unavailable] Cited facts: ${claims}`,
      request,
    ),
    degraded: true,
  };
}

/** Why a rung stepped aside: the provider failed (outage, refused key, rate limit) or its text was rejected. */
export type RungFailure = 'provider-error' | 'rejected-by-validator';

/**
 * Told once per failed rung, so the reason reaches the deploy log. Without it a refused API key looked
 * exactly like a model outage: every report quietly fell to the deterministic rung and nothing said why
 * (found on the live deployment, 2026-11-21). `detail` is the provider's own error text (a status code,
 * never a credential) or empty for a validator rejection — the rejected prose itself is never logged.
 */
export type OnRungFailure = (provider: string, failure: RungFailure, detail: string) => void;

export class LlmLadder implements SealableLLM {
  readonly #providers: readonly LlmProvider[];
  readonly #seal: GateSeal;
  readonly #onRungFailure: OnRungFailure | undefined;

  constructor(providers: readonly LlmProvider[], seal: GateSeal, onRungFailure?: OnRungFailure) {
    this.#providers = providers;
    this.#seal = seal;
    this.#onRungFailure = onRungFailure;
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
      if (isValidNarration(narrative, request.facts)) return narrative;
      this.#report(provider.name, 'rejected-by-validator', '');
      return null;
    } catch (e) {
      // provider outage / refused key / rate-limit → descend one rung (availability degrade)
      this.#report(provider.name, 'provider-error', e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  // A reporter must never be able to break the ladder it reports on (Art. XVI).
  #report(provider: string, failure: RungFailure, detail: string): void {
    try {
      this.#onRungFailure?.(provider, failure, detail);
    } catch {
      /* reporting is best-effort */
    }
  }
}

export function makeLlmLadder(
  providers: readonly LlmProvider[],
  seal: GateSeal,
  onRungFailure?: OnRungFailure,
): LlmLadder {
  return new LlmLadder(providers, seal, onRungFailure);
}
