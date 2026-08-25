# BEACON — S04 task decomposition: THE FINAL COMPLETE VERSION

> **GABBE phase:** S04 (task decomposition) for `../../../CURRENT-MASTER-PLAN.md`.
> Requirements: `../docs/requirements/EARS_FINAL_VERSION.md`. Architecture: ADR-030…036.
> Status legend: ☐ todo · ◐ in progress · ☑ done · ⚠ blocked/needs decision.
> ⛔ Agents never run git commit/push/tag. Every wave ends ALL-GATES-GREEN.
> **This file is the resumable backlog — keep it current; it is what a fresh session executes.**

## 0. VERIFIED SEAM FINDINGS from S02 (read before implementing — these correct the plans)

These were found by reading the code during S02 and **supersede the plan annexes** where they conflict.
Each one is already folded into a task below.

| # | Finding (verified) | Consequence |
|---|---|---|
| F-01 | `GET /regions` is `x-status: planned` in `docs/api/openapi.yaml:183`; there is no `regions` verb in the `Command` union, and `RegionReadModel` is injected (`command-router.ts:70,100`) but never consumed. | FR-ZONE-1 needs a real API route + command, not just a UI change. → B1.2 |
| F-02 | `InteractionRequest` has **no** `locale` and no `args` (`src/ports/interaction.ts:160-172`), contradicting ADR-023:28-29. | A4 must widen the envelope (additive, optional) and correct ADR-023 by addendum. → A4.1 |
| F-03 | `CapOptions.language` has no caller and `buildCapAlert` hardcodes ONE `<info>` (`cap-mapper.ts:135`). | Multi-language CAP is a signature widening, not wiring. → A4.2 |
| F-04 | `config/regions.json` has no `iso`; domain `Region` (`src/domain/region.ts:11`) has no `iso`/`tz`/`lang`; coverage matching uses a hardcoded `ISO_BY_REGION` map in the composition root. | Region schema + domain extension are prerequisites for zone genericity. → B1.1 |
| F-05 | `enabled_adapters`, `tz`, `lang`, `units` are parsed (`region-registry.ts:61-63`), persisted and drift-guarded, but **consumed by nothing**; `buildAdapterRegistry` builds every manifest row regardless. | "Add a region by config" is only partially true today. → B1.3 |
| F-06 | Region bboxes are **duplicated** into `FALLBACK_BBOX` (`live-seed.ts:46`) and an unknown region silently receives **California's bbox** (`regionOf`, `:127`). | Real defect: a new zone would render Californian data. → B1.4 (must fix before shipping any new zone) |
| F-07 | The default basemap is `OPEN_RASTER_STYLE` — **raster** OSM PNG tiles (`app/_components/map/style.ts:8-18`). Labels are baked into bitmaps: there is no `text-field`, no `name:en`, and no RTL-plugin concern. | Basemap labels **cannot** be localized on this style. Honest limitation, must be stated in SPEC + ADR-030. → A5.3 |
| F-08 | `@fontsource-variable/inter` **does** ship Greek (`U+0370-03FF` + greek-ext). | `el` costs zero font budget, confirming the master-plan assumption. → A3 |
| F-09 | There is **no direct `Intl.*` call anywhere** in `src/` or `app/`; `relative-time.ts` lives in `app/_components/ui/` (not `_lib/`) and is hand-rolled English. | Locale-aware formatting is genuinely new work. → A2.5 |
| F-10 | `config/regions.json` declares `us-ca` `"units": "imperial"` while units are locked universal-SI and the field is unused. | Actively misleading config → delete the field. → B1.1 |
| F-11 | `IntlValue.timeZone` is hardcoded `'UTC'` (`app/layout.tsx`). | Region-tz consumption lands with the region read model. → B1.5 |
| F-12 | The regions↔manifest drift-guard test **already exists** (`region-registry.test.ts:57-75`); the master plan lists it as new work. | Extend it, don't rebuild it. → B1.6 |
| F-13 | `buildRegionRegistries` + `lkg:<adapterId>:<regionId>` cache keying are present and correct (`live-composition.ts:38`, `last-known-good-cache.ts:12`). | Reuse verbatim; no rebuild. |
| F-14 | `alertLocalesFor()` exists (`src/config/locales.ts`) with **no caller**. | A4 wiring only. |
| F-15 | GloFAS exceedance probability + tendency are parsed (`glofas-acl.ts:42-43`) then dropped by `definedOnly({…})` (`:82-90`); `Gauge` (`src/domain/gauge.ts:22-30`) has no field to receive them. | MW-C must extend the domain first, then the ACL. → C1.1 |
| F-16 | `ESCALATION` / `IMPACT_OVER_TIME` exist in the domain enum and the DB CHECK constraint but are **never constructed anywhere**. | Confirms "promised-never-built". → C2.2 |
| F-17 | SitRep synthesis has **zero** references to `Prediction`. | The Outlook wiring is wholly new, not a modification. → C2.3 |
| F-18 | `risk-intersection.ts` is fully hazard-kind-agnostic. | `STORM_SURGE` exposure needs **no** engine change — only composition-root data wiring. → B2.3 |
| F-19 | `SPREAD_CONE` already exists in `HAZARD_KINDS` but is the *wildfire* spread cone — not reusable for a cyclone forecast cone. | Storm needs its own `CONE` kind. → B2.1 |
| F-20 | `output-validator.ts` enforces "no LLM numbers" by regex-matching **numbers only** — it would not catch an invented likelihood WORD. | Extend the contract with `usesOnlyCitedLikelihoodClasses`. → C1.4 |
| F-21 | ~~⚠ **Philippines has no verified feed of any kind.**~~ **THIS FINDING WAS WRONG — RESOLVED 2026-07-27 by the B3.4 spike.** PAGASA **is** a registered WMO-SWIC alerting authority (`ph-pagasa-en`, OID `urn:oid:2.49.0.0.608.0`, feed *Operating*); the earlier enumeration at `GLOBAL_ZONE_SOURCE_RESEARCH.md:137-141` was incomplete, not the source list. Two keyless LIVE CAP v1.2 paths verified same-day fresh: the SWIC relay `severeweather.wmo.int/v2/cap-alerts/ph-pagasa-en/rss.xml` (71 items) and the native Atom `publicalert.pagasa.dost.gov.ph/feeds/`, the latter **explicitly CC BY 4.0 in the feed itself**. | **No escalation needed; rung (a) taken.** `ph` ships on a real national alert source, with the global stack as the Art. XVI redundancy tier rather than the story. PH needs NO "no national alert source" banner. `fil` is already a shipped locale. PHIVOLCS is HTML-only **and out of hazard scope — do not wire it**; NDRRMC is PDF/dashboard ⇒ link-out only. → B3.2 + B3.4 |
| F-22 | Deriving the region selector from config changes the rendered labels ("California (Flagship)" vs "California (US)") and would break 4 visual baselines. | Region display names come from the CATALOG, not from `regions.json` `name`. → B1.7 |

### 0b. Second finding batch (from ADR-034/035/036) — includes THREE live defects in shipped code

| # | Finding (verified) | Consequence |
|---|---|---|
| **F-23** 🔴 | **`blendPopulation` (`derive-cop.ts:329-336`) performs NO clipping and discards `e.area`, while `:343` renders "residents within the exposed area".** | A **live honesty defect**: the UI claims polygon-precise exposure it does not compute. FR-PAP-3 is therefore a CORRECTNESS FIX, not an enhancement. → D1.1, and call it out in the MW-E docs-truth lens. |
| **F-24** 🔴 | **`logistics-board.tsx:25` `TRANSITIONS` drifts from the domain machine** (UI: `ASSIGNED/EN_ROUTE/ON_SCENE` · domain: `TASKED/ENROUTE/ONSCENE`). | A **live defect**: the board's state machine disagrees with the domain's. Blocks D6-1's "taskable via the existing board" claim. → D6.0 (fix first). |
| **F-25** 🔴 | **`purgeAfter` is stamped and indexed but has NO sweep executor** — nothing ever enforces it. | The "no PII retention beyond the incident lifecycle" guarantee (Art. XIV) is **claimed but unenforced**. Either implement the sweep or state the limitation honestly; implementing it is cheap and is the right call. → D4.3. |
| F-26 | `estimatePopulation` has **zero production call sites**; production uses `fetchSlice` (`live-seed.ts:325/358`). `PopulationPort` is **bbox-only**; `SpatialPort.intersect` returns a boolean and the PostGIS impl is a stub — polygon∩polygon clipping does not exist. | The zonal-sum engine needs a real clipping primitive first. → D1.0. |
| F-27 | **No population raster/tile artifact exists.** WorldPop is an HTTP call forced into a bbox rectangle (`worldpop-adapter.ts:55,170`). | Master plan §5.2's "pre-clipped tiles" needs a NEW artifact format: ship a quantized integer grid (integrity-hashed), not GeoTIFF (no raster dependency exists and none should be added). → D1.2. |
| F-28 | **OpenCelliD yields `TelecomCoverage`, not `InfrastructureNode`, and `online` is hardcoded `true`.** | No outage inference is possible from it — the comms-blackout figure must be **geometric** (sites inside the predicted extent), and must say so. → D1.3. |
| F-29 | **CAP `msgType` is hard-pinned to `Alert` and `CapAlert` has no `references`**, though the CAP schema already requires `references` for Update/Cancel (`:89-94`). | Update / Cancel / ALL-CLEAR are **unconstructible today** — FR-WARN-2 starts with a domain+mapper change. → D3.2. |
| F-30 | **No delivery count exists anywhere**: all three messaging ports return `Result<void>` and the broadcast loop discards results (`interop.ts:140`). | Delivery feedback is new plumbing (counts per channel, never per recipient). → D3.3. |
| F-31 | **Inbound EDXL-RM is not schema-validated** (asymmetric with emit). | D4-2 must close the asymmetry. → D5.2. |
| F-32 | **No `FEATURE_*` flag reaches the browser** (`FEATURE_CAMERAS`/`FEATURE_EXTERNAL_VIEWS` are declared and never read). | Every new panel flag needs a `NEXT_PUBLIC_` mirror, exactly like the two existing precedents. → D5.0/D6.0. |
| F-33 | **`schemas/threshold-rule.schema.json` is dead** (zero code references) and has drifted from its domain type; the real config-as-data precedent is `policy-loader.ts:34-47`. | Follow the policy-loader pattern for the EAP schema; fix or delete the dead schema at MW-E. → D2.1, E1. |
| F-34 | **GloFAS reporting points expose a DERIVED probability, not ensemble members.** | The member-counting evaluator has **no wired live source** and must ship from cached files, labeled — do not imply live ensemble access. → D2.2 + honest-limitations ledger. |
| F-35 | `Shelter` domain + port + memory impl exist, but **no shelter adapter exists** (`persistence/seed.ts:66` hardcodes them), and **there is no CSV/export precedent** anywhere. | D4-3 re-sized S–M → **M**; D6-4 is larger than "S". Schedule accordingly. |
| F-36 | **`estimatePopulation`/`blendPopulation`/`purgeAfter`/threshold-schema findings are all pre-existing** — none was introduced by this feature. | They belong in the MW-E audit narrative as "found and fixed during the final version", not hidden. |

### 0c. Third finding batch (from the MW-A docs-truth pass) — SIX pre-existing false doc claims

The docs lane was told to document `NEXT_PUBLIC_DEFAULT_LOCALE` and **refused, correctly**: the variable does
not exist. That instruction came from this project's own S03 delta doc, so the delta doc was itself carrying
the defect class the docs pass exists to catch. Recorded here rather than quietly fixed.

| # | Finding (verified) | Consequence |
|---|---|---|
| **F-37** | **`NEXT_PUBLIC_DEFAULT_LOCALE` does not exist and nothing reads it.** The default locale is registry-driven (`config/locales.json` `defaultLocale` + `DEFAULT_LOCALE`). The only `NEXT_PUBLIC_*` vars are `AUTH_DEV_LOGIN` and `FEATURE_CITIZEN_STREAM`. | `docs/SPEC-FINAL-VERSION-DELTA.md` §6 must drop the row (done). Localization is deliberately NOT env-configured; if an env override is ever wanted, it needs code FIRST. |
| **F-38** | **`REGION_LANG` / `REGION_TZ` / `REGION_UNITS` never existed** — CONFIGURATION §12a and SPEC §3.5 documented all three. The real fields are `languages[]` and `tz`. | Corrected in both docs by the lane. |
| **F-39** | **SPEC §3.5 claimed imperial display for `us-ca`** — a documented behaviour the product never had, the same misconception the removed `units` field encoded. | Corrected. Reinforces F-10. |
| **F-40** | **`.env.example` had `DEFAULT_REGION_ID=ca-flagship`** — that region id does not exist (`us-ca`, `ro`). | Fixed. |
| **F-41** | **`SPEC.md` has NO consolidated "Known limitations" section**, although the S03 delta asserts the limitations "appear verbatim" there and **NFR-F10 requires it**. The only consolidated list is in `CHANGELOG.md` under `[0.1.0]`. | The localization limitations landed as a labelled block inside §3.5; **creating the top-level section is MW-E/E1 work** and NFR-F10 is not satisfied until it exists. |
| **F-42** | The S03 delta doc says machine-translated locales are "all except English **and Romanian**". `messages/ro.json` is `review: machine`. | Delta doc corrected (done). Romanian flips to human only after the entrant's review. |

### 0d. Fourth finding batch (MW-B/B2 + a REGRESSION THIS SESSION INTRODUCED AND FIXED)

| # | Finding | Consequence |
|---|---|---|
| **F-43** 🔴 | **The `brace-expansion: ^5.0.8` override added earlier this session BROKE the coverage gate.** brace-expansion 5.x is ESM-only with no CJS default export, while `glob`'s nested `minimatch@9` calls `brace_expansion_1.default(...)` — so `vitest --coverage` crashed in `getUntestedFiles`. The security fix silently disabled Gate 3. | **Fixed** by additionally overriding `minimatch: ^10.2.5` (which expects brace-expansion 5 and consumes it correctly). Coverage now runs and its floors pass, and `npm audit` stays at 0 high. **Lesson: a dependency override is a code change — re-run the FULL battery after one, including `--coverage`, not just tests.** |
| F-44 | `schemas/schema.sql` (the reference DDL, declared "source of truth") mirrors the same CHECK constraints as the Drizzle schema, and ADR-032 cited only the latter. A hazard/incident enum widening must land in **three** places, not two. | The storm wave updated all three. Add the DDL mirror to the exhaustive-map checklist in §0. |
| F-45 | Exposure inclusion/exclusion is decided in `src/application/derivation/derive-cop.ts` (`exposureQueryOf`, `incidentExposureQuery`), NOT at the composition root as ADR-032 §3 assumed. | The storm wave made it **compile-enforced** via `EXPOSURE_BEARING_BY_KIND: Record<HazardKind, boolean>` in the domain, so a future hazard kind fails Gate 2 rather than being silently counted as exposure. Better than the ADR specified. |
| F-46 | `MapFeatureList` (the accessible keyboard alternative to the map) covers only fire/gauge/infra/exposure/report/shelter — **every overlay layer is absent**: outage, cell, weather, floodzone, cameras, prediction, route, and now storm. | Not a storm defect; a pre-existing a11y coverage gap in the non-visual alternative. Candidate for MW-E: either widen the list to overlays or state the limitation. |
| F-47 | The storm layer needed **no visual-baseline regeneration** despite adding a `LayerTogglePanel` row, because the baseline screenshots keep the Layers popover closed. Empirically confirmed: Playwright 78/78 green. | **Visual budget remains 1 of 2 used.** The expectation that it would cost a regen was wrong — verify with a run, do not assume. |

### 0e. Fifth finding batch (B3.4 Philippines spike) — one of them would have put a FALSE MAP on camera

| # | Finding (verified by fetching the actual documents) | Consequence |
|---|---|---|
| **F-48** 🔴 | **PAGASA's tropical-cyclone CAP (`acp`) `<polygon>` is its entire Area of Responsibility, not the storm footprint** — observed verbatim as `21,120 21,130 5,130 5,121.5 9.5,113 15,113 21,120`, which is **wider than any sane PH bbox**. Its flood CAP (`gfa`) by contrast carries genuine province-level geometry (3 polygons for Maguindanao; polygon + `geocode SAME 153600000` for Lanao Del Sur). | If the relay treats every CAP `area` as hazard geometry, BEACON paints a false polygon across the West Pacific **in front of the judges** — the exact failure class as F-06 (California's bbox), which is why that one got its own test. **Required in B3.2:** `acp` areas → *advisory/alert-extent*, clipped to the region bbox and labelled as such; flood geometry from `gfa` province polygons; storm footprint from GDACS. Bind it with a test. |
| **F-49** | **CAP allows MULTIPLE `<polygon>` elements per `<area>`** (observed in the live `gfa` document), and **CAP coordinate order is `lat,lon` — reversed from GeoJSON**. | A relay parser that keeps the first ring silently drops hazard area; one that forgets the axis swap transposes every polygon. Both are silent wrongness. The parser must emit MultiPolygon and swap axes, each pinned by a fixture test. |
| **F-50** | The `wmo-swic` relay adapter **does not exist yet** — `grep -i "swic\|wmo"` returns nothing in `config/adapters.json` or `config/planned-sources.md`. `ph-pagasa-en` is therefore *one configured source id on an adapter B3.2 must create first*, not an adapter of its own. | B3.4's remaining code work is near-zero and strictly downstream of B3.2. Manifest shape by analogy with `meteoalarm-ro` (`coverage COUNTRIES/["PH"]`, ttl ≈900 s, standard breaker, fixtures = one `gfa` + one `acp`). |
| F-51 | Unverified after the time box, and **must not be claimed**: the full PAGASA alert-family catalogue (only `gfa` and `acp` were observed — **no basis to claim thunderstorm/rainfall advisories are CAP-published**); published rate limits on either host; relay-vs-native content parity; CAP archive depth (URLs are UUID-keyed ⇒ feed-discovery only); Project NOAH, PH gauges, PH cameras. The suggested bbox `[116.93, 4.59, 126.60, 21.12]` is **not geodetically verified** — confirm at implementation. | These go in the honest-limitations ledger, not in a source table. PH gauges fall to global `glofas`. |

### 0f. Sixth finding batch (B1.3 allowlist lane)

| # | Finding (verified) | Consequence |
|---|---|---|
| **F-52** | **`config/regions.json` allowlists were STALE**: `open-meteo`, `bluesky`, and all five E11 camera sources landed in the manifest and in `live-seed.ts` without ever being added to any region's `enabled_adapters` — so the moment the allowlist became real, both shipped regions would have silently lost live layers. Reconciled in the same change (us-ca 15→21, ro 10→14). Root cause remains: **nothing forces a new manifest row + consumer to appear in a region list**; the current guard hardcodes the consulted-id lists because `live-seed.ts`'s per-region ids are private constants. | B1.8's generic coverage-driven path must DERIVE the consulted set from the region's allowlist, making this guard structural instead of a hardcoded mirror. |
| **F-53** | **`capTranslationsFor()` has NO production caller** — `alert-sink.ts:70` passes `deps.capOptions` straight through and its only production construction site (`feature-seed.ts:213` `makeAlertSink({ clock })`) supplies no `capOptions` at all, so every emitted CAP still carries exactly one English `<info>` block. Also structural: `capOptions` is one GLOBAL object while alerts are per-region — the sink needs a region-aware option (per-alert region → `regionAlertLocales()` → `capTranslationsFor()` → `CapOptions.translations`), not a constant. | The A4.2 machinery is built-not-consumed until this hop lands. → wire in MW-D/D3 (warning excellence), where the CAP path is already being reworked for Update/Cancel. Do NOT claim multilingual CAP emission before then. |
| F-54 | `schemas/regions.schema.json` allows `"enabled_adapters": []` while the composition treats empty as "consult nothing". | Recommend `minItems: 1` so "consult nothing" must be said by deleting the region, not by an empty array (a config state that looks like an accident should be unrepresentable). → fold into B1.8 or MW-E/E1. |
| F-55 | `live-seed.ts:regionOf` duplicates the config-id lookup now available (private) as `findRegion` in `region-registry.ts`. | Unify in B1.8 (which owns `live-seed.ts`). |
| F-56 | **Deliberate API-surface change** (more honest, but observable): a source a region does not enable no longer appears in that region's `/status` source projection at all — previously it appeared MOCK-labelled. No scoped baseline test depended on it. | State in CHANGELOG at MW-E/E1; if any full-battery test asserts the old surface, fix the TEST, not the behaviour. |

### 0g. Seventh finding batch (A4.3b + B1.2 lanes, and one ORCHESTRATOR REVERSAL)

