# ADR-023 — Multi-channel interaction: CLI + messaging comm adapters (channel-agnostic core)

- **Status:** Accepted (2026-07-06)
- **Deciders:** Entrant + prod-architect (user-directed)
- **Relates to:** ADR-001 (hexagonal ports & adapters), ADR-003 (Next.js API), ADR-010 (CAP/EDXL interop),
  ADR-017 (AI compliance proxy), ADR-021 (CAMARA plugin pattern); CONSTITUTION Art. II/XII/XIII/XVI;
  PRD FR-4/FR-13/FR-15; SECURITY_BASELINE.

## Context

BEACON's value is a source-cited common operating picture usable *in the field*, often on degraded or
non-browser access paths (a responder on a phone, an EOC on a terminal, an SMS/chat bridge in a
connectivity-poor area). The web COP (E8) is one **delivery channel**, not the system. The hexagonal core
(domain + application use-cases behind ports) already makes the delivery mechanism a detail: the Next.js
API (ADR-003) is merely one *driving adapter*. The user requires the system to be operable **independently
of the web frontend** — via a **CLI** and via **messaging plugins (WhatsApp / Telegram / …)** — with the
same guarantees (provenance/citations, deterministic-truth, HITL-before-public-action, redundancy), and
covered by **end-to-end tests** through each channel.

This is not new core behavior; it is new **primary (inbound) and secondary (outbound) adapters** over the
existing use-cases. Building it any other way (channel logic inside use-cases) would violate ADR-001 and
duplicate the compliance/HITL/provenance guarantees per channel.

## Decision

Introduce a **channel-agnostic interaction layer** as adapters over the existing application use-cases —
**zero core change** (the comprehensiveness/innovation claim, made concrete):

1. **`InteractionPort` (inbound / driving).** A single canonical request/response contract that every
   channel adapter maps *into*: `{ actor (role+id), command, args, locale }` → a typed
   `InteractionResult { data, provenance[], freshness, citations?, errors? }` — the **same envelope** the
   HTTP API returns (ADR-003/§4 code-style). Channel adapters translate their native input (argv, a chat
   message, an HTTP body) into this contract and render the result in their native form. A small
   **command router** (application-adjacent, not in the domain) dispatches a command to the right use-case;
   it is the ONE place a channel's request meets the core.

2. **CLI adapter (`src/adapters/channels/cli/`).** A zero-extra-dependency Node entrypoint (`beacon`
   binary via `package.json#bin`, stdin/argv in, stdout/stderr out, JSON or human-readable via `--json`).
   Commands mirror the core read/act surface: `status`/`sitrep`/`incidents`/`sources`/`report`/`verify`/
   `alert:draft` (never `alert:send` without the HITL approval command). It composes the SAME wired core as
   the API (shared composition root, ADR-003/§main). This is the **reference channel** and the primary
   e2e target (works fully offline against seeded/cached data — Art. XVI).

3. **Messaging adapters (`src/adapters/channels/messaging/`).** A `MessagingPort` abstracts a chat
   transport (inbound webhook message → `InteractionPort`; outbound `NotificationPort` → channel send).
   Concrete adapters — **Telegram** (Bot API, simplest: a bot token + long-poll/webhook) and **WhatsApp**
   (Cloud API / or an open bridge) — are **pluggable, config-flagged, and MOCK by default** (like CAMARA,
   ADR-021): they need external accounts/tokens, so the demo ships a **recorded-mock transport** that
   proves the round-trip without network. Live is a config switch (`CHANNEL_TELEGRAM_MODE=live` +
   `TELEGRAM_BOT_TOKEN`), never a rewrite.

4. **Guarantees hold on every channel (non-negotiable).** A channel is just I/O; it does not get to bypass
   the core:
   - **Provenance/citations** travel in `InteractionResult`; a CLI `sitrep` prints citations, a Telegram
     reply appends sources. An ungrounded response is impossible (the use-case enforces it).
   - **HITL before public action (Art. XIII).** No channel emits a CAP/EDXL alert or tasks a resource from
     an unverified report; a messaging "approve" is an authenticated VERIFIER/EM action, audited.
   - **AI compliance + heuristic firewall (ADR-017).** Any natural-language input from a messaging channel
     is **untrusted** and passes the input firewall/PII-redaction before reaching the LLM; outbound text
     passes the output firewall. Channel NL never computes numbers (Art. XII).
   - **Responsible data (Art. XIV).** Precise PII location is never pushed to a public/broadcast channel;
     messaging replies use generalized geometry unless the recipient is an authenticated responder.
   - **Security (SECURITY_BASELINE).** Per-channel authN/authZ (CLI = local trust / token; messaging =
     signed webhook + allow-listed sender→role mapping), rate-limiting, replay protection, and audit of
     every inbound command and outbound send.

