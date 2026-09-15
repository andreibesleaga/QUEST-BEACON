# BEACON — Test Plan (day-one MANDATORY matrix)

<!-- Created by: prod-tech-lead (GABBE SDLC — Specification, S03 testing standard) · Date: 2026-06-29 -->
<!-- Derived from: docs/SPEC.md §9 (testing strategy) + §1.1 golden thread · docs/architecture/
     C4_ARCHITECTURE.md (Fitness Functions F1–F19) · docs/requirements/PRD.md (FR-1..13, EARS, §6
     acceptance) · agents/CONSTITUTION.md Art. I (test-first, ≥99%) · agents/guides/principles/
     {testing-strategy,evaluation-strategy}.md · the author's agentic-AI engineering framework
     (GABBE skills: tdd-cycle, testing-strategy, browser-tdd, pbt-strategy, metamorphic-testing,
     chaos-fault-injection). Eval-layer detail (AI) lives in docs/EVAL_PLAN.md; CI wiring in docs/CI_CD.md. -->
<!-- This is a SPEC document (S03). No application code exists yet (PAUSED at S04). Tooling/coverage gates
     here are the binding target the S05 build must satisfy; every requirement maps to a verification layer. -->

> **Standard:** the **full** matrix below is **MANDATORY from S05 day one** (ADR-019) — not a
> core-now / nice-later split. BEACON is life-safety software: an ungrounded, LLM-numbered, redundancy-broken,
> or PII-leaking build **fails CI** (the F1–F19 fitness functions are executable architecture, not aspirations).
> Tests verify **determinism** (green/red); evals score **probabilistic quality** (graded) — see `docs/EVAL_PLAN.md`.
> Never substitute a passing test suite for an eval on AI output, or vice versa.

---

## 1. Scope & strategy

**In scope.** Every functional requirement **FR-1…FR-13** and the cross-cutting redundancy requirement, plus
the nineteen contract/fitness functions **F1–F19** (C4 §"Quality / Fitness Functions"), including the four
new AI-governance functions **F16** compliance-proxy-enforced, **F17** budget-HITL-above-threshold, **F18**
sustainability-report-schema-valid (plugin, non-blocking), **F19** per-step-cost-attribution-present. The four flagship
features end-to-end on the golden path (PRD §6).

**Out of scope (this doc).** AI **eval** scoring (golden dataset, LLM-as-judge, RAG faithfulness, pass^k) is
specified in `docs/EVAL_PLAN.md`. CI/CD workflow wiring, SCA/SAST/SBOM/signing is in `docs/CI_CD.md`.
Live penetration testing of a deployed instance (no scope). Physics-grade hazard simulation (out of product scope).

