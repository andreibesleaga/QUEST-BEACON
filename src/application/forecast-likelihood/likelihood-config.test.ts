// BEACON — forecast-likelihood threshold-table config tests (C1.2; ADR-033 §2.2, ADR-012).
//
// Two jobs: (1) the SHIPPED config/likelihood-thresholds.json validates against its published JSON-Schema —
// the same config↔schema pin as region-registry.schema.test.ts, so a hand edit that breaks the contract fails
// a test rather than silently reshaping every class BEACON displays; (2) the fail-fast parser rejects every
// malformed table, including the two properties JSON-Schema cannot express (ascending bands, ascending class
// rank). No live network, no clock, no filesystem writes.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  DEFAULT_LIKELIHOOD_CONFIG,
  LIKELIHOOD_SIGNAL_TYPES,
  parseLikelihoodConfig,
} from './likelihood-config.js';

const CONFIG = fileURLToPath(
  new URL('../../../config/likelihood-thresholds.json', import.meta.url),
);
const SCHEMA = fileURLToPath(
  new URL('../../../schemas/likelihood-thresholds.schema.json', import.meta.url),
);

const raw = JSON.parse(readFileSync(CONFIG, 'utf8')) as Record<string, unknown>;

describe('config/likelihood-thresholds.json ↔ schemas/likelihood-thresholds.schema.json', () => {
  it('validates against the published JSON-Schema', () => {
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
      JSON.parse(readFileSync(SCHEMA, 'utf8')) as object,
    );
    validate(raw);
    expect(validate.errors ?? [], JSON.stringify(validate.errors, null, 2)).toEqual([]);
  });

  it('rejects an unknown signal type and an unknown band class (additionalProperties/enum are closed)', () => {
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
      JSON.parse(readFileSync(SCHEMA, 'utf8')) as object,
    );
    const signalTypes = raw['signalTypes'] as Record<string, unknown>;
    expect(
      validate({ ...raw, signalTypes: { ...signalTypes, MADE_UP_SIGNAL: { kind: 'ORDINAL' } } }),
    ).toBe(false);
    expect(
      validate({
        ...raw,
        signalTypes: {
          CATEGORICAL_ADVISORY_TIER: {
            ...(signalTypes['CATEGORICAL_ADVISORY_TIER'] as Record<string, unknown>),
            levels: { low: 'CERTAIN' },
          },
        },
      }),
    ).toBe(false);
  });

  it('keeps the thresholds OUT of the code: no band bound appears as a literal in the classifier', () => {
    // ADR-012: the table is data. If someone re-hardcodes 0.3/0.6 into the use-case this fails.
    const classifier = readFileSync(
      fileURLToPath(new URL('./forecast-likelihood.ts', import.meta.url)),
      'utf8',
    ).replace(/^\s*(\/\/|\*|\/\*).*$/gm, ''); // ignore prose in comments
    expect(classifier).not.toMatch(/0\.3\b/);
    expect(classifier).not.toMatch(/0\.6\b/);
  });
});

