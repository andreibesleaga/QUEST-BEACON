<!-- BEACON PR template — mirrors AGENTS.md §6 "PR body must include" + the 7 Quality Gates. -->

## What changed and why

<!-- Summary of the change and the motivation. Link the requirement/spec/task (golden thread). -->

## Test coverage for the change

<!-- Which tests were added/updated. Domain + application stay ≥99% (line + branch). Note new
     golden / error / edge scenarios if this touches an FR. -->

## Breaking changes

<!-- Any breaking API/contract change? If none, write "None". Breaking changes need human sign-off
     (AGENTS.md §9). -->

## Security implications

<!-- Auth/RBAC/PII/provenance/compliance-gateway impact? Any new dependency or data source?
     If none, write "None". -->

---

### Conventional Commit

<!-- Title MUST follow: <type>(<scope>): <subject> — type ∈ feat|fix|docs|style|refactor|test|chore|perf|sec|deps -->

### Gate checklist (AGENTS.md §6 — CI enforces these)

- [ ] Gate 1 — Lint + format: `npm run lint` + `npm run format:check` clean
- [ ] Gate 2 — Types: `npm run typecheck` clean
- [ ] Gate 3 — Coverage: `npm run test:coverage` passes (≥99% domain + application)
- [ ] Gate 4 — Integration: `npm run migrate` applies on Postgres 16
- [ ] Gate 5 — Security: `npm audit --audit-level=high` clean (SCA/secrets non-blocking for now)
- [ ] Gate 6 — Boundaries/complexity: `npm run boundaries` clean (no cycles, no layer violation)
- [ ] Browser: `npx playwright test` green (golden path + axe WCAG 2.2 AA + TTTP budget)
- [ ] Docs/memory updated where relevant; no secrets committed (`.env` is gitignored)
