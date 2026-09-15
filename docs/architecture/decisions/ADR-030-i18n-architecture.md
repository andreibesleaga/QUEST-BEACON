# ADR-030 — Localization: next-intl v4 without i18n routing, English-source catalogs, deterministic core untouched

- **Status:** Accepted (2026-07-26)
- **Deciders:** Entrant + prod-architect (master-plan wave MW-A / MW-B)
- **Relates to:** ADR-002 (frontend stack — Next.js App Router + Zustand + Tailwind v4, the surfaces this ADR
  localizes), ADR-001 (hexagonal — `src/domain`/`src/application` stay framework-free; catalogs and the client
  provider live in `app/`, the locale registry in `src/config/` so the server can emit multilingual CAP), ADR-009/ADR-024 (redundancy ladders — English is the fallback rung for strings, exactly as cache is
  for data), ADR-010 (interop CAP/EDXL/GeoJSON — multilingual CAP is a multi-`<info>` emit, enum tokens never
  translated), ADR-011 (multi-region registry — region `lang`/`tz` become live inputs), ADR-012
  (config-for-everything — locale is config + UI state, never code), ADR-023 (multi-channel interaction — the
  `InteractionRequest` locale seam; see Finding 5), ADR-031 (region-generic composition — the shipped-zone set
  that promotes `fil` + `el`), CONSTITUTION Art. XII (deterministic source of truth — the LLM never emits a
  number, in any language), Art. XVI (redundancy / degrade-never-dead-end — a missing catalog is a degraded
  rung, never a blank screen)
- **Requirements:** `docs/requirements/EARS_FINAL_VERSION.md` §1 — FR-I18N-1…8 (FU-1…FU-5, FEV-1/FEV-2,
  FST-1, FOP-1, FUW-1/FUW-2)
- **Threat model:** `docs/architecture/THREAT_MODEL.md` TB4 — new rows required: locale-id injection /
  path-traversal via the message loader, ICU-message denial (malformed catalog), font supply-chain (OFL Noto
  WOFF2 subsets committed in-repo with hashes), and the explicit "no new egress host" assertion (catalogs and
  fonts are build-time static imports; zero CDN, Art. XVI)

## Context

BEACON's COP is a single-page, `'use client'` operator screen (`app/page.tsx:102`) served over API routes; every
user-facing string in it is an English literal today (~260–310 strings across ~28 components plus ~33
aria-labels). A wildfire/flood COP whose operators cannot read it is unusable in exactly the regions that need
it most, and MW-B ships three non-anglophone zones (`ph`, `es`, `gr`) whose national languages must therefore
ship as locales (coverage-completeness rule, master plan §2A).

Four properties of the current tree constrain every option:

1. **English rendering must stay byte-identical.** ~200 exact-English assertions across the app test files and
   **four** Playwright visual baselines
   (`e2e/visual.spec.ts-snapshots/cop-{desktop-dark,desktop-light,tablet,phone}-linux.png`) pin the `en` render.
   The master plan §5.3 allows exactly two baseline regenerations across the whole feature, neither of them
   "because i18n".
2. **There is no SSR/SEO requirement.** The COP is an authenticated EOC tool behind a single route; the API is
   versioned under `app/api/v1/`. Nothing rewards a `/[locale]/…` URL space.
3. **Offline-first is constitutional (Art. XVI).** Catalogs and fonts must be in-repo static assets, never
   CDN-fetched. `app/globals.css:4` already records the doctrine verbatim — "No CDN: Inter is self-hosted via
   `@fontsource-variable/inter` (imported in layout.tsx). Offline-identical." — and `app/layout.tsx:6` is that
   import.
4. **The deterministic core is frozen for this wave.** Deterministic fact claims are composed as complete
   English sentences deep in `src/application` (`derive-cop.ts:293`, `:339`, `:349`, `:372`, `:381`;
   `news-grounding.ts:205`) and cross the wire pre-composed. Refactoring them to `{key, params}` would put a
   99%-coverage-floor module under churn for cosmetic gain and is explicitly out of scope (master plan §2A).

**Finding 1 — MW-A A1 landed while this ADR was being written; the ADR is written against the built code.**
This ADR was authored 2026-07-26 in parallel with an active MW-A A1 implementation session. At the start of
the S02 read the tree was pre-i18n (`app/layout.tsx:22` `<html lang="en">` hardcoded, no `messages/`, no
next-intl); by the end it was not. Verified current state: `next-intl@^4.13.4` declared (`package.json:60`)
and installed (4.13.4), plus `src/config/locales.ts`, `config/locales.json`, `messages/en.json`,
`app/_lib/i18n.tsx`, `app/_lib/messages.server.ts`, `app/_components/ui/locale-switcher.tsx`, and a rewritten
`app/layout.tsx`. **Every decision below now cites the shipped file, not a plan.** The pre-announced
`package.json` protected-file escalation for next-intl is therefore already spent; any *additional* dependency
(font packages) still needs one. Two decisions in the P1 annex were superseded by A1 and are recorded as such
here rather than silently: locale is resolved **server-side from the cookie** (not from a Zustand slice — §1),
and the fallback is a **server-side deep merge over English** (not a per-key runtime ladder — §2). Both
changes are improvements and are adopted as the decision.

## Decision

### 1. Library + mode: next-intl v4, "without i18n routing", cookie-resolved server render + client provider

**No `[locale]` route segment, no `middleware.ts` rewrite, no route restructuring.** Locale is UI state
carried by a cookie, resolved on the server so the first byte is already correct:

