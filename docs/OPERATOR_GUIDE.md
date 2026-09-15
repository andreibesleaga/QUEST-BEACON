# BEACON — Operator Guide

> ### 🔎 Judges & first-time readers — start here: **[JUDGE_MATRIX.md](../JUDGE_MATRIX.md)**
> One page, built for a fast scan: what was promised vs what shipped, the five judging criteria with
> evidence, production readiness, what's genuinely new, and the honest limitations. Everything below and
> throughout `docs/` is the supporting detail behind it.

> How to **use** the three core workflows — Situation Report, Logistics & Tasking, Evacuation
> Routing — as an operator or judge, in any posture (local `npm run dev`, Docker, or the cloud
> deploy). This guide states honest limitations inline (project law: degradation is labelled,
> never hidden). For the 60-second orientation, run commands and the doc map, read
> `docs/QUICK_GUIDE.md` first — this guide does not repeat it.
>
> Executable walkthroughs of everything below: `e2e/logistics-tasking.spec.ts` (roster → task
> lifecycle → pre-positioning) and `e2e/golden-path.spec.ts` (report → verify → SitRep → route).
> A step-by-step filmed narrative lives in `docs/DEMO_SCRIPT.md`.
>
> **Running this for real, not as a demo?** `docs/LIVE_PRODUCTION_GUIDE.md` is the production
> posture: every source that can serve live serving live (**35 of 44** adapters — the other nine
> are named with their reasons), a real PostgreSQL store behind logistics/reports/audit, real AI
> synthesis, real alert delivery, real road routing, and how to cover any region worldwide.

---

## 1. Personas & sign-in

BEACON has four roles (`src/domain/app-user.ts`): **PUBLIC**, **RESPONDER**, **VERIFIER**, **EM**
(Emergency Manager). PUBLIC needs no account — anyone can open the COP, view every map layer and
SitRep, submit a public report or SOS, and request an evacuation route. Privileged roles unlock
writes, in escalating order.

| Capability | PUBLIC | RESPONDER | VERIFIER | EM |
|---|---|---|---|---|
| View COP map, layers, incident detail | ✅ | ✅ | ✅ | ✅ |
| Read the Situation Report (`GET /incidents/{id}/sitrep`) | ✅ | ✅ | ✅ | ✅ |
| Submit a public report / SOS (`POST /reports`) | ✅ | ✅ | ✅ | ✅ |
| Request an evacuation route (`POST /routes`) | ✅ | ✅ | ✅ | ✅ |
| List resources / see the logistics roster | — | ✅ (own org) | ✅ | ✅ (all orgs) |
| Task a resource / advance the task lifecycle | — | ✅ | ✅ | ✅ |
| Register a resource (API-only, see §3) | — | ✅ (own org) | ✅ | ✅ (any org) |
| Pre-positioning suggestions (`GET /pre-positioning`) | — | ✅ | ✅ | ✅ |
| EDXL-RM mutual-aid import/export (API-only) | — | ✅ (own org) | ✅ | ✅ |
| Verify/reject public reports (triage queue) | — | — | ✅ | ✅ |
| EDXL-SitRep export, CAP alert approval | — | — | ✅* | ✅ |

\* EDXL-SitRep export is EM-only per `docs/api/openapi.yaml` (`x-required-role: EM`); report
verification is VERIFIER+.

### Signing in

- **Named-account sign-in** (the real auth surface, cloud-safe): a user/password control in the
  COP toolbar (`app/_components/login-control.tsx`). It calls `POST /api/v1/auth/login`; accounts
  come from the server's `AUTH_USERS` env var (`id:ROLE:password` triples — config, not a DB
  table; a production IdP is post-v1 roadmap and the code says so). The minted bearer is a
  fail-closed HS256 JWT — the **server** decides your role; the client can never ask for one. The
  control renders only in builds made with `NEXT_PUBLIC_AUTH_TOKEN_LOGIN=on` (the cloud deploy
  is; the default offline build is not).
