# ADR-001: Hexagonal Ports-and-Adapters + Anti-Corruption Layer as the Core
<!-- Architecture Decision Record — created by adr-writer.skill -->
<!-- Store in: docs/architecture/decisions/ADR-001-hexagonal-ports-and-adapters.md -->

**Date:** 2026-06-27
**Status:** Accepted
**Deciders:** prod-architect + human (Andrei Besleaga)
**Tags:** architecture | infrastructure | pattern

---

## Context

BEACON unifies dozens of heterogeneous free/authoritative sources (FIRMS, NWS, NWPS, USGS, OSM Overpass,
GDELT, ReliefWeb, Copernicus/GloFAS, …) — each in a different wire format (CSV/XML/GeoJSON/ArcGIS/RSS/JSON)
— into one trustworthy COP, computes exposure/risk deterministically, and narrates it as a cited SitRep.
Source count only grows; an integrator must add a regional source with **zero core change**. The
risk-intersection/ranking/threshold/routing logic must be testable without a server, DB, or live API, and
the system must stay fully functional offline and when any provider is down (Art. XVI). Deciding now is
required because every S03/S05 artifact inherits this skeleton; choosing wrong is a big-bang rewrite.

**Current state:** Phase-2 concept (`Phase2/submission/ARCHITECTURE.md` §3) sketches a hexagonal spine; no code yet (spec-only S00→S04).
**Constraints:** Constitution Art. II (library-first, framework-agnostic logic), VIII (no circular deps, layer import rules), XV (every source a swappable adapter behind a port + ACL), XVI (total redundancy); source breadth must not destabilize core; near-$0 cost; small team.

## Options Considered

### Option A — Hexagonal (Ports & Adapters) + DDD + Anti-Corruption Layer (CHOSEN)
Domain entities/use-cases at center, depending only on port *interfaces*; all I/O (sources, DB, LLM, queue,
realtime) lives in adapters implementing those ports; an ACL normalizes every external format to the
canonical model before it crosses inward.
**Pros:** source breadth lives in adapters — add/replace = new adapter behind existing port, zero core change (Art. XV, integrator persona); redundancy ladders (cache/mock/circuit-breaker) become flag-swapped adapter concerns, never leaking into domain (Art. XVI); deterministic engine is pure and unit-testable with no server/DB/network (Art. I 99% coverage, AI-disabled test); ACL stops raw ArcGIS/CSV/RSS shapes leaking upward.
**Cons:** more upfront ceremony (port interfaces + DTO mapping + DI wiring before first feature); risk of premature abstraction if ports over-designed for hypothetical sources.
**Source:** Cockburn "Hexagonal Architecture"; Evans *DDD* (ACL pattern); Constitution Art. II/VIII/XV.

### Option B — Classic N-Tier / Layered (Controller → Service → Repository)
Controllers call services call repositories; source clients invoked directly from services.
**Pros:** familiar, least startup ceremony, many tutorials; fast for a CRUD-shaped app with 1–2 sources.
**Cons:** dependency arrow points toward infrastructure — logic imports DB/HTTP clients, violating Art. II and making the deterministic engine hard to test in isolation; no seam for swapping a source/fallback (adding source #20 touches the service layer, fighting Art. XV); ACL dissolves, raw formats leak into services.
**Source:** Fowler *PoEAA* (Layered/Service Layer); team experience with adapter-heavy ingestion.

### Option C — Framework-Native MVC (Next.js route handlers as the architecture)
Fetching, mapping, computation, rendering directly in route handlers / server components.
**Pros:** minimum boilerplate, ships a demo fastest; one mental model (the framework).
**Cons:** business rules inseparable from framework — the explicitly forbidden pattern (AGENTS.md §3, Art. II "risk logic inside a route handler/component"); untestable without booting Next.js (defeats TDD + offline/AI-disabled tests); no port seam → no redundancy ladders → fails Art. XVI.
**Source:** Constitution Art. II BEACON anti-patterns; AGENTS.md §3 Forbidden Patterns.

## Decision

**We will use Option A — Hexagonal Ports-and-Adapters + DDD with a mandatory Anti-Corruption Layer.**
Rationale: (1) it is the structural prerequisite for the core promise — many sources, one canonical model,
added as adapters with zero core change (Art. XV, integrator persona, PRD §1/§4); (2) only it keeps the
deterministic engine pure and server/DB/network-free, enabling Art. XII (LLM never computes), Art. I (99%
coverage), and the three Art. XVI acceptance tests; (3) redundancy ladders, last-known-good cache,
recorded-mock, and circuit breakers become adapter-local, flag-switchable concerns (CONFIGURATION.md §11).
Per Art. III (Rule of Three) the *port interfaces* are fixed up front (they are the architecture), but
shared *adapter helpers* are extracted only after three concrete adapters justify them.

## Consequences

- **+** Source breadth scales without core churn; integrator adds a regional adapter via the registry.
- **+** Deterministic core fully unit-testable; offline/AI-disabled/source-down tests achievable.
- **+** Clear layer import rules give the agentic-linter a precise contract (Art. VIII).
- **−** Upfront cost: ~15 port interfaces (P1–P15 + Queue/Spatial/Cache) + DTO mappers + DI composition root.
- **−** Developers must internalize the dependency rule (nothing inward depends on anything outward).
- **~** Explicit DTO ↔ domain mapping at the ACL boundary on every adapter.
- **~** Directory layout (`src/domain|application|ports|adapters|main` + `app/`) becomes mandatory.
- **risk:** over-abstraction of ports → mitigated by Rule of Three (concrete first three, then extract).
- **risk:** ACL mapping drift vs canonical model → mitigated by adapter contract tests (schemas/, S03) asserting every adapter emits valid canonical entities with provenance.

## Y-Statement
> For the BEACON team and future integrators needing to fuse many heterogeneous, sometimes-unavailable
> sources into one trustworthy COP, a hexagonal ports-and-adapters core with an ACL isolates a pure,
> testable deterministic domain from all I/O and source formats; unlike a layered or framework-native MVC
> design, it lets any source/infrastructure choice be swapped behind a port with zero core change and
> supports per-layer redundancy ladders by configuration alone.

## Links
- **PRD:** §1 (adapter spine), §4 (integrator), §7 (canonical model), §10 (reliability/offline NFRs).
- **Constitution:** Art. II (library-first), VIII (architecture integrity), XV (adapter integrity), XVI (total redundancy).
- **Related ADRs:** ADR-004 (QueuePort), ADR-005 (SpatialPort), ADR-006 (realtime), ADR-007 (LLMPort), ADR-008 (VisionPort), ADR-009 (redundancy), ADR-012 (config).
- **Official docs:** alistair.cockburn.us/hexagonal-architecture; DDD ACL pattern (Evans).
- **Implementation:** S05 scaffolding (`src/` — does not exist yet; project PAUSED at S04).

## Review
**Approved by:** prod-architect + human, 2026-06-27 · **Implementation complete:** Yes (Phase-B/C/D) · **Revisit:** S05 kickoff (validate port set P1–P15 against real adapters before extracting helpers).
