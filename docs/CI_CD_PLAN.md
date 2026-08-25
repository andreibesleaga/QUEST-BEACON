# BEACON — CI/CD Implementation Plan (for S09 human approval)

*IEEE Response Quest 2026 · Phase 3 · prepared 2026-07-08 · persona: `prod-tech-lead` + `ops-devops`.*

> **This is a PLAN, not an implementation.** Authoring or changing CI/CD is a governance-gated action
> (`AGENTS.md` §6 "Forbidden Actions" + §8 "requires human decision"). At the S08 gate the user explicitly
> chose **DEFER — present the plan at S09 first**. **No `.github/workflows/*` file has been created.**
> Nothing here is executed until you approve it at the S09 gate.

---

## 1. Why this document exists

`docs/CI_CD.md` (authored at S03 hardening) declares the full PR-blocking + nightly + release pipeline
**"MANDATORY from S05 day one."** That has never been true: **there is no `.github/` directory at all.**
The S04 backlog is honest about this — `project/tasks/E0-*.md` tasks **T-020…T-030** (author `ci.yml`,
`nightly.yml`, `release.yml`) are correctly **still open**, not marked done. The over-claim lives only in
`CI_CD.md`'s framing, and this plan corrects it.

## 2. Reality check — verified 2026-07-08 (do not skip)

A verbatim implementation of `CI_CD.md`'s skeletons **would fail on the first run.** Verified facts:

**Missing npm scripts.** `CI_CD.md` invokes 17 scripts; **14 do not exist** in `package.json`:
`test:bdd`, `test:integration`, `test:contract`, `test:interop`, `test:e2e`, `test:chaos`,
`test:metamorphic`, `test:edge:heavy`, `test:load`, `test:compliance`, `test:budget`,
`test:cost-attribution`, `bench:ci`, `check:scenario-triad`, `eval:full`, `eval:tier`.

**Missing tooling.** Not installed: `stryker` (mutation), `api-extractor` (API-surface snapshot),
`redocly` (OpenAPI lint — `npm run docs` is currently a broken script; the environment is also offline).

**Missing governance files** required by `CI_CD.md` §6: `CODE_OF_CONDUCT.md`, `CHANGELOG.md`,
`CONTRIBUTING.md`, `.github/dependabot.yml`, `.husky/` pre-commit hooks. (`SECURITY.md`, `LICENSE`,
`NOTICE` **do** exist.)

**What genuinely passes today** (all verified green on this tree, offline, no network):

| Check | Command | Verified result |
|---|---|---|
| Type safety | `tsc --noEmit` | 0 errors |
| Lint | `eslint .` | 0 errors (incl. `.cjs`, after the `globals.node` override) |
| Format | `prettier --check .` | available |
| Boundaries | `depcruise src` + `madge --circular src` | 292 modules, 0 violations, 0 cycles (madge now real via `.madgerc`) |
| Unit/component | `vitest run` | 971 / 971 pass |
| Coverage floor | `vitest run --coverage` | domain+application **100 / 100 / 100 / 99.21 branch** (≥99 gate) |
| Build | `next build` | succeeds |
| DB migration | `drizzle-kit migrate` | applies clean on Postgres 16 (19 tables) — proven |
| Container | `docker compose -f infra/docker-compose.yml config` / `build` | valid; images build |
| Browser gates | `playwright test` | see `docs/audit/S06_BROWSER_GATES.md` |
| Dependency CVEs | `npm audit --audit-level=high` | 0 high/critical (6 moderate, dev/build-only, documented) |

**Conclusion:** a *real* CI can be green **today** — but only if it runs the checks that exist. Everything
else must be earned, not declared.

---

## 3. Proposed implementation — phased, so CI is green from its first commit

### Phase 1 — `ci.yml` (PR-blocking). Only checks verified green above.
Maps to `AGENTS.md` §6 Quality Gates 1–6 and E0 tasks T-020…T-024, T-028.

