# BEACON Phase 3 — External Authoritative Verification & Anti-Hallucination Cross-Check

*IEEE Response Quest 2026 · Phase 3 · run 2026-06-29 (GABBE SDLC, persona `prod-research` + integrator).
After the post-hardening final audit, every external claim, standard, version, endpoint, license, and
model id across **all Phase-2 and Phase-3 artifacts** was cross-checked online against **authoritative
academic / industry / government sources** (standards bodies, vendor docs, official agency portals). This
file consolidates the three verification passes, every correction applied, and the Phase-2 discrepancies
that were **noted but not edited** (Phase 2 is submitted/accepted and stays verbatim).*

> **Method.** Three parallel read-only web-verification passes (no sub-agents; `WebSearch`/`WebFetch`
> direct): **(1) Standards**, **(2) Data sources**, **(3) Tech & models**. Each claim was rated
> ✅ confirmed · ⚠️ corrected · 🔵 nuanced-but-kept. Corrections were applied to **Phase-3** artifacts
> only. Authoritative source named per row. Anti-hallucination rule: any figure/endpoint/id that could not
> be confirmed against a primary source was softened to honest language or removed — nothing invented.

---

## Pass 1 — Standards & compliance frameworks

| Claim (as written) | Verdict | Authoritative source | Correction applied (Phase 3) |
|---|---|---|---|
| OWASP **LLM Top-10 (2025)** | ✅ confirmed | owasp.org / genai.owasp.org | kept |
| OWASP **ASI01–ASI10** as a standalone "standard" | ⚠️ nuanced | OWASP GenAI Security Project | Title corrected: the published doc is **"OWASP Top 10 for Agentic Applications (2026)"**; "ASI" = the **Agentic Security Initiative** prefix, not a separate ratified standard. Noted in COMPLIANCE_MATRIX. |
| **NIST AI RMF** (GOVERN/MAP/MEASURE/MANAGE) + **600-1** GenAI profile + **SSDF SP 800-218** | ✅ confirmed | nist.gov | kept; SSDF + EU CRA references **added** |
| **ISO/IEC 42001:2023** (AI management system) | ✅ confirmed | iso.org | kept |
| **ISO/IEC 21031:2024** = GSF Software Carbon Intensity (SCI) | ✅ confirmed | iso.org / GSF | kept |
| **EU AI Act** high-risk obligations dates | ⚠️ corrected | EUR-Lex Reg. (EU) 2024/1689 | Softened to: **Annex III** high-risk obligations apply **2 Aug 2026**; **Annex I** product-embedded high-risk extend **2 Aug 2027**; BEACON aligns as an **intent map**, does not assert a fixed risk class. |
| **MITRE ATLAS** technique ids | ⚠️ corrected | atlas.mitre.org | **AML.T0046 was wrong** (it is "Spamming ML System with Chaff Data"). Corrected to **AML.T0029 Denial of ML Service**; **AML.T0057 LLM Data Leakage**; **AML.T0010 AI Supply Chain Compromise**; **AML.T0051 LLM Prompt Injection**. Clarifying note added in COMPLIANCE_MATRIX. |
| **OTel GenAI** semantic conventions (`gen_ai.*`) | ✅ confirmed | opentelemetry.io | kept |
| **OASIS CAP v1.2** | ✅ confirmed (OASIS **Standard**) | oasis-open.org | kept |
| **OASIS EDXL-RM 1.0** | ✅ confirmed (OASIS **Standard**) | oasis-open.org | kept |
| **OASIS EDXL-SitRep 1.0** described as a peer standard | ⚠️ corrected | oasis-open.org | It is an **OASIS Committee Specification (CS02, 2016)**, **not a full OASIS Standard**. Status note added in SPEC §7.3 + ADR-010. |
| **GeoJSON RFC 7946**, **RFC 8615** (.well-known) | ✅ confirmed | rfc-editor.org | kept |
| **`.well-known/sustainability` v05** called "RFC v05" / a standard | ⚠️ corrected | IETF datatracker | It is an **individual IETF Internet-Draft** (`draft-besleaga-green-sustainability-wellknown-05`) **authored by the project author** — **not an RFC, not a WG/adopted standard**. Re-framed as **author-originated** across ADR-020, SUSTAINABILITY.md, SPEC §7.4, PRD. |
| **SFC engineering profile 1.1** implied to be an industry standard | ⚠️ corrected | (author profile) | It is **the author's own profile**, not an adopted standard. Re-framed as an author-originated alignment example everywhere it appears. |
| **SLSA**, **CycloneDX**, **Sigstore/cosign**, **OpenSSF Scorecard** | ✅ confirmed | slsa.dev / cyclonedx.org / sigstore.dev / openssf.org | kept |
| **EU Cyber Resilience Act (CRA)** posture | ✅ confirmed | EUR-Lex Reg. (EU) 2024/2847 | kept (referenced) |

