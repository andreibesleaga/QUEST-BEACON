# BEACON — Data Source Verification

*Authoritative verification of every data source/API in the BEACON catalog, for Phase 3. Pairs with
`PHASE2_AUDIT.md` + `CLARIFICATIONS.md`. Each source gets a **demo verdict: LIVE / CACHED / MOCK**
(governed at runtime by `SOURCE_<NAME>_MODE`, see `../docs/architecture/CONFIGURATION.md`).*

> **Method & honesty note:** consolidated from the Phase-2 catalog, the Phase-2 liveness check (3 Jun
> 2026), and three live web-research passes in this audit. Some endpoints could not be re-fetched from
> this environment; those carry the best-known canonical URL + a **conservative** verdict and a
> **"re-verify live at build (S05)"** flag. No source is assumed live without a path to cache/mock
> fallback (Constitution XVI). First-class **free-world data only** (Constitution XI).

Legend — **Verdict:** LIVE = reliable to call live on the golden path · CACHED = snapshot nightly/periodic
(slow/heavy/gated-but-open) · MOCK = gated/impractical/again-license → recorded fixtures. **⚠ re-verify** =
confirm endpoint/terms during S05 build.

---

## 0. Wired-as-adapter status (Phase-D 2026-07; counts corrected 2026-07-31 — E1; S2 expansion 2026-08-08; S3 AirQuality trio 2026-08-08)

> ### 2026-08-08 — S3 Lane A: the AirQuality trio is REGISTERED **and CONSULTED** — 41 → **44 registered**
>
> `openaq`, `airnow`, `sensorcommunity` (AirQuality port P17) were held at S2 because F-52 forbids
> enabling a port no assembly consults. **Their consumer now exists**: `derive-cop`'s deterministic,
> cited SitRep air-quality threshold fact (source-published AQI at/above Unhealthy-for-Sensitive-Groups,
> or a concentration-only PM2.5 reading at/above the fixed 35.5 µg/m³ constant — never a category derived
> from a concentration, Art. XII), fed by `live-seed.ts`'s new **incident-only** `airQuality` slot
> (SitRep/`status` path; it paints no map layer, so the map cites no AQ source). All three are in
> `enabled_adapters`, coverage-honest per zone: `us-ca` = airnow → openaq; `ro`/`es`/`gr` =
> sensorcommunity → openaq; `ph` = openaq only. This was the SAFE enablement case the S2 warning below
> reserves: the slot is NEW, so nothing was displaced and no existing slot's precedence moved — the
> B1.8 characterisation snapshots confirm only provenance lists and the new `airQuality` input changed.

> ### 2026-08-08 (S3, later) — D-38 EXECUTED: per-slot enablement of 10 of the 11 S2 adapters
>
> The consumption design the S2 revert demanded now exists, and the enablement ran per slot with the
> characterisation snapshots as the proof (**zero removed lines across all ten snapshot diffs — pure
> additions**): every id was APPENDED after its slot's existing sources, so no existing winner moved.
> `metno` (all zones) + `anm` (ro) are weather fallback rungs; `mastodon`/`caphub`/`lanceflood` (all
> zones) + `openfema` (us-ca) grow the NewsIntel fusion batch; `eonet`/`cemsrm` (all zones) are EVENT
> hazard feeds — cited, never drawn (`HAZARD_FOOTPRINT_SOURCES`); `nri` (us-ca) and `hdxpop` (ro) are
> LAST population rungs. Two coupled fixes landed with it: **populationGrounding** is now minted for the
> first-serving population adapter (F-66(b) had reopened — a served census/WorldPop figure rode UNCITED;
> the seeded planning number stays ungrounded on purpose), and the population-down tests now prove the
> full ladder (census down + worldpop down ⇒ nri serves AND cites itself).
>
> **`hifld` is the one hold-out, deliberately:** the S2 trial's evidence stands — its static-2019 node
> set displaces the seeded infrastructure slice and silently breaks the derived "ASSUMED offline"
> outage marking. It stays registered-but-unconsulted until the infrastructure slot gets a
> merge-not-replace design. Consumed count: **41 of 44** (36 COP/`status` + 5 cameras); NOT consumed:
> `hifld` (held, above) + `itu`/`camara-gsma` (operator-gated MOCK plugins by design).

> ### 2026-08-08 — live-demo increment S2: 30 → **41 registered adapters**
>
> Eleven adapters were implemented and registered: `mastodon`, `metno`, `anm`, `hdxpop`, `hifld`,
> `eonet`, `cemsrm`, `openfema`, `caphub`, `lanceflood`, `nri` (rows appended to the table below).
>
> **CRITICAL DISTINCTION — registered ≠ consulted.** *(This paragraph is the S2-close record;
> SUPERSEDED the same day by the D-38 note above — 10 of the 11 are now enabled per-slot, `hifld`
> held.)* All eleven were in `config/adapters.json` and `ADAPTER_FACTORIES`, but **none was in any
> region's `enabled_adapters` allowlist** in `config/regions.json`, so **no region consulted them**. `enabled_adapters` is a PERMISSION list, not
> an obligation (`adapter-registry.test.ts`), so nothing here is mis-declared — but do not read "41
> registered" as "41 feeding the COP". The consumed count is unchanged at **28** (23 COP/`status` + 5
> camera), plus `itu`/`camara-gsma` as by-design mock plugins.
>
> **Region enablement was TRIED at S2 close and deliberately REVERTED**, because it is not the
> config-only change it appears to be. Enabling `hifld` for `us-ca` **displaced the seeded infrastructure
> slice**, and because HIFLD is a static 2019 node set whose nodes do not intersect the seeded EAGLE-I
> outage polygon, the derived **"ASSUMED offline" outage computation silently marked nothing** —
> `outageNodeIds` returned `['hifld:4:11212']` where the feature expects `ca-substation-north`. Enabling a
> source changes *which* source wins a domain slot, so it needs the per-slot precedence + fallback design
> that belongs with its consumption work (session 3), not a config append at a session close. Recorded
> here so future work starts from the evidence rather than rediscovering it.
>
> **Mode truth-up: four candidate keyless LIVE flips were live-probed 2026-08-08; NONE passed.** The plan
> was "flip only what passes" — nothing did, and all four correctly stay CACHED/MOCK:
>
> | Candidate | Probe result | Verdict |
> |---|---|---|
> | `effis` → LIVE | The pinned ArcGIS query **301s** to `data.effis.emergency.copernicus.eu`, which returns S3 `<Code>NoSuchKey</Code>` **404**. The FeatureServer endpoint is **GONE**, not merely unconfirmed. | Stays CACHED. Upgrades the standing "endpoint unconfirmed (honest)" note to **confirmed dead** — the recorded fixture is the only working path, and re-pointing the adapter is real S3+ work. |
> | `worldpop` → LIVE | `api.worldpop.org/v1/services/stats` returns `{"status":"created","taskid":…}` after **16.7 s** — it is an **ASYNCHRONOUS task API**, not a data response. | Stays CACHED. A LIVE rung would need task-polling the adapter does not implement; the 16.7 s first leg alone breaks the TTTP budget. |
> | `usgs-water` → LIVE | OGC root `api.waterdata.usgs.gov/ogcapi/v0/collections` is healthy (**200**, `latest-continuous` present), but the adapter's `buildUrl` still appends **legacy IV query params** (documented-partial). | Stays MOCK. The host is alive; our *query construction* is the blocker. Flipping would send legacy params to the OGC host — a wrong-data risk, worse than an honest MOCK. |
> | `eagle-i` → LIVE | Its base is an ORNL dataset **explore page**, not an API. | Stays CACHED (historical + derived "ASSUMED offline"), exactly as documented. |

