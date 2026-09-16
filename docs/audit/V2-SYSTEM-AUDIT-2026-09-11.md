# BEACON V2 — full system audit, 2026-09-11

Commissioned by the owner with one bar: **what stands between this repository and a 5/5?** Phase 2 scored
4.48. The instruction was to be rigorous rather than flattering, and to avoid manufacturing findings to
look thorough.

Six parallel audits ran: architecture-docs-vs-code, deployment artifacts, security, accessibility,
documentation truth, and production-readiness + i18n. Every finding below carries a `file:line` citation
and is marked **PROVEN** or **SUSPECTED**. Where an area was genuinely sound, it is stated in one line.

---

## Executive summary — what stands between this repo and a 5/5

Ordered by how much damage each would do if a judge found it.

**1. The project's own Gate 5 was failing.** `npm audit --audit-level=high` — a command the docs tell a
judge to run — exited 1 with **2 critical and 3 high** advisories, including unauthenticated RCE in Next.js
and an XSS sanitizer bypass in the map library that renders the entire COP. A reviewer running one
documented command and seeing `2 critical` is the single most damaging avoidable finding. **FIXED
2026-09-11** — now exits 0 (7 moderate remain, all dev-only or below the gate).

**2. The documented "air-gapped judge path" was neither air-gapped nor safe.** `npm run docker:up`
rendered `DEPLOY_MODE=local` into a container publishing port 3000 on all interfaces — which unlocks the
spoofable `x-beacon-role` header. Anyone reaching that port could claim EM, read precise SOS coordinates
(Art. XIV) and promote a DRAFT alert to an ACTUAL CAP (Art. XIII). Setting `AUTH_SECRET` did **not** close
it. **FIXED 2026-09-11**, with a test that pins the shipped profiles and was verified to fail against the
old one.

**3. The air-gapped claim still breaks on one axis: the basemap.** Fonts, scripts, AI and data are all
genuinely local — verified. But the map's default style points at `https://tile.openstreetmap.org`, with
no config override and no bundled fallback. Disconnected, the COP renders incident markers floating on a
blank background with no coastline, road or place name, and **no label saying the basemap is unavailable**
— which contradicts the project's own "degrade, label, never dead-end" rule. **OPEN.**

**4. A screen reader could not use the product.** A per-second clock sat inside a polite live region, so
the page announced the ticking second forever and queued every other announcement behind it. Separately,
the `?` shortcut was globally armed and swallowed the character, so a citizen could not type "Is anyone
coming?" into the SOS field. **Both FIXED 2026-09-11** — the clock's live region was scoped to the counts,
and the `?` handler now skips any input, textarea, select or contenteditable target.

**5. On the normal production path the map has no non-visual equivalent at all.** The accessible feature
table exists and is well built, but is rendered only in the WebGL-failure branch — and every axe scan
disables WebGL, so CI structurally cannot see this. **OPEN.**

**6. Several architecture documents claim capabilities that do not exist.** MFA, a verifier-agent,
OpenTelemetry spans, a `QueuePort` implementation, and a port-parity test across four rungs are all
recorded as implemented; none exist. Four ADRs covering shipped flagship tiers still say "Not started".
**OPEN** — and this is the category most likely to be checked by a careful reviewer, because the
compliance matrix invites exactly that check.

**The good news, stated once and meant:** the authorization model is genuinely strong (fail-closed at
every branch, one rank table, server-derived actor identity, scrypt with a dummy-derivation branch that
does not enumerate accounts); SQL injection, command execution, path traversal and SSRF are each
structurally absent, not merely unobserved; the PII gate is the strongest control in the codebase;
Playwright e2e plus axe run blocking in CI behind an exhaustively pinned offline profile; coverage floors
are real and enforced; base images are digest-pinned; and `docs/CI_CD.md` contains an unusually honest
as-built reconciliation in which no inaccuracy was found.

---

## Severity counts by area

| Area | Blocking | Should-fix | Nit |
|---|---|---|---|
| Security | 2 | 7 | 5 |
| Deployment artifacts | 4 | 12 | 7 |
| Accessibility (`app/**`) | 4 | 10 | 10 |
| Architecture docs vs code | 8 | 15 | 5 |
| Documentation truth | 11 | 22 | 10 |
| Production readiness | 4 | 6 | 4 |
| Internationalisation | 1 | 4 | 3 |

