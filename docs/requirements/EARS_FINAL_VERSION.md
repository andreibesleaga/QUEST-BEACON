# BEACON — S01 requirements for THE FINAL COMPLETE VERSION (master-plan feature)

> **GABBE phase:** S01 (Requirements) for the single unified feature described in
> `../../../CURRENT-MASTER-PLAN.md` (the execution doc of record). Extends — never replaces —
> `PRD.md` §5 (FR-1…FR-16, U/EV/ST/OP/UW lines), which remains the canonical baseline for everything
> already shipped. Nothing here weakens an existing requirement.
> **Golden thread rule (Gate 7):** every FR below names its EARS line(s), its wave, and its test
> artifact. An FR without a test is a gate failure, not a TODO.
> ⛔ Agents never run git commit/push/tag.

Notation as in PRD §5: **U**=ubiquitous · **EV**=event-driven · **ST**=state-driven ·
**OP**=optional/feature-flag · **UW**=unwanted behaviour. New lines are numbered in their own
namespaces (`FU-*`, `FEV-*`, `FST-*`, `FOP-*`, `FUW-*`) so they can never collide with PRD §5.

---

## 0. Requirement groups & traceability index

| Group | FRs | Wave | ADR | Primary test artifacts |
|---|---|---|---|---|
| Localization | FR-I18N-1…8 | MW-A | ADR-030 | `tests/i18n/*.test.ts`, `e2e/i18n-rtl.spec.ts` |
| Region-generic zones | FR-ZONE-1…7 | MW-B | ADR-031 | `tests/zones/add-a-zone.test.ts`, `src/main/*.test.ts` |
| Storm hazard family | FR-STORM-1…3 | MW-B | ADR-032 | `src/domain/hazard-geometry.test.ts`, `app/_components/map/*.test.tsx` |
| Prediction probability | FR-PRED-1…6 | MW-C | ADR-033 | `src/application/prediction*/**.test.ts` |
| Anticipatory action | FR-AA-1…5 | MW-D | ADR-034 | `src/application/anticipatory/**.test.ts` (incl. replay determinism) |
| Predicted impact | FR-PAP-1…5 | MW-D | ADR-035 | `src/application/predicted-impact/**.test.ts` |
| Warning excellence | FR-WARN-1…6 | MW-D | ADR-036 | `src/application/warning/**.test.ts`, `schemas/*.test.ts` |
| Trust & governance | FR-GOV-1…3 | MW-D | ADR-034/036 | `src/application/governance/**.test.ts`, drill-isolation structural test |
| Response modules (D4 tier) | FR-D4-1…5 | MW-D | ADR-036 | per-module use-case tests + panel tests |
| Basic-aggregate tier (D6) | FR-D6-1…6 | MW-D | ADR-035 | per-module tests + **no-person-identifying-field structural test** |

**Rubric mapping** (IEEE Response Quest categories 1 Timeliness · 2 Comprehensiveness ·
3 Integration · 4 Usability · 5 Scenario-fit): I18N→4 · ZONE/STORM→2,5 · PRED→1,5 · AA→1,5 ·
PAP→2,3,5 · WARN→3,4 · GOV→3 · D4/D6→2,5.

---

## 1. Localization (FR-I18N-*) — wave MW-A

| FR | Requirement | EARS | Rubric |
|---|---|---|---|
| FR-I18N-1 | A user can select a display language from the shipped set and the choice persists across sessions | FEV-1, FU-1 | 4 |
| FR-I18N-2 | All user-facing UI text renders from message catalogs, with English fallback at every level | FU-2, FUW-1 | 4 |
| FR-I18N-3 | Right-to-left locales render a correct RTL layout without mirroring the map | FST-1 | 4 |
| FR-I18N-4 | Dates/numbers are locale-formatted; physical quantities use labeled SI units in every locale | FU-3 | 4 |
| FR-I18N-5 | Machine-translated catalogs are labeled as such in-file and in-UI | FU-4 | 4 (honesty) |
| FR-I18N-6 | Outbound alerts carry the region language **and** English; enum tokens are never translated | FEV-2, FUW-2 | 3 |
| FR-I18N-7 | A new language is added by configuration only (catalog + switcher row), with zero core change | FOP-1 | 2 |
| FR-I18N-8 | Fonts for shipped scripts are bundled/self-hosted and loaded per active locale (no CDN) | FU-5 | 1,4 |

