# BEACON — Live status: the single source of truth (2026-09-15)

**Every line below was produced by running `npm run check:live`, reading the deployment log and the
adapter registry on 2026-09-15.** It supersedes any live/mock claim in any other document. Re-run before
quoting: the deployment changes as its variables do.

## 1. The reference deployment

https://quest-beacon.up.railway.app — production posture (`DEPLOY_MODE=cloud`, dev seams hard-off),
`DATA_SOURCE_COMPOSITION=adapters`, re-ingest every 300 s, `FEATURE_STORE=postgres` (migrated, seeded by
the app when it finds the database unseeded — ADR-046), named-account sign-in, live posture chip,
CSP + HSTS on every route, boot warm-up so the first request never waits for the composition.

`npm run check:live --region us-ca` → **12 pass / 2 warn / 0 fail**; `--region ro` → **11 / 2 / 0**
(anonymous). The two warnings are the same on both: some sources are not live (below), and the
signed-in checks are skipped without an account. Signed in, the checker also proves the SitRep with
cited fields, the resource roster, an evacuation route with its distance and shelters, a public report
landing in the verification queue, and every served layer inside the region outline.

## 2. Per-source truth on the deployment (region us-ca and ro, 38 sources consulted)

| Tier | Sources | Why |
|---|---|---|
| **LIVE now** (26) | FIRMS · NIFC · NWS · NWPS · Open-Meteo · GDACS · EONET · agency RSS · ReliefWeb · Mastodon · Bluesky · MeteoAlarm (ES/GR) · met.no · WMO SWIC · NFHL · NRI · OpenFEMA · CAP hub · LANCE flood · HDX population · OpenCelliD (metered) · Caltrans CCTV · ALERTWildfire · Windy webcams · OpenAQ · Sensor.Community · FEMA shelters · CEMS-RM | fetched every cycle; each stamped with its own `fetchedAt` |
| **CACHED by configuration** | ANM (RO), CNADNR (RO), Census (needs a free key), EAGLE-I (entitled endpoint), EFFIS (no queryable service), Sentinel-2/GWIS/InciWeb/outage-proxy (registered `cached`) | `cached` on a platform with an in-memory cache is MOCK after every restart until the mode is `live` |
| **CACHED → MOCK by reachability** | **OSM Overpass** — `overpass-api.de` answers `fetch failed` from the Railway host every cycle (and `406` to any client without a User-Agent — fixed 2026-09-15); **GloFAS** for regions with no configured reporting point (the log now says so); **GDELT** rate-limits by IP | mirror ladder + User-Agent (see §4); `SOURCE_GLOFAS_POINTS` per region |
| **MOCK by design** | ITU · CAMARA/GSMA (operator-gated) · USGS Water (partial OGC migration; NWPS is the live US gauge rung) · WorldPop (regional sync unsupported upstream) | documented limitations |
| **Not consulted** | `hifld` (held out of every region), `dot511` (covers Georgia only; removed from California) | coverage, not failure |

**Incidents.** Live-only picture (`LIVE_PICTURE=auto`): California shows the wildfires discovered from
FIRMS/NIFC/NWS; Romania shows **no incident while no live fire or flood is published there**, and says so
on screen. `LIVE_PICTURE=hybrid` draws the seeded demo scenario beside the live picture, labelled.

## 3. Verified capabilities (each executed against the deployment)

| Capability | Evidence |
|---|---|
| Live composition, five regions, 300 s re-ingest | `check:live` freshness ≤ 5 min; `/api/v1/health` `startedAtMs` vs `fetchedAt` |
| Named-account sign-in, fail-closed roles | wrong password → 401; spoofed `x-beacon-role` → PUBLIC; `/me` shows the verified role |
| Full persona chain | PUBLIC report 201 → VERIFIER queue → verify → EM approve → CAP DRAFT→ACTUAL, audited |
| Precision gating | PUBLIC gets `position`; RESPONDER+ additionally `precisePosition` |
| Routing | `POST /routes` 200 with distance/duration and nearest shelters (ORS with heuristic fallback logged) |
| Threshold rules from the table | `GET /threshold-rules` (EM) lists the seeded rules; live signals evaluate them every cycle (ADR-044) |
| Security headers | `Content-Security-Policy`, `Strict-Transport-Security` on page and API routes (`x-powered-by` still appears on page routes on this platform — cosmetic) |
| Self-seed | deploy log `[beacon] seeded 5 regions, 43 resources, 3 shelters, 3 threshold rules, 4 users` |

## 4. Operator actions that change the tiers above

| Change | Effect |
|---|---|
| `SOURCE_OSM_OVERPASS_MIRRORS=https://lz4.overpass-api.de/api/interpreter,https://overpass-api.de/api/interpreter,https://maps.mail.ru/osm/tools/overpass/api/interpreter` + `SOURCE_OSM_OVERPASS_TIMEOUT_MS=30000` | Overpass tries a second and third instance when the first is unreachable from the host; the deployment build after 2026-09-15 also sends a User-Agent |
| `SOURCE_GLOFAS_POINTS` with one reporting point per region (Romania: `27.512,45.556`) | GloFAS LIVE for that region |
| `AIRNOW_API_KEY` (free) | AirNow live instead of excluded |
| `CENSUS_API_KEY` (free) | Census live |
| `LIVE_PICTURE=hybrid` + redeploy | demo scenario shown beside live |
| `LOG_LEVEL=info` | one degraded line per source per cycle stops |
| `NEXT_PUBLIC_PWA=on` (build) | installable, offline-capable COP |

A variable change is applied only by a redeploy; the give-away that it was not is a source whose mode
differs from the store — compare with `railway ssh --service Quest-BEACON -- sh -c 'env | grep ^SOURCE_'`.

## 5. How to run it — three lanes

```bash
# A) AIR-GAPPED (no keys, no egress, ≈ $0) — the reproducibility floor
docker compose -f infra/docker-compose.yml up -d --build   # or: nvm use && npm install && npm run dev

# B) FULL LIVE, LOCAL (.env) — docs/LIVE_PRODUCTION_GUIDE.md profile
npm run docker:up                    # renders .env for compose, builds, runs
BEACON_DEBUG_LIVE=1 npm run live:probe

# C) CLOUD (Railway) — docs/CLOUD_DEPLOY_RAILWAY.md; docs/RELEASE_GUIDE.md §3 lists what must be set
npm run demo:on && npm run check:live
```

The gates stay immune to `.env` (`playwright.config.ts` pins the offline profile), so `npm test` and
`playwright test` mean the same thing on every machine and a test can never message real humans.