- **Sign-in survives a reload of the same tab, and only that** — the auth/session slice (role +
  bearer) is mirrored to **sessionStorage** (`app/_lib/store.ts`), so a reload mid-incident does not
  sign you out, while closing the tab drops the session entirely (nothing ever lands in
  localStorage). A tampered or forged stored token verifies to PUBLIC server-side — fail-closed.
  Sign-out removes the stored session. *(Changed 2026-08 — earlier versions of this guide said
  sign-in was per-page-load.)*
- **Dev role-switcher**: in dev-posture builds only (no `NEXT_PUBLIC_DEPLOY_POSTURE=live`), the
  toolbar shows a role dropdown that sets a spoofable `x-beacon-role` header. The server honours
  it only when `AUTH_DEV_TRUST_HEADER=on`; on cloud it is hard-off and the switcher is replaced
  by a LIVE chip. It is a demo convenience, not authentication.
- Auth configuration reference: `docs/architecture/CONFIGURATION.md` §10.

---

## 2. Situation Report (SitRep)

Open an incident (map marker or incident list) and the SitRep panel renders the AI intel view.

### What you are looking at

- **Cited fields** — every factual field carries `citations[]` resolving to a `SOURCE_RECORD`.
  A field with no citation renders as a **visible error** (`data-testid="uncited-field"`), never
  silently. This is contract, not decoration (Constitution Art. XII, iron rule F2).
- **Trend** — a deterministic escalation-trend sentence (computed by
  `src/application/escalation-trend`, never by the LLM). It stays in English and is labelled as
  engine output.
- **Ranked priorities** — an ordered list whose ranks and scores are read verbatim from the API
  response; the UI never computes or re-ranks them.
- **AI narration** — when an LLM is enabled (`AI_MODE=cloud|local`), a prose summary appears,
  explicitly labelled as AI. Numbers are **stripped before the model sees the facts**; an
  ungrounded citation in the model's output rejects the narration entirely. Narration is
  locale-aware (follows the `beacon-locale` language you pick); the underlying claims stay
  English by contract.
- **Deterministic-only rung** — with AI off or failed, the narration disappears and a
  labelled "deterministic-only" badge appears. Facts, citations, trend and priorities remain
  fully functional. This is the required degraded mode, not a broken state.
- **Provenance popover** — the panel header's provenance control lists every source record and
  freshness timestamp behind the response.
- **EN chips** — when the UI language is not English, engine-produced English content (trend,
  claims) is marked with an EN language chip rather than being machine-translated.
- **Outlook section** — forecast outlook data is always on the wire; the panel section renders
  only in builds with `NEXT_PUBLIC_FEATURE_OUTLOOK_PANEL=on` (render gate only).

### Freshness and refresh

There is **no stored SitRep**. Every read computes the report fresh from current inputs
(`synthesizeSitRep`, `src/application/sitrep-synthesis`); the `sitrep`/`citation` DB tables exist
in the schema but are never written — no cache, no "last known SitRep". To refresh:

- use the panel's **retry** button on an error state,
- let **SSE-driven updates** invalidate and refetch automatically, or
- switch region/incident and back — any re-select recomputes.

*(A formerly documented `?refresh=true` query on the SitRep endpoint was removed from the OpenAPI
2026-08-10 — the handler never read it, and since nothing is cached a plain re-request is already
a full recomputation.)*

### What you deliberately cannot do

An operator **cannot edit facts, priorities, or citations**. This is Constitution Art. XII by
design: numbers and rankings come only from the deterministic engine; the human role is to act
on them (verify reports, approve alerts, task resources), not to hand-edit the picture.

### Relevant settings (pointers only)

- `AI_MODE` and the LLM ladder — `docs/architecture/CONFIGURATION.md` §4.
- `DATA_SOURCE_COMPOSITION=adapters` switches SitRep inputs from the offline seed to live
  adapters (news grounding merges in only in this mode).
- `NEXT_PUBLIC_FEATURE_OUTLOOK_PANEL` — render gate for the Outlook section (data unaffected).

---

## 3. Logistics — resources, shelters, tasking

