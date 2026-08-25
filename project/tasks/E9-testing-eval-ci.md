# Epic E9 — Cross-cutting Test / Eval harness + suites (day-one matrix)

> Owner persona: **eng-qa** (CI wiring **ops-devops**) · Waves W1–W5 · IDs `E9·T-395…T-444(+a–e)`
> Per-feature TDD tests live in E1–E8; E9 owns the **shared harness + cross-feature suites**. Full matrix
> mandatory (ADR-019): unit/integration/contract/BDD/e2e/visual/property/metamorphic/mutation/chaos +
> evals. Coverage ≥99% line+branch. Every FR needs a **golden+error+edge triad**. The **3 redundancy
> acceptance tests** (offline/source-down/AI-off) are first-class. F1–F19 each get an executable check.

| ID | Task | Persona | Deps | Wave | Tags | Trace | Acceptance |
|---|---|---|---|---|---|---|---|
| T-395 | Configure Vitest projects (domain/application/adapters/app split) | eng-qa | — | W1 | [PARALLEL] {testing-strategy} | ADR-019/§TEST_PLAN §2 | 4 named projects; `npm test` green on empty scaffold |
| T-396 | Set coverage-gate ≥99% line+branch on domain+application | eng-qa | T-395 | W1 | {testing-strategy} | §TEST_PLAN §2 | thresholds fail run below 99% line AND branch |
| T-397 | Set adapter coverage floor (~70–80% critical paths) | eng-qa | T-395 | W1 | [PARALLEL] {testing-strategy} | §TEST_PLAN §2 | adapter project enforces lower threshold, excludes raw-network |
| T-398 | Stand up ephemeral-Postgres test DB harness (pg-in-Docker) | eng-qa | — | W1 | [PARALLEL] {testing-strategy} | §TEST_PLAN §3.2/§4 | boots PG, runs migrate, tears down |
| T-399 | Build typed factories/builders for domain entities | eng-qa | T-395 | W1 | [PARALLEL] {testing-strategy} | §TEST_PLAN §4 | produces valid Incident/HazardGeometry/Report fixtures |
| T-400 | Build recorded-fixture vault loader (`MOCK_FIXTURES_DIR`) | eng-qa | T-399 | W1 | [PARALLEL] {testing-strategy} | §TEST_PLAN §4 | resolves `./fixtures/<source>/`, shared by mock-mode + offline test |
| T-401a | **Named real-scenario demo fixtures** — a concrete CA wildfire scenario (named incident + exposed infra + gauge, EMSR758-equivalent story) alongside RO EMSR758, so the DEFAULT region tells a compelling story | eng-qa | T-400 | W1 | {testing-strategy} | S05_READINESS/rubric-5/D-35 | CA + RO scenario fixtures load; golden-path e2e uses them |
| T-401 | Seed deterministic California + Romania cached region data | eng-qa | T-398 | W1 | {testing-strategy} | §TEST_PLAN §4 | idempotent seed loads flagship regions |
| T-402 | Set up BDD step-definition harness (vitest-cucumber) | eng-qa | T-395 | W1 | {testing-strategy} | §TEST_PLAN §3.4 | Gherkin runner discovers `tests/bdd/*.feature`, shared World |
| T-403 | Set up Playwright config (desktop/tablet/phone projects) | eng-qa | — | W1 | [PARALLEL] {browser-tdd} | §TEST_PLAN §3.5/§3.6 | runs across 3 breakpoints on seeded fixtures |
| T-404 | Write `check:scenario-triad` gate script | eng-qa | T-402 | W2 | {testing-strategy} | §TEST_PLAN §1.1/CI §2 | fails if any FR .feature lacks golden+error+edge or has @skip |
| T-405 | `region.feature` BDD triad (FR-1) | eng-qa | T-402,E1-FR1 | W2 | [PARALLEL] {testing-strategy} | FR-1/§TEST_PLAN §1.2 | golden+error+edge green, no pending |
| T-406 | `freshness.feature` BDD triad (FR-2) | eng-qa | T-402,E1-FR2 | W2 | [PARALLEL] {testing-strategy} | FR-2/F1 | stale-labeled + clock-skew edge green |
| T-407 | `exposure.feature` BDD triad (FR-3) | eng-qa | T-402,E2-FR3 | W2 | [PARALLEL] {testing-strategy} | FR-3/F3 | on-boundary + empty-hazard edge green |
| T-408 | `sitrep.feature` BDD triad (FR-4) | eng-qa | T-402,E6-FR4 | W3 | [PARALLEL] {testing-strategy} | FR-4/F2,F7 | AI-down→deterministic-only error green |
| T-409 | `report-triage.feature` BDD triad (FR-5) | eng-qa | T-402,E5-FR5 | W3 | [PARALLEL] {testing-strategy} | FR-5/F3,F12 | duplicate-SOS + PII-screen green |
| T-410 | `verify.feature` BDD triad (FR-6) | eng-qa | T-402,E5-FR6 | W3 | [PARALLEL] {testing-strategy} | FR-6/F8 | reject→no-emit + CAP-from-UNVERIFIED→409 green |
| T-411 | `routing.feature` BDD triad (FR-7) | eng-qa | T-402,E3-FR7 | W3 | [PARALLEL] {testing-strategy} | FR-7/F6 | engine-down→heuristic-labeled green |
| T-412 | `resource-task.feature` BDD triad (FR-8) | eng-qa | T-402,E3-FR8 | W3 | [PARALLEL] {testing-strategy} | FR-8/F8 | illegal-transition→409 + BOLA→403 green |
| T-413 | `edxl-roundtrip.feature` BDD triad (FR-9) | eng-qa | T-402,E7-FR9 | W3 | [PARALLEL] {testing-strategy} | FR-9/F15 | full RM round-trip + XXE-reject green |
| T-414 | `manifest.feature` BDD triad (FR-10) | eng-qa | T-402,E4-FR10 | W3 | [PARALLEL] {testing-strategy} | FR-10/F10 | add-source-zero-core + missing-key fail-fast green |
| T-415 | `threshold.feature` BDD triad (FR-11) | eng-qa | T-402,E2-FR11 | W3 | [PARALLEL] {testing-strategy} | FR-11/F8 | hysteresis/cooldown non-fire edge green |
| T-416 | `prediction.feature` BDD triad (FR-12) | eng-qa | T-402,E2-FR12 | W3 | [PARALLEL] {testing-strategy} | FR-12 | missing-wind→labeled-caveat error green |
| T-417 | `decision.feature` BDD triad (FR-13) | eng-qa | T-402,E6-FR13 | W3 | [PARALLEL] {testing-strategy} | FR-13/F3,F7 | narration-down→deterministic-decision green |
| T-418 | `compliance-proxy.feature` BDD triad (FR-15) | eng-qa | T-402,E6-FR15 | W3 | [PARALLEL] {testing-strategy} | FR-15/F16,F17 | un-stamped→reject + budget→hard-block green |
| T-419 | `sustainability.feature` BDD triad (FR-14, non-blocking) | eng-qa | T-402,E8-FR14 | W3 | [PARALLEL] {testing-strategy} | FR-14/F18 | disabled→endpoint-absent + schema-invalid→fail green |
| T-420 | `telecom.feature` BDD triad (FR-16, mock-now) | eng-qa | T-402,E8-FR16 | W3 | [PARALLEL] {testing-strategy} | FR-16/F11,F12 | mock-parity + non-aggregate→blocked green |
| T-421 | E2E golden-path suite (4 flagship features) — **parametrized by region (us-ca + ro)** | eng-qa | T-403,T-401 | W3 | {browser-tdd} | §TEST_PLAN §3.5/D-35 | COP→SitRep→alert→verify→route→CAP green **in both regions** |
| T-422 | E2E explicit ERROR-path suite (4xx/409/degrade) — both regions | eng-qa | T-421 | W4 | {browser-tdd} | §TEST_PLAN §1.1(b) | error journeys assert typed recovery, never 5xx dead-end (us-ca + ro) |
| T-423 | E2E EDGE-case suite (concurrency/empty/boundary) — both regions | eng-qa | T-421 | W4 | {browser-tdd} | §TEST_PLAN §1.1(c) | edge journeys green on degenerate inputs (us-ca + ro) |
| T-423a | **Cross-region complete-UX suite (D-35)**: full user-experience e2e across **us-ca AND ro** — locale (ro narration + original-language citations), tz render (LA vs Bucharest), units (imperial display vs metric; engine always SI), NOT_COVERED labeling, EMSR758 cached replay, PWA offline reload, act-menu + command-palette journeys, per-persona flows (EM/responder/public) | eng-qa | T-421,E8:T-350a,E8:T-389a | W4 | {browser-tdd}{accessibility} | SPEC §3.5/UIUX/F13/F14/D-35 | both-region UX suite green incl. axe + visual snapshots per region × theme |
| T-424a | **Frontend perf budget gate**: Lighthouse CI (perf/a11y/best-practices), bundle-size budget, deck.gl map-FPS floor — regressions fail PR (category-4 lever) | eng-qa | T-403 | W4 | [PARALLEL] {browser-tdd} | S05_READINESS/F14/D-35 | Lighthouse ≥ target; bundle ≤ budget; map FPS ≥ floor |
| T-424 | Visual-regression baselines (COP/SitRep/logistics) + axe | eng-qa | T-403 | W3 | {browser-tdd} | §TEST_PLAN §3.6/F13 | screenshot + axe green; baseline updates human-gated |
| T-425 | Contract harness: OpenAPI↔routes conformance | eng-qa | T-395 | W2 | {testing-strategy} | §TEST_PLAN §3.2 | handlers match openapi.yaml shapes/status |
| T-426 | F1 provenance contract test | eng-qa | T-395 | W2 | [PARALLEL] {testing-strategy} | F1/§TEST_PLAN §3.3 | envelope with empty provenance/freshness fails |
| T-427 | F2 citation-coverage contract test | eng-qa | T-395 | W2 | [PARALLEL] {testing-strategy} | F2 | any uncited generated SitRep field fails |
| T-428 | F3 no-LLM-numbers contract test | eng-qa | T-395 | W2 | [PARALLEL] {testing-strategy} | F3 | numeric token in narrative not matching engine fails |
| T-429 | F8 HITL-invariant contract test | eng-qa | T-395 | W2 | [PARALLEL] {testing-strategy} | F8 | CAP/EDXL from UNVERIFIED fails; audit-less change fails |
| T-430 | F15 CAP/EDXL round-trip + AJV contract test | eng-qa | T-395 | W2 | [PARALLEL] {testing-strategy} | F15 | emit schema-valid; RM import↔export lossless; XXE rejected |
| T-430a | **Classical-security test suite (D-35)**: OWASP ZAP baseline DAST (PR-blocking, no High) + security-headers assertion (CSP/HSTS/frame-ancestors/nosniff) + XSS/CSRF/authz(BOLA)/SSRF/rate-limit e2e + `dangerouslySetInnerHTML` lint gate — covers SECURITY_BASELINE §§1-3 end-to-end | eng-qa | T-425 | W2 | [PARALLEL] {testing-strategy} | SECURITY_BASELINE/OWASP/D-35 | ZAP baseline clean; headers present; each classical attack e2e blocked |
| T-431 | F18 sustainability-schema contract test (non-blocking) | eng-qa | T-395 | W2 | [PARALLEL] {testing-strategy} | F18 | validates; runs continue-on-error |
| T-432 | Property suite: CAP/EDXL + GeoJSON round-trip (fast-check) | eng-qa | T-395 | W2 | [PARALLEL] {pbt-strategy} | §TEST_PLAN §3.7 | parse(serialize(x))≡x; counterexample DB committed |
| T-433 | Property suite: engine invariants (clamp/monotone/envelope) | eng-qa | T-395 | W2 | [PARALLEL] {pbt-strategy} | §TEST_PLAN §3.7/F1 | confidence∈[0,1], monotone, non-empty provenance hold |
| T-434 | Property suite: cursor pagination stability | eng-qa | T-395 | W2 | [PARALLEL] {pbt-strategy} | §TEST_PLAN §3.7 | no row dropped/duplicated under fuzz |
| T-435 | Metamorphic suite for AI SitRep narration | eng-qa | E6-FR4 | W5 | {metamorphic-testing} | §TEST_PLAN §3.8 | paraphrase/order/noise invariance + monotonicity hold |
| T-436 | Stryker mutation config + ≥80% gate (domain+application) | eng-qa | T-396 | W5 | {testing-strategy} | §TEST_PLAN §3.10 | nightly fails below 80% killed |
| T-437 | Chaos/fault-injection harness (Toxiproxy + mock seams) | eng-qa | T-400,E4 | W4 | {chaos-fault-injection} | §TEST_PLAN §3.9 | injects drop/latency/503; positive recovery assertions |
| T-438 | Chaos cases: malformed-upstream, cache-corruption, breaker, audit-fail | eng-qa | T-437 | W5 | [PARALLEL] {chaos-fault-injection} | §TEST_PLAN §3.9/F6,F8 | each fault asserts typed degrade; freshness never relabeled fresh |
| T-439 | **REDUNDANCY ACCEPTANCE 1 — offline/air-gapped** (F5) | eng-qa | T-437,E4,E6 | W5 | {chaos-fault-injection} | F5/§TEST_PLAN §3.9(a) | COP+priorities returned; network-call count = 0 |
| T-440 | **REDUNDANCY ACCEPTANCE 2 — primary-source-down** (F6) | eng-qa | T-437,E4 | W5 | {chaos-fault-injection} | F6/§TEST_PLAN §3.9(b) | descends secondary→cache→mock; correct degraded.rung, no 5xx |
| T-441 | **REDUNDANCY ACCEPTANCE 3 — AI-disabled** (F7) | eng-qa | T-437,E6 | W5 | {chaos-fault-injection} | F7/§TEST_PLAN §3.9(c) | ai_mode:"deterministic-only", ranked priorities, no free-form text |
| T-442 | Evals harness: golden-dataset builder + baseline loader | eng-qa | T-400 | W2 | {eval-driven-development} | §EVAL_PLAN §2 | loads golden.yaml, edge-tagged, read-only baseline in gating |
| T-443 | Eval Tier-1 deterministic gates (citation/no-numbers/schema/PII) | eng-qa | T-442 | W3 | [PARALLEL] {eval-driven-development} | §EVAL_PLAN §3/§6 | blocks on <100% citation, any number/PII leak |
| T-444 | Eval Tier-2/3 + RAG + trajectory + F1–F19 index | eng-qa | T-442,T-443 | W5 | {llm-as-judge}{eval-driven-development} | §EVAL_PLAN §3/§4/§8 | pass^5 scorecard, judge-debias checklist, FF index maps F1–F19 |
| T-444a | Wire unit+coverage+PBT into PR `unit` job | ops-devops | T-396,T-432 | W2 | {testing-strategy} | CI §3 | runs test --coverage + fast-check-ci, PR-blocking |
| T-444b | Wire integration+contract+F15 into PR `integration` job | ops-devops | T-425,T-430 | W2 | {testing-strategy} | CI §3 Gate4 | green with ephemeral PG, PR-blocking |
| T-444c | Wire BDD + triad-check into PR `bdd` job | ops-devops | T-404 | W3 | {testing-strategy} | CI §3 Gate7 | fails PR when any FR lacks a triad |
| T-444d | Wire visual+axe and Tier-1 eval into PR jobs | ops-devops | T-424,T-443 | W3 | {testing-strategy} | CI §3 | visual + eval-tier1 PR-blocking |
| T-444e | Wire mutation+chaos+redundancy+metamorphic+eval-full into `nightly.yml` | ops-devops | T-436,T-439,T-440,T-441 | W5 | {chaos-fault-injection} | CI §4 | nightly runs heavy suites, publishes scorecard, non-blocking |

**Day-one PR-BLOCKING (W1–W3):** all BDD triads (T-405…T-420) + triad-gate (T-404), contract F1/F2/F3/F8/F15 (T-426…T-430), critical PBT (T-432…T-434), visual+axe (T-424), eval Tier-1 (T-443).
**Nightly / non-blocking (W5):** mutation (T-436), full chaos + the **3 redundancy acceptance tests** (T-437…T-441), metamorphic (T-435), eval-full (T-444).
**Cross-epic:** the 3 redundancy tests depend on adapters (E4) and/or the AI ladder (E6) → W5. Coverage-gate (T-396) is live from the first Green; branch coverage read strictly (error/edge branches must be hit by an executed scenario). TTTP<10s (F14) is a perf/release gate (owned with E8 T-394), not a PR gate. Supply-chain SBOM/SLSA/cosign is E0-owned, referenced not duplicated.
