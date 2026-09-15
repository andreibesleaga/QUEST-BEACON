# BEACON — Engineering Principles & Definition of Done (standing, all phases)

> **Binding companion** to the FROZEN `agents/AGENTS.md` + `agents/CONSTITUTION.md`. This charter records the
> quality bar the user set for **every phase from now on** (S04 → S05 implementation → release → beyond). It
> does not amend the Constitution; it operationalizes it. Every task, PR, doc, and artifact is "done" only
> when it satisfies this checklist. Read at the start of each phase (referenced from
> `agents/memory/PROJECT_STATE.md`). Adopted 2026-07-01 (D-28).

*Practice what it preaches: this file is short, scannable, and single-sourced. Each rule says **how it is
enforced** so it is testable, not aspirational.*

---

## 1. Correct & complete
- Golden thread unbroken: **requirement → EARS → component/ADR → schema/contract → test → task → code**. No
  requirement without a test (Constitution Art. I); no orphan code. *Enforced:* traceability audit + Gate 7.
- Covers **all** requirements + all 5 IEEE rubric categories + the 4 flagship features — nothing silently
  dropped; de-scopes are recorded openly. *Enforced:* `RUBRIC_DEFENSIBILITY.md`, per-FR BDD triads.

## 2. Simplest thing that fully works (+ extensible)
- Prefer the **simplest implementation that covers the need**; lean core, pluggable edges. If a task has an
  "and", split it; if an abstraction earns its keep only post-v1, defer it (flagged, not built). *Enforced:*
  simplicity audit, 15-min task rule, complexity gate (cyclomatic < 10).
- **Extensible by construction:** new source/region/provider/hazard = config or one adapter (FR-10), never a
  core rewrite. Ports isolate churn. *Enforced:* adapter registry + manifest contract test.
- **Don't reinvent:** use a mature, free, maintained OSS lib/API for every non-trivial capability (map, geo,
  ORM, LLM routing, schema validation, SSE, CAP/EDXL, SBOM, tests). Hand-roll only what no lib provides.
  *Enforced:* library-first review + dependency-security scan.

## 3. Redundant, available, offline, free
- **Total redundancy (Art. XVI):** every layer has a documented fallback ladder and labels degradation —
  never a dead-end. Works **fully offline / air-gapped out-of-the-box** (`docker compose up`, cached/mock,
  local Ollama, ~$0, zero required keys) AND in the cloud, same artifacts. *Enforced:* 3 redundancy
  acceptance tests (offline / source-down / AI-off).
- **Free & open only:** all data + deps are free, open-source, license-compatible (Apache-2.0 product; NC /
  NC-SA never bundled). *Enforced:* `DATA_SOURCE_VERIFICATION.md`, `NOTICE`, license check.

## 4. Secure & clean/safe AI
- **AI is clean & safe:** LLM never computes numbers (F3); every SitRep field cited (F2); HITL before any
  public action (F8); every LLM/Vision call passes the **fail-closed** compliance proxy (FR-15). *Enforced:*
  fitness contracts F2/F3/F8/F16, proxy tests.
- **Secure by default:** RBAC + BOLA/BFLA before protected routes; secrets in env only; input validation;
  XXE/injection/PII defenses; hash-chained audit. Mapped to OWASP LLM/ASI · NIST · ISO 42001 · EU AI Act ·
  MITRE ATLAS. *Enforced:* `COMPLIANCE_MATRIX.md`, SAST/secret/dep scans, threat model.

## 5. Scalable, reliable, clean architecture
- **Hexagonal + DDD, clean boundaries:** domain pure (F9), use-cases port-only, ACL at every edge, no god
  objects, no circular imports. *Enforced:* agentic-linter / dependency-cruiser, F9.
- **Scale is a config switch, not a rewrite:** CRON↔BullMQ, Turf↔PostGIS, memory↔Redis, SSE↔polling behind
  ports/flags. *Enforced:* feature-flag adapters + ADRs.
- **Reliable:** circuit breaker + last-known-good + degraded-200 envelope + per-adapter health everywhere.
  *Enforced:* F5/F6, chaos suite.

## 6. Clear, concise, well-documented (incl. code) — easy to search, understand, test, work with
- **Docs:** short, scannable, single-sourced (no duplication); every artifact says what it is and links its
  Trace. Diagrams valid + current. *Enforced:* non-redundancy audit, doc-lint.
- **Code:** self-explanatory names (kebab files, `<Name>Port`, camelCase fns); small pure functions; comment
  the *why*, not the *what*; a docblock on every public function/module/adapter; typed everywhere (no `any`).
  *Enforced:* eslint + tsc strict, review.
- **Searchable & navigable:** predictable structure (`src/{domain,application,ports,adapters,main}`, `app/`,
  `tests/` mirrors `src/`); consistent naming; one concept → one canonical location; stable IDs (FR-##, F##,
  `E#·T-n`) so any thread is greppable. *Enforced:* structure lint, naming conventions.
- **Testable & tested:** TDD-first (Red→Green); golden + error + edge triad per FR; ≥99% coverage on
  domain+application; deterministic, fast, isolated tests. *Enforced:* coverage gate, triad gate, BDD/e2e.
- **Easy to work with & adjust mid-build:** modular epic files, label-based cross-epic deps, feature flags,
  and Trace links so **any piece can change without cascade**; every change classified (task / spec / arch)
  and propagated. *Enforced:* `project/TASKS.md §1` change-management model.

## 7. Usable & innovative
- **Usable:** crisis-first, **modern** UX per `docs/UI_UX_DESIGN.md` (dark-first tokens, Radix primitives,
  restrained motion, ⌘K palette) — low cognitive load, one meaning per color/shape, per-layer freshness +
  "Unverified" badges, **WCAG 2.2 AA**, fully responsive, works throttled/offline. *Enforced:* F13,
  visual-regression (theme×breakpoint), cross-region UX e2e (E9·T-423a).
- **Innovative (the defensible white-space):** cited deterministic AI synthesis + offline/local-first +
  responder logistics + free-world data in one ≈$0 OSS tool. *Enforced:* MARKET_SCAN, rubric category 5.

---

### How this stays binding across phases
- Referenced from `agents/memory/PROJECT_STATE.md` (read at every phase start) and
  `agents/memory/semantic/PROJECT_KNOWLEDGE.md`.
- The listed **fitness functions (F1–F19)** + **CI quality gates (1–7)** are the executable enforcement; this
  charter is the human-readable index of them plus the doc/code-quality bar.
- Any deviation is a logged decision (ADR or `AUDIT_LOG.md`), not a silent drift. AGENTS.md / CONSTITUTION.md
  remain FROZEN; propose an amendment only with user approval.
