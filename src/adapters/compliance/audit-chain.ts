// BEACON — hash-chained append-only AUDIT_EVENT writer (E6·T-276; ADR-022/CM-C23/EU-AI-Act-Art.12).
// Reuses the DOMAIN hash link (makeAuditEvent/verifyAuditLink/linkHash) so every compliance decision is
// committed to a tamper-evident chain: hash = linkHash(prevHash, payload). FAIL-CLOSED at the gateway —
// if an append throws, the gateway refuses to forward upstream (no audit write ⇒ no commit). The chain
// stores UUIDs + generalized fields only (no PII/raw content, THREAT §9.3). Cost fields are non-null on
// AI calls (F19). incident/region tags live in an adapter-side index (not in the hash) for budget sums.
import { makeAuditEvent, verifyAuditLink } from '@/domain/audit-event.js';
import type { AuditEvent, ModelTier } from '@/domain/audit-event.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { AppUserId, AuditEventId } from '@/domain/value-objects/ids.js';
import type { SpendLedger } from './cost-guardrails.js';

export interface AuditAppendInput {
  readonly action: string;
  readonly target: string;
  readonly actorId?: string;
  readonly at?: string;
  readonly costTokensIn?: number;
  readonly costTokensOut?: number;
  readonly costUsd?: number;
  readonly modelTier?: ModelTier;
  readonly incidentId?: string;
  readonly regionId?: string;
  /**
   * Content address of an evidence record held beside the chain (governance ledger, ADR-034 §5). Additive
   * and optional: absent ⇒ the appended payload and therefore the hash are byte-identical to before this
   * field existed, because the domain canonicalizer omits `undefined` keys.
   */
  readonly evidenceDigest?: string;
}

export interface AuditSink extends SpendLedger {
  append(input: AuditAppendInput): AuditEvent;
  verify(): boolean;
  readonly events: readonly AuditEvent[];
}

interface IndexedEvent {
  readonly event: AuditEvent;
  readonly incidentId?: string;
  readonly regionId?: string;
}

// Cost/actor/evidence-digest fields present only when supplied (kept out of a hash-changing `undefined`,
// F19/§9.3) — which is also why appending without `evidenceDigest` reproduces pre-change hashes exactly.
function costFields(input: AuditAppendInput): Record<string, unknown> {
  return {
    ...(input.actorId !== undefined ? { actorId: asId<AppUserId>(input.actorId) } : {}),
    ...(input.costTokensIn !== undefined ? { costTokensIn: input.costTokensIn } : {}),
    ...(input.costTokensOut !== undefined ? { costTokensOut: input.costTokensOut } : {}),
    ...(input.costUsd !== undefined ? { costUsd: input.costUsd } : {}),
    ...(input.modelTier !== undefined ? { modelTier: input.modelTier } : {}),
    ...(input.evidenceDigest !== undefined ? { evidenceDigest: input.evidenceDigest } : {}),
  };
}

export class AuditChain implements AuditSink {
  readonly #log: IndexedEvent[] = [];
  #seq = 0;

  append(input: AuditAppendInput): AuditEvent {
    const prev = this.#log.at(-1)?.event;
    const event = makeAuditEvent({
      id: asId<AuditEventId>(`ae-${++this.#seq}`),
      action: input.action,
      target: input.target,
      at: input.at ?? new Date().toISOString(),
      ...(prev ? { prevHash: prev.hash } : {}),
      ...costFields(input),
    });
    this.#log.push({
      event,
      ...(input.incidentId !== undefined ? { incidentId: input.incidentId } : {}),
      ...(input.regionId !== undefined ? { regionId: input.regionId } : {}),
    });
    return event;
  }

  /** Verify the whole chain: each link's stored hash must equal linkHash(prevHash, payload). */
  verify(): boolean {
    let prevHash: string | undefined;
    for (const { event } of this.#log) {
      if (!verifyAuditLink(event, prevHash)) return false;
      prevHash = event.hash;
    }
    return true;
  }

  spentForIncident(incidentId: string): number {
    return this.#log
      .filter((r) => r.incidentId === incidentId)
      .reduce((sum, r) => sum + (r.event.costUsd ?? 0), 0);
  }

  spentForRegion(regionId: string): number {
    return this.#log
      .filter((r) => r.regionId === regionId)
      .reduce((sum, r) => sum + (r.event.costUsd ?? 0), 0);
  }

  get events(): readonly AuditEvent[] {
    return this.#log.map((r) => r.event);
  }
}

export const makeAuditChain = (): AuditChain => new AuditChain();