| Step | Mechanism | Evidence |
|---|---|---|
| 1 | The switcher writes the `beacon-locale` cookie and calls `router.refresh()` | `app/_components/ui/locale-switcher.tsx:27`–`:28`; cookie name `LOCALE_COOKIE = 'beacon-locale'` (`src/config/locales.ts:62`) — the same naming convention as `theme-toggle.tsx:11`'s `'beacon-theme'` |
| 2 | The async root layout resolves it: `resolveLocale()` reads the cookie via `next/headers` and **coerces anything unrecognised to English** | `app/_lib/messages.server.ts:42`–`:45`, using `toLocaleId` (`src/config/locales.ts:85`–`:87`) |
| 3 | `loadMessages(locale)` returns the catalog **deep-merged over English** | `app/_lib/messages.server.ts:51`–`:56` |
| 4 | `<html lang={locale} dir={dir}>` is **server-rendered**; `IntlProvider` mounts the merged catalog for the client tree | `app/layout.tsx` (`localeDir` from `src/config/locales.ts:95`–`:97`); `app/_lib/i18n.tsx:41`–`:48` |
| 5 | Absent everything | `DEFAULT_LOCALE = 'en'` (`src/config/locales.ts:59`) — the universal floor (FUW-1) |

**Server-side resolution beats the client-state design the P1 annex sketched** (a Zustand `locale` slice
mirroring `theme`), and A1 correctly chose it: `lang`/`dir` are right on the first paint, so a screen reader
and the bidi algorithm never see a wrong answer, and RTL never arrives as a post-hydration layout jump. There
is consequently **no locale field in `app/_lib/store.ts`** — the store keeps owning only client-transient
state (`activeRegionId`, `layers`, `selectedIncidentId`, `theme`, `actorRole`), which is the cleaner boundary.

**The provider wraps next-intl's core, not its hooks — deliberately.** `app/_lib/i18n.tsx` exposes `useT` /
`useFormat` built on `createTranslator` / `createFormatter` (`:14`, `:65`–`:90`) behind a context whose
**default value is the English catalog** (`FALLBACK`, `:33`). `NextIntlClientProvider` + `useTranslations`
would *throw* without a surrounding provider, forcing a provider wrapper into ~50 existing component tests and
making the English render depend on test plumbing (`app/_lib/i18n.tsx:4`–`:12`). With the English-default
context, a provider-less render produces identical English — which is exactly what keeps the existing suite
and the four visual baselines valid, and means a provider-less render can never leak a raw key. Keys are
**compile-checked** against `messages/en.json` (`Messages = typeof enMessages`, `:19`; `MessageNamespace`, `:22`),
so a typo is a `tsc` error rather than a runtime blank.

`NEXT_PUBLIC_DEFAULT_LOCALE` remains the documented deployment override for the default (ADR-012); it is a
build-inlined client flag on the two-track `NEXT_PUBLIC_*` precedent (`app/page.tsx:55`, `:61`;
`.env.example:280`, `:283`) and deliberately does **not** enter `EnvSchema` (`src/config/index.ts:14`), which
governs server config. It must still be documented in `CONFIGURATION.md` + `.env.example`.

Rationale for *not* using routing mode:

- **Byte-identical `en` is cheapest to guarantee when the URL never changes.** A `[locale]` segment moves
  `app/page.tsx` and every e2e path; the four visual baselines and the Playwright specs (`e2e/golden-path.spec.ts`,
  `e2e/layers-phase-d.spec.ts`, `e2e/a11y.spec.ts`, `e2e/perf.spec.ts`) all navigate to `/`.
- **No SEO/SSR benefit exists** for an EOC tool (Context §2), which is the only thing routing mode buys.
- **Air-gapped operation.** Middleware rewriting adds a request-path dependency for zero offline benefit.
- **The API surface is untouched.** `app/api/v1/[...path]/route.ts` and the `Envelope` contract
  (`src/ports/interaction.ts:52`) keep exactly their current shapes — no wire change in MW-A.

### 2. Catalog shape + the two-part registry: `messages/<locale>.json` ICU catalogs, descriptors in config

```
messages/
  en.json            ← SOURCE OF TRUTH (authored; never machine-generated)
  ro.json  ar.json  …
  en-XA.json         ← pseudo-locale, QA-only, excluded from the switcher
config/locales.json  ← DATA truth: per-locale descriptors (endonym, dir, script, review, font)
src/config/locales.ts← TYPE truth: LOCALE_IDS literal union + guards, importable server AND client
```

**The registry is deliberately split in two, drift-guarded** (`src/config/locales.ts:5`–`:10`): `LOCALE_IDS`
(`:14`–`:29`) is a `const` tuple, so the switcher and every `t()` call site are compile-checked; the display
data lives in `config/locales.json` and is loaded into `SHIPPED_LOCALES` (`:69`–`:74`), which **throws at
import time** if a row is missing — a build defect, never a runtime fallback. It lives in `src/config/` rather
than `app/` precisely because the **server** needs it too, for CAP multi-language emission and closed-vocabulary
localization (§6–§7). `LocaleDescriptor` (`:44`–`:56`):

