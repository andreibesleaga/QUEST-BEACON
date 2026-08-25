> **Historical decision record.** Kept in the public repo because source comments trace locked decisions to this file. Process references to agent memory (`agents/`, RESUME_POINTER, AUDIT_LOG) describe the internal GABBE SDLC tooling, which is not part of this repository.

# BEACON — Full Delivery Plan: "Deliver the Over-Claims" Program (2026-07-14)

> **✅ STATUS: FULLY IMPLEMENTED — HISTORICAL RECORD (archived here from the repo root 2026-07-18).**
> Every wave below was delivered and verified; the outcome is consolidated in `../../CHANGELOG.md`
> `[0.1.0]` and audited in `FINAL_LIVE_AUDIT.md`. The single pending plan of record now lives at the
> repo root: `IEEE/Quest/CURRENT-PLAN.md` (Localization — the last feature before the first tag).

*Approved-for-later-execution plan. Written at the Phase-C close; will be implemented in a future session.
Read together with `Phase3/agents/memory/RESUME_POINTER.md` (latest resume entry) and
`Phase3/docs/audit/FINAL_LIVE_AUDIT.md`. Every wave ends with ALL gates green; user commits (no auto-commit);
AGENTS.md + CONSTITUTION.md frozen.*

> **✅ PR #3 MERGED (2026-07-14, merge commit `a4828a5` on `main`).** The 4 Copilot review comments were
> fixed (commit `20baab2`): (1) `playwright.config.ts` `testIgnore`s `e2e/capture-screenshots.spec.ts` unless
> `CAPTURE_SCREENSHOTS=on`; (2) corrected the non-strict-EnvSchema comment in `src/config/index.ts`; (3) removed
> the no-op spread in `scripts/capture-playbook.ts`; (4) both dev-login 404 bodies → generic `'no such route'`
> (posture non-disclosure), with the 4 dev-login 404 tests strengthened first (TDD). Gate green:
> tsc 0 · eslint 0 · vitest **1061/2skip**. **`main` is the clean baseline for this program.** PR#2 (Phase-B)
> also merged. All Phase-C honesty/security/test/docs work (resume-12) is on `main`.

---

## Context

BEACON is built, live-verified, and merged (S00→S09 + Phase-B go-live: live source adapters, durable
Postgres, real JWT, cloud-AI narration proven on OpenRouter; gates green: tsc 0 · eslint 0 · vitest 1061 ·
depcruise 303/0). The Phase-C 6-lens adversarial audit found the remaining gap is **claims vs. build**:
several Phase-2-promised capabilities exist only as ports/toggles/docs (news+social fusion, misinformation
flagging, outage/cell/weather map layers, ORS routing, Overpass infrastructure, WorldPop population, vision,
CAMARA), and a tail of audit debt (OpenAPI drift, THREAT_MODEL rows, ADR footers, tests/coverage floor).
So far these were *honestly scoped down* in docs. **The user's directive reverses that: implement them
all for real, end-to-end** — plus a **working Telegram bot** (real Bot API: broadcast approved alerts,
inbound commands) and **every real API in the verified catalog implemented + config-gated** (free keys,
registered/gated, paid — each works "when the client pays/registers" via the existing `SOURCE_*_MODE` +
`keyEnv` fail-fast pattern). Every wave must end with all gates green; nothing weakens the constitution
(deterministic→AI→human, HITL, provenance/citations, offline-first redundancy, free/open data, no auto-commit).

## Verified seam map (explored 2026-07-14 — reuse these, don't reinvent)

**Adapter pattern (replicate exactly):** 3 files per source — `src/adapters/sources/<id>/{<id>-acl.ts,
<id>-adapter.ts,__fixtures__/<sample>}`; class implements `SourceAdapterPort<T>` + the outward domain port;
3-method plug (`mapper`/`fetchLive` via `httpGetText`/`loadMockRaw`) into `engine.run(...)`; factory
`make<X>Adapter(engine, env)` using `resolveSourceConfig({prefix, keyEnv?, requireKeyForLive?})`.
Registration = 3 edits, zero core change: `src/main/adapter-registry.ts:31 ADAPTER_FACTORIES` + one
`config/adapters.json` row + the files. Manifest schema: `mode` enum LIVE|CACHED|MOCK; `port` is a free
string (NewsIntel/Infrastructure/Population/Outage/Telecom all legal); `additionalProperties:false`.
Test pattern: copy `firms-adapter.test.ts` (FakeCache + RedundancyEngine, mode-switch MOCK/CACHED/LIVE,
live-down-degrades, Sourced envelope, health, factory fail-fast) + `<id>-acl.test.ts`.

**Ports with ZERO implementations today** (`src/ports/infrastructure-sources.ts`): `InfrastructurePort.fetchNodes`
(:30), `OutagePort.fetchOutages` (:35), `TelecomPort.fetchCoverage` (:40), `PopulationPort.estimatePopulation`
(:45). `NewsIntelPort` (`src/ports/intel.ts:20`) has one impl (meteoalarm-ro). `NewsItem` (`intel.ts:13`) has
NO credibility fields — the ONE domain-port change needed (additive optional `credibility?`/`sourceAuthority?`).

