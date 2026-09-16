# BEACON — S03 specification delta: THE FINAL COMPLETE VERSION

> **GABBE phase:** S03 (technical spec) for `../../CURRENT-MASTER-PLAN.md`.
> Requirements: `requirements/EARS_FINAL_VERSION.md` · Architecture: ADR-030…036 · Backlog:
> `../project/TASKS-FINAL-VERSION.md`. **This file is a DELTA** — `SPEC.md` remains the spec of record and
> is updated in place at MW-E/E1. Everything below is **additive**: no existing contract is broken.
> ⛔ Agents never run git commit/push/tag.

## 1. Contract-change principles (apply to every item)

1. **Additive only.** New domain fields are optional; new API fields are additive; new DB migrations add
   columns/tables and never rewrite. A v1 client that ignores every new field keeps working.
2. **Enums grow, they never change meaning.** Adding `STORM` / `TRACK` / `CONE` / `STORM_SURGE` /
   `ESCALATION` / `IMPACT_OVER_TIME` widens closed vocabularies; existing tokens keep their exact semantics.
   Every widening must land in BOTH the TypeScript union and the DB `CHECK` constraint in the same change.
3. **Machine values are never translated.** CAP/EDXL tokens, identifiers, geometry, and units of record stay
   as they are in every locale (FR-I18N-6 / FUW-2).
4. **Numbers stay deterministic.** Every field added below is produced by typed code, never by the LLM
   (Art. XII). The output-validator contract grows to cover likelihood WORDS as well as digits.
5. **Config, not code.** Thresholds, protocol definitions, clearance parameters, CAP profiles, and plain-
   language templates are data files validated by a JSON-Schema — never literals in a use-case.

## 2. New schema artifacts

| Schema | Validates | Wave | Status |
|---|---|---|---|
| `schemas/locales.schema.json` | `config/locales.json` (shipped-locale registry) | MW-A | ☑ shipped |
| `schemas/regions.schema.json` | `config/regions.json` incl. required `iso` / `tz` / `languages`, minus the misleading `units` | MW-B | ☑ shipped |
| `schemas/likelihood-thresholds.schema.json` | `config/likelihood-thresholds.json` — the source-signal → likelihood-class threshold table; `source` and the displayed `method` are **required** per row, so no band can ship without stating where the number came from | MW-C | ☑ shipped |
| `schemas/eap.schema.json` | `config/eap/*.json` — the six IFRC EAP elements, `stop` **required** | MW-D | ☐ |
| `schemas/cap-profiles/*.schema.json` | selectable CAP profile rules (`CAP_PROFILE`); IPAWS rules are **transcribed from the authority's published spec at implementation time, never invented** | MW-D | ☐ |
| `schemas/d6-*.schema.json` | the five D6 aggregate entities, `additionalProperties: false` (this is what the person-identifying-field guard walks) | MW-D | ☐ |
| `schemas/incident-summary.schema.json` | the incident-close export payload | MW-D | ☐ |

**Dead schema to resolve (F-33):** `schemas/threshold-rule.schema.json` has zero code references and has
drifted from its domain type. At MW-E either wire it or delete it — a schema nobody validates against is
worse than none, because it reads as a guarantee.

## 3. Message catalogs (MW-A)

- `messages/<locale>.json`, ICU syntax, namespaced by surface, with a `_meta` block
  (`locale`, `review`, `machineTranslated`). English is the source and the fallback.
- **Key parity is a build gate**: every catalog has exactly the English key tree; ICU arguments may not be
  invented, dropped, or renamed; no blank or placeholder values (`tests/i18n/catalog-parity.test.ts`).
- Catalog keys are **compile-checked** at every call site — a typo is a `tsc` error, not a runtime blank.

## 4. Domain deltas

| Entity | Addition | Wave | Notes |
|---|---|---|---|
| `Incident` | `STORM` incident type | MW-B | + DB `CHECK` |
| `HazardGeometry` | `TRACK`, `CONE`, `STORM_SURGE` kinds | MW-B | `SPREAD_CONE` is the *wildfire* cone and is NOT reused (F-19); + DB `CHECK` |
| `Gauge` | `exceedanceProbability?`, `tendency?` | MW-C | the fields the GloFAS ACL currently parses and throws away (F-15) |
| `Prediction` | `likelihoodClass?` (`POSSIBLE`\|`LIKELY`\|`VERY_LIKELY`), `etaHours?`, `hazardArrival?` | MW-C | class derives ONLY from source-provided signals |
| `Prediction` | `ESCALATION`, `IMPACT_OVER_TIME` kinds actually constructed | MW-C | already in the enum + DB CHECK, never built (F-16) |
| SitRep / COP slice | `predictions[]` **plural** end-to-end | MW-C | 6 lockstep sites |
| `Alert` | `msgType`, `references[]`, `responseType`, `urgency`, `certainty`, structured text | MW-D | Update/Cancel/all-clear are unconstructible today (F-29) |
| `Region` | `iso`, `tz`, `languages[]` | MW-B | currently parsed into region meta and dropped (F-04/F-05) |
| `Resource` | volunteer TEAM + SUPPLY kinds (`SUPPLY` already exists) | MW-D | aggregate-only; no person-identifying field may exist |
| `PublicReport` | damage/needs category + aggregate casualty tally | MW-D | tally always labeled "unverified — not authoritative" |
| new | `EarlyActionProtocol`, `TriggerEvaluation`, `TriggerState`, `LedgerEntry` | MW-D | evaluation is pure and clock-free |
| new | `PredictedImpact` (people · alert-reach · shelter demand · clearance) | MW-D | every figure carries method + inputs + uncertainty |

