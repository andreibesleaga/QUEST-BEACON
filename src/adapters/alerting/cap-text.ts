// BEACON — region-aware multilingual CAP options (D3.4; ADR-036 §5, FR-I18N-6 / FUW-2; finding F-53).
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// THIS FILE IS THE MISSING HOP.
//
// Wave A built `capTranslationsFor()` (src/adapters/interop/cap-mapper.ts) and `regionAlertLocales()`
// (src/adapters/persistence/region-registry.ts) and wired NEITHER: `capTranslationsFor` had no production
// caller at all, and the only production sink construction (`makeAlertSink({ clock })`) passed no
// `capOptions`, so every emitted CAP document carried exactly ONE English `<info>` block. Multilingual CAP
// was built-but-unreached. This module is the connective tissue:
//
//     alert  →  regionIdFor(alert)  →  regionAlertLocales(regions, regionId)   [region.languages + en]
//            →  warningTranslator(locale) + buildWarningText(...)              [the copy, per language]
//            →  capTranslationsFor(locales, texts)                            [ordered, en always]
//            →  CapOptions.translations                                       →  buildCapAlert → one <info> per language
//
// The structural reason it could not be wired before: `AlertSinkDeps.capOptions` is ONE GLOBAL object, while
// languages are a property of the alert's REGION. A constant cannot express "Romanian for a Romanian alert,
// English for a Californian one". `AlertSinkDeps.capOptionsFor` is the per-alert seam this needs.
// ════════════════════════════════════════════════════════════════════════════════════════════════════
//
// INVARIANTS THIS FILE IS RESPONSIBLE FOR:
//  • ENGLISH IS ALWAYS PRESENT (ADR-030 §7) — via `regionAlertLocales`, which appends `en` unconditionally,
//    so the authoritative wording is never absent from a public artefact.
//  • A LANGUAGE WITH NO COPY IS SKIPPED, NEVER MISLABELLED — `capTranslationsFor` drops a locale with no
//    entry rather than emitting English text under a foreign `<language>` tag. Because the copy here comes
//    from the catalogs (which have full key parity), every shipped locale has copy; an UNSHIPPED locale
//    never reaches this point, since `regionAlertLocales` filters to shipped `LocaleId`s.
//  • MACHINE VALUES ARE NEVER TRANSLATED — only `event`, `headline`, `description`, `instruction` are
//    produced per language. `category`, `responseType`, `urgency`, `severity`, `certainty`, geometry and
//    `areaDesc` are written identically into every block by `buildInfo`, and `capMachineValuesAgree()`
//    blocks the emission if they ever diverge.
//  • AREA DESCRIPTIONS ARE NOT TRANSLATED, deliberately: `areaDesc` names a real place, and a machine-
//    translated place name is a wrong place name. It is the same string in every block.
import type { Alert } from '@/domain/alert.js';
import { isAllClear } from '@/domain/alert.js';
import type { CapLocalizedText, CapOptions } from '@/adapters/interop/cap-mapper.js';
import { capTranslationsFor } from '@/adapters/interop/cap-mapper.js';
import type { RegionRegistry } from '@/adapters/persistence/region-registry.js';
import { regionAlertLocales } from '@/adapters/persistence/region-registry.js';
import { buildWarningText } from '@/application/warning-text/index.js';
import type { WarningTextInput } from '@/application/warning-text/index.js';
import { definedOnly } from '@/domain/shared/guard.js';
import type { LocaleId } from '@/config/locales.js';
import { warningTranslator } from './warning-catalog.js';

