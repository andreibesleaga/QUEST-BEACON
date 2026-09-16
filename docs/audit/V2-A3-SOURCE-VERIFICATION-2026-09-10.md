# V2 · WP A3 — source truth-ups for "all possible live"

**Verification date: 2026-09-10** (all probes below were made on this date, from this WSL box, against the
live production services — no credentials of any kind were sent except where a row says otherwise).
**Branch:** `feat/v2-live-production` · **Scope:** verification + honesty only. **No source file was changed
by this work package** (see §5 for the code/env changes this evidence *implies*, which are reported, not made).

This document exists because §1 of [`docs/LIVE_PRODUCTION_GUIDE.md`](../LIVE_PRODUCTION_GUIDE.md) makes
a public, checkable claim about how many adapters can serve live. A claim like that decays: upstreams
move, hosts come back, TLS stacks change. A3 re-derives every non-live row from a response recorded
today, and changes the doc — never the claim — where the two disagree.

**Honesty law applied here:** a label is upgraded only on a recorded HTTP 200 that carried *real features*.
A recorded reason that is no longer true is replaced with today's observation and today's date, even when
the old reason was more convenient.

---

## 1. Probe table

Status lines are the literal output of
`curl -sS -o /dev/null -w '%{http_code} %{content_type} %{size_download}B' --max-time N -L <url>`
(redirects followed, so a `301 → 404` chain reports the final `404`).

### 1.1 EFFIS — the one verdict that moved

| # | Endpoint | HTTP / type / size | Real features? | Verdict |
|---|---|---|---|---|
| E1 | `https://forest-fire.emergency.copernicus.eu/effis/rest/services/CurrentSituation/BurntAreas/FeatureServer/0/query?f=geojson&where=1%3D1&outFields=*` — the adapter's `DEFAULT_BASE_URL` | `404 application/xml 360B` (after one 301 to `data.effis.emergency.copernicus.eu`) | **NO** | **Still dead.** The 2026-08 "confirmed dead" finding reproduces exactly. |
| E2 | `https://maps.effis.emergency.copernicus.eu/effis?service=WMS&request=GetCapabilities&version=1.3.0` | `200 text/xml; charset=UTF-8 104545B` | n/a (capabilities) | Service is alive: 40+ queryable layers (`all.hs`, `modis.ba.poly`, `effis.nrt.ba.poly`, …). |
| E3 | same host, `REQUEST=GetFeatureInfo&INFO_FORMAT=application/json` | `200` but body is a `ServiceExceptionReport`: `msWMSFeatureInfo(): WMS server error. Unsupported INFO_FORMAT value (application/json).` | **NO** | WMS advertises only `text/html`, `application/vnd.ogc.gml`, `text/plain`. **No GeoJSON route.** |
| E4 | same host, `INFO_FORMAT=text/plain`, `LAYERS=all.hs`, Iberia box `35,-10,45,5` | `200 text/plain 55B` → `GetFeatureInfo results:\n\n  Search returned no results.` | **NO** | Click-protocol, same shape as GloFAS; not an enumeration route. |
| E5 | `https://maps.effis.emergency.copernicus.eu/effis?service=WFS&request=GetCapabilities&version=1.1.0` | `000` — `curl: (28) Operation timed out after 60000 milliseconds with 0 bytes received` (also timed out at 25 s on `version=2.0.0`) | **NO** | No usable WFS. |
| **E6** | **`https://api.effis.emergency.copernicus.eu/rest/2/burntareas/current/`** | **`200 application/json 509469B`** (13.3 s, one 301 to add the trailing slash) | **YES** | **A real, free, unauthenticated EFFIS endpoint EXISTS.** `{"count":127594,…,"results":[…]}`, each row a `MultiPolygon` with `firedate` / `lastupdate` / `country` / `area_ha`. Newest row at probe time: `firedate 2026-09-09T12:32+02:00`, `lastupdate 2026-09-10T14:58:13+02:00` — **today**. |
| E7 | `…/burntareas/current/?country=RO&limit=1&ordering=-firedate` | `200 application/json 14346B` | **YES** | `count=5554`; newest `2026-09-07T11:10+02:00`, Mehedinţi, `MultiPolygon`. |
| E8 | `…?country=ES&limit=1&ordering=-firedate` | `200 application/json 2223B` | **YES** | `count=12597`; newest `2026-09-08T12:32+02:00`, Zaragoza. |
| E9 | `…?country=EL&limit=1&ordering=-firedate` | `200 application/json 5987B` | **YES** | `count=2542`; newest `2026-09-08T00:33+02:00`, Δράμα. **Greece is `EL`, not `GR`** — `?country=GR` returns `count=0`. |
| E10 | `…?country=US` / `?country=PH` | `200 application/json` | **NO** | `count=0` for both. This collection has no US or Philippines coverage; `us-ca` and `ph` gain nothing from EFFIS. |
| E11 | `…?format=geojson` | `404 application/json 23B` → `{"detail":"Not found."}` | — | The API has **no GeoJSON output format**. |
| E12 | `…?bbox=-10,35,5,45` | `200 application/json` | — | `count` unchanged at `127594` — **the `bbox` parameter is silently ignored**. Filtering is by `country=`, ordering by `ordering=`. |

