# ADR-026 — Telegram alert broadcast & subscriber registry

- **Status:** Accepted (2026-07-15)
- **Deciders:** Entrant + prod-architect (user-directed, Phase-D W4b)
- **Relates to:** ADR-023 (multi-channel interaction — Telegram MessagingPort, MOCK-default),
  ADR-010 (CAP/EDXL alert path), ADR-017 (AI compliance proxy — `NotificationPort` shares the
  PII-redact/firewall/audit posture), ADR-021 (CAMARA plugin pattern — config-gated live, MOCK default),
  ADR-025 (JWT identity — the approver recorded on the emitted alert), CONSTITUTION Art. XIII (HITL
  before public action), Art. XIV (responsible data), Art. XVI (redundancy / audited-not-fatal)
- **Threat model:** `docs/architecture/THREAT_MODEL.md` TB2 T2.9 (broadcast side-effect), TB6 T7.10/T7.11
  (webhook trust + the allow-list/subscriber-list accepted-risk decision), TB4 T5.9 (Telegram egress host)

## Context

ADR-023 established Telegram as a channel-agnostic messaging adapter (`MessagingPort`, MOCK by default)
and its addendum (2026-07-15) records that the outbound transport is now REAL Bot API `sendMessage`. What
ADR-023 explicitly left open was: (1) *who* an approved alert gets broadcast to (no subscriber registry
existed), and (2) *how* that broadcast composes with the existing HITL emit gate
(`POST /alerts/{id}/approve`, ADR-010) without becoming a second, unaudited way to "publish" an alert or
without letting a flaky Telegram API call break the approval response. Phase-D W4b closes both gaps.

## Decision

1. **A narrow, swappable subscriber registry.** `SubscriberRegistry`
   (`src/adapters/channels/messaging/subscriber-registry.ts`) exposes only `list()` / `add(chatId)` over an
   **in-memory**, insertion-ordered set, seeded at composition from `TELEGRAM_ALERT_CHAT_IDS`
   (comma-separated env, parsed by `parseChatIds`). It holds **opaque chat ids only — no PII**. The
   interface is deliberately narrow so a durable/DB-backed registry (subscribe/unsubscribe via a bot
   command, persisted across restarts) can replace the in-memory impl later with **zero call-site change**
   — the same "flag/plugin swap, never a rewrite" pattern as ADR-021/ADR-023.

2. **Broadcast is a strictly post-emit, HITL-derived side-effect — never an alternate emit path.**
   `broadcastApproval` (`src/adapters/channels/http/routes/interop.ts`) is called from
   `handleAlertApprove` **only after** `deps.sink.emit(emittable)` has already succeeded on an
   `EmittableAlert` promoted from an approved `DRAFT` (Art. XIII — the existing HITL gate is unchanged;
   Telegram never becomes a second way to make an alert ACTUAL). Both `notifier` (a `NotificationPort`,
   never a raw `MessagingPort`) and `subscribers` on `InteropDeps` are **optional** — when either is
   absent (the offline/default composition), `handleAlertApprove` is byte-identical to pre-W4b behavior.

