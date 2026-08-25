# Contributing to BEACON

BEACON — Browser-based Emergency Awareness & Coordination Open Network (IEEE Response Quest 2026,
Phase 3). Thanks for helping. This project follows a **spec-driven, test-first, review-driven** flow.
Please read the two governing documents before your first change:

- **`agents/AGENTS.md`** — the single source of truth for engineering rules (commands, the 7 Quality
  Gates, architecture boundaries, secrets policy, Conventional Commits).
- **`agents/CONSTITUTION.md`** — project law (≥99% coverage / test-first, deterministic→AI→human,
  provenance & citations, security-by-default). These are non-negotiable.

## 1. Setup

```sh
# Node is pinned via .nvmrc (Node 24.x).
nvm use            # or: nvm install && nvm use
npm ci             # clean, lockfile-exact install (preferred over `npm install` for reproducibility)

cp .env.example .env   # fill any keys you need; ALL defaults run fully offline / air-gapped
```

`.env` is gitignored and must **never** be committed. `.env.example` is the committed, secret-free
template — if you add a new config value, document it there (see the secrets policy below).

## 2. The gate commands (run all before opening a PR)

These are the exact commands CI runs. Green locally ⇒ green in `ci.yml`.

```sh
npm run typecheck        # Gate 2 — tsc --noEmit, 0 errors
npm run lint             # Gate 1 — eslint ., 0 errors (incl. complexity rule → Gate 6)
npm run format:check     # Gate 1 — prettier --check .
npm run boundaries       # Gate 6 — depcruise src && madge --circular src (no cycles / no layer violation)
npm run test:coverage    # Gate 3 — vitest run --coverage; FAILS under 99% on domain + application
npm run build            # next build
npm run migrate          # Gate 4 — drizzle-kit migrate (needs a Postgres 16 + DATABASE_URL)
npx playwright test      # Browser — golden-path e2e + axe WCAG 2.2 AA + TTTP budget (builds+starts prod itself)
npm audit --audit-level=high   # Gate 5 — no high/critical CVEs
```

> The security lane (`npm audit`, gitleaks, OSV-Scanner) is currently **non-blocking** in CI
> ("earn the right to block") — it graduates to blocking once calibrated. Do not introduce a
> high/critical CVE or a committed secret regardless.

## 3. Definition of Done

A change is done only when **all** hold (see `docs/ENGINEERING_PRINCIPLES.md`):

- All gate commands above pass; no skipped tests; coverage floor held.
- The change is covered by a test written **before** the implementation (TDD red → green → refactor).
- Non-trivial features start from an **EARS** spec; the golden thread stays intact
  (requirement → spec → test → code → audit).
- No architecture boundary crossed (domain imports no framework/HTTP/DB; adapters never leak raw
  source formats upward; routes delegate to use-cases). See `agents/AGENTS.md` §3.
- Constitutional invariants preserved: the LLM never emits a number/ranking/distance; every SitRep
  field carries `citations[]`; every data response carries `provenance[]` + `freshness`; no
  `UNVERIFIED` report emits a CAP/EDXL alert (human-in-the-loop before public action).
- Docs/memory updated where relevant; limitations stated honestly.

## 4. Commit & PR conventions

**Conventional Commits** (`agents/AGENTS.md` §6):

```
<type>(<scope>): <subject>

type ∈ feat | fix | docs | style | refactor | test | chore | perf | sec | deps
scope = module or layer (optional)
```

Examples: `feat(routing): add Valhalla fallback adapter`, `fix(api): server-derive audit actor`,
`sec(deps): bump jose to patch CVE`.

Open a PR using the template (`.github/pull_request_template.md`): what changed & why, test coverage,
breaking changes, security implications, plus the gate checklist. Keep commits scoped and reviewable.

## 5. Secrets & data policy

- All secrets via environment variables only — **never** hardcode keys, tokens, or connection strings.
- Local: `.env` (gitignored). CI: GitHub Secrets. Add every new var to `.env.example` (secret-free).
- Only **free/open** data sources with compatible licensing (tracked in `NOTICE`); no scraping of
  ToS-protected platforms. See `agents/AGENTS.md` §14 and `docs/RESPONSIBLE_DATA.md`.

## 6. Local pre-commit hook (optional, follow-up)

`.husky/pre-commit` runs a fast staged-safe subset (`format:check → lint → typecheck`). Enabling husky
needs a one-time setup that edits `package.json` (a protected file — do it deliberately, not via an
agent):

```sh
npm i -D husky lint-staged
npm pkg set scripts.prepare="husky"
npm run prepare        # installs the git hooks
```

Until then the hook script exists but is not wired by git. This, plus the Phase-2 scripts/tools, are
tracked in `.github/PINNING_CHECKLIST.md` ("Follow-ups deferred").

## 7. CI/CD

See `docs/CI_CD_PLAN.md` (what is live now vs. earned later) and `.github/workflows/` (`ci.yml`
PR-blocking, `nightly.yml` non-blocking, `release.yml` tag-driven). Every third-party action is pinned
to a major tag with a `# TODO(pin)` — resolve to full SHAs before enabling protection (checklist:
`.github/PINNING_CHECKLIST.md`). Changing CI/CD is a governance-gated action requiring human approval.
