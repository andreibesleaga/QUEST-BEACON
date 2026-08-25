# ADR-036 — Warning excellence: CAP profile validation, lifecycle completeness, comprehension, broadcast preview + the D4 response modules

- **Status:** Accepted (2026-07-26)
- **Deciders:** Entrant + prod-architect + ops-security (master-plan wave MW-D)
- **Relates to:** ADR-010 (CAP v1.2 + full EDXL-RM round-trip + EDXL-SitRep — this ADR completes the CAP
  lifecycle ADR-010 scoped but did not finish, and rides the EDXL-RM round-trip ADR-010 already built),
  ADR-014 (DRAFT-only threshold fires), ADR-023 (multi-channel interaction — the `MessagingPort`),
  ADR-026 (HITL broadcast + subscriber registry — where per-channel delivery counts must come from),
  ADR-025 (JWT identity — the recorded authorizer), ADR-012 (config-for-everything — profiles, templates and
  parameters are data), ADR-021 (CAMARA telecom — the other telecom boundary), ADR-028/ADR-029 (link-only
  doctrine reused by the D4 overlays), ADR-030 (i18n architecture — the catalogs this ADR reuses), ADR-032
  (STORM — new events to template), ADR-034 (anticipatory action — the `EXERCISE` CAP status is decided
  jointly with this record), ADR-035 (predicted-impact figures shown beside a warning), CONSTITUTION Art. XII
  (deterministic — the LLM never composes a warning number), Art. XIII (HITL before any public action; produce
  + validate CAP, **no live IPAWS origination**), Art. XIV (responsible data; misinformation flagged never
  merged), Art. XVI (redundancy / degrade-never-dead-end)
- **FR refs:** FR-WARN-1…FR-WARN-6 (`docs/requirements/EARS_FINAL_VERSION.md:220-225`; FU-17, FEV-15…FEV-18,
  FOP-3, FUW-6 at `:227-241`) and FR-D4-1…FR-D4-5
  (`docs/requirements/EARS_FINAL_VERSION.md:269-273`; FEV-20…FEV-24 at `:275-284`)
- **Threat model:** new rows required at S03 — new egress hosts for the FEMA shelter feed and the Copernicus
  EMS products (extends TB4), a rumor-board row under TB3 (surfacing flagged content must not launder it into
  fact), and a CAP-validator fuzz row under TB2 (master plan §5.8, `CURRENT-MASTER-PLAN.md:219-220`)

## Context

### The gap this closes

`CURRENT-MASTER-PLAN.md:105-108` locks **D3 Warning excellence**: CAP/X.1303-bis validator + selectable IPAWS
profile; delivery-count feedback + first-class ALL-CLEAR (Update/Cancel); ISO 22324 severity pictograms
(colour never the sole carrier); NWS-HazSimp plain-language templating; multilingual CAP + browser TTS; 3GPP
cell-broadcast preview. `CURRENT-MASTER-PLAN.md:113-118` locks the **D4 tier — all five modules**. Both land
in wave MW-D (`CURRENT-MASTER-PLAN.md:154-158`).

The annex's framing is the reason this matters more than it sounds: the literature says early-warning systems
fail at **the last mile** — warnings not reaching, not understood, no feedback, no all-clear
(`CURRENT-PLAN-3-DIFFERENTIATORS.md:28-32`) — and BEACON's standards posture is
**CAP v1.2 ≡ ITU-T X.1303 bis** plus EDXL, which lets it *feed* Everbridge/RapidPro/Genasys downstream rather
than compete with them (`CURRENT-PLAN-3-DIFFERENTIATORS.md:36-39`). Two of the most documented WMO Checklist
gaps — "verify warnings reached people" and "inform when impacts ended" — are exactly what §2 closes
(`CURRENT-PLAN-3-DIFFERENTIATORS.md:87-91`).

### Findings from the codebase — the validator is better than assumed, the emitter is worse