**Live-composition seam:** `src/main/live-seed.ts` — `enrichCaIncident` (:125), `enrichRoIncident` (:135),
`enrichCaMap` (:185), `enrichRoMap` (:193) currently keep `infrastructure`/`exposedPopulation` seeded;
`fetchSlice<T>(registry, id, region)` + `collectProvenance` are the plug points. News today is provenance-only —
a **news→GroundedFact bridge** (deterministic claims minted BEFORE the LLM, Art. XII) into `SitRepFacts`
(`sitrep-synthesis.ts:16-28`) is new work.

**Map layers:** outage/cell deck.gl builders + toggles ALREADY EXIST and are correct
(`app/_components/map/build-layers.ts:139-169`, `LayerTogglePanel`, palette) — they receive `undefined`.
Missing: server slice (`MapProjection` `src/application/map-projection/map-projection.ts:82-93` has no
outage/cell/weather) → wire type (`app/_lib/types.ts:276-287 MapProjectionData`) → client mapper
(`app/_lib/map-data.ts` `assembleLayers`:131 + `presentLayers`:117). `InfraNodeType` has POWER+CELL;
CA seeds 2 POWER (1 OFFLINE, 1 AT_RISK), NO CELL nodes seeded; `OutageArea.polygon` required (POWER nodes are
points → seed small AOI polygons or derive buffers). Weather is not a layer at all (wind exists as SitRep
fact `derive-cop.ts:146-149,240-247`) — needs LAYER_IDS + LAYER_META + palette + builder + slice.
Per-layer freshness: `map-data.ts:109-114` stamps ONE shared value; `hooks.ts:117` discards `env.provenance[]`
— pure mapper change (layer→sourceId map, per-`SourceRef.fetchedAt`).

**Telegram:** outbound seam = `LiveStubTransport.send` (`src/adapters/channels/messaging/messaging-port.ts:42`,
deliberately stubbed; factory `makeTelegramMessaging`:61 picks Live vs Recorded on `CHANNEL_TELEGRAM_MODE=live`
+ `TELEGRAM_BOT_TOKEN`). Broadcast hook = `handleAlertApprove` (`src/adapters/channels/http/routes/interop.ts:120`,
after `sink.emit` at :138) → thread a `NotificationPort` (`makeNotifier` `notification.ts:74` already does
PII-redact + firewall + hash-chained audit around a `MessagingPort`) into `InteropDeps` (:51) +
`feature-seed.ts:153`. NO subscriber registry exists (add chat-id list). Inbound = NO webhook route exists;
new `app/api/v1/channels/telegram/webhook/route.ts` verifying Telegram's `X-Telegram-Bot-Api-Secret-Token`
(`TELEGRAM_WEBHOOK_SECRET` documented but unused) → map update JSON → `InboundMessage` → `handleInbound`
(`handle-inbound.ts:58`; trust pipeline `trust.ts:105` HMAC/allow-list/replay/rate/firewall). Webhook needs
public HTTPS → also a `getUpdates` long-polling dev runner for localhost demos. HITL invariant: broadcast
ONLY as downstream side-effect of an approved ACTUAL (`EmittableAlert` type-gate).

**ORS routing:** NOT a SourceAdapter — feature adapter `src/adapters/routing/ors-routing.ts` implementing
`RoutingPort` (`src/ports/logistics.ts:24`; POST `/v2/directions`, avoid-polygons from hazard footprint;
`keyEnv:'ORS_API_KEY'`). `FEATURE_ROUTING` is in `.env.example` but NOT in EnvSchema and unread —
add + ladder-select in `feature-seed.ts:142` (ORS→heuristic; `planEvacRoute` `evac-routing.ts:32` already
degrades on `!ok`).

**Vision:** `makeVisionAdapter` (`src/adapters/ai/vision/vision-adapter.ts:67`) exists, consent+seal-gated,
composed NOWHERE. Wire mirror of `build-ai.ts` seal handshake into the verify flow; `FEATURE_VISION` gate;
advisory only (feeds human decision, never auto-alerts).

**Misinformation/credibility (deterministic):** ready-made home `PublicReport.confidenceComponents`
(`src/domain/public-report.ts:16` — geocode/authority/classifier/corroboration, "never LLM-produced");
`TRIAGED→REJECTED` transition exists. UI gap: `verifier-queue.tsx:48-58` shows only text+badge — add
confidence/components display + misinfo-reject affordance; extend `ReportSummary` + `mappers.ts`.

**Verified catalog (audit/DATA_SOURCE_VERIFICATION.md) for the new adapters:** GDELT keyless LIVE (429
backoff; authority-rank) · ReliefWeb v2 LIVE (registered `RELIEFWEB_APPNAME` since 2025-11) · Overpass
LIVE→CACHED (ODbL attribution, rate-limited→cache) · ORS free-key LIVE · WorldPop CACHED (CC BY 4.0) ·
NFHL CACHED (ArcGIS REST, confirmed live) · EAGLE-I CACHED (historical + derive "assumed-offline" via
hazard∩infra) · OpenCellID CACHED (free key, CC BY-SA) · CAMARA MOCK-only (operator-gated) · Census CACHED
(free key). Paid/gated = config-gated live: `SOURCE_<X>_MODE` + `keyEnv` fail-fast (works when the client
registers/pays; MOCK/CACHED fixture otherwise — never a dead-end).