| field | type | role |
|---|---|---|
| `id` | `LocaleId` | must match `LOCALE_IDS` (drift guard) |
| `englishName` / `nativeName` | string | a11y label / switcher endonym (`Español`, `العربية`, `简体中文`, `Ελληνικά`) |
| `dir` | `'ltr' \| 'rtl'` | drives `<html dir>`; single source, no second hardcoded RTL list (`localeDir`, `:95`) |
| `script` | ISO-15924-ish tag | selects the bundled font family |
| `review` | `'source' \| 'human' \| 'machine'` | **the honesty field** — `isMachineTranslated` (`:100`–`:102`) drives the in-UI notice (FU-4) |
| `font` | string | bundled self-hosted family covering the script — never a CDN (§5, Art. XVI) |

- **Namespaces = surfaces.** One top-level key per rendering surface, so `useT('toolbar')` maps 1:1 to a file
  region. Shipped so far (`messages/en.json`): `locale`, `app`, `toolbar`, …; the migration extends this to
  `map`, `map.legend`, `map.layers` (the `LAYER_META` labels/caveats at
  `app/_components/map/build-layers.ts:56`), `panel.sitrep`, `panel.logistics`, `panel.verifier`,
  `panel.routing`, `panel.decision`, `panel.drafts`, `form.sos`, `badge`, `palette`, `a11y`, `error`, `time`,
  `units`.
- **ICU MessageFormat** throughout (next-intl v4 native). Non-negotiable because `ar` uses all six CLDR plural
  categories and `ru`/`ro` use `few`/`many`.
- **Per-catalog `_meta` block, first key in every file** (`messages/en.json:2`–`:7`): `locale` (must equal the
  filename stem — drift guard), `review`, `machineTranslated`, `comment`. **Recommended addition, not yet
  present: `sourceRevision`** — the `en.json` content hash the translation was generated from, so a stale
  translation is *detectable* rather than merely unknown. A mismatch is a lint warning, never a render failure.
  (Descriptor-level provenance lives in `config/locales.json`; the in-file `_meta` keeps a catalog
  self-describing when read in isolation. The drift-guard test asserts the two agree.)
- **English is the source of truth and the fallback at every level** (FU-2, FUW-1), implemented as **two
  independent layers** — this is stronger than the single per-key ladder the P1 annex described, and both
  layers must be kept:
  1. **Server-side deep merge.** `loadMessages` merges the active catalog *over* English
     (`app/_lib/messages.server.ts:51`–`:56`; `mergeMessages` `:25`–`:39`), treating an **empty string as
     "not translated"** (`:30`) — a blank label is worse than an English one. A missing or unparseable
     catalog degrades to English rather than throwing (`importCatalog` `:62`–`:69`, Art. XVI). So an
     untranslated key cannot even reach the client.
  2. **Client-side `getMessageFallback`.** `englishFallback` (`app/_lib/i18n.tsx:107`–`:110`) substitutes the
     English message; if English were somehow absent (impossible while keys are type-checked) it degrades to
     the final key segment rather than blanking. ICU/lookup errors are surfaced in dev and swallowed in
     production (`reportIntlError`, `:113`–`:118`) — a crisis screen degrades, it never crashes.

  A raw key must never render in production; the raw-key-leak scan (Verification §5) enforces it end-to-end.
- **Never translated** (glossary, enforced by a lint rule): `BEACON`, `CAP`, `EDXL`, layer ids, CAP/EDXL enum
  tokens (FUW-2), provenance source names, place names, and the `DATA_ATTRIBUTION` legal credit lines
  ("Webcams provided by windy.com", "ALERTCalifornia | UC San Diego") which are verbatim licence obligations
  (ADR-027 §5, THREAT_MODEL T5.11).

### 3. Fourteen shipped locales; everything else is add-by-config

**12 core** — `en zh-Hans hi es ar fr bn pt-BR id ur ru ro` — **plus 2 promoted by MW-B's shipped zones**:
`fil` (Philippines) and `el` (Greece) ⇒ **14**, in switcher order, as shipped at `src/config/locales.ts:14`–`:29`
(FR-I18N-1, FR-ZONE-6). RTL: `ar`, `ur` (`dir` per row in `config/locales.json`). `ro` ships
`review: 'human'`; the other 12 non-`en` catalogs ship `review: 'machine'` and are labelled in-UI.

**The add-by-config contract (FR-I18N-7 / FOP-1) — a contributor adds exactly these and nothing else:**

| # | Artefact | Where |
|---|---|---|
| 1 | `messages/<locale>.json` (key parity with `en.json`, ICU-valid, `_meta` complete) | `messages/` |
| 2 | One descriptor row (`id`, `englishName`, `nativeName`, `dir`, `script`, `review`, `font`) | `config/locales.json` |
| 3 | One id in the `LOCALE_IDS` tuple | `src/config/locales.ts:14` — the only *source* file touched, and only so the literal union stays the compile-time truth |
| 4 | *Optional* — one self-hosted OFL WOFF2 subset + its NOTICE entry, **only if the script is new** | fonts dir + `NOTICE` |

No component, no route, no API, no server-logic change: `loadMessages` resolves the catalog by id at runtime
(`app/_lib/messages.server.ts:8`–`:9`, `:62`–`:69`), so nothing in the loader knows the locale list. The
registry is a fixed allowlist and is the security boundary for §8.

### 4. RTL: `dir` on `<html>`, logical CSS only, and the map never mirrors

- `app/layout.tsx` was `<html lang="en" data-theme="dark">` — **hardcoded**, a real pre-existing WCAG 3.1.1
  defect the moment a non-English string renders. It is now `<html lang={locale} dir={dir} data-theme="dark">`,
  **server-rendered** from the cookie (§1), so RTL is correct on the first byte rather than after hydration
  (FEV-1). `data-theme` keeps its existing client-toggle mechanism (`theme-toggle.tsx:21`) — the two
  attributes are independent by design.
