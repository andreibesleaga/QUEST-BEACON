# BEACON — Opportunity Assessment (S00 Discovery)

*North-Star + HEART metrics, RICE-prioritized bets, risks, and the go/no-go frame for the Phase-3 build.
Pairs with `PROBLEM_STATEMENT.md` + `MARKET_SCAN.md`.*

---

## 1. Opportunity & "size" (in challenge terms)

BEACON's "market" for Phase 3 is **the IEEE Response Quest rubric** (the prize) and, beyond it, the
**real, underserved population of small/rural/non-US/low-budget emergency operators** that commercial
COP suites price out. The opportunity is to be the **only** solution that is simultaneously:
open-source · free-world-data · local-first (~$0, air-gapped) · AI-cited-synthesis · responder-logistics ·
region-portable · fully redundant. (See `MARKET_SCAN.md` for the white-space proof.)

**Value created:** minutes saved per decision in the window where minutes = lives/property; a defensible,
audited decision trail; situational awareness for operators who currently have none.

## 1b. Evidence base (primary-sourced)

**The underserved market is real and documented:**
- Rural EMS/fire/health departments "operate on tight budgets … shortages in equipment, training, and
  staffing" (Rural Health Information Hub). Volunteer/rural fire departments specifically lack "access to
  technology" (USDA). A rural emergency-response "digital divide" affects ~42M Americans without broadband
  (IAFC).
- Incumbent cost is a named barrier: Esri ArcGIS criticized for "high licensing cost … every critical
  extension behind an extra paywall"; Genasys is quote-based/enterprise-tier. Cost is explicitly cited as
  an adoption barrier for EM software for "smaller organizations with limited budgets" (RHIhub).
- **Free-COP precedent validates the niche:** MIT Lincoln Laboratory's NICS is offered "worldwide at no
  cost to first responder and emergency management agencies" (MIT News, 2025).
- **Global South gap:** only ~60% of countries have multi-hazard early warning; lowest in the Americas/
  Caribbean (51%) and Least Developed Countries (UNDRR MHEWS 2025). DRR benefit–cost ratios "regularly
  exceed 10:1" in high-risk low-income countries.

**JTBD grounded in doctrine:** EOC core functions are "communications, information management, situational
awareness, and resource management," producing a shared situational picture (FEMA EOC Quick Reference /
NIMS). Information overload is shown to degrade emergency-manager cognition (ScienceDirect); defensible,
documented decisions are a codified legal-liability requirement (FEMA legal-issues materials). Field
responders face comms outages in **>50% of recent US wildfires within 24h** (CRS R48776; deadzones.com) —
making offline-first a necessity, not a gimmick.

## 2. North-Star metric

> **Time-to-Trustworthy-Picture (TTTP):** elapsed time from "open BEACON on a region" to "operator has a
> cited situational report + ranked priorities they can act on."** Target in demo: **< 10 seconds** on
> live primary sources (vs. the status-quo "6 tabs stitched by hand" measured in many minutes).

Why this metric: it directly encodes the core problem (integration/synthesis bottleneck) and is
demonstrable in the Phase-3 video.

## 3. HEART supporting metrics

| HEART | Metric (demo-measurable) | Target |
|---|---|---|
| **Happiness** | Crisis-UX clarity: operator can find each flagship action ≤1 click from the map | yes |
| **Engagement** | A full golden-path session exercises all 4 flagship features end-to-end | 4/4 |
| **Adoption** | One-command local start (`docker compose up`) to working COP, no training | < 5 min |
| **Retention** | System stays usable across degraded conditions (offline / API-down / AI-off) | 3/3 acceptance tests pass |
| **Task success** | Every SITREP claim is cited; every alert traces provenance; 0 ungrounded numbers | 100% / 100% / 0 |

## 4. RICE-prioritized bets (what to build, in what order)

RICE = Reach × Impact × Confidence ÷ Effort (relative scores, 1–5; higher = do sooner). Reach = how
central to the golden-path demo + rubric.

