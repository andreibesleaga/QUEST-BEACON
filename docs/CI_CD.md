# BEACON — CI/CD Standard (day-one, OpenSSF-aligned)

<!-- Created by: prod-tech-lead (GABBE SDLC — Specification, S03 testing/CI standard) · Date: 2026-06-29 -->
<!-- Derived from: AGENTS.md §2 (exact commands), §6 (7 Quality Gates, secrets policy, Conventional Commits)
     · docs/SPEC.md §9/§10.2 · C4 F1–F19 · CONSTITUTION Art. I (≥99%, test-first), Art. V (security by default)
     · the author's agentic-AI engineering framework + the 8-pillar open-source audit standard
     (OpenSSF Scorecard, SLSA v1.1, Sigstore/cosign, CycloneDX 1.6, OSV-Scanner, Semgrep/CodeQL,
     NIST SSDF, Keep a Changelog, SemVer). Test detail in docs/TEST_PLAN.md; eval gates in docs/EVAL_PLAN.md. -->
<!-- SPEC document (S03). No workflows are wired until S05 (PAUSED at S04). The YAML below is a binding
     SKELETON the S05 CI must implement; CI/CD config changes need human approval (AGENTS.md §6). -->

> **Standard:** the **full** PR-blocking + nightly + release pipeline below is **MANDATORY from S05 day one**
> (ADR-019), aligned to the author's agentic-AI engineering framework and the 8-pillar open-source audit
> (Pillars 3/5/6: Security & Supply Chain, Testing & Verification, CI/CD & Release Engineering). The audit's
> standing finding — *"architectural ambition outpaces supply-chain hygiene"* — is pre-empted here: BEACON
> ships the evidence (coverage, SBOM, signed+provenanced releases, CVE delta, API-surface snapshot) from the
> first commit, not retrofitted.

---

## 1. Lanes overview

| Lane | Trigger | Purpose | Blocks merge? |
|---|---|---|---|
| **PR** (`ci.yml`) | `pull_request`, `push` to feature branches | lint + typecheck + unit ≥99% **line + branch (error/edge branches)** + integration **incl. key error cases (4xx/409/422, authz/BOLA, degrade-and-label)** + contract F1–F4/F8–F13/F15 + **compliance (F16 stamp/bypass-rejection, F17 budget hard-block, F19 cost-attribution) + AJV `config/policies.yml` validation** + **BDD-per-FR carrying the golden + key error + key edge scenario each (Gate 7 triad)** + visual + critical PBT + secrets + SCA + SAST + API-surface snapshot + micro-bench + Tier-1 eval gates | **yes** (7 quality gates + F-gates; **fails if any FR lacks golden+error+edge**) |
| **Nightly** (`nightly.yml`) | `schedule` (cron) | mutation (Stryker) + **full chaos/fault-injection incl. the 3 redundancy acceptance tests as error-path e2e (F5–F7)** + **heavy/combinatorial edge sets (max-load, concurrency, large EDXL round-trip, hysteresis/cooldown sweeps, unicode/bidi/zero-width)** + e2e-against-real-sources + load + full eval suite | no (reports scorecard) |
| **Release** (`release.yml`) | `push` tag `v*.*.*` | build + **CycloneDX SBOM + SLSA L2 provenance + Sigstore cosign** signed GitHub Release | n/a (gated by green PR + nightly) |

> **Scenario-coverage policy (TEST_PLAN §1.1) is a PR gate.** The **PR lane** runs, for **every FR**, the
> **golden/happy path** plus the **key error/failure and edge scenario(s)** — fast, with all externals
> **mocked** (recorded fixtures; no live network). The **nightly lane** runs the heavy/combinatorial edge
> sets, chaos/fault-injection (the 3 redundancy acceptance tests F5/F6/F7), e2e-against-real-sources, load,
> and mutation. **A PR fails if any FR lacks an implemented golden + error + edge triad** (Gate 7 extended,
> §2) — a golden-only or stubbed (`@skip`/pending-step) `.feature` is an incomplete gate, not a pass.

Common rules: **all third-party actions SHA-pinned** (not `@v4` floating tags — Scorecard "Pinned-Dependencies"
/ supply-chain integrity); least-privilege `permissions:` per job; secrets only from GitHub Secrets (never in
code/bundle/envelope — AGENTS.md secrets policy); concurrency-cancel stale runs.

