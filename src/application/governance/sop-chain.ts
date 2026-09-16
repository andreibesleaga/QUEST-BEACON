// BEACON — SOP approval chain use-case (MW-D/D4; ADR-034 §6, FR-GOV-2 / FST-4, Art. XIII).
// Pure: imports ports and the domain only, never adapters. Reads NO clock — both instants are injected.
//
// The deadlock being fixed: an approval only one role may give stalls when that role is unavailable, and the
// tempting fix is an auto-approve timeout, which deletes Art. XIII. This chain DELEGATES instead — after a
// configured window a SECOND human role becomes co-responsible. Approval stays required, human and recorded,
// and the ledger records WHICH role actually acted (FST-4).
//
// The algebra lives in `@/domain/governance.js` (`resolveApproval`) so it is testable with no ports at all;
// this module adds exactly one thing: the governance record. Whoever approved is recorded by ID and ROLE —
// never by name (Art. XIV).
import type { Result } from '@/domain/shared/result.js';
import { err, ok } from '@/domain/shared/result.js';
import { DomainError } from '@/domain/errors.js';
import type { IncidentId } from '@/domain/value-objects/ids.js';
import type { ApprovalAttempt, ApprovalOutcome, SopChainConfig } from '@/domain/governance.js';
import { resolveApproval } from '@/domain/governance.js';
import type { GovernanceLedgerPort } from '@/ports/governance.js';
import { DEFAULT_GOVERNANCE_CONFIG } from './governance-config.js';

export interface SopApprovalRequest {
  /** What is being approved, e.g. `eap:ro-flood-2026#ep-1` or `alert:al-7`. Never a person. */
  readonly target: string;
  /** When approval was requested — the instant the fallback window is measured from (injected). */
  readonly requestedAt: string;
  /** "Now", injected. Together with `requestedAt` this makes the responsible role a pure function. */
  readonly now: string;
  /** A human's approval attempt. Absent ⇒ the request is simply still pending. */
  readonly attempt?: ApprovalAttempt;
  /** Per-protocol override (e.g. an EAP's `approval` block); defaults to the shipped governance config. */
  readonly config?: SopChainConfig;
  readonly incidentId?: IncidentId;
}

export interface SopApprovalDecision {
  readonly outcome: ApprovalOutcome;
  /** The ledger link committing the approval. Present only on an APPROVED outcome. */
  readonly ledgerHash?: string;
}

export interface SopChainDeps {
  /** Optional: without a ledger the decision is still correct, just unrecorded (used by pure tests). */
  readonly ledger?: GovernanceLedgerPort;
}

/**
 * Decide an approval and record it.
 *   • no attempt              ⇒ ok(PENDING) with the currently responsible role(s) — never an approval;
 *   • an attempt not accepted ⇒ err(UNAUTHORIZED) — the rejection is surfaced, not silently swallowed;
 *   • an accepted attempt     ⇒ ok(APPROVED) + a `SOP_APPROVE` ledger entry naming the acting role.
 *
 * There is no fourth branch, and `ApprovalOutcome`'s PENDING arm has no property carrying an approver, so
 * "nobody approved but it went out" is not a state this function can return in ANY configuration.
 */
export function decideSopApproval(
  deps: SopChainDeps,
  request: SopApprovalRequest,
): Result<SopApprovalDecision, DomainError> {
  const config = request.config ?? DEFAULT_GOVERNANCE_CONFIG.approval;
  const outcome = resolveApproval(config, request.requestedAt, request.now, request.attempt);
  if (outcome.state === 'PENDING') {
    if (request.attempt === undefined) return ok({ outcome });
    return err(
      new DomainError(
        'UNAUTHORIZED',
        `approval of ${request.target} refused: role ${request.attempt.role} is not responsible now ` +
          `(responsible: ${outcome.responsibleRoles.join('|')}) — Art. XIII`,
      ),
    );
  }
  if (deps.ledger === undefined) return ok({ outcome });
  const appended = deps.ledger.append({
    action: 'SOP_APPROVE',
    target: request.target,
    at: outcome.approval.approvedAt,
    actorId: outcome.approval.approvedBy,
    actorRole: outcome.approval.approvedByRole,
    ...(request.incidentId !== undefined ? { incidentId: request.incidentId } : {}),
    evidence: {
      requestedAt: request.requestedAt,
      decidedAt: request.now,
      authorizerRole: config.authorizerRole,
      fallbackRole: config.fallbackRole,
      fallbackAfterMinutes: config.fallbackAfterMinutes,
      delegated: outcome.approval.delegated,
    },
  });
  if (!appended.ok) return appended;
  return ok({ outcome, ledgerHash: appended.value.hash });
}
