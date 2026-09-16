> ⚠️ **SUPERSEDED AS SHOT-LIST-OF-RECORD.** This document is the **narrative companion** (story beats,
> talking points, background) — it predates the E11 "Live Views" feature and has been kept only
> partially in sync. The **shot list to actually film** is `docs/FINAL_LIVE_TEST_AND_DEMO.md` §3 (the
> rubric-mapped 12-shot + 9a cut, current as of Phase-D). **Film from that list**, use this document for
> narrative framing and talking points only.

# BEACON — Demo script & TTTP budget (golden path)

> The out-of-the-box demo walkthrough — doubles as the **2–5 min video script** (IEEE Phase-3 deliverable)
> and the E8·T-394 / E9·T-421 e2e golden-path test. Proves rubric 1 (**Time-to-Trustworthy-Picture < 10 s**,
> F14) with a real person driving the UI. Runs with **zero external setup**.

## Zero-setup start (out-of-the-box)
```bash
nvm use && npm install
docker compose up            # Postgres + app; migrates + seeds automatically
# defaults: DEPLOY_MODE=local, SOURCE_*_MODE for ⚠ sources = mock, AI_MODE=off (deterministic-only —
# this is the actual default; local Ollama and cloud LLMs are opt-in, see AI_MODE=local/cloud below)
open http://localhost:3000   # California is the default region
```
No keys required for the demo (cached/mock fixtures; AI is **off by default**, so the golden path — COP,
SitRep, alerts, routing, logistics — is fully proven with zero LLM involved; flip `AI_MODE=local` for
Ollama or `AI_MODE=cloud` for a hosted model if you want narrated prose on camera). Flip individual sources to `live` in
`.env` after the S05 re-verify gate. Fully **air-gapped** (`AI_MODE=off`, all `SOURCE_*_MODE=mock`) still
yields a complete COP (deterministic-only).

## Golden path (record this) — target **TTTP < 10 s**
| # | Step (what the presenter does) | What appears | Budget |
|---|---|---|---|
| 1 | Open app → **California** region | COP map + timestamped layers (fire, flood gauges, infrastructure); each layer shows a **freshness badge** (LIVE/CACHED + age) | ≤ 2.0 s |
| 2 | Click an active **wildfire incident** | Hazard geometry + exposed infrastructure (deterministic nodes-in-hazard) + prediction cone (labeled *first-order*) | ≤ 1.5 s |
| 3 | Open the **AI SitRep** panel | Cited situational report — every field carries `citations[]` → source; ranked priorities (deterministic 0.45/0.35/0.20); escalation trend; **a news-derived field** ("N authoritative sources report …", from the deterministic news-grounding pass — cited, minted before the LLM) | ≤ 4.0 s (AI) / ≤ 1.5 s (deterministic-only) |
| 4 | **Threshold** crosses (gauge category) | A **DRAFT** early-warning alert appears (never auto-ACTUAL) with provenance | ≤ 1.0 s |
| — | **Time-to-Trustworthy-Picture** (steps 1–3) | trustworthy, cited COP visible | **< 10 s ✅** |
| 5 | Submit a consented **public SOS** report | Report pinned "Unverified" + confidence components (LLM geocode is *input only*) | ≤ 1.5 s |
| 6 | As **Verifier**, approve it (+ emit CAP) | State → VERIFIED; a **DRAFT CAP** alert referenced in `meta.emittedAlert` (HITL gate; Art. XIII) | ≤ 1.0 s |
| 7 | Request an **evac route** | Route drawn **avoiding the hazard polygon** + nearest open **shelters** (capacity vs demand). With `FEATURE_ROUTING=ors` + `ORS_API_KEY` this is a **real ORS road route** (avoid-polygons from the hazard footprint); without them, the hazard-avoiding heuristic — same port, labeled honestly (the UI does not yet distinguish the two) | ≤ 2.0 s |
| 8 | **Logistics** board → task a resource | Resource tasked (only from a VERIFIED source, ST1); optional **EDXL-RM** round-trip | ≤ 1.5 s |

## Resilience beats to show (the differentiators)
- **Offline:** disconnect network → COP stays up on cached/mock, badges flip to "CACHED"; nothing dead-ends.
- **AI off:** set `AI_MODE=off` → SitRep degrades to deterministic-only (`ai_mode` shown), priorities intact.
- **Source down:** kill one adapter → it descends secondary→cache→mock, labeled "degraded", never a 5xx.
- **Portability:** switch region to **Romania** → same COP on global-equivalent free data (GloFAS/EFFIS/
  MeteoAlarm-RO/Open-Meteo), US-only layers show "not available in this region"; timestamps render in
  Europe/Bucharest, units metric, Romanian sources cited in original language (SPEC §3.5).
- **Timeliness on camera (category-1 lever):** an on-screen **TTTP stopwatch/HUD** shows the < 10 s picture forming; film it.
- ~~**Operational readiness (category-4 lever):** show the **adapter-health board** (`/health/adapters`) — one adapter degraded → labeled CACHED, COP stays green (5-second beat).~~
  🚫 **BEAT STRUCK 2026-08-01 (findings F-324 / F-401 / F-323) — DO NOT FILM.** There is no adapter-health
  board component anywhere in `app/_components/**`, and `GET /health/adapters` returns **404** in the
  shipped app: only the single-segment `/health` is wired (`src/adapters/channels/http/routing.ts:88-89`)
  and a 2-segment GET matches nothing (`routing.ts:117-121`). Filming this beat — or letting a judge
  `curl` it from `docs/SPEC.md` during the reproducibility beat — puts a 404 on camera.
