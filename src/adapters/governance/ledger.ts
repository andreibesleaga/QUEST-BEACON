// BEACON — governance ledger adapter (MW-D/D4; ADR-034 §5, FR-GOV-1 / FEV-19).
//
// THIS IS NOT A SECOND HASH CHAIN. It is a thin, typed writer over the EXISTING one:
// `makeAuditChain()` (`src/adapters/compliance/audit-chain.ts`), whose link is the DOMAIN primitive
// `linkHash`/`verifyAuditLink` (`src/domain/audit-event.ts`) and which the CAP emitter already writes to
// (`src/adapters/alerting/alert-sink.ts:94`). Pass the SAME `AuditSink` into `makeAlertSink` and into this
// ledger and trigger decisions, approvals, drills, retention sweeps and alert emissions land in ONE
// verifiable chain — which is the point: two chains would be two things to verify and two ways to disagree.
//
// What this adapter adds on top of the chain:
//  1. A CLOSED action vocabulary (`LEDGER_ACTIONS`) — a governance record cannot be an arbitrary string.
//  2. Evidence CONTENT-ADDRESSING: bulky evidence is stored append-only beside the chain and bound to it by
//     `evidenceDigest`, so the chain stays small and PII-free (Art. XIV) while tampering with the stored
//     evidence is still detectable (`verify()` recomputes every digest).
//  3. A FAIL-CLOSED person-identifying-key walk over that evidence (Art. XIV): a governance record is about
//     a decision, never about a reporter. The error names the offending KEY PATH and never its value.
//  4. Per-entry verification granularity: `verify()` reports WHERE the chain first breaks and why.
//
// `actorRole` (FST-4's "record which role actually acted") travels inside the digested evidence envelope
// rather than as a new chain-payload field: ADR-034 §5 deliberately limited the shared `AuditPayload` to ONE
// additive field (`evidenceDigest`), and the envelope is bound by that digest, so the role is tamper-evident
// either way.
import type { AuditEvent } from '@/domain/audit-event.js';
import { evidenceDigest as digestOf, verifyAuditLink } from '@/domain/audit-event.js';
import { DomainError } from '@/domain/errors.js';
import type { Result } from '@/domain/shared/result.js';
import { err, ok } from '@/domain/shared/result.js';
import type { AppUserRole } from '@/domain/app-user.js';
import type { LedgerEntry } from '@/domain/governance.js';
import { LEDGER_ACTIONS, findPersonIdentifyingKey, makeLedgerEntry } from '@/domain/governance.js';
import type {
  GovernanceLedgerPort,
  LedgerAppendInput,
  LedgerVerification,
} from '@/ports/governance.js';
import type { AuditAppendInput, AuditSink } from '@/adapters/compliance/audit-chain.js';
import { makeAuditChain } from '@/adapters/compliance/audit-chain.js';

export interface GovernanceLedgerDeps {
  /**
   * Share an existing chain (e.g. the one `makeAlertSink` writes to) so governance decisions and alert
   * emissions are ONE verifiable sequence. Defaults to a fresh in-memory chain.
   */
  readonly audit?: AuditSink;
}

/** The ledger plus its inspection surface. The chain itself stays reachable for cross-writer verification. */
export interface GovernanceLedger extends GovernanceLedgerPort {
  readonly audit: AuditSink;
}

/** The digested envelope: the caller's evidence plus the acting role, as ONE content-addressed record. */
interface EvidenceEnvelope {
  readonly actorRole?: AppUserRole;
  readonly evidence?: unknown;
}

/** Reject malformed input BEFORE it can touch the chain — an append-only log must never hold a bad row. */
function validate(input: LedgerAppendInput): DomainError | undefined {
  if (!(LEDGER_ACTIONS as readonly string[]).includes(input.action)) {
    return new DomainError(
      'INVARIANT_VIOLATION',
      `ledger action must be one of ${LEDGER_ACTIONS.join('|')}, got ${String(input.action)}`,
    );
  }
  if (input.target.trim().length === 0) {
    return new DomainError('INVARIANT_VIOLATION', 'ledger target must be non-empty');
  }
  if (Number.isNaN(Date.parse(input.at))) {
    return new DomainError(
      'INVARIANT_VIOLATION',
      `ledger 'at' must be an ISO-8601 instant from the injected clock, got ${input.at}`,
    );
  }
  return undefined;
}

