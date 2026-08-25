# ADR-022: Observability + cost attribution — OTel GenAI span hierarchy, per-step token/cost, verifier-agent, privacy sampling

**Date:** 2026-06-29
**Status:** Accepted
**Deciders:** ops-security + prod-architect + human
**Tags:** ai | observability | security | governance

---

## Context

Art. VI makes observability first-class: every run/decision/model+tool call must be a trace with token
usage and **per-step cost attribution** tagged with OpenTelemetry GenAI semantic conventions, content
redacted by default. The compliance gateway (ADR-017) and cost guardrails (ADR-018) both need a structured
trace to attach guardrail/breaker events and cost to, and the `AUDIT_EVENT` record needs to carry cost so
budget caps (ADR-018) and EU AI Act record-keeping (Art.12) are auditable. Decided now because the gateway
audit stage, the `AUDIT_EVENT` shape, and `OTEL_EXPORTER_OTLP_ENDPOINT` (CONFIGURATION §1) depend on it.

**Current state:** `audit-trail.skill` defines the hash-chained `AUDIT_EVENT`; `agent-analytics.skill`
defines token/cost metrics + the `gen_ai.usage.*` convention; not yet bound to a span hierarchy or to the
`AUDIT_EVENT` schema. No code yet.
**Constraints:** redact content by default (Art. IV/VI); hash-chained append-only audit (Art. XIII, THREAT
§9); deterministic numbers, incl. cost math (Art. XII); no PII in traces/logs (Art. IV, THREAT §9.3).

## Options Considered

### Option A — OTel GenAI 5-level span hierarchy + cost-extended AUDIT_EVENT + verifier-agent + privacy sampling (CHOSEN)
A **5-level span tree** per AI-assisted operation:
`L0 execute (root: incident request) → L1 plan (synthesis orchestration) → L2 discover (gather grounding
facts) → L3 execute (the LLM/Vision call via the gateway) → L4 retrieve (citation/source resolution)`.
Each LLM/Vision span carries `gen_ai.usage.input_tokens` / `gen_ai.usage.output_tokens` / `gen_ai.request.model`
+ a derived `cost.usd` (deterministic: tokens × tier rate, Art. XII). Guardrail decisions, firewall
hits, circuit-breaker transitions, reservations, and HITL holds are **trace-linked events** on the
relevant span. The **`AUDIT_EVENT` concept is extended** with `costTokensIn` / `costTokensOut` / `costUsd`
/ `modelTier`. A **verifier-agent pattern** (a *different model family* than the producer) optionally
cross-checks critical outputs (e.g. a cited SitRep before VERIFIER review) — advisory, never authoritative
(the human + deterministic engine remain the truth). (TS-domain casing `costTokensIn/costTokensOut/costUsd/
modelTier`; DDL snake `cost_tokens_in/out, cost_usd, model_tier` — same four fields, see Decision note.)
**Privacy sampling:** prompt/response *content*
capture is **off in prod** (spans carry token counts, model, latency, cost, decision metadata only — no
PII, no raw text); content capture is a dev-only opt-in.
**Pros:** legible end-to-end (Art. VI Transparency); cost attributable per step → feeds ADR-018 caps + EU
AI Act Art.12; standards-aligned (OTel GenAI semconv); verifier-agent reduces single-model error on
critical outputs without overriding determinism; privacy-safe by default.
**Cons:** instrumentation overhead; verifier-agent doubles cost on the spans it covers (so it is opt-in,
critical-only, and itself budget-governed by ADR-018).
**Source:** Art. VI; `audit-trail.skill`, `agent-analytics.skill`; `llm-as-judge.skill` (verifier
pattern); OpenTelemetry GenAI semantic conventions; OWASP LLM Top-10 2025; OWASP ASI08 (traceability).

### Option B — Plain text logs, no spans, no cost attribution
**Pros:** trivial. **Cons:** no per-step cost (breaks ADR-018 caps + Art. X), no legible trace (breaks
Art. VI), no EU AI Act record. Rejected.

### Option C — Full content capture in traces (prompts + responses always stored)
**Pros:** maximal debuggability. **Cons:** stores PII / raw ingested text in traces (violates Art. IV,
THREAT §9.3/§11). Rejected; allowed only as a dev-only opt-in in Option A.

