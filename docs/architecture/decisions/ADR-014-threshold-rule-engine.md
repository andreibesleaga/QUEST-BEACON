# ADR-014: Declarative JSON threshold-rule engine (early-warning)

**Date:** 2026-06-27
**Status:** Accepted
**Deciders:** prod-architect + human
**Tags:** domain, alerting, early-warning

---

## Context

FR-11 requires threshold-triggered early-warning alerts (gauge crosses a flood category; hazard polygon
enters an infrastructure buffer). This must be **deterministic, testable, and configurable per region**,
and must never auto-emit a public alert (Constitution Art. XIII). A representation was sketched in
`docs/audit/v1/CLARIFICATIONS.md` §B.Q5; this ADR records it as the decision.

**Current state:** Phase-2 named FR-11 and one Gherkin scenario but no rule representation/semantics.
**Constraints:** deterministic (Art. XII); HITL before CAP (Art. XIII); per-region; flap-safe.

## Options Considered

### Option A — Declarative JSON rules over the canonical model, edge-triggered (CHOSEN)
`{ target: GAUGE_CATEGORY|HAZARD_BUFFER, operator: crosses|gte|enters, value, scope: region_id,
hysteresis, cooldown }`, evaluated each ingestion cycle; a transition across `value` creates a **DRAFT**
ALERT with provenance to the triggering SOURCE_RECORD.
**Pros:** simple, serializable, versionable, unit-testable, per-region; no engine dependency.
**Cons:** limited to declared targets (extend by adding target kinds).
**Source:** PRISM threshold-alert pattern (S00 MARKET_SCAN); CLARIFICATIONS §B.Q5.

### Option B — Embedded rules engine (e.g. json-rules-engine / Drools-style)
**Pros:** richer expressions. **Cons:** dependency + complexity beyond demo needs; harder to audit; YAGNI (Art. III).

### Option C — Hardcoded threshold checks in code
**Pros:** fastest. **Cons:** not configurable per region; violates config-for-everything (Art. XV/U5).

## Decision

**We will use Option A** — declarative JSON rules, edge-triggered with `hysteresis` (min dwell to avoid
flap) and `cooldown` (de-dup repeat fires). Fires create **DRAFT** alerts only; promotion to ACTUAL CAP
requires human approval (Art. XIII). Evaluation is pure/deterministic and unit-tested.

## Consequences

**Positive:** reproducible early warning; per-region tuning via config; trivially testable; no broker.
**Negative:** new target kinds require a small code addition (acceptable; Rule-of-Three).
**Neutral:** rules live in the region registry / config.
**Risks:** alert flapping → mitigated by hysteresis/cooldown; missed transitions on ingest gaps → mitigated by last-known-good + freshness.

## Y-Statement
> For emergency managers needing trustworthy early warning, a declarative edge-triggered threshold-rule
> engine is a deterministic alerting approach that creates auditable DRAFT alerts; unlike a hardcoded or
> heavyweight rules engine, it is per-region-configurable, flap-safe, and unit-testable.

## Links
- PRD FR-11 / EARS EV6; `docs/audit/v1/CLARIFICATIONS.md` §B.Q5; Constitution Art. XII, XIII.
- Depicted in `../C4_ARCHITECTURE.md` Flow C; `../DOMAIN_MODEL.md` (THRESHOLD_RULE, ALERT state machine).

## Review
**Approved by:** human, 2026-06-27 · **Revisit:** S03 (formalize JSON-Schema for rules).
