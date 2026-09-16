# BEACON — Phase 2 Audit & Verification

*Prepared at the start of Phase 3, before any product development. Phase 2 was submitted and accepted;
this is an **additive** audit — no Phase-2 file is modified. Goal: verify correctness, remove ambiguity,
cut redundancy, simplify, and surface every gap so Phase 3 specs start from a clean, unambiguous base.*

- **Scope audited:** `Phase2/submission/{CONCEPT,PRD,ARCHITECTURE,DESIGN,DATA_SOURCES,RESPONSIBLE_DATA,AUDIT,FORM_ANSWERS,SUMMARY,ONE_PAGER}.md`,
  13 `submission/diagrams/*.png`, 3 `submission/mockups/*.png`, and `Phase2/project/*.md` research files.
- **Companion docs:** [`DATA_SOURCE_VERIFICATION.md`](DATA_SOURCE_VERIFICATION.md) (authoritative live source checks),
  [`CLARIFICATIONS.md`](CLARIFICATIONS.md) (every ambiguity resolved with a recommended decision).

---

## 1. What BEACON is (verified summary)

**BEACON** (Browser-based Emergency Awareness & Coordination Open Network) is a 100% open-source,
local-first browser app that gives emergency managers and first responders a single **common operating
picture (COP)** for **wildfires and floods**. It ingests free/authoritative data through pluggable
adapters, fuses it with an LLM into a **source-cited situational report**, and ties it to **responder
logistics**. Runs on one laptop via `docker-compose up` (~$0) and deploys to cloud unchanged.

**Personas:** Emergency Manager (EOC), First Responder/Incident Commander, Public reporter, and a
Phase-3 Integrator (another agency).

**Four flagship capabilities** (consistent across CONCEPT §4, PRD §4.1, SUMMARY, ONE_PAGER):
1. Unified Live Geospatial COP (region select; timestamped hazard/infra/outage layers).
2. AI Situational-Intelligence Fusion + Insight Engine ⭐ (cited SitRep, ranked priorities, escalation
   trend, threshold alerts).
3. Responsible Crowdsourced SOS Intake + Evacuation Routing (consent → AI triage → human verify → CAP).
4. Responder Comms, Logistics & Resource Management ⭐ (registry, tasking lifecycle, shelter capacity,
   EDXL-RM/SitRep + CAP).

**Core differentiator — the decision-intelligence "handshake" (CONCEPT §4.4, ARCHITECTURE §13):**
deterministic engine owns *all numbers/rankings* → LLM owns *grounded synthesis/explanation* → human
owns *the decision*. If the LLM is down, the deterministic layer still produces usable ranked decisions.
This is the strongest and most defensible idea in the submission and should be preserved verbatim into
Phase 3.

**Architecture (verified, ARCHITECTURE.md):** hexagonal ports-and-adapters; 15 ports (P1–P15), 15
adapter families (A1–A15); anti-corruption layer normalizes every format (CSV/XML/GeoJSON/ArcGIS/RSS)
to one canonical domain model; CAP v1.2 + EDXL as interchange; push-not-poll via WebSocket/SSE; C4
L1–L3 + ingestion flow + SOS sequence + EM journey + two ER views + two state machines + deployment +
strategy + decision-intelligence (13 diagrams total).

---

## 2. Internal consistency matrix

Cross-document contradictions, ranked by impact. "Resolution" is the recommended Phase-3 stance; the
binding decisions are restated in [`CLARIFICATIONS.md`](CLARIFICATIONS.md).

