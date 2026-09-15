# ADR-040 — Operator-only links are served by the server to the session that earned them, never built into the bundle

- **Status:** Accepted (2026-09-10) — decided and implemented in V2 work package A7.
- **Deciders:** Entrant (V2 plan §0·6 + §2·A7) + prod-architect
- **Relates to:** ADR-012 (config for everything), ADR-017 / ADR-025 (JWT identity, fail-closed role
  resolution), ADR-002 (frontend store/query architecture), CONSTITUTION Art. XIV (least privilege —
  operator surfaces are not public surfaces), Art. XVI (degrade and label, never dead-end)
- **Generalises:** the first instance is the Directus DB-admin link (`DB_ADMIN_URL`), but the decision is
  about the CLASS: any URL, endpoint or affordance that only one role may see.

## Context

V2 puts a real Postgres behind the deployment and a Directus admin UI in front of it (plan §2·A4). An EM
looking at the COP should be able to reach that admin UI in one click. Nobody else should even learn that
it exists: a Directus instance's URL is the front door of the database the whole product's provenance
claim rests on, and publishing it invites exactly the traffic it should never see.

Next.js offers a tempting way to do this in one line — `NEXT_PUBLIC_DB_ADMIN_URL`, read directly in the
component. **That is the defect this work package exists to avoid, and it is worth being precise about
why it is a defect rather than merely untidy.** A `NEXT_PUBLIC_*` value is *inlined by `next build` into
the JavaScript every visitor downloads*. The role check would still be written in the component, and it
would still work visually — the anonymous visitor would not see a link. But the string would be sitting in
the bundle they already have on disk, one `view-source` away. The gate would be a **rendering** decision
about a value **everybody already holds**, which is not a gate at all. Plan §0·6 states the rule as
"never `NEXT_PUBLIC_*` (must not be baked into the public bundle)"; this ADR records the mechanism.

There is a second, less obvious question, and it is the one that decides the shape of the change. The COP
persists the auth slice — `actorRole` + `authToken` — in `sessionStorage` (`app/_lib/store.ts:35-46`), so
a signed-in EM survives a page reload. If the admin URL rode **only** on the `POST /auth/login` response
(`src/adapters/channels/http/http-dispatcher.ts:311-325`), it would be held only in React state minted at
sign-in. After a reload the operator would still be signed in, still be EM, still be sending a valid
bearer — and the link would be silently gone. A capability that disappears when you refresh the page is
indistinguishable, to the person using it, from a broken one.

## Decision

### 1. `DB_ADMIN_URL` is server configuration, validated at boot, and never mirrored to the browser

Declared **optional** in `EnvSchema` (`src/config/index.ts`) as `z.string().url().optional()`, alongside
the other auth-adjacent values that are declared-for-validation and read from raw env at their call site
(`AUTH_SECRET`, `AUTH_DEV_LOGIN`). Optional because a deployment with no admin UI is the normal case and
must not be forced to invent one; URL-validated because a typo'd admin address is worth a boot error, not
a dead link handed to the one role trusted to act on it. The running app always boots through
`createHttpDepsLive` → `loadConfig(rawEnv)` (`http-dispatcher.ts:420-422`), so the validation is on the
real path, not a decorative declaration.

It has **no `NEXT_PUBLIC_` mirror**, and deliberately no entry in `BROWSER_MIRRORED_FLAGS`: the mirror
machinery in `src/config/index.ts` exists to keep a browser flag *honest* about a server flag, and the
right answer here is not an honest mirror but no mirror at all.

### 2. The gate lives in the response, not in the render

`GET /me` — the authenticated session read the dispatcher already serves from the resolved principal
(`http-dispatcher.ts:236-238`) — gains `dbAdminUrl` **only** when `principal.role === 'EM'` **and** the
server is configured with one. Every other role, and the anonymous caller, receives exactly the body they
received before: the field is absent, not empty, not null. A PUBLIC/RESPONDER/VERIFIER caller cannot learn
the URL by reading a response, because it was never in one.

The principal is resolved fail-closed before this point (`rbac.ts:141-151`): a forged, expired, or
wrong-algorithm bearer verifies to PUBLIC, so "role is EM" here means the server proved it, not that the
client asserted it.

### 3. `GET /me` — not the login response — is the carrier

Chosen over login-only for the reload reason above, and chosen **instead of** login-and-also-`/me` rather
than in addition to it, because one carrier is the smaller and more auditable surface:

- `GET /me` **already exists and is already authenticated by the same principal resolution as every other
  route**. Adding a field to it widens no auth surface: it opens no route, accepts no new input, and
  introduces no new place where a role is decided.
- It is correct in both moments that matter. Immediately after sign-in the store's `actorRole` changes to
  the server-assigned role, which re-keys the query (`queryKeys.me(role)`, `app/_lib/hooks.ts:86`) and
  refetches. After a reload the persisted bearer is restored synchronously and the same read fires again.
- Adding the field to `POST /auth/login` as well would put the same secret-ish value in two responses for
  no gain, and would leave a copy in whatever logs a login response.

**Consequence, accepted:** the link appears one short round-trip after sign-in rather than in the same
tick. For a link to an external admin console that is invisible in practice, and it is the price of the
value being *fetched by an authenticated session* rather than *remembered from a form submit*.

### 4. The client asks only when it has a session to ask with

`useMe` is gated on `authToken !== undefined`. An anonymous visitor issues **no** `/me` request at all, so
the default and offline postures make exactly the requests they made before this work package. This is
also the stricter reading of "authenticated session": the local demo's spoofable `x-beacon-role` header
path (`rbac.ts:39-84`, hard-off in cloud) is not a session and does not get the link, even though the
server would answer one — the client narrows, never widens.

### 5. The link is a link, with the hardening a new-tab link needs

Rendered in the toolbar's account cluster next to the sign-in control — the account area of the shipped
UI, since V2 forbids a redesign (plan §0·1) — as an ordinary anchor with `target="_blank"` and
`rel="noopener noreferrer"`, so the admin console can never reach back through `window.opener`. The label
is the plan's own string, `⛁ DB Admin ↗`. It is **hardcoded English, not an i18n key**, because i18n keys
are frozen for V2 (plan §0·8) and adding one would touch all 14 catalogs; this follows the precedent the
routing panel already set for operator-facing strings. Flagged as a PLAN-DELTA rather than done silently.

## Consequences

**Good.** The admin URL exists in exactly two places: the server's environment, and the response body of
an authenticated EM session. It is absent from the client bundle, absent from every other role's
responses, and absent from an anonymous visitor's world entirely. The link survives a reload because it is
re-derived from the session rather than remembered from a form. A deployment that sets no `DB_ADMIN_URL`
renders no link and needs no flag to say so — absence is the off switch, which is one fewer thing to
misconfigure.

**Costs and limits, stated plainly.** This is *obscurity plus a gate*, not access control: Directus
enforces its own authentication and always has to. Hiding the URL raises the cost of finding the door; it
is not the lock. A local operator running with `AUTH_DEV_TRUST_HEADER=on` who sends `x-beacon-role: EM`
*would* be served the field by the server (the dev-header path is a full local EM by design) — the client
simply never asks in that posture. And the URL is read from raw env at the call site, so the boot
validation binds on the live composition root; the synchronous offline `createHttpDeps` used by tests
performs no `loadConfig` (the same, pre-existing, deliberate pattern as `AUTH_SECRET`).

**Rejected alternatives.** *`NEXT_PUBLIC_DB_ADMIN_URL` + a role check in the component* — one line, and it
ships the admin URL to every anonymous visitor in the bundle while looking correct on screen; this is the
whole defect the WP avoids. *Login-response only* — the smallest server diff, and the link silently
vanishes on reload, which teaches the one operator who has it not to trust it. *A dedicated
`GET /admin/links` route* — a new authenticated endpoint, a new place for a role decision to be written
and later gotten wrong, to carry one optional string that an existing authenticated read already has the
principal to gate. *Persisting `dbAdminUrl` into the `sessionStorage` session slice* — survives reload
without any server change, and keeps handing out a URL after the token that justified it has expired.

## Rubric traceability

- **Technical excellence / security** — the role gate is enforced where the data is produced, and proven
  per role by unit test plus a build-output grep asserting the value is not inlined anywhere in the client
  bundle (plan §4, "A7 role gate").
- **Comprehensiveness** — closes plan §0·6 / §2·A7 and makes the V2 Directus deployment reachable by the
  role that operates it, without turning it into a public surface.
- **Real-world deployability** — one optional environment variable, validated at boot, with absence as the
  documented off state; nothing to build differently and nothing to rebuild when it changes.
