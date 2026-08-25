// BEACON — GOVERNANCE domain (MW-D/D4; ADR-034 §5/§6, SPEC-FINAL-VERSION-DELTA §4 `LedgerEntry`).
// Pure TS — no framework/HTTP/DB imports (F9). Three closed vocabularies + one entity + the pure SOP
// approval algebra. Everything here is deterministic: not one function reads a clock, a file or an env var.
//
// WHY THE LEDGER IS NOT A NEW HASH CHAIN. The chain link is the EXISTING domain primitive
// (`linkHash`/`verifyAuditLink`, `./audit-event.ts`) already used by the compliance chain and the CAP
// emitter (`src/adapters/compliance/audit-chain.ts`, `src/adapters/alerting/alert-sink.ts:94`). A
// `LedgerEntry` is a PROJECTION of an `AuditEvent` in that one chain, not a parallel log — two chains in one
// system would mean two things to verify and two ways to disagree, which is a governance defect. The only
// additive change this task made to the chain is the optional `evidenceDigest` field (see `./audit-event.ts`).
import type { AppUserId } from './value-objects/ids.js';
import type { AppUserRole } from './app-user.js';
import { invariant } from './shared/guard.js';
import { findPersonIdentifyingRuntimeKeys } from './shared/aggregate-only.js';

/**
 * The closed ledger vocabulary (FEV-19 / ADR-034 §5). A governance record whose action is not in this list
 * cannot be appended — so "what kinds of decision are auditable" is a reviewable enum, not whatever string
 * a caller happened to pass. `EAP_*` are the anticipatory engine's (lane D2, which writes through the port
 * and never touches the chain); `SOP_APPROVE` is the approval chain; `DRILL_*` the exercise lifecycle;
 * `RETENTION_PURGE` the Art. XIV retention sweep.
 */
export const LEDGER_ACTIONS = [
  'EAP_EVAL',
  'EAP_TRANSITION',
  'EAP_ACTIVATE',
  'EAP_APPROVE',
  'EAP_STOP',
  'SOP_APPROVE',
  'DRILL_START',
  'DRILL_ARTIFACT',
  'DRILL_END',
  'RETENTION_PURGE',
] as const;
export type LedgerAction = (typeof LEDGER_ACTIONS)[number];

/**
 * The roles that may APPROVE (Art. XIII: a human VERIFIER/EM). This set is the reason the SOP chain cannot
 * resolve to "nobody approved but it went out": both the primary authorizer and the delegated fallback are
 * drawn from it, so a delegation widens WHO may approve and never WHETHER approval is required.
 */
export const APPROVER_ROLES = ['VERIFIER', 'EM'] as const;
export type ApproverRole = (typeof APPROVER_ROLES)[number];

/** True when a role carries approval authority (Art. XIII). PUBLIC/RESPONDER never do. */
export function isApproverRole(role: AppUserRole): role is ApproverRole {
  return (APPROVER_ROLES as readonly string[]).includes(role);
}

/**
 * The first person-identifying key path anywhere in `value`, or `undefined`. The ledger calls this on
 * candidate evidence and fails closed (Art. XIV): a governance record is about a decision, never about a
 * reporter.
 *
 * IT DEFINES NO DENYLIST OF ITS OWN. It delegates to `findPersonIdentifyingRuntimeKeys`
 * (`./shared/aggregate-only.ts`, ADR-035 §4 Layer C), which is the ONE list — exact + substring, with an
 * opt-in allowlist — that the D6 no-person-identifying-field layers already check against. A second
 * denylist would be two things to keep in step and two ways to disagree, which is the same argument
 * ADR-034 §5 makes for there being one hash chain. **No allowlist is passed**: a governance record gets
 * zero exemptions, which is stricter than a D6 export payload and deliberately so.
 *
 * RESIDUAL RISK, accepted and stated: structure catches key SHAPE, not content — a person's name typed
 * into a free-text field legitimately called `note` is not detectable here.
 */
export function findPersonIdentifyingKey(value: unknown): string | undefined {
  return findPersonIdentifyingRuntimeKeys(value)[0];
}