## Locked decisions (user, 2026-07-14)
- **NFHL = prediction-input + a VISIBLE flood-zone map layer** (strongest on-camera Comprehensiveness).
- **Cadence = run all waves through continuously** (pause only when blocked on user input/keys or session
  limits); user reviews + commits at the end; RESUME_POINTER checkpointed per wave regardless.
- **Architecture ruling:** new sources are generic `SourceAdapterPort<T>` with entity types
  `InfrastructureNode`/`OutageRecord`/`TelecomCoverage`/`PopulationEstimate` (the proven registry →
  `fetchSlice<T>` → live-seed pipeline); the specialized ports in `infrastructure-sources.ts` get a note
  that they are satisfied via the manifest pattern — no dead second consumption path.
- Weather layer = wind vector/glyph at the observation point from the deterministic `WeatherFactInput`
  (never synthesized grids). EAGLE-I outage = "ASSUMED offline" label (inference, honest timestamps).
  Telegram polling and webhook are mutually exclusive (Bot API): poller is an env-gated script; webhook
  registration is an explicit operator action, never boot-time.

## Wave plan (every wave ends with ALL gates green: tsc · eslint · vitest · depcruise · next build; W3+ Playwright)

### W0 — Contracts & flags (sequential, ONE owner; all additive → trivially green) ~8 files
1. `src/ports/intel.ts` — `NewsItem` + optional `credibility?`/`sourceAuthority?` (the one domain-port change).
2. `src/config/index.ts` — `FEATURE_ROUTING` (`heuristic|ors`, default heuristic) + refine `ors`⇒`ORS_API_KEY`;
   `TELEGRAM_WEBHOOK_SECRET` optional; refine `CHANNEL_TELEGRAM_MODE=live`⇒token.
3. `app/_lib/types.ts` + `app/_lib/store.ts` — extend `LAYER_IDS` with **`weather` + `floodzone`**; new
   toggles default **OFF** (visual-snapshot protection). Wire-type extensions on `MapProjectionData`
   (`outage?`, `cell?`, `weather?`, `floodzone?` + optional per-layer `sourceId` for freshness).
4. Types-only extensions: `MapDerivationInput` (+`outages?`, `cellSites?`, `floodZones?`, weather passthrough)
   in `derive-cop.ts`; `ProjectedOutage/ProjectedCell/ProjectedWeather/ProjectedFloodZone` on
   `MapSource`/`MapProjection` in `map-projection.ts`.

### W1 — FOURTEEN source adapters: the full portal-named catalog (parallel lanes + 1 integrator) ~75 files
Each lane owns ONE new dir `src/adapters/sources/<id>/` (acl + adapter + `__fixtures__` recorded-real
fixture + acl.test + adapter.test — clone `firms/`; tests inject their manifest row so each lane is green
in isolation & resumable). Lenient ACLs (unknown fields ignored, malformed rows dropped+counted).

| id | port/entity | mode default | key/gate (config-gated: live "when client pays/registers") | portal claim it satisfies |
|---|---|---|---|---|
| `gdelt` | NewsIntel/NewsItem (+authority-rank → credibility) | LIVE (keyless) | 429 backoff | "GDELT global news-event stream" (novel) |
| `reliefweb` | NewsIntel/NewsItem | CACHED→LIVE | `RELIEFWEB_APPNAME` (registered) | "authoritative news (ReliefWeb…)" |
| `agency-rss` | NewsIntel/NewsItem — configurable verified-feed list | **LIVE** (keyless) | `AGENCYRSS_FEEDS`/`_RO` (env exists) | "InciWeb, agency RSS" — one adapter, N feeds (incl. InciWeb feed) |
| `bluesky` | NewsIntel/NewsItem — **vetted-social**, corroboration-only, never auto-trusted (Art. XIV) | MOCK (LIVE-capable, keyless public API) | none | "vetted social" — the ToS-allowed social channel (X/Twitter excluded) |
| `nifc` | HazardSource/HazardGeometry — official fire **perimeters** | CACHED | none (ArcGIS REST) | "NIFC perimeters" (FIRMS≠perimeters limitation closed) |
| `effis` | HazardSource/HazardGeometry — EU fire (RO/global equivalent) | CACHED | none (keyless WMS/REST) | "EFFIS perimeters"; non-US coverage |
| `osm-overpass` | Infrastructure/InfrastructureNode | CACHED (LIVE-capable) | none; ODbL attribution, long TTL | "critical infrastructure (OSM Overpass)" — golden-path core |
| `worldpop` | Population/PopulationEstimate | CACHED | none (CC BY 4.0) | "population (WorldPop…)" |
| `census` | Population/PopulationEstimate — US demographics | CACHED | free key (`CENSUS_API_KEY`) | "…Census" |
| `nfhl` | FloodZone polygons | CACHED | none (ArcGIS REST) | "FEMA NFHL zones"; crest×NFHL prediction |
| `eagle-i` | Outage/OutageRecord (historical + assumed-offline derive) | CACHED | none | "DOE EAGLE-I power outages" (novel) |
| `opencellid` | CellCoverage | CACHED | `OPENCELLID_API_KEY` (free) | "cell coverage (OpenCelliD)" |
| `itu` | Connectivity signal | **MOCK-only** | gated data | "ITU connectivity" |
| `camara-gsma` | Telecom/TelecomCoverage | **MOCK-only** | operator-gated (fixtures exist at `fixtures/camara-gsma`) | "CAMARA/GSMA Open Gateway" (novel) |

