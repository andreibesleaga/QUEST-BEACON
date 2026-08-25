# ADR-013: ORM — Drizzle over Prisma (Postgres, TypeScript)
<!-- Architecture Decision Record — created by adr-writer.skill -->
<!-- Store in: docs/architecture/decisions/ADR-013-orm-prisma-vs-drizzle.md -->

**Date:** 2026-06-27
**Status:** Accepted
**Deciders:** prod-architect + human (Andrei Besleaga)
**Tags:** database | infrastructure

---

## Context

BEACON persists ~19 canonical entities in PostgreSQL (REGION, INCIDENT, HAZARD_GEOMETRY, GAUGE,
INFRASTRUCTURE_NODE, EXPOSURE, PREDICTION, PUBLIC_REPORT, SITREP, CITATION, SOURCE_RECORD, ALERT,
THRESHOLD_RULE, RESOURCE, RESOURCE_TASK, SHELTER, EVAC_ROUTE, APP_USER, AUDIT_EVENT) accessed via a
`Repository` port (the domain never touches the DB directly — Art. II). The store must run plain Postgres
with no required extension (Turf-default geo, PostGIS behind a flag — ADR-005), ship air-gapped at ≈$0, and
deploy unchanged to cloud free-tier Postgres (e.g. Neon). Both AGENTS.md §1 and PRD §13 leave the ORM open
("Prisma or Drizzle — confirm at S02/S03"). This ADR resolves it as required, picking one as Accepted with a
documented revisit.

**Current state:** Open question (AGENTS.md §1, PRD §13 "ORM choice — decide at S02/S03"). No code yet.
**Constraints:** PostgreSQL canonical store (CLARIFICATIONS §D); TypeScript 5.x; runs behind a `Repository` port (Art. II); air-gapped/≈$0; deploys unchanged to cloud free-tier Postgres; works alongside the SpatialPort flag (raw SQL / PostGIS when enabled — ADR-005); 99% test coverage (Art. I).

## Options Considered

### Option A — Drizzle ORM (+ drizzle-kit migrations) (CHOSEN)
A lightweight, SQL-first TypeScript ORM: schema defined in TS, type-safe query builder mapping closely to
SQL, migrations via `drizzle-kit`. Thin runtime, no separate engine binary.
**Pros:** SQL-first + escape hatch — its query builder mirrors SQL and raw SQL is first-class, fitting BEACON's deterministic engine and the PostGIS-flag path (ADR-005) where hand-written spatial SQL is needed (`ST_Intersects`, `ST_DWithin`); lightweight, no engine binary — no separate query-engine process to bundle/run, smaller footprint, simpler air-gapped Docker image and cloud free-tier deploy (Art. XVI parity, ≈$0); strong end-to-end TS types inferred from the schema, sits cleanly behind a `Repository` port adapter; works directly over a standard `pg`/postgres driver — easy to point at local Postgres or Neon via `DATABASE_URL` with no code change (ADR-012).
**Cons:** smaller (though fast-growing) ecosystem and less batteries-included than Prisma, fewer high-level conveniences (e.g. nested writes); migration tooling is younger, some workflows more manual than Prisma Migrate.
**Source:** orm.drizzle.team (SQL-first, no engine binary, drizzle-kit); ADR-005 (PostGIS/raw-SQL path); Constitution Art. XVI (lean air-gapped image).

### Option B — Prisma ORM (+ Prisma Migrate)
A mature, batteries-included ORM: declarative `schema.prisma`, generated typed client, robust migrations, large ecosystem and docs.
**Pros:** mature, excellent DX, strong migration tooling (`prisma migrate`), large community and docs; declarative schema + generated client, nested writes and relations are ergonomic; widely used with Next.js, the AGENTS.md migrate command already references `prisma migrate dev`.
**Cons:** historically shipped a separate Rust query-engine binary the app invokes — a heavier runtime/image and an extra moving part to bundle for air-gapped Docker and small cloud free tiers (tension with the lean ≈$0 image goal). **Note (verified 2026-06-29): Prisma 7 dropped the Rust engine** in favour of a TypeScript/WASM query compiler, so this footprint con is largely resolved on current Prisma; Drizzle is still chosen for being SQL-first, lighter, and offering native PostGIS geometry handling. Prisma is also more abstracted from SQL — mixing raw spatial SQL for the PostGIS-flag path (ADR-005) is less natural than Drizzle's SQL-first model; its generated-client + schema-language indirection adds a build step and a layer between the domain port and the SQL.
**Source:** prisma.io/docs (schema, migrate, client/engine model); ADR-003/AGENTS.md §2 (`prisma migrate dev` placeholder); Constitution Art. XVI (image footprint).