/**
 * One append-only governance record (SPEC-FINAL-VERSION-DELTA §4). Deliberately carries NO person-
 * identifying field: an actor is an `AppUserId` and a ROLE, never a name (Art. XIV). `evidenceDigest`
 * content-addresses the full evidence record held beside the chain, so tampering with the evidence is
 * detectable without putting the evidence (which may be large) inside the hash-chained payload.
 */
export interface LedgerEntry {
  readonly seq: number; // 1-based position in the chain — the "append-only" ordering, not an identity
  readonly action: LedgerAction;
  readonly target: string; // e.g. `eap:<id>#<episodeId>`, `alert:<id>`, `retention:public_report`
  readonly at: string; // ISO-8601 UTC — ALWAYS an injected clock, never a wall-clock read
  readonly actorId?: AppUserId; // absent for machine evaluations (ADR-034 §5)
  readonly actorRole?: AppUserRole; // which role actually acted — FST-4's delegation record
  readonly evidenceDigest?: string;
  readonly prevHash?: string; // absent for the genesis entry
  readonly hash: string;
}

/** Validated construction of a ledger entry. Throws `InvariantViolation` on anything malformed. */
export function makeLedgerEntry(input: LedgerEntry): LedgerEntry {
  invariant(
    (LEDGER_ACTIONS as readonly string[]).includes(input.action),
    `LedgerEntry.action must be one of ${LEDGER_ACTIONS.join('|')}, got ${String(input.action)}`,
  );
  invariant(Number.isInteger(input.seq) && input.seq >= 1, `LedgerEntry.seq must be a positive integer, got ${input.seq}`);
  invariant(input.target.trim().length > 0, 'LedgerEntry.target must be non-empty');
  invariant(!Number.isNaN(Date.parse(input.at)), `LedgerEntry.at must be a valid instant: ${input.at}`);
  invariant(input.hash.trim().length > 0, 'LedgerEntry.hash must be non-empty');
  return Object.freeze({ ...input });
}

// ── SOP approval chain (ADR-034 §6 / FR-GOV-2 / FST-4) ────────────────────────────────────────────
//
// The deadlock this solves: an approval that only ONE role may give stalls when that role is unavailable,
// and the tempting "fix" is an auto-approve timeout — which deletes Art. XIII. The chain instead DELEGATES:
// after `fallbackAfterMinutes` a second HUMAN role becomes co-responsible. Approval is still required, still
// human, still recorded (with which role actually acted).

/** The SOP approval parameters. Config-as-data (ADR-012) — see `config/governance.json`. */
export interface SopChainConfig {
  readonly authorizerRole: ApproverRole;
  readonly fallbackRole: ApproverRole;
  readonly fallbackAfterMinutes: number;
}

/** A human approval attempt, as recorded. `role` is the actor's role AT THE TIME (RBAC-resolved). */
export interface ApprovalAttempt {
  readonly actorId: AppUserId;
  readonly role: AppUserRole;
  readonly at: string; // ISO-8601 UTC
}

/**
 * Proof that a HUMAN approved, and which one. There is deliberately no way to build this value other than
 * `resolveApproval` accepting an attempt by an approver-capable, currently-responsible role — so a caller
 * cannot fabricate approval, and `PENDING` has no `approvedBy` property to read (`tsc` enforces it).
 */
export interface SopApproval {
  readonly approvedBy: AppUserId;
  readonly approvedByRole: ApproverRole;
  readonly approvedAt: string;
  /** True when the FALLBACK role acted rather than the primary authorizer (FST-4 records which one acted). */
  readonly delegated: boolean;
}

/** Approval is either still outstanding, or granted by a named human. There is no third state. */
export type ApprovalOutcome =
  | {
      readonly state: 'PENDING';
      /** The role(s) that may approve right now — one before the fallback window, two after. */
      readonly responsibleRoles: readonly ApproverRole[];
      /** True once the fallback role has become co-responsible (the delegation is open). */
      readonly delegationOpen: boolean;
    }
  | { readonly state: 'APPROVED'; readonly approval: SopApproval };

