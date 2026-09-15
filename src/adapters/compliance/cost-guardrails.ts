// BEACON — cost guardrails + budget posture (E6·T-280/T-282/T-284/T-286; ADR-018/F17/CM-C13-C15).
// FIVE deterministic-floor guardrails (the model cannot reason past them): (1) consumption cap,
// (2) temporal/wall-clock boundary, (3) loop/pagination cap, (4) delegation-depth cap, (5) idempotency
// (a retried step debits + executes ONCE). Plus pre-step reservation (reserve→execute→reconcile) and a
// degrade→escalate→terminate posture. Budget posture: SOFT within budget (auto-proceed + per-call audit);
// HARD-BLOCK + human approval ONLY at/above escalation_threshold_usd or a per-incident/per-region cap.
// Safety controls elsewhere remain fail-closed regardless of budget.
import type { BudgetPolicy, GatewayStatus } from './types.js';

export interface GuardLimits {
  readonly maxUsdPerTask: number; // (1) consumption cap
  readonly maxWallClockMs: number; // (2) temporal boundary
  readonly maxLoops: number; // (3) loop/pagination cap
  readonly maxDepth: number; // (4) delegation-depth cap
}

export const DEFAULT_LIMITS: GuardLimits = {
  maxUsdPerTask: 1.0,
  maxWallClockMs: 30_000,
  maxLoops: 25,
  maxDepth: 5,
};

export interface ReserveInput {
  readonly estimatedUsd: number;
  readonly incidentId?: string;
  readonly regionId?: string;
  readonly idempotencyKey?: string;
  readonly loopCount?: number;
  readonly depth?: number;
  readonly elapsedMs?: number;
  readonly humanApproved?: boolean;
}

export type Escalation = 'proceed' | 'degrade' | 'escalate' | 'terminate';

export interface ReserveVerdict {
  readonly allowed: boolean;
  readonly status: GatewayStatus; // 200 allow, 503 hold/hard-block
  readonly escalation: Escalation;
  readonly reservedUsd: number;
  readonly reason?: string;
  readonly requiresHumanApproval?: boolean;
}

/** Cumulative spend the guard consults before reserving (summed from the AUDIT_EVENT trail, D-29). */
export interface SpendLedger {
  spentForIncident(incidentId: string): number;
  spentForRegion(regionId: string): number;
}

const deny = (
  status: GatewayStatus,
  escalation: Escalation,
  reason: string,
  requiresHumanApproval: boolean,
): ReserveVerdict => ({
  allowed: false,
  status,
  escalation,
  reservedUsd: 0,
  reason,
  ...(requiresHumanApproval ? { requiresHumanApproval } : {}),
});

// (1)-(4): deterministic floors — hard terminate, un-gameable by a looping/compromised model.
function checkFloors(input: ReserveInput, limits: GuardLimits): ReserveVerdict | null {
  if ((input.loopCount ?? 0) > limits.maxLoops)
    return deny(503, 'terminate', 'loop/pagination cap exceeded', false);
  if ((input.depth ?? 0) > limits.maxDepth)
    return deny(503, 'terminate', 'delegation-depth cap exceeded', false);
  if ((input.elapsedMs ?? 0) > limits.maxWallClockMs)
    return deny(503, 'terminate', 'wall-clock boundary exceeded', false);
  if (input.estimatedUsd > limits.maxUsdPerTask)
    return deny(503, 'terminate', 'per-task consumption cap exceeded', false);
  return null;
}

// Per-incident / per-region hard caps → HARD-BLOCK + escalate for human (never auto-proceed).
function checkCaps(
  input: ReserveInput,
  ledger: SpendLedger,
  budget: BudgetPolicy,
): ReserveVerdict | null {
  const incidentTotal =
    (input.incidentId ? ledger.spentForIncident(input.incidentId) : 0) + input.estimatedUsd;
  if (input.incidentId && incidentTotal > budget.per_incident_usd) {
    return deny(
      503,
      'escalate',
      `per-incident budget cap $${budget.per_incident_usd} would be exceeded`,
      true,
    );
  }
  const regionTotal =
    (input.regionId ? ledger.spentForRegion(input.regionId) : 0) + input.estimatedUsd;
  if (input.regionId && regionTotal > budget.per_region_usd) {
    return deny(
      503,
      'escalate',
      `per-region budget cap $${budget.per_region_usd} would be exceeded`,
      true,
    );
  }
  return null;
}

// Soft escalation threshold → HITL hold unless already human-approved (soft within budget otherwise).
function checkEscalation(input: ReserveInput, budget: BudgetPolicy): ReserveVerdict {
  const atThreshold = input.estimatedUsd >= budget.escalation_threshold_usd;
  if (atThreshold && budget.require_human_above_threshold && !input.humanApproved) {
    return deny(
      503,
      'escalate',
      `reserved $${input.estimatedUsd} ≥ escalation threshold $${budget.escalation_threshold_usd} — human approval required`,
      true,
    );
  }
  return {
    allowed: true,
    status: 200,
    escalation: atThreshold ? 'escalate' : 'proceed',
    reservedUsd: input.estimatedUsd,
  };
}

/** Classify spend posture without reserving (degrade→escalate→terminate; T-283/T-284). */
export function classifyEscalation(
  input: ReserveInput,
  limits: GuardLimits,
  ledger: SpendLedger,
  budget: BudgetPolicy,
): Escalation {
  const floor = checkFloors(input, limits);
  if (floor) return floor.escalation;
  const cap = checkCaps(input, ledger, budget);
  if (cap) return cap.escalation;
  return checkEscalation(input, budget).escalation;
}

export class CostGuard {
  readonly #limits: GuardLimits;
  readonly #ledger: SpendLedger;
  readonly #budget: BudgetPolicy;
  readonly #seen = new Set<string>(); // idempotency (5): a retried step is not double-counted

  constructor(budget: BudgetPolicy, ledger: SpendLedger, limits: GuardLimits = DEFAULT_LIMITS) {
    this.#budget = budget;
    this.#ledger = ledger;
    this.#limits = limits;
  }

  /** Pre-step reservation: reserve→(execute)→reconcile. Rejects at the gate on any guardrail/cap breach. */
  reserve(input: ReserveInput): ReserveVerdict {
    // (5) idempotency: a step already reserved is executed/debited once — a retry auto-affords at $0.
    if (input.idempotencyKey && this.#seen.has(input.idempotencyKey)) {
      return { allowed: true, status: 200, escalation: 'proceed', reservedUsd: 0 };
    }
    const verdict =
      checkFloors(input, this.#limits) ??
      checkCaps(input, this.#ledger, this.#budget) ??
      checkEscalation(input, this.#budget);
    if (verdict.allowed && input.idempotencyKey) this.#seen.add(input.idempotencyKey);
    return verdict;
  }
}