The last three rows were re-dispatched after the first attempts died on an API spend limit; their full
deliverables are `V2-DOCS-AUDIT-2026-09-11.md` and `V2-PRODREADY-I18N-AUDIT-2026-09-11.md`, and their
headline findings are summarised in the addendum at the end of this document.

---

## Fixed during this audit (2026-09-11)

| # | Finding | Fix |
|---|---|---|
| SEC-F2 | `npm audit` exits 1: 2 critical (Next.js RCE ×2, maplibre-gl XSS), 3 high (sharp/libheif, js-yaml, browserslist) | `npm audit fix` for the non-breaking set; `maplibre-gl` 5→6 for the critical XSS, which required porting the v6 named export (`map-engine.ts:5`). Gate now exits **0**; build, tsc, eslint and the 98 map tests all pass |
| SEC-F1 | `docker:up` opened the spoofable role header on a published port | `DEPLOY_MODE`, `AI_MODE`, `AUTH_DEV_TRUST_HEADER`, `AUTH_DEV_LOGIN` pinned as literals in `infra/docker-compose.yml:88-105`; new `rbac.compose-profile.test.ts` pins every shipped profile, mutation-verified to fail against the old values |
| DEP-B2 | `npm ci \|\| npm install` silently defeated the lockfile in two stages | fallback removed (`infra/Dockerfile:19,44`). A desync now fails the build loudly instead of producing an image whose tree matches no committed artifact |
| A11Y-F11 | a per-second clock inside a polite live region starved every other announcement | live region scoped to the counts only; clock moved outside it and marked `aria-live="off"`; two tests pin the structure (`status-strip.tsx:183-205`) |

---

## Open — blocking

### B-1 · The basemap breaks the air-gapped claim, silently
`app/_components/map/style.ts:13` hardcodes `https://tile.openstreetmap.org/{z}/{x}/{y}.png` as the
unconditional default; `map-engine.ts:109` falls back to it and no caller ever supplies `opts.style`. There
is no `MAP_STYLE`/`TILE_URL` env var anywhere, so an operator cannot swap it without editing source.
`docs/LIBRARIES.md:38` lists PMTiles as the offline basemap — it is not a dependency and no `.pmtiles`
file exists.

A failed raster tile does not throw, so `MapView` never sets `failed`: the canvas mounts, deck.gl draws
every BEACON layer correctly, and the basemap underneath is simply empty. A responder cannot tell which
road a task is on, and nothing on screen says why. **PROVEN.**

*Remedy (small):* add `MAP_STYLE_URL`/`MAP_TILES_MODE`, default to a bundled no-basemap style when
`DEPLOY_MODE=local`, and render a visible "basemap: offline" chip. Until then, amend `README.md:83,193`
and the honest-limitations list at `README.md:161-191`, which currently omits this.

### ~~B-2~~ · `?` swallowed the keystroke — **FIXED 2026-09-11**
`app/_components/command-palette.tsx:41-43` listens on `document`, never inspects `e.target`, and calls
`preventDefault()`. WCAG 2.1.4 (Level A) failure, and a data-loss bug: a citizen cannot type a question
mark into the SOS textarea (`sos-form.tsx:122`), and a modal opens over the form instead. **PROVEN.**
*Fixed:* `isTypingTarget()` now guards the branch, so the shortcut is restricted to a focused component
exactly as the success criterion prescribes. `Ctrl/Cmd+K` is deliberately left unguarded — a modifier
combination is not a character key and is expected to work while typing.

### B-3 · The map has no non-visual equivalent on the shipped path
`MapFeatureList` is rendered only inside `if (failed)` (`MapView.tsx:101`). The success branch renders the
`aria-hidden` canvas plus three camera buttons and nothing else. Every axe scan disables WebGL
(`e2e/a11y.spec.ts:11-13`), so CI can never see this. **PROVEN.**
*Fixed 2026-09-11:* rendered in BOTH branches using the skip-link pattern (`sr-only focus-within:not-sr-only`),
so assistive technology always reaches the table and a sighted keyboard operator sees it on focus instead of
tabbing through invisible controls. Guarded by a test that asserts the list in both the working and the
failing engine branch, and mutation-verified. The a11y scan without `disableWebGL` is still owed.

