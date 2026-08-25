# Epic E7 — Interop (CAP/EDXL) · API layer (22 operations / 21 paths) · out-of-core plugins

> Owner personas: **eng-api · eng-backend** (tests **eng-qa**) · Waves W2–W3 · IDs `E7·T-290…T-344`
> API routes are THIN (validate → delegate to E5 use-cases → envelope). Envelope `{data, provenance[],
> freshness, meta?, errors?}` mandatory (**F1**); SitRep adds citations[] (**F2**). Interop via EdxlPort
> ACL: CAP v1.2, full EDXL-RM round-trip, EDXL-SitRep (CS02), GeoJSON (**F15**). HITL before public action
> (**F8**). Plugins (sustainability, CAMARA-mock) are non-blocking.
>
> **Auth blast-radius:** T-320→T-325 (JWT+RBAC+org-guard) MUST precede protected routes (T-335…T-341),
> **not [PARALLEL]** with them. *Note: E7 IDs T-290…T-292 overlap E6 numerically — disambiguated by epic.*

### Interop — CAP + EDXL (EdxlPort ACL)
| ID | Task | Persona | Deps | Wave | Tags | Trace | Acceptance |
|---|---|---|---|---|---|---|---|
| T-290 | Contract test: CAP v1.2 builder validates vs `cap-v1.2.schema.json` (Draft default) | eng-qa | — | W2 | [PARALLEL] {contract-testing} | FR-9/ADR-010/§7.1 | Red; schema-valid Draft alert |
| T-291 | Implement CAP v1.2 builder: Alert → CAP alert/info/area (generalized, no PII) | eng-backend | T-290 | W2 | {api-design} | FR-9/ADR-010/§7.1 | PII fields absent from output |
| T-292 | Test: CAP validator rejects Actual without approvedBy (→409) | eng-qa | T-291 | W2 | [SEC] {contract-testing} | F8/ADR-010/§7.1 | Red; Actual-without-approver not yet rejected |
| T-293 | Implement CAP validate-before-emit gate (reject Actual w/o approver) | eng-backend | T-292 | W2 | [SEC] {api-design} | F8/ADR-010/§7.1 | only approved alerts serialize as Actual |
| T-294 | Test: `deploymentStatus`→RESOURCE_TASK.status map (9→5, informational cases) | eng-qa | — | W2 | [PARALLEL] {contract-testing} | F15/§7.2.1 | Red; table-driven map incl. Available/Unavailable=no-op |
| T-295 | Implement deploymentStatus↔task-status mapping table (deterministic) | eng-backend | T-294 | W2 | {api-design} | F15/§7.2.1 | informational values do not transition task |
| T-296 | Test: EDXL-RM inbound parse validates vs `edxl-rm.schema.json` (RequestResource) | eng-qa | — | W2 | [PARALLEL] {contract-testing} | F15/ADR-010/§7.2 | Red; rejects malformed, accepts valid |
| T-297 | Implement EDXL-RM request-mapping: RequestResource → RESOURCE_TASK(PROPOSED) + edxlRmRef | eng-backend | T-296,T-295 | W3 | {api-design} | F15/§7.2 | task created with round-trip ref |
| T-298 | Test: commit-mapping CommitResource → TASKED, locks resource to org | eng-qa | T-297 | W3 | [SEC] {contract-testing} | F15/§7.2 | Red; commit transition + org-lock |
| T-299 | Implement EDXL-RM commit-mapping (Commit/Ack→TASKED; Release/RequestReturn→CLEARED) | eng-backend | T-298 | W3 | {api-design} | F15/§7.2 | lifecycle transitions match table |
| T-300 | Test: response-mapping ResponseToRequest/OfferUnsolicited → match, PROPOSED→TASKED | eng-qa | T-299 | W3 | {contract-testing} | F15/§7.2 | Red; response/offer path |
| T-301 | Implement response/offer mapping + messageId/originatingMessageID correlation | eng-backend | T-300 | W3 | {api-design} | F15/§7.2 | round-trip correlation id assigned |
| T-302 | Round-trip conformance test: import→canonical→re-export request→commit→response | eng-qa | T-301 | W3 | [PARALLEL] {contract-testing} | F15/ADR-010/§7.2 | `edxl-roundtrip.feature` red |
| T-303 | Implement EDXL-RM re-serializer (canonical → EDXL-RM), validate vs schema | eng-backend | T-302 | W3 | {api-design} | F15/§7.2 | re-export schema-valid, chain preserved |
| T-304 | Test: XML EDXL serializer has XXE/entity-expansion disabled | eng-qa | — | W2 | [SEC][PARALLEL] {contract-testing} | T2.4/§7 | Red; XXE payload rejected/inert |
| T-305 | Implement XML EDXL serializer with XXE+DTD+entity-expansion hardening | eng-backend | T-304 | W2 | [SEC] {api-design} | T2.4/§7 | external entities disabled |
| T-306 | Test: EDXL-SitRep serializer validates vs `edxl-sitrep.schema.json` | eng-qa | — | W2 | [PARALLEL] {contract-testing} | F15/ADR-010/§7.3 | Red; serializer missing |
| T-307 | Implement EDXL-SitRep serializer: SitRep+exposure → EDXL-SitRep 1.0 (CS02 subset) | eng-backend | T-306 | W2 | {api-design} | F15/§7.3 | schema-valid SitRep produced |
| T-308 | Test: EDXL-SitRep PII-screen strips precise location/contact | eng-qa | T-307 | W2 | [SEC] {contract-testing} | T2.6/§7.3 | Red; PII absent from SitRep |
| T-309 | Implement EDXL-SitRep PII-screen pass (reject/strip precise geom + contact) | eng-backend | T-308 | W2 | [SEC] {api-design} | T2.6/§7.3 | no PII in serialized output |