5. **Redundancy (Art. XVI).** Channels are additive fallback surfaces: web SSE → CLI/poll → messaging
   digest. The CLI runs air-gapped; messaging degrades to MOCK. No channel is a single point of failure.

## Consequences

**Positive.** Proves the hexagonal claim (one core, many channels, zero core change); makes the system
usable in field/low-bandwidth/no-browser contexts; strengthens the rubric story (Usability +
Comprehensiveness) with a demonstrable "same COP over CLI and chat"; each channel is independently
testable with a golden+error+edge e2e. Messaging is an *out-of-core plugin* (ADR-021 pattern), so it adds
no demo-time dependency.

**Negative / mitigations.** More inbound trust boundaries → mitigated by routing ALL channel input through
the existing firewall/validation + per-channel auth (no new bypass). Messaging providers need
tokens/accounts → mitigated by MOCK-default + config-flag-to-live. Command surface could drift from the
API → mitigated by both channels sharing the one `InteractionPort` command router + envelope (single
source of truth, DRY).

## Alternatives considered

- **Channel logic inside use-cases / a bespoke CLI reaching into the DB** — rejected: violates ADR-001,
  duplicates guarantees per channel, and couples the core to a transport.
- **Web-only + "export" buttons** — rejected: does not meet the "operable independently of the frontend"
  requirement, and offers no inbound (report/verify/approve) path off the browser.
- **A generic third-party chatbot framework** — rejected for the demo: heavyweight dependency, and it
  would own the conversation/state we must keep in the audited core. Revisit post-MVP.

## Implementation (see backlog E10 — `project/tasks/E10-channels-cli-messaging.md`)

- `src/ports/interaction.ts` — `InteractionPort`, `InteractionRequest/Result`, `NotificationPort`,
  `MessagingPort` (interfaces only; Result-returning; import type only).
- `src/application/interaction/command-router.ts` — dispatch a canonical command to a use-case (ports
  only; no adapters). Deterministic, unit-tested.
- `src/adapters/channels/cli/**` — the `beacon` CLI adapter + renderers (human / `--json`).
- `src/adapters/channels/messaging/**` — `MessagingPort` + Telegram/WhatsApp adapters (MOCK default;
  recorded-mock transport fixtures) + inbound signature/allow-list auth + outbound notification.
- Composition root (`src/main`) wires the CLI and messaging adapters to the same core as the API.
- **E2E:** a channel e2e suite drives `monitor → assess → (report) → verify → act(DRAFT)` end-to-end over
  the CLI (offline, US + RO) and over the messaging MOCK transport, asserting the same envelope +
  citations + HITL gate as the HTTP e2e.
- Config: `CHANNEL_CLI_ENABLED`, `CHANNEL_TELEGRAM_MODE/TELEGRAM_BOT_TOKEN`, `CHANNEL_WHATSAPP_MODE/…`
  (12-factor, ADR-012; documented in `.env.example`; MOCK defaults).

## Implementation status (2026-07-07, S05) — ✅ realized, gate green

Built as decided, **zero core change**. `InteractionPort` + the `Envelope` DRY-anchor live in
`src/ports/interaction.ts`; the RBAC-gated `command-router` (`src/application/interaction/`) dispatches the
closed `Command` set to existing use-cases/ports; the composition root (`src/main`, offline-first memory
core + CA/RO seed) hands every channel the one `buildInteraction()`. CLI (`src/adapters/channels/cli`),
HTTP (`src/adapters/channels/http`, with a domain→SPEC §196 public API-code translation), and messaging
(`src/adapters/channels/messaging`, MOCK-default; HMAC + allow-list + replay + firewall) each dispatch
through it, with deterministic offline e2e (US + RO) asserting envelope + citations + HITL parity.
Gate: tsc 0 · eslint 0 · vitest 689 · 0 boundary violations · coverage (domain+application) 100/99.23/100/100.
**Deferred (post-reset):** live messaging transports, real JWT (header-stub today), and routing/logistics/
EDXL-emit/SSE routes (E7/E8 — need driven adapters + the frontend delta channel).