| # | Finding (verified) | Consequence |
|---|---|---|
| F-57 | **OASIS EDXL-RM 1.0 and EDXL-SitRep 1.0 define no language element in their core message types** — only a normative RFC 3066 citation with nothing wired to it; the family's actual mechanism is EDXL-DE 2.0's `<language>`/`<contentLanguage>` (`xsd:language`), and BEACON does not wrap RM/SitRep in a DE envelope. | The new optional `language` field is grounded in the DE element's name+semantics, applied at message level, with the gap documented in both schemas and both mappers instead of inventing a wire format. If a DE wrapper ever lands, the field moves there. |
| **F-58** 🔴 | **A lane "fixed" honesty drift in the WRONG DIRECTION**: `messages/ro.json` `_meta` falsely claimed "reviewed by a human translator" (pre-existing, committed) and ADR-030 asserted "ro is the one human-reviewed non-English catalog" in three places — all ASPIRATIONAL; no human review has happened (the entrant's review is a pending USER action, F-42). The A4.3b lane harmonized `config/locales.json` toward the false claim, which would have REMOVED the in-UI machine-translation notice for Romanian. **Reversed by the orchestrator**: all surfaces (`config/locales.json`, `messages/ro.json` `_meta`, `locales.test.ts`) now say `machine`; ADR-030 carries a dated correction note marking its three statements as the intended END state, post-review. 94/94 ro-related tests green after the reversal. | **Lesson for every future consistency fix: when two surfaces disagree, find the GROUND TRUTH, not the majority.** Two false surfaces outvoting one true one is how honesty drift compounds. The catalog `_meta` + registry row must only flip together, after the actual review. |
| F-59 | **Two more false claims on SERVED openapi paths** (same class as F-01's): `GET /regions/{id}/incidents` documents `data` as an array of `Incident` while the code returns `{regionId, incidents[]}` — and `Incident.id` is `format: uuid` while served ids are slugs; `GET /sources` documents an array of `SourceRecord` while the code returns `{regionId, sources:[{sourceId,mode,fetchedAt}]}`. Also: **no 429 documented anywhere** though every route is token-bucket limited with `Retry-After` (`http-dispatcher.ts:91-98`). | → MW-E/E1 docs truth-up (openapi is that lane's file by then). |
| F-60 | `makePgRegionReadModel` projects only `{id,name}`; `bbox` is already on the row (`mappers.ts:200-208`) and could be projected for free, but `iso`/`tz`/`languages` need columns or a config merge — and the pg `region.id` is a UUID, so a config-id join is not possible as-is. The openapi now states this honestly. | Optional improvement; NOT required for the demo profile. Roadmap or MW-E decision — do not silently upgrade. |
| F-63 | **B1.8's 12 accepted characterisation diffs are all citation/precedence-visible, none silent.** CA incident gains `nwps`/`usgs-water` citations (the `gauges` slot must be on the incident path or RO loses its `glofas` citation — CA pays the symmetric price honestly); `census` before `worldpop` is the old hardcoded "Census preferred for US" rule now living in config; RO incident gains `open-meteo` (enabled, cited, no weather fact to change); CA map gains `usgs-water`/`nws` as real fallback rungs; **RO map LOSES `meteoalarm-ro`** because no map layer renders news — citing it inflated the map's source list, and its items still reach the SitRep via the incident path. | Reviewable in one place; each is a deliberate, argued change rather than drift. |
| **F-64** 🟢 | **A latent MISLABEL found by the refactor and FIXED, not accepted**: `grounding.sourceId` becomes the SitRep's `GroundedFact.sourceId`, so when Open-Meteo was down and NWS supplied the wind reading, the fact would have carried the number from NWS while still **citing Open-Meteo**. `updateWeather` now re-attributes to whichever source actually served (unchanged when the primary serves; `citationId` retained — it is the citation's stable id, not a source). | Only visible because the fallback rung was exercised by a snapshot. A wrong citation on a right number is exactly the failure the provenance guarantee exists to prevent. |
| F-65 | **`config/adapters.json` has no `role` field** though ADR-031 §1 specifies one. `port` alone cannot separate a footprint hazard source from an advisory feed, so `HAZARD_FOOTPRINT_SOURCES` (`live-seed.ts:389`) still names 3 adapter ids (`firms`/`nifc`/`effis`). | Per-ADAPTER, not per-region, so zones stay code-free either way. A new HazardSource row defaults to EVENT (cited, never drawn) and fails the classification test. → add `role` in MW-E or when the next hazard source lands. |
| F-66 | **Two more grounding gaps of the same class as F-64, both PRE-EXISTING** (snapshots freeze current behaviour): (a) the crest fact is never enriched from the served FloodGauge slice (`enrichDerivation` handles weather but not crest) — RO's gauge is consulted and cited but its stage/crest never reaches the SitRep; (b) `exposedPopulation` is overridden by a served census/worldpop number while `grounding.exposure` still cites `firms`/`glofas`, even though `populationGrounding`/`populationEstimates` exist for exactly this and are never set by the live path. | (a) → MW-C (the crest/forecast wave owns it). (b) needs a decision on which citation the exposure claim carries → MW-D/D1 (predicted impact), which is already reworking exposure. **Do not claim polygon-grounded exposure citations before then.** |
| F-67 | `layerSources` key `fire` really means "hazard geometry layer" — a flood-footprint region would badge its hazard layer `fire`. | Cosmetic-but-misleading; renaming touches the map projection. → MW-E/E1. |
| **F-62** | **The C1.4 likelihood-word guard is English-surface-only, so it cannot police a TRANSLATED narration.** Deterministic fact claims stay English by design (Art. XII boundary, S03 delta limitation 3), but a narration may be translated (`NarrativeRequest.locale`, ADR-030) — so a Romanian narration inventing "foarte probabil" passes the guard. | Pinned by an explicit `KNOWN BLIND SPOT` test in `output-validator.test.ts` so the gap is executable, not prose. Options for MW-E: (a) state it in the SPEC known-limitations ledger — cheapest and honest; (b) add per-locale likelihood surfaces from the catalogs (the classes ARE closed vocabulary, so this is tractable); (c) validate the narration BEFORE translation. **Do not claim the guard is language-agnostic.** |
| F-61 | The four new C1.1 domain fields (`Gauge.exceedanceProbability/tendency`, `Prediction.likelihoodClass/etaHours`) have **no DB columns** (`core-tables.ts:133-155`, `:215-240`). Nothing is lost today — no repository maps Gauge/Prediction rows — but any future persistence path would silently drop them. | Needs a drizzle migration when C2.x wires predictions into persistence; record in the C2.1 task. |

**Structural mechanisms chosen (ADR-034/035/036) — implement exactly these, they are the gate:**
- **Drill isolation**, three layers, none a runtime `if`: (1) drill artifacts carry `capStatus:'EXERCISE'` while
  `EmittableAlert` requires the `'ACTUAL'` literal (`ports/logistics.ts:41-44`) ⇒ `sink.emit(exercise)` fails
  `tsc` and `asEmittable` returns null at runtime (reuses the EXISTING HITL guard, no parallel one);
  (2) `src/main/build-drill.ts` never calls `makeBroadcastDeps`, plus a new dependency-cruiser rule
  `drill-never-reaches-a-live-channel`; (3) `tests/architecture/drill-isolation.test.ts` asserting
  module-graph unreachability of `channels/messaging/**` + a throwing-`fetch` spy.
- **No person-identifying field**, four layers: (A) an `AggregateOnly<T>` conditional type that resolves to
  an error type when `keyof T` meets `PERSON_IDENTIFYING_KEYS` (fails Gate 2); (B) a recursive walk of the
  `schemas/d6-*.schema.json` files (`additionalProperties:false`) against exact + substring denylists with a
  written-justification allowlist; (C) a runtime `Object.keys()` walk over maximal factory output (catches
  spreads/mappers); (D) a fail-closed guard inside `buildIncidentSummary` before serialization.
  **Recorded residual risk:** structure cannot stop a name typed into a free-text `callsign` — mitigated by a
  schema `pattern`/`maxLength`, accepted and documented.

**Exhaustive `Record<LayerId,…>` maps a new map layer must touch** (compile-enforced — missing one is a
type error, which is the safety net): `app/_lib/types.ts:15-29` `LAYER_IDS` · `map/palette.ts:9`
`COLOR_BY_GROUP` · `map/build-layers.ts:56` `LAYER_META` · `map/build-layers.ts:369` `LAYER_BUILDERS` ·
`app/_lib/map-data.ts:135` `presentLayers().populated` · `app/_lib/store.ts:9-14` `defaultLayers()`.
Plus two **not** compile-enforced: the DB CHECK constraints (`core-tables.ts:87`, `:112-117`) and
`cap-mapper.ts:92-105`'s geometry-type switch.

---

### 0h. Eighth finding batch (B3.3/B3.5 zone-shipping lane) — incl. a CORRECTED bbox

| # | Finding (verified) | Consequence |
|---|---|---|
| **F-68** 🔴 | **The `ph` bbox suggested by the B3.4 spike was WRONG and would have silently dropped territory.** `[116.93, 4.59, 126.60, 21.12]` **clipped all four extremes**: Balabac Great Reef fell ~4.7 km west, Saluag I. + Frances Reef fell south, Pusan Point ~0.5 km east, Mavulis ~0.2 km north. Shipped instead: **`[116.87, 4.40, 126.62, 21.14]`**, built from the four extreme points rounded OUTWARD to 2 dp and containment-checked against **EPSG:4683 (PRS92)** "Philippines — onshore and offshore". `es`/`gr` built and checked the same way vs OSM/Nominatim relations + EPSG:4258. | F-51's "confirm at implementation, not geodetically verified" earned its keep. **A bbox is never copied from a suggestion** — derive from extremes, round outward, verify containment against an independent authority. Two deliberate exclusions are written into the config `$comment`s so the limitation travels with the config: `ph` excludes the Kalayaan/Spratly claim (an operating envelope is not a territorial position; +280 km of contested ocean adds no coverage), `es` is mainland + Balearics only (the Canaries would imply ~2000 km of Atlantic coverage we do not have). |
| **F-69** | **`prediction-projection.ts:77` `FloodInundationInput.nfhl` is REQUIRED and named after a US-only regulatory dataset** (FEMA NFHL). A non-US flood zone cannot express "this region has no regulatory floodplain layer" in the type; the only honest escape is closing the `floods` gate — which is exactly what `ph` does (`map-seed.ts`: `floods: false`, so `projectFloodInundation` returns `null` before `nfhl` is read). Correct behaviour, wrong type. | **Make `nfhl` optional with an explicit "no regulatory layer" state**, or the next non-US flood zone will be tempted to pass *something* off as a floodplain. → MW-C (owns prediction) or MW-E. |
| **F-70** | **`agency-rss-adapter.ts:144` `if (region.iso === 'RO' && …)` is a residual region-specific branch INSIDE an adapter** — the one place "add a zone by config" is still incomplete. Adding a zone with its own NATIONAL news feeds would need code. B1.8's claim was about the composition root's dispatch, which is genuinely gone; this is a separate, smaller seam. | `es`/`gr`/`ph` receive the WORLDWIDE feed set, not national media — correct and honest (no wrong-region data) but thinner than `ro`, and stated in each zone's `$comment`. Generalise to `AGENCYRSS_FEEDS_<ISO>` when a zone needs national feeds. |
| **F-71** | **A second stale region-geography literal inside an adapter**: `wmo-swic-adapter.ts:60` `PH_REGION` carries the now-superseded bbox (F-06 class in miniature). It is **inert** — it only shapes the outward `fetchNews` Region and the coverage gate matches on `iso`, never bbox — and its own comment admits it is unverified. Same pattern at `agency-rss-adapter.ts:62` (`RO_REGION`). The TEST-side duplicate was removed (`wmo-swic-acl.test.ts` now reads the bbox from `config/regions.json`). | Delete the literals or read them from the registry. Left unfixed deliberately: the lane's purpose was to prove a zone needs no application code, and editing `src/` would have muddied that proof. → MW-E. |
| **F-72** | **E2E coverage gap — 5 shipped zones, only 2 tested in a browser.** `e2e/helpers.ts:27` `REGIONS` is a hand-authored two-entry map (`us-ca`, `ro`) that `golden-path`, `perf` and `layers-phase-d` all iterate; `:64` also hardcodes a two-region assumption (`target === 'us-ca' ? 'ro' : 'us-ca'`). So `es`/`gr`/`ph` have **no golden path, no TTTP measurement, no layer-toggle test** in a real browser. | **MW-E/E2 explicitly owns "demo + live-test scenarios … P(zones)" — it must pick this up.** Flagged because "5 shipped zones" is a claim the browser gates do not currently back. |
| **F-72** 🟡 **IN PROGRESS (observed 2026-07-31, E1 pass)** | A sibling lane is actively closing this in the same session: `e2e/helpers.ts` no longer hand-declares `REGIONS` — it now derives `SHIPPED_REGIONS`/`SHIPPED_REGION_IDS` from `config/regions.json` (`helpers.ts:14,55-59`), and a new `e2e/zones.spec.ts` asserts the served region registry, the COP selector, and a non-empty provenanced truth picture agree across all five zones. `capture-screenshots.spec.ts`, `golden-path.spec.ts`, `layers-phase-d.spec.ts`, `perf.spec.ts` are also mid-edit (presumably to consume the derived list). | **Not yet verified passing.** E1 (docs lane) is barred from running Playwright this session — a sibling lane owns the browser suite exclusively, and concurrent runs corrupt each other's results (see F-194). Do not mark F-72 closed in any doc until that lane reports its gate numbers. |
| F-73 | **MOCK-mode geography is not zone-meaningful**: with `DATA_SOURCE_COMPOSITION=adapters` + everything forced MOCK, global adapters serve their recorded (largely Californian/Romanian) fixtures for any zone. Labelled MOCK throughout and pre-existing (it equally affects the synthetic `pt` test zone). The OFFLINE default (`DATA_SOURCE_COMPOSITION=seed`) is correct per zone. | Do not demo a new zone in adapters+MOCK mode; demo it in `seed` mode. State in the MW-E limitations ledger. |
| F-74 | **No live verification of any new zone** — nothing was fetched for `es`/`gr`/`ph`; the MeteoAlarm GR/ES fixtures remain hand-authored recorded-style (B3.1's own caveat), and `ph` renders no prediction by design (F-69). | Belongs in the S08 live-test pass (scenarios with real keys), not in a claim now. |

### 0i. Ninth finding batch (C2.1 plural-predictions lane)

| # | Finding (verified) | Consequence |
|---|---|---|
| F-75 | **Two of the six "lockstep sites" named in the C2.1 brief are NOT data fields — they are the `LayerId` `'prediction'`.** `app/_components/map/palette.ts:26` (`LAYER_PALETTE`) and `build-layers.ts:119` (`LAYER_META`) are keyed on the closed layer vocabulary declared at `app/_lib/types.ts:27` (`LAYER_IDS`), which also keys the `layerSources` **wire** map, the persisted Zustand toggle state, `messages/*.json` `map.layers.prediction` in **14** catalogs, and the layer-toggle rows the visual baselines can see. | **Deliberately NOT renamed.** ADR-033 §3.1 asks for plural *data* fields, never a layer-id rename; renaming would have been a breaking closed-vocabulary change costing 14 catalogs plus a probable baseline regen for zero benefit. Only `build-layers.ts:578`'s **argument** (`d.prediction`→`d.predictions`) moved; the key stayed `prediction:`. The real sixth site is `app/_components/map/types.ts:160` (`MapData.predictions?`). |
| F-76 | **`buildPredictionLayers` and `predictionCaveat` had ZERO tests before C2.1** — `grep` across the repo found no test file referencing either, and `build-layers.test.ts` never built a `MapData` with a prediction. The prediction cone — the surface that carries the mandatory method/inputs/uncertainty label — was the one layer builder no test exercised. | Fixed: 4 new tests (single-cone byte-identity, N descriptors with distinct ids, per-cone caveat non-identity, registry routing). **Root cause is a gate gap: `vitest.config.ts:32` scopes coverage `include` to `src/**` only**, so any `app/**` module can ship untested and no floor notices. Raise at MW-E (either extend the include with its own measured floor, or state the limitation). |
| F-77 | **`ProjectedPrediction.geometry` is REQUIRED, so the map wire's `predictions[]` is "map-plottable predictions", not "all predictions".** `projectMap` skips a `Prediction` with no `geom` (`map-projection.ts` `projectPrediction` returns `undefined`, filtered by `present()`), which is exactly today's behaviour preserved. But ADR-033 §4.1/§4.2 give `ESCALATION`/`IMPACT_OVER_TIME` `geom: undefined` **by design**, while ADR-033 §5 says the COP Outlook panel reads `predictions[]` from `MapProjectionData`. Those two statements cannot both hold. | **Not pre-empted by C2.1** (its remit was a pure widening). C2.3 must either source the Outlook from the SitRep path — which SPEC-FINAL-VERSION-DELTA §5 already specifies (`GET /incidents/{id}/sitrep` → `predictions[]` + ranked `outlook[]`) — or make `ProjectedPrediction.geometry` optional and teach `buildPredictionLayers` to skip geometry-less entries. Decide it in C2.3, in ADR-033, before building the panel. |
| **F-79** 🟢 | **A REAL Art. XIII hole in the emission path, found by C2.4 and FIXED.** `makeAlertSink.emit` had **no runtime cap_status check at all** — the only guard was the compile-time `EmittableAlert` type — and `cap-mapper.ts:273` deliberately maps a non-ACTUAL alert to a perfectly valid `status: "Draft"` CAP document (correct per ADR-010: DRAFT alerts are CAP-shaped for preview). Its guard at `:302` fires only for ACTUAL-**without**-approver. So the header comment's claim that "a malformed document or an ACTUAL-without-approver never leaks" did **not** cover a DRAFT: a `as EmittableAlert` cast, a DB row narrowed at a boundary, or any JS caller would have had a DRAFT serialized to CAP, hash-chained into the audit log and recorded as a real emission. Proven by a test that overrode the compiler and got an emission back. | Fixed: `emit` now re-checks via `asEmittable` and returns a typed `CONFLICT`, fail-closed, before any serialization or audit append — emission is the one irreversible step, so it verifies rather than trusts. The structural type guarantee is unchanged and still primary; this is defense in depth behind it. **Lesson: "the type makes it impossible" is only true inside the type system** — every boundary that receives an alert from outside TS needs the runtime twin. |
| F-80 | **`schemas/threshold-rule.schema.json` (dead, F-33) is now MORE drifted, deliberately.** It was not extended with `FORECAST_GAUGE_CATEGORY`, so the dead file now disagrees with the domain enum on the target vocabulary as well as on everything F-33 already listed. The live mirrors that DO matter were all updated in lockstep (4 of them: `schemas/schema.sql`, `intel-tables.ts` `checkEnum`, `drizzle/0004_*.sql` + journal/snapshot, `openapi.yaml`). | Intentional, per the C2.4 brief and F-33. **MW-E/E1 must DELETE it, not repair it** — a schema no code loads cannot be trusted by a reader, and repairing it would create a second source of truth for the same enum. `drizzle-kit generate` emitted `IN ($1, $2, $3)` placeholders for the `sql`` ` CHECK body (same bug 0003 hit), so 0004 was hand-completed — **never ship a generated CHECK-constraint migration unread**. |
| F-81 | **The forecast DRAFT has no surface and no persistence.** `DraftAlertProposal.forecast` (lead time, expected crossing instant, vintage, likelihood evidence) exists only in memory: the `alert` table has no column for any of it (same class as F-61/F-78), no `feature-seed.ts` spec seeds a `FORECAST_GAUGE_CATEGORY` rule, and no UI reads `deriveDraftAlertProposals`. The feature is fully tested and fully unreachable from the running app. | Out of C2.4's file ownership (`feature-seed.ts`, panels). **MW-E/E2 blocker class — "a feature with no on-camera moment"**: either seed a forecast rule + surface the lead time in the verifier/alert panel, or drop the claim. If any lane persists the proposal, F-61's three-mirror rule (F-44) applies to the new columns. |
| F-78 | **C2.1 touches no persistence path**, so **F-61 remains OPEN**: `Gauge.exceedanceProbability/tendency` and `Prediction.likelihoodClass/etaHours` still have no DB columns, and no repository maps a `Prediction` row. `MapSource`/`MapProjection` are read-model/wire types only; the map seed is in-memory (`memory-map.ts` derives per read). | No drizzle migration was written or needed. F-61 must be closed by whichever lane FIRST persists a prediction — three mirrors per F-44 (`core-tables.ts`, `schemas/schema.sql`, an additive `drizzle/000N_*.sql` + journal/snapshot). |

### 0j. Tenth finding batch (C2.2 trend-derived prediction kinds lane)

| # | Finding (verified) | Consequence |
|---|---|---|
| **F-82** 🟢 | **A FALSE CLAIM in the shipped seed, found and FIXED (comment only).** `scenario-inputs.ts:419` asserted "Rising gauge-stage history ⇒ classifyTrend COMPUTES **ESCALATING** (the flood is building)" for `PH_TREND_READINGS`. Executed against the real classifier the series yields **slope +0.25 m/h vs a 0.5 dead-band ⇒ STEADY**. (Verified for all five zones: CA +55 ESCALATING, ES +40 ESCALATING, GR +62.5 ESCALATING, RO 0 STEADY, PH +0.25 **STEADY**.) | The **data was left untouched** — a 0.5 m rise over two hours genuinely is inside the classifier's noise band, and editing the readings to make the prose true would be inventing a trend. The comment now states the verified result, the slope, and the downstream consequence. **Lesson: a comment asserting a computed outcome is an untested claim** — this one shipped wrong through six waves because no test asserted `ph`'s trend. |
| F-83 | **The two new kinds ship with a GENERIC signal label, because `src/main/seed.ts` is outside this lane's file ownership.** `IncidentDerivationInput.trendSignalLabel` (new, optional) is never set by any of the five zones, so every constructed `ESCALATION`/`IMPACT_OVER_TIME` labels its slope `'hazard trend signal (units as published by the source)'` instead of the units the scenario constants already know (`burned area (acres)` for CA/ES/GR, `gauge stage (m)` for RO/PH). No `sourceId` is attached either, for the same reason. | Honest but weaker than it needs to be: a slope's unit is available and unstated. **One line per zone in `seed.ts`** (`trendSignalLabel: …`) closes it — whoever owns `seed.ts` next, or MW-E/E1. Nothing is wrong, only under-labelled. |
| F-84 | **The C1 likelihood seam on both kinds has no seeded signal to read.** `EscalationInput.forecast` / `ImpactOverTimeInput.forecast` take a `ForecastLikelihoodInput` and are fully wired to `deriveForecastLikelihood`/`hazardArrival` (tested both ways), but **no seeded `Gauge` carries `exceedanceProbability`** — C1.1 taught the GloFAS ACL to map it, while `RO_GAUGE` (`scenario-inputs.ts:223`) and `PH_GAUGE` (`:413`) still set only `floodCategory`/`stage`. So every prediction the running app constructs ships **without** a `likelihoodClass`. | Correct behaviour (no source signal ⇒ no class — FUW-3), but it means **C2.3's Outlook comparator will rank every seeded item at its `POSSIBLE` default** and the class/ETA columns will be empty in an offline demo. Same "no on-camera moment" class as F-81. Fix is either a live GloFAS fetch or a MOCK-labelled `exceedanceProbability` on the seeded gauges — a seed-data decision, deliberately not taken here. |
| F-85 | **ADR-033 §4.2 is dimensionally under-specified and the implementation had to resolve it.** It says the count is "projected along the least-squares trend slope", but that slope is in SIGNAL units/hour (acres/h, metres/h) while the count is people/nodes — multiplying one by the other produces a figure whose unit does not exist. **Resolved by projecting along the signal's own RELATIVE rate** (`slopePerHour ÷ latest signal level`, a dimensionless per-hour rate), refusing to project at all when the latest level is ≤ 0. The ADR's `method` string is still quoted **verbatim** so the label cannot drift from the spec; the actual arithmetic and its caveat live in `inputs.projection`/`inputs.caveat`. | **ADR-033 is C2.3-owned, so §4.2 was NOT amended** — it needs one sentence recording the relative-rate resolution, or the next reader will re-derive the same problem. Raise with C2.3 or at MW-E/E1. |

### 0k. Eleventh finding batch (C2.3 ranked-Outlook lane)

| # | Finding (verified) | Consequence |
|---|---|---|
| **F-90** 🟢 | **ADR-033 §5's comparator sketch types the tiebreak as a REQUIRED `severity`, but no `Prediction` has ever carried one** (`src/domain/prediction.ts` — `kind`/`method`/`inputs`/`uncertainty`/`geom`/`horizon`/`likelihoodClass`/`etaHours`/`sourceId`, no severity field). Implementing it as written would have forced every caller to manufacture a severity purely to satisfy a tiebreak. | Shipped as **optional**, supplied only by a caller holding a **source-stated** severity (`rankOutlook`'s `severityByPredictionId`), and an absent severity ranks **below `MINOR`** so an unstated severity can never outrank a stated one. Recorded in the dated ADR-033 §5 addendum, not silently reinterpreted. |
| **F-91** 🟢 | **ADR-033 §5's comparator sketch is not a total order.** After defaulting an absent ETA to `+Infinity` it returns `etaA - etaB`, which is **±Infinity** whenever exactly one row states a lead time (the common case) and **NaN** for two non-finite ETAs — and a comparator that can return `NaN` lets `Array.prototype.sort` emit *any* permutation, silently corrupting the whole ranking rather than misplacing one row. | Shipped comparator normalises every non-finite ETA to `+Infinity` and **compares instead of subtracting** (`-1`/`1`). The ORDER is exactly §5's; only the arithmetic is closed. Laws (reflexivity · antisymmetry · transitivity · transitivity-of-equality · sort stability · monotone sort · idempotence) asserted **exhaustively over the comparator's entire declared input space** (140 rows, 19 600 pairs, 46 656 triples) plus a seeded-LCG 500-row sample in `src/application/outlook/outlook.test.ts`. `fast-check` is not a devDependency and none was added. |
| **F-92** 🟢 | **F-77 CLOSED per the orchestrator ruling.** The Outlook is sourced from the **SitRep path** (`GET /incidents/{id}/sitrep` → `outlook[]`), which SPEC-FINAL-VERSION-DELTA §5 already specified. `ProjectedPrediction.geometry` was deliberately **NOT** made optional — a projected map prediction without a shape is meaningless, and weakening a correct contract to work around a doc error would push the error into the type system. ADR-033 §5's "reads `predictions[]` from the plural `MapProjectionData`" is corrected by a dated addendum (original text retained verbatim). | Proven end-to-end rather than argued: the served `us-ca` SitRep's `outlook[]` contains **`ESCALATION` + `IMPACT_OVER_TIME` only** — precisely the two kinds `projectMap` drops for having no geometry. A map-sourced panel would have rendered an EMPTY Outlook while the engine had rows. Pinned by a test over real handler output (`sitrep-panel.test.tsx`). |
| **F-93** | **F-66(a) is NOT fixed and cannot be, inside this lane's file ownership.** Verified precisely: the `gauges` slot IS consulted and cited on the incident path (`live-seed.ts:346` `SLOT_PATHS.gauges.incident = true`), but `IncidentFetch` (`live-seed.ts:511-516`) never picks the slice up and `enrichDerivation` (`:531-543`) has no crest branch — so RO's served stage/crest never reaches the SitRep, exactly as F-66 states. It is a **three-file** change, all outside C2.3: (1) `live-seed.ts` — add `gauge: firstServing(slotSlices(c,'gauges'))` to `IncidentFetch` and an `updateCrest(d.crest, f.gauge)` mirroring `updateWeather` (`:154-165`), **re-attributing `grounding.sourceId` to the adapter that actually served the reading (F-64 — a wrong citation on a right number is a provenance failure)**; (2) `derive-cop.ts:315-318` — `CrestFactInput.input` carries only `{returnPeriodLabel, floodCategory}`, so a served **stage/crest value has nowhere to go**; it needs a `stage?`/`crestForecast?` field plus the matching sentence in `crestFact` (`:464-471`); (3) whichever seed owns the RO grounding. | **MW-E, or whichever lane next owns `live-seed.ts` + `derive-cop.ts`.** Bonus once wired: a served gauge also carries `exceedanceProbability` (C1.1), which is the missing likelihood signal F-84 describes — the same three-file change would light up the Outlook's class/ETA columns from real data. |
| **F-94** | **The Outlook section measurably changes FIVE visual baselines, so it ships DISPLAY-GATED OFF.** Verified by RUNNING (F-47), not by reasoning: with the section rendered, `cop.png` grows **1644 px → 1836 px** and 4 × `cop.png` + `cop-rtl.png` fail (`5 failed / 73 passed`); with it suppressed, the same run is **green**, which also proves the delta is C2.3's alone and that no other MW-C lane moved a baseline. | The panel is gated by `NEXT_PUBLIC_FEATURE_OUTLOOK_PANEL` (default OFF), same seam as `NEXT_PUBLIC_FEATURE_CITIZEN_STREAM` and the same "ship inert, cost nothing" precedent as the storm layer — **the last regeneration unit is unspent and remains the orchestrator's to spend**. The DATA is not gated: `outlook[]` is served, tested and openapi-documented unconditionally. Turning it on = the env var + one baseline regeneration, no code change. The flag-ON render was verified in a real browser (axe WCAG 2.2 AA + golden path, desktop-dark, both green). |
| **F-95** | **The output-validator needed NO extension, for a structural reason.** `SitRep.outlook` is built by `rankOutlook` inside `synthesizeSitRep` and travels STRUCTURALLY to the wire; the narrator's payload is built by `toCitedFacts` from the grounded `facts` alone, so no outlook row is ever handed to a model (asserted by a test that stringifies the actual `ComplianceRequest` payload and greps it). The existing `usesOnlyCitedNumbers` + `usesOnlyCitedLikelihoodClasses` already reject a narration asserting a number or likelihood WORD absent from the cited facts — the only direction a model can reach an Outlook claim from. | No change to `output-validator.ts`. **F-62 is unchanged and must not be claimed closed**: that guard is English-surface-only and cannot police a translated narration. **If a later lane ever mints a GroundedFact from an outlook row** (e.g. "Outlook: VERY_LIKELY escalation in 8 h"), the guard covers it automatically — but only in English. |
| **F-96** | **The served `uncertainty` carries float noise**: `us-ca`'s `ESCALATION` row reaches the wire as `0.7000000000000001` (compounding arithmetic in `trend-projection.ts`, C2.2's file). The UI is unaffected (ICU `{value, number}` renders `0.7`), but a JSON/interop consumer of `GET /incidents/{id}/sitrep` sees the artifact, and `uncertainty` is a **labelled figure** (Art. XIV), so it reads as false precision. | Not fixed — outside C2.3's file ownership. One `Math.round(x * 100) / 100` at the point the uncertainty is composed closes it. MW-E or the next lane in `prediction-projection/**`. |
| **F-97** | **SPEC-FINAL-VERSION-DELTA §5 says `GET /incidents/{id}/sitrep` returns "`predictions[]` **+** ranked `outlook[]`"; only `outlook[]` shipped.** Each outlook row carries the prediction's identity, kind, method, uncertainty, class and ETA, so no information is withheld — but emitting the same predictions twice on one response, once unordered, would invite a client to sort them a second way and become a competing ranking (exactly the failure mode ADR-033 §5's "shared verbatim so they cannot disagree" exists to prevent). | Read the SPEC row as satisfied by `outlook[]` (the ranked projection of `predictions[]`), or amend it at MW-E. `openapi.yaml`'s `Sitrep` schema now requires `outlook` and documents every row field; the singular/plural mirror trick C2.1 used for the map wire was **not** needed here because the SitRep never had a prediction field to keep compatible (F-17). |
| **F-98** | **ADR-033 §4.2's dimensional gap (F-85) is now recorded in the ADR**, as C2.2 asked: the addendum states that the count is projected along the signal's **relative** rate (`slopePerHour ÷ latest level`, dimensionless per-hour), because the raw slope is in signal units/hour while the count is people/nodes. | Closes the doc half of F-85. The implementation half already shipped in C2.2. |