### API envelope, errors, realtime, auth
| ID | Task | Persona | Deps | Wave | Tags | Trace | Acceptance |
|---|---|---|---|---|---|---|---|
| T-310 | Test: envelope serializer wraps data with non-empty provenance[] + freshness | eng-qa | — | W2 | [PARALLEL] {contract-testing} | F1/§2.1 | Red; wrapper does not exist |
| T-311 | Implement `ResponseEnvelope` serializer (mode UPPERCASE mapping) | eng-backend | T-310 | W2 | {api-design} | F1/§2.1 | every wrapped response carries provenance+freshness |
| T-312 | Test: SitRep envelope adds citations[] (100% field coverage) | eng-qa | T-311 | W2 | {contract-testing} | F2/§2.4 | Red; citations[] not enforced |
| T-313 | Implement `SitrepEnvelope` serializer (mandatory citations[]) | eng-backend | T-312 | W2 | {api-design} | F2/§2.4 | each SitRep field grounded by ≥1 citation |
| T-314 | Test: typed error envelope maps domain errors → stable codes | eng-qa | — | W2 | [PARALLEL] {contract-testing} | §2.6 | Red; error-code mapping absent |
| T-315 | Implement typed `ErrorEnvelope` serializer (stable code map + field details) | eng-backend | T-314 | W2 | {api-design} | §2.6 | each domain error → correct code+status |
| T-316 | Test: circuit-breaker degraded path → 200 + meta.status=degraded + SOURCE_DEGRADED | eng-qa | T-315 | W3 | {contract-testing} | UW2/§2.3/ADR-006 | Red; degraded-200 envelope |
| T-317 | Implement degraded-envelope helper (200 LKG) + 503-only-on-total-outage | eng-backend | T-316 | W3 | {api-design} | UW2/§2.3 | cache/mock → 200 degraded; no-fallback → 503 |
| T-318 | Test: cursor pagination meta.page {nextCursor,hasMore,limit} | eng-qa | T-311 | W2 | {contract-testing} | §2.6/GET incidents | Red; pagination missing |
| T-319 | Implement cursor pagination serializer (limit 50/max 200, sort updated_at desc,id) | eng-backend | T-318 | W2 | {api-design} | §2.6/GET resources | nextCursor round-trips stably |
| T-320 | Test: JWT verify middleware rejects missing/invalid bearer → 401 | eng-qa | — | W3 | [SEC] {auth} | §10.2/all-protected | Red; invalid token must 401 |
| T-321 | Implement JWT auth middleware (verify AUTH_SECRET, extract role+org; **pin `alg` allowlist** — reject `alg=none`/alg-confusion) | eng-backend | T-320 | W3 | [SEC] {auth} | §10.2/all-protected/SECURITY_BASELINE §2 | valid → user ctx; invalid/`alg=none`/wrong-alg → 401 |
| T-320a | **CSRF protection**: `SameSite=Strict` + `Secure` + `HttpOnly` session cookies; Origin/double-submit check on all state-changing routes; JWT-in-Authorization for API (no ambient-cookie auth) | eng-backend | T-321 | W3 | [SEC] {auth} | SECURITY_BASELINE §1/API/D-35 | cross-origin state-change → 403; cookie flags asserted |
| T-320b | **Security-headers + CSP middleware**: strict CSP (nonce, `default-src 'self'`, `frame-ancestors 'none'`, no unsafe-inline/eval), HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy(geo self), COOP/CORP | eng-backend | — | W3 | [SEC] {auth} | SECURITY_BASELINE §1/D-35 | headers present on every response; CSP has no unsafe-*; clickjacking blocked |
| T-320c | **Global rate-limit + DoS guards**: per-IP + per-route sliding-window (rate-limiter-flexible), request body-size caps, SSE connection cap, per-request timeouts | eng-backend | T-321 | W3 | [SEC] {auth} | SECURITY_BASELINE §2/API4/D-35 | over-limit → 429; oversized body → 413; SSE cap enforced |
| T-320d | **CORS allowlist** (deny-by-default; only configured origins; no `*` with credentials) | eng-backend | T-321 | W3 | [SEC] {auth} | SECURITY_BASELINE §1/D-35 | foreign origin blocked |
| T-320e | **SSRF fetch-layer egress guard** (defense-in-depth beyond the host allowlist): a shared HTTP client that **resolves-then-blocks** link-local/metadata/private ranges (169.254/::1/127/10/172.16/192.168) to defeat DNS-rebinding; all adapter + news-search fetches go through it | eng-backend | E4:T-142 | W3 | [SEC] {auth} | SECURITY_BASELINE §2/A10-API7/D-35 | fetch to a host that resolves to 169.254.169.254 / a private IP is blocked (e2e in E9·T-430a) |
| T-322 | Test: RBAC role-gate enforces min role (PUBLIC<RESPONDER<VERIFIER<EM) → 403 | eng-qa | T-321 | W3 | [SEC] {auth} | §B.Q6/all-protected | Red; under-privileged → 403 |
| T-323 | Implement RBAC role-gate middleware — **precedes protected routes (NOT [PARALLEL])** | eng-backend | T-322 | W3 | [SEC] {auth} | §B.Q6/all-protected | role below threshold → 403 |
| T-324 | Test: org-ownership (BOLA/BFLA) guard on resource/EDXL writes → 403 cross-org | eng-qa | T-323 | W3 | [SEC] {auth} | T2.8/POST edxl,resources | Red; cross-org write → 403 |
| T-325 | Implement org-ownership guard (RESPONDER own-org, EM any) | eng-backend | T-324 | W3 | [SEC] {auth} | T2.8/POST edxl,resources | own-org allowed, foreign blocked |
| T-326 | Test: SSE frame format id:/event:/data: + heartbeat | eng-qa | — | W3 | [PARALLEL] {realtime} | ADR-006/GET stream/§2.5 | Red; no framer/heartbeat |
| T-327 | Implement SSE stream framer (text/event-stream, monotonic id, heartbeat, region-keyed) | eng-backend | T-326,T-311 | W3 | {realtime} | ADR-006/GET stream/§2.5 | frames well-formed; heartbeat emitted |
| T-328 | Test: per-region delta coalescing debounces within window | eng-qa | T-327 | W3 | {realtime} | ADR-006/§2.5 | Red; bursts not coalesced |
| T-329 | Implement delta coalescing/debounce per region (default 1500ms) | eng-backend | T-328 | W3 | {realtime} | ADR-006/§2.5 | N deltas in window → 1 frame |
| T-330 | Test: Last-Event-ID reconnect backfills missed deltas in order | eng-qa | T-329 | W3 | {realtime} | ADR-006/§2.5 | Red; backfill not implemented |
| T-331 | Implement Last-Event-ID backfill buffer + replay on reconnect | eng-backend | T-330 | W3 | {realtime} | ADR-006/§2.5 | missed deltas replayed once |
| T-332 | Test: polling fallback returns same delta contract since Last-Event-ID | eng-qa | T-331 | W3 | {realtime} | ADR-006/OP2 | Red; polling path absent |
| T-333 | Implement polling-fallback branch (StreamEvent[] since cursor) | eng-backend | T-332 | W3 | {realtime} | ADR-006/OP2 | polling yields identical deltas |