### ~~B-4~~ · No `<h1>` anywhere in the application — **FIXED 2026-09-11**
15 headings, none of them `h1` (`ui/card.tsx:32` renders the shell title as `h2`). A screen-reader user
pressing `1` to orient lands nowhere. Invisible to the gate because `page-has-heading-one` is tagged
best-practice and the axe tag set omits it. **PROVEN.** *Fixed:* a `headingLevel` prop on `Panel`, defaulting to `h2`, with the shell passing `h1`.
Same classes at either level, so the document outline is corrected without moving a pixel.

### ~~B-5~~ · k8s init-container deadlocks against the migrate Job's TTL — **FIXED 2026-09-11**
`infra/k8s/50-app.yaml:19-22` blocks every pod until `kubectl get job beacon-migrate` reports success;
`40-migrate-job.yaml:11` garbage-collects that Job after one hour. From then on no pod can ever become
Ready, so the HPA cannot scale and any rescheduled pod hangs. **PROVEN.**
*Fixed:* the kubectl-poller is gone. The app now migrates in an init container running `scripts/migrate.mjs`
from its own image, so the precondition enforced is the real one — the schema is current — rather than a
proxy Kubernetes is entitled to garbage-collect. The Job, the `bitnami/kubectl:latest` image and the
jobs-reading Role and RoleBinding are all deleted; BEACON's pods now hold no cluster permissions at all.
`migrate.mjs` takes a Postgres advisory lock, so two replicas racing at first boot is safe — which it was
not before, on Railway either.

### ~~B-6~~ · Documentation claims five capabilities that do not exist — **FIXED 2026-09-11**
`COMPLIANCE_MATRIX.md:77` (MFA), `:83` (verifier-agent), `:81` + `C4_ARCHITECTURE.md:606` (OTel spans),
`C4_ARCHITECTURE.md:135,207,272,428` + ADR-004 (`QueuePort` implementations), `C4_ARCHITECTURE.md:598`
(port-parity test across four rungs — three of the four have no adapters at all). Each is marked
`implemented`, and the matrix defines that word as "BUILT, wired, and test/gate-verified". **PROVEN.**
*Fixed:* a `not-implemented` status was added to the matrix legend and applied to C20, C24 and C26, each row
now saying exactly what exists and what does not — short-lived JWTs yes and MFA no; cost attribution yes and
OTel spans no; no verifier agent, with a note that Art. XII removes the need for one by never letting the LLM
produce a figure. The C4 queue and realtime rows, the port-parity row F11 and the cost row F19 were corrected
the same way. Where a rung is specified but unbuilt the docs now say so and explain what the port still buys.

### ~~B-7~~ · Four ADRs covering shipped tiers still say "Not started" — **FIXED 2026-09-11**
ADR-033, ADR-034, ADR-035 and ADR-036 all carry "Implementation status / Not started" while their
subjects — forecast likelihood, the anticipatory-action engine, predicted-impact methods and the warning
tier — are fully built and shipping. A reviewer reading these concludes the flagship anticipatory
capability was never delivered. **PROVEN.**
*Fixed:* all four now read **SHIPPED**, with the original S02 planning text preserved beneath as a block
quote rather than deleted. A decision record that lags the code is not a neutral omission; it actively
misinforms the one audience it exists for.

---

## Open — should-fix, grouped

**Security.** The rate limiter is keyed by role, so every anonymous caller shares one bucket — a single
client at >30 rps returns 429 to every citizen, including SOS submission (`rbac.ts:87-89`,
`rate-limit.ts:23-24`). `POST /routes` has no authorization yet writes a durable row and can burn the
operator's ORS quota (`feature-router.ts:202`, `logistics.ts:171,191`). Org scoping is client-supplied, so
"org-scoped" currently means "scoped to whatever the client claims" (`feature-router.ts:270,445`). No
request body size limit (`app/api/v1/[...path]/route.ts:11`). No CSP and no HSTS (`next.config.mjs:7-21`)
— the CSP omission is reasoned, but a baseline policy would also blunt the map XSS advisory.
`PgReportStore.list()` is unbounded (`read-models.ts:305`).

