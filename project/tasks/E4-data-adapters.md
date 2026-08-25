# Epic E4 — Adapter framework + source adapters (redundancy ladder)

> Owner personas: **eng-data · eng-backend** · Waves W1–W2 · IDs `E4·T-130…T-189`
> Every source = a swappable adapter behind a port: **ACL mapping → last-known-good cache → recorded-mock
> → circuit breaker**, live/cached/mock by config flag (`SOURCE_*_MODE`). Fitness fns **F1** (provenance),
> **F5** (breaker), **F6** (cache). Part A = shared framework + FIRMS exemplar (atomic); Part B = one
> `[PARALLEL]` task per remaining adapter (same file per adapter → no blast-radius collision).

### Part A — Shared adapter framework + FIRMS exemplar
| ID | Task | Persona | Deps | Wave | Tags | Trace | Acceptance |
|---|---|---|---|---|---|---|---|
| T-130 | Author base contract types (Result/Ok/Err, AdapterError+Kind, SourceRecord, CanonicalRecord, FetchResult, Coverage, Region, HealthState, SourceAdapterPort<T>) | eng-backend | E1:ports | W1 | [PARALLEL] {hexagonal}{typescript} | adapter-contract §1-3/ADR-001 | tsc clean; port interface compiles + exported |
| T-131 | Implement `AntiCorruptionMapper<Raw,T>` + PARSE-error convention (never silently drop) | eng-backend | T-130 | W1 | [PARALLEL] {hexagonal}{acl} | adapter-contract §4 | unmappable shape returns/throws typed PARSE |
| T-132 | Implement circuit-breaker utility (CLOSED→OPEN→HALF_OPEN, thresholds/cooldown) | eng-backend | T-130 | W1 | [PARALLEL] {resilience} | adapter-contract §3.1.2/ADR-009/F5 | unit: N failures trip OPEN; cooldown→HALF_OPEN; trial re-CLOSEs |
| T-133 | Circuit-breaker test (F5): OPEN short-circuits to fallback, HALF_OPEN single trial | eng-data | T-132 | W1 | [PARALLEL] {resilience}{testing} | ADR-009/F5 | breaker state transitions match contract table |
| T-134 | Implement last-known-good cache wrapper (serve within ttl, preserve freshness, degraded=true) | eng-data | T-130,E3:CachePort | W1 | [PARALLEL] {resilience}{cache} | adapter-contract §3.1.3/ADR-009/F6 | served-from-cache keeps original freshness + degraded=true |
| T-135 | LKG-cache test (F6): live-fail serves cache; TTL-expiry falls through | eng-data | T-134 | W1 | [PARALLEL] {cache}{testing} | ADR-009/F6 | cache-hit within TTL; cache-miss past TTL falls through |
| T-136 | Implement recorded-mock loader + fixtures convention (`MOCK_FIXTURES_DIR/<id>/*.json`) | eng-data | T-130 | W2 | [PARALLEL] {integration-patterns}{testing} | adapter-contract §3.1.4/ADR-009/OP3 | loads fixture, stamps mode=MOCK, degraded=true |
| T-137 | Mock-loader test + missing-fixture handling (fail-fast CONFIG vs graceful UNAVAILABLE) | eng-data | T-136 | W2 | [PARALLEL] {testing} | ADR-009/OP3 | fixture served as MOCK; absent fixture → typed error |
| T-138 | Implement provenance/SourceRecord stamper (id/source/adapter/fetchedAt/license/mode/url/attribution) | eng-data | T-130 | W1 | [PARALLEL] {provenance} | adapter-contract §2/source-ref.schema/F1 | every emitted CanonicalRecord carries valid SourceRecord |
| T-139 | Provenance stamper test (F1): every datum → SourceRecord validating vs `source-ref.schema.json` | eng-data | T-138 | W1 | [PARALLEL] {provenance}{testing} | source-ref.schema/F1 | record-without-provenance fails; all pass schema |
| T-140 | Implement `withRedundancy()` composing breaker+cache+mock+provenance+timeout/retry (full ladder) | eng-backend | T-132,T-134,T-136,T-138 | W2 | [PARALLEL] {resilience}{integration-patterns} | adapter-contract §3.1/ADR-009 | ladder walks all rungs; sets effective mode/degraded/freshness |
| T-141 | `withRedundancy` ladder test: live→cache→mock→Err(UNAVAILABLE), never dead-end | eng-data | T-140 | W2 | [PARALLEL] {resilience}{testing} | adapter-contract §3.1.5/ADR-009 | all-rungs-fail → unavailable + last freshness |
| T-142 | Implement config resolver (`SOURCE_<PREFIX>_MODE`/url/timeout/keys; fail-fast on missing) | eng-backend | E1:ports | W1 | [PARALLEL] {config}{12-factor} | adapter-contract §5/ADR-012/FR-10 | valid prefix resolves; missing key → CONFIG error at boot |
| T-143 | Implement adapter registry loader (parse `config/adapters.json`, validate vs manifest schema, dynamic-import, region-gate) | eng-backend | T-130,T-142 | W2 | [PARALLEL] {integration-patterns}{config} | adapter-contract §5/manifest-schema/FR-10 | valid manifest builds registry; invalid entry fails boot |
| T-144 | Manifest contract test (FR-10 zero-core-change): port known, module exports SourceAdapterPort, prefix resolves | eng-backend | T-143 | W2 | [PARALLEL] {config}{testing} | FR-10/manifest-schema/U5 | manifest schema-valid; each module wire-checks |
| T-145 | Implement per-adapter `health()` + registry health aggregation (breaker state, lastSuccessAt) | eng-backend | T-140,T-143 | W2 | [PARALLEL] {resilience}{observability} | adapter-contract §3 health/ADR-009 | registry reports AdapterHealth per adapter id |
| T-146 | FIRMS exemplar — adapter stub `firms-adapter.ts` (SourceAdapterPort<HazardGeometry>, mode from `SOURCE_FIRMS_MODE`) | eng-data | T-140 | W2 | [PARALLEL] {integration-patterns} | FIRMS/HazardSource/adapter-contract §6 | stub compiles; registered via manifest `firms` |
| T-147 | FIRMS ACL mapper — hotspot CSV/JSON → HazardGeometry + SourceRecord (NASA public domain); PARSE on bad row | eng-data | T-131,T-146 | W2 | [PARALLEL] {acl}{provenance} | FIRMS/F1/Art.XII | sample hotspot → valid HazardGeometry with provenance |
| T-148 | FIRMS live call (firms.modaps.eosdis.nasa.gov, MAP_KEY from config, timeout+retry, 429→RATE_LIMITED) | eng-data | T-146,T-142 | W2 | [PARALLEL] {integration-patterns} | FIRMS/DATA_SOURCE §1 | success maps rows; 5xx→UNAVAILABLE (mocked http) |
| T-149 | FIRMS recorded mock fixture `firms/hotspots.json` + cache wiring via withRedundancy | eng-data | T-140,T-148 | W2 | [PARALLEL] {testing}{cache} | FIRMS/ADR-009/OP3 | mock mode serves fixture, degraded=true |
| T-150 | FIRMS breaker+LKG wiring assertion (breaker trips → cache → mock) | eng-data | T-149 | W2 | [PARALLEL] {resilience} | FIRMS/ADR-009/F5,F6 | breaker OPEN serves cache then mock |
| T-151 | FIRMS contract test — emits valid HazardGeometry + provenance vs schemas; ACL round-trips golden fixture | eng-data | T-147,T-149 | W2 | [PARALLEL] {testing}{provenance} | FIRMS/F1/adapter-contract §4 | every record schema-valid with SourceRecord |
| T-152 | FIRMS mode-switch test — live/cached/mock each produce usable HazardGeometry + correct mode/freshness | eng-data | T-151 | W2 | [PARALLEL] {config}{testing} | FIRMS/ADR-009/CONFIG §11 | 3 modes each return records + correct mode/degraded |

