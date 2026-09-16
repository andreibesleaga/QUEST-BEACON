// BEACON — RTL guard (ADR-030; FR-I18N-3, NFR-F8). Arabic and Urdu ship, so the interface must lay out
// right-to-left. The failure mode is not dramatic — it is a stray `ml-2` that leaves one chip hanging off
// the wrong side of a card, which nobody notices in review because nobody reviews in Arabic. So it is
// enforced mechanically: **physical direction utilities are banned in app/**; use the logical ones.**
//
//   ml-/mr-      → ms-/me-        pl-/pr-       → ps-/pe-
//   border-l/r   → border-s/e     text-left/right → text-start/end
//   rounded-l-/r- → rounded-s-/e-
//
// The map canvas is deliberately NOT part of this: geography never mirrors (ADR-030). This test only
// covers the chrome around it.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const APP_DIR = fileURLToPath(new URL('../../app/', import.meta.url));

/**
 * Physical-direction utilities that have a logical equivalent. Word-boundary anchored so `rounded-lg`
 * (a RADIUS SIZE, not a side) and `border-t` are not false positives.
 */
const BANNED = [
  { pattern: /\b(ml|mr)-[\w./[\]]+/g, use: 'ms-/me-' },
  { pattern: /\b(pl|pr)-[\w./[\]]+/g, use: 'ps-/pe-' },
  { pattern: /\bborder-(l|r)\b/g, use: 'border-s/border-e' },
  { pattern: /\btext-(left|right)\b/g, use: 'text-start/text-end' },
  { pattern: /\brounded-[tb]?(l|r)-[\w./[\]]+/g, use: 'rounded-s-/rounded-e-' },
];

/**
 * Direction-NEUTRAL uses that must stay physical. Each entry is a justification, not a suppression:
 * `left-1/2` with `-translate-x-1/2` centres an element — it is symmetric, so mirroring it would be a
 * no-op at best and a bug at worst.
 */
const ALLOWED_EXACT = ['left-1/2', 'right-1/2'];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = `${dir}${name}`;
    if (statSync(full).isDirectory()) return sourceFiles(`${full}/`);
    if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) return [];
    return [full];
  });
}

describe('RTL: app chrome uses logical CSS properties only (FR-I18N-3)', () => {
  const files = sourceFiles(APP_DIR);

  it('finds source files to check (guards against a silently empty scan)', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const file of files) {
    const rel = file.slice(APP_DIR.length);
    it(`app/${rel} has no physical-direction utility`, () => {
      const source = readFileSync(file, 'utf8');
      const offences: string[] = [];
      for (const { pattern, use } of BANNED) {
        for (const match of source.matchAll(pattern)) {
          if (ALLOWED_EXACT.includes(match[0])) continue;
          const line = source.slice(0, match.index).split('\n').length;
          offences.push(`${rel}:${line} "${match[0]}" → use ${use}`);
        }
      }
      expect(offences, offences.join('\n')).toEqual([]);
    });
  }
});
