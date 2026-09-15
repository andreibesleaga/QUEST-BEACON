# BEACON — End-to-End Testing Playbook

*IEEE Response Quest 2026 · Phase 3. A single, self-contained runbook to exercise **everything live** — US
(California wildfire) + Romania (flood), every system and API, offline → fully-live. Every example output
below is **real, captured** from the running system (`scripts/capture-playbook.ts`, `npm run live:probe`,
`npm run ai:probe`). Screenshots in [`docs/screenshots/`](screenshots/) are real golden-path captures.*

> **Honest scope up front — recounted by machine 2026-08-10 (live-demo delivery S1–S3).** BEACON wires
> **45 registered source adapters** (`config/adapters.json → adapters.length` = 45 = the `ADAPTER_FACTORIES`
> entry count; equality asserted by `adapter-registry.test.ts`) — **41 consumed** (the union of
> `enabled_adapters` across the five shipped zones in `config/regions.json`, which is the list
> `buildAdapterRegistry` actually filters on). **Exactly three** are registered and not consumed by any
> zone: `itu` + `camara-gsma` (operator-gated MOCK-only plugins, by design) and `hifld` (**held** out of
> every allowlist — its static-2019 snapshot displaces the seeded infrastructure the derived-outage
> marking depends on; merge-not-replace slot design is an open register item).
>
> *The 2026-08-02 recount below is preserved; its `30 / 28 / 2` figures predate the S2/S3 adapter
> increment (metno, anm, mastodon, openfema, caphub, lanceflood, eonet, cemsrm, nri, hdxpop, hifld +
> the openaq/airnow/sensorcommunity air-quality trio).*
>
> **(2026-08-02, preserved)** BEACON wires
> **30 registered source adapters** (`config/adapters.json → adapters.length` = 30 = the `ADAPTER_FACTORIES`
> entry count at `src/main/adapter-registry.ts:56-94`; equality asserted by `adapter-registry.test.ts:54`)
> — **28 consumed** (the union of `enabled_adapters` across the five shipped zones in `config/regions.json`,
> which is the list `buildAdapterRegistry` actually filters on). **Exactly two** are registered and not
> consumed by any zone: `itu` + `camara-gsma` (operator-gated MOCK-only plugins, by design).
>
> *The paragraph below is the Phase-D + E11 authoring-date text, preserved. Its figures — `27 registered /
> 24 consumed`, and `usgs-water` among the not-consumed — are stale: the three B3 aggregators
> (`meteoalarm-es`, `meteoalarm-gr`, `wmo-swic`) landed after it, and `usgs-water` is now in `us-ca`'s
> allowlist.*
>
> BEACON now wires **27 registered source adapters**
> (registered in `src/main/adapter-registry.ts` + `config/adapters.json`) — **24 consumed by the live
> composition**: 19 of the 22 portal-named data sources on the COP/status pipeline (via the live-seed
> derivation bridge — including the previously built-not-consumed **nws + gdacs**) + 5 Live-Views camera
> sources on the E11 `cameras` map layer. 3 remain registered but not consumed: `usgs-water` (a
> gauge-redundancy alternative, not threaded into the default composition) and `itu` + `camara-gsma`
> (operator-gated MOCK-only plugins by design). Delivered end-to-end since
> the S09 snapshot: **news/social → SitRep fusion** (deterministic news-grounding + misinformation
> flag-not-merge), the **outage / cell / weather / flood-zone COP layers** with per-layer freshness, **NFHL∩crest
> prediction**, **real ORS road routing** (`FEATURE_ROUTING=ors`), a **real Telegram broadcast** of approved
> alerts, advisory **vision assist**, and **pre-positioning-from-predictions**. The deterministic→AI→human
> spine, HITL, provenance/citations, CAP/EDXL, JWT, durable Postgres, and cloud-AI narration remain **live and
> verified**. **Honest tiers kept:** ITU + CAMARA/GSMA are **MOCK-only** (operator/data-gated), EFFIS is
> **CACHED-only** (endpoint unconfirmed), Bluesky is MOCK-by-default (LIVE-capable, corroboration-only), and
> Telegram/vision default to mock/off until their env is set — each with a documented flag-to-live path.

