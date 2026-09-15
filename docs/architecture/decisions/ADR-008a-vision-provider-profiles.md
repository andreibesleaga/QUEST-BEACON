# ADR-008a: Env-Switchable Vision / LLM Provider Profiles (incl. Google Gemma Vision) — Companion to ADR-008
<!-- Architecture Decision Record — created by adr-writer.skill -->
<!-- Store in: docs/architecture/decisions/ADR-008a-vision-provider-profiles.md -->
<!-- COMPANION to ADR-008 (VisionPort). ADR-008 is unchanged; this ADR adds provider-profile detail. -->

**Date:** 2026-06-29
**Status:** Accepted (companion to ADR-008; does not modify it)
**Deciders:** prod-architect + human (Andrei Besleaga)
**Tags:** ai | infrastructure | frontend

---

## Context

ADR-008 locked the `VisionPort` (cloud → local-LLaVA → skip; advisory/cited/confidence-scored, off by
default). It deliberately left the *concrete provider/model selection* open. CONFIGURATION §5 already
makes vision provider/model env vars (`VISION_PROVIDER`, `VISION_MODEL`, `VISION_LOCAL_MODEL`), and §4 does
the same for text LLMs via LiteLLM tiers. We want to nail down the **provider profiles** so an operator can
switch vision/LLM provider and model entirely by environment — zero code change (Art. XV/XVI, 12-factor) —
including a first-class **Google Gemma vision** profile (Gemma 3 multimodal via a hosted OpenAI-compatible
endpoint, and local Gemma / PaliGemma via Ollama) alongside the existing OpenRouter/Qwen-VL and LLaVA
profiles, all behind LiteLLM. We decide now because the provider matrix informs `.env.example`, the LiteLLM
wiring (ADR-007), and the offline acceptance test. This ADR is **additive**: ADR-008 is not edited.

**Current state:** ADR-008 fixes the ladder shape; provider/model are config but the concrete profiles aren't enumerated.
**Constraint(s):** every provider/model/API-base/key is env-driven, switching never needs a code change (Art. XV/XVI; CONFIGURATION §4/§5); golden path must not depend on vision (off by default, ADR-008); offline-capable (local Ollama rung); free/open-leaning; LiteLLM is the single provider-agnostic client (ADR-007); advisory/cited/confidence-scored only, never auto-alert/override geometry (Art. XII/XIV).

---

## Options Considered

### Option A: One LiteLLM/OpenRouter abstraction + named env provider profiles (CHOSEN)
Keep a single LiteLLM client for both text (`LLMPort`, ADR-007) and vision (`VisionPort`, ADR-008). A
"profile" is just a set of env values — `*_PROVIDER`, `*_MODEL`, `*_API_BASE`, the matching `*_API_KEY` —
resolved at boot. Ship documented profiles including:

| Profile | Vision env (illustrative) | Notes |
|---|---|---|
| OpenRouter / Qwen-VL (default cloud) | `VISION_PROVIDER=openrouter`, `VISION_MODEL=qwen/qwen2.5-vl-72b-instruct` | CONFIGURATION §5 default (id verified 2026-06-29) |
| **Google Gemma vision** | `VISION_PROVIDER=google`, `VISION_MODEL=gemma-3-4b-it` (or `gemma-3-12b-it` / `gemma-3-27b-it`; multimodal Gemma 3) | hosted via OpenAI-compatible endpoint behind LiteLLM; `GOOGLE_API_KEY`. 1B is text-only; Gemma 4 (2026-04) may be preferred; local Ollama tag is `gemma3` |
| Local Gemma / PaliGemma (offline) | `VISION_MODE=local`, `VISION_LOCAL_MODEL=gemma3` (or a PaliGemma tag), `OLLAMA_BASE_URL=...` | runs on local Ollama; no key; air-gapped rung |
| Local LLaVA (offline, ADR-008 baseline) | `VISION_MODE=local`, `VISION_LOCAL_MODEL=llava` | ADR-008's named local rung |
| OpenAI-compatible (any) | `VISION_PROVIDER=openai`, `VISION_API_BASE=<endpoint>`, `VISION_MODEL=<model>` | point any tier at any OpenAI-compatible base |