---

## 2. The 7 Quality Gates (AGENTS.md §6) → CI jobs

| Gate | Check | CI job | Tooling |
|---|---|---|---|
| Gate 1 — Syntax/Lint | zero ESLint/Prettier errors + axe a11y (F13) | `lint` | `npx eslint .`, `npx prettier --check .`, Playwright+axe |
| Gate 2 — Type Safety | zero `tsc` errors | `typecheck` | `npx tsc --noEmit` |
| Gate 3 — Coverage | **≥99%** line (domain/app), all tests pass, no skips | `test` | `npm test -- --coverage` (Vitest) |
| Gate 4 — Integration | ephemeral Postgres up + migrations + API contract (F1/F10/F15) + **compliance proxy/cost (F16/F19)** + **AJV `config/policies.yml` ↔ `schemas/policies.schema.json`** + **F18 `/.well-known/sustainability` ↔ `schemas/sustainability-v05.schema.json`** (non-blocking) | `integration` / `compliance` | `pg`-service / Testcontainers + `drizzle-kit migrate` + AJV + `@redocly/cli lint` |
| Gate 5 — Security scan | no critical/high CVE | `sca` | `npm audit --audit-level=high` + OSV-Scanner |
| Gate 6 — Complexity | cyclomatic < 10 on modified files; no boundary violation (F9) | `complexity` | ESLint complexity rule + dependency-cruiser |
| Gate 7 — EARS compliance (**triad-extended**) | every FR has an implemented **golden + error + edge** scenario triad (TEST_PLAN §1.1/§1.2) — **a golden-only or stubbed (`@skip`/pending) `.feature` fails the gate**; F3/F8 contract green + **F16 fail-closed (PII/injection → 403) + F17 budget hard-block + HITL** | `bdd` / `compliance` | Gherkin-per-FR (Vitest-cucumber) + contract suite + **triad-coverage check** |

Plus the day-one supply-chain/quality additions (audit framework §7 verification gates): **secrets scan**
(gitleaks), **SAST** (Semgrep + CodeQL), **API-surface snapshot diff** (api-extractor), **micro-benchmark**
(±5% non-regression), and the **Tier-1 eval gates** (citation coverage=100%, no-LLM-numbers, schema/fallback,
no-PII — `docs/EVAL_PLAN.md §6`).

---

## 3. PR-blocking workflow (skeleton)