**How E6 was found (so it can be re-found):** the old EFFIS Current Situation Viewer at
`/apps/effis_current_situation/` now serves a page whose stylesheet is literally `css/decommissioned.css`
and whose text reads *"The EFFIS Current Situation Viewer Version 1 has been decommissioned … You are
being automatically redirected to the new Version 2"*. The V2 viewer (`/apps/effis.csv/`, a Nuxt SPA,
`version 2.9.5`) declares its own data endpoints in chunk `_nuxt/DjF8GMaP.js`:
`toolbar:{bal:{…,url:"https://api.effis.emergency.copernicus.eu/rest/2/burntareas/current",…}}`.
That is the endpoint the official viewer itself uses.

**Why EFFIS nevertheless stays CACHED in this build — the blocker moved, it did not disappear.**
`parseEffisFeatures` (`src/adapters/sources/effis/effis-acl.ts:57-61`) does
`JSON.parse(text) as { features?: EffisFeature[] }` and maps `f.geometry` + `f.properties`. The v2 API
returns a Django-REST paginated envelope — `{count, next, previous, results[]}` — with geometry under
`shape` and the attributes flat on the row, **not** a GeoJSON `FeatureCollection`. Pointed at E6 today the
adapter would parse **zero** features and degrade silently-but-honestly to cache. So:

> **EFFIS verdict 2026-09-10: the endpoint question is CLOSED (a keyless live endpoint exists and was
> proven), the adapter question is OPEN (the ACL cannot read that shape).** `effis` stays **CACHED** in
> this build. It is no longer "an unconfirmed URL / account-gated extract" — that reason is retired. See
> PLAN-DELTA §5.1.

### 1.2 The eight re-verified non-live rows