- **FU-1** THE SYSTEM SHALL treat the active locale as UI state only (cookie + client store), never as a
  URL segment, and SHALL default to `NEXT_PUBLIC_DEFAULT_LOCALE` (`en`) when no choice is stored.
- **FU-2** THE SYSTEM SHALL render every user-facing string through the message catalog for the active
  locale; a missing key SHALL fall back to English and SHALL NEVER render the raw key.
- **FU-3** THE SYSTEM SHALL format dates, times, and numbers with `Intl` in the active locale using the
  active region's timezone, and SHALL express every physical quantity in SI units with an explicit unit
  label in all locales.
- **FU-4** THE SYSTEM SHALL mark any catalog that was machine-translated with `_meta.machineTranslated`
  and SHALL surface that fact in the UI while such a locale is active.
- **FU-5** THE SYSTEM SHALL serve all fonts from the application bundle (no third-party CDN) and SHALL
  load only the subsets required by the active locale's script.
- **FEV-1** WHEN a user selects a locale, THE SYSTEM SHALL re-render the UI in that locale, persist it,
  and set `<html lang>` and `<html dir>` accordingly.
- **FEV-2** WHEN a CAP alert is emitted, THE SYSTEM SHALL include one `<info>` block per required
  language (region language + English always) with identical machine-readable values across blocks.
- **FST-1** WHILE an RTL locale is active, THE SYSTEM SHALL lay out the interface right-to-left using
  logical CSS properties, and SHALL NOT mirror the map canvas, geographic axes, or map label language.
- **FOP-1** WHERE a `messages/<locale>.json` catalog and its switcher entry exist, THE SYSTEM SHALL
  offer that locale without any change to source files outside the catalog directory and locale registry.
- **FUW-1** IF a catalog key is missing, malformed, or an ICU message fails to compile, THEN THE SYSTEM
  SHALL fall back to English for that key and SHALL NOT throw or blank the surrounding view.
- **FUW-2** THE SYSTEM SHALL NOT translate CAP/EDXL enumerated tokens (`status`, `msgType`, `category`,
  `severity`, `certainty`, `urgency`, `responseType`), geometry, identifiers, or units-of-record.

**Acceptance (MW-A):** key-parity across all shipped catalogs · ICU compile lint · fallback-ladder test ·
raw-key-leak scan over the rendered DOM · axe clean under `ar` · one RTL visual smoke · English render
byte-identical to the pre-MW-A baseline (existing visual/e2e baselines stay green).

---

## 2. Region-generic zones (FR-ZONE-*) — wave MW-B

| FR | Requirement | EARS | Rubric |
|---|---|---|---|
| FR-ZONE-1 | The selectable region list comes from configuration, not from code | FU-6 | 2 |
| FR-ZONE-2 | Region data assembly is generic and config-driven for every region | FU-7 | 2 |
| FR-ZONE-3 | A new zone is added by configuration only and immediately renders real data via the global aggregators | FOP-2 | 2 |
| FR-ZONE-4 | European official alerts are served for all covered countries via one aggregator | FEV-3 | 2,5 |
| FR-ZONE-5 | Countries whose national portals are closed are served via the WMO CAP relay | FEV-4 | 2,5 |
| FR-ZONE-6 | Each shipped zone has offline seed data and a golden scenario; its national language ships as a locale | FST-2 | 5 |
| FR-ZONE-7 | Region ISO code and timezone are consumed by formatting, alerting, and source selection | FU-8 | 3 |