Open the **Resources** tab (RESPONDER+; the dev role-switcher or a signed-in account gets you
there). What you see is the seeded demo roster:

| Seeded item | Details |
|---|---|
| `ca-engine-1` | ENGINE, AVAILABLE, California org |
| `ca-crew-1` | CREW, AVAILABLE, California org |
| `ro-medical-1` | MEDICAL, AVAILABLE, Romania org |
| `ca-shelter-1` | capacity 200, occupancy 20, OPEN |
| `ro-shelter-1` | capacity 120, occupancy 0, OPEN |

Two incidents are seeded as **verified**: `us-ca-wildfire-demo` and `ro-flood-demo`. **Tasking
any other incident is refused (403) by design** — a resource may never be tasked from an
unverified picture (Art. XIII). This is the tasking gate, not a bug.

### Task lifecycle

`PROPOSED → TASKED → ENROUTE → ONSCENE → CLEARED`, strictly forward, **one hop per click**. The
Task button on a resource row (RESPONDER+) creates the task at PROPOSED and each subsequent click
advances exactly one state. There is no skip and no rollback. The full click-through is executable
in `e2e/logistics-tasking.spec.ts`.

### Adding a resource — API-only today

There is **no UI form** for registering a resource. The only path is
`POST /api/v1/resources` with a RESPONDER+ bearer:

```bash
# 1. Mint a bearer from a configured AUTH_USERS account
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"userId":"em1","password":"<password>"}' | jq -r .token)

# 2. Register the resource (kind + org required; status defaults to AVAILABLE)
curl -s -X POST http://localhost:3000/api/v1/resources \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
        "kind": "ENGINE",
        "org": "org-ca-calfire",
        "status": "AVAILABLE",
        "geom": { "type": "Point", "coordinates": [-121.50, 39.70] }
      }'
```

(In a local dev posture with `AUTH_DEV_TRUST_HEADER=on`, `-H 'x-beacon-role: EM'` works instead
of the bearer — demo convenience only, never available on cloud.)

**Shelters are config-defined.** The shelter roster loads from `config/shelters.json` at boot
(operator-editable without touching code — edit the file, restart), but there is no `/shelters`
write route or UI: capacity and occupancy are fixed for the life of the process. Runtime shelter
editing does not exist (see §6).

### Dock panels (added 2026-08, S3)

The logistics dock additionally shows three read-only panels — **Supplies**, **Volunteer teams**
and **Shelter status** — plus the **shelter capacity widget** (per-shelter occupancy/capacity with
a Within-capacity / Over-capacity verdict, computed from the same map-projection data the COP
uses). The SitRep dock gains **Damage reports** (triage-status buckets) and the **CEMS damage
overlay** panel. All five panels are honest about their feed: **their provenance says MOCK because
they are fixture-fed** — no supply/volunteer/shelter/EMS source adapter exists yet, and the damage
buckets aggregate the fixture, not the live report store. A failed or malformed response lands each
panel on a labelled error state with a Retry button, never a blank or crashed dock. Each panel is
flag-gated (`FEATURE_D4_*` / `FEATURE_D6_*`, default on).

### Persistence caveat — read this before demoing

The logistics store is **in-memory by default** and **durable under `FEATURE_STORE=postgres`**:
since the 2026-08 live-demo increment, `feature-seed.ts` composes `makePgLogisticsStore`
(`src/adapters/logistics/pg-logistics.ts`) when that flag is set, so registered resources and task
state survive a restart. On the default in-memory profile they are still lost on restart — that is
the labelled degraded rung, not a bug. *(Evacuation routes remain unpersisted in both profiles —
see §4.)*

### Pre-positioning panel

The pre-positioning panel shows **advisory suggestions**: AVAILABLE resources and OPEN shelters
with spare capacity that sit *near but not inside* the incident's projected hazard extent. The
selection radius (20 km) and per-category cap (top 5) are **code constants**, not configuration.
The engine suggests; a human decides — nothing is ever auto-tasked. All four empty states are
labelled rather than blank.

