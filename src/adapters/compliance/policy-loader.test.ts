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
    // Either quote style: the formatter normalises YAML strings to single quotes.
    const body = readFileSync(REAL_POLICY, 'utf8').replace(
      /version:\s*["'][^"']*["']/,
      'version: ""',
    );
    expect(() => loadPolicy(write('bad-version.yml', body), SCHEMA)).toThrow(/fail-fast/i);
  });

  it('aborts boot when a required block (budget) is missing', () => {
    // Strip the entire budget block → schema `required` violation.
    const body = readFileSync(REAL_POLICY, 'utf8').replace(
      /\nbudget:[\s\S]*?(?=\neu_ai_act:)/,
      '\n',
    );
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
    compiled.piiPatterns.reduce(
      (out, p) => out.replace(new RegExp(p.re.source, `${p.re.flags.replace('g', '')}g`), '[X]'),
      text,
    );

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
  ])(
    'leaves the deterministic cited fact %j intact — the narration must still be groundable',
    (text) => {
      expect(redact(text)).toBe(text);
    },
  );
});

// ── The four budget env vars were INERT (documentation audit, 2026-09-11) ───────────────────────────
//
// `BUDGET_PER_INCIDENT_USD`, `BUDGET_PER_REGION_USD`, `BUDGET_ESCALATION_THRESHOLD_USD` and
// `REQUIRE_HUMAN_ABOVE_THRESHOLD` were documented in BOTH `.env.example` and `CONFIGURATION.md`, were not
// even present in the config schema, and were read by NO code. Enforcement ran solely off
// `config/policies.yml`.
//
// That is worse than an undocumented variable. An operator who sets `BUDGET_PER_REGION_USD=10` in the
// Railway variable store — the only surface they have on a hosted deployment — reads the documentation,
// believes they have capped spend at ten dollars, and is actually still governed by the fifty in a YAML
// file baked into the image. A spending limit that silently does nothing is the kind of defect that costs
// real money, and it is one of the few findings in this audit with consequences outside the competition.
//
// The project's own law (`.claude/CLAUDE.md` §14, "Config for everything; nothing hardcoded") says the
// env var should win. These tests pin that.
describe('budget env overrides (the documented vars must actually bind)', () => {
  it('leaves the policy file in charge when no env var is set', () => {
    const p = loadPolicy(REAL_POLICY, SCHEMA, {});
    expect(p.policy.budget.per_region_usd).toBe(50);
    expect(p.policy.budget.require_human_above_threshold).toBe(true);
  });

  it('an env var OVERRIDES the policy file — the operator surface wins', () => {
    const p = loadPolicy(REAL_POLICY, SCHEMA, {
      BUDGET_PER_REGION_USD: '10',
      BUDGET_PER_INCIDENT_USD: '2.5',
      BUDGET_ESCALATION_THRESHOLD_USD: '0.05',
    });
    expect(p.policy.budget.per_region_usd).toBe(10);
    expect(p.policy.budget.per_incident_usd).toBe(2.5);
    expect(p.policy.budget.escalation_threshold_usd).toBe(0.05);
  });

  // THE VOCABULARY IS on/off. That is what `.env.example` line 121 says, what CONFIGURATION.md says, what
  // sixteen other flags in this project use, and what the live Railway variable store has held for weeks.
  // The first version of this parser accepted only true/false, and it took the live deployment down the
  // moment it merged (2026-09-11): every API request runs the policy loader, the loader threw on 'on', and
  // login, sources, health and the SitRep all returned 500 while the static page shell kept serving. The
  // variable had been inert until that day, so the documented value had never been parsed by anything.
  // true/false remain accepted so the earlier tests and any operator who used them keep working.
  it.each([
    ['on', true],
    ['off', false],
    ['ON', true],
    ['Off', false],
    ['true', true],
    ['false', false],
  ])(
    'the human-approval switch parses %j as %j — on/off is the documented vocabulary',
    (raw, expected) => {
      expect(
        loadPolicy(REAL_POLICY, SCHEMA, { REQUIRE_HUMAN_ABOVE_THRESHOLD: raw }).policy.budget
          .require_human_above_threshold,
      ).toBe(expected);
    },
  );

  it('a malformed budget value FAILS THE BOOT rather than falling back to the file', () => {
    // Falling back would recreate the defect in its most dangerous form: the operator asked for a limit,
    // got a different one, and nothing said so. A boot error is the only honest answer.
    expect(() => loadPolicy(REAL_POLICY, SCHEMA, { BUDGET_PER_REGION_USD: 'ten dollars' })).toThrow(
      /BUDGET_PER_REGION_USD/,
    );
    expect(() => loadPolicy(REAL_POLICY, SCHEMA, { BUDGET_PER_INCIDENT_USD: '-5' })).toThrow(
      /BUDGET_PER_INCIDENT_USD/,
    );
    expect(() =>
      loadPolicy(REAL_POLICY, SCHEMA, { REQUIRE_HUMAN_ABOVE_THRESHOLD: 'maybe' }),
    ).toThrow(/REQUIRE_HUMAN_ABOVE_THRESHOLD/);
  });
});
