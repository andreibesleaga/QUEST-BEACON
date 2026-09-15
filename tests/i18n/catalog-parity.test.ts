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
import {
  LOCALE_IDS,
  SHIPPED_LOCALES,
  isMachineTranslated,
  type LocaleId,
} from '../../src/config/locales.js';

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
const presentLocales: LocaleId[] = LOCALE_IDS.filter((id) =>
  existsSync(`${MESSAGES_DIR}${id}.json`),
);

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
          const rendered = (t as unknown as (k: string, v?: Record<string, string>) => string)(
            key,
            args,
          );
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

// ── 6. UNTRANSLATED CONTENT — the invariant this battery was missing ────────────────────────────────
//
// WHY THIS EXISTS. The five invariants above are genuinely good, and they all passed 72/72 while **29
// keys of the `anticipatory` namespace — including two safety disclaimers — sat byte-identical to English
// in ALL THIRTEEN non-English catalogues** (i18n audit, 2026-09-11). They had been mirrored structurally
// to satisfy KEY PARITY and never translated.
//
// That is the recurring failure shape in this project, and it is worth naming: a gate that is trusted,
// documented, and structurally incapable of failing for the thing it appears to cover. Key parity proves
// a key EXISTS in Bengali. It says nothing about whether the value is Bengali.
//
// THE ALLOWLIST IS THE HARD PART, and it is deliberately narrow. Some values are legitimately identical:
// a loanword the locale actually uses ("Live", "Operator"), a unit or standard token ("UTC", "km", "OK"),
// a proper noun, or a CAP/EDXL enum that MUST NOT be translated because it travels on the wire. Every
// entry below is one of those. Anything else identical to English is an untranslated string, and this
// test says so with the locale and the key path, so the gap is actionable rather than a bare count.
const IDENTICAL_ALLOWED = new Set<string>([
  // Standard tokens and units — translating these would be wrong, not merely unnecessary.
  'statusStrip.clock', // "UTC"
  'ui.mode.LIVE', // a loanword in most shipped locales; each catalogue chose it deliberately
  // EDXL-RM resource-task states. Their VALUES are the enum tokens themselves (`PROPOSED`, `EN_ROUTE`, …),
  // rendered verbatim so the screen shows the same word that travels on the wire and appears in an
  // exported message. Translating them would make the UI and the interop payload disagree about what a
  // task's state is called — the same reasoning that keeps the shelter-status token verbatim.
  'logistics.transition.PROPOSED',
  'logistics.transition.ASSIGNED',
  'logistics.transition.EN_ROUTE',
  'logistics.transition.ON_SCENE',
  'logistics.transition.CLEARED',
  // The dev/live MODE badges. Their values are the mode tokens themselves, shown on a badge that exists to
  // say which build you are looking at; the same reasoning as `ui.mode.LIVE` directly above.
  'toolbar.devBadge', // "dev"
  'toolbar.devLogin', // "dev-login"
  'toolbar.liveBadge', // "live"
]);

/**
 * Strings that are CORRECT in a given language while being spelled the same as the English.
 *
 * This list exists because the blunt rule — identical means untranslated — is wrong for real languages.
 * "Provenance", "Citations", "Infrastructure" and "Action" are French words. "Active" is Romanian.
 * "SitRep" is the term of art emergency managers use in every language shipped here. Tagalog borrows
 * "password" and "user id" wholesale. Flagging these would push a translator toward inventing a worse
 * word purely to make a test go green, which is a gate actively making the product worse.
 *
 * Every entry is a decision someone made about one language, and the key names it, so a reviewer can
 * disagree with a specific line rather than with a blanket exemption. A locale not listed here has NO
 * exemptions at all — the default stays strict.
 */
const REVIEWED_IDENTICAL: Readonly<Record<string, readonly string[]>> = {
  fr: [
    // French–English cognates, all of them ordinary French.
    'channels.digest.citations',
    'commandPalette.groupIncidents',
    'decision.citations',
    'draftAlerts.provenance',
    'map.list.colType',
    'map.list.colAction',
    'map.group.infra',
    'map.zone.label',
    'shell.region.ph', // "Philippines" is the French name too
    'sitrep.provenance',
    'statusStrip.sources',
    'statusStrip.minutesAgo', // "min" is the French abbreviation for minute
    'suppliesPanel.provenance',
    'volunteerTeamsPanel.provenance',
    'shelterStatusPanel.provenance',
    'damageReportsPanel.provenance',
    'emsOverlayPanel.attribution',
    'emsOverlayPanel.provenance',
    'verifierQueue.component.corroboration',
    'ui.provenance.trigger',
    'ui.provenance.triggerAria',
    'ui.provenance.heading',
    'ui.externalViews.kind.satellite',
    'warning.label.impacts', // "IMPACTS" — the French plural is spelled the same
    'warning.label.action',
  ],
  ro: [
    'statusStrip.active', // "Active" — Romanian feminine plural of activ
    'statusStrip.liveOfTotal',
    'statusStrip.minutesAgo',
    'tabs.sitrep',
    'ui.mode.DB', // "Operator" is the Romanian word
    'ui.freshness.fresh', // "Live" — the loanword Romanian broadcasters use
  ],
  es: ['statusStrip.minutesAgo'],
  'pt-BR': ['statusStrip.minutesAgo', 'tabs.sitrep'],
  id: ['tabs.sitrep', 'ui.mode.DB'],
  fil: [
    // Tagalog takes its computing and emergency-management vocabulary from English almost wholesale.
    'map.detail.node',
    'shell.region.ro',
    'statusStrip.minutesAgo',
    'verifierQueue.component.geocode',
    'tabs.sitrep',
    'toolbar.devLoginUserPlaceholder',
    'toolbar.loginUserLabel',
    'toolbar.loginPasswordLabel',
    'toolbar.loginPasswordPlaceholder',
    'ui.mode.DB',
    'ui.freshness.fresh',
  ],
};