| Source | Endpoint probed today | HTTP / type / size | Real features? | Recorded reason still true? |
|---|---|---|---|---|
| `eagle-i` | `https://openenergyhub.ornl.gov/explore/dataset/eaglei_outages_2014/` | `200 text/html; charset=utf-8 88551B` | **NO** — `<title>EAGLE-I historic outages 2014-2025 — OpenEnergyDataPortal</title>`, an HTML browse page | **YES, unchanged.** Still a dataset explore page, not an API. Live outage feeds remain entitled-agency only. Stays CACHED + derived "ASSUMED offline". |
| `glofas` | `https://ows.globalfloods.eu/glofas-ows/ows.py?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities` | `200 text/xml; charset=UTF-8 147665B` | yes (capabilities, byte-identical to the WP A11 record) | **NO — the recorded reason is STALE and is replaced.** See §1.3. |
| `usgs-water` | `https://api.waterdata.usgs.gov/ogcapi/v0/collections` | `200 application/json; charset=utf-8 199377B` | host healthy — 37 collections, `latest-continuous` present | **YES, unchanged** — and the blocker is *ours*, not theirs: `buildUrl` at `src/adapters/sources/usgs-water/usgs-water-adapter.ts:132-134` still emits the legacy IV query `?format=json&bBox=…&parameterCd=…` against the OGC host. MOCK remains the honest default. |
| `anm` | `https://www.meteoromania.ro/wp-json/meteoapi/v2/starea-vremii` (the exact path `AnmAdapter.fetchLive` builds, `anm-adapter.ts:52-53,129-130`) | **`200 application/json; charset=UTF-8 65582B`** in **1.14 s** | **YES** — `{"success":true,"type":"FeatureCollection","date":"2026-09-10T20:00:00+03:00","features":[…]}` | **NO — the recorded reason is FALSE today.** The TLS handshake refusal did **not** reproduce from this environment. Secondary check: `…/avertizari-generale` → `200 application/json 88174B`, warning issued `2026-09-10T10:00`. |
| `cnadnr-ro` | `https://www.cnadnr.ro/ro/trafic-live` and `…/fetesti-bucuresti-constanta-camera-1` | **`403 text/html 373B`** (both) | **NO** | **Structural reason YES; the supporting note is now STALE.** There is still no machine-readable feed — that is unchanged and decisive. But the DSV line "5 official pages verified 200" is no longer reproducible: those pages now answer **403** to a server-side request. MOCK-only remains correct, and is now *more* correct. |
| `hifld` | `https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/Critical_Infrastructure_Map_Service/FeatureServer?f=json` | `200 application/json; charset=utf-8 5875B` | service alive (10+ layers incl. *Electric Power Generation Plants*) | **YES, and now positively proven.** Layer 5 reports `editingInfo.dataLastEditDate = 1560435855899` = **2019-06-13**. The "static 2019 package" claim is no longer an inference — it is the service's own timestamp. Stays HELD by design. |
| `itu` | `https://www.itu.int/itu-d/sites/dcm/` · `https://datahub.itu.int/api/` | `404 text/html 26632B` · `403 text/html 919B` | **NO** | **YES, unchanged.** No keyless route to Disaster Connectivity Maps. MOCK-only by design. |
| `camara-gsma` | `https://sandbox.opengateway.telefonica.com/` · GSMA Open Gateway API-descriptions page | `200 text/html; charset=utf-8 2015B` (a developer-portal landing page, not an API) · `403 text/html 5710B` | **NO** | **YES, unchanged.** Reaching a portal is not reaching an API: every Open Gateway call still needs operator onboarding. MOCK-only by design. |
| `worldpop` | `https://api.worldpop.org/v1/services/stats?dataset=wpgppop&year=2020&geojson=<0.1°×0.1° box near Bucharest>` | `200 application/json 152B` | **NO** — body is `{"status":"created","status_code":200,"error":false,"error_message":null,"taskid":"4ed3574f-…"}` | **YES, unchanged.** Still an **asynchronous task API**: a handle, not data. The adapter implements no task-poll rung, so **CACHED stays**, exactly as guide §1 footnote 5 says. |

### 1.3 `glofas` — the row that improved (WP A11, re-verified independently today)

`glofas` was migrated to the strict OGC WMS endpoint earlier today by the A11 agent. This WP re-ran the
evidence rather than trusting the note:

| # | Request | HTTP / type / size | Real features? |
|---|---|---|---|
| G1 | `GetCapabilities` on `https://ows.globalfloods.eu/glofas-ows/ows.py` | `200 text/xml; charset=UTF-8 147665B` | yes — `<WMS_Capabilities version="1.3.0">`, layer `RPG_U_GLOFAS_3_3` `queryable="1"` |
| G2 | `GetFeatureInfo` at the recorded China/Salween recipe (`BBOX=29.874,97.174,29.876,97.176`, 512×512, I/J=256, `INFO_FORMAT=text/html`) | `200 text/html 26365B` | **YES** — 2 × `tbl_info_point`, Point ID `DM001736` |
| G3 | `GetFeatureInfo` at the **Romanian** Siret/Lungoci point (`BBOX=45.574,27.524,45.576,27.526`) | `200 text/html 26315B` | **YES** — 2 × `tbl_info_point`, Station `G0578`, Point ID **`SI001084`**, River Siret, Station Name Lungoci, **Forecast Date `2026-09-10`**, Alert level `Inactive`, peak forecast in 5 days |
| G4 | same recipe at `27.9457,45.4353` (the *illustrative* coordinate used in `glofas-adapter.test.ts:147`) | `200 text/html **10B**` — empty body | **NO** — nothing within the ~0.02° click tolerance |