const MINUTE_MS = 60_000;

/**
 * The roles responsible for an approval requested at `requestedAt`, as of `now`. Pure function of the
 * INJECTED instants (ADR-034 §6): the primary authorizer alone until `requestedAt +
 * fallbackAfterMinutes`, both roles at or after it. Never empty — an empty set would be a deadlock, which
 * is the whole defect being fixed here.
 */
export function responsibleRoles(
  config: SopChainConfig,
  requestedAt: string,
  now: string,
): readonly ApproverRole[] {
  const elapsedMs = Date.parse(now) - Date.parse(requestedAt);
  const open = elapsedMs >= config.fallbackAfterMinutes * MINUTE_MS;
  return open ? [config.authorizerRole, config.fallbackRole] : [config.authorizerRole];
}

/**
 * Resolve the approval state. `attempt` absent ⇒ PENDING. An attempt by a role that is not currently
 * responsible ⇒ still PENDING (never a silent grant): the caller surfaces it as a FORBIDDEN, and because
 * the returned value is not `APPROVED` there is no property carrying an approver to mistake for one.
 *
 * This function is the ONLY producer of `SopApproval`, and it produces one only from an `ApprovalAttempt`
 * that carries a real `actorId` and an approver role. That is the structural reason no configuration can
 * yield "nobody approved but it went out" — see `sop-chain.test.ts`, which asserts it over the exhaustive
 * cross-product of configs, clocks and actor roles.
 */
export function resolveApproval(
  config: SopChainConfig,
  requestedAt: string,
  now: string,
  attempt?: ApprovalAttempt,
): ApprovalOutcome {
  const roles = responsibleRoles(config, requestedAt, now);
  const pending = { state: 'PENDING', responsibleRoles: roles, delegationOpen: roles.length > 1 } as const;
  if (attempt === undefined) return pending;
  // Art. XIII, defence in depth: an approver-capable role AND currently responsible AND a non-empty id.
  if (!isApproverRole(attempt.role)) return pending;
  if (!roles.includes(attempt.role)) return pending;
  if (String(attempt.actorId).trim().length === 0) return pending;
  return {
    state: 'APPROVED',
    approval: {
      approvedBy: attempt.actorId,
      approvedByRole: attempt.role,
      approvedAt: attempt.at,
      delegated: attempt.role === config.fallbackRole,
    },
  };
}

/**
 * Validate a SOP chain's shape (used by the config parser AND by any caller passing a per-protocol
 * override, e.g. an EAP's `approval` block). Both roles must be approver-capable and the fallback window
 * must be a positive finite number of minutes — a zero/negative window would make the delegation
 * unconditional, which is a policy decision that must be written as two co-equal roles, not smuggled in
 * as a timeout of nothing.
 */
export function assertValidSopChain(config: SopChainConfig, at: string): void {
  invariant(isApproverRole(config.authorizerRole), `${at}.authorizerRole must be one of ${APPROVER_ROLES.join('|')}`);
  invariant(isApproverRole(config.fallbackRole), `${at}.fallbackRole must be one of ${APPROVER_ROLES.join('|')}`);
  // A fallback identical to the primary is a delegation that does nothing while LOOKING configured — the
  // exact deadlock this mechanism exists to remove. Say "only EM may approve" by having no fallback block,
  // not by naming EM twice. (Direction is deliberately unconstrained: delegating down (EM→VERIFIER, the
  // WMO "delegation of authority" case) and escalating up (VERIFIER→EM) are both legitimate SOPs.)
  invariant(
    config.fallbackRole !== config.authorizerRole,
    `${at}.fallbackRole must differ from authorizerRole (both ${config.authorizerRole}) — a self-delegation is a no-op`,
  );
  invariant(
    Number.isFinite(config.fallbackAfterMinutes) && config.fallbackAfterMinutes > 0,
    `${at}.fallbackAfterMinutes must be a positive number of minutes, got ${String(config.fallbackAfterMinutes)}`,
  );
}
