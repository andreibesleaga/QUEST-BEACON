// BEACON — the documented example environment must boot (added after the 2026-09-11 outage).
//
// `.env.example` is the contract an operator copies. On 2026-09-11 a parser merged that rejected the value
// this file documents for REQUIRE_HUMAN_ABOVE_THRESHOLD (`on`), and the live deployment went down within
// the hour while every CI job stayed green — no job had ever run the loaders against the documented values.
// This test closes that gap the only way that cannot rot: it reads the example file itself and pushes every
// declared value through the SAME loaders the app boots with. If a loader and the documentation disagree,
// this is red before merge, not on Railway after it.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './index.js';
import { loadPolicy } from '../adapters/compliance/policy-loader.js';

const EXAMPLE = fileURLToPath(new URL('../../.env.example', import.meta.url));

/** The declared (uncommented) KEY=value pairs, inline comments stripped, quotes removed. */
function declaredEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const raw of readFileSync(EXAMPLE, 'utf8').split('\n')) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(raw);
    if (m === null) continue;
    let value = m[2]!;
    const hash = value.indexOf(' #');
    if (hash >= 0) value = value.slice(0, hash);
    value = value
      .trim()
      .replace(/^"(.*)"$/, '$1')
      .replace(/^'(.*)'$/, '$1');
    env[m[1]!] = value;
  }
  return env;
}

describe('.env.example boots the real loaders', () => {
  const env = declaredEnv();

  it('declares a meaningful number of variables (the parser is reading the right file)', () => {
    expect(Object.keys(env).length).toBeGreaterThan(40);
    expect(env['REQUIRE_HUMAN_ABOVE_THRESHOLD']).toBe('on'); // the value that took production down
  });

  it('every documented value passes the config schema', () => {
    expect(() => loadConfig(env)).not.toThrow();
  });

  it('documents every variable the config schema knows (release guide §7 — no undocumented knob)', () => {
    const text = readFileSync(EXAMPLE, 'utf8');
    const documented = (name: string) =>
      new RegExp(`(^|[^A-Z0-9_])${name}([^A-Z0-9_]|$)`, 'm').test(text);
    const missing = Object.keys(loadConfig({})).filter((k) => !documented(k));
    expect(missing).toEqual([]);
  });

  it('documents SOURCE_<PREFIX>_MODE for every adapter in the manifest', () => {
    const text = readFileSync(EXAMPLE, 'utf8');
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../config/adapters.json', import.meta.url)), 'utf8'),
    ) as
      | { adapters?: { id: string; configPrefix?: string }[] }
      | { id: string; configPrefix?: string }[];
    const entries = Array.isArray(manifest) ? manifest : (manifest.adapters ?? []);
    expect(entries.length).toBeGreaterThan(40);
    const missing = entries
      .filter((e) => typeof e.configPrefix === 'string')
      .map((e) => `SOURCE_${e.configPrefix}_MODE`)
      .filter((name) => !text.includes(name));
    expect(missing).toEqual([]);
  });

  it('every documented budget value passes the policy loader', () => {
    const p = loadPolicy('./config/policies.yml', './schemas/policies.schema.json', env);
    expect(p.policy.budget.require_human_above_threshold).toBe(true);
  });
});
