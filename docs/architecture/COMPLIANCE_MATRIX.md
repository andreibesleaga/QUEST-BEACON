# BEACON — Compliance & Governance Implementation Matrix

*IEEE Response Quest 2026 · Phase 3 · Persona: `ops-security`. The security / audit / logging / governance
**implementation matrix**: it maps each BEACON control to the public AI-risk standards it implements, names
the **enforcing component**, and states **status**. It is the coverage map behind the THREAT_MODEL trust
boundaries (TB1–TB11) and the Constitution (Art. IV–VI, X–XVI). Standards: **OWASP LLM Top-10 (2025)**,
**OWASP Agentic Security Initiative ASI01–ASI10**, **NIST AI RMF 1.0** (GOVERN / MAP / MEASURE / MANAGE),
**ISO/IEC 42001:2023**, **EU AI Act**, **MITRE ATLAS**. Pattern attribution follows the public standards
above and the author's agentic-AI engineering framework (`agents/guides/security/ai-risk-standards-map.md`).*

> **Honesty note (carried from the standards map):** this is a **coverage & intent** map, not a
> certification or audit attestation. A row means BEACON provides a relevant, named mechanism — not that
> BEACON is certified against any standard. Formal conformance requires independent assessment.

Note: the sustainability-reporting and CAMARA items are **out-of-core optional plugins / alignment examples** (non-blocking); the AI compliance proxy, security/audit/logging/governance controls here are **core**.

---

## 1. Standard legend & abbreviations

- **OWASP LLM Top-10 2025:** LLM01 Prompt Injection · LLM02 Sensitive Info Disclosure · LLM05 Improper
  Output Handling · LLM06 Excessive Agency · LLM10 Unbounded Consumption (plus LLM09 Misinformation where noted).
- **OWASP ASI01–ASI10 (Agentic Security Initiative):** *(title nuance, verified 2026-06-29: the published
  document is titled "OWASP Top 10 for Agentic Applications (2026)"; "ASI" is the Initiative/prefix — the
  ASI01–ASI10 IDs used here are correct.)* ASI01 Agent Injection · ASI02 Tool Misuse · ASI03
  Privilege Compromise · ASI04 Resource Overload · ASI05 Cascading Trust Failure · ASI06 Memory/Data
  Poisoning & Leakage · ASI07 Insecure Agent Comms · ASI08 Traceability/Repudiation Gaps · ASI09 Identity
  Spoofing · ASI10 Human-Oversight Bypass.
- **NIST AI RMF function:** GOVERN · MAP · MEASURE · MANAGE.
- **ISO/IEC 42001 clause** (AIMS): 6 (planning/risk), 8 (operation/controls), 9 (performance/audit), 10 (improvement).
- **EU AI Act article:** Art.9 risk mgmt · Art.10 data governance · Art.12 record-keeping · Art.13
  transparency · Art.14 human oversight · Art.15 robustness/security · Art.50 AI-disclosure.
  *Applicability (verified 2026-06-29): Annex III high-risk obligations apply from 2 Aug 2026;
  product-embedded (Annex I) high-risk obligations extend to 2 Aug 2027. BEACON aligns to these
  articles as an intent map (see honesty note above); it does not assert a fixed risk classification.*
