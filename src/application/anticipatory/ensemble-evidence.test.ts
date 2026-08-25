// BEACON — ensemble member-counting tests (D2; ADR-034 §3, V4, finding F-34).
//
// The load-bearing assertions here are the honesty ones: the evaluator reads a CACHED/RECORDED FILE, the
// shipped fixture says so in its own words, the evidence never claims to be live, and a member share is never
// expressed as a chance of occurrence. Deterministic: fixture files on disk, no network, no clock.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ENSEMBLE_MEMBER_COUNT_LABEL, SOURCE_DERIVED_PROBABILITY_LABEL } from '@/domain/trigger-evaluation.js';
import type { EnsembleMemberFile } from './ensemble-evidence.js';
import { countMembersOverThreshold, ensembleEvidence, parseEnsembleMemberFile, sourceProbabilityEvidence } from './ensemble-evidence.js';

/** THE INPUT SOURCE: a recorded file that ships with the repo. Nothing in BEACON fetches ensemble members. */
const FIXTURE_RUN_1 = fileURLToPath(
  new URL('../../../fixtures/anticipatory/ro-danube-discharge-ensemble-run-1.json', import.meta.url),
);
const FIXTURE_RUN_2 = fileURLToPath(
  new URL('../../../fixtures/anticipatory/ro-danube-discharge-ensemble-run-2.json', import.meta.url),
);

const rawRun = (path: string): Record<string, unknown> => JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
const loadRun = (path: string): EnsembleMemberFile => parseEnsembleMemberFile(rawRun(path));

const RUN_1 = loadRun(FIXTURE_RUN_1);
const RUN_2 = loadRun(FIXTURE_RUN_2);

describe('the shipped ensemble fixture is labelled for what it is (F-34)', () => {
  it.each([
    ['run 1', RUN_1],
    ['run 2', RUN_2],
  ])('%s declares the FIXTURE tier — never LIVE', (_label, run) => {
    expect(run.sourceTier).toBe('FIXTURE');
    expect(run.members.length).toBe(51);
  });

  it('states in the file itself that it is not from GloFAS and that BEACON has no live ensemble source', () => {
    expect(RUN_1.sourceStatement).toMatch(/NOT obtained from Copernicus GloFAS/i);
    expect(RUN_1.sourceStatement).toMatch(/no wired live ensemble source/i);
    expect(RUN_1.sourceStatement).toMatch(/queries no ensemble product at runtime/i);
    expect(RUN_1.sourceStatement).toMatch(/discharge values are invented/i);
  });
});

describe('countMembersOverThreshold is arithmetic, never invention (V4)', () => {
  const members = [1, 2, 3, 4, 5];

  it.each([
    [0, 'GTE', 5],
    [3, 'GTE', 3],
    [5, 'GTE', 1],
    [6, 'GTE', 0],
    [3, 'LTE', 3],
    [0, 'LTE', 0],
  ] as const)('counts members %s %s as %s', (threshold, comparator, expected) => {
    expect(countMembersOverThreshold(members, threshold, comparator)).toBe(expected);
  });

  it('counts the threshold value itself as crossing it (the bound is inclusive, both directions)', () => {
    expect(countMembersOverThreshold([10], 10, 'GTE')).toBe(1);
    expect(countMembersOverThreshold([10], 10, 'LTE')).toBe(1);
  });

  it('counts the real fixture exactly, per stage threshold', () => {
    expect(countMembersOverThreshold(RUN_1.members, 6500, 'GTE')).toBe(37);
    expect(countMembersOverThreshold(RUN_1.members, 7200, 'GTE')).toBe(22);
    expect(countMembersOverThreshold(RUN_2.members, 6500, 'GTE')).toBe(51);
    expect(countMembersOverThreshold(RUN_2.members, 7200, 'GTE')).toBe(36);
  });
});

