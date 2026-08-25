# Epic E10 — Multi-channel interaction (CLI + messaging comm adapters)

> Owner personas: **eng-backend · eng-api** (channels), **ops-security** (inbound trust), tests **eng-qa** ·
> Waves W3-b–W4 · IDs `E10·T-450…T-479` · Source: **ADR-023** (channel-agnostic core). User-directed
> (2026-07-06): the system must be operable **independently of the web frontend** via CLI + messaging
> (WhatsApp/Telegram), same guarantees, with e2e per channel.
>
> Hexagonal: these are DRIVING (inbound) + DRIVEN (outbound) adapters over the EXISTING use-cases — zero
> core change. All channel input is UNTRUSTED → firewall/validate/auth before the core (ADR-017,
> SECURITY_BASELINE). Provenance/citations + HITL + responsible-data hold on every channel.

| ID | Task | Persona | Deps | Wave | Tags | Trace | Acceptance |
|---|---|---|---|---|---|---|---|
| T-450 | `src/ports/interaction.ts` — `InteractionPort`, `InteractionRequest/Result` (envelope-parity with API), `NotificationPort`, `MessagingPort` | eng-backend | E1,E7 | W3-b | [PARALLEL]{secure-coding} | ADR-023/ADR-001 | interfaces only; Result-returning; `import type`; tsc clean |
| T-451 | Failing test: command-router dispatches a canonical command → the right use-case (ports only) | eng-qa | T-450 | W3-b | [PARALLEL]{tdd-cycle} | ADR-023 | Red: `sitrep`/`status`/`report`/`verify`/`alert:draft` routed; unknown ⇒ typed error |
| T-452 | `src/application/interaction/command-router.ts` to green T-451 (imports ports only) | eng-backend | T-451 | W3-b | {tdd-cycle}{arch-lint} | ADR-023/§4 | deterministic; no adapter import; envelope out |
| T-453 | CLI adapter `src/adapters/channels/cli/` (`beacon` bin; argv/stdin→InteractionPort; human + `--json` renderers) | eng-backend | T-452,E-main | W3-b | {tdd-cycle} | ADR-023 | `beacon status`/`sitrep`/`sources` run offline vs seeded data; citations shown |
| T-454 | CLI `package.json#bin` + never-`alert:send`-without-approval command surface | eng-backend | T-453 | W3-b | [SEC]{secure-coding} | ADR-023/ArtXIII | `alert:draft` only; approval is a separate authenticated command |
| T-455 | `MessagingPort` + inbound webhook→InteractionPort mapping + **signature/allow-list auth** (sender→role) | ops-security | T-450 | W4 | [SEC]{tdd-cycle} | ADR-023/SECURITY_BASELINE | unsigned/unknown sender rejected; rate-limited; replay-guarded |
| T-456 | Telegram adapter (Bot API) — MOCK default, config-flag-to-live (`TELEGRAM_BOT_TOKEN`) + recorded-mock transport fixture | eng-api | T-455 | W4 | {tdd-cycle} | ADR-023/ADR-021 | round-trip works vs recorded mock, no network; live behind flag |
| T-457 | WhatsApp adapter (Cloud API/bridge) — MOCK default, config-flagged, recorded-mock fixture | eng-api | T-455 | W4 | {tdd-cycle} | ADR-023/ADR-021 | same envelope; MOCK by default; documented token path |
| T-458 | Outbound `NotificationPort` send: generalized geometry to public channels (no precise PII, ArtXIV); audited | ops-security | T-455 | W4 | [SEC]{tdd-cycle} | ArtXIV/SECURITY_BASELINE | precise location only to authenticated responder; every send audited |
| T-459 | Input firewall on channel NL (ADR-017) before LLM; output firewall on channel replies | ops-security | T-452,E6 | W4 | [SEC]{tdd-cycle} | ADR-017/Art XII | injection/PII blocked; NL never computes numbers |
| T-460 | Wire CLI + messaging adapters in composition root (same core as API) | eng-backend | T-453,T-456,E-main | W4 | {tdd-cycle} | ADR-023/§main | one wired core; channel = config |
| T-461 | **Channel e2e (CLI):** monitor→assess→report→verify→act(DRAFT) offline, US + RO; assert envelope+citations+HITL parity with HTTP e2e | eng-qa | T-460 | W4 | {browser-tdd→cli-e2e} | ADR-023/DEMO_SCRIPT | golden+error+edge; deterministic (no wall-clock/live-net flakiness) |
| T-462 | **Channel e2e (messaging MOCK):** inbound report + outbound SitRep digest over recorded transport | eng-qa | T-460 | W4 | {tdd-cycle} | ADR-023 | same guarantees; MOCK; deterministic |
| T-463 | `.env.example` + CONFIGURATION: `CHANNEL_CLI_ENABLED`, `CHANNEL_TELEGRAM_MODE`, `CHANNEL_WHATSAPP_MODE`, tokens | eng-backend | T-456,T-457 | W4 | {config-for-everything} | ADR-012/ADR-023 | 12-factor; MOCK defaults; documented |