Text-LLM tiers mirror this (`LLM_TIER_*`, CONFIGURATION §4): groq default → openrouter fallback → local
Ollama → deterministic-only. OpenRouter and a Google/Gemma route are switchable rungs; same machinery.

**Pros:**
- Pure env switching: provider/model/base/key are config; changing them (e.g. to Google Gemma vision, or local Gemma/PaliGemma via Ollama) needs no code change (Art. XV/XVI; CONFIGURATION §4/§5).
- One abstraction (LiteLLM, ADR-007) for text + vision; OpenRouter and a Google/Gemma route are just rungs — consistent operator model, prevents per-provider code paths.
- Keeps ADR-008's safety/ladder intact: still cloud → local → skip, off by default, advisory/cited; Gemma is simply a selectable cloud or local profile.
- Offline story preserved/expanded: local Gemma/PaliGemma or LLaVA on Ollama gives an air-gapped vision rung with no key.

**Cons:**
- A provider matrix to document and keep current as model ids change (e.g. Gemma model tags).
- Hosted-Gemma availability/quality varies by endpoint; treated as one switchable profile, not the sole path.

**Source:** CONFIGURATION §4/§5 (env-driven provider/model); ADR-007 (LiteLLM ladder); ADR-008 (VisionPort ladder); the author's agentic-AI engineering framework (config-for-everything, redundancy ladders); Ollama (local Gemma/PaliGemma/LLaVA); OpenRouter (provider router). Concrete Google/Gemma model ids and any hosted-endpoint availability MUST be confirmed against current official Google/Gemma + LiteLLM provider docs at wiring time (Research Gate, AGENTS.md §7) — do not assume model tags from memory.

### Option B: Hardcode one vision provider/model
Pick a single vision model in code.
**Pros:** simplest wiring.
**Cons:** violates config-for-everything (Art. XV/XVI) and the redundancy ladder; an operator could not switch to Google Gemma, a self-hosted endpoint, or offline Ollama without a code change. **Rejected.**
**Source:** Art. XV/XVI; CONFIGURATION §4/§5.

### Option C: Per-provider bespoke clients (no LiteLLM)
Write a dedicated client per provider (OpenRouter, Google, OpenAI, Ollama).
**Pros:** finest control per provider.
**Cons:** N code paths to maintain/test, contradicts ADR-007's single provider-agnostic client, and re-introduces provider lock-in the hexagon is meant to avoid. **Rejected.**
**Source:** ADR-007 (one LiteLLM client behind the port).

---

## Decision

**We will use Option A — a single LiteLLM/OpenRouter abstraction with named, env-switchable provider
profiles for both `VisionPort` and `LLMPort`, including a Google Gemma vision profile
(`VISION_PROVIDER=google`, `VISION_MODEL=gemma-3-4b-it` / `gemma-3-12b-it` / `gemma-3-27b-it`; local Gemma/PaliGemma via Ollama, tag `gemma3`) and any
OpenAI-compatible endpoint — selectable entirely by environment, zero code change.**

Because:
1. It satisfies config-for-everything and the redundancy ladder: provider/model/base/key are env, so switching to Google Gemma vision, a self-hosted OpenAI-compatible endpoint, or local Gemma/PaliGemma on Ollama is a `.env` edit, not code (Art. XV/XVI; CONFIGURATION §4/§5).
2. It reuses ADR-007's single LiteLLM client for text and vision, so there are no per-provider code paths and ADR-008's cloud → local → skip safety ladder is preserved unchanged.
3. It expands the offline rung (local Gemma/PaliGemma or LLaVA on Ollama) so vision still degrades to a key-less, air-gapped option, keeping the golden path independent of any cloud vision provider (ADR-008, off by default).

