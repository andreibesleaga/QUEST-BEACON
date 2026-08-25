# BEACON — LIVE Verification (Phase B)

*Phase 3 · captured 2026-07-13 on the `phase-b-live` branch. Evidence that BEACON runs on **real data, real
persistence, and real auth identity** end-to-end — with the deterministic offline path preserved as the
redundancy floor (Art. XVI). Companion to `docs/audit/S09_RELEASE_GATE.md` (which documented the pre-Phase-B
offline build) and Phase B of the master delivery plan.*

> **What changed in Phase B.** The 4 leaf lanes (live source adapters, Postgres durable store, real per-user
> JWT, live AI ladder) were built and then **wired into the composition root** so the running app honours three
> added rungs via env, each defaulting OFF (offline-first stays the zero-config default):
> `DATA_SOURCE_COMPOSITION=adapters` · `FEATURE_STORE=postgres` · `AI_MODE=cloud|local`.

> **⚠️ SCOPE STAMP — added 2026-08-02 (lens-1/lens-7), because two documents disagree about this one.**
>
> **What this file DOES evidence** (captured 2026-07-13, with real output): a full `docker compose` stack,
> **real network fetches** over live egress from `open-meteo` and `nwps` carrying real 2026-07-13 timestamps
> (§2), durable Postgres persistence (§3), and real per-user JWT identity (§4).
>
> **What it explicitly does NOT evidence, and says so in §5:** a real MODEL call. There was no Ollama and no
> cloud key on that host. **Any doc that cites this file for "cloud AI proven" is over-claiming** —
> `docs/SUMMARY.md` §2 did, and now carries a correction.
>
> **Conversely,** the earlier sign-off plan §2/§6 says *"Every gate to date ran offline/MOCK … No live
> API call has been made."* Taken literally that is contradicted by §2 below. The accurate statement is:
> **the full live matrix (sign-off plan §6.2, L1–L18) has never been run, no KEYED source has ever been
> exercised live, and no real model has ever been called** — which is the substance the sign-off plan means
> and is still the project's largest untested surface.
>
> **Gate figures in §0 are from 2026-07-13 and are stale.** Machine truth 2026-08-02: `vitest run` →
> **304 files / 3742 tests, 3 FAILING** (`app/_lib/hooks.mutations.e2e.test.tsx`; `docs/SPEC.md` §13.13);
> `depcruise src app` → **730 modules / 0 violations** (`depcruise src` → 570). Re-derive, do not quote.

---

## 0. Gate status (whole tree, after integration)
`tsc 0 · eslint . 0 · depcruise 302 modules / 0 violations · vitest 1050 passed / 2 skipped · coverage
application 100/100/100/100, domain 100 stmts/99.56 branch, all-files 100/99.22 · next build ✅`. The two
skips are host-gated live tests (real Ollama / real Postgres) that run only when their env is present.

---

## 1. Full docker stack — `docker compose up` end-to-end (B3 infra)
`docker compose -f infra/docker-compose.yml up -d --build` → exit 0. This is the flow the S09 package listed as
"CI-ready but never executed end-to-end" — now executed:

| Service | Result |
|---|---|
| `db` (postgres:16.10-alpine, sha-pinned) | **Up (healthy)** |
| `migrate` (`drizzle-kit migrate`) | **Exited(0)** — clean apply of both migrations |
| `app` (`next start`) | **Up (healthy)** |

`GET /api/v1/health` → `{"status":"ok"}` · `GET /api/v1/status` → `{data, provenance[], freshness}` envelope with
headline · `GET /.well-known/sustainability` → schema-valid (`measurement-method: third-party-modeled`) ·
**19** public base tables.

## 2. Live source adapters (B1) — real network fetch — `npm run live:probe`
Env: `DATA_SOURCE_COMPOSITION=adapters`, `SOURCE_{NWS,NWPS,OPEN_METEO,GDACS}_MODE=live`, `FIRMS=mock`
(needs a free `FIRMS_MAP_KEY`), `GLOFAS/METEOALARM_RO=cached`. Drives the real composition
(`createHttpDepsLive → handleHttp`) in-process over working egress:

