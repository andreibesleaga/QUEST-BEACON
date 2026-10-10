# BEACON Feature Plan — "Live Views": cameras + external context links on the map

> **✅ Status: IMPLEMENTED (E11, 2026-07-17 — in CHANGELOG `[0.1.0]`; ADR-027/028/029; kept as the
> golden-thread plan→ADR→tests traceability record).** Originally: GABBE Loki SDLC S00→S09, fully
> mapped. Feature: show LIVE CAMERAS (fire-spotting, traffic CCTV, webcams) as icons on the COP with a
> **link** to view each feed (never embedded), plus one-click **external context views** (Google
> Earth/Maps/Street View, Bing, OSM, Windy, Zoom Earth, NASA Worldview) and an optional consent-gated
> **citizen live-view** link on SOS reports. All link-out, human-facing, advisory-only — the deterministic
> engine and AI never read a pixel from any external view. Multi-region (US + Romania), multi-source, live.
>
> Grounded in verified research (2026-07-17) + a file:line seam map of the current build. Companion:
> `docs/FINAL_LIVE_TEST_AND_DEMO.md`, `docs/audit/FINAL_LIVE_AUDIT-2026-08.md`, `docs/audit/PHASE3-FULL-DELIVERY-PLAN.md` (implemented, archived).

---

## 0. One-paragraph summary

A new **`cameras` COP layer** renders location-pinned live cameras from a set of adapters (Caltrans CCTV,
ALERTWildfire/ALERTCalifornia, Windy Webcams, state 511 DOT cams, Romanian CNADNR) through the existing
redundancy ladder (LIVE→cache→recorded-mock), each pin opening the source's own live-view page in a new tab.
A parallel **External Views** panel gives every incident/location a set of deterministic deep-links to
third-party 3D/satellite/street context (no API key, pure URL construction). An optional **Citizen Live
View** link can be attached to an SOS report — consent-gated, HITL-reviewed, permanently badged
"Unofficial", allowlist-validated, never scraped. Everything is link-only, attributed, provenance-stamped,
and advisory (Article XII: never a fact the engine or LLM asserts).

---

## S00 — Business value & discovery  · GATE: GO/NO-GO

**Problem / JTBD.** During a wildfire or flood, the single most-requested thing responders and the public
want is *eyes on the ground* — "what does it actually look like there right now?" Today BEACON fuses
sensors, gauges, and news but offers no visual ground-truth. Fire agencies already depend on ALERTWildfire
PTZ cameras; DOTs run CCTV on exactly the evacuation routes we compute. Surfacing those existing public
feeds as map pins — plus letting a user jump to Google Earth 3D / NASA smoke imagery for any point — closes
the "see it" gap with zero new sensing infrastructure and near-zero cost.

**North-star metric.** Time-to-visual-confirmation: from opening an incident to viewing a relevant live
camera or 3D context < 15 s, with ≥1 relevant live view available for the flagship CA wildfire scenario.

**Rubric mapping (IEEE Response Quest, jury 4.48/5 baseline).**
- *Comprehensiveness (4.7, protect)* — adds the whole visual-ground-truth modality the COP lacked.
- *Timeliness (4.2→)* — live cameras are the most literal "real-time" signal a judge can see move on camera.
- *Innovation (Scenario 4.7)* — cited deterministic fusion **plus** one-click 3D/satellite/camera context is
  a white-space combo; ALERTWildfire integration is exactly what real fire IMTs use.
- *Usability (4.3→)* — "click pin → see the fire" is the most intuitive interaction in the app.
- *Responsible (Integration 4.5)* — link-only + consent + no-unsecured-cameras is a graded-honesty win.

**RICE-ranked scope.** v1 = camera layer (Caltrans + ALERT + Windy) + external deep-links (highest
reach/lowest effort/cost) → v1.1 = 511 multi-state + CNADNR-RO → v1.2 = citizen live-view (highest new-risk,
gated last).

**S00 artifact:** `docs/discovery/LIVE_VIEWS_OPPORTUNITY.md`. **GABBE:** persona `prod-pm`; skills
`clarify`, `business-value`; memory: DECISION_LOG entry, SDLC_TRACKER row. **GATE:** user GO/NO-GO (this doc).

---