**No credentials were sent in G1–G4.** `GLOFAS_CDS_KEY` was not read.
G4 is worth keeping: it is the measured proof that `SOURCE_GLOFAS_POINTS` must contain **real reporting-point
coordinates**, not merely coordinates inside the region — an in-bbox guess returns a 200 with nothing in it.

---

## 2. Per-region LIVE matrix (2026-09-10)

Driven by the **real code**, not by hand-probing: `createHttpDepsLive()` + `handleHttp` from
`src/adapters/channels/http/http-dispatcher.ts` (the same entry `scripts/live-probe.ts` uses), with
`DATA_SOURCE_COMPOSITION=adapters` and the guide-§3 "all possible live" profile applied as shell
overrides — class A keyless + every class B whose credential is present in `.env`
(all nine except `CENSUS_API_KEY`, which is empty), and class C/D/E left at their honest defaults.

`GET /api/v1/regions/<id>/map` as `RESPONDER`. `mode` is the rung the redundancy engine actually served
from, so `LIVE` here means *this adapter really answered over the network for this bbox, in this run*.

| Region | HTTP | **LIVE sources** | LIVE ids | Fell back (`MOCK`) | Map arrays returned |
|---|---|---|---|---|---|
| `us-ca` | 200 | **8** | `alertwildfire` `firms` `metno` `nifc` `nwps` `nws` `open-meteo` `windy-webcams` | `caltrans-cctv` `dot511` `eagle-i` `nfhl` `opencellid` `osm-overpass` `usgs-water` | hazards 29 · gauges 2 · infrastructure 3 · shelters 1 · reports 1 · predictions 1 · route.path 3 · outage 5 · cell 6 · weather 2 · floodZones 4 · cameras 268 |
| `ro` | 200 | **4** | `firms` `metno` `open-meteo` `windy-webcams` | `anm` `cnadnr-ro` `effis` `glofas` `opencellid` `osm-overpass` | hazards 114 · gauges 4 · infrastructure 3 · shelters 1 · reports 1 · predictions 1 · route.path 3 · cell 6 · weather 2 · floodZones 1 · cameras 55 |
| `es` | 200 | **4** | `firms` `metno` `open-meteo` `windy-webcams` | `effis` `glofas` `opencellid` `osm-overpass` | hazards 55 · gauges 4 · infrastructure 3 · predictions 1 · cell 6 · weather 2 · cameras 50 |
| `gr` | 200 | **4** | `firms` `metno` `open-meteo` `windy-webcams` | `effis` `glofas` `opencellid` `osm-overpass` | hazards 92 · gauges 4 · infrastructure 3 · predictions 1 · cell 6 · weather 2 · cameras 50 |
| `ph` | 200 | **4** | `firms` `metno` `open-meteo` `windy-webcams` | `glofas` `opencellid` `osm-overpass` | hazards 4 · gauges 4 · infrastructure 3 · cell 6 · weather 2 · cameras 10 |

Run timestamps (the `freshness` each response carried): `us-ca` 18:12:28Z · `ro` 18:12:45Z ·
`es` 18:13:08Z · `gr` 18:13:30Z · `ph` 18:13:50Z.

### 2.1 `meteoalarm-es` / `meteoalarm-gr` — verified directly (they are expected live and they are)

The plan calls these two out by name, so they were probed at their own upstream rather than left to a
surface that does not consult them. `MeteoalarmAdapter`'s `defaultUrl` is
`https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-<country>`
(`src/adapters/sources/meteoalarm/meteoalarm-adapter.ts:67-83`), keyless:

| Adapter | Feed | HTTP / type / size | Real features? |
|---|---|---|---|
| `meteoalarm-gr` | `…-greece` | `200 application/atom+xml; charset=utf-8 5596B` | **YES** — 3 `<entry>`, feed `<updated>2026-09-10T18:06:03Z` |
| `meteoalarm-es` | `…-spain` | `200 application/atom+xml; charset=utf-8 214535B` | **YES** — 137 `<entry>`, feed `<updated>2026-09-10T18:05:23Z` |
| `meteoalarm-ro` | `…-romania` | `200 application/atom+xml; charset=utf-8 106720B` | **YES** — 69 `<entry>`, feed `<updated>2026-09-10T18:05:31Z` |

