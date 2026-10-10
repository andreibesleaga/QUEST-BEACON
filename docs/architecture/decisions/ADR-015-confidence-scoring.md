# ADR-015: Deterministic confidence-scoring for public reports

**Date:** 2026-06-27
**Status:** Accepted
**Deciders:** prod-architect + human
**Tags:** domain, ai, responsible-data

---

## Context

`PUBLIC_REPORT.confidence` and "AI confidence" are referenced across the concept, but no method was
specified. Constitution Art. XII forbids the LLM from producing the score itself; it must be a
**deterministic, reproducible blend** with surfaced components (Art. XI provenance). Sketched in
`docs/audit/v1/CLARIFICATIONS.md` §B.Q4; recorded here.

**Constraints:** deterministic blend (Art. XII); components visible, not just a number; LLM contributes
only cited sub-signals.

## Options Considered

### Option A — Weighted deterministic blend of four components (CHOSEN)
`confidence = 0.40·geocode_precision + 0.30·source_authority + 0.20·classifier_score +
0.10·corroboration` ∈ [0,1]; weights in config; LLM supplies only `geocode` + `classifier_score` (with
citations); the blend is computed in code; the **components** are surfaced in the UI.
**Pros:** reproducible, testable, explainable, tunable; honors Art. XII.
**Cons:** weights are a judgement call → exposed in config + revisable.

### Option B — LLM emits a single confidence number
**Pros:** trivial. **Cons:** non-reproducible, ungrounded — **violates Art. XII**. Rejected.

### Option C — ML classifier trained on labeled SOS corpus
**Pros:** potentially accurate. **Cons:** needs labeled data + training pipeline; out of demo scope; revisit later.

## Decision

**We will use Option A.** Deterministic weighted blend; components displayed; LLM limited to cited
geocode + intent-classification sub-signals. Feeds the verify pipeline (never auto-acts — Art. XIII).

## Consequences

**Positive:** explainable, reproducible triage confidence; tunable per deployment; constitution-aligned.
**Negative:** weights need empirical tuning (config-exposed).
**Neutral:** corroboration requires a nearby-report/official-match lookup.
**Risks:** gaming via spam reports → mitigated by corroboration weight + human verify + abuse controls (threat model TB1).

## Y-Statement
> For responders triaging crowdsourced SOS, a deterministic weighted confidence blend is a scoring
> approach that is reproducible and explainable; unlike an LLM-emitted score, every component is cited
> and auditable, and the LLM never invents the number (Art. XII).

## Links
- `docs/audit/v1/CLARIFICATIONS.md` §B.Q4; PRD EARS EV4; Constitution Art. XI, XII, XIV.
- `../DOMAIN_MODEL.md` (PUBLIC_REPORT.confidence_components); `../C4_ARCHITECTURE.md` Flow B.

## Review
**Approved by:** human, 2026-06-27 · **Revisit:** post-demo (consider Option C with real labels).
