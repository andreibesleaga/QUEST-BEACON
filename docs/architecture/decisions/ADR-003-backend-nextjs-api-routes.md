# ADR-003: Backend — Next.js API Routes + TypeScript (supersedes the stray "NestJS" mention)
<!-- Architecture Decision Record — created by adr-writer.skill -->
<!-- Store in: docs/architecture/decisions/ADR-003-backend-nextjs-api-routes.md -->

**Date:** 2026-06-27
**Status:** Accepted
**Deciders:** prod-architect + human (Andrei Besleaga)
**Tags:** api | infrastructure

---

## Context

BEACON needs an HTTP API surface (regions/incidents/sitrep/exposure/reports/routes/resources/alerts, EDXL
import-export, and an SSE delta stream — PRD §8) plus CRON ingestion workers. Phase-2 `AUDIT.md` §4 contained
a stray "NestJS + PostGIS + BullMQ" line that contradicts the rest of the concept; CLARIFICATIONS §C C1
explicitly voids it as a Phase-2 editing slip. We must record the backend framework decision authoritatively
so no agent reintroduces NestJS. Forces: keep deterministic logic framework-agnostic (Art. II), minimize
moving parts and cost (one deployable, ≈$0 local), run the same artifacts locally air-gapped and on cloud free tiers.

**Current state:** Locked default (CLARIFICATIONS §D, AGENTS.md §1) = TypeScript + Next.js API routes; no code yet. The contradictory NestJS mention is the only open inconsistency this ADR closes.
**Constraints:** single Node LTS runtime; one repo/one deployable for local↔cloud parity (Art. XVI); business logic must not live in the framework (Art. II); small team; Next.js already chosen for frontend (ADR-002) and as locked app framework.

## Options Considered

### Option A — Next.js (App Router) API routes + TypeScript, delegating to hexagonal use-cases (CHOSEN)
The same Next.js app serves UI, thin API route handlers, and the SSE endpoint; CRON workers run in the same
runtime; all handlers delegate immediately to `src/application` use-cases over `src/domain`.
**Pros:** one framework, one deployable for UI + API + SSE — minimal ops, smallest footprint, easiest to run air-gapped via `docker-compose up` and redeploy unchanged to a cloud free tier (Art. XVI parity); thin handlers keep business logic framework-agnostic (Art. II) — framework is just delivery; native streaming-response support fits the SSE delta channel (ADR-006); TypeScript end-to-end shares domain types between UI and API (no contract duplication).
**Cons:** route handlers less opinionated than a dedicated backend (no built-in DI/guards/pipes) — discipline from hexagonal layering + agentic-linter, not the framework; long-running workers in the same runtime need care (handled via QueuePort/CRON, ADR-004).
**Source:** nextjs.org/docs (Route Handlers, streaming); CLARIFICATIONS §D; Constitution Art. II.

### Option B — NestJS as a separate backend service
A dedicated NestJS API service alongside the Next.js frontend.
**Pros:** batteries-included (DI container, guards, interceptors, pipes, modules; strong conventions); clear frontend/backend separation.
**Cons:** two runtimes/deployables to build, wire, deploy — more cost/ops, harder to ship a single air-gapped image and maintain local↔cloud parity (against Art. XVI + ≈$0 NFR); heavy DI/decorator framework duplicates the hexagonal composition root and risks pulling logic into framework constructs (tension with Art. II); this is exactly the **voided** Phase-2 slip (CLARIFICATIONS §C C1) — reintroducing it contradicts the locked stack.
**Source:** docs.nestjs.com; CLARIFICATIONS §C C1 ("NestJS not used; Phase-2 editing slip, superseded").

### Option C — Separate standalone API service (Fastify/Express) + Next.js frontend
A lightweight Node API server separate from the Next.js app.
**Pros:** lightweight, flexible, well understood; decouples API lifecycle from the UI.
**Cons:** still two deployables and two config/CI sets — same parity/cost downside as B with less framework benefit; duplicate TypeScript build/type-sharing across two packages; no benefit over A at this demo's scale, adds integration surface.
**Source:** fastify.dev; expressjs.com; team experience.

## Decision

**We will use Option A — Next.js API routes + TypeScript, with thin handlers delegating to hexagonal
use-cases. This ADR explicitly SUPERSEDES the stray "NestJS" mention in Phase-2 `AUDIT.md` §4 (per
CLARIFICATIONS §C C1). NestJS is NOT used.**
Rationale: (1) a single Next.js deployable for UI + API + SSE is the leanest path to local↔cloud artifact
parity and air-gapped operation at ≈$0 (Art. XVI, cost NFR) — the central operational-readiness promise;
(2) thin route handlers over hexagonal use-cases keep business logic framework-agnostic (Art. II), so the
framework choice carries no architectural weight beyond delivery; (3) the locked stack-of-record
(CLARIFICATIONS §D) already mandates this — the only conflicting input is the voided NestJS slip this ADR closes.

## Consequences

- **+** One runtime, one image, one CI pipeline; trivial local↔cloud parity and air-gapped packaging.
- **+** Shared TypeScript types across UI/API/domain; no cross-service contract drift.
- **+** The "NestJS vs Next.js" ambiguity is permanently resolved and traceable.
- **−** No framework-provided DI/guards — discipline relies on the hexagonal composition root + agentic-linter.
- **−** Co-locating CRON/ingestion with the web runtime requires deliberate worker design (see ADR-004).
- **~** API route handlers must stay thin by convention (enforced as an architecture rule, AGENTS.md §3).
- **risk:** logic creeping into route handlers (forbidden pattern) → mitigate with agentic-linter layer import rules + code review (Art. VIII / II anti-patterns).
- **risk:** worker scaling under load → mitigate via QueuePort flag to BullMQ when needed (ADR-004), without changing the framework choice.

## Y-Statement
> For the BEACON team deploying a single app locally (air-gapped) and to cloud free tiers, needing an
> HTTP + SSE API without a second service, Next.js API routes in TypeScript delegating to hexagonal
> use-cases keep one deployable and one type system while leaving business logic framework-agnostic; unlike
> a separate NestJS or Fastify service, it avoids a second runtime, preserving local↔cloud parity and ≈$0
> cost — and it voids the stray Phase-2 NestJS mention.

## Links
- **PRD:** §8 (API surface incl. `/stream` SSE), §10 (portability/cost/offline NFRs).
- **Constitution:** Art. II (library-first / framework-agnostic logic), XVI (local↔cloud parity, air-gapped), VIII (architecture integrity / API contracts).
- **Supersedes:** Phase-2 `AUDIT.md` §4 "NestJS+PostGIS+BullMQ" line (voided per CLARIFICATIONS §C C1).
- **Related ADRs:** ADR-001 (hexagonal core), ADR-002 (frontend, same Next.js app), ADR-004 (queue), ADR-005 (spatial), ADR-006 (SSE), ADR-013 (ORM).
- **Official docs:** nextjs.org/docs/app/building-your-application/routing/route-handlers.
- **Implementation:** S05 (`app/` API routes — pending S04 gate).

## Review
**Approved by:** prod-architect + human, 2026-06-27 · **Implementation complete:** Yes (Phase-B/C/D) · **Revisit:** S05 (only if worker isolation or API scale demands a split — would be a new ADR).