All three are keyless, live and current as of today. The class-A listing for them is confirmed, not assumed.

### 2.2 Method note — what was attempted and abandoned, so nobody repeats it blind

A second pass was written to drive `GET /api/v1/sources?regionId=<id>` (the full per-region provenance
catalogue, all enabled adapters rather than the map slice) and `GET /api/v1/regions/<id>/incidents`.
Under the full "all possible live" profile it ran for **over 25 minutes without emitting its first
region** and was killed. That is consistent with §2 note 3 — a shared Overpass endpoint and several slow
keyless feeds, all being hit for the first time with cold caches. It produced **no data, so no claim from
it appears anywhere in this document**. If a future WP wants the full catalogue matrix, run it per-region
with a shortened per-source timeout rather than all five in one process.

**Reading this table honestly — five things it does and does not say.**

1. **These are the *map* adapters only.** `/regions/:id/map` consults the map-derivation slice (15 / 10 /
   8 / 8 / 7 provenance rows respectively), not all 31 / 25 / 22 / 22 / 20 adapters `config/regions.json`
   enables for each zone. `meteoalarm-es` and `meteoalarm-gr` are `NewsIntel` adapters and correctly do
   **not** appear here — the news-fusion surface is where they serve. Their non-appearance is a surface
   boundary, **not** a failure. They were verified separately instead, in §2.1.
2. **PH really does rely on the global adapters, and it worked.** `firms` + `metno` + `open-meteo` all
   served LIVE for the Philippines bbox and produced 4 hazards. That is a small number because **the PH
   region had almost no active fire detections at probe time** — *sources live, no active incidents*, which
   is a true and acceptable result, not a defect.
3. **`osm-overpass` and `opencellid` were set LIVE and still served MOCK** in every region. That is the
   redundancy ladder doing its job under a rate-limited shared Overpass endpoint and a slow/limited
   OpenCellID; it is honest degradation, visibly labelled, and it is why the guide's "LIVE-capable" count
   is a *ceiling* rather than a promise about any single run.
4. **`nfhl`, `caltrans-cctv` and `dot511` served MOCK in `us-ca`** this run despite LIVE mode and a present
   `DOT511_API_KEY`. Recorded as observed; not investigated under A3 (out of scope), and not claimed as live.
5. **`effis`, `glofas`, `anm`, `cnadnr-ro`, `eagle-i`, `usgs-water` show `MOCK`** because this run left them
   at their documented CACHED/MOCK defaults — the ladder's fallback label, not a failed live attempt.

---

## 3. Every documentation line changed, and why

### 3.1 `docs/LIVE_PRODUCTION_GUIDE.md` §1

All edits are **additive**: the owner's original sentence is preserved verbatim in every cell, with a
dated `**2026-09-10 re-verified:**` clause appended. No section was rewritten.

