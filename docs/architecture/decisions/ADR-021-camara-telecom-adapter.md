# ADR-021: CAMARA / GSMA Open Gateway as a Future `TelecomPort` (P13) Plugin — Mock in Demo
<!-- Architecture Decision Record — created by adr-writer.skill -->
<!-- Store in: docs/architecture/decisions/ADR-021-camara-telecom-adapter.md -->

**Date:** 2026-06-29
**Status:** Accepted (v1.1 plugin; MOCK in the demo)
**Deciders:** prod-architect + human (Andrei Besleaga)
**Tags:** api | data | infrastructure | security

**Scope: OUT-OF-CORE optional plugin (MOCK in v1, flag-to-live post-v1) — non-blocking alignment/innovation example.** Demonstrates adapter/plugin extensibility + innovative mobile-API usage (aggregate population-density/connectivity, no individual tracking) and UN-SDG fit.

---

## Context

Telecom-network signals — aggregate population density, regional device counts, and connectivity status —
are high-value exposure/impact inputs for a disaster COP: they help estimate how many people are in a
hazard polygon and whether connectivity has degraded. CAMARA (Linux Foundation) / GSMA Open Gateway
standardizes these as carrier-neutral APIs (Population Density Data, Region Device Count, Connectivity
Insights, Device Location). BEACON already reserves a `Telecom` port (P13) in the hexagon
(DOMAIN_MODEL §6). However, live CAMARA access requires commercial GSMA Open Gateway operator agreements
and carries acute privacy obligations — so it cannot be a live demo dependency, and any use MUST be
aggregate-only (no individual tracking, Art. XIV). We decide now because we want the *wireability* proven
(zero-core-change plugin via the registry/manifest) and the canonical mapping fixed, while keeping the
adapter MOCK for the demo and documenting it as a v1.1 plugin. The CAMARA SDK/OpenAPI live at
`/home/andrei/work/camara/` (TypeScript SDK + unified OpenAPI aggregator).

**Current state:** P13 `Telecom` port reserved; no telecom data wired. CAMARA SDK/OpenAPI available locally.
**Constraint(s):** aggregate-only, no individual location/identity/device tracking (Art. XIV); free/open + offline-capable demo (live CAMARA is commercial — must default MOCK, Art. XVI); zero core change to add the adapter (adapter-contract §5, FR-10/OP2/OP3); advisory only — telecom signals never auto-alert and never override deterministic geometry (Art. XII/XIII); honest labeling (modeled/aggregate).

---

## Options Considered

### Option A: CAMARA as a flag-to-live `TelecomPort` plugin, MOCK by default (CHOSEN)
Register a `camara-gsma` adapter in `config/adapters.json` implementing the `SourceAdapterPort` for the
`Telecom` port (P13). It declares `coverage: { kind: "COUNTRIES", iso: [...] }`, `mode: "MOCK"`, and
ships a recorded fixture (`fixtures/camara-gsma/population-density.json`). Its anti-corruption layer maps
CAMARA responses (Population Density Data / Region Device Count / Connectivity Insights) into a canonical
`TelecomSignal` (`population-density`, `connectivity`, `region-device-count`), **aggregate-only**. A
deployment with a GSMA Open Gateway agreement flips `SOURCE_CAMARA_MODE=live` — pure config, no code change.

**Pros:**
- Zero-core-change wireability: it's one manifest entry + one adapter file behind the existing P13 port (adapter-contract §5; FR-10/OP2/OP3) — proves the hexagon's extensibility claim.
- Privacy by construction: canonical `TelecomSignal` is aggregate-only (density buckets, approximate counts, connectivity fractions); no individual location/identity ever crosses the ACL (Art. XIV). Matches CAMARA's own minimum-aggregation guidance.
- Safe-by-default: `mode: "MOCK"` keeps the demo free, offline, and reliable; `LIVE` is a flag flip when a commercial agreement exists (Art. XVI live→cached→mock ladder).
- Standards-aligned and real: uses actual CAMARA/GSMA Open Gateway API definitions (the local SDK/OpenAPI) without taking a runtime dependency on a paid service.

**Cons:**
- Live CAMARA is commercial and carrier-specific; the demo only ever exercises the MOCK rung.
- Aggregate-only mapping discards detail by design (acceptable — that detail is exactly what Art. XIV forbids).

**Source:** CAMARA SDK/OpenAPI at `/home/andrei/work/camara/` (Population Density Data, Region Device Count, Connectivity Insights APIs); adapter-contract §5; DOMAIN_MODEL §6 (P13 Telecom); CAMARA/GSMA Open Gateway (public standard); the author's agentic-AI engineering framework (adapter discipline).

### Option B: Bake CAMARA into core / make it a live dependency
Wire CAMARA calls directly or require live access for telecom layers.
**Pros:** richest signal if access exists; no mock indirection.
**Cons:** breaks free/offline demo (commercial dependency), violates adapter discipline (core change), and risks Art. XIV if raw device/location data is pulled in. **Rejected.**
**Source:** Art. XIV/XVI; adapter-contract §5 (adapters, not core).

