# BEACON — Classical Security Baseline (end-to-end, all planes, input + output)

> Consolidated **classical computer/network/web AppSec** across backend · frontend · data · AI planes,
> mapped to OWASP **Web Top-10 (2021)** + OWASP **API Security Top-10 (2023)** + OWASP **LLM Top-10 (2025)**
> + CWE Top-25, each with a control and an owning task. Complements the AI-plane governance
> (`ADR-017`/`COMPLIANCE_MATRIX.md`) and the STRIDE threat model (`THREAT_MODEL.md`). Every control is
> defense-in-depth (input **and** output), fail-closed where safety-critical. Adopted 2026-07-04 (D-35).

## Cross-cutting principles
Validate all input at the boundary (Zod DTOs) · encode/escape all output for its sink · least privilege ·
deny-by-default · secrets only in env (never client-exposed) · fail-closed on security-control error ·
everything scanned in CI (SAST/SCA/secrets/DAST) · no security control removable without an ADR.

## 1. Web / frontend plane (browser-facing)
| Threat (OWASP) | Control | Owner task |
|---|---|---|
| **XSS** (A03 Injection) | React auto-escaping; **ban `dangerouslySetInnerHTML`** on untrusted; sanitize any rich text (DOMPurify); strict **CSP** (nonce/hash, `default-src 'self'`, no `unsafe-inline`/`unsafe-eval`) | **E8·T-394a**, E7·T-320b |
| **CSP as shipped** (2026-09-14, PR-G) | `default-src 'self'`; basemap tile hosts allow-listed for `connect-src`/`img-src` (tested against the map's ladder); `worker-src blob:` for MapLibre; `frame-ancestors 'none'`; `object-src 'none'`. **Accepted residual:** `script-src`/`style-src` carry `'unsafe-inline'` — Next's hydration runtime is inline and a nonce needs a middleware; no `'unsafe-eval'`. HSTS `max-age=31536000; includeSubDomains`. `next dev` sends no CSP (HMR). | next.config.mjs |
| **Service worker cache (ADR-047, 2026-09-15)** | `public/sw.js` is opt-in (`NEXT_PUBLIC_PWA=on`), same-origin only, and stores **only anonymous answers to PUBLIC GET routes** (asserted against `openapi.yaml` by `app/_lib/pwa/sw-policy.test.ts`); never writes, `/auth/*`, `/me`, the SSE stream, role-gated reads, or any response to a request carrying a bearer/elevated role. A served copy is labelled with its saved time. Off builds unregister the worker and purge `beacon-sw-*` caches | ADR-047 |
| **Clickjacking** | `Content-Security-Policy: frame-ancestors 'none'` + `X-Frame-Options: DENY` | E7·T-320b |
| **CSRF** | `SameSite=Strict` cookies + double-submit/Origin check on state-changing routes; JWT in `Authorization` (not ambient cookie) for API | E7·T-320a |
| **Security headers** | HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` (geolocation self only), COOP/CORP | E7·T-320b |
| **Sensitive data in client** | no secrets/PII in bundle or localStorage; precise geo only in responder view (ST3); SW cache excludes auth responses | E8·T-350a, E8·T-370 |
| **Supply-chain (client deps)** | SBOM + SCA (OSV) + SRI for any external asset (there are none — all self-hosted, offline-identical) | E0·T-024/T-030 |
| **Tabnabbing / open-redirect** | `rel="noopener noreferrer"` on external links; allowlist redirects | E8·T-394a |

## 2. API / backend plane (Next API routes)
| Threat (OWASP API) | Control | Owner task |
|---|---|---|
| **Broken auth (API2)** | JWT verify (jose) + short expiry; reject missing/invalid → 401 | E7·T-320/321 |
| **BOLA/BFLA (API1/API5)** | RBAC role-gate + org-ownership before every protected route | E7·T-322…325 |
| **SSRF (API7)** | adapter egress **allowlist** (only known source hosts); block link-local/metadata (169.254/::1/10.x); no user-controlled URLs to `fetch` | E4·T-142/143, E6·T-266 |
| **Injection (A03)** | Zod-validated DTOs on every input; **parameterized queries only (Drizzle)** — no string SQL; typed path/query params | E1·T-088, E3 repo tasks, E7 route tasks |
| **Mass assignment** | explicit DTO allowlists (never spread request body into entities) | E7 route tasks |
| **Rate limiting / DoS (API4)** | per-IP + per-route sliding-window limiter; body-size caps; SSE connection cap; request timeouts | E7·T-320c, E6·T-262 |
| **Improper inventory (API9)** | OpenAPI is the single contract; conformance test (T-344); no undocumented routes | E7·T-344 |
| **Error handling / info leak** | typed `ErrorEnvelope` with stable codes; never leak stack/SQL/internal paths | E7·T-314/315 |
| **XXE / XML bombs** | fast-xml-parser with external-entities+DTD disabled (EDXL) | E7·T-304/305 |

## 3. Data plane (Postgres, cache, fixtures)
| Threat | Control | Owner task |
|---|---|---|
| **SQLi** | Drizzle parameterization; DB user least-privilege; no dynamic SQL | E3 repo tasks |
| **PII at rest / retention** | no PII retention past `purgeAfter`; precise geom responder-gated; purge cron | E3·T-129a, E1·T-061 |
| **Tamper / repudiation** | hash-chained append-only `audit_event` (`prev_hash/hash`) | E1·T-082/083, E3·T-104 |
| **Secrets** | env only; `.env` gitignored; gitleaks in CI + pre-commit; `.env.example` secret-free | E0·T-014/015/023/033 |
| **Transport** | TLS 1.3 in cloud (`TLS=on`); local air-gapped needs none | CONFIGURATION §10 |
| **At-rest encryption** | AES-256 volume/DB encryption — **delegated to the managed platform** (Neon/host); documented accepted assumption for the demo, `PGSSLMODE=require` in cloud | accepted-assumption (D-35) |
| **Backup/DR** | pg_dump snapshot + restore verification (demo-day) | E3·T-129b (new) |

## 4. AI plane (governed separately — pointer)
Prompt-injection (direct + indirect), PII egress, jailbreak, model-DoS, insecure output handling, excessive
agency, supply-chain of models → the **bidirectional fail-closed compliance proxy** (ADR-017: input firewall
T-263–268 + output firewall T-278a) + policy-as-code + cost guardrails + red-team corpus (T-292a) + evals
(EVAL_PLAN). Mapped to OWASP LLM Top-10 2025 + ASI + MITRE ATLAS in `COMPLIANCE_MATRIX.md`.

## 5. Network / infra / supply-chain plane
Least-priv containers (non-root, read-only FS where possible) · no unnecessary ports · dependency pinning +
Dependabot + OSV + `npm audit` (PR-blocking) · Semgrep/CodeQL SAST · **DAST (OWASP ZAP baseline)** in CI ·
CycloneDX SBOM + SLSA L2 + cosign signed releases · SHA-pinned GitHub Actions · OpenSSF Scorecard.

## 6. Verification (all in CI)
SAST (Semgrep/CodeQL) · SCA (OSV) · secrets (gitleaks) · **DAST (ZAP baseline)** · **security-headers assertion
test** · XSS/CSRF/authz e2e · dependency + container scan · the AI red-team corpus (T-292a). **Every control
here has a test; a regression fails the PR.** Full STRIDE-per-asset detail: `docs/architecture/THREAT_MODEL.md`.