### Part B — Remaining adapters (one `[PARALLEL]` task each, per framework+FIRMS template = port+ACL+cache+mock+breaker+contract+mode-switch)
| ID | Task | Persona | Deps | Wave | Tags | Trace | Acceptance |
|---|---|---|---|---|---|---|---|
| T-153 | NWS Weather adapter (`api.weather.gov`, US LIVE, CAP→Alert; `NWS_USER_AGENT` req) | eng-data | T-140,T-143,E1:Weather | W2 | [PARALLEL] {integration-patterns} | NWS/Weather/ADR-009/F1 | contract + mock-fallback tests green |
| T-154 | OSM Overpass Infrastructure adapter (GLOBAL LIVE→cached, ODbL) | eng-data | T-140,T-143,E1:Infrastructure | W2 | [PARALLEL] {integration-patterns} | Overpass/ADR-009/F1 | contract + mock-fallback green |
| T-155 | NOAA NWPS FloodGauge adapter (`api.water.noaa.gov/nwps/v1`, US LIVE) | eng-data | T-140,T-143,E1:FloodGauge | W2 | [PARALLEL] {integration-patterns} | NWPS/ADR-009/F1 | contract + mock-fallback green |
| T-156 | USGS Water FloodGauge adapter (new OGC `api.waterdata.usgs.gov`, US LIVE) | eng-data | T-140,T-143,E1:FloodGauge | W2 | [PARALLEL] {integration-patterns} | USGS/ADR-009/F1 | contract + mock-fallback green |
| T-157 | GDELT NewsIntel adapter (`api.gdeltproject.org`, GLOBAL LIVE, 429 backoff) | eng-data | T-140,T-143,E1:NewsIntel | W2 | [PARALLEL] {integration-patterns} | GDELT/ADR-009/F1 | contract + mock-fallback green |
| T-158 | ReliefWeb v2 NewsIntel adapter (`api.reliefweb.int/v2`, GLOBAL LIVE, pre-approved `appname`) | eng-data | T-140,T-143,E1:NewsIntel | W2 | [PARALLEL] {integration-patterns} | ReliefWeb/ADR-009/F1 | contract + mock-fallback green |
| T-159 | OpenRouteService Routing adapter (`api.openrouteservice.org`, GLOBAL LIVE, ORS key) | eng-data | T-140,T-143,E1:Routing | W2 | [PARALLEL] {integration-patterns} | ORS/ADR-009/F1 | contract + mock-fallback green |
| T-160 | Copernicus EFAS/GloFAS HazardSource adapter (CDS API, GLOBAL CACHED) | eng-data | T-140,T-143,E1:HazardSource | W2 | [PARALLEL] {integration-patterns} | GloFAS/ADR-009/F6 | contract + mock-fallback green |
| T-161 | Copernicus EFFIS HazardSource adapter (`forest-fire.emergency.copernicus.eu`, GLOBAL CACHED) | eng-data | T-140,T-143,E1:HazardSource | W2 | [PARALLEL] {integration-patterns} | EFFIS/ADR-009/F6 | contract + mock-fallback green |
| T-162 | MeteoAlarm-RO Weather adapter (CAP/Atom feeds, EU CACHED, RO focus) | eng-data | T-140,T-143,E1:Weather | W2 | [PARALLEL] {integration-patterns} | MeteoAlarm/ADR-009/F6 | contract + mock-fallback green |
| T-163 | Open-Meteo Weather adapter (`api.open-meteo.com`, GLOBAL CACHED, CC-BY-4.0, self-host fallback) | eng-data | T-140,T-143,E1:Weather | W2 | [PARALLEL] {integration-patterns} | Open-Meteo/ADR-009/F6 | contract + mock-fallback green |
| T-164 | FEMA NFHL Flood/Hazard adapter (ArcGIS REST, US CACHED, nightly-cache) | eng-data | T-140,T-143,E1:FloodGauge | W2 | [PARALLEL] {integration-patterns} | NFHL/ADR-009/F6 | contract + mock-fallback green |
| T-165 | WorldPop Population adapter (`worldpop.org`, GLOBAL CACHED, CC-BY-4.0) | eng-data | T-140,T-143,E1:Population | W2 | [PARALLEL] {integration-patterns} | WorldPop/ADR-009/F6 | contract + mock-fallback green |
| T-166 | DOE/ORNL EAGLE-I Outage adapter (public dataset/ArcGIS, US CACHED, historical/assumed-offline) | eng-data | T-140,T-143,E1:Outage | W2 | [PARALLEL] {integration-patterns} | EAGLE-I/ADR-009/F6 | contract + mock-fallback green |
| T-167 | Sentinel-2 / Planetary-Computer catalog adapter (STAC, GLOBAL CACHED, catalog-only) | eng-data | T-140,T-143,E1:HazardSource | W2 | [PARALLEL] {integration-patterns} | Sentinel/ADR-009/F6 | contract + mock-fallback green |
| T-168 | Google FloodHub HazardSource adapter (gated API, CACHED/MOCK default, CC-BY-4.0) | eng-data | T-140,T-143,E1:HazardSource | W2 | [PARALLEL] {integration-patterns} | FloodHub/ADR-009/OP3 | contract + mock-fallback green |
| T-169 | OpenCelliD Telecom adapter (`opencellid.org`, GLOBAL CACHED, key, CC-BY-SA) | eng-data | T-140,T-143,E1:Telecom | W2 | [PARALLEL] {integration-patterns} | OpenCelliD/ADR-009/F6 | contract + mock-fallback green |
| T-170 | FEMA NRI Population/Risk adapter (`hazards.fema.gov/nri`, US CACHED, baseline vulnerability) | eng-data | T-140,T-143,E1:Population | W2 | [PARALLEL] {integration-patterns} | FEMA-NRI/ADR-009/F6 | contract + mock-fallback green |

