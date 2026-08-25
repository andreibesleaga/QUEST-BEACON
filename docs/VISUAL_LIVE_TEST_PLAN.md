# BEACON — Visual Live Test Plan (click-through validation)

*Phase 3 · a human-runnable, browser-based checklist to validate the whole app end-to-end. Tick each ☐ as
you see the expected result. Companion to `docs/DEMO_SCRIPT.md` (the 2–5 min video narrative) — this doc is
the exhaustive QA pass behind it.*

> **Scope note (honest):** the current build runs **offline on an in-memory seed** (deterministic, AI off,
> sources MOCK). Every check below works with **no network**. The **live** variants (real FIRMS/NWS feeds,
> AI narration through the compliance proxy, full Postgres via `docker compose up`, real JWT login) arrive in
> **Phase B** (the go-live phase of the delivery program) and this plan gets a "LIVE" column appended then.

---

## 0. Start the app

```bash
cd IEEE/Quest/Phase3
source ~/.nvm/nvm.sh && nvm use
rm -rf .next                       # avoids a stale-cache 500 on the dev page
# Fast (dev):
AUTH_DEV_TRUST_HEADER=on npm run dev -- --port 3100
# OR fair-perf (prod, what the gates measure):
#   npm run build && AUTH_DEV_TRUST_HEADER=on npm run start -- --port 3100
```
Open **http://localhost:3100**.

- ☐ The page renders a **Common Operating Picture** (map area + side panels + toolbar) — **not** a blank page.
- ☐ No red error overlay; browser console has no uncaught `TypeError`.

*Role note:* the toolbar has a dashed **DEV role switcher** (`data-testid="role-switcher"`): PUBLIC / RESPONDER /
VERIFIER / EM. It sends `x-beacon-role` (honoured only because `AUTH_DEV_TRUST_HEADER=on`). Real login is Phase B.

---

## 1. MONITOR — the common operating picture (FR-1, FR-2)

- ☐ **Region selector** shows **California (us-ca)** by default; the map/feature-list is populated (not empty).
- ☐ The **map feature list** (accessible fallback, `map-feature-list`) shows rows: a fire perimeter + hotspots,
  infrastructure nodes (a substation AT_RISK/OFFLINE), exposure nodes, a shelter, a report, a prediction cone,
  an evac route. (If WebGL renders, the deck.gl map shows the same; the list is the a11y-guaranteed view.)
- ☐ **Layer toggle panel** (`layer-toggle-panel`) — toggling a layer hides/shows its features.
- ☐ Each layer/feature shows a **freshness badge** (icon + label, e.g. "MOCK / cached") — never a bare timestamp.
- ☐ A **provenance** affordance is present (badge/popover) tying data to a source record.

## 2. ASSESS — cited SitRep, priorities, trend (FR-4, F2)

Open the **SitRep panel** (`sitrep-panel`).
- ☐ **Every field shows a citation chip** (source reference) — this holds **even though AI is off**
  (`aiMode: deterministic-only`). F2: cited numbers are retained in deterministic-only mode.
- ☐ A **trend** indicator is shown (e.g. **ESCALATING** for the CA scenario).
- ☐ A **priorities** list is shown (e.g. the OFFLINE substation ranked highest).
- ☐ The figures are **deterministic** — reload; they don't change. (They are computed by the engine, not invented.)
- ☐ There is **no LLM prose paragraph** in deterministic-only mode (only cited facts). *(AI narration = Phase B.)*

## 3. DECIDE — decision support + draft alerts (FR-13, FR-11)

- ☐ **Decision support** panel shows the engine's figures beside their citations (numbers echo the SitRep
  priorities verbatim — nothing is computed in the browser).
- ☐ Switch the role to **VERIFIER**. Open **draft-alert review** (`draft-alert-review`): a **DRAFT** alert is
  listed (the CA threshold-rule fired — Fire / SEVERE). It is **DRAFT**, not ACTUAL.

## 4. ACT — SOS, verify, approve (FR-5, FR-6, FR-9, Art. XIII)

**Submit an SOS (as PUBLIC):**
- ☐ Set role to **PUBLIC**. Open the **SOS form** (`sos-form`). It has a **consent** control; you cannot submit
  without consenting.