| # | Issue | Where | Severity | Resolution |
|---|---|---|---|---|
| C1 | **Stack name contradiction.** `AUDIT.md` §4 (line 75) asserts the stack is "firmly design-of-record **(NestJS+PostGIS+BullMQ)**", but `CONCEPT.md` §5, `ARCHITECTURE.md` §2/§11, `PRD.md` all specify **Next.js API routes** (not NestJS) and explicitly call backend/messaging/storage **"flexible / final choice at build time."** NestJS appears nowhere except that one AUDIT line. | AUDIT.md:75 vs CONCEPT §5, ARCH §2/§11, PRD §4 | 🔴 HIGH | Treat as an editing error in AUDIT.md. Phase 3 **locks the stack now** (decided): Next.js/TS front+API, **CRON default / Redis+BullMQ as config-flagged adapter**, **Postgres + client-side Turf.js** (PostGIS optional adapter), **SSE**. NestJS is *not* adopted. |
| C2 | **"Illustrative/flexible" stack vs. design-of-record.** The submission keeps backend/messaging/storage deliberately optional ("or", "flexible", "final choice at build time" — CONCEPT §5, ARCH §11). Good for a concept; **blocks specs/contracts/DDL** for a build. | CONCEPT §5, ARCH §2/§11, PRD §8 | 🟠 MED | Resolved by the locked Phase-3 stack (above). The flexibility is preserved *architecturally* via the adapter/feature-flag pattern, but S02 commits one concrete default. |
| C3 | **PostGIS vs Turf.js indecision repeated everywhere.** Storage/geocompute is offered as "PostGIS *or* client-side Turf.js" in CONCEPT §5, ARCH §2/§11/§10, PRD §8, DATA_SOURCES §4. Two materially different data models (server spatial joins vs client compute). | multiple | 🟠 MED | Phase-3 decision: **Postgres canonical store + Turf.js for demo-scale exposure compute; PostGIS behind a `SpatialPort` flag** for scale. DDL written for Postgres; PostGIS geometry types optional. |
| C4 | **EAGLE-I "live outages" vs gov-operational access.** CONCEPT §3.2 and the COP feature list (CONCEPT §4(1), PRD §4.1) imply a live "power outages" layer, but DATA_SOURCES §4 + AUDIT §3 state the **live feed is government-operational**; only **public historical (2014–2025) + dashboard** are open, with live status *derived* by hazard∩infra intersection. | CONCEPT §4(1) vs DATA_SOURCES:46, AUDIT:64 | 🟠 MED | Demo shows outages as a **derived/"assumed-offline" layer** (clearly labeled) + historical EAGLE-I context, **not** a claimed live national feed. Update PRD wording in S01. |
| C5 | **`project/mockups/` vs `submission/mockups/`.** Two PRD.md, ARCHITECTURE.md, and a TDD.md also exist under `project/mockups/`. DESIGN.md:56 correctly declares the *submission* mockups the design-of-record and the project ones "brainstorming only" — but the duplicate filenames are a trap for Phase-3 readers/agents. | project/mockups/* vs submission/* | 🟡 LOW | **`submission/` is authoritative.** Phase 3 reads only `submission/` + this audit. `project/` is historical research, not an input to specs. |
| C6 | **CAP emission scope.** Could read as BEACON issuing public IPAWS-authority alerts. PRD §4.4 correctly scopes it: BEACON **emits standards-compliant CAP v1.2 *ready for* IPAWS**, but real IPAWS origination "requires FEMA approval" (out of scope). | CONCEPT §4(4), ARCH §7.2 vs PRD §4.4 | 🟡 LOW | Consistent once read together. S01/S03 state explicitly: CAP payloads are produced + validated; **no live IPAWS injection**; downstream authority is a documented integration point. |
| C7 | **Diagram says BullMQ; stack says "or CRON".** SOS sequence (ARCH §5) hardcodes `Worker (BullMQ)`; §12 scalability narrative assumes "**BullMQ workers**… partitioned by region," while §2/§11 say "Async queues **or** CRON." | ARCH §5/§12 vs §2/§11 | 🟡 LOW | Per locked decision, **CRON is the default; BullMQ is the flagged adapter**. Diagrams need a one-word caption fix in Phase-3-regenerated versions (see §6). |
| C8 | **Two-persona vs four-persona count.** CONCEPT §1 lists **2** users (EM, First Responder); PRD §2 lists **4** (adds Public reporter, Phase-3 Integrator). | CONCEPT §1 vs PRD §2 | 🟡 LOW | PRD's 4-persona set is the superset and correct; CONCEPT just foregrounds the two operational roles. Use PRD's set in S00/S01. |

**No contradiction rises to "the concept is wrong."** C1 is the only factual error (a stray "NestJS"),
and it lives in an internal audit note, not in any submitted-PDF narrative. Everything else is
concept-stage optionality that Phase 3 is *meant* to resolve.

---

## 3. Redundancy map

The submission intentionally repeats its pitch across audience-specific docs (form answers, exec brief,
one-pager). That redundancy is **appropriate for submission** but should **not** be carried into Phase-3
working specs, which need a single source of truth per fact.

| Repeated content | Appears in | Phase-3 canonical home |
|---|---|---|
| One-paragraph product summary | CONCEPT §0, SUMMARY, ONE_PAGER, FORM_ANSWERS | S00 `PROBLEM_STATEMENT.md` → one definition, others link |
| Four flagship features (verbatim) | CONCEPT §4, PRD §4.1, SUMMARY, ONE_PAGER, FORM_ANSWERS | S01 `PRD.md` §scope (single list) |
| Rubric mapping (Cat 1–5) | CONCEPT §3, AUDIT §2, FORM_ANSWERS | S00 discovery (one rubric-traceability table) |
| Decision-intelligence explanation | CONCEPT §4.4 **and** ARCH §13 (near-duplicate prose) | S02 `C4_ARCHITECTURE.md` (one authoritative section); PRD references it |
| Logistics "inclusions" paragraph | CONCEPT §4 (two near-identical blockquotes) + PRD §4.1 | S01 PRD (one definition) |
| Data-source limitations | DATA_SOURCES (inline) + CONCEPT §3.2 + AUDIT §3 | `DATA_SOURCE_VERIFICATION.md` (one verified table) |
| "Golden path / mock secondaries" philosophy | CONCEPT §5.1/§6, ARCH §10/§12, PRD §8, DATA_SOURCES §intro | S02 ADR + S01 PRD scope (state once) |

**Notable intra-file redundancy:** CONCEPT §4 contains the logistics description **twice** (the numbered
item 4 and a following blockquote), and the decision-intelligence narrative is ~80% duplicated between
CONCEPT §4.4 and ARCHITECTURE §13. Consolidate in Phase 3; do not edit Phase 2.

---

## 4. Ambiguities to resolve (underspecified for a build)

Each is carried into [`CLARIFICATIONS.md`](CLARIFICATIONS.md) with a recommended decision. These are the
items that would otherwise stall implementation or cause rework.

| # | Ambiguity | Why it blocks the build |
|---|---|---|
| Q1 | **Exact live-vs-mock source set & per-region.** "Core subset (FIRMS, NWS, Overpass)" is named, but the full live set, and which sources are live in *which* region, is not pinned. Critical given the **broad multi-region** scope. | Adapters, demo script, and reliability budget all depend on it. Resolved against `DATA_SOURCE_VERIFICATION.md`. |
| Q2 | **EDXL-RM / EDXL-SitRep schema versions + resource data model.** Cited repeatedly but no version (EDXL-RM 1.0?) or field mapping. | Can't write import/export contracts or `RESOURCE`/`RESOURCE_TASK` serialization. |
| Q3 | **Shelter-capacity data source.** Shelter capacity-vs-demand is a feature, but no external source is named; `SHELTER.capacity/occupancy` appear in the model with no provenance. | Determines whether shelters are agency-entered, imported (EDXL-RM/NSS), or mocked. |
| Q4 | **SOS & AI confidence-scoring algorithm.** `PUBLIC_REPORT.confidence` and "AI confidence" are referenced; no method given. | Needs a defined, testable formula (e.g. geocode precision × source-authority × text-classifier score). |
| Q5 | **Threshold-rule engine (FR-11) representation.** `THRESHOLD_RULE{target,operator,value}` exists, but no rule DSL/semantics, evaluation cadence, or de-dup/hysteresis policy. | Required to implement + test FR-11 alerts deterministically. |
| Q6 | **RBAC matrix.** `APP_USER.role ∈ {PUBLIC,RESPONDER,VERIFIER,EM}` defined, but no permission matrix (who can verify, task, emit CAP, see precise PII location). | Needed for authz + the RESPONSIBLE_DATA "precise location only in responder view" rule. |
| Q7 | **Real-time push policy.** "Pushed within seconds"/"on delta" stated, but no concrete trigger (on source change? debounce? heartbeat?) or transport decision (WebSocket vs SSE — both appear). | Locked to **SSE**; still needs the push-trigger + reconnect/backfill policy. |
| Q8 | **Prediction method specifics.** Fire "spread cone" = directional buffer from wind; flood = NWPS-crest ∩ NFHL; "impact over time." Inputs/units/uncertainty representation not fully specified. | Needed to implement FR-12 honestly with labeled uncertainty. |
| Q9 | **"Multi-region" definition.** Region = community/state/country selector, adapters "declare region coverage." But how regions are registered/configured, and how a non-US region degrades when US-only sources don't apply, is unspecified. | Central to the chosen broad multi-region scope. Needs a region-registry config model. |
| Q10 | **LLM model/version + token/cost budget.** "Llama 3 via Groq → … → Ollama" with no model size, context window, or per-SitRep token budget. | Needed for cost NFR and Ollama-offline feasibility. |

---

## 5. Gaps for implementation (missing artifacts)

The concept is build-*ready in design intent* but is missing the concrete engineering artifacts a build
needs. Each maps to a Phase-3 SDLC output:

| Gap | Produced in |
|---|---|
| **Database schema / DDL** (the ER diagrams §7/§7.1 are not executable SQL; no indexes, FKs, geometry types, migrations) | S03 SPEC — `schema.sql` + migrations |
| **API contract (OpenAPI 3.1)** — §7.2 lists routes informally; no request/response schemas, status codes, pagination, errors | S03 — `docs/api/openapi.yaml` |
| **JSON-Schema for CAP v1.2 + EDXL-RM/SitRep** payloads (the §7.2 CAP JSON is illustrative, not a validating schema) | S03 — `schemas/*.json` |
| **Adapter contract + reference implementation** — the port interfaces are named (P1–P15) but no TypeScript `Port`/`Adapter` interface, no manifest/registry format, no worked example | S03 — adapter interface + OSM Overpass reference adapter |
| **Test plan / BDD** — §10 BDD gate assumes "one Gherkin per FR" but only **one** sample scenario (FR-11) is written | S03/S04 — Gherkin per FR-1…FR-13 + unit/integration/e2e plan |
| **Error / retry / circuit-breaker / cache policy** — named ("retries, circuit breakers, last-known-good") but no thresholds, backoff, TTLs | S02 ADR + S03 |
| **Data-refresh cadence policy** — per-adapter poll intervals + cache TTLs not tabulated | S03 — refresh table |
| **Deployment config** — "docker-compose up" claimed; no compose file, env schema, or service list | S03/S04 — `docker-compose.yml`, `.env.example` |
| **Performance/load targets** — "within seconds" only; no feature-count limits, concurrent users, region-scale numbers (needed to defend Turf-vs-PostGIS) | S02/S03 — perf budget |
| **Security posture** — Apache-2.0 + "no PII" stated; no authN method, secrets management, TLS, threat model | S02 — `THREAT_MODEL.md` + RBAC |
| **Operational runbook** — referenced in CONCEPT §3.4 ("ships with a runbook") but does not exist | S03/S07 — runbook |

---

## 6. Figure & schematic check (13 diagrams + 3 mockups)

All 13 architecture PNGs are rendered from the in-repo mermaid (faithful to ARCHITECTURE.md). Findings:

| Asset | State | Phase-3 action |
|---|---|---|
| `01-system-context` … `04-ingestion` | ✅ match text | Keep; regenerate only if stack labels change |
| `05-sequence` (SOS) | ⚠️ labels worker "BullMQ" | Re-caption to "Worker (CRON; BullMQ optional)" per locked stack (C7) |
| `06-journey`, `07-domain-core`, `08-domain-ops` | ✅ match §6/§7/§7.1 | Domain ER becomes the basis for the S03 DDL — keep as design intent |
| `09-state-infra`, `10-state-report` | ✅ match §8 | Keep |
| `11-deployment` | ⚠️ shows PostGIS + Redis as default | Re-caption: default = Postgres+CRON; PostGIS/Redis = scale profile |
| `12-strategy`, `13-decision` | ✅ match §10/§13 | `13-decision` is the keystone diagram — preserve exactly |
| `mockups/cop.png`, `sitrep.png`, `sos.png` | ✅ design-of-record (DESIGN §4) | Drive the Phase-3 UI; the `[src▸]` citation affordance in `sitrep.png` is a hard requirement |

No diagram is *wrong*; three need minor captions to reflect the now-locked lean-default stack.
`project/mockups/*` PNGs are explicitly **not** design-of-record (DESIGN §56) — ignore in Phase 3.

---

## 7. Simplification recommendations (tied to the locked lean stack)

The concept is broad by design (good for scoring "comprehensiveness"). For a *reliable working demo*,
simplify the **infrastructure** while keeping the **breadth** in the adapter layer:

1. **Geocompute:** default to **Turf.js** client/server-side for demo feature counts (hundreds–low
   thousands); keep PostGIS behind a `SpatialPort` flag. Removes a heavy deploy dependency. (Honors
   ARCH §10's own fallback.)
2. **Workers:** **CRON/interval** polling as default; Redis+**BullMQ** as a config-flagged adapter for
   scale. Removes a broker from the demo path.
3. **Push:** **SSE** (one-way, simpler, proxy-friendly) over WebSocket; upgrade later if bi-directional
   need appears.
4. **Cache/eventbus:** in-memory by default; Redis Streams behind a flag. (ARCH §4 shows Redis Streams —
   make it optional.)
5. **AI:** keep the **deterministic engine as the reliable core**; AI SitRep is the grounded amplifier.
   Demo must remain fully functional with the LLM disabled (Ollama-offline path proves it). This is
   already the design — make it an explicit acceptance test.
6. **Secondary sources:** **cache/mock** anything gated, slow, or flaky (CAMARA, Sentinel-2 NBR, FEMA
   NFHL, EAGLE-I live) behind the *same* port, so the COP never dead-ends. Live = FIRMS, NWS, Overpass,
   NWPS, USGS, GDELT, ReliefWeb, ORS (subject to `DATA_SOURCE_VERIFICATION.md`).
7. **Predictions:** ship the **honest first-order** projections (wind buffer, crest∩NFHL) with visible
   uncertainty; defer physics-grade models (FARSITE/Rothermel) as documented adapter extensions.
8. **Multi-region:** ship **one fully-live flagship region** + additional regions on cached/mock data
   via a region registry, so "multi-region" is real but not fragile. (Reconciles the broad-scope choice
   with reliability.)

Net: every simplification is a **default + flag**, not a capability removal — the Phase-2 scalability
story stays intact, the demo stays lean.

---

## 8. Strengths to preserve (do not "simplify" away)

- The **classic→AI→human** decision handshake and the **provenance-on-every-datum / citation-on-every-
  claim** structural anti-hallucination guarantee (CITATION→SOURCE_RECORD). These are the submission's
  identity and its rubric-Cat-3 win.
- **Honest limitations** language (FIRMS≠perimeters, EAGLE-I granularity, satellite revisit gaps). Keep
  stating gaps — it scores.
- **Consent + "Unverified" badge + human verify before action** responsible-data pipeline.
- **Local-first, Apache-2.0, free-data, region-portable** deployability claim — genuine differentiator.

---

## 9. Audit verdict

**Phase 2 is internally sound and build-directable.** Exactly **one factual error** (C1, the stray
"NestJS" in AUDIT.md §4 — superseded by the locked Next.js stack), a set of **concept-stage optionalities**
that Phase 3 is meant to close (C2–C3, Q1–Q10), and the **expected absence of engineering artifacts**
(§5) that the S00→S04 SDLC will now produce. No rework of the concept is required; the audit's outputs
feed directly into Phase-3 specs:

- Contradictions → resolved in [`CLARIFICATIONS.md`](CLARIFICATIONS.md).
- Data claims → verified in [`DATA_SOURCE_VERIFICATION.md`](DATA_SOURCE_VERIFICATION.md).
- Gaps → assigned to S01–S04 deliverables (§5 table).
- Simplifications → become S02 ADRs (§7).

**Recommended pre-spec decisions for the user** (also at top of `CLARIFICATIONS.md`): confirm Q2 (EDXL
versions), Q3 (shelter source), Q6 (RBAC matrix), and Q9 (region-registry model) — the four items that
most shape the SPEC.