/** Build the digested envelope, or `undefined` when there is nothing beside the chain to bind. */
function envelopeOf(input: LedgerAppendInput): EvidenceEnvelope | undefined {
  if (input.actorRole === undefined && input.evidence === undefined) return undefined;
  return {
    ...(input.actorRole !== undefined ? { actorRole: input.actorRole } : {}),
    ...(input.evidence !== undefined ? { evidence: input.evidence } : {}),
  };
}

/** The chain-writer payload. Ids are stringified; nothing person-identifying is ever in here. */
function toAuditInput(input: LedgerAppendInput, digest: string | undefined): AuditAppendInput {
  return {
    action: input.action,
    target: input.target,
    at: input.at,
    ...(input.actorId !== undefined ? { actorId: String(input.actorId) } : {}),
    ...(input.incidentId !== undefined ? { incidentId: String(input.incidentId) } : {}),
    ...(input.regionId !== undefined ? { regionId: input.regionId } : {}),
    ...(digest !== undefined ? { evidenceDigest: digest } : {}),
  };
}

/** Project a chain event + its position into the ledger's read model. */
function toEntry(event: AuditEvent, seq: number, actorRole: AppUserRole | undefined): LedgerEntry {
  return makeLedgerEntry({
    seq,
    action: event.action as LedgerEntry['action'],
    target: event.target,
    at: event.at,
    hash: event.hash,
    ...(event.actorId !== undefined ? { actorId: event.actorId } : {}),
    ...(actorRole !== undefined ? { actorRole } : {}),
    ...(event.evidenceDigest !== undefined ? { evidenceDigest: event.evidenceDigest } : {}),
    ...(event.prevHash !== undefined ? { prevHash: event.prevHash } : {}),
  });
}

/**
 * Build the governance ledger. Append-only by construction: there is no update, no delete and no way to
 * reorder — `entries` is a projection of the chain, and the evidence store only ever gains keys.
 */
export function makeGovernanceLedger(deps: GovernanceLedgerDeps = {}): GovernanceLedger {
  const audit = deps.audit ?? makeAuditChain();
  const evidence = new Map<string, EvidenceEnvelope>();
  const mine: LedgerEntry[] = [];

  function append(input: LedgerAppendInput): Result<LedgerEntry, DomainError> {
    const invalid = validate(input);
    if (invalid !== undefined) return err(invalid);
    const envelope = envelopeOf(input);
    // Art. XIV, fail closed. The message names the key PATH only — never the value, which would copy the
    // very datum being refused into an error string and, from there, into a log.
    const offending = envelope === undefined ? undefined : findPersonIdentifyingKey(envelope);
    if (offending !== undefined) {
      return err(
        new DomainError(
          'CONFLICT',
          `ledger evidence for ${input.action} carries a person-identifying key '${offending}' — a ` +
            'governance record records a decision and an actor id, never a person (Art. XIV)',
        ),
      );
    }
    const digest = envelope === undefined ? undefined : digestOf(envelope);
    if (digest !== undefined && envelope !== undefined) evidence.set(digest, envelope);
    const event = audit.append(toAuditInput(input, digest));
    const entry = toEntry(event, audit.events.length, input.actorRole);
    mine.push(entry);
    return ok(entry);
  }

  /**
   * Verify the WHOLE chain (not just this ledger's own entries — a splice anywhere invalidates every later
   * link) using the domain's own `verifyAuditLink`, then re-derive every stored evidence digest.
   */
  function verify(): LedgerVerification {
    const events = audit.events;
    let prevHash: string | undefined;
    for (const [index, event] of events.entries()) {
      if (!verifyAuditLink(event, prevHash)) {
        return { intact: false, entries: events.length, brokenAt: index + 1, reason: 'CHAIN_LINK' };
      }
      const stored =
        event.evidenceDigest === undefined ? undefined : evidence.get(event.evidenceDigest);
      if (stored !== undefined && digestOf(stored) !== event.evidenceDigest) {
        return {
          intact: false,
          entries: events.length,
          brokenAt: index + 1,
          reason: 'EVIDENCE_DIGEST',
        };
      }
      prevHash = event.hash;
    }
    return { intact: true, entries: events.length };
  }

  return {
    append,
    get entries(): readonly LedgerEntry[] {
      return mine;
    },
    evidenceFor: (digest: string): unknown => evidence.get(digest),
    verify,
    audit,
  };
}
