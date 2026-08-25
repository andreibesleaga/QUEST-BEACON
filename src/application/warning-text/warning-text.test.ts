// BEACON — plain-language warning-composition tests (D3.5; ADR-036 §4, V7). The invariants worth pinning
// are not "does it concatenate strings" but: does it EVER compute a number of its own (Art. XII), does the
// action really follow `responseType`, and does a missing catalog key degrade to English instead of
// rendering a raw key on a crisis screen.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { createTranslator } from 'next-intl';
import { ALERT_RESPONSE_TYPES } from '@/domain/alert.js';
import { buildWarningText, WARNING_SECTION_IDS } from './warning-text.js';
import type { WarningTranslate } from './warning-text.js';

const MESSAGES = fileURLToPath(new URL('../../../messages/', import.meta.url));
const catalog = (locale: string): Record<string, unknown> =>
  JSON.parse(readFileSync(`${MESSAGES}${locale}.json`, 'utf8')) as Record<string, unknown>;

/** A real translator over a real shipped catalog — these are the strings that actually ship. */
function translatorFor(locale: string): WarningTranslate {
  const t = createTranslator({ locale, messages: catalog(locale) as never, onError: () => undefined });
  return (key, args) =>
    (t as unknown as (k: string, v?: Readonly<Record<string, string | number>>) => string)(key, args);
}

const en = translatorFor('en');

const INPUT = {
  event: 'Flood',
  severity: 'SEVERE',
  areaDesc: 'Argeș floodplain',
  responseType: 'Evacuate',
  when: 'from 22:00 UTC',
  impacts: '3 lifeline nodes inside the hazard footprint',
} as const;

