# ADR-019: Testing & CI/CD Standard — full day-one matrix, mandatory from S05
<!-- Architecture Decision Record — created by adr-writer.skill -->
<!-- Store in: docs/architecture/decisions/ADR-019-testing-cicd-standard.md -->

**Date:** 2026-06-29
**Status:** Accepted
**Deciders:** prod-tech-lead + human (Andrei Besleaga)
**Tags:** testing | ci-cd | security | infrastructure | performance

---

## Context

BEACON is life-safety software whose core claims (deterministic source of truth, provenance/citations, the
deterministic→AI→human handshake, total redundancy, no PII retention) are only credible if they are
**executable** and **continuously verified** — an ungrounded, LLM-numbered, redundancy-broken, or PII-leaking
build must fail CI, not a review. SPEC §9 already names the layers (unit/TDD, integration, contract F1–F19,
BDD-per-FR, e2e, the 3 redundancy acceptance tests) and §10/PRD §6 set the bars (≥99% coverage, 100% citation/
provenance, 0 LLM-invented numbers, TTTP < 10 s). The open-source audit's standing finding — *architectural
ambition outpaces supply-chain hygiene* — is the exact trap to avoid: evidence (SBOM, signed+provenanced
releases, CVE delta, API-surface snapshot, coverage) must exist from the first commit, not be retrofitted. We
must decide **now**, before S05 scaffolding, how complete the testing + CI/CD standard is on day one.

**Current state:** Specs only (PAUSED at S04); no `package.json`, no workflows. SPEC §9 lists layers but not a
binding day-one PR-vs-nightly matrix, tools, coverage gates, or the supply-chain CI standard.
**Constraints:** LOCKED stack (Vitest, Playwright, Next.js/TS, Drizzle, GitHub Actions — AGENTS.md §1/§2);
Constitution Art. I (test-first, ≥99%, no requirement without a test) and Art. V (security by default, no
HIGH+ CVE, secrets in CI); ≈$0 / free-tier CI minutes; F1–F19 must gate (the AI-governance gates F16
compliance-proxy-enforced, F17 budget-HITL-above-threshold, F18 sustainability-schema-valid [plugin,
non-blocking], F19 per-step-cost-attribution are mandated by this ADR alongside the original F1 through F15);
no CI/CD or
library change without human approval (AGENTS.md §6).

## Options Considered

### Option A — Full day-one matrix, mandatory (CHOSEN)
Adopt the complete matrix at S05 day one: unit/TDD ≥99%, integration on ephemeral Postgres, contract F1–F19,
BDD-per-FR, e2e golden-path, visual-regression, property-based (fast-check), metamorphic (AI), mutation
(Stryker, nightly), a chaos/fault-injection harness formalizing the 3 redundancy acceptance tests, and an
eval-driven AI layer — wired into an OpenSSF-aligned PR/nightly/release pipeline (lint+typecheck+coverage+
gitleaks+OSV-Scanner+Semgrep/CodeQL+API-surface snapshot+micro-bench+the 7 gates+BDD/eval gates; release =
CycloneDX SBOM + SLSA L2 + Sigstore cosign; SHA-pinned actions; governance files; husky/lint-staged).
**Pros:** every BEACON guarantee is executable from commit 1; no evidence-gap to retrofit (avoids the audit's
top portfolio finding); the contract/redundancy fitness functions defend the differentiating claims; matches
Art. I/V and the rubric directly; cheap deterministic gates block PRs while noisy AI evals stay advisory until
calibrated (earn-the-right-to-block), so the gate is not flaky.
**Cons:** higher up-front setup effort (mutation, chaos harness, eval suite, signing); more CI minutes (mitigated
by lane split — heavy suites nightly, not PR).
**Source:** docs/TEST_PLAN.md, docs/EVAL_PLAN.md, docs/CI_CD.md; the author's agentic-AI engineering framework
(testing-strategy, evaluation-strategy, eval-driven-development, metamorphic-testing, chaos-fault-injection,
pbt-strategy, llm-as-judge, rag-evaluation, output-validation, browser-tdd); OpenSSF Scorecard, SLSA v1.1,
Sigstore, CycloneDX 1.6, OSV-Scanner, Semgrep/CodeQL, NIST SSDF, Keep a Changelog/SemVer.

### Option B — Core now, advanced tiers backlogged
Ship unit + integration + contract + BDD + basic SCA at S05; defer visual-regression, PBT, metamorphic,
mutation, the chaos harness, full eval gating, and SBOM/SLSA/cosign to a later sprint.
**Pros:** lower initial effort; faster first green build; fewer CI minutes early.
**Cons:** leaves exactly the gaps the audit flags as the highest-leverage risk (missing redundancy proofs, no
mutation/eval signal, unsigned/unattested releases); the 3 redundancy acceptance tests (F5–F7) and the
no-LLM-numbers/citation guarantees would be unenforced during the build window when regressions are cheapest to
introduce; retrofitting CI gates after code exists is slower and tends to grandfather violations.
**Source:** open-source audit framework §7 (creating the baseline is itself a P0 *before* other work).

## Decision