| Bet | R | I | C | E | RICE | Priority |
|---|:-:|:-:|:-:|:-:|:-:|---|
| **Unified live COP** (map + toggleable cited layers + freshness) | 5 | 5 | 5 | 3 | 41.7 | **P0 — substrate** |
| **Deterministic decision engine** (risk-intersection, priority ranking, threshold rules, routing, capacity) | 5 | 5 | 4 | 3 | 33.3 | **P0 — reliable core** |
| **Adapter spine + redundancy ladders** (primary live, secondary cached/mock, fallback) | 5 | 5 | 4 | 3 | 33.3 | **P0 — enables everything** |
| **AI SitRep fusion** (grounded, cited; misinformation flagging) | 5 | 5 | 4 | 4 | 25.0 | **P1 — differentiator** |
| **SOS intake + verify + evac routing** (consent → AI triage → human verify → CAP) | 4 | 5 | 4 | 4 | 20.0 | **P1** |
| **Responder logistics** (registry, tasking lifecycle, shelters, **full EDXL-RM mutual-aid** + CAP) | 4 | 5 | 4 | 5 | 16.0 | **P1 — challenge emphasis** |
| **Prediction layer** (wind-buffer fire cone; NWPS-crest ∩ NFHL; impact-over-time) | 3 | 4 | 3 | 4 | 9.0 | **P2 — labeled first-order** |
| **Multi-region** (CA live + 1 non-US cached) | 3 | 4 | 4 | 3 | 16.0 | **P2 — portability proof** |
| **Multi-modal / vision** (Sentinel-2 burn area; SOS photo classify) | 2 | 3 | 3 | 4 | 4.5 | **P3 — stretch, advisory** |

**Build sequence (Golden Path first):** P0 substrate+engine+spine → P1 differentiators → P2
prediction+portability → P3 vision stretch. Mirrors CONCEPT §6 and is refined into tasks at S04.

## 5. Rubric traceability (the prize is the opportunity)

| IEEE rubric category | BEACON evidence | Primary bets |
|---|---|---|
| 1 — Timeliness, Real-Time & Reliability | push/SSE, freshness, redundancy ladders, TTTP <10s | COP, spine |
| 2 — Comprehensiveness, Data Use & Novelty | broad free-world catalog; NWPS crest, EAGLE-I, Sentinel NBR, GDELT | spine, vision |
| 3 — Integration, Synthesis & Responsible Data | canonical model + cited AI + consent/provenance/verify/no-PII | engine, AI SitRep, SOS |
| 4 — Usability, Clarity & Operational Readiness | crisis-first COP, offline-capable, runbook | COP, redundancy |
| 5 — Scenario Fit, Insight & Innovation | prediction layer + decision-intelligence + logistics + local-first OSS | engine, prediction, logistics |

## 6. Key risks & mitigations

| Risk | Mitigation |
|---|---|
| External API deprecation — **now-verified churn**: NOAA Billion-Dollar Disasters DB shut down (May 2025); **OpenFEMA API v1 EOL (Aug 18 2025)**; HIFLD Open portal closed 2025; proposed ~24% NOAA cut | Adapter spine + last-known-good cache + recorded mock; multi-source + resilient **global** feeds (Copernicus, FIRMS, FloodHub) so no single shutdown is fatal; live verdicts in `docs/audit/DATA_SOURCE_VERIFICATION.md` |
| AI hallucination in a life-safety tool — **real incidents:** Grok falsely said **tsunami alerts were canceled** (Jul 2025 8.8 quake); AI wildfire **deepfakes** in 2025 LA & BC fires | Deterministic source of truth; LLM cites or is bypassed; JSON-schema validation; visible confidence/uncertainty (Constitution XII); misinformation flagged not merged |
| Automated false alerts (liability) — **active litigation:** 2025 LA-wildfire suits allege delayed/failed evacuation warnings | Human-in-the-loop before any CAP/EDXL; DRAFT-only auto-fires; BEACON **informs**, the agency decides/issues (Constitution XIII); audit trail for defensibility |
| Incumbent lock-in (NIST IR 8255: proprietary formats discourage interoperability) | Open standards first (GeoJSON, CAP, OGC, EDXL); interoperate with Genasys/CrisisCleanup rather than rip-and-replace |
| Scope creep (all-hazards, physics models) | Locked scope: 2 hazards, 4 flagship features, labeled first-order predictions |
| Demo fragility under live data | One fully-live flagship region + cached/mock elsewhere; 3 redundancy acceptance tests |
| Cost overrun | Cheap open-weight LLM default; local Ollama; budgets in `gabbe.config.json` |

## 7. Go/No-Go recommendation

**Recommendation: GO into S01.** The problem is real and sharply framed, the white-space is genuine
(`MARKET_SCAN.md`), the data exists and is mostly verified free/open, the architecture is already proven
at concept stage and de-risked by the audit, and the metrics are demo-measurable. Effort is bounded by
the Golden-Path-first sequence and the locked scope.

**Success criteria to carry into S01:** TTTP < 10s on live primary sources; all 4 flagship features
exercised; 100% citation/provenance coverage with 0 LLM-invented numbers; all 3 redundancy acceptance
tests (offline, primary-down, AI-off) pass; one live + one cached region.

---

> **Gate (HUMAN GO/NO-GO):** Approve GO into S01 (Requirements/PRD), or adjust the problem framing,
> metrics, scope, or RICE priorities first?