---

## Consequences

### Positive
- Operators choose vision/LLM provider+model (OpenRouter/Qwen-VL, Google Gemma, OpenAI-compatible, local Gemma/PaliGemma/LLaVA) purely via env — no code change, no rebuild.
- One LiteLLM abstraction; OpenRouter and Google/Gemma are interchangeable rungs; offline Ollama rung preserved.
- ADR-008 stays the source of truth for the ladder/safety; this ADR only enumerates profiles (additive).

### Negative
- A provider/model matrix to keep current (model ids drift; Gemma tags especially) — mitigated by treating model ids as config + a Research-Gate confirmation at wiring time.
- Hosted-Gemma vision availability/quality varies; it is one selectable profile, never the only path.

### Neutral
- New/illustrative env vars consistent with CONFIGURATION §4/§5: vision uses `VISION_PROVIDER`/`VISION_MODEL`/`VISION_API_BASE`/`VISION_LOCAL_MODEL`; a `GOOGLE_API_KEY` is added to the provider-keys list for the Google/Gemma profile (documented in CONFIGURATION/.env.example in the later integration step — not edited here).
- Vision remains off by default and advisory/cited/confidence-scored (ADR-008); profile choice never changes those guarantees.

### Risks
- Stale/incorrect model ids (e.g. a wrong Gemma tag) → mitigated by config-driven ids + Research Gate (AGENTS.md §7) confirming current official Google/Gemma + LiteLLM provider docs before wiring; fail-fast boot validation if a chosen mode lacks its key/base (CONFIGURATION §11).
- Over-reliance on one cloud provider → mitigated by the ladder (cloud → local → skip) and multiple interchangeable profiles.
- Provider key leakage → mitigated by env-only secrets, `.env` gitignored (AGENTS.md Secrets Policy).

---

## Y-Statement Summary

> For operators who need to choose their vision/LLM provider and model — including Google Gemma vision or a
> local Gemma/PaliGemma — without touching code,
> a single LiteLLM/OpenRouter abstraction with env-switchable provider profiles
> is a configuration approach
> that flips provider/model/base/key entirely via environment while preserving ADR-008's cloud → local → skip safety ladder.
> Unlike a hardcoded provider or per-provider bespoke clients,
> our solution adds providers (Gemma, OpenAI-compatible, offline Ollama) by config, with zero code change and no lost safety guarantees.

---

## Links

- **Parent ADR:** ADR-008 (VisionPort cloud → local-LLaVA → skip; advisory/cited; off by default) — **not modified by this ADR**.
- **Related ADRs:** ADR-007 (LiteLLM text provider ladder — same client), ADR-012 (config-for-everything), ADR-009 (total redundancy / offline-first).
- **Config:** CONFIGURATION §4 (`AI_MODE`, `LLM_TIER_*`, provider keys) and §5 (`FEATURE_VISION`, `VISION_MODE/PROVIDER/MODEL/LOCAL_MODEL`); integration of any new vars (e.g. `GOOGLE_API_KEY`) happens in the later CONFIGURATION/.env.example step, not here.
- **Official docs (confirm at wiring time — Research Gate):** Google/Gemma model documentation; docs.litellm.ai (provider routing incl. Google + vision models); ollama.com (local Gemma / PaliGemma / LLaVA); OpenRouter.
- **Constitution:** Art. XV/XVI (config-driven switching, redundancy ladders), Art. XII/XIV (vision advisory/cited; never auto-alert/override geometry; PII screen).
- **Implementation:** S05 LiteLLM wiring of `VisionPort`/`LLMPort` with profile resolution; pending S04 gate; vision is a stretch layer.

---

## Review

**Approved by:** prod-architect + human, 2026-06-29 · **Implementation complete:** Yes (Phase-D W4c, companion to ADR-008) · **Revisit:** S05/S06 — confirm current Google/Gemma vision model ids + hosted availability and local Gemma/PaliGemma performance on Ollama.
