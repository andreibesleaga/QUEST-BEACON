# BEACON — Problem Statement (S00 Discovery)

*IEEE Response Quest 2026 · Phase 3 · GABBE SDLC S00 (Strategy & Discovery).*
*Grounded in `../../../Phase2/submission/CONCEPT.md` + `../../audit/`. Gate: HUMAN GO/NO-GO before S01.*

---

## 1. The problem (one sentence)

During a wildfire or flood, the people who must **decide and act under time pressure have no single,
trustworthy, real-time picture** — they manually stitch together half a dozen agency websites, feeds,
and maps in their heads while minutes matter; **the bottleneck is integration and synthesis, not raw
data.**

## 2. Who hurts, and how

| Who | Pain today |
|---|---|
| **Emergency Manager (EOC)** | Juggles NASA fire feeds, river gauges, the weather service, power-outage maps, agency news, and social media in parallel; builds the common picture mentally; decisions wait on manual correlation; no defensible audit trail. |
| **First Responder / Incident Commander** | Needs precise hazard geometry, which assets/people are exposed, and safe routes — but that requires cross-referencing tools not built for the field. |
| **Public reporter (affected resident)** | Has no simple, consented, trusted way to report being trapped/in danger that actually reaches responders verified and fast. |
| **Smaller / rural / non-US / low-budget agencies** | Commercial COP suites (Esri, Genasys) are costly and US/vendor-centric; these agencies are effectively priced out of situational awareness. |

## 3. Jobs-to-be-done (JTBD)

- **EOC manager:** *"When a hazard threatens my region, help me see the whole situation, predict where
  it's going, and decide what to do — with evidence I can defend — without juggling six tools."*
- **First responder/IC:** *"When I'm tasked to an incident, show me exactly where the hazard is, who and
  what is in its path, and a safe route — fast, on whatever device I have."*
- **Public reporter:** *"When I'm in danger, let me tell responders where I am and what's happening,
  simply and safely, and know it was received."*

Emotional jobs: **confidence** (trust the picture), **control** (act, not just watch), **safety** (don't
make a wrong call on bad data).

## 4. Why now

- **Data is abundant and free** — NASA FIRMS, NOAA/NWS/NWPS, USGS, UN OCHA/Copernicus/ESA, OpenStreetMap,
  WorldPop — but **fragmented** across formats, latencies, and agencies. The raw material for a unified
  picture finally exists openly; nobody has assembled it for *small/open* operators.
- **Grounded AI is now practical** — open-weight LLMs + provider-agnostic routing make a **source-cited**
  synthesis layer feasible at near-zero cost, *if* it is built to never invent facts.
- **Disasters are escalating** (wildfire/flood frequency and impact), widening the gap between
  well-resourced and under-resourced responders.
- **Recent source churn** (e.g. HIFLD Open portal closed 2025; X/Twitter free API ended 2023) proves the
  need for a **modular, swappable, redundant** integration spine rather than hardcoded feeds.

## 5. Problem framing & constraints

- **Core problem to solve:** *integration + synthesis + decision-support + logistics*, not "more dots on
  a map."
- **Hard constraints (from the concept + Phase-3 direction):** 100% open-source; free/open first-class
  world data only; runs locally (~$0, air-gapped capable) and in cloud unchanged; **must work in all
  cases** (full redundancy — no single AI/API/network dependency); responsible-by-design (provenance,
  consent, no PII retention, human-in-the-loop); region-portable (US + global).
- **Scenario scope:** wildfires and floods (complementary hazards; richest free data) — deliberately
  focused, not all-hazards.

## 6. What success looks like (links to metrics in OPPORTUNITY_ASSESSMENT)

A regional operator opens one browser COP, gets a **cited** situational report and ranked priorities in
seconds, sees who/what is exposed and a hazard-avoiding route, receives a verified public SOS, tasks
resources, and emits a standards-compliant alert — **and the whole thing still works with the LLM off,
a primary API down, or no internet** — at essentially zero cost, in any region.

## 7. Non-goals (this phase)

All-hazards coverage (hurricane/earthquake/tsunami — adapter-extensible later); native mobile apps
(responsive PWA covers mobile); live IPAWS-authority alert origination (needs FEMA authority — we emit
CAP *ready* for it); physics-grade hazard simulation (FARSITE/Rothermel — labeled first-order
projections only, deeper models are a documented extension).

---

> **Gate question for the user (GO/NO-GO):** Is this the right problem, framed correctly, with the right
> constraints and non-goals, to take into S01 requirements? (See `MARKET_SCAN.md` for the competitive
> white-space and `OPPORTUNITY_ASSESSMENT.md` for sizing, metrics, and the RICE-ranked bets.)
