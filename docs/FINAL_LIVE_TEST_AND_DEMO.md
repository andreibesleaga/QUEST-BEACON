# BEACON — FINAL Live Test & Demo Master File

> **The one file to run everything live.** All API keys (what/where/how to get), every scenario
> (offline → fully-live, US + Romania, all sources, AI, Telegram, routing, vision, logistics,
> misinformation check, alerts/interop), what you must SEE at each step, and the final demo script
> mapped to the 5 IEEE rubric categories. Companion detail: `E2E_TESTING_PLAYBOOK.md` (captured real
> outputs + screenshots), `audit/FINAL_LIVE_AUDIT.md` (what is proven), `DEMO_SCRIPT.md` (video cut).
> Status of record **(recounted by machine 2026-08-02 — lens-7, F-411 class; every figure in the preserved
> line below was stale)**: **30 adapters registered, 28 consumed**; the **two** not consumed by any shipped
> zone are `itu` and `camara-gsma` (operator-gated MOCK-only, by design) — `usgs-water` **is** consumed now
> (it is in `us-ca`'s `enabled_adapters`). Registered = `config/adapters.json → adapters.length` = the
> `ADAPTER_FACTORIES` entry count (`src/main/adapter-registry.ts:56-94`); consumed = the union of
> `enabled_adapters` across the five zones in `config/regions.json`. Gate figures **re-measured 2026-08-02 after F-417 was
> fixed**: `tsc` 0 · `eslint` 0 · `vitest run --coverage` **306 files / 3773 passed / 2 skipped, exit 0**
> (all floors met, including the new `app/**` floor) · `depcruise src app` **0 violations / 729 modules** ·
> `npm audit` **0 high / 0 critical** · `next build` ✅ · Playwright **190 passed / 26 skipped / 0 failed**.
> *(An earlier version of this line reported the suite RED — 304 files / 3 failing on the Art. XIII
> approve-with-CAP path. That red was real and it was reporting a real product fault: the seeded
> verifier-queue rows carried no `incidentId`, so "Approve + CAP" emitted nothing. Fixed at the root as
> finding **F-417** — see `docs/SPEC.md` §13.13 — not by adjusting the test.)*
>
> *Preserved historical line (Phase-D + E11 authoring date):* 27 adapters registered, 24 consumed (19 COP data sources + 5
> Live-Views camera sources; `usgs-water`/`itu`/`camara-gsma` not consumed by design), gates green (vitest
> 206 files/1832 pass/2 env-gated skip · Playwright 53/0/3 skip · axe 0 s/c · TTTP ~0.83 s).
>
> **§2026-08-10 recount (live-demo delivery S1–S3).** Current, machine-verified: **44 adapters registered /
> 41 consumed / 3 not consumed** — `itu` + `camara-gsma` (MOCK-only by design) and `hifld` (registered but
> HELD out of every region's allowlist: its static-2019 snapshot displaces the seeded infrastructure the
> derived-outage marking depends on; merge-not-replace slot design is an open register item). Gates
> 2026-08-10: `tsc` 0 · `eslint` 0 · vitest **361 files / 4509 passed / 2 skipped** · depcruise **0/844** ·
> OpenAPI 36 paths/39 ops. Playwright is mid-re-baseline: the planned S3 UI delta moved 5 visual baselines
> (4 `cop.png` re-minted + verified; `cop-rtl.png` verdicted legitimate, re-mint pending) — see §5e for the
> S3 scenario additions and the two flake classes found while confirming.

---

## 0. One-time setup

```bash
cd Phase3
source ~/.nvm/nvm.sh && nvm use          # Node 24.x (pinned .nvmrc)
npm install
cp .env.example .env                     # then fill keys below — .env is gitignored, NEVER commit it
```

Gate sanity (all must be green before any demo):
```bash
./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/eslint . \
  && ./node_modules/.bin/vitest run --coverage && npm run boundaries \
  && rm -rf .next && ./node_modules/.bin/next build
rm -rf .next && ./node_modules/.bin/playwright test        # full matrix: 5 zones × 4 device projects (expect 0 failed; skips are designed)
```

---

## 1. ALL API keys & credentials (complete inventory)

### 1a. Keyless — LIVE with no key at all (work right now)
| Source | Env (only if tweaking) | Notes |
|---|---|---|
| NWS alerts/obs (US) | `NWS_USER_AGENT="BEACON (you@email)"` | UA string required by NWS policy, any value |
| NOAA NWPS flood gauges (US) | — | live-proven |
| Open-Meteo weather (global) | — | live-proven |
| GDACS global events | — | live-proven (polygon-footprint fix 2026-07-15) |
| GDELT news (global) | — | aggressive 429s — honest degrade to MOCK is expected sometimes |
| Agency RSS / InciWeb | `AGENCYRSS_FEEDS`, `AGENCYRSS_FEEDS_RO` | defaults ship; max 3 feeds/fetch |
| NIFC fire perimeters (US) | — | ArcGIS REST, keyless |
| FEMA NFHL flood zones (US) | — | ArcGIS REST, keyless |
| WorldPop population (global) | — | sync (`runasync=false`) rung |
| OSM Overpass infrastructure | — | rate-limited: CACHED default, LIVE capable; ODbL attribution in NOTICE |
| USGS Water | — | |
| Bluesky (vetted-social) | — | public API is CDN-bot-gated from servers → MOCK default (honest) |
| EFFIS (EU fire) | — | CACHED-only — former endpoint **confirmed DEAD upstream** (301 → S3 `NoSuchKey`, 2026-08); re-point is an open register item |
| EAGLE-I outages | `SOURCE_EAGLE_I_URL=<override>` | historical dataset; LIVE needs an explicit URL |

### 1b. Free-registration keys (each flips one source to LIVE)
| Key env var | Get it at | Flips |
|---|---|---|
| `FIRMS_MAP_KEY` | firms.modaps.eosdis.nasa.gov (NASA Earthdata, free) | `SOURCE_FIRMS_MODE=live` — live satellite hotspots |
| `RELIEFWEB_APPNAME` | reliefweb.int/help/api (register app name) | `SOURCE_RELIEFWEB_MODE=live` |
| `CENSUS_API_KEY` | api.census.gov/data/key_signup.html | `SOURCE_CENSUS_MODE=live` (US population) |
| `OPENCELLID_API_KEY` | opencellid.org (free tier) | `SOURCE_OPENCELLID_MODE=live` (CC BY-SA) |
| `ORS_API_KEY` | openrouteservice.org/dev (free tier) | `FEATURE_ROUTING=ors` — real road evacuation routes |
| `SOURCE_GLOFAS_POINTS` (keyless; `GLOFAS_CDS_KEY` is not read) | GloFAS reporting-point catalogue | `SOURCE_GLOFAS_MODE=live` (EU flood) |
| `WINDY_WEBCAMS_API_KEY` | api.windy.com (Windy API portal → Webcams API, free) | `SOURCE_WINDY_WEBCAMS_MODE=live` — Windy live camera pins (mandatory "provided by windy.com" badge) |
| `DOT511_API_KEY` | per-state 511 developer portal (e.g. 511ga.org, free) | `SOURCE_DOT511_MODE=live` — state 511 DOT CCTV pins |

### 1c. Cloud AI (LLM narration) — OpenRouter profile (already in your `.env`)
```bash
AI_MODE=cloud
LLM_TIER_DEFAULT_MODEL=anthropic/claude-haiku-4-5
LLM_TIER_DEFAULT_BASE=https://openrouter.ai/api/v1
LLM_TIER_DEFAULT_KEY=sk-or-v1-…        # your OpenRouter key
```
Alternates (same envelope): Groq (`https://api.groq.com/openai/v1` + Groq key), local Ollama
(`LLM_TIER_LOCAL_*`). `AI_MODE=off` (default) = deterministic-only — the app is FULLY functional without AI.

### 1d. Telegram (real bot — the live alert channel)
1. In Telegram, talk to **@BotFather** → `/newbot` → copy the token → `TELEGRAM_BOT_TOKEN=…`
2. Send your bot any message, then get your chat id: `curl "https://api.telegram.org/bot<TOKEN>/getUpdates"`
   → `message.chat.id` → `TELEGRAM_ALERT_CHAT_IDS=<id>` (comma-separate several).
3. `CHANNEL_TELEGRAM_MODE=live`
4. Inbound, EITHER (mutually exclusive): **poller** (localhost demo) `npm run telegram:poll` — OR —
   **webhook** (public HTTPS): set `TELEGRAM_WEBHOOK_SECRET=<random>` and register
   `curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<host>/api/v1/channels/telegram/webhook&secret_token=<secret>"`

### 1e. App/auth/infra
```bash
AUTH_SECRET=<any 32+ char random>   # real JWT signing
AUTH_DEV_LOGIN=on                   # demo IdP: POST /api/v1/auth/dev-login (local only; hard-off in cloud)
DATABASE_URL=postgres://beacon:beacon@localhost:5432/beacon   # for FEATURE_STORE=postgres
FEATURE_STORE=postgres              # durable reports/audit AND logistics since S1 (COP stays live in-memory by design)
DATA_SOURCE_COMPOSITION=adapters    # THE live switch: seed enrichment through the 44-adapter registry
FEATURE_VISION=on                   # vision advisory (MockVision unless a vision provider is configured)
```

> **Cloud (Railway) + judge access:** the internet-reachable lane is documented separately in
> [CLOUD_DEPLOY_RAILWAY.md](CLOUD_DEPLOY_RAILWAY.md) — cloud hard-offs the dev header/dev-login by design;
> judges sign in via the toolbar with named `AUTH_USERS` accounts (id + password, builds with
> `NEXT_PUBLIC_AUTH_TOKEN_LOGIN=on`); `npm run auth:mint-tokens` remains for headless/API use
> (`Authorization: Bearer`). Verified fail-closed 2026-08-04.

> **⚠ Four `.env` traps found the hard way (2026-08-04)** — one bad row fail-fasts a WHOLE region's live
> registry (by design; run `BEACON_DEBUG_LIVE=1 npm run live:probe` to see the exact row named):
> `SOURCE_EAGLE_I_MODE`/`SOURCE_CNADNR_RO_MODE` can never be `live` (no live endpoint exists — cached/mock
> only), and `SOURCE_CENSUS_MODE`/`SOURCE_DOT511_MODE` may be `live` only once their keys are actually
> filled in. Upstream realities, all verified with real requests: ReliefWeb 403s until the appname is
> approved by ReliefWeb; Bluesky public search now 403s keyless (mock by design); FEMA NFHL resets TLS
> from non-US networks (works from US egress, e.g. Railway); GDELT 429-rate-limits aggressively.

---

## 2. Scenario matrix — run them in this order

Each scenario: the command block, then **VERIFY** = what you must see.

### A. Offline / air-gapped baseline (Art. XVI — always first)
```bash
unset DATA_SOURCE_COMPOSITION AI_MODE; rm -rf .next && npm run dev   # http://localhost:3000
```
**VERIFY:** full COP renders on seeds — fire+flood+infra+exposure+reports+prediction+route+shelters AND
the Phase-D layers (toggle ON: Power outages ["ASSUMED offline" caveat], Cell coverage, Weather wind glyph
[US-CA], Flood zones NFHL [RO]); every layer shows a MOCK freshness badge; SitRep is deterministic-only
(`ai_mode: deterministic`); logistics board shows resources/tasks/shelters + **Pre-positioning suggestions
(Advisory — human decides)**; nothing errors with zero egress.

### B. Docker full stack (judge-reproducible, ~$0)
```bash
npm run docker:up
```
Use the npm script, not bare `docker compose up`: it renders your `.env` into the compose env-file
first — bare compose skips that step and the stack falls back to the offline defaults.
**VERIFY:** db healthy → migrate exit 0 → app on :3000; 19 tables; `GET /api/v1/status` 200 envelope;
`.well-known/sustainability` 200. `FEATURE_STORE=postgres` is preset — submit an SOS report, restart the
app container, report survives (durable) and audit hash-chain intact.

### C. US-CA LIVE (keyless real egress)
```bash
DATA_SOURCE_COMPOSITION=adapters SOURCE_NWS_MODE=live SOURCE_NWPS_MODE=live \
SOURCE_OPEN_METEO_MODE=live SOURCE_GDACS_MODE=live SOURCE_GDELT_MODE=live \
SOURCE_AGENCYRSS_MODE=live SOURCE_NIFC_MODE=live SOURCE_WORLDPOP_MODE=live \
NWS_USER_AGENT="BEACON (you@email)" npm run dev
# or non-interactive proof:
npm run live:probe
```
**VERIFY:** `/status` source list shows LIVE for nws/nwps/open-meteo/gdacs (+gdelt/agency-rss/nifc/worldpop
when their endpoints cooperate — a 429/timeout shows CACHED/MOCK **with the honest label**: that IS the
redundancy ladder demo); map freshness badges show per-layer LIVE stamps; SitRep weather fact carries the
real current wind.

### D. + your free keys (1b) — full-catalog live
Add `SOURCE_FIRMS_MODE=live SOURCE_RELIEFWEB_MODE=live SOURCE_CENSUS_MODE=live
SOURCE_OPENCELLID_MODE=live SOURCE_GLOFAS_MODE=live` with their keys in `.env`.
**VERIFY:** live FIRMS hotspots on the fire layer; ReliefWeb items in the SitRep news field citations;
census-based exposure ("WorldPop/census estimate" label); live cell sites.

### E. Romania (multi-region, EU sources)
Switch region to RO in the UI (or `?region=ro`).
**VERIFY:** GloFAS gauge (live w/ key), meteoalarm-ro OFFICIAL news, Open-Meteo live weather, NFHL flood-zone
layer falls back to seeded zones (US-only source — honestly labeled), US-only sources absent (never
mislabeled); golden path works identically.

### F. Cloud AI narration + F3 proof
```bash
set -a; source .env; set +a; PROBE_ROLE=EM AUTH_DEV_TRUST_HEADER=on npm run ai:probe
```
**VERIFY:** `aiMode: cloud`, 3+ citations, prose numbers ⊆ cited fact numbers, `F3 … PASS`, OTel line with
`gen_ai.usage.*` + `cost_usd`. In the UI: SitRep panel shows narrated summary + identical numbers to AI-off
(toggle `AI_MODE=off` and compare — the fields/numbers must not change; only prose).

### G. News fusion + misinformation check (the differentiator)
With scenario C/D running, open the SitRep (US-CA):
**VERIFY:** a `news-*` field like "N authoritative sources report wildfire… (outlets…)" with one citation
per outlet; any uncorroborated social item appears ONLY as "Unverified social report — not corroborated"
(flagged, never merged). Verifier queue: each report shows the confidence meter + component bars
(geocode/authority/classifier/corroboration); click **Reject** on a suspect report → REJECTED transition,
no outbound anything (Art. XIII/XIV on camera).

### H. Alerts end-to-end + Telegram broadcast (HITL)
1. As EM/VERIFIER (dev-login), threshold engine has DRAFT alerts in the queue (`GET /api/v1/alerts`).
2. Approve one: `POST /api/v1/alerts/{id}/approve`.
**VERIFY:** 201, alert becomes ACTUAL with `approvedBy`=your JWT sub; CAP v1.2 XML exports valid;
**your Telegram receives the PII-free digest within seconds** (with 1d configured); kill the bot token →
approval still 201 (broadcast failure audited-not-fatal). Inbound: reply to the bot (poller running) →
message lands via the trust pipeline as an InboundMessage.

### I. Real road routing (ORS)
`FEATURE_ROUTING=ors` + `ORS_API_KEY` → request an evac route on an incident.
**VERIFY:** road-following geometry (not a straight heuristic line), avoid-polygons honored around the
hazard; unset the key/kill network → heuristic hazard-avoiding fallback, never a dead-end. Since
2026-08-10 the route panel also **names its engine** under the hazard-avoidance line — "Road routing
(OpenRouteService)" vs "Hazard-avoiding heuristic (offline engine — not road-following)" — so the
kill-switch beat is now visible in text, not only in geometry shape.

### J. Vision advisory (consent-gated)
`FEATURE_VISION=on`; as VERIFIER: `PATCH /api/v1/reports/{id}` with
`{"decision":"VERIFIED","visionAssist":{"imageRef":"fixture:sentinel2-burn-area-001","task":"burn-area","imageConsented":true,"piiScreened":true}}`
**VERIFY:** response `meta.visionFinding` (advisory; MockVision default); the verifier queue shows the
"Vision (advisory)" chip with the never-auto-decides caption; `imageConsented:false` → refused, decision
still applies.

### K. Interop round-trips
`POST /api/v1/edxl/rm` (RequestResource→Commit lifecycle), `POST /api/v1/edxl/sitrep`, CAP export.
**VERIFY:** schema-valid round-trips (playbook §4 has real captured payloads to replay verbatim).

### L. Pre-positioning (predictions → logistics)
`GET /api/v1/pre-positioning?incidentId=<id>` as RESPONDER+.
**VERIFY:** ranked near-extent suggestions (resources + shelters, distance-ranked, inside-extent excluded),
`method` label + `extentAvailable:true`; board section renders them with the advisory badge.

### M. Push, resilience, a11y (rubric hard evidence)
- ✅ **SSE push — SAFE TO FILM, and machine-verified 2026-08-01 (F-416 implemented and closed).**
  Submit an SOS (or approve an alert) in a second tab → the first tab updates **with no reload, in ~1.7 s**.
  > History worth keeping, because it is the reason to trust this line now: until 2026-08-01 this beat was
  > **unfilmable**. `EventBusPort.publish` was declared, implemented, and called from **no production code
  > path**, so the stream served `hello` + heartbeats only and the COP refreshed on the 15 s polling rung.
  > Nothing looked broken and every test passed. The publisher now exists (`publishDelta`,
  > `http-dispatcher.ts`) and is proven end-to-end in a real browser by `e2e/sse-push.spec.ts` — browser
  > `EventSource` → Next route → `handleStream` → the process-wide bus → a real HTTP mutation.
  > **~1.7 s against a 15 s polling interval is what makes it push rather than a lucky poll.**
- Supporting shot if you want the mechanism visible: `curl -N localhost:3000/api/v1/stream?regionId=us-ca`
  in a terminal beside the browser → the `event: delta` frame appears the instant you submit. Note the
  frame carries only `{type, region, entity, at}` — **no figures ride the channel** (Art. XII); the client
  refetches over REST, where provenance and RBAC apply. That is a strong Integration point on camera.
- Cross-region isolation is also proven (THREAT T13.1): a `ro` subscriber receives nothing from a `us-ca`
  change. Worth one sentence if a judge asks about multi-tenancy.
- TTTP stopwatch: cold load → first truthful picture < 10 s (measured 0.8–1.0 s).
- Kill a live source mid-demo (drop network) → layer badge flips to CACHED/MOCK, app never breaks.
- `./node_modules/.bin/playwright test` → axe 0 serious/critical, dark/light × desktop/tablet/phone.
- Screenshots refresh: `CAPTURE_SCREENSHOTS=on ./node_modules/.bin/playwright test e2e/capture-screenshots.spec.ts` → `docs/screenshots/`.

### N. Live cameras & external views (E11 "Live Views")
```bash
DATA_SOURCE_COMPOSITION=adapters AUTH_DEV_TRUST_HEADER=on rm -rf .next && npm run dev   # http://localhost:3000
# caltrans-cctv is keyless-LIVE by default; add WINDY_WEBCAMS_API_KEY / DOT511_API_KEY (1b) for those pins.
# For the citizen-stream demo add: FEATURE_CITIZEN_STREAM=on
```
**VERIFY:**
- Toggle the **"Live cameras"** layer ON → **violet pins** appear for **CA and Romania**, including the
  seeded REAL fixture URLs **offline** (Concow ALERT fire-camera, 2 Caltrans streams, Fetești + Giurgiu
  CNAIR) — no key or egress needed.
- **Click a pin** → the provider's own live-view page opens in a **new tab** (`noopener,noreferrer`); the
  tooltip shows provider + LIVE/SNAPSHOT + "click to open ↗".
- Legend attribution shows the **"ALERTCalifornia | UC San Diego"** credit and the mandatory
  **"Webcams provided by windy.com"** badge.
- SitRep decision-support panel → **External views** section: 11 deep-links incl. **Google Earth 3D** of the
  incident, plus the two hazard views added 2026-08-11 — **NASA FIRMS active fires** (worldwide, last 24 h)
  and **Google Flood Hub** (AI river-flood forecasts, 150+ countries), both centred on the same point as the
  incident (opens the provider site; no key, works offline as a link).
- With `FEATURE_CITIZEN_STREAM=on`: an SOS `liveViewUrl` on the allow-list (e.g. a `youtube.com/watch…`
  link) surfaces the SOS live-feed field + a warn-styled **"Live Feed — Unofficial ↗"** chip in the
  verifier queue; with the flag OFF the same field is rejected with a **400** (honest, never silently
  dropped). Never fetched server-side.

---

## 3. Final demo script (2–5 min video) — rubric-mapped shot list

| # | On camera | Rubric |
|---|---|---|
| 1 | `docker compose up` → app live, sources panel: LIVE badges (keyless real egress) | Timeliness · Integration |
| 2 | COP tour: fire/flood/infra + toggle outage ("ASSUMED offline"), cell, weather glyph, NFHL zones — per-layer freshness badges | Comprehensiveness |
| 3 | TTTP stopwatch moment (<10 s, **measured ~1 s on every one of the 5 zones, on phone as well as desktop** — `e2e/perf.spec.ts`) **+ a real SSE delta arriving live**: submit in a second tab → this tab updates with no reload in **~1.7 s** (F-416 implemented + browser-proven by `e2e/sse-push.spec.ts`; 15 s polling is the fallback, so this speed is push). | Timeliness |
| 4 | SitRep: cited news-fusion field ("3 authoritative sources…") + click citation → source record; AI-on vs AI-off numbers identical | Integration · Innovation |
| 5 | Misinformation: flagged social report → verifier confidence components → Reject (no alert emitted) | Scenario-fit · Responsible-AI |
| 6 | SOS → geocode/triage confidence → human VERIFY (+ vision advisory chip) → CAP XML export | Scenario-fit |
| 7 | Alert approve → **real Telegram message arrives on a phone on camera** | Integration · Innovation |
| 8 | Evac route with ORS road geometry + kill-switch → heuristic fallback (degrade-not-break) | Usability · Scenario-fit |
| 9 | NFHL∩crest predicted impact (method+uncertainty labels) → pre-positioning suggestions on the board | Innovation · Comprehensiveness |
| 9a | **Live Views:** toggle "Live cameras" → click an ALERT fire-camera pin → live PTZ view opens in a new tab; then "Google Earth 3D" of the incident from the SitRep External-views panel | Innovation · Comprehensiveness · Timeliness |
| 10 | Romania switch: same golden path, EU sources (portability beyond US) | Comprehensiveness |
| 11 | Phone breakpoint + dark mode + keyboard-only pass (axe-clean) | Usability |
| 12 | Close: `.well-known/sustainability`, audit hash-chain, "reproduce it: docker compose up + this file" | Trust/all |

---

## 4. Remaining human steps to contest end (9 Oct 2026)
1. **You:** review + commit the `phase-d-deliver` diff; PR → main (Copilot review → merge — per your standing flow).
2. **You:** run scenarios A→M above with your keys; file anything off as issues.
3. Record the video per §3 (self-score against the rubric first — JUDGE_SCORE_PREDICTION.md §checklist).
4. Portal product submission: repo link (public state), video, updated FORM answers; attestations unchanged.
5. Optional stretch (docs/architecture/MESSAGING_CHANNEL_OPTIONS.md): Matrix OSS channel for the
   air-gapped-alert on-camera moment.

---

## 5. Findings-driven live verification — MW-D additions (added 2026-07-31)

> **Why this section exists.** Scenarios A–N above cover the features that existed before MW-D. This
> section covers what MW-D added, and — more importantly — lists the specific things that **automated
> tests cannot decide for you**. Every item here is either a claim that only a human running the real app
> can confirm, or a known limitation you must be able to state accurately on camera.
>
> **The rule this project runs on: an unverified thing is "unverified", never "fine".** A 403, a fixture,
> a green unit test and a reasoned argument are all *not* live verification. Tick a box here only after
> you have seen the thing happen in a running browser.

### 5a. MUST verify by hand — nothing else can close these

| # | Finding | What to do | Why a test cannot do it |
|---|---|---|---|
| 1 | **F-177** 🔴 | Open both reunification URLs **in a browser**: `familylinks.icrc.org` and the American Red Cross Restoring Family Links page. Confirm each resolves, is the named organisation, and is the right service. | Both answer automated requests with **HTTP 403** (bot protection), so liveness is *unconfirmed, not disproven*. The Red Cross entry has **no positive evidence at all**. `FEATURE_D6_REUNIFICATION_LINKS` now defaults **on**, so these ship enabled. The other five (ICRC RFL, `crucearosie.ro`, `www2.cruzroja.es`, `redcross.gr`, `redcross.org.ph`) were fetch-verified 200. |
| 2 | **F-72** ✅ **CLOSED 2026-08-01 — no longer a hand-check** | ~~Run the golden path in a real browser for `es`, `gr` and `ph`.~~ **Done by machine, repeatably.** `SHIPPED_REGIONS` is now DERIVED from `config/regions.json`, and the full Playwright suite ran **all five zones × four device projects**: golden path, layer toggles, SitRep, zones and TTTP all pass — **190 passed / 26 skipped / 0 failed** (re-measured 2026-08-02, after the F-414 map fix), TTTP ~1 s per zone including on phone. | Was true when `REGIONS` was a hand-authored two-entry map. It is derived now, so a sixth zone is covered with no edit — the gap cannot silently reopen. |
| 3 | **F-191 / F-192** ✅ **CLOSED 2026-08-01 — no longer a hand-check** | ~~Click Task on the logistics board and complete the flow.~~ **`e2e/logistics-tasking.spec.ts` now does exactly that in a real browser on every project**: the registry loads (F-192) and a resource walks the WHOLE forward-only lifecycle server-confirmed at each hop (F-191). | Still worth doing once on camera-day for your own confidence, but the claim is now machine-backed rather than resting on a repair lane's word. |
| 4 | **F-170 / F-193** | With **no `.env` overrides**, confirm which surfaces now appear. All ten `FEATURE_D4_*` + `FEATURE_D6_*` flags default **`on`** as of 2026-07-31. | The defaults changed deliberately. Verify the app you film matches the app you describe. Also confirm the reverse: set all ten `off` and confirm nothing renders (V13 / V17). |
| 5 | **F-53** | Emit a CAP alert in a non-English region and **read the emitted XML**. | Multilingual CAP had **no production caller for two entire waves** and was only wired in MW-D. Confirm a language with no copy is **skipped, never mislabelled**. |
| 6 | **F-23** | Trigger an exposure figure on a rung that cannot clip, and **read the label**. | The number must say *"NOT clipped to the extent — a region-wide figure reported as such"*. If a region-wide figure ever renders as if clipped, that is a reportable honesty failure, not a cosmetic one. |
| 7 | **F-25** | Let a report pass its `purgeAfter` and confirm it is actually swept. | The retention guarantee was decorative until MW-D — stamped but never swept. |

### 5b. Known limitations you must state accurately (do NOT claim these work)

| Finding | The honest statement |
|---|---|
| **F-150** ⚠️ | **FR-D4-5 is the Copernicus Emergency *Management* Service damage overlay — NOT "EMS / casualty transport".** There is no patient or transport concept in it. **Do not call it EMS-as-ambulances on camera.** (This was an orchestrator briefing error the build lane caught and refused; the wrong name must not survive into the video narration.) |
| **F-154** | The shelter board is **fixture-fed**: there is no shelter *source adapter*. The board, the RFC-4180 CSV export and the provenance labelling are real; the FEMA Open-Shelters feed is not wired. Provenance will say `MOCK` — that is correct and honest, not a bug. |
| **F-156** | EDXL-RM **ingest is now strict** (F-31 closed): a partner sending a non-standard member, a bad `sentDateTime`, or no `originatingMessageID` is now **rejected with `PARSE_ERROR`** where it was previously accepted. This is a deliberate behaviour change and belongs in the changelog. |
| **F-152 / F-171 / F-172 / F-173 / F-174** | **LARGELY CLOSED (S3, 2026-08-08): 7 of 10 D5/D6 modules are now composed.** Five dock panels landed — supplies, volunteer teams, shelter status (logistics dock), damage reports, EMS overlay (SitRep dock) — beside the already-served incident-summary export + casualty tally. **Still not composed, by plan:** rumor board, mutual aid, reunification links — do not demo those three. HONEST LIMIT to state on camera: the five new panels are **fixture-fed MOCK** (labelled in their provenance); no supply/volunteer/shelter/EMS source adapter exists, and the damage buckets aggregate the fixture, not the live report store. |
| **F-81** | **CLOSED (S1; row re-verified 2026-08-10):** the forecast DRAFT is live — `ro-alert-forecast-draft-1` from seeded rule `ro-forecast-crossing-rule`, proven anticipatory + Art. XIII-safe by `e2e/forecast-draft-alert.spec.ts`. ~~Honest residual (F-301): the forecast *evidence* … is computed but not on the wire.~~ **F-301 CLOSED 2026-09-10 (V2·A8):** lead time, expected crossing, forecast category and likelihood class are served on `GET /alerts` and rendered in the DRAFT review deck with their method + uncertainty. Narrate them — and narrate the uncertainty line with them, never the figure alone. |
| **F-41 / NFR-F10** | `SPEC.md` still has **no consolidated "Known limitations" section**. This whole table is its raw material. |

### 5c. New MW-D scenarios to run (extends the A–N matrix)

- **O. Predicted impact (D1).** Confirm every impact figure names its **method, inputs and uncertainty**, and that the clipping ladder labels its rung. No figure may appear without its unit.
- **P. Anticipatory action (D2).** Confirm the trigger evaluator is **fixture-fed and replayable** — the same input yields the same decision, and no LLM produces any number.
- **Q. Warning excellence (D3).** CAP Update / Cancel / all-clear lifecycle; profile validation; multilingual emission (see 5a #5).
- **R. Governance & drill (D4).** `DRILL_MODE=on` selects a **separate composition** and structurally cannot reach a real channel. Verify a drill alert can never emit for real, then verify the hash-chained ledger.
- **S. Coordination tier (D5).** Rumor board flags-never-merges; mutual-aid conflicts flagged not merged; shelter CSV export opens cleanly in a spreadsheet **and is not formula-injected** (the escaping was tested against expectations, never against a real spreadsheet).
- **T. Aggregate tier (D6).** Confirm no D6 surface can display a person-identifying field, and that the casualty tally always carries its `"unverified — not authoritative"` label at **every** render and export site.

### 5d. Non-negotiables to re-confirm live before filming

1. **AI off ⇒ every number is identical.** The deterministic engine owns all figures (Art. XII).
2. **No CAP/EDXL from an UNVERIFIED report** (Art. XIII); threshold fires produce **DRAFT only**.
3. **Every fallback rung is labelled** and nothing dead-ends (Art. XVI); **never claim LIVE for CACHED/MOCK**.
4. **Visual-baseline budget: 0 of 2 remain** (spent: ADR-032 storm layer, ADR-033 outlook section). If a baseline breaks, gate the new UI **off** — any further regeneration is an explicit entrant decision. *(Exercised exactly once since: the 2026-08-10 S3 re-mint was such an explicit entrant decision, taken after the delta was eyeballed and verdicted as precisely the planned S3 content — see §5e note 3 for the `cop-rtl.png` remainder.)*
5. **F-157**: re-run the suite twice — once whole, once file-by-file. A test count that changes with run
   context means cross-test shared state. Green is not the same as deterministic.

### 5e. Live-demo increment S1–S3 additions (added 2026-08-10)

New scenarios to run (extend the A–T matrix; all work offline on the seed):

- **U. Dock panels (D4/D6, S3).** With default flags, the logistics dock shows **Supplies**, **Volunteer
  teams**, **Shelter status** and the **shelter capacity widget** ("ca-shelter-1 20/200 (10%) Within
  capacity"); the SitRep dock shows **Damage reports** and the **CEMS damage overlay** panel. VERIFY each
  panel's provenance says **MOCK** (fixture-fed — that is the honest label, not a bug), and that killing
  the API (or a malformed envelope) lands each panel on a **labelled error state with Retry**, never a
  crashed page.
- **V. Accessible map fallback ×14.** With WebGL unavailable (or via the e2e path), the map's fallback
  lists **all 14 layers** as feature rows — including outages ("ASSUMED offline" + customer count), cell
  LTE/5G statuses, the wind observation, cameras, the prediction cone **with its uncertainty caveat**,
  route and shelter rows.
- **W. Session persistence.** Sign in (or pick a dev role), reload the same tab → the role survives
  (sessionStorage); close the tab and reopen → back to PUBLIC. Nothing may appear in localStorage.
- **X. Air quality (S3).** The SitRep shows the air-quality threshold fact with a citation naming the
  adapter that actually served (openaq → airnow → sensorcommunity ladder).
- **Y. Population citation ladder (S3).** The exposure population figure's citation names the adapter
  that served it (census on us-ca; worldpop on ro; nri only when the rungs above are down). A seeded
  planning figure carries **no** population citation — grounding is never invented.

Verification notes from the 2026-08-10 confirming runs:

1. **ROOT-CAUSED AND FIXED (2026-08-10, same day):** the "one-shot alert already ACTUAL" failure and the
   `ECONNREFUSED` tail were ONE cause, not two — `reuseExistingServer: !CI` let a leftover `next start`
   from a *previous* run be reused, carrying that run's mutations (the seeded DRAFT already promoted) and
   then dying mid-run. Within one run the suite is serial (`workers: 1`) and order-deterministic. Fix:
   `reuseExistingServer` now defaults **off** (fresh server every run; opt back in with `PW_REUSE=1`),
   and the golden-path API-gate test's VERIFIER half now targets a nonexistent alert id (404 proves RBAC
   passed while mutating nothing) so the one-shot UI click is the suite's ONLY promoter. No assertion was
   weakened.
2. **Visual-baseline scope:** `--update-snapshots` filtered by `visual` re-mints only
   `e2e/visual.spec.ts` — the RTL baseline (`cop-rtl.png`, `e2e/i18n-rtl.spec.ts`) needs its own pass
   when the COP visibly changes.