**Net standards correction:** the only substantive overclaims were (a) the IETF draft + SFC profile
presented as adopted standards, (b) EDXL-SitRep's track, (c) one wrong MITRE id, (d) the OWASP-ASI title,
and (e) EU-AI-Act dates. **All fixed**; recognized standards (GSF SCI / GHG Protocol / CSRD-ESRS-E1 / RFC
8615) are now named as the real basis for the sustainability surface.

---

## Pass 2 — Data sources & APIs (cross-check vs `audit/DATA_SOURCE_VERIFICATION.md`)

| Source | Verdict | Authoritative source | Correction applied (Phase 3) |
|---|---|---|---|
| NASA **FIRMS** | ✅ LIVE | firms.modaps.eosdis.nasa.gov | kept |
| NWS **api.weather.gov** | ✅ LIVE | weather.gov/documentation | kept |
| **OSM Overpass** | ✅ LIVE | overpass-api.de | kept |
| NOAA **NWPS** (`api.water.noaa.gov`) | ⚠️ re-verified | water.noaa.gov | flag cleared → **LIVE** |
| FEMA **NFHL** | ⚠️ re-verified | hazards.fema.gov | flag cleared → **LIVE** |
| **USGS waterservices** | ⚠️ corrected | waterservices.usgs.gov / OGC API | **legacy decommission = Q1 2027** (degradation ≥ Aug 2026) → adopt new OGC API now |
| Copernicus **EFFIS** | ⚠️ corrected | forest-fire.emergency.copernicus.eu | canonical domain **moved** to `forest-fire.emergency.copernicus.eu` |
| **InciWeb** | ⚠️ corrected | inciweb.wildfire.gov | domain **moved** to `inciweb.wildfire.gov` |
| **OpenFEMA** | ⚠️ corrected | fema.gov/openfema | **per-dataset versioning** — specific dataset v1's hit EOL on dated schedules (e.g. 2025-08-18); **no API-wide v1 cutoff** (v1/v2/v3 coexist) |
| **ReliefWeb v2** | ⚠️ corrected | reliefweb.int/help/api | `appname` **pre-approved** since 2025-11-01 |
| Google **FloodHub** API | 🔵 nuanced | sites.research.google/floods | free but **non-commercial + key + GCP-gated** → CACHED/MOCK |
| **MeteoAlarm** | 🔵 nuanced | meteoalarm.org | **token API** → CACHED |
| MS **Planetary Computer** | ⚠️ corrected | planetarycomputer.microsoft.com | free Hub **compute retired 2024-06-06**; **data + STAC API still free**; "Pro" paid → CACHED data, not live compute |
| MS **Building Footprints** | ⚠️ corrected | github.com/microsoft/* | license is **CDLA Permissive 2.0** |
| **xView2 / xBD** | ⚠️ corrected | xview2.org | license is **CC BY-NC-SA 4.0** (not "CC BY-NC") → MOCK/eval-only, never bundled in the Apache-2.0 product |
| **Maxar (Vantor) / Planet** open imagery | ⚠️ corrected | maxar.com (now Vantor) / planet.com | removed a **Planet + Anthropic conflation**; Maxar Open Data = **CC BY-NC 4.0**; Planet disaster/education open data = non-commercial |
| **GDELT**, **WorldPop**, **OpenRouteService**, **EAGLE-I**, **FEMA NRI**, **OpenCelliD** | ✅ confirmed (per-tier) | respective official portals | kept (tiers as recorded) |
| **NOAA Billion-Dollar Disasters DB** | ✅ change confirmed | ncei.noaa.gov | **closed 2025-05** (excluded) |
| **HIFLD Open** portal | ✅ change confirmed | hifld-geoplatform.* | **closed 2025** (excluded) |
| **X/Twitter** free tier | ✅ change confirmed | developer.x.com | gone since **Feb 2023** (excluded) |
| **CAMARA / GSMA Open Gateway** | ✅ confirmed | camaraproject.org | MOCK now; live needs operator agreement (ADR-021) |
| **IPAWS** origination | ✅ confirmed (boundary) | fema.gov/ipaws | produce + validate CAP only, **no live origination** (Art. XIII) |

**Net data correction:** all changes were endpoint moves, versioning/EOL nuance, and one license
upgrade-to-stricter (xView2) — every one strengthens accuracy. No source claimed "live" that is not
reachable on a free/open basis; the LIVE/CACHED/MOCK ladder holds.

---

## Pass 3 — Tech stack & model ids

| Claim (as written) | Verdict | Authoritative source | Correction applied (Phase 3) |
|---|---|---|---|
| Groq default `llama-3.1-70b-versatile` | ⚠️ corrected | console.groq.com/docs/deprecations | **DECOMMISSIONED** (errors since 2025-01-24). Default tier → **`openai/gpt-oss-120b`**, cheap tier → **`openai/gpt-oss-20b`**; Groq stays the provider, ladder unchanged. (`llama-3.1-8b-instant` / `llama-3.3-70b` also deprecated.) |
| **Claude Haiku 4.5** id + pricing | ✅ confirmed | Anthropic docs | id `claude-haiku-4-5`, **$1 / $5** per 1M tokens (in/out) |
| Cloud vision `qwen/qwen2.5-vl-72b-instruct` | ✅ confirmed | OpenRouter | kept |
| **Gemma vision** `gemma-3-4b-it` (+ `-12b-it`/`-27b-it`) | ✅ confirmed | ai.google.dev / Ollama | kept (env-switchable VisionPort profile) |
| **LiteLLM** ladder (Groq→Claude Haiku→Ollama→deterministic) | ✅ confirmed | docs.litellm.ai | kept |
| **Ollama** local (`llama3`, LLaVA) | ✅ confirmed | ollama.com | kept |
| **Node LTS** (latest stable) | ✅ confirmed | nodejs.org | kept (exact pin at S02/S05) |
| **Drizzle ORM**, **Next.js App Router**, **MapLibre GL + deck.gl**, **Turf.js / PostGIS**, **BullMQ**, **SSE** | ✅ confirmed | respective official docs | kept |

**Net tech correction:** one decommissioned Groq model id (now fixed and documented as a historical note
explaining the switch). Everything else current. Model ids must still be **re-pinned at build** against the
Groq deprecation page (recorded in ADR-007 + CONFIGURATION).

---

## Phase-2 discrepancies — NOTED, NOT EDITED (Phase 2 is frozen / accepted)

Per the `additive-edits-to-user-docs` rule, **no Phase-2 file was modified**. Discrepancies found during
cross-check are recorded here and resolved **in Phase 3** only:

1. **Stray "NestJS" backend reference** in a Phase-2 doc → contradicts the locked lean stack (Next.js API
   routes). **Voided in Phase 3 via ADR-003**; Phase-2 text left verbatim.
2. **Phase-2 liveness checks partly sandbox-blocked** at submission time → re-done properly in Phase 3
   `audit/DATA_SOURCE_VERIFICATION.md`; Phase-2 `AUDIT.md` unchanged.
3. **Source-status drift since Phase-2 submission** (HIFLD Open closed 2025, NOAA Billion-Dollar DB closed
   2025-05, X/Twitter free tier gone) → recorded in the Phase-3 data audit; Phase-2 `DATA_SOURCES.md` left
   verbatim.
4. **Endpoint moves** (EFFIS, InciWeb) and **license precision** (xView2 → CC BY-NC-SA 4.0) → corrected in
   Phase-3 artifacts; Phase-2 references untouched (they were not wrong at submission time / were less
   precise, not false).

None of these are Phase-2 errors requiring retraction; they are drift + added precision, correctly
isolated to Phase 3.

---

## Anti-hallucination sweep (all artifacts)

- **0 fabricated endpoints / ids / figures** remain: every external claim now traces to a named
  authoritative source above, or is honestly labeled estimated/modeled (sustainability) or
  pin-at-build (model ids).
- **0 unpublished-source references** (no "BOOK"/manuscript/chapter): attribution is "the author's
  agentic-AI engineering framework" + public standards. (FINAL_AUDIT's "0 book refs" lines are
  verification statements, not references.)
- **Standards-status honesty:** author-originated artifacts (IETF I-D v05, SFC profile 1.1) and
  committee-track artifacts (EDXL-SitRep CS02) are explicitly distinguished from adopted standards.
- **Decommissioned facts kept as honest history:** `llama-3.1-70b-versatile` and the per-request
  sustainability-header anti-pattern remain in the docs **labeled as rejected/decommissioned**, not as
  active choices.

---

## Result

**All external references verified or corrected; project is standards-current as of 2026-06-29 and free of
detectable hallucination.** Corrections were confined to Phase-3 artifacts; Phase-2 remains verbatim. The
post-hardening verdict (**SOUND, CONSISTENT, STANDARDS-CURRENT & BUILD-READY**) stands, now with external
authoritative backing.

*BEACON — IEEE Response Quest 2026, Phase 3 · external verification 2026-06-29.*