## Decision

**We will use Drizzle ORM (with drizzle-kit migrations), behind the `Repository` port, as the Accepted
choice — superseding the placeholder `prisma migrate dev` command in AGENTS.md §2.**
Rationale: (1) its SQL-first model and first-class raw SQL fit BEACON best — the deterministic engine and the
PostGIS-flag path (ADR-005) need hand-written spatial SQL, which Drizzle expresses naturally; (2) no separate
query-engine binary keeps the air-gapped Docker image lean and the cloud free-tier deploy simple, directly
serving the ≈$0 / local↔cloud-parity goal (Art. XVI, ADR-012's `DATABASE_URL`); (3) it gives strong inferred
TS types behind the `Repository` port adapter without an extra generated-client layer, keeping the domain
framework-agnostic (Art. II). Both options are viable; the deciding factors are SQL-first ergonomics for
spatial work and a lighter runtime footprint. The AGENTS.md §2 migration command should read `drizzle-kit`
rather than `prisma migrate dev` once scaffolded.

## Consequences

- **+** Natural fit with raw/spatial SQL and the PostGIS flag; deterministic queries are transparent.
- **+** Lean runtime/image — easier air-gapped packaging and small cloud free-tier deploys.
- **+** Clean type-safe `Repository` adapter; no engine binary to manage.
- **−** Smaller ecosystem than Prisma; fewer high-level conveniences; team may need to write more SQL by hand.
- **−** Younger migration tooling — more manual review of generated migrations.
- **~** `DATABASE_URL` (CONFIGURATION.md §2) selects local Postgres vs cloud free-tier with no code change.
- **~** The repository is the only layer touching Drizzle; swapping ORMs later is contained to that adapter.
- **risk:** migration-tooling immaturity bites → mitigated by keeping the `Repository` port as the only ORM boundary (swap is localized) and reviewing every generated migration; **revisit if** drizzle-kit blocks a needed workflow.
- **risk:** team familiarity gap (Prisma is more common) → mitigated by Drizzle's SQL-closeness (lower magic) and the contained adapter; **revisit at S03/S05** if onboarding cost proves high.
- **risk:** decision reversal cost → low, because all DB access is behind the `Repository` port (Art. II), so switching to Prisma later is an adapter-level change, not a core rewrite.

## Y-Statement
> For BEACON's persistence layer on PostgreSQL behind a Repository port, needing transparent, SQL-first,
> type-safe access that fits spatial SQL and a lean air-gapped image, Drizzle ORM (with drizzle-kit) maps
> closely to SQL and ships no separate query-engine binary; unlike Prisma, it keeps raw/spatial SQL
> first-class and the runtime footprint minimal — at the cost of a smaller ecosystem, which we accept and
> will revisit at S03/S05.

## Links
- **PRD:** §7 (canonical entities / DDL at S03), §13 (open question: Prisma vs Drizzle — this ADR resolves it), §10 (portability/cost NFRs).
- **Constitution:** Art. II (Repository port, framework-agnostic domain), XVI (lean air-gapped image / local↔cloud parity), VIII (architecture integrity).
- **Supersedes:** AGENTS.md §2 placeholder `prisma migrate dev` (use `drizzle-kit` once scaffolded).
- **Related ADRs:** ADR-001 (Repository port in the hexagon), ADR-003 (single Next.js deployable), ADR-005 (Postgres + Turf/PostGIS — raw spatial SQL path), ADR-012 (`DATABASE_URL` config).
- **Config:** `../CONFIGURATION.md` §2 (`DATABASE_URL`, `FEATURE_SPATIAL`).
- **Official docs:** orm.drizzle.team; prisma.io/docs; postgresql.org/docs.
- **Implementation:** S03 DDL + S05 Repository adapter — pending S04 gate.

## Review
**Approved by:** prod-architect + human, 2026-06-27 · **Implementation complete:** Yes (Phase-B/C/D) · **Revisit:** S03/S05 — re-confirm at first real schema/migration work; reverse to Prisma only if drizzle-kit migrations or team familiarity prove blocking (low cost: change contained to the Repository adapter).
