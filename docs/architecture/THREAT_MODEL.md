# BEACON — Threat Model (S02)

*IEEE Response Quest 2026 · Phase 3 · GABBE SDLC S02 (Architecture). Persona: `ops-security`.
Required by **CONSTITUTION Article V** ("Threat model required before implementing any: authentication,
authorization, data storage, file upload, … external API integration"). Inputs: `../requirements/PRD.md`
(§11, §5 EARS), `docs/audit/v1/CLARIFICATIONS.md` (§B.Q6 RBAC), `CONSTITUTION.md` (Art. IV, V, XII, XIII,
XIV, XVI), `../../../Phase2/submission/RESPONSIBLE_DATA.md`. Method: **STRIDE** per trust boundary, mapped
to **OWASP** (Top 10 2021, **LLM Top 10 2025**, **API Security Top 10 2023**) and **NIST** (SP 800-53
Rev.5, SP 800-61r2, AI RMF 1.0). Gate: feeds the **S07** security gate checklist (§16).*

> In a crisis a wrong, unattributed, or false-positive output can cost lives. For BEACON, **trust,
> provenance, and human control are constitutional, not features** (CONSTITUTION preamble to Art. XI–XVI).
> This threat model therefore treats *integrity of the decision* and *integrity of the alert* as the
> crown-jewel assets, above confidentiality.

---

## 1. Scope, method & risk scale

### 1.1 STRIDE legend

| Letter | Property threatened | Desired property |
|---|---|---|
| **S** | Spoofing | Authentication |
| **T** | Tampering | Integrity |
| **R** | Repudiation | Non-repudiation / audit |
| **I** | Information disclosure | Confidentiality |
| **D** | Denial of service | Availability |
| **E** | Elevation of privilege | Authorization |

### 1.2 Likelihood × Impact → Risk

Likelihood ∈ {Low, Med, High}; Impact ∈ {Low, Med, High, **Critical**}. Risk = product, with
**Critical** reserved for life-safety (false public alert, suppressed real alert, PII leak of an
at-risk person). Each row maps a mitigation to a **CONSTITUTION article** and/or an **EARS requirement**
(PRD §5) plus an external standard.

### 1.3 Crown-jewel assets (ranked)

1. **Outbound alert integrity** (CAP v1.2 / EDXL emitted to the world) — a false or suppressed alert is a
   direct life-safety hazard.
2. **Reporter PII** (precise location, contact, free-text, SOS images) of people *currently in danger*.
3. **Decision integrity** (deterministic exposure/ranking + cited SitRep) — the basis of dispatch.
4. **Audit log** (`AUDIT_EVENT`) — the accountability and forensic record.
5. **Secrets** (provider keys, DB creds) and **availability** of the COP itself.

### 1.4 Trust boundaries (data-flow overview)

```
              UNTRUSTED                          │  SEMI-TRUSTED            │   TRUSTED CORE
 ┌──────────────────────────────────────────┐   │ ┌─────────────────────┐ │ ┌────────────────────────┐
 │ Public reporter (web/SMS)  ── TB1 ───────▶│   │ │ Source adapters TB4 │ │ │ Domain (deterministic) │
 │ Crowd/social signal ─────── TB3 ─────────▶│   │ │ (FIRMS/NWS/Overpass │ │ │  exposure/ranking/U3   │
 │ External data feeds ─────── TB4 ─────────▶│   │ │  /GDELT/ReliefWeb…) │ │ │ Application use-cases   │
 │ Ingested text+images ────── TB5 (LLM) ───▶│   │ └─────────────────────┘ │ │ AlertSink (CAP/EDXL) TB2│
 └──────────────────────────────────────────┘   │ ┌─────────────────────┐ │ │ Repository / Audit TB7 │
 ┌──────────────────────────────────────────┐   │ │ LLM provider  TB5   │ │ │ RBAC enforcement  TB6  │
 │ Authn'd users PUBLIC/RESPONDER/           │   │ │ (Groq/OpenRouter/   │ │ │ Secrets / config  TB8  │
 │ VERIFIER/EM ─────────────── TB6 ─────────▶│   │ │  local Ollama)      │ │ │ Region isolation  TB9  │
 └──────────────────────────────────────────┘   │ └─────────────────────┘ │ └────────────────────────┘
                                                                            offline/air-gapped = TB10
```

Boundaries covered: **TB1** public SOS intake · **TB2** verify→CAP/EDXL alert path · **TB3**
crowd/social misinformation · **TB4** external data-source adapters / supply chain · **TB5** the LLM ·
**TB6** RBAC (PUBLIC/RESPONDER/VERIFIER/EM) · **TB7** audit-log integrity · **TB8** secrets/keys ·
**TB9** multi-tenant / multi-region isolation · **TB10** offline / local deployment ·
**TB11** AI Compliance Proxy (the mandatory chokepoint in front of every LLM+Vision call — §14a).

---

## 2. TB1 — Public SOS intake (consent, PII, abuse/spam, geolocation spoofing)

*Asset:* `PUBLIC_REPORT` (consent flag, contact, free text, coordinates, image). *Entry point:*
`POST /reports` (web + SMS gateway). Untrusted, anonymous, internet-facing.

| # | STRIDE | Attack | Impact | L | Mitigation → mapping |
|---|---|---|---|---|---|
| T1.1 | **S** | Attacker spoofs another person's location/identity to mis-direct responders | Med–High | High | All reports enter as `UNVERIFIED`; **HITL verify gate** before any action (Art. XIII; **EV4/EV5/ST1/UW5**). Deterministic `confidence` blends `source_authority` + `corroboration` (CLARIF §B.Q4) so a lone spoof scores low. |
| T1.2 | **T** | **Geolocation spoofing** — forged GPS/address to create phantom hotspots | High | High | Geocode precision component scored deterministically (CLARIF Q4); corroboration weighting; crowd signal is *supplementary, never overrides official data* (Art. XI). Cross-check against authoritative hazard geometry before promotion. |
| T1.3 | **R** | Reporter denies/forges a submission; no trace of who acted on it | Med | Med | Every state change → `AUDIT_EVENT(actor, action, target, time)` (Art. XIII; CLARIF Q6 footer; **NIST AU-2/AU-3**). |
| T1.4 | **I** | PII (contact, precise coords, free text) leaked to public COP or logs | **Critical** | Med | **ST3**: precise location/contact in **responder-authenticated view only**; public view generalized. **UW6/Art. IV**: never log PII — log UUID + generalized cell + status + confidence components. See §11. |
| T1.5 | **I** | Submission without genuine consent → unlawful PII processing | High | Med | **EV4** requires explicit consent before store; no consent ⇒ reject. Consent recorded (timestamp + scope) per RESPONSIBLE_DATA §2; data minimization (Art. IV). |
| T1.6 | **D** | **Abuse/spam flood** of fake reports drowns verifiers / exhausts triage budget | High | High | Per-IP/per-number rate limiting + CAPTCHA/proof-of-work on web; SMS throttle; dedup/cooldown (mirrors threshold `cooldown`/`hysteresis`, CLARIF Q5). Triage queue backpressure; LLM token budget cap (CLARIF Q10) bounds cost-amplification. **OWASP API4:2023 (Unrestricted Resource Consumption)**, **API6 (Sensitive Business Flows)**. |
| T1.7 | **D** | Oversized/malformed payload or SMS bomb crashes intake worker | Med | Med | Strict input validation + size limits at the boundary (Art. V "input validation at all boundaries"); typed parser returns `Result`, never throws upstream (AGENTS §4). |
| T1.8 | **T** | Malicious file upload (SOS image) — polyglot/oversized/EXIF-geotag exploit, malware | Med–High | Med | MIME/type/size allow-list; re-encode/strip metadata; PII screen before storage (Art. XIV; OP1 vision is consent+PII-screened). **OWASP A05/ASVS file-upload**; see §11.3. Only derived non-identifying classification persists. |
| T1.9 | **E** | Forged role/field in report body to self-escalate (e.g. claim "official account") | Med | Low | `source_authority` is assigned server-side from the authenticated channel, never trusted from the payload (Art. V least privilege). Mass-assignment guard. |
| T1.10 | **S/I/D** | **Citizen live-view link abuse** (E11 "Live Views" v1.2, ADR-029) — an SOS `liveViewUrl` used for SSRF (IP-literal/private/link-local/metadata host, `user:pass@` credential-smuggling), open-redirect/phishing, or to smuggle a non-stream URL onto the COP | Med–High | Med | **Flag-off by default** (`FEATURE_CITIZEN_STREAM`) — the field is REJECTED with a **400** when off (honest, never a silent drop), so the surface is opt-in per deployment. When on: `isAllowedLiveViewUrl` (`src/adapters/channels/http/routing.ts`) enforces a **STRICT https host allow-list** (`youtube.com`/`www.` with a `^/(watch\|live)` path, `youtu.be`, `twitch.tv`, `facebook.com`/`www.` non-root) — which by construction contains **no IP literals and no private/link-local hosts**; `user:pass@` userinfo is rejected; `≤2048` chars; `http:`/unparseable rejected. The URL is **PARSED for validation only — NEVER fetched server-side** (no HEAD, no thumbnail, no oEmbed) here or downstream (link-only doctrine). The stream is a distinct `CITIZEN_STREAM` trust category: `UNVERIFIED`, **HITL-reviewable/delistable** (Art. XIII), permanently badged **"Live Feed — Unofficial"**, **2 h TTL** (`isLiveViewFresh`, fail-open), never merged with agency cameras, and covered by the existing per-reporter **rate bucket** + PII purge (Art. XIV). Generic-https intake is DEFERRED behind its own review. |

---

## 3. TB2 — Verify → CAP/EDXL alert path (false-alert liability, authz)

*Asset (crown jewel #1):* outbound `ALERT` (CAP v1.2), `EDXL-RM`/`EDXL-SitRep`. *Entry:* `POST /alerts`,
EDXL export. *This is the highest-liability boundary — output acts on the public world.*

| # | STRIDE | Attack | Impact | L | Mitigation → mapping |
|---|---|---|---|---|---|
| T2.1 | **E** | Non-VERIFIER/EM emits a CAP alert | **Critical** | Med | RBAC: only VERIFIER/EM "Approve report → emit CAP" (CLARIF §B.Q6). Server-side authz on `POST /alerts`; **EV5/ST1/UW5**. **OWASP API1/API5 (BOLA/BFLA)**. |
| T2.2 | **T** | Unverified report or DRAFT threshold alert promoted straight to outbound CAP | **Critical** | Med | **Art. XIII** HITL: threshold fires create **DRAFT** only (EV6/CLARIF Q5); `UNVERIFIED`/`TRIAGED` cannot emit (**ST1/UW5**). State-machine guard enforced in the use-case, not the UI. |
| T2.3 | **S/T** | **False-alert liability** — spoofed/poisoned input drives a real evacuation order | **Critical** | Med | Defense-in-depth: corroboration + deterministic geometry cross-check (Art. XII) + mandatory human approval (Art. XIII) + full audit (who approved, on what evidence). **No live IPAWS origination** (PRD §11/§12, CLARIF C6) — BEACON *produces+validates* CAP, a human authority disseminates. Caps blast radius of any single failure. |
| T2.4 | **T** | CAP/EDXL XML tampered/injected (XXE, malformed geometry) at serialization boundary | High | Med | Validate every emitted message against **CAP v1.2 / EDXL-RM/SitRep JSON-Schema** (`schemas/`, S03) before send; XML built by a hardened serializer with **XXE disabled**, output-encoded (Art. V output encoding). **OWASP A03/A05**. |
| T2.5 | **R** | Approver denies authorizing an alert; or alert lacks evidentiary trail | High | Med | `AUDIT_EVENT` records actor + report id + provenance chain at approval; alert carries `provenance[]` to triggering `SOURCE_RECORD` (Art. XI, EV6). Tamper-evident log (§9). **NIST AU-9/AU-10 (non-repudiation)**. |
| T2.6 | **I** | CAP message embeds reporter PII in description | **Critical** | Low | CAP payload built from generalized/derived fields only; PII-screen step on alert composition (Art. IV/XIV; ST3). |
| T2.7 | **D** | Alert pipeline blocked → real warning never goes out (suppressed alert) | **Critical** | Low | Redundancy ladder (Art. XVI): AlertSink failures surfaced loudly, never silently dropped; retries + dead-letter; degradation labeled, not hidden. Availability of the warning path is itself life-safety. |
| T2.8 | **E** | RESPONDER tasks resources from another org via mutual-aid path | Med | Med | "Register/task resources" = RESPONDER **own-org only** / EM (CLARIF §B.Q6). EDXL-RM commit checks org ownership (BFLA). |
| T2.9 | **D/S** | Telegram alert broadcast (`handleAlertApprove` → `broadcastApproval`, ADR-026) becomes an alternate/earlier emit path, or a broadcast failure blocks the approval | **Critical**/Med | Low | **Notifier-only injection**: the handler only ever sees a `NotificationPort` (PII-redact + output-firewall + hash-chained audit are structural, never a raw `MessagingPort`) — a broadcast literally cannot be constructed without those controls. **Strictly a post-emit side-effect**: fired only AFTER `sink.emit` succeeds on an already-approved `EmittableAlert` (Art. XIII) — never an alternate path to ACTUAL. **Audited-not-fatal**: any per-chat-id send failure (typed err or thrown transport) is caught and swallowed per-recipient — never 5xx's the `POST /alerts/{id}/approve` response, never blocks the other subscribers (Art. XVI). |

---

## 4. TB3 — Crowdsourced / social misinformation

*Asset:* integrity of the fused SitRep and the COP (decision integrity, crown jewel #3).

| # | STRIDE | Attack | Impact | L | Mitigation → mapping |
|---|---|---|---|---|---|
| T3.1 | **T** | Coordinated misinformation campaign injects false "facts" into the SitRep | High | Med | Crowd/social is **supplementary, never overrides official data** (Art. XI). Conflicting/low-authority signals are **flagged, never merged as fact** (Art. XIV; RESPONSIBLE_DATA §4). All SitRep fields require `citations[]` → authoritative `SOURCE_RECORD` (**U2/Art. XI**). |
| T3.2 | **S** | Sockpuppet/bot accounts fake "official" corroboration to inflate confidence | Med–High | Med | `source_authority` tier (official > consented > public-social) + corroboration counts *independent* sources (CLARIF Q4); official accounts allow-listed, not inferred from display name. |
| T3.3 | **T** | Prompt-injection riding inside social text (see TB5/§10) | High | Med | Treat all ingested NL as untrusted data, not instructions (§10; **OWASP LLM01**). |
| T3.4 | **I** | Misinformation flag itself reveals an investigation target | Low | Low | Flags are operational metadata, responder-view only; no PII (Art. IV). |
| T3.5 | **D** | Volume of low-quality social signal degrades fusion latency / TTTP <10s | Med | Med | Bounded grounding-fact set + token budget (CLARIF Q10); deterministic core unaffected by AI load (Art. XII/XVI). |

> **No scraping of ToS-protected platforms** (X/Twitter) — only consented intake + permitted public
> firehoses/official accounts (RESPONSIBLE_DATA §2; Art. XIV). This removes a whole class of legal +
> integrity risk at the source.

---

## 5. TB4 — External data-source adapters (poisoned/compromised feed, supply chain)

*Asset:* canonical domain model (decision integrity); the dependency/build pipeline.

| # | STRIDE | Attack | Impact | L | Mitigation → mapping |
|---|---|---|---|---|---|
| T5.1 | **T** | A source feed is compromised/poisoned (e.g. spoofed gauge crest, fake hotspot) drives a false threshold alert | High | Med | Threshold fires → **DRAFT only** + human verify (Art. XIII; EV6). Provenance to exact `SOURCE_RECORD` (Art. XI) makes a rogue feed traceable. Cross-source corroboration for high-stakes transitions; `hysteresis`/`cooldown` damp single-feed flap (CLARIF Q5). |
| T5.2 | **S** | DNS/TLS MITM impersonates `api.weather.gov`/FIRMS → injected data | High | Low | **TLS 1.3** + cert validation on all egress (NFR §10); pinned/known bases via config (U5); no plaintext fetch. **NIST SC-8/SC-13**. |
| T5.3 | **T** | Raw upstream format (ArcGIS/CSV/RSS/XML) carries an exploit through the parser (XXE, billion-laughs, CSV-injection) | High | Med | **Anti-corruption layer** normalizes & validates before anything reaches the domain (Art. XV; AGENTS §3 "no raw format above ACL"); XML parsers with **XXE/entity-expansion disabled**; CSV sanitized. **OWASP A03/A05**. |
| T5.4 | **D** | A source goes down, is rate-limited, or returns garbage | Med | High | Per-adapter **circuit breaker + last-known-good cache + recorded-mock fallback** (Art. XV/XVI; **UW2**); degrade to "unavailable + freshness", never a dead-end. |
| T5.5 | **T** | **Supply-chain**: malicious npm dependency / typosquat / compromised transitive package | **Critical** | Med | `npm audit --audit-level=high` gate (Art. V; AGENTS Gate 5) — no critical/high CVEs ship; lockfile pinned + integrity hashes; Dependabot; **SBOM** + provenance; minimal deps (Art. III). **OWASP A06 (Vulnerable Components)**, **A08 (Software/Data Integrity)**, **NIST SR-3/SR-11**. |
| T5.6 | **T** | Compromised CI/CD injects code or exfiltrates secrets | High | Low | CI secrets in GitHub Secrets only; least-privilege tokens; protected `main` (no direct push, AGENTS §6); CI config changes need human approval (AGENTS §8). **NIST CM-3/SA-15**. |
| T5.7 | **I** | Adapter logs raw upstream payload containing third-party PII or keys | Med | Med | Redaction by default (Art. VI observability); never log full payloads/keys (Art. IV). |
| T5.8 | **E** | An adapter granted broader DB/network rights than it needs | Med | Low | Least privilege per adapter; adapters cannot import persistence/domain internals (Art. II/XV). |
| T5.9 | **S** | DNS/TLS MITM impersonates a new Phase-D **feature-adapter** egress host — `api.telegram.org` (outbound `sendMessage`, `src/adapters/channels/messaging/messaging-port.ts` `TelegramLiveTransport`) or `api.openrouteservice.org` (ORS routing, `src/adapters/routing/ors-routing.ts`) — injecting a forged bot reply or a hazard-crossing route | High | Low | Same control as T5.2: **TLS 1.3** + cert validation, base URL from config/constant (never client-supplied), no plaintext fetch. **`redirect: 'manual'`** now covers all outbound clients — ORS/source adapters (`_shared/resilient-http.ts`), the Telegram `sendMessage` egress (`TelegramLiveTransport`), and the LLM/AI-provider client (`src/adapters/ai/http-client.ts`) — so a MITM'd upstream cannot 3xx-redirect an egress to an internal/metadata address (SSRF-via-redirect); a 3xx surfaces as a non-2xx (`res.ok` false) failure, never a follow. Both are typed-`Result`, never-throw adapters (Art. XVI) — a failure degrades (ORS → heuristic route; Telegram send → audited-not-fatal, T2.9) rather than trusting a malformed response. The 14 new W1 source-catalog adapters (`gdelt`/`reliefweb`/`agency-rss`/`bluesky`/`nifc`/`effis`/`osm-overpass`/`worldpop`/`census`/`nfhl`/`eagle-i`/`opencellid`/`itu`/`camara-gsma`) are ordinary `SourceAdapterPort` entries and already covered generically by T5.1–T5.8 above (this doc does not enumerate a per-adapter host table, matching its existing granularity — see `docs/audit/DATA_SOURCE_VERIFICATION.md` for the per-source endpoint list). **NIST SC-8/SC-13**. |
| T5.10 | **S/T** | DNS/TLS MITM impersonates a new E11 **camera-adapter** egress host — `cwwp2.dot.ca.gov` (Caltrans CCTV), `services8.arcgis.com` (ALERTCalifornia ArcGIS Living Atlas FeatureServer), `api.windy.com` (Windy Webcams v3), `511ga.org` (GA 511 DOT) — injecting a forged camera list or a malicious `viewUrl` | High | Low | Same control as T5.2/T5.9: **TLS 1.3** + cert validation, base URL from config/constant (never client-supplied), `redirect:'manual'` on the shared resilient-http client (no 3xx-to-internal follow), typed-`Result` never-throw adapters that degrade LIVE→cache→recorded-mock (Art. XVI). Injected `viewUrl`s are still bounded by the https-only host-validation guard (T5.11). **`cnadnr-ro` is MOCK-only and performs NO server egress** (hand-curated official RO pages served from a recorded fixture) — it has no live host to impersonate. **NIST SC-8/SC-13**. |
| T5.11 | **T/S** | **Camera link-out href-injection / open-redirect** — a crafted or MITM'd upstream camera record carries a `javascript:`/`data:`/`http:` or attacker-controlled `viewUrl` that lands in an anchor the user clicks | High | Low | **Structural https-only invariant**: `makeCameraFeed` (`src/domain/camera-feed.ts`) rejects any `viewUrl` whose `new URL(...).protocol !== 'https:'` (and any unparseable string) — a non-https/`javascript:`/`data:` URL can never construct a `CameraFeed`. A `viewUrl` is only ever an adapter-typed value (Caltrans direct field, ALERTCalifornia's authoritative `cameraURL` attribute, a Windy/511 detail page) or, for citizen streams, an allow-listed intake URL (T1.10) — **never a raw upstream string echoed into an href without host validation**. The external-views deep-links (ADR-028) interpolate only a `toFixed(5)` numeric coordinate into a hard-coded `https://<fixed-host>/…` template — nothing untyped reaches the href. All link-out anchors carry `target=_blank rel="noopener noreferrer"` / `window.open(...,'noopener,noreferrer')`. **Attribution-compliance obligation:** the mandatory **"Webcams provided by windy.com"** badge and **"ALERTCalifornia \| UC San Diego"** credit are rendered in the legend `DATA_ATTRIBUTION` (a licensing, not a security, control, tracked here for completeness — Windy ToS + ALERT CC BY-NC-ND require it). **OWASP A03 (Injection)/A01 (Broken Access — open redirect)**. |

---

## 6. TB5 — The LLM (prompt injection, hallucination, data exfiltration)

*Asset:* SitRep integrity, secrets, PII. See the dedicated **§10 (anti-prompt-injection)**; summary rows
below. *Maps to **OWASP LLM Top 10 2025**.*

| # | STRIDE | Attack | Impact | L | OWASP LLM | Mitigation → mapping |
|---|---|---|---|---|---|---|
| T6.1 | **T** | **Prompt injection** via ingested news/social/SOS text/image → LLM follows hidden instructions | High | High | **LLM01** | Structured grounding (facts as data, not instructions); JSON-schema-validated output, reject+fallback on failure (**U3/UW3**, Art. XII); LLM has **no tools/actions** (narration only). See §10. |
| T6.2 | **T** | **Hallucination** — LLM invents a number, ranking, or uncited claim | **Critical** | High | **LLM09** | **Art. XII**: LLM never computes figures — all numbers deterministic (Turf/SQL). Every SitRep field needs `citations[]` (**U2**); uncited/invalid output rejected → deterministic fallback (**UW3**). |
| T6.3 | **I** | **Data exfiltration** — injection coaxes the model to emit secrets, PII, or system prompt | High | Med | **LLM02/LLM06** | No secrets/PII ever placed in the prompt context (Art. IV); grounding facts are pre-screened, generalized; egress-bounded output (schema-constrained, no free URLs/markdown-image beacons). |
| T6.4 | **D/Cost** | Token-flood / recursive prompt drives unbounded cost ("denial of wallet") | Med | Med | **LLM10** | Per-SitRep input truncation + output schema bound (CLARIF Q10); model tiering + budget (Art. X). |
| T6.5 | **T** | Compromised model/provider returns malicious or biased output | Med | Low | **LLM03 Supply-Chain / LLM04 Data-&-Model-Poisoning** (OWASP LLM 2025 titles) | Provider via config + fallback ladder (Groq→OpenRouter→**local Ollama**→deterministic-only, Art. XVI/UW1); local Ollama = no-egress option; output still schema-validated. |
| T6.6 | **I** | Sensitive grounding context sent to a 3rd-party cloud LLM | Med | Med | Offline/local mode (Ollama) for sensitive deployments — **no data egress** (Art. XVI; TB10); redact-by-default (Art. VI). |
| T6.7 | **T** | Vision model misled by adversarial/poisoned imagery to mis-classify | Med | Low | Vision is **advisory, cited, confidence-scored**, feeds verify pipeline, **never auto-alerts, never overrides deterministic geometry** (Art. XII; OP1/CLARIF Q11). |

---

## 7. TB6 — RBAC (PUBLIC / RESPONDER / VERIFIER / EM)

*Asset:* authorization integrity. *Matrix authority:* the RBAC capability matrix is single-sourced in
**`docs/audit/v1/CLARIFICATIONS.md §B.Q6`** (not reproduced here) — PUBLIC/RESPONDER/VERIFIER/EM with precise-PII
gated to RESPONDER+, triage/approve-CAP/audit-read to VERIFIER+, and config/threshold/region/adapter +
resource/shelter mutation scoping per that matrix. The threat rows below assume it.

| # | STRIDE | Attack | Impact | L | Mitigation → mapping |
|---|---|---|---|---|---|
| T7.1 | **E** | **BOLA/IDOR** — user fetches another report's precise PII by guessing an ID | **Critical** | Med | Per-object authz on every endpoint, not just per-route; precise-PII fields gated to RESPONDER+ (ST3). **OWASP API1:2023 (BOLA)**; **NIST AC-3/AC-4**. |
| T7.2 | **E** | **BFLA** — PUBLIC calls the approve-CAP / configure-adapter function directly | **Critical** | Med | Server-side function-level checks against the matrix; EM-only for config/threshold/region/adapter. **OWASP API5:2023 (BFLA)**. |
| T7.3 | **E** | RESPONDER tasks/edits resources outside own org | Med | Med | "own org" scope enforced on resource/shelter mutations + EDXL-RM (CLARIF Q6). |
| T7.4 | **S** | Stolen/replayed session or weak auth → impersonation of a VERIFIER/EM | High | Med | Short-lived tokens, session expiry, **MFA for admin (EM) operations** (Art. V); SSO/strong authn for staff roles. **NIST IA-2/IA-5**. |
| T7.5 | **E** | Privilege creep / over-broad default role | Med | Low | Least privilege (Art. V); deny-by-default; role assignment audited. |
| T7.6 | **R** | Staff action with no attributable actor | High | Low | Authenticated identity on every state change → `AUDIT_EVENT` (Q6 footer). PUBLIC is anonymous **only** for submit/view; all privileged actions require authenticated identity. |
| T7.7 | **I** | "View audit log" exposed below VERIFIER (contains actors/targets) | Med | Low | Audit-log read = VERIFIER/EM only (Q6); audit entries themselves PII-minimized (§9). |
| T7.8 | **S/E** | Forged/algorithm-confused bearer JWT (`alg=none`, RS↔HS confusion, expired token) grants an elevated role | **Critical** | Low | `resolvePrincipal`/`verifyBearerPrincipal` (`src/adapters/channels/http/rbac.ts`, ADR-025) use **jose** `jwtVerify` with an **explicit pinned `algorithms:['HS256']` allow-list** (rejects `alg=none` and RS-HS confusion) and enforces `exp`. **Fail-closed on ANY failure** (bad signature, wrong secret, expired, unknown role claim) → `{role:'PUBLIC'}` with no `sub` — never throws, never falls back to a higher-privilege default. A client-supplied `actorId`/`sub` in a request body is separately rejected 400 (never trusted) — the audit actor is always the *verified* claim or the role key. **OWASP API2:2023 (Broken Authentication)**; **NIST IA-5**. |
| T7.9 | **E** | `POST /auth/dev-login` demo-IdP minter is reachable in a real deployment and mints an arbitrary-role token | **Critical** | Low | Defense-in-depth, three independent gates in `handleDevLogin` (`http-dispatcher.ts`, ADR-025): (1) **hard-off** whenever `NODE_ENV=production` or `DEPLOY_MODE=cloud`, regardless of any other flag; (2) **opt-in**: requires BOTH `AUTH_SECRET` set AND `AUTH_DEV_LOGIN=on` explicitly — a secret alone never enables minting; (3) **non-disclosing 404**: disabled/prod/cloud all return the SAME generic `{code:'NOT_FOUND', message:'no such route'}` body as an unrouted path, never confirming the route exists or which gate blocked it (PR#3 Copilot hardening). Confirmed by the Phase-C security audit (`docs/audit/FINAL_LIVE_AUDIT-2026-08.md` §3). |
| T7.10 | **S/E** | Telegram webhook (`POST /channels/telegram/webhook`) spoofed by a non-Telegram sender, or an unlisted chat id drives a privileged command | **Critical** | Low | `handleTelegramWebhook` (`src/adapters/channels/messaging/telegram-webhook.ts`, ADR-023/ADR-026) requires the `X-Telegram-Bot-Api-Secret-Token` header to **constant-time** match `TELEGRAM_WEBHOOK_SECRET` (`node:crypto timingSafeEqual` — no early-out length/byte compare); absent/unconfigured secret ⇒ generic 404 (route disabled, non-disclosing, mirrors T7.9); bad token ⇒ generic 401. A verified update is then **self-signed** and re-enters the SAME `handleInbound` trust pipeline every channel uses (allow-list → replay → rate → firewall → parse, `trust.ts`) — an unlisted sender is rejected there. **Replay/dedupe:** because the webhook self-signs each verified update with a **fresh clock**, the trust pipeline's signature-keyed replay guard (and its freshness window) could not catch a captured/re-delivered POST on this path — replay within the secret-holder trust boundary was possible before `update_id` dedupe (**closed 2026-07-15**). The handler now dedupes Telegram's stable, monotonically-increasing per-update `update_id` (a bounded FIFO `seenUpdate` seam in `app/api/v1/channels/telegram/webhook/route.ts` — no timers/clock) **after** secret verification and **before** dispatch: an already-seen `update_id` is acked 200 without re-dispatching (Telegram redelivers the same id on retry). **200-on-verified-but-unparseable/rejected/deduped** is deliberate Telegram-retry-loop avoidance, not a bypass (the command is never dispatched). **Poller/webhook mutual exclusion** (`scripts/telegram-poll.ts` refuses to start when `TELEGRAM_WEBHOOK_SECRET` is set) prevents the Bot API `getUpdates`-while-webhook-registered conflict from creating a duplicate/confused inbound path. **OWASP API2:2023**. |
| T7.11 | **E** | *(Accepted risk, not fully mitigated — see rationale.)* The inbound command allow-list is seeded from the SAME `TELEGRAM_ALERT_CHAT_IDS` list the outbound approved-alert broadcast (ADR-026) fans out to — an operator chat id can both *receive* broadcasts and *issue* RESPONDER-role commands over the bot; there is no separate "broadcast-only, no-inbound" chat-id class | Med | Low | **Accepted risk, by design** (2026-07-15): `TELEGRAM_ALERT_CHAT_IDS` is documented as "the operator/responder channel", so double-duty is the intended trust model for the demo/field-ops posture, not an oversight — see `app/api/v1/channels/telegram/webhook/route.ts` `allowListFromEnv`. Every id still maps to `RESPONDER` only (never VERIFIER/EM) and every command still traverses the full trust pipeline (T7.10) + RBAC (this section) before acting. **Recommended future control** (not yet built): split into `TELEGRAM_ALERT_CHAT_IDS` (broadcast-only) + a separate `TELEGRAM_RESPONDER_CHAT_IDS` (inbound allow-list) so a compromised/leaked broadcast recipient list cannot be replayed as a command allow-list. |

---

## 8. TB8 — Secrets / keys

*Asset (crown jewel #5):* provider API keys (FIRMS MAP_KEY, ORS, OpenCelliD, LLM provider keys, ReliefWeb
appname), DB credentials, SMS gateway creds, signing keys.

| # | STRIDE | Attack | Impact | L | Mitigation → mapping |
|---|---|---|---|---|---|
| T8.1 | **I** | Secret committed to git / baked into image / leaked in logs/errors | High | Med | **No secrets in code or git history** (Art. V); all via env (`.env` gitignored, `.env.example` documented) + GitHub Secrets (AGENTS §6); redact-by-default (Art. IV/VI); secret-scanning in CI. **NIST IA-5, SA-15**. |
| T8.2 | **I** | Secret returned to client / exposed via misconfigured config endpoint | High | Low | Config read fail-fast at boot, server-side only (U5); no secret in any API envelope/client bundle. |
| T8.3 | **E** | Over-scoped key (e.g. write key where read suffices) | Med | Low | Least-privilege per provider key; separate keys per env (Art. V). |
| T8.4 | **T** | No rotation → long-lived compromise | Med | Low | Rotation policy + short-lived tokens where supported (Art. V); rotation runbook in §16. |
| T8.5 | **D** | Key exhaustion / quota abuse takes a source offline | Med | Med | Per-adapter quota handling + circuit breaker + cache fallback (Art. XVI/UW2). |
| T8.6 | **S/T** | `AUTH_SECRET` (the HS256 JWT signing/verification key, ADR-025) leaks or is weak/absent → forged bearer tokens (see T7.8) or a silently-disabled auth path | **Critical** | Low | `AUTH_SECRET` is env-only (never committed, `.env` gitignored) and read server-side only (`rbac.ts`); **absent `AUTH_SECRET` is fail-closed, not fail-open** — `resolvePrincipal` falls back to the dev-header path (itself gated by `AUTH_DEV_TRUST_HEADER=on`, else PUBLIC) rather than accepting an unverifiable bearer token. Also gates the demo minter (T7.9: `AUTH_SECRET` alone does not enable `POST /auth/dev-login` — `AUTH_DEV_LOGIN=on` is required too, and both are hard-off in prod/cloud). Rotation follows the general key-rotation runbook (§16.6); rotating `AUTH_SECRET` invalidates all outstanding tokens (short-lived, 1h default, bounds blast radius). |

---

## 9. TB7 — Audit-log integrity

*Asset (crown jewel #4):* `AUDIT_EVENT` stream / `AUDIT_LOG.md` — authoritative accountability record
(Art. VI: "AUDIT_LOG is authoritative"; Q6 footer; RESPONSIBLE_DATA §5/§6).

| # | STRIDE | Attack | Impact | L | Mitigation → mapping |
|---|---|---|---|---|---|
| T9.1 | **T** | Attacker/insider edits or deletes audit entries to hide a false-alert approval | High | Med | **Append-only** store; tamper-evidence via **hash-chained** entries (each row hashes prev) / WORM; periodic integrity check. **NIST AU-9 (Protection of Audit Info)**, **OWASP A09 (Logging/Monitoring Failures)**. |
| T9.2 | **R** | Missing entry for a state change → action unattributable | High | Med | **Every** state-changing action writes `AUDIT_EVENT(actor, action, target, time)` — contract-tested (Q6 footer; Art. XIII). No write path bypasses audit. |
| T9.3 | **I** | Audit log itself stores PII (free text, precise coords) | Med | Med | Audit records reference UUIDs + generalized fields only — **never** raw PII (Art. IV; §11). |
| T9.4 | **D** | Audit write failure silently drops events | Med | Low | Audit write in same transaction as state change (fail-closed: no audit ⇒ no commit); alert on audit-pipeline failure. |
| T9.5 | **E** | Unauthorized read of audit log | Med | Low | Read restricted to VERIFIER/EM (Q6); see T7.7. |

---

## 10. Input validation & anti-prompt-injection (ingested text + images) — OWASP LLM Top 10

> This section satisfies the PRD §11 / Art. V "input validation at all boundaries" requirement for the
> *AI ingestion* boundary specifically, and the Art. VI mandatory input-guardrails requirement.

### 10.1 Trust posture
**All ingested natural language (news, social, SOS free-text) and all images are UNTRUSTED DATA, never
instructions.** They are content to *analyze*, never commands to *obey*.

### 10.2 Controls (mapped to OWASP LLM Top 10 2025)

| Control | Defends | OWASP LLM | Constitution / EARS |
|---|---|---|---|
| **Structural separation** — ingested text passed as delimited data fields in a fixed template; system instructions never concatenated with raw user/source text | Prompt injection | **LLM01** | Art. XII |
| **No tools / no actions on the LLM** — model only emits a JSON narrative; it cannot fetch, write, alert, or task | Excessive agency, exfiltration | **LLM01/LLM06** | Art. XII/XIII |
| **Schema-bound output + validation** — response must match SitRep JSON-Schema with `citations[]`; on parse/contract/citation failure → **reject + deterministic fallback** | Injection result, hallucination | **LLM01/LLM09** | **U2, U3, UW3** |
| **Grounded-only generation** — model sees only pre-computed, pre-screened, cited facts; numbers come from the deterministic core | Hallucination, exfiltration | **LLM09/LLM02** | **U2, U3**, Art. XII |
| **Output egress constraints** — no free-form URLs / markdown image links in output (blocks data-beacon exfiltration) | Exfiltration | **LLM02** | Art. IV |
| **Input sanitation & size limits** — strip control/zero-width/bidi chars, normalize unicode, cap length/token budget | Hidden-instruction smuggling, DoW | **LLM01/LLM10** | Art. V, CLARIF Q10 |
| **Image pipeline** — consent + PII-screen + re-encode + size/type allow-list *before* vision model; vision is advisory/cited/confidence-scored only | Malicious/adversarial image, PII | **LLM01**, OWASP A05 | Art. XIV, OP1/Q11 |
| **PII never in context** — grounding context carries generalized fields only | Disclosure | **LLM06/LLM02** | Art. IV, ST3 |
| **Provider fallback incl. local** — Groq→OpenRouter→Ollama→deterministic-only | Compromised model, egress | **LLM03/LLM05** | Art. XVI, UW1/UW4 |
| **Misinformation flagging** — conflicting/low-authority signals flagged, not merged | Poisoned content | LLM-adjacent | Art. XI/XIV |

### 10.3 Detection
Heuristic injection-pattern screen on ingested text ("ignore previous", role-play, instruction verbs near
delimiters) → flag + lower confidence, never auto-act. Log injection attempts (content redacted) for
monitoring (OWASP A09).

---

## 11. PII handling (no retention · responder-only precise location · image PII screen)

> Satisfies PRD §11, **UW6**, **ST3**, CONSTITUTION **Art. IV & XIV**, RESPONSIBLE_DATA §3.

### 11.1 Data-minimization & retention

| Data | Policy | Mapping |
|---|---|---|
| Reporter contact (phone/email) | Active-incident follow-up **only**; **not retained beyond incident lifecycle**; never displayed publicly; **purged at incident close** | UW6, Art. IV/XIV |
| Precise personal location | **Responder-authenticated view only**; public view generalized (cell/area) | **ST3**, Q6 |
| Free-text report body | Scrubbed of incidental PII before storage; raw text **not retained after triage** | RESPONSIBLE_DATA §3, Art. IV |
| SOS image | Consent + PII-screen + metadata strip **before** storage; **only derived non-identifying classification persists** | Art. XIV, OP1 |
| Telecom (CAMARA) | Aggregate density/connectivity only — **no individual tracking**; demo-mocked | RESPONSIBLE_DATA §3 |

### 11.2 Cross-cutting PII rules
- **Never** log PII (Art. IV): logs carry `PUBLIC_REPORT` UUID, generalized cell, status, deterministic
  confidence components — *not* contact/coords/free-text.
- Encryption: **at rest AES-256, in transit TLS 1.3** (Art. IV; NFR §10). **NIST SC-8/SC-13/SC-28**.
- Right-to-deletion + explicit retention period (Art. IV); incident-close purge job.
- Consent recorded before collection (EV4); no secondary use / no profiling / no advertising
  (RESPONSIBLE_DATA §3).

### 11.3 Image PII-screen pipeline
`upload → consent check → type/size allow-list → strip EXIF/geotag → PII/face screen → re-encode →
vision classify (advisory) → persist ONLY derived classification`. The original identifying image is not
retained beyond the screen unless an active responder action requires it within the incident lifecycle.

---

## 12. Alert liability & Human-in-the-Loop (HITL)

> The single most safety-critical control set. CONSTITUTION **Art. XIII**; EARS **EV5, EV6, ST1, UW5**;
> CLARIF **Q5, Q6**.

1. **No unverified input acts on the world.** `PUBLIC_REPORT` is `UNVERIFIED` until a VERIFIER/EM
   approves; only `VERIFIED` may emit CAP or task a resource (Art. XIII; **EV5/ST1/UW5**).
2. **Threshold rules create DRAFT alerts only.** Promotion to outbound CAP requires human approval
   (EV6; CLARIF Q5 — *"no CAP is emitted until a VERIFIER approves"*).
3. **No live IPAWS origination.** BEACON *produces + validates* CAP v1.2 ready for IPAWS; a credentialed
   human authority disseminates (PRD §11/§12, CLARIF C6). This bounds BEACON's liability surface: it is a
   decision-support + draft tool, not an autonomous alerting authority.
4. **Deterministic + corroboration cross-check** before approval: geometry from the deterministic core,
   not the LLM (Art. XII); confidence components surfaced (Q4) so the human approves on evidence.
5. **Full attribution on approval:** approver, report id, evidence/provenance chain → `AUDIT_EVENT`
   (Art. XIII; §9) — defensible, auditable decisions (Art. VI manager-not-operator: Purpose/
   Transparency/Control).
6. **Fail toward safety, not silence:** an alert-path failure is surfaced loudly (T2.7) — a *suppressed*
   real alert is as dangerous as a false one.

---

## 13. TB9 — Multi-tenant / multi-region isolation

*Asset:* cross-region/cross-org data separation. Demo = CA (LIVE) + EU flood (CACHED) (U4/Q9).

| # | STRIDE | Attack | Impact | L | Mitigation → mapping |
|---|---|---|---|---|---|
| T13.1 | **E** | Cross-region/cross-org data access (one agency reads another's reports/resources) | High | Med | Region/org scoping on every query; SSE stream **keyed by region** (PRD §8); per-object authz (BOLA, T7.1). Region registry defines `{id, scope, bbox, enabled_adapters}` (Q9). |
| T13.2 | **I** | A region's PII/precise data bleeds into another region's view | High | Low | Tenant filter enforced in repository layer, deny-by-default; tested (Art. I). |
| T13.3 | **T** | Config of one region's adapters/thresholds affects another | Med | Low | EM-only config (Q6), scoped to `region_id`; `scope` field on threshold rules (CLARIF Q5). |
| T13.4 | **D** | One region's load/abuse starves another | Med | Low | Per-region debounce/backpressure on SSE (Q7); per-region rate limits. |

---

## 14. TB10 — Offline / local / air-gapped deployment

*Asset:* the local-first security posture (Art. XVI). Offline mode is also a *mitigation* (no egress) but
introduces its own threats.

| # | STRIDE | Attack | Impact | L | Mitigation → mapping |
|---|---|---|---|---|---|
| T14.1 | **I** | Local `.env` / DB / cached PII left unprotected on an operator laptop | High | Med | At-rest encryption (Art. IV); `.env` gitignored + filesystem perms; incident-close purge applies offline too (UW6). |
| T14.2 | **I** | Unexpected outbound egress in "air-gapped" mode (telemetry, cloud LLM) | High | Low | **No outbound egress** guarantee: local Ollama, cached layers, AI-off path (Art. XVI; **UW4**); egress-blocked acceptance test (mandatory test (a), CLARIF Q12). |
| T14.3 | **D** | Stale cache silently presented as fresh during offline op | Med | Med | Freshness label on every layer; stale/unavailable marked explicitly (**U1/U4**); never a silent stale map (RESPONSIBLE_DATA §6). |
| T14.4 | **S/E** | Local deployment ships with default/weak creds | Med | Med | Fail-fast config validation at boot (U5); no default secrets; first-run setup forces credential set. |
| T14.5 | **T** | Tampered local image/artifact (no integrity check offline) | Med | Low | Signed images / SBOM verification at install; identical artifacts cloud↔local (Art. XVI). |

---

## 14a. TB11 — AI Compliance Proxy (the mandatory LLM/Vision chokepoint)

*Asset:* decision/alert integrity, reporter PII, and the AI cost budget — defended **structurally** rather
than by per-adapter goodwill. The `AICompliancePort` reverse-proxy gateway (**ADR-017**) is the single
in-process chokepoint in front of every `LLMPort`/`VisionPort` call, running the fixed pipeline
`JWT/role-scope → circuit-breaker → semantic firewall (prompt-injection / instruction-override /
destructive-command / SSRF / secret-file-access) → policy-as-code (`config/policies.yml`) → PII
detect+redact → cost guardrails (ADR-018) → hash-chained append-only audit + OTel GenAI spans (ADR-022) →
upstream`. **Safety controls fail closed** (a control error short-circuits `403`); **availability degrades
gracefully** down the ADR-007/008 ladder (breaker-open → local/deterministic-only, never a dead-end —
Art. XVI). Provider adapters refuse any request not stamped by the gateway, so the chokepoint cannot be
bypassed.

| # | STRIDE | Attack | Impact | L | Mitigation → mapping |
|---|---|---|---|---|---|
| T11.1 | **T/E** | A code path reaches the LLM/Vision provider without screening/audit (per-adapter drift, bypass shim) | High | Med | Gateway is the **only** route to a provider; adapters reject un-stamped calls (structural, unbypassable). This is the chokepoint that binds the §10 anti-injection + §11 PII + §9 audit controls in one place. **OWASP LLM01/06; ASI01/02/03**. |
| T11.2 | **T** | Prompt-injection / instruction-override / SSRF / destructive-command rides ingested NL/image into the model | High | Med | Semantic firewall stage (regex + classifier pre-filter) + structural separation (§10.2); fail-closed; logged + confidence-lowered (defense-in-depth — structural controls stay authoritative). **LLM01/05; ASI01; AML.T0051**. |
| T11.3 | **I** | PII / secrets egress to a provider in the prompt context | **Critical** | Med | PII detect+redact stage **before** egress, fail-closed; no PII/secrets ever placed in context (Art. IV; §11; ST3). **LLM02/06; ASI06; AML.T0057**. |
| T11.4 | **E** | A caller invokes the model outside its role scope (e.g. PUBLIC drives a privileged synthesis) | Med | Med | JWT/role-scope stage, deny-by-default per `policies.yml roles` (TB6). **LLM06; ASI03/ASI09/ASI10; EU AI Act Art.14**. |
| T11.5 | **D/Cost** | Token-flood / recursive plan drives "denial of wallet" through the model | Med | Med | Cost-guardrail stage — 5 deterministic counters + pre-step reservation + degrade→escalate→terminate breaker (ADR-018); hard-block + HITL above threshold/cap. **LLM10; ASI04; AML.T0029** (Denial of ML Service; T0046 is "Spamming ML System with Chaff Data"). |
| T11.6 | **R** | An AI call escapes the audit/trace record (repudiation, no cost attribution) | High | Low | Audit stage writes a hash-chained `AUDIT_EVENT` (+ `cost_tokens_in/out`, `cost_usd`, `model_tier`, ADR-022) and trace-links firewall/breaker/reservation/HITL events; fail-closed (no audit ⇒ no upstream). **ASI08; EU AI Act Art.12**. |
| T11.7 | **T/D** | The gateway itself is the new single point of compromise/outage | High | Low | No secrets in the gateway; provenance-pinned; fail-closed for safety + breaker-degrade for availability; covered by fitness function **F16** (proxy-enforced). |

> **Cross-walk, not duplication.** The full control→standard matrix (C1–C33 mapped to OWASP LLM Top-10
> 2025 / ASI01–ASI10, NIST AI RMF, ISO/IEC 42001, EU AI Act, MITRE ATLAS) lives in
> **`COMPLIANCE_MATRIX.md`**; this TB11 names only the proxy-specific threats and that the gateway is the
> chokepoint binding the §9/§10/§11 controls. New AI-governance controls slot into existing boundaries
> there (TB5 → C1–C11/C16/C26/C28; TB6 → C2/C19–C21; TB7 → C23–C25/C27/C29; resource/budget → C12–C15).

### 14a.1 Tiered Autonomy (A / B / C) governance note

BEACON actions are governed by **three autonomy tiers**, enforced by the gateway (ADR-017) + RBAC (TB6) +
HITL (Art. XIII) + the budget posture (ADR-018). The tier is fixed by an action's **blast radius**, never
by convenience, and can never be silently demoted (NIST GOVERN; EU AI Act Art.14; OWASP **ASI10**
human-oversight-bypass):

- **Tier A — human-only:** the system never acts; a human originates (promote CAP to `ACTUAL` /
  disseminate; live IPAWS origination — out of scope; amend `CONSTITUTION.md`; change CI/CD).
- **Tier B — human-approval-before-execute:** the system proposes, a human approves before execution
  (approve an `UNVERIFIED` report → DRAFT CAP/EDXL or task a resource (F8); **any AI call whose reserved
  cost ≥ `escalation_threshold_usd` or that exceeds a per-incident/region/org cap** — ADR-018; adopting a
  SOTA/expensive model).
- **Tier C — autonomous within policy:** the system acts automatically inside `policies.yml`, fully
  audited (cited SitRep synthesis + NL triage within budget; threshold eval → **DRAFT** alert only;
  deterministic exposure/ranking/routing; ingestion + cache/mock fallback).

**Tier rules:** (1) **safety is fail-closed in every tier** — a PII-egress or prompt-injection control
failure blocks the action regardless of tier or budget; (2) the deterministic→AI→human handshake is never
collapsed — threshold fires are Tier C only up to DRAFT, promotion to outbound CAP is Tier B, dissemination
is Tier A; (3) **budget crossing escalates tier** — a Tier-C call that reserves ≥ the configured
threshold/cap is automatically held as Tier B (autonomy contracts as spend rises); (4) **every tier writes
an `AUDIT_EVENT`** (actor, action, target, time + cost fields) — no write path bypasses audit (TB7,
fail-closed). The full tier table + control mapping is in `COMPLIANCE_MATRIX.md §3`.

---

## 15. Residual risks & assumptions

- **Insider threat (malicious VERIFIER/EM)** — partially mitigated by tamper-evident audit (§9) + least
  privilege; *not* fully eliminated (single approver can approve a false alert). Mitigation: log makes it
  *detectable & attributable*; optional dual-approval for high-impact alerts is a documented future
  control.
- **Determined geolocation spoofer with multiple consented channels** — corroboration weighting lowers
  but cannot zero the risk; the HITL + deterministic cross-check is the backstop.
- **Zero-day in a pinned dependency** — npm audit catches *known* CVEs only; SBOM + 7-day patch SLA
  (Art. VII) bound exposure.
- **Assumptions:** TLS terminates at a trusted edge; GitHub Secrets / host secret store is trustworthy;
  the human authority operating the IPAWS dissemination step is themselves authorized.

---

## 16. Security checklist — S07 gate

> The S07 gate (Loki SDLC hard gate) MUST verify every item. Maps to CONSTITUTION Art. V "Security
> Checklist before every production release" + AGENTS §6 Quality Gates 1–7.

### 16.1 AuthN / AuthZ (TB6)
- [ ] RBAC matrix (CLARIF §B.Q6) enforced **server-side** on every route AND every object (BOLA/BFLA).
- [ ] Approve-CAP, configure-adapter/threshold/region = VERIFIER/EM (EM for config) only — tested.
- [ ] "own org" scoping on resource/shelter/EDXL-RM mutations.
- [ ] Short-lived tokens, session expiry, **MFA for EM/admin** ops.
- [ ] Deny-by-default; least privilege; precise-PII fields gated to RESPONDER+ (ST3).

### 16.2 PII / privacy (TB1, §11)
- [ ] No PII in logs/errors/analytics (UUID + generalized fields only) — contract-tested (UW6).
- [ ] Precise location/contact in responder-authenticated view only (ST3).
- [ ] Consent enforced before intake (EV4); incident-close purge job exists + tested.
- [ ] Free-text scrubbed; raw text not retained post-triage; image PII-screen + metadata strip + derived-only persistence.
- [ ] AES-256 at rest, TLS 1.3 in transit.

### 16.3 Alert / HITL integrity (TB2, §12)
- [ ] UNVERIFIED/TRIAGED cannot emit CAP/EDXL or task resources (ST1/UW5) — tested.
- [ ] Threshold fires = DRAFT only; human approval required to emit (EV6).
- [ ] No live IPAWS origination (produce+validate only).
- [ ] Every CAP/EDXL validated against JSON-Schema before send; XXE disabled.
- [ ] Alert carries `provenance[]`; approval writes `AUDIT_EVENT`.

### 16.4 LLM / ingestion (TB5, TB11, §10, §14a)
- [ ] Ingested text/images treated as data; structural separation; no LLM tools/actions.
- [ ] Output schema-validated with `citations[]`; reject → deterministic fallback (U3/UW3).
- [ ] **0 LLM-invented numbers** (Art. XII) — contract-tested.
- [ ] No PII/secrets in prompt context; output egress constrained (no free URLs/image beacons).
- [ ] Input sanitation (control/bidi/zero-width strip), size + token budget caps; injection-pattern screen logs attempts.
- [ ] Local Ollama / deterministic-only fallback works (UW1/UW4).
- [ ] **AI Compliance Proxy is the only route to a provider** (ADR-017, TB11): every LLM/Vision call traverses JWT→breaker→firewall→policy→PII→cost→audit; adapters reject un-stamped calls; safety stages **fail closed** — contract-tested (**F16**).
- [ ] **Cost guardrails** (ADR-018): 5 deterministic counters + pre-step reservation; **hard-block + human approval above `escalation_threshold_usd`/cap** (Tier B), soft within budget; safety never weakened to save cost (**F17**).
- [ ] Tiered Autonomy (A/B/C) enforced — blast-radius-fixed tier, no silent demotion; budget crossing escalates to Tier B (§14a.1; COMPLIANCE_MATRIX §3).
- [ ] Full control→standard cross-walk verified against `COMPLIANCE_MATRIX.md` (OWASP LLM/ASI, NIST AI RMF, EU AI Act, MITRE ATLAS).

### 16.5 Adapters / supply chain (TB4)
- [ ] Anti-corruption layer validates every feed; XML XXE/entity-expansion disabled; CSV sanitized.
- [ ] `npm audit --audit-level=high` — **no critical/high CVEs** (Gate 5); lockfile pinned + integrity hashes; SBOM produced.
- [ ] TLS + cert validation on all egress; bases via config (no hardcoded endpoints/keys).
- [ ] Circuit breaker + last-known-good cache + mock fallback per adapter (UW2).

### 16.6 Secrets (TB8)
- [ ] No secrets in code/git/images/logs; secret-scanning in CI; `.env` gitignored, `.env.example` documented.
- [ ] Least-privilege, per-env keys; rotation runbook; no secret in any client bundle/API envelope.

### 16.7 Audit & observability (TB7, TB11, Art. VI)
- [ ] Append-only, hash-chained (tamper-evident) audit log; read = VERIFIER/EM only.
- [ ] Every state change → `AUDIT_EVENT(actor, action, target, time)`; audit write fail-closed.
- [ ] OTel GenAI **5-level span hierarchy** (L0 execute→L1 plan→L2 discover→L3 execute→L4 retrieve) with `gen_ai.usage.*` + derived `cost.usd`; firewall/breaker/reservation/HITL events trace-linked (ADR-022).
- [ ] **Cost-extended `AUDIT_EVENT`** — every LLM/vision/adapter event carries `cost_tokens_in/out`, `cost_usd`, `model_tier` (deterministic math); **per-step cost attribution present** (**F19**).
- [ ] **Privacy sampling** — prompt/response content capture **off in prod** (token counts/model/cost/decision metadata only; no PII/raw text — §9.3); content capture is a dev-only opt-in.
- [ ] Verifier-agent (different model family) on critical outputs is advisory only — never overrides the deterministic engine or the human (ADR-022); OTLP export optional, Markdown/`AUDIT_EVENT` trail authoritative without it.

### 16.8 Isolation & deployment (TB9, TB10)
- [ ] Region/org scoping on all queries; SSE keyed by region; cross-region access tests pass.
- [ ] Air-gapped acceptance test: **no outbound egress** (UW4); freshness labels on every layer.
- [ ] Fail-fast config validation at boot (U5); no default/weak creds; signed artifacts/SBOM verified.

### 16.9 Standards traceability
- [ ] OWASP Top 10 2021 (A01/A03/A05/A06/A08/A09), API Security Top 10 2023 (API1/4/5/6), LLM Top 10 2025 (LLM01/02/03/06/09/10) — each addressed by ≥1 control above.
- [ ] NIST SP 800-53 (AC-3/4, AU-2/3/9/10, IA-2/5, SC-8/13/28, SR-3/11, CM-3) and AI RMF 1.0 mapped.
- [ ] Threat-model rows trace to a CONSTITUTION article and/or an EARS requirement (golden thread, Art. I).

---

*Threat model owner: `ops-security` persona. Phase S02. Living document — revisit at S07 gate and on any
new trust boundary (new adapter, new role, new external integration) per Art. V.*
*BEACON — IEEE Response Quest 2026, Phase 3 · GABBE Kit 1.1.0 · 2026-06-27*
