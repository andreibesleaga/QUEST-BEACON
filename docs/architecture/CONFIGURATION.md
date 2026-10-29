# BEACON — Configuration & Feature-Flag Reference

*Everything is configurable via environment variables (12-factor). No model, provider, API endpoint,
key, region, or infrastructure choice is hardcoded. This file is the **single source of truth** for
configuration; `.env.example` is the committed, secret-free template. Elaborated/validated at S03; the
running config schema is enforced at app boot (fail-fast on invalid/missing required values).*

Conventions: every flag has a **safe default** that keeps BEACON fully functional **offline/local** with
no paid service. Switching a flag never requires a code change (Article XV/XVI). Booleans: `on|off`.
Enumerated flags list the **default first**.

> **Correction — 2026-08-02 (lens-7 machine recount, F-411 class).** Twenty rows in §3/§3a listed their
> values **default-first-wrong**, so this file — which declares itself the single source of truth for
> configuration — stated the opposite default from the code for the entire D4/D5 + D6 tier:
>
> - The ten `FEATURE_D4_*` / `FEATURE_D6_*` server flags read `off | on`, i.e. **default off**, while
>   `src/config/index.ts:181-192` and `:224-228` declare `featureFlag(['off','on'], 'on')` — **default on**.
>   The *same table cells* already said "**On by default** (entrant decision 2026-07-31, F-170 / F-193/F-155)"
>   in their prose, so the row contradicted itself as well as the code. Corrected to `on | off`.
> - The ten `NEXT_PUBLIC_FEATURE_D4_*` / `NEXT_PUBLIC_FEATURE_D6_*` mirrors read `on | off`, implying an
>   independent default of `on`. The code declares them `z.enum(['off','on']).optional()`
>   (`src/config/index.ts:255-264`) and **fills an unset mirror from its server flag** in the schema
>   transform (`:345-352`). An independent default is precisely the F-240 trap that transform removed —
>   under it, turning one feature off required setting two variables and getting it wrong **refused to
>   boot**. Corrected to `(unset ⇒ inherits) | on | off`, matching how `NEXT_PUBLIC_FEATURE_ANTICIPATORY_PANEL`
>   (§3b) already documents the identical mechanism.
>
> **How this was recounted:** every `featureFlag([...], 'default')` and `.default(...)` in
> `src/config/index.ts` was extracted mechanically and diffed against this file's "Values (default first)"
> column and against `.env.example`. Re-derive with that diff, never by eye.

---

## 1. Runtime & deployment

| Var | Values (default first) | Purpose |
|---|---|---|
| `NODE_ENV` | `development` \| `production` \| `test` | Standard Node env |
| `DEPLOY_MODE` | `local` \| `cloud` | `local` = air-gapped-capable docker-compose, no egress; `cloud` = free-tier hosts |
| `APP_PORT` | `3000` | Next.js port |
| `APP_BASE_URL` | `http://localhost:3000` | Public base URL (CAP sender, links) |
| `LOG_LEVEL` | `info` \| `debug` \| `warn` \| `error` | PII-redacted structured logs (Article IV) |
| `BEACON_WARMUP_DELAY_MS` | `10000` | Delay, in milliseconds, before the boot-time composition warm-up starts. `0` starts immediately; invalid, non-finite, or negative values fall back to `10000` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | _(empty=disabled; **recommended in prod**)_ | OpenTelemetry GenAI traces + per-step cost attribution (ADR-022). Empty disables the exporter; set it in production so every model/tool call is traced (`gen_ai.usage.*` semconv) |
| `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` | `false` | Keep prompt/response content OUT of traces (privacy-by-default; Article IV/VI, COMPLIANCE_MATRIX C27). Never flip to `true` in prod — it would put PII into spans |

## 2. Database / persistence

| Var | Values (default first) | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgres://beacon:beacon@localhost:5432/beacon` | Postgres canonical store |
| `DATABASE_URL_DEV` | _(=DATABASE_URL)_ | Used by the `postgres-dev` MCP server |
| `FEATURE_STORE` | `memory` \| `postgres` | Durable store for public reports + hash-chained triage audit + regions + sources. `memory` = offline-first default (Art. XVI); `postgres` moves those stores onto the DB (incidents COP stays in-memory either way). `postgres` **requires a real `DATABASE_URL`** — the placeholder default is rejected fail-fast |
| `FEATURE_SPATIAL` | `turf` \| `postgis` | Geo-compute engine (Turf = no PostGIS dependency) |
| `FEATURE_CACHE` | `memory` \| `redis` | Cache backend. `redis` is not built in this release: it selects a stub whose every call returns an error (`src/adapters/cache/redis-cache.ts`) |
| `REDIS_URL` | _(empty)_ | Required only if `FEATURE_CACHE=redis` or `FEATURE_QUEUE=bullmq` or `FEATURE_REALTIME` uses Redis Streams |

## 3. Workers / queue / realtime (feature-flagged infra — Article XVI)