```yaml
# .github/workflows/ci.yml — PR-blocking. All actions SHA-pinned (shown as <sha> placeholders).
name: ci
on:
  pull_request:
  push:
    branches-ignore: [main]
permissions:
  contents: read          # least privilege; raise per-job only where needed
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  static:                          # Gate 1 + Gate 2 + Gate 6
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha>
      - uses: actions/setup-node@<sha>
        with: { node-version-file: '.nvmrc', cache: npm }
      - run: npm ci
      - run: npx tsc --noEmit                 # Gate 2
      - run: npx eslint .                      # Gate 1 (incl. complexity rule → Gate 6)
      - run: npx prettier --check .            # Gate 1
      - run: npx depcruise src --config .dependency-cruiser.cjs   # F9 boundaries / no cycles

  unit:                            # Gate 3 — ≥99% domain/application
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha>
      - uses: actions/setup-node@<sha>
        with: { node-version-file: '.nvmrc', cache: npm }
      - run: npm ci
      - run: npm test -- --coverage           # Vitest; fails < 99% LINE *and* BRANCH (error/edge branches must be hit by an executed scenario, not happy-path padding — TEST_PLAN §1.1/§2)
      - run: npx fast-check-ci                 # critical property tests (round-trip/invariant) + boundary/edge generators — see TEST_PLAN §3.7

  integration:                     # Gate 4 + F1/F10/F11/F15 + policy/sustainability schema validation
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16@<sha>
        env: { POSTGRES_PASSWORD: ci }
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready" --health-interval 5s --health-timeout 5s --health-retries 5
    env:
      DATABASE_URL: postgres://postgres:ci@localhost:5432/postgres
    steps:
      - uses: actions/checkout@<sha>
      - uses: actions/setup-node@<sha>
        with: { node-version-file: '.nvmrc', cache: npm }
      - run: npm ci
      - run: npx drizzle-kit migrate           # F10 boot order: config → migrate → seed
      - run: npm run test:integration          # adapters+ACL+repo; both Turf & PostGIS (F11); INCLUDES the key error cases per FR — 4xx/409/422, authz/BOLA denial, malformed-upstream → SOURCE_DEGRADED, degrade-and-label (no 5xx dead-end, UW2/F6)
      - run: npm run test:contract             # F1 provenance, F2 citation, F3 no-numbers, F8 HITL
      - run: npm run test:interop              # F15 CAP/EDXL JSON-Schema validate + EDXL-RM round-trip
      - run: npx ajv validate -s schemas/policies.schema.json -d config/policies.yml --spec=draft2020
        # policy-as-code fail-fast (U5/F10/F33) — the boot-time gate F16/F17 rely on; same check runs at app boot
      - run: npx ajv validate -s schemas/sustainability-v05.schema.json -d fixtures/sustainability/*.json --spec=draft2020
        # F18 (plugin, NON-BLOCKING) — GET /.well-known/sustainability must validate (single object or trend array)
        continue-on-error: true
      - run: npx @redocly/cli lint docs/api/openapi.yaml

  compliance:                      # PR-blocking — AI-governance gates F16/F17/F19 (ADR-017/018/022)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha>
      - uses: actions/setup-node@<sha>
        with: { node-version-file: '.nvmrc', cache: npm }
      - run: npm ci
      - run: npm run test:compliance           # F16 every LLM/Vision call carries the gateway stamp; un-stamped → REJECTED (bypass-proof); PII/prompt-injection → fail-closed 403
      - run: npm run test:budget               # F17 call ≥ escalation_threshold_usd / over cap → HARD-BLOCK + HITL; within budget proceeds (soft); safety fail-closed regardless of budget
      - run: npm run test:cost-attribution     # F19 every LLM/vision/adapter AUDIT_EVENT has cost_tokens_in/out, cost_usd, model_tier populated

  bdd:                             # Gate 7 (triad-extended) — every FR carries golden + key error + key edge (TEST_PLAN §1.1/§1.2)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha>
      - uses: actions/setup-node@<sha>
        with: { node-version-file: '.nvmrc', cache: npm }
      - run: npm ci
      - run: npm run test:bdd                  # runs the golden + key error + key edge scenario per FR (FR-1..13, FR-15, plus FR-14/FR-16 plugin features); heavy/combinatorial edge variants run nightly
      - run: npm run check:scenario-triad      # FAILS the PR if any FR lacks an IMPLEMENTED golden+error+edge triad — a golden-only or stubbed (@skip / pending-step) .feature is an incomplete gate, not a pass (TEST_PLAN §1.1)

  visual:                          # F13 + visual-regression (COP / SitRep / logistics)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha>
      - uses: actions/setup-node@<sha>
        with: { node-version-file: '.nvmrc', cache: npm }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test --grep @visual    # toHaveScreenshot baselines + axe a11y
        # baseline updates (--update-snapshots) require human authorization (anti-tamper)

  api-surface:                     # audit gate — public API surface snapshot diff
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha>
      - uses: actions/setup-node@<sha>
        with: { node-version-file: '.nvmrc', cache: npm }
      - run: npm ci
      - run: npx api-extractor run --local        # fail if exported surface drifts unreviewed
      - run: git diff --exit-code etc/beacon.api.md

  benchmark:                       # audit gate — micro-benchmark, ±5% non-regression
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha>
      - uses: actions/setup-node@<sha>
        with: { node-version-file: '.nvmrc', cache: npm }
      - run: npm ci
      - run: npm run bench:ci                      # vitest bench on risk-intersection/ranking; fail > +5% vs baseline

  secrets:                         # gitleaks — Gate 5 sibling (Scorecard / NIST SSDF PS)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha>
        with: { fetch-depth: 0 }
      - uses: gitleaks/gitleaks-action@<sha>

  sca:                             # Gate 5 — SCA (OSV-Scanner + npm audit), no HIGH+ CVE
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha>
      - uses: google/osv-scanner-action@<sha>
        with: { scan-args: "--lockfile=package-lock.json" }
      - run: npm audit --audit-level=high

  sast:                            # SAST — Semgrep + CodeQL
    runs-on: ubuntu-latest
    permissions: { security-events: write, contents: read }
    steps:
      - uses: actions/checkout@<sha>
      - uses: github/codeql-action/init@<sha>
        with: { languages: javascript-typescript }
      - uses: github/codeql-action/analyze@<sha>
      - uses: semgrep/semgrep-action@<sha>        # OWASP / LLM-injection rule packs

  eval-tier1:                      # Tier-1 AI eval gates (deterministic slice) — EVAL_PLAN §6
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha>
      - uses: actions/setup-node@<sha>
        with: { node-version-file: '.nvmrc', cache: npm }
      - run: npm ci
      - run: npm run eval:tier1                    # citation=100% (F2), no-LLM-numbers (F3), schema/fallback (F4), no-PII (F12)
        # Tier-2/Tier-3 (judge) run nightly until calibrated & stable (earn-the-right-to-block)
```

