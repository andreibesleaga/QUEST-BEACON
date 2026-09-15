# ADR-009: Total Redundancy & Offline-First — Feature-Flagged Fallback Ladders on Every Layer
<!-- Architecture Decision Record — created by adr-writer.skill -->
<!-- Store in: docs/architecture/decisions/ADR-009-total-redundancy-offline-first.md -->

**Date:** 2026-06-27
**Status:** Accepted
**Deciders:** prod-architect + human (Andrei Besleaga)
**Tags:** infrastructure | performance | security

---

## Context

Disasters take down networks, power, and providers exactly when BEACON is needed most. The core
operational-readiness promise (Art. XVI) is that the system stays useful **fully offline/air-gapped** AND
**when any single provider/API is down** — at essentially zero cost — and that identical artifacts run
locally and on cloud free tiers. This is not one component's concern; it is a cross-cutting principle every
layer must honor with an explicit, configurable fallback ladder that always labels degradation
("estimated"/"unavailable"/freshness) rather than dead-ending. We record it as its own ADR because it
constrains the design of every other ADR (data, AI, vision, geo, queue, cache, realtime, routing, deploy)
and is a graded, test-enforced requirement.

**Current state:** Locked (CLARIFICATIONS §B Q12 → Constitution Art. XVI / §D). Each layer's ladder is specified; three mandatory acceptance tests defined. No code yet.
**Constraints:** no single dependency (AI, API, network, cloud) may be a hard requirement for core function (Art. XVI); local mode = no paid service, no outbound egress; same images local↔cloud; every degradation surfaced in UI/docs (Art. XV honest limitations); ≈$0.

## Options Considered

### Option A — Feature-flagged fallback ladders on every layer + air-gapped/cloud parity (CHOSEN — this principle)
Each capability declares and implements an explicit ladder, degrading one rung at a time and always
surfacing degradation: **Data** (primary API → secondary/global-equivalent → last-known-good cache →
recorded mock → "unavailable + freshness"); **AI text** (cloud → alt → Ollama → deterministic-only);
**Vision** (cloud → local → skip); **Geo** (PostGIS ↔ Turf); **Queue** (BullMQ ↔ CRON); **Cache/bus**
(Redis ↔ in-memory); **Realtime** (SSE → polling); **Routing** (ORS → Valhalla/OSRM → straight-line+avoid).
All driven by env flags (CONFIGURATION.md §11). Identical artifacts run air-gapped (`docker-compose up`,
local Ollama, cached layers, ~$0, no egress) and on cloud free tiers. Three mandatory acceptance tests: (a)
offline/air-gapped, (b) every primary source blocked, (c) AI disabled.
**Pros:** no single point of failure — every layer has a next rung, so the COP, deterministic insights, and ranked decisions survive provider/network/power/cloud loss (Art. XVI, UW1/UW2/UW4); config-driven, no code change — `local` vs `cloud`, live vs cached vs mock are flags (Art. XV, U5), demo runs lean and scale is a flag; honest degradation — freshness/"estimated"/"unavailable" labels everywhere preserve trust under partial failure (Art. XV, U4), never a UI dead-end; test-enforced — the three acceptance tests make redundancy a graded, regression-proof property, not an aspiration.
**Cons:** significant implementation + test surface (every adapter needs cache + recorded-mock + circuit breaker, and three full-system acceptance tests maintained); more config knobs to document and validate, more states to reason about per layer.
**Source:** CLARIFICATIONS §B Q12; Constitution Art. XVI (full ladders) + Art. XV; CONFIGURATION.md §11 + §"Acceptance tests"; PRD §6 redundancy, §10 reliability/offline NFRs.

### Option B — Best-effort resilience (retries + a cache, no full ladders, online-only)
Add per-call retries and a simple cache but assume connectivity; no air-gapped mode, no AI-off mode.
**Pros:** much less to build; covers transient blips; familiar pattern.
**Cons:** fails the core promise — no offline/air-gapped operation, no AI-disabled path, no global-equivalent fallback, directly violating Art. XVI and UW1/UW2/UW4; provider outage or network loss dead-ends the COP exactly when it's needed; forfeits rubric Cat 1/Cat 4 operational-readiness credit.
**Source:** Art. XVI (rejects "online-only"); PRD §6/§10.