- **Logical CSS properties only** in chrome. The physical-utility debt is small and fully enumerated — 16
  occurrences across `app/_components` + `app/page.tsx`. Concrete risks found:

  | Location | Utility | Treatment |
  |---|---|---|
  | `app/globals.css:118`, `:127` | `.skip-link { left: -9999px }` / `left: 0.5rem` on focus | → `inset-inline-start` (the **only** physical CSS in the 129-line stylesheet) |
  | `app/_components/ui/dialog.tsx:26`, `app/_components/command-palette.tsx:101` | `left-1/2` + `-translate-x-1/2` centring | keep — a symmetric centring transform is direction-invariant; do **not** churn it (baseline risk) |
  | `app/_components/ui/dialog.tsx:35` | `absolute right-3 top-3` (close button) | → `end-3` |
  | `app/_components/map/MapFeatureList.tsx:134`–`:155` | `text-left`, `pr-3` (table head/cells) | → `text-start`, `pe-3` |
  | `app/_components/panels/verifier-queue.tsx:185` | `text-right` (numeric confidence) | → `text-end` |
  | `app/_components/panels/decision-support.tsx:48`, `MapFeatureList.tsx:149` | `ml-1`, `ml-2` (unit/icon spacing) | → `ms-1`, `ms-2` |
  | `app/_components/map/LayerTogglePanel.tsx:59` | `pl-6` (caveat indent) | → `ps-6` |

  Because `en` is LTR, every logical utility resolves to the identical physical value, so the four visual
  baselines stay green — that is the reason the migration is safe (FST-1).
- **The map canvas, geographic axes, and map labels never mirror** (FST-1). The `MapView` container is
  explicitly `dir="ltr"`, and neither the MapLibre canvas nor `build-layers.ts` output is direction-aware.
- **Finding 2 — the `name:en` label claim does not apply to this basemap.** The default style is
  `OPEN_RASTER_STYLE` (`app/_components/map/style.ts:8`–`:18`): **raster** OSM PNG tiles
  (`tile.openstreetmap.org/{z}/{x}/{y}.png`), one `raster` layer, no vector source. Labels are baked into the
  tile bitmaps; there is no `text-field` and therefore **no `name:en` to select and no `setRTLTextPlugin`
  concern at all**. The correct honest statement is: *basemap labels are whatever the raster tile renders
  (predominantly local-language OSM `name`) and BEACON cannot and does not localize them* — documented as a
  known limitation, with the vector-style + `name:en` + RTL-plugin option recorded as post-v1 (it becomes
  relevant only if the offline vector/GIBS tile path in `style.ts:2` is adopted).

  - **Amendment, 2026-09-12 — the post-v1 option was adopted, for a different reason.** The raster host
    was found to be refusing this deployment outright (200 OK carrying an "Access blocked" image), so the
    online basemap became a ladder whose preferred rungs are the keyless **vector** hosts OpenFreeMap and
    VersaTiles. Vector tiles carry `name:<lang>` per feature, so `localizeLabels`
    (`app/_components/map/style.ts`) now rewrites every symbol layer's `text-field` to
    `coalesce(name:<lang>, name:latin, name)` — the basemap finally speaks the operator's language, and a
    language the tiles do not carry degrades to exactly the previous behaviour rather than to a blank
    label. **Finding 2's limitation therefore no longer holds for the vector rungs; it still holds
    verbatim for the raster rung**, which remains last in the ladder.
  - **RTL is still excluded, and that is a decision rather than an oversight.** Shaping Arabic/Urdu vector
    labels requires `setRTLTextPlugin`, whose build is fetched from a CDN at runtime — the same external
    dependency §5 declines for fonts. RTL locales stay on the latin label, which is what they already had;
    pinned in `style.test.ts` so nobody "fixes" it into unshaped, reversed text.

### 5. Fonts: system stack first, bundled OFL Noto subsets for core scripts only, ≤1 MB, no CDN

- `app/globals.css:77` is `--font-sans: 'Inter Variable', ui-sans-serif, system-ui, sans-serif`. It gains a
  **script-aware system fallback tail** before any download: `system-ui, "Segoe UI", "Noto Sans", "Nirmala UI",
  "Noto Sans Arabic", "Noto Sans Devanagari", "Noto Sans Bengali", "Microsoft YaHei", "PingFang SC", sans-serif`.
  Zero bytes on any OS that already has the script.
- **Bundled self-hosted OFL Noto WOFF2 subsets for CORE scripts only**: Arabic (serves `ar` **and** `ur`),
  Devanagari (`hi`), Bengali (`bn`), and a **subsetted** Noto Sans SC for `zh-Hans`. Loaded lazily
  per active locale via `unicode-range`-scoped `@font-face`, so a `zh-Hans` operator never downloads Arabic.
  **Budget: ≤1 MB total** (master plan §5.1). Licences → `NOTICE`; file hashes → THREAT_MODEL supply-chain row.
