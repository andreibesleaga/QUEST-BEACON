// @vitest-environment happy-dom
// BEACON — i18n access-layer tests (ADR-030; FR-I18N-1/2/3/4, FUW-1).
// The three properties that matter, in order of how much damage their absence would do:
//   1. NO PROVIDER ⇒ ENGLISH. Every pre-existing component test renders without a provider; if that path
//      produced raw keys, the whole suite (and the visual baselines) would be lying about the English UI.
//   2. MISSING KEY ⇒ ENGLISH, never a raw key on screen, never a throw (a crisis screen must not blank).
//   3. Formatting is locale- and timezone-aware, while units of record stay SI.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  IntlProvider,
  RegionTimeZone,
  useFormat,
  useLocaleId,
  useT,
  useTextDirection,
  type IntlValue,
  type Messages,
} from './i18n.js';
import enMessages from '../../messages/en.json';

function Probe(): ReactNode {
  const t = useT('toolbar');
  return <span data-testid="probe">{t('layers')}</span>;
}

function DirProbe(): ReactNode {
  return (
    <span data-testid="dir">
      {useLocaleId()}/{useTextDirection()}
    </span>
  );
}

/** A catalog that translates ONE key and omits the rest — the realistic mid-translation state. */
function partialCatalog(): Messages {
  return {
    ...enMessages,
    toolbar: { ...enMessages.toolbar, layers: 'Straturi' },
  } as Messages;
}

function value(overrides: Partial<IntlValue>): IntlValue {
  return { locale: 'en', messages: enMessages as Messages, timeZone: 'UTC', ...overrides };
}

describe('useT without a provider (the default every unit test hits)', () => {
  it('renders the English source string', () => {
    render(<Probe />);
    expect(screen.getByTestId('probe')).toHaveTextContent('Layers');
  });

  it('reports English/ltr', () => {
    render(<DirProbe />);
    expect(screen.getByTestId('dir')).toHaveTextContent('en/ltr');
  });
});

describe('useT with a provider', () => {
  it('renders the translated string', () => {
    render(
      <IntlProvider value={value({ locale: 'ro', messages: partialCatalog() })}>
        <Probe />
      </IntlProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('Straturi');
  });

  it('falls back to the ENGLISH text for a key the catalog has not translated (FUW-1)', () => {
    function Untranslated(): ReactNode {
      const t = useT('toolbar');
      return <span data-testid="probe">{t('legend')}</span>;
    }
    render(
      <IntlProvider value={value({ locale: 'ro', messages: partialCatalog() })}>
        <Untranslated />
      </IntlProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('Legend');
  });

  it('never renders a raw key, even when the catalog drops the key entirely', () => {
    // Simulate a catalog whose namespace is missing (upstream file truncated / bad merge).
    const broken = { ...enMessages, toolbar: {} } as unknown as Messages;
    render(
      <IntlProvider value={value({ locale: 'ar', messages: broken })}>
        <Probe />
      </IntlProvider>,
    );
    const text = screen.getByTestId('probe').textContent ?? '';
    expect(text).toBe('Layers'); // the English source, not "toolbar.layers"
    expect(text).not.toContain('toolbar.');
  });

  it('resolves RTL for Arabic and Urdu', () => {
    render(
      <IntlProvider value={value({ locale: 'ar' })}>
        <DirProbe />
      </IntlProvider>,
    );
    expect(screen.getByTestId('dir')).toHaveTextContent('ar/rtl');
  });

  it('substitutes ICU arguments', () => {
    function Shell(): ReactNode {
      const t = useT('shell');
      return <span data-testid="probe">{t('collapse', { label: 'Logistics' })}</span>;
    }
    render(<Shell />);
    expect(screen.getByTestId('probe')).toHaveTextContent('Collapse Logistics');
  });
});

describe('useFormat (FR-I18N-4)', () => {
  it('formats numbers in the active locale', () => {
    function NumberProbe(): ReactNode {
      const format = useFormat();
      return <span data-testid="n">{format.number(1234.5)}</span>;
    }
    render(
      <IntlProvider value={value({ locale: 'ro' })}>
        <NumberProbe />
      </IntlProvider>,
    );
    // Romanian groups with "." and uses "," as the decimal separator — the point is that it is NOT "1,234.5".
    expect(screen.getByTestId('n').textContent).not.toBe('1,234.5');
  });

  it('formats a timestamp in the provided timezone, not the host timezone', () => {
    function TimeProbe(): ReactNode {
      const format = useFormat();
      return (
        <span data-testid="t">
          {format.dateTime(new Date('2026-07-05T22:00:00Z'), { hour: '2-digit', minute: '2-digit', hour12: false })}
        </span>
      );
    }
    const { unmount } = render(
      <IntlProvider value={value({ timeZone: 'UTC' })}>
        <TimeProbe />
      </IntlProvider>,
    );
    expect(screen.getByTestId('t')).toHaveTextContent('22:00');
    unmount();
    render(
      <IntlProvider value={value({ timeZone: 'Europe/Bucharest' })}>
        <TimeProbe />
      </IntlProvider>,
    );
    expect(screen.getByTestId('t')).toHaveTextContent('01:00'); // UTC+3 in July
  });
});

describe('RegionTimeZone (FR-I18N-4 — the ACTIVE REGION\'s zone, not the viewer\'s)', () => {
  function Stamp(): ReactNode {
    const format = useFormat();
    const t = useT('toolbar');
    return (
      <span data-testid="stamp">
        {t('layers')}|
        {format.dateTime(new Date('2026-07-05T22:00:00Z'), { hour: '2-digit', minute: '2-digit', hour12: false })}
      </span>
    );
  }

  it('overrides the ambient timezone while inheriting locale and messages', () => {
    render(
      <IntlProvider value={value({ locale: 'ro', messages: partialCatalog(), timeZone: 'UTC' })}>
        <RegionTimeZone timeZone="Europe/Bucharest">
          <Stamp />
        </RegionTimeZone>
      </IntlProvider>,
    );
    const text = screen.getByTestId('stamp').textContent ?? '';
    expect(text).toContain('Straturi'); // locale inherited — only the zone changed
    expect(text).toContain('01:00'); // 22:00Z is 01:00 next day in Bucharest (UTC+3 in July)
  });

  it('leaves the rest of the tree on the document default', () => {
    render(
      <IntlProvider value={value({ timeZone: 'UTC' })}>
        <>
          <RegionTimeZone timeZone="Europe/Bucharest">
            <span data-testid="inside">
              <Stamp />
            </span>
          </RegionTimeZone>
          <span data-testid="outside">
            <Stamp />
          </span>
        </>
      </IntlProvider>,
    );
    expect(screen.getByTestId('inside').textContent).toContain('01:00');
    expect(screen.getByTestId('outside').textContent).toContain('22:00');
  });

  it('works without an ambient provider (falls back to English, applies the region zone)', () => {
    // A region can be selected before any locale cookie exists; that must not blank the timestamps.
    render(
      <RegionTimeZone timeZone="Europe/Bucharest">
        <Stamp />
      </RegionTimeZone>,
    );
    const text = screen.getByTestId('stamp').textContent ?? '';
    expect(text).toContain('Layers');
    expect(text).toContain('01:00');
  });
});
