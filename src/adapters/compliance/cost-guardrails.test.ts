// BEACON — cost guardrail tests (E6·T-280…T-286; ADR-018/F17/CM-C13-C15).
import { describe, expect, it } from 'vitest';
import { CostGuard, DEFAULT_LIMITS, classifyEscalation } from './cost-guardrails.js';
import type { BudgetPolicy } from './types.js';
import type { SpendLedger as Ledger } from './cost-guardrails.js';

const BUDGET: BudgetPolicy = {
  per_incident_usd: 5,
  per_region_usd: 50,
  escalation_threshold_usd: 0.5,
  require_human_above_threshold: true,
};

const emptyLedger: Ledger = { spentForIncident: () => 0, spentForRegion: () => 0 };
const seededLedger = (incident: number, region = 0): Ledger => ({
  spentForIncident: () => incident,
  spentForRegion: () => region,
});

describe('CostGuard — 5 deterministic-floor guardrails', () => {
  it('(1) consumption cap: rejects an estimate above per-task ceiling (terminate)', () => {
    const g = new CostGuard(BUDGET, emptyLedger);
    const v = g.reserve({ estimatedUsd: 2.0 }); // > DEFAULT_LIMITS.maxUsdPerTask (1.0)
    expect(v.allowed).toBe(false);
    expect(v.escalation).toBe('terminate');
  });

  it('(2) temporal boundary: rejects once wall-clock is exceeded', () => {
    const g = new CostGuard(BUDGET, emptyLedger);
    expect(g.reserve({ estimatedUsd: 0.01, elapsedMs: DEFAULT_LIMITS.maxWallClockMs + 1 }).allowed).toBe(false);
  });

  it('(3) loop cap and (4) delegation-depth cap terminate a runaway plan', () => {
    const g = new CostGuard(BUDGET, emptyLedger);
    expect(g.reserve({ estimatedUsd: 0.01, loopCount: DEFAULT_LIMITS.maxLoops + 1 }).allowed).toBe(false);
    expect(g.reserve({ estimatedUsd: 0.01, depth: DEFAULT_LIMITS.maxDepth + 1 }).allowed).toBe(false);
  });

  it('(5) idempotency: a retried step debits/executes once (auto-affords on replay)', () => {
    const g = new CostGuard(BUDGET, emptyLedger);
    const first = g.reserve({ estimatedUsd: 0.1, idempotencyKey: 'step-A' });
    const retry = g.reserve({ estimatedUsd: 0.1, idempotencyKey: 'step-A' });
    expect(first.allowed).toBe(true);
    expect(first.reservedUsd).toBe(0.1);
    expect(retry.reservedUsd).toBe(0); // not double-counted
  });
});

describe('CostGuard — budget posture (soft within budget / hard-block on cap)', () => {
  it('auto-proceeds (soft) for a cheap call below the escalation threshold', () => {
    const g = new CostGuard(BUDGET, emptyLedger);
    const v = g.reserve({ estimatedUsd: 0.05 });
    expect(v.allowed).toBe(true);
    expect(v.escalation).toBe('proceed');
  });

  it('HARD-BLOCKS for HITL at/above escalation threshold (503, requiresHumanApproval)', () => {
    const g = new CostGuard(BUDGET, emptyLedger);
    const v = g.reserve({ estimatedUsd: 0.6 });
    expect(v.allowed).toBe(false);
    expect(v.status).toBe(503);
    expect(v.requiresHumanApproval).toBe(true);
  });

  it('proceeds above threshold once a human approved (soft-after-approval)', () => {
    const g = new CostGuard(BUDGET, emptyLedger);
    expect(g.reserve({ estimatedUsd: 0.6, humanApproved: true }).allowed).toBe(true);
  });

  it('HARD-BLOCKS when the cumulative per-incident cap would be exceeded (escalate)', () => {
    const g = new CostGuard(BUDGET, seededLedger(4.9));
    const v = g.reserve({ estimatedUsd: 0.3, incidentId: 'inc-1' }); // 4.9 + 0.3 > 5
    expect(v.allowed).toBe(false);
    expect(v.requiresHumanApproval).toBe(true);
  });
});

describe('classifyEscalation — degrade→escalate→terminate', () => {
  it('classifies posture without reserving', () => {
    expect(classifyEscalation({ estimatedUsd: 0.05 }, DEFAULT_LIMITS, emptyLedger, BUDGET)).toBe('proceed');
    expect(classifyEscalation({ estimatedUsd: 0.6 }, DEFAULT_LIMITS, emptyLedger, BUDGET)).toBe('escalate');
    expect(classifyEscalation({ estimatedUsd: 9 }, DEFAULT_LIMITS, emptyLedger, BUDGET)).toBe('terminate');
  });
});
