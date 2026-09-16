# Messaging-Channel Options — Open-Source IM vs. Telegram (Possibility Report)

> Phase-D W5 evaluation (2026-07-15). Question: now that the Telegram channel is REAL end-to-end
> (ADR-023 addendum, ADR-026), would a fully open-source instant-messaging protocol (XMPP, Matrix, …)
> — free software, free API usage, cross-platform (desktop/mobile/web) — be a better demo channel?
> Verdict summary: **keep Telegram for reach; add Matrix as the open-source flagship channel when
> time permits — it is the only candidate that strengthens the rubric story (100% OSS + offline-first).**

## 1. What "implementing a channel" costs in BEACON (the proven seam)

The Telegram lane (W4b) proved the channel seam; every candidate below plugs into the SAME four points,
with **zero core change** (mirror of the adapter-registry discipline):

| Seam | What it is | Telegram precedent |
|---|---|---|
| Outbound transport | `MessagingPort` impl: one `send(chatId, text) → Result` (injected fetch/socket, err-never-throw) | `TelegramLiveTransport` (~60 lines + 7 tests) |
| Notifier wrapper | **channel-agnostic, already built** — PII-redact → firewall → hash-chained audit | `makeNotifier` reused as-is |
| Inbound | map platform message → `InboundMessage` → existing trust pipeline (`handleInbound`) | webhook route + `telegram-poll.ts` |
| Composition | env-gated wiring in `feature-seed.ts` (mock default, Art. XVI) | `makeBroadcastDeps` |

So the marginal cost of any new channel ≈ the W4b lane: **one adapter directory + one route/poller +
composition + tests**. The HITL invariant (broadcast only after an approved ACTUAL emits) and the
PII/audit guarantees are inherited, not re-implemented.

## 2. Candidates

### Matrix (matrix.org) — ★ recommended open-source channel
- **Openness:** open protocol + spec; servers: Synapse/Dendrite (AGPL-3.0, Element), **Conduit (Apache-2.0, Rust, tiny)**; clients: Element (web/desktop/iOS/Android), many others. Client–Server API is plain HTTP+JSON, free, no key/quota.
- **Outbound:** `PUT /_matrix/client/v3/rooms/{roomId}/send/m.room.message/{txnId}` with a bot access token — pure `fetch`, same shape as the Telegram transport. Room id ≈ chat id; the subscriber registry maps 1:1.
- **Inbound:** `/sync` long-poll (direct analogue of `getUpdates` — the poller script pattern reuses) or an Application-Service webhook (analogue of the Telegram webhook, with its own `hs_token` verification).
- **Demo strengths:** the ONLY candidate that can run **fully inside `docker compose` air-gapped** (Conduit + Element Web) — an alert channel that works with zero internet, which directly reinforces Art. XVI and the local-first rubric story; federation = resilience narrative; E2EE exists (use an unencrypted ops room for the bot to keep the adapter simple).
- **Effort:** ≈ 1 W4b-sized lane. Caveats: room-membership bootstrapping (bot must join/create the room — a small setup script), and self-hosting adds one compose service.

### XMPP (RFC 6120/6121) — viable, more plumbing
- **Openness:** IETF standard; servers Prosody (MIT), ejabberd (GPLv2); clients Conversations (Android), Monal (iOS), Gajim/Dino (desktop), Converse.js (web). Completely free.
- **Implementation:** outbound is NOT plain HTTP — needs a persistent XML stream (add `xmpp.js`), which breaks the injected-fetch idiom (transport would own a socket lifecycle). Inbound rides the same socket (no separate webhook/poller needed). Mobile push depends on XEP-0357 support server+client side — historically the weak spot.
- **Effort:** ~1.5× the Telegram lane (new dependency, connection lifecycle, reconnect/backoff). Fine as a v1.x adapter; not the best first OSS channel.

### Self-hosted team chat: Rocket.Chat (MIT core) / Mattermost (MIT core) / Zulip (Apache-2.0)
- **Trivial integration:** incoming webhook = ONE HTTP POST (even smaller than Telegram); outgoing webhooks for inbound. All docker-self-hostable.
- **But:** they read as *team collaboration tools*, not public-alerting channels — weaker demo semantics ("push alerts to the EOC's ops chat" is honest and cheap, though). Good opportunistic add; not a differentiator.

### Ruled out (honest reasons)
- **Signal:** clients OSS, but **no official bot API**; `signal-cli` needs a phone number and sits in ToS gray space — conflicts with the "no ToS-protected scraping/unofficial APIs" rule.
- **IRC:** trivial bots, fully open, but no mobile push, no media, dated UX — hurts the demo.
- **Delta Chat (email transport):** interesting resilience angle (works wherever SMTP/IMAP works) but delivery latency ill-suited to alerting; email is already reachable via standard channels if needed.
- **Briar / Meshtastic (P2P/LoRa mesh):** thematically aligned with the disclosed `mobile-mesh-ews` prior work and a compelling FUTURE roadmap line (true infrastructure-less alerts), but no practical server-side bot seam today — roadmap note, not an adapter.

## 3. Better for the demo or not? (verdict)

| Criterion | Telegram (built) | Matrix | XMPP | Team-chat |
|---|---|---|---|---|
| Judge reach (already on their phone) | ★★★ | ★ | ★ | ★ |
| 100% open-source stack claim | ✗ (server proprietary; Bot API free+official) | ★★★ | ★★★ | ★★ |
| Air-gapped/offline demo (Art. XVI) | ✗ | ★★★ (compose service) | ★★ | ★★ |
| Implementation cost on the seam | done | ≈ W4b lane | ~1.5× | trivial |
| Mobile push quality | ★★★ | ★★ (Element) | ★ | ★★ |

- **Telegram stays**: it is the *reach* demo (any judge's phone, zero infra, official free API — ToS-clean),
  and it is already built, tested, and HITL-safe. Its one honest blemish — the server is not open-source —
  is documented, not hidden.
- **Matrix is the right second channel** if budget allows: it converts the blemish into a strength
  (fully-OSS, self-hosted, works with the internet DOWN — on camera: kill the network, the alert still
  reaches Element Web served from the same compose stack). Effort is bounded and proven by the W4b
  template. Recommended as the next adapter (v1.1), with Conduit (Apache-2.0) + Element Web in
  `infra/docker-compose.yml`.
- XMPP and team-chat webhooks remain documented possibilities on the same seam; Signal/IRC/Briar are
  honestly out of scope for the reasons above.

*Author: Phase-D W5 lane. Related: ADR-023 (+addendum), ADR-026, THREAT_MODEL T2.9/T5.9/T7.10-11.*
