// BEACON — server-side warning-copy catalog (D3.4/D3.5; ADR-030 + ADR-036 §4/§5). Turns a locale id into a
// `WarningTranslate` over the `messages/<locale>.json` catalogs, for text composed on the SERVER (the
// emitted CAP document) rather than in the browser.
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
import { createTranslator } from 'next-intl';
import { DEFAULT_LOCALE } from '@/config/locales.js';
import type { LocaleId } from '@/config/locales.js';
import type { WarningTranslate } from '@/application/warning-text/index.js';
import ar from '../../../messages/ar.json';
import bn from '../../../messages/bn.json';
import el from '../../../messages/el.json';
import en from '../../../messages/en.json';
import es from '../../../messages/es.json';
import fil from '../../../messages/fil.json';
import fr from '../../../messages/fr.json';
import hi from '../../../messages/hi.json';
import id from '../../../messages/id.json';
import ptBR from '../../../messages/pt-BR.json';
import ro from '../../../messages/ro.json';
import ru from '../../../messages/ru.json';
import ur from '../../../messages/ur.json';
import zhHans from '../../../messages/zh-Hans.json';

/** A catalog node: text, a nested group, or a non-text value (each catalog carries a `_meta` block). */
type MessageTree = { readonly [key: string]: unknown };

/**
 * The catalogs, COMPILED IN — one entry per shipped locale, and the type makes that exhaustive: a new
 * `LocaleId` does not compile until its catalog is imported here.
 *
 * They used to be read from `messages/<locale>.json` on disk at first use. The runtime image does not
 * carry that directory (infra/Dockerfile copies `.next`, `config`, `schemas`, `fixtures` … and not
 * `messages`), so in every container the read failed, the English base came back EMPTY, and the
 * "resolves to English, never to a raw key" ladder below had nothing to resolve to. Found on the live
 * deployment on 2026-11-21: an approved alert was emitted as
 * `<event>warning.event.Fire</event><headline>warning.headline</headline>`. Every test passed, because
 * the test runner works in the repository, where the directory exists.
 *
 * Importing the JSON puts the text in the server bundle, where no deployment layout can lose it — the
 * same way `channels/messaging/digest-i18n.ts` has always carried its English catalog.
 */
const CATALOGS: Readonly<Record<LocaleId, MessageTree>> = {
  en,
  'zh-Hans': zhHans,
  hi,
  es,
  ar,
  fr,
  bn,
  'pt-BR': ptBR,
  id,
  ur,
  ru,
  ro,
  fil,
  el,
};

const isTree = (value: unknown): value is MessageTree =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Deep-merge `override` onto `base`, ignoring blank overrides (an empty string is "not translated"). */
function mergeMessages(base: MessageTree, override: MessageTree): MessageTree {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = out[key];
    if (typeof value === 'string') {
      if (value !== '') out[key] = value;
    } else if (isTree(value) && isTree(current)) {
      out[key] = mergeMessages(current, value);
    } else if (current === undefined) {
      out[key] = value;
    }
  }
  return out;
}

const translators = new Map<string, WarningTranslate>();

/**
 * A `WarningTranslate` for one locale, memoized. `onError` is swallowed on purpose: an ICU defect in one
 * translated string must degrade that one string, never abort an alert emission. The catalog battery
 * (`tests/i18n/catalog-parity.test.ts`) is what actually keeps such defects out of the tree.
 */
export function warningTranslator(locale: LocaleId): WarningTranslate {
  const cached = translators.get(locale);
  if (cached) return cached;
  const english = CATALOGS[DEFAULT_LOCALE];
  const messages = locale === DEFAULT_LOCALE ? english : mergeMessages(english, CATALOGS[locale]);
  const t = createTranslator({ locale, messages: messages as never, onError: () => undefined });
  const translate: WarningTranslate = (key, args) =>
    (t as unknown as (k: string, v?: Readonly<Record<string, string | number>>) => string)(
      key,
      args,
    );
  translators.set(locale, translate);
  return translate;
}