### EDXL-RM mutual-aid — API-only

Import/export of EDXL-RM 1.0 mutual-aid messages has no UI; use the API (RESPONDER+ bearer):

```bash
# Import a mutual-aid resource request (server assigns a round-trip messageId)
curl -s -X POST http://localhost:3000/api/v1/edxl/rm \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"messageType":"RequestResource","originatingMessageID":"ma-demo-001"}'

# Export the message + its round-trip chain (JSON, or XML via Accept header)
curl -s http://localhost:3000/api/v1/edxl/rm/<messageId> \
  -H "Authorization: Bearer $TOKEN"
```

The full message body contract is `schemas/edxl-rm.schema.json`; the store is in-memory (same
restart caveat as above).

---

## 4. Evacuation routing

Open the **Route** tab. The flow is:

1. **Click the map to set the origin.** The picked point appears in the panel and is editable.
2. **Select an incident — required.** The incident provides the hazard polygon the route must
   avoid; the submit button stays disabled without one.
3. **Destination resolves automatically** to the nearest **OPEN** shelter with headroom
   (occupancy < capacity), chosen deterministically server-side. If no open shelter is in range
   you get a typed NOT_FOUND — never a route to nowhere. Supplying an explicit `to` destination
   is API-only (`POST /api/v1/routes` with a `destination` in the body); the UI never sends one.
4. **Read the result.** The panel shows the nearest shelters with capacity/occupancy, plus:
   - whether the route **avoids the hazard** (`avoidsHazard` — when the engine could not clear
     the hazard it says so, labelled, rather than pretending),
   - the **suggested evacuation start** — projected hazard arrival − travel clearance time −
     a 30-minute margin. This is a first-order, labelled estimate from seeded arrival times
     (CA 02:00Z / RO 06:00Z in the demo seed), not a physics-grade forecast.

### Routing engine ladder

`FEATURE_ROUTING=heuristic|ors` (`docs/architecture/CONFIGURATION.md` §7). `ors` requires
`ORS_API_KEY` (fail-fast at boot) and uses OpenRouteService with hazard avoid-polygons; **any**
ORS failure falls back to the labelled heuristic (250 m hazard buffer, perpendicular detour
steps; if nothing clears, a straight line labelled `avoidsHazard: false`). The default heuristic
works fully offline.

### Routes are not saved

The computed route lives in component state only. There is no route history, no recall, and the
`evac_route` table is never written. Re-submit to recompute.

---

## 4a. Working offline and installing the app (ADR-047, deployments built with `NEXT_PUBLIC_PWA=on`)

When your deployment enables it, BEACON installs like an app (browser menu → *Install* / *Add to Home
Screen*) and keeps working when the connection drops:

- **What you keep offline:** the screen itself and the **last public picture** this device saw — regions,
  incidents, the map layers, each incident's SitRep and exposure list, the source list. Navigate it as
  usual.
- **What you cannot do offline:** send a report, verify one, approve an alert, task a resource, sign in.
  Those need the server and fail visibly; nothing is queued for later.
- **How you know:** a banner at the top says *"Offline — showing the picture saved at HH:MM"* (or
  *"Server unreachable — …"* if your network is up but the server is not). The time is when the oldest
  saved part on screen was saved, in your locale. If a copy carries no time the banner says so instead
  of guessing; offline before anything saved is on screen it says *"no saved picture yet on this device"*.
- **Language:** saved copies are kept per language. Switching language offline shows only what this
  device saved in that language. This needs a browser with the Cookie Store API (Chrome 87+,
  Firefox 132+, Safari 18.4+); an older browser keeps the app's build assets but saves no picture and no
  page, so it can never show the wrong language — it simply has nothing to show offline.
- **What a signed-in role sees offline:** the public picture. Only anonymous copies are ever stored on
  the device, so responder-only detail (a precise report position) is not available from the cache.
- **First visit vs later visits:** the picture is saved from the second visit on (the first visit
  installs the worker). Reload once after installing.
- **Turning it off:** a deployment rebuilt without the flag removes the worker and its saved copies the
  next time you open the page.