**We will adopt the full day-one testing + CI/CD matrix (Option A) as MANDATORY from S05**, specified in
`docs/TEST_PLAN.md`, `docs/EVAL_PLAN.md`, and `docs/CI_CD.md`. Because: (1) BEACON's credibility rests on
guarantees that must be *executable and continuously enforced* — half a matrix leaves the differentiating claims
unverified exactly when they are easiest to break; (2) it satisfies Constitution Art. I/V and the rubric without
a later remediation sprint, and pre-empts the audit's "evidence gap" finding by shipping SBOM/SLSA/cosign/
coverage from commit 1; (3) the effort cost is contained by the **lane split** (deterministic gates block PRs;
mutation/chaos/metamorphic/full-eval run nightly) and by **earn-the-right-to-block** (noisy AI-judge evals stay
advisory until calibrated), so the standard is complete without being flaky or expensive per-PR.

## Consequences

- **+** Every BEACON guarantee (provenance F1, citation F2, no-LLM-numbers F3, fallback F4, redundancy F5–F7,
  HITL F8, boundaries F9, fail-fast F10, port-parity F11, PII F12, a11y F13, TTTP F14, CAP/EDXL F15,
  compliance-proxy-enforced F16, budget-HITL F17, sustainability-schema-valid F18 [plugin], per-step-cost-attribution F19)
  is a CI gate. **F16–F19 are the AI-governance gates this ADR mandates** (ADR-017/018/020/022): F16/F17/F19
  block PRs in the `compliance`/`integration` lane (CORE); F18 is the non-blocking sustainability plugin.
- **+** Supply-chain evidence (CycloneDX SBOM, SLSA L2 provenance, Sigstore-signed releases, OSV/Semgrep/CodeQL,
  API-surface snapshot, micro-bench) exists from day one — no retrofit, strong OpenSSF Scorecard posture.
- **+** Mutation + chaos + eval close the gaps example-based tests miss; the redundancy acceptance tests are
  formalized as an automated harness, not a manual demo.
- **−** Higher S05 setup effort (mutation config, chaos seams/Toxiproxy, golden dataset, signing/OIDC).
- **−** More total CI minutes (mostly nightly, off the PR critical path).
- **~** Heavy/slow/noisy suites run nightly or advisory-until-stable, not on every PR — full coverage without a
  flaky or slow PR gate.
- **risk:** effort/time to stand up the full matrix delays first green → mitigated by building the deterministic
  PR lane first (unit/integration/contract/BDD/static + SCA/secrets), adding mutation/chaos/eval incrementally
  in the same S05 phase; the lane split means the PR gate is usable before nightly is complete.
- **risk:** flaky eval/judge gates erode trust → mitigated by earn-the-right-to-block (Tier-1 deterministic
  evals gate PRs; Tier-2/3 stay nightly/advisory until variance < ~1 pt; pass^k for reliability).
- **risk:** CI-minute / token cost on free tiers → mitigated by cheap-checks-first ordering, capped Tier-3
  judge subset + hard token budget, nightly scheduling of heavy suites, SHA-pinned cached actions.
- **risk:** SHA-pinned actions drift / go stale → mitigated by Dependabot `github-actions` weekly grouped updates.

## Y-Statement
> For BEACON's S05 build, which must keep its life-safety guarantees executable and continuously verified,
> the full day-one testing + OpenSSF-aligned CI/CD matrix (mandatory, lane-split) makes every F1–F19 fitness
> function (incl. the AI-governance gates F16–F19) and supply-chain evidence a CI gate from commit 1; unlike a
> core-now/advanced-later split, it leaves
> no guarantee unenforced during the build and no evidence gap to retrofit — at the cost of higher up-front
> setup, which we accept and contain via PR/nightly lane separation and earn-the-right-to-block eval gating.

## Links
- **PRD:** §6 (acceptance: ≥99% coverage, 100% citation/provenance, 0 LLM-invented numbers, 3 redundancy tests,
  TTTP < 10 s), §10 (NFRs, Apache-2.0).
- **SPEC:** §9 (testing strategy per layer), §10.2 (security posture / gates), §1.1 (golden thread FR→test).
- **C4:** "Quality / Fitness Functions" F1–F19 (F16–F19 = the AI-governance gates).
- **Related ADRs (AI-governance gates):** ADR-017 (compliance proxy — F16), ADR-018 (cost guardrails/budget — F17),
  ADR-020 (sustainability reporting — F18, plugin), ADR-022 (observability/cost-attribution — F19).
- **Constitution:** Art. I (test-first, ≥99%, spec→evals→test→code), Art. V (security by default).
- **Related ADRs:** ADR-005 (Turf↔PostGIS — F11 port-parity), ADR-007 (LLM ladder — F3/F4/F7), ADR-009 (total
  redundancy — F5/F6/F7), ADR-010 (CAP/EDXL — F15), ADR-012 (config fail-fast — F10), ADR-013 (Drizzle migrations
  on ephemeral Postgres — Gate 4).
- **Implements:** `docs/TEST_PLAN.md`, `docs/EVAL_PLAN.md`, `docs/CI_CD.md`.
- **Standards:** OpenSSF Scorecard; SLSA v1.1; Sigstore/cosign; CycloneDX 1.6; OSV-Scanner; Semgrep/CodeQL;
  NIST SP 800-218 SSDF; Keep a Changelog; SemVer; Playwright; fast-check; Stryker; promptfoo.
- **Implementation:** S05 CI scaffolding — pending S04 gate (no workflows wired until approved).

## Review
**Approved by:** prod-tech-lead + human, 2026-06-29 · **Implementation complete:** Yes (Phase-B/C/D) · **Revisit:**
S05 kickoff (confirm tool versions + SHA pins) and S06 (promote stable AI evals from advisory to blocking once
calibrated).