### Part B (cont.) — portal-named sources, concretized 2026-07-04 (D-31; same template, all [PARALLEL])
| ID | Task | Persona | Deps | Wave | Tags | Trace | Acceptance |
|---|---|---|---|---|---|---|---|
| T-171 | GDACS NewsIntel/Hazard adapter (`gdacs.org` feeds, GLOBAL **LIVE-capable**, cached/mock fallback — demo live set remains FIRMS+NWS per DEMO_SCRIPT) | eng-data | T-140,T-143,E1:NewsIntel | W2 | [PARALLEL] {integration-patterns} | GDACS/ADR-009/F1 | contract + mock-fallback green |
| T-172 | NIFC **WFIGS** HazardSource adapter (`data-nifc.opendata.arcgis.com` FeatureServer, keyless — authoritative US interagency incidents + **current perimeters**; supersedes CAL FIRE's bot-blocked API; §10.5 ⭐) | eng-data | T-140,T-143,E1:HazardSource | W2 | [PARALLEL] {integration-patterns} | NIFC-WFIGS/§10.5/F6 | contract + mock-fallback green |
| T-173 | US Census/ACS Population adapter (`api.census.gov`, US **CACHED** — feeds impact-over-time §5.6) | eng-data | T-140,T-143,E1:Population | W2 | [PARALLEL] {integration-patterns} | Census/ADR-009/F6 | contract + mock-fallback green |
| T-174 | InciWeb NewsIntel adapter (`inciweb.wildfire.gov`, US **CACHED**) | eng-data | T-140,T-143,E1:NewsIntel | W2 | [PARALLEL] {integration-patterns} | InciWeb/ADR-009/F6 | contract + mock-fallback green |
| T-175 | Agency-RSS NewsIntel adapter (CalFire + configurable feed list, **LIVE**) | eng-data | T-140,T-143,E1:NewsIntel | W2 | [PARALLEL] {integration-patterns} | agency-RSS/ADR-009/F1 | contract + mock-fallback green |
| T-176 | ITU connectivity adapter (Disaster Connectivity Maps, GLOBAL **MOCK** — gated data) | eng-data | T-140,T-143,E1:Telecom | W2 | [PARALLEL] {integration-patterns} | ITU/ADR-009/OP3 | contract + mock-fallback green |
| T-177 | Vetted-social intake adapter (official-agency accounts only, **CACHED/MOCK**; feeds `source_authority` confidence — never auto-trusted, Art. XIV) | eng-data | T-140,T-143,E1:NewsIntel | W2 | [PARALLEL][SEC] {integration-patterns} | PRD§4.2/ADR-015/F12 | contract + mock-fallback green; unverified badge propagates |

### Part B (cont.) — deep-catalog fallback/corroboration adapters, added 2026-07-04 (D-32; same template, all [PARALLEL])
| ID | Task | Persona | Deps | Wave | Tags | Trace | Acceptance |
|---|---|---|---|---|---|---|---|
| T-178 | **HDX (CKAN API)** Population/impact adapter (global datasets; RO population fallback — Phase-2-promised) | eng-data | T-140,T-143,E1:Population | W2 | [PARALLEL] {integration-patterns} | HDX/§10.3/F6 | contract + mock-fallback green |
| T-179 | **Bluesky Jetstream** public-signal adapter (keyless JSON stream; keyword/geo filter; Phase-2 RESPONSIBLE_DATA §2 promise; feeds `source_authority`, never auto-trusted) | eng-data | T-140,T-143,E1:NewsIntel | W2 | [PARALLEL][SEC] {integration-patterns} | Bluesky/§10.4/Art.XIV/F12 | contract + mock-fallback green; Unverified badge propagates |
| T-180 | **NASA EONET v3** curated-event adapter (keyless GeoJSON; global multi-hazard event index) | eng-data | T-140,T-143,E1:HazardSource | W2 | [PARALLEL] {integration-patterns} | EONET/§10.3/F1 | contract + mock-fallback green |
| T-181 | **GWIS (JRC)** global fire adapter (keyless WMS; fire-danger + burnt areas — global FIRMS/EFFIS fallback) | eng-data | T-140,T-143,E1:HazardSource | W2 | [PARALLEL] {integration-patterns} | GWIS/§10.3/F6 | contract + mock-fallback green |
| T-182 | **NASA LANCE NRT flood** adapter (MCDWD/VCDWD ~250 m observed flood; Earthdata token; GIBS-tile alt) | eng-data | T-140,T-143,E1:HazardSource | W2 | [PARALLEL] {integration-patterns} | LANCE/§10.3/F6 | contract + mock-fallback green |
| T-183 | **met.no Locationforecast** weather adapter (keyless; **mandatory contact User-Agent**; CC-BY/NLOD — 2nd global weather fallback) | eng-data | T-140,T-143,E1:Weather | W2 | [PARALLEL] {integration-patterns} | met.no/§10.3/F6 | contract + mock-fallback green |
| T-184 | **OpenAQ v3** air/smoke adapter (free key; global incl. US+RO — wildfire-smoke corroboration) | eng-data | T-140,T-143,E1:Infrastructure | W2 | [PARALLEL] {integration-patterns} | OpenAQ/§10.4/F6 | contract + mock-fallback green |
| T-185 | **Worldwide CAP aggregator** adapter (Alert-Hub.org filtered feeds + IFRC Alert Hub; WMO Register of Alerting Authorities for per-country feed discovery — official alerts for ~200 feeds/all CAP-publishing countries) | eng-data | T-140,T-143,E1:Weather | W2 | [PARALLEL] {integration-patterns} | Alert-Hub/§10.3/F1 | contract + mock-fallback green; alerts labeled "official where available" |
| T-186 | **ANM Romania** adapter (live-verified keyless `wp-json/meteoapi/v2/avertizari-generale` JSON + nowcasting XML-GIS polygons — richer than MeteoAlarm for RO) | eng-data | T-140,T-143,E1:Weather | W2 | [PARALLEL] {integration-patterns} | ANM/§10.1/F6 | contract + mock-fallback green |
| T-187 | **Copernicus EMS Rapid-Mapping activations** adapter (public JSON `public-activations-info/`; flood-extent vectors; **EMSR758 = the RO demo scenario fixture**) | eng-data | T-140,T-143,E1:HazardSource | W2 | [PARALLEL] {integration-patterns} | CEMS-RM/§10.1/§10.3/F6 | contract + EMSR758 fixture green |
| T-188 | **Sensor.Community** citizen-PM adapter (keyless, ODbL — **RO citizen-sensor density**; smoke corroboration) | eng-data | T-140,T-143,E1:Infrastructure | W2 | [PARALLEL] {integration-patterns} | Sensor.Community/§10.4/F6 | contract + mock-fallback green |
| T-189 | **AirNow** US-official air/smoke adapter (free key; US-only → `NOT_COVERED` for RO) | eng-data | T-140,T-143,E1:Infrastructure | W2 | [PARALLEL] {integration-patterns} | AirNow/§10.4/F6 | contract + mock-fallback green |

*Port note (audit D-33): the three air/smoke adapters (T-184 OpenAQ, T-188 Sensor.Community, T-189 AirNow)
deliberately ride `E1:Infrastructure` — no dedicated air/environment port exists in P1–P15, and smoke-PM
readings are treated as environmental-condition observations on the infrastructure/exposure layer feeding
hazard corroboration; if E5 grows a distinct AirQuality concept, split a thin port then (zero-core-change).*

*Manifest note (D-33): `config/adapters.json` currently seeds the **8 golden-path entries** as the worked
exemplar; the remaining adapters register their own manifest row as part of each task's acceptance (the
registry is data-driven — SPEC §4.2). `config/regions.json` (CA + Romania) now exists and gates adapters
per region.*

