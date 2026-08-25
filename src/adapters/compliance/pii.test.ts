// BEACON — PII detect/redact tests (E6·T-271…T-274; ADR-017/CM-C8/LLM02).
import { describe, expect, it } from 'vitest';
import { loadPolicy } from './policy-loader.js';
import { applyPii, detectPii, redactDeep } from './pii.js';

const { piiPatterns } = loadPolicy();

describe('detectPii — pattern coverage', () => {
  it.each([
    ['email', 'contact jane.doe@example.org'],
    ['ssn', 'SSN 123-45-6789'],
    ['phone', 'call (415) 555-0132'],
  ])('detects %s (class name only, never the value)', (cls, text) => {
    const matches = detectPii(text, piiPatterns);
    expect(matches).toContain(cls);
  });
});

describe('applyPii — actions', () => {
  it('redact swaps a class-only placeholder (no raw value, no reversible suffix)', () => {
    const r = applyPii('email me at bob@site.io now', piiPatterns, 'redact');
    expect(r.blocked).toBe(false);
    expect(r.text).not.toContain('bob@site.io');
    // Class-only token: `[REDACTED:<class>]` with NO value-derived (offline-reversible) suffix (Art. IV).
    expect(r.text).toContain('[REDACTED:email]');
    expect(r.text).not.toMatch(/\[REDACTED:email:[0-9a-f]+\]/);
  });

  it('two DIFFERENT low-entropy values redact to the SAME class token (nothing to brute-force)', () => {
    // The old FNV suffix let the upstream LLM invert low-entropy PII offline; identical tokens now leak
    // no per-value signal at all. Distinct phone numbers ⇒ indistinguishable placeholders.
    const a = applyPii('call (415) 555-0132', piiPatterns, 'redact').text;
    const b = applyPii('call (415) 555-0199', piiPatterns, 'redact').text;
    expect(a).toBe(b);
    expect(a).not.toMatch(/[0-9a-f]{8}/); // no residual hash suffix anywhere in the token
  });

  it('hash marks a one-way scrub with a class-only token (no value-derived suffix)', () => {
    const r = applyPii('SSN 123-45-6789 on file', piiPatterns, 'hash');
    expect(r.text).not.toContain('123-45-6789');
    expect(r.text).toContain('[PII:ssn]');
    expect(r.text).not.toMatch(/\[PII:ssn:[0-9a-f]+\]/);
  });

  it('block short-circuits (blocked=true) when PII is present', () => {
    const r = applyPii('email me at bob@site.io', piiPatterns, 'block');
    expect(r.blocked).toBe(true);
  });

  it('leaves PII-free text unchanged', () => {
    const r = applyPii('two shelters open', piiPatterns, 'redact');
    expect(r.matches).toHaveLength(0);
    expect(r.text).toBe('two shelters open');
  });
});

describe('redactDeep — deep payload walk (egress guard)', () => {
  it('redacts strings nested in a NarrativeRequest-shaped object', () => {
    const payload = { facts: [{ claim: 'reporter alice@ex.com at (212) 555-9000' }], style: 'sitrep' };
    const out = redactDeep(payload, piiPatterns, 'redact');
    const json = JSON.stringify(out.value);
    expect(json).not.toContain('alice@ex.com');
    expect(out.matches).toContain('email');
    expect(out.matches).toContain('phone');
  });

  it('block action reports blocked when nested PII is present', () => {
    const out = redactDeep({ a: { b: 'ssn 123-45-6789' } }, piiPatterns, 'block');
    expect(out.blocked).toBe(true);
  });
});
