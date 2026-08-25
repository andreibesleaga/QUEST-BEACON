// BEACON — shipped-locale registry (ADR-030; FR-I18N-1/5/7/8; NFR-F7). Pure, env-free, and importable
// from BOTH the server (CAP multi-language emission, closed-vocabulary localization) and the browser
// (locale switcher, dir resolution) — so there is exactly ONE definition of "which locales ship".
//
// Two-part design, on purpose:
//   • LOCALE_IDS below is the TYPE-LEVEL truth (a literal union → `t()` call sites and the switcher are
//     compile-checked; a typo cannot reach runtime).
//   • config/locales.json is the DATA truth (display names, direction, script, review status, font).
// A drift-guard test asserts the two agree exactly — the same pattern that guards regions.json ids
// against the adapter manifest. Adding a language = one catalog + one JSON row + one id here.
import localesConfig from '../../config/locales.json';

/** Every shipped locale id, in switcher order (core 12 → zone-promoted 2). Type-level source of truth. */
export const LOCALE_IDS = [
  'en',
  'zh-Hans',
  'hi',
  'es',
  'ar',
  'fr',
  'bn',
  'pt-BR',
  'id',
  'ur',
  'ru',
  'ro',
  'fil',
  'el',
] as const;

export type LocaleId = (typeof LOCALE_IDS)[number];

/** Writing direction. `rtl` drives `<html dir>` + logical-CSS layout; the map canvas never mirrors. */
export type TextDirection = 'ltr' | 'rtl';

/**
 * Translation provenance — an HONESTY field, surfaced in the UI (Art. XV honest limitations):
 *  - `source`  : authored in this language (English).
 *  - `human`   : human-reviewed translation.
 *  - `machine` : machine-translated at build time, not yet human-reviewed → labeled in-UI.
 */
export type LocaleReview = 'source' | 'human' | 'machine';

export interface LocaleDescriptor {
  readonly id: LocaleId;
  /** Name in English (for the a11y label / docs). */
  readonly englishName: string;
  /** Endonym — what a speaker of the language calls it (what the switcher shows). */
  readonly nativeName: string;
  readonly dir: TextDirection;
  /** ISO 15924-ish lowercase script tag; selects the bundled font family. */
  readonly script: string;
  readonly review: LocaleReview;
  /** Bundled, self-hosted font family covering the script (never a CDN — offline-first). */
  readonly font: string;
}

/** The default/fallback locale. English is both the source language and the fallback at every level. */
export const DEFAULT_LOCALE: LocaleId = 'en';

/** Cookie carrying the reader's choice. Locale is UI state — never a URL segment (ADR-030). */
export const LOCALE_COOKIE = 'beacon-locale';

const BY_ID: ReadonlyMap<string, LocaleDescriptor> = new Map(
  (localesConfig.locales as readonly LocaleDescriptor[]).map((l) => [l.id, l]),
);

/** All shipped locales, in registry order. */
export const SHIPPED_LOCALES: readonly LocaleDescriptor[] = LOCALE_IDS.map((id) => {
  const found = BY_ID.get(id);
  // Fail fast at import time: a missing row is a build defect, not a runtime fallback case.
  if (!found) throw new Error(`config/locales.json is missing the locale row "${id}"`);
  return found;
});

/**
 * Locale-id guard. This is also the SECURITY boundary (NFR-F7): a locale id reaches a catalog file path,
 * so only ids on this fixed allowlist are ever accepted — no user string can traverse a path.
 */
export function isLocaleId(value: unknown): value is LocaleId {
  return typeof value === 'string' && (LOCALE_IDS as readonly string[]).includes(value);
}

/** Coerce any untrusted input (cookie, header, query) to a shipped locale, defaulting to English. */
export function toLocaleId(value: unknown): LocaleId {
  return isLocaleId(value) ? value : DEFAULT_LOCALE;
}

/** Descriptor for a shipped locale (total function — `LocaleId` is already validated). */
export function localeDescriptor(id: LocaleId): LocaleDescriptor {
  return SHIPPED_LOCALES[LOCALE_IDS.indexOf(id)]!;
}

/** Writing direction for a locale. */
export function localeDir(id: LocaleId): TextDirection {
  return localeDescriptor(id).dir;
}

/** True when the catalog is machine-translated and must carry the in-UI "unreviewed translation" notice. */
export function isMachineTranslated(id: LocaleId): boolean {
  return localeDescriptor(id).review === 'machine';
}

/**
 * The languages an outbound alert must carry for a region: the region's language(s) FIRST, then English —
 * always English, even when the region speaks something else (FR-I18N-6). Deduplicated, order-stable.
 */
export function alertLocalesFor(regionLocales: readonly string[]): readonly LocaleId[] {
  const out: LocaleId[] = [];
  for (const candidate of regionLocales) if (isLocaleId(candidate) && !out.includes(candidate)) out.push(candidate);
  if (!out.includes(DEFAULT_LOCALE)) out.push(DEFAULT_LOCALE);
  return out;
}
