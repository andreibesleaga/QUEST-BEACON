# ADR-005: Persistence + Geo-compute — Postgres + Turf.js Default, PostGIS Behind a SpatialPort Flag
<!-- Architecture Decision Record — created by adr-writer.skill -->
<!-- Store in: docs/architecture/decisions/ADR-005-persistence-postgres-turf-postgis-flag.md -->

**Date:** 2026-06-27
**Status:** Accepted
**Deciders:** prod-architect + human (Andrei Besleaga)
**Tags:** database | performance | infrastructure

---

## Context

BEACON's deterministic engine computes exposure (infrastructure/people inside hazard geometry), distances,
risk-intersections, prediction cones/inundation polygons, and routing geometry — geospatial math that must
be reproducible, unit-testable, and runnable both server-side and (for some interactions) client-side,
fully offline. We need a canonical store and a geo-compute engine. The demo must run air-gapped at ≈$0 with
no special DB extension required, while still supporting heavy server-side spatial workloads when available.
Deciding now is required because the canonical schema (PRD §7) and the SpatialPort contract feed S03 DDL and S05.

**Current state:** Locked default (CLARIFICATIONS §D, §C C2/C3) = Postgres + client/server Turf.js; PostGIS behind a `FEATURE_SPATIAL` flag. The Phase-2 "PostGIS required" framing is superseded.
**Constraints:** no mandatory DB extension for local/air-gapped (Art. XVI); geo math deterministic and testable (Art. XII, Art. I); same SpatialPort behavior either way (Art. XV, PRD OP2); ≈$0 cost; Postgres is the locked canonical store.

## Options Considered

### Option A — Postgres canonical store + Turf.js geo-compute default, PostGIS behind a `SpatialPort` flag (CHOSEN)
A `SpatialPort` with two adapters: Turf.js (JS, in-process, client/server) as default, and PostGIS (SQL
spatial) selected by `FEATURE_SPATIAL=postgis`. Plain Postgres holds canonical entities; geometry stored as
GeoJSON/columns and computed via the active SpatialPort.
**Pros:** plain Postgres + Turf.js needs no PostGIS extension — runs anywhere, fully air-gapped, ≈$0, on any cloud free-tier Postgres (e.g. Neon) (Art. XVI, cost NFR); Turf.js (MIT) runs identically server/client, enabling offline client-side geo + pure, deterministic, unit-testable geometry (Art. XII, Art. I; matches U3 "compute numbers deterministically"); PostGIS one flag away for heavy server-side spatial joins/indexing at scale, same SpatialPort contract, no code change (Art. XV, PRD OP2); either engine alone satisfies the core exposure math (CONFIGURATION.md §11).
**Cons:** Turf.js slower than PostGIS for very large spatial joins / lacks spatial indexes — fine at demo scale, a known limit at very large datasets (documented; PostGIS flag exists for that case); two SpatialPort adapters to keep behaviorally equivalent.
**Source:** CLARIFICATIONS §D / §C C2/C3; CONFIGURATION.md §2/§11; turfjs.org (MIT); postgis.net.

### Option B — PostGIS required (Phase-2 framing)
Make PostGIS a hard dependency for all spatial computation and storage.
**Pros:** mature, indexed, fast server-side spatial operations; rich function set (ST_Intersects, ST_DWithin…); single spatial code path in SQL.
**Cons:** forces the PostGIS extension everywhere, complicating local/air-gapped setup and some managed free-tier Postgres offerings — conflicts with Art. XVI + ≈$0 NFR; no client-side/offline geo path (cannot do in-browser interactions without a server round-trip); pushes deterministic logic into SQL, harder to unit-test in isolation (tension with Art. I/XII test goals); contradicts the locked default — exactly the over-requirement CLARIFICATIONS §C C2/C3 relaxed.
**Source:** postgis.net; CLARIFICATIONS §C C2/C3.

### Option C — Dedicated spatial database (separate GIS engine)
Use a specialized GIS datastore alongside Postgres.
**Pros:** purpose-built spatial performance/features.
**Cons:** second datastore to operate, sync, and deploy — heavy for the demo, hurts local↔cloud parity and cost; splits the canonical model across stores, against the single-source-of-truth Postgres design.
**Source:** team experience; Art. XVI parity/cost constraints.

## Decision

**We will use Option A — Postgres as the canonical store with Turf.js geo-compute by default, and PostGIS
selectable behind a `SpatialPort` + `FEATURE_SPATIAL` flag.**
Rationale: (1) plain Postgres + Turf.js is the only option that runs air-gapped at ≈$0 with no extension and
on any free-tier Postgres, preserving local↔cloud parity (Art. XVI, cost NFR); (2) Turf.js gives pure,
deterministic, server-and-client geometry functions that are trivially unit-testable and never delegate
numbers to the LLM (Art. XII, Art. I, PRD U3); (3) PostGIS is available by one flag for large-scale
server-side spatial work under the identical SpatialPort contract (Art. XV, PRD OP2), matching the locked stack-of-record.

## Consequences

- **+** Dependency-free, air-gapped, ≈$0 default; client-side offline geo possible.
- **+** Deterministic, unit-testable geometry; clean SpatialPort seam.
- **+** Flag-driven scale path to PostGIS with no refactor.
- **−** Turf.js lacks spatial indexing — large spatial joins are slower (mitigated by demo scale + PostGIS flag).
- **−** Two SpatialPort adapters to maintain equivalently.
- **~** Geometry persisted in a portable form (GeoJSON/columns) usable by either engine.
- **risk:** performance on large layers under Turf → mitigate with bbox pre-filtering, geometry simplification, and switching `FEATURE_SPATIAL=postgis` where indexed joins matter.
- **risk:** adapter divergence → mitigate with shared SpatialPort contract tests run against both engines.

## Y-Statement
> For BEACON's deterministic engine running locally air-gapped and on cloud free tiers, needing reproducible
> exposure/geometry math without a mandatory spatial extension, Postgres + Turf.js by default with PostGIS
> behind a SpatialPort flag keeps geometry pure, testable, server/client-capable, and dependency-free — yet
> scales to indexed SQL spatial joins by one config change; unlike a PostGIS-required design, it never
> forces an extension on an air-gapped, ≈$0 deployment.

## Links
- **PRD:** U3 (deterministic numbers), EV2 (exposure recompute), EV7/EV8/EV12 (routing/prediction geometry), §7 (canonical model), OP2, §10 (offline/cost).
- **Constitution:** Art. XII (deterministic source of truth), XVI (offline/redundancy), XV (pluggable infra), I (testability).
- **Supersedes/relaxes:** Phase-2 "PostGIS required" framing (per CLARIFICATIONS §C C2/C3).
- **Related ADRs:** ADR-001 (SpatialPort in the hexagon), ADR-007 (LLM never computes geometry), ADR-009 (redundancy), ADR-013 (ORM over Postgres).
- **Official docs:** turfjs.org; postgis.net; postgresql.org/docs.
- **Implementation:** S03 DDL + S05 adapters (pending S04 gate).

## Review
**Approved by:** prod-architect + human, 2026-06-27 · **Implementation complete:** Yes (Phase-B/C/D — Postgres + Turf default are live; the PostGIS `FEATURE_SPATIAL=postgis` flag path remains an explicit, honestly-labeled stub per `src/adapters/spatial/postgis-spatial.ts`) · **Revisit:** S05/S06 (if profiling shows Turf spatial joins exceed latency NFR → enable PostGIS).