- **FU-6** THE SYSTEM SHALL read the region registry (id, name, iso, tz, bbox, source modes) from
  `config/regions.json`, and the UI region selector SHALL be derived from it.
- **FU-7** THE SYSTEM SHALL assemble every region's COP slice through one generic, configuration-driven
  composition path (no per-region code branches).
- **FU-8** THE SYSTEM SHALL use each region's `iso` for source/locale selection and its `tz` for all
  displayed timestamps and alert effective/expiry times.
- **FEV-3** WHEN a region in MeteoAlarm's coverage is opened, THE SYSTEM SHALL fetch that country's
  official warning feed via the MeteoAlarm aggregator adapter and attribute it per its licence.
- **FEV-4** WHEN a region's national source is unavailable or access-restricted, THE SYSTEM SHALL use the
  WMO CAP relay for that authority's alerts and SHALL label the relay as the provenance path.
- **FST-2** WHILE a shipped zone is selected with all sources forced to MOCK, THE SYSTEM SHALL still
  render a populated, correctly-labeled COP from that zone's offline seed.
- **FOP-2** WHERE a syntactically valid region entry is added to `config/regions.json`, THE SYSTEM SHALL
  offer it in the selector and populate it from coverage-matching adapters with zero source changes; a
  region with no matching adapter SHALL render an explicit "no source covers this region" state, never
  a dead-end.

**Shipped zones (locked):** `us-ca` (full parity) · `ro` (full/live-capable) · `ph` (Philippines) ·
`es` (Spain) · `gr` (Greece) ⇒ shipped locales = 12 core + `fil` + `el` = **14**.

---

## 3. Storm hazard family (FR-STORM-*) — wave MW-B

| FR | Requirement | EARS | Rubric |
|---|---|---|---|
| FR-STORM-1 | Tropical cyclone / storm is a first-class hazard type alongside fire and flood | FU-9 | 2,5 |
| FR-STORM-2 | Cyclone track and forecast cone render as a distinct, legended map layer | FEV-5 | 2,4 |
| FR-STORM-3 | Storm-surge extent participates in exposure intersection and priority ranking | FEV-6 | 5 |

- **FU-9** THE SYSTEM SHALL model `STORM` as a hazard type with `TRACK`, `CONE`, and `STORM_SURGE`
  geometry kinds, carried through domain, projection, map, legend, and interop without special-casing.
- **FEV-5** WHEN storm data is present for the active region, THE SYSTEM SHALL render track and cone
  geometry on a dedicated toggleable layer with uncertainty labeling and a legend entry.
- **FEV-6** WHEN storm-surge extent is available, THE SYSTEM SHALL intersect it with infrastructure and
  population exactly as flood extent is intersected, and include the results in ranked priorities.

---

## 4. Prediction probability (FR-PRED-*) — wave MW-C

| FR | Requirement | EARS | Rubric |
|---|---|---|---|
| FR-PRED-1 | Forecast exceedance probability and tendency survive ingestion instead of being dropped | FU-10 | 1,5 |
| FR-PRED-2 | Likelihood is expressed as a deterministic class derived only from source-provided signals | FU-11, FUW-3 | 5 |
| FR-PRED-3 | Predictions carry a likelihood class and an ETA where the source supports one | FU-12 | 1,5 |
| FR-PRED-4 | Escalation-trend and impact-over-time predictions are produced, not merely promised | FEV-7 | 5 |
| FR-PRED-5 | Multiple predictions per incident are carried end-to-end and ranked into an Outlook | FEV-8 | 1,5 |
| FR-PRED-6 | A forecast threshold crossing raises a DRAFT alert with its lead time | FEV-9 | 1,5 |

- **FU-10** THE SYSTEM SHALL preserve forecast probability-of-exceedance and tendency from every source
  that provides them, from the anti-corruption layer through to presentation, with provenance.