---

## 4. Nightly workflow (skeleton)

```yaml
# .github/workflows/nightly.yml — non-blocking; publishes scorecards.
name: nightly
on:
  schedule: [{ cron: '0 5 * * *' }]
  workflow_dispatch:
permissions: { contents: read }
jobs:
  mutation:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha>
      - uses: actions/setup-node@<sha>
        with: { node-version-file: '.nvmrc', cache: npm }
      - run: npm ci
      - run: npx stryker run                       # mutation score ≥ 80% killed on domain+application

  chaos:                                            # F5/F6/F7 — the 3 redundancy acceptance tests, as first-class ERROR-PATH e2e
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha>
      - uses: actions/setup-node@<sha>
        with: { node-version-file: '.nvmrc', cache: npm }
      - run: npm ci
      - run: npm run test:chaos                     # offline/air-gapped (F5), primary-down (F6), AI-disabled (F7) + malformed-upstream, cache-corruption, audit-write-fail, breaker; Toxiproxy seams (TEST_PLAN §3.9)

  edge-heavy:                                       # heavy / combinatorial EDGE sets (the §1.2 (c) cases too expensive for the PR lane)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha>
      - uses: actions/setup-node@<sha>
        with: { node-version-file: '.nvmrc', cache: npm }
      - run: npm ci
      - run: npm run test:edge:heavy                # max feature-count (Turf perf bound), concurrent SSE clients, large EDXL-RM round-trip, hysteresis/cooldown enum-boundary sweeps, duplicate/near-duplicate SOS corroboration, clock-skew/freshness boundary, unicode/bidi/zero-width

  metamorphic:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha>
      - run: npm ci && npm run test:metamorphic     # AI SitRep paraphrase/noise/order invariance

  e2e-real:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha>
      - run: npm ci && npx playwright install --with-deps
      - run: npm run test:e2e:real                  # golden path against live primary sources; TTTP < 10s (F14)

  load:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha>
      - run: npm ci && npm run test:load            # SSE delta latency, ingestion cadence under load

  eval-full:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha>
      - run: npm ci && npm run eval:full            # full golden set; Tier-1/2/3; pass^5; drift-vs-baseline scorecard
```

---

## 5. Release workflow — SBOM + SLSA L2 + cosign (skeleton)

```yaml
# .github/workflows/release.yml — tag-driven; supply-chain evidence (audit Pillar 6).
name: release
on:
  push: { tags: ['v*.*.*'] }
permissions: { contents: read }
jobs:
  build:
    runs-on: ubuntu-latest
    outputs: { digest: ${{ steps.hash.outputs.digest }} }
    steps:
      - uses: actions/checkout@<sha>
      - uses: actions/setup-node@<sha>
        with: { node-version-file: '.nvmrc', cache: npm }
      - run: npm ci && npm run build
      - name: CycloneDX SBOM
        run: npx @cyclonedx/cyclonedx-npm --output-file sbom.cdx.json   # CycloneDX 1.6
      - id: hash
        run: echo "digest=$(sha256sum dist/*.tgz | base64 -w0)" >> "$GITHUB_OUTPUT"

  provenance:                                       # SLSA Level 2 build provenance
    needs: [build]
    permissions: { id-token: write, contents: write, actions: read }
    uses: slsa-framework/slsa-github-generator/.github/workflows/generator_generic_slsa3.yml@<sha>
    with: { base64-subjects: ${{ needs.build.outputs.digest }} }

  sign-and-publish:
    needs: [build, provenance]
    runs-on: ubuntu-latest
    permissions: { id-token: write, contents: write }      # OIDC for keyless cosign
    steps:
      - uses: actions/checkout@<sha>
      - uses: sigstore/cosign-installer@<sha>
      - run: cosign sign-blob --yes dist/*.tgz --bundle beacon.cosign.bundle   # keyless / Fulcio + Rekor
      - uses: softprops/action-gh-release@<sha>             # attach SBOM + provenance + cosign bundle
        with: { files: |
            dist/*.tgz
            sbom.cdx.json
            beacon.cosign.bundle }
```