| Line(s) after edit | Row | Change | Why |
|---|---|---|---|
| 42–50 | class-count table / the "35 of 44" headline | **Appended** a dated delta block. The table (lines 30–36) and the headline paragraph (38–40) are left **byte-identical**. | The ceiling genuinely moved: A 26→28, C 2→1, D 5→4 ⇒ **37 of 44** on free credentials, **38** with the entitled EAGLE-I endpoint. Rewriting the owner's on-camera number in place would erase the baseline the delta is measured against; appending records both, and says which rows moved. |
| 57 | class A list | **Appended** `` `glofas`⁶ `` and `` `anm`⁷ `` to the keyless-live list. | Both proved live and keyless today (§1.2, §1.3). |
| 59 | class A list | **Added** a one-line marker: "⁶⁷ added 2026-09-10 (WP A3) … both were re-classified on a recorded 200." | So a reader scanning only the list sees that two entries are newer than the rest, and on what basis. |
| 71–72 | footnote 5 (`worldpop`) | **Appended** a dated re-verification sentence; the owner's original footnote text is untouched. | The WP requires `worldpop`'s recorded reason to be re-confirmed, not assumed. It was: still an async task handle. |
| 73–80 | **new** footnote 6 (`glofas`) | **Added.** | States the recovery *and* its load-bearing limit: LIVE coverage is exactly `SOURCE_GLOFAS_POINTS`, and those must be real reporting points — an in-bbox guess returns `200` with an empty body (evidence G4). Without that sentence the class-A listing would over-promise. |
| 81–86 | **new** footnote 7 (`anm`) | **Added.** | Dates the recovery, keeps the old TLS finding visible as history, and tells the operator to re-check from *their* network because the original block was environmental. |
| 109 | class C · `effis` | **Appended** the 2026-09-10 finding; original sentence preserved verbatim ahead of it. | Both halves of the recorded reason are now wrong: the URL is no longer unconfirmed (E6) and nothing is account-gated. The row now names the real blocker (ACL shape) and points at PLAN-DELTA §5.1. |
| 115 | class D · `glofas` | **Appended** `SUPERSEDED 2026-09-10` + the WMS evidence; the original decommissioning sentence is struck through but **kept**, because half of it is still true. | The keyless JSON facade is indeed gone; the operative fact is that a different keyless route is live and proven (G1–G3). |
| 116 | class D · `usgs-water` | **Appended** `Re-verified 2026-09-10` + the `file:line` of our own blocker. | Reason holds; evidence refreshed, and the blocker is attributed to our `buildUrl` rather than to USGS. |
| 117 | class D · `anm` | **Appended** `SUPERSEDED 2026-09-10` + the 200/FeatureCollection evidence; original TLS sentence struck through but kept. | The recorded reason is false today from this environment. |
| 118 | class D · `cnadnr-ro` | **Appended** the 403 observation. | The structural reason stands; the "and verified" half must not be left implying a current 200. |
| 119 | class D · `hifld` | **Appended** the `dataLastEditDate` proof. | Turns "static 2019 package" from a claim into the service's own timestamp. |
| 125–129 | class E | **Appended** a dated re-verification paragraph. | Both reasons were re-probed and both still hold; the reader should see the date rather than assume freshness. |
| 52 / 104 / 111 | the three class headings `(26)` / `(2)` / `(5)` | **Annotated** in place: `26 → **28**`, `2 → **1**`, `5 → **4**`, each tagged `as of 2026-09-10, WP A3`. | A heading that says "(26)" above a list of 28 entries is a defect on its own; the arrow keeps the original number visible. |
| §3 all-live profile block (`class D/E stay honest`) | `SOURCE_GLOFAS_MODE` / `SOURCE_ANM_MODE` | **Added** a dated comment above the two lines pointing at footnotes 6 and 7, incl. the `SOURCE_GLOFAS_POINTS` value proven in G3. The two `=cached` lines themselves are unchanged. | §3 is outside §1 but would otherwise contradict it. The lines stay `cached` because the *mode decision* is the owner's; the comment removes the false implication that live is impossible. |

### 3.2 `audit/DATA_SOURCE_VERIFICATION.md`

| Line(s) after edit | Row | Change | Why |
|---|---|---|---|
| 85–98 | 2026-08-08 live-trial block | **Appended** a dated `RE-PROBED 2026-09-10 (WP A3)` block under the four-candidate trial table. The 2026-08-08 table itself is untouched. | Three of the four verdicts still stand; `effis` now has a materially different endpoint answer and must not be read as still-current without the delta. |
| 132 | `glofas` row — credential column | `` `GLOFAS_CDS_KEY` for live `` struck through and replaced with the keyless strict-WMS truth + today's evidence + the `SOURCE_GLOFAS_POINTS` limit. | The row asserted a key requirement that no longer exists: the WMS route sends no credential at all. |
| 145 | `effis` row | **Appended** the E6 finding to the existing "endpoint confirmed DEAD" note. | Both facts are now true at once — the old endpoint is still dead **and** a keyless replacement exists that our ACL cannot yet read. |
| 161 | `anm` row | **Appended** the 2026-09-10 observation; "refused our TLS handshake" struck through but kept as history. | "CACHED not by choice" is no longer an upstream fact. |
| 163 | `hifld` row | **Appended** the `2019-06-13` service timestamp. | Hardens an existing claim with today's proof; the HELD verdict is unchanged. |
| 314 | CNADNR row (§ camera sources) | **Appended** the 403 observation beside "5 official pages verified 200". | Those 200s no longer reproduce; the coordinates remain valid, the provenance is now historical. |