**Integrator (single owner, last):** `src/main/adapter-registry.ts` +14 factories; `config/adapters.json`
+14 rows; `adapter-registry.test.ts`; `.env.example` + `docs/architecture/CONFIGURATION.md`; update
`config/planned-sources.md` (all implemented → empty/roadmap-note) + NOTICE wired-list. Green because
nothing consumes the new ids yet. (News lanes wait on W0 NewsItem fields; the rest start immediately.)
Sentinel-2 burn-area NBR is NOT a source adapter — it lands in W4c as the vision `burn-area` task
(consented imagery fixture → advisory VisionFinding), per the existing VisionRequest task enum.

### W2 — Backend consumption (4 parallel lanes, disjoint) ~18 files
- **2a `src/main/live-seed.ts` + `map-seed.ts` + `scenario-inputs.ts` (one owner):** extend the 4 enrich
  fns with `fetchSlice` calls for the new ids (AND consume the already-built `nws` + `gdacs` — closes the
  built-not-consumed audit finding); replace seeded `infrastructure`/`exposedPopulation` when served
  (retain as fallback — Art. XVI); eagle-i → `outageNodeIds` assumed-offline; populate
  `outages`/`cellSites`/`floodZones`; seed CA CELL nodes + outage AOI polygons so the OFFLINE default also
  shows the new layers; provenance via `collectProvenance` (per-sourceId).
- **2b derivation/projection (one owner):** `derive-cop.ts` logic for outage/cell/weather/floodzone slices +
  WorldPop-blended exposure; `map-projection.ts` projecting them; NFHL∩crest into `prediction-projection`
  (makes the PRD flagship-3 claim TRUE). Heavy tests (99% floor applies).