Notes: keyless cosign uses OIDC (`id-token: write`) — never bare local signing. SLSA L2 = the
`slsa-github-generator` attests the build. SBOM (CycloneDX) attached to every GitHub Release.

---

## 6. Required governance files (day one)

Per the author's framework + the open-source audit P0 set (these unlock OpenSSF Scorecard sub-scores and close
the lowest-hanging Pillar 3/4/7 gaps — all `additive`, none changes behavior):

| File | Standard | Content |
|---|---|---|
| `SECURITY.md` | OpenSSF / NIST SSDF | disclosure email, supported-versions table, response SLA; references THREAT_MODEL.md |
| `CODE_OF_CONDUCT.md` | Contributor Covenant 2.1 | verbatim |
| `CONTRIBUTING.md` | — | review-driven dev flow (AGENTS.md §5), Conventional Commits, the 7 gates |
| `CHANGELOG.md` | **Keep a Changelog** + **SemVer** | Unreleased + per-version sections |
| `.github/dependabot.yml` | Dependabot | `npm` + `github-actions` ecosystems, **weekly**, **grouped** (minor/patch together), auto-rebase |
| `.github/workflows/scorecard.yml` | **OpenSSF Scorecard** | weekly Scorecard run + badge |
| `LICENSE` / `NOTICE` | Apache-2.0 (PRD §10) | code license + per-source data-license attributions (Art. XIV) |

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: npm
    directory: "/"
    schedule: { interval: weekly }
    groups:
      minor-and-patch: { update-types: [minor, patch] }
    open-pull-requests-limit: 10
  - package-ecosystem: github-actions
    directory: "/"
    schedule: { interval: weekly }