- **FU-11** THE SYSTEM SHALL map source-provided probability signals to the ordered classes
  `POSSIBLE` < `LIKELY` < `VERY_LIKELY` by documented deterministic thresholds, and SHALL display the
  class together with the underlying source value and method.
- **FU-12** THE SYSTEM SHALL attach `likelihoodClass` and, where derivable, `etaHours` plus a computed
  hazard-arrival time to each prediction, always labeled with method, inputs, and uncertainty.
- **FEV-7** WHEN a time series of observations/forecasts is available, THE SYSTEM SHALL produce
  `ESCALATION` and `IMPACT_OVER_TIME` predictions from it deterministically.
- **FEV-8** WHEN a SitRep or COP slice is generated, THE SYSTEM SHALL carry all predictions and present a
  ranked Outlook ordered by likelihood class then soonest ETA.
- **FEV-9** WHEN a forecast (not only an observation) crosses a configured threshold, THE SYSTEM SHALL
  create a **DRAFT** alert stating the expected crossing time and the forecast basis.
- **FUW-3** THE SYSTEM SHALL NOT invent, interpolate, or model a probability value that a source did not
  provide, and the LLM SHALL NOT emit any probability, class, or ETA.

---

## 5. Anticipatory action (FR-AA-*) — wave MW-D

| FR | Requirement | EARS | Rubric |
|---|---|---|---|
| FR-AA-1 | Early-action protocols are declared as validated configuration with an explicit stop mechanism | FU-13 | 5 |
| FR-AA-2 | Trigger evaluation is deterministic, ensemble-based, and replayable | FU-14, FUW-4 | 1,5 |
| FR-AA-3 | Two-stage readiness/activation trigger states are tracked per protocol | FST-3 | 5 |
| FR-AA-4 | Activation proposes the protocol's pre-agreed actions as suggestions for human approval | FEV-10 | 5 |
| FR-AA-5 | Trigger state, ensemble evidence, and activation history are visible in the UI | FEV-11 | 4,5 |

- **FU-13** THE SYSTEM SHALL express each early-action protocol as data (not code) validated against a
  published schema, carrying trigger definitions, pre-agreed actions, resource ceiling, roles,
  geographic scope, and an explicit stop/deactivation mechanism.
- **FU-14** THE SYSTEM SHALL evaluate triggers by counting forecast ensemble members that exceed the
  configured threshold, expose that count and the member total as the evidence, and produce identical
  decisions for identical cached inputs.
- **FST-3** WHILE a protocol is evaluated, THE SYSTEM SHALL hold it in exactly one of
  `IDLE`, `READINESS`, `ACTIVATED`, or `STOPPED`, and SHALL record every transition with its evidence.
- **FEV-10** WHEN an activation trigger is met, THE SYSTEM SHALL surface the pre-agreed actions as
  engine suggestions into pre-positioning/tasking for human approval, and SHALL NOT dispatch,
  task, or broadcast anything automatically.
- **FEV-11** WHEN the anticipatory panel is opened, THE SYSTEM SHALL show each protocol's state, the
  members-over-threshold evidence, the lead time, and the activation/stop history.
- **FUW-4** THE SYSTEM SHALL NOT let an activation emit a public warning, and SHALL NOT let the LLM
  decide or alter a trigger outcome.

---

## 6. Predicted impact (FR-PAP-*) — wave MW-D

| FR | Requirement | EARS | Rubric |
|---|---|---|---|
| FR-PAP-1 | Predicted-affected population is quantified for predicted extents | FEV-12 | 2,5 |
| FR-PAP-2 | Predicted loss of cell coverage yields an alert-reach / unreachable-residents estimate | FEV-13 | 2,3,5 |
| FR-PAP-3 | Current exposure is computed against the clipped hazard polygon, not a bounding box | FU-15 | 2 |
| FR-PAP-4 | Predicted shelter demand and evacuation-clearance feasibility are estimated with stated assumptions | FEV-14 | 5 |
| FR-PAP-5 | Every impact figure is deterministic, aggregate-only, reproducible, and method-labeled | FU-16, FUW-5 | 3 |

