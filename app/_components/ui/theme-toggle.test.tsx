// @vitest-environment happy-dom
// BEACON — ThemeToggle tests (E8·T-345/T-347). Toggles <html data-theme>, persists to localStorage.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeToggle } from './theme-toggle.js';

describe('ThemeToggle', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    // No stored preference + no light preference → resolves to dark.
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: false,
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          onchange: null,
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    );
  });

  it('toggles data-theme dark↔light and persists the choice', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    // Initial resolve (no storage, not light) → dark; button offers switch-to-light.
    const toLight = await screen.findByRole('button', { name: 'Switch to light theme' });
    await user.click(toLight);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(window.localStorage.getItem('beacon-theme')).toBe('light');

    const toDark = screen.getByRole('button', { name: 'Switch to dark theme' });
    await user.click(toDark);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem('beacon-theme')).toBe('dark');
  });

  it('honours a stored preference on first load', async () => {
    window.localStorage.setItem('beacon-theme', 'light');
    render(<ThemeToggle />);
    await screen.findByRole('button', { name: 'Switch to dark theme' });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
