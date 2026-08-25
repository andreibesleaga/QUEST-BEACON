# BEACON — S09 Release Gate (staging/release) — Human GO/NO-GO

*IEEE Response Quest 2026 · Phase 3 · SDLC phase **S09 (Release/Staging)** · prepared 2026-07-08.*
*Personas: prod-tech-lead (gate prep) · orch-judge (EARS) · ops-security · eng-qa · prod-ethicist.*
**This is a human GO/NO-GO gate. No autonomous continuation past this point; the agent cannot self-approve.**
*Supersedes `S08_REVIEW_PACKAGE.md` (see its §9 addendum for the honest correction of its over-claims).*

> **⚠️ ERA-STAMPED (2026-07-17):** Figures as of 2026-07-07/08 (the **8-adapter era**). Current state: see
> `docs/audit/FINAL_LIVE_AUDIT.md` §6 + `docs/FINAL_LIVE_TEST_AND_DEMO.md` (Phase-D + E11: 27 adapters
> registered / 24 consumed — 19 COP data sources + 5 Live-Views camera sources; `usgs-water`/`itu`/
> `camara-gsma` registered but not consumed by design — 1832 tests, Playwright 53/0). The gates below were
> re-verified green post-Phase-D at a larger scale (`tsc 0 · eslint 0 · vitest 206 files/1832 pass/2
> env-gated skip · depcruise 499/0 · Playwright 53/0/3skip · axe 0 serious/critical · TTTP ~0.83s · npm
> audit 0 high/critical`) — this document's body is retained verbatim below as the
> historical S09 record. The project also went live on real infra (Phase-B) and was 6-lens audited +
> honesty-corrected (Phase-C) since this was written.