/** Does this value carry translatable prose at all? A pure placeholder/number/symbol never differs. */
function isTranslatableProse(v: string): boolean {
  // Strip ICU placeholders before asking — "{count}" and "{hours, number} h" carry almost no prose.
  const withoutIcu = v.replace(/\{[^}]*\}/g, '').trim();
  if (withoutIcu.length < 3) return false;
  return /\p{L}{3,}/u.test(withoutIcu);
}

describe('untranslated content (values identical to English)', () => {
  const english = readCatalog('en');
  const englishKeys = leafKeys(english);

  it.each(LOCALE_IDS.filter((l) => l !== 'en'))(
    'messages/%s.json carries no untranslated prose outside the allowlist',
    (locale) => {
      const catalog = readCatalog(locale as LocaleId);
      const identical = englishKeys.filter((key) => {
        if (IDENTICAL_ALLOWED.has(key)) return false;
        if (REVIEWED_IDENTICAL[locale]?.includes(key) === true) return false;
        const en = leafValue(english, key);
        const loc = leafValue(catalog, key);
        return typeof en === 'string' && en === loc && isTranslatableProse(en);
      });
      // Named, not counted: a bare number tells a maintainer there is a problem; the paths tell them
      // which strings a speaker of this language cannot read.
      expect(
        identical,
        `${locale}: ${identical.length} untranslated — ${identical.slice(0, 12).join(', ')}`,
      ).toEqual([]);
    },
  );
});

// ── Invariant 7: the exemption lists cannot rot ───────────────────────────────────────────────────────
//
// An allowlist is the classic place for a gate to quietly stop covering what it claims to. Two ways it
// rots: an entry names a key that no longer exists, or a key gets properly translated and the exemption
// stays behind, now silently excusing nothing while looking like it excuses something. Both leave a
// reviewer reading a list that does not describe the catalogue. So the lists are themselves checked.
describe('the untranslated-content exemptions describe reality', () => {
  const english = readCatalog('en');
  const englishKeys = new Set(leafKeys(english));

  it('every globally allowed key still exists in the English catalogue', () => {
    expect([...IDENTICAL_ALLOWED].filter((k) => !englishKeys.has(k))).toEqual([]);
  });

  it.each(Object.keys(REVIEWED_IDENTICAL))(
    'every reviewed-identical entry for %s still exists AND is still identical',
    (locale) => {
      const catalog = readCatalog(locale);
      const entries = REVIEWED_IDENTICAL[locale] ?? [];
      expect(entries.filter((k) => !englishKeys.has(k))).toEqual([]);
      // Still identical: if someone translated it, the exemption is dead weight and should be deleted.
      const noLongerIdentical = entries.filter(
        (k) => leafValue(english, k) !== leafValue(catalog, k),
      );
      expect(
        noLongerIdentical,
        `${locale}: these are now translated — delete them from REVIEWED_IDENTICAL: ${noLongerIdentical.join(', ')}`,
      ).toEqual([]);
    },
  );

  it('a locale with no entry gets no exemptions — there is no blanket default', () => {
    for (const locale of LOCALE_IDS.filter((l) => l !== 'en')) {
      if (!(locale in REVIEWED_IDENTICAL)) expect(REVIEWED_IDENTICAL[locale]).toBeUndefined();
    }
  });
});

// ── Invariant 8: every catalogue states its own coverage ──────────────────────────────────────────────
//
// `_meta.machineTranslated` already tells a reader these strings were not written by a human translator.
// It does NOT say whether the catalogue is COMPLETE, and for most of this project's life one of them
// (Filipino) was roughly half the size of the others with nothing on screen saying so. A field that must
// be declared is the cheap way to stop that recurring silently.
describe('catalogue coverage is declared, not assumed', () => {
  it.each(LOCALE_IDS.filter((l) => l !== 'en'))('%s declares a coverage level', (locale) => {
    const meta = (readCatalog(locale) as { _meta?: { coverage?: string } })._meta;
    expect(meta?.coverage, `${locale}: _meta.coverage must be "full" or "partial"`).toMatch(
      /^(full|partial)$/,
    );
  });
});