- ☐ Submit → a confirmation; the report is created **UNVERIFIED**.

**Verify (as VERIFIER):**
- ☐ Set role to **VERIFIER**. Open the **verifier queue** (`verifier-queue`) — reports are listed (PUBLIC can't
  see this queue).
- ☐ Click **Approve/Verify** (`verify-report-btn`) → the report moves to **VERIFIED**. (No `actorId` is sent by
  the UI; the server records the actor itself.)

**Approve a DRAFT alert (HITL, Art. XIII):**
- ☐ In draft-alert review, **approve** the DRAFT alert → its state flips **DRAFT → ACTUAL**.
- ☐ Switch role to **PUBLIC** and confirm you **cannot** approve (the action is unavailable / returns Forbidden).

## 5. RBAC + responsible data (Art. XIII / XIV)

- ☐ As **PUBLIC**: no precise coordinates are shown for reports (only a generalized position); no verifier queue;
  no approve.
- ☐ As **RESPONDER**: precise geometry (`precisePosition`) becomes visible on the report/map. (This is enforced
  **server-side** — see the API checks in §8.)

## 6. Redundancy — degrade, never dead-end (Art. XVI; current offline rungs)

- ☐ **Offline / air-gapped:** disconnect the network entirely and reload — the COP still loads and every feature
  above still works (it runs on the local seed). Freshness shows MOCK/cached, never an error page.
- ☐ **AI disabled (default):** the SitRep still produces cited numbers + trend + priorities (deterministic-only).
  *(The AI-ON path through the compliance proxy, and the source-down live ladder, are validated in Phase B.)*

## 7. Second region — portability (FR-1)

- ☐ Switch the region to **Romania (ro) — flood**. Repeat §1–§4 key checks: flood extent + gauge, exposure,
  shelter, report, an inundation prediction cone, an evac route; SitRep shows a **crest** fact + trend + priorities.
- ☐ Everything works identically — proving the core is region-data-driven, not US-hardcoded.

## 8. Accessibility + responsiveness (F13, WCAG 2.2 AA)

- ☐ **⌘K / Ctrl-K** (`command-palette-trigger`) opens the command palette; you can navigate it by keyboard.
- ☐ **Theme toggle** switches dark/light; contrast stays readable in both.
- ☐ Resize to **tablet** and **phone** widths — the layout adapts (panels dock/collapse), no horizontal scroll.
- ☐ Tab through the page with the keyboard — focus rings are visible; the skip-link works.
- ☐ (Automated: `npx playwright test e2e/a11y.spec.ts` → **0 serious/critical** axe violations.)

## 9. API spot-checks (curl — proves the contracts + RBAC)

```bash
BASE=http://localhost:3100/api/v1
curl -s $BASE/regions/us-ca/incidents | jq '.data.incidents|length, (.provenance|length)'   # >0, >0
curl -s $BASE/incidents/us-ca-wildfire-demo/sitrep | jq '{aiMode:.data.aiMode, priorities:(.data.priorities|length), citations:(.citations|length), trend:.data.trend}'
# RBAC:
curl -s -o /dev/null -w "%{http_code}\n" -H 'x-beacon-role: PUBLIC'   $BASE/reports   # 403
curl -s -o /dev/null -w "%{http_code}\n" -H 'x-beacon-role: VERIFIER' $BASE/reports   # 200
curl -s -o /dev/null -w "%{http_code}\n" -H 'x-beacon-role: VERIFIER' $BASE/alerts    # 200 (computed DRAFT)
# Audit cannot be forged:
curl -s -X PATCH -H 'x-beacon-role: VERIFIER' -H 'content-type: application/json' \
     -d '{"decision":"VERIFIED","actorId":"attacker"}' $BASE/reports/<id>            # 400 VALIDATION_ERROR
curl -s $BASE/.well-known/sustainability | jq '.["measurement-method"]'              # schema-valid report
```
- ☐ Every data envelope carries `provenance[]` + `freshness` (F1). SitRep carries top-level `citations[]` (F2).
- ☐ `/reports` and `/alerts`: PUBLIC → 403, VERIFIER → 200.
- ☐ A `PATCH /reports/:id` with a body `actorId` → **400** (the audit actor is server-derived, not forgeable).

