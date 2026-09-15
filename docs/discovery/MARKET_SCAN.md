# BEACON — Market Scan (S00 Discovery)

*Competitive/related-work scan + positioning for the open-source, local-first wildfire/flood COP.*
*Pairs with `PROBLEM_STATEMENT.md` + `OPPORTUNITY_ASSESSMENT.md`.*

> **Sourcing note:** synthesized from established domain knowledge with canonical source URLs. Items
> marked *(verify)* — pricing, current repo activity, DPG status, 2025–2026 funding/deprecation events,
> named recent AI entrants — should be confirmed against live sources before relying on them (the live
> data-source check is tracked separately in `../../audit/DATA_SOURCE_VERIFICATION.md`).

---

## 1. Incumbents & related platforms

| Platform | Type / license | Cost | Strengths | Gaps | How BEACON differs |
|---|---|---|---|---|---|
| **Ushahidi** | OSS (AGPLv3) + hosted | free self-host; paid SaaS *(verify)* | Battle-tested multi-channel crowdsourcing (SMS critical in low-connectivity); Global-South pedigree | Intake/mapping only — no AI synthesis, cited sitreps, logistics, EO fusion, or offline-first | Ushahidi-style intake is **one input channel** into BEACON's fused, cited COP |
| **WFP PRISM** | OSS, **Digital Public Good** *(verify)* | free | EO + vulnerability fusion; **threshold/anticipatory alerts**; national-agency fit | Macro/anticipatory, not field-level COP; not wildfire-focused; no LLM-cited narrative; GIS setup | BEACON cites PRISM as the **inspiration for threshold alerts** but goes operational/field-level + logistics |
| **Sahana Eden** | OSS (MIT) | free | Deep logistics/resource/shelter/registry features | Slowed maintenance *(verify)*; dated UX; no real-time hazard/EO; heavyweight | BEACON inherits the logistics *idea* but modern, real-time, AI-fused, local-first (the **maintainability lesson**) |
| **Genasys / Zonehaven** | Proprietary SaaS (+LRAD) | enterprise per-county *(verify)* | Purpose-built zone evacuation, wide CA adoption, clean public evac UX | Cost/procurement barrier; vendor lock-in; US-centric; closed; not full COP | BEACON is free/open/region-portable + full COP; could **consume** Genasys zones rather than replace |
| **Esri ArcGIS (Emergency Mgmt, Mission)** | Proprietary | named-user/credit, significant for small orgs *(verify)* | Industry-standard GIS; huge ecosystem; trained workforce; dashboards | Cost + GIS-expertise barrier; cloud-dependent; not turnkey AI-cited sitreps; format lock-in | BEACON is the **$0, local-first, turnkey, AI-cited** alternative; interoperates via GeoJSON/CAP/OGC |
| **FEMA IPAWS** | Government | n/a | Authoritative WEA/EAS/CAP reach to phones/broadcast | **Sending requires FEMA authorization (COG/MOA)**; high liability bar | BEACON **consumes** IPAWS/CAP and emits CAP *ready for* it; never originates authoritative alerts |
| **FEMA National Risk Index** | Government, free API | free | Baseline hazard-risk (county/tract, 18 hazards incl. wildfire/flood) | Static-ish, not real-time; US-only | A free **baseline-vulnerability input** layer |
| **Google Crisis / Public Alerts** | Proprietary (public-facing) | free | Surfaces official alerts to the public in Search/Maps | Aggregator, not a responder COP; cloud-locked | BEACON is responder-facing + offline; consumes official alerts |
| **Google FloodHub / Flood Forecasting** | Free public API, **global** | free | AI riverine flood forecasting, global coverage | Flood-only; cloud API | Strong **free-world global flood input** for BEACON (non-US flood coverage!) |
| **Microsoft Planetary Computer / AI for Good** | Free EO data+compute | free | Sentinel/Landsat + humanitarian AI (damage assessment) | Data/compute layer, not a product | BEACON **consumes** its free imagery/models for the vision/EO layer |
| **xView2 / xBD, Copernicus EMS** | OSS models / free EU service | free | Satellite **damage assessment** + rapid mapping (global, open) | Analysis layers, not COPs | Fused into BEACON's multi-modal/vision layer |

