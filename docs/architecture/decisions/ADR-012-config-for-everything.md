# ADR-012: Config-for-Everything — 12-Factor, Env-Driven Models/Providers/Keys/Flags, Fail-Fast Validation
<!-- Architecture Decision Record — created by adr-writer.skill -->
<!-- Store in: docs/architecture/decisions/ADR-012-config-for-everything.md -->

**Date:** 2026-06-27
**Status:** Accepted
**Deciders:** prod-architect + human (Andrei Besleaga)
**Tags:** infrastructure | security | performance

---

## Context

BEACON's resilience, portability, and frugality all depend on one thing being true: every model, provider,
API base, key, feature flag, per-source mode, region, and infra choice is configurable, with nothing
hardcoded. The redundancy ladders (Art. XVI) are *driven by* feature flags; local↔cloud parity is a config
switch; the LLM/vision providers are selected by env; live/cached/mock is a per-source flag. A wrong or
missing required value must fail fast at boot, not silently at 3 a.m. during an incident. We record this as
its own ADR because it is the mechanism that makes ADR-004 through ADR-011 switchable without code changes,
and it is a constitutional requirement (config-for-everything, Art. XV/XVI; U5).

**Current state:** Locked (CLARIFICATIONS §D; AGENTS.md §14). `CONFIGURATION.md` is the single source of truth; `.env.example` is the committed, secret-free template; the running config schema is enforced at boot. No code yet.
**Constraints:** 12-factor (config in env); no hardcoded endpoint/key/model/region/flag (U5, Art. XV/XVI); secrets only in env / secret store, never in git (Art. V, secrets policy); fail-fast on invalid/missing required config at boot (U5); safe defaults keep BEACON fully functional offline/local at ≈$0 (Art. XVI/X).

## Options Considered

### Option A — Config-for-everything: env-driven, schema-validated, fail-fast at boot (CHOSEN)
Every model/provider/API base/key/flag/per-source mode/region/infra choice reads from environment variables
(documented in `CONFIGURATION.md`, templated in `.env.example`). A typed config schema is validated at app
boot: invalid or missing-required values fail fast with a clear error; if a chosen mode lacks its required
key/URL (e.g. `FEATURE_CACHE=redis` without `REDIS_URL`), boot fails. Every flag has a safe default that
keeps BEACON fully functional offline/local at ≈$0. Switching a flag never requires a code change.
**Pros:** mechanism for every other decision — the redundancy ladders (ADR-004/005/006/007/008/009), provider choice, live/cached/mock, and local↔cloud parity all become flag flips (Art. XV/XVI, U5); fail-fast safety — misconfiguration surfaces at boot, not mid-incident, a mode without its key/URL is rejected immediately (U5, reliability NFR); secrets stay out of code/git — keys live in env / secret store, `.env.example` is secret-free (Art. V, secrets policy); frugal-by-default — safe defaults run fully offline/local at ≈$0, scale/cloud is opt-in (Art. X/XVI).
**Cons:** large, well-documented config surface to design, validate, and keep in sync with `CONFIGURATION.md`/`.env.example`; a typed config-schema + boot validator is upfront work, every new flag must be documented and validated.
**Source:** CLARIFICATIONS §D; CONFIGURATION.md (all sections + §11); AGENTS.md §14; Constitution Art. XV/XVI/X/V; PRD U5; 12factor.net (config).

### Option B — Mostly env config, but some hardcoded defaults / partial validation
Use env for the obvious things (DB URL, keys) but hardcode some endpoints/models and validate config lazily (only when a feature is first used).
**Pros:** less upfront config design; fewer flags to document.
**Cons:** hardcoded endpoints/models break portability and the no-hardcoding rule (U5, Art. XV) — a region or provider change needs a code edit; lazy validation lets a misconfiguration lurk until a flag is exercised mid-incident (fails the reliability NFR, violates U5 fail-fast); inconsistent operator model, harder to reason about what's switchable.
**Source:** U5 (no hardcoding; fail fast); Art. XV.