## S01 — Requirements (PRD + EARS)  · GATE: REVIEW

New FRs (append to `docs/requirements/PRD.md`; EARS in §5):

- **FR-CAM-1** The system SHALL render a toggleable `cameras` COP layer of location-pinned live cameras for
  the active region, each pin exposing a link to the source's own live-view page (opened externally).
- **FR-CAM-2** WHEN a camera source is unavailable, the system SHALL degrade to its last-known-good camera
  list (cache) then a recorded-mock set, labelling freshness — never an empty/dead layer (Art. XVI).
- **FR-CAM-3** The system SHALL attribute each camera source per its license (e.g. mandatory "Webcams
  provided by windy.com" badge; "ALERTCalifornia \| UC San Diego" credit) in the legend/info panel.
- **FR-VIEW-1** For any incident (and any clicked map point), the system SHALL offer deterministic external
  context links (Google Maps/Satellite/Street View, Google Earth 3D, Bing, OSM, Windy, Zoom Earth, NASA
  Worldview), constructed from the coordinate with no API key, opened externally.
- **FR-VIEW-2** External view links SHALL be advisory context only; no engine or AI component reads content
  from a linked view or derives a fact from it (Art. XII).
- **FR-CIT-1** (v1.2, feature-flagged) A reporter MAY attach one live-view URL to an SOS report; it SHALL be
  consent-gated, host-allowlist + SSRF validated, HITL-reviewable, permanently badged "Live Feed —
  Unofficial", TTL-expired, and never merged visually with agency cameras.
- **NFR:** link-only (never embed/proxy/rehost third-party video/imagery); no unsecured-camera aggregators;
  no PII; every camera datum carries provenance + freshness; camera layer default-OFF (opt-in), external
  views default-ON (zero cost).

**GABBE:** persona `prod-pm` + `clarify`; golden-thread each FR → test. **GATE:** user review.

---

## S02 — Architecture (ADRs + threat model)  · GATE: REVIEW

**ADR-027 — Live camera sources as SourceAdapterPort<CameraFeed>.** Cameras are a normal source family:
one new domain entity `CameraFeed`, one outward `CameraDirectoryPort`, N adapters behind the proven registry
+ manifest + RedundancyEngine pattern (zero core change per FR-10). Fits the exact §3/§6 seams below.

**ADR-028 — External views as a deterministic link builder (no adapter).** Deep-links are pure functions of
a coordinate — a framework-free `external-views.ts` in `src/application/` returns
`ExternalViewLink[] = {label, kind, url, provider}` with **no network, no key, no state** — so it is trivially
correct, testable, offline, and cost-free. Rendered in the info panel + a map context-menu.

**ADR-029 — Citizen live-view links: consent-gated, HITL, one-way, "Unofficial".** Extends `PublicReport`
with an optional validated `liveViewUrl`; a distinct trust category that never joins the agency-camera layer;
allowlist + SSRF hygiene + TTL + audit. (Feature-flagged; ships last.)

**Link-only doctrine (threat model additions).** BEACON never takes possession of third-party video bytes:
no embed, no proxy, no server-side thumbnail fetch. Rationale: liability (we don't host/endorse), bandwidth
(no proxy DoS surface), licensing (Google Maps AUP forbids tile/imagery reuse but *sanctions* the Maps-URLs
deep-link scheme; ALERT CC BY-NC-ND forbids image rehosting — link-only sidesteps both), CORS (these are
session web apps, not keyless embed targets anyway). Threat rows: outbound-link SSRF on citizen URLs
(allowlist + no IP-literals + no private nets + no server fetch); open-redirect/phishing via a crafted
camera URL (adapters construct URLs from typed coordinates + fixed hosts only, never echo raw upstream
strings into an href without host validation); attribution-compliance (Windy badge, ALERT credit).

**Hard exclusions (constitutional).** Insecam-class unsecured/default-password camera aggregators (illegal
surveillance — hard-blocklisted, never a link target); EarthCam & Skyline Webcams (ToS bar third-party deep
-linking/indexing); generic RO re-aggregators (unclear chain-of-rights). Documented in NOTICE + threat model.

**S02 artifacts:** ADR-027/028/029; `THREAT_MODEL.md` rows; `C4_ARCHITECTURE.md` ADR index → 29.
**GABBE:** personas `prod-architect` + `ops-security`; skills `adr-writer`, `security-audit`,
`ai-ethics-compliance`. **GATE:** user review (esp. the ALERT license posture — see Open Questions).

---

## S03 — Technical spec (entity, port, adapter contract, schema, openapi, deep-link table)  · GATE: REVIEW

### 3.1 Domain entity `CameraFeed` — `src/domain/camera-feed.ts` (mirror `flood-zone.ts` template)
```
CameraFeed {
  id: CameraFeedId
  position: Position            // [lon,lat]
  kind: 'FIRE_CAMERA' | 'TRAFFIC_CCTV' | 'WEBCAM' | 'CITIZEN_STREAM'
  title: string
  provider: string             // 'ALERTCalifornia' | 'Caltrans' | 'windy.com' | ...
  viewUrl: string              // the external live-view page (https, host-validated)
  license: string              // for attribution
  isLive: boolean              // false ⇒ periodic snapshot, labelled honestly
  observedAt?: string          // last camera-list refresh
}
```
+ `makeCameraFeed` with `invariant` guards (https viewUrl, finite position, non-empty title/provider);
barrel line in `src/domain/index.ts`. `CameraFeedId` in `value-objects/ids.ts`.

### 3.2 Port — `src/ports/cameras.ts`
`CameraDirectoryPort { fetchCameras(query: AreaQuery): Promise<Result<Sourced<readonly CameraFeed[]>, DomainError>> }`
(mirrors `TelecomPort`/`OutagePort` in `infrastructure-sources.ts`). Port-local DTOs live in each adapter's ACL.

### 3.3 Adapters (3-file pattern each: `<id>-acl.ts` / `<id>-adapter.ts` / `__fixtures__/`)
| id | source | mode default | key | coverage | view-link pattern (verified) |
|---|---|---|---|---|---|
| `caltrans-cctv` | Caltrans District CCTV JSON | **LIVE** | none | US-CA | `currentImageURL` / `streamingVideoURL` fields (direct) |
| `alertwildfire` | ALERTWest OpenAPI (public cameras) | **CACHED**→LIVE | none (confirm) | US-West | per-camera view page (⚠ confirm exact URL via browser network tab) |
| `windy-webcams` | Windy Webcams API v3 | CACHED→LIVE | `WINDY_WEBCAMS_API_KEY` (free) | GLOBAL (+RO) | windy.com camera detail page (+ mandatory attribution badge) |
| `dot511` | state 511 CCTV APIs (GA pilot schema) | CACHED | per-state free key | US (per-state) | `Views[].Url` dashboard page |
| `cnadnr-ro` | CNADNR/CNAIR Trafic Live (hand-curated, geocoded) | **MOCK/CACHED** | none | RO | official per-camera page |
Each: class implements `SourceAdapterPort<CameraFeed>` + `CameraDirectoryPort`; `engine.run({mapper,
fetchLive via httpGetText, loadMockRaw})`; factory `make<X>Adapter(engine,env)` +
`resolveSourceConfig({prefix, keyEnv?, requireKeyForLive?})`; recorded-real fixture; ACL is the only place
the raw upstream shape exists. Registry entry in `ADAPTER_FACTORIES` + one `config/adapters.json` row +
manifest schema fields (port `CameraDirectory`, entity `CameraFeed`).

### 3.4 Map layer chain (add `cameras` — the Phase-D precedent, exact files)
- `app/_lib/types.ts` — `LAYER_IDS` += `'cameras'`; new wire type `ProjectedCameraData {id, position, kind,
  title, provider, viewUrl, isLive}`; `MapProjectionData.cameras?` + `layerSources.cameras`.
- `app/_components/map/types.ts` — `CameraPin` input type + `MapData.cameras?`.
- `app/_components/map/palette.ts` — `cameras` RGBA; `build-layers.ts` — `LAYER_META.cameras` (label "Live
  cameras — links open externally", caveat), `LAYER_BUILDERS.cameras` = icon layer (pickable; click →
  `window.open(viewUrl, '_blank', 'noopener')`), tooltip (title/provider/isLive).
- `app/_lib/map-data.ts` — `presentLayers.cameras`, passthrough in `phaseDLayers`.
- `src/application/map-projection/map-projection.ts` — `ProjectedCamera` + `MapSource.cameras?` +
  `projectCamera` (role-independent — cameras are public; strips nothing but validates https).
- `src/application/derivation/derive-cop.ts` — `MapDerivationInput.cameras?: CameraFeed[]` + derive step.
- Legend `app/_components/ui/legend.tsx` — extend `DATA_ATTRIBUTION` (Windy badge + ALERT credit + Caltrans).

### 3.5 External views — `src/application/external-views/external-views.ts`
Pure `buildExternalViews(position, opts?): ExternalViewLink[]` with the **verified** templates:
```
Google Maps      https://www.google.com/maps/@?api=1&map_action=map&center={lat}%2C{lon}&zoom=14
Google Satellite …&basemap=satellite
Street View      https://www.google.com/maps/@?api=1&map_action=pano&viewpoint={lat}%2C{lon}
Google Earth 3D  https://earth.google.com/web/@{lat},{lon},700a,20000d,35y,0h,0t,0r
Bing Aerial      https://www.bing.com/maps/default.aspx?cp={lat}~{lon}&style=a&lvl=15
OpenStreetMap    https://www.openstreetmap.org/?mlat={lat}&mlon={lon}#map=14/{lat}/{lon}
Windy            https://www.windy.com/?{lat},{lon},10
Zoom Earth       https://zoom.earth/maps/satellite/#view={lat},{lon},8z   (unofficial-but-stable)
NASA Worldview   https://worldview.earthdata.nasa.gov/?v={minLon},{minLat},{maxLon},{maxLat}   (~1° box)
```
No key, no network, deterministic → 100% unit-testable. Surfaced in a new **External Views** section of the
incident info/decision-support panel + a right-click map context-menu. (Copernicus Browser/EO Browser
**dropped** — EO Browser was sunset 2026-03-20; Copernicus has no verified raw-coord URL scheme → roadmap.)

### 3.6 Citizen live-view (v1.2) — `src/domain/public-report.ts` + intake
Optional `liveViewUrl?` on `PublicReport` + `MakePublicReportInput` + `definedOnly` builder; intake
validation: https-only, host allowlist (youtube/youtu.be live, twitch, generic https with disclaimer),
reject IP-literals/private nets (SSRF), never server-fetch. HITL review; permanent "Live Feed — Unofficial"
badge; TTL auto-fade (~2 h); per-reporter rate limit; audit-logged. New `CITIZEN_STREAM` camera kind, styled
distinctly, never merged with agency pins.

### 3.7 Contracts
- `schemas/adapter-manifest.schema.json` already free-string `port`/`entity` — no schema change.
- `docs/api/openapi.yaml` — `GET /regions/{id}/map` response gains the `cameras` slice; `ProjectedCameraData`
  schema; external views are client-derived (no endpoint) — documented as such; citizen `liveViewUrl` on the
  reports POST/PATCH bodies (v1.2).
- `config/adapters.json` — 5 new rows; `.env.example` — `FEATURE_CAMERAS`, `FEATURE_EXTERNAL_VIEWS` (default
  on), `FEATURE_CITIZEN_STREAM` (default off), `SOURCE_CALTRANS_CCTV_MODE`, `SOURCE_ALERTWILDFIRE_MODE`,
  `SOURCE_WINDY_WEBCAMS_MODE` + `WINDY_WEBCAMS_API_KEY`, `SOURCE_DOT511_MODE` + key, `SOURCE_CNADNR_RO_MODE`.
- `src/config/index.ts` — `FEATURE_CAMERAS`/`FEATURE_EXTERNAL_VIEWS`/`FEATURE_CITIZEN_STREAM` flags + refine
  (Windy LIVE ⇒ key). Per-source `SOURCE_*_MODE` read at factory sites (no EnvSchema edit needed).

**GABBE:** personas `prod-tech-lead` + `prod-architect`; skills `spec-writer`, `config-for-everything`,
`verified-schemas-contracts`. **GATE:** user review (SPEC + openapi parity).

---

## S04 — Task decomposition  · GATE: FINAL REVIEW → (approval to implement)

Waves (single-owner files; every wave ends green: tsc/eslint/vitest+cov/depcruise/next build; W-map+ Playwright):

- **CW0 — contracts (1 owner):** `CameraFeed` entity + `CameraFeedId` + barrel; `CameraDirectoryPort`;
  `LAYER_IDS += cameras` + all 4 exhaustive `Record<LayerId,…>` stub entries + wire/`MapData`/`MapSource`/
  `MapDerivationInput` optional `cameras?` slices (pass-through) + palette; `external-views.ts` pure builder.
  FEATURE flags + `.env.example`. All additive → trivially green.
- **CW1 — adapters (parallel lanes, 1 integrator):** caltrans-cctv, alertwildfire, windy-webcams, dot511,
  cnadnr-ro (each: acl+adapter+fixtures+2 tests, green in isolation). Integrator: registry + manifest rows +
  registry test port assertions + `.env.example`/CONFIGURATION/NOTICE attribution.
- **CW2 — consumption + derivation:** `live-seed.ts` enrichCaMap/enrichRoMap `fetchSlice<CameraFeed>` +
  `MapFetch`/`stamps`/`phaseDMapSlices` + `layerSources.cameras`; derive/project the slice; seed a CA + RO
  camera set so offline demo shows pins.
- **CW3 — frontend:** `cameras` icon builder + tooltip + click-to-open-external; legend attribution;
  External Views panel + map context-menu; per-layer freshness badge; Playwright layer smoke + one snapshot
  regen.
- **CW4 — citizen live-view (v1.2, gated):** `PublicReport.liveViewUrl` + intake validation + HITL +
  "Unofficial" badge + TTL + audit + tests.
- **CW5 — docs/gates:** openapi + THREAT_MODEL + ADR footers + DATA_SOURCE_VERIFICATION rows +
  E2E playbook section + coverage floors + FINAL_LIVE_AUDIT addendum.

**S04 artifact:** `project/tasks/E11-live-views.md` + TASKS ledger row. **GATE:** user final review → **STOP.**

---

## S05→S09 — mapped (runs only after approval; not started now)

- **S05 Implementation:** waves CW0→CW5 above, TDD-first, adapter pattern reuse, HITL/provenance/link-only
  invariants; ≥99% domain+application coverage; adapters/main under the two-tier floor.
- **S06 Quality gates (9):** lint/types/coverage/integration(docker incl. new fixtures)/security(SSRF on
  citizen URLs, secrets scan for WINDY key)/complexity<10/EARS-has-tests/boundaries/visual+axe.
- **S06.5 Perf:** camera-list fetch off the golden path (async, cached); time-to-visual-confirmation probe.
- **S07 Security review:** outbound-link SSRF, open-redirect/href-injection, attribution compliance,
  citizen-stream abuse/PII, no-embed enforcement; update SECURITY_REVIEW.md.
- **S07.5 Sustainability:** link-only adds ~0 egress/compute (the whole point) — note in SUSTAINABILITY.md.
- **S08 Human review gate:** demo the camera layer + external views live; user GO/NO-GO.
- **S09 Release/demo:** new demo-script beats (click ALERT fire-camera pin → live PTZ view; "View on Google
  Earth 3D"; NASA smoke imagery); DATA_SOURCE_VERIFICATION + playbook + FINAL_LIVE_AUDIT updated; merge.

**GABBE workflow per phase:** preflight → clarify → spec-driven (spec→evals→test→code) → observability
(provenance/audit on every camera fetch) → state-preserve (RESUME_POINTER per wave) → final-review; memory
(PROJECT_STATE/SDLC_TRACKER/DECISION_LOG/AUDIT_LOG/CONTINUITY) updated at each step; AGENTS.md + CONSTITUTION
FROZEN (feature honors existing Articles XII/XIII/XIV/XVI — no amendment needed).

---

## Verified source catalog (research 2026-07-17)

**Wire live first:** ① Caltrans CCTV (no key, lat/lon + direct URLs, zero ToS friction) · ② ALERTWildfire/
ALERTCalifornia (ALERTWest OpenAPI; ⚠ confirm exact view-URL + email ALERT re CC BY-NC-ND link-only) ·
③ Windy Webcams (free key, global+RO, mandatory attribution) · ④ 511 DOT (GA-verified schema, multi-state
template) · ⑤ CNADNR-RO (hand-curated official RO highway cams).
**External deep-links (no key):** Google Maps/Satellite/Street View, Google Earth 3D, Bing, OSM, Windy,
Zoom Earth, NASA Worldview — all coordinate-templated, verified.
**Excluded (documented):** Insecam-class (illegal surveillance) · EarthCam & Skyline (ToS bar deep-link/
index) · generic RO re-aggregators (unclear rights) · EO Browser (sunset 2026-03-20).

**Open extensibility (locked, 2026-07-17).** The camera catalog is OPEN by design: ANY additional camera/
view source — including ones not supported or not included today, and even the currently-excluded ones
should their rights/permissions later be cleared (e.g. EarthCam/Skyline with written permission, RO
aggregators with confirmed chain-of-rights, a paid/commercial directory when a client pays) — can be added
with ZERO core change via the same `SourceAdapterPort<CameraFeed>` + `CameraDirectoryPort` pattern: one
adapter directory (acl + adapter + fixtures + tests) + one `config/adapters.json` manifest row + one
`ADAPTER_FACTORIES` entry + a `SOURCE_<PREFIX>_MODE` (+ optional key) env flag. Mode/key gating means a
gated/paid source ships MOCK/CACHED and flips LIVE per-deployment when the operator has the rights/key.
The ONLY permanent exclusion is the constitutional one: unsecured/non-consenting camera aggregators
(Insecam-class) are banned regardless of technical feasibility. This clause is mirrored into SPEC §12 and
DATA_SOURCE_VERIFICATION at CW5.

## Responsible-data posture
Link-only (never embed/proxy/rehost) · no unsecured-camera aggregators · advisory-not-fact (no AI/engine
reads pixels — Art. XII) · citizen streams consent-gated + HITL + permanently "Unofficial" + TTL + no PII ·
attribution honored (Windy badge, ALERT credit) · every camera datum provenance+freshness stamped.

## Risks & mitigations
1. ALERT exact view-URL unconfirmed → CW1 spike (browser network tab) before wiring; fixture-first so the
   lane is green regardless; email ALERT re licensing (cheap insurance) — **user decision, see below**.
2. Windy free-tier ads/branding non-blockable + attribution mandatory → render the badge; keep Windy as
   secondary not sole source.
3. Street View / Bing-oblique coverage gaps in rural/RO areas → links still open (fall back to map); label
   honestly, don't promise coverage.
4. Citizen streams = new PII/abuse/SSRF surface → gated last (v1.2), allowlist+SSRF+HITL+TTL, feature-flag
   default-off; can ship the whole feature without it.
5. Dead/stale camera links → freshness badge + periodic list refresh + honest "isLive=false" for snapshots.

## Locked decisions (user, 2026-07-17)
- **Q1 → ALL FIVE in v1.** CW1 builds all five camera adapters (Caltrans, ALERTWildfire, Windy Webcams,
  511 DOT, CNADNR-RO) in the first pass — full US + Romania camera coverage at launch. (More separate free
  keys to register: `WINDY_WEBCAMS_API_KEY` + per-state 511 keys — all documented in the E2E playbook.)
- **Q2 → CITIZEN LIVE-VIEW INCLUDED, gated last (v1.2 / wave CW4).** Feature-flag `FEATURE_CITIZEN_STREAM`
  default-off; consent-gated + HITL + "Unofficial" badge + allowlist/SSRF + TTL + audit. The feature can
  still fully demo without enabling it.
- **Q3 → ALERT link-only NOW.** Wire ALERTWildfire/ALERTCalifornia link-only in v1 on the link-not-rehost
  reading; show the "ALERTCalifornia | UC San Diego" credit; record the licensing reading in the threat
  model. (An email to ALERT remains recommended as cheap insurance but is not a blocker.) ⚠ Still resolve
  the exact per-camera human view-URL via a browser-network-tab spike at the start of CW1 (fixture-first so
  the lane stays green regardless).
- **Q4 → EXTERNAL VIEWS DEFAULT-ON.** `FEATURE_EXTERNAL_VIEWS` default-on (no key, no cost, no network) —
  every incident/point gets the one-click 3D/satellite/street context panel.

**Implementation is APPROVED-IN-SCOPE but NOT YET STARTED — awaiting the user's explicit "go" to begin
S05 wave CW0.** (Per the standing "stop before implementation" instruction.)