## 1b. Additional verified OSS/DPG competitors (live scan, June 2026)

A second, **live-verified** research pass surfaced these (URL-backed, current June 2026) — they tighten
the competitive picture and identify the **two nearest competitors** BEACON must out-position:

| Platform | License / cost | What it leads on | Gaps vs BEACON |
|---|---|---|---|
| **Signpost AI** (IRC/Mercy Corps/Internews) | GPL-3.0, free + LLM cost | **Nearest AI competitor:** real LLM synthesis (OpenAI/Anthropic/Gemini **+ Ollama local**) with **RAG source-citation** (Weaviate) + human-in-loop. The *only* incumbent with citations. Actively maintained (push Jun 2026). | Serves **info to affected people**, not a responder COP; **no logistics**; not offline-first (server+cloud; Ollama partial); no hazard/EO fusion or geospatial exposure. |
| **CrisisCleanup** | Apache-2.0, free (gated) | **Logistics leader:** disaster work-order coordination + **de-dup engine** + hotline; proven at scale (~600k volunteers, 200+ disasters); **global** (US + AU). | Cloud SaaS (**not offline/local-first**); **no AI synthesis**; **no source-citation**; scoped to cleanup work orders, not real-time hazard COP; access gated. |
| **KoBoToolbox** | AGPL+mixed, free/paid | **True offline** field data collection (KoboCollect Android); DPG; entrenched. | Forms/collection only — no AI, no logistics, no citation, no COP. |
| **HOT Tasking Manager** | BSD-2 (data ODbL), free | De-facto humanitarian crowd-mapping coordination. | Produces base-map data, not decision-ready analysis; no AI/offline/logistics/citation. |
| **GeoNode** | GPL-3.0, free (self-host) | Mature geospatial CMS / SDI for non-specialists (OSGeo). | Infrastructure, not a decision product; self-host/DevOps; no AI/offline/logistics. |
| **FrontlineSMS** | LGPL — **DEFUNCT (2021)** | *Was* genuinely offline SMS field comms (Haiti "4636"). | Dead; live analogues: RapidPro/TextIt (UNICEF, OSS), Telerivet (commercial). |

**Sharper white-space finding (verified):** *No single platform combines AI/LLM synthesis +
source-citation + offline/local-first + responder logistics.* Today these are **siloed**: Signpost has
AI+citation (no logistics, not offline); CrisisCleanup/Sahana have logistics (no AI, cloud/aging); only
KoBo (collection) and the dead FrontlineSMS were truly offline. **BEACON's bet is the union of all four
on free-world data** — which has no direct incumbent.

> Competitive takeaways for BEACON: (1) cite **Signpost AI** as proof the "grounded, cited, Ollama-capable
> AI" approach is viable — and beat it by adding geospatial COP + logistics + offline-first; (2) cite
> **CrisisCleanup** as the logistics bar to interoperate with (Apache-2.0, open standards), not duplicate.

## 1c. Commercial incumbents (live-verified, June 2026)

Pricing in this market is almost never list-published; figures are signals from procurement records, SEC
filings, and analyst writeups.