describe('buildWarningText', () => {
  it('leads with the hazard IN CAPS and the severity word (emphasis survives being read aloud)', () => {
    const text = buildWarningText(INPUT, en);
    expect(text.headline).toBe('FLOOD — Severe');
  });

  it('emits the What / Where / When / Impacts / Action sections in the NWS-HazSimp order', () => {
    const text = buildWarningText(INPUT, en);
    expect(text.sections.map((s) => s.id)).toEqual([...WARNING_SECTION_IDS]);
    expect(text.sections.map((s) => s.label)).toEqual(['WHAT', 'WHERE', 'WHEN', 'IMPACTS', 'ACTION']);
  });

  it('omits WHEN and IMPACTS when the caller has nothing to say (no empty labelled section)', () => {
    const text = buildWarningText({ event: 'Flood', severity: 'MINOR', areaDesc: 'Galați' }, en);
    expect(text.sections.map((s) => s.id)).toEqual(['what', 'where', 'action']);
    expect(text.description).not.toContain('WHEN');
  });

  it('selects the ACTION sentence from responseType — every CAP response type has distinct copy', () => {
    const rendered = new Set<string>();
    for (const responseType of ALERT_RESPONSE_TYPES) {
      const text = buildWarningText({ ...INPUT, responseType }, en);
      expect(text.instruction.length).toBeGreaterThan(0);
      expect(text.instruction).not.toContain('warning.action'); // never a raw key
      rendered.add(text.instruction);
    }
    expect(rendered.size).toBe(ALERT_RESPONSE_TYPES.length);
  });

  it('falls back to the WEAKEST instruction when responseType is absent (never escalates on missing data)', () => {
    const text = buildWarningText({ event: 'Flood', severity: 'SEVERE', areaDesc: 'Galați' }, en);
    expect(text.instruction).toBe(buildWarningText({ event: 'Flood', severity: 'SEVERE', areaDesc: 'Galați', responseType: 'Monitor' }, en).instruction);
  });

  it('keeps the ACTION out of the <description> body (CAP has its own <instruction> element)', () => {
    const text = buildWarningText(INPUT, en);
    expect(text.description).toContain('WHAT:');
    expect(text.description).not.toContain('ACTION:');
    expect(text.description).not.toContain(text.instruction);
  });

  it('COMPUTES NOTHING (Art. XII) — every value in the output came from the input or the catalog', () => {
    const text = buildWarningText(INPUT, en);
    const inputValues = [INPUT.event.toLocaleUpperCase(), INPUT.areaDesc, INPUT.when, INPUT.impacts];
    // Every DIGIT that appears anywhere in the output must also appear in an input value. The module has no
    // arithmetic at all, and this assertion is what would catch someone adding some.
    const digitsIn = (s: string): string => s.replace(/\D+/g, '');
    const outputDigits = digitsIn(text.headline + text.description + text.instruction);
    const inputDigits = digitsIn(inputValues.join(''));
    for (const digit of outputDigits) expect(inputDigits).toContain(digit);
  });

  it('is deterministic — the same input renders byte-identically every time', () => {
    expect(buildWarningText(INPUT, en)).toEqual(buildWarningText(INPUT, en));
  });

  it('renders localized copy for a shipped locale, with machine tokens untouched', () => {
    const ro = buildWarningText({ ...INPUT, event: 'Inundație' }, translatorFor('ro'));
    expect(ro.headline).toBe('INUNDAȚIE — Severă');
    expect(ro.instruction).toContain('Plecați acum din Argeș floodplain');
    expect(ro.sections.map((s) => s.id)).toEqual([...WARNING_SECTION_IDS]); // same structure in every locale
  });

  it('renders every shipped locale without producing a blank or a raw key (acceptance test 2)', () => {
    const locales = ['en', 'zh-Hans', 'hi', 'es', 'ar', 'fr', 'bn', 'pt-BR', 'id', 'ur', 'ru', 'ro', 'fil', 'el'];
    for (const locale of locales) {
      const text = buildWarningText(INPUT, translatorFor(locale));
      for (const part of [text.headline, text.description, text.instruction]) {
        expect(part.trim(), `${locale} produced blank copy`).not.toBe('');
        expect(part, `${locale} rendered a raw key`).not.toMatch(/warning\.[a-zA-Z.]+/);
      }
    }
  });

  it('degrades to the ENGLISH source text for a key a locale has not delivered (never a raw key)', () => {
    // Simulates ADR-030's fallback ladder: the merged catalog resolves the missing key to English.
    const partial = { ...catalog('en'), warning: { ...(catalog('ro') as { warning: object }).warning } };
    const merged = createTranslator({ locale: 'ro', messages: partial as never, onError: () => undefined });
    const t: WarningTranslate = (key, args) =>
      (merged as unknown as (k: string, v?: Readonly<Record<string, string | number>>) => string)(key, args);
    const text = buildWarningText(INPUT, t);
    expect(text.instruction).not.toContain('warning.action');
  });

  it('stays inside a plain-language reading-grade ceiling for the English action sentences', () => {
    // Flesch–Kincaid grade level, computed here rather than pulled in as a dependency. The ceiling is
    // GRADE 9 — the level protective-action guidance is routinely written to. A sentence that drifts above
    // it is a real defect: the people who most need a warning are the least able to parse a long one.
    for (const responseType of ALERT_RESPONSE_TYPES) {
      const sentence = buildWarningText({ ...INPUT, responseType }, en).instruction;
      expect(fleschKincaidGrade(sentence), `${responseType}: "${sentence}"`).toBeLessThanOrEqual(9);
    }
  });
});

/** Flesch–Kincaid grade level: 0.39·(words/sentences) + 11.8·(syllables/words) − 15.59. */
function fleschKincaidGrade(text: string): number {
  const sentences = Math.max(1, (text.match(/[.!?]+/g) ?? []).length);
  const words = text.split(/\s+/).filter((w) => /[a-zA-Z]/.test(w));
  const syllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
  return 0.39 * (words.length / sentences) + 11.8 * (syllables / words.length) - 15.59;
}

/** Vowel-group syllable estimate — the standard approximation used by readability scorers. */
function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length === 0) return 0;
  const groups = w.replace(/e$/, '').match(/[aeiouy]+/g);
  return Math.max(1, groups?.length ?? 0);
}