---

## 0. TL;DR — three commands

```bash
cd IEEE/Quest/Phase3 && source ~/.nvm/nvm.sh && nvm use && rm -rf .next
# (a) OFFLINE (zero setup, deterministic, air-gapped):
AUTH_DEV_TRUST_HEADER=on npm run dev -- --port 3100          # → http://localhost:3100
# (b) FULL DOCKER STACK (Postgres + migrate + app, durable):
docker compose -f infra/docker-compose.yml up -d --build     # → http://localhost:3000
# (c) IN-PROCESS CAPTURE of every envelope + CAP + EDXL + RBAC (no server needed):
npm run capture:playbook        # (tsx scripts/capture-playbook.ts)
```

---

## 1. API keys — the complete table

Every key is **free** unless noted. The default offline + keyless-live paths need **none**. Copy
`.env.example` → `.env` (gitignored) and fill only what a scenario needs.

| Env var | Free? | Unlocks | Where to get it | Needed for |
|---|---|---|---|---|
| *(none)* | — | Offline deterministic demo + keyless-live sources | — | Scenarios A, B |
| `NWS_USER_AGENT` | free (no signup) | NWS live (a contact string is mandatory, not a key) | set `"BEACON (contact: you@example.org)"` | CA-live |
| `FIRMS_MAP_KEY` | free | Live NASA FIRMS wildfire hotspots | https://firms.modaps.eosdis.nasa.gov/api/map_key/ | CA-live + FIRMS |
| `SOURCE_GLOFAS_POINTS` | none (keyless WMS; `GLOFAS_CDS_KEY` is not read) | Live Copernicus GloFAS flood gauges | GloFAS reporting-point catalogue (`lon,lat;…`) | RO-live GloFAS |
| `AUTH_SECRET` | self-gen | Real per-user JWT verification + `/auth/dev-login` | `openssl rand -hex 32` | Real-auth / JWT demo |
| `OPENROUTER_API_KEY` | paid credits | Cloud AI narration (recommended) | https://openrouter.ai/keys | Cloud-AI |
| `GROQ_API_KEY` | free tier | Cloud AI narration (Groq fast tier) | https://console.groq.com/keys | Cloud-AI (alt) |
| `ANTHROPIC_API_KEY` | paid | Cloud AI (direct Anthropic) | https://console.anthropic.com | Cloud-AI (alt) |
| `LLM_TIER_DEFAULT_MODEL/_BASE/_KEY` | — | The actual ladder tier the proxy calls (maps a provider) | see §2 Cloud-AI | Cloud-AI |
| `RELIEFWEB_APPNAME` | free | ReliefWeb news adapter LIVE (`SOURCE_RELIEFWEB_MODE=live`) — feeds news fusion | any registered/approved string | News fusion (LIVE) |
| `ORS_API_KEY` | free | Real OpenRouteService road routing (`FEATURE_ROUTING=ors`) | https://openrouteservice.org/dev | ORS live route |
| `OPENCELLID_API_KEY` | free | Cell-coverage layer LIVE (`SOURCE_OPENCELLID_MODE=live`) | https://opencellid.org | Cell layer (LIVE) |
| `CENSUS_API_KEY` | free | US Census/ACS population LIVE (`SOURCE_CENSUS_MODE=live`) | https://api.census.gov/data/key_signup.html | Population (LIVE) |
| `WINDY_WEBCAMS_API_KEY` | free | Windy Webcams live camera pins (`SOURCE_WINDY_WEBCAMS_MODE=live`) — mandatory "provided by windy.com" badge | https://api.windy.com (Windy API portal → Webcams API) | Live cameras (Windy) |
| `DOT511_API_KEY` | free | State 511 DOT CCTV pins (`SOURCE_DOT511_MODE=live`) | per-state 511 developer portal (e.g. 511ga.org developer signup) | Live cameras (511 DOT) |
| `TELEGRAM_BOT_TOKEN` | free | Real Telegram broadcast transport (with `CHANNEL_TELEGRAM_MODE=live`) | @BotFather → `/newbot` (see §7) | Telegram live send |
| `TELEGRAM_ALERT_CHAT_IDS` | free | Comma-separated subscriber chat id(s) that receive approved-alert broadcasts | @userinfobot / `getUpdates` (see §7) | Telegram live send |
| `TELEGRAM_WEBHOOK_SECRET` | self-gen | Verifies Telegram's `X-Telegram-Bot-Api-Secret-Token` on the inbound webhook | `openssl rand -hex 32` | Telegram webhook mode |
| `EARTHDATA_TOKEN` | free | NASA LANCE NRT flood (planned) | https://urs.earthdata.nasa.gov | roadmap |
| `OPENAQ_API_KEY` / `AIRNOW_API_KEY` | free | Air-quality/smoke corroboration (planned) | https://openaq.org / https://docs.airnowapi.org | roadmap |
| ~~`CLOUDFLARE_RADAR_TOKEN`~~ | — | **Do not obtain — no longer used.** The internet-outage proxy it belonged to was dropped 2026-08-08: its other half (Georgia Tech IODA) is "All Rights Reserved" with no open-licence grant, failing Art. IX. The adapter was deleted and the env row removed. | — | **removed** |
| `GOOGLE_API_KEY` | paid | Gemma vision profile (advisory, off by default) | https://aistudio.google.com | roadmap |