### Option C — External config service / dynamic remote config
Pull configuration from a remote config service at runtime.
**Pros:** central management; runtime changes without redeploy.
**Cons:** adds a network dependency — breaks air-gapped/offline operation (Art. XVI) and the no-egress local rule; over-engineered for a ≈$0 demo, another service to run and secure; conflicts with 12-factor env-config simplicity and local parity.
**Source:** Art. XVI (offline/no-egress); team experience.

## Decision

**We will use Option A — config-for-everything: all models/providers/API bases/keys/flags/per-source modes/
regions/infra choices are env-driven (documented in `CONFIGURATION.md`, templated by `.env.example`),
validated by a typed config schema that fails fast at boot, with safe defaults that run fully offline/local
at ≈$0.**
Rationale: (1) it is the mechanism that makes every redundancy ladder and portability switch a flag flip
with no code change (Art. XV/XVI, U5) — the other ADRs depend on it; (2) fail-fast boot validation
(including mode-needs-its-key/URL checks) prevents silent misconfiguration from surfacing during an incident
(U5, reliability NFR); (3) it keeps secrets out of code/git (Art. V) and defaults to the frugal offline path
(Art. X/XVI), matching the locked stack-of-record.

## Consequences

- **+** Every infra/provider/region/source choice is switchable by env; no code change to reconfigure.
- **+** Misconfiguration fails fast at boot with clear errors; safe offline/≈$0 defaults out of the box.
- **+** Secrets are never in code/git; `.env.example` documents every key safely.
- **−** Large config surface to design, document, and keep in sync (`CONFIGURATION.md` ↔ `.env.example` ↔ schema).
- **−** Upfront typed config-schema + boot validator; discipline to validate every new flag.
- **~** `CONFIGURATION.md` is the single source of truth; `.env.example` is the committed secret-free template (elaborated/validated at S03).
- **risk:** config drift (docs vs schema vs example) → mitigated by treating `CONFIGURATION.md` as source of truth and a CI check / schema test that `.env.example` covers all required vars.
- **risk:** a required key/URL missing for a chosen mode → mitigated by fail-fast boot validation (e.g. `FEATURE_QUEUE=bullmq` requires `REDIS_URL`) — the explicit S06 assertion in CONFIGURATION.md.
- **risk:** accidental secret commit → mitigated by `.env` in `.gitignore`, secret-free `.env.example`, and the Art. V secrets policy (Gate 5 dependency/security scans).

## Y-Statement
> For operators deploying BEACON across environments (offline/local, cloud, multi-region) at ≈$0, needing to
> reconfigure providers, flags, sources, and regions without code changes, config-for-everything (12-factor
> env config, schema-validated, fail-fast at boot, safe offline defaults) makes every redundancy ladder and
> portability switch a flag flip and catches misconfiguration at boot; unlike partial hardcoding or a remote
> config service, it keeps nothing hardcoded, requires no network for config, and never lets a bad setting
> surface mid-incident.

## Links
- **PRD:** U5 (read all config from env; fail fast; no hardcoding), OP2/OP3/OP4 (feature flags), §10 (portability/cost/reliability/security NFRs).
- **Constitution:** Art. XV/XVI (flags drive adapters + ladders, no hardcoding), X (frugal defaults), V (secrets policy), VI (observability config).
- **Decision source:** CLARIFICATIONS §D; AGENTS.md §14 (config-for-everything).
- **Related ADRs:** ADR-004/005/006/007/008 (each flag-switched), ADR-009 (config drives all ladders), ADR-011 (region config), ADR-013 (DATABASE_URL/migrations config).
- **Config:** `../CONFIGURATION.md` (all sections + §11 ladder map + S06 fail-fast assertions); `.env.example` (committed, secret-free — created S03/S05).
- **Official docs:** 12factor.net (config).
- **Implementation:** S03 config schema + S05 boot validator — pending S04 gate.

## Review
**Approved by:** prod-architect + human, 2026-06-27 · **Implementation complete:** Yes (Phase-B/C/D) · **Revisit:** S03 (config schema elaboration) and S06 (fail-fast + offline-default assertions verified).