**44 sources are registered as `SourceAdapterPort` adapters — registered in `src/main/adapter-registry.ts`
+ `config/adapters.json` (an exact match: every manifest row has a factory, every factory has a manifest
row). 41 are consumed by the live composition** (count updated with the D-38 enablement above): 36 data
sources on the COP/`status` pipeline via the live-seed derivation bridge (`src/main/live-seed.ts` — incl.
NIFC/EFFIS fire perimeters merged beside FIRMS hotspots, the three AirQuality sources on the incident-only
`airQuality` slot, and the ten D-38 fallback/corroboration rungs), plus 5 camera sources on the E11
`cameras` map layer (see the note below the table). **3 are registered but NOT consumed:** `hifld`
(deliberately HELD — see the D-38 note) and `itu` + `camara-gsma` (operator-gated **MOCK-only plugins**:
wired and mock-consumable **by design**, not fused onto the COP — a real operator/DCM feed would enable
them).
`Default mode` = the shipped `SOURCE_*_MODE` (`config/adapters.json`); each has a documented flag-to-live
path (fail-fast if LIVE without its key). The per-source LIVE/CACHED/MOCK **verdicts** in §§1–8 are the
source-capability tiers and remain unchanged — this table records the *manifest wiring*, not a re-verdict.

> **2026-07-31 correction (E1 docs truth-up):** this section previously read "27 registered / 24
> consumed / 3 not consumed," undercounting the three MW-B B3 aggregator rows (`meteoalarm-gr`,
> `meteoalarm-es`, `wmo-swic` — added B3.2/B3.3, verified live keyless for GR/ES, `wmo-swic` resolving
> F-21 for `ph`) that were already registered in `config/adapters.json`/`ADAPTER_FACTORIES` but never
> added as rows here. Also, `usgs-water`'s "not consumed" verdict was stale: the region-generic
> `consultationPlan` (`src/main/live-seed.ts:507`) consults every adapter in a region's `enabled_adapters`
> whose port fills a used slot, and `us-ca`'s `enabled_adapters` includes `usgs-water` alongside `nwps` —
> both are consulted and cited for the `gauges` slot (`nwps` serves first by precedence order). Both
> corrections verified directly against the code, not carried over from a prior document.

