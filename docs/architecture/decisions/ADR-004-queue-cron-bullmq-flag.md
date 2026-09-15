# ADR-004: Queue/Workers — CRON Default, Redis+BullMQ Behind a QueuePort Flag
<!-- Architecture Decision Record — created by adr-writer.skill -->
<!-- Store in: docs/architecture/decisions/ADR-004-queue-cron-bullmq-flag.md -->

**Date:** 2026-06-27
**Status:** Accepted
**Deciders:** prod-architect + human (Andrei Besleaga)
**Tags:** infrastructure | performance

---

## Context

BEACON ingests many sources on a schedule (default 300s cadence, per-source overrides), recomputes exposure
on new hazard/exposure data, and evaluates threshold rules each cycle — needing a worker mechanism. The
demo must run fully local/air-gapped at ≈$0 with no extra infrastructure, yet must also scale to higher
source counts/cadence on cloud free tiers when desired, all without code change (Art. XVI). We must pick
the default worker engine and the scale path now because the QueuePort contract and ingestion use-cases depend on it.

**Current state:** Locked default (CLARIFICATIONS §D) = CRON/interval; BullMQ behind a `FEATURE_QUEUE` flag. Phase-2 diagrams showing BullMQ as primary are re-captioned "CRON default; BullMQ optional" (CLARIFICATIONS §C C7).
**Constraints:** zero mandatory external dependency for local/air-gapped (Art. XVI); Redis must be optional; same behavior contract regardless of engine (Art. XV, PRD OP2); ≈$0 cost NFR.

## Options Considered

### Option A — CRON/interval default + Redis+BullMQ behind a `QueuePort` feature flag (CHOSEN)
A `QueuePort` with two adapters: an in-process CRON/interval scheduler (zero dependency) as default, and a
Redis+BullMQ adapter selected by `FEATURE_QUEUE=bullmq` (requires `REDIS_URL`).
**Pros:** zero-dependency local/air-gapped path — `docker-compose up` needs only app + Postgres, no Redis (Art. XVI, ≈$0 NFR); BullMQ available by a single flag for durable retries/concurrency/backpressure when scaling on cloud, same QueuePort contract, no code change (PRD OP2, Art. XV); ladder (bullmq ↔ cron) already modeled in CONFIGURATION.md §3/§11, consistent with every other redundancy ladder.
**Cons:** two adapters to build and keep behaviorally equivalent (idempotency, retry semantics) under one port; in-process CRON has weaker durability than BullMQ (lost on crash mid-cycle) — acceptable for the poll-and-recompute model since the next cycle re-fetches (documented limitation).
**Source:** CLARIFICATIONS §D / §C C7; CONFIGURATION.md §3; docs.bullmq.io; node-cron / setInterval.

### Option B — Redis+BullMQ only (as the Phase-2 diagrams implied)
Make BullMQ the single, required worker engine.
**Pros:** one worker code path; durable, observable jobs with mature retry/concurrency primitives; good for high-volume, high-cadence ingestion at scale.
**Cons:** forces Redis as a hard dependency for every deployment, breaking the air-gapped/≈$0 local promise (direct conflict with Art. XVI + cost NFR); over-engineered for a demo cadence (minutes), adds an always-on service to operate; contradicts the locked default — exactly the over-claim CLARIFICATIONS §C C7 corrected.
**Source:** docs.bullmq.io (Redis requirement); CLARIFICATIONS §C C7.

### Option C — Cloud-managed scheduler/queue (hosted cron/queue service)
Use a managed scheduler/queue on the cloud host.
**Pros:** offloads durability/ops to the platform; simple at cloud scale.
**Cons:** provider-specific, not portable, and cannot run air-gapped/local (breaks Art. XVI parity); risks egress/vendor lock-in against the no-egress local requirement and Art. XI's open-stack ethos.
**Source:** team experience; Art. XVI parity requirement.

## Decision

**We will use Option A — CRON/interval as the default worker engine, with Redis+BullMQ selectable behind a
`QueuePort` + `FEATURE_QUEUE` flag.**
Rationale: (1) CRON-by-default is the only option keeping local/air-gapped operation dependency-free at ≈$0
(Art. XVI, cost NFR) — the core operational-readiness promise; (2) a single `QueuePort` contract lets
BullMQ be enabled by one env flag for cloud scale with identical behavior and no code change (Art. XV, PRD
OP2); (3) it matches the locked stack-of-record and the corrected diagrams (CLARIFICATIONS §D / §C C7).

## Consequences

- **+** Lean local demo with no Redis; trivially air-gapped.
- **+** Clear, flag-driven scale path to durable queuing without refactoring.
- **−** Must maintain two QueuePort adapters with equivalent, idempotent semantics.
- **−** In-process CRON loses in-flight work on crash (mitigated by the re-fetch-next-cycle model).
- **~** `INGEST_DEFAULT_INTERVAL_SEC` + per-source `SOURCE_<NAME>_INTERVAL_SEC` govern cadence either way.
- **risk:** behavioral divergence between CRON and BullMQ adapters → mitigate with shared QueuePort contract tests run against both adapters (Art. I, schemas/ S03).
- **risk:** missed cycle under CRON on crash → accepted; mitigated because ingestion is idempotent poll+recompute, and the BullMQ flag exists for durability-sensitive deployments.

## Y-Statement
> For BEACON operators running locally air-gapped and on cloud free tiers, needing scheduled
> ingestion/recompute without a mandatory broker, CRON/interval workers by default with Redis+BullMQ behind
> a QueuePort flag keep the local demo dependency-free yet scale to durable queuing by one config change;
> unlike a BullMQ-only design, it never forces Redis on an air-gapped, ≈$0 deployment.

## Links
- **PRD:** OP2 (feature-flag infra), EV2 (recompute on new data), EV6 (threshold eval per cycle), §10 (reliability/offline/cost).
- **Constitution:** Art. XVI (redundancy/offline ladders), XV (pluggable infra behind ports).
- **Supersedes/corrects:** Phase-2 diagrams `05-sequence`/`11-deployment` (re-captioned per CLARIFICATIONS §C C7).
- **Related ADRs:** ADR-001 (QueuePort in the hexagon), ADR-009 (redundancy), ADR-012 (config flags).
- **Official docs:** docs.bullmq.io; node-cron.
- **Implementation:** S05 (`src/adapters` CRON + BullMQ — pending S04 gate).

## Review
**Approved by:** prod-architect + human, 2026-06-27 · **Implementation complete:** No (spec phase) · **Revisit:** S05/S06 (if measured ingestion volume on cloud justifies making BullMQ the cloud default).
