# ADR-031 — Region-generic composition: one config-driven path, coverage-matched enrichment, two aggregator adapters

- **Status:** Accepted (2026-07-26)
- **Deciders:** Entrant + prod-architect (master-plan wave MW-A / MW-B)
- **Relates to:** ADR-011 (multi-region registry — this ADR is its *completion*: ADR-011 decided the registry +
  adapter `coverage` model; that model was built but the composition root never consumed it generically),
  ADR-012 (config-for-everything — a region becomes data, not a code branch), ADR-001 (hexagonal — the generic
  path lives in `src/main`, the composition root, and adds no domain coupling), ADR-009/ADR-024 (total
  redundancy / live-composition — the LIVE→cache→recorded-mock ladder and `lkg:` keying that make a
  never-before-seen region safe to add), ADR-010 (interop — GLIDE/GeoJSON cross-region identity; CAP relays),
  ADR-027 §7 (the "catalog is open by design" extensibility clause this ADR generalizes from sources to
  regions), ADR-030 (i18n — shipped zones promote `fil` + `el`; region `lang`/`tz` become live inputs),
  ADR-032 (STORM/TYPHOON hazard type — the Philippines zone's dependency), CONSTITUTION Art. XII
  (deterministic source of truth), Art. XV (adapter discipline / zero core change), Art. XVI (total redundancy
  — degrade, never dead-end)
- **Requirements:** `docs/requirements/EARS_FINAL_VERSION.md` §2 — FR-ZONE-1…7 (FU-6, FU-7, FU-8, FEV-3,
  FEV-4, FST-2, FOP-2)
- **Threat model:** `docs/architecture/THREAT_MODEL.md` TB4 — new rows required for each new egress host
  (`feeds.meteoalarm.org` — already present via `meteoalarm-ro`, now EU-wide; **`severeweather.wmo.int`** —
  new, WMO SWIC CAP relay; **`www.aemet.es`** — new, keyless AEMET CAP RSS), plus a region-config validation
  row (region ids and `bbox` are allowlisted/range-checked; a region entry is data, never a path or a code
  path) and a "relayed provenance" integrity note (a SWIC-relayed CAP is attributed to the relay **and** the
  originating authority, never laundered as first-party)

## Context

BEACON claims "add a region by configuration, zero core change" (ADR-011, FR-10, Art. XV). The claim is
**partially true**: the registry, the per-region adapter wiring, the coverage model and the redundancy ladder
all exist and work. What does not exist is a *generic consumer* of them. The composition root instead contains
two hand-written, per-region enrichment paths, and the UI contains a hardcoded region list. So today a third
region loads, is selectable only if someone edits a TSX array, and receives **no adapter data at all** — it
falls through to `input` unchanged.

MW-B must make the claim literally true, because everything after it depends on it: three new shipped zones
(`ph`, `es`, `gr`), the prediction layer (MW-C) which runs on global inputs per region, the anticipatory-action
EAP samples (MW-D) which are per-region configs, and the honest-limitations story judges will probe.

### The problem, with verified evidence

| # | Hardcoded seam | Evidence (`file:line`) |
|---|---|---|
| 1 | **Region ids are string constants in the composition root** | `src/main/live-seed.ts:35`–`:36`: `const US_CA = 'us-ca';` / `const RO = 'ro';` |
| 2 | **ISO codes hardcoded — the coverage gate's key input is not read from config** | `src/main/live-seed.ts:44`–`:45`: `const ISO_BY_REGION: Readonly<Record<string,string>> = { [US_CA]: 'US', [RO]: 'RO' };` with the comment *"the domain Region has no iso"* |
| 3 | **Bboxes hardcoded, duplicated from `config/regions.json`** | `src/main/live-seed.ts:46`–`:50` `FALLBACK_BBOX` ("kept in sync with config/regions.json" — i.e. a manual-sync duplication); a lookup miss silently falls back to **California**: `regionOf` `:127` `?? FALLBACK_BBOX[id] ?? FALLBACK_BBOX[US_CA]!` |
| 4 | **Per-region news source lists hardcoded** | `src/main/live-seed.ts:40`–`:42`: `NEWS_IDS`, `CA_NEWS_IDS`, `RO_NEWS_IDS = [...NEWS_IDS, 'meteoalarm-ro']` |
| 5 | **Four bespoke `enrich*` functions — the core defect** | `enrichCaIncident` `src/main/live-seed.ts:320`–`:345`; `enrichRoIncident` `:347`–`:378`; `enrichCaMap` `:457`–`:487`; `enrichRoMap` `:489`–`:515`. Each hardcodes its own `fetchSlice(registry, '<literal-id>', region)` sequence, its own `NamedSlice[]` provenance list, and its own `LayerStamp[]` badge mapping. |
| 6 | **Two-branch dispatch — a third region is a silent no-op** | `enrichIncident` `src/main/live-seed.ts:380`–`:384`: `if (base.regionId === US_CA) … if (base.regionId === RO) … return Promise.resolve(base);` and `assembleLiveMapSeed` `:527`: `id === US_CA ? await enrichCaMap(…) : id === RO ? await enrichRoMap(…) : input` |
| 7 | **Camera source priority lists hardcoded per region** | `src/main/live-seed.ts:468` (`['caltrans-cctv','alertwildfire','dot511','windy-webcams']`), `:500` (`['cnadnr-ro','windy-webcams']`) |
| 8 | **The UI region list is a code array, not config** | `app/page.tsx:42`–`:45`: `const REGIONS: readonly RegionOption[] = [{ id:'us-ca', label:'California (US)' }, { id:'ro', label:'Romania (EU)' }];` consumed at `:158` (`<RegionSelector regions={REGIONS} />`) and `:204` (`CommandPalette`). `RegionSelector` itself falls back to a single-entry default (`app/_components/map/RegionSelector.tsx:26`). |
| 9 | **`config/regions.json` has no `iso` at all** | `config/regions.json:6`–`:36` (`us-ca`) and `:37`–`:68` (`ro`) carry `id`, `name`, `scope`, `bbox`, `enabled_adapters`, `source_mode_overrides`, `lang`, `tz`, `units` — **no `iso`**, which is precisely the field `COUNTRIES` coverage matching needs |
| 10 | **The domain `Region` entity has no `iso`/`tz`/`lang`** | `src/domain/region.ts:11`–`:17` = `{id, name, scope, bbox, enabledAdapters}` |
| 11 | **`enabled_adapters` is parsed, persisted, drift-guarded — and consumed by nothing** | parsed `src/adapters/persistence/region-registry.ts:58`; on the domain entity `src/domain/region.ts:16`; persisted `src/adapters/persistence/seed.ts:45`, `mappers.ts:197`/`:206`, `schema/core-tables.ts:43`. `buildAdapterRegistry` builds **every** manifest row regardless (`src/main/adapter-registry.ts:132`–`:141`), and the `enrich*` functions ignore the field entirely. |
| 12 | **`tz`, `lang`, `units` are parsed and consumed by nothing** | `src/adapters/persistence/region-registry.ts:61`–`:63` into `LoadedRegion` (`:17`–`:19`); **no consumer anywhere in `src/` or `app/`** (grep). MW-A A1 built the *consumer side* — `IntlValue.timeZone` (`app/_lib/i18n.tsx:29`) and `useFormat` (`:87`–`:90`) — but the root layout still passes the literal `'UTC'` (`app/layout.tsx:42`), with the comment at `:38`–`:39` explicitly deferring the region-tz override to this wave. Region `tz` reaching `IntlValue.timeZone` is **MW-B B1 work**, and it is what makes FU-8 true. |
| 13 | **MeteoAlarm is RO-scoped in four independent places, though the upstream feed family is EU-wide** | `src/adapters/sources/meteoalarm-ro/meteoalarm-ro-adapter.ts:34` `DEFAULT_BASE_URL = 'https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-romania'`; `:40` `const RO_REGION: Region = { id:'ro', bbox:[20,43,30,48], iso:'RO' }`; `:55` `coverage = { kind:'COUNTRIES', iso:['RO'] }`; `:95` `fetchNews()` **ignores the caller's region and always fetches `RO_REGION`**. Manifest row (`config/adapters.json`) mirrors it: `coverage.iso:["RO"]`, `configPrefix:"METEOALARM_RO"`, fixture `meteoalarm-ro/romania-atom.xml`. |
| 14 | **`GET /regions` is specified but not served — the UI has no config-derived source to read** | `docs/api/openapi.yaml:183`–`:196`: `x-status: planned`, *"NOT YET SERVED (v1). `src/adapters/channels/http/routing.ts` has no `/regions` (bare collection) route"*. Confirmed: `routing.ts:101`–`:110` matches only `/regions/:id/incidents`; the `Command` union (`src/ports/interaction.ts:69`–`:135`) has **no `regions` verb**; `RegionReadModel` is declared (`src/application/interaction/command-router.ts:70`–`:72`) and injected (`:100`) but **never consumed** (`grep deps.regions` → zero hits); `RegionView` is only `{id, name}` (`:43`–`:46`). |

**Plainly stated: "add a region by config" is currently only partially true.** Adding a `config/regions.json`
entry today gets you: a validated domain `Region`, a dedicated per-region adapter registry with its own
`RedundancyEngine` and mode overrides, and a drift-guard test. It does **not** get you: a selector entry, any
adapter data (item 6), a correct ISO for coverage matching (items 2 and 9), a correct bbox (item 3 — you
silently get California's), or any timezone/language behaviour (item 12).

### What already exists and must be preserved (verified — do not rebuild)

| Asset | Evidence | Role in the refactor |
|---|---|---|
| **`buildRegionRegistries`** — one wired adapter registry per region, each with that region's `source_mode_overrides` applied and its own `RedundancyEngine` so one region's override cannot bleed into another | `src/main/live-composition.ts:38`–`:49`, called at `:83`; unit-tested for override threading **and** isolation at `src/main/live-composition.test.ts:95`–`:122` | **Kept verbatim.** This is the correct per-region seam and needs no change. |
| **Per-region last-known-good keying** | `src/adapters/_shared/last-known-good-cache.ts:12`: `` return `lkg:${adapterId}:${regionId}`; `` | **Kept verbatim.** A new region's cache is already namespaced — no cross-region cache poisoning when zones multiply. |
| **The `Coverage` model + matcher** | `src/adapters/_shared/contract.ts:35`–`:38` (`GLOBAL` \| `BBOX` \| `COUNTRIES{iso[]}`); `src/adapters/_shared/coverage.ts:6`–`:10` `isCovered()`; the adapter-layer `Region` already carries optional `iso` (`contract.ts:29`–`:33`) | **This is the engine of the refactor.** It exists, it is correct, and nothing generic calls it. |
| **`NOT_COVERED` as a first-class, non-error outcome** | `fetchSlice` `src/main/live-seed.ts:100`: `covered: res.error.kind !== 'NOT_COVERED'`; `collectProvenance` `:112`–`:123` skips uncovered, retains seeded for covered-but-unserved | **Kept.** The graceful-degradation primitive is already right. |
| **Mode precedence env > region override > manifest** | `resolveEntryEnv` `src/main/adapter-registry.ts:149`–`:157` | **Kept.** |
| **The regions↔manifest drift guard already exists** | `src/adapters/persistence/region-registry.test.ts:57`–`:75` — asserts every `enabled_adapters` + `source_mode_overrides` id is a real manifest id | **Kept and extended** (see Verification §4). The master plan lists this as new work; it is in fact already built. |
| **Global-coverage adapters that light up any new zone for free** | `config/adapters.json` — `firms`, `gdacs`, `open-meteo`, `effis`, `glofas`, `worldpop`, `osm-overpass` all declare `coverage: {kind:'GLOBAL'}` | The substrate that makes an aggregator-plus-global-stack zone genuinely non-empty. |

## Decision

### 1. One generic, config-driven composition path

Replace the four bespoke `enrich*` functions and the two-branch dispatch (items 5–6) with **one** generic
enrichment driven by the region registry plus adapter `coverage` and manifest metadata. The pipeline:

```
config/regions.json  ──loadRegionRegistry──▶  LoadedRegion[]   (extended: iso, tz, languages, bbox, sourceModeOverrides)
                                                    │
                                        buildRegionRegistries  (EXISTS — src/main/live-composition.ts:38)
                                                    │              one registry + RedundancyEngine per region
                                                    ▼
   config/adapters.json ──coverage/port/entity──▶  ROLE RESOLUTION  (new, generic)
                                                    │   for each derivation ROLE, pick the covering adapters
                                                    ▼
                                        assembleLiveCoreSeed / assembleLiveMapSeed  (generic, no region literals)
                                                    │
                                                    ▼
                                     seed retained wherever nothing served (Art. XVI)
```

**Role resolution** is the mechanism that removes the region literals. Each manifest row already declares
`port` and `entity`; MW-B adds one optional `role` (and an optional `rolePriority`) so the composition root
asks *"which adapters can serve the `hazard.hotspot` role for this region?"* instead of naming `firms`. Roles
are a closed, typed set derived from the existing slice structure (`MapFetch`, `src/main/live-seed.ts:291`–`:301`):

| Role | Today's hardcoded ids | Layer badge |
|---|---|---|
| `hazard.hotspot` | `firms` | `fire` |
| `hazard.perimeter` | `nifc` (US) / `effis` (global) | `fire` |
| `hazard.event` | `gdacs` | — (provenance only) |
| `gauge` | `nwps` (US) / `glofas` (global) | `flood` |
| `weather` | `open-meteo`, `nws` | `weather` |
| `infrastructure` | `osm-overpass` | `infra` |
| `population` | `census` (US, preferred) / `worldpop` | — |
| `outage` | `eagle-i` | `outage` |
| `telecom` | `opencellid` | `cell` |
| `floodzone` | `nfhl` | `floodzone` |
| `camera` | `caltrans-cctv`, `alertwildfire`, `dot511`, `cnadnr-ro`, `windy-webcams` | `cameras` |
| `alerts.official` | `meteoalarm-*` (RO today; EU after §4), `wmo-swic` (new) | — (news/intel) |
| `news` | `gdelt`, `reliefweb`, `agency-rss`, `bluesky` | — |

For a region, the served adapter for a role = the highest-`rolePriority` adapter whose `coverage` matches that
region **and** (if the region declares `enabled_adapters`) is enabled for it. This finally makes
`enabled_adapters` load-bearing instead of decorative (item 11): declared as an **optional allowlist** — absent
means "all coverage-matching adapters", present means "only these" — which is backward-compatible with both
existing regions, since their lists already contain exactly the adapters their bespoke functions fetch.

The existing merge/retain semantics are preserved unchanged and are the reason this is safe: `mergeHazards`
(`:169`–`:177`), `servedOr` (`:156`–`:158`), `mergeCameras` (`:262`–`:273`), `buildLayerSources` (`:230`–`:239`),
`collectProvenance` (`:112`–`:123`), `pickOutageNodeIds` (`:194`–`:206`), `choosePopulation` (`:214`–`:216`).
**Nothing about the redundancy ladder changes** — only the *selection* of which adapter id fills which role
moves from a literal to a lookup.

### 2. The region schema (precise — S03 turns this into `schemas/regions.schema.json`)

There is **no region JSON-Schema today** (`ls schemas/` → `adapter-manifest.schema.json`, `cap-v1.2`,
`edxl-rm`, `edxl-sitrep`, `policies`, `sitrep`, `source-ref`, `sustainability-v05`, `threshold-rule`, plus
`schema.sql`/`MIGRATION_PLAN.md`/`adapter-contract.md` — no regions schema). MW-B/S03 creates one and validates
`config/regions.json` against it at boot, exactly as `loadManifest` already validates the adapter manifest
against `schemas/adapter-manifest.schema.json` (`src/main/adapter-registry.ts:87`, `:90`–`:100`).

| Field | Type | Req. | Semantics / validation |
|---|---|---|---|
| `id` | `string`, `^[a-z0-9]{2}(-[a-z0-9]+)*$` | **yes** | registry key + cache-key component (`lkg:<adapterId>:<regionId>`) + URL path segment ⇒ strict pattern, **allowlist-shaped, never a path** |
| `name` | `string`, non-empty | **yes** | enforced today by `makeRegion` (`src/domain/region.ts:39`–`:41`) |
| `scope` | `"COMMUNITY"｜"STATE"｜"COUNTRY"` | **yes** | `REGION_SCOPES` (`src/domain/region.ts:8`), mirrors the `schema.sql` CHECK |
| `bbox` | `[number,number,number,number]` | **yes** | `[minLon,minLat,maxLon,maxLat]` WGS-84; `assertBBox` (`src/domain/region.ts:28`–`:36`) already rejects a min>max corner; the schema additionally range-checks lon ∈ [-180,180], lat ∈ [-90,90] |
| **`iso`** | `string`, `^[A-Z]{2}$` (ISO-3166-1 alpha-2) | **yes (new)** | **The field that makes `COUNTRIES` coverage work** (`coverage.ts:9`). Required because a region without it silently loses every country-scoped adapter. Replaces the hardcoded `ISO_BY_REGION` (item 2). Sub-national regions carry their parent country's code (`us-ca` → `US`). |
| `tz` | IANA tz identifier | **yes (was optional)** | Consumed by `Intl.DateTimeFormat` for every displayed timestamp and by CAP `effective`/`expires` (FU-8). Promoted to required because "no timezone" has no honest rendering. |
| **`languages`** | `string[]` of BCP-47, ≥1, first = primary | **yes (new)** | Replaces the singular `lang`. Drives CAP multi-`<info>` (region language + English always, ADR-030 §7), the non-blocking "switch to the region's language?" hint, and the coverage-completeness rule (a shipped zone's primary language must be a shipped locale — FR-ZONE-6). `lang` is accepted as a deprecated alias for one wave. |
| `enabled_adapters` | `string[]` of manifest ids | optional | **Now load-bearing** (§1): present ⇒ allowlist; absent ⇒ all coverage-matching adapters. Every id must exist in the manifest (drift guard already enforces — `region-registry.test.ts:57`). |
| `source_mode_overrides` | `Record<manifestId, "LIVE"｜"CACHED"｜"MOCK">` | optional | Already consumed via `buildRegionRegistries` → `resolveEntryEnv`; env still wins per row. Renamed **`sourceModeOverrides`** in the typed `LoadedRegion` (`region-registry.ts:17`) — the JSON key stays snake_case for backward compatibility. |
| `seed` | `string` (seed profile id) or `null` | optional | Selects the offline seed profile (§3). `null`/absent ⇒ the **empty-but-labeled** path. |
| `units` | `"metric"` | optional, **dormant** | Units are **universal SI, always labelled** in every locale (ADR-030, FU-3). See Finding 6. |
| `$comment` | `string` | optional | already used (`config/regions.json:2`, `:64`) |

### 3. Coverage matching + graceful degradation + per-region offline seeds

**How an adapter declares coverage** — unchanged, already correct (`src/adapters/_shared/contract.ts:35`–`:38`):

| Kind | Matches when | Example |
|---|---|---|
| `GLOBAL` | always | `firms`, `gdacs`, `open-meteo`, `effis`, `glofas`, `worldpop`, `osm-overpass` |
| `BBOX` | the adapter bbox intersects `region.bbox` (`coverage.ts:8`, `bboxIntersects` `:13`–`:18`) | sub-national feeds |
| `COUNTRIES` | `region.iso ∈ coverage.iso` (`coverage.ts:9`) | `nfhl`/`eagle-i`/`census`/`nwps` (`US`), `meteoalarm-*` (EU list after §4) |

**Graceful degradation — the "no source covers this region" state (FOP-2, Art. XVI).** Three distinct outcomes
must be visually distinguishable, and none may be an empty dead-end:

| Case | Behaviour |
|---|---|
| Role has ≥1 covering adapter that **served** | render data, mode-labelled LIVE/CACHED/MOCK + freshness (today's behaviour) |
| Role has a covering adapter that **did not serve** (primary down) | retain the seeded/cached slice, label **degraded** — `collectProvenance` `:118`–`:119` already does this |
| Role has **no covering adapter** for this region | render an explicit, per-layer **"no source covers this region for `<layer>`"** state — the layer is listed, disabled, and captioned; **never a blank or missing layer.** This generalizes ADR-011's "not available in this region" (OP4) from a per-source to a per-role statement. |
| **No role** has a covering adapter (a genuinely uncovered region) | the region still opens, with a single region-level banner naming what is missing and what would fix it (add an adapter with matching coverage / add an `iso`) — an honest empty state, not a spinner or an error page |

**Per-region offline seeds (FST-2).** Two tiers, both driven by the `seed` field:

- **Rich seeds** for the five shipped zones — a golden scenario each, so `SOURCE_*_MODE=MOCK` everywhere still
  produces a populated, correctly-labelled COP. `us-ca` and `ro` already have theirs (`src/main/seed.ts`,
  `src/main/map-seed.ts`, consumed via `DEFAULT_SEED`/`DEFAULT_MAP_SEED` at
  `src/main/live-composition.ts:74`–`:75`); `ph`, `es`, `gr` gain new ones in B4.
- **Empty-but-labeled** for any config-added region with no seed: the generic path emits a structurally valid,
  entity-empty derivation input carrying the region's provenance skeleton and the degradation labels above.
  This is the difference between "add-by-config works" and "add-by-config returns `undefined`", and it is what
  makes the FR-ZONE-3 acceptance test possible.

### 4. The two aggregator adapters — what makes add-by-config *real*

A generic composition path over a US-and-Romania adapter set would still light up nothing new. The two
aggregators are the other half of the decision. Endpoints as verified in
`docs/features/GLOBAL_ZONE_SOURCE_RESEARCH.md` (all live-probed 2026-07-18):

| Adapter | Endpoint | Coverage | Key | Licence | Shipped mode |
|---|---|---|---|---|---|
| **`meteoalarm`** (widened from `meteoalarm-ro`) | `https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-<country>` (slug = English country name) — Atom embedding CAP v1.2 fields + links to full `application/cap+xml` (`GLOBAL_ZONE_SOURCE_RESEARCH.md:13`–`:19`) | `COUNTRIES` ≈ **38 European countries** (GR/ES/PT/IT verified; also Balkans, Scandinavia, RO) | **none** | CC BY 4.0 — attribution *"Data provided by EUMETNET members"* | CACHED (LIVE-capable) |
| **`wmo-swic`** (new) | `https://severeweather.wmo.int/v2/cap-alerts/<sourceId>/rss.xml`, source list at `https://severeweather.wmo.int/json/sources.json` — RSS 2.0 + CAP 1.2 (`:20`–`:25`) | `COUNTRIES`, enumerated from `sources.json`; verified live: `cn-cma-xx` (China), `hk-hko-xx` (HK), `id-inatews-id` (Indonesia), `nz-nms-en` (NZ) (`:137`–`:141`) | **none** | WMO Unified Data Policy Res.1 core data (attribution; **per-feed licence page absent — flagged**, `:24`) | CACHED |

Two constraints carried from the research annex into the design: the **RSS variant of MeteoAlarm is deprecated
(2026-01-14) — Atom only**, and the **EDR API is Bearer-gated to members/re-distributors** (`:17`–`:18`), so the
keyless Atom family is the only compliant path. **Turkey is not a MeteoAlarm member** (`:18`) — a concrete
example of the "no source covers this region" state being a real, reachable UI condition, not a theoretical one.

**Widening `meteoalarm-ro` → `meteoalarm` is a migration, not a rewrite, and it is backward-compatible:**

| Concern | Decision |
|---|---|
| Manifest id | **The `meteoalarm-ro` id is retained** as a deprecated alias row for one release, so `config/regions.json:56` / `:62` (`ro`'s `enabled_adapters` + `source_mode_overrides`) and the drift guard keep passing with no config edit. The new generic row is `meteoalarm`. |
| Coverage | `{kind:'COUNTRIES', iso:['RO']}` (`meteoalarm-ro-adapter.ts:55`) → the verified EU member list. The RO alias row keeps `['RO']`. |
| URL | `DEFAULT_BASE_URL` (`:34`) becomes a **template** resolved from `region.iso` → country slug via a static, in-repo ISO→slug map (**never** string-built from user input — the slug set is an allowlist, THREAT_MODEL row). |
| `RO_REGION` constant (`:40`) | **Deleted.** `fetchNews()` (`:95`) currently ignores its caller's region and always fetches Romania — the outward `NewsIntelPort` gains the region as a parameter (additive), and the `SourceAdapterPort.fetch(region)` path (`:73`) already receives the correct region. |
| Config prefix | `SOURCE_METEOALARM_MODE`/`_URL` added; **`SOURCE_METEOALARM_RO_*` continues to be honoured** for one release (documented in `CONFIGURATION.md` + `.env.example`). |
| Fixtures + tests | `romania-atom.xml` is **kept as-is** and remains the RO fixture; per-country fixtures are added alongside. Every existing assertion in `meteoalarm-ro-adapter.test.ts` (incl. `:83` "COUNTRIES=[RO] rejects a non-RO region" and `:115` the identity/coverage assertion) stays green against the alias row — the widened adapter gets its own new test file. |
| ACL | `meteoalarm-ro-acl.ts` is **unchanged**: the mapping decision (no geometry in the legacy feed ⇒ honest `NewsItem`, not a fabricated `HazardGeometry` — `meteoalarm-ro-acl.ts:10`–`:16`) is correct and country-independent. Upgrading to the linked `application/cap+xml` document for real geometry is recorded as post-v1. |

`wmo-swic` is a **relay**, and provenance must say so (FEV-4): each record is attributed to the relay *and*
the originating authority (e.g. "PAGASA via WMO SWIC"), with the relay named as the provenance path. It is
never presented as a first-party national feed.

### 5. The five shipped zones vs the EXTENDED roadmap — and what "demo-grade" honestly means

| Zone | Depth | Alert path | Locale promoted |
|---|---|---|---|
| `us-ca` | **full parity** (exists) | `nws`, `agency-rss` | `en` (core) |
| `ro` | **full / live-capable** (operator's region) | `meteoalarm` (RO), `agency-rss` | `ro` (core, human-reviewed) |
| `ph` | **demo-grade** | PAGASA via `wmo-swic` | **`fil`** |
| `es` | **demo-grade** | keyless AEMET CAP RSS + `meteoalarm` (ES) | `es` (core) |
| `gr` | **demo-grade** | `meteoalarm` (GR) + `effis` (already wired) | **`el`** (zero font cost — ADR-030 Finding 3) |

⇒ **14 shipped locales** = 12 core + `fil` + `el` (FR-ZONE-6, ADR-030 §3).

**"Demo-grade" is a claim with a definition, not a hedge.** For `ph`, `es`, `gr` it means exactly: the
global-coverage stack (`firms`, `gdacs`, `effis`, `glofas`, `open-meteo`, `worldpop`, `osm-overpass`) plus one
official-alert path plus a rich offline seed and a golden scenario — with **no** national gauge network, **no**
national outage feed, **no** national flood-zone layer, and **no** curated camera set. Every absent role
renders the explicit "no source covers this region" state from §3, so the gap is visible in the product, not
just in a footnote. `SOURCE_*_MODE` ships CACHED/MOCK for these zones and flips LIVE per deployment (ADR-027 §5
pattern). Every other researched zone stays **EXTENDED roadmap**: a region entry plus, optionally, one national
adapter — zero core change, which is the whole point of this ADR.

**Finding 7 — two of the three new zones have no verified source dossier.** The master plan §2B cites
"verified source sets in the research annex" for all five shipped zones. That is true for **Spain**
(`GLOBAL_ZONE_SOURCE_RESEARCH.md:44`–`:55`: AEMET OpenData CAP + the **keyless** CAP RSS fallback
`https://www.aemet.es/documentos_d/eltiempo/prediccion/avisos/rss/CAP_AFAE_RSS.xml` verified 200, DGT DATEX-II
CC-BY, EFFIS already wired) but **not** for the Philippines or Greece: both are listed under *"REMAINING to
research"* at `:7` and again in the resume instructions at `:120`–`:122` — *"Philippines (PAGASA/NOAH/MMDA)"*
and *"Greece (HNMS/Civil Protection — probed, report undelivered)"*. What **is** verified and sufficient to
start: Greece is inside MeteoAlarm's coverage (`:15` — "GR/ES/PT/IT verified") and inside EFFIS, so `gr` needs
**no new source research at all** — the two aggregators plus the already-wired EFFIS cover it. The Philippines
has **no verified feed of any kind**: the SWIC enumeration at `:137`–`:141` confirms ID/CN/NZ/HK and four
Pacific entries, but **PAGASA is not among the confirmed ids**. ⇒ **MW-B B3 must begin with a bounded
live-probe spike: enumerate `sources.json` and confirm the PAGASA `sourceId` (and, failing that, a keyless
PAGASA/NOAH alternative) before `ph` is claimed as shipped.** If no compliant PH alert path is confirmed, the
honest fallbacks in priority order are: (a) ship `ph` on the global stack + GDACS only, with the
`alerts.official` role in the explicit no-coverage state, or (b) swap `ph` for a zone with a verified feed
(Indonesia `id-inatews-id` is verified LIVE at `:144` and is WorldRiskReport rank 3). **Neither the STORM type
nor `fil` is wasted in case (a)** — both remain justified by the zone itself.

### 6. Migration safety — `us-ca` and `ro` must be observably identical

This refactor touches the composition root, so the safety argument has to be explicit.

1. **The refactor is a lookup substitution, not a semantic change.** Every merge/retain/provenance helper in
   `live-seed.ts` is kept byte-identical (§1). What changes is only *how the adapter id for a role is chosen*.
2. **Role tables are seeded from today's literals.** The `role`/`rolePriority` values assigned in
   `config/adapters.json` are chosen so that role resolution for `us-ca` reproduces `enrichCaIncident`
   (`:320`–`:345`) and `enrichCaMap` (`:457`–`:487`) exactly — including the deliberate quirks: the `fire`
   layer badge stays `firms` even though `nifc` perimeters are merged in (documented rationale,
   `live-seed.ts:476`–`:479`), and `census` is preferred over `worldpop` for US population
   (`choosePopulation`, `:214`–`:216`). Likewise for `ro` vs `enrichRoIncident` (`:347`–`:378`) / `enrichRoMap`
   (`:489`–`:515`), including RO's `noWx` weather-fact suppression (`:363`) and `hazNone`/`outNone`
   (`:501`–`:502`).
3. **A characterisation test is written BEFORE the refactor** (TDD red): snapshot the full `CoreSeed` +
   `MapInputsSeed` for `us-ca` and `ro` under an all-MOCK deterministic registry, then assert the generic path
   produces the *same* structures. The existing `src/main/live-seed.test.ts` (which already loads the real
   `config/regions.json`, `:17`/`:43`) and `src/main/live-composition.test.ts:73`–`:91` (end-to-end per-region
   composition through the real config) are the starting points.
4. **`GET /regions` gets served** (item 14), so the UI derives its region list from config instead of
   `app/page.tsx:42` (FU-6): add a `regions` verb to the `Command` union, route it in
   `src/adapters/channels/http/routing.ts`, consume the already-injected `RegionReadModel`
   (`command-router.ts:70`/`:100`), and widen `RegionView` (`:43`–`:46`) from `{id, name}` to include
   `iso`, `tz`, `languages`, `bbox`. The openapi entry flips from `x-status: planned` to served. The client
   hook falls back to the current two-entry list if the call fails, so the COP never loses its selector
   (Art. XVI). **`RegionSelector`'s rendered labels for `us-ca`/`ro` must be unchanged** ("California (US)",
   "Romania (EU)") or the four visual baselines break — so the config `name` values (`config/regions.json:7`
   "California (Flagship)", `:39` "Romania (EU Flood)") are **not** what renders; a `displayLabel` (or a
   catalog key, ADR-030 §2) supplies the toolbar label. This is a real trap and is called out here so B1 does
   not walk into it.
5. **Visual-baseline policy.** MW-B is allowed **one** regeneration, and it is spent on the **STORM layer**
   (master plan §5.3), not on this refactor. Any `us-ca`/`ro` visual diff produced by B1 is a **defect**.
6. **Drift guards.** The existing regions↔manifest test (`region-registry.test.ts:57`–`:75`) is extended to
   also assert: every region has a valid `iso`, `tz`, and ≥1 `languages` entry; every region's primary language
   is a shipped locale (the coverage-completeness rule, mechanised); every `role` referenced by the composition
   root exists on ≥1 manifest row; and `config/regions.json` validates against the new
   `schemas/regions.schema.json`.
7. **The new add-a-zone-by-config acceptance test (FR-ZONE-3 / FOP-2)** joins the redundancy-acceptance family
   in `gabbe.config.json` `required_acceptance_tests` (protected-file escalation pre-announced, master plan
   §5.6): inject a **synthetic** region entry (e.g. `iso: 'PT'`, a valid bbox, no `enabled_adapters`, no
   `seed`) into an in-memory registry and assert (a) it appears in the selector, (b) coverage-matching global
   adapters populate it non-empty with correct mode labels, (c) roles with no covering adapter render the
   explicit no-coverage state, and (d) **nothing outside `config/regions.json` was modified** — the last
   assertion is what actually proves "zero core change".

## Consequences

- **Positive.** The pivotal enabler: after MW-B, a zone is a config entry, which is what MW-C (prediction per
  region), MW-D (per-region EAP configs, predicted-impact per zone) and the judges' "comprehensiveness"
  criterion all stand on. Two adapters buy official alerts for ~38 European countries plus the closed-portal
  set — a far better comprehensiveness-per-line-of-code ratio than N national adapters, and it converts
  ADR-011's *design* claim into a *demonstrable* one on camera (add a region live, watch it populate). Four
  duplicated ~30-line functions collapse into one path, so the next zone costs nothing and the next
  *role* is added once rather than per region. Five latent config fields (`iso` newly added, `tz`, `lang`,
  `enabled_adapters`, `units`) stop being decorative — dead config is a docs-truth liability, and MW-E's
  docs-truth lens would have flagged every one of them.
- **Negative / accepted — the blast radius is the composition root.** `src/main/live-seed.ts` is the single
  file where every adapter meets every derivation input; a regression there is a regression in *every* layer of
  *every* region simultaneously, and it is exactly the kind of change that silently degrades provenance labels
  rather than crashing. This is accepted because (a) the four helper families that carry the actual semantics
  are preserved byte-identical, (b) the characterisation snapshots in §6.3 make any behavioural drift a
  hard test failure rather than a subtle label change, and (c) the alternative — adding `ph`/`es`/`gr` as three
  more bespoke `enrich*` pairs — would make the same file six branches long and would have to be undone before
  MW-C anyway. **It is still the right call: every later wave is cheaper because of it, and the "add a region
  by config" claim is either true after MW-B or it is a false claim in the submission.**
- **Negative / accepted — role resolution introduces a new implicit-behaviour surface.** "Which adapter served
  this role?" becomes a computed answer rather than a readable literal, which is harder to eyeball. Mitigated
  by the drift guards (§6.6), by `layerSources` already recording the serving adapter per layer
  (`buildLayerSources`, `live-seed.ts:230`–`:239`), and by keeping the role table small, closed and typed.
- **Negative / accepted — an aggregator is a single point of failure across ~38 countries.** If
  `feeds.meteoalarm.org` degrades, every European zone's official-alert role degrades together. Mitigated by
  the per-region `lkg:<adapterId>:<regionId>` cache (already correct), the per-region circuit breakers, and
  the honest degraded labelling; national anchors (AEMET for `es`, EFFIS for fire) act as independent
  corroborators where they exist.
- **Negative / accepted — relayed provenance is one hop from the authority.** A SWIC-relayed CAP is as fresh
  and as correct as the relay; the WMO feeds also lack per-feed licence pages
  (`GLOBAL_ZONE_SOURCE_RESEARCH.md:24`). Both facts are labelled in `NOTICE` and
  `audit/DATA_SOURCE_VERIFICATION.md`, and the relay is named in provenance (§4).
- **Negative / accepted — demo-grade zones are shallow, and the UI says so.** Three of five shipped zones have
  no national gauge/outage/flood-zone/camera coverage (§5). The explicit no-coverage state makes this visible
  rather than hidden — which is the honest-limitations rubric item, not a weakness.
- **Risk — the Philippines alert path is unverified** (Finding 7). Owned by a bounded B3 spike with two
  pre-decided fallbacks, so it cannot become a mid-wave scope crisis.
- **Neutral / cleanup.** **Finding 6:** `config/regions.json:35` declares `us-ca` `"units": "imperial"`. Units
  are locked to **universal SI, always labelled** (ADR-030, FU-3), and the field is consumed by nothing
  (item 12) — so today it is not merely dormant, it is **actively misleading** any reader of the config. MW-B
  sets it to `"metric"` (or removes it) and the schema restricts it to `"metric"`, with a `$comment` recording
  that units are intentionally not configurable. This is a docs-truth fix, not a behaviour change: current
  behaviour is already metric everywhere.

## Alternatives considered

- **Add `ph`/`es`/`gr` as three more bespoke `enrich*` function pairs** (the pattern the code already
  establishes) — rejected. It is the cheapest single wave and the most expensive project: `live-seed.ts` grows
  to six branches and ~1000 lines, MW-C/MW-D must then multiply per branch, "add-by-config" stays a false
  claim, and the refactor still has to happen before the final audit — with three more callers to migrate.
- **A per-region plugin module** (`src/main/regions/<id>.ts`, each exporting its own enrichment) — rejected.
  It is tidier than branches but still *code per region*, so adding a zone remains a code change requiring a
  release, which fails FR-ZONE-3/FOP-2 outright and defeats the on-camera demo.
- **N national adapters instead of the two aggregators** (AEMET, IPMA, DPC, BMKG, PAGASA, HNMS, …) — rejected
  as the *v1 mechanism*, kept as the roadmap. Each is a separate licence, auth model, format, fixture set and
  breakage surface; the research annex documents a dozen with materially different quirks (token-gated ANA,
  WAF-blocked inaRISK needing a browser UA, GitHub-hosted DPC JSON with a 1000-file API truncation). Two
  keyless aggregators deliver most of the coverage at a fraction of the maintenance, and ADR-027 §7's
  extensibility clause means any national anchor can be added later with zero core change.
- **Deriving `iso` from the bbox by point-in-country lookup** instead of adding the field — rejected: it needs
  a country-boundary dataset (repo weight, licence, Art. XVI offline cost), and it is *wrong* for sub-national
  and cross-border regions. A two-letter code in config is the honest, zero-cost answer.
- **Keeping the UI's hardcoded `REGIONS` array and just adding three rows** — rejected: it fails FU-6 in the
  most literal way possible, and it guarantees the config and the selector will drift the first time a region
  is added. Serving `GET /regions` also retires a documented-but-unserved endpoint
  (`openapi.yaml:183`) and finally consumes the already-injected `RegionReadModel` — a docs-truth win MW-E
  would otherwise flag.
- **Renaming the `meteoalarm-ro` manifest id outright** — rejected for one release: it would break
  `config/regions.json`'s `ro` entry (`:56`, `:62`), the drift guard, the `SOURCE_METEOALARM_RO_*` env
  contract, and the adapter's existing tests in one commit. A deprecated alias row costs one manifest entry and
  keeps every gate green (§4).
- **Fetching the full linked `application/cap+xml` document per MeteoAlarm entry to obtain real geometry** —
  rejected for MW-B: it multiplies request volume per region and changes the ACL's honest no-geometry mapping
  decision (`meteoalarm-ro-acl.ts:10`–`:16`). Recorded as post-v1.

## Verification

| # | Gate / test | Proves |
|---|---|---|
| 1 | `src/main/live-seed.test.ts` — **characterisation snapshots**: `us-ca` and `ro` `CoreSeed` + `MapInputsSeed` byte-identical before/after the refactor under an all-MOCK deterministic registry | FU-7, migration safety §6.3 |
| 2 | `e2e/visual.spec.ts` — the four `cop-*-linux.png` baselines pass **unchanged** after B1 (the single MW-B regeneration is reserved for the STORM layer) | master plan §5.3 |
| 3 | `tests/zones/add-a-zone.test.ts` — **new acceptance test**: a synthetic region entry appears in the selector, is populated non-empty by coverage-matching global adapters with correct mode labels, renders the explicit no-coverage state for uncovered roles, and requires **no file change outside `config/regions.json`** | **FR-ZONE-3 / FOP-2** |
| 4 | `src/adapters/persistence/region-registry.test.ts` — extended drift guard: existing manifest-id integrity (`:57`–`:75`) **plus** every region has valid `iso`/`tz`/`languages`; every primary language ∈ shipped locale set; every composition role exists on ≥1 manifest row | FU-6, FU-8, FR-ZONE-6 |
| 5 | `schemas/regions.schema.json` + a boot-validation test mirroring `loadManifest` (`adapter-registry.ts:90`) — the real `config/regions.json` validates; malformed entries fail fast without throwing | §2, ADR-012 fail-fast |
| 6 | `src/adapters/_shared/coverage.test.ts` — role resolution: GLOBAL matches every region; `COUNTRIES` matches only on `iso`; a region **without** `iso` loses country-scoped adapters and gets the explicit no-coverage state (never a silent blank) | FOP-2, Art. XVI |
| 7 | `src/main/live-composition.test.ts` — per-region registry isolation and override threading still hold for **five** regions (extends `:95`–`:122`) | §1, no cross-region bleed |
| 8 | `src/adapters/sources/meteoalarm/*.test.ts` **and** the retained `meteoalarm-ro/*.test.ts` (incl. `:83`, `:115`) — widened adapter resolves the country slug from `iso` from a static allowlist; the RO alias row keeps its coverage, fixture and env prefix | §4 backward compatibility, FEV-3 |
| 9 | `src/adapters/sources/wmo-swic/*.test.ts` — recorded-fixture CAP relay maps to canonical entities; provenance names **both** the relay and the originating authority | FEV-4 |
| 10 | `tests/redundancy/*` — the three mandatory acceptance tests (air-gapped, primary-down, AI-disabled) re-run per shipped zone: with all sources MOCK, each of the five zones renders a populated, correctly-labelled COP from its seed | **FST-2**, Art. XVI |
| 11 | `src/adapters/channels/http/routing.test.ts` + openapi lint (`npx @redocly/cli lint docs/api/openapi.yaml`) — `GET /regions` served, envelope carries `provenance[]` + `freshness`, `x-status: planned` removed, `RegionView` widened | FU-6, item 14 |
| 12 | Formatting/alerting tests — every displayed timestamp uses `Intl.DateTimeFormat` in the region's `tz`; CAP `effective`/`expires` respect it; CAP carries the region's primary language **plus English** | **FU-8**, ADR-030 §7 |
| 13 | `npx depcruise` + `tests/architecture/*` — role resolution lives in `src/main`/`src/adapters/_shared`; **zero** new edges into `src/domain`/`src/application` | ADR-001 boundary |
| 14 | `NOTICE` + `audit/DATA_SOURCE_VERIFICATION.md` + THREAT_MODEL — an entry per new source with licence and attribution (EUMETNET, WMO Res.1, AEMET), a row per new egress host, and the region-config validation row | Art. XI/XIV, master plan §4 |

## Implementation complete: No (planned — wave MW-B, master plan §3)

Scope: **B1** engine-generic refactor (region schema + `iso`/`tz`/`languages`, role resolution, one generic
enrichment path, `GET /regions` served, UI selector from config, characterisation snapshots first) → **B2**
STORM/TYPHOON type + track/cone/surge + map layer (**the single visual-baseline regeneration**, ADR-032) →
**B3** the two aggregator adapters + the **PAGASA-via-SWIC verification spike** (Finding 7) + Mediterranean
zone configs → **B4** shipped-zone seeds + golden scenarios + `fil`/`el` locale promotion +
redundancy-acceptance rows. Findings 6 and 7 and migration trap §6.4 (the `RegionSelector` label) are inputs to
B1/B3 and must be reflected in the S03 spec deltas and S04 task decomposition.