3. **Notifier-only injection — the transport is structurally unreachable raw.** The broadcast handler's
   only dependency is `NotificationPort` (`makeNotifier`, already PII-redact + output-firewall +
   hash-chained-audit around a `MessagingPort`, per ADR-017's proxy posture) — it cannot be constructed to
   skip those controls. Each subscriber send is independently `try/catch`-wrapped: **audited-not-fatal**
   (Art. XVI) — a per-chat-id failure (typed err or thrown transport) never 5xx's the `POST
   /alerts/{id}/approve` response and never blocks the remaining subscribers.

4. **The broadcast content is a concise, PII-free digest**, never the raw alert object — `alertDigest`
   builds `"BEACON ALERT — {severity} {category} for incident {incidentId} (alert {id})"`, and the
   `NotificationPort` redacts on top of that (defense-in-depth; Art. XIV).

5. **The inbound command allow-list currently reuses the SAME chat-id list** (`allowListFromEnv` in
   `app/api/v1/channels/telegram/webhook/route.ts` maps every `TELEGRAM_ALERT_CHAT_IDS` entry to
   `RESPONDER`). This is an **accepted risk with a documented rationale**, not an oversight — see
   Consequences and THREAT_MODEL T7.11.

## Consequences

- **Positive.** Closes the "no subscriber registry" gap from ADR-023 with the smallest possible surface
  (2 methods); proves the portal's "working Telegram bot" claim end-to-end (broadcast approved alerts);
  keeps the HITL invariant airtight (broadcast cannot happen without a prior successful CAP emission);
  audited-not-fatal means a Telegram outage degrades gracefully (Art. XVI) rather than blocking the
  responder-facing approval flow.
- **Negative / accepted risk.** Because `TELEGRAM_ALERT_CHAT_IDS` doubles as both the broadcast audience
  and the inbound RESPONDER allow-list, a leaked/compromised chat id list grants both read (broadcast
  receipt) and write (RESPONDER command) capability — there is no "broadcast-only" chat-id class today.
  Mitigated by: every mapped role is RESPONDER (never VERIFIER/EM — cannot itself approve an alert or
  escalate config); every inbound command still traverses the full trust pipeline (allow-list → replay →
  rate → firewall → parse, `trust.ts`) before acting; the registry holds no PII. **Recommended future
  control** (not built in this ADR): split into `TELEGRAM_ALERT_CHAT_IDS` (broadcast-only) and a separate
  `TELEGRAM_RESPONDER_CHAT_IDS` (inbound allow-list), so the two capabilities can be revoked independently.
- **In-memory registry does not survive a process restart** (subscribers must be re-seeded from env). This
  mirrors the existing in-memory `AlertStore`/`EdxlRmStore` defaults (ADR-010) and is an accepted "demo
  now, durable-later" posture (Art. XVI — never a dead-end, since the env-seed always reconstructs it).

## Alternatives considered

- **A durable (Postgres-backed) subscriber table from day one** — rejected for this ADR: no
  subscribe/unsubscribe UX exists yet (bot command or admin UI); the narrow interface makes this a
  drop-in follow-up with zero call-site change once that UX lands, rather than premature persistence.
- **Broadcast as an alternate/parallel emit path** (e.g. a separate `POST /alerts/{id}/broadcast`) —
  rejected: would create a second way to "publish" an alert, weakening the single HITL gate (Art. XIII).
- **A raw `MessagingPort` dependency on the interop handler** — rejected: bypasses the PII-redact/firewall/
  audit posture ADR-017 establishes for every outbound AI/notification path; `NotificationPort` is the
  only sanctioned seam.
- **Separate broadcast vs. inbound-command chat-id lists from day one** — considered and preferred
  long-term, but deferred (documented as the recommended future control above) to keep the W4b surface
  minimal; `TELEGRAM_ALERT_CHAT_IDS` already existed as an env var and reusing it needed zero new config
  for the demo/field-ops posture.

## Implementation status (2026-07-15, Phase-D W4b) — ✅ realized, gate green

`SubscriberRegistry`/`makeInMemorySubscriberRegistry`/`parseChatIds`
(`src/adapters/channels/messaging/subscriber-registry.ts`), `broadcastApproval` +
`InteropDeps.{notifier,subscribers}` (`src/adapters/channels/http/routes/interop.ts`), and
`allowListFromEnv` (`app/api/v1/channels/telegram/webhook/route.ts`) implemented + unit-tested; wired into
`feature-seed.ts` composition. See `docs/architecture/THREAT_MODEL.md` TB2 T2.9, TB6 T7.10/T7.11, TB4 T5.9
for the corresponding threat rows, and `docs/api/openapi.yaml` `/channels/telegram/webhook` for the
inbound contract.