describe('the shipped table (DEFAULT_LIKELIHOOD_CONFIG)', () => {
  it('carries ADR-033 §2.2 row 1: derived exceedance probability, unclassified below 0.30', () => {
    const rule = DEFAULT_LIKELIHOOD_CONFIG.signalTypes.DERIVED_EXCEEDANCE_PROBABILITY;
    expect(rule?.kind).toBe('CONTINUOUS');
    if (rule?.kind !== 'CONTINUOUS') return;
    expect(rule.unclassifiedBelow).toBe(0.3);
    expect(rule.bands).toEqual([
      { lowerBound: 0.3, class: 'LIKELY' },
      { lowerBound: 0.6, class: 'VERY_LIKELY' },
    ]);
  });

  it('carries ADR-033 §2.2 row 2: ensemble member fraction banded from POSSIBLE up', () => {
    const rule = DEFAULT_LIKELIHOOD_CONFIG.signalTypes.ENSEMBLE_MEMBER_FRACTION;
    if (rule?.kind !== 'CONTINUOUS')
      return expect.unreachable('member fraction must be a continuous rule');
    expect(rule.unclassifiedBelow).toBeUndefined();
    expect(rule.bands.map((b) => b.class)).toEqual(['POSSIBLE', 'LIKELY', 'VERY_LIKELY']);
  });

  it('carries ADR-033 §2.2 row 3: ordinal advisory tiers mapped one-to-one', () => {
    const rule = DEFAULT_LIKELIHOOD_CONFIG.signalTypes.CATEGORICAL_ADVISORY_TIER;
    if (rule?.kind !== 'ORDINAL')
      return expect.unreachable('advisory tier must be an ordinal rule');
    expect(rule.levels).toEqual({ low: 'POSSIBLE', medium: 'LIKELY', high: 'VERY_LIKELY' });
  });

  it('states a source and a displayed method for EVERY signal type (no unsourced number)', () => {
    for (const name of LIKELIHOOD_SIGNAL_TYPES) {
      const rule = DEFAULT_LIKELIHOOD_CONFIG.signalTypes[name];
      expect(rule, name).toBeDefined();
      expect(rule?.source.length ?? 0, `${name} source`).toBeGreaterThan(20);
      expect(rule?.method.length ?? 0, `${name} method`).toBeGreaterThan(20);
      expect(rule?.sourceField.length ?? 0, `${name} sourceField`).toBeGreaterThan(0);
    }
  });

  it('never implies live ensemble access, and calls the member fraction what it is', () => {
    // Finding F-34 is binding: GloFAS reporting points expose a DERIVED probability; there is no wired live
    // ensemble source. The config text must not claim otherwise, and must not sell spread as a chance.
    const rule = DEFAULT_LIKELIHOOD_CONFIG.signalTypes.ENSEMBLE_MEMBER_FRACTION;
    if (rule?.kind !== 'CONTINUOUS')
      return expect.unreachable('member fraction must be a continuous rule');
    expect(rule.unit).toMatch(/share of forecast members/i);
    expect(rule.unit).toMatch(/NOT a calibrated probability/i);
    expect(rule.source).toMatch(/no wired live ensemble source/i);
    expect(`${rule.source} ${rule.method} ${rule.unit}`).not.toMatch(
      /\blive ensemble (feed|api|query|access)\b/i,
    );
  });
});

const ordinal = {
  kind: 'ORDINAL',
  sourceField: 'tier',
  source: 's'.repeat(30),
  method: 'm'.repeat(30),
};
const continuous = {
  kind: 'CONTINUOUS',
  sourceField: 'p',
  source: 's'.repeat(30),
  method: 'm'.repeat(30),
  unit: 'u',
};
const wrap = (signalTypes: Record<string, unknown>) => ({
  version: 1,
  authority: 'a'.repeat(30),
  boundaryConvention: 'b'.repeat(30),
  signalTypes,
});

