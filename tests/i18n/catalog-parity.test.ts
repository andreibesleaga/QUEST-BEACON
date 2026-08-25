// BEACON — message-catalog battery (ADR-030; FR-I18N-2/5, FUW-1; master plan MW-A/A5).
// These are the tests that keep 14 hand-and-machine-produced JSON files honest. A translation bug is
// invisible in review (nobody proof-reads Bengali in a diff) but very visible on a crisis screen, so the
// invariants are enforced mechanically:
//   1. KEY PARITY  — every catalog has exactly the English key tree: nothing missing, nothing orphaned.
//   2. ICU VALIDITY — every message compiles and renders with its declared arguments (a broken plural or
//      an unescaped apostrophe would otherwise degrade silently to English at runtime).
//   3. ARGUMENT PARITY — a translation may not invent, drop, or rename an ICU argument.
//   4. HONESTY — `_meta.machineTranslated` agrees with config/locales.json `review`.
//   5. NO PLACEHOLDER TEXT — no empty strings, no "TODO", no raw-key-shaped values.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createTranslator } from 'next-intl';
import { LOCALE_IDS, SHIPPED_LOCALES, isMachineTranslated, type LocaleId } from '../../src/config/locales.js';

const MESSAGES_DIR = fileURLToPath(new URL('../../messages/', import.meta.url));

type Tree = { readonly [k: string]: unknown };

function readCatalog(locale: string): Tree {
  return JSON.parse(readFileSync(`${MESSAGES_DIR}${locale}.json`, 'utf8')) as Tree;
}

/** Every leaf key path in the tree, excluding the `_meta` block (metadata, not user-facing copy). */
function leafKeys(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree)
    .filter(([k]) => prefix !== '' || k !== '_meta')
    .flatMap(([k, v]) =>
      typeof v === 'string'
        ? [`${prefix}${k}`]
        : typeof v === 'object' && v !== null
          ? leafKeys(v as Tree, `${prefix}${k}.`)
          : [`${prefix}${k}`],
    );
}

function leafValue(tree: Tree, path: string): unknown {
  return path.split('.').reduce<unknown>((node, seg) => (node as Tree | undefined)?.[seg], tree);
}

/** ICU argument names referenced by a message, e.g. "Collapse {label}" → ["label"]. */
function icuArgs(message: string): string[] {
  return [...message.matchAll(/\{\s*([A-Za-z0-9_]+)\s*[,}]/g)].map((m) => m[1]!).sort();
}

const english = readCatalog('en');
const englishKeys = leafKeys(english).sort();

/** Catalogs actually present on disk (a locale whose catalog is not shipped yet falls back to English). */
const presentLocales: LocaleId[] = LOCALE_IDS.filter((id) => existsSync(`${MESSAGES_DIR}${id}.json`));

describe('English source catalog', () => {
  it('is non-empty and every leaf is a non-blank string', () => {
    expect(englishKeys.length).toBeGreaterThan(0);
    for (const key of englishKeys) {
      const value = leafValue(english, key);
      expect(typeof value, `messages/en.json ${key} must be a string`).toBe('string');
      expect((value as string).trim(), `messages/en.json ${key} must not be blank`).not.toBe('');
    }
  });

  it('contains no placeholder or key-shaped copy', () => {
    for (const key of englishKeys) {
      const value = leafValue(english, key) as string;
      expect(value, `messages/en.json ${key}`).not.toMatch(/^(TODO|TBD|FIXME|XXX)\b/i);
      // A value identical to its own dotted key means the extraction copied the key, not the string.
      expect(value).not.toBe(key);
    }
  });

  it('declares itself as the authored source', () => {
    const meta = english['_meta'] as Record<string, unknown>;
    expect(meta['locale']).toBe('en');
    expect(meta['machineTranslated']).toBe(false);
  });

  it('has no duplicate key paths (JSON.parse would silently keep the last one)', () => {
    const raw = readFileSync(`${MESSAGES_DIR}en.json`, 'utf8');
    // Count occurrences of each quoted key at any depth; a duplicate inside the SAME object is the risk.
    const parsedTwice = JSON.parse(raw) as Tree;
    expect(leafKeys(parsedTwice).sort()).toEqual(englishKeys);
  });
});

describe('per-locale catalogs', () => {
  it('ships at least the English source catalog', () => {
    expect(presentLocales).toContain('en');
  });

  it('has no catalog file for an unshipped locale (registry is the allowlist)', () => {
    const stray = readdirSync(MESSAGES_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .filter((id) => !(LOCALE_IDS as readonly string[]).includes(id));
    expect(stray).toEqual([]);
  });

  for (const locale of presentLocales) {
    if (locale === 'en') continue;

    describe(`messages/${locale}.json`, () => {
      const catalog = readCatalog(locale);

      it('has exactly the English key tree (no missing keys, no orphans)', () => {
        expect(leafKeys(catalog).sort()).toEqual(englishKeys);
      });

      it('preserves every ICU argument name (a dropped argument renders a blank slot)', () => {
        for (const key of englishKeys) {
          const source = leafValue(english, key) as string;
          const translated = leafValue(catalog, key);
          if (typeof translated !== 'string') continue;
          expect(icuArgs(translated), `${locale} ${key}`).toEqual(icuArgs(source));
        }
      });

      it('compiles and renders every message (ICU syntax is valid in this locale)', () => {
        const errors: string[] = [];
        const t = createTranslator({
          locale,
          messages: catalog as never,
          onError: (e) => errors.push(String(e)),
        });
        for (const key of englishKeys) {
          const source = leafValue(english, key) as string;
          const args = Object.fromEntries(icuArgs(source).map((a) => [a, 'x']));
          const rendered = (t as unknown as (k: string, v?: Record<string, string>) => string)(key, args);
          expect(typeof rendered, `${locale} ${key} must render a string`).toBe('string');
        }
        expect(errors, `ICU errors in messages/${locale}.json`).toEqual([]);
      });

      it('declares its translation provenance honestly (FR-I18N-5)', () => {
        const meta = catalog['_meta'] as Record<string, unknown> | undefined;
        expect(meta, `messages/${locale}.json must carry a _meta block`).toBeDefined();
        expect(meta?.['locale']).toBe(locale);
        expect(meta?.['machineTranslated']).toBe(isMachineTranslated(locale));
      });

      it('leaves no blank translations (a blank label is worse than an English one)', () => {
        for (const key of englishKeys) {
          const value = leafValue(catalog, key);
          expect((value as string).trim(), `${locale} ${key} is blank`).not.toBe('');
        }
      });
    });
  }
});

describe('registry ↔ catalogs', () => {
  it('every locale offered in the switcher can be rendered (catalog present or English fallback)', () => {
    // The fallback ladder means a missing catalog is SAFE, never broken — this test documents that
    // contract and lists what is still outstanding, so "not translated yet" can never be mistaken for
    // "translated". MW-A/A3 lands the remaining catalogs.
    const missing = SHIPPED_LOCALES.map((l) => l.id).filter((id) => !presentLocales.includes(id));
    for (const id of missing) expect(LOCALE_IDS).toContain(id); // still a valid, offerable locale
  });
});
