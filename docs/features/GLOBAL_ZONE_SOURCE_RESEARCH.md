# Global Zone Source Research — verified dossiers (INTERIM SAVE, 2026-07-18)

> Input to the pending plan `../../../CURRENT-PLAN-2-GLOBAL-PREDICTION.md` (not yet written).
> All endpoints below were LIVE-PROBED 2026-07-18 by research agents unless marked UNVERIFIED.
> Free/open only; link-out-only for cameras; Insecam-class banned. STATUS: 12 dossiers saved
> (incl. Asia-Pacific + Americas late additions below). REMAINING to research on resume:
> Philippines, South-Asia (BD+IN), Australia, Japan, Greece (probed but report not delivered),
> Scandinavia NO/SE/DK (FI done), Romania full-coverage upgrade, WMO-SWIC full enumeration,
> Africa continental top-3 (Mozambique/Nigeria/Kenya), exact EM-DAT/WRI/INFORM rank citations.

## Cross-zone aggregators (the highest-leverage finds)

- **MeteoAlarm Atom feeds** — `https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-<country>`
  (slug = English country name). **LIVE, keyless, CC BY 4.0**, Atom embedding CAP v1.2 fields +
  links to full `application/cap+xml`. Covers ~38 European countries (GR/ES/PT/IT verified; also
  covers Balkans + Scandinavia + RO). Attribution "Data provided by EUMETNET members". RSS variant
  DEPRECATED (2026-01-14) — use Atom only. EDR API (api.meteoalarm.org/edr/v1) is Bearer-gated
  (members/re-distributors only) → future. **Turkey NOT a member.**
  → ONE adapter pattern covers official alerts for most of Europe.
- **WMO SWIC CAP relay** — `https://severeweather.wmo.int/v2/cap-alerts/<sourceId>/rss.xml`,
  source list at `https://severeweather.wmo.int/json/sources.json`. Verified LIVE for China
  (`cn-cma-xx`, fresh same-day CMA warnings, EN+ZH) and HK (`hk-hko-xx`). RSS 2.0 + CAP 1.2.
  License = WMO Unified Data Policy Res.1 core-data (attribution; per-feed license page absent —
  flag). → ONE adapter can carry official warnings for zones with closed national portals
  (China, likely others — enumerate sources.json on resume).

## Zone dossiers (verified essentials)

### Portugal (Mediterranean tier) — all LIVE keyless
- IPMA warnings: `https://api.ipma.pt/open-data/forecast/warnings/warnings_www.json` (JSON array;
  awarenessLevelID green/yellow/orange/red; NOT CAP — CAP via MeteoAlarm). Attribution mandatory.
- IPMA fire risk (RCM): `.../forecast/meteorology/rcm/rcm-d0.json` (also -d1/-d2); `.local[dico]
  .data.rcm` 1–5 + lat/lon per municipality.
- IPMA obs: `.../observation/meteorology/stations/observations.json` (missing = -99.0/null).
- Fogos.pt active fires: `https://api.fogos.pt/v2/incidents/active` → `{success,data[]}` rich
  incident objects (coords, status, resources, ICNF burn area, KML). Terms: mandatory visible
  "Source: Fogos.pt" + link; NON-COMMERCIAL; not-sole-source-in-critical-ops clause (fits BEACON
  advisory framing). Run by VOST Portugal (João Pina).
- ANEPC official occurrences: dados.gov.pt "ProCiv – Ocorrências em aberto" (ArcGIS-backed;
  exact FeatureServer URL UNVERIFIED — inspect dashboard on resume). CACHED corroborator.
- News: RTP RSS `https://www.rtp.pt/noticias/rss/pais` LIVE. Cameras: Infraestruturas de Portugal
  — link-out only (no open license).

### Spain (Mediterranean) 
- AEMET OpenData: free key self-service (`opendata.aemet.es/centrodedescargas/altaUsuario`),
  header `api_key`. CAP endpoint `GET /opendata/api/avisos_cap/ultimoelaborado/area/esp` →
  two-step (JSON `datos` URL → tar of CAP v1.2 XML). AEMET = MeteoAlarm-ES provider. LIVE.
- **Keyless fallback**: AEMET CAP RSS `https://www.aemet.es/documentos_d/eltiempo/prediccion/
  avisos/rss/CAP_AFAE_RSS.xml` (+ _ATOM) — LIVE 200.
- Fire: EFFIS (already wired) is the operational feed; MITECO EGIF = stats only.
- Gauges: NO national API — per-basin SAIH (Confederaciones; Guadalquivir viewer LIVE; CSV/HTML).
  CACHED per-basin. Flood zones: SNCZI WMS (endpoint UNVERIFIED).
- DGT traffic: `https://infocar.dgt.es/datex2/` DATEX-II v3.7 XML, keyless, CC-BY 4.0 — incidents
  LIVE + cameras (link-out; excludes País Vasco/Cataluña). News: AEMET RSS; Protección Civil has
  NO public feed (ES-Alert is cell-broadcast push).