**Model — Pyramid with a contract/fitness backbone.** BEACON's complexity is in a **pure deterministic
engine** (risk-intersection, ranking, threshold eval, confidence blend, routing, prediction) over a hexagonal
core, so the base is a fat **unit** layer (Pyramid, per `testing-strategy.md` §1 — "if your complexity is in
the logic, test the logic"). Above it sit integration, contract/fitness (F1–F19), BDD-per-FR, and a thin e2e
tip. Four advanced tiers (PBT, metamorphic, chaos/fault-injection, mutation) close the gaps example-based tests
miss. The probabilistic AI layer is graded by **evals**, not tests (`docs/EVAL_PLAN.md`).

**Toolchain (LOCKED — AGENTS.md §1/§2).** Vitest (`npm test -- --coverage`); Gherkin/BDD per FR
(`vitest-cucumber` / `@cucumber/cucumber`); Playwright (e2e + visual-regression + axe a11y);
**fast-check** (property-based, TS-native — the project's PBT tool, not Python/Hypothesis); **Stryker**
(mutation, TS); Testcontainers/`pg`-in-Docker (ephemeral Postgres, Gate 4); a deterministic in-test
**chaos/fault-injection harness** (mock/proxy seams; Toxiproxy for network-level faults). AJV validates emitted
CAP/EDXL against the `schemas/` JSON-Schemas (F15).

### 1.1 Scenario-coverage policy (MANDATORY)

> **Every FR's BDD/e2e suite MUST implement a triad of *concrete, implemented* scenarios — no TODO
> stubs, no `@skip`, no pending steps.** A `.feature` that names a scenario but leaves its step
> definitions empty (or a happy-path-only file) **fails Gate 7** exactly as a missing feature does. The
> triad is:
>
> 1. **(a) Golden / happy path** — the requirement satisfied on good inputs, live-equivalent (mocked)
>    sources, the expected envelope/status/state transition produced.
> 2. **(b) Error / failure paths** — every typed failure the requirement can hit: source down, AI down,
>    schema/citation rejection, verifier REJECT, budget block, compliance-proxy block, authz/BOLA denial,
>    invalid/oversized payload, illegal state transition, stream drop. Each asserts the **specified
>    recovery or hardstop** (degrade-and-label, fallback, `4xx`/`409`, fail-closed), **never** a 5xx
>    dead-end (UW2) and never silent success.
> 3. **(c) Edge cases** — boundaries and degenerate inputs: empty/zero, max load, concurrency, enum/
>    threshold boundaries (hysteresis/cooldown), duplicate/near-duplicate, air-gapped, clock-skew/
>    freshness boundary, oversized round-trip, unicode/bidi/zero-width.

**This raises the coverage bar from lines to branches.** The **≥99% line + branch** gate (§2) is read
strictly: the error-handling and edge branches — the `catch`, the fallback rung, the `409`/`403`/`422`
return, the hysteresis non-fire, the empty-set guard — **must be exercised by an executed scenario**,
not coverage-padded by happy-path lines that incidentally walk the file. A branch reached only by the
golden path is an **uncovered branch** for the purposes of this policy; the error/edge scenarios in §1.2
are what cover it. (Mutation, §3.10, is the backstop that the assertions on those branches actually bite.)

**Wiring.** The triad lives across the existing layers — not a new test type:
- **(a) golden** → one BDD scenario per FR (§3.4) + the e2e golden path (§3.5).
- **(b) error/failure** → BDD error scenarios (§3.4, same `.feature`) + integration error cases (§3.2,
  status/state assertions) + the **3 redundancy acceptance tests as first-class error-path e2e** (§3.9).
- **(c) edge** → BDD edge scenarios (§3.4) + unit edge cases (§3.1) + PBT boundary generators (§3.7) +
  the heavy/combinatorial edge sets that run nightly (§3.9/§3.10, §5).

CI lanes for the triad: **PR-blocking** runs golden + the *key* error/edge scenario(s) per FR (fast,
mocked externals); **nightly** runs the heavy/combinatorial edge sets, chaos/fault-injection, e2e-real,
load, and mutation (`docs/CI_CD.md` §3/§4). **A PR fails if any FR lacks all three of golden + error +
edge** (Gate 7 extended — `docs/CI_CD.md` §2).

### 1.2 Per-FR scenario matrix (golden + error + edge — the §1.1 triad)

Representative (not exhaustive) scenarios per FR; each error/edge row ties to its fitness function(s)
and to the typed recovery/hardstop in SPEC §8 (degradation ladder) / §10.2 (status codes). "→" means
the asserted, *positive* recovery. The 3 redundancy acceptance tests (F5/F6/F7) appear as first-class
error-path rows on the FRs they touch and are formalized end-to-end in §3.9.

| FR | (a) Golden / happy | (b) Error / failure (→ recovery, FF) | (c) Edge |
|---|---|---|---|
| **FR-1** region → layers | region selected → all relevant layers load with `provenance[]`+`freshness` | primary source down → secondary → cache → mock → **"unavailable + freshness"** (no dead-end, F6); region has no source coverage → layer labeled **"not available in this region"** (global-equivalent substituted) | empty region / zero incidents (valid empty COP, not error); **max feature-count** layer (Turf perf bound, F14-adjacent); concurrent region switches |
| **FR-2** freshness labeling | each layer shows source + last-updated | source returns 200-with-error / torn cache → typed `SOURCE_DEGRADED`, **stale labeled "estimated/degraded"**, never relabeled fresh (F1/F6) | clock-skew / freshness-boundary (datum exactly at the stale cutoff); all-sources-stale region |
| **FR-3** exposure intersection | hazard geometry ∩ infra/population → exposure counts (engine numbers, F3) | spatial engine unavailable on one path → `SpatialPort` parity fallback (Turf↔PostGIS, F11); malformed upstream geometry → ACL rejects, no raw shape leaks (F6/F9) | on-boundary point / node exactly at buffer edge; empty hazard set (zero exposure, valid); **max feature-count** load (Turf perf bound); unicode in place names |
| **FR-4** cited SitRep + priorities + trend | cited SitRep + ranked priorities + escalation trend, 100% field citation (F2) | **AI provider down → ladder → deterministic-only** (`ai_mode:"deterministic-only"`, ranked priorities retained, F7); **LLM output fails schema/citation validation → reject + deterministic-only fallback**, no free-form text (F4/UW3); compliance-proxy blocks (PII/prompt-injection) → **403**, fail-closed (F16) | empty priorities list; `< TREND_MIN_SAMPLES` → trend STEADY; conflicting sources flagged not merged; unicode/bidi/zero-width in narrative inputs (sanitized, F12) |
| **FR-5** consented report → UNVERIFIED + confidence | consented report → `UNVERIFIED` + confidence components (blend is engine, F3) | no consent / PII-screen fail → rejected at intake (UW6/F12); invalid/oversized payload → **400/422**; LLM triage down → report still accepted with deterministic confidence floor (F7); AI returns a number it shouldn't → rejected (F3) | **duplicate / near-duplicate SOS reports** → corroboration, confidence monotone-up not double-count; report body with name/phone (PII) → screened (F12); zero-signal report |
| **FR-6** verify/reject; approval may emit CAP | VERIFIER approves → may emit **DRAFT** CAP (`emitCap=true`, `meta.emittedAlert`) | **verifier REJECTS report → marked Rejected/misinformation**, no emission (F8); **CAP emit attempted from UNVERIFIED/TRIAGED → blocked 409** STATE_CONFLICT (F8/ST1/UW5); unauthorized role tries to verify → **401/403** (BFLA, F12-authz); BOLA: verify another region's report → **403** | concurrent verify of same report (idempotent, one transition); audit-sink down → **fail-closed**, transition rejected (F8) |
| **FR-7** evac routes + shelters | route avoids hazard polygon + nearest OPEN shelter(s) | routing engine down → ORS → Valhalla/OSRM → **heuristic straight-line `avoids_hazard=false` labeled** (F6/redundancy); no OPEN shelter / all full → labeled, nearest-available returned not error | zero capacity everywhere; node exactly at hazard boundary; no engine can avoid hazard (degraded-but-labeled route) |
| **FR-8** resources / shelter capacity | register/locate/task resource; `RESOURCE_TASK` lifecycle; shelter capacity tracked | illegal task transition (e.g. CLEARED→ENROUTE) → **409**; unauthorized task assignment → **403**; BOLA: task a resource outside region → **403**; oversized/invalid payload → **422** | shelter at exactly 100% capacity (boundary); concurrent task updates (last-writer/optimistic-lock); zero registered resources |
| **FR-9** CAP / EDXL-RM / EDXL-SitRep | CAP v1.2 for event; **full EDXL-RM mutual-aid round-trip**; EDXL-SitRep | emit invalid CAP/EDXL → **schema-validation reject before send** (F15), nothing leaves; XML with XXE/entity-expansion → **rejected** (THREAT T2.4); emit from UNVERIFIED → **409** (F8) | **very large EDXL-RM round-trip** (import↔export, no loss); all 9 OASIS `deploymentStatus` values incl. informational-only (no spurious transition); unicode/bidi/zero-width in fields preserved-or-rejected, never corrupting the message |
| **FR-10** adapter manifest, zero core change | add a source via manifest → new layer, **zero core change** | manifest missing key/URL → **boot fail-fast** (F10, e.g. `bullmq` without `REDIS_URL`); adapter throws/leaks raw format → ACL rejects, breaker opens, falls to cache/mock (F6/F9) | duplicate manifest id; adapter with no live mode (mock-only) still registers; max registered adapters |
| **FR-11** threshold DRAFT alerts | gauge crosses category / hazard enters buffer → **DRAFT** alert with provenance | alert sink unavailable → **fail-closed**, DRAFT persisted not silently dropped (F8); attempt to fire a non-DRAFT/ACTUAL alert automatically → blocked (F8/Art.XIII) | **flood-category transitions with hysteresis/cooldown** (dwell < hysteresis → no fire; cooldown de-dup; anti-flap); crossing-vs-holding boundary; **severity enum bounds** |
| **FR-12** labeled prediction | first-order projection with **method + inputs + uncertainty** labeled | missing wind vector / no NFHL coverage → projection **labeled caveat / "not available in this region"**, never a physics-grade claim (honest-limitations); upstream model input malformed → degrade-and-label | `projected_hazard_arrival=null → suggested_start=null`; zero-uncertainty vs wide-cone bounds; clock-skew on input timestamps |
| **FR-13** decision support | deterministic numbers + AI narration, **human-approved** | AI narration down → deterministic decision still rendered (F7); narration tempts a number → rejected (F3); compliance-proxy/budget block on the narration call → **403 / hard-block + HITL** (F16/F17), deterministic decision unaffected | conflicting inputs surfaced not auto-resolved; empty decision set; very long narration truncated-not-corrupted |
| **FR-15** AI compliance proxy + budget HITL | every LLM/vision call carries the gateway stamp → proceeds within budget | **un-stamped call attempted → REJECTED** (bypass-proof, F16); **PII-egress / prompt-injection → 403 fail-closed** regardless of budget (F16); **budget threshold exceeded / over cap → hard-block + HITL** (F17); destructive-action attempt via proxy → **403**; cost attribution missing on an `AUDIT_EVENT` → **fail** (F19) | reserved cost **exactly at** `escalation_threshold_usd` (boundary → block); concurrent calls racing the per-incident cap; invalid `config/policies.yml` → boot fail-fast (the policy-as-code backstop F16/F17 depend on) |
| **FR-14** sustainability plugin *(non-blocking)* | `GET /.well-known/sustainability` validates against schema, labeled modeled/estimated | plugin disabled → endpoint absent, **core unaffected** (no error to COP); schema-invalid payload → **contract fails** (non-blocking lane, F18) | single-object vs trend-array form; missing optional fields tolerated; large trend array |
| **FR-16** CAMARA telecom plugin *(mock-now)* | `TelecomPort` MOCK returns aggregate-only signal; flag-to-live path typed | live mode without key → **boot fail-fast / stays mock** (F10); attempt to expose non-aggregate (individual) data → **blocked** (privacy, F12) | mock↔live parity (`TelecomPort` contract, F11); empty/zero-density cell; region with no telecom coverage → labeled N/A |

**Cross-cutting error/edge → fitness-function map (so a reviewer can trace each class once):**

| Error / edge class | Asserted behavior | FF | Where (layer) |
|---|---|---|---|
| Primary source down → cache→mock→"unavailable+freshness" | degrade-and-label, correct `degraded.rung` + original freshness, no 5xx dead-end | **F6** | §3.9(b), §3.2, FR-1/2/3 BDD |
| AI provider down → ladder → deterministic-only | `ai_mode:"deterministic-only"`, ranked priorities retained | **F7/F4** | §3.9(c), FR-4/13 BDD |
| LLM output fails schema/citation validation → reject + fallback | no free-form text; deterministic-only path proven | **F4** | §3.3, EVAL §3, FR-4 BDD |
| Verifier REJECTS report | Rejected/misinformation, no emission, `AUDIT_EVENT` written | **F8** | FR-6 BDD, §3.2 |
| Budget threshold exceeded → hard-block + HITL | call held for human approval; within-budget proceeds (soft) | **F17** | §3.3, `compliance.feature`, FR-15 BDD |
| Compliance-proxy blocks (PII / prompt-injection / destructive) → 403 | fail-closed regardless of budget; un-stamped call rejected | **F16** | §3.3, `compliance-proxy.feature`, FR-15 BDD |
| Unauthorized role → 401/403; BOLA attempt → 403 | per-route AND per-object authz denial | **F12** (authz) | §3.2, FR-6/8 BDD |
| Invalid / oversized payload → 400/422 | Zod/contract reject, typed error envelope | (route contract) | §3.2, FR-5/8 BDD |
| SSE stream drop → polling + `Last-Event-ID` backfill | same delta contract; no missed deltas | **F11** (realtime parity) | §3.2, §3.9 |
| CAP emit attempted from UNVERIFIED → blocked (409) | STATE_CONFLICT; no outbound | **F8/ST1/UW5** | FR-6/9 BDD, §3.2 |
| Region source coverage N/A → "not available in this region" | labeled, global-equivalent substituted | **F6** (redundancy) | FR-1/12/16 BDD |
| Empty region / zero incidents; stale/degraded labeling | valid empty COP / honest staleness, not an error | **F1/F6** | §3.1, FR-1/2 BDD |
| Max feature-count load (Turf perf bound); concurrent SSE clients | engine stays within bound; per-region SSE isolation holds | **F11/F14** | nightly load §5, §3.2 |
| Enum/threshold boundaries (flood-category w/ hysteresis & cooldown; severity bounds) | edge-trigger only on dwell≥hysteresis; cooldown de-dups | (engine §5.3) | §3.1, FR-11 BDD |
| Duplicate / near-duplicate SOS reports | corroboration, confidence monotone-up, no double-count | (engine §5.4) | FR-5 BDD, §3.7 |
| Air-gapped / offline | full COP + deterministic insights, **zero egress** | **F5** | §3.9(a) |
| Clock-skew / freshness boundary | freshness never relabeled fresh; boundary handled | **F1/F6** | §3.1, FR-2/12 BDD |
| Very large EDXL-RM round-trip | lossless import↔export, schema-valid both ways | **F15** | §3.3, §3.7, FR-9 BDD |
| Unicode / bidi / zero-width in reports | sanitized/preserved, never corrupts output or injects | **F12** | §3.1, FR-4/9 BDD |

> The three redundancy acceptance tests — **(a) offline/air-gapped (F5), (b) primary-source-down (F6),
> (c) AI-disabled (F7)** — are the canonical first-class **error-path e2e**; they are specified in full
> in §3.9 and gated at S06 (§5), and every FR row above that says "source down" / "AI down" / "air-gapped"
> is an instance of one of them scoped to that requirement.

---

## 2. Coverage gates per layer (Constitution Art. I / Gate 3)

| Layer | Coverage gate | Lane | Tools | Rationale |
|---|---|---|---|---|
| `src/domain` (pure) | **≥99% line + branch** | PR-block | Vitest | deterministic = fully testable; zero excuse for gaps |
| `src/application` (use-cases, pure) | **≥99% line** | PR-block | Vitest | the deterministic engine — the trust core |
| `src/ports` (interfaces) | n/a (no logic) | — | tsc | type-checked only |
| `src/adapters` (I/O) | **critical paths ~70–80%** | PR-block | Vitest + fixtures | ACL/cache/breaker/mock paths mandatory; raw-network excluded in CI |
| `app/` (Next.js routes, thin) | route handlers exercised | PR-block | Vitest + Supertest-style | Zod, status codes, envelope, RBAC |
| `app/` (UI) | visual + a11y on COP/SitRep/logistics | PR-block | Playwright + axe | F13 (WCAG 2.2 AA) |
| **Contract / fitness F1–F19** | **mandatory regardless of layer** (F18 plugin/non-blocking) | PR-block (F1–F4,F8–F13,F15,F16,F17,F19) / S06 (F5–F7,F14) / contract non-block (F18) | Vitest contract + Playwright + AJV | an ungrounded/redundancy-broken/un-stamped build fails |
| **Mutation score** | **≥80% killed** on domain+application | nightly | Stryker | line coverage ≠ test quality; mutation is the real bar |

> **Overall ≥99% line** (PRD §6 / Art. I). The deterministic layers carry it; adapter raw-I/O is the only
> place ~70–80% is acceptable, but its contract/redundancy fitness functions are non-negotiable.
>
> **Branch coverage is read strictly (§1.1).** The ≥99% **branch** bar on `src/domain`/`src/application`
> means the **error and edge branches** — the fallback rung, the `409`/`403`/`422` return, the
> hysteresis non-fire, the empty-set guard — are each hit by an *executed* error/edge scenario (§1.2),
> not coverage-padded by happy-path lines. A branch reachable only on the golden path counts as
> **uncovered** under this policy until an error/edge scenario reaches it.

---

## 3. Layer-by-layer matrix

### 3.1 Unit / TDD — domain + application (pure, no I/O) — PR-block, ≥99%

Red-Green-Refactor per `tdd-cycle` (write the failing test first; a test that passes with no implementation is
broken). Every deterministic computation in SPEC §5 is unit-tested with named edge cases:

| Unit under test | SPEC | Key edge cases |
|---|---|---|
| Risk-intersection / exposure (`IN_POLYGON`/`IN_BUFFER`/`OUTAGE`, status transitions) | §5.1 | on-boundary point, empty hazard set, node exactly at buffer edge |
| Weighted priority ranking (0.45·prox + 0.35·vuln + 0.20·pop) | §5.2 | ties, `inside_hazard ⇒ proximity=1.0`, OFFLINE vulnerability boost |
| Threshold-rule eval (edge-trigger, hysteresis, cooldown) | §5.3 | crossing vs holding, dwell < hysteresis (no fire), cooldown de-dup, anti-flap |
| Confidence blend (0.40/0.30/0.20/0.10) | §5.4 | LLM supplies only geocode + classifier_score (both cited); blend is pure code |
| Capacity match (distance × available capacity) | §5.5 | zero capacity, all shelters full, no OPEN shelter |
| Hazard-avoid routing constraint | §5.5 | no engine can avoid → straight-line `avoids_hazard=false` labeled |
| Prediction cone / NWPS∩NFHL inundation / impact-over-time | §5.6 | missing wind vector, no NFHL coverage (labeled caveat) |
| Escalation trend (least-squares slope vs dead-band) | §5.7 | < TREND_MIN_SAMPLES ⇒ STEADY, exactly-on-dead-band, monotonic vs noisy |
| Suggested evac start (`arrival − clearance − margin`) | §5.7 | `projected_hazard_arrival=null ⇒ suggested_start=null` |
| Envelope serializer (`{data,provenance[],freshness}`), ACL mappers, `SourceMode` lowercase→UPPERCASE | §2.1/§4 | empty provenance must be impossible; stalest-input freshness |
| EDXL-RM `deploymentStatus ↔ RESOURCE_TASK.status` mapping | §7.2.1 | 9 OASIS values; informational-only values cause no transition |

### 3.2 Integration — adapters + ACL + Drizzle + API — PR-block (Gate 4)

- **Adapter fetch → ACL → normalize** against **recorded fixtures** (no live network in CI). Asserts raw
  upstream shapes are dropped at the ACL (Art. VIII); `SOURCE_RECORD` + `freshness` stamped.
- **Drizzle migrations + repository** against an **ephemeral Postgres** (Testcontainers / `pg`-in-Docker):
  `0000_init` (Turf/jsonb default) and the guarded `0001_postgis` path; structural invariants (every datum
  row has `source_id`; `geom_precise` never serialized to a non-RESPONDER role).
- **API route handlers**: Zod validation, status codes (200/201/202/4xx/409/422/429), envelope shape, RBAC
  (BOLA/BFLA — per-route AND per-object), cursor pagination, SSE `/stream` region-keyed isolation.
- **Both spatial paths** (Turf and PostGIS) exercised against the **same `SpatialPort` contract** (F11).

### 3.3 Contract / fitness tests — F1–F19 (executable architecture) — mostly PR-block

| # | Fitness function | Assertion | Lane |
|---|---|---|---|
| F1 | Provenance | every data envelope has non-empty `provenance[]` + `freshness`; missing → fail | PR-block |
| F2 | Citation | every generated SitRep field → ≥1 real `SOURCE_RECORD`; **100% field coverage** | PR-block |
| F3 | No-LLM-numbers | all numbers/rankings/distances/exposures originate from the engine; LLM output is non-numeric narrative | PR-block |
| F4 | Schema-fallback | invalid LLM JSON/citation → deterministic-only ranked priorities (no free-form text) | PR-block |
| F5 | Redundancy: offline/air-gapped | `AI_MODE=off` + all `SOURCE_*_MODE=mock` + `DEPLOY_MODE=local`, no egress → usable COP | S06 (chaos §3.9) |
| F6 | Redundancy: primary-source-down | each primary blocked → secondary/cache/mock, correct freshness, no dead-end | S06 (chaos §3.9) |
| F7 | Redundancy: AI-disabled | deterministic engine alone → ranked, usable decisions | S06 (chaos §3.9) |
| F8 | HITL invariant | no CAP/EDXL while `UNVERIFIED`/`TRIAGED`; DRAFT-only until approval; every change → `AUDIT_EVENT` | PR-block |
| F9 | Layer-import / boundary | dependency-cruiser: domain imports nothing framework-specific; no raw format above ACL; no cycles | PR-block (Gate 1/6) |
| F10 | Config fail-fast | boot rejects a flag missing its key/URL (e.g. `bullmq` without `REDIS_URL`) | PR-block (Gate 4) |
| F11 | Port-parity | Turf↔PostGIS, cron↔bullmq, memory↔redis, sse↔polling satisfy one behavior contract | PR-block |
| F12 | PII / privacy | no reporter PII in logs; precise location responder-only; purge at incident close; images PII-screened | PR-block (Gate 5/7) |
| F13 | WCAG 2.2 AA + responsive | axe + responsive across desktop/tablet/phone | PR-block (Gate 1) |
| F14 | TTTP North-Star | region open → cited SitRep + ranked priorities **< 10 s** on live primary sources | S06 perf |
| F15 | CAP/EDXL conformance | emitted CAP v1.2 + EDXL-RM/SitRep validate against JSON-Schema before send; **EDXL-RM round-trip** import↔export | PR-block (Gate 4) |
| F16 | **Compliance-proxy-enforced** (CORE) | no LLM/Vision call reaches a provider adapter without the gateway stamp; un-stamped calls are **rejected** (bypass-proof); the firewall/PII/policy/audit pipeline runs on every call and is **fail-closed on safety** (PII-egress / prompt-injection → `403`, regardless of budget) — ADR-017 | PR-block (`integration`/`contract`, Gate 4/7) |
| F17 | **Budget-HITL-above-threshold** (CORE) | an AI call whose reserved cost ≥ `escalation_threshold_usd` (or that exceeds a per-incident/region/org cap) is **hard-blocked for human approval**; within budget it proceeds (soft); safety stays fail-closed regardless of budget — ADR-018 | PR-block (`integration`/`contract`, Gate 7) |
| F18 | **Sustainability-report-schema-valid** (plugin, non-blocking) | `GET /.well-known/sustainability` validates against `schemas/sustainability-v05.schema.json` (single object or trend array) and is labeled modeled/estimated — ADR-020 | `contract` (Gate 4) — **non-blocking** (optional plugin) |
| F19 | **Per-step-cost-attribution-present** (CORE) | every LLM/vision/adapter `AUDIT_EVENT` carries `cost_tokens_in/out`, `cost_usd`, `model_tier` (deterministic tokens × tier rate); populated on each model call — ADR-022 | PR-block (`integration`/`contract`, Gate 4) |

Contract fixtures live in `tests/contract/`. F15 round-trip: import an EDXL-RM message → canonical → re-export,
validate both directions; XML serializer **XXE / entity-expansion disabled** (THREAT T2.4). The new AI-governance
fitness functions **F16/F17/F19 are CORE and run in the `integration`/`contract` lane (PR-blocking)**; **F18** is
the optional sustainability plugin, validated in the `contract` lane but **non-blocking**. Their config gate —
**AJV validation of `config/policies.yml` against `schemas/policies.schema.json`** — runs at boot and in CI (it
is the policy-as-code fail-fast that F16/F17 rely on).

### 3.4 BDD — one Gherkin `.feature` per FR, each carrying the §1.1 triad (Gate 7, golden thread §1.1) — PR-block

Each FR's `.feature` MUST contain the full **golden + error + edge triad** (§1.1) as **concrete,
implemented** scenarios — no pending steps, no `@skip`. The one-line below is the **golden** anchor; the
per-FR error/edge scenarios it must also carry are enumerated in **§1.2**. The PR-blocking lane runs the
golden scenario + the key error/edge scenario(s) for that FR (fast, mocked externals); the heavy/
combinatorial edge variants run nightly (§5). **Gate 7 fails the PR if any FR lacks all three** (a
golden-only `.feature` is treated as an incomplete gate — `docs/CI_CD.md` §2). Files in `tests/bdd/`:

| Feature file | FR | Golden anchor scenario (EARS-derived; error+edge per §1.2) |
|---|---|---|
| `region.feature` | FR-1 | WHEN a region is selected THEN all relevant layers load with freshness |
| `freshness.feature` | FR-2 | each layer shows source + last-updated; stale/unavailable marked |
| `exposure.feature` | FR-3 | hazard-geometry intersection computes infra/people exposure |
| `sitrep.feature` | FR-4 | cited SitRep + ranked priorities + escalation trend |
| `report-triage.feature` | FR-5 | consented report → UNVERIFIED + confidence components |
| `verify.feature` | FR-6 | VERIFIER approves → may emit DRAFT CAP; reject → misinformation |
| `routing.feature` | FR-7 | evac route avoids hazard + nearest shelters |
| `resource-task.feature` | FR-8 | register/locate/task resources; shelter capacity |
| `edxl-roundtrip.feature` | FR-9 | CAP for events; **full EDXL-RM mutual-aid round-trip**; EDXL-SitRep |
| `manifest.feature` | FR-10 | add a source as an adapter via manifest, zero core change |
| `threshold.feature` | FR-11 | gauge crosses category / hazard enters buffer → DRAFT alert |
| `prediction.feature` | FR-12 | labeled first-order projection with method+inputs+uncertainty |
| `decision.feature` | FR-13 | deterministic numbers + AI narration, human-approved |
| `compliance-proxy.feature` | FR-15 | every LLM/Vision call carries the gateway stamp (un-stamped → rejected); PII / prompt-injection **fail-closed** (`403`); a call over `escalation_threshold_usd`/cap is **hard-blocked for human approval** (F16/F17/F19) |
| `policies-schema.contract` | FR-15 (config) | **AJV schema-validation gate** — `config/policies.yml` validates against `schemas/policies.schema.json` (draft 2020-12) at boot/CI; an invalid/incomplete policy fails fast (the policy-as-code backstop F16/F17 depend on; F10/U5) |
| `sustainability.feature` | FR-14 (plugin, **non-blocking**) | `GET /.well-known/sustainability` validates against `schemas/sustainability-v05.schema.json`, labeled modeled/estimated; **error:** schema-invalid payload fails the contract; **edge:** single-object vs trend-array form; **disabled** → endpoint absent, core unaffected (F18) |
| `telecom.feature` | FR-16 (plugin, **mock-now**) | `TelecomPort` MOCK returns aggregate-only signal; **error:** live mode without key → boot fail-fast / stays mock (F10), non-aggregate exposure blocked (F12); **edge:** mock↔live parity (F11), zero-density cell, region with no coverage → N/A |

### 3.5 E2E — golden path (PRD §6) — smoke, runs on merge-to-main + nightly-real

One critical-user-journey Playwright suite (`tests/e2e/golden-path.spec.ts`) exercising **all four flagship
features**: COP open → cited SitRep → threshold DRAFT alert fires → insight flags N nursing homes in fire
buffer (1 without power) → consented SOS arrives → AI-triaged → human-verified → evac route around hazard +
resources tasked → CAP emitted. Seeded California flagship region; deterministic seed data (SPEC §3.4). The
**TTTP < 10 s** assertion (F14) runs against live primary sources in the S06 perf lane, not the PR lane.

### 3.6 Visual-regression — Playwright screenshots — PR-block

`toHaveScreenshot()` baselines for the three primary surfaces, captured after first Green and committed:
**COP** (MapLibre map + layer toggles + freshness chips), **SitRep panel** (summary + citations + ranked
priorities + trend), **logistics board** (resource list + status + shelter capacity). Run across desktop /
tablet / phone breakpoints; paired with **axe** DOM a11y checks (F13) so a visually-passing snapshot cannot
hide a broken semantic DOM (`browser-tdd` guardrail). Baseline updates (`--update-snapshots`) require explicit
human authorization (anti-tamper). Synthetic/anonymized fixtures only — never real PII in screenshots.

### 3.7 Property-based (fast-check) — PR-block on the critical properties

Per the author's agentic-AI engineering framework (PBT strategy) — declare invariants and let fast-check fuzz
many inputs + shrink to a minimal counterexample. **fast-check** is the TS-native generator (the project's PBT
tool; the GABBE pbt skill's Hypothesis/`@given` examples are the conceptual mirror). Each invariant traces to a
SPEC contract (no invented properties). See `PROPERTY_TEST_CHECKLIST.md` for the per-component form.

| Target | Family | Invariant |
|---|---|---|
| CAP / EDXL serializer ↔ parser | round-trip | `parse(serialize(x)) ≡ x`; emitted message always schema-valid (F15) |
| GeoJSON geometry codec | round-trip | `decode(encode(geom)) ≡ geom`; WGS84 bounds preserved |
| EDXL-RM `deploymentStatus` mapping | invariant-preservation | every input maps to a valid `RESOURCE_TASK.status` or is informational-only — never crashes |
| Envelope serializer | invariant | `provenance[]` is always non-empty; `freshness` ≤ every contributing observation (F1) |
| Confidence blend / priority score | invariant | output always clamped to `[0,1]`; monotone in each weighted input |
| Cursor pagination | invariant | stable sort `(updated_at desc, id)`; no row dropped or duplicated across pages |

`fast-check`'s example DB is committed so a found counterexample replays in CI (pin failures as regressions).

### 3.8 Metamorphic — AI SitRep stability (no exact oracle) — nightly (advisory→gating once stable)

The SitRep narrative has no single correct string, so assert **relations between related inputs** (per the
author's framework metamorphic-testing approach). Hand-designed, deterministic transforms preferred; equivalence
checked by embedding-cosine threshold (Tier-2) or a calibrated judge (Tier-3, `docs/EVAL_PLAN.md`):

| Metamorphic relation | Transform | Required output relation |
|---|---|---|
| Paraphrase invariance | reword an input news/report item preserving meaning | same ranked priorities, semantically-equivalent summary, **identical numbers** (numbers are deterministic, F3) |
| Noise / filler invariance | add whitespace / harmless boilerplate / casing changes | output unchanged |
| Order-permutation invariance | reorder the cited input facts | same ranking + same citations set |
| Monotonicity | add corroborating evidence to a report | confidence does not move the wrong direction |

Because numbers come from the engine, a paraphrase that changes a number is a hard F3 violation, not fuzzy.

### 3.9 Chaos / fault-injection — formalizes the 3 redundancy acceptance tests — nightly + S06

Deterministic in-test injection (mock/proxy seams, Toxiproxy for network faults) is the default; production
chaos is **out of scope for the automated agent** without explicit human sign-off. Every fault has a defined
expected recovery and a **positive** observable assertion (absence of an error is never proof of recovery).
This harness is the executable form of F5/F6/F7 (SPEC §9.4):

| Scenario | Fault injected | Expected recovery (escalation/hardstop) | Assertion | FF |
|---|---|---|---|---|
| **(a) Offline / air-gapped** | `AI_MODE=off` + all `SOURCE_*_MODE=mock` + `DEPLOY_MODE=local`, network blocked | serve cached/mock layers + deterministic insights; **zero egress** | COP + ranked priorities returned; network-call count = 0 (THREAT T14.2) | F5 |
| **(b) Primary-source-down** | each primary API → connection drop / 503 / timeout / 429 | secondary/global-equivalent → cache → mock → "unavailable + freshness" | correct `degraded.rung` + original freshness; never a 5xx dead-end (UW2); breaker opens per §8.1 | F6 |
| **(b′) Malformed upstream** | adapter returns invalid JSON / wrong schema / 200-with-error | ACL rejects, falls to cache/mock; no raw shape leaks above ACL | typed `SOURCE_DEGRADED`, not a thrown upstream error | F6/F9 |
| **(c) AI-disabled** | LLM tier all fail / schema-fail / `AI_MODE=off` | descend ladder → deterministic-only (`ai_mode:"deterministic-only"`) | ranked priorities + exposure still returned; no free-form text (UW3) | F7/F4 |
| Cache corruption | torn / truncated cache entry | hardstop on read → fall to mock, never relabel stale as fresh | freshness preserved (THREAT T14.3); no inconsistent state persists | F6 |
| Audit-write failure | audit sink unavailable | **fail-closed**: no commit without audit | the state change is rejected; no partial write survives (THREAT §9) | F8 |
| Circuit-breaker | 5 consecutive failures / 50% in 10-call window | breaker opens 60 s → half-open probe | live call skipped while open; success closes (§8.1) | F6 |

Honesty note (carried into every chaos report): the matrix **samples** failures and raises confidence; it does
**not** prove resilience to all fault combinations or timing races.

### 3.10 Mutation — Stryker — nightly

Run Stryker over `src/domain` + `src/application` nightly; gate on **mutation score ≥ 80% killed**. Mutation
score is the real test-quality metric (line coverage can be 99% with weak assertions). Surviving mutants on the
deterministic engine (ranking weights, threshold operators, clamp bounds, dead-band comparison) are
high-priority findings — a survived mutant on a weight or a comparison operator means the trust core is
under-tested. Nightly (not PR) because Stryker is slow; regressions reported on the scorecard.

---

## 4. Test data strategy

- **Unit:** in-memory builders / typed factories; no I/O.
- **Integration:** ephemeral Postgres (Testcontainers / `pg`-in-Docker), seeded idempotently (SPEC §3.4 seed).
- **Adapter / contract:** **recorded fixtures** colocated under `src/adapters/sources/<id>/__fixtures__/` — the same
  fixtures that power `SOURCE_*_MODE=mock` and the offline acceptance test (F5). No live network in any CI lane
  except the explicit S06 perf/e2e-real lane.
- **E2E / visual:** seeded California flagship region + one EU cached region; deterministic synthetic data only
  (no real PII, no real reporter contact — `browser-tdd` / Art. IV guardrail).
- **Eval:** the golden dataset (cited-SitRep + SOS-triage cases) — `docs/EVAL_PLAN.md`.

---

## 5. PR-lane vs nightly (summary; full YAML in `docs/CI_CD.md`)

| Lane | Runs | Contains |
|---|---|---|
| **PR-blocking** | every PR | static (ESLint/tsc/Prettier), unit ≥99% **line + branch (error/edge branches, §1.1/§2)**, integration (ephemeral PG) **incl. the key error cases** (4xx/409/422, authz/BOLA, degrade-and-label), contract F1–F4/F8–F13/F15 + **F16/F17/F19** (compliance-proxy stamp/bypass-rejection, budget hard-block, cost-attribution) + **AJV `config/policies.yml` validation**, **BDD-per-FR with the golden + key error + key edge scenario each (Gate 7 triad, §1.2)**, visual-regression + axe, the critical PBT properties, secrets+SCA+SAST+API-surface+micro-bench (CI_CD §). **A PR fails if any FR lacks golden+error+edge.** |
| **Merge-to-main** | on merge | the above + e2e golden-path smoke |
| **Nightly** | scheduled | mutation (Stryker), **full chaos/fault-injection matrix incl. the 3 redundancy acceptance tests as error-path e2e (F5–F7)**, **heavy/combinatorial edge sets (max-load, concurrency, large EDXL round-trip, hysteresis/cooldown sweeps, unicode/bidi)**, metamorphic suite, e2e-against-real-sources, load test, full eval suite (`EVAL_PLAN.md`) |
| **S06 / release** | perf + acceptance gate | TTTP <10 s (F14), the 3 redundancy acceptance tests (F5/F6/F7) signed off |

---

## 6. Honesty notes (carried into every report)

- PBT, metamorphic, chaos, and evals **sample** the input space and **raise confidence** — they do **not prove**
  correctness. "100%" only ever means "100% on the current set of N cases."
- Mutation score measures test strength, not behavioral correctness.
- Coverage ≥99% is necessary, not sufficient — the contract/redundancy fitness functions and the mutation gate
  are what actually defend the BEACON guarantees (deterministic truth, provenance, HITL, redundancy, no PII).

---

## 7. AS-BUILT reality note — added 2026-08-02 by the lens-7/lens-1 docs↔code audit

> **Everything above §7 is preserved verbatim as the S03 *target standard* it was authored as (2026-06-29,
> when no application code existed). This section is the machine-checked statement of what the shipped repo
> actually runs.** It is here because §3.4/§3.7/§3.10 name test artefacts, directories and tools by
> file path, and **a named verification that does not exist is the F-415 defect class** — the highest-value
> thing a docs audit can find, precisely because a claim *of verification* is the least-questioned kind of
> claim. None of the target above is withdrawn; it is a backlog, and it should be read as one.

### 7.1 Lanes that exist and execute

| §  | Lane | Status | Machine evidence |
|---|---|---|---|
| 3.1 | Unit / TDD (domain + application) | ✅ **real** | `vitest run` collects **304 files / 3742 tests** (globs in `vitest.config.ts:30-35`) |
| 3.2 | Integration (adapters/ACL/API/Drizzle) | ✅ **real** | colocated `*.test.ts`; `.github/workflows/ci.yml` `integration` job runs `npm run migrate` against a `postgres` service and asserts 19 tables |
| 3.3 | Contract / fitness F1–F19 | ✅ **real, but colocated** — **not** in a `tests/contract/` directory | e.g. `app/_lib/mappers.contract.test.ts`, `src/application/coordination/d5-contracts.test.ts`, `src/adapters/_shared/contract.ts`. **`tests/contract/` (§3.3 prose) does not exist** |
| 3.5 | E2E golden path | ✅ **real, at a different path** | the file is **`e2e/golden-path.spec.ts`**, not `tests/e2e/golden-path.spec.ts` as §3.5 states. 15 Playwright specs live under `e2e/` |
| 3.6 | Visual regression + axe | ✅ **real** | `e2e/visual.spec.ts`, `e2e/a11y.spec.ts`, `@axe-core/playwright` in `devDependencies` |
| 3.9 | Redundancy acceptance (F5/F6/F7) | ✅ **real, in-repo** | `tests/redundancy/**` — **but as Vitest suites, not the Toxiproxy/network-fault harness §3.9 describes** |

### 7.2 Lanes that DO NOT EXIST — named in this document, absent from the repo

| §  | Claimed artefact | Verified absent by |
|---|---|---|
| 1 (Toolchain), 3.4 | **BDD / Gherkin per FR** — 17 named `.feature` files in `tests/bdd/`, and "**Gate 7 fails the PR if any FR lacks all three**" | `find . -name '*.feature' -not -path './node_modules/*'` → **zero results**. No `tests/bdd/` directory. No `vitest-cucumber` / `@cucumber/cucumber` in `package.json`. No `test:bdd` script. **No `bdd` job in `.github/workflows/ci.yml`** (its jobs are `static`, `unit`, `build`, `integration`, `browser`, `security`). **Gate 7 as described is not enforced by anything.** |
| 1, 3.7 | **Property-based testing (fast-check)**, incl. "`fast-check`'s example DB is committed" | `fast-check` is in neither `dependencies` nor `devDependencies`; **no PBT spec exists** and there is no committed example DB. (`PROPERTY_TEST_CHECKLIST.md`, referenced in §3.7, *does* exist — as a GABBE template at `agents/templates/coding/PROPERTY_TEST_CHECKLIST.md`, not as a filled-in artefact) |
| 1, 3.10, §2 table row | **Mutation testing (Stryker), gate ≥80% killed** | `stryker` is not a dependency; `nightly.yml` has one job (`full-suite`) running `npm run test:coverage` + `npm run build` + an audit — **no mutation step** |
| 1, 3.2, 4 | **Testcontainers** | not a dependency; CI uses a plain `services: postgres` container instead (equivalent in effect, different tool) |
| 1, 3.9 | **Toxiproxy network-fault injection** | not a dependency; no network-level fault harness exists |
| 3.8 | **Metamorphic AI suite** (nightly) | no metamorphic spec files; `nightly.yml` runs no such step |
| 3.3 | `tests/contract/` as the home of contract fixtures | directory does not exist (the tests do — see §7.1) |

### 7.3 What this means for anyone quoting this document

- **Do not cite §3.4 as evidence that every FR has a golden+error+edge triad.** Nothing computes that, so
  the triad policy in §1.1/§1.2 is an authoring convention, not an enforced gate. The FR→test golden thread
  is real but is carried by colocated Vitest suites and the `e2e/` Playwright specs, not by `.feature` files.
- **Do not cite a mutation score or a PBT property.** Neither tool is installed; there is no number to quote.
- The **branch-coverage** bar in §2 *is* real and enforced (`vitest.config.ts:44-52`, run by the `unit` CI
  job) — the strongest true statement in this document. Two honest riders: the floors are **two-tier**, not a
  flat ≥99% (`src/domain/**` and `src/application/**` carry 99/99/99/99; `src/main/**` carries 97/79/96/97
  and `src/adapters/**` 90/83/93/90 — measured-minus-margin, ratchet-upward), and the coverage `include` list
  **omits `app/**` entirely**, so the 71 browser-layer source files are unmeasured (open finding **F-365** —
  and that is exactly where F-360/F-361/F-362 lived).
- **The unit gate is currently RED**: 3 tests in `app/_lib/hooks.mutations.e2e.test.tsx` fail (see
  `docs/SPEC.md` §13.13). Re-run before quoting any figure here.

*None of the absent lanes can be added without new dependencies, which the current scope freeze forbids.
The honest options are (a) leave them as a documented backlog, which this note makes explicit, or (b) delete
the aspirational sections. (a) is chosen: deleting them would hide that the project once intended them.*

---

*BEACON — IEEE Response Quest 2026, Phase 3 · GABBE SDLC S03 testing standard · prod-tech-lead · 2026-06-29.*
*§7 as-built reality note added by the docs↔code parity + honesty audit, 2026-08-02; every row machine-checked.*
*Binding references: docs/SPEC.md §9 · C4 F1–F19 · PRD FR-1..13 / §6 · CONSTITUTION Art. I · docs/EVAL_PLAN.md · docs/CI_CD.md · ADR-019.*
