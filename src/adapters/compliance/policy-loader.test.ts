// BEACON — policy loader tests (E6·T-240/T-242; ADR-017/F10/CM-C33).
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPolicy } from './policy-loader.js';

const SCHEMA = './schemas/policies.schema.json';
const REAL_POLICY = './config/policies.yml';
const dir = mkdtempSync(join(tmpdir(), 'beacon-policy-'));
const write = (name: string, body: string): string => {
  const p = join(dir, name);
  writeFileSync(p, body);
  return p;
};

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('loadPolicy (fail-fast policy-as-code, T-240/T-242)', () => {
  it('validates the real config/policies.yml and returns a compiled Policy', () => {
    const compiled = loadPolicy(REAL_POLICY, SCHEMA);
    expect(compiled.policy.version).toMatch(/\d/);
    expect(compiled.policy.roles.em?.allowed_models).toContain('*');
    // Regexes are pre-compiled to RegExp (boot check, D-29).
    expect(compiled.piiPatterns.every((p) => p.re instanceof RegExp)).toBe(true);
    expect(compiled.blockedPatterns.length).toBeGreaterThan(0);
  });

  it('rejects a policy whose version is empty (bad-version → fail-fast)', () => {
    const body = readFileSync(REAL_POLICY, 'utf8').replace(/version:\s*"[^"]*"/, 'version: ""');
    expect(() => loadPolicy(write('bad-version.yml', body), SCHEMA)).toThrow(/fail-fast/i);
  });

  it('aborts boot when a required block (budget) is missing', () => {
    // Strip the entire budget block → schema `required` violation.
    const body = readFileSync(REAL_POLICY, 'utf8').replace(/\nbudget:[\s\S]*?(?=\neu_ai_act:)/, '\n');
    expect(() => loadPolicy(write('no-budget.yml', body), SCHEMA)).toThrow(/fail-fast/i);
  });

  it('fails fast on an un-compilable PII regex pattern', () => {
    const body = readFileSync(REAL_POLICY, 'utf8').replace(
      /name: email\n\s*regex:\s*"[^"]*"/,
      'name: email\n      regex: "([unterminated"',
    );
    expect(() => loadPolicy(write('bad-regex.yml', body), SCHEMA)).toThrow(/regex|fail-fast/i);
  });
});

// ── F-347 sibling: precise location in FREE TEXT must not reach a cloud LLM (Art. XIV) ─────────────────
//
// `geomPrecise` — the STRUCTURED coordinate — was already gated: it is responder-view-only, and the D6
// aggregate-only denylist blocks it by key. But the four original PII patterns (email/ssn/phone/credit-card)
// match no coordinate at all, so a reporter typing "I'm at 38.5816, -121.4944" into the SOS description
// sent their exact position upstream unredacted, through the one field a schema cannot constrain.
//
// These assert the REAL `config/policies.yml` (not a fixture), because the value of this guard is entirely
// about what the SHIPPED policy does. Both directions are pinned: coordinates redact, and the deterministic
// cited facts the narration is grounded in survive — a pattern that ate "crest 12.4 feet" would silently
// disable the SitRep by starving it of the facts it must cite.
describe('PII patterns — precise location in free text (Art. XIV)', () => {
  const compiled = loadPolicy(REAL_POLICY, SCHEMA);
  const redact = (text: string): string =>
    compiled.piiPatterns.reduce((out, p) => out.replace(new RegExp(p.re.source, `${p.re.flags.replace('g', '')}g`), '[X]'), text);

  it.each([
    ["I'm at 38.5816, -121.4944 please hurry", 'decimal pair, comma-separated'],
    ['trapped near 34.0522 -118.2437', 'decimal pair, space-separated, negative lon'],
    ['position 38° 34\' 53.8" N, 121° 29\' 39.8" W', 'degrees-minutes-seconds'],
  ])('redacts a precise position written as %j (%s)', (text) => {
    const out = redact(text);
    expect(out).not.toMatch(/\d+\.\d{3,}/); // no surviving high-precision coordinate
    expect(out).toContain('[X]');
  });

  it.each([
    'crest at 12.4 feet',
    'wind 45.5 mph gusting',
    '3 sources report 1200.5 acres burned',
    'ETA 2.5 hours',
  ])('leaves the deterministic cited fact %j intact — the narration must still be groundable', (text) => {
    expect(redact(text)).toBe(text);
  });
});
