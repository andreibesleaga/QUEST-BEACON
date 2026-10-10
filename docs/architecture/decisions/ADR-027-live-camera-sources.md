# ADR-027 — Live camera sources as `SourceAdapterPort<CameraFeed>`

- **Status:** Accepted (2026-07-17)
- **Deciders:** Entrant + prod-architect (user-directed, E11 "Live Views" wave CW0–CW2)
- **Relates to:** ADR-001 (hexagonal ports-and-adapters — cameras are just another source family),
  ADR-011 (multi-region registry + adapter `coverage` — US + Romania), ADR-012 (config-for-everything —
  per-source `SOURCE_*_MODE` + keys), ADR-009/ADR-024 (total redundancy / live-composition — LIVE→cache→
  recorded-mock ladder), ADR-028 (external view links — the sibling link-only builder), ADR-029 (citizen
  live-view — the `CITIZEN_STREAM` kind), CONSTITUTION Art. XII (advisory-not-fact — no engine/AI reads a
  pixel), Art. XIV (responsible data — attribution + no unsecured cameras), Art. XVI (redundancy /
  degrade-never-dead-end)
- **Threat model:** `docs/architecture/THREAT_MODEL.md` TB4 T5.10 (new camera egress hosts) and T5.11
  (camera link-out / href-injection guard); attribution-compliance obligation (Windy badge, ALERT credit)

## Context

Responders and the public repeatedly want *eyes on the ground* — "what does it actually look like there
right now?" BEACON fused sensors, gauges and news but had no visual ground-truth modality. Fire IMTs
already depend on ALERTWildfire/ALERTCalifornia PTZ cameras; DOTs run CCTV on exactly the evacuation routes
BEACON computes. E11 surfaces those existing public feeds as COP map pins.

The design question was whether cameras needed a new subsystem or fit the existing seam. They fit: a camera
is a geolocated, provenance-stamped datum from a redundancy-laddered adapter — structurally identical to a
hazard, gauge, or outage. Wiring them as a first-class source family (rather than a bespoke feature) is the
project's core "comprehensiveness + adapter discipline, zero core change" claim (FR-10).

## Decision

1. **Cameras are a normal source family.** One new pure domain entity `CameraFeed`
   (`src/domain/camera-feed.ts`) — `{id, position, kind, title, provider, viewUrl, license, isLive,
   observedAt?}` with `makeCameraFeed` invariant guards — plus one outward port `CameraDirectoryPort`
   (`src/ports/cameras.ts`, `fetchCameras(query): Result<Sourced<readonly CameraFeed[]>, DomainError>`,
   mirroring `TelecomPort`/`OutagePort`). N adapters sit behind the proven registry + manifest +
   `RedundancyEngine` pattern. The registry grew **22 → 27**; five schema-valid `config/adapters.json`
   rows (`port:"CameraDirectory"`, `entity:"CameraFeed"`) were added. **No core file changed** — the same
   flag/plugin discipline as ADR-021/023.

2. **Link-only, never rehost (the `viewUrl` https-only invariant is the href-injection guard).** A
   `CameraFeed` only ever carries the external live-view **page** URL; the UI opens it in a new tab
   (`window.open(viewUrl, '_blank', 'noopener,noreferrer')`). BEACON never takes possession of third-party
   video bytes: no embed, no proxy, no server-side thumbnail fetch. `makeCameraFeed` enforces
   `new URL(viewUrl).protocol === 'https:'` — rejecting `http:`/`javascript:`/`data:`/unparseable strings —
   so an adapter must construct the href from a fixed host + typed coordinates and can never echo a raw
   upstream string into an anchor (see THREAT_MODEL T5.11).

3. **Five adapters shipped in v1 (all US + Romania at launch — user Q1 locked ALL FIVE):**

   | id | source | shipped mode | key | coverage | view-link |
   |---|---|---|---|---|---|
   | `caltrans-cctv` | Caltrans District CCTV JSON | **LIVE** (keyless) | none | US-CA | direct `streamingVideoURL`/`currentImageURL`; `isLive` honest stream-vs-snapshot |
   | `alertwildfire` | ArcGIS Living Atlas `ALERTCalifornia_Camera_Feed` FeatureServer | **CACHED** | none | US | per-camera `cameraURL` attribute (`cameras.alertcalifornia.org/?id=…`) |
   | `windy-webcams` | Windy Webcams API v3 | **CACHED** | `WINDY_WEBCAMS_API_KEY` (free) | GLOBAL (+RO) | `urls.detail` else `https://www.windy.com/webcams/{id}` |
   | `dot511` | state 511 CCTV APIs (GA schema) | **CACHED** | `DOT511_API_KEY` (per-state) | US | first Enabled `Views[].Url` dashboard page |
   | `cnadnr-ro` | CNADNR/CNAIR Trafic Live (hand-curated) | **MOCK** | none | RO | official per-camera page |

4. **ALERTWildfire finding (CW1 spike, resolved 2026-07-17).** The planned "ALERTWest OpenAPI" is **dead
   (HTTP 404)**. The wired source is instead the **keyless ArcGIS Living Atlas
   `ALERTCalifornia_Camera_Feed` FeatureServer** (~1250 cameras, `f=geojson`, egress `services8.arcgis.com`,
   curl-200 verified). Each feature already carries a **`cameraURL` attribute** that IS the human live-view
   page — BEACON surfaces that verbatim (host-validated), it is **never constructed**. The `imageURL`
   attribute is **deliberately NOT surfaced**: ALERTCalifornia imagery is **CC BY-NC-ND 4.0**, which forbids
   rehosting/derivatives but does not bar link-out to the source's own page (user Q3: link-only NOW). The
   mandatory credit **"ALERTCalifornia | UC San Diego"** rides the `provider`/`license`/attribution fields.