- **FU-15** THE SYSTEM SHALL compute population and infrastructure exposure by intersecting the actual
  hazard/prediction geometry with the population source, never by bounding-box approximation.
- **FU-16** THE SYSTEM SHALL label every impact estimate with its method, inputs, population-source
  vintage, and uncertainty, and SHALL produce the same number for the same inputs on every run.
- **FEV-12** WHEN a prediction extent exists and a population source covers it, THE SYSTEM SHALL compute
  the predicted-affected population as an aggregate zonal count and cite the population source.
- **FEV-13** WHEN cell-site data and a prediction extent are both available, THE SYSTEM SHALL compute the
  sites within the extent, the resulting estimated unreachable residents, and flag those areas as
  requiring non-cellular warning dissemination.
- **FEV-14** WHEN predicted-affected population is known, THE SYSTEM SHALL estimate shelter demand
  against known shelter capacity and flag whether evacuation clearance is feasible within the lead time,
  citing the literature-based parameters used.
- **FUW-5** THE SYSTEM SHALL NOT derive, store, or display any individual-level or re-identifiable
  population figure, and SHALL NOT let the LLM produce any impact number.

---

## 7. Warning excellence (FR-WARN-*) — wave MW-D

| FR | Requirement | EARS | Rubric |
|---|---|---|---|
| FR-WARN-1 | Outbound CAP is schema- and profile-validated before it can be emitted | FEV-15, FUW-6 | 3 |
| FR-WARN-2 | Alert lifecycle supports updates, cancellations, and a first-class all-clear with delivery feedback | FEV-16 | 3,5 |
| FR-WARN-3 | Severity is conveyed by icon and text as well as colour | FU-17 | 4 |
| FR-WARN-4 | Warning text is generated in plain language from the alert's response type | FEV-17 | 4 |
| FR-WARN-5 | Alerts can be read aloud on request in the active locale | FOP-3 | 4 |
| FR-WARN-6 | A cell-broadcast-length rendering of any alert can be previewed | FEV-18 | 3,5 |

- **FU-17** THE SYSTEM SHALL present severity with a distinct pictogram and text label in addition to
  colour, with a text alternative for every pictogram.
- **FEV-15** WHEN an alert is prepared for emission, THE SYSTEM SHALL validate it against CAP v1.2 and
  the selected profile, and SHALL block emission with actionable errors if validation fails.
- **FEV-16** WHEN a hazard ends or an alert supersedes another, THE SYSTEM SHALL support Update/Cancel
  and an explicit all-clear message referencing the original identifier, and SHALL record per-channel
  delivery counts for every emission.
- **FEV-17** WHEN alert text is composed, THE SYSTEM SHALL generate protective-action wording from the
  alert's response type using plain-language templates in the target locale.
- **FEV-18** WHEN an operator requests a broadcast preview, THE SYSTEM SHALL render the alert as
  93-character cell-broadcast pages and show the page count.
- **FOP-3** WHERE `FEATURE_TTS=on`, THE SYSTEM SHALL offer on-demand speech playback of an alert in the
  active locale using the browser speech API; audio SHALL never start automatically.
  *(Not implemented as of 2026-09-16 — registered in `docs/audit/UNIMPLEMENTED_REGISTER.md`; no
  `FEATURE_TTS` variable exists.)*
- **FUW-6** THE SYSTEM SHALL NOT emit any alert that fails validation, that originates from an
  unverified report, or that lacks a human authorizer (reinforces PRD ST1/UW5).

---

## 8. Trust & governance (FR-GOV-*) — wave MW-D