- **Finding 3 — the Greek claim is CORRECT, and the P1 annex's font claim is WRONG.** The shipped
  `@fontsource-variable/inter` **does** ship Greek: `node_modules/@fontsource-variable/inter/index.css:31`–`:38`
  declares `inter-greek-wght-normal` with `unicode-range: U+0370-0377,U+037A-037F,U+0384-038A,U+038C,U+038E-03A1,U+03A3-03FF`,
  and `:21`–`:28` declares `inter-greek-ext` (`U+1F00-1FFF`). So the master plan §2B statement "Inter covers
  Greek, no font cost" holds and **`el` adds zero font bytes**; `CURRENT-PLAN.md:93`'s claim that Inter
  "covers Latin+Cyrillic ONLY" is factually wrong and must not be carried into the spec. (Cyrillic for `ru` is
  likewise already covered — `index.css:1`–`:19`.)
- No CDN, ever: fonts are `npm`/in-repo assets imported from `app/layout.tsx:6`'s pattern (FU-5, Art. XVI).
- Honest caveats stated in-UI/docs: Urdu renders in **naskh**, not Nastaliq; minimal-OS installs fall through
  to the bundled subset; CJK is a **subset**, so a rare glyph may fall back.

### 6. The deterministic-core boundary (constitutionally load-bearing)

This is the part that must not be softened. **Translation is presentation. Facts are computation.**

| Layer | Language policy | Verified seam |
|---|---|---|
| `src/domain`, `src/application` | **English only, unchanged in MW-A.** No `t()`, no locale parameter, no ICU. | Art. XII / ADR-001; boundaries proven each wave by `depcruise` + `tests/architecture` |
| Deterministic `GroundedFact.claim` | Stays **English**, rendered with `lang="en"` part-markup (WCAG 3.1.2), with a visible "fact claims are shown in English" note | `src/application/derivation/derive-cop.ts:293`–`:299` (exposure), `:339`–`:347` (population), `:349`–`:357` (priority), `:372`–`:379` (weather), `:381`–`:388` (crest); `:364`–`:370` `rankedToPriorities` (`blended risk score X`); `src/application/sitrep-synthesis/news-grounding.ts:205` |
| LLM narrator | **Receives a locale, still never emits a number.** `NarrativeRequest` gains `locale?: string`; the prompt says "narrate in `<locale>`; cite the supplied facts verbatim; introduce no figures". | `src/ports/intel.ts:43`–`:46` (`NarrativeRequest = {facts, style?}` — no locale today); `src/application/sitrep-synthesis/sitrep-synthesis.ts:107`–`:123` `narrate()` |
| Server closed vocabularies | Localized **at the presentation edge**, not in the domain: the token is emitted, the client renders the label. | `compass8()` — `src/application/shared/map-geometry.ts:123`, consumed inside a composed English sentence at `src/application/map-projection/map-projection.ts:331`; `HAZARD_LABEL` — `src/application/sitrep-synthesis/news-grounding.ts:66`, consumed at `:205` |
| CAP/EDXL enum tokens | **Never translated** (FUW-2) | `SEVERITY_MAP` `src/adapters/interop/cap-mapper.ts:77`; `capCategory` `:85` |

**Why this preserves Art. XII.** The `isGrounded` check
(`src/application/sitrep-synthesis/sitrep-synthesis.ts:126`–`:129`) accepts narration only if every citation
it returns was in the fact set BEACON supplied. That check is language-agnostic — it compares source ids, not
prose — so threading a locale into the prompt cannot weaken it. The narrator's permitted input set is still
exactly `toCitedFacts(...)` (`:131`), whose numbers are engine outputs. **Adding a locale changes the prose
style, never the number provenance.** AI-parity tests stay valid for the same reason: they assert
"deterministic-only summary ≡ the joined engine claims" (`deterministicSummary`, `:101`–`:103`) and the
AI-disabled path (`:73`) — both operate on the English `GroundedFact.claim` strings, which MW-A does not
touch. The whole i18n layer is a pure lookup at render time: no runtime machine translation, no LLM in the
string path (Art. XII), so a translated UI is still a deterministic UI.

**Presentation-edge localization pattern.** Where a closed vocabulary must be localized without touching the
domain, the *sentence* stays English and the *token* is additionally exposed as a structured field the client
can render (e.g. the wind label keeps its English `label` and gains `directionToken: 'NE'`). This is additive
only, and the `{key, params}` structured-fact refactor for the full ~40–60 sentence inventory is recorded here
as the **post-v1 seam** — deliberately out of MW-A (master plan §2A "NO deterministic-core refactor").

### 7. Interop: multilingual CAP, EDXL language fields

- **CAP v1.2 multilingual = one `<info>` per language.** Locked policy: **region language + English, always**
  (FEV-2, FR-I18N-6). `ro` ⇒ two blocks (`ro`, `en`); `us-ca` ⇒ one (`en`); `es`/`gr`/`ph` ⇒ two. The
  resolver is **already built and unit-testable**: `alertLocalesFor(regionLocales)`
  (`src/config/locales.ts:108`–`:113`) returns the region's shipped locales followed by English, deduplicated
  and order-stable, appending `en` unconditionally. It has **no caller yet** — wiring it is A4's job, and it
  is the reason the locale registry lives in `src/config/` rather than `app/` (§2).