### Option C — Redundancy at a few critical layers only (e.g. data + AI, not infra/realtime/routing)
Implement ladders for data and AI but leave queue/cache/realtime/routing single-path.
**Pros:** covers the highest-impact failure modes with less work.
**Cons:** leaves dead-end paths (e.g. SSE drop with no polling, Redis-required cache) that break air-gapped/cloud parity and the "works in all cases" guarantee (Art. XVI is explicitly all-layer); inconsistent operator model, harder to reason about which layers are safe.
**Source:** Art. XVI (ladders required on *every* listed layer).

## Decision

**We will adopt Total Redundancy & Offline-First as a cross-cutting architectural principle: every layer
implements an explicit, feature-flagged fallback ladder that always labels degradation, identical artifacts
run air-gapped and on cloud free tiers, and three mandatory acceptance tests (offline/air-gapped,
primary-source-down, AI-disabled) gate the build.**
Rationale: (1) it is the literal core operational-readiness promise (Art. XVI) and a graded rubric item —
disasters remove exactly the dependencies a naive design assumes; (2) driving every ladder by config (Art.
XV, U5) keeps the demo lean and ≈$0 while making scale and resilience a flag flip, not a rewrite; (3) the
three acceptance tests turn "works in all cases" into an enforced, regression-proof property rather than a claim.

## Consequences

- **+** The COP, deterministic insights, and ranked decisions remain available under any single failure.
- **+** True local↔cloud parity; ≈$0 air-gapped operation; honest, trust-preserving degradation labels.
- **+** Resilience is testable and regression-proof via the three mandatory acceptance tests.
- **−** Large build + test surface: per-adapter cache/mock/circuit-breaker and full-system acceptance tests.
- **−** Many config states to document, validate (fail-fast), and reason about.
- **~** Meta-decision constraining ADR-004/005/006/007/008/010/011 and the routing/deploy choices, which record the per-layer specifics.
- **risk:** combinatorial state explosion → mitigated by one consistent ladder shape per layer + the three canonical acceptance configurations (not testing every permutation).
- **risk:** mock/cache drift from reality → mitigated by recorded fixtures + freshness labels and the primary-source-down test exercising fall-through with correct labels.
- **risk:** maintenance cost of two paths per layer → accepted as the price of the operational-readiness promise; shared port contracts keep both paths behaviorally aligned (contract tests).

## Y-Statement
> For responders in disaster zones where networks, power, and providers fail, needing a tool that stays
> useful offline and when any single dependency is down, total redundancy & offline-first — feature-flagged
> fallback ladders on every layer with air-gapped/cloud parity and three mandatory acceptance tests —
> guarantees no single dependency is a hard requirement for core function; unlike best-effort online-only
> resilience, it serves the COP, deterministic insights, and ranked decisions with AI off, sources blocked,
> or fully air-gapped — at ≈$0.

## Links
- **PRD:** §6 (3 redundancy acceptance tests), OP2/OP3/OP4, UW1/UW2/UW4, §10 (reliability/offline/portability/cost NFRs).
- **Constitution:** Art. XVI (total redundancy & offline — the source article), XV (adapter ladders, honest limitations), X (cost), I (acceptance tests).
- **Decision source:** CLARIFICATIONS §B Q12 (→ Art. XVI).
- **Related ADRs:** ADR-004 (queue ladder), ADR-005 (geo ladder), ADR-006 (realtime ladder), ADR-007 (AI ladder), ADR-008 (vision ladder), ADR-010 (interop), ADR-011 (multi-region/global-equivalents), ADR-012 (config drives all ladders).
- **Config:** `../CONFIGURATION.md` §11 (ladder-to-flag map + S06 acceptance assertions).
- **Implementation:** S05 adapters + S06 acceptance tests — pending S04 gate.

## Review
**Approved by:** prod-architect + human, 2026-06-27 · **Implementation complete:** Yes (Phase-B/C/D) · **Revisit:** S06 (when the three acceptance tests are authored and run end-to-end).