- **2c news/social→SitRep bridge + misinformation (one owner):** NEW
  `src/application/sitrep-synthesis/news-grounding.ts` — NewsItem[] (gdelt + reliefweb + agency-rss +
  bluesky vetted-social + meteoalarm) → deterministic `GroundedFact[]` minted BEFORE the LLM (Art. XII):
  authority-ranked, corroboration-counted ("3 authoritative sources report…"), conflicting/low-authority
  signals **flagged not merged** (the portal's misinformation claim, deterministic); credibility blend →
  `PublicReport.confidenceComponents`; integrate into `sitrep-synthesis.ts` so the AI narration now fuses
  **authoritative news + vetted social + geospatial risk** — the portal's headline differentiator — with the
  LLM narrating the cited facts (info-summaries), never inventing; `verifier-queue.tsx` shows confidence +
  components + misinfo-reject (→ existing REJECTED transition). Makes flagship-2 TRUE end-to-end.
- **2d logistics decision-support completeness (one owner, small):** verify/close the flagship-4 portal
  claims on the built logistics: registry+tasking+capacity-vs-demand exist (memory-logistics + board +
  EDXL-RM round-trip 🟢); ADD the missing **pre-positioning-from-predictions** deterministic use-case
  (resources/shelters ranked near the projected extent from `prediction-projection`, surfaced as engine
  suggestions on the logistics board — human decides, Art. XII) + real-time reallocation surfaced from the
  existing tasking lifecycle; "info exchange": EDXL-RM/EDXL-SitRep/CAP round-trips already live, W4b adds the
  Telegram channel; AI info-summaries = the SitRep digest already rendered per-channel (`renderDigest`).

### W3 — Frontend map end-to-end (2 lanes + e2e closer) ~12 files + snapshots
- **3a `app/_lib` (one owner):** `map-data.ts` mappers for outage/cell/weather/floodzone; per-layer
  freshness (`freshnessFor` → per-sourceId stamps; retain `env.provenance[]` in `hooks.ts:117`; fall back
  to shared stamp when absent — old behavior = degraded rung); `mappers.contract.test.ts`.
- **3b `app/_components/map` (one owner):** weather + floodzone builders in `build-layers.ts`
  (outage/cell builders exist); `LAYER_META` labels+caveats ("ASSUMED offline", ODbL/CC attributions);
  palette; tooltips; tests.
- **3c Playwright closer (one owner, last):** layer smoke specs (toggle-on assertions) + regenerate visual
  snapshots ONCE (new toggles default-off minimizes churn).

### W4 — Feature adapters: ORS · Telegram · Vision (3 lanes; 4a→4b handoff on feature-seed.ts) ~18 files
- **4a ORS routing (owns `feature-seed.ts` FIRST):** `src/adapters/routing/ors-routing.ts` implements
  `RoutingPort` — POST `api.openrouteservice.org/v2/directions` with avoid-polygons from the hazard
  footprint → `makeEvacRoute`; typed-Result degrade; fixture tests. Ladder select in `buildFeatureDeps`
  by `FEATURE_ROUTING` (ORS-down → hazard-avoiding heuristic, never a raw straight line).
- **4b Telegram (owns messaging dir + `interop.ts` + new route + poller; takes feature-seed AFTER 4a):**
  real Bot API `sendMessage` in `LiveStubTransport` (injected fetch, fixture-tested); subscriber/chat-id
  registry (env-seeded `TELEGRAM_ALERT_CHAT_IDS` + durable option); thread `NotificationPort`
  (`makeNotifier` = PII-redact+firewall+audit, type-prevents raw transport) into `InteropDeps`; broadcast in
  `handleAlertApprove` strictly AFTER `sink.emit` succeeds on `EmittableAlert` (HITL) — broadcast failure
  audited-not-fatal (never 5xx the approval); inbound `app/api/v1/channels/telegram/webhook/route.ts`
  verifying `X-Telegram-Bot-Api-Secret-Token` → update JSON → `InboundMessage` → `handleInbound` (existing
  trust pipeline); 200-on-verified-but-unparseable (Telegram retry semantics); `scripts/telegram-poll.ts`
  getUpdates dev runner (localhost demo; env-gated, never in the request path). Docs: bot setup (BotFather →
  token → chat id → optional setWebhook) in the E2E playbook.
- **4c Vision (owns `build-ai.ts` + verify touchpoints):** compose `makeVisionAdapter(providers, seal,
  FEATURE_VISION)` mirroring the build-ai seal handshake; advisory `VisionFinding` (incl. Sentinel-2
  burn-area NBR + damage-severity tasks on consented imagery fixtures) surfaces in the verify flow
  (consent+PII-screen gated); MockVision default; never auto-alerts.

### W5 — Audit debt + docs truth-up + hardening (parallel doc/test lanes; coverage floor LAST) ~15 files
- `docs/api/openapi.yaml`: add served `GET /status` + `POST /auth/dev-login` (+ new telegram webhook route);
  `x-status: planned` on the 6 unserved paths. THREAT_MODEL rows (AUTH_SECRET TB8, JWT verify, dev-login
  minter, Telegram webhook/broadcast, new egress hosts). ~20 stale ADR footers → "Implementation complete:
  Yes (Phase-B/C)"; ADR-023 addendum (Telegram live transport now REAL); new ADR-026 (Telegram alert
  broadcast + subscriber registry) if warranted.
- **Claims flip TRUE** (only now, when real): PRD flagship-2 (news fusion + misinfo flag) + flagship-3 (ORS
  routing); README/SUMMARY/DEMO_SCRIPT updated from
  "roadmap/not wired" → demonstrated (with the new on-camera moments); DATA_SOURCE_VERIFICATION
  wired-column flips; E2E_TESTING_PLAYBOOK new sections (Telegram bot setup, new keys: RELIEFWEB_APPNAME,
  OPENCELLID_API_KEY, ORS_API_KEY, CENSUS_API_KEY; new run-matrix rows); LIVE_VERIFICATION appends new live evidence.
- Tests: `resolveStore`-postgres (mocked `makeDb`); `createHttpDepsLive` integration; AI-on==AI-off
  numeric-equality; then **`vitest.config.ts` second coverage floor** over `src/main`+`src/adapters`
  (measured-minus-margin) — LAST, after all code exists.

## Portal-entry (#5320) 100% coverage matrix — every Phase-2 claim → satisfied + exceeded
*(Jury 4.48/5 · T 4.2 · C 4.7 · I 4.5 · U 4.3 · S 4.7 — the program targets exceeding every category.)*