**AI ladder wiring (important):** the compliance proxy reads the tier from
`LLM_TIER_DEFAULT_{MODEL,BASE,KEY}` — **not** `OPENROUTER_API_KEY` directly. For OpenRouter set:
```bash
AI_MODE=cloud
LLM_TIER_DEFAULT_MODEL=anthropic/claude-haiku-4-5
LLM_TIER_DEFAULT_BASE=https://openrouter.ai/api/v1
LLM_TIER_DEFAULT_KEY=<your OpenRouter key>
```
With no key the ladder falls back to the offline mock → deterministic-only (never dead-ends).

---

## 2. Run matrix — every scenario

| # | Scenario | Command (prefix `source ~/.nvm/nvm.sh && nvm use && rm -rf .next`) | Keys | What you get |
|---|---|---|---|---|
| A | **Offline** (default) | `AUTH_DEV_TRUST_HEADER=on npm run dev -- --port 3100` | none | Deterministic seed, AI off, in-memory. Full COP US+RO. |
| B | **CA keyless-live** | `DATA_SOURCE_COMPOSITION=adapters SOURCE_NWS_MODE=live SOURCE_NWPS_MODE=live SOURCE_OPEN_METEO_MODE=live SOURCE_GDACS_MODE=live NWS_USER_AGENT="BEACON (contact: you@example.org)" AUTH_DEV_TRUST_HEADER=on npm run dev -- --port 3100` | none | Real nwps + open-meteo gauge/weather in the CA COP (provenance `mode:LIVE`). |
| B′ | **Verify keyless-live headless** | `npm run live:probe` | none | Prints provenance modes: nwps `LIVE`, open-meteo `LIVE`. |
| C | **CA + live FIRMS** | add `SOURCE_FIRMS_MODE=live FIRMS_MAP_KEY=<key>` to B | FIRMS | Live wildfire hotspots too. |
| D | **RO cached** | `DATA_SOURCE_COMPOSITION=adapters ... npm run dev` (switch region to `ro`) | none | GloFAS + MeteoAlarm-RO cached; RO flood COP. |
| E | **Durable Postgres** | `docker compose -f infra/docker-compose.yml up -d --build` (app sets `FEATURE_STORE=postgres`) | none | Reports + hash-chained triage audit persist across restarts. |
| E′ | **Verify Postgres headless** | `docker compose … up -d db` then `DATABASE_URL_TEST=postgres://beacon:beacon@127.0.0.1:5432/beacon npm run pg:probe` | none | Intake→triage→list round-trip + continuous audit hash chain. |
| F | **Cloud AI narration** | `.env` has the cloud profile (§1) → `AUTH_DEV_TRUST_HEADER=on npm run dev -- --port 3100`; SitRep as VERIFIER/EM shows LLM prose | OpenRouter | Real cited narration through the proxy. |
| F′ | **Verify cloud AI headless** | `PROBE_ROLE=EM AUTH_DEV_TRUST_HEADER=on npm run ai:probe` (with the LLM_TIER_* env) | OpenRouter | `aiMode: cloud`, real prose, `F3: PASS`. |
| G | **Full docker stack** | `docker compose -f infra/docker-compose.yml up -d --build && docker compose … ps` | none | db healthy · migrate exit0 · app healthy · 19 tables. |
| H | **News/social fusion demo** | `DATA_SOURCE_COMPOSITION=adapters SOURCE_GDELT_MODE=live AUTH_DEV_TRUST_HEADER=on npm run dev -- --port 3100` (SitRep as VERIFIER/EM) | none (GDELT keyless) | SitRep shows a **news-derived cited field** ("N authoritative sources report …"); misinformation-flagged social visible in the verifier queue confidence components. Deterministic — same field AI-off. |
| I | **Telegram live broadcast** | set `.env`: `CHANNEL_TELEGRAM_MODE=live TELEGRAM_BOT_TOKEN=… TELEGRAM_ALERT_CHAT_IDS=…` → run app → approve a DRAFT alert as VERIFIER/EM (see §7) | Telegram bot (free) | A **real `sendMessage`** lands in the subscriber chat, strictly after the approved DRAFT→ACTUAL emit (HITL); PII-redacted + audited; broadcast failure audited-not-fatal. |
| J | **ORS live road route** | `FEATURE_ROUTING=ors ORS_API_KEY=… AUTH_DEV_TRUST_HEADER=on npm run dev -- --port 3100` → request an evac route | ORS key (free) | Route from ORS `POST /v2/directions` with `avoid_polygons` from the hazard footprint; ORS-down → hazard-avoiding heuristic (same port, no dead-end). |
| K | **Advisory vision** | `FEATURE_VISION=on AUTH_DEV_TRUST_HEADER=on npm run dev -- --port 3100` → verify a report whose PATCH carries `visionAssist` | none (MockVision default) | An advisory, confidence-scored `VisionFinding` chip surfaces in the verify flow; report state unaffected; never auto-alerts. |
| L | **Pre-positioning** | `AUTH_DEV_TRUST_HEADER=on npm run dev -- --port 3100` → logistics board (RESPONDER+) with an incident that has a projected extent | none | `GET /pre-positioning` returns advisory resource/shelter suggestions ranked near the projected hazard extent (engine suggests, human decides — Art. XII). |
| M | **Live cameras & external views** (E11) | `DATA_SOURCE_COMPOSITION=adapters AUTH_DEV_TRUST_HEADER=on npm run dev -- --port 3100` — cameras seed offline; `SOURCE_CALTRANS_CCTV_MODE=live` (already the default) for real CA egress; add `FEATURE_CITIZEN_STREAM=on` for the citizen-stream demo | none (caltrans keyless; Windy/511 optional keys above) | Toggle the **"Live cameras"** layer ON → violet pins (CA + RO, incl. seeded REAL fixture URLs offline) → click a pin ⇒ source live-view page opens in a new tab; ALERT credit + "provided by windy.com" badge in the legend attribution. SitRep panel shows the **External views** section (Google Earth 3D etc.). With `FEATURE_CITIZEN_STREAM=on`, an SOS may carry a `liveViewUrl` (allow-listed) → verifier queue shows the warn-styled "Live Feed — Unofficial ↗" chip; with the flag OFF the field is rejected 400 (honest). |

