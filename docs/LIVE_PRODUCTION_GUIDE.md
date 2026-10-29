# BEACON — Full-Live Production Guide

> ### 🔎 Judges & first-time readers — start here: **[JUDGE_MATRIX.md](../JUDGE_MATRIX.md)**
> One page, built for a fast scan: what was promised vs what shipped, the five judging criteria with
> evidence, production readiness, what's genuinely new, and the honest limitations. Everything below and
> throughout `docs/` is the supporting detail behind it.

> **What this is.** How to run BEACON as a **real early-warning and response system** — every source
> that *can* serve live serving live, a **real PostgreSQL database** holding logistics, tasking,
> reports, alerts and the audit chain, real AI synthesis, real alert delivery, and real road routing,
> anywhere in the world.
>
> This is the **opposite posture from the demo**. The public demo deliberately runs a mixed ladder
> (some sources CACHED or MOCK) so that it is reproducible offline, costs nothing, and cannot be broken
> by an upstream outage during judging. This guide turns that ladder all the way up.
>
> **One promise this guide will not make:** that all 45 adapters can be LIVE. **38 of 45 can** on free
> credentials — 29 with no key at all, 9 with a free credential. Seven cannot on free public routes: four
> for upstream reasons, two operator-gated by design, one needing an endpoint your agency is entitled
> to; §1 names every one with its evidence (the class table below is the 2026-08 baseline, the
> 2026-09-10 note corrects it, and `shelters-fema` joined class A on 2026-09-11). Everything else here is
> reproducible with free accounts. Degradation is always labelled, never hidden (Art. XVI) — that rule
> holds in production exactly as it holds in the demo.

---

## 1. The honest ceiling — what "all live" actually means

> **Current ceiling (2026-09-16, the figure to quote): 45 registered · A 29 keyless · B 9 free
> credential · C 1 entitled endpoint · D 4 upstream-blocked · E 2 operator-gated — i.e. 38 of 45 live on
> free credentials alone, 39 with an entitled EAGLE-I endpoint.** The class table and the paragraph
> immediately below are the **2026-08 baseline, preserved as the pre-verification record**; the
> 2026-09-10 note and footnote ⁸ are the corrections that produced the figure above. Read them as
> history, not as the current count.

45 adapters are registered. Their live-capability, verified against each adapter's own source and the
per-row verdicts in [`docs/audit/DATA_SOURCE_VERIFICATION.md`](audit/DATA_SOURCE_VERIFICATION.md):

| Class | Count | Meaning |
|---|---|---|
| **A — LIVE now, keyless** | 26 | Flip one env var. No account, no key, no cost. |
| **B — LIVE with a free credential** | 9 | Register a free key/appname/app-password (§2). |
| **C — LIVE with an operator-supplied endpoint** | 2 | The adapter is live-ready; *you* must supply the URL your organisation is entitled to. |
| **D — Cannot serve live today** | 5 | Upstream reality. Each reason is recorded below. |
| **E — MOCK-only by design** | 2 | Operator-gated data with no public route. |

**So the real ceiling is 35 of 44 live on free credentials alone, 37 with an entitled endpoint.**
*(2026-08 baseline — superseded twice; the current figure is the box at the top of this section.)*
That kind of number is what to state — out loud, on camera, in front of judges. It is a far stronger
claim than "all of them", because every row of it survives being checked.

> **Re-verified 2026-09-10 (WP A3) — the ceiling moved up. The table and the paragraph above are kept
> verbatim as the pre-verification baseline; this note is the correction.** Every non-live row was
> re-probed today and two of them recovered, so the honest counts are now
> **A 28 · B 9 · C 1 · D 4 · E 2**, i.e. **37 of 44 live on free credentials alone, 38 with an entitled
> endpoint** — up from 35/37. What moved: `glofas` and `anm` join **A** (both keyless, both proven with a
> recorded 200 carrying real data today); `effis` leaves **C** for **D** because its blocker is no longer
> a missing URL — a free unauthenticated endpoint now demonstrably exists, and what stops us is our own
> anti-corruption layer. Every probe, with its status line, is in
> [`docs/audit/V2-A3-SOURCE-VERIFICATION-2026-09-10.md`](audit/V2-A3-SOURCE-VERIFICATION-2026-09-10.md).