5. **Per-source mode + attribution are config, not code.** Shipped modes are exactly the table above
   (`config/adapters.json`). LIVE is claimed only where curl-verified (caltrans, alertwildfire endpoints);
   Windy/dot511 ship CACHED and flip LIVE per-deployment once the operator supplies the free key
   (fail-fast if LIVE without its key). Attribution strings live on the manifest rows and the legend
   `DATA_ATTRIBUTION` (Windy badge + ALERT credit + Caltrans/511/CNAIR).

6. **The camera layer is default-OFF (opt-in) and MAP-ONLY.** `FEATURE_CAMERAS` gates the layer; camera
   data is a COP overlay (violet pins), not part of `/status` (the `nfhl` provenance pattern). Advisory
   only (Art. XII): the deterministic engine and the LLM never read a camera image or derive a fact from
   one.

7. **The catalog is OPEN by design (extensibility clause, locked 2026-07-17).** ANY additional camera/view
   source — including ones not supported or not included today, and even the currently-excluded ones should
   their rights/permissions later be cleared (e.g. EarthCam/Skyline with written permission, RO aggregators
   with a confirmed chain-of-rights, a paid/commercial directory when a client pays) — can be added with
   **zero core change** via the same `SourceAdapterPort<CameraFeed>` + `CameraDirectoryPort` pattern: one
   adapter directory (acl + adapter + fixtures + tests) + one manifest row + one `ADAPTER_FACTORIES` entry
   + a `SOURCE_<PREFIX>_MODE` (+ optional key). Mode/key gating means a gated/paid source ships MOCK/CACHED
   and flips LIVE per-deployment when the operator has the rights/key. The clause is mirrored into SPEC
   §12.8 and `docs/audit/DATA_SOURCE_VERIFICATION.md`.

## Consequences

- **Positive.** Adds the whole visual-ground-truth modality the COP lacked with zero core change and
  near-zero cost (link-only ≈ 0 egress/compute); real fire-agency + DOT feeds on the exact evacuation
  routes BEACON already computes; full US + Romania coverage at launch; every camera datum is
  provenance + freshness stamped and degrades LIVE→cache→recorded-mock (Art. XVI), never a dead/empty
  layer.
- **Negative / accepted.** Link targets can rot or a source can gate/relocate its endpoint (caltrans is the
  only keyless-LIVE default; ALERTCalifornia ships CACHED, the rest CACHED/MOCK) — mitigated by the
  freshness badge, honest `isLive:false` for snapshots, and the recorded-real fixtures. Windy free-tier
  branding/ads are non-blockable and its attribution badge is **mandatory** — rendered in the legend;
  Windy is a secondary, never a sole, source.
- **Constitutional permanent exclusion.** Unsecured / default-password / non-consenting camera aggregators
  (**Insecam-class** — illegal surveillance) are **hard-blocklisted, never a link target, regardless of
  technical feasibility**. This is the ONLY permanent exclusion and it is not waivable by the extensibility
  clause above.

## Alternatives considered

- **A bespoke "cameras" subsystem outside the adapter registry** — rejected: it would duplicate the
  redundancy ladder, provenance stamping and config discipline the source family already provides, and
  violate the zero-core-change discipline (Art. XV).
- **Embedding / proxying / server-side thumbnailing the feeds** — rejected: liability (hosting/endorsing
  third-party video), a bandwidth/DoS proxy surface, and licensing (ALERT CC BY-NC-ND forbids rehosting;
  link-out sidesteps it). Link-only is the doctrine (shared with ADR-028).
- **Constructing the ALERTCalifornia view-URL from an id template** — rejected once the spike found the
  authoritative `cameraURL` attribute already in the FeatureServer payload: surfacing the source's own
  canonical URL is safer than guessing a scheme that could break.
- **Surfacing `imageURL` for an inline thumbnail** — rejected on the CC BY-NC-ND reading (link-only, Q3).

## Implementation complete: Yes (E11 Live Views, 2026-07-17)

`CameraFeed` (`src/domain/camera-feed.ts`) + `CameraDirectoryPort` (`src/ports/cameras.ts`); five adapters
(`src/adapters/sources/{caltrans-cctv,alertwildfire,windy-webcams,dot511,cnadnr-ro}/`) each with acl +
adapter + recorded fixture + tests; registry 22→27 (`src/main/adapter-registry.ts`) + five
`config/adapters.json` rows; live-seed consumption + CA/RO seed pins (`src/main/live-seed.ts`); violet
camera layer + click-to-open + tooltip (`app/_components/map/build-layers.ts`); legend attribution. Gate
green after CW0–CW4 (tsc 0 · eslint 0 · vitest 1816 pass/2 skip). See THREAT_MODEL T5.10/T5.11,
`docs/audit/DATA_SOURCE_VERIFICATION.md` "Live camera sources (E11)", and `docs/api/openapi.yaml`
`GET /regions/{id}/map` `cameras` slice.