| Platform | Type | Cost signal | Leads on | Gap vs BEACON |
|---|---|---|---|---|
| **Genasys Protect (Zonehaven/EVAC)** | Proprietary SaaS (NASDAQ:GNSS) | ~$26K/yr rural county → ~$744K cumulative large county; ~$8.6M ARR | Zone-based evacuation leader (170+ fire districts, 3,300+ zones); 2025 LA/Dixie fires; TRAFFIC-AI evac modeling | US/CA-only (EVAC not deployed abroad); cloud (no offline); resident-facing map lock-in; AI = simulation not synthesis; no citation |
| **Esri ArcGIS (EM Ops, Mission)** | Proprietary | Viewer ~$100/yr → Creator ~$500–760/yr/seat; Mission Server ~$6.7K/yr + Enterprise + GIS staff | Mature dashboards; Field Maps offline; Mission P2P/DDIL; global self-host | Cost + GIS-expertise barrier; format lock-in; AI assistants are authoring helpers, not COP-grounded synthesis; cites only own docs |
| **Dataminr First Alert** | Proprietary SaaS | ~$20K floor → $40–100K+/yr | Earliest AI event detection (1M+ sources, 150+ langs, global) | Cost-prohibitive small/rural; alert fatigue (needs 24/7 SOC); no citation; no offline |
| **Samdesk** | Proprietary SaaS (CA) | ~$30–100K+/yr | AI crisis detection + verified briefs; Esri/Genasys partners | Enterprise cost; detection-only; citation unconfirmed; no offline |
| **Palantir (Foundry/Gotham)** | Proprietary (NYSE:PLTR) | multi-$M govt | **Best data fusion; data lineage/provenance is core (strongest citation story); air-gapped capable** | Inaccessible to small/rural (federal/enterprise-only); heavy lock-in; cost/politics-gated |
| **Juvare WebEOC + EMResource** | Proprietary | NH ~$662K NTE; per-license+services | De-facto US EOC standard (90%+ state EM, 3,500 hospitals); Nexus has **offline sync** + JAI assistant | Dated UX; sole-source lock-in; US ICS/NIMS/CDC-tuned; no citation |
| **Veoci** | Proprietary SaaS | per-org subscription | No-code virtual EOC; strong mobile; most globally portable EOC | License cost caps rollout; weak offline; no citation |
| **RapidSOS UNITE** | Proprietary (PE, >$1B) | **free to PSAPs** | 911 data layer (~92% US pop, 15k+ agencies) | US-centric; data layer not full COP; single-network lock-in |
| **D4H** (Irish) | Proprietary modular SaaS | **most transparent: ~$400/yr entry, multi-currency** | **Genuinely global/region-portable**; low entry; readiness+response suite | Cloud (no offline); AI not core; no citation |

**Verified cross-market findings:** (1) **Cost barrier is near-universal** — only D4H (~$400 entry) and
RapidSOS (free-to-PSAP) break the small/rural budget; everyone else is enterprise-priced. (2)
**Offline/local-first is rare** — only ArcGIS Mission, Juvare Nexus, and Palantir; the COP/AI analytic
layer is cloud-bound almost everywhere. (3) **Source-citation for AI outputs is a genuine market gap** —
**only Palantir** clearly provides provenance/lineage; the AI-detection vendors do not ground outputs to
cited sources. → BEACON's "$0 + offline + AI-cited + region-portable" combination is unoccupied even
across the commercial field.

## 2. Market gap — the white space

No incumbent combines **all six**: open-source · local-first/offline · free-data-only · AI **cited**
synthesis · region-portable · responder logistics. (Confirmed by both the domain scan above and the
live-verified pass in §1b — the closest, Signpost AI, still lacks logistics + offline-first.)

| | OSS | Offline/local-first | Free-data only | AI cited-synthesis | Region-portable | Responder logistics |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Ushahidi | ✅ | ~ | — | ❌ | ✅ | ❌ |
| WFP PRISM | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ |
| Sahana Eden | ✅ | ~ | ✅ | ❌ | ✅ | ✅ |
| Genasys/Zonehaven | ❌ | ❌ | ❌ | ❌ | ❌ (US) | ~ |
| Esri ArcGIS | ❌ | ~ | ❌ | ❌ | ✅ | ✅ |
| FEMA tools | gov | ❌ | ✅ | ❌ | ❌ (US) | ❌ |
| Google/MS AI | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ |
| **BEACON** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**Underserved segments:** small/rural/volunteer EOCs & fire departments (priced out of Esri/Genasys, no
GIS staff); **non-US / Global South** agencies (locked out of US-centric tooling; need free global data);
low-budget NGOs / mutual-aid groups (need a $0, laptop-deployable, connectivity-resilient COP).

## 3. Positioning (value-chain evolution — Wardley-style)

```
Visible / user need
  EOC situational decisions ── responder logistics ── public safety info
        │ (BEACON's differentiating, still-evolving space: AI-cited COP for the underserved)
  ── COP / synthesis ───────────────────────────── [custom→product: BEACON occupies the OPEN niche]
  ── hazard/exposure analysis (risk intersection, threshold, routing) ── [product/commodity]
  ── free data feeds (FIRMS, NWS, NWPS, USGS, Copernicus, FloodHub, OSM, WorldPop) ── [commodity/utility]
Invisible / commodity
```
Incumbents sit either in **commodity data** (FEMA/NASA/Copernicus — utilities BEACON consumes) or in
**expensive proprietary products** (Esri/Genasys). BEACON's bet is the **open, local-first, AI-cited COP
band** that no one occupies — built *on* the commodity feeds, *under* the user's decisions.