- **Finding 4 — the emitter is single-`<info>` and the language field has no caller.** `CapOptions.language`
  is declared (`src/adapters/interop/cap-mapper.ts:74`) and forwarded into the block
  (`buildInfo`, `:111`), but `buildCapAlert` hardcodes **one** block: `info: [buildInfo(alert, opts)]`
  (`:135`), and the sole caller — `src/adapters/alerting/alert-sink.ts:70`, spreading `deps.capOptions`
  (`:45`) — never populates `language`. MW-A A4 must therefore (a) widen `buildCapAlert` to emit
  `info: CapInfo[]` from a per-language options list, and (b) wire the region language from the region
  registry. **Machine-readable parity across blocks is a hard invariant**: `category`, `urgency`, `severity`,
  `certainty`, `responseType`, `area`/`polygon`, and all identifiers/timestamps must be **identical** in every
  block; only `headline`/`description`/`instruction`/`senderName` differ. A structural test asserts it.
- **EDXL** (`src/adapters/interop/edxl-rm-mapper.ts`, `edxl-sitrep-mapper.ts`) gains the schema's language
  field, populated from the same resolution.
- **Telegram digest** labels come from the catalogs (`renderDigest`,
  `src/adapters/channels/messaging/handle-inbound.ts:41`, called at `:68`).
- **Finding 5 — the channel envelope does NOT carry a locale.** ADR-023 §1 (lines 28–29) documents the
  contract as `{ actor (role+id), command, args, locale }`, but the implemented `InteractionRequest`
  (`src/ports/interaction.ts:160`–`:172`) has **no `locale` field** (and no `args`). The seam is
  ADR-documented-but-unimplemented; MW-A A4 adds `readonly locale?: string` as an additive optional field and
  threads it to the narrator and the CAP language resolution.

### 8. Budgets, security, QA

| Control | Target / mechanism |
|---|---|
| Added client JS | **≤ +300 KB gz** total for MW-A (next-intl + provider + switcher); Playwright perf spec asserts it; TTTP stays **< 10 s** |
| Catalog shipping | **Only the active locale's catalog reaches the client** — dynamic `import()` per locale, so 14 catalogs never become 14 payloads |
| Fonts | ≤ 1 MB total, lazy per active locale, self-hosted (§5) |
| ICU compile lint | every catalog parsed + compiled in CI; a malformed message fails the gate, and at runtime falls back to English rather than throwing (FUW-1) |
| Key parity | every shipped catalog's key set ≡ `en.json`'s (no missing, no extra) |
| Raw-key-leak scan | Playwright walks the rendered DOM under each locale asserting no `namespace.key`-shaped text node |
| **Locale-id allowlist** | **Implemented.** `isLocaleId` / `toLocaleId` (`src/config/locales.ts:80`–`:87`) coerce *any* untrusted value (cookie, header, query) to a member of the fixed `LOCALE_IDS` tuple, defaulting to `en`. `resolveLocale` (`app/_lib/messages.server.ts:42`–`:45`) applies it before the id can reach an import specifier (`:64`), so **no caller-controlled string can traverse a path** (`../../etc/passwd`, `%2e%2e`, an oversized id). This is the security boundary and it is stated as such in both files (`locales.ts:77`–`:79`, `messages.server.ts:11`–`:12`). THREAT_MODEL row still required. |
| Pseudo-locale | `en-XA` (accented + 40 % expanded + bracketed) catalog, QA/dev only, excluded from the switcher — catches hardcoded literals and layout overflow before a real translation exists |
| Accessibility | axe run under `en` + `ar` (RTL) + one CJK locale, zero serious/critical |

## Consequences

- **Positive.** The largest single usability lever in the project (rubric 4) for a bounded, mechanical change:
  no route change, no API change, no DB change, no domain change. `en` stays byte-identical, so the existing
  1832-test suite and all four visual baselines remain the regression net rather than becoming collateral.
  Adding language #15 is one JSON file plus one registry row — the same "zero core change" claim the adapter
  registry makes for data sources (ADR-011/ADR-027 §7). Multilingual CAP is a genuine standards-depth win
  (rubric 3): CAP v1.2's own multilingual mechanism, used correctly, with machine-readable parity enforced.
  The `dir`/`lang` fix repairs a real pre-existing WCAG 3.1.1 defect (`app/layout.tsx:22`).
- **Negative / accepted — machine translation is the headline limitation, and it is disclosed three ways.**
  Twelve of the fourteen catalogs are LLM/MT-generated and **not reviewed by a native speaker**. Emergency
  wording is exactly where a mistranslation costs most. Mitigation is honesty plus containment, not a claim of
  quality: (a) **in-file** — `_meta.machineTranslated: true`, `_meta.reviewedBy: null`, and
  `_meta.sourceRevision` so drift is detectable; (b) **in-UI** — a persistent one-line notice while such a
  locale is active ("Machine-translated, not reviewed by a native speaker — English is authoritative"), per
  FU-4; (c) **in-docs** — a row in the SPEC consolidated "Known limitations" ledger (master plan §5.10).
  Structural containment: **every emitted alert always carries the English `<info>` block** (§7), so the
  authoritative wording is never absent from a public artefact, and **enum tokens are never translated**, so
  machine-readable interoperability cannot be damaged by a bad string. `ro` is the one human-reviewed
  non-English catalog and is labelled as such. Community review is the upgrade path: a reviewer flips
  `machineTranslated: false` / sets `reviewedBy` with no code change.
- **Negative / accepted — English fact claims in a translated UI.** Deterministic `GroundedFact` sentences and
  SitRep priorities render in English inside an otherwise Arabic or Filipino screen (§6). This is a visible
  seam, mitigated by `lang="en"` part-markup (so screen readers switch voice correctly, WCAG 3.1.2) and an
  explicit note. It is the deliberate price of not destabilizing a 99 %-coverage deterministic core mid-feature.
