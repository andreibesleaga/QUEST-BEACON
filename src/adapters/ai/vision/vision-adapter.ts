// BEACON — VisionPort adapter (E6·T-290/T-291; ADR-008/ADR-008a/CM-C10/ASI06).
// Advisory / cited / confidence-scored; OFF by default (FEATURE_VISION=off) → degrade to skip, never
// dead-end. Reached ONLY through the gateway (seal handshake, like the LLM ladder). A consent + PII-screen
// gate rejects any un-consented / un-screened image BEFORE processing (Art. XIV). Vision NEVER auto-alerts
// and NEVER overrides deterministic geometry — output is advisory only (the verify pipeline decides).
import { err, ok } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import { DomainError } from '@/domain/errors.js';
import type { VisionFinding, VisionPort, VisionRequest } from '@/ports/intel.js';
import type { GateSeal } from '@/adapters/compliance/gate-token.js';
import type { VisionProvider } from './mock-vision.js';

export interface VisionGateContext {
  readonly imageConsented?: boolean; // consent obtained before intake (Art. XIV)
  readonly piiScreened?: boolean; // image PII-screened before processing
}

export interface SealableVision extends VisionPort {
  sealed(token: string, context: VisionGateContext): VisionPort;
}

const REFUSED_UNSTAMPED =
  'Vision call refused: missing gateway stamp — route via AICompliancePort (FR-15)';
const REFUSED_INVALID = 'Vision call refused: invalid/expired gateway stamp';
const DISABLED = 'Vision disabled (FEATURE_VISION=off) — skipped (advisory feature)';
const UNCONSENTED = 'Vision call rejected: image not consented / not PII-screened (Art. XIV)';

export class VisionAdapter implements SealableVision {
  readonly #providers: readonly VisionProvider[];
  readonly #seal: GateSeal;
  readonly #enabled: boolean;

  constructor(providers: readonly VisionProvider[], seal: GateSeal, enabled: boolean) {
    this.#providers = providers;
    this.#seal = seal;
    this.#enabled = enabled;
  }

  analyze(): Promise<Result<VisionFinding, DomainError>> {
    return Promise.resolve(err(new DomainError('INVARIANT_VIOLATION', REFUSED_UNSTAMPED)));
  }

  sealed(token: string, context: VisionGateContext): VisionPort {
    return {
      analyze: async (request: VisionRequest): Promise<Result<VisionFinding, DomainError>> => {
        if (!this.#enabled) return err(new DomainError('INVARIANT_VIOLATION', DISABLED));
        if (!context.imageConsented || !context.piiScreened)
          return err(new DomainError('INVARIANT_VIOLATION', UNCONSENTED));
        const claims = await this.#seal.verify(token);
        if (!claims) return err(new DomainError('INVARIANT_VIOLATION', REFUSED_INVALID));
        return this.#descend(request);
      },
    };
  }

  async #descend(request: VisionRequest): Promise<Result<VisionFinding, DomainError>> {
    for (const provider of this.#providers) {
      try {
        return ok(await provider.analyze(request));
      } catch {
        /* cloud → local → skip: descend on failure */
      }
    }
    // No vision rung available → skip (advisory feature degrades, never dead-ends).
    return err(new DomainError('NOT_FOUND', DISABLED));
  }
}

export function makeVisionAdapter(
  providers: readonly VisionProvider[],
  seal: GateSeal,
  enabled: boolean,
): VisionAdapter {
  return new VisionAdapter(providers, seal, enabled);
}
