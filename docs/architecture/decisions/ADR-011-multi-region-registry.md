# ADR-011: Multi-Region — Region-Registry Model (CA Live + 1 Non-US Cached; Global-Equivalent Adapters)
<!-- Architecture Decision Record — created by adr-writer.skill -->
<!-- Store in: docs/architecture/decisions/ADR-011-multi-region-registry.md -->

**Date:** 2026-06-27
**Status:** Accepted
**Deciders:** prod-architect + human (Andrei Besleaga)
**Tags:** infrastructure | api | data

---

## Context

BEACON must be portable to any region, not hardwired to one country's feeds. The demo ships a California
flagship region fully LIVE (FIRMS + NWS + NWPS + USGS + Overpass) plus at least one non-US region (European
flood via Copernicus/GloFAS/MeteoAlarm/Open-Meteo) on CACHED data to prove free-world/global portability
(CLARIFICATIONS §A U4). Different regions have different applicable sources: a US-only feed must not break a
European region — it should be marked "not available in this region" and a global-equivalent adapter used
where one exists. We decide the multi-region model now because the region registry, adapter `coverage`
declarations, and the COP region-select flow (PRD EV1/FR-1) depend on it, and it underpins the
global-equivalent fallback rung of Art. XVI.

**Current state:** Locked (CLARIFICATIONS §A U4, §B Q9 / §D) = a region registry (config/seed) with each region = `{id, name, scope, bbox, enabled_adapters[], source_mode_overrides}`; adapters declare `coverage`; global-equivalents fill non-US gaps. No code yet.
**Constraints:** region-portable (US + global) (PRD §10); a non-applicable source must degrade gracefully, not break (Art. XV, OP4); free-world global-equivalent data (Art. XI); config-driven (U5); one live flagship + ≥1 cached non-US region in the demo (U4).

## Options Considered

### Option A — Region registry + adapter `coverage` declarations + global-equivalent adapters (CHOSEN)
A config/seed `region registry`: each region declares `{id, name, scope, bbox, enabled_adapters[],
source_mode_overrides}`. Each source adapter declares `coverage` (US / global / specific country). When a
region selects a source whose coverage doesn't apply, the layer is marked "not available in this region" and
a global-equivalent adapter is used where one exists (GloFAS for flood, Copernicus EFFIS for fire,
MeteoAlarm/Open-Meteo for weather outside the US). `DEFAULT_REGION_ID` selects the region on first open.
**Pros:** genuine portability — adding a region is a registry entry + adapter coverage, the hexagonal core and UI are region-agnostic (Art. XV, U5, integrator persona); graceful coverage gaps — a US-only feed in Europe is labeled "not available in this region" and a global-equivalent substituted, never a broken layer (Art. XV, OP4, the Art. XVI global-equivalent rung); first-class free-world data — global-equivalents (GloFAS/EFFIS/MeteoAlarm/Open-Meteo) give non-US regions real coverage from open providers (Art. XI, CLARIFICATIONS §B Q13); per-region `source_mode_overrides` make live/cached/mock a per-region config flag (matches U4: CA live, EU cached).
**Cons:** requires every adapter to declare and respect coverage, and a global-equivalent mapping to maintain; region registry + bbox/scope modeling is extra config surface and validation.
**Source:** CLARIFICATIONS §A U4, §B Q9 / Q13 / §D; CONFIGURATION.md §9; Constitution Art. XI/XV/XVI; Copernicus EFFIS/GloFAS, MeteoAlarm, Open-Meteo (global-equivalents).

### Option B — Single hardcoded region (US-only)
Hardcode the California/US feed set; no region abstraction.
**Pros:** simplest; fastest golden-path demo for one region.
**Cons:** not portable — fails the explicit multi-region requirement (U4) and the region-portability NFR (PRD §10); a non-US deployment would require code changes (violates U5/Art. XV); no path to prove free-world/global coverage (rubric).
**Source:** CLARIFICATIONS §A U4 (multi-region is required); PRD §10.