## Addendum (2026-07-15, Phase-D W4b/W5) — Telegram live transport is now REAL

The "deferred: live messaging transports" line above is now closed for Telegram (WhatsApp remains a
deliberate stub, T-457 out of scope). What changed, concretely:

- **Outbound is real Bot API.** `TelegramLiveTransport` (`src/adapters/channels/messaging/messaging-port.ts`)
  POSTs `https://api.telegram.org/bot<token>/sendMessage` over an injected `fetch`, returning a typed
  `Result` — it never throws. `makeTelegramMessaging` still defaults to the MOCK `RecordedTransport`
  byte-identically unless `CHANNEL_TELEGRAM_MODE=live` **and** `TELEGRAM_BOT_TOKEN` is set (ADR-021
  plugin pattern: live is a config switch, never a rewrite).
- **Inbound webhook exists.** `app/api/v1/channels/telegram/webhook/route.ts` →
  `handleTelegramWebhook` (`src/adapters/channels/messaging/telegram-webhook.ts`) verifies
  `X-Telegram-Bot-Api-Secret-Token` (constant-time) against `TELEGRAM_WEBHOOK_SECRET`, then re-enters the
  SAME `handleInbound` trust pipeline (allow-list → replay → rate → firewall → parse) every channel
  shares — zero core change, per this ADR's founding principle. See THREAT_MODEL.md TB6 T7.10/T7.11.
- **A poller alternative exists for localhost demos.** `scripts/telegram-poll.ts` (`getUpdates`
  long-polling, env-gated, never on the request path) and the webhook are **mutually exclusive** per the
  Bot API (Locked decision) — the poller refuses to start while `TELEGRAM_WEBHOOK_SECRET` is set.
- **A new subscriber registry + broadcast side-effect were added** — see the new **ADR-026** (Telegram
  alert broadcast & subscriber registry), which supersedes the "NO subscriber registry exists" gap noted
  in the pre-Phase-D exploration notes.
- **Mock remains the default** in every offline/CI/air-gapped posture (Art. XVI) — this addendum changes
  what is *reachable when configured*, not the offline-first default.

---

## Addendum (2026-07-26, MW-A) — the envelope's `locale`, and a correction

**Correction to §"The envelope".** This ADR described `InteractionRequest` as
`{actor, command, args, locale}`. That was never what shipped: the implemented type
(`src/ports/interaction.ts`) had `channel`, `actorRole`, `command`, `receivedAt`, `requestId?`,
`actorId?` — **no `locale` and no `args`** (`args` are carried inside the discriminated `Command`
union, which is the better design and stays). The discrepancy was found by reading the code during the
S02 pass for the final-version feature and is recorded as finding **F-02** in
`project/TASKS-FINAL-VERSION.md`. Documenting a field that does not exist is exactly the drift the
docs-truth audit lens exists to catch, so it is corrected here rather than quietly patched.

**What MW-A adds.** `InteractionRequest.locale?: string` — optional, additive, and deliberately narrow:

- **Resolution is the channel adapter's job**, from its own transport: HTTP reads the `beacon-locale`
  cookie, Telegram reads `from.language_code`, the CLI takes `--locale`. A channel that cannot tell,
  omits it; the core then answers in English. No channel is required to change.
- **It selects presentation only** (ADR-030, Art. XII). It never reaches the deterministic engine and
  can never change a number, a ranking, an enum token, an identifier, or a geometry. Deterministic
  fact claims remain English and language-marked — translating engine-produced claims would put a
  translator between the data and the figure, which is precisely what Art. XII forbids.
- **An unrecognised tag degrades to English** rather than failing the request. Somebody's handset
  reporting a language BEACON does not ship must never cost them an alert (Art. XVI).
- **Outbound alerts do not depend on it.** CAP carries region language **and** English always, via
  multiple `<info>` blocks with identical machine-readable values (`capTranslationsFor` /
  `capMachineValuesAgree` in `cap-mapper.ts`; FR-I18N-6). The requester's UI locale is a display
  preference; the alert's languages are a property of the region being warned.