**Positioning statement:** *BEACON is the free, open, run-it-on-a-laptop common operating picture for the
EOCs the big vendors price out — turning free global satellite, weather, and flood feeds plus public
reports into one cited, offline-capable situational picture with responder logistics.*

## 4. Differentiators to emphasize

1. **Deterministic → AI → human handshake** (auditable, human-owned life-safety decisions).
2. **Provenance/citations on every claim** (the antidote to the AI-trust gap that limits incumbents).
3. **Local-first, $0** (structural advantage over Esri/Genasys — no SaaS bill, no procurement).
4. **Total redundancy / offline** (works exactly when cloud tools fail — degraded networks/power).
5. **Multi-modal satellite analysis** (FIRMS + Copernicus/Planetary Computer + FloodHub + xView2).
6. **Free-world data, region-portable** (only globally-free feeds → same deploy works anywhere).

## 5. Risks / watch-outs (carried to OPPORTUNITY_ASSESSMENT §6)

- **Liability of automated/AI alerts (top risk):** never originate authoritative alerts — inform; the
  agency decides/issues. Human-in-the-loop is constitutional (Art. XIII).
- **AI trust / hallucination in life-safety:** mandatory citations + deterministic gating + visible
  uncertainty ("no source → no claim"). (Art. XII)
- **Data-source deprecation/funding cuts (2025–2026)** *(verify)*: multi-source redundancy + resilient
  global feeds (Copernicus, FIRMS, FloodHub) so no single shutdown is fatal — itself a selling point.
- **Incumbent lock-in / interop:** lean into open standards (GeoJSON, CAP, OGC, EDXL); position as
  complementary, not rip-and-replace.
- **Connectivity/power loss:** the founding rationale *and* a hard engineering bar BEACON must truly meet.
- **Sustainability (the Sahana lesson):** lean, modern, documented stack + realistic maintenance story.

## 6. New free-world data inputs surfaced (feed S01 / data-source verification)

The scan surfaced strong **global, free** inputs to add/confirm in the catalog — valuable for the non-US
region (U4) and the vision layer:
- **Google FloodHub** — global AI riverine flood forecasting, free public API (strong non-US flood input).
- **Microsoft Planetary Computer** — free Sentinel/Landsat EO data + compute (vision/burn-area/flood-extent).
- **Copernicus EMS Rapid Mapping** — free EU service, global activations (damage/flood maps).
- **xView2 / xBD** — open building-damage-assessment models (vision layer).
- **FEMA National Risk Index** — free baseline hazard-vulnerability layer (US).

→ Action: add these to `../../audit/DATA_SOURCE_VERIFICATION.md` for live/licensing confirmation and to
the PRD data scope (S01).

---

### Key sources
Ushahidi https://www.ushahidi.com/ · WFP PRISM https://innovation.wfp.org/project/prism · DPG Registry
https://digitalpublicgoods.net/registry/ · Sahana Eden https://sahanafoundation.org/ · Genasys
https://genasys.com/ · Esri disaster https://www.esri.com/en-us/disaster-response/ · FEMA IPAWS
https://www.fema.gov/emergency-managers/practitioners/integrated-public-alert-warning-system · FEMA NRI
https://hazards.fema.gov/nri/ · NIMS https://www.fema.gov/emergency-managers/nims · Google Crisis
https://crisisresponse.google/ · FloodHub https://sites.research.google/floods/ · MS Planetary Computer
https://planetarycomputer.microsoft.com/ · NASA FIRMS https://firms.modaps.eosdis.nasa.gov/ · Copernicus
EMS https://emergency.copernicus.eu/ · xView2 https://xview2.org/

---

> **Gate (HUMAN GO/NO-GO):** Does the positioning/white-space hold, and should the newly-surfaced global
> inputs (FloodHub, Planetary Computer, Copernicus EMS, xView2, FEMA NRI) be folded into S01 scope?