**Deployment.** Healthchecks and the k8s readiness probe test a hardcoded literal, so an app with a dead
database reports healthy forever (`http-dispatcher.ts:282-283`, `k8s/50-app.yaml:37-40`). No resource
limits in compose, while k8s has them. `db` has no restart policy while `app` does. Postgres is published
on all interfaces with `beacon/beacon`. Two divergent migration paths, and the one that runs in production
(`scripts/migrate.mjs`) has no CI coverage. Seven `NEXT_PUBLIC_*` flags are undeclared build args, so two
features cannot be turned on and five cannot be turned off in any container. The security lane is
`continue-on-error` while `README.md:105` presents its result as a gate. `release.yml:4` claims a CI gate
it does not have. No Railway IaC exists anywhere in the repo.

**Accessibility.** `role="alert"` on a static "Uncited" marker fires once per uncited field
(`sitrep-panel.tsx:42-45`). Two nested `<main>` landmarks (`page.tsx:434`, `cop-layout.tsx:91`). Form
control borders measure 1.30–1.47:1 against their own container — axe does not test 1.4.11, so the gate is
green on it (`globals.css:22,56`). Hardcoded English in the entire citizen SOS form, the routing panel and
the verifier queue, including two `Panel` titles and two `aria-label`s that are accessible names — under
`lang="ar"` a screen reader applies Arabic pronunciation to English text (WCAG 3.1.2, Level AA). SSE
updates the picture with no announcement at all (`region-stream.tsx:28`).

**Architecture docs.** The ADR index stops at ADR-036 while ADR-037–041 ship. The port inventory says
"P1–P15 fixed" while 33 port interfaces exist and `src/ports/panels.ts` numbers itself P16. LiteLLM is
named as the LLM router and is not a dependency. `DOMAIN_MODEL.md` is six entity-level divergences and
eight undocumented entities behind the domain layer. A duplicate, headerless ADR-036 file states the D4
modules are "currently inert" — they are routed, DB-backed and tested.

---

## Recommended order of work

1. **B-2 and B-4** — two small edits, one of them a Level A failure with a data-loss bug attached.
2. **B-3** — ~10 lines, and it is the substantive accessibility gap.
3. **B-1** — the basemap. Either implement the config override or amend the claim; leaving both is the
   only unacceptable option.
4. **B-6 and B-7** — documentation truth. Cheap, and it is the category a careful reviewer checks first.
5. **The security should-fix set**, rate limiter first.
6. **The test-gate widening** — add `best-practice` to the axe tags, gate on `moderate`, and run one scan
   with WebGL enabled. That single change would have caught four of the accessibility findings on its own,
   which is the strongest argument for doing it before the rest.

---

## A note on method, because it is the recurring lesson

Three of the six audits found the same shape of defect: **a gate that cannot see the thing it claims to
cover.** The axe scans disable WebGL, so the shipped map path is never scanned. The npm audit step is
`continue-on-error`, so a red result merges green. The A2 unit tests drove fakes that asserted statement
shape, so three blocking SQL defects shipped behind a green suite.

In each case the check existed, was documented, and was trusted — and was structurally incapable of
failing for the reason it was created. That is worth more attention than any individual finding in this
document.

---

## Addendum — the two recovered audits (documentation truth; production readiness + i18n)

Both first attempts died on an API spend limit and were re-run. Full reports:
`V2-DOCS-AUDIT-2026-09-11.md` (1,140 lines) and `V2-PRODREADY-I18N-AUDIT-2026-09-11.md` (614 lines).
Their headline findings change the priority order above, so they are summarised here.

### Documentation truth — 11 blocking · 22 should-fix · 10 nits

The docs are not inflating the core thesis. The limitations ledgers are real and the "the model never
produces a number" discipline is genuinely structural. **The damage is drift**: the documentation describes
the repository as of 2026-08-25, and five weeks of V2 work moved underneath it.

The four that would cost the most, in the order a judge would meet them:

1. **`npm test` exits 1.** The README advertises "4536 passed / 2 skipped, exit 0" — the first command a
   judge runs, against a project whose pitch is that its numbers are machine-produced rather than asserted.
   *(Cause: the `shelters-fema` handoff, being wired now. PROVEN.)*