```

---

## 7. Pre-commit hooks (husky + lint-staged)

Fast local feedback (Commit-Hook stage = Lint + Type Check, `testing-strategy.md` §5; keep heavy suites in CI):

```jsonc
// package.json (excerpt)
{
  "scripts": { "prepare": "husky" },
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
    "*.{json,md,yaml}": ["prettier --write"]
  }
}
```

```bash
# .husky/pre-commit
npx lint-staged
npx tsc --noEmit
# .husky/commit-msg  → commitlint (Conventional Commits — AGENTS.md §6)
npx --no -- commitlint --edit "$1"
```

Pre-commit also runs `gitleaks protect --staged` so a secret cannot be committed locally (defense-in-depth with
the CI `secrets` job). No `--no-verify` bypass in normal flow.

---

## 8. Audit-framework verification gates (mapped)

The 6 audit verification gates (framework §7) are realized as CI jobs so a future refactor proves no breakage:
**API surface diff empty** (`api-surface` job), **config schema superset** (F10 fail-fast + `.env.example` diff
+ **AJV `config/policies.yml` ↔ `schemas/policies.schema.json`**, the policy-as-code gate F16/F17 depend on),
**on-wire fixture vault green** (F15 CAP/EDXL round-trip; **F18 sustainability schema-valid**, non-blocking),
**AI-governance gates green** (`compliance` job — F16 stamp/bypass-rejection, F17 budget hard-block, F19 cost-attribution),
**micro-benchmark within 5%** (`benchmark` job),
**CVE delta non-positive** (`sca` job pre/post), and **coverage published** (Gate 3 artifact). CLI surface diff
is N/A (BEACON is a web app, not a CLI).

---

## AS-BUILT reality note — added 2026-08-02 by the lens-7/lens-1 docs↔code audit

> **Everything above is preserved as the S03 *binding skeleton* it was authored as** (see the header
> comment: "No workflows are wired until S05"). Workflows now EXIST, and they implement a **subset**. This
> note states which — because §1's lane table and §2's gate table are written in the present tense, and a
> reader would reasonably take them for a description of the running pipeline. `docs/CI_CD_PLAN.md`
> (2026-07-08) already flagged the gap at plan level; this closes it in the standard itself.

**What actually ships** — `.github/workflows/`, read on 2026-08-02:

| Workflow | Jobs | Steps that run |
|---|---|---|
| `ci.yml` (on `pull_request`, `push`) | `static` · `unit` · `build` · `integration` · `browser` · `security` | `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run boundaries` · `npm run test:coverage` + coverage artifact · `npm run build` · `npm run migrate` against a `postgres` service + assert 19 base tables · `npx playwright install --with-deps chromium` + `npx playwright test` (+ report on failure) · `npm audit` high+, **gitleaks**, **OSV-Scanner** |
| `nightly.yml` (cron + dispatch) | `full-suite` | `npm run test:coverage`, `npm run build`, fresh dependency audit (report-only) |
| `release.yml` (tag `v*.*.*`) | `build` · `provenance` · `sign-and-publish` | build + **CycloneDX SBOM** + tarball + sha256 subject · **SLSA provenance** · **Sigstore cosign** keyless signing + GitHub Release |

**Jobs and gates described above that DO NOT EXIST in any workflow** (verified by reading all three YAML
files, and by `grep` for the scripts in `package.json`):

- **`bdd` job / Gate 7 triad enforcement** (§1, §2 Gate 7, §5 skeleton line 137-144). There is no `bdd` job,
  no `npm run test:bdd` script, no `.feature` file anywhere in the repo, and no Gherkin runner in
  `package.json`. **"A PR fails if any FR lacks golden+error+edge" is enforced by nothing.** See
  `docs/TEST_PLAN.md` §7.2.
- **`compliance` job** (F16 stamp/bypass-rejection · F17 budget hard-block · F19 cost-attribution) — the
  fitness functions themselves exist as colocated Vitest suites and run inside `unit`, but there is no
  separate compliance job and no `test:compliance` / `test:budget` / `test:cost-attribution` script.
- **`mutation` job / Stryker ≥80%** — `stryker` is not a dependency; `nightly.yml` has one job and no
  mutation step. **There is no mutation score to quote.**
- **`fast-check-ci` / critical PBT step** — `fast-check` is not a dependency and no PBT spec exists.
- **`api-surface` job** (API-surface snapshot diff) and **`benchmark` job** (micro-bench within 5%) — neither
  job nor `api-extractor` nor `bench:ci` exists.
- **`chaos` / `metamorphic` / `e2e-real` / `load` / `eval` nightly steps** — none are wired; `nightly.yml`
  runs coverage + build + audit only. (`npm run docs` → `redocly lint` and `npm run live:probe` are real
  scripts but are **not** invoked by any workflow.)
- **AJV `config/policies.yml` ↔ `schemas/policies.schema.json` as a CI gate** — the validation runs at boot
  and in colocated tests, but no CI job names it.

**The `.env.example` diff gate named in "config schema superset" also does not exist**, which matters:
`.env.example:52` sets `AI_MODE=cloud` while the code default is `off` (`src/config/index.ts:80`), and
`NEXT_PUBLIC_FEATURE_OUTLOOK_PANEL` — read by `app/_components/panels/sitrep-panel.tsx:101` — is absent from
`.env.example` altogether. A drift a documented gate would have caught, had the gate been built.

**Honest summary:** the shipped pipeline is a solid *conventional* one — types, lint, format, boundaries,
coverage-gated unit tests, real-Postgres migration check, full Playwright browser run, three security
scanners, and a genuinely strong signed/SBOM'd/provenanced release lane. It is **not** the pipeline §1–§5
describe. The difference is a backlog, and none of it can be closed without new dependencies, which the
current scope freeze forbids.

---

*BEACON — IEEE Response Quest 2026, Phase 3 · GABBE SDLC S03 CI/CD standard · prod-tech-lead · 2026-06-29.*
*As-built reality note added by the docs↔code parity + honesty audit, 2026-08-02; every row read from `.github/workflows/*.yml` and `package.json`.*
*Binding references: AGENTS.md §2/§6 · docs/SPEC.md §9/§10.2 · C4 F1–F19 · CONSTITUTION Art. I/V · docs/TEST_PLAN.md · docs/EVAL_PLAN.md · ADR-019.*