| FR | Requirement | EARS | Rubric |
|---|---|---|---|
| FR-GOV-1 | Every trigger evaluation and warning decision is written to a tamper-evident ledger | FEV-19 | 3 |
| FR-GOV-2 | Approval follows a declared SOP chain with delegated fallback approvers | FST-4 | 3 |
| FR-GOV-3 | Drill mode exercises the whole flow end-to-end and structurally cannot reach a real channel | FOP-4, FUW-7 | 3,5 |

- **FEV-19** WHEN a trigger is evaluated or a warning decision is taken, THE SYSTEM SHALL append a
  hash-chained ledger entry recording inputs, source/forecast version, probability evidence, decision,
  authorizer, and any stop action.
- **FST-4** WHILE an approval is pending, THE SYSTEM SHALL identify the responsible role and, after the
  configured interval, the delegated fallback approver, and SHALL record which one acted.
- **FOP-4** WHERE `DRILL_MODE=on`, THE SYSTEM SHALL label every surface and artifact as an exercise and
  SHALL route all outbound channels to a recording sink.
- **FUW-7** THE SYSTEM SHALL NOT deliver any drill-generated message to a real external channel, and this
  SHALL be enforced structurally (type-level/composition), not only by convention.

---

## 9. Response modules — D4 tier (FR-D4-*) — wave MW-D

| FR | Requirement | EARS | Flag |
|---|---|---|---|
| FR-D4-1 | Flagged rumors are reviewable on a dedicated board with their evidence | FEV-20 | `FEATURE_D4_RUMOR_BOARD` |
| FR-D4-2 | Mutual-aid requests can be raised, matched, and exchanged as EDXL-RM | FEV-21 | `FEATURE_D4_MUTUAL_AID` |
| FR-D4-3 | Shelter status (open/capacity/occupancy, aggregate) is visible and mapped | FEV-22 | `FEATURE_D4_SHELTER_STATUS` |
| FR-D4-4 | Damage and needs reports are captured through the existing verified-report pipeline | FEV-23 | `FEATURE_D4_DAMAGE_REPORTS` |
| FR-D4-5 | Authoritative post-event damage overlays can be ingested and displayed | FEV-24 | `FEATURE_D4_EMS_OVERLAY` |

- **FEV-20** WHEN a report or news item is flagged as misinformation, THE SYSTEM SHALL list it on the
  rumor board with its flag reason and corroboration state, and SHALL NOT merge it into any fact.
- **FEV-21** WHEN a mutual-aid request is created, THE SYSTEM SHALL match it against registered
  resources by capacity and distance, and SHALL import/export it as EDXL-RM.
- **FEV-22** WHEN shelter data is available for the region, THE SYSTEM SHALL display aggregate status and
  capacity per shelter and use it in shelter-demand comparisons.
- **FEV-23** WHEN a damage or needs report is submitted, THE SYSTEM SHALL route it through the existing
  consent/triage/verify pipeline with a category and aggregate severity.
- **FEV-24** WHEN an authoritative damage-assessment product is configured for the incident, THE SYSTEM
  SHALL display it as an attributed overlay labeled with its production date.

---

## 10. Basic-aggregate tier — D6 (FR-D6-*) — wave MW-D

| FR | Requirement | EARS | Flag |
|---|---|---|---|
| FR-D6-1 | Volunteer **teams** are registerable and taskable as resources | FEV-25 | `FEATURE_D6_VOLUNTEER_TEAMS` |
| FR-D6-2 | Relief **supplies** are registerable as resources and matched to needs | FEV-26 | `FEATURE_D6_SUPPLIES` |
| FR-D6-3 | Family-reunification help links out to official services, handling no data | FEV-27 | `FEATURE_D6_REUNIFICATION_LINKS` |
| FR-D6-4 | An incident summary of already-held aggregates can be exported at close | FEV-28 | `FEATURE_D6_INCIDENT_EXPORT` |
| FR-D6-5 | Damage reports may carry an aggregate, explicitly unverified casualty tally | FEV-29 | `FEATURE_D6_CASUALTY_TALLY` |
| FR-D6-6 | **No D6 entity may contain a person-identifying field** | FU-18, FUW-8 | (always) |