| Portal claim (verbatim intent) | Today | This program → exceeded by |
|---|---|---|
| COP layers: fire+perimeters, flood gauges+forecasts, weather+alerts, infrastructure, **power outages, cell coverage** | fire/flood/infra live; outage/cell toggles empty; no weather layer | W1 nifc/effis/eagle-i/opencellid + W2/W3: ALL named layers rendered with per-layer freshness (T 4.2→) |
| "authoritative news (ReliefWeb, GDACS, InciWeb, agency RSS)" | GDACS wired (not consumed), rest absent | W1 reliefweb+agency-rss(+InciWeb feed)+gdelt; W2a consumes GDACS+NWS too (closes the built-not-consumed audit finding) |
| "**vetted social** … fused … misinformation flagged, never auto-trusted" | absent | W1 bluesky (corroboration-only) + W2c deterministic flag-not-merge + verifier confidence UI (I 4.5→) |
| "AI fusion → ranked, **cited** situational report + escalation trend + threshold alerts" | cited geospatial SitRep live (incl. real LLM) | W2c adds the news/social fusion half — the differentiator complete |
| SOS → AI geocode/triage/confidence → human verify → CAP | live | W2c confidence-components UI + W4c advisory vision assist (Sentinel-2 NBR/damage tasks) |
| "hazard-avoidance evacuation routes" | heuristic (labeled) | W4a real ORS road routing + ladder (S 4.7 protected honestly) |
| Logistics: registry, tasking, capacity-vs-demand, **pre-positioning from predictions**, real-time reallocation, EDXL-RM/SitRep/CAP | all live except pre-positioning | W2d pre-positioning engine suggestions |
| Population (WorldPop, Census) · NFHL zones · ITU · CAMARA · Sentinel-2 NBR · GDELT · EAGLE-I (the "novel sources") | absent/mock | W1 adapters (each config-gated) + W4c vision NBR → ALL portal-named sources have a working implementation (C 4.7→) |
| Push not poll (SSE), per-layer freshness, degrade-not-break, works beyond US | live (SSE, ladder, RO) | W3a per-layer freshness completes the claim; RO gains effis/glofas/meteoalarm+news |
| Crisis-first UX, WCAG (2.1→2.2 AA), dark ops, offline field | live + browser-gated | W3 new layers keep axe/visual gates green (U 4.3→) |
| Responsible: provenance, consent, no-PII, HITL, no ToS scraping, audited | live (structural) | unchanged-strong; Telegram broadcast inherits notifier PII-redaction+audit |
| Two-engine decision support; AI-off still ranks | live + proven | AI-on==AI-off numeric-equality test (W5) makes it a filmed, tested claim |

## All-findings register (from the 6-lens Phase-C audit + earlier) — every item dispositioned
**🔴 Critical/High:** NWS+GDACS built-not-consumed → W2a consumes both (was doc-corrected, now made TRUE) ·
news/social fusion absent → W2c · misinformation-flag absent → W2c · outage/cell/weather layers unserved →
W1+W2+W3 · "22 sources implemented" false claim → W1 makes ~all true, W5 flips docs · GloFAS/NWS manifest
mislabels → FIXED · PII reversible token → FIXED · dev-login escalation → FIXED (opt-in + cloud-hard-off) ·
Phase-B seam 0% coverage → core FIXED, remainder W5 · docs "paused/spec-only" → FIXED.
**🟡 Medium:** OpenAPI bidirectional drift → W5 · THREAT_MODEL missing auth/live rows → W5 · stale ADR
footers/ADR-023 addendum → W5 · durable-Postgres dormant in compose → FIXED · AI never run live → FIXED
(OpenRouter) · ORS routing heuristic-only → W4a · vision unwired → W4c · CAMARA port-only → W1 ·
per-layer freshness shared-stamp → W3a · PUBLIC shared rate-bucket → documented (edge-layer roadmap) ·
dead RepositoryPort scaffolding → W5 decision (delete or test) · manifest port/entity not boot-validated →
W1 integrator adds the assertion · NOTICE/DSV wired-labelling → FIXED + W5 column · usgs OGC-partial →
documented (query migration = roadmap note) · prettier drift + SHA-pin CI + husky install → W5 ops notes.
**🟢 Informational:** redirect:manual → FIXED · EnvSchema flags + AI_MODE default → FIXED · seed-vs-manifest
fixture path decorative → W1 integrator aligns · `me` route sub → done · AGENTS.md stale "PAUSED at S04"
line → FROZEN, user's edit. · PR#3 Copilot ×4 → apply first (header note above).

## Dependency graph
W0→{W1 news lanes, W4a, W4b, W2b} · W1(integrator)→W2a · W1 eagle-i→W2a→W2b · W1 nfhl→W2b→W5 flagship-3 flip ·
W2a provenance→W3a freshness · W2b→W3a→W3b→W3c · W2+W4a→W5 claim flips · all code→W5 coverage floor ·
W4a feature-seed→W4b feature-seed (only intra-wave handoff) · W4c independent (Sentinel-2 NBR = vision task).
**Single-owner files (never two lanes):** intel.ts, config/index.ts (W0); adapter-registry.ts+adapters.json
(W1 int.); live-seed.ts+map-seed.ts (W2a); derive-cop.ts (types W0/logic W2b); sitrep-synthesis.ts (W2c);
app/_lib/{types,map-data,hooks}.ts (W0 types/W3a logic); feature-seed.ts (W4a→4b); interop.ts (W4b);
build-ai.ts (W4c); vitest.config.ts (W5 last).

## Top risks + mitigations
1. Per-layer freshness wire change → additive optional `sourceId`, shared-stamp fallback = degraded rung.
2. Visual-snapshot churn → new layers default-off; ONE regeneration at W3 close.
3. Telegram HITL/security → notifier-only injection (type-safe), post-emit side-effect, secret-token verify,
   audited-not-fatal broadcast, poller/webhook mutual exclusion.
4. Fixture-vs-reality drift on new LIVE sources → recorded real fixtures, lenient ACLs, breaker+CACHED rung
   free via RedundancyEngine; optional manual live-smoke script outside vitest.
