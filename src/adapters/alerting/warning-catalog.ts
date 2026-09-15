// BEACON — server-side warning-copy catalog (D3.4/D3.5; ADR-030 + ADR-036 §4/§5). Turns a locale id into a
// `WarningTranslate` over `messages/<locale>.json`, for text composed on the SERVER (the emitted CAP
// document, the Telegram digest) rather than in the browser.
//
// WHY NOT REUSE app/_lib/messages.server.ts: that loader is a Next.js server module — it reads `cookies()`
// and uses `await import()` so the bundler can code-split catalogs out of the client payload. Neither
// applies here (there is no request and no bundler in an emit path), and `src/**` must not import from
// `app/**` (Art. II layering, enforced by dependency-cruiser). So this is a small, synchronous, framework-
// free twin: same catalogs, same English-fallback ladder, no Next.js. The duplication is 20 lines and is
// preferable to inverting the layering.
//
// The fallback ladder is the part that matters: the locale catalog is deep-merged OVER English, so a key the
// translators have not delivered resolves to the English source text. A raw key never renders, and a blank
// never renders — a blank protective-action line is worse than an English one.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createTranslator } from 'next-intl';
import { DEFAULT_LOCALE } from '@/config/locales.js';
import type { LocaleId } from '@/config/locales.js';
import type { WarningTranslate } from '@/application/warning-text/index.js';

type MessageTree = { readonly [key: string]: string | MessageTree };

/**
 * Catalog path for a locale. `LocaleId` is a closed literal union, so no caller string reaches a path.
 * Resolved lazily at call time (never at module evaluation) so that merely importing this file is safe in
 * any environment, including a browser-shaped test runner where `import.meta.url` is not a `file:` URL.
 */
function catalogPath(locale: LocaleId): string {
  return fileURLToPath(new URL(`../../../messages/${locale}.json`, import.meta.url));
}

/**
 * Read a catalog, or `undefined` when it is missing/unparseable. A missing catalog is a DEGRADATION, not a
 * crash (Art. XVI): the emission continues in English rather than failing the alert.
 */
function readCatalog(locale: LocaleId): MessageTree | undefined {
  try {
    return JSON.parse(readFileSync(catalogPath(locale), 'utf8')) as MessageTree;
  } catch {
    return undefined;
  }
}

/** Deep-merge `override` onto `base`, ignoring blank overrides (an empty string is "not translated"). */
function mergeMessages(base: MessageTree, override: MessageTree): MessageTree {
  const out: Record<string, string | MessageTree> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = out[key];
    if (typeof value === 'string') {
      if (value !== '') out[key] = value;
    } else if (typeof current === 'object' && current !== null) {
      out[key] = mergeMessages(current, value);
    } else if (current === undefined) {
      out[key] = value;
    }
  }
  return out;
}

let englishCache: MessageTree | undefined;
const translators = new Map<string, WarningTranslate>();

/** The English source catalog, read once on FIRST USE (never at import time — see `catalogPath`). */
function english(): MessageTree {
  englishCache ??= readCatalog(DEFAULT_LOCALE) ?? {};
  return englishCache;
}

/**
 * A `WarningTranslate` for one locale, memoized. `onError` is swallowed on purpose: an ICU defect in one
 * translated string must degrade that one string, never abort an alert emission. The catalog battery
 * (`tests/i18n/catalog-parity.test.ts`) is what actually keeps such defects out of the tree.
 */
export function warningTranslator(locale: LocaleId): WarningTranslate {
  const cached = translators.get(locale);
  if (cached) return cached;
  const messages =
    locale === DEFAULT_LOCALE ? english() : mergeMessages(english(), readCatalog(locale) ?? {});
  const t = createTranslator({ locale, messages: messages as never, onError: () => undefined });
  const translate: WarningTranslate = (key, args) =>
    (t as unknown as (k: string, v?: Readonly<Record<string, string | number>>) => string)(
      key,
      args,
    );
  translators.set(locale, translate);
  return translate;
}