### A — LIVE now, keyless (26 → **28** as of 2026-09-10, WP A3)

`nws`¹ · `nwps` · `open-meteo` · `gdacs` · `gdelt` · `agency-rss` · `eonet` · `openfema` · `nifc` ·
`nfhl` · `osm-overpass`² · `meteoalarm-ro` · `meteoalarm-gr` · `meteoalarm-es` · `wmo-swic` ·
`sensorcommunity` · `airnow`³ · `mastodon` · `caltrans-cctv` · `alertwildfire` · `metno`¹ · `cemsrm` ·
`hdxpop` · `caphub`⁴ · `nri` · `worldpop`⁵ · `glofas`⁶ · `anm`⁷ · `shelters-fema`⁸

⁶⁷ **added 2026-09-10 (WP A3)** — see the two footnotes below; both were re-classified on a recorded 200.
⁸ `shelters-fema` **added 2026-09-11**: the keyless FEMA ESF#6 open-shelters directory (US public
domain); consumed by `us-ca` as the shelter directory. With it class A is **29** and the ceiling is
**38 of 45** on free credentials (39 with an entitled EAGLE-I endpoint).

¹ `nws` and `metno` require a **real contact User-Agent** (`NWS_USER_AGENT`, `METNO_USER_AGENT`) — their
terms of service, not ours. met.no returns 403 without it; the adapter fails fast rather than pretend.
² `osm-overpass` is rate-limited by a shared community endpoint — the cadence is the global
`LIVE_REINGEST_INTERVAL_SEC` (a per-source `SOURCE_<PREFIX>_INTERVAL_SEC` is parsed but not yet consumed —
`docs/audit/UNIMPLEMENTED_REGISTER.md`); set `SOURCE_OSM_OVERPASS_MIRRORS` + a `SOURCE_OSM_OVERPASS_USER_AGENT`,
and consider your own Overpass instance for sustained production use.
³ `airnow` uses the keyless EPA file product and is **NOT_COVERED outside North America** by design.
⁴ `caphub` (IFRC Alert Hub) is keyless and live-capable, but ships CACHED as a **licensing** decision:
the aggregate carries no single licence grant, so each relayed alert cites its own issuing authority.
Flipping it to LIVE is an operator decision you make with your legal posture in mind.
⁵ `worldpop` is verified live for small AOIs; **region-scale polygons return an async task handle**, so
CACHED remains correct for whole-region queries until the async task-poll rung is built (roadmap).
**Re-verified 2026-09-10:** still async — `api.worldpop.org/v1/services/stats` answered
`200 application/json 152B` with `{"status":"created","taskid":"…"}`. CACHED remains correct.
⁶ `glofas` (added 2026-09-10, WP A11 + A3) speaks the real OGC WMS 1.3.0 service at
`ows.globalfloods.eu/glofas-ows/ows.py` — **keyless; `GLOFAS_CDS_KEY` is not read and not sent**.
Re-verified independently on 2026-09-10: `GetCapabilities` → `200 text/xml 147665B`; `GetFeatureInfo` at the
Romanian Siret/Lungoci point → `200 text/html 26315B` carrying Point ID `SI001084` and forecast date
`2026-09-10`. **The honest limit:** WMS `GetFeatureInfo` is a *click* protocol, not an enumeration protocol,
so LIVE coverage is exactly the reporting points you configure in `SOURCE_GLOFAS_POINTS` — and they must be
**real reporting-point coordinates**: a coordinate merely inside the region returns `200` with an empty body
(measured). With no points configured the LIVE rung has nothing to ask for and degrades to cache/mock.
⁷ `anm` (added 2026-09-10, WP A3) is keyless and was **environment-blocked, not upstream-blocked** — the
earlier TLS-handshake refusal **did not reproduce today**: the exact path the adapter calls,
`meteoromania.ro/wp-json/meteoapi/v2/starea-vremii`, answered `200 application/json 65582B` in 1.14 s with a
real `FeatureCollection` stamped `2026-09-10T20:00:00+03:00`. Because the block was environmental, re-check
from *your* network before relying on it; the fixture rung remains behind it either way.

### B — LIVE with a free credential (9)