## 4. What did **not** change

* **No source file, test, fixture, schema or config was modified by A3.** This work package's entire
  footprint is three files: `docs/LIVE_PRODUCTION_GUIDE.md`, `audit/DATA_SOURCE_VERIFICATION.md`, and this
  document. Note for whoever reads `git status` next: the tree carries many other modified files at the
  time of writing (`app/**`, `src/**`, `messages/**`, `.env.example`, `src/config/index.ts`,
  `docs/architecture/CONFIGURATION.md`, the two new ADRs, …) — **those belong to the other V2 work packages
  running in parallel, not to A3.**
* No `.env`, `.env.example`, `src/config/index.ts`, `docs/architecture/CONFIGURATION.md`, `package.json`,
  `agents/AGENTS.md` or `agents/CONSTITUTION.md` was touched — those are owned elsewhere.
* No adapter mode was flipped anywhere. Every LIVE observation in §2 came from **shell-scoped** overrides
  in a single throwaway probe process; nothing was persisted.

---

## 5. PLAN-DELTAs — changes this evidence implies, reported and NOT made

### 5.1 EFFIS needs an ACL port, not an env default (blocking a LIVE flip)

Setting `SOURCE_EFFIS_URL` alone would **not** work, and shipping it would be exactly the "unverified
endpoint in production" the guide warns against. The v2 API's envelope is incompatible with
`parseEffisFeatures`. Proposed, for the owner to schedule:

1. `src/adapters/sources/effis/effis-acl.ts` — teach `parseEffisFeatures` the v2 shape:
   `{count, next, previous, results[]}`, geometry at `row.shape` (`MultiPolygon`/`Polygon`/`Point`),
   attributes flat on the row (`id`, `firedate`, `lastupdate`, `country`, `countryful`, `province`,
   `commune`, `area_ha`). Keep the existing GeoJSON branch so the recorded fixture keeps passing.
2. `src/adapters/sources/effis/effis-adapter.ts:46-47` — `DEFAULT_BASE_URL` →
   `https://api.effis.emergency.copernicus.eu/rest/2/burntareas/current/` (**trailing slash matters**: without
   it the service 301s), plus a bounded default query (`?ordering=-firedate&limit=<n>`).
3. **Region filtering must be by `country=`, not `bbox=`** — E12 proves `bbox` is silently ignored, and a
   silently-ignored spatial filter would ship the whole 127 594-row global set into a region. `country`
   codes are EU-style: **Greece is `EL`**. `US` and `PH` return `count=0`, so `us-ca`/`ph` must not consult it.
4. Record a new fixture from a real v2 response; keep the old one for the legacy branch.
5. Only then: `SOURCE_EFFIS_MODE=live` (+ optional `SOURCE_EFFIS_URL`) in `.env`/`.env.example`.

### 5.2 `.env` / `.env.example` rows for the env owner (I did not edit these files)

