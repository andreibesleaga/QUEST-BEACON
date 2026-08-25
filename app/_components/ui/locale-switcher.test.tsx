// @vitest-environment happy-dom
// BEACON — LocaleSwitcher tests (ADR-030; FR-I18N-1/5). Covers the three things a reader depends on:
// every shipped language is offered under its OWN name, choosing one persists + re-renders the server tree,
// and an unreviewed (machine-translated) catalog says so instead of pretending to be authoritative.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { LocaleSwitcher } from './locale-switcher.js';
import { IntlProvider, type IntlValue, type Messages } from '../../_lib/i18n.js';
import enMessages from '../../../messages/en.json';
import { LOCALE_COOKIE, SHIPPED_LOCALES } from '@/config/locales.js';

function withLocale(locale: IntlValue['locale']): ReactNode {
  const value: IntlValue = { locale, messages: enMessages as Messages, timeZone: 'UTC' };
  return (
    <IntlProvider value={value}>
      <LocaleSwitcher />
    </IntlProvider>
  );
}

beforeEach(() => {
  refresh.mockReset();
  document.cookie = `${LOCALE_COOKIE}=; path=/; max-age=0`;
});

describe('LocaleSwitcher', () => {
  it('offers every shipped locale under its endonym', () => {
    render(withLocale('en'));
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(SHIPPED_LOCALES.length);
    for (const l of SHIPPED_LOCALES) {
      expect(screen.getByRole('option', { name: l.nativeName })).toBeInTheDocument();
    }
  });

  it('has an accessible name and reflects the active locale', () => {
    render(withLocale('ro'));
    const select = screen.getByRole('combobox', { name: 'Display language' });
    expect(select).toHaveValue('ro');
  });

  it('persists the choice to the locale cookie and refreshes the server tree', async () => {
    render(withLocale('en'));
    await userEvent.selectOptions(screen.getByTestId('locale-switcher'), 'ar');
    expect(document.cookie).toContain(`${LOCALE_COOKIE}=ar`);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('labels a machine-translated locale as unreviewed (honest limitations)', () => {
    render(withLocale('zh-Hans'));
    expect(screen.getByTestId('machine-translated-notice')).toHaveTextContent('machine-translated');
  });

  it('shows no translation notice for the authored English catalog', () => {
    render(withLocale('en'));
    expect(screen.queryByTestId('machine-translated-notice')).not.toBeInTheDocument();
  });

  it('shows NO notice for Romanian — the entrant reviewed it on 2026-07-28 (F-58 discharged)', () => {
    // The notice tracks `config/locales.json` `review`, not intent. `ro` was `machine` right up until the
    // review actually happened; it flipped only when the entrant (a native speaker) confirmed the catalog,
    // and both surfaces (`messages/ro.json` `_meta` + the registry row) moved together, which is the rule.
    render(withLocale('ro'));
    expect(screen.queryByTestId('machine-translated-notice')).not.toBeInTheDocument();
  });

  it('still labels every catalog that has NOT been reviewed', () => {
    // The guarantee that matters is not "ro is exempt" but "unreviewed copy is always disclosed".
    for (const locale of ['zh-Hans', 'ar', 'hi', 'bn'] as const) {
      const { unmount } = render(withLocale(locale));
      expect(screen.getByTestId('machine-translated-notice'), locale).toBeInTheDocument();
      unmount();
    }
  });
});