### Italy (Mediterranean)
- **DPC criticality bulletins (anchor)**: github.com/pcm-dpc/DPC-Bollettini-Criticita-
  Idrogeologica-Idraulica — daily JSON `files/YYYYMMDD_HHMM.json` w/ TopoJSON of 156 alert zones,
  verde→rossa, today+tomorrow. CC-BY-4.0, keyless via raw.githubusercontent. Pipeline confirmed
  current (commit 2026-07-17). NOTE: GitHub contents API truncates at 1000 files — fetch by dated
  raw URL. + DPC-Bollettini-Vigilanza-Meteorologica repo (same pattern).
- DPC RSS: `https://api.protezionecivile.it/default/dpcPortalGenerateRss?categoria=<c>` with
  c ∈ {notizia, bollettino_criticita, bollettino_vigilanza, comunicato_stampa, …} — LIVE 200.
- MeteoAlarm Italy Atom LIVE (provider = Aeronautica Militare/CNMCA). MeteoAM own API NOT open.
- Weather model: ItaliaMeteo ICON-2I via Open-Meteo (`open-meteo.com/en/docs/italia-meteo-arpae-
  api`) or dati.agenziaitaliameteo.it CKAN (CC-BY-4.0).
- Gauges: national Dewetra CLOSED; per-region ARPA (ARPAE `simc.arpae.it/rt_data/` documented).
  Fire: EFFIS. News: ANSA RSS `https://www.ansa.it/sito/ansait_rss.xml` LIVE; vigilfuoco.it
  UNVERIFIED (WAF/geo-block from this env). Cams: Autostrade/ANAS link-out only.

### Turkey (Mediterranean; NOT in MeteoAlarm, no public CAP — verified 404)
- MGM warnings JSON (undocumented): `https://servis.mgm.gov.tr/web/meteoalarm/{today,tomorrow}`
  — WORKS but hard-requires header `Origin: https://www.mgm.gov.tr` (500 without). Also
  `/web/merkezler?il=X`, `/web/sondurumlar?merkezid=N`; bulk XML `https://www.mgm.gov.tr/FTPDATA/
  analiz/SonDurumlarTumu.xml` (no header needed). No open license → verdict CACHED (gray ToS).
- Fire: EFFIS/GWIS covers Turkey → LIVE via existing adapter. OGM nothing open.
- Gauges: DSİ closed → MOCK. AFAD: only earthquake API open (out of scope; note).
- Cams: İBB Istanbul CKAN `https://data.ibb.gov.tr/api/3/action/package_search?q=kamera`
  (İBB license ≈ CC-BY) — metadata LIVE, streams link-out. News: Anadolu Agency RSS
  `https://www.aa.com.tr/tr/rss/default?cat=guncel` LIVE.

### Finland (Scandinavia; model zone — ALL 7 categories fillable open)
- **FMI CAP v1.2 feed**: `https://alerts.fmi.fi/cap/feed/atom_en-GB.xml` — LIVE keyless CC-BY 4.0,
  covers weather + WILDFIRE + flood warnings in one stream (live Lapland forest-fire warning
  observed). THE anchor.
- FMI WFS keyless: `https://opendata.fmi.fi/wfs` (WFS 2.0.0; legacy fmi-apikey path deprecated).
- Gauges: SYKE OData `https://rajapinnat.ymparisto.fi/api/Hydrologiarajapinta/1.2/` (~5,000
  stations) LIVE CC-BY.
- Flood zones: SYKE INSPIRE WMS `https://paikkatiedot.ymparisto.fi/geoserver/inspire_nz/wms`
  (plural "paikkatiedot"; the arcgis path 404s) LIVE.
- Outage: Fingrid `https://data.fingrid.fi/api` (free key, CC-BY, transmission-level PROXY only;
  local DSO outages not open → MOCK).
- Cameras: Digitraffic `https://tie.digitraffic.fi/api/weathercam/v1/stations` (GeoJSON, ~470
  cams, keyless CC-BY; JPGs at weathercam.digitraffic.fi/<id>.jpg) LIVE.
- News: FMI RSS `https://www.ilmatieteenlaitos.fi/feed` (FI; EN 404).

### Germany/Austria/Czechia (Central-Europe floods) — supplement
- Flood-hazard polygons: DE BfG HWRM WMS/WFS (GeoNutzV, LIVE) · AT HORA + INSPIRE HQ100 WMS ·
  CZ DIBAVOD WMS + CHMI ArcGIS Hub. (Pegelonline DE gauges: famously open — full details in the
  main dossier pending; endpoint `https://www.pegelonline.wsv.de/webservices/rest-api/v2/`.)
- Outage: honest MOCK for all three — no open consumer-outage feed exists (SMARD/APG/ENTSO-E =
  grid-load proxies only).