- **MITRE ATLAS:** AML.T0051 LLM Prompt Injection · AML.T0057 LLM Data Leakage · AML.T0029 Denial of
  ML Service · AML.T0010 AI Supply Chain Compromise. (Note: AML.T0046 is "Spamming ML System with Chaff
  Data", NOT denial of service — denial of ML service is AML.T0029.)
- **Supply-chain / secure-development (classic-SW):** **NIST SSDF (SP 800-218)** + OpenSSF Scorecard,
  SLSA L2, CycloneDX SBOM, Sigstore cosign (ADR-019, CI_CD); and the **EU Cyber Resilience Act (CRA)**
  posture for an open-source critical-infrastructure tool (SBOM + coordinated vuln disclosure via
  `SECURITY.md`). These complement the AI-specific standards above.
- **Enforcing component:** `compliance-proxy` (AICompliancePort, ADR-017) · `RBAC` (TB6) · `threat-model`
  (a THREAT_MODEL §-control) · `fitness-function` (F1–F19 contract test) · `audit` (hash-chained
  AUDIT_EVENT / observability, ADR-022) · `cost-guard` (ADR-018).
- **Status:** `implemented` = the control is BUILT, wired into the running app, and test/gate-verified
  (S00→S09 complete; Phase-B go-live merged). The compliance gateway, JWT/role-scope, semantic firewall,
  PII redact, deterministic-truth/F3, rate-limit, cost guardrails, and circuit-breaker degrade were all
  confirmed present + fail-closed by the Phase-C security audit (see `docs/audit/FINAL_LIVE_AUDIT-2026-08.md`).
  (Historical note: earlier revisions marked rows `implemented-spec`/`planned-S05` during the spec phase.)
- **Status:** `not-implemented` = the control is DESIGNED and specified here, and no code implements it.
  Three rows carry it (C20, C24, C26), corrected on 2026-09-11 after an audit found them marked
  `implemented` with nothing behind them. A compliance matrix that overstates is worse than one with gaps:
  a gap is a task, an overstatement is a reader — an adopting agency, an auditor, a judge — making a
  decision on a control that is not there. Each row below says exactly what exists and what does not.

---

## 2. Control → standards implementation matrix

| # | BEACON control | OWASP LLM 2025 | OWASP ASI | NIST AI RMF | ISO 42001 | EU AI Act | MITRE ATLAS | Enforcing component | Status |
|---|---|---|---|---|---|---|---|---|---|
| C1 | **Mandatory AI compliance gateway** in front of every LLM+Vision call (ADR-017) | LLM01/02/06 | ASI01/02/03/06 | GOVERN/MANAGE | 8 | Art.9/15 | AML.T0051 | `compliance-proxy` | implemented |
| C2 | **JWT / role-scope** stage; deny-by-default per role (`policies.yml roles`) | LLM06 | ASI03/ASI09/ASI10 | GOVERN/MANAGE | 8 | Art.14 | — | `compliance-proxy`+`RBAC` | implemented |
| C3 | **Semantic firewall** — prompt-injection / instruction-override detection; ingested NL is untrusted data | LLM01/05 | ASI01 | MAP/MEASURE | 8 | Art.15 | AML.T0051 | `compliance-proxy` | implemented |
| C4 | **Blocked-command patterns** — destructive / SSRF / secret-file-access (`content_safety`) | LLM05/06 | ASI02/ASI04 | MEASURE/MANAGE | 8 | Art.15 | AML.T0057 | `compliance-proxy` | implemented |
| C5 | **Structural separation + no LLM tools/actions** (narration only, THREAT §10.2) | LLM01/06 | ASI01/ASI02 | MAP/MANAGE | 8 | Art.15 | AML.T0051 | `threat-model`+`compliance-proxy` | implemented |
| C6 | **Schema-bound output + citation validation**, reject → deterministic fallback (F2/F4) | LLM05/09 | ASI05 | MEASURE | 8/9 | Art.13/15 | — | `fitness-function` | implemented |
| C7 | **Deterministic source of truth** — LLM never computes numbers/rankings (F3, Art. XII) | LLM09 | ASI05 | MEASURE/MANAGE | 8 | Art.15 | — | `fitness-function` | implemented |
| C8 | **PII detect+redact** before egress; no PII/secrets in prompt context (`policies.yml pii`) | LLM02/06 | ASI06 | MEASURE/MANAGE | 8 | Art.10 | AML.T0057 | `compliance-proxy` | implemented |
| C9 | **Output egress constraints** — no free URLs / markdown-image beacons (THREAT §10.2) | LLM02 | ASI06 | MANAGE | 8 | Art.10 | AML.T0057 | `threat-model`+`compliance-proxy` | implemented |
| C10 | **Image consent + PII-screen + metadata strip** before any vision processing (ADR-008) | LLM01/02 | ASI06 | MAP/MANAGE | 8 | Art.10 | — | `threat-model` | implemented |
| C11 | **Input sanitation + token caps** — strip control/bidi/zero-width; per-role `max_tokens` | LLM01/10 | ASI04 | MEASURE | 8 | Art.15 | AML.T0029 | `compliance-proxy` | implemented |
| C12 | **Rate limit** per caller at gateway + intake (`policies.yml rate_limit`; T1.6) | LLM10 | ASI04 | MANAGE | 8 | Art.15 | AML.T0029 | `compliance-proxy`+`threat-model` | implemented |
| C13 | **Cost guardrails** — 5 deterministic counters + pre-step reservation (ADR-018) | LLM10 | ASI04 | MANAGE | 6/8 | Art.9 | AML.T0029 | `cost-guard` | implemented |
| C14 | **Budget posture** — soft within budget; hard-block + human approval over threshold/cap (ADR-018) | LLM10 | ASI04/ASI10 | GOVERN/MANAGE | 6 | Art.9/14 | — | `cost-guard`+`RBAC` | implemented |
| C15 | **Circuit-breaker + ladder degrade** (degrade→escalate→terminate; Art. XVI) | LLM10 | ASI04/ASI05 | MANAGE | 8 | Art.15 | AML.T0029 | `cost-guard`+`threat-model` | implemented |
| C16 | **Provider fallback incl. local Ollama → deterministic-only** (ADR-007/008) | LLM01/05 | ASI05 | MANAGE | 8 | Art.15 | — | `threat-model` | implemented |
| C17 | **HITL before public action** — UNVERIFIED can't emit CAP/EDXL or task (Art. XIII, F8) | — | ASI10 | GOVERN/MANAGE | 8 | Art.14 | — | `threat-model`+`fitness-function` | implemented |
| C18 | **Threshold fires = DRAFT only**; no live IPAWS origination (ADR-014, C6) | — | ASI10 | GOVERN | 8 | Art.14 | — | `threat-model`+`fitness-function` | implemented |
| C19 | **RBAC server-side per route AND per object** (BOLA/BFLA; TB6, CLARIF §B.Q6) | LLM06 | ASI03/ASI09 | GOVERN/MANAGE | 8 | Art.14 | — | `RBAC` | implemented |
| C20 | **MFA for EM/admin; short-lived tokens** (T7.4) — **short-lived JWTs ARE implemented; MFA IS NOT.** No second factor exists anywhere in the codebase: no TOTP, no WebAuthn, no enrolment, no challenge. An agency deploying BEACON for real must place it behind an identity provider that enforces MFA | — | ASI09 | GOVERN | 8 | Art.14 | — | `RBAC` | not-implemented |
| C21 | **Region/org isolation** — scoped queries; SSE region-keyed (TB9) | LLM02 | ASI06/ASI07 | MANAGE | 8 | Art.10 | — | `RBAC`+`threat-model` | implemented |
| C22 | **Provenance + citations structural** — every datum→SOURCE_RECORD (F1/F2, Art. XI) | LLM09 | ASI05/ASI08 | MEASURE | 8/9 | Art.12/13 | — | `fitness-function` | implemented |
| C23 | **Hash-chained append-only audit**, fail-closed (no audit ⇒ no commit; TB7) | LLM05 | ASI08 | GOVERN/MANAGE | 9 | Art.12 | — | `audit` | implemented |
| C24 | **Per-step cost attribution IS implemented; OTel TRACES are NOT.** `src/adapters/ai/observability.ts` emits structured pino logs using OpenTelemetry GenAI semantic-convention FIELD NAMES (`gen_ai.usage.*`), which is not the same thing as emitting spans: there is no OTel SDK, no exporter and no OTLP endpoint, so nothing arrives in a tracing backend. The hash-chained AUDIT_EVENT trail is authoritative without it, and the cost figures in C25 are real (ADR-022) | LLM10 | ASI08 | MEASURE/MANAGE | 9 | Art.12/13 | — | `audit` | not-implemented |
| C25 | **Cost-extended AUDIT_EVENT** (costTokensIn/Out/Usd/modelTier; DDL cost_tokens_in/out, cost_usd, model_tier; ADR-022) | LLM10 | ASI08 | MEASURE | 9 | Art.12 | — | `audit`+`cost-guard` | implemented |
| C26 | **Verifier-agent** (different model family) cross-checks critical outputs, advisory (ADR-022) — **not built.** No second-model cross-check exists. The guarantee this row was meant to provide is instead carried structurally: the LLM never produces a figure at all (Art. XII), so there is no generated number for a verifier agent to check | LLM09 | ASI05 | MEASURE | 9/10 | Art.15 | — | `audit` | not-implemented |
| C27 | **Privacy sampling** — trace content capture off in prod; no PII in audit (Art. IV/VI, §9.3) | LLM02 | ASI06/ASI08 | MANAGE | 8 | Art.10/12 | AML.T0057 | `audit` | implemented |
| C28 | **EU AI Act transparency headers** — AI-involvement marker on AI-derived responses | LLM09 | ASI08 | GOVERN | 9 | Art.13/50 | — | `compliance-proxy` | implemented |
| C29 | **Audit-log retention** (EU AI Act Art.12; `eu_ai_act.log_retention_days` = 365) | — | ASI08 | GOVERN | 9 | Art.12 | — | `audit`+`compliance-proxy` | implemented |
| C30 | **Misinformation flagging** — conflicting/low-authority signals flagged, never merged (Art. XI/XIV) | LLM09 | ASI06 | MEASURE/MANAGE | 8 | Art.10/13 | — | `threat-model`+`fitness-function` | implemented |
| C31 | **CAP/EDXL schema-validated before send; XXE/entity-expansion disabled** (T2.4, F15) | LLM05 | ASI05 | MANAGE | 8 | Art.15 | — | `fitness-function`+`threat-model` | implemented |
| C32 | **Anti-corruption layer validates every feed; supply-chain audit** (T5.3/T5.5, Gate 5) | LLM05 | ASI06 | MAP/MANAGE | 8 | Art.10/15 | AML.T0010 | `threat-model` | implemented |
| C33 | **Policy-as-code, fail-fast boot validation** (`policies.schema.json`; U5/F10) | LLM06 | ASI03 | GOVERN | 6/8 | Art.9 | — | `compliance-proxy`+`fitness-function` | implemented |

**Coverage check:** every OWASP LLM Top-10 2025 item used by BEACON (LLM01, LLM02, LLM05, LLM06, LLM09,
LLM10) and every ASI01–ASI10 category has ≥1 row; each NIST AI RMF function and each cited EU AI Act
article (Art.9/10/12/13/14/15/50) is covered. A control with no realistic BEACON surface (e.g. an external
tool-execution sink) is intentionally absent because BEACON's LLM has no tools (C5) — the surface does not
exist rather than being unmitigated.

---

## 3. Tiered Autonomy governance (A / B / C)

BEACON actions are governed by three autonomy tiers, enforced by the gateway (ADR-017) + RBAC (TB6) +
HITL (Art. XIII) + the budget posture (ADR-018). The tier of an action is fixed by its blast radius, not by
convenience; a higher-risk action can never be silently demoted to a lower tier (NIST GOVERN; EU AI Act
Art.14 human oversight; OWASP ASI10 human-oversight-bypass).

| Tier | Posture | Applies to (examples) | Control that enforces it |
|---|---|---|---|
| **Tier A — human-only** | The system never acts; a human originates. | Promote CAP to `ACTUAL` / disseminate; live IPAWS origination (out of scope, `IPAWS_ENABLED=off`); amend `CONSTITUTION.md`; change CI/CD. | RBAC (VERIFIER/EM) + `CAP_EMIT_MODE` + AGENTS §6 forbidden-actions; gateway refuses to originate. |
| **Tier B — human-approval-before-execute** | The system *proposes*; a human *approves* before it executes. | Approve an `UNVERIFIED` report → emit DRAFT CAP/EDXL or task a resource (F8); any AI call whose reserved cost ≥ `escalation_threshold_usd` or that would exceed a per-incident/region cap (ADR-018); adopting a SOTA/expensive model (Art. X). | HITL gate (Art. XIII) + `cost-guard` hard-block (ADR-018) + `audit` (approver recorded). |
| **Tier C — autonomous within policy** | The system acts automatically inside `policies.yml`, fully audited. | Cited SitRep synthesis + NL triage within budget; threshold evaluation → **DRAFT** alert (never ACTUAL — that is Tier A/B); deterministic exposure/ranking/routing; ingestion + cache/mock fallback; data-source ladder degradation. | `compliance-proxy` (firewall+PII+policy+audit) + `cost-guard` soft posture + `fitness-function`. |

**Tier rules.**
1. **Safety is fail-closed in every tier** — a PII-egress or prompt-injection control failure blocks the
   action regardless of tier or budget (ADR-017).
2. **Threshold-fired alerts are Tier C only up to DRAFT;** promotion to outbound CAP is Tier B (human
   approval) and dissemination is Tier A (human authority) — the deterministic→AI→human handshake (Art.
   XIII) is never collapsed.
3. **Budget crossing escalates tier:** a Tier-C AI call that reserves ≥ the configured threshold/cap is
   automatically held as Tier B (ADR-018) — autonomy contracts as spend rises.
4. **Every tier writes an `AUDIT_EVENT`** (actor=human|agent, action, target, time + cost fields, ADR-022);
   no write path bypasses audit (TB7, fail-closed). This is the ASI10 / EU AI Act Art.14 backstop: the
   human can always answer Purpose / Transparency / Control (Art. VI).

---

## 4. Trust-boundary & Constitution cross-reference

The matrix is anchored to the existing **THREAT_MODEL trust boundaries** (not re-enumerated here):
TB1 SOS intake · TB2 verify→CAP/EDXL · TB3 crowd/social misinformation · TB4 source adapters/supply chain ·
TB5 the LLM · TB6 RBAC · TB7 audit-log integrity · TB8 secrets · TB9 region/org isolation · TB10
offline/air-gapped · **TB11 the AI Compliance Proxy** (the mandatory `AICompliancePort` gateway, ADR-017 — the
unbypassable chokepoint in front of every LLM/Vision call; the structural anchor for **C1–C11**). New
AI-governance controls slot in as: **TB11** → **C1–C11** (gateway, role-scope, semantic firewall,
blocked-command, structural separation, schema/citation, deterministic truth, PII redact, egress constraint,
image consent, input-sanitation/token-caps — enforced at the proxy; F16); **TB5** → C16, C26, C28 (provider
fallback, verifier-agent, transparency); **TB6** → C2, C19–C21 (role-scope, RBAC, MFA, isolation); **TB7** →
C23–C25, C27, C29 (hash-chained audit, cost attribution, privacy sampling, retention); **resource/budget**
(spanning TB1/TB5/TB11) → C12–C15 (rate-limit, cost guards, budget posture, breaker; F17).

**Constitution articles enforced by this matrix:** Art. IV (privacy — C8/C10/C27), Art. V (security — C1–C4,
C19–C20, C31–C33), Art. VI (observability/transparency/HITL — C24–C28, Tier governance), Art. X (cost — C13–C15),
Art. XI (provenance — C22), Art. XII (deterministic truth — C5–C7, C16), Art. XIII (HITL/audit — C17–C18,
C23, Tier A/B), Art. XIV (responsible data — C8, C10, C30), Art. XV (adapter integrity — C32),
Art. XVI (total redundancy/graceful degrade — C15, C16).

---

## 5. Verification at the gates

- **S03 (now):** matrix rows trace to a control + standard + component + status (this document); the
  policy schema (`schemas/policies.schema.json`) + instance (`config/policies.yml`) validate (draft 2020-12).
- **S05:** `planned-S05` rows land as code behind the named component; `fitness-function` rows become
  F1–F19 contract tests (incl. the AI-governance gates F16 compliance-proxy-enforced, F17 budget-HITL,
  F18 sustainability-schema-valid [plugin], F19 per-step-cost-attribution).
- **S07 security gate (THREAT_MODEL §16):** every row is re-verified; the standards-traceability checklist
  (§16.9) now also covers OWASP ASI01–ASI10 and the EU AI Act articles cited above.

---

*Matrix owner: `ops-security` persona. Living document — revisit at S05 (status flip) and S07 (gate
re-verification), and on any new trust boundary / autonomy tier. Coverage & intent map, not a certification.*
*BEACON — IEEE Response Quest 2026, Phase 3 · 2026-06-29.*