**Notes.** Envelope parity with the HTTP API is the DRY anchor (one `InteractionResult`). CLI is the
reference channel + primary e2e (fully offline/air-gapped). Messaging is an out-of-core plugin (ADR-021
pattern), MOCK in the demo. All new tests must be **deterministic** (fixed injected clocks safely in the
past, recorded-mock transports) — no dependence on wall-clock or live network (flaky-test rule).

---

## IMPLEMENTATION STATUS — 2026-07-07 (S05, headless-channels wave) ✅ DONE, gate green

**Spine (T-450…T-452):** `src/ports/interaction.ts` (`InteractionPort` + `Envelope` DRY-anchor +
closed `Command` union + `Messaging`/`NotificationPort`) · `src/application/interaction/command-router.ts`
(thin RBAC-gated dispatcher over existing use-cases/ports, one envelope per verb; `errorEnvelope` helper) ·
composition root `src/main/{build-core,seed}.ts` + offline-first `src/adapters/memory/memory-core.ts`
(memory read-models + `MemoryReportStore`, seeded CA+RO demo; Postgres/live behind flags).
- **CLI (T-453/454/461):** `src/adapters/channels/cli/` — argv→Command parser, human + `--json` renderers
  (provenance + citations always shown), `bin.ts` (`package.json#bin` documented, file NOT edited), command
  surface exposes **only `alert:draft`** (no emit; Art. XIII). CLI golden-path e2e monitor→assess→report→
  verify→act(DRAFT) offline for US + RO. **36 tests.**
- **HTTP API (T-460 partial):** `src/adapters/channels/http/` — framework-agnostic `handleHttp` dispatcher
  over `buildInteraction`, envelope serializer, security middleware (header→role stub, token-bucket
  rate-limit→429, body validation), DomainError→HTTP status **+ domain→SPEC §196 public API-code
  translation** (UNAUTHORIZED→FORBIDDEN, PARSE_ERROR/INVARIANT→VALIDATION_ERROR, CONFLICT/INVALID_TRANSITION
  →STATE_CONFLICT). Thin `app/api/v1/**` + `app/.well-known/sustainability` Next delegators. Routes: status,
  regions/:id/incidents, incidents/:id/sitrep, sources, reports (POST), reports/:id (PATCH verify), alerts
  (POST draft), health, me, `/.well-known/sustainability` (Ajv-2020 schema-valid). **28 tests.**
- **Messaging (T-455…T-459/462):** `src/adapters/channels/messaging/` — NL-lite `parseMessageToCommand`,
  inbound trust (`mapInbound`: HMAC-SHA256 timing-safe verify → allow-list role → replay guard → per-sender
  rate-limit → `scanInput` firewall), Telegram + WhatsApp `RecordedTransport` MOCK adapters (live behind
  `CHANNEL_*_MODE`+token), `NotificationPort` (geometry generalization ~0.1°, output firewall, hash-chained
  audit), `handleInbound` orchestration. Messaging e2e (report→UNVERIFIED, sitrep digest, no PII leak).
  **17 tests.**

**All channels are DRIVING/DRIVEN adapters over the SAME core — zero core change; identical envelope +
provenance/citations + RBAC + HITL guarantees on every channel (ADR-023).** Gate: tsc 0 · eslint 0 ·
vitest 689 · depcruise 254 modules 0 violations + no-circular · coverage (domain+application) 100/99.23/100/100.

**DEFERRED to the post-reset frontend batch:** T-458 live messaging transports (real HTTP), full JWT auth
(currently header-stub, TODO→ADR-017), and any UI surfacing. Routing/logistics/EDXL-emit/SSE routes are
E7/E8 post-reset (they need driven adapters + the frontend delta channel).
