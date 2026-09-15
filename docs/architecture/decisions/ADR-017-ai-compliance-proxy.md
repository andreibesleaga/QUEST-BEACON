# ADR-017: AICompliancePort — mandatory reverse-proxy compliance gateway in front of every LLM + Vision call

**Date:** 2026-06-29 (amended 2026-07-04, D-35)
**Status:** Accepted
**Deciders:** ops-security + prod-architect + human
**Tags:** security | ai | api | governance

> **D-35 amendment — bidirectional / heuristic firewall.** The gateway screens **both directions**:
> the **input** request (role-scope → breaker/rate-limit → semantic firewall: prompt-injection incl.
> indirect-via-cited-source, destructive/SSRF/secret-file patterns, unicode/bidi/zero-width → policy-as-code
> → PII detect/redact → hash-chained audit → upstream) **and** the **output** response (egress stage
> T-278a: leaked-instruction / PII / policy-violating content / disallowed tool-call echoes → schema+citation
> validation). The firewall is **heuristic-layered** (deterministic regex/allowlist + a classifier where
> regex is insufficient) so a bypass of one layer is caught by another; every safety stage is **fail-closed**
> (a detector error blocks), availability stages degrade down the AI ladder. Red-teamed by E6·T-292a
> (I/O corpus) and gated in eval-tier1 (PR-blocking). Classical AppSec for the whole stack is in
> `docs/SECURITY_BASELINE.md`; this ADR governs the AI plane specifically.

---

## Context

ADR-007 (`LLMPort`) and ADR-008 (`VisionPort`) define provider ladders but assume the *adapter itself*
applies the safety/PII/audit controls the THREAT_MODEL requires (§10 anti-prompt-injection, §11 PII,
TB5 the-LLM). Spreading those controls across each adapter is unenforceable and drifts: an adapter could
ship a raw, un-screened, un-audited prompt to a cloud provider. BEACON's crown jewels are decision and
alert integrity plus reporter PII — every AI call therefore needs a **single, structural** enforcement
point, not per-adapter goodwill. This decides that point now because `LLMPort`/`VisionPort` wiring, the
config schema (`schemas/policies.schema.json`), and the SitRep/triage use-cases depend on it.

**Current state:** controls described per-skill (`ai-safety-guardrails`, `prompt-injection-defense`) and
per-threat row, with no architectural chokepoint binding them. No code yet.
**Constraints:** structural separation + no LLM tools (Art. XII, THREAT §10.2); no PII/secrets in prompt
context (Art. IV); every state/decision → hash-chained `AUDIT_EVENT` (Art. XIII, THREAT §9); config-driven
fail-fast (U5); degrade gracefully, never dead-end (Art. XVI).

## Options Considered

### Option A — `AICompliancePort` reverse-proxy gateway as the mandatory chokepoint (CHOSEN)
Every LLM and Vision call routes through one in-process `AICompliancePort` gateway before reaching any
provider adapter. Fixed pipeline:
`JWT/role-scope → circuit-breaker → rate-limit (per-caller, config/policies.yml rate_limit; T1.6/LLM10) →
semantic firewall (prompt-injection / instruction-override / destructive-command / SSRF / secret-file-access
— regex + classifier pre-filter) → policy-as-code (config/policies.yml) → PII detect+redact →
hash-chained append-only audit → upstream`.
Short-circuits `403` (policy/role/firewall denial) or `503`/ladder-descent (breaker open). **SAFETY
controls (PII egress, prompt-injection, blocked-command patterns) are FAIL-CLOSED** — a control error
blocks the call; **availability degrades gracefully** (breaker-open descends the ADR-007/008 ladder to
local/deterministic-only, never a dead-end — Art. XVI).
**Pros:** one auditable point of truth; the LLM physically cannot be reached without screening + audit
(LLM01/02/06); policy is declarative + fail-fast-validated (U5); reuses the existing ladder for graceful
degradation; testable as one contract (fitness function).
**Cons:** an extra hop on every AI call (sub-ms in-process); the gateway is itself security-critical and
must not become a bypassable shim — enforced by making adapters reject any call not carrying a gateway
token.
**Source:** THREAT_MODEL §6/§10/§11; `prompt-injection-defense.skill` (defense-in-depth, fail-closed
gateway); `ai-safety-guardrails.skill` (rails taxonomy, fail-closed); OWASP LLM Top-10 2025; OWASP
Agentic Security Initiative ASI01–ASI10.

### Option B — In-prompt guardrails only (system-prompt instructions + delimiters)
Rely on instruction hierarchy / spotlighting inside the prompt.
**Pros:** zero infrastructure. **Cons:** known-weak and trivially bypassed (both skills say so); no audit,
no PII redaction, no role/budget enforcement; a compromised model has nothing structural stopping it
(violates Art. IV/XII/XIII). Necessary-not-sufficient — kept as one layer *inside* Option A, never alone.