*E4 headroom is now fully allocated (T-130…T-189). Post-v1 catalog additions (Netatmo, CrowdHydrology,
Ushahidi, OSM-Notes, HOT-TM, APRS/Meshtastic, OpenSky, Mastodon, Reddit-pending-approval, Charter
activations, self-host Valhalla/OSRM) are documented in `audit/DATA_SOURCE_VERIFICATION.md §10.4` — each
lands later as one manifest row + one templated task, zero core change (FR-10). **GDELT DOC 2.0
incident-search mode** folds into T-157's acceptance (search + monitor modes). ⚠️ PurpleAir = conflicting
ToS verification → MOCK only, re-verify at S05. Google Earth Engine = research-only (noncommercial terms),
never a shipped dependency.*

**Open items (S05):** ① Re-verify every `⚠` source before flipping `SOURCE_*_MODE=live` (NIFC/IRWIN, Vantor/Planet, EAGLE-I live, HIFLD, IPAWS, CAMARA) — default CACHED/MOCK until confirmed. ② USGS: pin new OGC host (legacy decommissions Q1 2027). ③ ReliefWeb `appname` must be registered (v1 gone). ④ **Romania has no LIVE national hazard/gauge feed** — it is a CACHED region on GloFAS+EFFIS+MeteoAlarm-RO+Open-Meteo global-equivalents; US-only sources (NFHL/EAGLE-I/NRI) return `NOT_COVERED` for RO (surface as "not available in this region," OP4). ⑤ Licensing tracked in NOTICE (OSM ODbL, CC-BY-4.0 for WorldPop/Open-Meteo/FloodHub, CC-BY-SA OpenCelliD). ⑥ **xView2/xBD NOT bundled** (CC BY-NC-SA 4.0) — eval/model-only, no adapter row. CAMARA MOCK handled in E7 (ADR-021).