- ✅ **Operational readiness (category-4 lever) — REPLACEMENT BEAT, both halves real:**
  1. `curl -s localhost:3000/api/v1/sources | jq` — `GET /sources` **is** served
     (`src/adapters/channels/http/routing.ts:94-95`) and returns `{regionId, sources:[{sourceId, mode,
     fetchedAt}]}` — per source, its **effective mode** (LIVE/CACHED/MOCK) and **`fetchedAt` freshness**
     (`src/application/interaction/command-router.ts:324-334`; omitting `?regionId=` falls back to the
     configured default region, so the bare `curl` above works). Same degradation truth the struck beat
     promised, from an endpoint that actually answers.
  2. On the COP, point at the **per-layer freshness badges**: a degraded source's layer reads **CACHED**
     with its age while the COP stays green and never dead-ends (Art. XVI). No new claim is made here —
     both halves are surfaces the app already ships.
- **Demo-day hardening:** before recording/judging, verify **N≥20 concurrent sessions** against one
  instance (SSE connection cap + per-IP rate-limit configured); demo runs on cached/mock defaults so
  upstream free-tier limits cannot be exhausted by judges replaying it.

## Phase-D on-camera moments (now built — the delivered-over-claims)
These are new, filmable beats that did not exist at the S09 snapshot. Each is real and gated green.
- **News-cited SitRep field** — open the SitRep: a field reads *"3 authoritative sources report …"* with a
  citation chip per distinct outlet. Deterministic (authority-ranked OFFICIAL>MEDIA>SOCIAL, corroboration
  counted), minted before the LLM → toggle `AI_MODE=off` and the same field/count stays (AI-on == AI-off).
- **Misinformation reject** — in the **verifier queue**, a low-corroboration/social-only report shows its
  **confidence components** (geocode / authority / classifier / corroboration bars) and a **reject as
  misinformation** affordance → state goes to REJECTED with **no outbound action** (flag-not-merge, Art. XIV).
- **New COP layers + per-layer freshness** — toggle **power outages** ("ASSUMED offline" label), **cell
  coverage**, **weather** (wind glyph at the observation point), and **flood zones (NFHL)**; each layer shows
  its **own freshness badge** from its source's `fetchedAt` (not one shared stamp). New toggles default OFF.
- **NFHL∩crest predicted impact** — on a flood incident, the prediction cone is the real NFHL-zone ∩ crest
  extent, with a visible method/inputs/uncertainty label.
- **Pre-positioning panel** — the logistics board surfaces **pre-positioning-from-predictions** advisory
  suggestions (resources/shelters ranked near the projected extent; engine suggests, human decides).
- **Telegram broadcast on approval** — with `CHANNEL_TELEGRAM_MODE=live` + `TELEGRAM_BOT_TOKEN` +
  `TELEGRAM_ALERT_CHAT_IDS`, approving a DRAFT→ACTUAL alert triggers a **real Telegram `sendMessage`** to the
  subscriber chat(s) — strictly *after* the approved emit (HITL), PII-redacted + audited, broadcast failure
  audited-not-fatal. Mock by default. Setup: see `E2E_TESTING_PLAYBOOK.md` §7.
- **Advisory vision assist** — with `FEATURE_VISION=on`, the verify flow surfaces an advisory, confidence-
  scored `VisionFinding` chip (e.g. Sentinel-2 burn-area) — consent+PII gated, never auto-alerts.

## Live Views beat (E11 — shot 9a, added post-Phase-D)
This section was missing from the original script — added so the narrative doesn't omit a delivered
flagship. Full setup/verify: `docs/FINAL_LIVE_TEST_AND_DEMO.md` §2 scenario N; shot list entry: §3 row 9a.
- Toggle the **"Live cameras"** layer ON → violet pins appear (CA + Romania), including seeded real
  fixture URLs that work **offline**, no key or egress needed.
- Click an **ALERTCalifornia fire-camera pin** → its live PTZ view opens in a **new tab**
  (`noopener,noreferrer`); tooltip shows provider + LIVE/SNAPSHOT + "click to open ↗".
- Open the **SitRep → External views** panel → **Google Earth 3D** of the incident opens in a new tab
  (works offline as a link, no key).
- Talking point: this is genuinely novel data discovery (Comprehensiveness/Innovation) delivered on top
  of the canonical COP, not a bolt-on — same freshness/provenance discipline as every other layer.

## Talking points (map to rubric)
1. *Timeliness* — **real SSE push** (delta arrives in ~1.7 s with no reload; 15 s polling is the labelled
   fallback), freshness on every layer, TTTP < 10 s (**measured ~1 s per zone, phone included**).
   > **F-416 resolved 2026-08-01.** This line briefly carried a DO-NOT-SAY-"push" warning, because the SSE
   > channel had no server-side publisher — it was implemented and called from nowhere. The publisher now
   > exists and is proven end-to-end in a real browser (`e2e/sse-push.spec.ts`). Saying "push" is accurate.
2. *Comprehensiveness* — free-world
multi-domain data + novel derived layers. 3. *Integration/responsible-data* — one canonical model, cited
AI that never invents numbers, HITL, no-PII. 4. *Usability* — one crisis-first COP, WCAG AA, works offline.
5. *Innovation* — cited-synthesis + offline/local-first + logistics + free-data at ≈$0, all open-source.

*Latencies are targets validated by the E8/E9 perf gate; the video shows a **keyless-LIVE** layer
(NWPS river gauges + Open-Meteo weather — proven live over real egress, no API key, `npm run live:probe`)
and a **CACHED** layer (Romania GloFAS/MeteoAlarm-RO) to demonstrate honest source labeling. (FIRMS is
LIVE only with a free `FIRMS_MAP_KEY`; without it, it renders from its MOCK fixture — labeled as such.)
Full per-shot video plan: `docs/audit/JUDGE_SCORE_PREDICTION.md` §2 (internal, gitignored).*