- **FU-18** THE SYSTEM SHALL restrict every D6 entity to aggregate attributes (callsigns, headcounts,
  quantities, tallies, locations of resources) and SHALL enforce the absence of person-identifying
  fields structurally.
- **FEV-25** WHEN a volunteer team is registered, THE SYSTEM SHALL store its callsign, headcount,
  skills, and availability as a resource and make it taskable through the existing task lifecycle.
- **FEV-26** WHEN supplies are registered, THE SYSTEM SHALL store kind, quantity, location, and expiry
  and include them in capacity-versus-demand matching.
- **FEV-27** WHEN a user opens reunification help, THE SYSTEM SHALL present links to the official
  reunification services for that region and SHALL NOT collect, store, or transmit any personal detail.
- **FEV-28** WHEN an incident is closed, THE SYSTEM SHALL export a summary of already-held aggregates
  (alerts issued, tasks completed, shelter usage, affected-area figures) as CSV/JSON with provenance,
  collecting no new data.
- **FEV-29** WHEN a casualty tally is entered on a damage report, THE SYSTEM SHALL store it as an
  aggregate site-level count labeled "unverified — not authoritative" wherever displayed or exported.
- **FUW-8** THE SYSTEM SHALL NOT accept, store, or export a name, contact detail, identifier, medical
  detail, donation, or payment on any D6 entity; permanently out of scope are individual medical/triage
  records, safe-and-well registries, donor/payment handling, full recovery accounting, and a public
  information portal.

---

## 11. Cross-cutting non-functional requirements (carried from the master plan §5)

| NFR | Requirement | Verified by |
|---|---|---|
| NFR-F1 | Time-to-Trustworthy-Picture stays < 10 s (target ≈1 s) with all new layers on | `e2e/perf.spec.ts` — ✅ the assertion exists (`:101`, `expect(tttp).toBeLessThan(BUDGET_MS)`, `BUDGET_MS = 10_000` at `:14`) |
| NFR-F2 | Added client JS ≤ +300 KB gzipped; only the active locale's catalog is shipped | `e2e/perf.spec.ts:60-66` — ⚠️ **the check exists but does not verify this requirement as written.** It asserts a **TOTAL** ceiling (`JS_GZIP_CEILING_KB = 950`, `:34`), not the **+300 KB delta** this row states; the spec file says so itself under "HONEST SCOPE CHANGE" (`:23-34`) — no pre-feature baseline was ever captured, so the delta is not computable. *(This row is the original F-415: it once named a check that did not exist at all. The check was built; the requirement text was never reconciled to it. Reconcile the wording or capture a baseline — do not treat this as verified as stated.)* The "only the active locale's catalog is shipped" half is verified by `ADR-030` §Catalog-shipping (per-locale dynamic `import()`), **not** by this test |
| NFR-F3 | Bundled fonts ≤ 1 MB total; repo growth for zones+fonts+catalogs < ~50 MB | `e2e/perf.spec.ts:69-76` (`'bundled fonts stay under 1 MB (NFR-F3)'`, `FONT_CEILING_KB = 1024`, plus a non-vacuity guard that fails if zero fonts are found) — ✅ for the font half. ⚠️ **The "repo growth < ~50 MB" half has no check** and the previous cell value ("documented check at MW-E") named one that was never produced |
| NFR-F4 | Exactly two visual-baseline regenerations are permitted across the whole feature | ⚠️ **No executable check.** This is a human-tracked budget recorded in prose (ADR-032/ADR-033 §6 spend it, F-194 records it exhausted). Nothing counts regenerations; `--update-snapshots` is policy-gated, not machine-gated |
| NFR-F5 | Every new surface is behind a feature flag with a safe default and can be disabled without revert | `src/config/index.ts` (every flag declared with an explicit default; invalid values are boot errors) + `src/config/index.test.ts` + `src/config/anticipatory-panel-flag.test.ts` — ✅. `docs/architecture/CONFIGURATION.md` documents them, but a doc is not a verification |
| NFR-F6 | All new migrations are additive; protocol/trigger configs stay file-based (air-gap friendly) | ⚠️ **Human review only** — no test asserts additivity. What *is* machine-checked is that the migrations apply cleanly and yield 19 tables (`.github/workflows/ci.yml` `integration` job) |
| NFR-F7 | Locale and region identifiers are validated against allowlists (no path traversal) | `src/config/locales.test.ts` (locale registry/allowlist) + the regions↔manifest drift guard in `region-registry.test.ts`. ⚠️ "security tests" as a named artefact does not exist — there is no `tests/security/` |
| NFR-F8 | axe reports zero serious/critical under `en`, `ar` (RTL), and one CJK locale | `e2e/a11y.spec.ts` (+ `e2e/i18n-rtl.spec.ts`) — ✅. Note the glob in the old cell (`a11y*.spec.ts`) matches exactly **one** file |
| NFR-F9 | Coverage floors unchanged or raised; no test weakened, skipped, or made vacuous | `vitest.config.ts:44-52` thresholds, enforced by the `unit` CI job — ✅ for the floors. ⚠️ Two riders: the floors are **two-tier** (99 on domain/application; 97/79/96/97 on `src/main/**`; 90/83/93/90 on `src/adapters/**`), and `app/**` is **excluded from `include`**, so 71 browser files are unmeasured (**F-365**). "No test made vacuous" is not machine-checked — the mutation gate that would check it is not installed (`docs/TEST_PLAN.md` §7.2) |
| NFR-F10 | Known limitations are consolidated in one indexed SPEC section | `docs/SPEC.md` §13 (§13.1–§13.14) — ✅ exists and is indexed. Verification is editorial, not executable |