- Cameras: DE Autobahn API keyless open but webcam arrays EMPTY on probe (`{"webcam":[]}` on
  A1+A8) — schema LIVE/content MOCK; AT ASFINAG + CZ JSDI link-out-only (ToS-gated reuse).

### China (continental tier; Asia)
- Native portals RESTRICTED (nmc.cn / 12379 / mwr.gov.cn — no open API, viewing-only ToS; do NOT
  scrape). Use **WMO SWIC `cn-cma-xx` CAP relay** (LIVE, fresh warnings) + **HKO Open Data**
  `https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warnsum&lang=en`
  (keyless; open ONLY under DATA.GOV.HK terms — cite those, not hko.gov.hk site terms).
  Floods: GloFAS/global stack. WorldRiskReport 2025: China re-entered top-10 (#9, exposure-driven).

## Risk-ranking evidence base (for zone selection §)
- WorldRiskReport 2025 (focus: floods) — misereor.org PDF + preventionweb.net (China #9; PH/ID top).
- INFORM Risk (EU JRC drmkc.jrc.ec.europa.eu) + EM-DAT/CRED via Climate Risk Index 2025
  (floods ≈ 32% of global impact 1993–2022).

## Resume instructions (if this session dies)
1. Remaining research (relaunch agents): Philippines (PAGASA/NOAH/MMDA), Bangladesh+India
   (FFWC/BMD/IMD/CWC), Australia (BOM CAP!/NSW RFS/Sentinel hotspots/state cams), Japan (JMA
   bosai JSON/river.go.jp/MLIT cams), Greece (HNMS/Civil Protection — probed, report undelivered),
   Norway/Sweden/Denmark (met.no+MetAlerts CAP/NVE varsom/SMHI/FMI-done/DMI/Statens vegvesen
   cams), Romania upgrade (INHGA/ANM/IGSU/RO-Alert), WMO-SWIC sources.json enumeration,
   continental top-3: Americas (Canada CWFIS/ECCC GeoMet, Brazil INPE Queimadas/CEMADEN/ANA,
   Chile CONAF or Mexico CONAGUA), Africa (Mozambique INAM, Nigeria NIHSA/NiMet, Kenya KMD/ICPAC),
   Oceania (NZ MetService/GeoNet, Fiji RSMC Nadi), Indonesia (BMKG open API/inaRISK).
2. Then write `IEEE/Quest/CURRENT-PLAN-2-GLOBAL-PREDICTION.md` per resume-22 spec (10 Tier-1
   full-parity regions + continental Tier-2, STORM/TYPHOON first-class type, W-R1..R10 refactors,
   prediction-probability program: likelihood classes from source-provided probabilities +
   etaHours + predictions[] + Outlook + forecast-crossing DRAFT alerts; logistics/informational/
   checks per zone; final full audit tail; user runs all git).

## LATE ADDITION (saved post-dossier, same session): Asia-Pacific/Oceania synthesis (verified 2026-07-18)

### WMO SWIC enumeration (partial, verified)
`https://severeweather.wmo.int/json/sources.json` → confirmed registered + live CAP feeds:
Indonesia `id-inatews-id` (100 items) · China `cn-cma-xx` (100 items, EN) · NZ `nz-nms-en` (150+).
Pacific registered: PNG `pg-bmg-en`, Samoa `ws-met-en`, Tonga `to-met-en`, Vanuatu `vu-vms-en`
(individual feeds unverified; pattern proven). **Fiji NOT registered** — cover via GDACS + RSMC
Nadi link-out (met.gov.fj didn't resolve from this env).

### Indonesia (WorldRiskReport 2025 rank 3) — all keyless/free
- BMKG CAP via SWIC `.../cap-alerts/id-inatews-id/rss.xml` LIVE (primary alerts).
- BMKG quake JSON `https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json` (+gempaterkini/
  gempadirasakan) LIVE, attribution, 60 req/min/IP.
- BMKG forecast `https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=<code>` (3-day 3-hourly,
  village-level) LIVE.
- BNPB inaRISK ArcGIS REST `https://gis.bnpb.go.id/server/rest/services/inarisk` — 159 hazard
  rasters incl. KARHUTLA (fire), BANJIR/BANJIRBANDANG (flood) — CACHED; **WAF needs browser UA**
  (403 on default).
- PetaBencana.id `https://data.petabencana.id/floods` + `/floodgauges` (CogniCity OSS, GeoJSON/
  TopoJSON/CAP, keyless read) LIVE — Jakarta-strong real-time flood state.
- PUPR river telemetry: NOT FOUND → gap (use PetaBencana).

### New Zealand
- MetService native CAP `https://alerts.metservice.com/cap/rss` — **CC-BY 4.0 explicit**, LIVE
  (0 active warnings at probe; valid feed). SWIC `nz-nms-en` mirror LIVE.
- GeoNet quake `https://api.geonet.org.nz/quake?MMI=3` (GeoJSON, CC-BY 3.0 NZ) LIVE ·
  volcano `https://api.geonet.org.nz/volcano/val` LIVE (12 volcanoes) · GeoNet CAP atom feed
  documented UNVERIFIED. NEMA/FENZ: no open feeds found → link-out/MOCK. NIWA mostly commercial.
  LINZ basemap CC-BY 4.0 (free key, unverified today).

### Follow-ups noted by the researcher
Pull exact EM-DAT/WorldRiskIndex/INFORM numeric ranks (emdat.be, WorldRiskReport PDF,
drmkc.jrc.ec.europa.eu) — search budget exhausted; verify Pacific-neighbour SWIC feeds
individually; GeoNet CAP; LINZ.

## LATE ADDITION 2 (saved at session resume): AMERICAS continental sweep (verified 2026-07-18)

### Canada (wildfire benchmark; 2023 worst + 2025 second-worst fire seasons) — all anchors LIVE keyless
- **Alerts**: ECCC/MSC CAP datamart `https://dd.weather.gc.ca/today/alerts/cap/` (CAP XML, MSC open
  license, dir listing live). ⚠ path is `/today/alerts/cap/` NOT `/alerts/cap/`; weather alerts are
  NOT an OGC collection (`/collections/alerts` 404).
- **GeoMet OGC API**: `https://api.weather.gc.ca/` — LIVE; **gauges**:
  `/collections/hydrometric-realtime` (2100+ stations, GeoJSON, 30-day window) LIVE.
- **Fire**: CWFIS GeoServer `https://cwfis.cfs.nrcan.gc.ca/geoserver/ows` (WMS/WFS/WCS: fire danger,
  FWI, active fires `public:activefires`, hotspots, perimeters, smoke PM2.5; OGL-Canada) LIVE —
  the open substitute for NRCan's token-gated (499) national perimeters FeatureServer (do NOT use).
- Verify-before-LIVE: CWFIS activefires.csv filename, WaterOffice inline CSV params (422 on probe),
  NAADS/Pelmorex RSS `https://rss.naad-adna.pelmorex.com/`, BC/AB ArcGIS endpoints (open.canada.ca
  catalog ids 6ed3ec9b…/d3231d3f…).

### Brazil (WRI-2024 rank 41) — anchors LIVE keyless
- **Alerts**: INMET RSS `https://apiprevmet3.inmet.gov.br/avisos/rss` (RSS 2.0, CAP-equivalent
  severity Perigo/Perigo Potencial; 50+ items same-day) LIVE. No plain public CAP-XML confirmed;
  SWIC Brazil entry UNVERIFIED.
- **Fire**: INPE Queimadas hotspot CSV `https://dataserver-coids.inpe.br/queimadas/queimadas/focos/
  csv/10min/` (10-min multi-satellite, also daily/monthly + KML; since 1998) LIVE; BDQueimadas
  WebGIS export = CACHED harvest.
- Weather obs: INMET `https://apitempo.inmet.gov.br/estacoes/T` JSON LIVE.
- **Gauges**: ANA HidroWebService (SNIRH) REST+OAuth — free token via hidro@ana.gov.br → CACHED/MOCK
  until token; legacy SOAP telemetria DEPRECATED (sunset ~2026-06-30). CEMADEN rain gauges: map LIVE,
  webservice token-gated (PED) → CACHED/MOCK.

### Chile (RECOMMENDED Americas-Spanish primary — all reachable from outside)
- **Alerts**: DMC SAT RSS `https://archivos.meteochile.gob.cl/portaldmc/rss/rss.php` — LIVE,
  16 current items, feed declares `<copyright>public domain</copyright>`. (SENAPRED: no open API —
  link-out.) DMC is the WMO-registered CAP authority (CL 2.49.0.0.152.0).
- DMC climate services: `https://climatologia.meteochile.gob.cl/` — 17 JSON + 10 GeoJSON services
  (15-min stations, wildfire-risk, heat/cold-wave) LIVE.
- **Fire**: CONAF SIDCO ArcGIS dashboard `https://www.arcgis.com/apps/dashboards/
  d220de4bf3b54ca79ad1f9dbb59904b0` (query underlying FeatureServer) LIVE + IDE Minagri WMS/WFS
  perimeters CACHED.
- **Gauges**: DGA/BNA `https://snia.mop.gob.cl/` LIVE/CACHED.

### Mexico (strong secondary — flagship feeds GEOBLOCKED from outside MX)
- SMN CAP feed `https://correo1.conagua.gob.mx/feedsmn/feedalert.aspx` + SMN municipal forecast API:
  Imperva geoblock (TLS reset) from non-MX IPs → **CACHED only (needs in-region fetcher)**.
- Reachable now: CONAGUA SIH gauges `https://sih.conagua.gob.mx/` LIVE/CACHED · CONABIO SATI fire
  points `https://incendios.conabio.gob.mx/` (MODIS/VIIRS/GOES, shapefile/CSV/WMS, cite CONABIO)
  LIVE/CACHED · `https://datos.conagua.gob.mx/` CACHED. CENAPRED: no open CAP → link-out.

### Americas verdict
Tier-2 picks: **Canada + Brazil + Chile** (all three deliver alerts+fire+gauges LIVE keyless);
Mexico as secondary (geoblock-constrained). Global FIRMS/GDACS/GloFAS remain shared fallbacks.

---

## LATE ADDITION 3 — PHILIPPINES spike (task B3.4, resolves finding F-21) — verified 2026-07-27

> **Supersedes the "un-researched" status of the Philippines at lines 7 and 120–122 above, and
> corrects the WMO-SWIC enumeration at lines 137–141, which did NOT list PAGASA.**
> **VERDICT: ladder rung (a) — a national machine-readable alert source EXISTS, is CAP v1.2,
> keyless, and explicitly CC BY 4.0.** The pre-decided global-stack fallback (rung b) is NOT needed
> as the primary story; it remains the redundancy tier. Every row below cites the exact URL fetched
> from this environment on 2026-07-27 and what it actually returned.

### The correction: PAGASA **is** a registered WMO SWIC alerting authority

`https://severeweather.wmo.int/json/sources.json` — **fetched 2026-07-27, contains a Philippines
entry** that the 2026-07-18 partial enumeration missed:

```
sourceId:   ph-pagasa-en
name:       Philippine Atmospheric Geophysical and Astronomical Services Administration
country:    Philippines   region: 5   language: en
GUID/OID:   urn:oid:2.49.0.0.608.0
registration: Registered   alert feed: Operating
native feed:  https://publicalert.pagasa.dost.gov.ph/feeds/
org link:     https://www.pagasa.dost.gov.ph/
```

⇒ The Philippines is reachable through the **already-planned B3.2 WMO-SWIC CAP relay adapter with
zero new adapter code** — only a configured source id. This is the cheapest possible outcome.

### Primary source — verified LIVE (two independent paths, same publisher)

**Path 1 (relay, preferred primary):** `https://severeweather.wmo.int/v2/cap-alerts/ph-pagasa-en/rss.xml`
— **LIVE 200, valid RSS 2.0**, channel title *"Latest Official Public alerts in English for
Philippines: Philippine Atmospheric Geophysical and Astronomical Services Administration"*,
**71 `<item>` elements**, newest item `Mon, 27 Jul 2026 09:49:22 +0000` (same-day = pipeline fresh).
Item `<link>` points at the per-alert CAP XML on the WMO host, e.g.
`https://severeweather.wmo.int/v2/cap-alerts/ph-pagasa-en/2026/07/27/09/47/59-58b49f5fb6529a1eabdacffc14d9daaa.xml`.
Observed item titles: *General Flood Advisory* (repeated), *Tropical Cyclone Alert*.

**Path 2 (native, redundancy tier):** `https://publicalert.pagasa.dost.gov.ph/feeds/` — **LIVE,
Atom 1.0** (`<feed xmlns="http://www.w3.org/2005/Atom">`), title *"Latest Alerts from Philippine
Atmospheric Geophysical and Astronomical Services Administration"*, `updated 2026-07-27T17:47:59+08:00`,
50+ entries spanning 25–27 Jul 2026. Entry titles are more informative than the relay's, e.g.
*"GFA #4 - BARMM (Bangsamoro Autonomous Region in Muslim Mindanao)"*, *"GFA #1 - Region 4-A
(CALABARZON)"*, *"Tropical Cyclone Alert : Typhoon Kiyapo (NOUL)"*.
**Licence, quoted verbatim from the feed itself:** *"Copyright, Philippine Atmospheric Geophysical
and Astronomical Services Administration. Licensed under CC BY 4.0."* — an explicit open licence in
the payload, which is a stronger licence position than Spain's AEMET or the WMO-relay-only zones.
Per-alert CAP files live at `https://publicalert.pagasa.dost.gov.ph/output/<family>/<uuid>.cap`,
families observed: `gfa` (flood) and `acp` (tropical cyclone).
`https://publicalert.pagasa.dost.gov.ph/robots.txt` → **404** (no crawl restriction declared); the
feed is a published syndication endpoint under CC BY 4.0, so consumption is licensed, not scraping.

### CAP payload shape — probed on two real alerts (this decides the adapter)

**Flood (the BEACON-relevant one), `output/gfa/945d3297-ddf1-4e96-b668-2ea68a6f3b3c.cap`:**
`xmlns urn:oasis:names:tc:emergency:cap:1.2` · sender `PAGASA-DOST` · sent `2026-07-27T17:47:59+08:00`
· status `Actual` · msgType `Update` · info: category `Met`, event **`General Flood Advisory (Severe)`**,
urgency `Expected`, severity `Severe`, certainty `Likely`, expires `2026-07-28T05:47:59+08:00`.
**Geometry is real and province-granular:** two `<area>` blocks — *Maguindanao* carrying **three
`<polygon>` elements** (named watercourses: Nituan, Mindanao, Dalican, Allah, Buluan, Matuber, Mlang,
Lower Mlang) and *Lanao Del Sur* carrying one `<polygon>` **plus** a `<geocode>` with
`valueName SAME` / `value 153600000`. Region carried as a CAP `<parameter>`.

**Tropical cyclone, `output/acp/cc368dd6-7ebd-49d9-ba02-25c9d3b51a76.cap`:**
CAP 1.2 · sender `PAGASA-DOST` · sent `2026-07-25T10:48:59+08:00` · `Actual`/`Update`/`Public` ·
info: category `Met`, event `Tropical Cyclone Alert`, urgency `Expected`, severity `Minor`,
certainty `Possible`, headline *"Tropical Cyclone Alert : Typhoon Kiyapo (NOUL)"*. Area verbatim:

```xml
<area>
  <areaDesc>Philippine Area of Responsibility</areaDesc>
  <polygon>21,120 21,130 5,130 5,121.5 9.5,113 15,113 21,120</polygon>
</area>
```

with `<parameter><valueName>layer:Google:Region:0.1</valueName><value>Philippine Area of
Responsibility</value></parameter>`.

> ⚠ **HONESTY / ANTI-FABRICATION FINDING (must be honoured in B3.2 + the storm layer).** The TC-alert
> polygon is **PAGASA's whole Area of Responsibility (≈5–21°N, 113–130°E), not the storm footprint**,
> and it is *wider than the `ph` zone bbox*. Rendering it as a hazard geometry would paint a giant
> false polygon across the West Pacific in front of judges. Required handling: treat `acp`
> (Tropical Cyclone Alert) CAP areas as **advisory/alert-extent, not hazard geometry** — surface as an
> alert banner/`NewsIntel`-style item, clipped to the region bbox and labelled "alerting area, not
> storm extent"; take **flood** hazard geometry from the province-level `gfa` polygons, and storm
> *footprint* from GDACS. Also: CAP allows **multiple `<polygon>` children per `<area>`** (seen here)
> — the relay parser must emit a MultiPolygon, not silently keep the first ring. CAP polygon order is
> `lat,lon` (spec order), which is **reversed** relative to GeoJSON; the observed rings close correctly.

### Other national bodies — probed, all NEGATIVE

- **PHIVOLCS** — no official machine-readable feed found. `https://earthquake.phivolcs.dost.gov.ph/`
  and `https://www.phivolcs.dost.gov.ph/earthquake-information/` publish **HTML bulletins only**; the
  only machine-readable access found is the third-party `lindol` R package
  (`https://panukatan.io/lindol/`, `github.com/panukatan/lindol`) which **harvests/scrapes the HTML
  bulletins** — not an official API. **Verdict: UNUSABLE, and moot anyway** — earthquake/volcano are
  out of BEACON's hazard scope (wildfire · flood · storm). Even as a last resort it would be a poor
  fit. Do not wire it.
- **NDRRMC / OCD** — no documented machine-readable situational feed. `https://ndrrmc.gov.ph/` and
  `https://monitoring-dashboard.ndrrmc.gov.ph/page/situations` are a **PDF/dashboard** publication
  route (an `rbmes-api.ndrrmc.gov.ph` host exists but serves the NDRRMP monitoring-&-evaluation plan,
  not alerts). DSWD DROMIC (`dromic.dswd.gov.ph`) is likewise a portal. **Verdict: link-out only.**
  NOT verified as an API — recorded as unverified, not as usable.
- **Project NOAH** (named in the resume note at line 120) — **NOT probed this pass** (budget); the
  PAGASA CAP anchor made it unnecessary. Recorded as unknown, not as unavailable.

### Global fallbacks over the PH bbox — confirmed from the shipped manifest (no live calls made)

`config/adapters.json` declares each of these `coverage.kind = "GLOBAL"`, so a `ph` region resolves
them by construction (SPEC §4.2 returns `NOT_COVERED` only for non-matching scopes) — no new
verification was required and none was fabricated:
`gdacs` (GLOBAL, LIVE, GDACS/JRC-UN-OCHA open) · `firms` (GLOBAL, NASA open/attribution) ·
`open-meteo` (GLOBAL, LIVE, CC BY 4.0) · `worldpop` (GLOBAL, CC BY 4.0) · plus `glofas`, `effis`,
`osm-overpass`, `reliefweb`, `gdelt`, `agency-rss` (all GLOBAL). GDACS is the tropical-cyclone
*footprint* source for PH; FIRMS covers PH wildfire; EFFIS/GWIS is global for fire danger.
**Not verified live for a PH bbox in this spike** — deliberately, per the spike's no-live-key rule.

### DATA_SOURCE_VERIFICATION row (house format — to be transcribed into `audit/DATA_SOURCE_VERIFICATION.md`)

| Source | Live? | Endpoint | Free/Auth | License | Cadence | Coverage | Verdict | Notes |
|---|---|---|---|---|---|---|---|---|
| **PAGASA public alerts (CAP)** | ✅ | primary `https://severeweather.wmo.int/v2/cap-alerts/ph-pagasa-en/rss.xml` (WMO SWIC relay); native `https://publicalert.pagasa.dost.gov.ph/feeds/` (Atom → `output/{gfa,acp}/<uuid>.cap`) | **Free, keyless** | **CC BY 4.0** (declared in the native feed verbatim); relay additionally under WMO Unified Data Policy Res.1 | on issuance (71 relay items; newest same-day at probe) | **Philippines (PAR)** | **LIVE** | CAP v1.2, `sender PAGASA-DOST`. Flood (`gfa`) = province-level polygons + SAME geocode ⇒ usable hazard geometry. TC (`acp`) area = whole Area of Responsibility ⇒ **advisory extent only, never hazard geometry** (see finding above). Multi-polygon per `<area>`; CAP `lat,lon` order. Attribution string: "PAGASA-DOST / WMO Severe Weather Information Centre". |
| **PHIVOLCS** | ❌ (no feed) | `https://earthquake.phivolcs.dost.gov.ph/` (HTML bulletins) | n/a | none declared | n/a | PH | **UNUSABLE — do not wire** | Only 3rd-party HTML scraping (`lindol` R pkg) exists; and earthquake/volcano is out of BEACON scope. |
| **NDRRMC / OCD** | ❌ (no API verified) | `https://ndrrmc.gov.ph/`, `https://monitoring-dashboard.ndrrmc.gov.ph/page/situations` | n/a | none declared | per event (PDF) | PH | **link-out only** | PDF/dashboard sitreps; no machine-readable endpoint found. UNVERIFIED, not "unavailable". |

### What shipping the `ph` zone implies (documented here; **no config was edited by this spike**)

- **Adapter work: essentially none beyond B3.2.** `ph-pagasa-en` is one configured source id on the
  **B3.2 `wmo-swic` CAP relay adapter** (which does not yet exist in `config/adapters.json` — grep for
  `swic|wmo` returns nothing in the manifest or `planned-sources.md`; B3.2 creates it). Manifest shape
  by analogy with `meteoalarm-ro`: `coverage {kind: "COUNTRIES", iso: ["PH"]}` (or the relay declared
  GLOBAL with a per-region source list), `configPrefix` per B3.2's env scheme, `cache.ttlSec` ≈ 900,
  standard circuit breaker, and a recorded fixture (capture one `gfa` + one `acp` CAP).
  Optional second adapter id for the **native** PAGASA Atom as the ladder's tier-2 (Article XVI:
  SWIC relay → native PAGASA feed → LKG cache → recorded mock).
- **Region entry** (`config/regions.json`, one row, per `schemas/regions.schema.json` required
  `id/name/scope/iso/bbox/tz/languages/enabled_adapters`): `id "ph"`, `scope "COUNTRY"`, `iso "PH"`,
  `tz "Asia/Manila"`, `languages ["fil","en"]` (`fil` is **already** a shipped locale in
  `config/locales.json:114`, promoted "← Philippines"), `enabled_adapters` = the SWIC relay + the
  global stack (`gdacs`, `firms`, `open-meteo`, `worldpop`, `glofas`, `effis`, `osm-overpass`,
  `reliefweb`, `gdelt`, `agency-rss`). Suggested land bbox `[116.93, 4.59, 126.60, 21.12]`
  — **CONFIRM at implementation; not geodetically verified in this spike.** Note it is *narrower*
  than the CAP PAR polygon, so relay geometry must be clipped to the bbox.
- **US-only adapters** (`nws`, `nwps`, `usgs-water`, `nfhl`, `eagle-i`, `census`, `nifc`) stay
  disabled ⇒ `NOT_COVERED`, labelled, exactly as for `ro`.
- **No "no national alert source covers this region" banner is needed for PH** (that rung-(b) state
  is not triggered here) — but the **storm-extent caveat above is mandatory UI labelling**.

### Could NOT verify (stated openly, per Article "honest limitations")

1. **Per-alert CAP URL stability.** `output/<family>/<uuid>.cap` paths are UUID-keyed ⇒ **not
   enumerable**; alerts must always be discovered through the feed. Whether expired CAP files remain
   retrievable (archive depth) was not tested.
2. **Rate limits / quotas** for either host — no published figure found on either endpoint; none
   observed. Assume politeness (≥900 s poll) and rely on the circuit breaker.
3. **Whether the relay and the native feed are byte-identical in content or lag each other.** Both
   were fresh at probe (relay newest 27 Jul 09:49 UTC; native `updated` 27 Jul 17:47 +08:00 = 09:47
   UTC — ~2 min apart, consistent, but not systematically compared).
4. **The full alert-family catalogue.** Only `gfa` (General Flood Advisory) and `acp` (Tropical
   Cyclone Alert) were observed. Whether PAGASA also publishes **thunderstorm/rainfall advisories or
   heavy-rainfall warnings as CAP** was NOT confirmed — the two families seen are enough for BEACON's
   flood + storm hazards, but do not claim broader coverage.
5. **`https://alertingauthority.wmo.int/authorities.php?id=PHL`** returned only the **generic
   country-index page** ("Select a country to get started") from this environment — the SWIC
   `sources.json` OID (`urn:oid:2.49.0.0.608.0`) is the authority evidence used instead.
6. **Project NOAH, PH river/gauge telemetry, and any PH camera source** were not researched (out of
   the time box). PH flood gauges therefore fall to the global `glofas` tier; no PH-specific gauge or
   camera source is claimed.
7. **Live PH-bbox responses from GDACS/FIRMS/Open-Meteo/WorldPop** were not fetched (spike rule);
   coverage is asserted only from their `coverage.kind = GLOBAL` manifest declarations.

---

## LATE ADDITION 4 — BBOX CONFIRMATION at implementation (task B3.3, closes the F-51 bbox item) — 2026-07-27

> **Everything above is preserved as written.** This section only records what the B3.3 implementation
> lane actually confirmed the three new zones' bounding boxes against, because "confirm at implementation"
> was a standing instruction and a wrong bbox is finding F-06 all over again: every adapter query is
> bounded by it, so a bad extent queries the wrong part of the planet and renders the answer as local.

**Method (identical for all three).** Take the country's four EXTREME POINTS from the documented
land-geography record, round each OUTWARD to 2 dp so no extreme is clipped, then check the result is
CONTAINED BY an independent boundary/geodetic authority — a containment check, not a copy, because the
authorities' own boxes include maritime extents and (for `ph`) a disputed claim.

| Zone | Shipped bbox `[minLon, minLat, maxLon, maxLat]` | Extreme points it is built from | Independent containment check |
|---|---|---|---|
| `es` | `[-9.31, 35.99, 4.33, 43.80]` | Cabo Touriñán 9°18′W · Punta de Tarifa 36°00′N · La Mola, Menorca 4°19′E · Punta de Estaca de Bares 43°47′N | OSM/Nominatim `ES` relation bbox `-18.394, 27.434, 4.592, 43.993` (which additionally spans the Canaries) ⇒ contained. Scope wording matches EPSG:4258's own "Spain - mainland and Balearic islands" |
| `gr` | `[19.36, 34.79, 29.65, 41.76]` | Xilosermi, Othonoi 19°22′26″E · Cape Trypiti, Gavdos 34°48′03″N · islet of Strongyli, Megisti 29°38′43″E · Ormenio/Trigono 41°44′52″N | OSM/Nominatim `GR` relation bbox `19.113, 34.719, 29.684, 41.749` ⇒ contained on lon; lat rounded 0.011° north of the OSM box's 41.749 so the Ormenio border point itself is inside |
| `ph` | `[116.87, 4.40, 126.62, 21.14]` | Balabac Great Reef 116°53′17″E · Frances Reef, Sitangkai 4°24′54″N · Pusan Point, Caraga 126°36′18″E · Mavulis (Y'Ami), Batanes 21°07′18″N | EPSG:4683 (PRS92) area of use "Philippines - onshore and offshore" `116.04, 3.0, 129.95, 22.18` ⇒ contained |

### The `ph` correction (this is the F-51 item, and the spike's suggestion was wrong)

The suggested `[116.93, 4.59, 126.60, 21.12]` **clipped all four extremes**, each by a small margin:
Balabac Great Reef (116.888°E) fell ~4.7 km west of it, Saluag Island (4.587°N) and Frances Reef
(4.415°N) fell south of it, Pusan Point (126.605°E) fell ~0.5 km east of it, and Mavulis (21.122°N) fell
~0.2 km north of it. Small, but wrong in the one direction that silently drops territory from every
bbox-bounded query. The shipped box rounds outward from the same four points.

**Deliberate exclusion, stated openly:** the Kalayaan Island Group (Pag-asa 114°17′E), which OpenStreetMap's
`PH` relation includes as a national claim, is **outside** the shipped extent. BEACON's bbox is an operating
envelope, not a territorial position, and stretching it ~280 km west across contested water would add ocean,
not coverage. The `es` box likewise covers **mainland Spain + the Balearics only** — the Canary Islands,
Ceuta and Melilla are outside it, because reaching the Canaries would mean spanning ~2000 km of open
Atlantic and implying operational coverage BEACON does not have. Both exclusions are recorded in the zones'
`config/regions.json` `$comment`s so the limitation travels with the config, not just with this annex.

### Still not verified (unchanged from the "Could NOT verify" list above)

Nothing in this section was gained by fetching a source feed: no PH gauge network, no PH camera source, no
ES AEMET-direct or DGT adapter, and no GR national gauge/camera source was found or wired. The three zones
ship **DEMO-GRADE**, on the global stack plus one national alert source each.