```
/api/v1/status              → 200   firms MOCK   open-meteo LIVE (2026-07-13T15:36:53Z, real)
/api/v1/regions/us-ca/map   → 200   firms MOCK   nwps LIVE   open-meteo LIVE   (real 2026-07-13 timestamps)
/api/v1/regions/ro/map      → 200   glofas MOCK  meteoalarm-ro MOCK   (cached-empty → mock rung, honest)
```

- **Real LIVE fetches flow through the registry → RedundancyEngine ladder → derivation → envelope.** The
  derivation bridge (`src/main/live-seed.ts`) currently **consumes** `firms` + `open-meteo` (CA incident),
  `firms`/`nwps`/`open-meteo` (CA map), and `glofas`/`nwps`/`meteoalarm-ro` (RO) — which is exactly what the
  probe above shows feed the COP. **`nws` and `gdacs` are built + registered adapters but are NOT YET consumed
  by the derivation bridge** (roadmap — a `Weather`-alert and `HazardSource` slice respectively wait on the
  next wiring pass); flipping their `SOURCE_*_MODE=live` fetches real data but does not yet change the COP.
  Provenance is mode-labelled, never fabricated.
- **Hybrid scope (honest):** no adapter yet supplies infrastructure nodes, population, or trend history
  (Overpass/WorldPop are planned — `config/planned-sources.md`), so those slices stay seeded; the live hazards/
  weather/gauges compute over them. GloFAS implements a gauge port (not hazards), so RO hazards stay seeded.
- **Never dead-ends (Art. XVI):** a source that is down/uncovered falls back to cache→mock→seed and is labelled;
  the COP always renders.
- **Fix landed here:** `assembleLiveCoreSeed` now refreshes the per-region `sources` projection (read by
  `/status`) from the enriched provenance — otherwise `/status` showed seeded MOCK while `/map` was live.

## 3. Durable Postgres persistence (B3) — real DB — `npm run pg:probe`
Env: `FEATURE_STORE=postgres`, `DATABASE_URL=postgres://…@127.0.0.1:5432/beacon` (a real URL, not the local
placeholder the fail-fast refine rejects).

- **Store round-trip** vs the live docker Postgres (`DATABASE_URL_TEST=… vitest read-models.test.ts`): intake →
  triage → list with a **continuous hash chain** → PASS (10/10, incl. the DB-gated case).
- **HTTP durability across a "restart":** POST `/reports` → 201; a **freshly-built** `createHttpDepsLive()`
  instance then `GET /reports` sees the report (`before=1 → after=2`, read from the DB, not in-memory);
  PUBLIC `GET /reports` → **403** (RBAC / Art. XIII intact). The triage audit is committed durably to
  `audit_event` (tamper-evident chain), not lost on restart.
- The incident COP/map/draft-alerts still derive per-read in memory (decision: durable where it matters —
  reports + audit + regions + sources).

## 4. Real per-user JWT identity (B4)
- A verified bearer JWT's `sub` claim is recorded as the true audit actor (`actorId = sub ?? role-key`); the
  offline dev-header path keeps the role-key fallback so the offline demo audit is byte-unchanged.
- `POST /auth/dev-login` is a **demo IdP, opt-in** (needs `AUTH_SECRET` **and** `AUTH_DEV_LOGIN=on`) — a secret
  alone never exposes an arbitrary-role minter (least-privilege hardening applied at integration).
- RBAC + rate-limit stay keyed on the resolved role (spoof-proof); a body `actorId` → 400 (the resume-8 fix).


### §2026-08-25 — CLOSED: the real-model run is now demonstrated

The two caveats below (no cloud key on this host ⇒ AI proven only through the in-process provider) are
**superseded**. `npm run ai:probe` was executed against a **real cloud model via OpenRouter**, through the
full compliance gateway, on the live `us-ca` composition:

```
status      : 200
aiMode      : cloud
citations   : 28
ai_call     : gen_ai.operation.name=llm.narrate · tier=CLOUD · in 2266 / out 1751 tokens
              · cost_usd=0.011021 · stage=upstream · outcome=allow
F3/F-340 (prose carries no figure): PASS
```

Three things this proves that the mock provider could not:

1. **A real model was reached through the gateway** — the audited `ai_call` record carries a real tier,
   real token counts and a real cost, and the gateway stamped it `allow` at the `upstream` stage.
2. **The F3/F-340 guarantee holds against a real model**, not just a deterministic stub: the generated
   prose contains **no figure at all**, while all 28 cited claims are rendered from the deterministic
   record (exposure, population, weather, and 20 authority-ranked news fields).
3. **The news grounding ran on live sources** — latimes.com, fema.gov, gdacs.org, reliefweb.int,
   insurancejournal.com, noozhawk.com, meteoinfo.ru and NASA LANCE were cited by name, with Bluesky and
   Mastodon items separately labelled *"Unverified social report — not corroborated by any authoritative
   source"*.

Reproduce: `PROBE_ROLE=EM AUTH_DEV_TRUST_HEADER=on npm run ai:probe` (the compliance proxy's role-scope
denies the CLOUD tier to PUBLIC by policy, so the probe needs an authorized role; both flags are
process-local and neither is set on the cloud deployment).


## 5. Live AI narration through the compliance proxy (B5)
- `AI_MODE=cloud|local` wires the real env-driven LLM ladder (Groq → OpenRouter → Ollama) **through the
  ComplianceGateway**; the offline MOCK provider remains the fallback when no tier is configured, and
  deterministic-only stays the default. The F3 "LLM never emits a number" guard holds on every rung.
- **Not exercised against a real model here:** this box has no Ollama installed and no cloud key (Groq returns
  403 = reachable-but-unauthenticated). The path is proven end-to-end via the in-process mock provider
  (gateway → seal → ladder → validator → narration). To exercise a real model, set the cloud profile in
  `.env` (see `LLM_TIER_DEFAULT_{MODEL,BASE,KEY}` in `.env.example`) — pending the user's Groq/OpenRouter key.

---

## Honest limitations carried forward
- **AI real-model run** is documented/wired-ready, not demonstrated on this host (no Ollama / no key).
- **FIRMS / GloFAS live** need free keys (`FIRMS_MAP_KEY`, `GLOFAS_CDS_KEY`); they stay CACHED/MOCK otherwise.
- **Production mock/cached fixture fallback**: the adapters resolve their `__fixtures__` dir from
  `import.meta.url`, which points into `.next` in a bundled production build — so the *fixture* fallback rung is
  a dev/docker affordance; production live-mode relies on the network rung (live) then typed-unavailable. The
  offline **seed** default is unaffected. (`next build` no longer bundles those fixtures — `next.config.mjs`
  `module.parser.javascript.url=false`.)
- **Source-record region scoping**: `source_record` has no region column; the pg source read-model returns all
  configured sources for any region (per-region scoping stays available via region-registry overrides).

## Reproduce
```bash
# offline default (no flags) — everything works air-gapped:
npm run dev
# live sources (keyless):
DATA_SOURCE_COMPOSITION=adapters SOURCE_NWS_MODE=live SOURCE_NWPS_MODE=live \
  SOURCE_OPEN_METEO_MODE=live SOURCE_GDACS_MODE=live NWS_USER_AGENT="BEACON (contact: you@example.org)" \
  npm run live:probe
# durable Postgres:
docker compose -f infra/docker-compose.yml up -d db
FEATURE_STORE=postgres DATABASE_URL=postgres://beacon:beacon@127.0.0.1:5432/beacon npm run pg:probe
# full stack:
docker compose -f infra/docker-compose.yml up -d --build
```