- **Negative / accepted — basemap labels are not localized** and, on the raster default, cannot be
  (Finding 2). Documented, not hidden.
- **Negative / accepted — ongoing catalog maintenance.** Every new user-facing string is now 14 edits, or one
  edit plus 13 fallbacks-to-English. Key parity + `sourceRevision` make the debt visible instead of silent.
- **Neutral.** Units are **universal metric (SI), always labelled**, in every locale (FU-3) — so `units` in
  the region registry stays intentionally dormant. See ADR-031 Finding 6 for the `us-ca` `"units": "imperial"`
  value that is now actively misleading. Locale-aware *formatting* (dates/numbers/relative time) is separate
  and does apply. A1 built the mechanism (`useFormat` → `createFormatter({locale, timeZone})`,
  `app/_lib/i18n.tsx:87`–`:90`) but **no rendering code calls it yet**: there is still **no direct `Intl.*`
  call anywhere** in `src/` or `app/`, and `formatRelativeTime` remains hand-rolled English
  (`app/_components/ui/relative-time.ts:20`–`:25` — `"…s ago"`/`"…m ago"`/`"…h ago"`/`"…d ago"`), consumed by
  `freshness-badge.tsx` and `provenance-popover.tsx` (`app/_components/ui/index.ts:64`). A2 replaces it with
  `Intl.RelativeTimeFormat(locale)`. Also: `IntlValue.timeZone` is still the literal `'UTC'`
  (`app/layout.tsx:42`); the region's `tz` reaching it is MW-B work (ADR-031 item 12), and until then FU-3's
  "in the active region's timezone" clause is not yet satisfied. (Note: the helper is at
  `app/_components/ui/relative-time.ts`, not `app/_lib/relative-time.ts` as the P1 annex states.)

## Alternatives considered

- **next-intl in routing mode (`/[locale]/…` + middleware)** — rejected. It buys SSR/SEO per locale, which an
  authenticated single-page EOC tool does not need (Context §2), and costs the one thing MW-A cannot spend:
  it moves `app/page.tsx` and every e2e path, putting all four visual baselines and ~200 exact-English
  assertions at risk for zero operator benefit.
- **A hand-rolled zero-dependency dictionary (`Record<locale, Record<key,string>>` + a `t()` helper)** —
  rejected. It saves ~0 KB (next-intl is already installed, Finding 1) and loses ICU. Arabic needs all six
  CLDR plural forms and `ru`/`ro` need `few`/`many`; re-implementing CLDR plural selection would be new
  untested logic in exactly the place a bug is invisible to an English-speaking author. The catalog layout is
  deliberately kept swappable to this pattern if next-intl were ever dropped.
- **Runtime machine translation (translate-on-render via an API or a local model)** — rejected on three
  independent grounds: it violates offline-first (Art. XVI — a network dependency for the UI to render text),
  it puts a model in the string path (Art. XII), and it makes rendering non-deterministic, breaking the
  fixed-clock/zero-network test contract. Translation happens **once, at authoring time**, and is committed as
  reviewable JSON.
- **Refactoring deterministic facts to `{key, params}` in MW-A** — rejected for this wave (master plan §2A
  lock). It is the *correct* long-term design and is recorded above as the post-v1 seam, but it churns
  `src/application` modules under a 99 % coverage floor and changes the wire shape mid-feature. English +
  `lang="en"` part-markup + an honest limitation is the accepted interim.
- **Server-side locale negotiation via `Accept-Language`** — rejected as the primary mechanism: an operator's
  browser language is often not the language they want the COP in, and it would reintroduce a
  request-dependent render. Available later as a *first-visit hint* only, never an override of a stored choice.
- **Bundling all 14 catalogs into the main chunk** — rejected: it blows the +300 KB budget for no benefit,
  since an operator uses one locale at a time. Per-locale dynamic import is the decision.
- **Translating the `DATA_ATTRIBUTION` credit lines** — rejected: they are verbatim licence obligations
  (ADR-027 §5), and altering them is a compliance defect, not a localization improvement.

## Verification

Every item below is a gate, not a TODO (Gate 7 golden thread — FR → test).