5. 99% application-layer floor makes W2b/2c test-heavy → small pure functions, ~50% lane budget on tests.
6. Session-death resumability → W1 lanes green-in-isolation; cross-file steps are one-file/one-owner and
   re-derivable from this plan; RESUME_POINTER checkpoint per wave.

## User-supplied prerequisites (config-gated: everything works MOCK/CACHED without them)
- **Telegram:** create bot via @BotFather → `TELEGRAM_BOT_TOKEN`; target chat id(s) → `TELEGRAM_ALERT_CHAT_IDS`;
  optional `TELEGRAM_WEBHOOK_SECRET` + public HTTPS URL for webhook mode (long-polling works on localhost).
- Free keys when desired live: `RELIEFWEB_APPNAME` (registered), `OPENCELLID_API_KEY`, `ORS_API_KEY`,
  `CENSUS_API_KEY` (+ existing `FIRMS_MAP_KEY`, `GLOFAS_CDS_KEY`). OpenRouter key already in `.env`.
  Everything runs MOCK/CACHED without any of them — keys only flip rungs to LIVE (fail-fast if LIVE w/o key).

## Verification (per wave + final)
- Every wave: `tsc --noEmit` 0 · `eslint .` 0 · `vitest run` green (coverage floors) · `depcruise` 0 ·
  `next build` ✅; W3+: `rm -rf .next && playwright test` (golden path US+RO, axe, TTTP, visual).
- Live proofs (captured into LIVE_VERIFICATION/playbook): `npm run live:probe` shows new sources' provenance
  modes; gdelt LIVE fetch (keyless egress works on this box); Telegram outbound real `sendMessage` to the
  user's chat on a DRAFT→ACTUAL approval (with token); ORS live route when `ORS_API_KEY` set; COP screenshots
  regenerated showing outage/cell/weather/floodzone layers; SitRep showing a cited news-derived field;
  verifier queue showing confidence components + misinfo-reject.
- Final: re-run `capture:playbook` + screenshot capture; update FINAL_LIVE_AUDIT (findings → now-resolved);
  full-suite + browser gates green; user commits.

---

# GABBE operating framework & full continuation context (READ before executing)

BEACON is run through **GABBE** — a governed, agentic SDLC kit that lives in the repo at `Phase3/agents/`.
A fresh agent MUST operate inside it. All paths below are relative to `Phase3/` unless noted.

## Resume order (do these first, every session)
1. `agents/memory/RESUME_POINTER.md` — the **lifeline**: latest entry = **resume-13** (current task + exact
   NEXT ACTION). Read the top entry first.
2. This file (`../PHASE3-FULL-DELIVERY-PLAN.md`) — the program to execute.
3. `agents/AGENTS.md` — the single source of truth for all AI agents (also symlinked to
   `.claude/CLAUDE.md`/`.cursorrules`/etc.). **FROZEN** — respect, don't edit; ask if a change is needed.
4. `agents/CONSTITUTION.md` — project law (Articles I–XVI). **FROZEN.**
5. `agents/memory/CONTINUITY.md` (past failures/lessons) + `agents/memory/PROJECT_STATE.md` +
   `agents/memory/AUDIT_LOG.md` + `agents/memory/SDLC_TRACKER.md`.
6. `docs/ENGINEERING_PRINCIPLES.md` (Definition of Done — load every phase) + `docs/LIBRARIES.md` (pinned free libs).

## GABBE kit map (reuse; don't reinvent)
- **Capabilities are indexed** — consult before choosing generically: `agents/skills/00-index.md`,
  `agents/guides/00-index.md`, `agents/templates/00-index.md`, `agents/personas/00-index.md` (read a skill's
  full file before use). Personas (Loki) frame the parallel subagents (e.g. `eng-backend`, `prod-tech-lead`,
  `ops-security`, `prod-architect`, `prod-pm`).
- **Memory subsystem** (`agents/memory/`, gitignored — persists on disk, resumes losslessly): RESUME_POINTER
  (lifeline), PROJECT_STATE (SDLC phase), CONTINUITY (lessons), AUDIT_LOG (decision trail), SDLC_TRACKER,
  `episodic/` snapshots. **State-preserve continuously** — refresh RESUME_POINTER + append AUDIT_LOG after every
  meaningful step; assume a cutoff at any moment (the session-limit deaths this project already hit).
- **Loki mode** (`agents/skills/brain/loki-mode.skill.md`) = the deterministic SDLC (S00→S13) with HITL hard
  gates; **Brain mode** (`brain/brain-mode.skill.md`) = the strategist/router that wraps Loki. The `gabbe` CLI
  is OPTIONAL — operate in pure-markdown inference (this project always has).

## Operating spine (AGENTS.md §5/§13 — every task)
**preflight → clarify → plan → test-first (TDD) → implement → verify (all gates) → refactor → log & state-preserve.**
- **Spec-driven, golden thread:** requirement → spec → test → code → audit. No requirement without a test.
- **Observability + HITL:** trace decisions/cost; the human delegates → observes → intervenes; pause & ask on
  ambiguity, security trade-offs, architecture changes, expensive/irreversible actions.