| # | Finding | Evidence |
|---|---|---|
| G1 | **A blocking validate-before-emit gate already exists for base CAP.** `alertToCap` rejects ACTUAL-without-approver as `CONFLICT`, rejects a missing `sent` as `PARSE_ERROR`, and Ajv-validates the document against `schemas/cap-v1.2.schema.json` before returning ok | `src/adapters/interop/cap-mapper.ts:145-151`; validator chain `src/adapters/interop/interop-result.ts:20` → `src/adapters/interop/schema-validator.ts:24` (memoized `ajv.compile`). The sink calls it and refuses to record on failure (`src/adapters/alerting/alert-sink.ts:70-71`) |
| G2 | **The CAP schema already encodes conditional business rules the emitter cannot satisfy.** `references` is a declared property, and `msgType ∈ {Update, Cancel} ⇒ references required` is an `allOf/if-then` rule | `schemas/cap-v1.2.schema.json:65-68` and `:89-94` (siblings: `scope=Restricted ⇒ restriction` `:82-84`, `scope=Private ⇒ addresses` `:85-88`) |
| G3 | **…but `CapAlert` has no `references` field at all**, so an Update/Cancel is literally unconstructible; if one were constructed, the existing gate (G2) would correctly reject it | `CapAlert` = `{identifier, sender, sent, status, msgType, scope, info}` — `src/adapters/interop/cap-mapper.ts:49-57` |
| G4 | **`msgType` is hard-pinned to `Alert` in practice.** It exists only as a boundary option, defaulted at build time, and the composition root wires the sink **without** `capOptions` | type `src/adapters/interop/cap-mapper.ts:18`; option `:62`; default `:134`; sink call `src/adapters/alerting/alert-sink.ts:70`; wiring `src/main/feature-seed.ts:213` (`makeAlertSink({ clock })`) |
| G5 | **The domain `Alert` carries no warning content and no CAP lifecycle.** No `msgType`, `references`, `responseType`, `urgency`, `certainty`, `headline`, `description`, `instruction`; `CAP_STATUSES` is `['DRAFT','ACTUAL']` only | `src/domain/alert.ts:9`, `:21-32`. `urgency`/`certainty` are hardcoded `'Expected'`/`'Likely'` at `src/adapters/interop/cap-mapper.ts:115`, `:117`. The UI fabricates a headline client-side at `app/page.tsx:142`; the broadcast fabricates its own at `src/adapters/channels/http/routes/interop.ts:124-126` |
| G6 | **`info` is always a single block**, so multilingual CAP has no seam yet — although the schema is ready (`info` is an array, `minItems:1`, and `info.language` is a declared property) | emitter `src/adapters/interop/cap-mapper.ts:136` (`info: [buildInfo(alert, opts)]`); schema `schemas/cap-v1.2.schema.json:73-78`, `:103-107` |
| G7 | **No delivery count exists anywhere.** All three outbound ports return `Result<void>`; the broadcast loop discards every per-send result; the response `meta` carries none | `src/ports/logistics.ts:48`, `src/ports/interaction.ts:200`, `:208`; loop `src/adapters/channels/http/routes/interop.ts:138-143` (result not captured at `:140`); `meta` at `:183`. Derivable today: `subscribers.list().length` (`src/adapters/channels/messaging/subscriber-registry.ts:27`), `RecordedTransport.sent.length` (`src/adapters/channels/messaging/messaging-port.ts:32`) |
| G8 | **A severity pictogram component already exists, is already colour-plus-icon-plus-text, and is now already localized** — four visually distinct shapes, icon `aria-hidden` with the text carrying the label — **but the DRAFT alert panel does not use it** | `SEVERITY_META` `app/_components/ui/severity-tag.tsx:21-26` (`Info`/`TriangleAlert`/`ShieldAlert`/`OctagonAlert`, imported `:6`), per-severity catalog keys `ui.severity.*` `:31`, `SEVERITY_ORDER` `:28`, `SeverityTag` `:46`; icon shell `app/_components/ui/badge.tsx:25`; tokens `app/globals.css:23-26` (dark), `:46-49` (light), Tailwind mapping `:68-71`. `app/_components/panels/draft-alert-review.tsx:7` imports only `Button, EmptyState, Panel, ProvenancePopover`; severity is flattened into a string upstream at `app/page.tsx:142` even though the API returns it (`src/adapters/channels/http/routes/queue.ts:117-125`) |
| G9 | **The HITL approve flow has no preview and no confirmation** — one click promotes DRAFT→ACTUAL, emits CAP and triggers the fan-out | `app/_components/panels/draft-alert-review.tsx:47` → `app/page.tsx:232` → `app/_lib/hooks.ts:172` → `src/adapters/channels/http/routes/interop.ts:153`, emit `:170`, broadcast `:177` |
| G10 | **The EDXL-RM round-trip is genuinely built** (the annex's "one panel away" claim is correct) | emit `resourceTaskToEdxlRm` `src/adapters/interop/edxl-rm-mapper.ts:167` (validates at `:172`), pure build `:146`, parse `edxlRmToResourceTask` `:203`; status maps `:33`, `:44`, `:56`, `:65`; routes `handleEdxlRmPost` `src/adapters/channels/http/routes/interop.ts:193`, `handleEdxlRmGet` `:219`; table `src/adapters/channels/http/routes/feature-router.ts:314`, `:328-330` |
| G11 | **…but inbound EDXL-RM is NOT schema-validated** (asymmetric with the emit side) | `edxlRmToResourceTask` does hand-rolled null checks only (`src/adapters/interop/edxl-rm-mapper.ts:205-211`); the raw body is cast at `src/adapters/channels/http/routes/feature-router.ts:261`. `schemas/edxl-rm.schema.json` is used on emit (`edxl-rm-mapper.ts:19`, `:172`) but never on ingest |
| G12 | **No `ResourceRequest` concept.** The "request" role is only the EDXL message-type string mapped from `PROPOSED` | `src/adapters/interop/edxl-rm-mapper.ts:27`, `:57`; correlation via `ResourceTask.edxlRmRef` `src/domain/resource-task.ts:24` |
| G13 | **Misinformation flagging is already computed and already labeled** — the rumor board is a rendering job, not an analysis job | `groundNews` `src/application/sitrep-synthesis/news-grounding.ts:95`; the flagging loop `:117-124` (only social items in an authoritative-free cluster); `flaggedFact` minter `:214-225` with `flagged: true` at `:223` and the "not corroborated by any authoritative source" claim at `:220`; `flaggedCount` `:47`; the `flagged` field `src/application/sitrep-synthesis/sitrep-synthesis.ts:24-25`. Not exported from the application barrel (`src/application/index.ts:4-13`) |
| G14 | **`PublicReport` has no `category`.** `source` is a channel, not a category | `src/domain/public-report.ts:9`; consent `:32`; triage machine `:62-67`; `transitionPublicReport` `:138-146`; retention stamped at `src/adapters/memory/memory-core.ts:187` |
| G15 | **No shelter adapter and no EMS adapter exist.** Shelters are hardcoded seeds; Copernicus EMS is an inert planned flag | shelters `src/adapters/persistence/seed.ts:66`, served `src/adapters/logistics/memory-logistics.ts:19`, `:94`; `SOURCE_CEMSRM_MODE=cached  # NOT WIRED (planned)` `.env.example:206` |
| G16 | **The i18n machinery landed during this same S02 session (wave MW-A, ADR-030) and is now real** — so this ADR consumes it rather than waiting on it | `messages/en.json` + `messages/_fragments/ui.json`; catalog loading `app/_lib/messages.server.ts:42` (`resolveLocale`), `:51` (`loadMessages`); the client shim `app/_lib/i18n.tsx:41` (`IntlProvider`), `:65` (`useT`), `:87` (`useFormat`), built on `next-intl`'s `createTranslator`/`createFormatter` (`app/_lib/i18n.tsx:14`) rather than `useTranslations`; dynamic document language/direction `app/layout.tsx:29-36`; locale registry `src/config/locales.ts` + `config/locales.json`; parity test `tests/i18n/catalog-parity.test.ts`. **The warning templates in §4 are therefore catalog keys, not a new mechanism** |
| G17 | Schema files are read **CWD-relative at runtime** | `src/adapters/interop/schema-validator.ts:27` (`readFileSync(schemaPath,'utf8')`) with paths `src/adapters/interop/cap-mapper.ts:14`, `edxl-rm-mapper.ts:19`, `edxl-sitrep-mapper.ts:14`. Works from the repo root; the profile validator must not make this worse |

The honest summary: **the validator is in better shape than the plan assumed (G1/G2) and the emitter is in
worse shape (G3–G6)**. So this ADR is mostly about giving the domain `Alert` the CAP lifecycle and content it
never had, plus one new *profile* layer on top of an existing, working schema gate.

## Decision

### 1. CAP validation stays a blocking pre-emit gate; **profiles** are the new, data-driven layer (FR-WARN-1 / FEV-15 / FUW-6)

The base gate is not rebuilt — `alertToCap` already blocks emission on schema failure and returns actionable
errors (`src/adapters/interop/cap-mapper.ts:145-151`, `formatErrors` at
`src/adapters/interop/schema-validator.ts:32`). What is added is a **selectable profile** applied *after* base
validation and *before* the sink records anything:

```
buildCapAlert → base schema (schemas/cap-v1.2.schema.json) → PROFILE rule set → sink
                       ↑ exists today (G1)                    ↑ new
```

- **Profiles are data**, one JSON rule set per profile in `schemas/cap-profiles/<id>.schema.json`, selected by
  `CAP_PROFILE` (config, default `base`). A profile is expressed in the same JSON-Schema dialect as the base
  document and composed with it — which works because the base schema already demonstrates conditional
  business rules in exactly this form (`schemas/cap-v1.2.schema.json:80-95`). Validation reuses
  `validatorForFile` (`src/adapters/interop/schema-validator.ts:24`) so profiles are memoized like every other
  schema; the CWD-relative read (G17) is confined to the same helper rather than duplicated.
- **The IPAWS-style profile's concrete rules are populated at S03 from the published FEMA IPAWS CAP profile**
  (listed in the annex's source set, `CURRENT-PLAN-3-DIFFERENTIATORS.md:167-168`). **This ADR deliberately
  does not enumerate them**, because inventing profile rules would be worse than having none — the S03 task is
  to transcribe them from the published profile with a citation per rule.
- **Wording discipline.** BEACON emits documents that are **schema-valid CAP v1.2 and profile-validated
  against the selected rule set**. It does not claim conformance certification, and it performs **no live
  IPAWS origination** — ADR-010's boundary is unchanged (`IPAWS_ENABLED=off`, `CAP_EMIT_MODE=draft`).
  **ITU-T X.1303 bis ≡ CAP v1.2** is the international-standard framing recorded in the annex
  (`CURRENT-PLAN-3-DIFFERENTIATORS.md:36-38`, `:85-87`); we state the equivalence as the annex records it and
  make no separate X.1303 conformance claim.
- **Failure is actionable and blocking.** A profile failure returns a typed `PARSE_ERROR` listing the failing
  rules, surfaced in the review panel next to the field that caused it. Emission does not happen (FUW-6,
  `docs/requirements/EARS_FINAL_VERSION.md:240-241`).

### 2. Lifecycle completeness: Update / Cancel / a first-class ALL-CLEAR, plus delivery counts (FR-WARN-2 / FEV-16)

**Domain deltas (G5) — the substantive part of this ADR.** `src/domain/alert.ts` gains, all additive:

| Field | Values | Why |
|---|---|---|
| `msgType` | `ALERT \| UPDATE \| CANCEL` | today unreachable (G4); CAP-native (`schemas/cap-v1.2.schema.json:34-38`) |
| `references` | `readonly AlertId[]` | required by the schema for Update/Cancel (G2, `schemas/cap-v1.2.schema.json:89-94`); mapped to the CAP `sender,identifier,sent` triplet form at the boundary (`:65-68`) |
| `responseType` | CAP enum incl. `AllClear` | drives §4's templating; already a schema-declared enum (`schemas/cap-v1.2.schema.json:125-134`) and already a boundary type (`src/adapters/interop/cap-mapper.ts:23-25`) |
| `urgency`, `certainty` | CAP enums | stop hardcoding `'Expected'`/`'Likely'` (`src/adapters/interop/cap-mapper.ts:115`, `:117`) |
| `headline`, `description`, `instruction` | text, generated by §4 | today fabricated in two places (`app/page.tsx:142`, `src/adapters/channels/http/routes/interop.ts:124-126`) |
| `capStatus` | `+ EXERCISE` | decided jointly with ADR-034 §7 — CAP-native, and the schema already notes the full enum allows it |

**ALL-CLEAR is first-class, not a convention.** An all-clear is
`msgType: CANCEL` (or `UPDATE` where the hazard is superseded rather than ended) **+**
`responseType: ['AllClear']` **+** `references: [originalAlertId]`, produced by a dedicated
`buildAllClear(original, approver, now)` domain function so the reference to the original identifier cannot be
forgotten — which matters because the existing schema rule (G2) would otherwise reject the document at emit
time with a validation error rather than at authoring time with a helpful one. `CapAlert` gains `references`
(G3) and the mapper emits it.

**Per-channel delivery counts (G7).** The counts come from the broadcast loop, which currently throws its
results away at `src/adapters/channels/http/routes/interop.ts:140`. The change is minimal and stays inside
ADR-026's posture (notifier-only injection, audited-not-fatal): capture each `notify` result in the loop
(`:138-143`), tally `{channel, attempted, delivered, failed}`, and put the tally on the approval response's
`meta` beside the existing `auditHash` (`:183`). No port signature changes and no new PII: the tally is
**counts per channel**, never per recipient — `subscribers.list()` holds opaque chat ids only (ADR-026 §1),
and nothing about an individual recipient is stored or displayed. The intended-recipient denominator is
`subscribers.list().length` (`src/adapters/channels/messaging/subscriber-registry.ts:27`); in the default
composition the transport is `RecordedTransport`, whose `sent` array (`messaging-port.ts:32`) gives an exact,
honest mock-mode count labeled as such.

**Honest scope note:** this is *dissemination* feedback (did our channel accept it, for how many
destinations), **not** delivery confirmation to a person and not read receipts — the annex's own constraint,
"coarse Telegram delivery-count only (no individual tracking/PII)"
(`CURRENT-PLAN-3-DIFFERENTIATORS.md:88-91`).

### 3. ISO 22324 pictograms and colour-never-alone (FR-WARN-3 / FU-17)

The mechanism already exists and is already correct in principle (G8): four **visually distinct shapes** per
severity with the localized text label carrying the meaning and the icon `aria-hidden`
(`app/_components/ui/severity-tag.tsx:21-26`, `:31`, `app/_components/ui/badge.tsx:25`). Per the annex, ISO
22324:2022 severity pictograms are driven by CAP severity/category with **colour never the sole carrier —
icon + text + ordering** (`CURRENT-PLAN-3-DIFFERENTIATORS.md:93-94`, WCAG 1.4.1). Three deltas:

1. **Wire `SeverityTag` into the alert surfaces.** `DraftAlertItem` gains `severity` and `category`
   (`app/_components/panels/draft-alert-review.tsx:10-16`) — the API already returns them
   (`src/adapters/channels/http/routes/queue.ts:117-125`) — and the panel renders `<SeverityTag>`
   (`app/_components/ui/severity-tag.tsx:46`) instead of the flattened string built at `app/page.tsx:142`.
2. **Every pictogram carries a text alternative** (FU-17, `docs/requirements/EARS_FINAL_VERSION.md:227-228`).
   The current pattern is icon-`aria-hidden` + adjacent visible text; where a pictogram ever appears without
   adjacent text (map legend, CB preview), it carries an explicit accessible name instead. A lint-style test
   asserts no pictogram exists without one of the two.
3. **Ordering is a carrier too.** `SEVERITY_ORDER` (`app/_components/ui/severity-tag.tsx:28`) sorts alert
   lists and the legend, so severity is conveyed by position as well as shape and text — the third
   non-colour channel the annex names.

Colour tokens stay where they are (`app/globals.css:23-26` dark, `:46-49` light); this ADR adds no new colour
semantics, only guarantees that colour is never load-bearing alone.

### 4. Plain-language templating, `responseType`-driven, per-locale, as DATA (FR-WARN-4 / FEV-17)

A new pure module `src/application/warning-text/` — the same shape as the existing deterministic text builders
(`buildExternalViews` `src/application/external-views/external-views.ts:39`; `HAZARD_LABEL`
`src/application/sitrep-synthesis/news-grounding.ts:66-72`; `compass8`
`src/application/shared/map-geometry.ts:123`; `renderDigest`
`src/adapters/channels/messaging/handle-inbound.ts:41`; `alertDigest`
`src/adapters/channels/http/routes/interop.ts:124`). It composes, deterministically and with no LLM
involvement (Art. XII):

- a **HAZARD-IN-CAPS headline**, then **What / Where / When / Impacts / Action** sections, populated from CAP
  fields — the NWS Hazard Simplification grammar as recorded at
  `CURRENT-PLAN-3-DIFFERENTIATORS.md:95-96`;
- the **Action** section selected by `responseType` (`Shelter`/`Evacuate`/`Prepare`/`Avoid`/`Monitor`/
  `AllClear`), which is why `responseType` had to become a domain field in §2;
- a reading-grade ceiling asserted by test.

**Templates are data, not code:** ICU message strings in the MW-A catalogs (ADR-030 — `messages/en.json` +
`messages/_fragments/`, loaded by `app/_lib/messages.server.ts:51`), keyed
`warning.<responseType>.<section>`, so a new phrasing or a new locale is a catalog edit. The module resolves a
key and interpolates already-computed values — it never concatenates a number it computed itself, and it
never calls a model. Server-side composition (the CAP document, the Telegram digest) uses `next-intl`'s
`createTranslator` directly, the same primitive the client shim wraps (`app/_lib/i18n.tsx:14`, `:65`), so the
panel and the emitted document render from one catalog. Where a locale lacks a key, the English fallback
applies (ADR-030's ladder, guarded by `tests/i18n/catalog-parity.test.ts`), and a raw key never renders
(acceptance test 2, `docs/requirements/EARS_FINAL_VERSION.md:338`).

The generated text is shown in the **review panel before approval** — which is also the fix for G9's
no-preview flow: the operator sees the plain-language rendering, the CB preview (§6) and the profile
validation result before the single click that emits.

### 5. Multilingual CAP + opt-in TTS (FR-WARN-5 / FOP-3)

**Multilingual CAP** uses CAP's own mechanism: repeatable `<info>` blocks with `xml:lang`
(`CURRENT-PLAN-3-DIFFERENTIATORS.md:98-100`). The schema is already ready — `info` is an array with
`minItems:1` and `info.language` is declared (`schemas/cap-v1.2.schema.json:73-78`, `:103-107`); only the
emitter's single-block construction has to change (G6, `src/adapters/interop/cap-mapper.ts:136`). The locked
rule from the i18n plan is **region language + English always**
(`CURRENT-MASTER-PLAN.md:59-61`), so `buildCapAlert` emits one `<info>` per selected language, English always
present.

**Enum tokens are never translated.** `category`, `responseType`, `urgency`, `severity`, `certainty` and
`msgType` are CAP closed vocabularies (`schemas/cap-v1.2.schema.json:108-118`, `:125-134`) and stay in their
canonical English tokens in every `<info>` block; only free text (`headline`, `description`, `instruction`,
`areaDesc`, `senderName`) is localized. A test asserts every emitted `<info>` uses identical enum values
across languages — the failure mode that would silently break every downstream consumer.

**TTS** is `FEATURE_TTS`, **default off** (`CURRENT-MASTER-PLAN.md:206-207`), browser
`SpeechSynthesis` only (no server call, no egress, no audio file), reading the §4 plain-language headline in
the active locale, **on explicit user activation only — audio never starts automatically** (FOP-3,
`docs/requirements/EARS_FINAL_VERSION.md:238-239`; master plan §5.9, `CURRENT-MASTER-PLAN.md:221-222`). Voice
availability is the browser's, so the control is hidden when no voice exists for the locale rather than
failing silently. Offline neural voices remain a documented roadmap item, not v1
(`CURRENT-PLAN-3-DIFFERENTIATORS.md:98-100`).

### 6. 3GPP cell-broadcast **preview** — an authoring aid, and nothing more (FR-WARN-6 / FEV-18)

A pure function `renderCellBroadcastPages(text, opts)` in `src/application/warning-text/`: GSM-7 encodability
check, split into **93-character pages** with a page count, honouring the **15-page cap** and the ETWS
primary-notification length check, exactly as recorded in the annex
(`CURRENT-PLAN-3-DIFFERENTIATORS.md:101-103`); FEV-18 requires the 93-character pages and the count
(`docs/requirements/EARS_FINAL_VERSION.md:236-237`). Non-GSM-7 characters are reported (not silently
transliterated) so the operator can choose the wording. Rendered in the review panel beside the plain-language
text (§4).

**Be blunt about what this is not.** BEACON is **not a Cell Broadcast Entity**. It has **no telco delivery
path**: no CBC/CBE interface, no operator agreement, no `SBc`/`CBS` integration, no MME/AMF connectivity, no
regulatory authorisation to originate a public warning on a mobile network. It cannot transmit a cell
broadcast, cannot verify one was transmitted, and cannot know whether a handset displayed one. The feature
renders **CB-ready text for the authority who does have that path** — the same posture as ADR-010's
"produce + validate CAP, no live IPAWS origination" and the annex's explicit "cannot-compete" statement:
no telco cell-broadcast/hardware delivery (`CURRENT-PLAN-3-DIFFERENTIATORS.md:36-39`, `:101-103`). Every
surface that shows a page count says so.

### 7. The D4 five modules — each a thin use-case + panel over a NAMED existing seam

Each behind its own flag (`src/config/index.ts`, plus a `NEXT_PUBLIC_` mirror — no `FEATURE_*` currently
reaches the browser; `src/config/index.ts:89-90` are declared and never read, and only `app/page.tsx:54`,
`:60` cross). Each panel mounts as one more tab in the existing `Tabs` groups (`app/page.tsx:214-235`,
`:237-259`) and one more barrel export (`app/_components/panels/index.ts`).

| FR / flag | Module | Existing seam (`file:line`) | Delta | Size |
|---|---|---|---|---|
| FR-D4-1 `FEATURE_D4_RUMOR_BOARD` | **Rumor board** | `groundNews` `src/application/sitrep-synthesis/news-grounding.ts:95`; flagging loop `:117-124`; `flaggedFact` `:214-225` (`flagged:true` `:223`); `flaggedCount` `:47`; the `flagged` field `src/application/sitrep-synthesis/sitrep-synthesis.ts:24-25` | a **read-only projection + panel** listing already-flagged items with their flag reason and corroboration state (the claim string at `news-grounding.ts:220` already carries the reason). Also export `news-grounding.js` from `src/application/index.ts:4-13`. **It never adjudicates truth** — a WHO EPI-WIN-style structure-and-route surface (`CURRENT-PLAN-3-DIFFERENTIATORS.md:110-111`); FEV-20 forbids merging a flagged item into any fact (`docs/requirements/EARS_FINAL_VERSION.md:275-276`) | **S** — genuinely a rendering job |
| FR-D4-2 `FEATURE_D4_MUTUAL_AID` | **Mutual-aid request board (EDXL-RM)** | the **already-built round-trip** (G10): `resourceTaskToEdxlRm` `src/adapters/interop/edxl-rm-mapper.ts:167`, `edxlRmToResourceTask` `:203`, status maps `:33`/`:44`/`:56`/`:65`; routes `src/adapters/channels/http/routes/interop.ts:193`, `:219`; table `src/adapters/channels/http/routes/feature-router.ts:314`, `:328-330`; matching via `listAvailable` (`src/ports/logistics.ts:30`) + distance ranking `src/application/pre-positioning/pre-positioning.ts:118` | a **list use-case + panel** over the existing store — the annex's "one panel away" logistics gap (`CURRENT-MASTER-PLAN.md:113-118`). **Must also fix G11:** validate inbound EDXL-RM against `schemas/edxl-rm.schema.json` before mapping, closing the emit/ingest asymmetry. Per G12 there is no `ResourceRequest` entity; the board is a view over `ResourceTask` correlated by `edxlRmRef` (`src/domain/resource-task.ts:24`) — stated plainly rather than implying a richer model | **S–M** |
| FR-D4-3 `FEATURE_D4_SHELTER_STATUS` | **Shelter status board** | `Shelter` `src/domain/shelter.ts:12-18` (capacity `:15`, occupancy `:16`, `FULL` invariant `:61-64`); `findShelters` `src/ports/logistics.ts:33` / `src/adapters/logistics/memory-logistics.ts:94`; wire type `ProjectedShelter` `src/application/map-projection/map-projection.ts:59-62` | **the largest of the five (G15): no shelter adapter exists** — shelters are hardcoded (`src/adapters/persistence/seed.ts:66`). Needs a real `SourceAdapterPort` for the FEMA Open Shelters ArcGIS feed (`CURRENT-PLAN-3-DIFFERENTIATORS.md:112-114`) with acl + manifest row + fixtures, on the ADR-027 pattern. Aggregate occupancy only; the write path is **counts, never a person**. Feeds ADR-035 §1(d) | **M** — not S–M as planned |
| FR-D4-4 `FEATURE_D4_DAMAGE_REPORTS` | **Damage / needs reports** | `PublicReport` `src/domain/public-report.ts:23-42`; consent `:32`; triage machine `:62-67`; `transitionPublicReport` `:138-146`; confidence components `:16-20`; retention stamp `src/adapters/memory/memory-core.ts:187`; verifier UI `app/_components/panels/verifier-queue.tsx` | add `category: 'SOS' \| 'DAMAGE' \| 'NEED'` (G14 — it does not exist today) + aggregate severity, reusing the **unchanged** consent/triage/verify/confidence/retention pipeline (FEV-23, `docs/requirements/EARS_FINAL_VERSION.md:281-282`). This is also the host for ADR-035's FR-D6-5 casualty tally | **M** |
| FR-D4-5 `FEATURE_D4_EMS_OVERLAY` | **Copernicus EMS damage overlay** | link-only/overlay doctrine ADR-028/ADR-029; adapter pattern ADR-027; inert planned flag `SOURCE_CEMSRM_MODE=cached  # NOT WIRED (planned)` at `.env.example:206` | read-only ingest of **published** delineation/grading products as an attributed COP layer labeled with its production date (FEV-24, `docs/requirements/EARS_FINAL_VERSION.md:283-284`). **Consume only** — EMS *activation* is Authorised-User-gated and BEACON never requests one (`CURRENT-PLAN-3-DIFFERENTIATORS.md:115-116`) | **M** |

## Verification

| # | What is verified | Concrete test / gate |
|---|---|---|
| V1 | **CAP validator fuzz** (master plan §5.8, `CURRENT-MASTER-PLAN.md:219-220`) | property-based fuzz over `buildCapAlert` inputs and over raw documents: the validator never throws, never returns ok for a document missing a required field, and always yields a non-empty actionable error list (`formatErrors`, `src/adapters/interop/schema-validator.ts:32`) |
| V2 | Profile selection is real and blocking | `CAP_PROFILE=base` accepts a document the IPAWS-style profile rejects and vice versa; a profile failure returns `PARSE_ERROR` and **no emission is recorded** (`src/adapters/alerting/alert-sink.ts:70-71`, emissions array unchanged); unknown `CAP_PROFILE` ⇒ fail-fast at boot (`src/config/index.ts` refine pattern, e.g. `:94-116`) |
| V3 | **All-clear round-trip** | build an ALERT → build its all-clear via `buildAllClear` → assert `msgType=Cancel`, `responseType=['AllClear']`, `references` contains the original identifier, and the document passes the **existing** conditional rule (`schemas/cap-v1.2.schema.json:89-94`); assert an all-clear built **without** references is rejected by that same rule (proving the gate, not just the builder) |
| V4 | Update/Cancel are constructible at all (G3/G4) | mapper test asserting `CapAlert.references` is emitted in the CAP `sender,identifier,sent` triplet form and that `msgType` is no longer pinned to `Alert` (`src/adapters/interop/cap-mapper.ts:134`) |
| V5 | Delivery counts are counts, never recipients | broadcast-loop test with 3 subscribers, 1 failing transport ⇒ `meta.delivery = {channel:'telegram', attempted:3, delivered:2, failed:1}`; a test asserting no chat id, handle or address appears anywhere in the response or the audit payload; audited-not-fatal preserved (a failing send never 5xx's the approval, ADR-026 §3) |
| V6 | **Pictogram a11y** | axe zero serious/critical (`e2e/a11y.spec.ts:9`, `:19-21`) extended to scan the DRAFT-alert panel individually — today only COP/palette/SOS/layers are scanned (`:23`, `:37`, `:50`, `:61`); component test asserting every severity renders a distinct icon **and** a text label, and a colour-blind-simulation-independent assertion that removing colour leaves severity unambiguous (shape + text + order, `app/_components/ui/severity-tag.tsx:21-28`) |
| V7 | Plain-language templating | golden tests per `responseType` × locale; reading-grade ceiling assertion; a test that the module produces **no number it computed itself** (all interpolated values come from the input); missing-key ⇒ English fallback, never a raw key (acceptance test 2, `docs/requirements/EARS_FINAL_VERSION.md:338`) |
| V8 | Multilingual CAP correctness | multi-`<info>` emission test: region language + English always present; **enum tokens byte-identical across all `<info>` blocks**; each block's `language` is a valid RFC-3066-shaped code (`schemas/cap-v1.2.schema.json:103-107`); document still passes base + profile validation |
| V9 | TTS is safe by default | `FEATURE_TTS=off` ⇒ control absent; on ⇒ playback only after an explicit activation event; a test asserting no autoplay path exists (no `speak()` call outside a user-event handler) |
| V10 | **Page-splitting unit tests** | exact-93-character boundary, 92/93/94-character inputs, a 15-page input and a 16-page input (cap enforced), an empty message, a non-GSM-7 character reported rather than transliterated, and the ETWS primary-notification length check; page count matches the pages returned |
| V11 | The CB preview cannot be mistaken for transmission | a test asserting every CB surface renders the "preview only — BEACON is not a Cell Broadcast Entity and has no telco delivery path" caveat, and that no code path performs any network call from the CB module |
| V12 | D4-1 rumor board never launders a rumor | a flagged item never appears as a `GroundedFact` with `flagged:false`, never contributes to `corroboration` (`src/application/sitrep-synthesis/news-grounding.ts:128`), and is always rendered with its flag reason (FEV-20) |
| V13 | D4-2 mutual aid round-trips **and** validates inbound | existing round-trip fidelity test extended with a board-level case; **new**: a malformed inbound EDXL-RM is rejected by `schemas/edxl-rm.schema.json` before mapping (closing G11), asserted against the raw-cast path at `src/adapters/channels/http/routes/feature-router.ts:261` |
| V14 | D4-3 shelter adapter behaves like every other adapter | acl + mapper unit tests, recorded fixture, manifest row schema-valid (`src/adapters/_shared/manifest.ts:40`), LIVE→cache→mock ladder, and aggregate-only occupancy (no person field — ADR-035 §4 Layer B applies) |
| V15 | D4-4 rides the unchanged pipeline | a `DAMAGE`/`NEED` report traverses consent → triage → verify identically to `SOS` (`src/domain/public-report.ts:62-67`), retains the same `purgeAfter` stamping (`src/adapters/memory/memory-core.ts:187`), and **cannot** emit CAP while `UNVERIFIED` (Art. XIII, existing test posture) |
| V16 | D4-5 overlay is attributed and dated | layer renders provider attribution + product production date; link-only/no-rehost assertion (ADR-027/028 doctrine); flag-off ⇒ layer absent |
| V17 | Flag isolation for all six surfaces | with every `FEATURE_D4_*` and `FEATURE_TTS` off, all gates stay green and no surface renders (NFR-F5, `docs/requirements/EARS_FINAL_VERSION.md:328`) |
| V18 | No regression in the emit guarantees | existing `src/adapters/alerting/alert-sink.test.ts` + `src/adapters/interop/cap-mapper.test.ts` stay green unchanged: ACTUAL-without-approver still `CONFLICT`, hash-chained emission audit still appended before recording (`src/adapters/alerting/alert-sink.ts:72-86`) |

## Consequences

**Positive.** The two most-documented last-mile gaps close with mechanisms that already half-exist: the
schema gate is real (G1) and already encodes the Update/Cancel rule (G2), so the all-clear work is emitter
work, not validator work. The pictogram component exists and merely needs wiring (G8). The EDXL-RM round-trip
exists, so the mutual-aid board really is one panel plus one list use-case (G10). Delivery counts need no port
change — only the loop that already exists stops discarding its results (G7). And the review panel gains a
genuine preview (plain language + CB pages + profile result), fixing the one-click-no-preview flow (G9) as a
by-product rather than as separate work.

**Negative / accepted.** (a) `src/domain/alert.ts` grows substantially (seven fields plus a status value) —
the largest domain change in the wave, touching the CAP mapper, the schema, the DB CHECK constraints and every
alert fixture; (b) multi-`<info>` emission multiplies document size and makes every CAP golden fixture
locale-dependent; (c) D4-3 is **M, not S–M** as the plan estimated, because it needs a whole new source
adapter (G15) — if the timeline compresses, D4-3 is the first of the five to drop, which the per-module flags
already permit (`CURRENT-MASTER-PLAN.md:229-230`); (d) the profile layer adds a second validation pass per
emission (negligible — validators are memoized, `src/adapters/interop/schema-validator.ts:13`) and a second
schema surface to keep truthful at MW-E; (e) fixing G11 (inbound EDXL-RM validation) may reject messages a
lenient partner currently sends — correct, but it is a behaviour change worth calling out; (f) the CWD-relative
schema read (G17) is inherited, not fixed, and remains a deployment constraint.

**Honest limitations (all must land in the consolidated SPEC "Known limitations" index,
`CURRENT-MASTER-PLAN.md:223-226`).**

1. **BEACON originates nothing on a public warning network.** No live IPAWS origination (ADR-010, Art. XIII),
   and the CB feature is a **preview/authoring aid only** — no CBE role, no operator interface, no
   authorisation, no way to confirm transmission or handset display (§6).
2. **"Profile-validated" ≠ certified.** Passing a transcribed profile rule set is a strong self-check, not an
   accreditation, and the rule sets are only as complete as the S03 transcription.
3. **Delivery counts are dissemination counts.** They say a channel accepted a message for N destinations —
   not that N people received, opened or understood it. No read receipts, no per-recipient tracking, by design
   (Art. XIV).
4. **Plain-language templates are English-authored and machine-translated for most locales** (ADR-030's
   posture: MT-labeled, unreviewed except `ro`) — protective-action wording is precisely where a translation
   error is most costly, so the MT label is mandatory on warning text and a human-reviewed catalog is the
   documented path to production use.
5. **TTS quality is the browser's**, and no voice may exist for a shipped locale; there is no offline neural
   voice in v1.
6. **ISO 22324 alignment is a design posture**, not a certified conformance claim; the pictogram set is
   BEACON's, chosen to satisfy the standard's colour-plus-additional-carrier principle as recorded in the
   annex (`CURRENT-PLAN-3-DIFFERENTIATORS.md:93-94`).
7. **The rumor board never adjudicates truth** (FEV-20) — it structures and routes an already-flagged,
   uncorroborated signal for human handling, and a flagged item is never merged into a fact
   (`src/application/sitrep-synthesis/news-grounding.ts:117-124`).
8. **EMS overlays are historical products**, published after an authorised activation; they are damage
   assessment, not live extent, and are labeled with their production date.

## Alternatives considered

- **Write a bespoke CAP validator instead of composing JSON-Schemas** — rejected: the base gate already works
  (G1) and the schema already expresses conditional business rules in the exact idiom a profile needs
  (`schemas/cap-v1.2.schema.json:80-95`). A hand-rolled rule engine would duplicate Ajv, be harder to audit
  against the published profile, and fail the "standards-provable" claim the annex makes
  (`CURRENT-PLAN-3-DIFFERENTIATORS.md:85-87`).
- **Enumerate IPAWS profile rules in this ADR** — deliberately rejected: inventing spec detail is the one
  failure mode that would discredit the whole standards claim. The rules are transcribed at S03 from the
  published profile with a citation per rule.
- **Model the all-clear as a new `capStatus` value** — rejected: CAP already expresses it as
  `msgType=Cancel/Update` + `responseType=AllClear` + `references`, and the schema already enforces the
  reference (`schemas/cap-v1.2.schema.json:89-94`). Inventing a BEACON-specific status would make our
  documents non-standard for exactly the downstream consumers we exist to feed.
- **Keep warning text in the UI layer** (today's behaviour, `app/page.tsx:142`,
  `src/adapters/channels/http/routes/interop.ts:124-126`) — rejected: the same alert would read differently in
  the panel, the Telegram digest and the CAP document, and none of them would be locale-aware or testable as a
  unit. One pure module, three consumers.
- **Let the LLM write the plain-language warning** — rejected (Art. XII/XIII). Protective-action wording is
  the highest-consequence text in the product; it is templated, deterministic, reviewable as a diff and
  identical on every run. The narrator may explain the situation around it, never compose the instruction.
- **Translate CAP enum tokens per locale** — rejected: they are closed vocabularies
  (`schemas/cap-v1.2.schema.json:108-118`, `:125-134`); translating them breaks every downstream parser. Only
  free text is localized (`CURRENT-MASTER-PLAN.md:59-63`).
- **Server-side TTS / shipped audio** — rejected: egress and bundle cost for a feature that is off by default,
  when the browser already has a synthesizer. Offline neural voices are recorded as roadmap
  (`CURRENT-PLAN-3-DIFFERENTIATORS.md:98-100`).
- **Per-recipient delivery tracking** — rejected (Art. XIV, ADR-026 §1): it would turn the opaque chat-id
  registry into a behavioural dataset about identifiable people for a marginal operational gain.
- **Build a `ResourceRequest` aggregate for the mutual-aid board** — considered, not chosen for v1 (G12):
  `ResourceTask` + `edxlRmRef` already round-trips the EDXL-RM lifecycle, and a second aggregate would need
  its own state machine, persistence and mapping for a board that is fundamentally a view. Recorded as the
  extension point if quantity/needed-by semantics are required later.
- **One `FEATURE_D4` flag** — rejected: master plan §5.4 requires per-surface flags so one module can be
  disabled without reverting (`CURRENT-MASTER-PLAN.md:206-208`), and EARS assigns each module its own
  (`docs/requirements/EARS_FINAL_VERSION.md:269-273`).

## Implementation status

Not started — this ADR is the S02 architecture record for wave MW-D (`CURRENT-MASTER-PLAN.md:154-158`).
S03 delivers: the `Alert` domain deltas + additive migration, `CapAlert.references`, the `EXERCISE` status
enum (jointly with ADR-034 §7), `schemas/cap-profiles/*.schema.json` transcribed from the published IPAWS
profile, the `warning.*` catalog keys (with ADR-030), inbound EDXL-RM validation, the FEMA shelter + EMS
adapter manifest rows, and `CONFIGURATION.md`/`.env.example` entries for `CAP_PROFILE`, `FEATURE_TTS` and the
five `FEATURE_D4_*` flags (plus `NEXT_PUBLIC_` mirrors). S04/S05+ implement under the golden-thread
requirement→spec→test→code discipline.