### Option C — Per-region forked deployments (one build per country)
Ship a separate build/config per region.
**Pros:** each build is simple internally; no runtime region switching.
**Cons:** breaks "identical artifacts" parity (Art. XVI) and the single-deployable model (ADR-003), an operational nightmare to maintain N builds; no in-app region select, integrator can't add a region without a new build; duplicates the adapter spine per fork.
**Source:** Art. XVI (identical artifacts); ADR-003 (single deployable).

## Decision

**We will use Option A — a config/seed region registry with per-region adapter selection + per-region source
modes, adapters that declare `coverage`, and global-equivalent adapters for non-US gaps. The demo ships
California LIVE + one non-US (EU flood) region CACHED.**
Rationale: (1) only a registry + coverage model makes BEACON genuinely region-portable with the core and UI
staying region-agnostic (Art. XV, U5, U4) — adding a region is config, not code; (2) coverage-aware
degradation + global-equivalents means a non-applicable source never breaks a region, it labels "not
available" and substitutes an open global equivalent (Art. XV/XVI, OP4, Art. XI); (3) it matches the locked
stack-of-record and the demo's portability proof (CA live + EU cached), and feeds the Art. XVI
global-equivalent fallback rung directly.

## Consequences

- **+** New regions are registry entries; core/UI unchanged; integrator can add regional coverage.
- **+** Coverage gaps degrade gracefully with honest "not available in this region" labels.
- **+** Real non-US coverage via free-world global-equivalents; demo proves global portability.
- **−** Every adapter must declare/respect `coverage`; a global-equivalent mapping must be curated and maintained.
- **−** Region registry, bbox/scope, and per-region overrides add config + validation surface.
- **~** `REGIONS_CONFIG` (`./config/regions.json`) and `DEFAULT_REGION_ID` are config (CONFIGURATION.md §9); per-region `source_mode_overrides` set live/cached/mock per region.
- **risk:** wrong/missing coverage mapping (US feed shown in EU) → mitigated by adapter `coverage` declarations + the "not available in this region" rule (OP4) and registry validation.
- **risk:** global-equivalent quality variance → mitigated by honest labeling/freshness and keeping the non-US region CACHED for the demo (U4); equivalents documented per layer.
- **risk:** region-config drift vs adapters → mitigated by fail-fast boot validation of `enabled_adapters[]` against the adapter registry (U5).

## Y-Statement
> For operators and integrators deploying BEACON across US and non-US regions, needing real coverage
> everywhere without per-region code changes or broken layers, a config-driven region registry with adapter
> coverage declarations and global-equivalent adapters keeps the core region-agnostic and degrades
> non-applicable sources gracefully; unlike a hardcoded single-region or per-region forked build, it adds
> regions by configuration and gives non-US regions genuine free-world coverage.

## Links
- **PRD:** EV1/FR-1 (region select loads region layers), OP4 (coverage gap → "not available" + global-equivalent), §6 (multi-region: CA live + EU cached), §10 (portability NFR).
- **Constitution:** Art. XV (adapter coverage, graceful degradation), XVI (global-equivalent fallback rung), XI (first-class free-world data, global-equivalents), II (region-agnostic core).
- **Decision source:** CLARIFICATIONS §A U4, §B Q9 / Q13 / §D.
- **Related ADRs:** ADR-001 (adapters/registry in the hexagon), ADR-009 (global-equivalent rung), ADR-010 (GLIDE/GeoJSON cross-region identity/geometry), ADR-012 (region config).
- **Config:** `../CONFIGURATION.md` §9 (`REGIONS_CONFIG`, `DEFAULT_REGION_ID`); data verdicts in `../../audit/DATA_SOURCE_VERIFICATION.md`.
- **Implementation:** S03 region schema/seed + S05 coverage-aware adapters — pending S04 gate.

## Review
**Approved by:** prod-architect + human, 2026-06-27 · **Implementation complete:** Yes (Phase-B/C/D) · **Revisit:** S03 (confirm the exact non-US flagship EU country; PRD §13 open question).