- **Cost discipline:** minimize tokens; parallel subagents for disjoint work but single-owner shared files;
  don't over-spawn beyond what you can integrate.

## Non-negotiable invariants (Constitution Art. XI–XVI / AGENTS.md §14) — this program must keep ALL
- **Deterministic → AI → human (Art. XII):** the LLM NEVER emits a number/ranking/distance/exposure — those
  come from deterministic code (Turf/SQL); the LLM narrates cited facts only. AI-off must still rank (proven).
- **Provenance + citations structural:** every datum → SOURCE_RECORD; every SitRep field → citations[]; every
  API response → provenance[] + freshness. An ungrounded build fails the contract test.
- **HITL before public action (Art. XIII):** no UNVERIFIED report emits CAP/EDXL or tasks a resource; threshold
  fires create DRAFT only; VERIFIER/EM approves. (Telegram broadcast is a downstream side-effect of an approved
  ACTUAL — never an alternate emit path.)
- **Responsible data (Art. XIV):** consent before intake; Unverified badge + numeric confidence; no PII
  retention; precise location responder-gated; misinformation flagged (deterministic), never merged as fact.
- **Total redundancy / offline-first (Art. XVI):** every layer has a fallback ladder (live → cache → mock →
  typed-unavailable), always labelled, never a dead-end; ships fully air-gapped (`docker compose up`, local
  Ollama, cached, ~$0) AND cloud from the same artifacts. Three acceptance tests: offline, source-down, AI-off.
- **Free/open data only** with compatible licenses (tracked in NOTICE); no ToS-protected scraping (X/Twitter
  excluded — Bluesky is the vetted-social channel). **Config for everything** (12-factor; `SOURCE_*_MODE` +
  `keyEnv` fail-fast). **Secrets only in env** (`.env` gitignored — holds the OpenRouter key + cloud-AI profile).
- **Honest limitations are graded** — state them, never hide; never weaken a gate/assertion to force green.
- **No auto-commit** — the agent stages/greens; the USER reviews the diff and commits/merges. AGENTS.md +
  CONSTITUTION.md stay FROZEN.

## Commands & environment (exact)
`source ~/.nvm/nvm.sh && nvm use` (Node 24.x via `.nvmrc`). Use `./node_modules/.bin/{tsc,vitest,eslint,depcruise,
madge,next,playwright}` (npx misresolves on this WSL box). `rm -rf .next` before any dev-server / playwright run.
Gate = `tsc --noEmit` 0 · `eslint .` 0 · `vitest run` green (coverage floors) · `depcruise src --config
.dependency-cruiser.cjs` 0 · `next build` ✅ · (W3+) `playwright test`. Probes: `npm run
{live:probe,pg:probe,ai:probe,capture:playbook,demo:reset}`. Docker: `docker compose -f infra/docker-compose.yml
up -d --build`. Egress works on this box; docker daemon up; Ollama NOT installed (cloud AI via OpenRouter).

## Repo state (2026-07-14)
`main` @ `a4828a5` (PR#2 Phase-B + PR#3 Phase-C both merged), clean, in sync with origin. Gates green
(tsc 0 · eslint 0 · vitest 1061/2skip · depcruise 303/0). Work on a NEW branch off main (e.g. `phase-d-deliver`);
the user commits/merges per wave or at the end. This plan file is at the git root `IEEE/Quest/` (untracked —
commit it if you want it versioned).

## Reference doc map
Governance: `agents/AGENTS.md`, `agents/CONSTITUTION.md`. Lifeline/memory: `agents/memory/*`. Program plan:
this file + the A/B/C master plan (consolidated in `CHANGELOG.md` `[0.1.0]`). Audits/evidence: `docs/audit/FINAL_LIVE_AUDIT.md`
(S00→S09 findings→resolutions), `docs/audit/LIVE_VERIFICATION.md` (captured live proofs),

Testing: `docs/E2E_TESTING_PLAYBOOK.md` (keys/run-matrix/real outputs/36 screenshots),
`docs/VISUAL_LIVE_TEST_PLAN.md`. Data: `audit/DATA_SOURCE_VERIFICATION.md` (the verified catalog),
`config/adapters.json` + `config/planned-sources.md`. Architecture: `docs/architecture/decisions/ADR-*.md`
(ADR-024 Phase-B composition, ADR-025 JWT/dev-login are the latest), `docs/architecture/THREAT_MODEL.md`,
`docs/api/openapi.yaml`. Security: `docs/security/SECURITY_REVIEW.md`, `docs/architecture/COMPLIANCE_MATRIX.md`.

## Attribution rule (enforced)
No artifact may reference the unpublished book/manuscript. Attribute agentic-AI patterns generically ("the
author's agentic-AI engineering framework") or to the public standards (OWASP LLM/ASI, NIST AI RMF, ISO 42001,
EU AI Act, MITRE ATLAS, OASIS CAP/EDXL). Prior/companion work disclosed in the portal:
`github.com/andreibesleaga/mobile-mesh-ews`.
