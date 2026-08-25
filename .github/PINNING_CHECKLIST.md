# Action SHA-Pinning Checklist

> **Why:** OpenSSF Scorecard "Pinned-Dependencies" / SLSA supply-chain integrity — a floating tag
> (`@v4`) is mutable and can be repointed at malicious code. Every third-party GitHub Action must be
> pinned to a **full commit SHA** before CI runs on a protected branch.
>
> **Why not done here:** this environment is **offline** — commit SHAs are not resolvable. As promised
> in `docs/CI_CD_PLAN.md` §4 item 4, every action is pinned to its **major version tag** as an interim
> measure and carries a `# TODO(pin)` comment. **No SHA in these workflows is fabricated.** Resolve each
> SHA (`gh api /repos/<owner>/<repo>/commits/<tag> --jq .sha`, or the Action's release page) and replace
> `@vN` → `@<40-char-sha>  # vN`, then tick the box.

## How to pin

```sh
# Example: resolve actions/checkout@v4 to its current commit SHA
gh api repos/actions/checkout/commits/v4 --jq '.sha'
# then edit the workflow:  uses: actions/checkout@<sha>  # v4
```

## Actions used across all workflows

### `.github/workflows/ci.yml`

- [ ] `actions/checkout@v4`
- [ ] `actions/setup-node@v4`
- [ ] `actions/upload-artifact@v4`
- [ ] `gitleaks/gitleaks-action@v2`
- [ ] `google/osv-scanner-action@v2`
- [ ] `postgres:16` (service container image — pin to a digest: `postgres:16@sha256:<digest>`)

### `.github/workflows/nightly.yml`

- [ ] `actions/checkout@v4`
- [ ] `actions/setup-node@v4`

### `.github/workflows/release.yml`

- [ ] `actions/checkout@v4`
- [ ] `actions/setup-node@v4`
- [ ] `actions/upload-artifact@v4`
- [ ] `actions/download-artifact@v4`
- [ ] `sigstore/cosign-installer@v3`
- [ ] `softprops/action-gh-release@v2`
- [ ] **EXCEPTION — do NOT SHA-pin:** `slsa-framework/slsa-github-generator/.github/workflows/generator_generic_slsa3.yml@v2.0.0`
      — this reusable workflow verifies its own ref and **must** be referenced by an immutable semantic
      version tag, not a SHA (SHA-pinning it is unsupported and will fail). Keep it on a pinned `vX.Y.Z`
      tag and bump deliberately. (Confirm the exact latest tag when online.)

## Follow-ups deferred (require editing protected `package.json` — see CONTRIBUTING.md)

These are the Phase-2 prerequisites from `docs/CI_CD_PLAN.md` §2/§3, tracked so the commented CI/nightly
TODO blocks can graduate to live jobs:

- [ ] Add devDeps: `husky`, `lint-staged` (enable `.husky/pre-commit`), `@stryker-mutator/*` (mutation),
      `@microsoft/api-extractor` (API-surface snapshot), `@redocly/cli` (fix/replace the broken `docs` script).
- [ ] Add npm scripts: `test:bdd`, `check:scenario-triad`, `test:integration`, `test:contract`,
      `test:interop`, `test:compliance`, `test:budget`, `test:cost-attribution`, `bench:ci`,
      `test:chaos`, `test:edge:heavy`, `test:metamorphic`, `test:e2e:real`, `test:load`, `eval:tier1`,
      `eval:full`, and a `prepare: husky` script.
- [ ] Wire the Phase-2 CI jobs (SAST: CodeQL + Semgrep; container: Trivy; api-surface; benchmark; compliance;
      eval-tier1) once the above exist, then drop `continue-on-error` from `security` after calibration.
- [ ] Set `repo_url` in `agents/AGENTS.md` §1 (currently `[PLACEHOLDER: set on first push]`) — done by the
      maintainer at first push; not an agent edit (AGENTS.md is frozen).
