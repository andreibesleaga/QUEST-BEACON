# Differentiator Research — authoritative-source findings (2026-07-19)

> Input to `../../../CURRENT-PLAN-3-DIFFERENTIATORS.md`. Sources: ITU/OASIS/WMO/UNDRR/OCHA/WFP/IFRC/
> ISO/W3C/NWS/FEMA + named OSS/industry. All accessed 2026-07-18/19. UNVERIFIED flagged inline.

## Standards & frameworks (the citable spine)
- **EW4All** 4 pillars: risk-knowledge (UNDRR) · monitoring/forecasting (WMO) · dissemination (ITU) ·
  preparedness/response (IFRC). Target end-2027. 24h notice ≈ −30% damage; ~10× ROI. un.org, itu.int.
- **WMO MHEWS Checklist 2018** — software-implementable items: dynamic multi-hazard maps; disaggregated
  vulnerability (sex/age/disability); evac zones/routes/shelters from extent; impact-based
  threat→action; **verify warnings reached people (feedback)**; **all-clear/"impacts ended"**;
  false-alarm minimization; immutable warning archive; drill/exercise mode; lessons-learned loop.
- **Last-mile failure** (IFRC/GDPC): failure is dissemination+comprehension+feedback, not prediction;
  ~37% of orgs have feedback mechanisms (GNDR 2025, UNVERIFIED-tier).
- **CAP v1.2 ≡ ITU-T X.1303 bis** (same wire format; ITU number lets states mandate). BEACON's CAP is
  de-facto X.1303-bis-conformant. Public XSD → embeddable validator. Mandatory alert/info fields +
  enums + conditional-required (references on Update/Cancel/Ack). **IPAWS Profile** adds SAME/FIPS +
  EAS originator (injection needs FEMA COG = out of scope; validation is in scope).
- **Cell Broadcast/PWS (3GPP TS 23.041)**: 93 chars GSM-7/page, ≤15 pages (max 1,395), ETWS primary
  56 bytes <4s; EU-Alert DCS multilingual (ETSI TS 102 900). BEACON = template/validate/preview only.
- **ITU-T E.107 ETS** (responder priority calling) = context. **Galileo EWSS** satellite→GNSS alert
  (<60s, network-independent; GA date UNVERIFIED) = format payloads only. **Tampere Convention** +
  **GSMA HCC** = posture/context, not features.
- **ISO 22324:2022** color-coded alerts: Red danger/Yellow caution/Green safe, ≤7 colors; accessibility
  clause — color reinforced with text/number/shape/symbol/audio, never alone. Joins to CAP severity.
- **NWS HazSimp**: HAZARD-IN-CAPS → What/Where/When/Impacts/Action. weather.gov/hazardsimplification.
- **WCAG 2.2 AA / ARIA alert**: role=alert live region, persistent (2.2.3), no flashing (2.3.1),
  color not sole carrier (1.4.1), contrast (1.4.3), lang (3.1.x), alt (1.1.1). Repeatable
  `<info xml:lang>` per locale = native CAP multilingual (supports the 37-locale plan).

## Anticipatory action (turns predict→pre-authorized action)
- AA = pre-agreed **trigger + activities + financing** before impact (OCHA/CERF 3 pillars; 60+ countries).
- **IFRC EAP** 6 elements: trigger/threshold · pre-agreed actions · pre-arranged financing · roles ·
  activation mechanism · **stop mechanism**. Two-stage: readiness (long lead) vs activation (short lead).
- **IFRC GO trigger-monitoring MVP** (reusable engineering pattern): daily job ingests **GloFAS
  51-member ensemble** (Copernicus EWDS) → exceedance probability by **counting members over threshold**
  (deterministic, replayable) → hydrograph + team alert. PH example: 5-yr return period, ≥70% prob,
  3-day lead. Also 510 Global/Rode Kruis IBF portal (OSS COP sibling). anticipation-hub.org.