### Option C: Drop telecom signals entirely
No telecom port wiring.
**Pros:** smallest surface.
**Cons:** forgoes a genuinely useful, standards-backed exposure/connectivity input and the chance to demonstrate the P13 plugin path; the port already exists in the model. **Rejected** in favor of a documented MOCK plugin.
**Source:** DOMAIN_MODEL §6 (P13 reserved).

---

## Decision

**We will add CAMARA / GSMA Open Gateway as a `TelecomPort` (P13) plugin — `camara-gsma` — registered in
the manifest with `mode: "MOCK"`, an aggregate-only canonical `TelecomSignal` mapping, and a recorded
fixture; it stays MOCK for the demo and is documented as a v1.1 plugin, flag-to-live via config.**

Because:
1. It proves zero-core-change extensibility of the hexagon (manifest + adapter file only; adapter-contract §5) for a real, standards-backed telecom source.
2. It is privacy-safe by construction — aggregate-only `TelecomSignal`, no individual tracking (Art. XIV) — and advisory-only, never auto-alerting or overriding deterministic geometry (Art. XII/XIII).
3. `mode: "MOCK"` keeps the demo free/offline/reliable while a single config flip (`SOURCE_CAMARA_MODE=live`) enables it where a GSMA Open Gateway agreement exists (Art. XVI ladder), using the real CAMARA API definitions in `/home/andrei/work/camara/`.

---

## Consequences

### Positive
- A real, standards-aligned telecom exposure/connectivity input is wired as a clean P13 plugin, demonstrable in MOCK.
- Privacy and trust guarantees are structural (aggregate-only ACL; advisory-only signal).
- Forward path to live is config-only for any operator with Open Gateway access.

### Negative
- The demo never exercises the live rung; live behavior is validated only against recorded fixtures and the CAMARA OpenAPI shapes.
- Aggregate-only intentionally drops fine detail.

### Neutral
- Canonical `TelecomSignal` kinds: `POPULATION_DENSITY` (density buckets / approximate population per cell), `REGION_DEVICE_COUNT` (bucketed/approximate device counts), `CONNECTIVITY` (network types, reachable fraction, degraded flag). Maps into EXPOSURE / INFRASTRUCTURE_NODE base (DOMAIN_MODEL §6, P12/P13).
- `coverage: COUNTRIES` with a representative ISO set; non-covered regions degrade to "not available in this region" (OP4), consistent with ADR-011.

### Risks
- Privacy regression (raw device/location leaks upward) → mitigated by the aggregate-only ACL contract + a contract test that rejects any individual-level field (Art. XIV); minimum-aggregation group enforced in the canonical mapping.
- Over-trust of telecom-derived figures → mitigated by advisory-only, labeled "estimated/aggregate," feeding the human-verify pipeline, never auto-alerting (Art. XII/XIII).
- Commercial/availability gating of live CAMARA → mitigated by MOCK default + the live→cached→mock ladder; no demo dependency on a paid service (Art. XVI).

---

## Y-Statement Summary

> For responders/EMs who need population-exposure and connectivity context in a hazard area without taking
> on a commercial dependency or any privacy risk,
> a CAMARA / GSMA Open Gateway `TelecomPort` (P13) plugin that maps to an aggregate-only canonical
> `TelecomSignal`, MOCK by default and flag-to-live via config,
> is a standards-backed adapter
> that adds telecom signal with zero core change and zero individual tracking.
> Unlike baking CAMARA into core or making it a live dependency,
> our solution keeps the demo free, offline, and privacy-safe while proving the plugin path.

---

## Links

- **SDK / API:** CAMARA TypeScript SDK + unified OpenAPI at `/home/andrei/work/camara/` (Population Density Data, Region Device Count, Connectivity Insights, Device Location); CAMARA Project / GSMA Open Gateway (public standard).
- **Manifest entry:** `config/adapters.json` (`id: camara-gsma`, `port: Telecom`, `coverage: COUNTRIES`, `mode: MOCK`).
- **Fixture:** `fixtures/camara-gsma/population-density.json` (aggregate-only; no PII).
- **Contract:** `schemas/adapter-contract.md` §3/§5 (SourceAdapterPort, registry/manifest, redundancy ladder).
- **Domain:** DOMAIN_MODEL §6 (P12 Population / P13 Telecom → EXPOSURE / INFRASTRUCTURE_NODE).
- **Constitution:** Art. XIV (aggregate-only, no individual tracking), Art. XII/XIII (advisory, never auto-alert/override geometry), Art. XVI (live→cached→mock ladder; offline demo).
- **Related ADRs:** ADR-001 (hexagon/ports), ADR-011 (multi-region coverage/`COUNTRIES`), ADR-012 (config flags), ADR-009 (redundancy ladder).
- **Implementation:** S05 `src/adapters/camara-gsma-adapter.ts` (ACL → `TelecomSignal`) — v1.1 plugin, MOCK in demo; pending S04 gate.

---

## Review

**Approved by:** prod-architect + human, 2026-06-29 · **Implementation complete:** Yes (Phase-D W1 — `src/adapters/sources/camara-gsma`, MOCK-only as decided/Option A, flag-to-live) · **Revisit:** when a deployment obtains a GSMA Open Gateway agreement (flip `SOURCE_CAMARA_MODE=live`) and re-verify the aggregate-only contract test against the live API shapes.