describe('ensembleEvidence — the count travels with the threshold it was taken against', () => {
  const evidence = ensembleEvidence(RUN_1, 6500, 'GTE');

  it('reports k of N and the fraction, all three from the same list', () => {
    expect(evidence.membersOverThreshold).toBe(37);
    expect(evidence.memberTotal).toBe(51);
    expect(evidence.memberFraction).toBeCloseTo(37 / 51, 12);
    expect(evidence.threshold).toBe(6500);
    expect(evidence.comparator).toBe('GTE');
  });

  it('carries the source vintage, version, tier and statement verbatim', () => {
    expect(evidence.issuedAt).toBe(RUN_1.issuedAt);
    expect(evidence.forecastVersion).toBe(RUN_1.forecastVersion);
    expect(evidence.leadTimeHours).toBe(RUN_1.leadTimeHours);
    expect(evidence.sourceTier).toBe('FIXTURE');
    expect(evidence.sourceStatement).toBe(RUN_1.sourceStatement);
  });

  it('takes its label from the DOMAIN CONSTANT, so a fixture cannot relabel what it is', () => {
    const relabelled = ensembleEvidence({ ...RUN_1, sourceStatement: 'LIVE GloFAS ensemble feed, real-time' }, 6500, 'GTE');
    expect(relabelled.label).toBe(ENSEMBLE_MEMBER_COUNT_LABEL);
    expect(relabelled.label).toMatch(/no wired live ensemble source/);
  });

  it('makes NO chance-of-occurrence claim and NO live-source claim anywhere in the serialized evidence', () => {
    // Every occurrence of "probability" / "live" in the record must sit inside a DENIAL — the fixed domain
    // label or the file's own source statement. Strip those two, and neither word may remain anywhere.
    const stripped = JSON.stringify(evidence)
      .replace(ENSEMBLE_MEMBER_COUNT_LABEL, '')
      .replace(JSON.stringify(evidence.sourceStatement).slice(1, -1), '');
    expect(stripped).not.toMatch(/probability|chance|percent|odds/i);
    expect(stripped).not.toMatch(/\blive\b/i);
    // …and both denials say the same thing, so neither can drift into a claim.
    expect(ENSEMBLE_MEMBER_COUNT_LABEL).toMatch(/no wired live ensemble source/);
    expect(evidence.sourceStatement).toMatch(/no wired live ensemble source/);
    expect(Object.keys(evidence)).not.toContain('probability');
    expect(evidence.memberFraction).toBeLessThanOrEqual(1);
  });

  it('never gains a probability field, whatever the threshold', () => {
    for (const threshold of [0, 6500, 7200, 99_999]) {
      expect(Object.keys(ensembleEvidence(RUN_1, threshold, 'GTE'))).toEqual(Object.keys(ensembleEvidence(RUN_1, 6500, 'GTE')));
    }
  });
});

describe('sourceProbabilityEvidence — the source value, verbatim and alone', () => {
  const reading = {
    forecastVersion: 'glofas-reporting-point-run-1',
    parameter: 'exceedance of the 5-year return period',
    unit: 'dimensionless probability fraction in [0,1]',
    issuedAt: '2026-07-05T00:00:00Z',
    leadTimeHours: 36,
    sourceTier: 'CACHED' as const,
    sourceStatement: 'Derived exceedance probability published by the source product itself, carried verbatim.',
    probability: 0.72,
  };

  it('carries the probability unchanged and gains NO member count', () => {
    const evidence = sourceProbabilityEvidence(reading);
    expect(evidence.probability).toBe(0.72);
    expect(evidence.label).toBe(SOURCE_DERIVED_PROBABILITY_LABEL);
    for (const banned of ['memberTotal', 'membersOverThreshold', 'memberFraction']) {
      expect(Object.keys(evidence)).not.toContain(banned);
    }
  });
});

describe('parseEnsembleMemberFile fails fast', () => {
  const base = rawRun(FIXTURE_RUN_1);
  const bad: readonly [string, unknown][] = [
    ['a non-object file', 'nope'],
    ['a null file', null],
    ['a wrong version', { ...base, version: 2 }],
    ['no members at all', { ...base, members: [] }],
    ['members that are not an array', { ...base, members: 51 }],
    ['a non-finite member', { ...base, members: [1, Number.NaN] }],
    ['a non-numeric member', { ...base, members: [1, '2'] }],
    ['a LIVE source tier — there is no such tier (F-34)', { ...base, sourceTier: 'LIVE' }],
    ['an unknown source tier', { ...base, sourceTier: 'REALTIME' }],
    ['a missing source tier', { ...base, sourceTier: undefined }],
    ['a source statement too short to state anything', { ...base, sourceStatement: 'cached' }],
    ['a missing source statement', { ...base, sourceStatement: undefined }],
    ['an unparseable vintage', { ...base, issuedAt: 'yesterday' }],
    ['a missing vintage', { ...base, issuedAt: undefined }],
    ['a negative lead time', { ...base, leadTimeHours: -1 }],
    ['a non-numeric lead time', { ...base, leadTimeHours: '40' }],
    ['a blank id', { ...base, id: '' }],
    ['a blank forecast version', { ...base, forecastVersion: '' }],
    ['a blank parameter', { ...base, parameter: '' }],
    ['a blank unit', { ...base, unit: '' }],
  ];

  for (const [what, raw] of bad) {
    it(`rejects ${what}`, () => {
      expect(() => parseEnsembleMemberFile(raw)).toThrow(/Invalid ensemble member file/);
    });
  }

  it('accepts a CACHED tier as well as FIXTURE (a last-known-good copy is still not live)', () => {
    expect(parseEnsembleMemberFile({ ...base, sourceTier: 'CACHED' }).sourceTier).toBe('CACHED');
  });

  it('copies the member list rather than aliasing the caller’s array', () => {
    const raw = { ...base, members: [1, 2, 3] };
    const parsed = parseEnsembleMemberFile(raw);
    (raw.members as number[]).push(4);
    expect(parsed.members).toEqual([1, 2, 3]);
  });
});
