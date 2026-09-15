# Epic E0 — Project Scaffold · Config · CI/CD · Governance · Observability bootstrap

> Owner personas: **eng-infra · ops-devops · ops-release** · Waves W0–W3 · IDs `E0·T-001…T-039`
> Change rule: every task carries a **Trace** key (ADR/§doc/Fnn/command) — edit a task freely; keep its Trace
> pointing at the governing artifact so a spec/arch change propagates here (and vice-versa). See master
> `project/TASKS.md` for the DAG, waves, and change-management model.

Status legend: TODO · IN_PROGRESS · DONE · BLOCKED (all tasks start TODO).

| ID | Task | Persona | Deps | Wave | Tags | Trace | Acceptance |
|---|---|---|---|---|---|---|---|
| T-001 ✅ | Create `.nvmrc` pinning the exact latest Node LTS version | eng-infra | — | W0 | [PARALLEL][SEC] {toolchain-pinning} | AGENTS§2/ADR-019 | `node -v` matches `.nvmrc`; `setup-node` uses `node-version-file` |
| T-002 ✅ | Write `package.json` (name, type:module, engines, scripts dev/build/test/typecheck/lint/format) | eng-infra | T-001 | W0 | {toolchain-pinning} | AGENTS§2 | `npm ci` resolves; every §2 command has a script entry |
| T-003 ✅ | Write `tsconfig.json` (TS5 strict, `@/*`→src, moduleResolution bundler) | eng-infra | T-002 | W0 | [PARALLEL] {typescript-config} | AGENTS§4 | `npx tsc --noEmit` runs; `@/` resolves in a probe import |
| T-004 ✅ | Write `eslint.config.js` (flat, TS + complexity<10, no-framework-in-domain rule) | eng-infra | T-002 | W0 | [PARALLEL] {lint-config} | CI_CD§2 Gate1/6 | `npx eslint .` exits 0 on skeleton with complexity rule active |
| T-005 ✅ | Write `.prettierrc` + `.prettierignore` | eng-infra | T-002 | W0 | [PARALLEL] {lint-config} | CI_CD§2 Gate1 | `npx prettier --check .` exits 0 |
| T-006 ✅ | Write `vitest.config.ts` with coverage provider + ≥99% line+branch thresholds | eng-infra | T-002,T-003 | W0 | [PARALLEL] {test-config} | CI_CD§2 Gate3 | `npm test -- --coverage` fails if coverage <99% |
| T-007 ✅ | Write `next.config.mjs` (App Router, minimal) | eng-infra | T-002 | W0 | [PARALLEL] {nextjs-scaffold} | ADR-003 | `npm run build` recognizes config |
| T-008 ✅ | Create App-Router skeleton `app/layout.tsx` + `app/page.tsx` | eng-infra | T-007 | W1 | [PARALLEL] {nextjs-scaffold} | ADR-003 | dev server renders `/` without error |
| T-009 ✅ | Create layered dir skeleton (src/domain, application, ports, adapters, main; tests/) with barrels | eng-infra | T-003 | W0 | [PARALLEL] {hexagonal-scaffold} | ADR-001/AGENTS§3 | all five layer dirs exist with placeholder exports |
| T-010 ✅ | Write `.dependency-cruiser.cjs` boundary rules (domain imports nothing framework, no cycles) | eng-infra | T-009 | W1 | [SEC] {boundary-enforcement} | CI_CD§3/AGENTS§3 F9 | `npx depcruise src` flags a planted domain→adapter import |
| T-011 ✅ | Add `madge` circular-dependency check script | eng-infra | T-009 | W1 | [PARALLEL] {boundary-enforcement} | AGENTS§3 | `npx madge --circular src` exits 0 clean |
| T-012 ✅ | Write config schema module (typed env: NODE_ENV/DEPLOY_MODE/APP_PORT/DATABASE_URL/flags) | eng-infra | T-003 | W1 | [SEC] {configuration-management} | ADR-012/CONFIG§1 | schema parses valid env; rejects unknown mode value |
| T-013 ✅ | Add fail-fast boot validator (mode-needs-its-key: `FEATURE_CACHE=redis`⇒`REDIS_URL`) | eng-infra | T-012 | W2 | [SEC] {configuration-management} | ADR-012/CONFIG-S06 | boot throws clear error when redis mode set without `REDIS_URL` |
| T-014 | Write `.env.example` (secret-free, every required var documented) | ops-devops | T-012 | W2 | [SEC] {configuration-management} | ADR-012/AGENTS§6 | contains no secret values; covers all schema-required keys |
| T-015 | Add `.gitignore` (`.env`, node_modules, dist, coverage excluded) | ops-devops | — | W0 | [PARALLEL][SEC] {secrets-hygiene} | AGENTS§6 | `.env` matched by ignore rules |
| T-016 | CI check that `.env.example` covers all schema-required vars (drift guard) | eng-infra | T-014 | W2 | [SEC] {configuration-management} | ADR-012 config-drift | fails when a required schema var missing from `.env.example` |
| T-017 ✅ | Write `drizzle.config.ts` (dialect postgres, schema+out paths, `DATABASE_URL`) | eng-infra | T-012 | W2 | [PARALLEL] {drizzle-setup} | ADR-013/AGENTS§2 | `npx drizzle-kit` reads config without error |
| T-018 ✅ | Write `infra/docker-compose.yml` (postgres:16 + app, ~$0 parity, **app `healthcheck` on /ready**) | ops-devops | T-002 | W1 | [PARALLEL] {containerization} | AGENTS§1/deploy | `docker compose config` validates; postgres + app healthchecks present |
| T-018a | **`npm run demo:reset`** — one command to restore clean demo state (drop→migrate→seed scenario fixtures) for flawless multi-take recording | ops-devops | T-017 | W2 | [PARALLEL] {containerization} | S05_READINESS/D-35 | reset reproduces the exact demo state idempotently |
| T-019 ✅ | Write `Dockerfile` (multi-stage, node LTS, lean image, **`USER` non-root + read-only rootfs + no build secrets**) | ops-devops | T-002 | W1 | [PARALLEL][SEC] {containerization} | AGENTS§1/SECURITY_BASELINE §5 | image builds; runs as non-root; rootfs read-only |
| T-024a | **Container image scan** (Trivy/grype) in CI — no High/Critical in the built image | ops-devops | T-019 | W2 | [SEC] {dependency-security} | SECURITY_BASELINE §5/D-35 | image scan gate fails on High+ |
| T-020 | Author `ci.yml` static job (checkout, setup-node, tsc, eslint, prettier, depcruise) | ops-devops | T-004,T-005,T-010 | W2 | [SEC] {ci-pipeline} | CI_CD§3 static | job green on skeleton; actions SHA-pinned |
| T-021 | Author `ci.yml` unit job (coverage-gate + fast-check hook) | ops-devops | T-006 | W2 | [PARALLEL] {ci-pipeline} | CI_CD§3 unit Gate3 | job fails when coverage <99% |
| T-022 | Author `ci.yml` integration job (pg service, drizzle migrate, ajv, redocly) | ops-devops | T-017 | W3 | [SEC] {ci-pipeline} | CI_CD§3 integ Gate4 | pg service boots; migrate step runs in job |
| T-023 | Author `ci.yml` secrets job (gitleaks SHA-pinned, fetch-depth 0) | ops-devops | — | W1 | [SEC] {dependency-security} | CI_CD§3 secrets | planted fake secret fails the job |
| T-024 | Author `ci.yml` sca job (OSV-Scanner + `npm audit --audit-level=high`) | ops-devops | T-002 | W2 | [SEC] {dependency-security} | CI_CD§3 sca Gate5 | HIGH+ CVE fails the job |
| T-025 | Author `ci.yml` sast job (CodeQL + Semgrep, least-priv perms) | ops-devops | — | W2 | [PARALLEL][SEC] {static-analysis} | CI_CD§3 sast | security-events:write scoped; runs on TS |
| T-026 | Author `ci.yml` api-surface job (api-extractor + `git diff --exit-code`) | ops-devops | T-009 | W3 | [PARALLEL] {api-surface} | CI_CD§3 api-surface | unreviewed export drift fails the job |
| T-027 | Author `ci.yml` benchmark job (`bench:ci`, ±5% non-regression) | ops-devops | T-006 | W3 | [PARALLEL] {perf-benchmark} | CI_CD§3 benchmark | runs vitest bench against baseline |
| T-028 | Add `ci.yml` `permissions: contents:read` + concurrency-cancel | ops-devops | T-020 | W3 | [SEC] {ci-pipeline} | CI_CD§1 | least-priv default set; stale runs cancel |
| T-029 | Author `nightly.yml` skeleton (mutation, chaos, edge-heavy, e2e-real, load) | ops-devops | T-021 | W3 | [PARALLEL] {ci-pipeline} | CI_CD§4 | scheduled + workflow_dispatch triggers present |
| T-030 | Author `release.yml` (CycloneDX SBOM + SLSA L2 provenance + cosign keyless + gh-release) | ops-release | T-002 | W3 | [SEC] {supply-chain} | CI_CD§5 | tag-triggered; id-token:write; actions SHA-pinned |
| T-031 | Author `scorecard.yml` (weekly OpenSSF Scorecard + badge) | ops-release | — | W2 | [PARALLEL][SEC] {supply-chain} | CI_CD§6 | weekly cron; Scorecard action SHA-pinned |
| T-032 | Write `.github/dependabot.yml` (npm + github-actions, weekly, grouped) | ops-devops | — | W1 | [PARALLEL][SEC] {dependency-security} | CI_CD§6 | both ecosystems + grouped minor-and-patch |
| T-033 | Configure husky + lint-staged + `.husky/pre-commit` (lint-staged, tsc, gitleaks protect) | eng-infra | T-004,T-005 | W2 | [SEC] {pre-commit-hooks} | CI_CD§7 | staged commit runs lint-staged + gitleaks protect |
| T-034 | Add `.husky/commit-msg` commitlint (Conventional Commits) + config | eng-infra | T-033 | W3 | [PARALLEL] {commit-lint} | CI_CD§7/AGENTS§6 | non-conventional message rejected |
| T-035 | Add governance files: SECURITY.md, CODE_OF_CONDUCT.md, CHANGELOG.md, CONTRIBUTING.md | ops-release | — | W1 | [PARALLEL] {governance-docs} | CI_CD§6 | all four present; CHANGELOG has Unreleased section |
| T-036 | Write OTel GenAI bootstrap skeleton (span-tree L0→L4 helper, gen_ai.usage.*, exporter env-gated) | eng-infra | T-012 | W2 | [PARALLEL] {observability} | ADR-022 | tracer no-ops when `OTEL_EXPORTER_OTLP_ENDPOINT` empty |
| T-037 | Add privacy-sampling guard (content capture off unless dev opt-in flag) | eng-infra | T-036 | W3 | [SEC] {observability} | ADR-022/CONFIG-C27 | message-content NOT captured with default env |
| T-038 | Wire agentic-linter config stub (boundary + forbidden-pattern checks) | eng-infra | T-010 | W3 | [PARALLEL] {boundary-enforcement} | AGENTS§3 | linter config references depcruise + complexity rules |
| T-039 | Add `LICENSE` (Apache-2.0) + `NOTICE` (per-source attribution skeleton) | ops-release | — | W0 | [PARALLEL] {governance-docs} | CI_CD§6/AGENTS§14 | Apache-2.0 SPDX header present; NOTICE attribution table stub |

**Cross-epic:** Every epic depends on the W0 scaffold (T-002/T-003/T-006/T-009). E3/E4 need T-012/T-017/T-018; all epics inherit CI gates T-020…T-028; AI epics (E6) attach to the OTel skeleton T-036.
**W0 critical path:** T-001→T-002→T-003→(T-006,T-009); config path T-012→T-013→T-014/T-016.
**Research flag (S05):** confirm current action SHAs for T-025/T-030 and exact latest Node LTS for T-001 at scaffold time (do not float `@v*` tags).
