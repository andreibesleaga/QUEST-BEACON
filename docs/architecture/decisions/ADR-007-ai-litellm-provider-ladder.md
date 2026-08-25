# ADR-007: AI — LiteLLM Provider-Agnostic Ladder (Groq → OpenRouter/Claude Haiku → Ollama → Deterministic)
<!-- Architecture Decision Record — created by adr-writer.skill -->
<!-- Store in: docs/architecture/decisions/ADR-007-ai-litellm-provider-ladder.md -->

**Date:** 2026-06-27
**Status:** Accepted
**Deciders:** prod-architect + human (Andrei Besleaga)
**Tags:** ai | infrastructure | security | performance

---

## Context

BEACON uses an LLM for grounded synthesis (cited SitReps), NL triage of public reports, and misinformation
flagging — but **never** to compute numbers, rankings, distances, exposures, or scores (Art. XII; those are
deterministic). The system must work at ≈$0, keep functioning when a provider is down/rate-limited/
unreachable, and run fully offline/air-gapped (Art. XVI). AI must never become a single point of failure:
with AI fully disabled, the deterministic engine must still produce ranked, usable decisions (a mandatory
acceptance test). We must choose the LLM integration strategy now because the `LLMPort` contract, the SitRep
synthesis use-case, and the config schema (CONFIGURATION.md §4) depend on it.

**Current state:** Locked (CLARIFICATIONS §B Q10/Q12/§D) = LiteLLM-fronted ladder, Groq (open-weight Llama-3-class) → OpenRouter/Claude Haiku → local Ollama → deterministic-only. No code yet.
**Constraints:** ≈$0 default (Art. X, cost NFR); provider-agnostic + env-configurable (Art. XV, U5); full offline fallback (Art. XVI); LLM output JSON-schema + citation validated, rejected on failure (U3, Art. XII); the deterministic path must stand alone (AI-disabled acceptance test).

## Options Considered

### Option A — LiteLLM provider-agnostic ladder behind an `LLMPort`, degrading to deterministic-only (CHOSEN)
A single `LLMPort` whose adapter uses LiteLLM to call any OpenAI-compatible endpoint. Each tier configures
provider + model + API base + key independently: `default` = Groq (open-weight Llama-3-class), `fallback` =
OpenRouter / Claude Haiku (`anthropic/claude-haiku-4-5`), `local` = Ollama (Llama-3-class / LLaVA), final
rung = **deterministic-only** (no narrative, full numeric/geometry retained). Output is JSON-schema +
citation validated; on parse/contract failure it falls to the deterministic layer.
**Pros:** provider-agnostic by construction — LiteLLM normalizes many providers to one OpenAI-compatible call, so any tier points at any endpoint via env (Art. XV, U5), no lock-in; cost-frugal default — Groq's open-weight tier is cheap/fast, escalation to Claude Haiku (`claude-haiku-4-5`, ~$1/$5 per 1M tokens in/out) happens only on failure (Art. X, cost NFR); true offline path — local Ollama needs no key/egress, final deterministic-only rung guarantees the AI-disabled acceptance test passes (Art. XVI, Art. XII); LLM never computes figures, output is schema/citation-gated so an ungrounded/malformed response is rejected rather than shown (U3, Art. XII, anti-hallucination guarantee).
**Cons:** LiteLLM is an added dependency + abstraction to keep current with the provider matrix; per-tier behavior/latency differs across providers (prompts must be robust across model families); cross-provider output-quality variance requires the schema/citation validator to be strict.
**Source:** CLARIFICATIONS §B Q10/Q12/§D; CONFIGURATION.md §4; docs.litellm.ai (OpenAI-compatible routing, fallbacks); Groq, OpenRouter, Ollama docs; Claude model facts (claude-api skill, 2026-06): Claude Haiku 4.5 = `claude-haiku-4-5`, $1.00 input / $5.00 output per 1M tokens.

### Option B — Single cloud provider (one vendor, one model)
Integrate one provider's SDK directly (e.g. only Groq, or only OpenAI, or only Anthropic).
**Pros:** simplest integration (one SDK, one prompt-tuning target, predictable behavior); no abstraction layer to maintain.
**Cons:** single point of failure — provider outage/rate-limit/region-block takes AI down entirely, violating Art. XVI's no-single-dependency rule and UW1; no offline path, cannot run air-gapped (breaks Art. XVI acceptance test); vendor lock-in, harder to honor Art. X frugality (no cheap-default + escalate pattern) and U5 (env-driven provider choice).
**Source:** Art. XVI (redundancy), UW1; provider status pages (outages happen).