| File · line | Current | Proposed | Reason |
|---|---|---|---|
| `.env:221` | `SOURCE_GLOFAS_MODE=cached # UPSTREAM DECOMMISSIONED 2026-08: the JSON facade 301s into the SPA; live impossible until Copernicus re-exposes it` | keep the mode decision with the owner, but **the comment is now false** — replace with: `strict-WMS route live-proven keyless 2026-09-10 (ows.globalfloods.eu); LIVE additionally requires SOURCE_GLOFAS_POINTS` | "live impossible" is contradicted by G1–G3. |
| `.env` (absent) | no `SOURCE_GLOFAS_POINTS` | **add**, e.g. the RO demo point `27.525,45.575` (Siret at Lungoci, Point ID `SI001084`, proven in G3) | Without it the LIVE rung has no point to interrogate and degrades to cache/mock — so `SOURCE_GLOFAS_MODE=live` alone would be a no-op. The value must be **real reporting-point coordinates** (G4). |
| `.env:223` | `SOURCE_EFFIS_MODE=cached  # WIRED adapter — Copernicus EFFIS/GWIS fire (keyless, attribution)` | leave `cached`; append `— keyless v2 REST endpoint EXISTS and is live (2026-09-10) but the ACL cannot parse it yet; see PLAN-DELTA 5.1` | Prevents the next reader concluding a mode flip is all that is missing. |
| `.env:261` | `SOURCE_ANM_MODE=cached  # NOT WIRED (planned) — Romania ANM JSON+nowcast (keyless, live-verified)` | comment correction: `anm` **is** wired and consumed (`ro` weather fallback rung, DSV line 143); host re-verified reachable `200` on 2026-09-10 | "NOT WIRED (planned)" contradicts the adapter table. A LIVE flip is now technically available; the decision is the owner's. |
| `.env.example` | Bluesky documented as "keyless LIVE-capable" (already flagged in plan §2·A5) | out of A3 scope; re-flagged only | Consistency. |

### 5.3 `usgs-water` (unchanged verdict, recorded for the backlog)

The OGC host is healthy and carries `latest-continuous`. The only thing standing between `usgs-water` and
LIVE is our own `buildUrl` (`usgs-water-adapter.ts:132-134`) plus the response mapper. Not an A3 change.

---

## 6. Gate

Docs-only work package. Both commands were run at the end; output verbatim:

```
$ npx eslint .
ESLINT_EXIT=0
```

```
$ npx tsc --noEmit
app/_lib/map-data.ts(151,5): error TS2322: Type '{ fetchedAt: string | null; mode: "LIVE" | "CACHED" | "MOCK" | "DB"; }' is not assignable to type 'LayerFreshness'.
  Types of property 'mode' are incompatible.
    Type '"LIVE" | "CACHED" | "MOCK" | "DB"' is not assignable to type 'FreshnessMode'.
      Type '"DB"' is not assignable to type 'FreshnessMode'.
src/application/aggregate/incident-summary.ts(137,5): error TS2322: Type '"LIVE" | "CACHED" | "MOCK" | "DB"' is not assignable to type '"LIVE" | "CACHED" | "MOCK"'.
  Type '"DB"' is not assignable to type '"LIVE" | "CACHED" | "MOCK"'.
src/application/interaction/command-router.ts(343,54): error TS2345: Argument of type 'readonly SourceRef[]' is not assignable to parameter of type 'readonly { readonly mode: "LIVE" | "CACHED" | "MOCK"; readonly fetchedAt: string; }[]'.
  Type 'SourceRef' is not assignable to type '{ readonly mode: "LIVE" | "CACHED" | "MOCK"; readonly fetchedAt: string; }'.
    Types of property 'mode' are incompatible.
      Type '"LIVE" | "CACHED" | "MOCK" | "DB"' is not assignable to type '"LIVE" | "CACHED" | "MOCK"'.
        Type '"DB"' is not assignable to type '"LIVE" | "CACHED" | "MOCK"'.
TSC_EXIT=1
```

**Re-run immediately after the final Markdown touch-ups — both now clean:**

```
$ npx tsc --noEmit
TSC_EXIT=0

$ npx eslint .
ESLINT_EXIT=0
```

Both runs are recorded rather than only the green one, because the difference is informative: this tree is
shared with the other V2 work packages running concurrently, and the three errors in the first run were
fixed by **A12** between the two runs — nothing A3 did caused them and nothing A3 did fixed them. The
analysis below stands as the attribution for that first run.

**`eslint` was clean in both runs. In the first run `tsc` reported 3 errors, and none of them belonged to A3.** A3 changed only Markdown,
which `tsc` does not compile. All three are the in-flight **A12** widening of the served-mode vocabulary:
`src/domain/source-record.ts:27` now declares `export const SERVED_MODES = [...SOURCE_MODES, 'DB'] as const;`
and the three call sites above have not yet been widened to accept `'DB'`. None of the three files is in
A3's footprint (`git status` shows `app/_lib/map-data.ts` untouched; the other two are modified by A12, not
by this WP). Reported here rather than fixed — they are another work package's to close.