| Var | Values (default first) | Purpose |
|---|---|---|
| `FEATURE_QUEUE` | `cron` \| `bullmq` | Ingestion worker engine. `cron` = zero-dependency; `bullmq` is validated (needs `REDIS_URL`) but not built: no adapter implements `QueuePort` |
| `FEATURE_EVENTBUS` | `memory` \| `redis` | Delta event bus. Only the in-memory bus exists (`src/adapters/eventbus/`); `redis` is not built |
| `FEATURE_REALTIME` | `sse` \| `polling` | Browser push. SSE primary; polling is the auto-fallback if the stream drops (the browser client `app/_lib/sse.ts` then refetches every 15 s). The flag itself is read only by the schema (`src/config/index.ts`); no server-side polling adapter exists |
| `INGEST_DEFAULT_INTERVAL_SEC` | `300` | Default poll cadence (per-adapter overrides below) |
| `SSE_DEBOUNCE_MS` | `1500` | Coalesce window for delta pushes |
| `SSE_HEARTBEAT_SEC` | `15` | Liveness heartbeat. **Corrected 2026-08-01 (F-411 class): this row said `20`; the code default is `15`** (`app/api/v1/stream/route.ts` `heartbeatMsFromEnv`, and `.env.example:42`). `0`/invalid ⇒ heartbeat disabled |
| `SSE_MAX_CONNECTIONS` | `100` | Max CONCURRENT open SSE streams **per process** (F-351). `/api/v1/stream` is the one endpoint that bypasses the request rate limiter — the delegator calls `handleStream` directly, never `handleHttp` — and each request holds a stream open indefinitely, so this is an **availability** guard, and availability is the product during an incident. Over the cap ⇒ a **labelled 503 + `Retry-After`** naming the polling fallback, never a silent drop (Art. XVI). Unset or invalid ⇒ the built-in default; **it cannot be disabled by a typo** |
| `FEATURE_CAMERAS` | `on` \| `off` | E11 "Live Views" — gates the camera source family (`caltrans-cctv`/`alertwildfire`/`windy-webcams`/`dot511`/`cnadnr-ro`) into the composition; the `cameras` map layer itself defaults OFF in the UI regardless (opt-in). On by default; offline-safe (sources default MOCK/CACHED). See §6c |
| `FEATURE_EXTERNAL_VIEWS` | `on` \| `off` | E11 "Live Views" — pure coordinate deep-links (Google Earth 3D/Maps/Street View/NASA Worldview, plus NASA FIRMS active fires + Google Flood Hub…) in the SitRep panel; no key/cost/network. On by default (ADR-028) |
| `NEXT_PUBLIC_FEATURE_EXTERNAL_VIEWS` | *(unset ⇒ inherits)* \| `on` \| `off` | Browser mirror of `FEATURE_EXTERNAL_VIEWS`, added in the live-demo delivery increment, session 1 (ADR-037 §1). Joins the same `LIVE_VIEWS_BROWSER_MIRRORED_FLAGS` mechanism as `NEXT_PUBLIC_FEATURE_ANTICIPATORY_PANEL` (§3b): declared `.optional()`, an unset mirror **inherits** the server flag, and an explicit disagreement **refuses to boot** (`src/config/index.ts`). **Session 1, landing — verified by reading the code, not by argument.** Until this mirror existed, `FEATURE_EXTERNAL_VIEWS=off` was documented but INERT: `app/_components/panels/sitrep-panel.tsx` says so in its own comment ("`FEATURE_EXTERNAL_VIEWS` is currently a server-only config flag with no client-side wire-up") and renders the External Views section unconditionally whenever a map position is available, regardless of the flag. The schema-level mechanism (validated mirror + inherit) is real as of this session; the client component has **not yet** been changed to read it — grepped, no other reference exists in `app/`. Setting `off` still changes nothing on screen until that wire-up lands |
| `FEATURE_CITIZEN_STREAM` | `off` \| `on` | E11 "Live Views" — consent+HITL-gated citizen live-view link on SOS intake; **server-side authority** (rejects the field with 400 when off, never silently drops it). Off by default (ADR-029). Client mirror: `NEXT_PUBLIC_FEATURE_CITIZEN_STREAM` (§10) — UX-only, the server flag is authoritative |
| `DRILL_MODE` | `off` \| `on` | MW-D/D4 exercise mode (ADR-034 §7). `on` selects a **separate composition** (`src/main/build-drill.ts`) that never constructs a live channel. The flag is *not* what keeps an exercise artifact off a real channel — three structural layers are: a drill artifact's `capStatus:'EXERCISE'` is not assignable to the `'ACTUAL'` literal `AlertSinkPort.emit` requires (emitting one is a `tsc` error), the drill composition never calls `makeBroadcastDeps`, and the dependency-cruiser rule `drill-never-reaches-a-live-channel` fails the build if that subgraph ever imports a messaging transport. Off by default |
| `NEXT_PUBLIC_DRILL_MODE` | `off` \| `on` | Browser mirror for the persistent EXERCISE banner. **The server `DRILL_MODE` is authoritative**; unlike the other two `NEXT_PUBLIC_*` flags this one is declared in `EnvSchema`, so `loadConfig` **refuses to boot when the two disagree** — an exercise whose UI forgot to say "EXERCISE" is the failure FOP-4 exists to prevent |
| `FEATURE_D4_RUMOR_BOARD` | `on` \| `off` | MW-D/D5 rumor & misinformation board (FR-D4-1, FEV-20, ADR-036 §7). A read-only projection over the **existing** deterministic news-grounding pass (`src/application/sitrep-synthesis/news-grounding.ts`) — it re-counts nothing; the three summary figures are carried through by identity. A flagged item is listed with its flag reason and is **never merged into a fact**: `RumorRow.flagged` is the literal `true` and `corroboratingSourceCount` the literal `0`, so laundering one is a `tsc` error, and a flagged fact that arrives carrying corroborating sources makes the whole board fail closed. **On by default** (entrant decision 2026-07-31, F-193/F-155; set `off` for the most conservative deployment) |
| `FEATURE_D4_MUTUAL_AID` | `on` \| `off` | MW-D/D5 mutual-aid request board (FR-D4-2, FEV-21). A **view** over `ResourceTask` rows correlated by their EDXL-RM `edxlRmRef` — BEACON has no `ResourceRequest` entity and the board says so rather than implying a richer model. Capacity/distance matching is **not** re-implemented (it already exists in `src/application/pre-positioning/`). ⚠ The related **inbound EDXL-RM schema validation is deliberately NOT behind this flag** — `edxlRmToResourceTask` now validates every inbound document against `schemas/edxl-rm.schema.json` unconditionally (finding F-31), because a validation gate an operator can switch off is not a gate. **On by default** (entrant decision 2026-07-31, F-193/F-155; set `off` for the most conservative deployment) |
| `FEATURE_D4_SHELTER_STATUS` | `on` \| `off` | MW-D/D5 shelter supply board + RFC-4180 CSV export (FR-D4-3, FEV-22). Aggregate only — `{shelter_id, status, capacity, occupancy, available, utilization}`, no occupant and no geometry — and the export is fail-closed through `guardAggregateOnly` (ADR-035 §4 Layer D). Provenance (`LIVE`/`CACHED`/`MOCK`, the domain's own `SOURCE_MODES`) is a **required** input and the rendered claim can only say "live" when the mode is `LIVE`: shelters are still hand-seeded, since no shelter source adapter exists yet (findings F-35/F-154). **On by default** (entrant decision 2026-07-31, F-193/F-155; set `off` for the most conservative deployment) |
| `FEATURE_D4_DAMAGE_REPORTS` | `on` \| `off` | MW-D/D5 damage & needs assessment (FR-D4-4, FEV-23). Rides the **unchanged** consent → triage → verify pipeline (`src/domain/public-report.ts`): an assessment entry derives its `triageStatus` from the report itself and cannot be handed a state the pipeline did not produce. Produces **one bucket per triage state and no grand total** — a figure mixing VERIFIED with UNVERIFIED cannot be constructed — and labels every non-verified figure `unverified — not authoritative`. **On by default** (entrant decision 2026-07-31, F-193/F-155; set `off` for the most conservative deployment) |
| `FEATURE_D4_EMS_OVERLAY` | `on` \| `off` | MW-D/D5 authoritative post-event damage overlay (FR-D4-5, FEV-24). **EMS here is the Copernicus Emergency _Management_ Service**, not Emergency Medical Services (finding F-150). Published DELINEATION/GRADING products are shown as attributed, production-dated **link-outs**: attribution, licence and production date are domain invariants, so an unattributed or undated overlay cannot exist as a value. Consume-only and link-only — no geometry is rehosted or re-derived, no network primitive exists in the module, and BEACON never requests a mapping activation. **On by default** (entrant decision 2026-07-31, F-193/F-155; set `off` for the most conservative deployment) |
| `FEATURE_D6_VOLUNTEER_TEAMS` | `on` \| `off` | MW-D/D6 volunteer **teams** as an aggregate unit (FR-D6-1, FEV-25, ADR-035 §4; `src/application/aggregate/volunteer-team.ts`). A team carries `callsign`, `headcount`, `skills`, `availability` — a UNIT, never a roster. Adding a member/name/contact field is a `tsc` error (`AggregateOnly<VolunteerTeamFields>` is the factory's return type), a schema-walk failure and a runtime-walk failure at once. The callsign `pattern`/`maxLength` are **read from** `schemas/d6-volunteer-team.schema.json`, not restated in code. **Scope, stated plainly:** this ships the fields, their invariants and their guard — it does **not** add `'TEAM'` to `RESOURCE_KINDS`, the DB CHECK or the logistics board, so "taskable end-to-end in the browser" is not yet true (ADR-035 §4 blocks it on F15/F-140). **On by default** (entrant decision 2026-07-31, F-170; set `off` for the most conservative deployment) |
| `FEATURE_D6_SUPPLIES` | `on` \| `off` | MW-D/D6 relief **supply** lots (FR-D6-2, FEV-26; `src/application/aggregate/supplies.ts`). Adds `quantity` (integer stock count — deliberately **not** `amount`), `unit` (closed enum), `expiresAt`. A quantity without a unit is rejected rather than guessed. **No donor field and no payment field, ever** — `donor`/`donorId`/`payment`/`amount`/`cardNumber`/`iban`/`account` are all denylisted, so this is structurally blocked at four layers, not merely undocumented. Does **not** wire supplies into `rankByExtent` (`src/application/pre-positioning/`), and adds no capacity-vs-demand matcher. **On by default** (entrant decision 2026-07-31, F-170; set `off` for the most conservative deployment) |
| `FEATURE_D6_REUNIFICATION_LINKS` | `on` \| `off` | MW-D/D6 family-reunification **link-out** (FR-D6-3, FEV-27; `src/application/aggregate/reunification-links.ts`). A pure function of a region id → `{label, provider, rung, iso?, url}` for the ICRC Family Links network and, where one is listed, the region's national society — keyed by ISO from `config/regions.json`, so a new region for a listed country inherits its link with no code change. **Handles zero data**: no input field, no query, no form, no POST, no fetch, no result — which is exactly what makes it constitutional; a reunification **registry** is PERMANENTLY OUT (ADR-035 §4). Art. XVI: the GLOBAL rung is always emitted, so an unknown region degrades-and-labels instead of dead-ending. **Honest limitation:** the URLs are static, human-curated and unmonitored; four of six were confirmed by fetch at authoring time and two answered automated requests with HTTP 403 bot protection, so their liveness is unconfirmed rather than verified. **On by default** (entrant decision 2026-07-31, F-170; set `off` for the most conservative deployment) |
| `FEATURE_D6_INCIDENT_EXPORT` | `on` \| `off` | MW-D/D6 **incident summary export** at close (FR-D6-4, FEV-28; `buildIncidentSummary`, `src/application/aggregate/incident-summary.ts`). Reads only already-held aggregates (alerts issued, tasks completed, shelter usage, affected area) and collects nothing new. Pure and clock-free (`generatedAt` is injected), so the same input yields a byte-identical document. `provenance[]` is **required and non-empty** (Art. XI), `freshness` is the **oldest** `fetchedAt` (never the newest, and never newer than `generatedAt`), and `caveats[]` are **derived from the document's own content** rather than written beside it. Layer D is wired here: `guardAggregateOnly` runs over the constructed document and the error branch is propagated **instead of** the payload — the shape `src/adapters/alerting/alert-sink.ts:121` already uses. **On by default** (entrant decision 2026-07-31, F-170; set `off` for the most conservative deployment) |
| `FEATURE_D6_CASUALTY_TALLY` | `on` \| `off` | MW-D/D6 aggregate **casualty tally** (FR-D6-5, FEV-29; `src/application/aggregate/casualty-tally.ts`). A count and its caveat — no names, no ages, no triage tags, no medical detail (all denylisted keys). The mandatory `"unverified — not authoritative"` label and `authoritative:false` are **required fields of the value**, set by the factory and pinned by JSON-Schema `const`, so the caveat travels *with* the number to every render and export site instead of being written beside it. Zero is preserved as a meaningful count. **Honest limitation:** the guard constrains the shape of the tally; it cannot make the number true. **On by default** (entrant decision 2026-07-31, F-170; set `off` for the most conservative deployment) |

### 3a. D4/D6 browser mirrors (F-173, ADR-035 §4)

> **Built as a working pair, not ten dead env vars.** ADR-035 §4 asks for `NEXT_PUBLIC_` mirrors of the
> D4/D6 flags so a browser surface can read them. The D6 lane deliberately did NOT add them (F-173): it
> owned no browser surface, and an unread mirror would repeat **F-32**'s defect class — a config value that
> exists and nothing reads. The fix is not "add the ten vars"; it is "add the ten vars **plus the mechanism
> that keeps them honest**" — the same `.refine()` pattern `NEXT_PUBLIC_DRILL_MODE` (§3 above) already uses.
> Each mirror is declared in `EnvSchema` (`src/config/index.ts`), so `loadConfig` **refuses to boot** when a
> mirror disagrees with the server flag it mirrors, naming the offending flag in the error. The ten mirror
> field names and the ten parity checks are both derived from one local array
> (`D4_D6_BROWSER_MIRRORED_FLAGS`) rather than re-typed independently — the F-24/F-140/F-141/F-190/F-192
> root-cause class (a re-declared contract drifts, a derived one cannot) applied to this file's own flag
> list, without importing across the config→application boundary the way `d6-flags.ts` and
> `coordination-flags.ts` derive `Env`'s keys the other direction.
>
> **Honesty (F-152): these ten mirrors exist ahead of their consumer.** Nothing in `src/main/**` composes
> the D4/D6 modules yet, so no browser surface reads any of these ten today — same as the server flags they
> mirror. The refine is precisely what keeps that "ahead of its consumer" state from rotting into F-32's
> defect class while it waits: an operator (or a future panel wired with the wrong value) cannot boot with
> a mirror that lies about the server flag.

| Var | Values (default first) | Purpose |
|---|---|---|
| `NEXT_PUBLIC_FEATURE_D4_RUMOR_BOARD` | *(unset ⇒ inherits)* \| `on` \| `off` | Browser mirror of `FEATURE_D4_RUMOR_BOARD`. `loadConfig` refuses to boot if they disagree |
| `NEXT_PUBLIC_FEATURE_D4_MUTUAL_AID` | *(unset ⇒ inherits)* \| `on` \| `off` | Browser mirror of `FEATURE_D4_MUTUAL_AID`. `loadConfig` refuses to boot if they disagree |
| `NEXT_PUBLIC_FEATURE_D4_SHELTER_STATUS` | *(unset ⇒ inherits)* \| `on` \| `off` | Browser mirror of `FEATURE_D4_SHELTER_STATUS`. `loadConfig` refuses to boot if they disagree |
| `NEXT_PUBLIC_FEATURE_D4_DAMAGE_REPORTS` | *(unset ⇒ inherits)* \| `on` \| `off` | Browser mirror of `FEATURE_D4_DAMAGE_REPORTS`. `loadConfig` refuses to boot if they disagree |
| `NEXT_PUBLIC_FEATURE_D4_EMS_OVERLAY` | *(unset ⇒ inherits)* \| `on` \| `off` | Browser mirror of `FEATURE_D4_EMS_OVERLAY`. `loadConfig` refuses to boot if they disagree |
| `NEXT_PUBLIC_FEATURE_D6_VOLUNTEER_TEAMS` | *(unset ⇒ inherits)* \| `on` \| `off` | Browser mirror of `FEATURE_D6_VOLUNTEER_TEAMS`. `loadConfig` refuses to boot if they disagree |
| `NEXT_PUBLIC_FEATURE_D6_SUPPLIES` | *(unset ⇒ inherits)* \| `on` \| `off` | Browser mirror of `FEATURE_D6_SUPPLIES`. `loadConfig` refuses to boot if they disagree |
| `NEXT_PUBLIC_FEATURE_D6_REUNIFICATION_LINKS` | *(unset ⇒ inherits)* \| `on` \| `off` | Browser mirror of `FEATURE_D6_REUNIFICATION_LINKS`. `loadConfig` refuses to boot if they disagree |
| `NEXT_PUBLIC_FEATURE_D6_INCIDENT_EXPORT` | *(unset ⇒ inherits)* \| `on` \| `off` | Browser mirror of `FEATURE_D6_INCIDENT_EXPORT`. `loadConfig` refuses to boot if they disagree |
| `NEXT_PUBLIC_FEATURE_D6_CASUALTY_TALLY` | *(unset ⇒ inherits)* \| `on` \| `off` | Browser mirror of `FEATURE_D6_CASUALTY_TALLY`. `loadConfig` refuses to boot if they disagree |

### 3b. D2 anticipatory action (MW-D/D7; ADR-034, FR-AA-1…FR-AA-4)

> **A DISPLAY gate, not an action gate.** `FEATURE_ANTICIPATORY_PANEL` gates the COP's Anticipatory Action
> panel — the first surface over lane D2's trigger-evaluation engine (`src/application/anticipatory/**`),
> which was fully tested and completely unreachable from the running app (the F-81/F-152 "a feature with no
> on-camera moment" class). The engine it surfaces is a pure function that holds no port, emits nothing and
> tasks nothing (`ANTICIPATORY_CANNOT_EMIT` is a `tsc`-checked assertion), so this flag can never be the
> difference between acting and not acting — only between showing an evaluation and not showing it.
>
> **Why `off` by default.** Not "new surface, new risk": the COP's Playwright visual baselines have **zero
> regenerations left** (F-194), and a panel that rendered by default would move them. With the flag off,
> neither the tab trigger nor the panel body exists in the DOM, so the default COP render is byte-identical
> — verified by RUNNING Playwright, not by argument (F-47/F-94, the "ship inert, cost nothing" precedent set
> by the storm layer and the Outlook section). Turning it on = this one variable plus one baseline
> regeneration; no code change.
>
> **Unlike the ten D4/D6 mirrors, this mirror HAS a consumer today** (F-32 is not merely deferred here):
> `app/_components/panels/anticipatory-panel.tsx` reads `NEXT_PUBLIC_FEATURE_ANTICIPATORY_PANEL` and
> `app/page.tsx` gates the tab trigger from the same exported constant — one gate read twice, never two
> flags that could disagree. The mirror is checked and inherited by the SAME composed list the ten D4/D6
> mirrors use (`BROWSER_MIRRORED_FLAGS` = the D4/D6 list + the D2 list), so there is one mechanism, not two.

| Var | Values (default first) | Purpose |
|---|---|---|
| `FEATURE_ANTICIPATORY_PANEL` | `off` \| `on` | COP anticipatory-action panel: the EAP trigger ladder, the k-of-N member-count evidence behind each decision, source-stated lead time, the classifier's own method string, the pre-agreed actions a fire SUGGESTS, the roles that must approve, and the STOP mechanism. Every figure is the engine's — the panel computes none and the LLM contributes none. Fixture-fed and labelled `FIXTURE`: `TriggerSourceTier` has no `LIVE` member (F-34), so this surface cannot claim live data |
| `NEXT_PUBLIC_FEATURE_ANTICIPATORY_PANEL` | *(unset ⇒ inherits)* \| `off` \| `on` | Browser mirror of `FEATURE_ANTICIPATORY_PANEL` — the flag the panel actually reads, since it is a client component. **Leave it unset and it inherits the server flag** (F-240): turning the panel off is ONE variable. An EXPLICIT contradiction refuses to boot, naming the offending variable |

> **The D6 hard boundary is not enforced by these flags.** ADR-035 §4 / FR-D6-6 ("no person-identifying field
> on any D6 entity") is enforced by four independent layers built in D6.0 and *reused* — not re-implemented —
> by every module above: **A** `AggregateOnly<T>` at `tsc` time, **B** a recursive walk of every
> `schemas/d6-*.schema.json` (all five now exist, and the walker picked each new one up with zero change to
> the guard), **C** a runtime key walk over maximal factory output, **D** `guardAggregateOnly` at the export
> boundary. Turning a flag `on` never widens what a D6 entity may carry.

**Governance parameters are config, not code** (ADR-012): the SOP approval chain (`authorizerRole`,
`fallbackRole`, `fallbackAfterMinutes`), the Art. XIV retention window enforced by the purge sweep, and the
drill default live in **`config/governance.json`**, validated by **`schemas/governance.schema.json`** and
parsed fail-fast at import by `src/application/governance/governance-config.ts`. The schema permits only
`VERIFIER`/`EM` in either approval slot and has `additionalProperties: false`, so an auto-approve setting is
not expressible: a delegation widens *who* may approve, never *whether* approval is required (Art. XIII).

**Retention sweep scheduling** (`docs/audit/UNIMPLEMENTED_REGISTER.md` row 20; the live-demo delivery increment (ADR-037)
session 1, ADR-037). The purge EXECUTOR (`src/application/governance/retention-sweep.ts`) applies the
`config/governance.json` retention window above and is real and tested — but on its own it is only a
function; nothing in the composed app called it, so the Art. XIV "no PII beyond the incident lifecycle"
guarantee held only if an operator ran it by hand. These two vars drive the scheduler seam
(`src/main/scheduler.ts`) built to start it automatically at composition.

| Var | Values (default first) | Purpose |
|---|---|---|
| `RETENTION_SWEEP_ENABLED` | `on` \| `off` | Starts the retention-purge loop at server composition (never under test/gate — tests inject their own timer). Default **on**: a privacy guarantee that must be switched on by hand is not a guarantee |
| `RETENTION_SWEEP_INTERVAL_SEC` | `3600` | Sweep cadence. The sweep is idempotent and cheap, so the default (1 h) is generous rather than tight |

**Session 1, landing — verified by reading the code, not by argument.** `EnvSchema` validates both vars
today (`src/config/index.ts`). `src/main/scheduler.ts` now exists and exports `startBackgroundJobs`, which
reads `RETENTION_SWEEP_ENABLED`/`RETENTION_SWEEP_INTERVAL_SEC` and runs `retention-sweep.ts` on the
configured cadence — but nothing in `src/main/**` or `app/**` calls `startBackgroundJobs` yet (grepped: its
only references outside its own file are its own comments and tests). Until the composition root is patched
to call it at boot, the sweep still only runs when invoked by hand, whatever `RETENTION_SWEEP_ENABLED` says.

**Periodic live re-ingest** (V2·A12). The live composition (`createHttpDepsLive`) is memoised behind ONE
promise per server process (`src/adapters/channels/http/http-dispatcher.ts` — `cachedAsync`), so
`assembleLiveSeeds` ran at the first request and **never again**. Everything downstream inherited that: the
COP's incidents, the map geometry and every `fetched_at` were a **boot-time snapshot**, re-stamped per boot
rather than per fetch, and an incident that started after boot could not appear until the process was
restarted. This var is what re-runs the composition and atomically swaps the served picture
(`src/main/live-refresh.ts`), driven from the same `src/main/scheduler.ts` loop as the two jobs above.

| Var | Values (default first) | Purpose |
|---|---|---|
| `LIVE_REINGEST_INTERVAL_SEC` | `0` (off) \| `>= 60` | Seconds between live re-ingests. **0 is off and is exactly today's behaviour**, so every offline/air-gapped/memory/Playwright profile is unchanged until an operator sets it. **900 is the recommended LIVE value**; the schema refuses 1–59 |

**Why the recommended value is 900 and the floor is 60 — read this before lowering it.** A re-ingest is a
*full fan-out*: every enabled adapter, for every region. The adapter cache cannot throttle it, because that
cache is **last-known-good only** — the LIVE rung calls upstream *first* and reads cache only when the call
fails (`src/adapters/_shared/redundancy.ts`), and `assembleLiveSeeds` builds a fresh `makeCachePort` per run,
so a manifest's `cache.ttlSec` suppresses nothing *between* runs. What the manifests *do* tell you is how
often each source actually changes: `intervalSec` in `config/adapters.json` is **300 s at the fastest and
900 s for most of the 45 adapters**. Polling a free public service faster than it publishes buys no freshness
and spends somebody else's bandwidth. The floor is 60 rather than 300 only because a `SOURCE_*_MODE=MOCK` /
`CACHED` posture contacts no upstream at all and may legitimately want a tight demo loop.

> **Operator warning — `cached` on a cloud deploy means MOCK.** The last-known-good cache is written from
> exactly one place: the live fetch inside `RedundancyEngine.tryLive`. A source in `CACHED` mode never takes
> that path, so it never warms its own cache. A container that starts with a cold cache therefore serves the
> recorded fixture for the life of the deployment — labelled `MOCK`, honestly, but a fixture. On a platform
> where the cache is in-memory and every deploy restarts the container (Railway, for one), `cached` is mock
> permanently. For real data that still degrades gracefully, use `live`: its ladder is live → cache → mock,
> and it is the only mode that ever writes the cache. Pinned by three tests in
> `src/adapters/_shared/redundancy.test.ts`.

**Three guarantees, structural rather than promised.** *Never a half-built picture* — the new seeds are
assembled in full and the swap is a single synchronous statement (`swapHttpDepsAsync`), so a reader gets the
old complete picture or the new complete picture, never a mixture. *A failed re-ingest keeps the last good
picture and re-stamps nothing* — an assembly that yields nothing live commits nothing, so a degraded upstream
degrades freshness rather than the COP's existence (Art. XVI); an assembly that throws propagates so the
scheduler records `SCHEDULED_JOB_FAILED` and the loop continues (FR-LD-12). *Runs never stack* — the
scheduler drops a tick that arrives while the previous re-ingest is still in flight, which matters here
because the composition does ~17 s of real work across five regions. A completed re-ingest rings the
**existing** SSE doorbell (one `incident.updated` delta with `entity: '*'` per attributed region) so
connected clients refetch; no new frame type was introduced and no figure travels (Art. XII).

**What a refresh replaces, and what it deliberately does not.** Only the two halves derived from the live
seeds are rebuilt: the core interaction and the map read-model. The event bus (open SSE subscriptions), the
rate limiter (token buckets), the report store, the interop/alert stores and the logistics store are carried
over by reference. Under the memory posture, re-seeding the core does reset core state that is not the
shared report store (an alert approved since boot, a stored SitRep); under `FEATURE_STORE=postgres` — the
live-production posture — those live in the database and are untouched.

## 4. AI — text LLM (env-driven model & provider; full fallback ladder)

> The app's `LLMPort` uses LiteLLM. Each **tier** independently configures provider + model + API base +
> key, so you can point any tier at any OpenAI-compatible endpoint. The ladder degrades
> cloud → alt → local Ollama → **deterministic-only**.

| Var | Values (default first) | Purpose |
|---|---|---|
| `AI_MODE` | `off` \| `cloud` \| `local` | `off` = deterministic-only (no narrative); `local` = Ollama only; `cloud` = full ladder. **Default corrected 2026-08-02 (lens-7): this row read `cloud \| local \| off`, i.e. default `cloud`. The code default is `off`** — `featureFlag(['cloud','local','off'], 'off')` at `src/config/index.ts:80`, and `resolveAi` (`src/main/build-core.ts:66-77`) wires the LLM ladder **only** when the RAW env explicitly says `cloud` or `local`, so an unset `AI_MODE` yields deterministic-only. Off-by-default is the offline-first posture the whole document promises; the old row promised the opposite. ⚠️ **`.env.example:52` still ships `AI_MODE=cloud`** (another lane's file — reported, not changed here): copying `.env.example` to `.env` therefore turns cloud AI ON, which is a deliberate demo convenience but is **not** the code default and should not be quoted as one |
| `AI_NARRATION_DEADLINE_MS` | integer ms | **ADR-038 (V2).** How long a SitRep **read** may wait for narration. Positive ⇒ the model is raced against this deadline: prose that arrives in time is used as before; prose that does not leaves the report `deterministic-only` while the call continues in the background and lands in the narration memo, so the next read serves it. `0` ⇒ fully synchronous (pre-V2). Read from RAW env in `resolveAi` (`src/main/build-core.ts`), consulted only when `AI_MODE=cloud\|local`. **Default `1500`** — on by default because a synchronous cloud call exceeds the platform's 60 s edge timeout, which showed the operator an error instead of the deterministic report they already had |
| `AI_NARRATION_CACHE_TTL_SEC` | integer seconds | Narration-memo TTL (`src/adapters/compliance/narration-memo.ts`). An identical (role, tier, operation, facts) request inside the window is served from cache — no tokens, no audit record, because no model was reached. The memo also **single-flights**: concurrent identical requests join one upstream call (ADR-038). `0` ⇒ memoization disabled, gateway returned unwrapped. Default `120` |
| `LLM_TIER_DEFAULT_PROVIDER` | `groq` | Primary provider (LiteLLM provider id) |
| `LLM_TIER_DEFAULT_MODEL` | `openai/gpt-oss-120b` | Primary model — current Groq-served open-weight id (cheap tier uses `openai/gpt-oss-20b`) |
| `LLM_TIER_DEFAULT_API_BASE` | _(provider default)_ | OpenAI-compatible base URL override |
| `LLM_TIER_FALLBACK_PROVIDER` | `openrouter` | Second rung |
| `LLM_TIER_FALLBACK_MODEL` | `anthropic/claude-haiku-4-5` | Second-rung model |
| `LLM_TIER_LOCAL_PROVIDER` | `ollama` | Offline rung |
| `LLM_TIER_LOCAL_MODEL` | `llama3` | Offline model |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Local Ollama endpoint (human-facing; the resolver reads `LLM_TIER_LOCAL_BASE`) |
| `LLM_TIER_DEFAULT_BASE` | _(unset → tier skipped)_ | **Resolver-read** OpenAI-compatible base for the default (Groq) rung, e.g. `https://api.groq.com/openai/v1` |
| `LLM_TIER_DEFAULT_KEY` | _(unset)_ | **Resolver-read** API key for the default rung (e.g. `${GROQ_API_KEY}`) |
| `LLM_TIER_FALLBACK_BASE` | _(unset → tier skipped)_ | **Resolver-read** base for the fallback (OpenRouter) rung, e.g. `https://openrouter.ai/api/v1` |
| `LLM_TIER_FALLBACK_KEY` | _(unset)_ | **Resolver-read** API key for the fallback rung (e.g. `${OPENROUTER_API_KEY}`) |
| `LLM_TIER_LOCAL_BASE` | _(unset → tier skipped)_ | **Resolver-read** base for the local (Ollama) rung — use `http://localhost:11434/v1` (trailing `/v1`; the provider appends `/chat/completions`) |
| `LLM_TIER_LOCAL_KEY` | _(unset; key-less)_ | **Resolver-read** API key for the local rung (Ollama needs none) |
| `LLM_MAX_INPUT_TOKENS` | `8000` | Grounding-context cap per SitRep |
| `LLM_MAX_OUTPUT_TOKENS` | `1500` | JSON-schema-bounded output cap |
| `LLM_TEMPERATURE` | `0.1` | Low — grounded synthesis, not creativity |
| `LLM_REQUEST_TIMEOUT_SEC` | `30` | Per-call timeout before laddering down |

> **Model ids verified 2026-06-29; pin a currently-served id at build (Research Gate) — Groq's
> deprecation page is authoritative.** Groq's `llama-3.1-70b-versatile` is **DECOMMISSIONED** (errors
> since 2025-01-24) and `llama-3.1-8b-instant` / `llama-3.3-70b` are deprecated; the default tier now uses
> the current Groq-served open-weight id `openai/gpt-oss-120b` and the cheap tier `openai/gpt-oss-20b`
> (Groq stays the provider; the ladder is unchanged).

> **How the ladder is resolved (B5).** `resolveLadder` (`src/adapters/ai/llm/ladder-config.ts`) reads the
> raw env record — NOT the parsed `Env` (these `LLM_TIER_*` keys are intentionally kept OUT of `EnvSchema`).
> For each tier it reads exactly `LLM_TIER_{DEFAULT|FALLBACK|LOCAL}_{MODEL,BASE,KEY}`; a tier missing `MODEL`
> or `BASE` is **skipped**. `AI_MODE=off` yields an empty ladder. When the resolved real ladder is empty
> (e.g. `AI_MODE=cloud` but no keys/bases configured), `buildComplianceAi` falls back to the in-process
> deterministic **MOCK** → the SitRep degrades to **deterministic-only** (never a dead end, F3-safe). Ready-to-
> uncomment cloud/local/off profiles ship in `.env.example` (§ "AI: B5 ladder profiles").

### Provider API keys (set only the ones you use)
| Var | Provider |
|---|---|
| `GROQ_API_KEY` | Groq |
| `OPENROUTER_API_KEY` | OpenRouter |
| `ANTHROPIC_API_KEY` | Anthropic (Claude Haiku) |
| `OPENAI_API_KEY` | OpenAI-compatible (optional) |
| `GOOGLE_API_KEY` | Google (Gemma vision/text profile, ADR-008a) |
| _(Ollama needs no key)_ | local |

## 4a. AI compliance proxy + cost/budget guardrails (ADR-017 / ADR-018)

> Every `LLMPort` and `VisionPort` call routes through the mandatory `AICompliancePort` reverse-proxy
> gateway (ADR-017): `JWT/role-scope → circuit-breaker → semantic firewall → policy-as-code → PII
> detect+redact → hash-chained audit → upstream`. SAFETY controls (PII egress, prompt-injection,
> blocked destructive/SSRF/secret-file patterns) are **fail-closed**; **availability degrades down the
> AI ladder** (an open breaker descends cloud → alt → local Ollama → deterministic-only, never a
> dead-end — Article XVI, §11). The declarative policy lives in `config/policies.yml`, validated
> fail-fast at boot against `schemas/policies.schema.json`.

| Var | Values (default first) | Purpose |
|---|---|---|
| `COMPLIANCE_PROXY_ENABLED` | `on` \| `off` | Mandatory AI compliance gateway in front of every LLM+Vision call (ADR-017, COMPLIANCE_MATRIX C1). **On by default**; `off` is only for a deterministic-only build where no AI call is ever made. Adapters refuse any call not stamped by the gateway, so this cannot be silently bypassed |
| `COMPLIANCE_POLICIES_PATH` | `./config/policies.yml` | Policy-as-code bundle (RBAC scope, PII patterns, content-safety, rate-limit, budget, EU-AI-Act). Loaded fail-fast at boot (U5/F10) — invalid/missing policy aborts startup |
| `BUDGET_PER_INCIDENT_USD` | `5.00` | Hard ceiling on cumulative AI spend per incident (ADR-018; mirrors `policies.yml budget.per_incident_usd`). Exceed → HARD-BLOCK + human approval |
| `BUDGET_PER_REGION_USD` | `50.00` | Hard ceiling on cumulative AI spend per region per budget period (region isolation, TB9). Exceed → HARD-BLOCK + human approval |

> **How the four budget variables bind (corrected 2026-09-11).** `config/policies.yml` carries the shipped
> defaults; each of `BUDGET_PER_INCIDENT_USD`, `BUDGET_PER_REGION_USD`, `BUDGET_ESCALATION_THRESHOLD_USD`
> and `REQUIRE_HUMAN_ABOVE_THRESHOLD` **overrides** its policy-file value when set, and a malformed value
> aborts the boot rather than silently falling back.
>
> Until 2026-09-11 these four were documented here and read by no code at all, so setting a cap in a
> deployment's variable store changed nothing while appearing to. If you have a deployment configured from
> before that date, re-check its values now — they were inert and are now live.
| `BUDGET_ESCALATION_THRESHOLD_USD` | `0.50` | Soft per-call/cumulative-step escalation point. At/above it the circuit-breaker escalates (degrade→escalate→terminate) and, if HITL-above is on, requires human approval before dispatch |
| `REQUIRE_HUMAN_ABOVE_THRESHOLD` | `on` \| `off` | When `on`, a call whose reserved cost ≥ `BUDGET_ESCALATION_THRESHOLD_USD` (or that would exceed a cap) is held for human approval (HITL, Article X/XIII). Below the threshold, calls auto-proceed with per-call audit (soft posture). Safety controls stay fail-closed regardless |

> The budget posture is **soft within budget** (auto-proceed + per-call `AUDIT_EVENT` + pre-step
> reservation) and **HARD-BLOCK + human approval** only above the threshold/cap (ADR-018, COMPLIANCE_MATRIX
> C13–C14, Tiered-Autonomy B). These env vars are the operator-facing surface of the `policies.yml budget`
> block; the file is authoritative and the env vars override it at boot.

## 5. AI — multi-modal / vision (`VisionPort`) — env-switchable provider profiles (ADR-008a)

> **⚠ HONESTY NOTE — what is actually wired today.** Only **`FEATURE_VISION`** and its browser mirror
> **`NEXT_PUBLIC_FEATURE_VISION`** are read by code. The `VISION_MODE` / `VISION_PROVIDER` /
> `VISION_MODEL` / `VISION_API_BASE` / `VISION_LOCAL_MODEL` / `VISION_MAX_IMAGE_MB` /
> `VISION_PII_SCREEN` ladder below is a **roadmap design** — no code reads any of them; the running
> provider is the deterministic recorded-fixture **MockVision** (`src/main/build-vision.ts`). Setting
> these variables changes nothing today.

> The vision provider/model/base/key are **entirely env-driven** — switching provider (OpenRouter/Qwen-VL,
> Google Gemma, any OpenAI-compatible endpoint, or local Gemma/PaliGemma/LLaVA on Ollama) is a `.env`
> edit, **zero code change** (ADR-008a; Article XV/XVI). One LiteLLM/OpenRouter abstraction serves both
> text (§4) and vision; OpenRouter and a Google/Gemma route are interchangeable rungs of the same ladder
> (cloud → local → skip, advisory/cited only). Vision stays **off by default** so the golden path never
> depends on it (ADR-008).

| Var | Values (default first) | Purpose |
|---|---|---|
| `FEATURE_VISION` | `off` \| `on` | Vision is a stretch layer; off by default for the golden path. **The only wired server var in this table** |
| `VISION_MODE` | `cloud` \| `local` \| `off` | **ROADMAP — not wired.** Ladder: cloud → local (LLaVA/Gemma/PaliGemma) → skip (advisory only) |
| `VISION_PROVIDER` | `openrouter` \| `google` \| `openai` | Vision provider (LiteLLM provider id). `google` selects the Gemma vision profile |
| `VISION_MODEL` | `qwen/qwen2.5-vl-72b-instruct` (or any vision model) | Cloud vision model (id verified 2026-06-29). Gemma profile uses `gemma-3-4b-it` / `gemma-3-12b-it` / `gemma-3-27b-it` (multimodal Gemma 3; 1B is text-only) |
| `VISION_API_BASE` | _(provider default)_ | OpenAI-compatible base URL override (point any vision rung at any compatible endpoint) |
| `VISION_LOCAL_MODEL` | `llava` (or `gemma3` / a PaliGemma tag) | Local vision model on Ollama (key-less, air-gapped rung) |
| `VISION_MAX_IMAGE_MB` | `8` | Reject larger uploads |
| `VISION_PII_SCREEN` | `on` | Mandatory PII screen before any image processing/storage (Article XIV) |

### Provider profiles (ROADMAP — not wired; illustrative — confirm current model ids against official Google/Gemma + LiteLLM docs at wiring time, Research Gate)

| Profile | Env (illustrative) | Notes |
|---|---|---|
| OpenRouter / Qwen-VL (default cloud) | `VISION_PROVIDER=openrouter`, `VISION_MODEL=qwen/qwen2.5-vl-72b-instruct` | Default cloud rung; `OPENROUTER_API_KEY` (id verified 2026-06-29) |
| **Google Gemma vision** | `VISION_PROVIDER=google`, `VISION_MODEL=gemma-3-4b-it` (or `gemma-3-12b-it` / `gemma-3-27b-it`) | Multimodal Gemma 3 via an OpenAI-compatible endpoint behind LiteLLM; `GOOGLE_API_KEY`. 1B is text-only; Gemma 4 (2026-04) may be preferred |
| Local Gemma / PaliGemma (offline) | `VISION_MODE=local`, `VISION_LOCAL_MODEL=gemma3` (or a PaliGemma tag), `OLLAMA_BASE_URL=...` | Runs on local Ollama; no key; air-gapped rung |
| Local LLaVA (offline, ADR-008 baseline) | `VISION_MODE=local`, `VISION_LOCAL_MODEL=llava` | ADR-008's named local rung |
| OpenAI-compatible (any) | `VISION_PROVIDER=openai`, `VISION_API_BASE=<endpoint>`, `VISION_MODEL=<model>` | Point any rung at any OpenAI-compatible base |

> **Text-LLM tiers (§4) mirror this same machinery.** A Google/Gemma text route is just another LiteLLM
> tier — e.g. `LLM_TIER_FALLBACK_PROVIDER=google` + `LLM_TIER_FALLBACK_MODEL=gemma-3-12b-it` (with
> `GOOGLE_API_KEY`; `gemma-3-1b-it` is text-only), or `LLM_TIER_LOCAL_MODEL=gemma3` (Ollama local tag).
> OpenRouter, Google/Gemma, and any OpenAI-compatible endpoint are interchangeable rungs; switching is
> config, not code (ADR-007/008a).

## 5a. Sustainability reporting (ADR-020)

> BEACON exposes `GET /.well-known/sustainability` (RFC 8615 out-of-band; RFC
> `draft-besleaga-green-sustainability-wellknown-05`) returning a modeled, schema-validated energy/carbon
> disclosure (`schemas/sustainability-v05.schema.json`). It adds **zero** per-request overhead (no hot-path
> burden, Article XVI). Numbers are deterministic/modeled — never LLM-produced (Article XII) — and labeled
> estimated; methodology is `docs/SUSTAINABILITY.md`.

| Var | Values (default first) | Purpose |
|---|---|---|
| `SUSTAINABILITY_ENABLED` | `on` \| `off` | Serve `GET /.well-known/sustainability` (ADR-020). On by default; the document is heavily cached |
| `SUSTAINABILITY_MEASUREMENT_METHOD` | `third-party-modeled` \| `hardware-metered` \| `hardware-estimated` \| `cloud-billing` | Reported `measurement-method`. The demo publishes `third-party-modeled` (no real metering); flip to `hardware-metered` only where a deployment has authoritative datacenter metering |
| `SUSTAINABILITY_METHODOLOGY_URI` | `https://beacon.local/docs/SUSTAINABILITY.md` | Reported `methodology-uri` — the transparent methodology + SFC C1–C4 checklist (anti-greenwashing) |
| `SUSTAINABILITY_PROVIDER` | `BEACON (sustain@beacon.local)` | Reported `provider` (entity operating the origin) |

## 6. Data sources (per-adapter: mode + key + interval)

> Every source adapter reads three vars: `SOURCE_<NAME>_MODE`, optional key, optional interval. Mode
> ladder per Article XVI: `live → cached → mock`. Default mode keeps the demo reliable.

| Pattern | Values (default first) | Purpose |
|---|---|---|
| `DATA_SOURCE_COMPOSITION` | `seed` \| `adapters` | How `buildCore` assembles the COP inputs. `seed` (default) = the hand-seeded, air-gapped demo dataset (byte-identical, zero net). `adapters` = OPT-IN live path: the runtime adapter registry (`config/adapters.json` + 30 registered `make*Adapter` factories — 25 data-source adapters + 5 E11 camera adapters, see §6a/§6d) supplies the hazard/gauge/weather/infrastructure/population/outage/telecom/flood-zone/news slices via `buildCoreLive`/`buildInteractionLive`/`live-seed.ts`; two factories are registered + boot-validated but NOT consumed by `live-seed.ts`'s fetch calls — `itu` + `camara-gsma` (operator-gated MOCK-only plugins by design); the three MW-B B3 aggregators `meteoalarm-gr`/`meteoalarm-es`/`wmo-swic` ARE consumed as of B3.3 by the `gr`/`es`/`ph` zones (see §6d) — and slices with no adapter at all (buffers/trend) stay seeded — an honest hybrid scope, not a hidden gap. **Corrected 2026-07-31 (E1):** `usgs-water` is now also consumed — the region-generic `consultationPlan` (`live-seed.ts:507`) consults every adapter in a region's `enabled_adapters` whose port fills a used slot, and `us-ca`'s list includes `usgs-water` alongside `nwps` in its `gauges` slot (both consulted/cited; `nwps` serves first by precedence order). It is a cited redundancy rung, not an unused registration. Per-source mode is still chosen by each `SOURCE_<PREFIX>_MODE` (→ region override → manifest). |
| `LIVE_PICTURE` | `auto` \| `hybrid` \| `live-only` | What the COP shows under `DATA_SOURCE_COMPOSITION=adapters` (2026-09-14, ADR-043). `auto` (default) = `live-only` on the live posture: incidents are only those DISCOVERED from live hazards (`discovered:<region>:…`), map layers hold only what a LIVE or CACHED source served (a MOCK answer is cited in provenance, never drawn), shelters come from the agency registry `config/shelters.json`; the hand-seeded demo incidents and layers exist only as the offline seed (`DATA_SOURCE_COMPOSITION=seed`). `hybrid` = the seeded demo picture enriched by live slices (the behaviour before 2026-09-14; the offline-demo and test profiles). A region with no live hazards shows no incident, and says so. |
| `LIVE_REGION_CONCURRENCY` | `1`–`8` (default `2`) | How many regions the live composition assembles concurrently (2026-09-14). Regions do not share registry, engine or cache keys, so the only cost is upstream request bursts. `1` restores the serial order (~300 s for five regions). |
| `SOURCE_<NAME>_MODE` | `live` \| `cached` \| `mock` | Per-source mode (see verdicts in `docs/audit/DATA_SOURCE_VERIFICATION.md`) |
| `SOURCE_<NAME>_INTERVAL_SEC` | _(=INGEST_DEFAULT_INTERVAL_SEC)_ | Per-source poll cadence |
| `SOURCE_OSM_OVERPASS_MIRRORS` | _(unset ⇒ a single endpoint)_ | **A10 (V2).** Ordered, comma-separated Overpass mirror ladder for `osm-overpass`, tried in order **inside the existing circuit breaker** — a fully failed ladder is ONE breaker failure, then the engine degrades cache → recorded mock as before. A rung falls through on any HTTP failure *and* on a 200 carrying an unparseable body (an overloaded mirror's error page). The endpoint that actually answered is stamped into provenance as `OSM Overpass (host)` (`SourceRecord` has no endpoint field); cache/mock rungs keep the bare `OSM Overpass`. **Unset ⇒ exactly one endpoint** — `SOURCE_OSM_OVERPASS_URL` if set, else `https://overpass-api.de/api/interpreter` — i.e. pre-V2 behaviour; **set ⇒ this list IS the ladder and supersedes `SOURCE_OSM_OVERPASS_URL`**. Entries are validated as absolute http(s) URLs at boot (fail-fast `CONFIG`) and de-duplicated. Verified 2026-09-10: `overpass-api.de` (announces `gall.openstreetmap.de`) and `lz4.overpass-api.de` (announces `lambert.openstreetmap.de` — a genuinely different server) both 200; `overpass.private.coffee` is the renamed `overpass.kumi.systems` (OSM wiki) and did not answer from the dev box, so it belongs last. **Keep the list ≤2 on a request path**: worst case per live attempt is mirrors × `SOURCE_OSM_OVERPASS_TIMEOUT_MS` × breaker retries, and the cloud edge cuts a request at 60 s. Note the per-mirror provenance NAME is a display label, not a stable key — the durable `source_record` upsert (ADR-039) keys on the ADAPTER id, so mirrors never fragment a source's row |
| `SOURCE_OSM_OVERPASS_USER_AGENT` | `BEACON/1.0 (open-source emergency COP; +https://github.com/andreibesleaga/QUEST-BEACON)` | **2026-09-15.** The `User-Agent` sent to every Overpass mirror. The public instances answer **`406 Not Acceptable`** to a request that carries none — Node's default `fetch` sends none, so every live attempt against `overpass-api.de` and `lz4.overpass-api.de` was refused before this header existed (verified with and without it the same day) — and the OSM usage policy asks every client to identify itself. Put the deployment's own contact in it; blank falls back to the default. Tested in `osm-overpass-adapter.test.ts` |
| `CACHE_TTL_SEC` | `900` | Last-known-good TTL |

> **Mock fixtures are colocated, not path-configured.** Each adapter's recorded-mock snapshots live under
> `src/adapters/sources/<id>/__fixtures__/` next to the adapter that reads them; there is no
> `MOCK_FIXTURES_DIR` env var and no code path that reads one. The `mock.fixture` field in each
> `config/adapters.json` manifest row is a **documentation label** describing which fixture the adapter
> uses — it is not a load path.

### Source keys (free; set those you enable live)
| Var | Source | Notes |
|---|---|---|
| `FIRMS_MAP_KEY` | NASA FIRMS | free MAP_KEY |
| `RELIEFWEB_APPNAME` | UN OCHA ReliefWeb v2 | free registered appname; **required** for `reliefweb` LIVE (fail-fast without it; CACHED/MOCK need no key) |
| `ORS_API_KEY` | OpenRouteService | free key (or self-host Valhalla/OSRM) |
| `OPENCELLID_API_KEY` | OpenCelliD | free key; **required** for `opencellid` LIVE (fail-fast without it) |
| `SOURCE_OPENCELLID_MAX_TILES` | opencellid | tiles (~1.9 km squares around the discovered clusters) per region per refresh; default `4`; positive integer, else the default |
| `SOURCE_OPENCELLID_DAILY_BUDGET` | opencellid | live requests per UTC day for the free key; default `800`; once spent the adapter answers RATE_LIMITED without a request and the ladder serves last-known-good until the day turns |
| `CENSUS_API_KEY` | US Census Bureau (ACS 5-year) | free key (`api.census.gov/data/key_signup.html`); **required** for `census` LIVE (fail-fast without it; CACHED/MOCK need no key) |
| `COPERNICUS_*` / `SENTINEL_*` | Copernicus/Sentinel-2 | free account (vision/imagery — Sentinel-2 burn-area/NBR is a vision `burn-area` task, not a source adapter) |
| `NWS_USER_AGENT` | NWS api.weather.gov | required UA string (contact email) |
| `METNO_USER_AGENT` | met.no Locationforecast | **mandatory** contact UA (403 without) |
| `EARTHDATA_TOKEN` | NASA LANCE/IMERG | free Earthdata login |
| `OPENAQ_API_KEY` / `AIRNOW_API_KEY` | OpenAQ / AirNow | free keys (air/smoke corroboration) |
| `AGENCYRSS_FEEDS` | agency/news RSS adapter | **comma-separated verified feed list** — each added feed = one config entry, zero code change (FR-10). Default = the ranked D-32 worldwide set (audit §10.4), including the InciWeb/GDACS feeds; extend per region (RO: Digi24/ProTV/HotNews/Mediafax per §10.5) |
| `WINDY_WEBCAMS_API_KEY` | Windy Webcams API v3 | free key (`api.windy.com/webcams`, register); **required** for `windy-webcams` LIVE (fail-fast without it; CACHED/MOCK need no key) — see §6c |
| `DOT511_API_KEY` | 511 DOT (state traveler info) | free per-state developer key; **required** for `dot511` LIVE (fail-fast without it; CACHED/MOCK need no key) — see §6c |

### 6a. Phase-D catalog completion — the 14 new source adapters (W1)

> **Count updated 2026-08-08 (live-demo increment S2): the registry now holds 41, not 30.** Eleven
> adapters were added — `mastodon`, `metno`, `anm`, `hdxpop`, `hifld`, `eonet`, `cemsrm`, `openfema`,
> `caphub`, `lanceflood`, `nri` — each with a manifest row, a factory, and acl+adapter tests.
> `node -e "require('./config/adapters.json').adapters.length"` = **41**.
>
> **Read the consumed count carefully: it is still 28, not 41.** None of the eleven is in any region's
> `enabled_adapters`, so no region consults them; they are registered and boot-validated but feed nothing
> yet. `enabled_adapters` is a permission list, not an obligation, so this is honest scope rather than a
> broken declaration — but "41 registered" must never be reported as "41 live on the COP". Enabling them
> is scheduled with their consumption work (session 3); an S2-close attempt was reverted after `hifld`
> displaced the seeded infrastructure and broke the derived outage marking. Full evidence:
> `docs/audit/DATA_SOURCE_VERIFICATION.md` §0.
>
> Three further adapters (`openaq`, `airnow`, `sensorcommunity`) exist with passing tests but are
> deliberately **unregistered** — F-52 forbids enabling a port no assembly consults, and their SitRep
> consumer lands in session 3. One (`outageproxy`) was **deleted** on a licence rejection (IODA).
>
> **Count corrected 2026-08-02 (lens-7 machine recount, F-411 class): the registry then held 30, not 22.**
> `node -e "require('./config/adapters.json').adapters.length"` = **30** and the `ADAPTER_FACTORIES` map in
> `src/main/adapter-registry.ts:56-94` has **30 entries** (the two are asserted equal by
> `adapter-registry.test.ts:54`). **28 of the 30 are consumed** — the union of every shipped zone's
> `enabled_adapters` in `config/regions.json` is 28 ids; the two that no zone enables are `itu` and
> `camara-gsma` (operator-gated, MOCK-only by design). The `22` below counted only the state at the end of
> Phase-D W1 and predates the three B3 aggregators (`meteoalarm-es`, `meteoalarm-gr`, `wmo-swic`) and the
> five E11 camera directories (`caltrans-cctv`, `alertwildfire`, `windy-webcams`, `dot511`, `cnadnr-ro`).
> The historical sentence is preserved below as the W1 record it was written as.
>
> 22 adapters now exist end-to-end (`config/adapters.json` + `src/main/adapter-registry.ts
> ADAPTER_FACTORIES`): the original 8 (`FIRMS`, `NWS`, `NWPS`, `USGS_WATER`, `GDACS`, `OPEN_METEO`,
> `GLOFAS`, `METEOALARM_RO`) plus these 14. Each row's `configPrefix` is verified against the adapter's
> own `resolveSourceConfig({ prefix, ... })` call — the env var is always `SOURCE_<PREFIX>_MODE`.

| id | `configPrefix` (env `SOURCE_<PREFIX>_MODE`) | port → entity | default mode | key (required for LIVE) | license / attribution |
|---|---|---|---|---|---|
| `gdelt` | `GDELT` | NewsIntel → NewsItem | LIVE | none (keyless; 429 backoff) | GDELT open — GDELT Project |
| `reliefweb` | `RELIEFWEB` | NewsIntel → NewsItem | CACHED | `RELIEFWEB_APPNAME` (registered) | UN OCHA terms (attribution) |
| `agency-rss` | `AGENCYRSS` | NewsIntel → NewsItem | LIVE | none (keyless; feed list = `AGENCYRSS_FEEDS`/`_RO`) | per-feed (verified open feeds) |
| `bluesky` | `BLUESKY` | NewsIntel → NewsItem (vetted-social, corroboration-only) | MOCK (LIVE-capable, keyless public AppView) | none | Bluesky public API terms |
| `nifc` | `NIFC` | HazardSource → HazardGeometry (fire perimeters) | CACHED | none (ArcGIS REST) | US public domain (NIFC/WFIGS) |
| `effis` | `EFFIS` | HazardSource → HazardGeometry (EU/global fire) | CACHED | none (keyless) | Copernicus/JRC open (attribution) |
| `osm-overpass` | `OSM_OVERPASS` | Infrastructure → InfrastructureNode | CACHED (LIVE-capable) | none | ODbL (attribution + share-alike) — © OpenStreetMap contributors |
| `worldpop` | `WORLDPOP` | Population → PopulationEstimate | CACHED | none | CC BY 4.0 — WorldPop |
| `census` | `CENSUS` | Population → PopulationEstimate (US) | CACHED | `CENSUS_API_KEY` (free) | US public domain — US Census Bureau |
| `nfhl` | `NFHL` | FloodZone (local port) | CACHED | none (ArcGIS REST) | US public domain (FEMA) |
| `eagle-i` | `EAGLE_I` | Outage → OutageRecord (historical + derived "ASSUMED offline") | CACHED | none | US public domain (DOE/ORNL EAGLE-I) |
| `opencellid` | `OPENCELLID` | Telecom → TelecomCoverage | CACHED | `OPENCELLID_API_KEY` (free) | CC BY-SA (OpenCelliD) |
| `itu` | `ITU` | Telecom → TelecomCoverage (connectivity signal) | **MOCK-only** | gated data (no keyless live route) | ITU terms (gated) |
| `camara-gsma` | `CAMARA_GSMA` | Telecom → TelecomCoverage | **MOCK-only** | operator-gated (no public sandbox reachable) | operator terms (CAMARA/GSMA) |

> Two prior staleness fixes: the env var is `SOURCE_OSM_OVERPASS_MODE` (not `SOURCE_OVERPASS_MODE`) and
> `SOURCE_EAGLE_I_MODE` (not `SOURCE_EAGLEI_MODE`) — both match the adapter's `resolveSourceConfig`
> `prefix` exactly. `itu` and `camara-gsma` are honestly MOCK-only (no reachable keyless/free-tier live
> endpoint); every other row above is config-gated LIVE (works once the client registers/pays for the key).
> **Updated 2026-07-17:** all 14 are built + registered + boot-validated (see `adapter-registry.test.ts`)
> and 12 of the 14 are threaded into `live-seed.ts`'s `fetchSlice` calls (feeding the COP/map layers):
> `gdelt`, `reliefweb`, `agency-rss`, `bluesky`, `nifc`, `effis`, `osm-overpass`, `worldpop`, `census`,
> `nfhl`, `eagle-i`, and `opencellid`. Only `itu` and `camara-gsma` are registered + boot-validated but not
> consumed there (operator-gated MOCK-only plugins by design, not a gap). Combined with the original 8,
> the full registered catalog is 22 data-source adapters — 19 consumed, 3 not (`usgs-water`, `itu`,
> `camara-gsma`; see `docs/audit/DATA_SOURCE_VERIFICATION.md` §0 for the exact 27/24/3 breakdown incl. the 5
> E11 camera adapters). **MW-B B3 update (2026-07-27):** three aggregator rows were added on top of that
> catalog — `meteoalarm-gr`, `meteoalarm-es`, `wmo-swic` — taking the registered total to 30 (§6d).
> **Corrected 2026-07-31 (E1 docs truth-up):** the 27/24/3 breakdown above predates the B3.3 zone rollout.
> **Current: 30 registered / 28 consumed / 2 not consumed.** The three MW-B B3 aggregator rows bring the
> registered total to 30 (as this note already said); and `usgs-water` moved from "not consumed" to
> "consumed" once the region-generic `consultationPlan` started reading `us-ca`'s `enabled_adapters`
> directly (it now consults `usgs-water` alongside `nwps` for the `gauges` slot, cited as a redundancy
> rung). Only `itu` and `camara-gsma` remain genuinely unconsumed (MOCK-only by design). See
> `docs/audit/DATA_SOURCE_VERIFICATION.md` §0 for the corrected per-adapter table.
>
> **Current as of 2026-09-16 (final audit): 45 registered / 41 consumed / 4 not consumed** —
> `shelters-fema` joined on 2026-09-11, and `dot511` (Georgia-only) is the fourth unconsumed id. The
> dated note that follows is preserved as the 2026-08-10 record.
>
> **Corrected again 2026-08-10 (live-demo delivery S1–S3): current was 44 registered / 41 consumed / 3
> not consumed.** Fourteen adapters landed in S2/S3 (metno, anm, mastodon, openfema, caphub, lanceflood,
> eonet, cemsrm, nri, hdxpop, hifld + the openaq/airnow/sensorcommunity air-quality trio), and ten of
> the eleven S2 ids were enabled per-slot in `config/regions.json` — each APPENDED after its slot's
> existing sources so no precedence moved (D-38/D-39). Not consumed: `itu` + `camara-gsma` (MOCK-only by
> design) and `hifld` (held — its static-2019 snapshot displaces seeded infrastructure; merge-not-replace
> slot design is an open register item). `docs/audit/DATA_SOURCE_VERIFICATION.md` §0 remains the authority.

Representative source names (adapter `prefix`; the env var is `SOURCE_<PREFIX>_MODE`): `FIRMS`, `NIFC`,
`EFFIS`, `SENTINEL2` _(planned — NBR lands via the vision `burn-area` task, not a source adapter)_,
`NWPS`, `USGS_WATER`, `GLOFAS` (LIVE needs `SOURCE_GLOFAS_POINTS` — the reporting points to interrogate; unset ⇒ enters the ladder at CACHED), `GDACS`, `NFHL`, `NWS`, `OPEN_METEO`,
`METEOALARM_RO`, `OSM_OVERPASS`, `HIFLD` _(planned)_, `OPENCELLID`, `ITU`, `EAGLE_I`, `CAMARA_GSMA`,
`IPAWS` _(planned)_, `RELIEFWEB`, `INCIWEB` _(covered by `AGENCYRSS_FEEDS`, not a separate adapter)_,
`AGENCYRSS`, `GDELT`, `BLUESKY`, `WORLDPOP`, `HDXPOP` _(planned)_, `CENSUS`, `OPENFEMA` _(planned)_,
`EONET` _(planned)_, `GWIS` _(covered by the `effis` adapter, not a separate adapter)_,
`LANCEFLOOD` _(planned)_, `METNO` _(planned)_, `OPENAQ` _(planned)_, `CAPHUB` _(planned)_,
`ANM` _(planned)_, `CEMSRM` _(planned)_, `SENSORCOMMUNITY` _(planned)_, `AIRNOW` _(planned)_,
`SOCIAL` _(covered by the `bluesky` adapter, not a separate adapter)_, `FLOODHUB` _(planned)_,
`NRI` _(planned)_. See `config/planned-sources.md` for the genuine roadmap remainder.

## 6b. Interaction channels — CLI + messaging (ADR-023; impl in E10)

> The same use-cases behind ANY channel, zero core change (ADR-023): every channel adapter maps its native
> input into the one `InteractionPort` contract and renders the same `{ data, provenance[], freshness,
> citations?, errors? }` envelope the HTTP API returns. Messaging is **MOCK-default** (no tokens needed,
> no egress) — every channel keeps provenance/citations + HITL + the AI compliance gateway +
> responsible-data; there is no channel bypass. See `src/adapters/channels/{cli,messaging}/`.

| Var | Values (default first) | Purpose |
|---|---|---|
| `CHANNEL_CLI_ENABLED` | `on` \| `off` | The `beacon` CLI (reference channel). Runs fully offline against the same wired core as the API — no tokens, no network |
| `CHANNEL_TELEGRAM_MODE` | `mock` \| `live` | `mock` = `RecordedTransport` (captures outbound sends in memory, deterministic, no network — the demo default). `live` = the REAL Telegram Bot API `sendMessage` transport (T-456) over an injected `fetch`; **requires `TELEGRAM_BOT_TOKEN`** — `EnvSchema.refine` fails config validation fast at boot when `live` is set without it |
| `TELEGRAM_BOT_TOKEN` | _(empty; from @BotFather)_ | Bot API token. Secret — never commit. Required when `CHANNEL_TELEGRAM_MODE=live` |
| `TELEGRAM_WEBHOOK_SECRET` | _(empty)_ | Verifies inbound `X-Telegram-Bot-Api-Secret-Token` (constant-time compare, THREAT_MODEL T7.10) on `POST /channels/telegram/webhook`. Required to run the **webhook** rung; absent/unconfigured ⇒ the route 404s (non-disclosing). **Mutually exclusive with the poller**: `scripts/telegram-poll.ts` refuses to start while `TELEGRAM_WEBHOOK_SECRET` is set, preventing the Bot API `getUpdates`-while-webhook-registered conflict (a duplicate/confused inbound path) |
| `TELEGRAM_ALERT_CHAT_IDS` | _(empty; comma-separated chat ids)_ | The operator/responder channel list, seeded into the in-memory `SubscriberRegistry` at composition (ADR-026). **Double duty, by design (accepted risk, THREAT_MODEL T7.11)**: the SAME list is both (a) the outbound fan-out for the approved-alert broadcast, and (b) the inbound command allow-list `handleInbound`'s trust pipeline (`trust.ts`) checks before a chat id may issue a RESPONDER-role command. There is no separate broadcast-only chat-id class today — every listed id can both receive alerts and issue commands, and every id maps to RESPONDER only (never VERIFIER/EM) |
| `CHANNEL_WHATSAPP_MODE` | `mock` | `mock` = `RecordedTransport`, same as Telegram's mock rung. **`EnvSchema` accepts only `mock`** — the WhatsApp transport (`LiveStubTransport` in `messaging-port.ts`) is a **deliberate stub** (T-457 not wired: it always returns a typed `err`, never makes an HTTP call), so `CHANNEL_WHATSAPP_MODE=live` fails config validation fast at boot rather than silently shipping a channel that can never actually send |
| `WHATSAPP_TOKEN` | _(empty)_ | Reserved for the WhatsApp Cloud API token once T-457 wires a real transport. Currently has no effect (the transport is a stub regardless of its value) |
| `WHATSAPP_WEBHOOK_SECRET` | _(empty)_ | Reserved HMAC secret for verifying inbound WhatsApp webhooks once T-457 lands. Currently has no effect |

> **Fail-fast refine.** `EnvSchema` rejects `CHANNEL_TELEGRAM_MODE=live` without `TELEGRAM_BOT_TOKEN` at
> boot (mirrors the `FEATURE_ROUTING=ors` ⇒ `ORS_API_KEY` pattern, §7). `CHANNEL_WHATSAPP_MODE`'s enum has
> only one member (`mock`) so any other value — including `live` — is rejected the same way, honestly
> reflecting that the WhatsApp transport has nothing to switch to yet.

### 6c. Live camera sources (CW1) — E11 "Live Views" (ADR-027/028; CameraDirectoryPort P16)

> 5 more adapters land here (all implementing the outward
> `CameraDirectoryPort.fetchCameras` (`src/ports/cameras.js`) alongside the framework
> `SourceAdapterPort<CameraFeed>`. Link-only doctrine (Art. XII): every `CameraFeed.viewUrl` is an
> https-only link-out to the provider's own view page — BEACON never rehosts/proxies camera imagery.

| id | `configPrefix` (env `SOURCE_<PREFIX>_MODE`) | port → entity | default mode | key (required for LIVE) | license / attribution |
|---|---|---|---|---|---|
| `caltrans-cctv` | `CALTRANS_CCTV` | CameraDirectory → CameraFeed (US-CA, District 3 CCTV) | LIVE (keyless) | none | Caltrans open data — "Caltrans" |
| `alertwildfire` | `ALERTWILDFIRE` | CameraDirectory → CameraFeed (US, fire-spotting PTZ) | CACHED (LIVE-capable, keyless — verified 2026-07-17) | none | CC BY-NC-ND 4.0 (imagery; link-only use) — "ALERTCalifornia \| UC San Diego" |
| `windy-webcams` | `WINDY_WEBCAMS` | CameraDirectory → CameraFeed (GLOBAL webcams) | CACHED | `WINDY_WEBCAMS_API_KEY` (free) | Windy Webcams API ToS (link-only; attribution required) — mandatory UI credit "Webcams provided by windy.com" |
| `dot511` | `DOT511` | CameraDirectory → CameraFeed (US, state 511 traffic CCTV; coverage = the configured host's state — the default host is Georgia's, so the adapter is not enabled for `us-ca`) | CACHED | `DOT511_API_KEY` (free, per-state) | State DOT open data (developer key) — "511 DOT (state traveler info)" |
| `cnadnr-ro` | `CNADNR_RO` | CameraDirectory → CameraFeed (RO, national-road cameras) | **MOCK-only** | none | Official public agency pages (link-only) — "CNAIR (cnadnr.ro)" |

> `cnadnr-ro` is honestly **MOCK-only by design**: CNADNR/CNAIR "Trafic Live" publishes only link-only
> HTML camera-view pages, with no machine-readable feed (no API, no lat/lon) to poll — the hand-curated
> `__fixtures__/cameras.json` catalog (5 verified rows) *is* the source; `makeCnadnrRoAdapter` rejects
> `SOURCE_CNADNR_RO_MODE=live` fail-fast (CONFIG) rather than silently no-op'ing or scraping. `alertwildfire`
> is LIVE-capable and keyless (the ALERTCalifornia ArcGIS Living Atlas FeatureServer, verified reachable
> 2026-07-17) — it ships CACHED by default purely as a kindness default toward the shared ArcGIS service;
> an operator opts into LIVE via `SOURCE_ALERTWILDFIRE_MODE=live`.

### 6d. Cross-zone alert aggregators (MW-B B3.1/B3.2) — official CAP/Atom warnings for new zones

> 3 more adapters land here (taking the registered total to 30 at the time; **44** as of 2026-08-10, see §6 note above), all implementing the outward `NewsIntelPort.fetchNews`
> alongside the framework `SourceAdapterPort<NewsItem>`. Both are **aggregator patterns**: one adapter, N
> config-driven feeds, so a new country is one manifest row (+ one preset line) and **zero new parsing
> code** (FR-10). **As of B3.3 all three ARE enabled**, each by exactly the zone its ISO coverage covers:
> `meteoalarm-es` → `es`, `meteoalarm-gr` → `gr`, `wmo-swic` → `ph`. Those three zone rows were added to
> `config/regions.json` as CONFIG ONLY — no application code — and each leads its zone's NewsIntel slot so
> the national warning authority is cited ahead of the global news feeds. A test in
> `src/main/adapter-registry.test.ts` pins that ownership map and the general rule behind it (a
> country-scoped row may only be enabled by a region whose ISO it covers).

| id | `configPrefix` (env `SOURCE_<PREFIX>_MODE`) | port → entity | coverage | default mode | key | license / attribution |
|---|---|---|---|---|---|---|
| `meteoalarm-gr` | `METEOALARM_GR` | NewsIntel → NewsItem (Greece legacy-Atom warnings) | COUNTRIES `["GR"]` | CACHED (LIVE-capable, keyless) | none | MeteoAlarm terms ≡ CC BY 4.0 — "Data provided by EUMETNET members" |
| `meteoalarm-es` | `METEOALARM_ES` | NewsIntel → NewsItem (Spain legacy-Atom warnings; provider AEMET) | COUNTRIES `["ES"]` | CACHED (LIVE-capable, keyless) | none | MeteoAlarm terms ≡ CC BY 4.0 — "MeteoAlarm / AEMET" |
| `wmo-swic` | `WMO_SWIC` (+ `WMO_SWIC_SOURCE_ID`, default `ph-pagasa-en`) | NewsIntel → NewsItem (per-source CAP v1.2 relay: RSS index → per-alert CAP) | COUNTRIES `["PH"]` | CACHED (LIVE-capable, keyless) | none | **CC BY 4.0** (PAGASA-DOST, declared verbatim in its own feed); relay under WMO Unified Data Policy Res. 1 — "PAGASA-DOST / WMO Severe Weather Information Centre" |

> **`meteoalarm-ro` is unchanged** (alias row): the same manifest row, env prefix `METEOALARM_RO`, recorded
> fixture and tests — its module now delegates to the generic MeteoAlarm adapter the GR/ES rows use.
>
> **`wmo-swic` yields alert/advisory intel ONLY — never hazard geometry (finding F-48 🔴).** PAGASA's
> tropical-cyclone (`acp`) CAP `<polygon>` is its whole **Area of Responsibility** (~5–21°N, 113–130°E),
> wider than the `ph` bbox, *not* the storm footprint; rendering it as a footprint would paint a false
> polygon across the West Pacific. Because the adapter emits only `NewsItem`s, such an area can never reach
> `EXPOSURE_BEARING_BY_KIND`/`exposureBearingHazards` nor the map's hazard layer — the guarantee is
> structural, not a filter — and `acp` summaries carry an explicit "alerting area only, not the storm
> extent" label. PH storm/flood **footprints** come from `gdacs`/`glofas`. The CAP parser emits
> **MultiPolygon over all `<polygon>` rings** and swaps CAP's `lat,lon` order to GeoJSON `[lon,lat]`
> (finding F-49). Honest limits (F-51): only the `gfa` (flood) and `acp` (cyclone) families were observed —
> no thunderstorm/rainfall CAP support is claimed; no published rate limit exists for either host (hence
> the CACHED default, 900 s ttl, a per-fetch CAP-document cap and the standard breaker); per-alert URLs are
> UUID-keyed ⇒ feed-discovery only. Fixtures are hand-authored recorded-style from the documented live
> evidence in `docs/features/GLOBAL_ZONE_SOURCE_RESEARCH.md` "LATE ADDITION 3" and labelled as such in-file.

### 6e. Demo auto-report watcher — a PRESENTATION AID, not an alerting path (live-demo delivery increment decision 18; ADR-037 §5)

> **State this plainly, because the name invites the wrong reading.** `DEMO_AUTO_REPORT` does not create
> alerts, does not touch the alert store, and does not shorten the human-approval chain in any way. While a
> region is being monitored live, the watcher evaluates that region's already-computed live slices with the
> **existing** deterministic threshold/severity logic — Art. XII: no new judgment code, no new numbers, the
> watcher adds no evaluation the running app does not already perform. On the FIRST critical wildfire/flood
> signal it sends **exactly one** Telegram message, through the **existing** notifier (`makeNotifier`:
> PII-redact + firewall + hash-chained audit — the same pipeline every other Telegram send uses), to
> `TELEGRAM_ALERT_CHAT_IDS` (§6b). Every message is prefixed **"⚠️ AUTOMATED MONITORING (not an approved
> public alert)"** plus region/signal/citation/freshness, so a reader can never mistake it for an approved
> public alert. It **never** emits a CAP/EDXL document, **never** creates a domain `Alert`, and **never**
> touches the alert store — a threshold-rule fire still only ever creates a DRAFT alert (unchanged), and
> public alerting still requires a human (Article XIII).
>
> **Delivery still needs the same rungs as any other live Telegram send** (§6b): `CHANNEL_TELEGRAM_MODE=live`
> + `TELEGRAM_BOT_TOKEN` + `TELEGRAM_ALERT_CHAT_IDS`. With the `mock` channel default (or those unset), the
> watcher still evaluates and still latches, but the notifier records the send in the in-memory
> `RecordedTransport` instead of delivering a real message — nothing reaches an actual chat.
>
> **Off by default everywhere, including the Playwright gate profile.** An accidentally-on watcher would
> message real humans from a CI/test run — the exact failure class the gate's env block exists to prevent
> (§1 constraint 7); `DEMO_AUTO_REPORT` is pinned `off` there regardless of what `.env` says for a live demo.

| Var | Values (default first) | Purpose |
|---|---|---|
| `DEMO_AUTO_REPORT` | `off` \| `on` | Master switch for the watcher loop |
| `DEMO_AUTO_REPORT_REGION` | `us-ca` | The region id the watcher monitors |
| `DEMO_AUTO_REPORT_INTERVAL_SEC` | `120` | Evaluation tick interval |
| `DEMO_AUTO_REPORT_ONCE` | `on` \| `off` | `on` latches after the first send — one notification per boot, because a presentation wants one moment, not a stream. `off` sends on every newly-detected critical signal |

**Wired at boot since S1-close (paragraph corrected 2026-08-08 — it previously claimed nothing called
`startBackgroundJobs`, which went stale the day `createHttpDepsLive` gained the call).** `EnvSchema`
validates all four vars (`src/config/index.ts`); the watcher — `src/application/demo-watch/demo-watch.ts`
(`makeDemoWatcher`), scheduled by `startBackgroundJobs` — is started by the live composition root at
`src/adapters/channels/http/http-dispatcher.ts` (`createHttpDepsLive` → `startBackgroundJobs(...)`), so
`DEMO_AUTO_REPORT=on` in a served app is real behaviour, second-latched by `CHANNEL_TELEGRAM_MODE`.

**What the notification contains — stated precisely.** The message is the deterministic
**threshold-signal envelope** (`monitoringEnvelope`: the fired rule, its target/operator/value, the
signal's severity/category/summary, and the serving source's id/mode/fetchedAt as provenance) — it is
**not** the AI SitRep digest. It is cited and deterministic (Art. XII-clean) either way; this sentence
exists so nobody demos it as "the AI report arrives in Telegram".

### 6f. Published shelter directories (WP A4) — `ShelterDirectoryPort` P18

> **Shelters are POLLED, not seeded — and that was a decision, not a convenience.** WP A4 originally
> proposed seeding `config/shelters.json` from published lists. The evidence pack
> (`docs/audit/V2-A4-SEED-SOURCING-2026-09-10.md`) found real, citable rosters for California and Romania
> and **none** for Spain, Greece or the Philippines, and refused to invent the rest. Shelters are also not
> a static roster: they open and close during an incident. The feed proves it — the A4 research recorded
> **zero** open California shelters on 2026-09-10; re-probing the same service on **2026-09-11** returned
> **one** (`shelter_id` 341375, Lake County Fairgrounds, Lakeport). A seed frozen on the 10th would have
> shown an empty California on the 11th. So California reads the live feed at demo time and shows whatever
> FEMA is publishing then, including shelters that open during a real event.

| id | `configPrefix` (env `SOURCE_<PREFIX>_MODE`) | port → entity | coverage | default mode | key | license / attribution |
|---|---|---|---|---|---|---|
| `shelters-fema` | `SHELTERS_FEMA` (+ `_URL`, `_TIMEOUT_MS`, `_INTERVAL_SEC`, `_LAYERS`, `_MAX_PER_LAYER`) | ShelterDirectory → Shelter (FEMA ESF#6 National Shelter System, public ArcGIS MapServer) | COUNTRIES `["US"]` | CACHED (LIVE-verified, keyless) | none | **US public domain** (17 U.S.C. §105); the service's own `copyrightText` names three parties — "FEMA, Mass Care, American Red Cross" — and all three are credited |

**Endpoint, verified live from this machine 2026-09-11** (nothing below is quoted unfetched):
`https://gis.fema.gov/arcgis/rest/services/NSS/FEMA_NSS/MapServer` → **HTTP/2 200**,
`serviceDescription` = "FEMA ESF#6 Shelter System (Formerly known as the FEMA National Shelter System)",
`copyrightText` = "FEMA, Mass Care, American Red Cross", `access-control-allow-origin: *`, no credential.
Layer counts the same day for `state='CA'`: **layer 0 Open = 1, layer 1 Closed = 6,887, layer 2 Full = 0,
layer 3 Alert = 1**; a distinct-value query over CA's closed layer returns exactly one
`shelter_status_code`: `CLOSED`.

**`SOURCE_SHELTERS_FEMA_LAYERS`** (default `0,1,2`) selects which NSS layers are consumed. Layers 0/1/2 are
Open/Closed/Full, which map 1:1 onto the domain `SHELTER_STATUSES`. **Layer 3 "Alert" is refused with a
CONFIG error, by design**: an alerted shelter is on standby, so calling it OPEN would send evacuees to a
building that is not receiving them and calling it CLOSED would erase a published state. There is no honest
third option, so the layer is absent rather than smuggled in under a wrong status.

**`SOURCE_SHELTERS_FEMA_MAX_PER_LAYER`** (default `200`) bounds one fetch per layer, ordered by
`shelter_id` so the page is deterministic rather than arbitrary-by-chance. **Honest limitation to state
wherever this layer is shown:** for a wide region the *closed* list is a **sample**, not the complete
register (California alone holds 6,887 closed records against a service `maxRecordCount` of 4000). Open and
Full — the layers an operator acts on — are far below the cap.

**Honest limitations that the UI must carry, not hide:**
1. **A CLOSED shelter renders CLOSED.** Closed shelters are never promoted to OPEN and never filtered out
   to make the map look busier. Outside an active mass-care activation a shelter system genuinely *is*
   closed, and a COP that implied otherwise would be lying about where evacuees can go.
2. **An unpublished capacity is never invented.** FEMA's `evacuation_capacity` may be absent, and 39
   records nationally carry the placeholder `99999` (every one of them alongside `post_impact_capacity = 0`,
   and the set includes a radio station). Both are treated as *uncounted* and hydrate to capacity `0` — this
   codebase's existing documented meaning for an absent capacity (`src/adapters/persistence/mappers.ts`,
   `shelterMapper.fromRow`: "nobody has counted this building"), which makes the shelter **ineligible for
   capacity matching** rather than a destination with invented headroom.
3. **Records the domain cannot express are dropped AND counted, never bent.** Where FEMA publishes an
   occupancy with no capacity (7 of the 13 nationally-open shelters on 2026-09-11), every available
   encoding would lie, so the row is dropped and the loss is counted. See the PLAN-DELTA note in
   `src/adapters/sources/shelters-fema/shelters-fema-acl.ts`.
4. **US only.** Coverage is `COUNTRIES ["US"]`, so a non-US region receives `NOT_COVERED` — rendered as
   "not available in this region" (OP4) — rather than an empty layer that reads as "no shelters here".
5. **No named-individual PII, ever.** The NSS layers also publish `org_poc_name` / `org_poc_phone` /
   `org_poc_after_hours_phone` / `org_poc_email`. The adapter requests an **explicit field projection**
   instead of `outFields=*` (RESPONSIBLE_DATA rule 4), so those fields never enter BEACON's memory, logs or
   recorded fixtures.

> ⚠️ **WAF note for future query builders:** `gis.fema.gov` sits behind Cloudflare, and a `where` clause
> containing the token `IS NULL` is answered with an **HTTP 403 HTML block page** (measured 2026-09-11).
> The adapter keeps `where=1=1` and does all null handling in the ACL.

## 7. Routing

| Var | Values (default first) | Purpose |
|---|---|---|
| `FEATURE_ROUTING` | `heuristic` \| `ors` | Routing engine ladder. `EnvSchema` accepts only these two values today (`ors` requires `ORS_API_KEY`, refined fail-fast). `valhalla`/`osrm` below are the **documented future ladder rungs** (self-hosted road routing), not values `FEATURE_ROUTING` accepts yet — setting either fails config validation |
| `VALHALLA_URL` / `OSRM_URL` | _(empty)_ | Self-hosted routing endpoints reserved for the future `valhalla`/`osrm` rungs (not yet wired into `FEATURE_ROUTING`) |

## 8. Alerting / interop

| Var | Values (default first) | Purpose |
|---|---|---|
| `CAP_SENDER` | `beacon@localhost` | CAP `sender` identity |
| `CAP_EMIT_MODE` | `draft` \| `actual` | `draft` until human-verified; never auto-`actual` (Article XIII) |
| `IPAWS_ENABLED` | `off` | Live IPAWS origination is out of scope (needs FEMA authority) |
| `CAP_PROFILE` | `base` \| `ipaws` | The profile rule set (`schemas/cap-profiles/<id>.schema.json`) every emitted CAP document must satisfy **in addition to** `schemas/cap-v1.2.schema.json`, applied before the sink records anything (ADR-036 §1). `base` adds no rules. `ipaws` enforces the rules transcribed verbatim from OASIS *CAP v1.2 USA IPAWS Profile v1.0* CS01 (13 Oct 2009) §2 — `<code>` containing `IPAWSv1.0`, `<expires>`, exactly one SAME three-letter `<eventCode>`, and at least one `<area>`. **Passing a profile is a self-check, not a conformance certification and not authorisation to originate**; `IPAWS_ENABLED` is unchanged. A profile failure is a blocking `PARSE_ERROR`; an unknown value fails fast at boot. |
| `EDXL_VERSION` | `1.0` | EDXL-RM / EDXL-SitRep version |

## 9. Regions (multi-region registry)

| Var | Values (default first) | Purpose |
|---|---|---|
| `REGIONS_CONFIG` | `./config/regions.json` | Region registry: `{id,name,scope,iso,tz,languages[],bbox,enabled_adapters[],source_mode_overrides}` — validated by `schemas/regions.schema.json` |
| `DEFAULT_REGION_ID` | `us-ca` | Region loaded on first open |

**Required region fields (MW-B).** Every config-authored region MUST declare `iso`, `tz` and
`languages[]` in addition to `bbox`; `schemas/regions.schema.json` rejects a region that omits them. The
domain entity `Region` keeps them optional so existing programmatic seeds and tests remain valid — config
does not get that latitude.

| Field | Example | Purpose |
|---|---|---|
| `iso` | `US` · `RO` | ISO-3166-1 **alpha-2**, uppercase (a `Region` factory invariant). Selects country-scoped adapters; a typo fails loudly rather than silently disabling every country-scoped source |
| `tz` | `America/Los_Angeles` · `Europe/Bucharest` | IANA timezone for **display only** — storage is always UTC `timestamptz` |
| `languages` | `["en"]` · `["ro","en"]` | BCP-47 tags, **most significant first**. Drives multilingual CAP `<info>` emission (region language first, English always) and the region's default UI language |

> **`units` was REMOVED** from `config/regions.json` (MW-B). It was declared and never read, and it
> implied a per-region imperial display mode that does not exist: **BEACON displays SI everywhere, always
> labelled** (SPEC §3.5). An unused field that contradicts the shipped behaviour is a doc-truth defect, so
> it is gone rather than documented.
>
> **Geography now comes only from the registry (finding F-06).** The composition root previously held a
> hardcoded ISO map and a duplicated bbox fallback table; an unconfigured region silently inherited
> **California's bounding box**, i.e. it would have queried every source over California and rendered the
> result as if it were local. Both tables are removed — `bbox`/`iso` are read from the registry, and an
> unconfigured region keeps its hand-seeded, labelled picture instead of borrowing someone else's
> geography.

## 10. Security / auth

| Var | Values (default first) | Purpose |
|---|---|---|
| `AUTH_SECRET` | _(required in cloud)_ | Session/JWT signing; when set, `handleHttp` verifies a Bearer JWT and extracts `role` + per-user `sub` (ADR-017) |
| `AUTH_MODE` | `dev` \| `oauth` \| `oidc` | `dev` = seeded users for local demo |
| `AUTH_DEV_LOGIN` | `off` | Demo IdP token minter — `POST /auth/dev-login {role,userId}` mints a per-user (`sub`) bearer. **OPT-IN**: disabled unless `AUTH_SECRET` is set AND `AUTH_DEV_LOGIN=on` (a secret alone never exposes an arbitrary-role minter — least privilege). DEMO ONLY, never production issuance |
| `NEXT_PUBLIC_AUTH_DEV_LOGIN` | `off` | Client build-time public flag revealing the COP toolbar dev-login control. Hidden by default (offline demo / e2e / visual baseline unchanged); `on` to show it |
| `NEXT_PUBLIC_AUTH_TOKEN_LOGIN` | `off` | Client build-time public flag revealing the COP toolbar **sign-in** control (cloud judge access: sign in with a named `AUTH_USERS` account id + password via `POST /auth/login`; see `docs/CLOUD_DEPLOY_RAILWAY.md`). `npm run auth:mint-tokens` remains headless/API-only (`Authorization: Bearer` header). Set BEFORE `next build` on a cloud deploy. The server JWT verify path (`AUTH_SECRET`) needs no flag and is always fail-closed |
| `NEXT_PUBLIC_DEPLOY_POSTURE` | `dev` \| `live` | Client build-time posture chip: `live` shows a green **LIVE** chip and hides the DEV tag + role switcher. Validated in `EnvSchema` (`src/config/index.ts`) — a typo'd value is a boot error, not a silent default |
| `NEXT_PUBLIC_PWA` | `off` (default) \| `on` | **ADR-047 (2026-09-15).** Client build-time switch for the installable, offline-capable COP. `on` links `public/manifest.webmanifest` and registers the hand-written module service worker `public/sw.js`: hashed build assets cache-first, stable assets (`/maplibre/*`, icons, manifest) stale-while-revalidate, navigations and the **PUBLIC read-only API** (`/status`, `/regions`, `/regions/{id}/incidents`, `/regions/{id}/map`, `/incidents/{id}`, `/incidents/{id}/sitrep`, `/incidents/{id}/exposure`, `/sources`) network-first with the last saved copy as the fallback. A copy is stored only for a request that carried no credentials, so the cache can hold nothing a signed-out visitor could not fetch; writes, `/auth/*`, `/me`, the SSE stream, every role-gated read and cross-origin tiles are never touched. A served copy is announced to the page and the banner names when it was saved (never a ticking clock beside old data). Anything but `on` = the pre-PWA behaviour, and a visit on such a build **unregisters the worker and deletes its `beacon-sw-*` caches** (complete fallback). Validated in `EnvSchema` like the posture flag; build-time inlined, so on Railway/Docker it must reach the BUILD (`infra/Dockerfile` ARG, compose `build.args`). Tested: `app/_lib/pwa/*.test.ts` (policy ⇄ OpenAPI contract, registration table), `e2e/pwa-offline.spec.ts` (real offline reload) |
| `NEXT_PUBLIC_BASEMAP_MODE` | `online` (default) \| `offline` | Client build-time basemap. `offline` ships a MapLibre style with **no sources**, so the browser requests no tile from any host, and the map carries a translated label saying the basemap is absent while every operational layer still draws (Art. XVI — degrade, label, never dead-end). Set it on air-gapped images. Only the exact string `offline` disables the basemap, so a typo cannot blank a connected deployment. **`online` is not a promise that a basemap arrived** (2026-09-12): the OSM volunteer servers answer a refused request with *200 OK* carrying an "Access blocked" image — verified against the live host from this deployment — so online mode walks a keyless ladder and, if every rung refuses, labels the absence exactly as `offline` does |
| `NEXT_PUBLIC_BASEMAP_TILE_URL` | _(unset ⇒ the keyless ladder applies)_ | Client build-time **pinned** basemap — a self-hosted, cached or commercial host. A URL containing `{z}` is read as a raster `{z}/{x}/{y}` template; anything else is read as a MapLibre **style document** URL. Pinning DISABLES the failover: an operator who named a host does not want BEACON quietly reaching for a different one. Unset, online mode walks the ladder `OpenFreeMap → VersaTiles → OSM raster → no basemap (labelled)` — see `app/_components/map/style.ts` |
| `NEXT_PUBLIC_BASEMAP_ATTRIBUTION` | `© OpenStreetMap contributors` | Client build-time credit shown for a pinned basemap. The credit is always a string this repo controls — a fetched style document's own attribution is replaced, never appended to, because it is third-party HTML entering the MapLibre attribution sanitizer (GHSA-jrc7-96c5-q579) |
| `NEXT_PUBLIC_FEATURE_VISION` | `off` | Client build-time UI mirror of `FEATURE_VISION` (reveals the advisory vision-check surface). UX-only — the server `FEATURE_VISION` flag stays authoritative |
| `NEXT_PUBLIC_FEATURE_CITIZEN_STREAM` | `off` | Client build-time public flag revealing the SOS form's "Live stream link" field (E11 citizen live-view). UX-only — the server `FEATURE_CITIZEN_STREAM` flag stays authoritative and rejects intake when off |
| `NEXT_PUBLIC_FEATURE_OUTLOOK_PANEL` | `off` (unset) \| `on` | **Added 2026-08-02** — this variable ships and is READ (`app/_components/panels/sitrep-panel.tsx:101`, `const OUTLOOK_PANEL_ENABLED = process.env.NEXT_PUBLIC_FEATURE_OUTLOOK_PANEL === 'on'`) but was documented in **neither this file nor `.env.example`**, in a file that declares itself the single source of truth for configuration (lens-7 recount; `.env.example` is another lane's file and is only *reported*, not fixed, here). Client build-time flag revealing the SitRep dock's forecast **Outlook** section (ADR-033 §6). The DATA is never gated — `GET /incidents/{id}/sitrep` serves `outlook[]` unconditionally — only the surface is. Default off because rendering it grows the COP page 1644 px → 1836 px and moves four `cop.png` visual baselines plus `cop-rtl.png` (F-94/F-194); turning it on is this one variable plus one baseline regeneration, no code change. **Unlike the eleven mirrors above it is NOT declared in `EnvSchema`**, so a typo'd value is a silent `off`, not a boot error |
| `DB_ADMIN_URL` | _(unset ⇒ no link)_ | **A7 (V2; ADR-040).** Address of the Directus DB-admin console, surfaced as the toolbar's "⛁ DB Admin ↗" link. Served on the authenticated `GET /me` payload as `dbAdminUrl` **only when the SERVER-resolved principal is `EM`** and only when this is set — the field is *absent* (not empty, not null) for PUBLIC/RESPONDER/VERIFIER and for anonymous callers, so the string never enters a response a non-EM client could keep. Declared in `EnvSchema` and validated as a URL, so a typo is a boot error rather than a dead link handed to the one role trusted to click it; read from raw env at the call site like `AUTH_SECRET`. **There is deliberately NO `NEXT_PUBLIC_DB_ADMIN_URL` mirror** — `next build` inlines `NEXT_PUBLIC_*` values into the bundle every anonymous visitor downloads, which would make the role check a rendering decision about a string everybody already holds. Unset ⇒ no link for anyone: absence is the off switch, so there is no second flag to disagree with this one |
| `TLS` | `off` (local) \| `on` (cloud) | TLS 1.3 in transit (Article IV) |

---

## 11. How config implements the redundancy ladders (Article XVI)

> **Canonical source** for the redundancy-ladder ↔ flag mapping. PRD, SPEC §9, and CLARIFICATIONS reference
> this table rather than restating it (single source of truth).

| Layer | Flag(s) | Ladder (degrade left→right) |
|---|---|---|
| Data | `SOURCE_*_MODE` + `CACHE_TTL_SEC` | live → cached (last-known-good) → mock → "unavailable + freshness" |
| AI text | `AI_MODE`, `LLM_TIER_*` | cloud → alt provider → local Ollama → deterministic-only |
| Vision | `FEATURE_VISION`,`VISION_MODE`,`VISION_PROVIDER` | cloud (OpenRouter/Qwen-VL ↔ Google Gemma ↔ OpenAI-compatible) → local (LLaVA/Gemma/PaliGemma) → skip (advisory) |
| AI compliance gateway | `COMPLIANCE_PROXY_ENABLED`, `COMPLIANCE_POLICIES_PATH` | safety controls **fail-closed** (no degrade); availability degrades down the AI-text/Vision ladders above (breaker-open descends cloud → alt → local → deterministic-only, never a dead-end — ADR-017) |
| AI budget | `BUDGET_*`, `REQUIRE_HUMAN_ABOVE_THRESHOLD` | soft within budget (auto + per-call audit) → escalate at threshold (degrade→escalate→terminate) → HARD-BLOCK + human approval over threshold/cap (ADR-018) |
| Store | `FEATURE_STORE` (+ `DATABASE_URL`) | postgres (durable public reports + hash-chained triage audit + regions + sources) ↔ memory (offline-first default; incidents COP derives in-memory in both) |
| Geo | `FEATURE_SPATIAL` | postgis ↔ turf (either alone suffices) |
| Queue | `FEATURE_QUEUE` | bullmq ↔ cron (bullmq not built) |
| Cache/bus | `FEATURE_CACHE`,`FEATURE_EVENTBUS` | redis ↔ memory (redis not built) |
| Realtime | `FEATURE_REALTIME` | sse → polling |
| Routing | `FEATURE_ROUTING` | ors → heuristic (valhalla/osrm are a documented future ladder rung, not yet accepted `FEATURE_ROUTING` values — see §7) |
| Deploy | `DEPLOY_MODE` | identical artifacts: local (air-gapped, ~$0, no egress) ↔ cloud |

**Acceptance tests (S06) assert these:** an `.env` setting `AI_MODE=off` + every `SOURCE_*_MODE=mock` +
`DEPLOY_MODE=local` must still serve the COP, deterministic insights, and cached/mock layers with no
network. Config validation fails fast at boot if a chosen mode lacks its required key/URL. The compliance
gateway stays on whenever any AI call can be made (`COMPLIANCE_PROXY_ENABLED=on`) — safety controls
fail-closed in every rung — and `GET /.well-known/sustainability` (`SUSTAINABILITY_ENABLED=on`) serves a
modeled, cached document with no hot-path or network dependency (works air-gapped).

---

## 12. Decision-engine tunables (E5; config-injected, never hardcoded — safe defaults shown)

Deterministic-engine weights/boundaries are env-injected so behavior is adjustable without code change
(numbers stay deterministic — Art. XII). Pinned here so S05 has authoritative defaults.

| Var | Default | Meaning |
|---|---|---|
| `PRIORITY_WEIGHTS` | `0.45,0.35,0.20` | proximity, vulnerability, population (sum = 1) |
| `PRIORITY_VULNERABILITY_BOOST` | `1.5` | multiplier for an OFFLINE/at-risk critical node (term clamped ≤ 1.0) |
| `POPULATION_NORMALIZATION` | `per_region_max` | population term basis (`per_region_max` \| `global_cap`) |
| `CONFIDENCE_WEIGHTS` | `0.40,0.30,0.20,0.10` | source-authority, corroboration, recency, geolocation (ADR-015) |
| `CAPACITY_MATCH_DIRECTION` | `maximize_availability_per_distance` \| `minimize_distance` | shelter ranking objective — see note below the table |
| `TREND_MIN_SAMPLES` | `3` | below this ⇒ STEADY |
| `TREND_DEADBAND` | `0.05` | \|slope\| ≤ deadband ⇒ STEADY (strict `>` ⇒ escalating/deescalating) |
| `PREPOSITION_RADIUS_KM` | `20` | **A9 (V2).** How far from the projected hazard **edge** an asset may sit and still be surfaced by `GET /pre-positioning`. In **kilometres** — see the unit note below the table |
| `PREPOSITION_TOP_N` | `5` | **A9 (V2).** Cap on suggestions **per category** (resources, shelters), so the board stays scannable. Positive integer |
| `EVAC_SAFETY_MARGIN_SEC` | code default `1800` s | subtracted when computing the suggested evac start. **Not currently env-configurable** — the value is the `DEFAULT_EVAC_SAFETY_MARGIN_SEC` constant in `src/application/shared/config.ts` |

> **`CAPACITY_MATCH_DIRECTION` — corrected in the live-demo delivery increment, session 1 (ADR-037).** This
> row has claimed the default above since S03; until this session **no code read the variable at all** —
> the shelter-ranking comparator in `memory-logistics.ts` was hardcoded to the
> `maximize_availability_per_distance` behaviour. The two values:
> - `maximize_availability_per_distance` (default) — nearest eligible shelter first; where two are equally
>   far, the one with more spare headroom wins (a convoy is not split across a site about to fill).
> - `minimize_distance` — the nearest eligible (OPEN, spare-capacity) shelter wins outright; equal-distance
>   candidates keep registry order.
>
> Both comparators now live in ONE shared, tested module — `src/adapters/logistics/shelter-ranking.ts`
> (`rankShelters`/`comparatorFor`), whose `CapacityMatchDirection` type is derived from `EnvSchema` itself
> (`Env['CAPACITY_MATCH_DIRECTION']`) rather than retyped, so a value the config cannot express is a `tsc`
> error at the adapter. `src/adapters/logistics/memory-logistics.ts` threads its
> `LogisticsOptions.capacityMatchDirection` into that module. **Session 1, landing — verified by reading the code, not by
> argument.** As of this writing `src/main/feature-seed.ts` calls `makeLogisticsAdapter(seed.logistics)`
> with no second argument, so the running composition still gets the module's own default regardless of
> what `CAPACITY_MATCH_DIRECTION` is set to in `.env` — the composition root has not yet threaded the
> parsed config value through. The Postgres-backed logistics store (`src/adapters/logistics/pg-logistics.ts`,
> this session's Lane P) reuses the same `shelter-ranking.ts` comparator with the same `direction` option, so
> both stores will honour the variable identically once the composition root passes it to either one.

> **`PREPOSITION_RADIUS_KM` / `PREPOSITION_TOP_N` — V2·A9, and this row is the CAPACITY_MATCH_DIRECTION
> lesson applied one step further.** Until V2 these were the module constants `DEFAULT_NEAR_RADIUS_M =
> 20_000` and `DEFAULT_MAX_PER_CATEGORY = 5` in `src/application/pre-positioning/pre-positioning.ts`. The
> use-case had **always** accepted `nearRadiusMeters` / `maxPerCategory` on its input — what was missing was
> a caller that passed them, which is why the documented values could not be changed without editing code.
> A9 adds the two validated variables above and threads them from the **HTTP composition root**
> (`createHttpDepsLive` → `prePositioningTuning` → `HttpDeps.prePositioning` → `handlePrePositioning`), so
> the application layer stays pure and injected exactly as `src/application/shared/config.ts`'s `DEFAULT_*`
> constants are. **The schema defaults ARE the old constants**, so an environment that sets neither produces
> byte-identical suggestions to pre-V2 (asserted by a test, not by argument).
>
> **Units.** The variable is **kilometres** because that is what an operator reasons in; the engine takes
> **metres** because that is what a haversine returns. The conversion happens **once**, at the composition
> boundary, and is unit-tested there — a factor applied in two places is a factor that will eventually be
> applied twice, or not at all. **Validation.** The radius must be `> 0` (fractions allowed: `7.5` is a
> legitimate 7.5 km) and the cap a positive **integer** (a fractional row-cap is not a thing a board can
> honour); either out of range fails the boot rather than silently reverting to the default.
>
> **Scope, stated honestly.** Only the HTTP endpoint is wired. `runAnticipatoryCycle` also forwards a
> `nearRadiusMeters` to the same use-case (`src/application/anticipatory/anticipatory-engine.ts`), but the
> shipped replay surface (`app/_lib/anticipatory.ts`) passes no `candidates`, so no pre-positioning runs on
> that path today and there is nothing there for these variables to tune yet.

### 12·1 Forecast-likelihood thresholds — a validated config FILE, not an env var (MW-C, ADR-033 §2.2)

The source-signal → likelihood-class table is a **data file**, not a variable and not a literal in a
use-case: a threshold that decides whether a responder reads "LIKELY" or "VERY_LIKELY" has to be reviewable
as data, with its source and its caveats attached to it.

| Knob | Where it lives | Default | Meaning |
|---|---|---|---|
| Likelihood threshold table | `config/likelihood-thresholds.json` (data), validated by `schemas/likelihood-thresholds.schema.json` | derived exceedance probability: no class < 0.30, `LIKELY` ≥ 0.30, `VERY_LIKELY` ≥ 0.60; member fraction: `POSSIBLE` ≥ 0, `LIKELY` ≥ 0.30, `VERY_LIKELY` ≥ 0.60; advisory tiers low/medium/high → `POSSIBLE`/`LIKELY`/`VERY_LIKELY` | Parsed fail-fast into `DEFAULT_LIKELIHOOD_CONFIG` (`src/application/forecast-likelihood/likelihood-config.ts`) and injectable per region like `PriorityWeights`. Every row must declare the SOURCE that publishes the signal and the METHOD displayed beside every class — a schema-required field, so a new row cannot be added without saying where the number came from |

Honest limitation carried in the file itself: these are BEACON's **presentation** bands over a probability a
source already published. They are deliberately not the IPCC calibrated-likelihood scale, they are not an
activation trigger (that is the EAP config), and an ensemble **member fraction** is model spread — the share
of forecast members over a threshold — never a calibrated chance of occurrence, and never rendered as a
percentage chance. BEACON reads no ensemble members at runtime (finding F-34).

## 12a. Localization, time & units (SPEC §3.5, ADR-030 — implemented in wave MW-A)

**Localization is NOT env-configured — and that is deliberate.** There is no `LOCALE` / `DEFAULT_LOCALE` /
`NEXT_PUBLIC_DEFAULT_LOCALE` variable. The reader picks a language at runtime and the shipped set is a
validated registry, so an env var would only add a second, drift-prone source of truth.

| Knob | Where it lives | Default | Meaning |
|---|---|---|---|
| Shipped locale set (14) | `config/locales.json` `locales[]` (data) + `src/config/locales.ts` `LOCALE_IDS` (type) | `en zh-Hans hi es ar fr bn pt-BR id ur ru ro fil el` | The **allowlist**. Drift-guarded (a test asserts JSON ↔ TS agree) and validated by `schemas/locales.schema.json` |
| Default / fallback locale | `config/locales.json` `defaultLocale` + `DEFAULT_LOCALE` | `en` | English is both the source language and the fallback at every level (deep-merge + `getMessageFallback`) |
| Reader's active locale | **`beacon-locale` cookie** (`LOCALE_COOKIE`) | unset ⇒ `en` | Locale is UI state, **never a URL segment** (ADR-030). Resolved **server-side in the async root layout**, so `<html lang>`/`dir` and `generateMetadata` are right on the first byte. An unrecognised cookie value falls back to `en` |
| Catalogs | `messages/<locale>.json` | — | ICU catalogs; English is the source. `tests/i18n/catalog-parity.test.ts` gates key/ICU-argument parity, ICU compilation, `_meta` honesty, no blanks |
| Render timezone | `tz` per region in `config/regions.json` | `America/Los_Angeles` · `Europe/Bucharest` | Display only; storage is always UTC `timestamptz` |
| Units | — | SI | **No knob.** SI everywhere, always labelled; `THRESHOLD_RULE` values are always SI (normalized at the ACL). The unused `units` region field was removed in MW-B |

**Security note.** The locale-id allowlist is also the **path-traversal guard** (NFR-F7): a locale id
reaches a catalog file path, so only ids in `LOCALE_IDS` are ever accepted — no user-supplied cookie
string can traverse a path.

### Adding a language (no source change)

1. Add `messages/<id>.json` — mirror the English key tree exactly, including a `_meta` block with an
   honest `review` (`source` \| `human` \| `machine`) and `machineTranslated`.
2. Add one row to `config/locales.json` `locales[]`: `id`, `englishName`, `nativeName` (endonym — this is
   what the switcher shows), `dir` (`ltr`\|`rtl`), `script`, `review`, `font`.
3. Add the same `id` to `LOCALE_IDS` in `src/config/locales.ts` (this is the type-level truth and the
   allowlist; the drift-guard test fails if steps 2 and 3 disagree).
4. **Only if the script is new:** add a bundled `@fontsource/*` script subset (weights 400 + 700) and
   append the family to the `--font-sans` stack in `app/globals.css`. Never a CDN — fonts are
   self-hosted for the air-gapped path (Art. XVI).

Nothing else changes: no routing, no middleware, no `next.config.mjs` edit, no component change.
`tests/i18n/catalog-parity.test.ts` will fail the build if the new catalog drifts from English.

**Honest limitation:** all 13 non-English catalogs — **including Romanian** — are machine-translated and
unreviewed, declared as such in `_meta` and labelled in the UI while active. See SPEC §3.5 "Known
limitations" for the full localization limitation set (basemap raster labels, English fact claims, CJK
system fonts).

## 13. Multi-region coverage (ADR-011)

Each region declares `enabled_adapters[]` + per-adapter `coverage` (`GLOBAL|COUNTRY|STATE|COMMUNITY`).
**California** enables the US LIVE set; **Romania** enables the global-equivalent set (GloFAS, EFFIS,
MeteoAlarm-RO, Open-Meteo, WorldPop) and leaves US-only adapters (NFHL, EAGLE-I, **Census**, NRI)
**disabled**. `census` declares `coverage: { kind: 'COUNTRIES', iso: ['US'] }` (`DEFAULT_STATE_FIPS='06'`,
California golden-path scope) — a Romania request against it returns `NOT_COVERED` like the other US-only
adapters (WorldPop remains the global-coverage population source for Romania). A request that would hit an
out-of-region adapter returns `coverage: NOT_COVERED` and the UI shows "not available in this region" (OP4)
— never an error, never a dead-end.

**Five shipped zones (B3.3).** Beyond the two above, `es` (Spain), `gr` (Greece) and `ph` (Philippines) ship
as **DEMO-GRADE** zones — added as `config/regions.json` entries plus a catalog label and an offline seed,
with **zero application code**, which is the executable proof of FR-10/FR-ZONE-3. They are **not at
California parity** and each row's `$comment` states its own gaps:

| Zone | National alert source | What it does NOT have |
|---|---|---|
| `es` | `meteoalarm-es` (MeteoAlarm's relay of AEMET's CAP warnings) | no AEMET-direct adapter, no DGT traffic-camera adapter, no national gauge/outage source, no ES `AGENCYRSS_FEEDS` list; extent is **mainland Spain + the Balearics only** — Canaries/Ceuta/Melilla are outside it |
| `gr` | `meteoalarm-gr` (EMY/HNMS warnings via MeteoAlarm) | no national gauge, camera or outage source; no GR feed list |
| `ph` | `wmo-swic` (`ph-pagasa-en` — PAGASA's CAP v1.2, keyless, CC BY 4.0) | no PH gauge network (falls to global GloFAS), no PH cameras, no regulatory floodplain layer, so no inundation projection is made; PAGASA's `acp` cyclone CAP area is its whole Area of Responsibility, never a storm footprint (F-48) |

Each zone's `enabled_adapters` **array order is its source precedence order** (B1.8/ADR-012), and none of
them enables a US-only row: those would return `NOT_COVERED` anyway, so listing them would inflate the
zone's source list rather than widen its coverage.

## 14. Required keys for the default demo (fail-fast at boot; all free-tier)

The **out-of-the-box demo needs no keys** — ⚠ sources default to `SOURCE_*_MODE=mock`/`cached`. Keys are
required only when a source is flipped to `live` (after the S05 re-verify gate / Phase-D W1 for the new
catalog): `FIRMS_MAP_KEY`, `NWS_USER_AGENT` (contact string), `RELIEFWEB_APPNAME` (registered),
`ORS_API_KEY`, `CENSUS_API_KEY` (free), `OPENCELLID_API_KEY` (free), `WINDY_WEBCAMS_API_KEY` (free,
CW1 Live Views), `DOT511_API_KEY` (free per-state, CW1 Live Views). `.env.example` lists each with an
example value + comment; boot validation fails fast if a `live` source lacks its key.