> **Correction (2026-07-27, MW-C/C1.3 implementation):** the `Prediction` row above lists `hazardArrival?`
> among the entity's additions. It is **not** a field on `Prediction`, and shipping it as one would have been
> a real defect: `hazardArrival` = now + `etaHours`, so storing it forces a wall-clock read into
> `makePrediction`, which every other domain factory in this codebase refuses to do (`makeGauge`,
> `makeHazardGeometry`, `makeAlert` all take injected timestamps). ADR-033 §3 and its "Alternatives
> considered" already decided this explicitly — hazard arrival is **computed at the application layer** from
> an injected clock (`src/application/forecast-likelihood/forecast-likelihood.ts`), exactly as `horizon`
> already is. Implemented that way; the delta row is corrected here rather than quietly reinterpreted. The
> other three additions (`likelihoodClass?`, `etaHours?` on `Prediction`; `exceedanceProbability?`,
> `tendency?` on `Gauge`) shipped verbatim as written.

> **Implementation note (2026-07-28, MW-C/C2.1 — `predictions[]` plural).** The "SitRep / COP slice" row
> above shipped as a **widening, not a rename**, so principle §1.1 holds literally rather than only in
> spirit (ADR-033 §3.1 called it "a breaking rename at the type level"):
> - `MapSource.predictions: readonly Prediction[]`, `MapProjection.predictions: readonly
>   ProjectedPrediction[]` and `MapProjectionData.predictions: readonly ProjectedPredictionData[]` are
>   **required, default `[]`** — a new construction site cannot forget them (`tsc` fails).
>   `MapDerivationInput.predictions: readonly PredictionSpec[]` likewise.
> - `MapProjection.prediction` / `MapProjectionData.prediction` **survive as `@deprecated` mirrors of
>   `predictions[0]`**, omitted when `predictions` is empty. A v1 client of `GET /regions/{id}/map` that
>   never learned the plural field therefore keeps rendering the first cone byte-identically. `openapi.yaml`
>   marks the singular `deprecated: true` and adds `predictions` to `MapProjection.required`.
> - The **`LayerId` vocabulary was NOT touched**: `'prediction'` remains the toggle/layer id in
>   `LAYER_IDS`, `LAYER_META`, `LAYER_PALETTE`, `layerSources` and all 14 message catalogs. Only *data*
>   field names moved. Renaming the layer id would have been a breaking closed-vocabulary change that
>   ADR-033 never asks for (finding F-75).
> - Each prediction keeps its **own** method + inputs + uncertainty end-to-end: `buildPredictionLayers`
>   emits one descriptor **per** cone, each with its own `predictionCaveat`. Multiple predictions are
>   multiple labelled cones, never one merged polygon with an averaged caveat (Art. XII).
> - **No persistence path was touched** — predictions still reach no repository, so **F-61 stays open**.
> - Not in scope and deliberately left to C2.2/C2.3: `ProjectedPrediction.geometry` is still **required**,
>   so a geometry-less prediction (the `ESCALATION`/`IMPACT_OVER_TIME` kinds C2.2 will build) is skipped by
>   `projectMap` and does **not** appear in the map wire's `predictions[]` (finding F-77).

## 5. API deltas (`docs/api/openapi.yaml`, additive)

| Endpoint | Change | Wave |
|---|---|---|
| `GET /regions` | **actually served** — currently `x-status: planned` with no `Command` verb and an injected-but-unused read model (F-01). Returns id, name, iso, tz, languages, bbox. | MW-B |
| `GET /regions/{id}/map` | new optional layers: storm track/cone/surge | MW-B |
| `GET /regions/{id}/map` | new required `predictions[]`; the singular `prediction` stays as a `deprecated` mirror of `predictions[0]` (see the C2.1 note above) | MW-C |
| `GET /incidents/{id}/sitrep` | `predictions[]` + ranked `outlook[]` | MW-C |
| `GET /incidents/{id}/impact` | predicted-impact figures (aggregate-only) | MW-D |
| `GET /eap` · `GET /eap/{id}/state` | protocol definitions + current trigger state and evidence | MW-D |
| `POST /alerts/{id}/all-clear` | Cancel + all-clear referencing the original identifier | MW-D |
| `GET /incidents/{id}/summary` | incident-close export (CSV/JSON) of already-held aggregates | MW-D |
| envelope | `InteractionRequest` gains optional `locale` (ADR-023 documents it; the type never had it — F-02) | MW-A |
| CAP output | one `<info>` per required language, identical machine values across blocks (F-03) | MW-A |