## Decision

**We will use Option A.** A 5-level OTel GenAI span hierarchy (L0 execute → L1 plan → L2 discover → L3
execute → L4 retrieve) with `gen_ai.usage.*` token+cost per step and trace-linked guardrail/breaker/
reservation/HITL events; the `AUDIT_EVENT` concept extended with `costTokensIn/costTokensOut/costUsd/
modelTier`; an opt-in, critical-only verifier-agent of a different model family; and privacy sampling
(content capture off in prod). Exporter is optional and config-driven (`OTEL_EXPORTER_OTLP_ENDPOINT`); the
hash-chained Markdown/`AUDIT_EVENT` trail is authoritative without it (Art. VI).

> **Naming convention (same four fields, two casings).** These are persisted in the DDL as the snake-case
> columns `cost_tokens_in`, `cost_tokens_out`, `cost_usd`, `model_tier` (`schemas/schema.sql` audit_event ·
> DOMAIN_MODEL §2) and surfaced in the TypeScript domain / API as camelCase `costTokensIn`, `costTokensOut`,
> `costUsd`, `modelTier` (`docs/api/openapi.yaml` AuditEvent). Same four fields — the ACL/serializer maps
> snake ↔ camel; all four are nullable (set on LLM/Vision/adapter calls, NULL on non-AI events).

## Consequences

**Positive:** per-step cost feeds ADR-018 budget caps + agent-analytics; full Transparency (Art. VI);
EU AI Act Art.12 record-keeping satisfied; verifier-agent catches single-model drift on critical outputs;
no PII in traces by default.
**Negative:** instrumentation cost; verifier-agent adds spend where enabled (budget-governed, opt-in).
**Neutral:** cost rates per tier live in config; spans export only when an OTLP endpoint is set.
**Risks:** trace volume / cost → sampling + content-off keep it bounded; verifier-agent over-trust →
advisory-only, never overrides the deterministic engine or the human (Art. XII/XIII); cost-math error →
deterministic + unit-tested (Art. XII), hard-math validated (agent-analytics).

## Y-Statement Summary

> For operators and auditors who need to see exactly what an AI step did, what it cost, and which
> guardrail fired — without leaking PII — the OTel GenAI span hierarchy with cost-extended `AUDIT_EVENT`
> and privacy sampling makes every AI step legible and attributable; unlike plain logs or full-content
> capture, it carries per-step token/cost and decision metadata while keeping raw content out of traces.

## Standards mapping
OTel GenAI semantic conventions (`gen_ai.usage.*`, `gen_ai.request.model`) · OWASP ASI08 (cascading-failure
traceability), LLM05 (output handling), LLM10 (consumption visibility) · NIST AI RMF MEASURE + MANAGE +
GOVERN · EU AI Act Art.12 (record-keeping), Art.13 (transparency) · IEEE 7001 (transparency) · Constitution
Art. VI (observability/redaction), XII (deterministic cost math), XIII (audit).

## Links
- **SPEC:** §10.2 (audit & observability — "OTel GenAI traces with cost attribution; content redacted by default"); **THREAT_MODEL:** §9 (audit integrity), §9.3 (no PII in audit), §16.7.
- **Constitution:** Art. IV, VI, XII, XIII.
- **Related ADRs:** ADR-017 (gateway audit stage emits these spans/events), ADR-018 (cost caps consume the attribution), ADR-007/008 (model tiers priced here).
- **Skills:** `core/audit-trail` (hash-chained AUDIT_EVENT), `core/agent-analytics` (gen_ai.usage.* + cost), `ai/llm-as-judge` (verifier-agent).
- **Config:** `OTEL_EXPORTER_OTLP_ENDPOINT` (CONFIGURATION §1); **matrix:** `../COMPLIANCE_MATRIX.md`.
- **Implementation:** S05 — pending S04 gate.

## Review
**Approved by:** ops-security + human, 2026-06-29 · **Implementation complete:** Yes (Phase-B/C/D) · **Revisit:** S06 (confirm OTel GenAI semconv stability + per-tier cost rates).