| Job | Contents | Gate |
|---|---|---|
| `static` | checkout · setup-node (24.18.0 via `.nvmrc`) · `npm ci` · `tsc --noEmit` · `eslint .` · `prettier --check .` · `npm run boundaries` | 1, 2, 6 |
| `unit` | `vitest run --coverage` — **fails if domain+application coverage < 99%** | 3 |
| `build` | `next build` | — |
| `integration` | `services: postgres:16` · `drizzle-kit migrate` · assert 19 tables | 4 |
| `browser` | Playwright (cached chromium) — golden-path e2e + axe WCAG 2.2 AA + TTTP perf budget | 7 / F13 / F14 |
| `sca` | `npm audit --audit-level=high` + OSV-Scanner | 5 |
| `secrets` | `gitleaks` (`fetch-depth: 0`) | 5 sibling |
| `sast` | CodeQL (TS) + Semgrep, least-privilege `security-events: write` | — |
| `container` | Trivy scan of the built image — fail on High/Critical (T-024a) | 5 |

Hardening applied to every workflow: `permissions: contents: read` by default, concurrency-cancel on stale
runs, **all third-party actions SHA-pinned** (never floating `@v*`).

### Phase 2 — earn-the-right-to-block (author the prerequisite first, then add the job)
Each of these needs its npm script and/or tool added **before** a CI job can reference it. Proposed order:
`test:integration` + `test:contract`/`test:interop` (schema round-trips) → `api-extractor` API-surface
snapshot (T-026) → `bench:ci` micro-benchmark (T-027) → `test:bdd` (Gherkin per FR, Gate 7) → mutation
(Stryker), chaos, metamorphic, and the eval suites → `nightly.yml` (T-029).

### Phase 3 — `release.yml` (tag-driven `v*.*.*`), T-030
Build → **CycloneDX SBOM** → **SLSA L2 provenance** (`slsa-github-generator`) → **Sigstore cosign keyless**
signing via OIDC (`id-token: write`; never bare local signing) → signed GitHub Release with SBOM +
provenance + cosign bundle attached.

### Phase 0 (cheap, do alongside Phase 1) — governance files
`CODE_OF_CONDUCT.md`, `CHANGELOG.md` (Keep-a-Changelog + SemVer), `CONTRIBUTING.md`,
`.github/dependabot.yml`, `.husky/` + `lint-staged` pre-commit (format + lint + gitleaks on staged files).

---

## 4. What I need you to approve at the S09 gate

1. **Create `.github/workflows/{ci,nightly,release}.yml`** — a governance-gated action (§6/§8).
2. **Edit `package.json`** — a *protected file* (`gabbe.config.json`). Phase 1 needs no new scripts;
   Phase 2 needs the missing `test:*` / `bench:ci` scripts, and `npm run docs` should be fixed or removed
   (redocly is not installed).
3. **Add devDependencies** — `gitleaks`/OSV/Trivy run as pinned actions (no dep), but Phase 2 needs
   `@stryker-mutator/*`, `@microsoft/api-extractor`, `@redocly/cli`.
4. **Network access to resolve real action SHAs.** Pinning requires looking up current commit SHAs for each
   action; this environment is offline. I will not invent SHAs — if you approve while offline, I will author
   the workflows with clearly-marked `<sha>` placeholders and a checklist to resolve before enabling.
5. **Branch protection** on `main` requiring the `ci.yml` jobs (a GitHub repo setting, not a file) — and
   note `repo_url` in `AGENTS.md` §1 is still `[PLACEHOLDER: set on first push]`; there is no remote yet.

**Recommendation:** approve **Phase 0 + Phase 1** now (they are green today and give real protection),
schedule Phase 2 as earned, and Phase 3 at the first release tag. Correct `docs/CI_CD.md`'s
"mandatory from day one" framing to "target state; Phase 1 enforced from S09."

---

## 5. Honest status

**CI/CD does not exist and nothing in this plan has been executed.** Until it does, every quality gate in
this repository is enforced **locally and by the agent workflow**, not by a machine on every push. That is a
real limitation and it is disclosed in the S09 review package.