export interface CapTextDeps {
  /** The loaded region registry — the source of each region's `languages` (config/regions.json). */
  readonly regions: RegionRegistry;
  /**
   * Which REGION an alert belongs to. `Alert` carries an `incidentId`, not a region, so this resolution is
   * the composition's to make (feature-seed maps the demo incidents to their configured regions). Returning
   * `undefined` — an unknown incident — resolves to ENGLISH ONLY: never another region's language.
   */
  readonly regionIdFor: (alert: Alert) => string | undefined;
  /**
   * The human description of the affected area, per alert (e.g. "Butte County, California"). CAP requires an
   * `<areaDesc>` on every `<area>`; the geometry cannot supply the words. Absent ⇒ the mapper's documented
   * default.
   */
  readonly areaDescFor?: (alert: Alert) => string | undefined;
  /** Pre-formatted time phrase for the WHEN section, per alert. This module formats no dates (Art. XII). */
  readonly whenFor?: (alert: Alert) => string | undefined;
  /** Pre-computed impact sentence for the IMPACTS section, per alert. Never computed here (Art. XII). */
  readonly impactsFor?: (alert: Alert) => string | undefined;
}

/** The deterministic inputs the warning templates interpolate, assembled from the alert + the composition. */
function warningInputFor(alert: Alert, event: string, deps: CapTextDeps): WarningTextInput {
  const responseType = alert.responseType?.[0];
  const when = deps.whenFor?.(alert);
  const impacts = deps.impactsFor?.(alert);
  return {
    event,
    severity: alert.severity,
    areaDesc: deps.areaDescFor?.(alert) ?? '',
    ...(responseType !== undefined ? { responseType } : {}),
    ...(when !== undefined ? { when } : {}),
    ...(impacts !== undefined ? { impacts } : {}),
  };
}

/** The per-language copy for one alert in one locale (the human half of a CAP `<info>`). */
function textFor(
  alert: Alert,
  locale: LocaleId,
  deps: CapTextDeps,
): Omit<CapLocalizedText, 'language'> {
  const t = warningTranslator(locale);
  const event = t(`warning.event.${alert.category}`);
  const areaDesc = deps.areaDescFor?.(alert);
  const warning = buildWarningText(warningInputFor(alert, event, deps), t);
  // An all-clear leads with ALL CLEAR, not with the hazard and its severity: the first line of a cancel must
  // not read like a fresh warning for the same hazard. The instruction still comes from the AllClear action
  // key, so the wording is one catalog edit away in every language.
  const headline = isAllClear(alert) ? t('warning.allClear.headline', { event }) : warning.headline;
  const description = isAllClear(alert)
    ? t('warning.allClear.description', { event, area: areaDesc ?? '' })
    : warning.description;
  return {
    event,
    headline,
    description,
    instruction: warning.instruction,
    ...(areaDesc !== undefined ? { areaDesc } : {}),
  };
}

/**
 * Build the per-alert `CapOptions` the sink merges over its global defaults: one `<info>` block per language
 * the alert's region requires, English always included, machine values untouched.
 *
 * Returned as a plain function so the composition root can hand it to `makeAlertSink({ capOptionsFor })`
 * with no further plumbing, and so a test can call it directly and inspect the exact options produced.
 */
export function makeCapTextProvider(deps: CapTextDeps): (alert: Alert) => CapOptions {
  return (alert) => {
    const locales = regionAlertLocales(deps.regions, deps.regionIdFor(alert) ?? '');
    const texts: Record<string, Omit<CapLocalizedText, 'language'>> = {};
    for (const locale of locales) texts[locale] = textFor(alert, locale, deps);
    const areaDesc = deps.areaDescFor?.(alert);
    // The ENGLISH block's fields are ALSO set at the base-option level, so the single-language case and the
    // multilingual case are produced by one code path rather than two that can drift apart — and so the
    // authoritative English wording is the document's base text even for a non-English region (ADR-030 §7).
    const base = texts['en'] ?? texts[locales[0] ?? 'en'];
    return {
      ...definedOnly({
        event: base?.event,
        headline: base?.headline,
        description: base?.description,
        instruction: base?.instruction,
        areaDesc,
      }),
      translations: capTranslationsFor(locales, texts),
    } as CapOptions;
  };
}