## 5. Settings quick reference

All configuration is env-driven (12-factor; nothing hardcoded). The single source of truth is
`docs/architecture/CONFIGURATION.md` — this table points, it does not restate values.

| Topic | Where |
|---|---|
| AI text LLM (AI_MODE, tiers, providers, fallback ladder) | CONFIGURATION.md §4 (+ §4a compliance proxy & budget) |
| Routing engine (`FEATURE_ROUTING`, `ORS_API_KEY`) | CONFIGURATION.md §7 |
| Regions (registry, `DEFAULT_REGION_ID`, iso/tz/languages) | CONFIGURATION.md §9 |
| Auth (`AUTH_USERS`, `AUTH_SECRET`, `NEXT_PUBLIC_AUTH_TOKEN_LOGIN`, dev-login flags) | CONFIGURATION.md §10 |
| Redundancy ladders (which flag drives which degrade path) | CONFIGURATION.md §11 |
| Decision-engine tunables (trend, priority weights, thresholds) | CONFIGURATION.md §12 |
| **Full-live production profile** (all source modes, keys, Postgres, Redis, AI, channels, worldwide regions) | **`docs/LIVE_PRODUCTION_GUIDE.md`** |

Cloud-deploy specifics (token minting for judges, posture flags): `docs/CLOUD_DEPLOY_RAILWAY.md`.

---

## 6. Known limitations relevant to operators

The complete honest-limitations ledger is `docs/SPEC.md` §13; the consolidated register of
documented-but-unimplemented items is `docs/audit/UNIMPLEMENTED_REGISTER.md`. The subset an
operator will actually bump into:

- **No shelter editing in the COP.** Shelters come from the agency registry (`config/shelters.json`,
  and FEMA's live directory for California); there is no write route or UI, so capacity and occupancy
  change only when the registry or the directory does.
- **Routes are not recallable in the COP.** Evacuation routes are computed per request; under
  `FEATURE_STORE=postgres` each computed route is written to the `evac_route` trail (ADR-039) for the
  audit record, but the UI has no "saved routes" list.
- **Logistics durability is opt-in.** On the default in-memory profile, runtime-added resources
  and task state are lost on restart; `FEATURE_STORE=postgres` makes them durable (§3).
  Full production database setup — provisioning, migration, what becomes durable and the two
  persistence gaps that remain — is `docs/LIVE_PRODUCTION_GUIDE.md` §4.
- **There is no SitRep refresh parameter** — every read is already a fresh computation, so a plain
  refetch is the refresh. (The dead `?refresh` param was removed from the OpenAPI 2026-08-10.)
- **Pre-positioning radius and cap are code constants** (20 km / top-5 per category), not env
  vars — you cannot tune them via configuration today.
- **Sign-in is per-tab** (§1 — survives a same-tab reload via sessionStorage, dies with the tab)
  and the dev role-switcher is a dev-posture demo control, not authentication.
- **Two dock panels are fixture-fed** (§3) — Shelter status and EMS overlay show MOCK provenance by
  construction. Supplies, Volunteer teams and Damage reports are DB-backed under
  `FEATURE_STORE=postgres` (ADR-041; edited in the Directus admin, labelled `DB` in the UI) and fall
  back to the recorded fixtures on the memory posture.
- **Offline is read-only** (§4a) — a report written without a connection is not queued.

When something is degraded — a source down, AI off, ORS unreachable — BEACON labels the state
("estimated", "deterministic-only", "unavailable + freshness") instead of hiding it. If you see
such a label, that is the system working as specified, not failing.

---

*Cross-references: `docs/QUICK_GUIDE.md` (orientation) · `docs/UI_UX_DESIGN.md` (design charter)
· `docs/DEMO_SCRIPT.md` (filmed walkthrough) · `docs/api/openapi.yaml` (API contract) ·
`docs/SPEC.md` §13 (limitations ledger) · `e2e/logistics-tasking.spec.ts` +
`e2e/golden-path.spec.ts` (executable walkthroughs).*