### Option C — Provider-side safety only (e.g. cloud moderation endpoints)
Trust the provider's built-in filters.
**Pros:** no local code. **Cons:** absent offline/Ollama/deterministic rungs (breaks Art. XVI); no BEACON
PII/secret-file/SSRF policy; no local audit; cross-provider inconsistency; egresses raw PII to get it
screened. Unacceptable.

## Decision

**We will use Option A** — a mandatory `AICompliancePort` reverse-proxy gateway as the single chokepoint
in front of every `LLMPort` and `VisionPort` call, running the fixed
JWT→breaker→rate-limit→firewall→policy→PII→audit→upstream pipeline. Safety controls are fail-closed; availability
degrades down the ADR-007/008 ladder. Policy is `config/policies.yml`, validated at boot against
`schemas/policies.schema.json`. Provider adapters refuse any request not stamped by the gateway, so the
chokepoint cannot be bypassed. In-prompt and provider-side controls survive only as inner layers of this
gateway (defense-in-depth), never as the authority.

## Consequences

**Positive:** structural, single-point enforcement of LLM01/02/06 + PII (Art. IV) + role scope (TB6) +
audit (Art. XIII); one contract to test; offline/air-gapped safe (local rungs, no egress, UW4).
**Negative:** one in-process hop per AI call; the gateway is security-critical (mitigated: no secrets in
it, provenance-pinned, fitness-function-tested).
**Neutral:** controls move out of individual adapters into the gateway + `policies.yml`.
**Risks:** firewall false-negatives (injection slips) → mitigated by defense-in-depth (structural
controls stay authoritative, classifier is a pre-filter) + lowered confidence + logged attempts; gateway
outage → fail-closed for safety, breaker-degrade for availability; policy drift → fail-fast boot
validation + audited policy `version`.

## Y-Statement Summary

> For BEACON operators who must never let an AI call escape screening, PII redaction, role scope, or
> audit, the `AICompliancePort` reverse-proxy gateway is a mandatory compliance chokepoint that fails
> closed on safety and degrades gracefully on availability; unlike in-prompt-only or provider-side-only
> guardrails, the LLM/Vision provider is structurally unreachable without passing the full pipeline.

## Standards mapping

| Pipeline stage | OWASP LLM 2025 | OWASP ASI | NIST AI RMF | EU AI Act |
|---|---|---|---|---|
| JWT / role-scope | LLM06 | ASI03 (privilege compromise) | GOVERN / MANAGE | Art.14 (human oversight) |
| Circuit-breaker (ladder degrade) | LLM10 | ASI04 (resource overload) | MANAGE | Art.15 (robustness) |
| Rate-limit (per-caller; `policies.yml rate_limit`; T1.6) | LLM10 (unbounded consumption) | ASI04 (resource overload) | MANAGE | Art.15 |
| Semantic firewall (injection/SSRF/destructive) | LLM01, LLM05 | ASI01 (agent injection), ASI02 (tool misuse) | MAP / MEASURE | Art.15 |
| Policy-as-code | LLM06 | ASI03 | GOVERN | Art.9 (risk mgmt) |
| PII detect+redact | LLM02, LLM06 | ASI06 (data/memory leakage) | MEASURE / MANAGE | Art.10 (data governance) |
| Hash-chained audit | LLM05 | ASI08 (cascading / traceability) | GOVERN / MANAGE | Art.12 (record-keeping), Art.13 (transparency) |

Also: MITRE ATLAS AML.T0051 (LLM prompt injection), AML.T0057 (data exfiltration) defended at the
firewall + PII + egress-constraint stages.

## Links
- **SPEC:** §6 (AI), §10.2 (security posture); **THREAT_MODEL:** TB5/§6, §10 (anti-injection), §11 (PII), §9 (audit).
- **Constitution:** Art. IV (privacy), V (security), XII (deterministic/no-LLM-tools), XIII (HITL/audit), XIV (PII), XVI (graceful degradation).
- **Related ADRs:** ADR-007 (LLMPort ladder — gateway sits in front), ADR-008 (VisionPort — same), ADR-018 (cost guardrails — the budget stage), ADR-022 (observability/cost-attribution — the audit stage), ADR-001 (hexagon).
- **Schema/config:** `schemas/policies.schema.json`, `config/policies.yml`; **matrix:** `../COMPLIANCE_MATRIX.md`.
- **Skills:** `prompt-injection-defense`, `ai-safety-guardrails`; **standards map:** `agents/guides/security/ai-risk-standards-map.md` (the author's agentic-AI engineering framework).
- **Implementation:** S05 (`src/adapters` / `src/main` gateway) — pending S04 gate.

## Review
**Approved by:** ops-security + human, 2026-06-29 · **Implementation complete:** Yes (Phase-B/C/D) · **Revisit:** S05 (re-check OWASP ASI list + classifier choice against the current matrix).