### 0l. Ninth finding batch (final polish pass, 2026-07-28)

| # | Finding (verified) | Consequence |
|---|---|---|
| **F-98** | **Coordinate vertices carry the same class of float residue** as F-96 did — e.g. `45.400000000000006`, `45.510000000000005` in `src/main/__snapshots__/live-seed.test.ts.snap`, from bbox arithmetic. | **Deliberately NOT fixed, and the reasoning matters**: a coordinate is a *computed geometry vertex*, not a labelled approximate figure, so it does not make a false precision CLAIM the way an `uncertainty` label does. More importantly, rounding vertices would change geometry — and this codebase decides exposure by polygon intersection, so a rounded vertex can flip an intersection result and silently change who is counted as at-risk. That is a strictly worse defect than cosmetic residue. If ever addressed, it must be at the SERIALIZATION boundary only, never in the geometry itself, and with the intersection tests as the guard. → MW-E to decide; do not "tidy" it casually. |

### 0m. Tenth finding batch (D6.0 lane — F-24 fix + the no-person-identifying-field guard)

| # | Finding (verified) | Consequence |
|---|---|---|
| **F-140** 🔴 | **A SECOND, more severe live defect sits directly downstream of F-24, and F-24's vocabulary fix alone does NOT repair it.** The tasking control's real HTTP path is broken end-to-end: (a) `app/_lib/api.ts:250-255` `taskResource` POSTs `TaskResourceBody` (`app/_lib/types.ts:278-283`, field name **`transition`**) verbatim as the JSON body, but `parseResourceTask` (`src/adapters/channels/http/routes/feature-router.ts:214-234`) reads `b.status` — **the client never sends a `status` key at all**, so every real tasking request from the browser silently creates a fresh task at the default `PROPOSED` state (or 400s — see (b)) regardless of what the operator selected in the `<select>`. Proven by contrast: `src/adapters/channels/http/feature-router.integration.test.ts:100-126` (the real HTTP-boundary test) posts `status: 'ENROUTE'` — the CORRECT field name — while the actual browser client (`app/_lib/api.ts`) never does. (b) `TaskControl` (`app/_components/panels/logistics-board.tsx`) never threads `incidentId` into the mutation (`task.mutate({ resourceId, transition })`, no `incidentId`) even though `LogisticsBoard` already receives one as a prop — and the server's `parseResourceTask` treats a missing `incidentId` as `parseFail('incidentId required')`. So in the current composition, a real click on "Task" in a running browser either creates a stray `PROPOSED` task with a fresh id every time (if `incidentId` were supplied) or 400s outright (as shipped, since it never is). **No test anywhere catches this**: `logistics-board.test.tsx` mocks `useTaskResource` (never exercises `api.ts`/the real fetch body), the HTTP-boundary integration test always constructs its body by hand with the correct `status` key, and no e2e/Playwright spec exercises the tasking flow through a real browser (`grep` for `resource-tasks`/`taskResource` across `e2e/*.ts` returns nothing). | **Out of D6.0's file ownership** — `app/_lib/api.ts`, `app/_lib/hooks.ts`, `app/_lib/types.ts` are unowned by any D-lane's explicit list but are also not in D6.0's "you own" set, and `src/adapters/channels/http/routes/feature-router.ts` is explicitly D3-owned (`src/adapters/channels/**`) — reported, not fixed, per the file-ownership rule. **D6.0 DID fix the vocabulary half** (F-24: the `<select>` now posts the correct domain token `TASKED`/`ENROUTE`/`ONSCENE`/etc.), which is a NECESSARY precondition for (a)'s eventual fix to do anything useful — but the wire-field-name mismatch (a) and the missing `incidentId` (b) must both also be fixed, in `app/_lib/{api,hooks,types}.ts` + `LogisticsBoard`→`TaskControl` prop threading, before "taskable via the existing board" (ADR-035 §4 FR-D6-1's own precondition) is actually true end-to-end. → whichever lane next owns `app/_lib/**`, or MW-E. Add an e2e/integration test that posts through the REAL `api.taskResource` (not a mocked hook) to a real handler, so this class of defect cannot ship silently again. **ROOT CAUSE (verified independently by the orchestrator, 2026-07-30, and it dictates the fix shape):** the reason `tsc --noEmit` is at 0 errors despite an end-to-end-broken call is that `TaskResourceBody` (`app/_lib/types.ts:278-283`) is a HAND-AUTHORED CLIENT-SIDE DUPLICATE of the server contract, and it is duplicated *wrongly in both fields at once* — it declares `transition: string` (a free `string`, NOT the `ResourceTaskStatus` union, so no token is ever checked) and `incidentId?: string` (**optional**, while `parseResourceTask` hard-fails without it). A correct-but-duplicated type would still have drifted; a *derived* one could not have. So the fix is NOT merely renaming `transition`→`status` and threading `incidentId` — that repairs this instance and leaves the generator intact. The fix is to DERIVE the wire type from the server's parse contract (the same move D6.0 made for F-24: `const TRANSITIONS = RESOURCE_TASK_STATUSES` instead of re-declaring), so the client cannot name a field the server does not read, and cannot make required-server-side optional-client-side. This is the SAME root-cause class as F-24 — a re-declared contract instead of a derived one — which is now three occurrences (F-24, F-140, F-141's twin denylists) and should be treated as a systemic finding at the MW-E convergence review, not three unrelated bugs. |
| F-141 | **A second, independently-built person-identifying-key denylist already exists in the codebase**, for a DIFFERENT boundary: `src/domain/governance.ts:79-118` (`PERSON_IDENTIFYING_KEYS` + `findPersonIdentifyingKey`) guards `LedgerEntry` (the D4 governance/hash-chained ledger, ADR-034 §5/§6) with an exact-normalized-key-only match (no substring net, no schema walk, no `AggregateOnly<T>` type, no allowlist). D6.0's guard (`src/domain/shared/aggregate-only.ts`) is the ADR-035 §4 mechanism for a DIFFERENT boundary — the five D6 aggregate entities/exports — and additionally carries a substring net + schema-level (Layer B) + export-time (Layer D) enforcement `src/domain/governance.ts` does not have. Not a collision (different files, different exported names, different guarded boundary) and not fixed here — `src/domain/governance.ts` is D4's file (`src/application/ledger/**`'s domain counterpart), out of D6.0's ownership. | Two denylists guarding two boundaries is defensible short-term (LedgerEntry and D6 aggregate exports are genuinely different payloads with different lifecycles), but they WILL drift apart (e.g. `src/domain/governance.ts`'s list may not track a future extension to `PERSON_IDENTIFYING_KEYS` in `aggregate-only.ts`, or vice versa). → MW-E convergence review: either unify on one shared denylist module (`src/domain/shared/aggregate-only.ts`'s `PERSON_IDENTIFYING_KEYS`/`isPersonIdentifyingKey`, since it is the more complete of the two — exact + substring + allowlist) with `governance.ts` importing from it, or explicitly document why the ledger boundary needs a narrower/different rule (e.g. its exact-only matching is deliberately less aggressive because ledger `target` strings are structured ids, not free-form aggregate data). Do not silently let both keep evolving independently. |
| F-142 | **`schemas/d6-*.schema.json` currently has exactly ONE file** (`d6-volunteer-team.schema.json`, D6.0's own guard fixture, scoped to FR-D6-1's new fields only) of the five `SPEC-FINAL-VERSION-DELTA.md` §2 anticipates ("the five D6 aggregate entities"). D6.0's brief is explicitly to build the GUARD MECHANISM, not the five D6 modules (FR-D6-1…FR-D6-5, ADR-035 §4) — so `d6-supplies`, `d6-reunification-link`, `d6-incident-summary`, `d6-casualty-tally` schemas do not exist yet, by design, and Layer B's recursive walk (`tests/architecture/d6-no-pii.test.ts`) will automatically pick each one up (zero code change to the guard) the moment its owning lane adds a `schemas/d6-*.schema.json` file — proven by the plant/fail/revert cycle run against the one real file that does exist. | Whichever lane builds FR-D6-2…FR-D6-5 must (a) add its own `schemas/d6-*.schema.json` with `additionalProperties:false`, (b) add the `AggregateOnly<T>` compile-time assertion for its DTO (`src/domain/shared/aggregate-only.ts`), (c) exercise Layer C's runtime walk over its factory's maximal output, and (d) call `guardAggregateOnly` (`src/application/privacy/incident-summary-guard.ts`) at its own export boundary if it has one — none of which requires touching the guard itself. |
| F-143 | **`buildIncidentSummary` (FR-D6-4) does not exist yet** — confirmed by a repo-wide grep (`grep -rln buildIncidentSummary src app` → no hits). Per this task's explicit instruction, D6.0 did NOT stub a fake `buildIncidentSummary`; instead Layer D shipped as the standalone, fully-tested `guardAggregateOnly` (`src/application/privacy/incident-summary-guard.ts`, 6 tests, 100% coverage) that awaits its call site. | Whoever builds `buildIncidentSummary` (D6-4) must call `guardAggregateOnly(payload)` immediately before returning/serializing and propagate the error branch rather than the payload — exactly the pattern `src/adapters/alerting/alert-sink.ts:121` already uses for `asEmittable` immediately before `alertToCap`. |
| **F-140** ✅ **CLOSED 2026-07-31** | Fixed at the ROOT, not the symptom. `TaskResourceBody` is no longer hand-authored: `app/_lib/types.ts` now type-only re-exports `ResourceTaskWireBody`, defined next to `parseResourceTask` in `feature-router.ts` and derived by **indexed-access types** from `ResourceTaskRequest` (the type `handleResourceTask` actually consumes). `parseResourceTask`'s raw-JSON reads go through a `wireField<K extends keyof ResourceTaskWireBody>()` helper, so a rename anywhere in the chain is a **compile error, not a runtime 400**. `incidentId` threaded `LogisticsBoard`→`TaskControl`; Task button now disabled when no incident is selected instead of firing a request that can only fail. | **Both halves of the guard were plant/fail/reverted empirically.** Runtime: sending the pre-fix shape produced `ApiError: incidentId required`. Compile-time: restoring the old hand-duplicated interface produced `TS2353/TS2339: 'status' does not exist on type 'TaskResourceBody'` at `logistics-board.tsx(132,43)` and `hooks.ts(229,53)`. New guard test `app/_lib/api.task-resource.e2e.test.ts` drives the REAL unmocked `api.taskResource` through an injected `fetchImpl` into the REAL `handleHttp` dispatcher — no hand-built server body, no mocked hook, which is the only test shape that can catch this defect class. |
| F-190 ✅ CLOSED | `ResourceTaskResult` declared a flat `{id, status}` but the server nests it under `task` (`success(201, {task: res.value})` in `logistics.ts`). Found while writing the F-140 guard test. Fixed in `app/_lib/types.ts`; grep-confirmed it was never destructured elsewhere, so zero blast radius. | Another instance of the same systemic root cause: a hand-authored client mirror of a server shape. |
| **F-191** 🔴 | **Even after F-140, the default real-world click on "Task" still fails.** The wire type carries no task `id` (server mints one), and the domain requires a brand-new task to start at `PROPOSED` (`memory-logistics.ts` `createTask`), but the board's `<select>` defaults to `TASKED` → `STATE_CONFLICT: a new resource task must start at PROPOSED, got TASKED`. This is now an **honest, labelled failure** surfaced by the existing `task-error` UI rather than the prior silent-wrong-success/400 — a real improvement — but the control still does not work for its default selection. Captured as a live assertion in the F-140 guard test. | NOTE `parseResourceTask` DOES accept `optStr(b.id) ?? newId('task')`, so the server can already advance an EXISTING task by id — the wire type simply omits `id`, which is why every POST creates instead of advances. Fix needs a product call: surface existing tasks and advance them by id (creation legally starts at `PROPOSED`), or allow direct-to-status creation in the domain. |
| **F-143** ✅ **CLOSED 2026-07-31** | `buildIncidentSummary` now exists (`src/application/aggregate/incident-summary.ts`) and calls `guardAggregateOnly(payload)` over the CONSTRUCTED document immediately before returning, propagating the error branch and **never the payload beside it** — orchestrator-verified by reading the code, not by lane report. `AggregateOnly<T>` is the factory's actual RETURN type across all five modules (load-bearing), not a decorative `const _check`. | The guard is genuinely reachable: `casualtyTally` is re-emitted **by reference**, so a cast, a DB row, or a JS caller that never passed the typed factory is exactly what Layer D catches. Field-picking there would have made the guard unreachable — a deliberate design choice worth preserving if this module is ever refactored. |
| **F-175** ✅ **CLOSED 2026-07-31 (orchestrator, plant/fail/revert verified)** | **Layer B's schema walker deliberately does NOT resolve `$ref`, which made `$ref` a silent hole rather than a bug.** A future author reaching for the obvious refactor — replacing the inlined casualty tally in `d6-incident-summary.schema.json` with a `$ref` — would have moved those property names OUT of the walk entirely. **Nothing would have failed. Layer B would have gone on reporting `[]` while the PII door stood open.** | Closed by asserting the ban rather than leaving it as a comment nobody reads at the moment they need it: `tests/architecture/d6-modules-aggregate-only.test.ts` now has *'contain NO $ref anywhere — Layer B does not resolve refs, so a ref is a silent hole in the walk'*. **Proven by planting a `$ref` into the real on-disk schema** → `AssertionError: d6-incident-summary.schema.json must not use $ref — see F-175` → reverted → 29/29 green again. The test comment states the escape hatch in the ONLY safe order: if `$ref` is ever genuinely needed, teach the WALKER to resolve it FIRST, then delete the test — never the reverse. |
| **F-170** ✅ **RESOLVED BY THE ENTRANT 2026-07-31 — default `on`** | The entrant's call: these five are the demonstrable coordination surfaces of a contest entry, and a capability nobody can see scores nothing. **Flipped on ALL surfaces TOGETHER** (the F-58 pairing rule): `src/config/index.ts` defaults, `.env.example` values + rationale block, the five `CONFIGURATION.md` rows, the pinned `d6-flags.test.ts` assertion, and a dated Resolution note appended to ADR-035 (appended, never rewritten). **Why defensible rather than merely convenient:** the Art. XIV argument for `off` is answered STRUCTURALLY, not waived — a D6 entity cannot carry a person-identifying field at four independent layers, each proven by planting a violation. **A flag default cannot leak what the type system cannot express.** Had the guarantee been a runtime filter rather than a structural one, `off` would have remained correct. | **V13 is unaffected and still binding** — and is now asserted EXPLICITLY rather than implied by the default: a new test sets all five to `off` and requires `enabledD6Flags` to be empty. The default moved; the off state did not. **Accepted open risk:** `FEATURE_D6_REUNIFICATION_LINKS` on means the link-out ships with F-177's two unverified URLs; the entrant verifies by hand before submission, and the module degrades-and-labels rather than dead-ending. Recorded in the open, in code, in `.env.example` and in the ADR. |
| **F-31** ✅ **CLOSED 2026-07-31 (orchestrator-verified end-to-end)** | Inbound EDXL-RM is now schema-validated **before** mapping: `parseInboundEdxlRm(raw: unknown)` validates against `schemas/edxl-rm.schema.json`, and `edxlRmToResourceTask` calls it as its **FIRST statement** (`src/adapters/interop/edxl-rm-mapper.ts:268`). **I checked the obvious hole and it does not exist:** `feature-router.ts:388` still casts `b as unknown as EdxlRmMessage`, but that cast is a type-level lie only — every runtime path to mapping goes through the mapper, so the gate holds. Placing it in the MAPPER rather than the ROUTE was the right call, and the lane's reasoning is worth preserving: **"a step a caller can forget is a filter, not a gate."** | Proven by planting: removing the two validation lines made all 4 malformed EDXL-RM documents map successfully (`expected true to be false` ×4) — which is also the empirical proof they were being accepted before the fix. **F-156 is the honest consequence:** this is a BEHAVIOUR CHANGE at the ingest boundary — a lenient partner sending a non-standard member, a bad `sentDateTime` or no `originatingMessageID` is now rejected with `PARSE_ERROR`. ADR-036 predicted it. It belongs in the SPEC "Known limitations" + changelog at MW-E. Cosmetic cleanup for MW-E: the route's raw cast should become a call to the parse function so the type no longer lies. |
| **F-150** 🔴 **MY BRIEFING ERROR, caught and corrected by the lane** | I wrote the D5 brief calling FR-D4-5 an *"EMS / casualty-transport overlay"*. **That is wrong.** The requirement of record (FEV-24, ADR-036 §7) is the **Copernicus Emergency *Management* Service** damage overlay — there is no patient or transport concept in it anywhere. The lane built FEV-24 as specified and **refused my framing rather than implementing it**, which is exactly right. Had it complied, we would have shipped a casualty-transport surface nobody asked for, duplicating FR-D6-5's aggregate tally and re-creating F-141 (two implementations of one concept). | Both `ems-overlay.ts` and `src/domain/damage-overlay.ts` carry a header warning so the misreading cannot recur. **Lesson for the orchestrator, not the lane: an expanded acronym is not a definition.** Verify a requirement against its record before putting it in a brief — a confidently-worded wrong instruction is more dangerous than a vague one, because it sounds authoritative. |
| F-151 | ADR-036 §7 wants `category: 'SOS'\|'DAMAGE'\|'NEED'` **on `PublicReport`** (+ DB CHECK); `src/domain/public-report.ts` was outside D5's write set, so the category currently lives on the new `DamageAssessmentEntry` view. | Designed for zero rework: when the field lands, `damageEntryFromReport` reads it instead of taking it as an argument. Pairs with F-174 (the casualty tally also needs this field). |
| F-152 | **Nothing composes the D5 modules yet** — no `src/main` wiring, no panel, no route, and they are deliberately absent from `src/application/index.ts`. So the flags being `off` is **not** what makes them inert; nothing imports them at all. | Asserted by a test, so the statement cannot quietly rot into a false claim. Same shape as F-53's two-wave-long "no production caller" — this project has been bitten by exactly this before. |
| F-153 | The "absolute https URL to a named host" rule exists **six times, all private**: `camera-feed.ts`, `public-report.ts`, and four camera ACLs. D5 added the first *exported* home (`src/domain/shared/link-policy.ts`) and used it. | Converging the other five is one import each — MW-E. Another instance of the systemic derive-don't-redeclare theme (now the dominant finding of this wave). |
| **F-154** 🟡 | **F-35's larger half is still open: there is no shelter source adapter.** D5 delivered the board, the RFC-4180 CSV export precedent and the provenance labelling — the FEMA Open-Shelters adapter itself is `src/adapters/sources/**` work and was never in scope. | Until it exists, the shelter board's `MOCK` provenance is honest but the feature is fixture-fed. Decide at MW-E whether the adapter ships or the limitation is documented in NFR-F10's Known-limitations section. |
| F-155 | **DUPLICATE of F-193** (independently found by D5 from the other side): spec-delta §6 tabulates `FEATURE_D4_*` as default `on`; D5 shipped `off` per its brief and the D6 precedent. | Two lanes finding the same drift independently is a good signal the register is working. Resolve once, at MW-E, together with F-193 — and **not by pattern-matching D6's justification** onto the D4 modules. |
| **F-157** 🟡 **possible non-determinism** | `app/_lib/api.task-resource.e2e.test.ts` failed **3 tests in the full suite but only 1 in isolation** during D5's run. A failure count that changes with run context is the signature of **cross-test shared state**, not of a real assertion failure. The owning lane has since made the suite green. | **Green is not the same as deterministic.** Flagged to the owning lane while it was still running. This project's rule is fixed clock `2026-07-05T22:00:00Z`, no wall-clock dependence, no live network, **and no order-dependence**. This file is the guard for a defect class (F-140/F-191/F-192) no other test shape can catch, so its integrity matters more than most. |
| **F-193 / F-155** ✅ **RESOLVED BY THE ENTRANT 2026-07-31 — default `on`** | Flipped on all surfaces together (F-58 pairing rule): `src/config/index.ts`, `DEFAULT_COORDINATION_FLAGS` in `coordination-flags.ts`, `.env.example`, five `CONFIGURATION.md` rows, the pinned test, and a dated Resolution note appended to `ADR-036-response-coordination-tier.md`. **Checked on these modules' OWN merits, explicitly NOT inherited from D6:** FR-D4-4 damage reports ride the consent→triage path and carry `AggregateOnly` with `triageStatus` `Pick`ed from the report (one bucket per triage state, **no grand total**, so a VERIFIED/UNVERIFIED-mixing figure is not expressible); FR-D4-3 shelter status is additionally guarded at the CSV **export** boundary; FR-D4-5 carries `AggregateOnly<DamageOverlayProduct>` and models no geometry (F-48); FR-D4-1/2 project news facts and `ResourceTask` rows and carry no person data at all. | **Three gating tests broke on the flip — and they were right to.** They had been using `DEFAULT_COORDINATION_FLAGS` as their "all off" baseline, i.e. borrowing whatever the shipped default happened to be instead of CONSTRUCTING the state under test. Fixed by introducing an explicit `ALL_OFF` fixture, so gating is pinned independently of the default. **This is a reusable lesson: a test that leans on a default's VALUE silently changes meaning when the default changes.** V17/NFR-F5 unaffected and now asserted explicitly. Note F-152: nothing composes these modules yet, so the new default is currently INERT — re-read at seam time. |
| ~~**F-193** (original finding, retained for the record)~~ | `docs/SPEC-FINAL-VERSION-DELTA.md:130` states the five **`FEATURE_D4_*`** flags (rumor · mutual-aid · shelter-status · damage-reports · EMS-overlay) default **`on`**; they currently ship **`off`**. This is the same document-vs-implementation disagreement as F-170, one line above it in the very same table, and it was NOT resolved at the same time **only because the owning lane (D5) held those files while it was still running.** | Apply the F-170 decision to the D4 tier once D5 lands — **but only after confirming the same structural argument holds for them.** D6's default flip was justified by a four-layer guarantee that a D6 entity cannot carry a person-identifying field; the D4 modules (notably damage reports, which ride the consent→triage path, and the EMS overlay) must be checked on their own merits rather than inheriting D6's justification by analogy. **Do not flip these by pattern-matching.** |
| ~~**F-170** (original finding, retained for the record)~~ | **Two documents disagree on a security-relevant default.** `docs/SPEC-FINAL-VERSION-DELTA.md:131` states the five `FEATURE_D6_*` flags default **`on`**; ADR-035 §4/V13 requires **`off`**. The D6 lane shipped `off` (the safe reading). One of the two documents is wrong. | Resolve at MW-E — and resolve it by finding GROUND TRUTH, not by majority. This project has been bitten before by two aspirational surfaces outvoting one true one (F-58, the Romanian review that had not happened). |
| F-171 | FR-D6-1/2 **seam** work is not done and D6 correctly did not do it: `'TEAM'` is still absent from `RESOURCE_KINDS`/the DB CHECK constraint/the board icon map, and supplies are not in `rankByExtent`. Those files belong to other lanes. | **"Taskable via the existing board" remains FALSE** — do not let any doc claim it. Already blocked in ADR-035 §4 on F15/F-140. |
| F-172 | FR-D6-4 has no HTTP route yet (CSV/JSON + `Content-Disposition`); `src/adapters/channels/http/**` is D3-owned. `buildIncidentSummary` is pure and route-ready. | Whichever lane owns the HTTP layer next adds the route. Note F-35: there was no CSV/export precedent in this codebase before D5. |
| F-173 | No `NEXT_PUBLIC_` mirrors for the five D6 flags, which ADR-035 §4 asks for. **Deliberate and correct**: D6 owns no browser surface, and an unread mirror would repeat F-32's defect class (a config value that exists but nothing reads). | Whichever lane adds the D6 panels must add the mirrors **plus a `.refine()` enforcing agreement between each flag and its mirror**, exactly as `NEXT_PUBLIC_DRILL_MODE` already does. |
| F-174 | The casualty tally is a standalone value object, not a field on `PublicReport` (`src/domain/public-report.ts` was outside D6's write set). | Wiring it onto the D4 damage report — and enumerating every render site for the label test ADR-035 §4 demands — is still open. |
| F-176 | `tests/architecture/d6-no-pii.test.ts` asserts `additionalProperties:false` only at each document **root**; nested object subschemas were unchecked. D6 added a recursive check in its own file (with its own planted-violation proof) rather than editing a sibling's test. | Two overlapping checks in two files. Converge at MW-E — same discipline as F-141. |
| **F-177** 🟡 | **Two of the seven curated reunification hosts cannot be verified by automated fetch.** `familylinks.icrc.org` and the American Red Cross RFL page return **HTTP 403 to automated requests** (bot protection) — so liveness is **unconfirmed, not disproven**. `familylinks.icrc.org` is corroborated indirectly (the verified ICRC page links to it by name); **the Red Cross URL has NO positive evidence** and is flagged as such in the module, the schema and CONFIGURATION.md. The other five (ICRC RFL, `crucearosie.ro`, `www2.cruzroja.es`, `redcross.gr`, `redcross.org.ph`) were fetch-verified 200. | **Needs a human eyeball before the link-out ships enabled.** Do not mark verified on the strength of a 403. |
| F-180 | ✅ **Positive finding, recorded deliberately as evidence against F-141 recurring:** the D5 lane independently reused `guardAggregateOnly` and `findPersonIdentifyingSchemaKeys` from `src/domain/shared/aggregate-only.ts` for its shelter CSV export **rather than building a third denylist**. `guardAggregateOnly` now has two real call sites. | The derive-don't-redeclare discipline is now propagating between lanes without being enforced per-lane. Worth keeping visible — it is the counter-example to F-24/F-140/F-141/F-192. |
| F-181 | `src/config/index.ts` was a three-lane hot file this wave (D4, D6, and whoever edited `index.test.ts`). The edits are additive and disjoint, but it is **the most likely merge-conflict site in MW-D**. | Inspect it deliberately at Checkpoint #4 rather than trusting that green gates imply a clean merge. |
| F-178 / F-179 | Sibling-lane state observed mid-flight and correctly NOT repaired: an eslint complexity error at `src/adapters/interop/edxl-rm-inbound.test.ts:22` (12 > 10), and 8 test failures plus 0%-coverage files under `src/application/coordination/**`. | Both belong to the D5 lane, which was still running when D6 reported. Expected mid-flight; re-verify after D5 lands rather than treating as regressions. |
| **F-172** ✅ **CLOSED 2026-07-31 (orchestrator-verified; the lane died before reporting)** | `GET /incidents/:id/summary` — CSV/JSON export with `Content-Disposition`, `RESPONDER+` RBAC, gated behind `FEATURE_D6_INCIDENT_EXPORT`. New `src/adapters/channels/http/routes/incident-summary.{ts,test.ts}` + the OpenAPI path at `docs/api/openapi.yaml:370`. **13/13 tests pass.** | **It did the two things that mattered.** (1) **Reused** `toCsv`/`csvCell` from `src/application/coordination/csv.ts` instead of writing a second RFC-4180 writer — the file says so explicitly and a test title asserts it ("not a second writer"). That is the derive-don't-redeclare discipline holding across a lane boundary for the second time (cf. F-180). (2) **Propagates the guard's error branch** (`if (!result.ok) return errorResponse(result.error)`) rather than the payload, matching `alert-sink.ts:121`. **Caveat: the lane terminated mid-sentence without a final report**, so there is no plant/fail/revert transcript from it — the closure above rests on the orchestrator reading the code and running the tests, which is weaker evidence than this project's usual bar. Re-check at Checkpoint #4. |
| **F-173** ✅ **CLOSED 2026-07-31** | Ten `NEXT_PUBLIC_FEATURE_D{4,6}_*` browser mirrors, built as a working pair with a boot-blocking parity guard rather than the ten dead env vars the previous lane rightly refused to add (F-32's defect class). Mirror names are computed by template literal from ONE derived list, never retyped, so a misspelling is a `tsc` error naming the missing property. Documented in `.env.example` + `CONFIGURATION.md`. | Proven by planting: `NEXT_PUBLIC_FEATURE_D6_SUPPLIES: NEXT_PUBLIC_FEATURE_D6_SUPPLIES must equal FEATURE_D6_SUPPLIES (the browser mirror agrees with the server flag; the server flag is authoritative)`, and an unknown value is a boot error, not a silent downgrade. **Honest note kept in the docs:** nothing reads the mirrors yet (F-152) — the refine is what stops them rotting while they wait for a consumer. |
| **F-240** ✅ **CLOSED 2026-07-31 by the orchestrator — a REAL OPERATIONAL TRAP, not a test problem** | Three existing tests broke when the F-173 parity refine landed. **They were the symptom; the design was the bug.** The mirrors carried their own independent `.default('on')`, so the refine fired whenever an operator set only the server flag: turning ONE feature off required setting TWO env vars, and getting it wrong did not degrade — **it refused to boot.** The concrete scenario that makes that unacceptable: the entrant disables `FEATURE_D6_REUNIFICATION_LINKS` because the F-177 URLs did not verify in time, and the app dies at startup — **during a filmed demo, on the single flag most likely to be switched off under time pressure.** | **Fixed at the root, not by patching the three tests.** Mirrors are now `.optional()`; an UNSET mirror INHERITS its server flag via a `.transform()`; the refine rejects only an EXPLICIT contradiction — the one case where the operator has genuinely said two different things. `Env` still types them as `'off' \| 'on'`, so no consumer changes. **The guarantee is unchanged and still structural** (a mirror can never silently disagree); what changed is that agreement is now the DEFAULT rather than the operator's homework. Also fixed a test that CLAIMED to plant "server off, mirror on" but only set the server flag — it was asserting the trap, not the guard. Added the inheritance test it was missing. 98/98 green. **Deriving a value beats requiring a human to restate it — F-24/F-140/F-141/F-190/F-192 applied to configuration instead of types.** |
| F-241 | Empirical confirmation of F-181's standing warning: whole-repo Gate 1/Gate 3/`next build` were observed red mid-session purely from sibling-lane in-flight work (complexity-lint in `feature-router.ts`/`read-models.ts`/`public-report.ts`; a transient `tsc` error in a sibling's new integration test that self-resolved between two runs). | **Do not diagnose a concurrent tree.** Re-run gates only once lanes reach a stable checkpoint; attribute by filename first. |
| **F-191 / F-192** ✅ **FIXED 2026-07-31 (orchestrator-verified on disk + by full battery)** | `api.getResources(params)` now takes and sends a query (F-192). `ResourceTaskWireBody` gained `readonly id?: ResourceTaskRequest['id']` with the semantics documented at the type: **absent ⇒ CREATE a new task (server-minted id, must start at `PROPOSED`); present ⇒ ADVANCE that task** (F-191) — which respects the domain's PROPOSED-first invariant instead of weakening it to suit the UI. | **F-157 also resolved**: `app/_lib/api.task-resource.e2e.test.ts` now passes **5/5 in isolation AND in the full suite** — counts agree, so the earlier variance was mid-flight write churn, not shared state. |
| **F-194** ❌ **WITHDRAWN 2026-07-31 — MY DIAGNOSIS WAS WRONG. DO NOT REGENERATE ANY BASELINE.** | **The baselines were never stale.** Verified at Checkpoint #4: `git diff HEAD -- e2e/visual.spec.ts-snapshots/` is **empty** — every baseline PNG is byte-identical to the committed version — and a clean full Playwright run on an idle box now passes **86/86 with 0 failures, including the COP baseline**, against the F-192-fixed app. **A stale baseline cannot pass against the app that supposedly invalidated it.** What actually happened: the 2 earlier failures were ENVIRONMENTAL. Concurrent lanes were each running `rm -rf .next && playwright test`, clobbering `.next` under another lane's running dev server — one lane's own words were *"a concurrent rebuild clobbered `.next` under the running server (pages rendered unstyled)"*. An unstyled render mismatches every baseline. **I read a diff image, saw the error text rendered in red, and concluded the BASELINE contained it — but red marks a DIFFERENCE, not which side it came from.** I then wrote a confident finding, told the entrant to spend their last visual-budget unit, and recorded it in three places. | **CONSEQUENCE: the visual budget is NOT zero — it is still 1 of 2 unspent.** The regeneration command issued to the entrant is **RETRACTED**; running it would have burned the last unit to overwrite correct baselines with identical-or-worse ones. **The transferable lesson is about evidence, not about Playwright: a diff shows THAT two images differ, never WHICH is correct.** To establish that a baseline is wrong you must check the baseline against version control (`git diff`) and re-run on a QUIET machine — because the cheapest explanation for a visual failure during concurrent builds is always the build, not the baseline. And never run visual tests concurrently with any other lane: serialize them, or the result is noise that reads like signal. |
| ~~**F-194** (original, INCORRECT diagnosis — retained so the mistake is legible)~~ | Playwright after the F-192 fix: **84 passed / 6 skipped / 2 failed**, both failures being the COP visual baseline (`desktop-dark` + `tablet`). **The diff is fully explained and the baseline is the thing that is wrong:** `e2e/visual.spec.ts-snapshots/cop-*.png` contains the rendered error text **“Resources unavailable — incidentId query param required”**. That string could only ever be produced by the F-192 defect, so the baseline captured and froze the broken state. Fixing the bug removes the error block, the layout reflows, and the stale baseline mismatches. | **This is the one case where regeneration is unambiguously correct** — the baseline documents a defect, so refusing to regenerate would be preserving a bug in amber. Regeneration was attempted and **blocked by the environment's permission classifier**; NOT worked around. **The entrant runs:** `rm -rf .next && ./node_modules/.bin/playwright test e2e/visual.spec.ts --update-snapshots`. **Visual budget: this consumes the 2nd of 2, leaving 0.** After it, re-run the full Playwright suite to confirm 86 pass. Everything else is green. |
| ~~**F-192** (original finding, retained for the record)~~ | **The logistics board's resource list fails to load at all in a real browser** — orchestrator-verified independently. `api.getResources()` (`app/_lib/api.ts:180-182`) fetches `/resources` with **no query string whatsoever**, while `resourcesGetRoute` (`feature-router.ts:147-148`) hard-fails `if (typeof incidentId !== 'string' …) return badRequest('incidentId query param required')`. So the board 400s before a user could ever reach the Task button. | **This is the FOURTH instance of the systemic root cause** (F-24, F-140, F-141, F-192): client and server contracts that drift because the client re-declares rather than derives. Fix as part of the logistics repair, and derive the query contract the same way F-140 derived the body contract. Demo-relevant: logistics is one of the four flagship features and appears on camera. |

### 0n. Eleventh finding batch (E1 docs-truth-up lane, 2026-07-31) — verified against code directly, not carried over on report

| # | Finding (verified) | Consequence |
|---|---|---|
| **F-280** 🟡 | **F-25's closure claim was overstated.** `runRetentionSweep` (`src/application/governance/retention-sweep.ts:66`) and both `RetentionStorePort` implementations (`src/adapters/memory/memory-core.ts:166`, `src/adapters/persistence/retention-store.ts:26`) are real, tested code — the "no sweep executor" defect is genuinely closed. But a repo-wide search for callers (`grep -rln "runRetentionSweep\|retention-sweep" src/main app`) returns **zero production call sites**: no cron/queue job, no HTTP admin route, no CLI command (`src/adapters/channels/cli/bin.ts` is 13 lines and does not mention it), no npm script. the internal session tracker states *"F-25 CLOSED — runs a real purge sweep... The PII-retention guarantee is enforced, not decorative"* — that is false as stated: the guarantee is **implementable on demand, not automatically enforced**. Same defect class as F-152 (built-but-not-composed). | Documented honestly in `docs/SPEC.md` §13.4 and `CHANGELOG.md` rather than left as a silent overclaim. Whoever next owns `src/main`/a queue adapter should wire a scheduled call (or an admin route) and then this finding closes for real. |
| **F-281** 🟡 | **Two files share ADR number 036, and one is an orphan.** `docs/architecture/decisions/ADR-036-response-coordination-tier.md` contains **only** a dated "Resolution note — 2026-07-31" (F-193/F-155) with no original ADR title, Status, Context, or Decision section — it was never a complete ADR. The actual response-coordination-tier decision record (FR-D4-1…FR-D4-5, the D5 five modules) lives in `ADR-036-warning-excellence-and-response-modules.md` §7, which already has its own title/Status/Decision. A prior lane appended the F-193/F-155 resolution note to a **new** file instead of the existing correctly-numbered one — the same append-target mistake the additive-edit discipline exists to prevent, just one directory over from a doc. This session's own briefing (`E1` task prompt) cited the orphan file BY NAME as the correct precedent location, propagating the error one hop further — an F-58-class case (an authoritative-sounding instruction was wrong; ground truth is in the file contents, not in what a brief asserts). | Not fixed in this pass (a structural ADR-renumbering/merge decision, and `docs/architecture/decisions/*.md` are the entrant's authored decision records — additive-edit discipline says append a note, not silently delete or rename). Flagged in `docs/SPEC.md` §13.10 and here. **Recommended resolution, for whoever picks this up:** move the Resolution note into `ADR-036-warning-excellence-and-response-modules.md` (append, preserving everything above it) and either delete the orphan file or replace its content with a one-line pointer — a git-tracked decision the entrant should make, not an agent. |

## MW-A — Localization

### A1 — scaffold ☑ DONE (gates green: tsc 0 · eslint 0 · 210 files/1867 tests · build ✅)
- ☑ A1.1 `config/locales.json` (14 locales) + `src/config/locales.ts` (literal-union type truth, allowlist
  guard, `alertLocalesFor`) + drift-guard test.
- ☑ A1.2 `messages/en.json` source catalog with `_meta`.
- ☑ A1.3 `app/_lib/i18n.tsx` — `createTranslator` behind a context defaulting to English (provider-less
  renders stay English ⇒ existing tests/baselines valid; keys compile-checked).
- ☑ A1.4 `app/_lib/messages.server.ts` — cookie→locale, deep-merge over English, dynamic catalog import.
- ☑ A1.5 `app/layout.tsx` async server-resolved `lang`/`dir` + localized `generateMetadata`.
- ☑ A1.6 `LocaleSwitcher` (endonyms, cookie + `router.refresh()`, machine-translation notice) + toolbar.
- ☑ A1.7 +35 tests. Protected-file escalation spent: `next-intl@4.13.4`.

### A2 — component migration (English byte-identical)
- ☑ A2.1 lane `map` (61 keys) · ☑ A2.2 lane `ui` (43) · ☑ A2.3 lane `shell` (25) · ☑ A2.4 lane `panels`.
  The panels lane was killed by a session limit mid-flight and was recovered from the commit diff.
- ☑ A2.5 locale-aware formatting: `relative-time.ts` split into a unit/value decision + a catalog key.
- ☑ A2.6 fragments merged → **222 keys / 16 namespaces**, 0 conflicts; `messages/_fragments/` deleted.
  Gates after A2: tsc 0 · eslint 0 · 211 files / 1875 tests. English byte-identical (proven by the
  pre-existing tests passing untouched).

### A3 — catalogs, fonts, RTL
- ☑ A3.1 **13 non-English catalogs** written by four parallel lanes, each key-parity/ICU/argument-parity
  verified. `ro` is marked **machine** too, not "human": it flips only once the entrant actually reviews
  `messages/ro.json` (claiming an unearned review would violate Art. XV). Translators left a per-locale
  list of judgement calls for that review.
- ☑ A3.2 fonts: bundled `@fontsource/noto-sans-{arabic,devanagari,bengali}` SCRIPT subsets (400+700)
  ≈300 KB of the 1 MB budget; one per-glyph `--font-sans` stack; Latin/Greek/Cyrillic already covered by
  Inter (F-08 confirmed). **CJK uses the SYSTEM stack by decision** — a usable SC face is 5–10 MB even
  unicode-range-split, which would blow both the font and repo budgets; system fonts are local so the
  air-gapped guarantee holds. Recorded as a known limitation.
- ☑ A3.3 RTL pass done AND locked: `tests/architecture/rtl-logical-css.test.ts` (69 checks) bans physical
  direction utilities in `app/**` with a justified allowlist for symmetric centring.
- ☐ A3.4 (still deferred, unchanged rationale, low value now that 14 real catalogs ship) pseudo-locale QA pass (long-string + bracket harness) — dev-only, never shipped in the switcher.

### A4 — alerts & channels
- ☑ A4.1 `InteractionRequest.locale?` added; **ADR-023 addendum** written, correcting its long-standing
  claim that the envelope already carried `locale`/`args` (it never did).
- ☑ A4.2 multilingual CAP: `CapOptions.translations` + `capTranslationsFor()` (region language first,
  English ALWAYS, a language with no copy is SKIPPED rather than mislabelled) + `capMachineValuesAgree()`
  proving category/urgency/severity/certainty/responseType/web/area are identical across blocks. With no
  translations the document is byte-identical to before. 10 new tests.
- ☑ A4.3a narrator locale: `NarrativeRequest.locale?` + `SynthesizeSitRepInput.locale?`; the provider
  appends a language instruction; English/absent ⇒ byte-identical prompt (tested). AI-parity green.
- ☑ A4.3b **DONE — MW-A is now 100% complete (A3.4 pseudo-locale deliberately deferred).**
  EDXL: OASIS RM 1.0 / SitRep 1.0 define NO language element (only a normative RFC 3066 citation) — the
  family's mechanism is EDXL-DE 2.0 `<language>`, which BEACON doesn't wrap; grounded the new optional
  `language` (RFC 3066 string) in that real element at message level, gap documented in both schemas and
  both mappers (F-57). `edxlSitRepMachineValuesAgree()`/`edxlRmMachineValuesAgree()` mirror the CAP
  invariant (multilingual SitRep/RM = one document per language, machine fields must agree). Telegram
  digest: new `src`-side `digest-i18n.ts` (core `createTranslator`, English deep-merge ladder, NFR-F7
  allowlist; no `app/` import — depcruise 0); labels from new `channels.digest.*` keys in ALL 14 catalogs;
  byte-identical English digest proven against the pre-i18n string verbatim. +11 interop tests + digest
  suite; 380/380 scoped. ⚠ Its `ro→human` "fix" was REVERSED by the orchestrator — see F-58.
- ☑ A4.4 `compass8`: `ProjectedWeather` now ships `compass` + `observedAt`; the wind label is composed
  client-side from the catalog with locale-correct abbreviations (ro V/SV/NV, ru С/СВ/З, …), the engine's
  English `label` retained as the CLI/API fallback. `HAZARD_LABEL` deliberately stays English — it feeds
  deterministic `GroundedFact` claims, and translating those would put a translator between the data and
  the figure (Art. XII).

### A5 — battery, docs, checkpoint
- ☑ A5.1 `tests/i18n/catalog-parity.test.ts` (key parity · ICU compile · argument parity · `_meta` honesty ·
  no blank/placeholder copy · no stray catalog files).
- ☑ A5.2 `e2e/i18n-rtl.spec.ts`: Arabic first-paint `dir=rtl`, raw-key-leak scan over the rendered DOM in
  ar/ro/zh-Hans, axe under **Arabic AND Chinese**, one RTL baseline. Found and fixed a REAL contrast
  defect (light-theme warn `#9a6b00` = 4.41:1 at 12px, under AA) by adding a `--warn-strong` token
  (5.31:1). Playwright **78/78**, TTTP ≈1.0 s. Visual baselines regenerated ONCE (the switcher wraps the
  toolbar on tablet/phone) = the single MW-A regeneration budgeted by §5.3.
- ☑ A5.3 docs truth-up DONE (SPEC §3.5 + a localization known-limitations block, CONFIGURATION §9/§12a,
  `.env.example`, CHANGELOG `[Unreleased]`, `llms.txt`, LOCALIZATION_FEATURE_PLAN → IMPLEMENTED). Found SIX
  pre-existing false doc claims — F-37…F-42. **NFR-F10 is NOT satisfied**: `SPEC.md` still has no
  consolidated top-level "Known limitations" section (→ E1).
- ☑ A5.4 **CHECKPOINT #1** recorded (report-and-continue) — gate report + memory checkpoint, then continue (report-and-continue).

## MW-B — region-generic engine + zones + storm

### B1 — engine genericity
- ☑ B1.1 `config/regions.json` regions now REQUIRE `iso`/`tz`/`languages[]`; misleading unused `units`
  removed (F-10); domain `Region` extended; **`schemas/regions.schema.json`** written + validated by
  `region-registry.schema.test.ts` (8 tests, incl. "every region's language is a shipped locale").
- ☑ B1.2 **DONE (F-01).** `{verb:'regions'}` (argument-free, min role PUBLIC) in the `Command` union;
  `handleRegions()` consumes the previously-unused `services.regions`; `GET /api/v1/regions` served via
  `matchGetSingle`; body `{data:{regions:[{id,name,iso?,tz?,languages[],bbox}]}, provenance, freshness}` —
  absent fields OMITTED, never defaulted (the F-06 rule). `DEFAULT_SEED.regions` now reads geography from
  `config/regions.json` via `seededRegion()` (never re-typed). openapi `/regions` de-planned and documented
  field-for-field, incl. the honest note that `FEATURE_STORE=postgres` serves only `id`+`name` (no
  iso/tz/languages columns). +12 tests; application coverage 100/99.37 ≥ floor. 5 `x-status: planned`
  paths remain (correct — still unserved).
- ☑ B1.3 **DONE (F-05).** `enabled_adapters` is now enforced: `BuildAdapterRegistryDeps.enabledAdapters`
  filters manifest rows BEFORE factory lookup; `buildRegionRegistries` passes each region's list.
  Semantics pinned by tests with WHY comments: key omitted (non-region-scoped callers: redundancy harness,
  per-adapter tests) ⇒ all rows, byte-identical to before; key present ⇒ it IS the allowlist, **empty ⇒
  zero adapters, never "all"** (an operator's deliberate restriction must not silently widen), degrading
  honestly per Art. XVI rather than Err-ing the whole composition; unknown id grants nothing, non-fatal
  (the drift guard is the enforcement point). `config/regions.json` reconciled — it was STALE (F-52):
  us-ca 15→21 ids, ro 10→14. `languages` consumed via new `regionAlertLocales()` (registry →
  `alertLocalesFor()`); the remaining CAP wiring is F-53. +12 tests across adapter-registry /
  live-composition / region-registry suites.
- ☑ B1.4 **F-06 FIXED.** `ISO_BY_REGION` and `FALLBACK_BBOX` deleted from `live-seed.ts`; geography comes
  only from the registry; `regionOf` returns `undefined` for an unconfigured region and the caller keeps
  the hand-seeded labelled picture instead of inheriting California's bbox. `assembleLiveMapSeed` now
  REQUIRES the region registry (an optional one would let a caller silently skip enrichment — the same
  class of quiet wrongness).
- ☑ B1.5 region `tz` threaded via a `RegionTimeZone` re-provider (`app/_lib/i18n.tsx`) +
  `src/config/regions.ts` (client-safe region view). Unknown region ⇒ UTC, never another region's zone and
  never the viewer's. 3 tests.
- ☑ B1.6 **DONE.** `tests/zones/add-a-zone.test.ts` (6 cases incl. path-traversal id rejection) + the
  drift-guard EXTENSION (F-12): `unknownAdapterRefs()` helper guards BOTH `enabled_adapters` and
  `source_mode_overrides` against the manifest, with a positive control (planted typo detected), a
  non-vacuity check (no shipped region has an empty allowlist), and a new rule that every override id is
  also on that region's allowlist (an override on a non-enabled row is dead config).
- ☑ B1.7 region SELECTOR LIST now derived from `config/regions.json` (`SHIPPED_REGIONS`); only the LABEL
  comes from the catalog (`shell.region.<id>`, id as fallback) — F-22 resolved, baselines kept their wording.
- ☑ B1.8 **DONE — THE REGION-ID DISPATCH IS GONE.** `live-seed.ts` 553→732 lines: four `enrich*` fns and
  BOTH region-id dispatches replaced by one generic path — `SLOT_BY_PORT` (manifest `port` → domain slot),
  `SLOT_PATHS` (which slots each of incident/map consumes), `LAYER_BY_SLOT` (declaration order = stamp
  order), precedence from each region's `enabled_adapters` ARRAY ORDER (config data, ADR-012).
  `US_CA`/`RO`, `CA_NEWS_IDS`/`RO_NEWS_IDS`, both camera priority arrays, `fetchNamed`,
  `fetchCameraSources`, `cameraStamp`, `regionOf` all DELETED; `grep "'us-ca'\|'ro'"` over the file returns
  **nothing**. F-55 closed (`findRegion` exported, one lookup); F-54 closed (`minItems: 1` + positive
  control test); **F-52 closed STRUCTURALLY** — a test now asserts consulted-set ≡ `enabled_adapters` in
  BOTH directions for every shipped region (previously false: `usgs-water` was enabled and consulted by
  nothing). Zero-code new zone proven by executing it: a config-only `pt` zone enriches from the global
  stack and cites nothing it didn't enable. 24→**52 tests**, 23 frozen snapshots.
  **Characterisation method (the reason this is trustworthy):** snapshots frozen against the pristine
  `git show HEAD` copy of the file, one aspect per test (a failing snapshot aborts its test and would mask
  later diffs), with SourceRecord ids mapped to first-appearance order so the counter offset didn't
  masquerade as a behaviour change. **35 assertions byte-identical**; 12 diffs accepted, each justified
  (see F-63). ⚠ One diff was a MISLABEL the lane FIXED rather than accepted — see F-64.

### B2 — storm hazard family (gates green: tsc 0 · eslint 0 · 221 files / 2122 passed + 2 pre-existing
skips · depcruise 0 · catalog-parity GREEN, the 13 catalogs were topped up centrally in parallel)
- ☑ B2.1 `STORM` incident type + `TRACK`/`CONE`/`STORM_SURGE` hazard kinds (F-19), incl. both DB CHECKs.
  Three mirrors updated: `core-tables.ts` (Drizzle), `schemas/schema.sql` (reference DDL), and a NEW
  additive migration `drizzle/0003_storm_hazard_family.sql` (+ journal/snapshot) — `0000_init.sql` untouched.
- ☑ B2.2 Map layer + palette + legend + `LAYER_META`/`LAYER_BUILDERS`/`presentLayers`/`defaultLayers`
  (all six exhaustive-map sites) + `stormConeCaveat()` uncertainty labeling on the cone. Default OFF.
- ☑ B2.3 Surge wired into exposure, track/cone excluded — via `exposureBearingHazards()`
  (`Record<HazardKind, boolean>`, so a new kind fails Gate 2) applied at BOTH exposure query builders in
  `src/application/derivation/derive-cop.ts`. That is where the `hazards` array is assembled, not
  `src/main/`; `risk-intersection.ts` unchanged, as F-18 predicted.
- ☑ B2.4 CAP mapping for storm/surge (`capCategoryForHazardKind`/`capEventForHazardKind`, both exhaustive)
  + the `LineString` gap now assertable via `capAreaIsTextOnly()`; `geometryToCapArea` behaviour unchanged.
- ☑ B2.5 **NO regeneration needed** — the storm layer ships default-OFF and the baseline screenshots keep
  the Layers popover closed, so the new toggle row is invisible to them. Confirmed empirically (Playwright
  78/78 green), not assumed (F-47). **Visual budget: 1 of 2 used** (the MW-A switcher); ONE remains for the
  whole feature, after which any visual diff is a defect.

### B3 — aggregators & zones
- ☑ B3.1 **DONE.** Generic `src/adapters/sources/meteoalarm/` (one class, N `MeteoalarmFeed` presets) +
  `meteoalarm-gr`/`meteoalarm-es` rows. `meteoalarm-ro` fully backward-compatible: its ACL is now an
  11-line re-export alias, its adapter subclasses the generic one with the RO preset, and **all 14 of its
  existing tests ran UNCHANGED and green** (manifest row, `METEOALARM_RO` prefix, id, coverage, class and
  factory names, recorded `romania-atom.xml` all preserved). GR/ES fixtures are hand-authored
  recorded-style and labelled as such in-file (feeds live-verified 2026-07-18, bodies not recorded).
- ☑ B3.2 **DONE.** `wmo-swic` relay (RSS index → CAP v1.2, both lenient/skip+count), source id by config
  (`WMO_SWIC_SOURCE_ID`, default `ph-pagasa-en`); mock walks the same index→CAP pipeline as LIVE.
  **F-48 resolved STRUCTURALLY, not by a filter: the adapter never constructs a `HazardGeometry` at all**
  — it yields alert/news intel only, so an `acp` area *cannot* reach `EXPOSURE_BEARING_BY_KIND` or the
  hazard layer even if a future caller wanted it to. Rejected mapping it to `TRACK`/`CONE` because those
  mean centre-line and track-uncertainty envelope — labelling PAGASA's Area of Responsibility a "cone"
  would have been a second falsehood on top of the first. `acp` summaries carry "alerting area only, not
  the storm extent"; `gfa` province polygons ARE parsed faithfully (`capAreaMultiPolygon`) but not emitted
  as hazards; PH footprints stay with `gdacs`/`glofas`. **F-49 pinned**: all three Maguindanao rings emit
  as ONE MultiPolygon (never first-ring-only) and every vertex is axis-swapped CAP `lat,lon`→GeoJSON
  `[lon,lat]`, with a lon>100/lat<10 invariant a transposition would break. **F-51 pinned**: an unobserved
  family (`Heavy Rainfall Warning`) gets NO advisory-extent classification — no unverified claim. One test
  asserts WHY F-48 matters: the PAR polygon's lon range 113…130 is wider than the `ph` bbox 116.93…126.60
  on BOTH sides. 26 tests.
- ☑ B3.3 **DONE — and the B1.8 claim held: THREE ZONES, ZERO APPLICATION CODE.** `es`/`gr`/`ph` are three
  rows in `config/regions.json` plus a catalog label and an offline seed; no `src/` logic was added, changed
  or branched to make them work (the only `src/` non-seed touch was a stale COMMENT in
  `adapter-registry.ts` that still said "no region enables these yet"). Precedence is stated per zone in
  `enabled_adapters` order: `es`/`gr` = `firms`→`effis` (hotspots AND perimeters land; the fire badge cites
  the near-real-time feed) → `gdacs` (EVENT feed, cited never drawn) → the one-rung slots (`open-meteo`,
  `glofas`, `osm-overpass`, `worldpop`, `opencellid`) → `meteoalarm-es`/`meteoalarm-gr` leading the
  NewsIntel slot so the NATIONAL warning authority outranks gdelt/reliefweb/agency-rss/bluesky →
  `windy-webcams`. `ph` = `gdacs`→`glofas` (PH's only gauge rung, F-51) → the one-rung slots → `wmo-swic`
  (PAGASA, CC BY 4.0) leading NewsIntel → the global news set → `windy-webcams`; `firms`/`effis` are
  DELIBERATELY absent (PH has no fire scenario; two fire feeds nothing consumes would inflate the source
  list, F-63). No US-only row on any of the three. **BBOXES CONFIRMED, and `ph`'s was WRONG** — the spike's
  `[116.93, 4.59, 126.60, 21.12]` (F-51: "not geodetically verified") clipped ALL FOUR extremes; shipped
  `[116.87, 4.40, 126.62, 21.14]`, built from the undisputed archipelago's extreme points and contained by
  EPSG:4683 PRS92. `es` `[-9.31, 35.99, 4.33, 43.80]` = mainland + Balearics ONLY (Canaries/Ceuta/Melilla
  deliberately outside — reaching them means 2000 km of Atlantic); `gr` `[19.36, 34.79, 29.65, 41.76]`
  = Othonoi/Gavdos/Strongyli/Ormenio. Method + sources appended to `GLOBAL_ZONE_SOURCE_RESEARCH.md`
  ("LATE ADDITION 4"). **GAP REPORTED, NOT INVENTED:** the backlog line named "AEMET keyless CAP RSS + DGT"
  — there is NO AEMET-direct and NO DGT adapter in this build, so `es` ships on `meteoalarm-es` (MeteoAlarm
  relays AEMET's warnings) + the global stack, and says so. `shell.region.es/gr/ph` added to ALL 14
  catalogs (real translations, correct script; no `_meta` touched — F-58).
- ◐ B3.4 **Philippines spike ☑ DONE (F-21 resolved — the finding was WRONG; see §0e F-48…F-51).** PAGASA
  is on WMO-SWIC with keyless LIVE CC-BY-4.0 CAP; `ph` ships on rung (a). Research appended to
  `GLOBAL_ZONE_SOURCE_RESEARCH.md` ("LATE ADDITION 3"). REMAINING (downstream of B3.2): add `ph-pagasa-en`
  as a source id on the new `wmo-swic` relay + the `ph` region row (`iso PH`, `tz Asia/Manila`,
  `languages ["fil","en"]`, bbox to confirm) + fixtures (one `gfa`, one `acp`) + the F-48 advisory-extent
  test. Original text kept below for the record:
  ~~⚠ **Philippines spike (F-21)** — time-boxed: probe PAGASA/PHIVOLCS feeds and the SWIC source~~
  list. Pre-decided fallbacks, no user question needed unless BOTH fail: (a) ship `ph` on the global stack
  (GDACS + FIRMS + Open-Meteo + WorldPop) with an explicit "no national alert source covers this region"
  state — honest and still demonstrates add-a-zone; (b) if PH cannot render usefully at all, escalate.
- ☑ B3.5 **DONE.** Per-zone offline seeds follow the `us-ca`/`ro` precedent exactly (raw inputs in
  `scenario-inputs.ts` → incident in `seed.ts` → map input in `map-seed.ts`), all MOCK-labelled, all
  illustrative events over REAL geography: `es` Sierra de la Culebra (Zamora) wildfire, `gr` North Evia
  wildfire, `ph` Maguindanao/BARMM flood — the last deliberately sited where PAGASA's real `gfa` fixture
  speaks. **This is also what made `live-seed.test.ts`'s consulted≡enabled guard go green**: before the
  seeds, the three zones loaded and rendered a selector entry but NO assembly consulted them, which that
  test caught. The seeds are honestly THIN and say so in-file: no cameras (no ES/GR/PH pin exists — seeding
  one means inventing a live-view URL), no outage/cell/floodzone slices (EAGLE-I and NFHL are US-only), no
  shelters/reports (fabricating a consented report is a Responsible-Data violation, not a nicer demo).
  `ph`'s inundation prediction is deliberately NULL: `FloodInundationInput` REQUIRES an `nfhl` geometry —
  a US-only regulatory dataset the Philippines has no equivalent of — so the deterministic `floods` gate is
  FALSE and the projection short-circuits before that field is read, rather than passing some other polygon
  off as a regulatory floodplain. `fil`/`el` CONFIRMED surfacing for `ph`/`gr`: a new test in
  `tests/zones/add-a-zone.test.ts` asserts every SHIPPED zone has a non-id catalog label and that each
  zone's declared languages are shipped locales.
- ☑ B3.6 **DONE for the three B3 ids** (`tests/redundancy/redundancy-acceptance.test.ts` `ALL_IDS` +3).
  Manifest is now **30 adapters** (was 27); `adapter-registry.test.ts` counts + `ALL_IDS` updated, and a
  new test `'the B3 aggregator rows are enabled by NO shipped region yet'` is written to **fail loudly**
  when B3.3 enables them, rather than letting that state drift silently. Re-run this task for any later id.
  Attribution landed in all three of the repo's existing places: manifest `license`/`attribution` fields,
  `NOTICE` (wired 27→30, PAGASA CC BY 4.0 with mandatory credit + the F-48 caveat), and
  `audit/DATA_SOURCE_VERIFICATION.md` §3 (spike rows transcribed, incl. PHIVOLCS "do not wire" and NDRRMC
  "link-out only"). New env vars documented in `.env.example` + `CONFIGURATION.md` §6d per AGENTS.md.
- ☑ B3.7 **CHECKPOINT #2 — RECORDED 2026-07-27, FULL BATTERY GREEN over the combined six-lane tree.**
  `tsc --noEmit` **0** · `eslint .` **0** · `depcruise` **0 violations / 582 modules / 1941 deps** ·
  `vitest run --coverage` **232 files, 2340 passed, 2 pre-existing skips, coverage gate EXIT 0** (all
  floors met — verified WITH `--coverage`, per the F-43 lesson) · `next build` ✅ (First Load JS 102 kB
  shared; `/` 735 kB) · `playwright test` **78 passed, 6 skipped** · **TTTP 946 ms (us-ca) / 942 ms (ro)**,
  ~10× inside the <10 s budget · axe **0 serious/critical** under en + **ar (RTL)** + **zh-Hans (CJK)** ·
  `npm audit` **0 high** (4 moderate, unchanged) · **visual budget still 1 of 2 used** — no regeneration
  needed for the whole of B1/B3 (verified by a run, not assumed).
  Scale now: **30 adapters · 14 locales · 2 shipped regions · 232 test files / 2340 tests · 73 files
  uncommitted**. Waves MW-A and MW-B are COMPLETE except B3.3/B3.5 (ship the new zones).

## MW-C — prediction probability
- ☑ C1.1 `Gauge` gains `exceedanceProbability?` (fraction in [0,1], invariant-guarded) + `tendency?`
  (`DECREASING|STAGNANT|INCREASING`); `glofas-acl.ts` maps both instead of dropping them (F-15). An
  out-of-range probability is left ABSENT, not rescaled — a bare `74` is an unknown unit, and guessing it
  could turn a quiet river into a certainty. Unrecognised tendency wording is likewise absent, never STAGNANT.
- ☑ C1.2 Deterministic likelihood classifier `src/application/forecast-likelihood/` — the threshold table is
  `config/likelihood-thresholds.json`, validated by the NEW `schemas/likelihood-thresholds.schema.json`
  (shipped-config↔schema test, the `region-registry.schema.test.ts` pattern; the dead
  `threshold-rule.schema.json` was NOT extended, per F-33). The classifier holds no threshold literal (a test
  greps the module for `0.3`/`0.6`), returns `{class, rawValue, sourceField, method, threshold}` so no surface
  can show a class without its evidence, and the schema REQUIRES a `source` + `method` per row.
- ☑ C1.3 `Prediction.likelihoodClass?` (`POSSIBLE|LIKELY|VERY_LIKELY`, ordered + `likelihoodClassRank`/
  `compareLikelihoodClass`) and `etaHours?` (finite, ≥ 0). `hazardArrival` is COMPUTED at the application
  layer from an injected clock (`deriveForecastLikelihood`/`hazardArrival`) and deliberately not stored on the
  entity — ADR-033 §3 rejects dragging a wall-clock read into a pure factory. Additive: C2.1's
  `predictions[]` plural rename lands on top untouched.
- ☑ C1.4 **DONE (F-20).** `usesOnlyCitedLikelihoodClasses` added and wired into `isValidNarration`, so a
  rejection drops the ladder to the deterministic-only rung as before. Surfaces matched LONGEST-FIRST and
  consumed, so "very likely" is never miscounted as a bare "likely"; `\b` stops "unlikely" matching
  "likely". **`UNLIKELY` is rejected outright** — it has no counterpart in `LIKELIHOOD_CLASSES`, so the
  engine cannot emit it, and an invented negative forecast is the most dangerous kind (it tells a reader
  NOT to act). Both directions caught: upgrade LIKELY→VERY_LIKELY *and* downgrade VERY_LIKELY→LIKELY.
  New `output-validator.test.ts` (14 tests, incl. an explicit proof that the number guard passes the
  upgrade case and only the word guard catches it); 44/44 in `src/adapters/ai/**`, ladder tests unchanged.
  Blind spot recorded as **F-62**, pinned by an executable test rather than left as prose.
- ☑ C2.1 **DONE.** `predictions[]` plural across the 6 lockstep sites, shipped as a **widening, not a
  rename**: `MapDerivationInput.predictions`, `MapSource.predictions`, `MapProjection.predictions`,
  `MapProjectionData.predictions` are all **required, default `[]`** (a new construction site cannot forget
  one — `tsc` fails), while `MapProjection.prediction`/`MapProjectionData.prediction` survive as
  `@deprecated` mirrors of `predictions[0]`, omitted when the array is empty, so a v1
  `GET /regions/{id}/map` client keeps rendering the first cone unchanged (SPEC delta §1.1, openapi marks
  the singular `deprecated: true`). `derivePredictions` runs each spec's engine in order and drops the ones
  that project nothing **without displacing** the ones that do; `buildPredictionLayers` emits **one
  descriptor per cone**, each with its own `predictionCaveat` — N predictions are N labelled cones, never a
  merged polygon with an averaged uncertainty (Art. XII). The single-prediction case is proven byte-identical
  three ways: the `prediction-cone` descriptor id is retained verbatim for index 0 (exact `toEqual` on the
  whole descriptor), the two regenerated `live-seed` snapshots differ ONLY by the key rename + array wrapper
  (line-multiset proof: zero content-only lines on either side), and Playwright's visual baselines are
  untouched. **Visual budget still 1 of 2 used.** The `LayerId` `'prediction'` was deliberately left alone
  (F-75); F-76 pins the previously-untested cone builder; F-77 hands C2.3 the geometry-less-prediction
  decision; F-78 records that **F-61 stays open** — no persistence path was touched.
- ☑ C2.2 **DONE (F-16 closed).** Both kinds are now CONSTRUCTED, in the new
  `src/application/prediction-projection/trend-projection.ts`. **`ESCALATION`** wraps `classifyTrend`
  (reused, never reimplemented — a test asserts the emitted `inputs` equal the classifier's own
  `TrendResult` field-for-field) and carries it verbatim + `signalLabel`/`windowHours`; `STEADY` (including
  the too-few-samples case) ⇒ labeled `null`. **`IMPACT_OVER_TIME`** projects the exposure-basis count the
  pipeline ALREADY computed forward at the config checkpoints (+6/+12/+24 h), each checkpoint with its own
  uncertainty and the prediction carrying the FURTHEST one (worst case, never an average). Both carry
  `geom: undefined` **by design** (ADR-033 §4.1/§4.2) — so `projectMap` skips them and they add no map
  descriptor (F-77 preserved, `geometry` was NOT made optional); their surface is the SitRep path, where
  `deriveIncidentFacts` now returns `predictions[]` built from the SAME trend result the SitRep label uses
  and the SAME blended population figure the grounded fact states — **nothing re-derived, no seed change
  needed, all five zones covered** (CA/ES/GR get both kinds, RO/PH get IMPACT_OVER_TIME only, honestly:
  their trends are STEADY — see F-82). Every parameter is DATA in the NEW `config/trend-projection.json` +
  `schemas/trend-projection.schema.json` (each block must declare its own `basis` or the schema rejects it;
  a test greps the projector for `0.4`/`0.02`/`0.1` and for inline checkpoints). Uncertainty is a **LABEL,
  never a probability of occurrence** (F-34) — stated in the config's own authority prose and pinned by a
  test. The C1 classifier is reused for class + ETA + `hazardArrival` through an optional `forecast` seam
  (a class never travels without its raw value); no signal ⇒ no class, never a default. Clock-freeness is
  proven by reading the module (no `Date.now()`, no argument-less `new Date()`) plus byte-identical replay.
  **Not persisted** — F-61/F-78 stay open, no migration written or needed. **For C2.3:** consume
  `IncidentFactsResult.predictions` (`derive-cop.ts`); `PredictionSpec` also accepts both kinds on the map
  path. New findings **F-82** (a false ESCALATING claim in the `ph` seed, fixed), **F-83**, **F-84**, **F-85**.
- ☑ C2.3 **DONE (F-17 closed; F-77 closed per the orchestrator ruling).** New
  `src/application/outlook/outlook.ts`: `compareOutlookItems` (pure, clock-free) + `rankOutlook`, the ONLY
  builder of `SitRep.outlook`. **Order, verbatim:** likelihood class DESC (absent ⇒ `POSSIBLE`) → soonest
  ETA ASC (absent/non-finite ⇒ last) → severity DESC (absent ⇒ below `MINOR`); rows equal on all three keep
  their DERIVATION order, since `sort` is stable — the same guarantee `tieBreakKey` gives the priority
  ranking. Ordering laws asserted **exhaustively over the comparator's entire declared input space**
  (140 rows: 19 600 pairs for antisymmetry, 46 656 triples for transitivity + transitivity-of-equality) plus
  a seeded-LCG 500-row sample for monotone-sort/stability/idempotence — **no dependency added**
  (`fast-check` is not in the repo). Two ADR defects found doing it: **F-90** (severity typed required,
  no `Prediction` has one) and **F-91** (`etaA - etaB` returns ±Infinity/NaN ⇒ not a total order).
  **SitRep section:** `SitRep.outlook` follows the `priorities` pattern exactly (required, defaults `[]`),
  ranked inside `synthesizeSitRep` from the new `SitRepFacts.predictions`; `hazardArrival` per row is
  computed from the SitRep's INJECTED `generatedAt`, never a clock read. **The engine-sorts/LLM-narrates
  boundary is structural, not a rule:** the narrator payload is built by `toCitedFacts` from `facts` alone,
  so no outlook row ever reaches a model (pinned by a test that greps the actual `ComplianceRequest`
  payload) — the **output-validator needed no extension** (**F-95**; F-62's English-only blind spot stands).
  **Wired end-to-end with no seed change:** C2.2's `IncidentFactsResult.predictions` → `IncidentView`
  (`command-router.ts`) → `MemoryReadModel.toView` → `outlook[]` on the wire; the served `us-ca` SitRep now
  carries 2 ranked rows, both **geometry-less kinds** — the empirical proof that a `MapProjectionData`-sourced
  panel would have shown an empty Outlook (F-77/**F-92**). `openapi.yaml`'s `Sitrep` schema now **requires**
  `outlook`. **COP panel:** `app/_components/panels/outlook-panel.tsx`, SitRep-sourced, renders nothing when
  the outlook is empty, class/kind tokens verbatim (never translated), every row labelled with its method +
  uncertainty; 6 new keys (`outlook.title|sectionLabel|eta|noEta|unclassified|uncertainty`) in **all 14**
  catalogs, real translations, **no `_meta` touched** (F-58 — `ro` stays `machine`). **Visual budget: still
  1 of 2 used** — the section measurably changes 5 baselines (1644→1836 px, verified by RUNNING both ways),
  so it ships **display-gated OFF** behind `NEXT_PUBLIC_FEATURE_OUTLOOK_PANEL` (**F-94**, storm-layer
  precedent); the flag-ON render passes axe WCAG 2.2 AA + the golden path in a real browser. ADR-033 §5
  corrected by a dated addendum (original retained verbatim), which also records §4.2's relative-rate
  resolution for C2.2 (**F-98**/F-85). **F-66(a) NOT fixed** — it is a three-file change entirely outside
  this lane (**F-93**: `live-seed.ts:511-516,531-543`, `derive-cop.ts:315-318,464-471`). New findings
  **F-90…F-98**.
- ☑ C2.4 **DONE.** `FORECAST_GAUGE_CATEGORY` added to `THRESHOLD_TARGETS` (+ all four enum mirrors:
  `schemas/schema.sql`, `intel-tables.ts` CHECK, hand-completed `drizzle/0004_forecast_threshold_target.sql`,
  `openapi.yaml`). `conditionMet` gains the forecast branch and **fails closed with no injected clock** — a
  forecast whose vintage cannot be checked never fires. Four gates, all DATA in the NEW
  `config/forecast-trigger.json` + `schemas/forecast-trigger.schema.json` (the dead
  `threshold-rule.schema.json` was NOT extended, per F-33; every gate must declare its own `basis` prose or
  the schema rejects it, and a test greps the evaluator for `168`/`24`/`'LIKELY'`): forecast category ≥ rule
  value · lead time inside `[0,168] h` · source issue instant no older than **24 h = one GloFAS update cycle**
  · likelihood ≥ **LIKELY**, compared via the C1 classifier (`forecastReadingFromGauge` is the single seam —
  this engine classifies nothing and holds no threshold literal). **Staleness answered twice:** the vintage
  window catches an aged run, and new `RuleRuntimeState.latestForecastIssuedAt` catches an out-of-order/
  replayed run that is older than one already seen (it is evaluated, so the episode state stays honest, but
  cannot fire). A future-dated issue instant is refused too — a bad timestamp cannot buy freshness.
  **The DRAFT-only guarantee is now STRUCTURAL (Art. XIII):** new `DraftAlert` type in `src/domain/alert.ts`
  (`'DRAFT'` literal + `approvedBy?: undefined`) is disjoint from `EmittableAlert`, so `buildDraftAlert`'s
  output cannot be passed to `AlertSinkPort.emit` — verified as a real `TS2379`, pinned by `@ts-expect-error`
  (which becomes an "unused directive" tsc error if the guarantee is ever weakened). `asEmittable` gains a
  `(DraftAlert) => null` overload so the narrowing cannot launder a fire either. **Defect found and fixed
  (F-79):** `makeAlertSink.emit` had NO runtime capStatus check and `alertToCap` deliberately maps a DRAFT to
  a valid `status: Draft` CAP — so a cast/JS caller WOULD have had a DRAFT recorded as a real emission; `emit`
  now fails closed with a typed CONFLICT. The DRAFT carries `forecast: { leadTimeHours, expectedCrossingAt
  (reusing C1 `hazardArrival`), forecastCategory, forecastIssuedAt, likelihoodClass + rawValue + sourceField +
  method }` — a class never travels without its evidence, and the ENSEMBLE row stays labeled a member share,
  never a chance of occurrence (F-34). Additive `deriveDraftAlertProposals` in `derive-alerts.ts` keeps the
  proposal whole for the surfaces; `deriveDraftAlerts` delegates, unchanged. **Still to wire (not C2.4):** a
  seeded forecast rule in `feature-seed.ts` and a UI surface for `forecast` — no on-camera moment yet (MW-E E2
  blocker class).
- ☑ C2.5 **CHECKPOINT #3 — RECORDED 2026-07-28. MW-C COMPLETE. FULL BATTERY GREEN.**
  `tsc` **0** · `eslint` **0** · `depcruise` **0 violations / 595 modules / 2014 deps** ·
  `vitest run --coverage` **237 files / 2520 passed / 2 skips — gate EXIT 0** · `next build` ✅ ·
  `playwright` **78 passed / 6 skipped** · TTTP <10 s · `npm audit` **0 high** (4 moderate) ·
  **visual budget STILL 1 of 2** (the Outlook panel ships display-gated OFF rather than spend it).
  **Recovery from the killed lane, done properly:** both moved characterisation snapshots were justified
  individually before updating — us-ca gained only `trendSignalLabel`/`trendSourceId` (F-83, additive);
  ro's crest input gained `crestForecast`/`crestTime`/`exceedanceProbability`, moved
  `floodCategory` minor→**moderate** and swapped `returnPeriodLabel` for `readingUnitLabel`, because the
  SERVED GloFAS gauge now replaces the seeded placeholder (F-93) — the whole point of the fix.
  **Three tests were added that the killed lane never wrote**, all catching real invariants:
  (1) the crest fact is stamped with the adapter that actually served it, and a downed-gauge fact retains
  the SEED's value AND the SEED's citation — never a source that served nothing (F-64 + Art. XVI);
  (2) the return-period threshold is stated ONLY when the source published one — an observed gauge may not
  inherit a return-period model's wording; (3) **a stage/crest figure is never stated without the unit its
  source published** — a number without its unit is not a fact. That third test closed the last branch
  under the 99% application floor, so the gate was met by covering a real honesty invariant, not padding.

## MW-D — differentiators
- ☐ D1 predicted-impact quantifications (people · comms-blackout/alert-reach · clipped population ·
  shelter demand + clearance) — all pure, reproducible, aggregate-only, method-labeled.
- ☐ D2 anticipatory-action engine: EAP config schema (6 IFRC elements incl. stop mechanism) + ensemble
  member-counting evaluator + state machine + replay-determinism test + suggestions into pre-positioning.
- ☐ D3 warning excellence: CAP/profile validator (blocking pre-emit) · Update/Cancel/ALL-CLEAR + delivery
  counts · ISO 22324 pictograms · plain-language templating · multilingual CAP (reuses A4) · opt-in TTS ·
  93-char cell-broadcast preview.
- ☐ D4 governance: hash-chained trigger/warning ledger · SOP chain with delegated fallback approver ·
  **DRILL mode with a structural (composition/type-level) guarantee** that no drill artifact reaches a real
  channel + the structural test.
- ☐ D5 the five D4-tier modules (rumor · mutual-aid EDXL-RM · shelter status · damage/needs · EMS overlay),
  each behind `FEATURE_D4_*`.
- ☐ D6 the five basic-aggregate modules (volunteer TEAMS · supplies · reunification LINK-OUT · incident
  summary export · aggregate casualty tally) behind `FEATURE_D6_*`, plus the **structural
  no-person-identifying-field test**.
- ☐ D7 Anticipatory panel UI (states · ensemble evidence chart · activation history) — on-camera visibility.
- ☐ D8 **CHECKPOINT #4**.

## MW-E — final pass
- ☐ E1 docs/counts truth-up everywhere (README · SUMMARY · CHANGELOG · llms.txt · SPEC · openapi · NOTICE ·
  CONFIGURATION · .env.example) — the 2026-07-17 stale-count defect class must not recur.
- ☐ E2 demo + live-test scenarios O(i18n) P(zones) Q(predictions) R(anticipatory+drill) **and the
  FEATURE→SHOT TRACEABILITY MATRIX — a feature with no on-camera moment is an MW-E BLOCKER**.
- ☐ E3 full 6-lens re-audit (code · security/secrets+git-history · docs-truth · test-quality ·
  judges-rubric vs Phase 1/2/3 · consistency/parity) + diff-scoped adversarial verify.
- ☐ E4 full gate battery incl. RTL smoke, axe under en/ar/CJK, TTTP <10 s, npm audit 0 high, bundle/font
  budgets measured (not assumed).
- ☐ E5 fix all findings → re-verify → **S08 HARD STOP** sign-off report → user merges → user tags
  `v1.0.0-rc.1` → user live-tests A–R → user promotes `v1.0.0` (package.json 0.1.0→1.0.0 at MW-E).


## §0o — MW-E / E3 SIX-LENS RE-AUDIT (2026-08-01). Findings F-320…F-404.

**Three lenses reported (security, architecture, rubric); two were still running at session end.** Every
finding below was produced by an adversarial read-only pass and cites `file:line`. Severity is the lane's,
re-checked by the orchestrator where marked.

### 🔴 FIXED IN THIS PASS
| ID | Finding | Status |
|---|---|---|
| **F-344** | **`AUTH_DEV_TRUST_HEADER=on` had no production/cloud hard-off** — while the strictly WEAKER dev-login minter did. The header path grants any role with **no secret and no token at all**. The lane demonstrated it against the real dispatcher: an unauthenticated caller read **precise SOS coordinates** (Art. XIV) and promoted a DRAFT to a schema-valid **ACTUAL CAP recorded in the hash chain as a genuine emission** (Art. XIII). **Not hypothetical: every profile in `docs/E2E_TESTING_PLAYBOOK.md` sets this flag on**, including the cloud demos — a copied profile was one `DEPLOY_MODE=cloud` from that sequence. | ✅ **FIXED by the orchestrator**: symmetric prod/cloud hard-off added to `resolveRole` (`rbac.ts`), plus 3 tests asserting the guard beats an EXPLICITLY-ENABLED flag (not merely an absent one) and a no-regression case for the documented local demo. 193/193 green. |

### 🔴 OPEN — highest priority, each with a demonstrated exploit
| ID | Finding |
|---|---|
| **F-340** | **The Art. XII "LLM never emits a figure" guard is a token-bag MEMBERSHIP check, not a provenance check.** `usesOnlyCitedNumbers` flattens every fact into one bag of digit tokens, so every ISO timestamp donates `2026/08/01/14/30`, every corroboration count donates a small integer. The lane ran the SHIPPED validator and got these **ACCEPTED**: *"Roughly 30 people are unaccounted for"* (30 from a timestamp) · *"About 2026 residents were evacuated"* (the year) · *"12.4 million dollars in damage"* (magnitude swap off a crest in feet) · *"3 fatalities confirmed"* (a source count re-attached) · *"Fourteen thousand displaced"* (number words carry no digits) · *"Butte County is the worst-hit and highest-priority area"* (a ranking, no digit). Only the single case the shipped test covers was rejected. **Fix: reject ALL digits and superlatives in narration** — the deterministic figures render separately, so the prose needs no numbers at all. |
| **F-341** | **The model-authored SitRep summary renders with NO "AI-generated" label** (`sitrep-panel.tsx:113-128`) — a badge appears only when there is *no* AI content. Art. VI requires the opposite. The same unlabelled string is exported to external agencies as `summary.executiveSummary`. **Fix: one catalog key + one badge.** |
| **F-346** | **The incident-summary export accepts a client-forged casualty tally verbatim.** `checkFigures` validates every figure except the tally, which is passed **by reference**, bypassing `stampCasualtyTally`'s F-174 guarantee. Demonstrated over HTTP as RESPONDER: `count:-7.5`, `label:"CONFIRMED by County Coroner — official verified count"`, `authoritative:true` → **200 text/csv** with the attacker's string in the CSV. Layer D walks key NAMES, so it cannot see a forged VALUE. **Fix: route through the existing tested factory instead of copying the reference.** |
| **F-380** | The report-verification `decision` vocabulary is **re-declared three times** downstream of `PUBLIC_REPORT_STATUSES`, and `app/_lib/types.ts:307` has **zero import relationship** to domain or ports — while `TaskResourceBody` **two lines below it** correctly derives. Renaming a domain token produces **0 tsc errors**; only a live 400 reveals it. The F-140/F-192 signature exactly. |
| **F-381** | `VisionRequest.task` duplicated in `routing.ts:29` and cast **directly from `string`**, so unlike F-380 there is **no structural check at all** — both sides can drift freely with 0 errors. `mock-vision.ts:10` already derives correctly, proving the fix pattern exists in-tree. |
| **F-382** | The two OLDER `NEXT_PUBLIC_` mirrors (`AUTH_DEV_LOGIN`, `FEATURE_CITIZEN_STREAM`) sit **outside** the parity refine built to fix this very class (F-240) — read raw from `process.env` in `app/page.tsx`, no schema entry, no test. Drift = a silently missing control, **and the app boots fine either way**. The silent sibling of the scenario F-240's own comment narrates. |
| **F-401** | **`SPEC.md:142` states `GET /health/adapters` "always 200 while the service is up"; `routing.ts` wires only single-segment `/health`; `openapi.yaml:1160` says "NOT YET SERVED (v1)".** Three documents, two stories — and `DEMO_SCRIPT.md:48` (still README's linked walkthrough) tells the presenter to **film it**. A judge doing the `docker compose up` reproducibility beat can `curl` it per the spec and get 404, in the second-lowest-scoring rubric category. **Fix: film `GET /sources` instead (already carries mode + freshness per source), or wire the trivial aggregate.** |

### 🟡 OPEN — see the full lane reports for F-342/343/345/347–359, F-383, F-402–404
Highlights: **F-347** the aggregate-only denylist has **no concept of location, device/chat id, or image reference** — `geomPrecise`, `latitude`, `chatId`, `photo` all pass, though Art. XIV names precise location as the flagship PII class · **F-350** an unhandled throw escapes as a framework 500 with no envelope (the dispatcher's sanitising `try/catch` never covers feature routes) · **F-351** `/api/v1/stream` has no auth, no RBAC, no rate limit (inert only because nothing publishes yet) · **F-348** the `callsign` mitigation is defeated by typing the name in CAPITALS, which the uppercase-only pattern actively invites — the test proves it rejects *lowercase*, not names · **F-402** the TTTP stopwatch the demo plan says to film **does not exist in the product** (only in a headless perf test) · **F-357** test-claim drift: `no-llm-numbers.contract` is cited in SPEC but does not exist, and two `npm run` scripts in CI_CD.md are not in `package.json`.

### ✅ GUARANTEES THE SECURITY LENS TRIED TO BREAK AND COULD NOT (defensible on camera)
No path emits a CAP without human approval (`capStatus:'ACTUAL'` is set at exactly ONE line, reachable only
through the VERIFIER+ approve route; **F-79 is genuinely closed** — the overload `asEmittable(DraftAlert): null`
makes the laundering branch dead code the compiler rejects) · threshold AND forecast fires produce DRAFT only,
with a compile-time proof `ANTICIPATORY_CANNOT_EMIT` and a DB CHECK backstop · RBAC fail-closed on every route
probed live · no privilege escalation through JWT (`algorithms:['HS256']` pinned; every failure returns PUBLIC
with no `sub`) · the audit actor cannot be forged from the body (a client-supplied `actorId` is **rejected**,
not silently dropped) · **the `$ref` ban is complete and enforced** (F-175 holds) · structured figures never
enter the model payload · logs carry no PII · **the report free-text body is never persisted anywhere** —
the largest PII carrier in a crowdsourced system is minimised out of existence by construction · secrets clean
(`.env` never committed; verified with `git log --all -S`).

### §0o (cont.) — LENS 1 HONESTY findings F-320…F-333. The most consequential of the audit.

| ID | Finding | Orchestrator note |
|---|---|---|
| **F-320** 🔴 | **SSE has NO browser client.** `app/_lib/sse.ts` (containing `subscribeRegionStream` and `useRegionStream`) is imported by **exactly one file: its own test.** No component, provider or page imports it, and there is **no `refetchInterval` anywhere in `app/`** — so the polling rung is not wired either. **The COP as shipped never updates after first load.** The server side is real; the CLIENT dead-ends. | **VERIFIED by the orchestrator** (`grep` over `app/`: only `sse.ts` itself). **This is the FIFTH instance of "code exists, nothing runs it"** — after F-53, F-152, F-280, F-328. It lands on the LOWEST judge-scored category (Timeliness 4.2) and on a beat `RUBRIC_DEFENSIBILITY.md:245` explicitly says to film ("SSE visibly pushing"). **Fix:** mount `useRegionStream` in `app/page.tsx` and invalidate query keys on delta — or delete the SSE demo beats and disclose in §13. |
| **F-322** 🔴 | **ALL 11 Playwright specs call `disableWebGL(context)`**, which drives `MapView` into its `failed` branch. Therefore **every browser gate — axe, the visual baselines, TTTP — ran against the accessible FALLBACK LIST, not the real MapLibre/deck.gl map.** The shipped COP map has **zero browser coverage**. | **VERIFIED by the orchestrator: 11 of 11 spec files disable WebGL.** This is disclosed in `docs/audit/S06_BROWSER_GATES.md` but **absent from README and SPEC §13** — one truthful surface, two silent ones, the F-58 shape. **It also corrects a claim the orchestrator repeated to the entrant several times**: "Playwright 86 passed / 0 failed" is evidence the FALLBACK works, not the map. **Fix:** disclose in README + §13, and add one smoke spec with WebGL ON asserting `map-canvas` mounts. |
| **F-321** 🔴 | The accessible non-visual map alternative (`MapFeatureList`) renders **only in the `failed` branch** (`MapView.tsx:74-88`). The success branch renders `aria-hidden="true"` canvas + layers and **no feature list at all** — so on the happy path a screen-reader user reaches *nothing* of the map. `UI_UX_DESIGN.md:51` states the alternative unconditionally. | WCAG/Usability is a graded category (4.3, second-lowest). **Fix:** render the list on the success path too (visually-hidden or in a disclosure). |
| **F-323** 🔴 | **Five endpoints in SPEC's "canonical" catalog return 404** — `/incidents/:id`, `/incidents/:id/exposure`, `/threshold-rules`, `/audit-events`, `/health/adapters` — proven by running `resolveRoute` directly. Worse, `/incidents/:id/exposure` sits in the **FR-3 golden thread** at `SPEC.md:54`. `openapi.yaml` is the one honest surface (all five carry `x-status: planned` + "NOT YET SERVED (v1)"). | Supersedes/absorbs F-401, which found the same for `/health/adapters` alone. **Fix:** carry the OpenAPI marker into SPEC §2.2 + §1.1 + PRD, and add a §13 bullet. |
| **F-324** 🔴 | `DEMO_SCRIPT.md:48` scripts an on-camera beat showing an **adapter-health board that does not exist** (no component anywhere in `app/_components/`, and the route 404s). | Same root as F-323/F-401. **Fix:** strike the beat or repoint at `GET /sources`. |
| F-325–F-333 🟡/🟢 | The live-test doc asks the human to verify the retention sweep, which cannot run (F-325) · §5b still says SPEC has no known-limitations section, but §13 now exists (F-326) · `SUMMARY.md` lists the retention executor among things "now genuinely wired" (F-327) · **`DRILL_MODE=on` selects nothing in the running app** — `buildDrillDeps` has zero non-test callers; the composition partition is genuinely well-built and machine-enforced, it is simply never entered (F-328) · stale `27/24` adapter counts survive in **7 uncorrected files** (F-329) · whole-suite vitest is timing-fragile: 3 files fail on 5 s timeouts under load and pass 52/52 in isolation (F-330) · the "threshold crosses → DRAFT appears" beat is not a live event; alerts are computed once at composition time (F-331) · `llms.txt` self-declared counts wrong: 27 vs 29 adapter dirs, 13 vs 14 layers (F-332) · one wrong `file:line` in the new §13 (F-333). | F-330 matters for release wording: **"green" is currently load-dependent.** |

**Lens 1 found NOTHING in two categories, stated plainly:** no fallback-ladder mislabelling (no LIVE shown for CACHED/MOCK anywhere), and no LLM-computes-a-number violation reachable in production.

### §0o (cont.) — LENS 3 TEST QUALITY findings F-360…F-373. The write seam is hollow.

**The headline: the backend suite is strong, but the CLIENT→SERVER WRITE SEAM has shipped three live
defects, and the correlation with the systemic root cause is exact.** `app/_lib/types.ts` re-exports two
wire types FROM the server (`ResourcesQuery`, `TaskResourceBody` — the F-140/F-192 fix). Three remain
hand-duplicated: `SubmitReportBody`, `VerifyReportBody`, `RequestRouteBody`. **Those are exactly the three
broken contracts below. 3-for-3** (F-364).

| ID | Finding | Note |
|---|---|---|
| **F-360** 🔴 | **Every SOS coordinate submitted from the real UI is silently discarded.** `sos-form.tsx` sends `{location:{lat, lon}}`; `routing.ts:124-130` reads top-level `lat`/`lng`. **Two mismatches at once** (nested vs flat, `lon` vs `lng`), and because location is optional server-side the response is **200 OK** — silent data loss on the citizen-SOS path. Proven with a real client→real-handler probe: client shape → no geometry; server shape → `geomPrecise` present. | Three tests "cover" this and all three are structurally blind: the component test mocks the hook and **never asserts `location` at all**; the HTTP test hand-builds the correct server shape; the e2e fills only the text box. |
| **F-361** 🔴 | **`POST /routes` 400s on every submit — the routing panel is dead.** Panel sends `{origin:{lat,lon}, regionId}`; server requires non-empty `incidentId`, `origin` as a `[lon,lat]` **array**, and a `destination` field the client type does not even declare. | **The purest instance of the F-140 shape in the repo:** `routing-panel.test.tsx:47` is a GREEN assertion that the client produces a payload the server refuses. No e2e for routing exists at all. |
| **F-362** 🔴 | **"Approve + CAP" is client-only fiction — on the Art. XIII CAP-emission path.** The button sends `emitCap:true`; `emitCap`/`emittedAlert` appear **nowhere under `src/`**. Proven: a real PATCH with `emitCap:true` returns `meta:{decision:'VERIFIED'}` — no CAP, no DRAFT. | **The test that "proves" it works supplies the server's response to itself**: the mock returns `data:{meta:{emittedAlert}}`, then asserts the component renders it. The Approve+CAP button has no `data-testid` and no e2e clicks it. 🔴 because this is the highest-stakes path in the product. |
| **F-363** 🔴 | **The suite is NOT green: `npm test` exits 1, reproducibly.** Two live-composition tests take ~4.1 s and ~4.7 s in isolation against Vitest's default 5000 ms — a **~6% margin** — and cross it under full-suite parallel load. CI runs on a 2-core runner with no override, so CI was strictly more exposed. With `--testTimeout=30000`: 301 files / 3615 passed, exit 0. | **This corrects the orchestrator's own repeated "301 files / 3615 tests, exit 0" reports** — those runs used `--coverage` and happened to win the race. Green was load-dependent, which the determinism rule forbids. **FIX APPLIED: `testTimeout: 30_000` in `vitest.config.ts`** — raises the ceiling without weakening any assertion; making live composition lazy is a behaviour change and belongs in its own task. |
| **F-365** 🟠 | **Coverage `include` omits `app/**` entirely — 71 source files unmeasured**, plus `src/config/**` and `src/ports/**`. The "≥99%" headline applies to `domain`+`application` only (`main` 97/79, `adapters` 90/83; measured total 95.99/91.26). **An excluded path is an unmeasured path — and it is exactly where F-360/361/362 live.** |
| **F-366** 🟠 | `app/_lib/hooks.ts` has **17 exported hooks; 1 is tested.** Every panel test mocks the whole module. The layer that assembles mutation payloads and owns optimistic-update/invalidation logic is exercised by nothing but Playwright, and is invisible to coverage. **This is the structural cause of the F-140 class recurring three times.** |
| F-367–F-373 🟡/🟢 | Two guard blocks have never executed anywhere (`describe.skipIf` on the real-Postgres round-trip and on Ollama-live) — the canonical persistence adapter's SQL is verified only against a fake `db` (F-367) · early-`return` narrowing makes three acceptance assertions vacuous when the value is `null`, including the **offline-redundancy acceptance test** (F-368) · a tautological mode assertion that cannot fail (F-369) · the Art. XIV precise-geometry reveal asserted only as "the field exists" (F-370) · a vacuous wiring test (F-371) · four trivial snapshots, plus the caution that **all 23 snapshots live in one file and 19 pin real provenance/citation content — a blind `vitest -u` would silently re-baseline CAP-adjacent provenance** (F-372) · six guards with no demonstrated failure, each with the exact plant that would prove it, including that `f9-domain-purity` matches only STATIC imports so `await import('next/server')` **evades it silently** (F-373). |

**GUARDS THE LENS VERIFIED AS GENUINELY TRUSTWORTHY** (do not re-verify these):
`api.task-resource.e2e.test.ts` — the model the rest of the write path should copy · `mappers.contract.test.ts`
— the fixture IS the wire, closing the READ seam · `d6-no-pii.test.ts` — four layers that **plant their own
violations**, with a self-healing `@ts-expect-error` idiom · **the coverage gate is live (F-43 class closed)**
— forced, and every floor fired by name · **no live network anywhere, PROVEN**: the full suite ran with
`fetch` stubbed to throw and all non-loopback TCP blocked → 301 files / 3615 passed, exit 0 · **no cross-file
order dependence** — full suite shuffled with a fixed seed, exit 0 · **F-240 has been fully internalised**:
all three flag-default tests now pin the documented decision AND separately construct the explicit off state.

---

## §0p — MW-E RESOLUTION PASS (2026-08-01). Fixes landed + FIVE NEW findings the fixes exposed.

**The write seam is closed as a CLASS, and closing it surfaced five more instances of the same defect.**
That is the expected shape of a derived-types sweep: once the compiler is allowed to check the wire, every
remaining hand-mirror announces itself. Six of the eight wire types in `app/_lib/types.ts` were hand-written;
**five of the six were wrong**. The two that were already derived were both correct. The evidence for
"derive, don't copy" is now overwhelming and should be treated as settled law in this repo.

### FIXED THIS PASS

| ID | Status | Resolution |
|---|---|---|
| **F-363** | ✅ CLOSED | `testTimeout: 30_000`. **VERIFIED** — plain `./node_modules/.bin/vitest run` (no `--coverage`): 301 files / 3618 tests, **exit 0**. The load-dependent failure is gone. |
| **F-360** | ✅ CLOSED | `SubmitReportWireBody` declared next to its parser (`routing.ts`); client type DERIVED; `sos-form.tsx` sends top-level `lat`/`lng`. Proven by a real-client-through-real-server test asserting the coordinate **by value** after a round trip through the RBAC-gated `GET /reports`. |
| **F-361** | ✅ CLOSED | `RouteWireBody` declared next to `parseRoutes`; client type DERIVED; `origin` is a `[lon,lat]` Position. **The server was also wrong against its own published contract** — `openapi.yaml` has always documented `destination` as optional ("if omitted, the nearest open shelter is the destination") while `handleRoutes` hard-required it. `resolveDestination` now picks the nearest **OPEN** shelter server-side (Art. XII), or returns a typed NOT_FOUND rather than routing to nowhere. |
| **F-362** | ✅ CLOSED | `VerifyReportWireBody` DERIVED; `emitCap` now read, validated as a strict boolean (no truthy-string coercion on an Art. XIII lever), and honoured. **The root reason it could never have worked: `PublicReport.incidentId` is a nullable FK in the entity, the DDL and `openapi.yaml`, but NO channel ever carried it — every report was orphaned, so a VERIFIED report had no incident to scope an alert to.** Intake now carries the link end-to-end (port → command → router → both stores). Art. XIII holds at three independent points: VERIFIED-only, DRAFT-only (`AlertSinkPort.emit` accepts only an approved ACTUAL **at the type level**), and an unlinked report drafts nothing and **says so** (`meta.capNotEmitted`) instead of inventing an incident. |
| **F-320** | ✅ CLOSED | `useRegionStream` is mounted for real (`app/page.tsx` → `RegionStream` → `useRegionSync`). Delta → precise TanStack invalidation via prefix builders added to the existing `queryKeys` object (no parallel key design). Unknown delta vocabulary refetches MORE, never less — a swallowed delta is the "stale COP that looks live" failure. **Plant/fail evidence: removing the mount line fails 6/6; neutering only the invalidation body fails 3/6 while the 2 mount-only tests stay green** — so neither half is vacuous. |
| **F-340** | ✅ CLOSED | The token-bag membership check is replaced by `narrationIsFigureFree` — Unicode `\p{N}` (not ASCII `\d`), number-words, and ranking-words, with a bounded non-quantity idiom allowlist. **Plant/fail: 8 planted bypasses, ALL 8 ACCEPTED by the shipped guard, all 8 rejected after.** A 9th was found during the work (Arabic-Indic numerals — the narrator is multilingual across 14 locales, and `\d` is ASCII-only). |
| **F-341** | ⚠️ PARTLY CLOSED | AI-generated badge on the SitRep summary in all 14 locales. **The EDXL-SitRep export surface is still unlabelled — see F-410.** |
| **F-323/F-401/F-324/F-322** | ✅ CLOSED (docs) | Five endpoints proven 404 by EXECUTING both route tables, each with the deciding `file:line`; SPEC rows kept and marked NOT SERVED rather than deleted; the `/health/adapters` "always 200" claim withdrawn as false; the demo beat that filmed it struck and replaced with a beat that is real (`GET /sources`). WebGL-off disclosed in README + SPEC §13.8. |

### NEW FINDINGS — all five are the SAME class, found because the compiler could finally see the wire

| ID | Finding | Status |
|---|---|---|
| **F-406** 🔴 | **`RouteData` was wrong in three ways at once, on the response side of the endpoint whose request was F-361.** It declared `geometry?: unknown` where the server sends `route: EvacRoute` — so the panel's route was *permanently undefined* even after the request was fixed — and invented `ShelterMatch.name` and `.demand`, fields the `Shelter` entity has never had. All three typechecked. | ✅ FIXED — `RoutesData` named in `logistics.ts`, client DERIVED; `ShelterMatch` is now the domain `Shelter`. |
| **F-407** 🔴 | **`AlertResult` declared `{id, state}`; the response carries `{alert, headline}` and the alert's CAP marker is `capStatus`.** Every field of `draftAlert()`'s result read `undefined`. **The verifier queue hid it perfectly**: it rendered `emitted.state ?? 'DRAFT'`, printing a confident "DRAFT alert DRAFT" whether or not the server said anything — **a defaulted display of an UNREAD field on an Art. XIII surface.** Its component test supplied a fake `state` key and passed. | ✅ FIXED — `AlertDraftData` named; client DERIVED; the masking fallback removed with the wrong key; the fixture rebuilt on the real vocabulary. |
| **F-408** 🟠 | `RegionDelta` (client) and `StreamDelta` (server) were hand-duplicated. **They AGREED** — which is exactly why it was worth converting: the three that disagreed typechecked just as cleanly. Correctness of a copy is a property of today, not of the contract. | ✅ FIXED — DERIVED. |
| **F-409** 🔴 | **The FR-8 "capacity vs demand" widget rendered a CONSTANT `0/capacity` at 0% for every shelter, and the over-capacity octagon was unreachable in the product** — it read the invented `s.demand`. Its test set `demand` in the fixture, so it certified a rendering the product could never produce. | ✅ FIXED — reads OCCUPANCY, the demand the entity actually models. Projected demand is modelled nowhere, so displaying it would be inventing a figure (Art. XII). |
| **F-410** 🟡 | `edxl-sitrep-mapper.ts:97` exports `executiveSummary: sitrep.summary` — **AI-authored prose crossing an agency boundary with no authorship marker** (Art. VI). The F-341 badge is a UI affordance and does not reach this surface. Fixing it means adding a field to `EDXL_SITREP_SCHEMA` — a contract decision, not a UI one. | OPEN — needs a schema decision. |
| **F-411** 🟡 | `docs/architecture/decisions/ADR-033` describes the Art. XII guard as a membership check in 5 places; stale after F-340. `docs/audit/FINAL_AUDIT.md:129` says "21 paths"; the real count is 29 paths / 32 operations. `POST /alerts/{id}/all-clear` **is served but has no `openapi.yaml` path entry**. | OPEN — doc/contract truth-up. |

### THE STANDING LESSON, now proven twice over
**Do not re-declare a contract — derive it.** Ten instances before this pass (F-24, F-140, F-141, F-190,
F-192, F-240, F-72, F-380, F-381, F-382), five more found in it (F-406…F-409 plus the three closed).
The counter-argument "our copy is correct" is refuted by F-408: the copy that AGREED sat one rename away
from silently freezing the COP. **A derived type makes the next divergence a compile error; a correct copy
makes it a browser bug nobody sees.**

### THE SECOND LESSON — a mask is worse than a gap
F-407's `?? 'DRAFT'` and F-409's `?? 0` did not merely fail to show the truth; they **manufactured a
plausible-looking value for a field that was never read**, on the CAP-emission and shelter-capacity
surfaces respectively. A blank is a visible defect. A default is an invisible lie. Prefer failing visibly.

### §0p ADDENDUM — closed after the first pass (same session)

| ID | Finding | Resolution |
|---|---|---|
| **F-344** ⚠️ | **MY OWN FIX WAS THE REGRESSION.** The guard I landed earlier copied `handleDevLogin`'s condition verbatim: `NODE_ENV === 'production' \|\| DEPLOY_MODE === 'cloud'`. **`NODE_ENV=production` means "optimized build", not "internet-reachable deployment"** — `next start` sets it for `docker compose up`, for the demo that gets FILMED, and for the Playwright suite (which uses a prod build deliberately, for deterministic timing). Every actor would have silently resolved to PUBLIC: no role switcher, no verifier queue, no logistics board, on camera. | ✅ NARROWED to `DEPLOY_MODE === 'cloud'` OR (`production` AND not explicitly `local`). Residual risk written into the code, not hidden: a cloud host setting BOTH `DEPLOY_MODE=local` and `AUTH_DEV_TRUST_HEADER=on` re-opens it — two explicit, individually documented mistakes, and the price of having a local demo at all. `handleDevLogin` keeps the stricter rule (no local flow needs it). +3 tests, incl. the prod-build-with-explicit-local case the first version broke. |
| **F-350** (general) | Lane D fixed the incident-summary instance; the CLASS remained. `http-dispatcher.ts` called `handleFeatureRoute` **bare, outside any try/catch**, while `dispatchCommand` three lines below it was wrapped — so a throw anywhere in logistics/interop/map/queue escaped `handleHttp` and became a framework 500 with **no envelope**, potentially rendering a stack or an internal message (a connection string) to the caller. **The asymmetry WAS the bug**, exactly as in F-344. | ✅ FIXED — `dispatchFeature` wrapper with the identical failure contract. **Plant/fail: reverting the wrapper propagated `Error: postgres://user:hunter2@db:5432/beacon` straight out of `handleHttp`;** 2 tests now pin a 500 carrying `{code,message}` ONLY — no stack, no credential. |
| **F-347** (sibling) | The four LLM-egress PII patterns (email/ssn/phone/credit-card) match **no coordinate**. `geomPrecise` — the STRUCTURED field — was already gated, but a reporter typing *"I'm at 38.5816, -121.4944"* into SOS free text sent their exact position to a cloud LLM unredacted: the Art. XIV disclosure arriving through the one field a schema cannot constrain. | ✅ FIXED — `coordinate-pair` + `coordinate-dms` patterns. Deliberately require BOTH halves with decimals and bound lat to ±90 / lon to ±180: a lone `12.4` is a crest height far more often than a latitude, and a pattern that ate `"crest at 12.4 feet"` would silently starve the narration of the facts it must cite. **Both directions tested against the REAL `config/policies.yml`; plant/fail confirmed all three position formats leak without them.** |
| **F-410** | `edxl-sitrep-mapper.ts` exported AI-authored prose **across an agency boundary with no authorship marker** (Art. VI). The only statement of AI authorship lived in the JSON-Schema's `description` text — **a human-readable comment in a schema is not a disclosure to a machine.** The F-341 badge is a UI affordance and never reaches this surface. | ✅ FIXED — `summaryAuthorship: AI_GENERATED \| DETERMINISTIC`, DERIVED from `sitrep.aiMode` (never passed in), added to both the emitter and `edxl-sitrep.schema.json` (`additionalProperties:false` means the schema and emitter must agree — asserted). `deterministic-only ⇒ DETERMINISTIC`, because claiming AI authorship when no model ran is its own misstatement. 3 tests; **all 3 failed before.** |
| **F-411** | ADR-033 §2.3 described the Art. XII guard as a membership check in 5 places (stale after F-340); `FINAL_AUDIT.md` claimed "21 paths / 47 schemas" and "23 ADRs"; `POST /alerts/{id}/all-clear` was **served but undocumented**. | ✅ FIXED — ADR-033 gains a dated Resolution note (original preserved verbatim) explaining that the companion validator it specified is **subsumed**, and recording the stricter rule's honest cost. `FINAL_AUDIT` gains a drift warning with machine-counted figures (30 paths / 33 ops / 63 schemas, 38 ADRs) and **withdraws its `/health/adapters` claim as false**. The all-clear path added to `openapi.yaml`. |

**F-323 found five DOCUMENTED-BUT-UNSERVED paths; F-411 found one SERVED-BUT-UNDOCUMENTED.** Same failure
to keep one contract, opposite directions, equally misleading to anyone reading the API surface.

### THE THIRD LESSON — symmetry is an argument, not a proof
F-344 and F-350 are the same mistake made in opposite directions on the same file. F-350 existed because one
of two sibling dispatch paths was hardened and the other was not; F-344 was introduced by copying a
neighbouring guard's condition **without asking whether the signal means the same thing in both places.**
Copying a condition is sound reasoning about INTENT and tells you nothing about applicability. **Run it.**

### §0p — E4 BROWSER GATE. The suite was NOT green; three real defects, none of which any other gate could see.

**First full 4-project Playwright run: 22 failed / 152 passed / 26 skipped.** Every other gate was green at
the time (eslint 0 · tsc 0 · vitest 303 files / 3719 tests exit 0 · coverage floors met · depcruise 0/726 ·
`next build` ✅). **This is the third time this session that a green non-browser gate concealed a live
defect**, and the clearest argument yet for why E4 exists.

| ID | Finding | Status |
|---|---|---|
| **F-413** 🔴 | **Five map layers were UNREACHABLE in the shipped product.** The layer-toggle panel renders 14 rows, each at least 44 px (`min-h-11`, the WCAG 2.2 target-size floor) plus caveat lines — over 800 px — inside a Popover anchored to the toolbar at the TOP of the page, **with no scroll region**. Everything from "Exposure" (the 10th row) downward ran off the bottom of the viewport and could not be clicked or tabbed to, **on a 1440×900 desktop as well as on phones**. 17 of the 22 failures. | ✅ FIXED — `max-h-[60vh] overflow-y-auto` on the list. **Why only the browser could catch it: jsdom renders all 14 rows, so every component test passed and every row was "present". Presence is not reach.** |
| **F-412** 🟠 | `forecast-draft-alert.spec.ts` asserted **every** alert in `/alerts` is DRAFT. All four Playwright projects share ONE in-memory server, and `golden-path.spec.ts` deliberately drives the real HITL gate on `ca-alert-draft-1`. So project 1 passed and projects 2–4 failed. **The assertion was FALSE in a correct system** — an alert an authenticated human approved through the audited gate is the invariant working, not a counterexample. The spec's own header claimed it was "free of order-dependent state". | ✅ CORRECTED (not relaxed) — the engine-authored invariant still covers every alert nothing has approved; the single HITL-promoted id is excluded **by name, with its reason**, and a non-vacuity assertion guards the exclusion from swallowing the whole set. |
| **F-414** 🟡 | The new WebGL-ON spec **passed on both desktop projects and failed on tablet + phone** — and the failure is informative: the container had acquired MapLibre's own `maplibregl-map` class, so **the real engine genuinely mounted**; it simply had no visible box. `cop-layout.tsx:80-92` gives the map slot `min-h-0 flex-1` in a column on small viewports, sharing height with a scrollable dock, so it can collapse to zero height. | ⚠️ **SCOPED, NOT SOLVED.** The gate now claims only what it has evidence for: **on desktop, the real WebGL map mounts and paints — F-322's core hole is closed.** Whether the phone/tablet collapse is correct responsive behaviour or the map vanishing on a phone is **NOT diagnosed**, and is recorded as open rather than asserted from a class name. **Do not film a phone map shot until this is checked.** |

**What F-413 says about the other gates.** The layer panel is exercised by component tests (all green), by
the visual baselines (which photograph the panel *as rendered*, including the unreachable overflow), and by
axe (which audits the DOM, where every row exists and is correctly labelled). **All three were green while
five layers were unusable.** The only instrument that could see it was one that tried to CLICK the control.

## §0q — E5 (2026-08-01). Remaining findings fixed; TWO NEW ONES; S08 sign-off.

| ID | Finding | Status |
|---|---|---|
| **F-415** 🟠 | **A stated verification did not exist.** `docs/requirements/EARS_FINAL_VERSION.md:325` says NFR-F2 (client-JS budget) is *"Verified by: build-size check in perf spec"*. `e2e/perf.spec.ts` was **36 lines and measured only TTTP**. This is the "code exists, nothing runs it" class one level up — **the claim of verification was itself the thing that did not exist**, sitting in the requirements register where it is least likely to be questioned. | ✅ FIXED — the check now exists, in the file the requirement names. **Honest scope change recorded in code:** NFR-F2 is written as "**added** JS ≤ +300 KB", which is **unmeasurable retroactively** (no pre-feature baseline was ever recorded, so there is no "before" to subtract). Rather than fabricate a baseline, it enforces a TOTAL ratchet: JS **888.2 KB gzipped** (ceiling 950) and fonts **502.1 KB / 13 files** (NFR-F3 ceiling 1024). Both guarded against vacuity — an empty glob fails rather than passes. |
| **F-416** 🔴 | **The SSE delta channel has NO server-side publisher.** `EventBusPort.publish` is declared, implemented, and called from **no production code path** (repo-wide grep for `.publish(` outside tests: nothing). A connected client gets `hello` + heartbeats forever; the COP refreshes on the 15 s POLLING rung. **Sixth instance of "code exists, nothing runs it"** (F-53, F-152, F-280, F-328, F-320). Lands on **Timeliness — the lowest-scored rubric category (4.2)** and on a portal claim. | ⚠️ **RECORDED, NOT FIXED — deliberately.** The publisher needs a region for its topic and `report`/`verify` do not carry one (only `alert:draft` resolves one, via its incident). That is a design decision, not a one-liner, and rushing an Art. XIII-adjacent path at the end of a long session is precisely what produced F-344. **Every claim corrected instead:** `DEMO_SCRIPT.md` talking-point 1 no longer says "push (SSE)" and carries a DO-NOT-SAY warning; `README.md` says "auto-refreshing COP (SSE channel + polling rung)"; new **SPEC §13.12** states the whole thing with the seam mapped for the next session. |

### Also corrected in E5
- **`npm audit`: 0 high / 0 critical** (Gate 5 PASS). 4 moderate, all transitively under `drizzle-kit`, a **dev-only** dependency — stated rather than silently passed over.
- **`SSE_MAX_CONNECTIONS` is now wired** (F-351 follow-up). The cap existed but no env var reached it — **a knob that is not wired is not a knob.** Read at the route beside `heartbeatMsFromEnv` (the established local idiom; `SSE_HEARTBEAT_SEC` is not in `config/index.ts` either, so routing one value through a second config pathway would have been the inconsistency). Fail-closed: a malformed value falls back to the default rather than disabling an availability guard.
- **`CONFIGURATION.md` said `SSE_HEARTBEAT_SEC` defaults to `20`; the code says `15`.** Corrected — the F-411 count/value-drift class.
- **README gate figures refreshed** to the measured 2026-08-01 values (they still claimed `depcruise 0/723`, `301 files / 3615 tests`, `Playwright 86 passed`).

### A measurement error worth recording, because the trap is reusable
The first font measurement read **903.5 KB across 19 files** and I was about to report "88% of budget, one
script from breaching". It was taken over a `.next` directory that had **not been cleaned** — stale hashed
assets from earlier builds accumulate in `static/media` and are indistinguishable from current ones by name.
A clean build reads **502.1 KB across 13 files**, about half the budget. **Always measure build size after
`rm -rf .next`.** Recorded in `e2e/perf.spec.ts` so the next person does not repeat it.

### §0q ADDENDUM — F-416 IMPLEMENTED AND BROWSER-PROVEN (entrant's call, same session)

**Reversal recorded honestly:** two hours earlier I declined to implement this and corrected the docs to
stop claiming push, on the grounds that rushing an Art. XIII-adjacent path at the end of a long session is
what produced F-344. The entrant then asked for it explicitly, which converts it from a rushed patch into a
deliberate task — a different thing, and the right call.

**What landed.** `publishDelta` (`http-dispatcher.ts`) publishes a region-keyed delta after every successful
mutating command. `regionOfIncident` (`command-router.ts`) resolves the region the router already had in
hand and surfaces it as `meta.regionId`; the dispatcher publishes on it. Layering is preserved — the
application layer never learns about the SSE transport, and the adapter never learns how to resolve an
incident.

**Four load-bearing properties, each tested:**
1. **Art. XII** — the frame carries EXACTLY `{type, region, entity, at}`. Asserted as an exact key set, in
   the unit test AND in the browser: no figure can ever ride the channel. A delta is a doorbell, not a delivery.
2. **THREAT T13.1** — region-keyed; a `ro` subscriber receives nothing from a `us-ca` change (browser-proven).
3. **Art. XVI** — an unattributable change (SOS against no incident) publishes NOTHING rather than
   broadcasting to a shared topic; the polling rung still carries it.
4. **Never fails the write** — a publish failure is swallowed; a subscriber problem must never turn a
   citizen's SOS into a 5xx. Tested with a throwing bus.

**Verified where it counts.** The unit test proves the dispatcher calls `publish` — necessary, not
sufficient, because it stubs the bus. `e2e/sse-push.spec.ts` proves the WHOLE chain with no stubs: browser
`EventSource` → Next route → `handleStream` → the process-wide bus → a real HTTP mutation, **delta observed
in ~1.7 s**. Since the polling fallback is 15 s, **that latency is itself the proof it was push**.
Plant/fail: removing the one `publishDelta` call fails the guard.

**Claims flipped back to TRUE** in `DEMO_SCRIPT.md`, `FINAL_LIVE_TEST_AND_DEMO.md` (§M + shot 3),
`SPEC.md` §13.12 (kept as a RESOLVED entry with the original finding preserved in a `<details>` block —
the defect shape is worth more than a tidy ledger) and `README.md`. **Shot 3 is filmable again**, on the
lowest-scored rubric category.

**Final gates, all machine-produced 2026-08-01:** eslint **0** · tsc **0** · vitest **303 files / 3723
tests, exit 0** with coverage floors met · depcruise **0 / 726** · `next build` ✅ · `npm audit` **0 high /
0 critical** · Playwright **186 passed / 30 skipped / 0 failed** · openapi **30 paths / 33 ops / 63 schemas**.

**Master sign-off plan delivered** (internal; final state consolidated in README + CHANGELOG).

## §0r — OPEN-FINDINGS SWEEP (2026-08-01, post-S08 at the entrant's request)

### F-181 ✅ CLOSED — deliberate inspection found NOTHING WRONG
The finding asked for a deliberate read of `src/config/index.ts` (a five-lane hot file) "rather than
trusting that green gates imply a clean merge". Done, and it is clean:
- **60 config keys · 0 duplicates · 0 undocumented** — every key is present in `.env.example` (checked by
  machine, not by eye).
- The browser-mirror machinery is **correctly derived, not duplicated**: `D4_D6_BROWSER_MIRRORED_FLAGS` +
  `D2_BROWSER_MIRRORED_FLAGS` compose into `BROWSER_MIRRORED_FLAGS`, and BOTH the parity `superRefine` and
  the inheritance `.transform` loop over the composed list — so the check and the list cannot drift apart.
  This is the F-153/F-364 principle applied correctly in the one file most exposed to it.
- **All 11 mirrored `NEXT_PUBLIC_*` flags have real consumers.** Checked per-flag after a first, too-narrow
  grep suggested only 3 did — the initial reading was wrong and is recorded here so nobody re-derives it.
  **Verify the negative before reporting it: "I could not find a caller" is not "there is no caller".**

**A clean result from an inspection is a result.** F-181 was a standing warning, not evidence of a defect,
and it is now discharged with evidence rather than left open indefinitely.

### F-241 ✅ NOT A DEFECT — it is a recorded LESSON, already learned
"Whole-repo gates were observed red mid-session purely from sibling-lane in-flight work — **do not diagnose
a concurrent tree**." Nothing to fix. It was applied repeatedly this session (failures were attributed by
filename to the owning lane and re-checked only at stable points). Closing it as a lesson, not a task.

### F-154 ⚖️ DECIDED: DOCUMENT, DO NOT IMPLEMENT — and the rules make this decision, not preference
The choice was "ship the FEMA Open-Shelters adapter or document the limitation". **Implementing it now
would violate two standing project rules:**
1. `audit/DATA_SOURCE_VERIFICATION.md` contains **no entry for FEMA Open-Shelters** — endpoint, licensing,
   auth, rate limits and availability are all unverified. `AGENTS.md` §7 (Research Gate) forbids calling any
   API not confirmed in official docs.
2. `AGENTS.md` §9 lists "**any data source whose licensing/availability is unconfirmed in
   `DATA_SOURCE_VERIFICATION.md`**" as an ALWAYS-pause-and-ask HITL trigger.

Writing an adapter against an endpoint nobody has verified is precisely the "confident and unverified"
failure this project has spent a wave eliminating — and a shelter feed is a life-safety surface.

**The limitation is already documented honestly and completely** — `docs/SPEC.md` §13 (shelters are seeded
fixtures at `src/adapters/persistence/seed.ts:66-68`; every `SOURCE_RECORD` correctly reads `MOCK`) and
`docs/FINAL_LIVE_TEST_AND_DEMO.md` §5b. **The MOCK label is honest labelling of a real gap, not a bug.**

**👤 To ship it instead** (entrant's call): first add a verified row to `DATA_SOURCE_VERIFICATION.md`
(endpoint, licence, auth, rate limit, coverage, LIVE/CACHED verdict) from authoritative FEMA documentation.
The adapter itself is then the well-worn 3-file pattern + registry + manifest row — small, once the source
is verified. **The verification is the work; the adapter is not.**

## §0s — POST-S08 OPEN-FINDINGS SWEEP (2026-08-02). Five lanes; three NEW findings, one of them Critical.

### The finding that mattered most had nothing to do with code
**🔴 `docker compose up` — the README's headline "one command" — DID NOT WORK.** The compose file lives at
`infra/docker-compose.yml`; from the project root the command exits 1 with `no configuration file provided`.
**It is the first command a judge types**, and the sign-off plan §9 rates "judges clone and something
breaks cold" as the only **Critical** risk in the register. Fixed in `README.md`, `docs/QUICK_GUIDE.md`,
`.env.example` and the sign-off plan. The compose file's own header had documented the correct form all
along — **the docs disagreed with each other and the one a judge reads first was the wrong one.**
Also fixed: a README link to `agents/CONSTITUTION.md`, which 404s in every clone (`agents/` is gitignored —
0 tracked files).

### F-417 🔴 — a red test reporting a REAL product fault, fixed at the root
Three tests failed on the Art. XIII approve-with-CAP path. Root cause: `defaultReportQueueSeed` minted both
verifier-queue rows with **no `incidentId`**, so `emitCap` correctly answered `capNotEmitted` — meaning
**"Approve + CAP" on either pre-seeded row emitted nothing at all.** The scripted golden path survived only
by accident (it files a fresh SOS with an incident selected); a presenter opening the queue directly — the
obvious thing to do — would have got nothing, on camera.

**The choice of fix was the whole point.** Changing the tests to file their own linked SOS would have turned
the build green **and left the defect in place with nothing looking at it**. The seed was linked instead,
pinned by a test asserting the id equals the canonical `CA_INCIDENT` from `scenario-inputs.ts` (the adapter
cannot import the composition root, so the literal needed a guard). Plant/fail verified.

### F-153 — the count was UNDERSTATED, and the ninth copy was the worst
The finding named six copies of the "https URL to a named host" rule. **There were nine.** Seven converged,
two preserved *because they were STRICTER* (`cnadnr-ro`'s host allow-list; `routing.ts`'s SSRF intake gate
with host+path allow-list and userinfo rejection). **A convergence that weakens a security check is worse
than the duplication it removes** — that was the operative rule, and it changed two decisions.

Every other copy was WEAKER than the shared policy, so all seven convergences *strengthened* their site.
The ninth (`app/_components/map/build-layers.ts`, converged separately once its owning lane finished) was
the weakest of all and sat on **the last hop before `window.open`**. Measured old-vs-new:

| input | old `startsWith('https://')` | shared `isLinkOnlyUrl` |
|---|---|---|
| `https://192.0.2.1/camera/live` (IP literal) | **accepted** | rejected |
| `https://<3000 chars>.com/x` | **accepted** | rejected |
| `https://cams.example.org/live` | accepted | accepted |

Divergence is now a **compile error** (branded `LinkOnlyUrl`), plus `tests/architecture/link-policy-sites.test.ts`
— a fitness function that scans every non-test file and fails if a new copy appears **or if a DECLARED
exception stops matching**. It immediately caught my own convergence and made me delete the stale
declaration: *the exception list cannot rot into a lie.* It is also what found sites 7–9.

### F-176 — converged into ONE strictly stronger check
The surviving recursive `additionalProperties:false` walk beats the union of both originals: it runs over a
glob rather than five hard-coded files, and detects an object subschema by `type:'object'` **or** the
presence of `properties` — so a typeless subschema that **neither** old check caught is now blocked.

### F-365/F-366 — the structural cause is now measured
`app/**` is in the coverage `include` (71 previously-unmeasured files, *exactly where F-360/361/362 lived*)
with a measured-minus-margin ratchet floor of 89/86/89/89 against a measured 90.57/87.95/90.27/90.57.
The hooks layer has real tests driving real requests through the real server.

### The largest honesty finding — claimed TEST INFRASTRUCTURE that does not exist
`TEST_PLAN.md` and `CI_CD.md` describe 17 Gherkin `.feature` files, Stryker mutation ≥80%, fast-check PBT,
Testcontainers, Toxiproxy, a metamorphic suite, and `api-surface`/`benchmark`/`compliance` CI jobs.
**`find -name '*.feature'` returns zero. None of it exists.** "A PR fails if any FR lacks golden+error+edge
coverage" is enforced by nothing. Both files now carry an as-built exists/absent table; nothing aspirational
was deleted, because deleting it would hide that the project intended it.

**This generalises F-415 and is the sharpest lesson of the sweep: the claim of a VERIFICATION is the
least-questioned kind of claim in a repository, and therefore the most likely to be false.** Every
"Verified by" / "Tested by" cell in the requirements register was opened against the file it names; NFR-F3's
repo-growth half, NFR-F4 and NFR-F6 have no check at all, and NFR-F2's check measures a *different quantity*
than the requirement states.

### Also closed
**F-181** (config inspection — nothing wrong: 60 keys, 0 undocumented, mirrors all consumed) ·
**F-241** (a lesson, not a defect) · **F-154** (decided: document, because the FEMA source is unverified and
building against it would breach the §7 Research Gate and the §9 HITL trigger on a life-safety surface) ·
**F-414** (measured at 378×0 phone / 776×0 tablet — the live map was clipped to nothing; fixed, and the
desktop-only skip removed so all four projects now assert it).