**Automated gates (headless, no keys):**
```bash
./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/eslint . && ./node_modules/.bin/vitest run \
  && ./node_modules/.bin/depcruise src --config .dependency-cruiser.cjs && ./node_modules/.bin/next build
rm -rf .next && ./node_modules/.bin/playwright test    # golden path US+RO, axe WCAG 2.2 AA, TTTP, visual
```

---

## 3. Visual workflow (monitor → assess → decide → act)

Real screenshots in [`docs/screenshots/`](screenshots/) — desktop (dark + light) and phone, for **US-CA** and
**RO**, 6 states each (36 total). Walk the golden path; each step maps to the rubric category it proves.

| Step | Screenshot (US-CA / RO) | Do this | Proves (rubric) |
|---|---|---|---|
| 1 · MONITOR | `*-01-cop.png` | Region selector (California default). Map + accessible feature list: fire perimeter, hotspots, infra (substation AT_RISK), exposure, shelter, prediction cone, evac route. Each layer a **freshness badge** (never a bare timestamp). | Timeliness, Comprehensiveness |
| 2 · ASSESS | `*-02-sitrep.png` | Open SitRep. **Every field has a citation chip** (holds even AI-off). Trend (ESCALATING) + priorities (OFFLINE substation top). Reload → figures unchanged (deterministic). | Integration/Responsible-data |
| 3 · DECIDE | `*-03-decision.png` | Decision-support echoes the engine figures beside citations (numbers = SitRep verbatim; nothing computed in the browser, Art. XII). | Integration |
| 4 · ACT (SOS) | `*-04-sos.png` | As PUBLIC, SOS form has a **consent** control (can't submit without it) → report created **UNVERIFIED**. | Usability, Responsible-data |
| 5 · ACT (verify) | `*-05-verifier-queue.png` | Switch role → VERIFIER. Verifier queue lists reports (PUBLIC can't see it). Approve → VERIFIED. No `actorId` sent by the UI; server records the actor. | Integration, Usability |
| 6 · ACT (alert) | `*-06-draft-alerts.png` | Draft-alert review: a DRAFT alert (CA threshold fired). Approve → **DRAFT→ACTUAL** (HITL, Art. XIII) → CAP emitted. PUBLIC cannot approve. | Scenario-fit, Responsible-data |

*Accessibility:* ⌘K/Ctrl-K palette; theme toggle (both screenshotted); phone breakpoint (no horizontal
scroll); axe WCAG 2.2 AA = 0 serious/critical (`e2e/a11y.spec.ts`).

---

## 4. Real example outputs (captured)

All below are **actual** responses (`npm run capture:playbook`; full log reproducible any time).

**`GET /api/v1/status`** — universal envelope (`data` + `provenance[]` + `freshness`, F1):
```json
{ "data": { "regionId": "us-ca", "incidentCount": 1,
    "incidents": [{ "id": "us-ca-wildfire-demo", "type": "WILDFIRE", "status": "ACTIVE",
                    "headline": "Bear Ridge Fire — active wildfire, Butte County" }] },
  "provenance": [{ "sourceId": "firms", "mode": "MOCK", "fetchedAt": "…" }, …],
  "freshness": "…" }
```
*(Keyless-live, `npm run live:probe`): the same provenance shows `open-meteo` `LIVE` + `nwps` `LIVE` with real timestamps.)*

**SitRep — deterministic-only** (AI off): every field cited, no LLM prose. **Cloud AI on** (OpenRouter,
`anthropic/claude-haiku-4-5`, real capture):
```
aiMode: cloud
summary: "Two electrical substations fall within the current hazard footprint out of two assessed
          facilities. The highest-priority asset is ca-substation-south, which carries a blended risk
          score of 0.86. Surface winds are measured at 25 km/h from the NE, with conditions favouring
          south-westward spread of the hazard."
F3 (no invented number): PASS   — every number (0.86, 25) is present in the cited deterministic facts.
```

**CAP v1.2 alert** — `POST /api/v1/alerts/ca-alert-draft-1/approve` (VERIFIER, HITL) → **201**. The alert
flips DRAFT→ACTUAL and emits a canonical CAP document (fields map 1:1 to CAP XML elements):
```json
{ "data": {
    "alert": { "id": "ca-alert-draft-1", "capStatus": "ACTUAL", "category": "Fire",
               "severity": "SEVERE", "edxlKind": "CAP", "approvedBy": "role:VERIFIER" },
    "cap": { "identifier": "ca-alert-draft-1", "sender": "beacon@beacon.local", "sent": "…",
             "status": "Actual", "msgType": "Alert", "scope": "Public",
             "info": [{ "category": ["Fire"], "event": "Fire hazard alert",
                        "urgency": "Expected", "severity": "Severe", "certainty": "Likely" }] } },
  "meta": { "emitted": true, "sink": "MOCK", "auditHash": "20a73982" } }
```
*(`<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2"><identifier>…</identifier><info><category>Fire</category>…`
is the equivalent XML serialization of the same document.)*

**EDXL-RM round-trip** — `POST /api/v1/edxl/rm` (RESPONDER) imports an EDXL Resource Message → canonical
`ResourceTask`; `GET /api/v1/edxl/rm/urn:beacon:rm:corr-42` exports it back as EDXL-RM (exact round-trip).
**EDXL-SitRep** — `POST /api/v1/edxl/sitrep` (VERIFIER) emits an EDXL-SitRep with the citations preserved.

**RBAC + anti-forgery** (all real):
```
GET /reports  PUBLIC   → 403        GET /reports VERIFIER → 200
PATCH /reports {actorId:"…"} VERIFIER → 400  {"code":"VALIDATION_ERROR",
   "message":"actorId is derived server-side from the authenticated principal; do not send it"}
POST /alerts/:id/approve PUBLIC → 403  {"code":"FORBIDDEN","message":"requires VERIFIER, actor is PUBLIC"}
```

**Sustainability** — `GET /.well-known/sustainability` → schema-valid modeled report
(`measurement-method: third-party-modeled`, energy/carbon, methodology URI).

---

## 5. Rubric map (what to film / show)

| IEEE category | On-screen evidence | Command / screenshot |
|---|---|---|
| **Timeliness/Reliability** | Keyless-live fetch (nwps/open-meteo LIVE); SSE push; source-kill → degrade-not-dead-end; TTTP<10s | Scenario B, `live:probe`, `e2e/perf.spec.ts` |
| **Comprehensiveness** | **30 registered adapters, 28 consumed** (recounted 2026-08-02; was `27/24`, which predated the three B3 aggregators + reflected a stale consumed-set — see §6), news/social fusion, outage/cell/weather/flood-zone COP layers, NFHL∩crest prediction, US+RO | Scenarios B/D/H, `*-01-cop.png` |
| **Integration/Responsible-data** | Cited AI SitRep (F3), HITL DRAFT→ACTUAL, CAP/EDXL, consent+verify, no-PII (responder-gated), JWT | §4 outputs, Scenario F |
| **Usability/Readiness** | Untrained monitor→assess→decide→act; WCAG 2.2 AA; phone + EOC; `docker compose up` reproducible | §3 workflow, Scenario E/G |
| **Scenario-fit/Innovation** | Deterministic-AI-human + offline-first + logistics + free-data ≈ $0; compliance proxy; sustainability; EDXL round-trip | §4, `docs/audit/FINAL_LIVE_AUDIT.md` |

---

## 6. What is mock/cached vs live (honesty) — 45 adapters registered, 42 consumed

> **Recounted 2026-08-10 (S1–S3 increment); this heading said `30 registered, 28 consumed`.** Current:
> `config/adapters.json` → `adapters.length` = **45** = the `ADAPTER_FACTORIES` entry count; **consumed =
> 41** = the union of `enabled_adapters` over the five zones (`us-ca` 31 · `ro` 25 · `es` 22 · `gr` 22 ·
> `ph` 20). Not consumed: `itu` + `camara-gsma` (MOCK-only by design) and `hifld` (held — slot-design open
> item). The S2/S3 additions: metno + anm weather rungs, mastodon/caphub/lanceflood/openfema news-batch
> rungs, eonet/cemsrm EVENT hazard feeds (cited, never drawn), nri/hdxpop population rungs, and the
> openaq/airnow/sensorcommunity air-quality trio feeding the SitRep's air-quality fact.
>
> **(2026-08-02, preserved)** Recounted (lens-7, F-411 class); this heading said `27 registered, 24 consumed`. Derivation:
> `config/adapters.json` → `adapters.length` = **30**, and `ADAPTER_FACTORIES`
> (`src/main/adapter-registry.ts:56-94`) has the same 30 ids (equality asserted by
> `src/main/adapter-registry.test.ts:54`). **Consumed = 28** = the union of `enabled_adapters` across the five
> shipped zones in `config/regions.json` (`us-ca` 21 · `ro` 14 · `es` 14 · `gr` 14 · `ph` 12, union 28);
> that allowlist is what `buildAdapterRegistry` actually filters on (`adapter-registry.ts:151-155,182`).
> The **two** not consumed by any zone are `itu` and `camara-gsma`. Note `usgs-water` is now IN the
> `us-ca` allowlist, so the older "not consumed: usgs-water" wording below is itself stale.

Ship-default `SOURCE_*_MODE` per `config/adapters.json` (each has a documented flag-to-live path):
- **LIVE by default (keyless):** NWS, NWPS, Open-Meteo, GDACS, GDELT, agency-RSS. **LIVE with a free key:**
  FIRMS (`FIRMS_MAP_KEY`).
- **CACHED by default** (real recorded fixtures; `mode:CACHED`, or `MOCK` when the last-known-good cache is
  cold — honest degradation): GloFAS, MeteoAlarm-RO, ReliefWeb (LIVE-capable with `RELIEFWEB_APPNAME`),
  NIFC, **EFFIS (CACHED-only — endpoint confirmed dead upstream 2026-08; re-point pending)**, OSM-Overpass, WorldPop, Census (LIVE-capable with
  `CENSUS_API_KEY`), NFHL, EAGLE-I (outage layer shows **"ASSUMED offline"** — hazard∩infra inference),
  OpenCelliD (LIVE-capable with `OPENCELLID_API_KEY`).
- **MOCK by default:** USGS-Water, **Bluesky** (LIVE-capable, vetted-social corroboration-only, never
  auto-trusted), **ITU + CAMARA/GSMA (MOCK-only by design — operator/data-gated)**; IPAWS origination, the
  Telegram transport (until `CHANNEL_TELEGRAM_MODE=live`), and vision (until `FEATURE_VISION=on`).
- **Consumed by the derivation bridge:** the news set (GDELT/ReliefWeb/agency-RSS/Bluesky + MeteoAlarm-RO)
  feeds the deterministic news-grounding → SitRep fusion; NWS + GDACS are now consumed (closing the old
  built-not-consumed gap); the outage/cell/weather/flood-zone slices render as COP layers with per-layer
  freshness; NFHL∩crest feeds the flood-impact prediction.

## 7. Telegram bot setup (real broadcast — BotFather → token → chat id → poll-or-webhook)
The Telegram channel is **mock by default**; these steps flip it to a real broadcast of approved-ACTUAL
alerts (HITL side-effect only — never an alternate emit path). All keys are free.

1. **Create the bot.** In Telegram, message **@BotFather** → `/newbot` → follow prompts → copy the
   **`TELEGRAM_BOT_TOKEN`** it returns.
2. **Find the target chat id(s).** Message your new bot (or add it to a group), then either message
   **@userinfobot**, or call `https://api.telegram.org/bot<token>/getUpdates` and read `message.chat.id`.
   Set **`TELEGRAM_ALERT_CHAT_IDS`** = comma-separated id(s) of the subscribers who should receive alerts.
3. **Enable live transport.** In `.env`: `CHANNEL_TELEGRAM_MODE=live` + `TELEGRAM_BOT_TOKEN` +
   `TELEGRAM_ALERT_CHAT_IDS`. Approve a DRAFT→ACTUAL alert as VERIFIER/EM → a real `sendMessage` lands in each
   subscriber chat **after** the approved emit (PII-redacted + hash-chained audit; a broadcast failure is
   audited, not fatal — it never 5xx's the approval).
4. **Inbound — choose EXACTLY ONE (Telegram Bot API: polling and webhook are mutually exclusive):**
   - **Poller (localhost demos):** `npm run telegram:poll` — a `getUpdates` long-poll dev runner; never in
     the request path. Do **not** also register a webhook.
   - **Webhook (public HTTPS):** set **`TELEGRAM_WEBHOOK_SECRET`** (`openssl rand -hex 32`), register it with
     `setWebhook` (url + `secret_token`); the route `POST /api/v1/channels/telegram/webhook` verifies the
     `X-Telegram-Bot-Api-Secret-Token` header before processing, and returns 200 on a verified-but-unparseable
     update (Telegram retry semantics). Delete any webhook before switching back to the poller.

Companion docs: [`docs/audit/LIVE_VERIFICATION.md`](audit/LIVE_VERIFICATION.md) (captured live evidence),
[`docs/audit/FINAL_LIVE_AUDIT.md`](audit/FINAL_LIVE_AUDIT.md) (S00→S09 audit).