| # | Gate / test | Proves |
|---|---|---|
| 1 | `tests/i18n/key-parity.test.ts` — each shipped catalog's key set ≡ `messages/en.json`'s | FR-I18N-2, FOP-1 |
| 2 | `tests/i18n/icu-lint.test.ts` — every message in every catalog compiles; plural categories valid for the locale | FUW-1 |
| 3 | `tests/i18n/fallback-ladder.test.ts` — missing key → English; malformed ICU → English; missing catalog → English; **never throws, never blanks** (registered in `gabbe.config.json` `required_acceptance_tests`; protected-file escalation pre-announced) | FR-I18N-2, FUW-1, Art. XVI |
| 4 | `src/config/locales.test.ts` + `tests/i18n/meta.test.ts` — **registry drift guard**: `LOCALE_IDS` ≡ `config/locales.json` rows exactly (both directions); every id has a shipped catalog; `_meta` well-formed with `locale` ≡ filename; `review`/`machineTranslated` agree between catalog and descriptor; `ro` is `human`, all other non-`en` are `machine` | FR-I18N-5, FOP-1 |
| 5 | `e2e/i18n-rtl.spec.ts` — raw-key-leak scan of the rendered DOM per locale; `<html lang>`/`dir` correct after switching; **one** `ar` RTL visual smoke (a new snapshot, not a regeneration of the four `en` baselines) | FR-I18N-1, FR-I18N-3, FEV-1, FST-1 |
| 6 | `e2e/visual.spec.ts` — the four existing `cop-*-linux.png` baselines pass **unchanged** | byte-identical `en` |
| 7 | `e2e/a11y.spec.ts` — axe zero serious/critical under `en`, `ar`, and one CJK locale | master plan §5.9 |
| 8 | `e2e/perf.spec.ts` — added client JS ≤ +300 KB gz; only the active locale's catalog in the payload; TTTP < 10 s | master plan §5.1 |
| 9 | `tests/i18n/locale-allowlist.test.ts` — traversal/oversize/unknown locale ids (`../`, `%2e%2e`, `en%00`, a trailing-space id, 500-char) all resolve to `en` and never touch the filesystem | THREAT_MODEL locale-injection row |
| 10 | `src/adapters/interop/cap-mapper.test.ts` — multi-`<info>` emit; **English block always present**; machine-readable fields byte-identical across blocks; enum tokens untranslated | FR-I18N-6, FEV-2, FUW-2 |
| 11 | `src/application/sitrep-synthesis/*.test.ts` — AI-disabled parity and `isGrounded` rejection unchanged with a locale threaded; narrator output containing a digit not present in the supplied facts is rejected | **Art. XII** |
| 12 | `tests/i18n/pseudo-locale.test.ts` + a manual `en-XA` pass | no hardcoded literals; layout survives 40 % expansion |
| 13 | `tests/architecture/*` + `npx depcruise` — zero new edges from `src/domain`/`src/application` into `app/` or `next-intl` | ADR-001 boundary |
| 14 | `tests/i18n/fonts.test.ts` + NOTICE check — bundled subsets ≤ 1 MB, no CDN URL in any built asset, every OFL font has a NOTICE entry and a recorded hash | FU-5, Art. XVI |

## Implementation complete: Partial — A1 landed 2026-07-26; A2–A5 pending (wave MW-A, master plan §3)

**A1 scaffold — DONE** (verified in tree, Finding 1): `next-intl@^4.13.4` (`package.json:60`); two-part locale
registry (`src/config/locales.ts`, `config/locales.json`); server catalog loader with English deep-merge and
the allowlist boundary (`app/_lib/messages.server.ts`); English-default client provider + `useT`/`useFormat`
(`app/_lib/i18n.tsx`); cookie switcher + `router.refresh()` (`app/_components/ui/locale-switcher.tsx`, mounted
before `ThemeToggle` in the `app/page.tsx` toolbar); server-rendered `<html lang/dir>` + localized
`generateMetadata` (`app/layout.tsx`); `messages/en.json` seeded.

**Pending:** **A2** component migration to `t()` keys + `Intl` formatting (incl. replacing the hand-rolled
`app/_components/ui/relative-time.ts:20`–`:25` with `Intl.RelativeTimeFormat`, and threading the active
region's `tz` into `IntlValue.timeZone` — today the document default is `'UTC'`) → **A3** the 13 non-`en`
catalogs + font subsets + pseudo-locale + the logical-CSS pass (§4 table) → **A4** alert/channel wiring
(multi-`<info>` CAP per Finding 4 — note `alertLocalesFor` (`src/config/locales.ts:108`–`:113`) already
implements "region language + English always" and is ready for its caller; EDXL language; Telegram digest;
`InteractionRequest.locale` per Finding 5; narrator locale; closed vocabularies) → **A5** the test battery
above + docs (SPEC §3.5, CONFIGURATION, `.env.example`, NOTICE, THREAT_MODEL rows, CHANGELOG, `llms.txt`).

Findings 1–5 are inputs to A2–A4 and must be reflected in the S03 spec deltas.

---

## Correction (2026-07-27, finding F-58) — Romanian review status

Three statements above (§Decision "ro ships `review: 'human'`", §Consequences "`ro` is the one
human-reviewed non-English catalog", §Verification row 4 "`ro` is `human`") were **aspirational, not
factual**: no human review of `messages/ro.json` has happened. The catalog's own `_meta` carried the same
unearned claim ("reviewed by a human translator"), and during A4.3b a consistency pass harmonized the
registry TOWARD that claim — the wrong direction. All surfaces now say `review: 'machine'` /
`machineTranslated: true` for `ro`, and the in-UI machine-translation notice shows for Romanian, until the
entrant (a native speaker) actually reviews the catalog and flips BOTH `messages/ro.json` `_meta` and the
`config/locales.json` row together. The statements above are retained verbatim as the intended END state;
this note records that they describe the state AFTER that review, not before. (See also S03 delta
"Known limitations" item 1 / finding F-42, which already stated the truthful version.)

## Resolution (2026-07-28) — Romanian review completed

The correction above is now **discharged**. The entrant (a native Romanian speaker) reviewed
`messages/ro.json` on 2026-07-28 and confirmed it. `review: 'human'` / `machineTranslated: false` were set
on **both** surfaces together — the catalog's `_meta` and the `config/locales.json` row — per the F-58 rule
that the two may only ever move as a pair, and `src/config/locales.test.ts` now pins
`isMachineTranslated('ro') === false`. The original §Decision / §Consequences / §Verification statements
that `ro` is the one human-reviewed non-English catalog are therefore **accurate as written**, and the
in-UI machine-translation notice correctly no longer shows for Romanian. The other 12 non-English catalogs
remain `machine` and keep their notice.
