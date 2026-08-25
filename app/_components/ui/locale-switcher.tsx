'use client';
// BEACON — LocaleSwitcher (ADR-030; FR-I18N-1/5). Changes the display language of the whole COP.
//
// Mechanics, deliberately the simplest thing that is correct:
//  • the choice is written to the `beacon-locale` cookie (locale is UI state, never a URL segment), then
//    `router.refresh()` re-renders the server layout so <html lang>/<html dir> and the catalog all change
//    together in ONE paint — no flash of the wrong language, no hydration mismatch;
//  • a native <select> (same pattern as the role switcher) so it is keyboard- and screen-reader-operable
//    with zero new dependency, and options show ENDONYMS (a reader looks for "العربية", not "Arabic");
//  • when the active catalog is machine-translated we say so, right there (Art. XV honest limitations).
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Languages } from 'lucide-react';
import { LOCALE_COOKIE, SHIPPED_LOCALES, isMachineTranslated } from '@/config/locales.js';
import { useLocaleId, useT } from '../../_lib/i18n.js';

/** One year: the reader's language is a durable preference, not a session detail. */
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function LocaleSwitcher(): ReactNode {
  const t = useT('locale');
  const locale = useLocaleId();
  const router = useRouter();

  const select = (next: string): void => {
    // `SameSite=Lax` + no `Secure` so it also works on http://localhost (offline demo); it carries no PII.
    document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(next)}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
    router.refresh();
  };

  return (
    <label className="flex items-center gap-1 text-xs text-fg-muted" data-testid="locale-switcher-label">
      <Languages aria-hidden="true" className="size-3.5" />
      <span className="sr-only">{t('switcherLabel')}</span>
      <select
        aria-label={t('switcherLabel')}
        data-testid="locale-switcher"
        value={locale}
        onChange={(e) => select(e.target.value)}
        className="rounded bg-surface-2 px-1 py-0.5 text-xs text-fg"
      >
        {SHIPPED_LOCALES.map((l) => (
          <option key={l.id} value={l.id} lang={l.id}>
            {l.nativeName}
          </option>
        ))}
      </select>
      {isMachineTranslated(locale) ? (
        <span data-testid="machine-translated-notice" title={t('machineTranslatedNotice')} className="text-warn-strong">
          {t('machineTranslatedShort')}
        </span>
      ) : null}
    </label>
  );
}