## Predicted affected people/points (the user's core ask)
- Population rasters, all free CC BY 4.0: **WorldPop 100m** (constrained = best exposure), **HRSL 30m**
  (has u5/elderly/women subgroups; not updated since ~2024), **GPW v4.11 1km** (fallback),
  **EU JRC GHS-POP 100m** (what GDACS/CEMS use → provenance win). Recipe everyone uses: hazard extent →
  **zonal sum over open grid** (deterministic, no runtime ML). GDACS/GloFAS/PDC all do this.
- **Predicted telecom blackout (novel)**: predicted extent ∩ **OpenCelliD** cells (CC BY-SA 4.0) →
  cells lost → residents losing alert reach. Validate vs **FCC DIRS** county aggregates + CRS R48776
  (~1-in-4 US residents on wildfire-outage-risk towers). No turnkey tool does predicted∩cell blackout.
- Evac science: Cova & Dennison 2005 (trigger buffers); Li/Cova/Dennison 2019 (clearance super-linear:
  160→292 min at 2× demand); Kuligowski 2020 (participation over-optimism). Params UNVERIFIED → expose
  as labeled assumptions.

## Competitor gap analysis
- Capable incumbents CLOSED/paid/gated: PDC DisasterAWARE (proprietary), Everbridge (~$5k+/yr),
  Genasys/Zonehaven (agency contracts + LRAD hardware), Google FloodHub (proprietary ML, 7-day),
  Meta Data for Good (partner-gated). Open ones AREN'T real-time multi-hazard COPs: Sahana Eden
  (records, aging), Ushahidi (crowdmap+offline capture), RapidPro (messaging). Google Person Finder
  **archived read-only 2025-09-17** (a real reunification gap).
- BEACON wins: offline-first multi-hazard COP (no capable incumbent has it) · ~$0 self-host ·
  deterministic+citations+HITL auditability (incumbents are black boxes) · standards-native CAP/EDXL
  (feeds vendors downstream) · forkable. Cannot-compete (state openly): no FloodHub-class model, no
  telco/hardware delivery, no 24/7 ops center, no field adoption yet. Positioning = complementary.

## Post-impact modules (feasible IF reusing consent+verifier+HITL, aggregate-only)
- **PFIF 1.4** family reunification (Atom-federatable; ICRC RFL Code of Conduct — never publish minors);
  Red Cross Safe-and-Well (search-key vs display separation). **KoBoToolbox/XLSForm** for needs
  (adopt standard, don't rebuild). **Copernicus EMS Rapid Mapping** (free products, activation gated —
  consume only). **INSARAG** worksite triage forms + CalTopo GeoJSON/ICS-104. **FEMA National Shelter
  System** Open Shelters ArcGIS feed (free, capacity/ADA/pets). **WHO EPI-WIN** infodemic RT2
  (structure/route, never auto-adjudicate).

## Ranked shortlist → mapped into plan-3 programs
D1 Anticipatory Action (EAP objects + ensemble member-counting) · D2 Predicted-Impact Quantification
(#1 affected people, #2 comms-blackout/alert-reach, #3 hazard-clipped pop, #4 shelter demand) ·
D3 Warning Excellence (X.1303 validator + profiles, delivery-feedback + all-clear, ISO-22324
pictograms, HazSimp templating, multi-info CAP + TTS, cell-broadcast preview) · D4 optional response
(damage/needs reports, rumor board, shelter board, EMS overlay) · D5 Trust & Governance (immutable
trigger/warning ledger, delegated HITL SOP, drill mode). Rejects (constitution/scope): volunteer/
donation/supply-chain/medical-triage management, RECOVER/AAR stage, public-info portal, individual
ack registries. Family reunification/safe-and-well = DEFER post-contest (privacy vs no-PII rule).

## UNVERIFIED flagged
GNDR 37% feedback stat; Galileo EWSS GA date; evac participation/clearance exact %; Mozilla Location
Service shutdown date (~2024); "SGH" NWS doc acronym; incumbent offline-cache claims; Person Finder
always-on instance.