> **Cell-by-cell re-check, 2026-08-02 (lens-1, F-415 class).** Every "Verified by" value above was opened and
> read against the file it names. Three named a verification that does not exist as described (**NFR-F2**
> checks a different quantity, **NFR-F3**'s repo-growth half and **NFR-F4** and **NFR-F6** have no check at
> all, **NFR-F7**'s "security tests" is not a real artefact); the rest were confirmed and now cite the
> specific test and line. **A claim of verification is the least-questioned kind of claim** — this table is
> the reason F-415 existed, so it is re-checked here rather than trusted.


## 12. New acceptance tests (redundancy-pattern, mandated by master plan §5.7)

1. **add-a-zone-by-config** — a synthetic region entry renders a populated COP via global aggregators.
2. **missing-locale fallback** — an incomplete catalog renders English, never a raw key.
3. **trigger-replay determinism** — identical cached ensemble input ⇒ identical decision + evidence.
4. **drill isolation (structural)** — no drill artifact can reach a real channel.
5. **predicted-affected reproducibility** — identical geometry + raster ⇒ identical count.
6. **no-person-identifying-field (structural)** — D6 entity types cannot carry PII.

## 13. Out of scope (restated, permanent)

Individual medical/triage data · safe-and-well or reunification registries · donations/payments ·
full recovery-stage accounting · a public information portal · IPAWS-authority origination ·
calibrated probabilistic modelling of our own · scraping ToS-protected platforms · any new hazard
family beyond the storm addition · translation of documentation or source code.

## 14. Approval

S01 for the master-plan feature is **self-approved under the locked-scope regime** recorded in
`CURRENT-MASTER-PLAN.md` §6 (all feature decisions were taken by the user on 2026-07-18/19/20 and the
plan explicitly authorises end-to-end execution without further feature questions). Only genuine
blockers escalate.
