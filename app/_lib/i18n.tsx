'use client';
// BEACON — i18n access layer (ADR-030; FR-I18N-1/2/3/4). ONE way for the UI to read a translated string.
//
// Why not next-intl's `useTranslations` + `NextIntlClientProvider` directly? Because `useTranslations`
// REQUIRES a surrounding provider and throws without one — which would force a provider wrapper into ~50
// existing component tests and make the English render depend on test plumbing. Instead we use next-intl's
// own core translator (`createTranslator`, the same ICU engine its hooks are built on) behind a context
// whose DEFAULT is the English catalog. Consequences, all deliberate:
//   • components render identical English with or without a provider ⇒ every existing test/visual baseline
//     stays valid, and a provider-less render can never leak a raw key (FR-I18N-2 / FUW-1);
//   • message keys are COMPILE-CHECKED against messages/en.json (a typo is a tsc error, not a runtime blank);
//   • no i18n routing, no middleware, no `[locale]` segment — locale is UI state (cookie), per ADR-030.
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { createFormatter, createTranslator, type NamespaceKeys, type NestedKeyOf } from 'next-intl';
import enMessages from '../../messages/en.json';
import { DEFAULT_LOCALE, localeDir, type LocaleId } from '@/config/locales.js';

/** The message-catalog shape. English is the schema: every locale mirrors this tree (key-parity test). */
export type Messages = typeof enMessages;

/** Any dot-path namespace within the catalog (e.g. `toolbar`, `panels`). Compile-checked. */
export type MessageNamespace = NamespaceKeys<Messages, NestedKeyOf<Messages>>;

export interface IntlValue {
  readonly locale: LocaleId;
  /** Active catalog, ALREADY merged over English server-side — so a lookup can never miss. */
  readonly messages: Messages;
  /** Active region's IANA timezone; all displayed timestamps are formatted in it (FR-I18N-4). */
  readonly timeZone: string;
}

/** English + UTC: the value used when no provider is mounted (unit tests, isolated renders). */
const FALLBACK: IntlValue = { locale: DEFAULT_LOCALE, messages: enMessages, timeZone: 'UTC' };

const IntlContext = createContext<IntlValue | null>(null);

/**
 * Mounts the active locale for the client tree. Rendered by the root layout with server-loaded messages,
 * so the very first paint is already in the right language and direction (no flash, no hydration mismatch).
 */
export function IntlProvider({
  value,
  children,
}: {
  value: IntlValue;
  children: ReactNode;
}): ReactNode {
  // The value object is created per request on the server; memoising here keeps consumers stable on re-render.
  const stable = useMemo<IntlValue>(
    () => ({ locale: value.locale, messages: value.messages, timeZone: value.timeZone }),
    [value.locale, value.messages, value.timeZone],
  );
  return <IntlContext.Provider value={stable}>{children}</IntlContext.Provider>;
}

/**
 * Re-provide the ambient intl value with the ACTIVE REGION's timezone (FR-I18N-4). The root layout cannot
 * know the region — region selection is client state — so the COP wraps its subtree in this once a region is
 * chosen. Locale and messages are inherited untouched; only the timezone changes, which is why this is a
 * six-line re-provider rather than a second parallel context.
 */
export function RegionTimeZone({
  timeZone,
  children,
}: {
  timeZone: string;
  children: ReactNode;
}): ReactNode {
  const ambient = useContext(IntlContext) ?? FALLBACK;
  const value = useMemo<IntlValue>(
    () => ({ locale: ambient.locale, messages: ambient.messages, timeZone }),
    [ambient.locale, ambient.messages, timeZone],
  );
  return <IntlContext.Provider value={value}>{children}</IntlContext.Provider>;
}

/** The active locale (falls back to English outside a provider). */
export function useLocaleId(): LocaleId {
  return useContext(IntlContext)?.locale ?? FALLBACK.locale;
}

/** Writing direction of the active locale — for the rare component that must branch on it. */
export function useTextDirection(): 'ltr' | 'rtl' {
  return localeDir(useLocaleId());
}

/**
 * A namespaced translator: `const t = useT('toolbar'); t('layers')`.
 * Keys are checked against messages/en.json at compile time. Missing/broken ICU never throws: the
 * English message is substituted (`getMessageFallback`) and the error is swallowed in production.
 */
export function useT<const NS extends MessageNamespace>(
  namespace: NS,
): ReturnType<typeof createTranslator<Messages, NS>> {
  const { locale, messages } = useContext(IntlContext) ?? FALLBACK;
  return useMemo(
    () =>
      createTranslator<Messages, NS>({
        locale,
        messages,
        namespace,
        onError: reportIntlError,
        getMessageFallback: englishFallback,
      }),
    [locale, messages, namespace],
  );
}

/**
 * Locale-aware date/number formatting in the active region's timezone (FR-I18N-4).
 * Physical quantities stay SI with an explicit unit label — only the NUMBER is localized, never the unit
 * of record (a metre is a metre in every locale).
 */
export function useFormat(): ReturnType<typeof createFormatter> {
  const { locale, timeZone } = useContext(IntlContext) ?? FALLBACK;
  return useMemo(() => createFormatter({ locale, timeZone }), [locale, timeZone]);
}

/** Resolve a dotted key path inside a message tree. Returns undefined when absent (never throws). */
function messageAt(tree: unknown, path: readonly string[]): string | undefined {
  let node: unknown = tree;
  for (const segment of path) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === 'string' ? node : undefined;
}

/**
 * The last line of the fallback ladder (FR-I18N-2, FUW-1): substitute the ENGLISH message. A raw key must
 * never reach the screen; the English source text is always a truthful, readable answer. If English is also
 * missing (impossible while keys are type-checked) we degrade to the final key segment rather than blanking.
 */
function englishFallback({
  key,
  namespace,
}: {
  key: string;
  namespace?: string | undefined;
}): string {
  const path = (namespace !== undefined && namespace !== '' ? `${namespace}.${key}` : key).split(
    '.',
  );
  return messageAt(enMessages, path) ?? path[path.length - 1] ?? '';
}

/** ICU/lookup problems must degrade, never crash a crisis screen. Surfaced in dev/test, silent in prod. */
function reportIntlError(error: unknown): void {
  /* c8 ignore next 3 -- diagnostic-only branch; the fallback path itself is covered by tests */
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[i18n]', error instanceof Error ? error.message : String(error));
  }
}