| Adapter | Credential | Where to get it (free) |
|---|---|---|
| `firms` | `FIRMS_MAP_KEY` | https://firms.modaps.eosdis.nasa.gov/api/map_key/ |
| `census` | `CENSUS_API_KEY` | https://api.census.gov/data/key_signup.html |
| `reliefweb` | `RELIEFWEB_APPNAME` | https://apidoc.reliefweb.int/#appname — **must be registered/approved**; unregistered names get 403 |
| `opencellid` | `OPENCELLID_API_KEY` | https://opencellid.org/register |
| `openaq` | `OPENAQ_API_KEY` | https://explore.openaq.org/register (v3, sent as `X-API-Key`) |
| `windy-webcams` | `WINDY_WEBCAMS_API_KEY` | https://api.windy.com/webcams — attribution badge is mandatory |
| `dot511` | `DOT511_API_KEY` | per-state 511 developer portal (one key per state). The default host is **Georgia's** (`SOURCE_DOT511_URL`) and the adapter declares that host's state as its coverage, so it is not enabled for `us-ca` (California's cameras come from `caltrans-cctv` + `alertwildfire`) — set a same-shape California host before re-enabling it in `config/regions.json` |
| `lanceflood` | `EARTHDATA_TOKEN` | https://urs.earthdata.nasa.gov/ (free Earthdata login) |
| `bluesky` | `BLUESKY_IDENTIFIER` + `BLUESKY_APP_PASSWORD` | app password in Bluesky settings — **required since ~2026**: the keyless public AppView began 403-ing `searchPosts` from datacenter IPs |

Every one of these **fails fast at boot** if its mode is `live` and the credential is missing. That is
deliberate: a silently-degraded "live" source is a lie, and this system does not tell it.

### C — LIVE with an operator-supplied endpoint (2 → **1** as of 2026-09-10, WP A3)

| Adapter | Set | Why it is on you |
|---|---|---|
| `eagle-i` | `SOURCE_EAGLE_I_URL` | DOE/ORNL EAGLE-I's public dataset is **historical browse only**. Live outage feeds are supplied to entitled agencies. With no URL the adapter serves the recorded fixture and the outage layer stays "ASSUMED offline" — an inference, honestly labelled. |
| `effis` | `SOURCE_EFFIS_URL` | The adapter's default Copernicus EFFIS/GWIS query URL is a **best-effort construction that has not been confirmed**. Raw burned-area extracts are account-gated. **Confirm the URL before flipping to LIVE** — do not ship an unverified endpoint into production. — **2026-09-10 (WP A3): this row is now class D, not C, and both halves of the reason above are retired.** A **free, unauthenticated** EFFIS endpoint *does* exist and was proven today: `https://api.effis.emergency.copernicus.eu/rest/2/burntareas/current/` → `200 application/json 509469B`, `count=127594` real burnt-area `MultiPolygon`s, newest `lastupdate 2026-09-10T14:58` (it is the endpoint the official EFFIS V2 viewer itself calls). Nothing is account-gated and no URL is owed by your agency. **`effis` still stays CACHED** for one honest reason: the v2 API returns a Django-REST envelope `{count,next,previous,results[]}` with geometry at `shape`, while our ACL parses a GeoJSON `FeatureCollection` (`effis-acl.ts:57-61`) — pointed at it today the adapter would read **zero** features. The fix is an ACL port, not an env var; it is written up as PLAN-DELTA §5.1 of the A3 evidence doc. Also recorded there: region filtering must use `country=` (**Greece is `EL`**), `bbox=` is silently ignored, and `US`/`PH` return `count=0`. |

### D — Cannot serve live today (5 → **4** as of 2026-09-10, WP A3) — with the evidence

| Adapter | Why not | Status |
|---|---|---|
| `glofas` | ~~Copernicus **decommissioned the keyless JSON facade (2026-08)**; it now 301s into a SPA. `GLOFAS_CDS_KEY` exists for the OGC route but the live path is unproven since the change.~~ **SUPERSEDED 2026-09-10 (WP A11 + A3).** The JSON facade is indeed gone — that half was and remains true — but the adapter now speaks the real OGC **WMS 1.3.0** service at `ows.globalfloods.eu/glofas-ows/ows.py`, **keyless**: `GetCapabilities` `200 text/xml 147665B` and a `GetFeatureInfo` on the Romanian Siret point `200 text/html 26315B` (Point ID `SI001084`, forecast date `2026-09-10`), both re-verified independently today with no credential sent. | **Moved to class A** (see footnote 6) — LIVE coverage = the configured `SOURCE_GLOFAS_POINTS` list |
| `usgs-water` | The IV host is **decommissioning (Q1 2027)**; the OGC-API replacement is wired for host but the **query-param and response mapping are only partially migrated**. — **Re-verified 2026-09-10: still true, and the blocker is ours, not theirs.** `api.waterdata.usgs.gov/ogcapi/v0/collections` answered `200 application/json 199377B` with 37 collections including `latest-continuous`; `buildUrl` (`usgs-water-adapter.ts:132-134`) still appends the legacy IV query `?format=json&bBox=…&parameterCd=…` to that OGC host. | Documented-partial — MOCK is the honest default |
| `anm` | ~~Romania ANM **refused the TLS handshake** from this environment.~~ The fixture is a recorded *real* response. **SUPERSEDED 2026-09-10 (WP A3): the refusal did not reproduce.** The exact path the adapter calls, `meteoromania.ro/wp-json/meteoapi/v2/starea-vremii`, answered `200 application/json 65582B` in 1.14 s with a live `FeatureCollection` dated `2026-09-10T20:00:00+03:00` (the warnings feed `…/avertizari-generale` likewise `200`, 88174B, warning issued `2026-09-10T10:00`). Because the original block was **environmental**, re-check from your own network. | **Moved to class A** (see footnote 7) |
| `cnadnr-ro` | **No machine-readable live feed exists** — CNAIR publishes link-only pages. The CACHED catalog is hand-curated and verified. — **Re-verified 2026-09-10: the structural reason stands and is now stronger.** The curated pages no longer even return 200 to a server-side request: `cnadnr.ro/ro/trafic-live` and `…/fetesti-bucuresti-constanta-camera-1` both answered **`403 text/html 373B`**. The catalogue's "verified 200" provenance is historical, not current; MOCK-only with no server egress remains the only honest posture. | Structural — **and now 403-gated** |
| `hifld` | The HIFLD Open portal was **discontinued**; what remains is a **static 2019 package**. It is held out of every region because it displaces the seeded infrastructure slice and silently breaks derived outage marking. — **Re-verified 2026-09-10: "static 2019" is no longer an inference, it is the service's own timestamp.** The surviving ArcGIS FeatureServer answered `200 application/json 5875B`, and its *Electric Power Generation Plants* layer reports `editingInfo.dataLastEditDate = 1560435855899` = **2019-06-13**. | Held by design — needs merge-not-replace |

### E — MOCK-only by design (2)

`itu` (gated connectivity data, no keyless route) and `camara-gsma` (operator-gated Open Gateway, no
reachable public sandbox). Both are real, working adapters kept as **plugin proof**: the day you have an
operator contract, they serve without a core change. That is the portability argument, demonstrated.

**Re-verified 2026-09-10 (WP A3) — both reasons still hold.** ITU: `itu.int/itu-d/sites/dcm/` → `404`,
`datahub.itu.int/api/` → `403`; no keyless route to Disaster Connectivity Maps. CAMARA: the Telefónica
sandbox landing page answers `200 text/html 2015B` and the GSMA API-descriptions page `403` — reaching a
developer *portal* is not reaching an *API*, and every Open Gateway call still requires operator onboarding.

---

## 2. Step 1 — obtain the free credentials

Register the nine in class B above, plus these operational ones:

| Purpose | Variable | Source |
|---|---|---|
| Real road routing | `ORS_API_KEY` | https://account.heigit.org/signup (free tier) |
| AI synthesis (pick ≥1) | `GROQ_API_KEY` / `OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY` | provider console |
| Alert broadcast | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALERT_CHAT_IDS` | @BotFather |
| Required contact strings | `NWS_USER_AGENT`, `METNO_USER_AGENT` | your own contact e-mail — **not a placeholder** |

Secrets live **only** in `.env` (gitignored) or your platform's secret store. Never in a tracked file.

## 3. Step 2 — the all-live source profile

Append to `.env` (or set as platform variables). This is class A + class B at full live:

> **Set `live`, never `cached`, on a cloud platform (learned 2026-09-12).** `cached` contacts no upstream —
> by design, that is the air-gapped guarantee — and the last-known-good cache is written ONLY by a live
> fetch. A `cached` source therefore never warms its own cache, and on a platform whose cache is in-memory
> and whose container restarts on every deploy it serves the recorded fixture, labelled MOCK, for the life
> of the deployment. 21 sources on the reference deployment sat in exactly that state. `live` degrades
> live → cache → mock and is the only mode that ever produces real data. Pinned by three tests in
> `src/adapters/_shared/redundancy.test.ts`; full reasoning in `architecture/CONFIGURATION.md` §6.

```bash
# ── posture ───────────────────────────────────────────────────────────────
DEPLOY_MODE=cloud
DATA_SOURCE_COMPOSITION=adapters      # the opt-in live path

# ── class A: keyless live ────────────────────────────────────────────────
SOURCE_NWS_MODE=live
SOURCE_NWPS_MODE=live
SOURCE_OPEN_METEO_MODE=live
SOURCE_GDACS_MODE=live
SOURCE_GDELT_MODE=live
SOURCE_AGENCYRSS_MODE=live
SOURCE_EONET_MODE=live
SOURCE_OPENFEMA_MODE=live
SOURCE_NIFC_MODE=live
SOURCE_NFHL_MODE=live
SOURCE_OSM_OVERPASS_MODE=live
SOURCE_METEOALARM_RO_MODE=live
SOURCE_METEOALARM_GR_MODE=live
SOURCE_METEOALARM_ES_MODE=live
SOURCE_WMO_SWIC_MODE=live
SOURCE_SENSORCOMMUNITY_MODE=live
SOURCE_AIRNOW_MODE=live
SOURCE_MASTODON_MODE=live
SOURCE_CALTRANS_CCTV_MODE=live
SOURCE_ALERTWILDFIRE_MODE=live
SOURCE_METNO_MODE=live
SOURCE_CEMSRM_MODE=live
SOURCE_HDXPOP_MODE=live
SOURCE_NRI_MODE=live
SOURCE_CAPHUB_MODE=live               # licensing decision — see §1 note 4
NWS_USER_AGENT=BEACON (contact: ops@your-agency.example)
METNO_USER_AGENT=BEACON (contact: ops@your-agency.example)

# ── class B: live with a free credential ─────────────────────────────────
SOURCE_FIRMS_MODE=live
FIRMS_MAP_KEY=...
SOURCE_CENSUS_MODE=live
CENSUS_API_KEY=...
SOURCE_RELIEFWEB_MODE=live
RELIEFWEB_APPNAME=...                 # must be REGISTERED, else 403
SOURCE_OPENCELLID_MODE=live
OPENCELLID_API_KEY=...
SOURCE_OPENAQ_MODE=live
OPENAQ_API_KEY=...
SOURCE_WINDY_WEBCAMS_MODE=live
WINDY_WEBCAMS_API_KEY=...
SOURCE_DOT511_MODE=live
DOT511_API_KEY=...
SOURCE_LANCEFLOOD_MODE=live
EARTHDATA_TOKEN=...
SOURCE_BLUESKY_MODE=live
BLUESKY_IDENTIFIER=you.bsky.social
BLUESKY_APP_PASSWORD=...

# ── class C: only if you have the entitled endpoint ──────────────────────
# SOURCE_EAGLE_I_MODE=live
# SOURCE_EAGLE_I_URL=https://...
# SOURCE_EFFIS_MODE=live
# SOURCE_EFFIS_URL=https://...        # CONFIRM before enabling

# ── class D/E stay honest ────────────────────────────────────────────────
# 2026-09-10 (WP A3): glofas and anm moved to class A — the two lines below are the
# CONSERVATIVE posture, not a limit. To run them live instead, see §1 footnotes 6 and 7:
#   SOURCE_GLOFAS_MODE=live
#   SOURCE_GLOFAS_POINTS=27.525,45.575     # real reporting points only (RO: Siret at Lungoci, SI001084)
#   SOURCE_ANM_MODE=live                    # re-check reachability from YOUR network first
SOURCE_GLOFAS_MODE=cached
SOURCE_USGS_WATER_MODE=mock
SOURCE_ANM_MODE=cached
SOURCE_CNADNR_RO_MODE=cached
SOURCE_HIFLD_MODE=cached
SOURCE_ITU_MODE=mock
SOURCE_CAMARA_GSMA_MODE=mock
SOURCE_WORLDPOP_MODE=cached           # region-scale AOIs are async — see §1 note 5

# ── ingest cadence ───────────────────────────────────────────────────────
LIVE_REINGEST_INTERVAL_SEC=300   # THE live cadence: one re-ingest pass over every region
INGEST_DEFAULT_INTERVAL_SEC=300  # scheduler-level default for the background jobs
# NOTE: a per-source SOURCE_<PREFIX>_INTERVAL_SEC is parsed but consumed by nothing today — it does NOT
# change polling (docs/audit/UNIMPLEMENTED_REGISTER.md). To poll a shared service less often, raise
# LIVE_REINGEST_INTERVAL_SEC or set that source's mode to `cached`.
```

**Poll responsibly.** These are free public services run by agencies and volunteers. Fast polling of
Overpass, GDELT or Mastodon will get you rate-limited or blocked, and a blocked source helps nobody in
an emergency. Today the only cadence control is the global `LIVE_REINGEST_INTERVAL_SEC` (plus a source's
mode): raise it rather than hammering a volunteer endpoint, and run your own Overpass instance for
sustained production use. Per-source cadence is on the roadmap.

## 4. Step 3 — a real database (durable logistics, reports, alerts, audit)

The demo runs `FEATURE_STORE=memory`: everything is lost on restart. Production must not.

```bash
FEATURE_STORE=postgres
DATABASE_URL=postgres://beacon:CHANGE_ME@your-db-host:5432/beacon
FEATURE_CACHE=redis                   # optional but recommended
FEATURE_QUEUE=bullmq                  # durable ingest scheduling
FEATURE_EVENTBUS=redis                # multi-instance fan-out
REDIS_URL=redis://your-redis-host:6379
FEATURE_REALTIME=sse
```

Provision and migrate:

```bash
docker compose -f infra/docker-compose.yml up -d db     # or point at your managed Postgres
npm run migrate                                          # drizzle-kit migrate — creates every table (23)
npx tsx scripts/pg-probe.ts                              # verifies connectivity + schema
```

**What becomes durable:** resources and the full task lifecycle, shelters and capacity, public reports
and their verification state, damage reports, volunteer teams, supply lots, alerts and their approval
chain, and the **hash-chained audit log** — the accountability record that survives restart.

**Two honest gaps that persist even with Postgres** (recorded in
[`docs/audit/UNIMPLEMENTED_REGISTER.md`](audit/UNIMPLEMENTED_REGISTER.md), on the roadmap):

- ~~**Evacuation routes are not persisted.** Routes are computed on request and returned; the `evac_route`
  store exists but nothing calls it.~~ **Superseded (2026-09-14):** under `FEATURE_STORE=postgres` the route
  trail store is composed (`evacRouteTrail`, feature-seed) and every served route is recorded.
- ~~**SitRep/citation persistence is built but not wired.**~~ **Superseded (2026-09-14):** SitReps are still
  derived live on every read (which is why they are always fresh), and under Postgres each read is ALSO
  recorded with its citations (`makePgSitRepHistoryStore`, build-core; ADR-039 resolves the two FK ids
  through the natural keys).

Neither affects live operation; both affect after-action reconstruction. Say so rather than discovering
it in an audit.

`FEATURE_SPATIAL=postgis` exists as an alternative to the default in-process Turf engine — note that
the shipped compose file uses stock `postgres:16-alpine`, so you must supply a **PostGIS-enabled image**
before enabling it. Turf is the tested default and is correct at region scale.

## 5. Step 4 — real AI synthesis

```bash
AI_MODE=cloud                         # cloud | local | off
LLM_TIER_DEFAULT_PROVIDER=groq
LLM_TIER_DEFAULT_MODEL=openai/gpt-oss-120b
LLM_TIER_FALLBACK_PROVIDER=openrouter
LLM_TIER_FALLBACK_MODEL=anthropic/claude-haiku-4-5
GROQ_API_KEY=...
OPENROUTER_API_KEY=...
BUDGET_PER_INCIDENT_USD=5.00
BUDGET_PER_REGION_USD=50.00
```

For a fully self-hosted deployment with **no external AI dependency**, use `AI_MODE=local` with Ollama
(`OLLAMA_BASE_URL`, `LLM_TIER_LOCAL_MODEL`). For an air-gapped deployment, `AI_MODE=off` — and the COP,
rankings, thresholds, routing and logistics all still work, because **every number is deterministic**.
The LLM narrates; it never computes. Verify that claim yourself: flip `AI_MODE=off` and confirm the
figures are unchanged.

Check your AI path before you rely on it: `npx tsx scripts/ai-probe.ts`.

## 6. Step 5 — real alert delivery

```bash
CHANNEL_TELEGRAM_MODE=live
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ALERT_CHAT_IDS=-1001234567890
TELEGRAM_WEBHOOK_SECRET=...           # required for webhook mode
```

Delivery happens **only after a human approves a DRAFT alert into ACTUAL** — never automatically. The
broadcast is PII-redacted and audited, and a broadcast failure is audited, not fatal (a failed Telegram
send must never take down the COP).

## 7. Step 6 — real road routing

```bash
FEATURE_ROUTING=ors
ORS_API_KEY=...
```

This gives true road routing with **avoid-polygons built from the live hazard footprint**. Without it,
the hazard-avoiding heuristic serves through the same port — and the UI names which engine produced the
route, so an operator always knows what they are looking at.

## 8. Step 7 — worldwide coverage

Five regions ship configured: `us-ca`, `ro`, `es`, `gr`, `ph`. Each is a `config/regions.json` entry —
a bbox plus an **ordered** `enabled_adapters` list, where order *is* precedence: the first adapter that
serves a slot wins it, and every consulted adapter is cited in that order.

To cover a new area anywhere in the world, add a region:

```jsonc
{
  "id": "au-nsw",
  "name": "New South Wales",
  "scope": "STATE",
  "iso": "AU",
  "bbox": [140.99, -37.51, 153.64, -28.16],
  "enabled_adapters": ["firms", "gdacs", "open-meteo", "metno", "osm-overpass",
                       "gdelt", "agency-rss", "mastodon", "eonet", "caphub",
                       "openaq", "sensorcommunity", "hdxpop", "worldpop"],
  "source_mode_overrides": {}
}
```

Set `DEFAULT_REGION_ID` to open there by default. **No code change is required** — this is the
adapter/plugin architecture doing the job it was designed for.

Build the list from **globally-scoped** adapters (FIRMS, GDACS, EONET, GDELT, Open-Meteo, met.no,
Overpass, OpenAQ, Sensor.Community, CAP Hub, HDX, WorldPop, Mastodon). US-only adapters (NWS, NWPS,
NIFC, NFHL, AirNow, Census, OpenFEMA, EAGLE-I, NRI, Caltrans, DOT511) will honestly report
`NOT_COVERED` outside their coverage rather than fabricate — which is why a non-US region still yields a
complete COP, just from different rungs.

## 9. Step 8 — start it, then prove nothing is mocked

```bash
npm run build && npm start
npm run live:probe                 # probes every configured live source over real egress
```

Then assert it from the outside — this is the check to run on camera, and the one a judge can repeat:

```bash
# every source and its EFFECTIVE mode, per region
curl -s "http://localhost:3000/api/v1/sources?regionId=us-ca" | jq '.sources[] | {sourceId, mode, fetchedAt}'

# fail loudly if anything is still MOCK
curl -s "http://localhost:3000/api/v1/sources?regionId=us-ca" \
  | jq -e '[.sources[] | select(.mode=="MOCK")] | length == 0' \
  && echo "ALL LIVE ✅" || echo "still mocked ⚠ — see the list above"
```

`mode` is the **effective** mode the adapter actually served with — not what you asked for in `.env`. If
a live source fails, the ladder degrades to CACHED and the badge says CACHED, in the API and on every
map layer. That is the system working correctly, and it is what makes the freshness badges trustworthy.

**Two checks that did not exist before 2026-09-12, and would have saved a day:**

```bash
node scripts/check-live.mjs --base https://<host>          # one command, eight checks, exit code
```

It prints a `live posture` line BEFORE the per-source list — `DATA_SOURCE_COMPOSITION` gates the whole
adapter path and defaults to `seed`, under which every source reports MOCK whatever its own mode says, so
the posture has to be read first or 38 correct modes look like 38 broken upstreams. And when a source does
fall back, the runtime log now says why:

```
[beacon] source degraded: gdacs LIVE->MOCK — UPSTREAM_UNAVAILABLE: https://www.gdacs.org/<redacted> 503
```

One line per fetch that stepped down a rung, never on a healthy one, never for a source configured MOCK,
and never carrying a credential (everything after the host is redacted, because FIRMS keeps its key in the
path). Before this the classified reason was computed on every failure and discarded.

**Warm the caches before any demo or drill:** the first request per region performs real upstream
fetches and can take ~30 s. Every request after it is sub-second.

## 10. Operating notes

- **Retention.** `RETENTION_SWEEP_ENABLED=on` with `RETENTION_SWEEP_INTERVAL_SEC=3600` runs the scheduled
  purge. Production handling of public reports depends on it.
- **Security posture.** Set `NEXT_PUBLIC_DEPLOY_POSTURE=live` (removes the dev role-switcher) and leave
  `AUTH_DEV_TRUST_HEADER` and `AUTH_DEV_LOGIN` **unset**. The dev role header is spoofable by design —
  trusting it on a public deployment hands Emergency Manager rights to any visitor. Configure real
  accounts via `AUTH_USERS` with a strong `AUTH_SECRET` (passwords are never stored — scrypt-derived
  under a per-user salt, compared in constant time).
- **Budgets.** `BUDGET_PER_INCIDENT_USD` / `BUDGET_PER_REGION_USD` are hard caps on AI spend, with a soft
  escalation threshold that triggers human review. An emergency system must not be able to surprise its
  agency with a bill.
- **Scale.** With `FEATURE_QUEUE=bullmq` + `FEATURE_EVENTBUS=redis`, multiple app instances share one
  ingest schedule and fan events out to all connected browsers. Region-partitioned workers keep latency
  flat as coverage grows.
- **Attribution is not optional.** Sensor.Community (ODbL share-alike), OSM (ODbL), Windy, ALERTWildfire
  (CC BY-NC-ND), Open-Meteo (CC BY 4.0) and others require visible credit. It ships in `NOTICE` and in
  the in-app attribution badges — keep both.

## 11. What stays true at full live

Turning everything up does **not** change the system's contracts, and this is the part worth saying to
an emergency manager:

- Every figure is still **deterministic** — the LLM narrates and never computes a number.
- Every claim still **cites** the record that produced it; an uncited field renders as an error.
- Crowdsourced and social input is still **corroboration-only**, badged Unverified, and still requires a
  **human** to verify before it can influence action.
- Alerts are still **DRAFT until a human approves them**.
- A source outage still **degrades to a labelled rung** instead of dead-ending the picture.
- The seven adapters that cannot serve live still say so, on screen, rather than pretending.

Running live raises the freshness of the inputs. It does not lower the standard of proof — that is the
whole design.

---

*See also: [`docs/OPERATOR_GUIDE.md`](OPERATOR_GUIDE.md) (using the three core workflows),
[`docs/CLOUD_DEPLOY_RAILWAY.md`](CLOUD_DEPLOY_RAILWAY.md) (one-platform deploy),
[`docs/audit/DATA_SOURCE_VERIFICATION.md`](audit/DATA_SOURCE_VERIFICATION.md) (per-source verdicts and
evidence), [`docs/SPEC.md`](SPEC.md) §13 and
[`docs/audit/UNIMPLEMENTED_REGISTER.md`](audit/UNIMPLEMENTED_REGISTER.md) (the honest-limitations ledgers).*

## Always-on front for the public address (`homepage-offline/`)

The public address https://quest-beacon.up.railway.app is owned by a separate, very small Railway
service built from `homepage-offline/` (Node core only, no dependencies, no build step). When the
deployment is running it passes every request through unchanged; when the deployment is switched off
it serves one page that explains the project, the contest status and how to request access, and
answers API paths with a JSON `503`. It decides by probing `GET /api/v1/health` on the deployment's own
address (`UPSTREAM_URL`) every few seconds. Nothing is switched by hand: start or stop the deployment's
services and the address follows. Setup, settings and the two modes are in `homepage-offline/README.md`.

