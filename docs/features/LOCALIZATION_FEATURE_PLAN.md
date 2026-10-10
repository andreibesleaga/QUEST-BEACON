# Localization (i18n) Feature Plan — pointer

> **Status: IMPLEMENTED in wave MW-A.** This file is a historical golden-thread pointer, not a live plan.
> The monorepo-level plan files it links to (`CURRENT-*.md`) are not part of this repository.
> **Architecture of record: [ADR-030](../architecture/decisions/ADR-030-i18n-architecture.md).**
> **Shipped behaviour of record: [`../SPEC.md`](../SPEC.md) §3.5** (incl. the localization "Known
> limitations" set) and [`../architecture/CONFIGURATION.md`](../architecture/CONFIGURATION.md) §12a
> (registry, `beacon-locale` cookie, add-a-language procedure).
> **EXECUTION DOC OF RECORD: `CURRENT-MASTER-PLAN.md` (entrant planning file, not part of this repository)**
> (all three features collapsed into one; this i18n content = master §2A / wave MW-A).
> Detail annex: `CURRENT-PLAN.md` (entrant planning file, not part of this repository). Build order
> & integration: `CURRENT-PLANS-INTEGRATION.md` (entrant planning file, not part of this repository).
> Implemented plans are consolidated into `../../CHANGELOG.md`.

Localizes all UI + alerts (nothing else) via translation files. **14 locales shipped:** the 12-locale
CORE (`en, zh-Hans, hi, es, ar, fr, bn, pt-BR, id, ur, ru, ro` — world top-10 by speakers + Russian +
Romanian; **RTL: ar, ur**) plus the two locales promoted by shipped zones (`fil`, `el`) under the
coverage-completeness rule. **Every other language is add-by-config** — one `messages/<locale>.json` +
one `config/locales.json` row + one `LOCALE_IDS` id (+ a font subset if the script is new); no other
source change.

As built: next-intl v4 in **core-translator mode** (`createTranslator` behind a context defaulting to the
English catalog — no i18n routing, no middleware, no `[locale]` segment, no `NextIntlClientProvider`,
`next.config.mjs` untouched), `beacon-locale` cookie resolved **server-side** in the async root layout
(correct `<html lang/dir>` + localized metadata on the first byte), `messages/{locale}.json` ICU catalogs
with parity/ICU/`_meta`-honesty tests, logical-CSS RTL (map never flips), bundled self-hosted OFL Noto
subsets for Arabic (ar+ur), Devanagari (hi) and Bengali (bn) behind one per-glyph stack, CAP multilingual
multi-`<info>` (region language + English always, machine values proven identical), build-time-only MT
with honest `_meta.machineTranslated` labeling, **English fallback always**, **universal SI units**.
Deterministic core untouched (wave CW4 removed) — fact claims stay English and language-marked (Art. XII).

**Deviations from this plan, all deliberate and documented in ADR-030 / SPEC §3.5:** `zh-Hans` uses the
**system** font stack rather than a bundled subset (a usable SC face is 5–10 MB); Greek needs no bundled
face (Inter covers it); and locale state is the cookie + server layout rather than Zustand, so the first
paint is already correct.

The final full multi-lens audit + first release tag happen once in the combined integration pass after the
master plan's remaining waves land.
