# ADR-006: Realtime — SSE (Delta + Heartbeat + Last-Event-ID Backfill) with Polling Fallback
<!-- Architecture Decision Record — created by adr-writer.skill -->
<!-- Store in: docs/architecture/decisions/ADR-006-realtime-sse.md -->

**Date:** 2026-06-27
**Status:** Accepted
**Deciders:** prod-architect + human (Andrei Besleaga)
**Tags:** api | performance | infrastructure

---

## Context

When new hazard/exposure data arrives, BEACON recomputes exposure and must push deltas to subscribed clients
within seconds, without the UI blocking on upstream calls (PRD EV2, latency NFR, Q7). The data flow is
overwhelmingly **server → client** (the COP and intel panel update as ingestion produces canonical deltas);
clients rarely need a low-latency upstream channel (reports/routes use normal REST). We must choose the
realtime transport now because it shapes the `/stream` endpoint (PRD §8), the EventBus delta design, and the
TanStack Query integration (ADR-002); it must degrade gracefully and run behind proxies/free-tier hosts.

**Current state:** Locked (CLARIFICATIONS §D / §B Q7) = SSE, delta-triggered + debounced per region + heartbeat, with `Last-Event-ID` reconnect backfill; polling is the auto-fallback. No code yet.
**Constraints:** no UI blocking on upstream (PRD §10); seconds-level delta latency; must reconnect and backfill missed deltas; must work on cloud free tiers and behind proxies; graceful degradation (Art. XVI); ≈$0.

## Options Considered

### Option A — Server-Sent Events (SSE): delta + debounce + heartbeat + Last-Event-ID; polling fallback (CHOSEN)
A `GET /stream` SSE channel keyed by region. Workers push on canonical-model delta, coalesced within a short
window (`SSE_DEBOUNCE_MS`, default 1500ms); a periodic heartbeat (`SSE_HEARTBEAT_SEC`) proves liveness;
client reconnect uses the standard `Last-Event-ID` header to backfill missed deltas; on stream
drop/unavailability the client auto-falls-back to periodic polling (`FEATURE_REALTIME=polling`).
**Pros:** perfect fit for one-way server→client push (BEACON's actual need), far simpler than a bidirectional protocol; native browser `EventSource` with built-in auto-reconnect + `Last-Event-ID` replay gives missed-delta backfill almost for free (PRD EV2 reliability, Q7); runs over plain HTTP — friendly to proxies, CDNs, cloud free tiers, no special server upgrade; clean degradation to polling (Art. XVI realtime ladder, CONFIGURATION.md §3/§11).
**Cons:** one-directional only (no client→server over the same channel) — acceptable since BEACON uses REST for upstream actions; each open SSE connection holds a server response stream, needing connection management at high client counts (fine at demo scale; debounced per-region pushes keep traffic low); some legacy proxies buffer streaming responses (mitigated by heartbeat + polling fallback).
**Source:** CLARIFICATIONS §B Q7 / §D; CONFIGURATION.md §3; html.spec.whatwg.org (Server-Sent Events, EventSource, Last-Event-ID); MDN EventSource.

### Option B — WebSocket
Full-duplex persistent socket.
**Pros:** bidirectional, low-latency in both directions, good for chat/collaborative cursors; mature ecosystem (ws, socket.io).
**Cons:** over-engineered for a predominantly one-way feed — adds protocol/upgrade complexity and a separate reconnect/backfill scheme we'd have to build (SSE gives `Last-Event-ID` natively); harder behind some proxies/free-tier hosts, needs explicit upgrade handling, heavier to operate; no clean built-in catch-up-on-reconnect semantics (we'd reimplement what SSE provides).
**Source:** datatracker.ietf.org/doc/html/rfc6455 (WebSocket); team experience.

### Option C — Long-polling only
Repeated HTTP requests holding open until data or timeout.
**Pros:** maximally compatible, trivial to implement, works everywhere.
**Cons:** higher latency and overhead than SSE (more requests, more server churn); no streaming liveness/heartbeat semantics, worse UX for live deltas; best as a *fallback*, not the primary transport.
**Source:** team experience; used here precisely as the SSE fallback rung.

## Decision

**We will use Option A — SSE as the primary realtime transport (delta-triggered, per-region debounced,
heartbeat for liveness, `Last-Event-ID` reconnect backfill), with automatic polling fallback.**
Rationale: (1) BEACON's realtime need is one-way server→client COP/intel deltas — SSE matches it exactly and
is far simpler than WebSocket (PRD EV2, Q7); (2) `EventSource`'s native auto-reconnect + `Last-Event-ID`
gives reliable missed-delta backfill with minimal code, meeting the reliability NFR; (3) plain-HTTP SSE works
on cloud free tiers/proxies and degrades cleanly to polling — the realtime rung of the Art. XVI ladder
(CONFIGURATION.md). WebSocket remains a documented future option (CLARIFICATIONS §D) if bidirectional
low-latency is ever required.

## Consequences

- **+** Simple, proxy-friendly, free-tier-friendly live updates with built-in reconnect/backfill.
- **+** Debounced per-region pushes keep traffic and recompute fan-out low; no UI blocking on upstream.
- **+** Clean polling fallback satisfies the redundancy mandate.
- **−** One-way only; upstream actions go via REST (a deliberate, documented split).
- **−** Long-lived connections need basic connection-count management at scale.
- **~** `SSE_DEBOUNCE_MS` and `SSE_HEARTBEAT_SEC` are tunable config (CONFIGURATION.md §3).
- **risk:** proxy buffering of the stream → mitigated by the heartbeat (detects stalls) and automatic polling fallback.
- **risk:** connection exhaustion at high client counts → mitigated by per-region debouncing and, if needed, a Redis Streams event bus (`FEATURE_EVENTBUS=redis`) for fan-out (ADR-009 ladder).

## Y-Statement
> For BEACON clients watching a live COP that must update within seconds, needing reliable server-pushed
> deltas that survive reconnects, SSE with delta+heartbeat+Last-Event-ID and a polling fallback delivers
> one-way pushes over plain HTTP with native reconnect/backfill; unlike WebSocket, it avoids bidirectional
> complexity for a one-way feed and degrades cleanly to polling.

## Links
- **PRD:** EV2 (push deltas on recompute), §8 (`GET /stream` SSE channel), OP2 (`FEATURE_REALTIME=polling`), §10 (latency/reliability NFRs).
- **Constitution:** Art. XVI (realtime ladder SSE→polling, `Last-Event-ID` backfill), XV (graceful degradation).
- **Decision source:** CLARIFICATIONS §B Q7 / §D.
- **Related ADRs:** ADR-002 (TanStack Query as delta sink), ADR-003 (Next.js streaming route handler), ADR-004 (workers produce deltas), ADR-009 (redundancy/eventbus), ADR-012 (config flags).
- **Official docs:** html.spec.whatwg.org server-sent-events; MDN EventSource.
- **Implementation:** S05 (`app/stream` + EventBus — pending S04 gate).

## Review
**Approved by:** prod-architect + human, 2026-06-27 · **Implementation complete:** Yes (Phase-B/C/D) · **Revisit:** Post-demo (if bidirectional low-latency collaboration is ever required → reconsider WS).
