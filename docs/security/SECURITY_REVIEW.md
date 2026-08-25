# BEACON — Security Review (S07)

*IEEE Response Quest 2026 · Phase 3 · SDLC phase **S07 (Security Review)** · dated 2026-07-07.*
*Personas: ops-security (adversarial) + eng-qa (verification). Companion to `docs/architecture/THREAT_MODEL.md`,
`docs/architecture/COMPLIANCE_MATRIX.md`, and the S05 code audit (`agents/memory/AUDIT_LOG.md`, 2026-07-07).*

## Verdict: **PASS — no HIGH/critical open findings.**
All HIGH-severity items (from the dependency audit and the adversarial code review) are resolved. The 6
remaining dependency findings are MODERATE, dev/build-time only, not in the production runtime attack
surface, and are documented accepted risks below. This satisfies the S07 gate (no HIGH open; every MEDIUM
has a documented mitigation or accepted risk).

---

## 1. OWASP Top 10 (2021) — web application

| # | Category | BEACON control | Status |
|---|---|---|---|
| A01 | Broken Access Control | RBAC enforced once in the channel-agnostic `command-router` by role rank (Art. XIII), on **every** channel (HTTP/CLI/messaging). HTTP auth is **fail-closed**: a bearer JWT is verified (`resolveRoleJwt`, HS256, explicit alg allow-list — rejects `alg=none`/confusion, verifies `exp`); with no `AUTH_SECRET` the `x-beacon-role` header is honoured ONLY under the explicit demo flag `AUTH_DEV_TRUST_HEADER=on`, else every caller is PUBLIC. Precise PII/geometry gated to responder role (Art. XIV). | ✅ |
| A02 | Cryptographic Failures | Secrets only in env (never committed; `.env` gitignored, `.env.example` documents keys). JWT via `jose` (Web-Crypto). Messaging webhook auth = HMAC-SHA256, timing-safe compare. No secrets in logs/errors/bundle. | ✅ |
| A03 | Injection | Parameterized persistence via Drizzle (no string-built SQL; no user-controlled SQL identifiers — verified). Inbound free-text firewalled (`scanInjection`) before the core on HTTP + messaging. XML parsed with a hardened `XMLParser` config (no entity expansion). React default-escapes all rendered text; no `dangerouslySetInnerHTML`. | ✅ |
| A04 | Insecure Design | Hexagonal ports-and-adapters; deterministic→AI→human keystone (LLM never computes a number, Art. XII); HITL before any public action (no CAP/EDXL emit from an UNVERIFIED report; DRAFT→ACTUAL requires an authenticated approver, enforced at the type level via `EmittableAlert`). Total-redundancy ladder (never a dead-end). | ✅ |
| A05 | Security Misconfiguration | 12-factor config validated fail-fast at boot (Zod). `poweredByHeader:false`. Rate-limit keyed on the trusted resolved role (not a spoofable client header). Errors never leak stacks — only `{code,message}` in the SPEC §196 public vocabulary. | ✅ |
| A06 | Vulnerable Components | `npm audit`: **0 high/critical** (see §4). Dependencies pinned; free/OSS only. | ✅ |
| A07 | Identification & Auth Failures | JWT verification fail-closed; unknown/expired/forged token ⇒ PUBLIC. Messaging: signature → allow-list (deny-by-default) → replay guard (freshness window) → rate-limit → firewall, in that order. | ✅ |
| A08 | Software & Data Integrity | Hash-chained append-only audit log (compliance `AuditChain`) for AI calls + alert emissions + report triage. CAP/EDXL validated against JSON-Schema before emit. | ✅ |
| A09 | Logging & Monitoring | Structured logging (pino), OTel GenAI spans + per-step cost attribution (ADR-022); content redacted from spans by default. Every state-changing action recorded (triage `TriageAuditRecord` with actor). | ✅ |
| A10 | SSRF | No user-controlled outbound URLs; adapters call fixed, vetted endpoints only; live messaging/IPAWS transports are documented MOCK stubs (no arbitrary egress). | ✅ |

## 2. OWASP LLM Top 10 (2025) + AI safety

Every model call routes through the mandatory **AICompliancePort** gateway (ADR-017), fail-closed:
role scope → circuit-breaker → **semantic firewall** (prompt-injection / destructive / secret-access) →
policy-as-code (`policies.yml`) → **PII detect/redact** → cost guardrails → hash-chained audit → upstream.

| Risk | Control | Status |
|---|---|---|
| LLM01 Prompt Injection | Input firewall on all untrusted channel text before the model; the SitRep narrator receives ONLY pre-computed `GroundedFacts` (it cannot be steered to invent figures). | ✅ |
| LLM02 Insecure Output | Output firewall on channel replies + notifications; narration must be *grounded* (every cited source ∈ supplied set) or it degrades to deterministic-only. | ✅ |
| LLM05/06 Sensitive-info disclosure | PII redaction in the gateway and in the outbound `NotificationPort` (email/phone/precise-coordinate pairs stripped) — cited engine figures preserved (Art. XII). | ✅ |
| LLM08 Excessive Agency | LLM is narrate-only (no tool/number/emit capability by design); HITL gates every public action. | ✅ |
| LLM10 Unbounded Consumption | Cost guardrails (consumption/temporal/loop/delegation/idempotency) + per-incident/region budget caps; soft within budget, HITL above threshold. | ✅ |

