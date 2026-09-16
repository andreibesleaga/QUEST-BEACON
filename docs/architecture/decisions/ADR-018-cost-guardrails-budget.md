# ADR-018: Cost guardrails + budget posture (5 minimum-viable guardrails, pre-step reservation, soft-within-budget / hard-block-on-cap)

**Date:** 2026-06-29
**Status:** Accepted
**Deciders:** ops-security + prod-architect + human
**Tags:** ai | security | performance | governance

---

## Context

The LLM ladder (ADR-007) and the compliance gateway (ADR-017) bound per-call tokens, but an agentic
fusion pipeline can still amplify cost catastrophically — a token-flood / recursive prompt is "denial of
wallet" (THREAT_MODEL T6.4, LLM10), and abuse-flooded intake (T1.6) multiplies AI spend per incident. We
need runtime cost guardrails that stop a runaway plan *before* it spends, plus a clear budget posture
that distinguishes routine spend (auto) from spend that demands a human. Decided now because the gateway's
budget stage and the `config/policies.yml` `budget` block depend on it.

**Current state:** Art. X mandates frugality + human approval for high cost; `agent-analytics.skill`
describes reserve→execute→reconcile admission control and a deterministic floor; nothing binds them to
BEACON's incident/region budget. No code yet.
**Constraints:** ≈$0 default (Art. X); never weaken safety/HITL to save cost (AGENTS §5); deterministic +
auditable (Art. XII, XIII); degrade gracefully (Art. XVI).

## Options Considered

### Option A — 5 minimum-viable guardrails + pre-step reservation + circuit-breaker, soft-within-budget / hard-block-on-cap (CHOSEN)
**Five deterministic-floor guardrails** (harness-enforced, the agent cannot reason past them —
`agent-analytics.skill`): **(1) consumption cap** (absolute token/USD ceiling per task & session),
**(2) temporal/wall-clock boundary**, **(3) loop/pagination cap**, **(4) delegation-depth cap**,
**(5) idempotency/dedup keys** (a retried/re-reasoned step debits + executes once). In front of every
premium call: **pre-step cost reservation** — estimate worst case → `reserve()`/`can_afford()` → reject
at the gate on failure → execute → reconcile actual vs reserved → recompute forecast. A **circuit-breaker**
escalates **degrade → escalate → terminate** (descend the AI ladder → flag/hold for human → stop the run).
**Budget posture (LOCKED):** *soft within budget* (auto-proceed, per-call `AUDIT_EVENT`); **HARD-BLOCK +
human approval ONLY when a configurable cost threshold (`escalation_threshold_usd`) or a
per-incident/per-region/org budget cap is exceeded**; **safety controls always fail-closed** regardless of
budget.
**Pros:** stops runaways before spend (admission control); routine work stays autonomous (no approval
fatigue); the human is pulled in exactly when money is at stake (Art. X HITL); ties cleanly to the audit
trail; deterministic floor is un-gameable by a compromised/looping model.
**Cons:** worst-case estimation can over-reserve (mitigated by reconcile-and-release); five counters to
implement + test.
**Source:** `agent-analytics.skill` (admission control + deterministic floor); Art. X; THREAT_MODEL
T1.6/T6.4; OWASP LLM10; OWASP ASI04 (resource overload).

### Option B — Hard block on every AI call until approved
**Pros:** zero surprise spend. **Cons:** destroys the autonomous COP / TTTP<10s; approval fatigue; not
viable for a live emergency tool. Rejected.

### Option C — Soft caps only (audit overruns, never block)
**Pros:** simplest, never blocks. **Cons:** reactive — detects spend after it happened; no protection
against denial-of-wallet (T6.4); violates Art. X "human approval for high cost." Rejected (kept only as
the *within-budget* half of Option A).

## Decision

**We will use Option A.** Five deterministic-floor guardrails (consumption, temporal, loop,
delegation-depth, idempotency) + pre-step reservation (reserve→execute→reconcile) + a
degrade→escalate→terminate circuit-breaker. Budget posture: **soft within budget (auto + per-call audit);
HARD-BLOCK + human approval only when `escalation_threshold_usd` or a per-incident/per-region/org cap is
exceeded; safety always fail-closed.** Thresholds/caps live in `config/policies.yml` (`budget` block),
validated at boot against `schemas/policies.schema.json`.

## Consequences

**Positive:** denial-of-wallet stopped at the gate; autonomy preserved for cheap/reversible AI work;
human in the loop precisely at the money boundary; full cost attribution → `AUDIT_EVENT` + agent-analytics.
**Negative:** over-reservation can transiently under-utilize budget (reconciled back); estimator sits on a
deterministic floor it cannot bypass (intended).
**Neutral:** budget is per-incident and per-region (region isolation, TB9) — one region cannot starve
another.
**Risks:** mis-set thresholds block legitimate work or allow overspend → mitigated by config + audited
`version` + revisit at S06; estimator gaming → deterministic floor is authoritative (harness-checked).

## Y-Statement Summary

> For BEACON operators who must keep AI spend near $0 without gating routine narration behind a human,
> the cost-guardrail set (5 deterministic counters + pre-step reservation + a degrade→escalate→terminate
> breaker) auto-proceeds within budget and hard-blocks for human approval only above a configured
> threshold or cap; unlike block-everything or audit-only, it stops denial-of-wallet at the gate while
> preserving autonomy and never weakening safety.

## Tie-in to AUDIT_EVENT + agent-analytics

Every reservation, reconcile, escalation, hard-block, and human approval writes an `AUDIT_EVENT`
(`actor, action, target, time` + `costUSD`/`costTokensIn`/`costTokensOut`/`modelTier` — the ADR-022
extension). agent-analytics' loop/cost-anomaly detection feeds the breaker's escalate rung; the weekly
report aggregates per-incident/per-region spend with hard-math validation (no hallucinated totals).

## Standards mapping
LLM10 (unbounded consumption) · OWASP ASI04 (resource overload) · NIST AI RMF MANAGE (act on prioritized
risk) · EU AI Act Art.9 (risk management) / Art.14 (human oversight on the hard-block) · Constitution Art.
X (cost), XIII (HITL + audit), XVI (graceful degrade rung).

## Links
- **SPEC:** §8.1 (circuit-breaker thresholds), §10.1 (LLM budget), §10.2 (security); **THREAT_MODEL:** T1.6, T6.4.
- **Constitution:** Art. X, XII, XIII, XVI.
- **Related ADRs:** ADR-017 (gateway budget stage), ADR-007 (ladder degrade rung), ADR-022 (cost attribution in AUDIT_EVENT).
- **Skills:** `core/agent-analytics` (admission control + deterministic floor), `ops/cost-optimization`.
- **Schema/config:** `schemas/policies.schema.json` (`budget`), `config/policies.yml`; **matrix:** `../COMPLIANCE_MATRIX.md`.
- **Implementation:** S05 — pending S04 gate.

## Review
**Approved by:** ops-security + human, 2026-06-29 · **Implementation complete:** Yes (Phase-B/C/D) · **Revisit:** S06 (calibrate thresholds against measured per-incident spend).
