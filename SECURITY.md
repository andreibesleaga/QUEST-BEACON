# Security Policy — BEACON

## Reporting a vulnerability
Please report suspected vulnerabilities **privately** — do not open a public issue.

- **Contact:** open a GitHub **private security advisory** on this repository
  (*Security → Report a vulnerability*), or email the maintainer listed in the repo profile.
- You will receive an acknowledgment within **72 hours** and a triage verdict within **7 days**.
- Please include: affected file/endpoint, reproduction steps, impact assessment, and any suggested fix.
- Coordinated disclosure: we ask for a reasonable embargo until a fix ships; credit is given unless you
  prefer otherwise.

## Scope
BEACON is a **pre-release contest entry** (IEEE Response Quest 2026, Phase 3) — the implementation is
complete and gated, but it has not been operated in a real deployment and carries no production warranty.
In scope: the web app and API routes (`app/**`), the domain/application core and adapters (`src/**`),
the AI-compliance gateway, and the interop surfaces (CAP v1.2 / EDXL-RM).
Out of scope: third-party data providers' own services (report those upstream), and the gitignored
governance/memory tooling (`agents/`, `.gabbe/`), which ships in no artifact.

## Security posture (summary)
Secrets only via environment, never committed (`.gitignore:11-14` ignores every `.env*` except the
example, plus `*.pem` / `*.key`) · RBAC + org-ownership before protected routes · per-user HS256 bearer JWT, fail-closed to
`PUBLIC` on any verification failure · fail-closed AI-compliance gateway on every model call
(prompt-injection / PII / policy screens) · hash-chained append-only audit log · XXE-hardened XML ·
`AlertSinkPort.emit` accepts only an approved ACTUAL alert **at the type level**, so no code path can emit
a public alert from an unverified report · SSE connection cap + rate limiting as availability guards.
Details: `docs/architecture/THREAT_MODEL.md` + `docs/architecture/COMPLIANCE_MATRIX.md`.

## What CI actually runs — and what it does not
Stated precisely, because an over-claimed control is worse than a missing one.

| Control | Status |
|---|---|
| `npm audit --audit-level=high` (SCA) | ✅ wired — `.github/workflows/ci.yml` `security` job, as `npm audit --omit=dev --audit-level=high` (runtime dependencies only) |
| **gitleaks** (secret scan, full history) | ✅ wired — same job, `fetch-depth: 0` |
| **OSV-Scanner** (lockfile CVEs) | ✅ wired — same job |
| **CycloneDX SBOM** + SHA-256 digests | ✅ wired — `.github/workflows/release.yml`. ⚠️ State on 2026-10-29: that workflow has failed at its SBOM step in all 6 runs so far (5 tags) and is disabled on GitHub, so no release carries an SBOM |
| **cosign keyless signing** + SLSA-3 provenance | ✅ wired — `.github/workflows/release.yml`. ⚠️ Never reached: both jobs run after the SBOM step above, so no release is signed or carries provenance |
| **SAST (CodeQL / Semgrep)** | ⛔ **NOT wired.** Planned only — see `.github/PINNING_CHECKLIST.md` and the header note in `ci.yml`. Do not read "SAST" into the security job; it is SCA + secrets, not static analysis. |
| **Container scanning (Trivy)** | ⛔ **NOT wired.** Planned; `.github/PINNING_CHECKLIST.md`. |

⚠️ The `security` job is **non-blocking** today (`continue-on-error: true`, `ci.yml:184`) — a deliberate
"earn the right to block" posture so a scanner quirk or rate-limit cannot red the first CI runs. It
graduates to blocking once calibrated on real runs (`docs/CI_CD.md` §3). Until then a finding in that
job **will not fail a build**, and reviewers must read the job output rather than trust the ✅.

Dependency state (`npm audit`, re-run 2026-08-02): **0 high, 0 critical**; 4 moderate, all
dev-only and transitive under `drizzle-kit`.

Re-run 2026-10-29: `npm audit --audit-level=high` reports **2 critical, 2 high, 6 moderate**. Only one is
in a runtime dependency: `zod` < 4.6.6 (high), which is also what the CI step above reports. The rest are
dev-only (`tinypool`, `@vitest/mocker` and the `vitest` packages that depend on them, `happy-dom`, and
`esbuild` under `drizzle-kit`).