### Option C — Self-hosted Ollama only (no cloud at all)
Run only local Ollama models, no cloud tiers.
**Pros:** zero cloud cost, fully private, trivially air-gapped.
**Cons:** local models weaker/slower for grounded synthesis than hosted open-weight tiers — quality ceiling lower for the flagship SitRep without a cloud rung; no graceful "best-available" behavior (can't escalate to a stronger model when online and warranted); doesn't satisfy the demo's cloud-parity story (cloud free-tier deployment).
**Source:** ollama.com; team experience; Art. XVI (we want both local AND cloud, not only local).

## Decision

**We will use Option A — a LiteLLM provider-agnostic ladder behind an `LLMPort`: Groq (open-weight) →
OpenRouter/Claude Haiku (`claude-haiku-4-5`) → local Ollama → deterministic-only — with the LLM never
computing numbers and all output JSON-schema + citation validated.**
Rationale: (1) only option simultaneously provider-agnostic (Art. XV, U5), cost-frugal by default (Art. X),
and fully offline-capable down to a deterministic-only rung (Art. XVI, UW1, UW4); (2) it enforces the
deterministic source-of-truth guarantee — the LLM only narrates cited, already-computed facts, and
schema/citation validation rejects ungrounded output (Art. XII, U3, UW3); (3) it matches the locked
stack-of-record and config model (CLARIFICATIONS §D, CONFIGURATION.md §4), keeping every
model/provider/key/cap env-driven and fail-fast validated.

## Consequences

- **+** Robust to provider outages and rate limits; cheapest-viable tier by default, escalate only on failure.
- **+** Air-gapped and AI-disabled runs both work; AI is an amplifier, never a hard dependency.
- **+** One uniform `LLMPort` contract regardless of provider; prompts/validation centralized.
- **−** LiteLLM dependency + provider-matrix upkeep (pin set finalized at S02 against current matrix).
- **−** Prompts and the schema/citation validator must be robust across heterogeneous model families.
- **~** Token budgets (`LLM_MAX_INPUT_TOKENS`/`LLM_MAX_OUTPUT_TOKENS`), temperature, and timeouts are config.
- **~** Exact model pins set at S02. Model ids verified 2026-06-29 (pin a currently-served id at build, Research Gate — Groq's deprecation page is authoritative): Groq's `llama-3.1-70b-versatile` is **DECOMMISSIONED** (errors since 2025-01-24) and `llama-3.1-8b-instant` / `llama-3.3-70b` are deprecated, so the Groq default tier is `openai/gpt-oss-120b` and the cheap tier `openai/gpt-oss-20b` (Groq stays the provider; the ladder is unchanged), with `claude-haiku-4-5` and Ollama `llama3`.
- **risk:** cross-provider output drift breaking the JSON contract → mitigated by strict schema + citation validation with deterministic fallback (UW3) and contract tests per tier.
- **risk:** a configured tier missing its key/URL → mitigated by fail-fast boot validation (U5, CONFIGURATION.md).
- **risk:** cost spike if escalation fires often → mitigated by cheap default tier + capped token budgets (Art. X); SOTA escalation would require human approval per Art. X.

## Y-Statement
> For BEACON operators needing cited situational narration that survives provider outages and runs offline,
> who must never let the AI invent figures or become a single point of failure, a LiteLLM provider-agnostic
> ladder (Groq → OpenRouter/Claude Haiku → Ollama → deterministic-only) degrades one rung at a time to a
> fully deterministic engine while keeping cost ≈$0 by default; unlike a single-provider integration, it has
> no single AI dependency and stays useful air-gapped and with AI fully disabled.

## Links
- **PRD:** U2/U3 (citations, deterministic numbers), EV3 (cited SitRep), UW1/UW3/UW4 (AI ladder, schema reject, offline), §4.2 (fusion engine), §10 (cost/offline).
- **Constitution:** Art. XII (deterministic source of truth, LLM never computes), XVI (AI ladder), X (cost/budget), XV (pluggable provider), VI (AI labeled/observable).
- **Decision source:** CLARIFICATIONS §B Q10 / Q12 / §D.
- **Related ADRs:** ADR-001 (LLMPort in the hexagon), ADR-008 (VisionPort, same ladder shape), ADR-009 (total redundancy), ADR-012 (config), ADR-005 (Turf/SQL do the math, not the LLM).
- **Official docs:** docs.litellm.ai; ollama.com; Groq / OpenRouter docs. Groq model ids verified 2026-06-29 (Groq's deprecation page is authoritative — pin a currently-served id at build): default `openai/gpt-oss-120b`, cheap `openai/gpt-oss-20b`; `llama-3.1-70b-versatile` is decommissioned. Claude Haiku 4.5 id `claude-haiku-4-5`, $1/$5 per 1M tokens (in/out) — per the claude-api skill (2026-06).
- **Implementation:** S05 (`src/adapters` LiteLLM `LLMPort`) — pending S04 gate.

## Review
**Approved by:** prod-architect + human, 2026-06-27 · **Implementation complete:** Yes (Phase-B/C/D) · **Revisit:** S02 model-pin finalization, then S05/S06 (re-check provider matrix + model ids against the current LiteLLM matrix and the latest Claude/Groq/Ollama model catalogs).