## 6. Configuration deltas (`docs/architecture/CONFIGURATION.md` + `.env.example`)

> **Correction (2026-07-27, finding F-37):** an earlier draft of this table listed
> `NEXT_PUBLIC_DEFAULT_LOCALE`. **No such variable exists and nothing reads it** — the default locale is
> registry-driven (`config/locales.json` `defaultLocale` + `DEFAULT_LOCALE` in `src/config/locales.ts`).
> The row has been removed. Localization is deliberately not env-configured; an env override would need
> code before a doc. This is recorded rather than silently corrected because inventing a config knob in a
> spec is precisely the drift the docs-truth audit lens exists to catch — including when this project
> writes it.

| Var | Default | Meaning |
|---|---|---|
| `CAP_PROFILE` | `base` | selectable CAP profile for pre-emit validation |
| `FEATURE_TTS` | `off` | opt-in alert speech; never auto-plays — **as built: never implemented; no such variable exists** (`docs/audit/UNIMPLEMENTED_REGISTER.md`) |
| `FEATURE_ANTICIPATORY` | `on` | anticipatory engine (DRAFT/suggestion-only by design) — **as built: the engine is always composed; the panel flag is `FEATURE_ANTICIPATORY_PANEL` (default `off`) with its `NEXT_PUBLIC_` mirror** |
| `FEATURE_PREDICTION_IMPACT` | `on` | predicted-impact quantification — **as built: no such variable; the quantifications are always computed and the D6 surfaces are the five `FEATURE_D6_*` flags** |
| `DRILL_MODE` | `off` | exercise mode; structurally cannot reach a real channel |
| `FEATURE_D4_*` (5) | `on` | rumor · mutual-aid · shelter-status · damage-reports · EMS-overlay |
| `FEATURE_D6_*` (5) | `on` | volunteer-teams · supplies · reunification-links · incident-export · casualty-tally |

**Browser-flag gap (F-32):** no `FEATURE_*` value currently reaches the client — `FEATURE_CAMERAS` and
`FEATURE_EXTERNAL_VIEWS` are declared and never read. Every new **panel** flag therefore needs a
`NEXT_PUBLIC_` mirror, following the two existing precedents (`NEXT_PUBLIC_AUTH_DEV_LOGIN`,
`NEXT_PUBLIC_FEATURE_CITIZEN_STREAM`), with the server remaining authoritative.

## 7. Known limitations to add to the SPEC ledger (MW-E/E1)

1. **Machine-translated locales are unreviewed** (all except English — **Romanian included**: it is
   `review: machine` until the entrant, a native speaker, reviews `messages/ro.json` and flips it) —
   declared in each catalog's `_meta` and labeled in the UI while that locale is active. (Finding F-42.)
2. **Basemap labels cannot be localized** (F-07): the default style is *raster* OSM tiles, so place labels
   are baked into the bitmaps. There is no `text-field` to switch. Only BEACON's own chrome translates.
3. **Deterministic fact claims remain English**, language-marked — a deliberate Art. XII boundary, not an
   oversight; translating engine-generated claims would put the LLM between the data and the number.
4. **CJK text uses the system font stack** — bundling a usable Simplified-Chinese face would exceed the
   font and repo budgets by an order of magnitude.
5. **Ensemble member fraction is not a calibrated probability**; it is the share of forecast members over a
   threshold, shown as evidence beside a class, never as a percentage of occurrence.
6. **The member-counting evaluator has no wired live ensemble source** (F-34): GloFAS reporting points
   expose a derived probability, so ensemble evidence ships from cached files and is labeled as such.
7. **Comms-blackout is geometric**, not an RF or network model (F-28): cell sites inside a predicted
   extent, with no per-operator truth and no liveness signal.
8. **Evacuation-clearance parameters are literature-based**, cited in config, not local measurements.
9. **The cell-broadcast view is a preview/authoring aid** — BEACON is not a cell-broadcast entity and has
   no telco delivery path.
10. **Three new zones are demo-grade**, not full parity: only US and Romania are fully covered.

## 8. Verification of this delta

Each row above is bound to at least one test named in `requirements/EARS_FINAL_VERSION.md` §0 and
`../project/TASKS-FINAL-VERSION.md`. The delta is complete when: every new schema validates its config in a
test · every enum widening appears in both the TS union and the DB CHECK · openapi additions are structurally
valid and match the served routes · CONFIGURATION and `.env.example` list every new var · the limitations
above appear verbatim in `SPEC.md`'s consolidated "Known limitations" section.
