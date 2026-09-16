# BEACON Phase 3 — Final Project Audit (informational · logic · semantic · simplification)

*Whole-project audit after the S00→S03 spec base + S03 consistency fixes, run 2026-06-27 via three
parallel read-only auditors (logic/golden-thread, semantic/informational, simplification) over all 40
committed artifacts (requirements, discovery, architecture + 16 ADRs, SPEC, OpenAPI, schemas, DDL,
configs, audit). Cross-checked against the Phase-2 accepted baseline (`../../Phase2/submission/`).*

> **The original 2026-06-27 audit is preserved below. The current, governing verdict is the
> POST-HARDENING audit immediately following.**

---

## ✅ POST-HARDENING FINAL AUDIT (2026-06-29) — current, governing

*After the pre-implementation hardening pass (AI compliance proxy + security/audit/governance matrix;
full day-one test/CI/eval matrix incl. per-FR golden+error+edge; sustainability v05/SFC + CAMARA as
out-of-core plugins; Gemma/provider env-switching), re-audited by **four** parallel read-only lenses —
logic/scope, security+AI+test/CI, semantic+simplification, and **architecture+diagrams** — over the now
**~50 artifacts (23 ADRs, F1–F19, FR-1…FR-16)**. No reference to any unpublished source (attribution =
"the author's agentic-AI engineering framework" + public standards).*

### Verdict: **SOUND, CONSISTENT, STANDARDS-CURRENT & BUILD-READY** — all 🔴/🟡 found were fixed.

- **Logic / golden thread:** FR-1…FR-16 + every EARS line (U1–U7, EV1–EV12, ST1–ST3, OP1–OP6, UW1–UW6)
  trace to architecture → spec → schema/contract → named test. Scope framing verified clean: **FR-14
  (sustainability) + FR-16 (CAMARA) + SFC = out-of-core OPTIONAL PLUGINS, non-blocking**; **FR-15
  (compliance proxy) + the test/CI matrix = CORE**. No orphans/contradictions/dead-ends.
- **Security + AI engineering:** AI compliance proxy covers OWASP **LLM Top-10 2025** + **ASI01–ASI10**;
  mappings to NIST AI RMF / ISO 42001 / EU AI Act / MITRE ATLAS verified plausible + honestly caveated;
  safety fail-closed; budget soft-within / HITL-above-threshold; OTel GenAI 5-level spans + cost-attributed
  hash-chained audit; classical controls (RBAC/BOLA, input/ACL, secrets, deps, TLS) intact; **NIST SSDF +
  EU CRA** now referenced. The **F16/F17/F18/F19 + FR-15** gates are now in the **binding** TEST_PLAN /
  CI_CD / EVAL_PLAN / COMPLIANCE_MATRIX (the one 🔴 from this round — fixed).