### Routes (thin) + plugins
| ID | Task | Persona | Deps | Wave | Tags | Trace | Acceptance |
|---|---|---|---|---|---|---|---|
| T-334 | Thin GET route group (regions, regions/:id/incidents, incidents/:id, exposure, sources) → use-cases | eng-api | T-311,T-317,T-323 | W3 | {api-design} | FR-1/§2.2 | validate→delegate→envelope; no domain logic in route |
| T-334b | `GET /health` (liveness) + `GET /ready` (DB reachable + migrations applied) routes; wired to docker-compose app `healthcheck` (prod-grade boot) | eng-api | T-315 | W3 | [PARALLEL] {api-design} | SECURITY_BASELINE/S05_READINESS/D-35 | /health 200 always-up; /ready 503 until DB+migrations ready |
| T-311a | **Structured logging + request-id middleware** (pino; per-request correlation id propagated to logs + OTel span + error envelope; PII-redacted) | eng-backend | T-315 | W3 | {api-design}{observability} | SECURITY_BASELINE §3/ADR-022/D-35 | every request logs a correlation id; no PII in logs |
| T-333b | **Graceful shutdown** in `src/main` bootstrap: SIGTERM → drain SSE, close PG pool, stop CRON, flush audit; exit clean | eng-backend | T-327 | W3 | {api-design} | S05_READINESS/D-35 | SIGTERM drains connections; `docker compose down` exits clean |
| T-334a | `GET /health/adapters` route → E4 registry health aggregation; returns `AdaptersHealthReport` (operational, non-envelope, always 200 while up) | eng-api | E4:T-145,T-315 | W3 | [PARALLEL] {api-design} | FR-2/UW2/ADR-009/§2.2 | schema-valid report; per-adapter breaker state/mode/freshness |
| T-335 | Auth test + thin GET group (resources, threshold-rules, audit-events, me) w/ role gate | eng-api | T-323,T-334 | W3 | [SEC] {api-design} | §B.Q6/§2.2 | under-role → 403; correct role → enveloped data |
| T-336a | **Anti-automation on public SOS** (API6): lightweight proof-of-work OR hCaptcha-free honeypot + stricter per-IP rate-limit on `POST /reports`; no cognitive puzzle (WCAG 2.2 §3.3.8) | eng-backend | T-320c | W3 | [SEC] {auth} | SECURITY_BASELINE §2/API6/D-35 | scripted flood throttled; accessible (no CAPTCHA puzzle) |
| T-336 | HITL test + `POST /reports` (consent-gate 422, UNVERIFIED, PII responder-only) | eng-api | T-311,T-315 | W3 | [SEC] {api-design} | F8/§2.2 | missing consent → 422; public omits precise geom |
| T-337 | HITL test + `PATCH /reports/:id` (VERIFIER, emitCap→meta.emittedAlert, no CAP from UNVERIFIED) | eng-api | T-323,T-293 | W3 | [SEC] {api-design} | F8/§2.2 | UNVERIFIED→CAP blocked; VERIFIED+emitCap → DRAFT |
| T-338 | Auth test + `POST /alerts` (VERIFIER, CAP validate, Actual-w/o-approver→409) | eng-api | T-293,T-323 | W3 | [SEC] {api-design} | F8/§2.2 | Actual w/o approver → 409; Draft → 201 |
| T-339 | Auth test + `POST /edxl/rm` + `GET /edxl/rm/:id` (RESPONDER/EM, org-checked, round-trip) | eng-api | T-303,T-325 | W3 | [SEC] {api-design} | F15/§2.2 | cross-org → 403; round-trip chain on GET |
| T-340 | Auth test + `POST /edxl/sitrep` (EM, PII-screened, AUDIT_EVENT) | eng-api | T-309,T-323 | W3 | [SEC] {api-design} | F15/§2.2 | non-EM → 403; PII-free; audit written |
| T-341 | Test + `POST /routes` + `POST /resources` + `POST /resource-tasks` (ST1: task only from VERIFIED) | eng-api | T-311,T-325 | W3 | [SEC] {api-design} | F8/§2.2 | task from non-VERIFIED → 409; valid → 201 |
| T-342 | Test + `GET /.well-known/sustainability` (origin-root, schema-valid, Cache-Control/ETag) — plugin | eng-api | T-315 | W3 | [PARALLEL] {api-design} | FR-14/ADR-020/F18 | non-blocking; validates vs schema, cached headers |
| T-343 | Mock test + `camara-gsma` MOCK TelecomPort adapter + manifest entry — plugin | eng-backend | — | W3 | [PARALLEL] {api-design} | FR-16/ADR-021 | aggregate-only TelecomSignal from fixture; manifest mode=MOCK |
| T-343a | **Mass-assignment / BOPLA contract test**: extra/unknown body fields are ignored (DTO allowlist, never spread into entities); non-responder response omits PII/precise-geom fields (API3) | eng-qa | T-334,T-336 | W3 | [SEC] {contract-testing} | SECURITY_BASELINE §2/API3/D-35 | injected `role`/`id`/extra fields ignored; PII absent for PUBLIC |
| T-344 | OpenAPI↔routes conformance test (`redocly lint` + response-shape parity, all 22 operations / 21 paths) | eng-qa | T-334,T-334a,T-342 | W3 | [PARALLEL] {contract-testing} | §2.2/openapi.yaml | redocly passes; each route matches its schema |

**Cross-epic / proxy routing:** Only LLM-path endpoints route through **E6 AICompliancePort** — `GET /incidents/:id/sitrep` (narration) and indirectly `POST /edxl/sitrep`. The other 20 endpoints are deterministic and must NOT touch the proxy (tests assert zero model calls in CAP/EDXL-RM/exposure/route paths).
**✅ RESOLVED (D-27):** `GET /health/adapters` **added** to `openapi.yaml` (path + `AdapterHealth`/`AdaptersHealthReport` schemas + `System` tag) and SPEC §2.2 — role PUBLIC, operational (non-envelope) `AdaptersHealthReport`, always 200 while up; backs E4's health/"stale" badge (E4:T-145) via new route task T-334a. API surface is now **22 operations across 21 paths** (OpenAPI machine-counted).
**🟡 Minor reconciliations:** `POST /alerts` role (OpenAPI VERIFIER vs desc "VERIFIER or EM" → treated min-role VERIFIER); `POST /edxl/sitrep` role (OpenAPI EM vs SPEC "VERIFIER/EM" → EM canonical). EDXL-RM maps only the ~6 task-transition messageTypes; the other 8 are accepted+audited but informational.
