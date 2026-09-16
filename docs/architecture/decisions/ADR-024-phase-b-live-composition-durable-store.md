# ADR-024 — Phase-B live composition + durable Postgres store

- **Status:** Accepted (2026-07-13)
- **Deciders:** Entrant + prod-architect (user-directed, Phase-B go-live)
- **Relates to:** ADR-001 (hexagonal ports & adapters), ADR-005 (Postgres/PostGIS persistence), ADR-012
  (12-factor config), ADR-013 (Drizzle), ADR-023 (channel-agnostic core, `buildInteraction`)

## Context
The S05 build wired every source adapter, the AI ladder, and the Drizzle persistence layer, but the running
app still composed a purely in-memory, hand-seeded core: the source adapters were orphaned (no live caller),
and the Postgres repositories were dead code at runtime. Phase B ("go fully live") had to feed the engines
from real adapters and make persistence real — **without** weakening the offline-first / air-gapped default
(Constitution Art. XVI) and **without** rewriting the core.

## Decision
Three additive rungs in the composition root (`src/main/build-core.ts`, `src/main/live-composition.ts`,
`src/adapters/channels/http/http-dispatcher.ts`), each opt-in and each preserving the offline default:

1. **Opt-in live data composition.** `buildCoreLive`/`buildInteractionLive` (async) + `assembleLiveSeeds`
   build the runtime adapter registry from `config/adapters.json` (one shared `RedundancyEngine`) and
   assemble the derivation-input seeds from live adapters when `DATA_SOURCE_COMPOSITION=adapters`. The
   engines then compute over **real** hazard/gauge/weather geometry. **Fail-open:** any registry/region/fetch
   failure returns the offline `DEFAULT_SEED` — the COP never dead-ends. The synchronous `buildCore`/
   `buildInteraction` are unchanged (offline default; used by tests, CLI, and the redundancy acceptance
   suite). Hybrid scope: slices no adapter supplies yet (infrastructure, population, trend history) stay
   seeded and are labelled — an honest limitation, not a hidden gap.

2. **Durable store selection.** `resolveStore` + `FEATURE_STORE=memory|postgres`. `postgres` moves the
   DURABLE, audit-critical data — public reports + the hash-chained triage audit + regions + sources — onto
   Postgres (via the read-model projections in `src/adapters/persistence/read-models.ts`). **The incident COP
   always derives per-read in memory** from the (seed or live-adapter) inputs; there is deliberately *no*
   Postgres incident read-model. `config.refine` fail-fasts if `postgres` is set without a real
   `DATABASE_URL` (the localhost placeholder is rejected). Default `memory` keeps the zero-config offline path.

3. **Async HTTP composition.** `createHttpDepsLive`/`getHttpDepsAsync` compose the live/durable/AI deps once
   per process; all three Next delegators (`[...path]`, `stream`, `.well-known/sustainability`) await the
   same instance so they share one EventBus (SSE deltas from a POST reach open streams) and one report store.
   With no flags set it reduces to the offline `createHttpDeps` — one path for every profile.

A build note: `next.config.mjs` sets `module.parser.javascript.url = false` so the live-adapter fixture
`new URL(..., import.meta.url)` reads survive the Next/Webpack build (dev/docker affordance; the offline
seed + live network rungs are unaffected).

## Consequences
- The 8 verified-schema adapters and the manifest loader (FR-10) are now genuinely reachable from the running
  app (import-graph verified), not dead code.
- `docker compose up` provisions Postgres + migrate + app and (with `FEATURE_STORE=postgres`, set on the app
  service) persists reports/audit across restarts. Proven end-to-end (19 tables) in `LIVE_VERIFICATION.md`.
- Two flags (`DATA_SOURCE_COMPOSITION`, `FEATURE_STORE`) drive the whole live/durable behaviour; both default
  to the offline path, so the air-gapped acceptance test and hermetic unit tests are untouched.
- The incidents-always-memory decision means a restart re-derives the COP from inputs (fast, no schema churn)
  but does not persist a computed COP snapshot — acceptable, and documented.

## Alternatives considered
- **Full Postgres COP** (persist raw records → derive from persisted inputs, + persist a computed snapshot) —
  rejected for v1: larger schema-adjacent work for little demo value; the derive-in-memory path is fast and
  keeps the durable surface focused on the audit-critical data. Recorded as a roadmap option.
- **Make `buildCore` itself async** — rejected: would ripple `await` into every sync caller (CLI, tests,
  redundancy suite). A parallel async entry point keeps the offline signature byte-identical.
- **Wire adapters unconditionally** — rejected: breaks the deterministic offline default + hermetic tests.

## Implementation status (2026-07-13, Phase B) — ✅ realized, gate green
`buildCoreLive`/`assembleLiveSeeds`/`resolveStore`/`createHttpDepsLive` implemented + tested (tsc 0, eslint 0,
vitest green, depcruise 0). Live-proven: keyless-live sources, durable Postgres round-trip, docker stack —
see `docs/audit/LIVE_VERIFICATION.md` and `docs/E2E_TESTING_PLAYBOOK.md`.
