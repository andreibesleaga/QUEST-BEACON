# ADR-025 — Real per-user JWT identity + opt-in dev-login IdP

- **Status:** Accepted (2026-07-13)
- **Deciders:** Entrant + ops-security (user-directed, Phase-B go-live)
- **Relates to:** ADR-017 (AI compliance proxy — role-scope), ADR-023 (channel-agnostic core), CONSTITUTION
  Art. V (authentication requires a threat model), Art. XIII/XIV (HITL, precise-PII gating)
- **Threat model:** `docs/architecture/THREAT_MODEL.md` (JWT signing key TB8, verify-path TB6, dev-login
  minter — added for this ADR)

## Context
Through S05 the HTTP RBAC actor was a role stub (`role:<ROLE>`) resolved from a dev-trust header, and the
hash-chained triage/approve audit recorded that stub rather than a real user. Constitution Art. V requires
real authentication (with a threat model) before public deployment; the audit trail must record the true
actor, not a role key. This had to happen without breaking the offline demo or the e2e role-switcher, and
without introducing a heavyweight IdP for a ~$0 open-source demo.

## Decision
1. **Verified per-user identity.** `resolvePrincipal` (`src/adapters/channels/http/rbac.ts`) verifies a
   bearer JWT with **jose**, pinned **HS256** allow-list (rejects `alg=none`/RS↔HS confusion), `exp`
   enforced. It returns `{ role, sub }` from the *verified* claims; **any** failure fails **closed** to
   `{ role: 'PUBLIC' }` with no `sub`. An empty/whitespace `sub` is treated as absent → the role key
   (fail-closed accountability). `actorId(principal) = sub ?? actorKey(role)` is the single source of the
   audit actor; every mutation's actor is server-derived (a body-supplied `actorId` is rejected 400).
   RBAC and rate-limiting stay keyed on the resolved **role** (spoof-proof). `AUTH_DEV_TRUST_HEADER` remains
   the offline-demo affordance only (honoured sole when set; else PUBLIC).

2. **Dev-login demo IdP — opt-in + cloud-hard-off.** `POST /auth/dev-login` mints a short-lived HS256 bearer
   for `{role, userId}` **only** when `AUTH_SECRET` is set **AND** `AUTH_DEV_LOGIN=on` (a secret alone never
   exposes an arbitrary-role minter), and **never** in a production/cloud build (`NODE_ENV=production` or
   `DEPLOY_MODE=cloud` → 404, belt-and-suspenders even if the flag leaks). It is a demo IdP, explicitly not
   production issuance; a real deployment plugs in OIDC/an external IdP behind the same `resolvePrincipal`.

## Consequences
- The hash-chained triage/approve audit now records the true per-user `sub` when a verified JWT carries it,
  else the role key — accountability is real, and the offline-demo audit is byte-unchanged.
- The e2e golden path + visual baselines run under `AUTH_DEV_TRUST_HEADER=on` with **no** `AUTH_SECRET`, so
  dev-login 404s and those flows keep using `x-beacon-role` — unchanged and green.
- The `/auth/dev-login` privilege-escalation surface is double-gated + cloud-hard-off (regression-tested);
  documented as a demo-only IdP. Residual: PUBLIC callers share one rate-limit bucket (role-keyed, spoof-proof;
  a per-IP fallback is an edge-layer roadmap item).

## Alternatives considered
- **Full OIDC / session cookies for the demo** — rejected for v1: heavyweight for a ~$0 offline-capable demo;
  the port (`resolvePrincipal`) is IdP-agnostic so OIDC drops in later without core change.
- **Keep the role-header stub** — rejected: violates Art. V + leaves the audit actor forgeable/unattributed.
- **Client-supplied `sub`/`actorId`** — rejected: forgeable; `sub` is only ever taken from a
  signature-verified claim, and body `actorId` is rejected 400.

## Implementation status (2026-07-13, Phase B) — ✅ realized, gate green
`resolvePrincipal`/`actorId`/`signDevToken(sub)`/`handleDevLogin` implemented + tested (unit + e2e + the
cloud-hard-off regression). Confirmed fail-closed + spoof-proof by the Phase-C security audit
(`docs/audit/FINAL_LIVE_AUDIT.md` §3).