---

## Automated equivalents (run the whole thing headless)
```bash
./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/eslint . \
  && ./node_modules/.bin/vitest run && ./node_modules/.bin/next build
rm -rf .next && ./node_modules/.bin/playwright test    # golden path US+RO, axe, visual, TTTP
```
Gate evidence: `docs/audit/S06_BROWSER_GATES.md`, `docs/audit/S09_RELEASE_GATE.md`.

---

## 10. LIVE variants (Phase B — now wired; evidence in `docs/audit/LIVE_VERIFICATION.md`)

Everything above runs on the deterministic **offline seed** (the zero-config default). Phase B added three
env-gated LIVE rungs, each defaulting OFF so the offline path is unchanged. Validate them:

### 10a. Live source feeds (keyless — real network) — `npm run live:probe`
```bash
DATA_SOURCE_COMPOSITION=adapters \
  SOURCE_NWS_MODE=live SOURCE_NWPS_MODE=live SOURCE_OPEN_METEO_MODE=live SOURCE_GDACS_MODE=live \
  NWS_USER_AGENT="BEACON (contact: you@example.org)" npm run live:probe
```
- ☐ `/api/v1/status` and `/api/v1/regions/us-ca/map` show **`nwps LIVE` / `open-meteo LIVE`** with real
  (today's) `fetchedAt` timestamps — real data flowed through the redundancy ladder into the COP.
- ☐ Kill the network mid-run → the same call degrades to **CACHED/MOCK/seed**, labelled, never a dead-end.
- ☐ FIRMS/GloFAS need free keys (`FIRMS_MAP_KEY`, `GLOFAS_CDS_KEY`); without them they stay CACHED/MOCK (honest).
- To run the whole app live: `DATA_SOURCE_COMPOSITION=adapters SOURCE_*_MODE=live … npm run dev` then repeat §1–§2.

### 10b. Durable Postgres persistence — `npm run pg:probe`
```bash
docker compose -f infra/docker-compose.yml up -d db
FEATURE_STORE=postgres DATABASE_URL=postgres://beacon:beacon@127.0.0.1:5432/beacon npm run pg:probe
```
- ☐ POST `/reports` → 201; a **fresh** deps instance then `GET /reports` still sees it (durable across restart,
  read from the DB) — `durable=true`. PUBLIC `GET /reports` → **403**.
- ☐ Full stack: `docker compose -f infra/docker-compose.yml up -d --build` → db healthy · migrate exit0 · app
  healthy · 19 tables (see §0 of LIVE_VERIFICATION).

### 10c. Real per-user JWT identity
- ☐ With `AUTH_SECRET` + `AUTH_DEV_LOGIN=on`: `POST /api/v1/auth/dev-login {role,userId}` → a bearer whose
  `sub` becomes the **audit actor** on a subsequent verify (not a role key). Without both, the endpoint 404s
  (opt-in; the offline demo keeps using the `x-beacon-role` dev header).

### 10d. AI-on narration through the compliance proxy
- ☐ Set the cloud profile (`AI_MODE=cloud` + `LLM_TIER_DEFAULT_{MODEL,BASE,KEY}`, a Groq/OpenRouter key) →
  the SitRep gains an **LLM prose paragraph** while every cited **number is identical** to deterministic-only
  (F3 — the LLM never invents a figure). Provider-down → visibly degrades to deterministic-only, citations kept.
- ☐ No key/Ollama on this host → the path is proven via the in-process mock; deterministic-only is the default.

## What is seed/MOCK by default (LIVE rungs validated in Phase B — see `docs/audit/LIVE_VERIFICATION.md`)
By default the app runs on the deterministic offline seed. The LIVE feeds (NWS/NWPS/Open-Meteo/GDACS proven;
FIRMS/GloFAS key-gated), durable Postgres, real per-user JWT, and AI-on narration are all wired and validated
per §10 above — each is an env-gated added rung, never replacing the offline redundancy floor.