describe('parseLikelihoodConfig fails fast', () => {
  const bad: readonly [string, unknown][] = [
    ['a non-object file', 'nope'],
    ['a null file', null],
    ['a wrong version', { ...wrap({}), version: 2 }],
    [
      'a missing authority',
      {
        ...wrap({ CATEGORICAL_ADVISORY_TIER: { ...ordinal, levels: { low: 'POSSIBLE' } } }),
        authority: '  ',
      },
    ],
    [
      'a missing boundary convention',
      {
        ...wrap({ CATEGORICAL_ADVISORY_TIER: { ...ordinal, levels: { low: 'POSSIBLE' } } }),
        boundaryConvention: '',
      },
    ],
    [
      'a missing signalTypes',
      { version: 1, authority: 'a'.repeat(30), boundaryConvention: 'b'.repeat(30) },
    ],
    ['an empty signalTypes', wrap({})],
    ['an unknown signal type', wrap({ VIBES: { ...ordinal, levels: { low: 'POSSIBLE' } } })],
    ['an unknown rule kind', wrap({ ENSEMBLE_MEMBER_FRACTION: { ...continuous, kind: 'MAGIC' } })],
    [
      'a missing sourceField',
      wrap({
        ENSEMBLE_MEMBER_FRACTION: {
          ...continuous,
          sourceField: '',
          bands: [{ lowerBound: 0, class: 'POSSIBLE' }],
        },
      }),
    ],
    [
      'a missing source',
      wrap({
        ENSEMBLE_MEMBER_FRACTION: {
          ...continuous,
          source: undefined,
          bands: [{ lowerBound: 0, class: 'POSSIBLE' }],
        },
      }),
    ],
    [
      'a missing method',
      wrap({
        ENSEMBLE_MEMBER_FRACTION: {
          ...continuous,
          method: 42,
          bands: [{ lowerBound: 0, class: 'POSSIBLE' }],
        },
      }),
    ],
    [
      'a missing unit',
      wrap({
        ENSEMBLE_MEMBER_FRACTION: {
          ...continuous,
          unit: '',
          bands: [{ lowerBound: 0, class: 'POSSIBLE' }],
        },
      }),
    ],
    ['no bands at all', wrap({ ENSEMBLE_MEMBER_FRACTION: { ...continuous } })],
    ['an empty band list', wrap({ ENSEMBLE_MEMBER_FRACTION: { ...continuous, bands: [] } })],
    [
      'a band bound above 1',
      wrap({
        ENSEMBLE_MEMBER_FRACTION: { ...continuous, bands: [{ lowerBound: 1.4, class: 'LIKELY' }] },
      }),
    ],
    [
      'a NaN band bound',
      wrap({
        ENSEMBLE_MEMBER_FRACTION: { ...continuous, bands: [{ lowerBound: NaN, class: 'LIKELY' }] },
      }),
    ],
    [
      'an unknown band class',
      wrap({
        ENSEMBLE_MEMBER_FRACTION: { ...continuous, bands: [{ lowerBound: 0.5, class: 'CERTAIN' }] },
      }),
    ],
    [
      'bands that do not ascend by bound',
      wrap({
        ENSEMBLE_MEMBER_FRACTION: {
          ...continuous,
          bands: [
            { lowerBound: 0.6, class: 'LIKELY' },
            { lowerBound: 0.3, class: 'VERY_LIKELY' },
          ],
        },
      }),
    ],
    [
      'bands whose class rank does not ascend with the bound (a non-monotonic table)',
      wrap({
        ENSEMBLE_MEMBER_FRACTION: {
          ...continuous,
          bands: [
            { lowerBound: 0.3, class: 'VERY_LIKELY' },
            { lowerBound: 0.6, class: 'LIKELY' },
          ],
        },
      }),
    ],
    [
      'an unclassifiedBelow above the lowest band',
      wrap({
        ENSEMBLE_MEMBER_FRACTION: {
          ...continuous,
          unclassifiedBelow: 0.5,
          bands: [{ lowerBound: 0.3, class: 'LIKELY' }],
        },
      }),
    ],
    [
      'an out-of-range unclassifiedBelow',
      wrap({
        ENSEMBLE_MEMBER_FRACTION: {
          ...continuous,
          unclassifiedBelow: -1,
          bands: [{ lowerBound: 0, class: 'POSSIBLE' }],
        },
      }),
    ],
    ['ordinal levels that are missing', wrap({ CATEGORICAL_ADVISORY_TIER: { ...ordinal } })],
    [
      'ordinal levels that are empty',
      wrap({ CATEGORICAL_ADVISORY_TIER: { ...ordinal, levels: {} } }),
    ],
    [
      'an upper-case ordinal level key',
      wrap({ CATEGORICAL_ADVISORY_TIER: { ...ordinal, levels: { High: 'VERY_LIKELY' } } }),
    ],
    [
      'an ordinal level mapped to a non-class',
      wrap({ CATEGORICAL_ADVISORY_TIER: { ...ordinal, levels: { low: 'MAYBE' } } }),
    ],
  ];

  for (const [what, cfg] of bad) {
    it(`rejects ${what}`, () => {
      expect(() => parseLikelihoodConfig(cfg)).toThrow(
        /Invalid config\/likelihood-thresholds\.json/,
      );
    });
  }

  it('accepts a minimal valid table (per-region injection is a first-class path)', () => {
    const cfg = parseLikelihoodConfig(
      wrap({
        DERIVED_EXCEEDANCE_PROBABILITY: {
          ...continuous,
          unclassifiedBelow: 0.1,
          bands: [{ lowerBound: 0.5, class: 'VERY_LIKELY' }],
        },
      }),
    );
    const rule = cfg.signalTypes.DERIVED_EXCEEDANCE_PROBABILITY;
    if (rule?.kind !== 'CONTINUOUS') return expect.unreachable('expected a continuous rule');
    expect(rule.unclassifiedBelow).toBe(0.1);
    expect(cfg.signalTypes.ENSEMBLE_MEMBER_FRACTION).toBeUndefined();
  });
});
