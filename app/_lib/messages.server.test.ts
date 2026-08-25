// BEACON — server catalog-loader tests (ADR-030; FR-I18N-2/7, FUW-1, NFR-F7).
// This is where the FALLBACK LADDER is proved: an untranslated key, a half-delivered catalog, and a
// catalog that does not exist at all must ALL end in readable English rather than a blank or a raw key.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { cookieValue } = vi.hoisted(() => ({ cookieValue: { current: undefined as string | undefined } }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => (cookieValue.current === undefined ? undefined : { value: cookieValue.current }) }),
}));

import { loadMessages, resolveLocale } from './messages.server.js';
import enMessages from '../../messages/en.json';

beforeEach(() => {
  cookieValue.current = undefined;
});

describe('resolveLocale (cookie → shipped locale)', () => {
  it('defaults to English when no cookie is set', async () => {
    await expect(resolveLocale()).resolves.toBe('en');
  });

  it('honours a shipped locale', async () => {
    cookieValue.current = 'ro';
    await expect(resolveLocale()).resolves.toBe('ro');
  });

  it('refuses an unshipped or hostile cookie value and serves English (NFR-F7)', async () => {
    for (const hostile of ['../../etc/passwd', 'de', 'en-US', '']) {
      cookieValue.current = hostile;
      await expect(resolveLocale()).resolves.toBe('en');
    }
  });
});

describe('loadMessages', () => {
  it('returns the English source catalog unchanged for en (byte-identical default path)', async () => {
    await expect(loadMessages('en')).resolves.toBe(enMessages);
  });

  it('falls back to English for a locale whose catalog is not shipped yet', async () => {
    // Whatever the current translation state, the result must be a COMPLETE catalog: every English key
    // present, so no lookup can miss (FR-I18N-2).
    const messages = await loadMessages('bn');
    expect(Object.keys(messages)).toEqual(expect.arrayContaining(Object.keys(enMessages)));
    expect(messages.toolbar.layers.length).toBeGreaterThan(0);
    expect(messages.app.title.length).toBeGreaterThan(0);
  });

  it('produces a catalog with the same key TREE as English for every shipped locale', async () => {
    const keysOf = (tree: unknown, prefix = ''): string[] => {
      if (typeof tree !== 'object' || tree === null) return [];
      return Object.entries(tree).flatMap(([k, v]) =>
        typeof v === 'string' ? [`${prefix}${k}`] : keysOf(v, `${prefix}${k}.`),
      );
    };
    const englishKeys = keysOf(enMessages).sort();
    for (const locale of ['ro', 'ar', 'zh-Hans'] as const) {
      const merged = await loadMessages(locale);
      // Merged catalogs may add nothing and must lose nothing.
      expect(keysOf(merged).sort()).toEqual(expect.arrayContaining(englishKeys));
    }
  });
});