| Adapter id | Port/entity | Default mode | Key/gate | Wired | Consumed |
|---|---|---|---|---|---|
| `firms` | HazardSource | LIVE | `FIRMS_MAP_KEY` (else MOCK fixture) | ✅ | ✅ |
| `nws` | Weather | LIVE | `NWS_USER_AGENT` | ✅ | ✅ (Phase-D — was built-not-consumed) |
| `nwps` | FloodGauge | LIVE | keyless | ✅ | ✅ |
| `glofas` | FloodGauge | CACHED | `GLOFAS_CDS_KEY` for live | ✅ | ✅ |
| `gdacs` | HazardSource | LIVE | keyless | ✅ | ✅ (Phase-D — was built-not-consumed) |
| `meteoalarm-ro` | NewsIntel | CACHED | keyless feeds | ✅ | ✅ (RO news fusion) |
| `open-meteo` | Weather | LIVE | keyless | ✅ | ✅ |
| `usgs-water` | FloodGauge | MOCK | keyless (OGC API) | ✅ | ✅ (gauge-redundancy rung: consulted + cited alongside `nwps` for `us-ca`'s `gauges` slot, `live-seed.ts:507` `consultationPlan`; `nwps` serves first by precedence order) |
| `meteoalarm-gr` | NewsIntel | CACHED | keyless feeds | ✅ | ✅ (`gr` news fusion; live-verified keyless 2026-07-18) |
| `meteoalarm-es` | NewsIntel | CACHED | keyless feeds | ✅ | ✅ (`es` news fusion; live-verified keyless 2026-07-18) |
| `wmo-swic` | NewsIntel | CACHED (LIVE-capable) | keyless | ✅ | ✅ (`ph` news fusion; PAGASA relay, resolves F-21) |
| `gdelt` | NewsIntel | LIVE | keyless (429 backoff) | ✅ | ✅ (news fusion) |
| `reliefweb` | NewsIntel | CACHED | `RELIEFWEB_APPNAME` for live | ✅ | ✅ (news fusion) |
| `agency-rss` | NewsIntel | LIVE | `AGENCYRSS_FEEDS`/`_RO` | ✅ | ✅ (news fusion; incl. InciWeb feed) |
| `bluesky` | NewsIntel (vetted-social) | MOCK | keyless (LIVE-capable) | ✅ | ✅ (corroboration-only, never auto-trusted) |
| `nifc` | HazardSource (perimeters) | CACHED | keyless (ArcGIS REST) | ✅ | ✅ (US fire PERIMETER merged beside FIRMS hotspots) |
| `effis` | HazardSource | CACHED | keyless — **CACHED-only; former endpoint confirmed DEAD 2026-08 (301 → S3 NoSuchKey), re-point is an open item** | ✅ | ✅ (EU/global fire merged into the RO hazards + provenance) |
| `osm-overpass` | Infrastructure | CACHED | keyless (ODbL) | ✅ | ✅ |
| `worldpop` | Population | CACHED | keyless (CC BY 4.0) | ✅ | ✅ (blended exposure) |
| `census` | Population | CACHED | `CENSUS_API_KEY` for live | ✅ | ✅ |
| `nfhl` | FloodZone | CACHED | keyless (ArcGIS REST) | ✅ | ✅ (layer + NFHL∩crest prediction) |
| `eagle-i` | Outage | CACHED | keyless — derives **"ASSUMED offline"** | ✅ | ✅ (outage layer) |
| `opencellid` | Telecom | CACHED | `OPENCELLID_API_KEY` for live | ✅ | ✅ (cell layer) |
| `itu` | Telecom | **MOCK-only** | gated data | ✅ | plugin (mock) — by design (not on the COP) |
| `camara-gsma` | Telecom | **MOCK-only** | operator-gated | ✅ | plugin (mock) — by design (not on the COP) |
| `caltrans-cctv` | CameraDirectory/CameraFeed | **LIVE** | keyless | ✅ | map-only (E11 `cameras` layer; not in `/status`) |
| `alertwildfire` | CameraDirectory/CameraFeed | CACHED | keyless (ArcGIS REST) | ✅ | map-only (E11 `cameras` layer) |
| `windy-webcams` | CameraDirectory/CameraFeed | CACHED | `WINDY_WEBCAMS_API_KEY` for live | ✅ | map-only (E11 `cameras` layer) |
| `dot511` | CameraDirectory/CameraFeed | CACHED | `DOT511_API_KEY` (per-state) for live | ✅ | map-only (E11 `cameras` layer) |
| `cnadnr-ro` | CameraDirectory/CameraFeed | **MOCK-only** | none (hand-curated) | ✅ | map-only (E11 `cameras` layer, RO) |
| `mastodon` | NewsIntel (vetted-social) | **LIVE** | keyless (public instance API) | ✅ | ✅ (S3 D-38: NewsIntel batch, ALL zones — the demo's live social source; live-fetch proven off-gate) |
| `metno` | Weather | **LIVE** | `METNO_USER_AGENT` **fail-fast** (their ToS mandates a contact UA) | ✅ | ✅ (S3 D-38: weather fallback rung, ALL zones — appended last, winner unchanged) |
| `anm` | Weather | CACHED | keyless | ✅ | ✅ (S3 D-38: `ro` weather fallback rung). **CACHED not by choice:** the ANM host **refused our TLS handshake** from this environment; the fixture is a recorded real response |
| `hdxpop` | Population | CACHED | keyless (per-dataset licence) | ✅ | ✅ (S3 D-38: `ro` LAST population rung behind worldpop; serves only when worldpop is down, and then cites itself via populationGrounding) |
| `hifld` | Infrastructure | CACHED | keyless | ✅ | ❌ **HELD (deliberate, D-38)** — the ONE S2 adapter still unconsulted: its **STATIC 2019** node set displaces the seeded infrastructure slice and silently breaks the derived "ASSUMED offline" outage marking (the reverted S2 trial). Needs a merge-not-replace infrastructure-slot design |
| `eonet` | HazardSource | **LIVE** | keyless | ✅ | ✅ (S3 D-38: EVENT hazard feed, ALL zones — cited, never drawn). **HONEST LIMIT: EONET's `floods` category is EMPTY upstream** — wildfire events are the real yield, so it is not a flood rung |
| `cemsrm` | HazardSource | CACHED | keyless | ✅ | ✅ (S3 D-38: EVENT hazard feed, ALL zones — cited, never drawn; EMSR758 = the RO demo fixture) |
| `openfema` | NewsIntel | **LIVE** | keyless | ✅ | ✅ (S3 D-38: `us-ca` NewsIntel batch — declared-disaster/program context as cited intel) |
| `caphub` | NewsIntel | CACHED | keyless | ✅ | ✅ (S3 D-38: NewsIntel batch, ALL zones). **No aggregate licence grant** — each relayed alert carries its own issuing authority + terms, cited per-alert; that is why it ships CACHED |
| `lanceflood` | NewsIntel | CACHED | `EARTHDATA_TOKEN` for live | ✅ | ✅ (S3 D-38: NewsIntel batch, ALL zones). **HONEST LIMIT: emits GRANULE AVAILABILITY** (which NRT products cover a bbox/date) — **NOT observed flood extent**. Do not cite it as observed flooding |
| `nri` | Population | CACHED | keyless | ✅ | ✅ (S3 D-38: `us-ca` LAST population rung behind census→worldpop; its POPULATION column is the 2020 Decennial figure verbatim, whole-county centroid caveat in the ACL). **Risk indices remain PARSED but NOT emitted** as a domain fact |
| `airnow` | AirQuality/AirQualityReading | **LIVE** | keyless (the Hourly AQ Obs FILE product needs no `AIRNOW_API_KEY`) | ✅ (S3) | ✅ `us-ca` primary airQuality rung (SitRep threshold fact). **NOT_COVERED outside North America** (BBOX coverage) — enabled nowhere else. Source-published AQI + category stated verbatim; data are PRELIMINARY per EPA |
| `sensorcommunity` | AirQuality/AirQualityReading | **LIVE** | keyless (ODbL 1.0 — attribution + **share-alike**) | ✅ (S3) | ✅ `ro`/`es`/`gr` primary airQuality rung (dense EU citizen PM network). **Concentrations only** — the fact compares against the fixed 35.5 µg/m³ constant and NEVER derives an AQI category |
| `openaq` | AirQuality/AirQualityReading | CACHED | `OPENAQ_API_KEY` for LIVE (v3 401s without it) | ✅ (S3) | ✅ global fallback airQuality rung on all 5 zones; `ph`'s only rung. Aggregate of per-location open licences (attribution required) |

> **E11 "Live Views" note (2026-07-17; count corrected 2026-07-31 — E1).** The five `CameraDirectory`/
> `CameraFeed` adapters above were originally counted as bringing the registry to 27; that count predates
> the MW-B B3 `meteoalarm-gr`/`meteoalarm-es`/`wmo-swic` rows added above. **The registry (44 rows in this
> table as of 2026-08-08) matches `config/adapters.json` ↔ `ADAPTER_FACTORIES` exactly** (verified by
> direct count; the count was 30 at 2026-07-31, 41 after the S2 expansion, 44 after the S3 AirQuality trio). Camera adapters are **map-only** (the default-OFF `cameras` COP layer, `FEATURE_CAMERAS`) —
> a link-out overlay, not part of `/status`. All are **link-only** (never embed/proxy/rehost — Art. XII):
> a `CameraFeed.viewUrl` is https-host-validated and opens the provider's own page in a new tab. See the
> dedicated "Live camera sources (E11)" section below for verified endpoints/licenses, and ADR-027.

> **Built but deliberately NOT in the 41 — RESOLVED 2026-08-08 (S3).** The hold this note recorded is
> closed: the three air-quality adapters registered the same day their consumer (the deterministic cited
> SitRep fact on an AQI threshold, `derive-cop` `airQualityFact`) landed, exactly as promised — one
> manifest row each plus their `ADAPTER_FACTORIES` entries, and their `SOURCE_*_MODE` flags now drive
> real behaviour. See their three ✅ rows in the table above and the S3 note at the top of this section.
> The hold's record is kept in `config/planned-sources.md` ("Built-but-held — RESOLVED").
>
> **Vision imagery is a live source too, and is not in this table** because it is not a `SourceAdapterPort`:
> the `burn-area` vision rung fetches **NASA GIBS** WMTS snapshots (keyless, US public domain) and sends
> them to a vision model. Note GIBS does **not** serve Sentinel-2 keylessly — it serves MODIS/VIIRS, so the
> "Sentinel-2 NBR" catalog entry is satisfied at a coarser resolution than its name implies. Proven live
> off-gate 2026-08-08 (real GIBS fetch → real model → "possible burn scar" over the 2024 Park Fire scar;
> a control image of unburned terrain correctly returned "no burn scar visible"). Attribution in `NOTICE`.

---

## 1. Wildfire

| Source | Live? | Endpoint | Free/Auth | License | Cadence | Coverage | Verdict | Notes |
|---|---|---|---|---|---|---|---|---|
| **NASA FIRMS** | ✅ | `firms.modaps.eosdis.nasa.gov/api` | Free, MAP_KEY | NASA open / attribution | NRT (US/CA real-time, global ≤3h) | **Global** | **LIVE** | Hotspots ≠ perimeters; thermal false positives; 375m/1km. Core golden-path. |
| **NIFC / IRWIN** | ✅ | NIFC ArcGIS Hub (`data-nifc.opendata.arcgis.com`) | Free | US public domain | per incident | US | **CACHED** ⚠ | Official US perimeters; ArcGIS REST. |
| **Copernicus EFFIS / GWIS** | ✅ | `forest-fire.emergency.copernicus.eu` (alias `effis.emergency.copernicus.eu`; old `effis.jrc.ec.europa.eu` superseded), `gwis.jrc.ec.europa.eu` | Free (open WMS; acct only for raw burned-area extracts) | Copernicus (free, attribution) | daily+ | **Global** | **CACHED** | Global fire danger/perimeters — non-US equivalent. Endpoint verified 2026-06-29. |
| **Sentinel-2 (burn area/NBR)** | ✅ | Copernicus Data Space / MS Planetary Computer STAC | Free acct | Copernicus open | ~5-day revisit | **Global** | **CACHED** (vision) | Cloud gaps; processing needed. Vision-layer (stretch). |
| **Vantor (ex-Maxar) + Planet disaster open programs** | ✅ | Vantor Open Data Program (Maxar rebranded Oct 2025) + Planet Disaster Data program | Free (crisis activations) | **CC-BY-NC (non-commercial)** | per event | Global | **CACHED** ⚠ | Free crisis imagery for major events. (Correction 2026-06-29: the Mar-2025 Planet–Anthropic deal is an AI-analysis partnership, **not** a free-imagery program — do not conflate.) Confirm per-activation terms. |
| **xView2 / xBD** | ✅ | `xview2.org` | Free | **CC BY-NC-SA 4.0** ❌ | static | Global | **MOCK/eval-only** | **Non-commercial + ShareAlike** — do NOT bundle in the Apache-2.0 product; eval reference or model-only. |

## 2. Flood

| Source | Live? | Endpoint | Free/Auth | License | Cadence | Coverage | Verdict | Notes |
|---|---|---|---|---|---|---|---|---|
| **NOAA NWPS** | ✅ | `api.water.noaa.gov/nwps/v1` (OpenAPI docs at `/nwps/v1/docs/`) | Free, none | US public domain | sub-hourly–hourly | US | **LIVE** | Crest forecast + flood categories. **Confirmed live 2026-06-29** (re-verify flag cleared). |
| **USGS Water Data** | ✅ | `api.waterdata.usgs.gov` (OGC API) | Free, none | US public domain | ~15-min | US | **LIVE** | Use the new OGC API; legacy `waterservices.usgs.gov` **decommission = Q1 2027** (degradation no earlier than Aug 2026) — pin the new endpoint. Verified 2026-06-29. |
| **Copernicus GloFAS** | ✅ | `global-flood.emergency.copernicus.eu` / CDS API | Free acct | Copernicus open | daily | **Global** | **CACHED** | Global flood forecast — non-US equivalent. |
| **Google FloodHub** | ✅ | `sites.research.google/floods/` + API | Free, **waitlist+key+GCP; API is non-commercial-only** | **CC BY 4.0** (forecasts) | daily, ≤7-day lead | **Global (150+ ctry)** | **CACHED/MOCK** | Strong non-US riverine input but API gated + non-commercial → cache/mock for demo. |
| **GDACS** | ✅ | `gdacs.org` REST/RSS | Free, none | open | on event | **Global** | **LIVE** | Coarse alert polygons. |
| **FEMA NFHL** | ✅ | `hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer` | Free, none | US public domain | effective maps | US | **CACHED** | **Confirmed live 2026-06-29** (JSON/GeoJSON queries; re-verify flag cleared). Slow under load → nightly cache to DB. |

## 3. Weather & warnings

| Source | Live? | Endpoint | Free/Auth | License | Cadence | Coverage | Verdict | Notes |
|---|---|---|---|---|---|---|---|---|
| **NWS api.weather.gov** | ✅ | `api.weather.gov` | Free, **User-Agent required** | US public domain | on issuance | US | **LIVE** | Alerts + CAP. Set `NWS_USER_AGENT`. Core golden-path. |
| **Open-Meteo** | ✅ | `api.open-meteo.com` | Free (non-commercial tier) | CC BY 4.0 | hourly | **Global** | **LIVE** | Global weather; no official warnings. |
| **MeteoAlarm** | ✅ | `meteoalarm.org` free Atom/CAP feeds (+ new token-gated `api.meteoalarm.org` REST/EDR) | Free (feeds) / token (API) | per-provider | on issuance | **Europe** | **CACHED** | EU official warnings — non-US equivalent. Free CAP feeds are the public path; the new API portal needs a requested token. **Wired per-country (B3.1, 2026-07-27):** ONE generic adapter over `feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-<country>` — rows `meteoalarm-ro` (recorded fixture), `meteoalarm-gr`, `meteoalarm-es` (GR/ES feeds live-verified keyless 2026-07-18; their fixture bodies are hand-authored recorded-style, labelled in-file). Legacy **RSS** variant dead since 2026-01 — Atom only. |
| **PAGASA public alerts (CAP)** ⭐ | ✅ (live-probed 2026-07-27) | primary `https://severeweather.wmo.int/v2/cap-alerts/ph-pagasa-en/rss.xml` (WMO SWIC relay, 71 items, newest same-day); native `https://publicalert.pagasa.dost.gov.ph/feeds/` (Atom → `output/{gfa,acp}/<uuid>.cap`) | **Free, keyless** | **CC BY 4.0** (declared verbatim in the native feed); relay additionally under WMO Unified Data Policy Res. 1 | on issuance | **Philippines (PAR)** | **LIVE** (ships CACHED) | CAP v1.2, `sender PAGASA-DOST`, SWIC OID `urn:oid:2.49.0.0.608.0` — **resolves F-21, which was wrong**. Wired as `wmo-swic` (B3.2), source id per config. Flood (`gfa`) = province-level polygons + SAME geocode. TC (`acp`) area = the **whole Area of Responsibility ⇒ advisory alerting extent only, NEVER hazard geometry (F-48)**; the adapter emits only `NewsItem`s so it cannot reach exposure/footprint rendering, and PH storm/flood footprints come from `gdacs`/`glofas`. Multi-`<polygon>` per `<area>` + CAP `lat,lon` order both handled (F-49). Attribution: "PAGASA-DOST / WMO Severe Weather Information Centre". **Not claimed (F-51):** any other alert family (only `gfa`+`acp` observed), any published rate limit, relay-vs-native parity, archive depth (UUID-keyed ⇒ feed-discovery only). |
| **PHIVOLCS** | ❌ (no feed) | `earthquake.phivolcs.dost.gov.ph`, `phivolcs.dost.gov.ph/earthquake-information/` (HTML bulletins) | n/a | none declared | n/a | PH | **UNUSABLE — do not wire** | Only third-party HTML scraping exists (`lindol` R package); earthquake/volcano is out of BEACON's hazard scope regardless. |
| **NDRRMC / OCD** | ❌ (no API verified) | `ndrrmc.gov.ph`, `monitoring-dashboard.ndrrmc.gov.ph/page/situations` | n/a | none declared | per event (PDF) | PH | **link-out only** | PDF/dashboard sitreps; no machine-readable endpoint found. Recorded as UNVERIFIED, not "unavailable". |

## 4. Critical infrastructure & lifelines

| Source | Live? | Endpoint | Free/Auth | License | Cadence | Coverage | Verdict | Notes |
|---|---|---|---|---|---|---|---|---|
| **OSM Overpass** | ✅ | public Overpass instances | Free (rate-limited) | **ODbL** (attribution) | static (cache) | **Global** | **LIVE→CACHED** | Rate-limited → cache aggressively; respect ODbL. Core golden-path infra. |
| **MS Global ML Building Footprints** | ✅ | GitHub release | Free | **CDLA Permissive 2.0** | static | Global | **CACHED** | ~1.4B buildings — exposure base. (License verified 2026-06-29: CDLA-Permissive-2.0, not ODbL.) |
| **HIFLD (Next / archived)** | ⚠ | ArcGIS Hub + archived layers | Free | US public domain | periodic | US | **CACHED** | **HIFLD Open portal closed 2025** → use OSM + ArcGIS Hub + HHS hospital data. |
| **OpenCelliD** | ✅ | `opencellid.org` | Free key | CC BY-SA | periodic | **Global** | **CACHED** | Crowdsourced gaps. |
| **ITU Disaster Connectivity Maps** | ✅ | ITU DCM | Free | ITU terms | per event | Global | **MOCK** | Event-based; sparse. |
| **DOE/ORNL EAGLE-I** | ⚠ | public dataset + ArcGIS dashboard | Free (open dataset) | US public domain | 15-min (historical); live = gov-operational | US (county) | **CACHED** | **Live feed gov-operational** → use public historical + derive "assumed-offline" via hazard∩infra. |
| **CAMARA / GSMA Open Gateway** | ⚠ | operator sandboxes | **Operator-gated** | operator terms | real-time | varies | **MOCK** | Demo-mocked; real only where an operator sandbox is reachable. |

## 5. Authoritative news & official information

| Source | Live? | Endpoint | Free/Auth | License | Cadence | Coverage | Verdict | Notes |
|---|---|---|---|---|---|---|---|---|
| **NWS / IPAWS CAP** | ✅/⚠ | NWS CAP feeds (public); IPAWS aggregate gated | Free (NWS); IPAWS needs FEMA approval | US public domain | on issuance | US | **LIVE** (NWS) / **MOCK** (IPAWS) | Consume CAP; **no live IPAWS origination**. |
| **UN OCHA ReliefWeb** | ✅ | `api.reliefweb.int/v2` | Free, **pre-approved `appname`** | UN OCHA terms (attribution) | continuous | **Global** | **LIVE** | **v1 decommissioned (410); use v2.** Note (2026-06-29): since **2025-11-01** the `appname` must be **registered/approved** (no longer self-declared). |
| **GDACS** | ✅ | `gdacs.org` | Free | open | on event | Global | **LIVE** | (also §2) |
| **USGS/FEMA/NIFC InciWeb** | ✅ | `inciweb.wildfire.gov` RSS/REST (old `inciweb.nwcg.gov` superseded) | Free | US public domain | per update | US | **CACHED** | Host verified 2026-06-29 (RSS 2.0 feeds). |
| **Agency RSS/Atom (e.g. Cal Fire)** | ✅ | per-agency | Free | per-agency | per update | regional | **LIVE** | Per-agency formats. |
| **GDELT Project** | ✅ | `api.gdeltproject.org` | Free | open | 15-min | **Global** | **LIVE** | Throttles (429) on rapid poll → backoff. Noisy; authority-rank. |

## 6. Population communications & vetted social

| Source | Live? | Free/Auth | Handling | Verdict | Notes |
|---|---|---|---|---|---|
| **Consented crowdsourced intake** | n/a (BEACON's own API) | n/a | consent + provenance + confidence + "Unverified" + human verify | **LIVE** | Primary social method (Constitution XIV). |
| **Official agency social** | ✅ | RSS/public API | authoritative-news tier | **CACHED** | Trusted accounts. |
| **Bluesky firehose (Jetstream)** | ✅ | Free | AI extraction; never auto-trusted; misinformation flagged | **MOCK** (optional) | Signal-to-investigate only. |
| **X/Twitter** | ❌ | **no free tier since Feb 2023** | — | **EXCLUDED** | ToS/cost — not used (Constitution XIV). |

## 7. Population, history & routing

| Source | Live? | Endpoint | Free/Auth | License | Coverage | Verdict | Notes |
|---|---|---|---|---|---|---|---|
| **WorldPop** | ✅ | `worldpop.org` | Free | **CC BY 4.0** | **Global** | **CACHED** | Modeled population grids. |
| **UN OCHA HDX / HAPI** | ✅ | `data.humdata.org`, HAPI | Free | per-dataset (mostly open) | **Global** | **CACHED** | Humanitarian indicators. |
| **US Census / ACS** | ✅ | `api.census.gov` | Free key | US public domain | US | **CACHED** | Demographics; survey lag. |
| **OpenFEMA** | ✅ | `fema.gov/api/open/{vN}/...` | Free | US public domain | US | **CACHED** | **Per-dataset versioning** (v1/v2/v3 coexist) — only *specific* dataset v1's reach EOL on dated schedules (e.g. 2025-08-18); there is **no API-wide v1 cutoff**. Declarations/context. (Corrected 2026-06-29.) |
| **FEMA National Risk Index** | ✅ | `hazards.fema.gov/nri` | Free | US public domain | US | **CACHED** | Baseline hazard-vulnerability layer. |
| **OpenRouteService** | ✅ | `api.openrouteservice.org` | Free key (rate-limited) | open | **Global** | **LIVE** | Hazard-avoidance routing. Self-host **Valhalla/OSRM** removes limits (ladder). |
| **Turf.js / PostGIS** | ✅ | library / DB | OSS | MIT / PostGIS | n/a | n/a | **LIVE** | Derived layers; compute-bound at high feature counts. |

## 8. Imagery/compute & damage assessment (vision layer — stretch)

| Source | Live? | Free/Auth | License | Verdict | Notes |
|---|---|---|---|---|---|
| **MS Planetary Computer** | ⚠ | data catalog + STAC free; **Hub compute retired 2024-06-06**; "Pro" paid | MIT SDK / open data | **CACHED** | Use catalog/STAC for imagery; no free hosted compute. |
| **MS building-damage-assessment** | ✅ | Free | **MIT**, runs offline | **CACHED/LOCAL** | Great vision-layer model (you supply imagery). |
| **Copernicus EMS Rapid Mapping** | ✅ | Free | Copernicus open | **CACHED** | EU service, global activations — **tasked E4·T-187** (EMSR758 = RO demo fixture). |
| **NASA GIBS/Worldview tiles** | ✅ | keyless WMTS/XYZ | attribution requested | **LIVE-capable** | 1000+ layers (fires/flood/aerosol) — consumed directly as MapLibre overlay (E8·T-364c), no E4 adapter needed. |

*Adapter-coverage note (D-32): of this section only Sentinel-2 (T-167), CEMS-RM (T-187) and GIBS
(E8·T-364c) are v1-tasked; **Vantor/Planet crisis imagery + MS building-damage-assessment are
model/eval references with NO v1 adapter** (vision is `FEATURE_VISION=off` stretch — honest scope).*

## 9. Standards (status)

| Standard | Status | Use |
|---|---|---|
| **OASIS CAP v1.2** | ✅ current | Internal event + outbound alert (validated before emit) |
| **OASIS EDXL-RM 1.0** | ✅ OASIS Standard | **Full mutual-aid round-trip** |
| **OASIS EDXL-SitRep 1.0** | ✅ usable — **Committee Specification (CS02, 2016)**, not a ratified OASIS Standard | Situation reports |
| **GeoJSON (RFC 7946) / OGC API** | ✅ current | Geospatial interchange |
| **GLIDE** | ✅ active | Cross-agency disaster IDs |

---

## 9a. Live camera sources (E11 "Live Views", verified 2026-07-17)

Cameras are surfaced **link-only** — a map pin whose click opens the provider's own live-view page in a new
tab. BEACON never embeds/proxies/rehosts the video or imagery (Art. XII; the engine and LLM never read a
pixel). Each is a `SourceAdapterPort<CameraFeed>` on the registry (ADR-027). `viewUrl` is always
https-host-validated (href-injection guard).

| Source | Endpoint (egress host) | Free/Auth | License / posture | Coverage | Verdict | View-link | Notes |
|---|---|---|---|---|---|---|---|
| **Caltrans District CCTV** | `cwwp2.dot.ca.gov` (district CCTV JSON) | Free, keyless | Caltrans open data | US-CA | **LIVE** | direct `streamingVideoURL`/`currentImageURL` | REAL fixture (272-cam D3 payload trimmed to 12 Butte-area, rec 2026-07-17); LIVE keyless default; `isLive` honest stream-vs-snapshot; out-of-service dropped. |
| **ALERTWildfire / ALERTCalifornia** | `services8.arcgis.com` — ArcGIS Living Atlas `ALERTCalifornia_Camera_Feed` FeatureServer (`f=geojson`, ~1250 cams, **curl-200 verified 2026-07-17**) | Free, keyless | **CC BY-NC-ND 4.0** (imagery) → **link-only** | US-West | **CACHED** (LIVE-capable) | per-camera **`cameraURL` attribute** (`cameras.alertcalifornia.org/?id=…`, curl 200) — surfaced verbatim, never constructed | ⚠ **Planned "ALERTWest OpenAPI" is DEAD (HTTP 404)** — replaced by the keyless ArcGIS FeatureServer (CW1 spike). `imageURL` **deliberately NOT surfaced** (CC BY-NC-ND forbids rehosting). Mandatory credit **"ALERTCalifornia \| UC San Diego"**. |
| **Windy Webcams** | `api.windy.com` (Webcams API v3; `x-windy-api-key`; bbox N,E,S,W) | Free key (`WINDY_WEBCAMS_API_KEY`) | Windy Webcams API ToS — **mandatory attribution**, link-only | GLOBAL (+RO) | **CACHED** | `urls.detail` else `https://www.windy.com/webcams/{id}` | v3 corroborated; **mandatory badge "Webcams provided by windy.com"**; inactive kept `isLive:false`; secondary, never a sole source. |
| **511 DOT (state traveler info)** | e.g. `511ga.org` (GA pilot schema; per-state) | Free per-state key (`DOT511_API_KEY`) | State DOT open data | US (per-state) | **CACHED** | first Enabled `Views[].Url` dashboard page | GA keyless probe returned `400 Invalid Key` (evidenced) → schema-crafted fixture; state-generic via `SOURCE_DOT511_URL`; fail-fast if LIVE without key. |
| **CNADNR / CNAIR Trafic Live** | official CNAIR public pages (hand-curated, geocoded) | Free, none | Official public agency pages — link-only | RO | **MOCK** | official per-camera page | 5 official pages verified 200 (3× Fetești 44.38,27.83 + 2× Giurgiu 43.90,25.97, town-level curated coords); **MOCK-only, NO server egress** (LIVE→CONFIG error, honest). |

**Excluded (documented).**
- **Insecam-class** unsecured / default-password / non-consenting camera aggregators — **PERMANENT
  constitutional ban** (illegal surveillance; never a link target, regardless of technical feasibility).
  This is the ONLY permanent exclusion.
- **EarthCam & Skyline Webcams** — ToS bar third-party deep-linking/indexing (excluded pending written
  permission).
- **Generic Romanian traffic-cam re-aggregators** — unclear chain-of-rights (excluded pending confirmed
  rights).
- **EO Browser / Copernicus Browser** (external-views, ADR-028) — EO Browser sunset 2026-03-20; no verified
  raw-coordinate URL scheme → roadmap.

**Open extensibility (locked, 2026-07-17).** The camera catalog is OPEN by design: ANY additional camera/
view source — including ones not supported or not included today, and even the currently-excluded ones
should their rights/permissions later be cleared (e.g. EarthCam/Skyline with written permission, RO
aggregators with confirmed chain-of-rights, a paid/commercial directory when a client pays) — can be added
with ZERO core change via the same `SourceAdapterPort<CameraFeed>` + `CameraDirectoryPort` pattern: one
adapter directory (acl + adapter + fixtures + tests) + one `config/adapters.json` manifest row + one
`ADAPTER_FACTORIES` entry + a `SOURCE_<PREFIX>_MODE` (+ optional key) env flag. Mode/key gating means a
gated/paid source ships MOCK/CACHED and flips LIVE per-deployment when the operator has the rights/key.
The ONLY permanent exclusion is the constitutional one: unsecured/non-consenting camera aggregators
(Insecam-class) are banned regardless of technical feasibility. (Mirrored from
`docs/features/LIVE_VIEWS_FEATURE_PLAN.md` + SPEC §12.8.)

---

## 10. Fallback & corroboration deep catalog (added 2026-07-04, D-32)

*Deep sweep so every layer has real fallback depth for **US + Romania + worldwide (any country)**, plus a
citizen/"emergence-of-information" corroboration layer. All free/open; tier verdicts follow the same
LIVE/CACHED/MOCK rules as §§1–8. New sources wire in as adapters (FR-10, one manifest row each) — the
golden path is unchanged; these deepen the ladders.*

### 10.1 Romania — verified deep set (endpoints live-checked 2026-07-02)

| Source | Endpoint | Free/Auth | Data | Tier |
|---|---|---|---|---|
| **ANM warnings JSON** ⭐ | `meteoromania.ro/wp-json/meteoapi/v2/avertizari-generale` (live-verified) | free, keyless | color-coded warnings + county **polygons** | **CACHED** (LIVE-capable) |
| **ANM nowcasting XML-GIS** ⭐ | `meteoromania.ro/avertizari-nowcasting-xml-gis.php` (live-verified) | free, keyless | minutes-scale severe-weather nowcasts + MULTIPOLYGON | **CACHED** (LIVE-capable) |
| ANM obs/forecast feeds | `wp-json/meteoapi/v2/starea-vremii`, `prognoza-orase-xml.php` | free, keyless | observations, city forecasts | CACHED |
| **MeteoAlarm RO Atom→CAP** | `feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-romania` (live-verified; legacy-RSS variant dead since 2026-01; richer `api.meteoalarm.org`) | free, CC BY 4.0 | CAP XML per alert, all 42 counties | **CACHED** |
| INHGA / hidro.ro | `hidro.ro` (`/avertizari-2/`, gauge map ~941 stations) | free, **no API** | hydro warnings, gauge thresholds | CACHED (snapshot; honest: HTML/PDF only) |
| Apele Române | `rowater.ro` + basin sites | free | flood hazard/risk maps, daily bulletins (.doc/PDF) | MOCK/CACHED |
| **Copernicus EMS Rapid Mapping — EMSR758** ⭐ | `rapidmapping.emergency.copernicus.eu` (Galați+Vaslui floods, Sep 2024 — real activation) | free | flood-extent vectors GeoJSON/SHP | **CACHED — the RO demo scenario** |
| EDO Drought WMS | `drought.emergency.copernicus.eu/api/wms` | free | drought/soil-moisture (fire-risk precursor) | CACHED |
| ERCC/ECHO daily maps | `erccportal.jrc.ec.europa.eu` (+ download API) | free | civil-protection daily context | CACHED |
| ANCPI INSPIRE | `geoportal.ancpi.ro/inspireview/rest/services` (ArcGIS REST/WFS) | free, keyless | admin boundaries, cadastral | CACHED (base layers) |
| INS TEMPO | `statistici.insse.ro` REST (JSON) | free, keyless | population by county/locality (exposure) | CACHED |
| data.gov.ro hydrography | CKAN API; basins/rivers/lakes/**dams & dikes** SHP | free | river network + water infra | CACHED |
| RO-ALERT / IGSU / DSU | **no public feed exists** (verified) — cell-broadcast only | — | — | **MOCK** (simulate RO-ALERT-style messages) |
| INFP earthquakes | `infp.ro` + FDSN/EIDA node; EMSC `seismicportal.eu` | free | real-time seismic (extensibility beyond fire/flood) | MOCK now, LIVE-capable |
| EFAS real-time | partner-gated (SMHI agreement); >30-day archive open | gated | flood forecasts | archived-CACHED only |

### 10.2 Lineage reusables (from `mobile-mesh-ews`, the disclosed prior work)

- **Google Earth Engine exports (Sentinel-2 `COPERNICUS/S2_SR`, Landsat-9, MODIS)** — working export code
  with a **Romania ROI already hard-coded** (23–27°E, 44–47°N). ⚠️ GEE is **noncommercial-only + 2026
  quota/annual-reverification** (§10.3) → **research/fixture-generation only, never a shipped dependency**;
  the shipped imagery paths are Copernicus Data Space + Planetary Computer + GIBS. The lineage code is
  still useful offline to pre-generate the RO cached fixtures.
- **Corroboration rulebook** (adopt in ADR-015/E5): density clustering (N correlated reports within a
  radius → certainty↑), **Confirm/Deny** user feedback loop (confirmed-by-many → escalate; denied-by-many
  → false-positive review), edge anonymization (hash+rotate IDs, fuzz GPS unless rescue mode).
- **CAP mapping defaults**: urgency from forecast horizon (<1 h Immediate, <6 h Expected); certainty from
  CI-vs-threshold overlap (Observed/Likely); concrete thresholds (fire idx ≥0.7 + temp >35 °C; precip
  ≥80 mm/6 h) — starting values for `THRESHOLD_RULE` seeds.
- **Offline SOS relay patterns** (post-v1 extensibility): BLE-Mesh/Wi-Fi-Direct micro-alerts + LoRaWAN
  store-and-forward; confidence-tagged report JSON schema.

### 10.3 Worldwide all-country verified feeds (web-verified 2026-07; per-layer ≥2 free global fallbacks)

| Layer | Global stack (primary → fallbacks) | Notes |
|---|---|---|
| **Fire** | FIRMS → **NASA EONET v3** (`eonet.gsfc.nasa.gov/api/v3/events`, keyless curated events) → **GWIS** (JRC WMS, keyless) → GDACS | satellite-derived ⇒ **every country, no gaps** |
| **Flood** | GloFAS (EWDS `ewds.climate.copernicus.eu`, free key) → **NASA LANCE NRT flood** (MCDWD/VCDWD ~250 m observed, Earthdata login; also as GIBS tiles) → GDACS → **Copernicus EMS activations** (public JSON `rapidmapping…/public-activations-info/`) → IMERG/GSMaP precip | model + observation + impact ⇒ every country |
| **Weather** | Open-Meteo → **met.no Locationforecast 2.0** (`api.met.no`, free incl. commercial, CC-BY/NLOD, **mandatory contact User-Agent**) → NASA POWER (context) → NOAA GFS open buckets | global-gridded ⇒ every country |
| **Official CAP alerts** | **WMO Register of Alerting Authorities** (`alertingauthority.wmo.int` — machine-readable feed *discovery*, ~500 authorities) → **IFRC Alert Hub** (`alerthub.ifrc.org`, open-source CAP aggregator) + **WMO SWIC 3.0** (per-source CAP RSS/Atom) → national direct (NWS US, MeteoAlarm EU/RO) | covers every country **that publishes CAP** (~130–150); elsewhere fall back to GDACS severity — label "official where available" (the one honest global gap) |
| **Imagery** | **NASA GIBS/Worldview** (WMTS/XYZ, keyless — drop-in MapLibre tile source; 1000+ layers incl. fires/flood/aerosol) → Copernicus Data Space (S1 SAR flood-through-cloud + S2, free OAuth, quotas) → MS Planetary Computer STAC (free, independent Sentinel mirror) → NOAA GOES (US, public buckets) | 3 independent global paths |
| **Population/impact** | WorldPop → **HDX CKAN API** (global datasets; HAPI beta = only ~25 HRP countries, not US/RO) → **IFRC GO API** (`goadmin.ifrc.org/api/v2`, field reports) → ReliefWeb (registered appname) → ESA WorldCover (context) | ≥2 everywhere |
| **Air/smoke (fire corroboration)** | **OpenAQ v3** (`api.openaq.org/v3`, free key, global incl. US+RO) → Sentinel-5P CO / GIBS aerosol (keyless tiles) → **AirNow** (US official) | 2 global + US extra |
| **Quakes (extensibility)** | USGS GeoJSON feeds (keyless, ~1-min) → EMSC FDSN + WebSocket | every country |

**❌ Verified NOT usable (drop/flag):** **PurpleAir** (paid points-based API — replaced by OpenAQ+AirNow) ·
**Google Earth Engine** (noncommercial-only + 2026 quota/annual-reverification — research-only, never a
shipped dependency; use CDSE/Planetary Computer) · **Google Public Alerts** (no open feed; publisher-ingest
only) · **WFP ADAM API** (gated) · Google FloodHub (still waitlist-gated — optional enrichment only).
**Quiet dependencies:** Earthdata login (LANCE/IMERG), CDSE quotas, met.no User-Agent, ReliefWeb appname.

### 10.4 Citizen/"emergence-of-information" corroboration + verified news aggregation (web-verified 2026-07)

*All corroboration-tier: AI-summarized, confidence-scored via `source_authority` (ADR-015), "Unverified"
badged, human-verified before any action — never auto-trusted (Art. XIV).*

**Citizen-sensor networks (smoke/rain corroboration):**
| Source | Access | Verdict |
|---|---|---|
| **OpenAQ v3** | `api.openaq.org/v3`, free key, CC-BY, global incl. US+RO | **WIRED 2026-08-08 (S3)** — registered + consulted (§0); CACHED default, LIVE needs the key |
| **Sensor.Community** (Luftdaten) | `data.sensor.community`, keyless, ODbL — **good RO density** | **WIRED 2026-08-08 (S3)** — registered + consulted (§0); keyless LIVE |
| **AirNow** | US EPA — the KEYLESS Hourly AQ Obs file product (`files.airnowtech.org`), US official | **WIRED 2026-08-08 (S3)** — registered + consulted (§0); keyless LIVE, North America only |
| PurpleAir | ⚠️ **conflicting verification** (one pass: paid points-API; other: free key w/ attribution + limited redistribution) | default **MOCK**; re-verify ToS at S05 before any use — OpenAQ+Sensor.Community+AirNow cover the need |
| Netatmo public PWS | free dev app, rate-limited, stations opt-in | post-v1 catalog (rain corroboration) |
| CrowdHydrology / CoCoRaHS (ACIS) / Safecast | free; US-centric / daily / off-hazard | post-v1 catalog |

**Official citizen-report patterns:** USGS **"Did You Feel It?"** (`felt`/`cdi` in quake GeoJSON, PD) +
**EMSC felt-reports** (strong Europe/RO) = the authoritative model BEACON's SOS clustering emulates
(extensibility tier). **mPING** (US precip/flood-type reports) = free research key but **no raw
redistribution** → internal-scoring-only if used. Waze/Google-Crisis = partner-gated → EXCLUDED.

**Platforms & meta-signals (post-v1 catalog):** Ushahidi per-deployment API (public posts only) ·
HOT Tasking-Manager new-project signal · OSM Notes API (bbox) · Zooniverse PRN (episodic damage-tagging).

**Social/public feeds:**
| Source | Verdict |
|---|---|
| **Bluesky Jetstream** (`docs.bsky.app` — public JSON stream, keyless, no paid tier) | **the flagship free+ToS-clean social source** (tasked T-179, default mock; fulfills Phase-2 RESPONSIBLE_DATA §2) |
| Mastodon public/hashtag timelines | CACHED via curated instance list (post-v1) |
| Reddit Data API | free non-commercial but **pre-approval required** → MOCK until approved |
| Telegram · X/Twitter · YouTube-ingest · FlightRadar24 · VolcanoDiscovery · PDC API | **EXCLUDED** (scrapy / paid / ToS-incompatible / gated) |

**Mesh/radio emergence (post-v1, unique grid-down signal):** APRS-IS read feed + `aprs.fi` API (low-rate,
no bulk) · **Meshtastic public MQTT** (`mqtt.meshtastic.org`) — MOCK demo tier, pairs with the
mobile-mesh-ews lineage patterns (§10.2). **OpenSky ADS-B** (free non-commercial) = clever air-tanker-
activity fire corroboration (post-v1; flag license before productizing).

**Worldwide verified news-RSS set for NewsIntel aggregation (ranked; each = one agency-RSS config row):**
1) **ReliefWeb** filtered RSS/API (workhorse; registered appname) · 2) **GDACS RSS** · 3) **ECHO/ERCC Daily
Flash** (`gdacs.org/contentdata/xml/daily_flash.json`) · 4) **NASA EONET** · 5) **MeteoAlarm per-country
Atom** (CC-BY-4.0-equiv, covers RO/ANM) · 6) **FloodList** (`floodlist.com/feed`, headline+link+attribution)
· 7) EMSC + Smithsonian-WVAR (extensibility) · 8) Wikipedia Current-events (CC BY-SA, community cross-check)
· 9) national agency RSS per region. **EXCLUDED:** Reuters/AP/AFP (no free RSS), Google News fixed feeds (ToS).

**Incident-driven news-SEARCH ladder (worldwide, verified-sources-only):**
**GDELT DOC 2.0** (`api.gdeltproject.org/api/v2/doc/doc` — keyless, `domainis:` verified-outlet allowlist,
65 langs, ~15-min updates; back off on 429) → **ReliefWeb keyword search** → NewsData.io free tier
(200 credits/day, commercial-ok) → **CC-NEWS** (daily WARC batch, retrospective only).
**EXCLUDED:** Google News RSS search (unofficial + ToS), Bing News API (**retired 2025-08**), NewsAPI/GNews
free tiers (dev-only terms). *(GDELT search mode folds into the existing GDELT adapter T-157.)*

### 10.5 Alternative channels — TV/broadcaster RSS, cams, road, outage-proxy, search (final sweep, verified 2026-07-02)

**Top verified additions (each = one `AGENCYRSS_FEEDS`/manifest config row — zero code change, FR-10):**
| Source | Access | Verdict |
|---|---|---|
| **NIFC WFIGS** ⭐ | `data-nifc.opendata.arcgis.com` FeatureServer, keyless | **best new US wildfire source** — authoritative interagency incidents + **current perimeters** (supersedes CAL FIRE's bot-blocked API); rides the NIFC adapter T-172 |
| **Digi24 RSS** (RO) ⭐ | `digi24.ro/rss` (live-fetched, minutes-fresh) | LIVE — top RO TV feed → AGENCYRSS row |
| **Știrile ProTV RSS** (RO) | `stirileprotv.ro/rss` (live-fetched, TTL 300 s) | LIVE → AGENCYRSS row |
| **HotNews.ro** (RO) | `hotnews.ro/feed` (live-fetched; legacy host dead) | LIVE → AGENCYRSS row |
| **Mediafax** (RO wire) | `mediafax.ro/feed` (verified; replaces broken Agerpres) | LIVE secondary → AGENCYRSS row |
| **Caltrans QuickMap/CWWP** | public data files, 5-min updates, keyless | LIVE — **road-closure input for evac routing** (CA; post-v1 RoutingPort enrichment) |
| **ALERTCalifornia wildfire cams** | via **ArcGIS Living Atlas layer** (explicitly licensed for third-party apps) | LIVE — visual corroboration layer (post-v1 VisionPort; use the Living Atlas path, not cam scraping) |
| **NASA Disasters Mapping Portal** | `maps.disasters.nasa.gov` REST/WMS, no login | LIVE — event-activated flood/fire products |
| **Cloudflare Radar outages + IODA** | Radar `annotations/outages` (free token) · IODA `api.ioda.inetintel.cc.gatech.edu/v2` (keyless) | **REJECTED — licence (2026-08-08).** IODA returns every response under "Copyright © 2021-2025 Georgia Tech Research Corporation. All Rights Reserved." — a public keyless API with **no open-licence grant**, which fails the free/open-data rule (Art. IX). Adapter was written and unit-tested, then **deleted unregistered**; no proxy outage rung ships. Romania's outage layer is derived-only and labels itself so. |
| CNN/CBS/ABC · **Al Jazeera** (`aljazeera.com/xml/rss/all.xml` verified) · DW | section RSS | LIVE → AGENCYRSS world rows |
| Google Alerts RSS | operator-pasted alert URLs, low poll | CACHED (keyword tripwire, e.g. "inundații"; grey for heavy automation) |
| SearXNG (self-hosted metasearch) | AGPL software, operator-run | optional **opt-in plugin only** (proxies engines whose ToS bar automation — ship disabled + documented caveat) |
| 511.org WZDx (Bay Area) · Wikimedia EventStreams (edit-spike signal) · G4Media (UA-blocked, retest) · EUMETSAT Data Store | various | CACHED / experimental post-v1 |

**EXCLUDED (honest reasons):** Brave Search API (free tier abolished 2026-02, metered) · DuckDuckGo search
(no official API) · Kagi/SerpAPI (paid) · **Agerpres** (first-party RSS dead) · TVR/Antena3/NHK (no stable
feed) · Nixle/CodeRED/Everbridge (per-agency or subscriber-only) · **Broadcastify audio** (ToS bans public
redistribution — exactly BEACON's surface) · Watch Duty (no API by design) · Genasys/Zonehaven (partner-only)
· Windy Webcams (10-min token expiry, low-res) · USGS volcano cams (off-scope).

---

## Key findings / changes since Phase 2

1. **Confirmed deprecations / changes** (build the adapter spine to survive these): OpenFEMA uses
   **per-dataset versioning** — specific dataset v1's reach EOL on dated schedules (e.g. 2025-08-18), but
   **there is no API-wide v1 cutoff** (v1/v2/v3 coexist); **NOAA Billion-Dollar Disasters DB closed
   2025-05**; **HIFLD Open portal closed 2025**; ReliefWeb **v1 → v2** (**pre-approved appname** since
   2025-11-01); **USGS `waterservices` legacy decommission = Q1 2027** (degradation ≥ Aug 2026) → new OGC
   API now; **EFFIS canonical domain moved to `forest-fire.emergency.copernicus.eu`**; **InciWeb →
   `inciweb.wildfire.gov`**; X/Twitter free tier gone since **Feb 2023** (excluded). MS **Planetary
   Computer free Hub compute retired 2024-06-06** (data/STAC still free; "Pro" paid).
2. **License caveats:** **xView2/xBD is CC BY-NC-SA 4.0** → MOCK/eval-only, never bundled in the Apache-2.0
   product. OSM is **ODbL** (attribution + share-alike on derived DB) — cache & attribute correctly.
   WorldPop/Open-Meteo/FloodHub forecasts are **CC BY 4.0** (attribution). **Open-Meteo caveat:** its
   free hosted API is **non-commercial**; BEACON (Apache-2.0, non-revenue) qualifies, but for any
   commercial/heavy use **self-host Open-Meteo** (open-source) — a clean fallback consistent with Art. XVI.
3. **Gated-but-free:** Google FloodHub (waitlist/key/GCP), CAMARA (operator), IPAWS aggregate (FEMA) →
   **CACHED/MOCK**, never golden-path-critical.
4. **Strong non-US/global equivalents** secured for the EU-cached region & portability (U4): Copernicus
   EFFIS/GWIS (fire), GloFAS + Google FloodHub (flood), MeteoAlarm/Open-Meteo (weather), OSM/WorldPop/HDX
   (infra/pop), ReliefWeb/GDACS/GDELT (intel) — all free-world.
5. **Golden-path LIVE set (CA flagship) is solid & free:** NASA FIRMS, NWS, OSM Overpass, NOAA NWPS,
   USGS, GDELT, ReliefWeb v2, OpenRouteService, GDACS, Open-Meteo.
6. **Every ⚠ source must be live-re-verified at S05** before flipping its `SOURCE_*_MODE` to `live`;
   default to CACHED/MOCK until confirmed. No source lacks a cache/mock fallback (Constitution XVI).