- **Test/CI:** full day-one matrix mandatory — unit/integration/contract/**BDD-per-FR**/e2e/**visual
  (Playwright)**/**property (fast-check)**/**metamorphic**/**mutation (Stryker)**/**chaos** + evals; each
  FR requires a **golden + error + edge triad** (Gate-7 triad check fails golden-only); SBOM(CycloneDX)+
  SLSA L2 + cosign + SHA-pinned actions + pre-commit; coverage ≥99% line+branch.
- **Semantic / informational:** entity/enum/port/config-key naming consistent (incl. new `audit_event`
  cost cols, `AICompliancePort`, `TelecomPort`); standards versions accurate; 0 book refs; cross-doc claims
  identical; no dangling refs. A documented SAFE single-source dedup backlog exists (budget posture,
  pipeline string, OTel tree, fitness defs, CAMARA kinds) — **optional**, awaits go-ahead.

### Architecture & Diagrams Verification (per request)
- **Diagrams:** 15 Mermaid diagrams — C4 **L1 System Context**, **L2 Containers**, **L3 Components
  (hexagonal core)**, 4 runtime flows (ingestion→SSE, SOS→verify→CAP, threshold→DRAFT, deterministic→AI→
  human), deployment view; + DOMAIN_MODEL 2 ER views + 3 state machines (report/infra/alert). **All
  syntactically valid and GitHub-renderable.** The one render defect (a `UID`→`UI` dangling participant in
  the SOS sequence) is **fixed**.
- **Correctness:** hexagonal ports-and-adapters + DDD layering sound (domain→application→ports→adapters,
  ACL at every boundary, no inward framework deps, enforced by F9); the **AI Compliance Proxy interposition
  is shown correctly** (P11 LLM + VisionPort → AICompliancePort → adapters; never direct) in L2 + L3 and
  the port map; the deterministic→AI→human handshake, redundancy ladders, multi-region registry, and the
  unbypassable compliance chokepoint are coherent and contradiction-free; **19 ER entities ↔ schema.sql ↔
  OpenAPI 3.1 in 1:1 agreement** (enums, FKs, cost columns, CHECK-enforced invariants); 3 state machines
  have no impossible transitions/dead-ends; **23 ADRs mutually consistent**, no conflicting decisions.
- **Standards-current (2026):** C4, hexagonal/DDD, 12-factor; OWASP LLM 2025 + ASI 2025; NIST AI RMF (+SSDF);
  ISO/IEC 42001:2023; EU AI Act (phased) + CRA; MITRE ATLAS; OTel GenAI semconv; OASIS CAP v1.2 + EDXL 1.0;
  OpenAPI 3.1; GeoJSON RFC 7946; CycloneDX/SLSA/Sigstore; GSF SCI (ISO/IEC 21031:2024); RFC
  sustainability-well-known v05 + RFC 8615. **No outdated/deprecated standard; no material gap.**
- **No regression:** Phase-2 + core Phase-3 guarantees (provenance/citations, deterministic-truth, HITL,
  redundancy/offline, free-world data, 19 entities) intact; `AGENTS.md`/`CONSTITUTION.md` untouched (FROZEN).

### Fixes applied this round (all done, re-validated)
🔴 F16–F19/FR-15 wired into the binding plans; 🔴 C4 `UID`→`UI`; 🟡 F1–F15→F1–F19 everywhere; 🟡 SPEC §1.1
golden-thread FR-14/15/16; 🟡 COMPLIANCE_MATRIX TB→TB11; 🟡 OpenAPI `AuditEvent` cost fields; 🟡 SPEC §4.2
manifest ↔ `config/adapters.json`; 🟡 ADR-021 `defaultMode`→`mode`; 🟡 `.env` `DATABASE_URL_DEV`; 🟡
rate-limit stage named; 🟡 DOMAIN_MODEL `AICompliancePort` row; 🟡 OWASP-2025 labels; 🟡 NIST SSDF + EU CRA
referenced. **Re-validated:** OpenAPI valid (20 paths/45 schemas), 9/9 JSON-Schemas valid, DDL 19 tables,
23 ADRs, 0 stale F1–F15, 0 book refs, 15 valid diagrams.

### Open (optional, documented — not applied; await user go-ahead)
SAFE single-source dedups (budget posture, gateway pipeline string, OTel span tree, fitness-fn defs,
CAMARA kinds); CONSTITUTION **Articles XVII/XVIII** (external-compliance-enforcement, sustainability) —
proposed only; the mechanisms already enforce existing Articles V/VI/XIII/XIV/XVI.

**Build-readiness: GO for S04 task decomposition** (then S05). Architecture needs no rework.

### External authoritative verification & anti-hallucination (2026-06-29) — appended

After this audit, a three-pass online cross-check against **authoritative academic / industry /
government sources** verified every external claim, standard, version, endpoint, license, and model id
across **all Phase-2 and Phase-3 artifacts** (full record: **`docs/audit/EXTERNAL_VERIFICATION.md`**).
Corrections applied to Phase 3 (Phase 2 left verbatim): IETF `.well-known/sustainability` **v05** + **SFC
profile 1.1** re-framed as **author-originated** (not adopted standards); **EDXL-SitRep 1.0** marked an
OASIS **Committee Specification (CS02)** vs CAP/EDXL-RM Standards; **MITRE** `AML.T0046`→**T0029** (+T0051/
T0057/T0010); **OWASP-ASI** title nuance; **EU-AI-Act** dates softened (Annex III 2 Aug 2026 / Annex I
2027, intent-map); Groq `llama-3.1-70b-versatile` **decommissioned** → `openai/gpt-oss-120b`/`-20b`;
data-source endpoint moves (EFFIS, InciWeb), **OpenFEMA** per-dataset versioning, **USGS** legacy → Q1
2027, **xView2** license → **CC BY-NC-SA 4.0**, Maxar(Vantor)/Planet imagery corrected. **Verdict:
standards-current as of 2026-06-29, 0 fabricated facts, 0 unpublished-source refs.** Phase-2 discrepancies
(stray NestJS ref, sandbox-blocked liveness, source drift) are **noted, not edited** (Phase 2 frozen).

---

> **Count note (2026-07-04, D-35):** task totals below are dated snapshots; the **current total is 496** (D-32/33/35 added data-source, UI/UX, security, and eval tasks). See `docs/audit/S05_READINESS.md`.

## ✅ S04 + GATE-FIXES VERIFICATION (2026-07-01, D-26/D-27) — pre-S05 full audit

*After S04 task decomposition and the user-approved gate fixes, a full re-verification of the changed spec
surface (openapi/schema/seed/policies) + the ~448-task backlog.*

### S04 decomposition
- **~448 atomic (≤15-min) tasks** across 9 epics (`project/TASKS.md` + `project/tasks/E0…E9-*.md`), produced
  by 9 parallel GABBE-persona sub-agents. Every task: persona · deps · wave (W0–W5) · `[PARALLEL]`/`[SEC]`
  tags · golden-thread **Trace** · testable acceptance; TDD-first ordering. **267 `[PARALLEL]`, 117 `[SEC]`.**
- **Coverage:** every FR-1…16, F1–F19, 22 API operations (21 paths), 19 entities, 37 source adapters
  (a pre-build S04 planning-catalog figure, dated 2026-07-01 — the shipped catalog is 27 registered
  adapters; see `audit/DATA_SOURCE_VERIFICATION.md` §0), and the 3 redundancy
  acceptance tests trace to ≥1 task. Blast-radius segregated (E6 proxy sequential + fail-closed before
  consumers; E7 auth before routes). orch-judge self-check **PASS** (`project/TASKS.md §7`).
- **Change-resilience (per mandate):** epic-modular files, composite `E#·T-n` IDs, label-based cross-epic
  deps, Trace-linked bidirectional propagation, flag/registry affordances.

### Gate fixes applied + re-verified (D-27)
- 🔴→✅ **`GET /health/adapters` added** — OpenAPI path + `AdapterHealth`/`AdaptersHealthReport` schemas +
  `System` tag; SPEC §2.2 row; route task `E7·T-334a`. **OpenAPI now 21 paths / 47 schemas (was 20/45),
  parses clean.** Endpoint count 23.
- 🟠→✅ **Seed = Romania (EU Flood)** — MIGRATION_PLAN §5 (name/scope=COUNTRY/RO-bbox/+meteoalarm-ro
  +worldpop/+MeteoAlarm-RO source_record/Bucharest-IGSU shelter), schema.sql comment, SPEC §3.4.
  **Zero residual Italy/Emilia references.** EFAS-vs-GloFAS reconciled (GloFAS seeded; EFAS = European live
  upgrade; distinct products).
- ✅ **AUDIT_EVENT hash-chain persisted** — `prev_hash`/`hash` columns in schema.sql (still **19 tables**) +
  OpenAPI `AuditEvent` fields; aligns E1 domain chain ↔ E3 DDL (`E3·T-104`).
- ✅ **Cost caps confirmed (Conservative)** in `config/policies.yml` ($0.50/call HITL · $5/incident ·
  $50/region · 365-day retention; valid YAML). ✅ **ADR-008a confirmed present** (Gemma profile).
  ✅ **E8 layout = docked panels in one COP** (`E8·T-350`).

> **⚠️ COUNT DRIFT — corrected 2026-08-01 (finding F-411).** The 2026-07-01 figures below are a HISTORICAL
> record of that date and are left verbatim, but they no longer describe the repository. Machine-counted on
> 2026-08-01: **`openapi.yaml` = 30 paths / 33 operations / 63 schemas** (was 21 paths / 47 schemas) and
> **38 ADRs** (was 23). Two of that growth is corrective rather than additive: `POST /alerts/{id}/all-clear`
> was **served but undocumented** and has been added, and the `/health/adapters` line below is **withdrawn as
> false** — that route 404s (F-323; see `docs/SPEC.md` §13.11 for the executed proof of all five
> documented-but-unserved paths). Do not quote the 2026-07-01 numbers as current.

### Re-validation (2026-07-01)
- **OpenAPI 3.1** parses; **21 paths / 47 schemas**; `/health/adapters` + both new schemas + AuditEvent
  `prevHash/hash` present. **11/11 JSON valid** (9 JSON-Schemas + gabbe.config + adapters.json); **policies.yml
  + all YAML valid**; **schema.sql = 19 tables** with hash-chain cols; **23 ADRs**; **0 book refs**; **0
  residual Italy seed refs**. Cross-doc counts reconciled (SUMMARY 21 paths; TASKS 22 operations / 21 paths).

### Verdict: **SOUND · CONSISTENT · BUILD-READY — S04 gate PASS.** ⏸️ PAUSE before S05. AGENTS/CONSTITUTION
FROZEN; Phase-2 untouched; no auto-commit.

---

### (Below: original 2026-06-27 pre-hardening audit — historical)

## Overall verdict: **SOUND, CONSISTENT & BUILD-READY — with fixes (1 🔴, ~10 🟡) + a safe simplification backlog**

- **Logic:** every FR-1…FR-13 + each EARS line (U/EV/ST/OP/UW) traces end-to-end to architecture →
  spec → schema → named test (golden thread complete; no orphans, dead-ends, or impossible transitions).
  The 3 state machines, redundancy ladders, decision-intelligence handshake, and EDXL-RM round-trip are
  internally consistent. **Constitution XI–XVI are *enforced* (DB CHECK + API codes + schema-required +
  fitness functions), not merely asserted.**
- **Semantic/informational:** 19 entities, all enums, ports, the `sourceId`+UPPERCASE-mode envelope,
  config (CONFIGURATION↔.env↔gabbe.config↔.mcp), standards versions, and license/deprecation facts are
  accurate and consistent across all files. 0 critical.
- **Simplification:** unusually clean for the size; ~180–230 lines of zero-tradeoff dedup available,
  ~1,000 if ADRs are trimmed (judgment call). No over-engineering below the requirements.
- **Phase-2 functionality preserved:** all 4 flagship features, prediction layer, decision-intelligence
  (keystone, verbatim), logistics/EDXL (**strengthened** to full mutual-aid round-trip), responsible-data,
  multi-region. Correct de-scopes recorded (live IPAWS, physics-grade sim, native mobile, extra hazards).

---

## 🔴 Must-fix (1)

**F-1 — Three SPEC/fitness-function-referenced JSON-Schemas were never authored.** `schemas/` has only
`cap-v1.2`, `edxl-rm`, `edxl-sitrep`, `source-ref`. SPEC §6.3/§5.3/§4.2 + C4 F2/F4/F10 reference
**`schemas/sitrep.schema.json`** (the structural anti-hallucination / citation-coverage gate),
**`schemas/threshold-rule.schema.json`** (FR-11 rule DSL validator), **`schemas/adapter-manifest.schema.json`**
(boot-time fail-fast). These encode Articles XI/XII/XV enforcement. (The S03 consistency pass missed this —
it validated only the 4 present files.) → **Author the 3 schemas** (doing so now) and update SPEC §11.

---

## 🟡 Should-fix (correctness reconciliations) — fixing now

| # | Issue | Files | Fix |
|---|---|---|---|
| F-2 | **API base path** `/api/v1` (SPEC §2) vs `/api` (openapi servers/paths) | SPEC, openapi.yaml | Standardize on **`/api/v1`** (Art. VIII frozen+versioned); align openapi servers. |
| F-3 | **Adapter `Coverage` type** two shapes (SPEC string-union vs adapter-contract tagged-object) | SPEC §4.1, adapter-contract.md | SPEC references adapter-contract's tagged-object shape (canonical). |
| F-4 | **CAP `status` enum** openapi allows Exercise/System/Test; CAP schema + Art. XIII = Draft\|Actual | openapi.yaml `CapAlertCreate` | Narrow to `[Draft, Actual]`. |
| F-5 | **`.env.example` missing `SOURCE_*_MODE`** for named LIVE/EU sources (GDACS, Open-Meteo, MeteoAlarm; +NIFC/HDX/Census/OpenFEMA) | .env.example | Add the missing `SOURCE_*_MODE` lines. |
| F-6 | **Seed uses "EFAS"** (a different product) instead of GloFAS/EFFIS | schemas/schema.sql (seed) | Rename to `copernicus-glofas`/`copernicus-effis`. |
| F-7 | **Escalation-trend + suggested-evac-start-time** lack a deterministic-engine spec section (other engine outputs have formulas) | SPEC §5 | Add §5.7: slope/window algorithm + start-time = f(arrival − clearance), deterministic (Art. XII). |
| F-8 | **EDXL-RM `deploymentStatus`(9) ↔ `RESOURCE_TASK.status`(5)** mapping is prose-only | SPEC §7.2 | Add a normative mapping table (F15 asserts it). |
| F-9 | **Two Phase-2 optional insights dropped without record:** "weather impact on operations" + "radio/TV & road access" | PRD §12 | Record as de-scoped (or add weather-impact insight + use `INFRASTRUCTURE_NODE.type=ROAD` OFFLINE for road access). |
| F-10 | **Stale "canonical ER lives in Phase2/ARCHITECTURE" pointers** (the ER is now DOMAIN_MODEL.md) | PRD §7, C4 footnote | Repoint to `docs/architecture/DOMAIN_MODEL.md`. |

## 🟢 Safe simplifications (no tradeoff) — applying now
- **S1** Collapse the now-applied `S03_CONSISTENCY.md` fix-log to its verdict + clean list (−~35 lines).
- **S2** Single-source the data-tier table to `DATA_SOURCE_VERIFICATION.md`; PRD §9 / SPEC §8.5 keep headline + link / cadence-only.
- **S3** Single-source the redundancy ladders to `CONFIGURATION §11`; shrink PRD §10 / CLARIFICATIONS Q12 to a link.
- **S4** THREAT_MODEL §7 drops the reproduced RBAC table → references CLARIFICATIONS §B.Q6.
- **S5** Strip `schema.sql`'s trailing commented GIST-index, optional approval-trigger, and 35-line commented SEED block (duplicated in MIGRATION_PLAN) — **keep the inline `-- [POSTGIS]` column markers** (−60–90 lines).
- **S8** Declare openapi.yaml the canonical API-boundary envelope + source-ref.schema.json the contract-test authority; add a "CI asserts parity" note (prevents recurring drift).

## 🟡 Optional simplification (judgment call) — DEFERRED, documented
- **S9** Trim the 13 long ADRs (001–013, ~150 lines each) toward the lean ADR-014 shape (collapse the
  4-way Consequences; drop per-option "Source:" lines) → ~−700–900 lines. **Deferred:** rejected-option
  rationale has archival value; recommend a conservative trim only on explicit go-ahead.

---

## 🟢 Verified sound (no action — high-value cross-checks that passed)
- Golden thread complete (FR↔EARS↔component↔test); 19 entities round-trip DOMAIN_MODEL↔DDL↔OpenAPI;
  all enums agree (incl. intentional dual-casing: internal severity MINOR…EXTREME vs CAP-boundary
  Extreme…Unknown). Ports P1–P15 + Queue/Spatial/Cache/Routing/Vision named identically everywhere.
- Constitution XI–XVI enforced: provenance/citations schema-required (F1/F2); no-LLM-numbers (deterministic
  §5 formulas, F3); HITL DB-level `chk_alert_actual_approved` + API 409/422 + CAP Draft-default (F8);
  no-PII (`geom_precise` responder-only, `purge_after`, consent CHECK, vision PII-screen, F12); adapter
  fallback + offline (CONFIGURATION §11, 3 redundancy acceptance tests F5/F6/F7).
- Config 4-way consistent; standards (CAP 1.2, EDXL-RM/SitRep 1.0, OpenAPI 3.1, GeoJSON RFC 7946) +
  license/deprecation facts accurate; model ids valid; cross-doc claims (TTTP<10s, weights, regions,
  EDXL-full, Drizzle, locked stack) identical everywhere; no dangling ADR/section refs.

## Build-readiness
Start S04 task decomposition. Carry into the S04 backlog the items not auto-fixed here (none blocking
once F-1 schemas land). The architecture needs no rework. **Status after fixes below: ship-ready for the
S04 gate.**

---
*Auditors: 3 parallel GABBE sub-agents (logic, semantic, simplification). Fixes applied 2026-06-27 — see
the "Fixes applied" addendum appended after remediation.*

---

## Fixes applied (2026-06-27)

Remediation pass over the committed artifacts (no edits to `agents/AGENTS.md` or `agents/CONSTITUTION.md`
— FROZEN). All 🟡 F-2…F-10 and all 🟢 S1/S2/S3/S4/S5/S8 applied. **F-1** (the 3 missing JSON-Schemas —
`sitrep` / `threshold-rule` / `adapter-manifest`) was authored separately by the schema agent and is now
present in `schemas/`. **S9** (ADR trim) **deferred** per the judgment-call note above.

**🟡 Correctness reconciliations**
- **F-2** Base path standardized on **`/api/v1`**: `docs/api/openapi.yaml` `servers` set to
  `localhost:3000/api/v1` + `{host}/api/v1`. SPEC §2 already says `/api/v1` (confirmed).
- **F-3** Coverage type: SPEC §4.1 `Coverage` replaced with the tagged-object shape
  (`GLOBAL | BBOX | COUNTRIES`) and annotated that `schemas/adapter-contract.md §3` is canonical.
- **F-4** CAP status: `openapi.yaml` `CapAlertCreate.status` enum narrowed to **`[Draft, Actual]`**
  (matches `cap-v1.2.schema.json` + Art. XIII).
- **F-5** `.env.example`: added `SOURCE_GDACS_MODE=live`, `SOURCE_OPENMETEO_MODE=live`,
  `SOURCE_METEOALARM_MODE=cached`, `SOURCE_NIFC_MODE=cached`, `SOURCE_HDX_MODE=cached`,
  `SOURCE_CENSUS_MODE=cached`, `SOURCE_OPENFEMA_MODE=cached` (grouped in the SOURCE_* block).
- **F-6** Seed: EFAS→GloFAS/EFFIS corrected. The reference seed (now single-sourced in
  `MIGRATION_PLAN.md §5`) uses `copernicus-glofas`/"Copernicus GloFAS" (flood) +
  `copernicus-effis`/"Copernicus EFFIS" (fire); the stale "EFAS" seed in `schema.sql` was removed (S5).
- **F-7** SPEC **§5.7** added — deterministic escalation trend (least-squares slope over a config window
  of hotspot-count/gauge-stage → ESCALATING|STEADY|DEESCALATING with a dead-band) + suggested evac start
  = projected_hazard_arrival − route_clearance_time − safety_margin. Data homes noted
  (`SITREP.trend` / `PREDICTION.kind=ESCALATION` / `EVAC_ROUTE.suggested_start`).
- **F-8** SPEC **§7.2.1** added — normative `deploymentStatus` (9 EDXL-RM values) ↔ `RESOURCE_TASK.status`
  (5 values) mapping table; `Available`/`Unavailable`/`OutOfService` marked informational-only.
- **F-9** PRD §12 records the two de-scoped Phase-2 insights ("weather impact on operations",
  "radio/TV broadcast outage") and notes road access IS covered via `INFRASTRUCTURE_NODE.type=ROAD` OFFLINE.
- **F-10** Stale "canonical ER in Phase2/ARCHITECTURE" pointers repointed to `DOMAIN_MODEL.md` in
  `PRD.md §7` and the `C4_ARCHITECTURE.md` port↔model footnote.

**🟢 Safe simplifications**
- **S1** `S03_CONSISTENCY.md` fix-log collapsed to a 2-line "applied 2026-06-27 (see git/AUDIT_LOG)" +
  verdict + Verified-clean list retained.
- **S2** Data-tier single-sourced to `DATA_SOURCE_VERIFICATION.md`: `PRD §9` keeps headline+link (per-source
  enumeration removed); `SPEC §8.5` made cadence-only (LIVE/CACHED/MOCK tier column dropped).
- **S3** Redundancy ladders single-sourced to `CONFIGURATION §11`: `PRD §10` NFR rows + `CLARIFICATIONS Q12`
  now reference it instead of re-enumerating (C4 redundancy table kept — adds EARS mapping).
- **S4** `THREAT_MODEL §7` drops the reproduced 8-row RBAC table → references `CLARIFICATIONS §B.Q6`;
  threat rows kept.
- **S5** `schema.sql` trailing commented GIST-index block, optional `enforce_alert_approval` trigger, and
  long commented SEED block removed (now in `MIGRATION_PLAN §4/§5`); inline `-- [POSTGIS]` per-column
  markers + active CHECK constraints KEPT; 1-line pointer comment added.
- **S8** Canonical-envelope parity note added to BOTH `openapi.yaml` (`info.description`) and
  `source-ref.schema.json` (`$comment`): openapi.yaml is the canonical API-boundary envelope,
  source-ref.schema.json the contract-test copy, CI MUST assert parity.

**Re-validation:** `openapi.yaml` parses (yaml.safe_load OK); `source-ref.schema.json` parses
(json.load OK). No stray "EFAS" remains in active content.

*Files touched: `docs/api/openapi.yaml`, `docs/SPEC.md`, `docs/requirements/PRD.md`,
`docs/architecture/C4_ARCHITECTURE.md`, `docs/architecture/THREAT_MODEL.md`, `audit/CLARIFICATIONS.md`,
`docs/audit/S03_CONSISTENCY.md`, `schemas/schema.sql`, `schemas/MIGRATION_PLAN.md`,
`schemas/source-ref.schema.json`, `.env.example`.*
