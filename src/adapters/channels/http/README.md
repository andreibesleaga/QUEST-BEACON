# HTTP channel adapter (E7)

A **framework-agnostic** driving adapter over the shared core (ADR-023). `handleHttp(req, deps)` is a pure
function of its inputs — it resolves the actor role, rate-limits, maps a REST route onto ONE existing
`Command` verb, stamps `receivedAt` from the injected clock, dispatches through `buildInteraction()`'s
`InteractionPort`, and serializes the universal `Envelope`. **Zero core change**; the `command-router` owns
RBAC + business logic. Tested deterministically without spinning up Next.js.

## Files

| File | Responsibility |
|---|---|
| `http-types.ts` | `HttpRequest` / `HttpResponse` / `HttpDeps` / `RateLimiter` transport-neutral contracts |
| `rbac.ts` | Real per-user identity: verified JWT `{role, sub}` (jose HS256, fail-closed) + rate-limit key (ADR-025) |
| `rate-limit.ts` | Naive per-actor token bucket (injected clock → deterministic) |
| `error-mapping.ts` | `DomainError.code` → HTTP status (SPEC §2.3); channel error envelope |
| `routing.ts` | REST route → canonical `Command` mapping + body validation |
| `sustainability.ts` | Standalone `/.well-known/sustainability` (schema-valid, cached, non-blocking) |
| `http-dispatcher.ts` | `handleHttp` + `createHttpDeps` / `getHttpDeps` (build core ONCE, reuse) |
| `credentials.ts` | Named-user accounts from `AUTH_USERS` behind `POST /auth/login` (scrypt-derived keys, constant-time compare) |
| `index.ts` | Barrel: the public exports of this channel |
| `routes/` | Feature routes beside the core commands (`feature-router.ts` and one module per area: interop, logistics, panels, map, stream, queue, incidents, threshold rules, audit events, adapter health, incident summary) |

The Next.js App-Router delegators (`app/api/v1/[...path]/route.ts`,
`app/.well-known/sustainability/route.ts`) are trivial: `Request → HttpRequest → handleHttp → Response`.

## Implemented routes (mapped onto the existing Command set)

| Method · Path | Command | Min role | Success |
|---|---|---|---|
| `GET /api/v1/status` | `{verb:'status', regionId?}` | PUBLIC | 200 |
| `GET /api/v1/regions` | `{verb:'regions'}` | PUBLIC | 200 |
| `GET /api/v1/regions/{id}/incidents` | `{verb:'incidents', regionId}` | PUBLIC | 200 |
| `GET /api/v1/incidents/{id}/sitrep` | `{verb:'sitrep', incidentId}` | PUBLIC | 200 (+ citations) |
| `GET /api/v1/sources` | `{verb:'sources', regionId?}` | PUBLIC | 200 |
| `POST /api/v1/reports` `{text,consent,lat?,lng?}` | `{verb:'report',…}` | PUBLIC | 201 |
| `PATCH /api/v1/reports/{id}` `{decision,emitCap?}` | `{verb:'verify',…}` | VERIFIER | 202 |
| `POST /api/v1/alerts` `{incidentId,headline}` | `{verb:'alert:draft',…}` | VERIFIER | 201 |
| `GET /api/v1/health` | — (liveness probe) | PUBLIC | 200 `{status:'ok'}` |
| `GET /api/v1/me` | — (echoes resolved role) | PUBLIC | 200 `{role}` |
| `GET /.well-known/sustainability` | — (plugin, origin-root) | PUBLIC | 200 (schema-valid) |

RBAC is enforced by the `command-router`'s `MIN_ROLE` gate (identical on every channel), so PUBLIC on
`PATCH /reports` or `POST /alerts` returns **403** without any adapter-local check.

## Route status (Phase-B/D)

Most of the originally-deferred routes are now **served** (Phase-B/D): `POST /routes`, `GET|POST /resources`,
`POST /resource-tasks`, `POST /alerts/{id}/approve` (the HITL emit gate, `feature-router.ts`), `POST /edxl/rm`
+ `GET /edxl/rm/{id}` + `POST /edxl/sitrep`, `GET /stream` (SSE), `GET /regions/{id}/map`,
`GET /pre-positioning` (RESPONDER+, W2d — advisory pre-positioning suggestions), `POST /auth/dev-login`,
`GET /regions` (the shipped-zone registry — B1.2/finding F-01, served via the new `regions` verb),
plus the core `status`/`incidents`/`sitrep`/`sources`/`reports`/`alerts` surface. Inbound Telegram
(`POST /channels/telegram/webhook`, W4b) is served but lives OUTSIDE this dispatcher — it is a separate Next
route (`app/api/v1/channels/telegram/webhook/route.ts`) that calls the pure `handleTelegramWebhook`
(`../messaging/telegram-webhook.ts`) directly, not `handleHttp`/`resolveRoute`/`handleFeatureRoute`; see that
file's header for its own (non-envelope) response contract. The five formerly-planned reads —
`GET /incidents/{id}`, `GET /incidents/{id}/exposure`, `GET /health/adapters`, `GET /threshold-rules`,
`GET /audit-events` — are **served since S1 (2026-08-07)**: the first two in `feature-router.ts`
(`incidentGetRoute` / `incidentExposureRoute`), the other three via their dedicated route modules
(`adapter-health.ts`, `threshold-rules.ts`, `audit-events.ts`); the `x-status: planned` markers were
removed from `docs/api/openapi.yaml` in the same session.

## Security notes

- **RBAC is real JWT (Phase-B, ADR-025).** `rbac.ts` `resolvePrincipal` verifies an `authorization: Bearer`
  JWT with jose (HS256, pinned `alg` allow-list — rejects `alg=none`/alg-confusion, `exp` enforced), returns
  `{role, sub}` from the *verified* claims, and fails **closed** to `PUBLIC` on any failure. The audit actor
  is the true `sub` (else the role key); a body-supplied `actorId` is rejected 400. `x-beacon-role` is honoured
  **only** as the offline-demo affordance when `AUTH_DEV_TRUST_HEADER=on` (else PUBLIC). A `POST /auth/dev-login`
  demo IdP is opt-in (`AUTH_SECRET` + `AUTH_DEV_LOGIN=on`) and hard-off in production/cloud builds.
- **Rate limit is a channel-local floor** (in-memory token bucket). The production guard (per-IP + per-route
  sliding window, body-size caps) lands with E7·T-320c.
- Errors never leak a stack/internal message: the body is always `{code, message}` (a non-domain throw
  becomes an opaque `500`).
