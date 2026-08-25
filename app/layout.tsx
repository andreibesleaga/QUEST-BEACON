// BEACON — root layout (E8·T-348; UI/UX Charter; ADR-030 i18n). Loads global tokens + self-hosted Inter
// (no CDN), sets the default dark theme, resolves the reader's LOCALE server-side (cookie → catalog) so the
// first paint already carries the right `lang`/`dir` and translated text, then mounts the providers tree +
// a skip-to-content link (WCAG landmark).
import type { ReactNode } from 'react';
import '@fontsource-variable/inter';
// Script coverage for the shipped non-Latin locales (ADR-030; FR-I18N-8). Self-hosted OFL subsets, never a
// CDN — the app must render correctly air-gapped (Art. XVI). Only the SCRIPT subset of each family is
// imported (not the family's Latin/math/symbol subsets — Inter already covers those, and Inter also ships
// Greek + Cyrillic, so `el`/`ru` cost nothing). Each `@font-face` is glyph-scoped by the family itself, so a
// reader of an English or Greek UI never downloads Arabic, Devanagari, or Bengali bytes: the browser fetches
// a face only when it has to render a glyph the earlier families in the stack lack. 400 + 700 only (regular
// and bold are the two weights the UI actually uses) ⇒ ~300 KB total, inside the 1 MB budget.
import '@fontsource/noto-sans-arabic/arabic-400.css';
import '@fontsource/noto-sans-arabic/arabic-700.css';
import '@fontsource/noto-sans-devanagari/devanagari-400.css';
import '@fontsource/noto-sans-devanagari/devanagari-700.css';
import '@fontsource/noto-sans-bengali/bengali-400.css';
import '@fontsource/noto-sans-bengali/bengali-700.css';
import './globals.css';
import { Providers } from './_lib/providers.js';
import { IntlProvider } from './_lib/i18n.js';
import { loadMessages, resolveLocale } from './_lib/messages.server.js';
import { localeDir } from '@/config/locales.js';

/**
 * Localized document metadata (FR-I18N-2): the browser tab reads in the reader's language too. Uses the
 * same cookie → catalog resolution as the body, so title and content can never disagree.
 */
export async function generateMetadata(): Promise<{ title: string; description: string }> {
  const messages = await loadMessages(await resolveLocale());
  return { title: messages.app.title, description: messages.app.description };
}

export const viewport = {
  themeColor: '#0b0f14',
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: ReactNode }): Promise<ReactNode> {
  const locale = await resolveLocale();
  const messages = await loadMessages(locale);
  const dir = localeDir(locale);
  return (
    // Default theme = dark; a client toggle may switch data-theme to "light" (persisted).
    // `lang`/`dir` are SERVER-rendered from the cookie: screen readers and the bidi algorithm get the right
    // answer on the first byte, and RTL never arrives as a post-hydration layout jump.
    <html lang={locale} dir={dir} data-theme="dark">
      <body>
        {/* `timeZone` is the document default; the COP overrides it with the ACTIVE REGION's tz once a
            region is selected (FR-I18N-4). UTC here means "no region context yet", never a silent guess.
            Script coverage is handled by the bundled font stack + `unicode-range` (globals.css): the browser
            downloads only the subsets the rendered text actually needs — no CDN, no per-locale JS. */}
        <IntlProvider value={{ locale, messages, timeZone: 'UTC' }}>
          <a href="#main" className="skip-link">
            {messages.app.skipToContent}
          </a>
          <Providers>{children}</Providers>
        </IntlProvider>
      </body>
    </html>
  );
}
