// BEACON — server-side catalog loader (ADR-030; FR-I18N-2/7). SERVER ONLY: it is imported by the root
// layout, so non-active catalogs never reach the browser — only the resolved, merged catalog is serialized
// into the client provider (keeps the added-JS budget, master plan §5.1).
//
// Two guarantees live here:
//  1. FALLBACK LADDER (FR-I18N-2 / FUW-1): the active catalog is deep-merged OVER English, so any key the
//     translators have not delivered yet resolves to the English source text — a lookup can never miss.
//  2. ADD-A-LANGUAGE-BY-CONFIG (FR-I18N-7): the catalog is resolved by id at runtime, so shipping a new
//     language is one `messages/<id>.json` + one `config/locales.json` row — NO code change here.
//
// Security (NFR-F7): the id reaching the import specifier is always one of the fixed `LOCALE_IDS`
// (`toLocaleId` coerces anything else to English), so no caller-controlled string can traverse a path.
import { cookies } from 'next/headers';
import enMessages from '../../messages/en.json';
import { DEFAULT_LOCALE, LOCALE_COOKIE, toLocaleId, type LocaleId } from '@/config/locales.js';
import type { Messages } from './i18n.js';

/** A nested catalog tree: objects of strings (ICU messages) at the leaves. */
type MessageTree = { readonly [key: string]: string | MessageTree };

/**
 * Deep-merge `override` onto `base`, keeping `base` wherever the override is absent, empty, or a type
 * mismatch. Empty strings count as "not translated" — a blank label is worse than an English one.
 */
function mergeMessages(base: MessageTree, override: MessageTree): MessageTree {
  const out: Record<string, string | MessageTree> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = out[key];
    if (typeof value === 'string') {
      if (value !== '') out[key] = value;
    } else if (typeof current === 'object' && current !== null) {
      out[key] = mergeMessages(current, value);
    } else if (current === undefined) {
      // A key the English source does not have: keep it (harmless), it is simply never referenced.
      out[key] = value;
    }
  }
  return out;
}

/** Read the reader's locale choice from the cookie, coerced to a shipped locale (English by default). */
export async function resolveLocale(): Promise<LocaleId> {
  const store = await cookies();
  return toLocaleId(store.get(LOCALE_COOKIE)?.value);
}

/**
 * Load the catalog for `locale`, merged over English. English short-circuits (it IS the base), so the
 * default path does zero extra work and renders byte-identically to the pre-i18n build.
 */
export async function loadMessages(locale: LocaleId): Promise<Messages> {
  if (locale === DEFAULT_LOCALE) return enMessages;
  const translated = await importCatalog(locale);
  if (translated === undefined) return enMessages; // catalog not shipped yet → English, never a raw key
  return mergeMessages(enMessages as unknown as MessageTree, translated) as unknown as Messages;
}

/**
 * Import `messages/<locale>.json` if it exists. A missing or unparseable catalog is a DEGRADATION, not a
 * crash (Art. XVI): the UI falls back to English rather than failing the request.
 */
async function importCatalog(locale: LocaleId): Promise<MessageTree | undefined> {
  try {
    const mod = (await import(`../../messages/${locale}.json`)) as { default?: MessageTree };
    return mod.default ?? (mod as unknown as MessageTree);
  } catch {
    return undefined;
  }
}
