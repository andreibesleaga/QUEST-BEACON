# ADR-008: Multi-modal/Vision — VisionPort (Cloud → Local LLaVA → Skip), Advisory & Cited Only
<!-- Architecture Decision Record — created by adr-writer.skill -->
<!-- Store in: docs/architecture/decisions/ADR-008-vision-port.md -->

**Date:** 2026-06-27
**Status:** Accepted
**Deciders:** prod-architect + human (Andrei Besleaga)
**Tags:** ai | security | frontend

---

## Context

BEACON has high-value multi-modal use cases: satellite-imagery analysis (Sentinel-2 burn-area/NBR delta for
fire-scar extent; optical/SAR flood-extent estimation), consented SOS-photo classification (scene/damage/
severity to enrich triage confidence), and optional scene/map understanding for operators. These are
genuinely useful but must never compromise trust or the golden path: vision output must be advisory, cited,
confidence-scored, feed the human-verify pipeline, never auto-trigger an alert, and never override
deterministic geometry (Art. XII/XIV). Every image must be consent-checked and PII-screened first; the
system must degrade gracefully with no vision model. We decide now because the `VisionPort` contract, the
SOS-triage use-case, and config (CONFIGURATION.md §5) depend on it.

**Current state:** Locked (CLARIFICATIONS §B Q11 / §D) = `VisionPort` + LiteLLM vision tier, cloud → local LLaVA → skip; vision off by default (stretch layer, `FEATURE_VISION=off`). No code yet.
**Constraints:** golden path must NOT depend on vision (PRD §12, OP1); advisory/cited/confidence-scored only, never auto-alert, never override geometry (Art. XII/XIV); consent + PII-screen mandatory before any image processing/storage (Art. XIV, `VISION_PII_SCREEN=on`); free/open models; offline-capable.

## Options Considered

### Option A — `VisionPort` with a cloud → local-LLaVA → skip ladder; advisory, cited, confidence-scored (CHOSEN)
A `VisionPort` (parallel to `LLMPort`) with a LiteLLM cloud vision tier (e.g. an open vision model via
OpenRouter), a local LLaVA-on-Ollama tier, and a final "skip" rung (advisory layer simply absent). Vision is
feature-flagged off by default; output is a flagged, cited, confidence-scored signal entering the same
human-verify pipeline. Every image is consent-checked and PII-screened before processing/storage.
**Pros:** degrades to nothing safely — cloud → local → skip means no vision model is never a dead-end (Art. XVI vision ladder, OP1), golden path never depends on it (PRD §12); trust-preserving by design — advisory/cited/confidence-scored, feeds human verify, never auto-alerts, never overrides deterministic geometry (Art. XII/XIV, PRD OP1); privacy-first — mandatory consent + PII-screen before any processing, only derived non-identifying classifications persist (Art. XIV, privacy U6, RESPONSIBLE_DATA); reuses the same provider-agnostic LiteLLM + Ollama machinery as ADR-007 (consistent oper-model story).
**Cons:** a second AI ladder + port to build, test, and keep current, plus extra prompts/validation for image tasks; local LLaVA is heavy and lower-quality, satellite/SAR estimates are coarse (must be labeled "estimated").
**Source:** CLARIFICATIONS §B Q11 / §D; CONFIGURATION.md §5; Constitution Art. XII/XIV/XVI; ollama.com (LLaVA); docs.litellm.ai (vision models).

### Option B — No vision at all
Drop multi-modal entirely.
**Pros:** simplest; smallest attack/privacy surface; no extra model cost.
**Cons:** forgoes a user-directed, high-value differentiator (burn-area/flood-extent, SOS-photo triage) the concept explicitly calls for (CLARIFICATIONS §B Q11, rubric innovation); leaves triage-confidence enrichment and imagery-derived hazard cues on the table.
**Source:** CLARIFICATIONS §B Q11 (user direction makes vision first-class).