## 3. Threat-model mitigations (THREAT_MODEL.md) — verified implemented
- Deterministic source of truth (F3) — the LLM path is unreachable for numeric output; verified by the
  `sitrep-synthesis` tests + the redundancy AI-off acceptance suite.
- HITL before public action (F8, Art. XIII) — no channel verb reaches `AlertSinkPort.emit`; approval is a
  separate authenticated VERIFIER+ step; verified by CLI/HTTP/alerting tests.
- Provenance + citations structural (F1/F2) — the envelope contract (non-empty `provenance[]`, per-field
  `citations[]`) is enforced in the router (`ensureProvenance`) and the FE fetch wrapper rejects an
  ungrounded response.
- Responsible data (Art. XIV) — consent is a compile-time precondition on report intake; precise geometry
  is responder-gated on the API and the map.

## 4. Dependency audit (`npm audit`) — triage

**Resolved this pass:**
- 🔴 **HIGH — drizzle-orm SQL-identifier escaping** (GHSA advisory): upgraded `drizzle-orm 0.38 → 0.45.2`
  (+ `drizzle-kit 0.31.10`). Note: BEACON never passes user input as a SQL identifier (static schema
  constants only — grep-verified), so it was not exploitable here; upgraded regardless. Persistence tests green.
- 🟡 **fast-xml-parser XMLBuilder injection**: upgraded `4.5 → 5.x`. BEACON only uses `XMLParser` (inbound
  parsing), never the vulnerable `XMLBuilder`, so it never applied; cleared anyway. XML tests green.

**Remaining — 6 MODERATE, all dev/build-time, ACCEPTED (tracked):**
- `esbuild` (dev-server request SSRF) reachable only via **`drizzle-kit`** — a local migration/dev tool,
  never shipped or exposed in the production runtime. npm's suggested "fix" (`drizzle-kit@0.18.1`) is a
  major **downgrade** that would break migrations; rejected.
- `postcss` (CSS-stringify XSS) via **Next's build pipeline** — a build-time transform, not a runtime code
  path; npm's suggested "fix" (`next@9.3.3`) is a false major downgrade of the framework; rejected. Next
  15.5's bundled toolchain is current.
- **Accepted-risk rationale:** none affect the deployed application's attack surface (all are dev/build
  tooling); the advised remediations are incorrect downgrades. Re-evaluate on the next Next.js / drizzle-kit
  minor that resolves the transitive pin. `npm audit` production floor: **0 high, 0 critical.**

## 5. Code-audit findings (S05, 2026-07-07) — all resolved
The adversarial 3-reviewer code audit's 14 findings were fixed and re-greened (see `AUDIT_LOG.md`):
RBAC (`alert:draft`→VERIFIER), fail-closed auth header, F1 provenance guarantee, 422/CONSENT_REQUIRED,
report `geomPrecise`, triage NOT_FOUND + actor audit, NotificationPort PII redaction, HTTP input firewall,
role-keyed rate-limit, messaging replay freshness window, webhook-secret documentation.

## 6. Residual / deferred (documented, non-blocking)
- Per-**user** identity (beyond role) arrives with full JWT claims — currently actor = `user-<role>` (stub,
  documented in code); the RBAC gate itself is real.
- Live messaging/IPAWS transports are MOCK by design in the demo (no external origination).
- SW cache deny-list for auth/precise-PII responses lands with the PWA offline work.

## 7. Addendum (2026-07-08) — `GET /regions/:id/map` surface reviewed post-S07
The new PUBLIC-readable map-projection route (`src/adapters/channels/http/routes/map.ts`) was reviewed and
cleared:
- **Read-only, no injection surface.** GET-only; the sole input is the path `regionId` (used as a read-model
  key, never interpolated into SQL/HTML). Unknown region → 404. No body, no query mutation.
- **Precise geometry RESPONDER-gated (Art. XIV).** The projection withholds `precisePosition` from PUBLIC and
  reveals it only to RESPONDER+ — the gate is server-side in the pure use-case, keyed on the resolved role
  (`projectMap` → `isResponder(input.role)` in `src/application/map-projection/map-projection.ts`), so a
  client cannot request it. Regression-locked by `routes/map.test.ts` (asserts PUBLIC omits it and RESPONDER
  sees the exact seeded coordinate).
- **Envelope contract enforced.** Responds with the canonical `{ data, provenance[], freshness }` envelope;
  provenance is non-empty on success (F1 / U1). No secret or internal detail on any path.
- **Net assessment:** no new attack surface; consistent with the existing PUBLIC read endpoints (`/status`,
  `/incidents`). Now documented in `docs/api/openapi.yaml` (path + `MapProjection` schema).

## SECURITY_CHECKLIST (S07 gate)
- [x] Authentication verified fail-closed (JWT alg-allowlist; PUBLIC default)
- [x] Authorization (RBAC) enforced server-side on every channel
- [x] Secrets only in env; none committed / logged / in bundle
- [x] Injection defenses (SQL parameterized, input firewall, XML hardened, output escaped)
- [x] HITL before every public action (Art. XIII) — type-level enforced
- [x] PII handling (consent gate, responder-gated precise geometry, redaction on egress — Art. XIV)
- [x] Audit trail (hash-chained) on AI calls, emissions, triage
- [x] Error hygiene (no stack/secret leakage; SPEC §196 public codes)
- [x] Dependency audit: **0 high/critical**; moderates documented + accepted
- [x] AI compliance gateway fail-closed on every model call (OWASP LLM Top-10)
- [ ] *(deferred)* automated axe WCAG 2.2 scan + Playwright security e2e (XSS-inert render)