> **⚠️ SECOND STAMP (2026-08-02, lens-7 machine recount).** The "current state" figures quoted in the
> stamp above are themselves now stale. Machine truth on 2026-08-02: **30 adapters registered / 28 consumed**
> (`config/adapters.json → adapters.length` = the `ADAPTER_FACTORIES` entry count, `src/main/adapter-registry.ts:56-94`;
> consumed = the union of `enabled_adapters` over the five zones in `config/regions.json`). **Exactly two are
> not consumed — `itu` and `camara-gsma`; `usgs-water` IS consumed now** (it is in `us-ca`'s allowlist).
> Unit gate: **304 files / 3742 tests, 3 FAILING** (`app/_lib/hooks.mutations.e2e.test.tsx` — `docs/SPEC.md`
> §13.13). depcruise: **730 modules / 0 violations** (`src app` scope) · **570 modules** (`src` scope).
> **An era stamp decays like anything else — re-derive, do not quote.**


---

## 1. Headline

BEACON is a **complete, building, and now BROWSER-VERIFIED** product: a channel-agnostic hexagonal core
(domain + 6 deterministic/AI engines + AI-compliance gateway + CAP/EDXL interop) behind an HTTP API, a CLI,
messaging channels, and a Next.js **Common Operating Picture** that a real user can drive end-to-end,
offline, for two regions (California wildfire, Romania flood).

Since S08, on the user's directive *"missing from S05 → go back before approving S09,"* the project:
1. **Wired all 6 core engines into the live path** — they were built + unit-tested but **orphaned**; the COP
   had been serving hand-authored seed *outputs*. They now **compute** from raw seed *inputs* (proven by
   input→output tests, not literals) and the AI-compliance proxy is the in-path, fail-closed chokepoint.
2. **Ran the browser gates** — which caught **three defects invisible to every headless gate**: a
   client-crashing envelope↔type mismatch (blank page), a **forgeable audit actor** (a security bug), and a
   WCAG `<dl>` violation. All three are fixed and regression-guarded.

## 2. Gate status — all green (re-verified by the main loop, 2026-07-08)

| Gate | Command | Result |
|---|---|---|
| 1 · Lint | `eslint .` | **0** (incl. `.cjs`) |
| 2 · Types | `tsc --noEmit` | **0** |
| 3 · Coverage (domain+application ≥99) | `vitest run --coverage` | **100 stmts / 99.22 branch / 100 funcs / 100 lines** |
| Unit/component/integration | `vitest run` | **990 / 990 pass · 142 files** |
| 4 · Integration (DB migrate) | `drizzle-kit migrate` on Postgres 16 | **19 tables, applies clean** (proven) |
| 5 · Security (deps) | `npm audit --audit-level=high` | **0 high/critical** (6 moderate, dev/build-only, documented) |
| 6 · Complexity | eslint `complexity:10` | enforced, 0 violations |
| 7 · Architecture | `depcruise src` + `madge --circular` | **293 modules · 0 violations · 0 cycles** (both guards now real) |
| Production build | `next build` | **✅ 6 pages** |
| **8 · Browser e2e (golden path US+RO ×4 breakpoints)** | `playwright test` | **PASS** |
| **F13 · axe WCAG 2.2 AA** | `@axe-core/playwright` | **PASS — 0 serious/critical** |
| **F14 · TTTP < 10s** | Playwright, prod build | **PASS — ~0.63–0.68 s/region** |
| Visual regression | `toHaveScreenshot` | **baselines created** (protection starts next run) |

Evidence: `docs/audit/S06_BROWSER_GATES.md` (browser), `docs/audit/S06_INTEGRATION_GATE.md` (docker),
`docs/security/SECURITY_REVIEW.md` (+ 2026-07-08 addendum).

## 3. Requirements → evidence (corrected; now reachable + tested end-to-end)

Every row is verified by import-graph reachability from an HTTP route **and** a test that proves the output is
computed, not seeded. (This corrects `S08_REVIEW_PACKAGE.md` §3, which cited orphaned use-cases as evidence.)

| FR | Now live via | Proof |
|---|---|---|
| FR-1 region → layers | `GET /regions/:id/map` + `useMapData` | computed geometry renders; golden-path e2e |
| FR-2 provenance/freshness | envelope `provenance[]`+`freshness` (all responses) | F1 contract test + `mappers.contract.test.ts` |
| FR-3 exposure | `computeExposures` in `derive-cop` | move node out of hazard → exposure 2→1 |
| FR-4 priorities + trend | `rankPriorities` + `classifyTrend` → SitRep | OFFLINE node ranks top; rising reading → ESCALATING |
| FR-5 SOS → UNVERIFIED | `POST /reports` + SosForm (consent gate) | e2e submit → 201 UNVERIFIED + `purgeAfter` |
| FR-6 verify → CAP | `PATCH /reports/:id` + VerifierQueue | e2e verify as VERIFIER; **actor server-derived** |
| FR-7 evac routes + shelters | `planEvacRoute`/`computeSuggestedStart` via `POST /routes` | bigger hazard → longer detour → earlier start |
| FR-8 resources/tasks | logistics adapter + routes | integration tests |
| FR-9 CAP/EDXL | AlertSink + `/alerts/:id/approve`, `/edxl/*` | schema-valid at emit |
| FR-11 threshold DRAFT alerts | `evaluateRule`/`buildDraftAlert` → `GET /alerts` | below-threshold → none; cross → DRAFT |
| FR-12 predictions (labeled) | `projectFireCone`/`projectFloodInundation` | raise wind → cone lengthens |
| FR-13 decision support | DecisionSupport figures = engine priorities (Art. XII) | e2e decide leg |
| FR-14 sustainability | `/.well-known/sustainability` | schema-valid |
| FR-15 AI compliance proxy | `build-ai.ts` in-path chokepoint | AI-on→gateway; off→deterministic; proxy-off→fail-closed 503 |

**Constitutional invariants, browser-verified:** deterministic→AI→human (LLM never emits a number, Art. XII);
HITL before public action (PUBLIC→403 on approve; DRAFT→ACTUAL needs authenticated VERIFIER+, Art. XIII);
precise geometry RESPONDER-gated on map + API (Art. XIV); redundancy/offline (the whole demo runs air-gapped).

## 4. What the browser gates caught (the case for the gate)

Every defect this phase was **invisible to `tsc`/`eslint`/`vitest 990`/`next build`** and appeared only when the
app was *driven*:
1. **Client crash → blank page** — `GET /regions/:id/incidents` returns `{regionId, incidents[]}`, the FE typed
   it an array; SitRep shape likewise diverged. Component tests used hand-authored fixtures never compared to
   real handler output. **Fix:** corrected the seam; **added a contract test that pipes real `handleHttp` output
   through the FE mappers** so any envelope↔type drift now fails `vitest`.
2. **🔒 Forgeable audit actor** — `PATCH /reports/:id` took `actorId` from the request body, so the hash-chained
   `TriageAuditRecord` could be attributed to anyone. **Fix:** actor is server-derived; a body `actorId` → 400.
   (Missed by the unit tests and the S07 review because nothing exercised the path end-to-end.)
3. **WCAG serious violation** — `<dl>` groups had a stray `<span>` sibling. **Fix:** citations moved into `<dd>`.

## 5. Security (S07) — holds

`docs/security/SECURITY_REVIEW.md` + 2026-07-08 addendum: 0 high/critical; OWASP Web + LLM Top-10 mapped;
fail-closed JWT/RBAC/compliance-gateway; the new `/reports`,`/alerts`,`/regions/:id/map` surfaces reviewed
(read-only, RBAC-gated, precise geometry RESPONDER-only); the actor-forgery bug found this phase is closed.

## 6. Honest limitations (graded rubric item — stated plainly)

- **Source adapters do not feed the live composition.** The 8 verified-schema adapters exist and are tested,
  but the running app computes over **in-memory seed inputs** (MOCK-mode provenance), not live/cached feeds.
  The redundancy ladder is unit/acceptance-tested, not exercised end-to-end against a real source.
- **Drizzle persistence is unused at runtime.** Schema + migration exist and the migration is proven against
  Postgres; the running app is in-memory. Postgres is a config path, not the demo default.
- **No CI/CD workflows.** `.github/` does not exist. By explicit user decision, CI/CD is **deferred**; the
  phased plan is `docs/CI_CD_PLAN.md` (and it documents that `docs/CI_CD.md` over-claimed a "day-one" pipeline).
- **`docker compose up` full-stack was never executed end-to-end** — CI-ready and each piece proven, but the
  combined run is env/concurrency-blocked (`S06_INTEGRATION_GATE.md`).
- **Per-user identity is a role-derived stub** (`role:VERIFIER`); full JWT `sub` claims are a follow-up.
- **FR-16 CAMARA telecom adapter absent** (documented as a v1.1 plugin).
- **Live messaging / IPAWS transports are MOCK** by design.
- **Visual regression protection begins on the *next* run** — this run created baselines.

**Verified NOT limitations:** the app builds, renders, and is drivable end-to-end offline for both regions;
all 6 engines compute in the live path; provenance/citations, deterministic→AI→human, HITL, RBAC, PII gating,
and offline redundancy are enforced and tested at unit, integration, **and browser** level.

## 7. Double-verification

1. **orch-judge:** requirements traced to reachable code + computed-output tests (§3). ✅
2. **prod-tech-lead:** boundaries clean, complexity <10, 990 tests, builds, browser golden path green. ✅
3. **ops-security:** fail-closed auth/RBAC/proxy; the forgeable-actor bug found + fixed this phase. ✅
4. **eng-qa:** browser gates real (no stubs/tautologies); a FAIL was reported as FAIL until genuinely fixed. ✅
5. **prod-ethicist:** deterministic→AI→human + HITL + responsible-data enforced at the type level;
   limitations disclosed without softening. ✅

## 8. GO / NO-GO — the ask

The product is **build-complete, gate-green (headless AND browser), security-reviewed, and demonstrably
drivable end-to-end offline** for both flagship regions. The remaining items in §6 are disclosed, scoped, and
mostly by explicit decision (CI/CD) or design (MOCK transports, in-memory demo).

**Requesting human GO/NO-GO for S09 (staging/release):**
- **GO** → proceed to release prep: approve the **CI/CD plan** (`docs/CI_CD_PLAN.md`) so I may author
  `.github/workflows/*` (a governance-gated action), then tag/stage. First git commit of the branch also
  requires your go-ahead (nothing is committed yet).
- **GO with conditions** → name which §6 items must be closed first (e.g. wire ≥1 live source adapter; run the
  full `docker compose up`; land real per-user JWT identity).
- **Changes requested** → I loop back with the specifics.

*No commits have been made — HEAD is `00cecec`; the entire diff is staged for your review (no-auto-commit).
AGENTS.md + CONSTITUTION.md remain frozen and untouched.*
