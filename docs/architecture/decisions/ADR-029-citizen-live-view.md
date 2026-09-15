# ADR-029 — Citizen live-view links: consent-gated, HITL, one-way, permanently "Unofficial"

- **Status:** Accepted (2026-07-17)
- **Deciders:** Entrant + prod-architect + ops-security (user-directed, E11 "Live Views" wave CW4 + CW5a)
- **Relates to:** ADR-027 (agency camera sources — the `CITIZEN_STREAM` kind is a distinct trust category,
  never merged with those pins), ADR-025 (JWT identity — the verifier recorded on a HITL decision), ADR-013
  (Drizzle persistence — the nullable report columns), ADR-012 (config — `FEATURE_CITIZEN_STREAM`),
  CONSTITUTION Art. XIII (HITL before public action), Art. XIV (responsible data — consent, no PII, purge),
  Art. XVI (redundancy — flag-off degrades honestly)
- **Threat model:** `docs/architecture/THREAT_MODEL.md` TB1 T1.10 (citizen `liveViewUrl` SSRF / abuse /
  allow-list / never-fetched-server-side)

## Context

During an incident a reporter may already be streaming the scene (YouTube/Twitch/Facebook Live). Attaching
that link to an SOS report can give responders live eyes on a location no agency camera covers. But a
free-form user-supplied URL is a new PII / abuse / SSRF / phishing surface — exactly the class of input the
constitution is strictest about. The feature therefore ships **last, flag-off, and maximally constrained**
(user Q2: included, gated last). BEACON can fully demo without ever enabling it.

## Decision

1. **One optional validated field on the report, a distinct trust category.** `PublicReport` gains an
   optional `liveViewUrl?` (`src/domain/public-report.ts`) — https-only, no IP-literal, ≤2048 chars,
   purge-covered like every other report field. It maps to a new `CameraFeed` kind **`CITIZEN_STREAM`**,
   styled distinctly and **never merged visually with agency cameras** (ADR-027).

2. **A STRICT host allow-list (as shipped) — not the plan's broader "generic-https" option.** The intake
   gate (`isAllowedLiveViewUrl`/`parseLiveViewUrl`, `src/adapters/channels/http/routing.ts`) accepts ONLY:
   `youtube.com`/`www.youtube.com` (path must match `^/(watch|live)(/|$)`), `youtu.be`, `twitch.tv`, and
   `facebook.com`/`www.facebook.com` (any non-root path). **Generic-https-with-disclaimer is DEFERRED** to a
   later version behind its own review: a small, well-known set of consumer live-stream hosts is far easier
   to reason about for SSRF, abuse and phishing on a first ship, and adding a host is a one-line reviewed
   change. The allow-list by construction excludes every IP literal and private/link-local host (none are
   on it), and `user:pass@` userinfo is rejected outright (credential-smuggling / host-confusion).

3. **Never fetched server-side.** The URL is **parsed for validation only** — no HEAD, no thumbnail, no
   probe — here or anywhere downstream (link-only doctrine, ADR-027/028). The engine and the LLM never read
   the stream.

4. **Flag-off ⇒ honest 400, not a silent drop.** When `FEATURE_CITIZEN_STREAM` is off (the default), a
   `liveViewUrl` on `POST /reports` is **rejected with a 400** — a client that sent it learns the feature is
   disabled, rather than believing a link is live while it was quietly dropped. An absent field is a
   byte-identical pass-through to the pre-feature route.

5. **HITL + permanent "Unofficial" badge + 2 h TTL.** A citizen stream is a `UNVERIFIED` report like any
   other — a VERIFIER/EM reviews it (Art. XIII) and can delist it. The verifier queue renders a
   warn-styled **"Live Feed — Unofficial ↗"** chip, and `isLiveViewFresh` fades it after a **2 h TTL**
   (fail-open when no timestamp is available, so a missing clock never hides a genuine link). The badge is
   permanent — a citizen stream never graduates into the agency-camera trust tier.

6. **Persistence + freshness landing (CW5a).** The Postgres `reports` table + a new Drizzle migration carry
   nullable `live_view_url` + `received_at` columns; `PublicReport` gains an optional `receivedAt?` (ISO,
   stamped at intake from the store clock in both the memory and pg stores) that threads
   `queue.ts toReportItem → ReportSummary.submittedAt` so the TTL chip renders against a real timestamp.
   (The memory store already persisted `liveViewUrl`; pg silently dropped it before this column landed.)

## Consequences

- **Positive.** Adds genuinely-unique eyes-on-scene where no agency camera reaches, without weakening any
  invariant: consent-gated, HITL-reviewed, allow-listed, never-fetched, TTL'd, purge-covered, and
  permanently badged. The entire feature is flag-off by default, so the SSRF/abuse surface is opt-in per
  deployment and the whole product demos without it.
- **Negative / accepted.** The strict allow-list turns away legitimate streams on other hosts (e.g. a
  municipal live page) — accepted for a first ship; the deferred generic-https path (behind review) is the
  documented future widening. A 2 h TTL may fade a still-live long-running stream — accepted (fail-open,
  and a verifier can re-affirm); erring toward "stale-unless-fresh" is the responsible default for
  unofficial content.
- **Constitutional.** A citizen stream can NEVER auto-emit a CAP/EDXL alert or be treated as agency-grade
  fact (Art. XII/XIII) — it is advisory context on an `UNVERIFIED` report, subject to the same HITL gate as
  any crowdsourced signal.

## Alternatives considered

- **The plan's broader "generic https + disclaimer" allow-list from day one** — rejected for v1.2:
  materially larger SSRF/phishing reasoning surface; deferred behind its own review (a one-line host
  addition when it lands).
- **Server-side fetching a thumbnail/oEmbed for a preview** — rejected: reintroduces the fetch/proxy/SSRF
  surface the link-only doctrine exists to avoid.
- **Silently dropping `liveViewUrl` when the flag is off** — rejected: dishonest to the client; a loud 400
  surfaces a stale/misconfigured caller.
- **Merging citizen streams into the agency-camera layer** — rejected: conflates trust tiers; the
  `CITIZEN_STREAM` kind + permanent "Unofficial" badge keep them visually and semantically separate.

## Implementation complete: Yes (E11 Live Views, 2026-07-17)

`PublicReport.liveViewUrl` (+`receivedAt?`, CW5a) with https/no-IP-literal/≤2048 guards
(`src/domain/public-report.ts`); strict intake allow-list `parseLiveViewUrl`/`isAllowedLiveViewUrl`
(`src/adapters/channels/http/routing.ts`); flag-off⇒400; `FEATURE_CITIZEN_STREAM` default-off; verifier
"Live Feed — Unofficial ↗" chip + `isLiveViewFresh` 2 h TTL; nullable `live_view_url`/`received_at`
Postgres columns + migration (CW5a). Gate green after CW4 (322-test scope; suite 1816 pass/2 skip). See
THREAT_MODEL T1.10 and `docs/api/openapi.yaml` `POST /reports` `liveViewUrl`.