2. **`JUDGE_MATRIX.md` does not exist in this repo and never has** — untracked in all git history — yet it
   is the README's literal first line to judges, repeated three more times, heading four other documents,
   and named in the submission-portal note. **Eight dead links.** It exists in the judge repo; this repo
   points at a file it does not contain.
3. **The README's own "What is honestly not done" list is stale** — the worst possible place for drift. It
   still says forecast evidence is not served (closed 2026-09-10) and that the GloFAS feed was
   decommissioned (re-verified live and keyless the same day).
4. **Four cost-guardrail environment variables are inert.** `BUDGET_PER_INCIDENT_USD`,
   `BUDGET_PER_REGION_USD`, `BUDGET_ESCALATION_THRESHOLD_USD` and `REQUIRE_HUMAN_ABOVE_THRESHOLD` are read
   by **no code**. Enforcement is real but driven solely by `config/policies.yml`, so raising a cap in
   `.env` silently does nothing. This is one of only two findings with consequences outside the
   competition — an operator could believe they had set a spending limit.

Also blocking: the adapter registry is **45**, not the 44 stated in ~25 places; `NOTICE` has **no
attribution entry for `shelters-fema`**, so a FEMA dataset currently ships unattributed, which is a
licensing defect rather than a documentation one; `PRD.md:255-268` says five endpoints 404 when all five
are served; and **five entrant-only documents ship**, one of which publishes judge account emails and the
source of their password. That last item is the owner's to decide on, and it is the reason it is called
out here rather than quietly fixed.

Recomputed ground truths for whoever fixes the numbers: **45** adapters · **43** ADR files (including the
duplicated ADR-036) · **878** modules · 36 paths / 39 operations / **66** schemas · 5 regions · 14 locales
· **29** hollow environment variables · **13** broken internal links.

### Production readiness — 4 blocking · 6 should-fix · 4 nits

The internals are unusually well built: one client with a bounded timeout behind every outbound fetch, a
real per-source breaker and last-known-good cache, a genuinely labelled LIVE→CACHED→MOCK ladder, a
symmetric failure contract inside `handleHttp`, a capped SSE channel, and an atomic re-ingest swap. All
three outage scenarios degrade rather than dead-end.

The problems were at the edges that matter on Railway, and three of them compounded into one failure mode:
the Next delegators had **no error boundary at all**, so the hardened contract began one stack frame too
late; the composition root runs lazily on the first request and performs 120 adapter consultations with no
overall deadline; and a **failed composition was memoised permanently**, because a rejected promise is not
`undefined`. Together: one typo in an environment variable meant a container reporting healthy, every
request returning an unshaped 500 forever, no retry after the cause cleared, and no log line — because
there is no request or error logging at all outside the AI cost sink.

**The memo and the delegator boundary are FIXED (2026-09-11)**, with the memo policy extracted so the test
drives the real code rather than a copy of it. The missing deadline on first-request composition and the
absent boot validation and logging remain **OPEN**.

### Internationalisation — 1 blocking · 4 should-fix · 3 nits

The catalogue layer is excellent and was verified independently of the suite: 393 keys × 14 catalogues,
zero missing, zero orphaned, correct CLDR plural categories including Arabic's six and Romanian's `de`,
and right-to-left handled properly with exactly one physical direction class in the whole of `app/**`.

Two holes. **`routing-panel.tsx` and `verifier-queue.tsx` contain no translation hook at all** — wholly
hardcoded English including eight accessible names and both panel titles, on the two surfaces where an
operator takes an irreversible action (publish an alert, dispatch an evacuation). And **the entire
`anticipatory.*` namespace — 29 keys including two safety disclaimers — is byte-identical across all 13
non-English catalogues**, mirrored structurally to satisfy the parity test and never translated. The
parity test cannot see this, because it has no untranslated-value check. Filipino is separately the
weakest catalogue at 28%, and the Philippines is a shipped region.

### What this changes about the order of work

`npm test` exiting 1 and the eight dead `JUDGE_MATRIX.md` links now rank above everything in the original
list: they are what a judge meets in the first five minutes, and both are cheap. The inert budget
variables and the missing `shelters-fema` attribution follow, because both are wrong outside the contest
as well as inside it.