### Option C — Vision required / vision in the critical path
Make vision a hard dependency that can directly drive alerts or geometry.
**Pros:** richer automated signal; fewer manual steps if it works.
**Cons:** violates Art. XII/XIV — vision would override deterministic geometry and/or auto-alert from an unverified, model-derived signal (in a crisis itself a hazard); breaks Art. XVI (a missing/failed vision model dead-ends the path) and PRD §12 (golden path must not depend on vision); privacy risk if images are required and not strictly consent/PII-gated.
**Source:** Art. XII/XIV/XVI; PRD §12, OP1.

## Decision

**We will use Option A — a `VisionPort` with a cloud → local-LLaVA → skip ladder, feature-flagged off by
default, producing only advisory, cited, confidence-scored signals into the human-verify pipeline, with
mandatory consent + PII-screen on every image.**
Rationale: (1) it captures the high-value multi-modal use cases without ever putting them in the critical
path — advisory/cited/confidence-scored, never auto-alert, never override geometry (Art. XII/XIV, PRD OP1);
(2) the cloud → local → skip ladder degrades to nothing safely, so the golden path never depends on vision
and the system stays usable air-gapped (Art. XVI, PRD §12); (3) mandatory consent + PII-screen makes the
privacy guarantee structural, not optional (Art. XIV).

## Consequences

- **+** Real multi-modal value (burn-area, flood-extent, SOS-photo triage) with zero golden-path dependency.
- **+** Trust and privacy guarantees enforced by design; vision can't auto-act or override geometry.
- **+** Off-by-default keeps the demo lean; switchable per deployment via `FEATURE_VISION`.
- **−** Second AI ladder/port to maintain; heavier local model (LLaVA) when offline vision is enabled.
- **−** Imagery-derived outputs are coarse and must always be labeled "estimated from imagery."
- **~** `VISION_MODE`, `VISION_PROVIDER/MODEL`, `VISION_LOCAL_MODEL`, `VISION_MAX_IMAGE_MB`, `VISION_PII_SCREEN` are all config (CONFIGURATION.md §5).
- **risk:** PII leakage via images → mitigated by mandatory PII-screen before processing/storage, only derived classifications persist (Art. XIV), `VISION_PII_SCREEN=on` default.
- **risk:** over-trust of vision output → mitigated by advisory/cited/confidence-scored labeling + human verify; never auto-alerts or overrides geometry (Art. XII/XIV).
- **risk:** demo flakiness from a slow/large model → mitigated by off-by-default + cached/mock imagery acceptable for the stretch layer (CLARIFICATIONS §B Q11).

## Y-Statement
> For triage and analysis where imagery adds signal (fire scars, flood extent, SOS photos), needing that
> signal without risking trust, privacy, or the golden path, a VisionPort with a cloud → local-LLaVA → skip
> ladder (advisory/cited/confidence-scored only) enriches the human-verify pipeline while degrading safely
> to no vision at all; unlike a no-vision or vision-required design, it captures the value without ever
> auto-alerting, overriding geometry, or blocking the demo.

## Links
- **PRD:** OP1 (advisory/cited vision, never auto-alert/override), §4 cross-cutting (multi-modal stretch), §11 (PII screen incl. SOS images), §12 (out of golden path).
- **Constitution:** Art. XII (vision advisory/cited, never overrides geometry), XIV (consent + PII screen), XVI (vision ladder cloud→local→skip), VI (AI labeled).
- **Decision source:** CLARIFICATIONS §B Q11 / §D.
- **Related ADRs:** ADR-007 (text AI ladder, same shape), ADR-001 (VisionPort in the hexagon), ADR-009 (redundancy), ADR-012 (config flags).
- **Official docs:** ollama.com (LLaVA); docs.litellm.ai (vision); Copernicus/Sentinel-2 imagery sources.
- **Implementation:** S05 (`src/adapters` VisionPort) — pending S04 gate; stretch layer.

## Review
**Approved by:** prod-architect + human, 2026-06-27 · **Implementation complete:** Yes (Phase-D W4c — composed in `src/main/build-vision.ts`, `FEATURE_VISION`-gated, MockVision default) · **Revisit:** S05/S06 (confirm local LLaVA performance; re-check open vision-model options).
