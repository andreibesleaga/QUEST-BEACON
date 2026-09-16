'use client';
// BEACON — ThemeToggle (E8·T-345/T-347; UIUX §1). Toggles <html data-theme> dark↔light, persists the
// choice to localStorage, and respects prefers-color-scheme on first load (no stored preference). Dark is
// the app default (night EOC ops). Renders an IconButton with an accessible name.
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Moon, Sun } from 'lucide-react';
import { IconButton } from './button.js';
import { useT } from '../../_lib/i18n.js';

export type Theme = 'dark' | 'light';
const STORAGE_KEY = 'beacon-theme';

function resolveInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

export function ThemeToggle(): ReactNode {
  const t = useT('theme');
  const [theme, setTheme] = useState<Theme>('dark');

  // Sync to the actually-resolved theme after mount (avoids a hydration mismatch on the server render).
  useEffect(() => {
    const initial = resolveInitialTheme();
    setTheme(initial);
    applyTheme(initial);
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      window.localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, []);

  const isDark = theme === 'dark';
  return (
    <IconButton
      variant="ghost"
      icon={isDark ? Sun : Moon}
      label={isDark ? t('toLight') : t('toDark')}
      aria-pressed={isDark}
      onClick={toggle}
    />
  );
}
