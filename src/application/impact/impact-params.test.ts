// BEACON — predicted-impact parameter-set tests (MW-D/D1; ADR-035 §1(d)/§3 + V7, ADR-012).
//
// Three jobs: (1) the SHIPPED config/impact-params.json validates against its published JSON-Schema — the
// same config↔schema pin as the likelihood table, so a hand edit that breaks the contract fails a test rather
// than silently shifting a published clearance figure; (2) the fail-fast parser rejects every malformed set;
// (3) V7's honesty guards — every value declares `verified`, `participationFraction` is explicitly NOT a
// literature value, and NO parameter value appears as a numeric literal anywhere in `src/application/impact`.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  DEFAULT_IMPACT_PARAMS,
  IMPACT_PARAMETER_IDS,
  assumptionsOf,
  parseImpactParams,
} from './impact-params.js';

const CONFIG = fileURLToPath(new URL('../../../config/impact-params.json', import.meta.url));
const SCHEMA = fileURLToPath(
  new URL('../../../schemas/impact-params.schema.json', import.meta.url),
);
const HERE = fileURLToPath(new URL('.', import.meta.url));

const raw = JSON.parse(readFileSync(CONFIG, 'utf8')) as Record<string, unknown>;
const compile = () =>
  new Ajv2020({ allErrors: true, strict: false }).compile(
    JSON.parse(readFileSync(SCHEMA, 'utf8')) as object,
  );

describe('config/impact-params.json ↔ schemas/impact-params.schema.json', () => {
  it('validates against the published JSON-Schema', () => {
    const validate = compile();
    validate(raw);
    expect(validate.errors ?? [], JSON.stringify(validate.errors, null, 2)).toEqual([]);
  });

  it('the schema is CLOSED: an unknown parameter, a missing citation and an out-of-range fraction all fail', () => {
    const validate = compile();
    const params = raw['parameters'] as Record<string, unknown>;
    expect(
      validate({
        ...raw,
        parameters: {
          ...params,
          madeUpFactor: { value: 1, unit: 'x', label: 'y', citation: 'z', verified: true },
        },
      }),
    ).toBe(false);
    const noCitation = { ...(params['loadingTimeHours'] as Record<string, unknown>) };
    delete noCitation['citation'];
    expect(validate({ ...raw, parameters: { ...params, loadingTimeHours: noCitation } })).toBe(
      false,
    );
    expect(
      validate({
        ...raw,
        parameters: {
          ...params,
          participationFraction: { ...(params['participationFraction'] as object), value: 1.5 },
        },
      }),
    ).toBe(false);
    expect(
      validate({
        ...raw,
        parameters: {
          ...params,
          minReportableCount: { ...(params['minReportableCount'] as object), value: 0 },
        },
      }),
    ).toBe(false);
  });
});

describe('parseImpactParams — fail fast', () => {
  it('rejects every malformed set', () => {
    const cases: readonly [string, unknown][] = [
      ['not an object', 'x'],
      ['null', null],
      ['bad version', { ...raw, version: 2 }],
      ['parameters missing', { ...raw, parameters: undefined }],
      ['unknown parameter', { ...raw, parameters: { ...(raw['parameters'] as object), nope: {} } }],
      ['blank parameterSetId', { ...raw, parameterSetId: '' }],
    ];
    for (const [label, value] of cases)
      expect(() => parseImpactParams(value), label).toThrow(/Invalid config\/impact-params\.json/);
  });

  it('rejects a parameter whose value leaves its documented domain, or whose labelling is incomplete', () => {
    const params = raw['parameters'] as Record<string, unknown>;
    const withParam = (id: string, over: Record<string, unknown>): unknown => ({
      ...raw,
      parameters: { ...params, [id]: { ...(params[id] as object), ...over } },
    });
    expect(() => parseImpactParams(withParam('shelterSeekingFraction', { value: 2 }))).toThrow(
      /must be in \[0,1\]/,
    );
    expect(() => parseImpactParams(withParam('occupantsPerVehicle', { value: 0 }))).toThrow(
      /must be > 0/,
    );
    expect(() => parseImpactParams(withParam('loadingTimeHours', { value: -1 }))).toThrow(
      /must be >= 0/,
    );
    expect(() => parseImpactParams(withParam('loadingTimeHours', { value: Number.NaN }))).toThrow(
      /finite/,
    );
    expect(() => parseImpactParams(withParam('loadingTimeHours', { value: 'x' }))).toThrow(
      /must be a number/,
    );
    expect(() => parseImpactParams(withParam('loadingTimeHours', { citation: '' }))).toThrow(
      /citation/,
    );
    expect(() => parseImpactParams(withParam('loadingTimeHours', { verified: 'yes' }))).toThrow(
      /verified/,
    );
    expect(() =>
      parseImpactParams({ ...raw, parameters: { ...params, loadingTimeHours: 7 } }),
    ).toThrow(/must be an object/);
  });
});

describe('the honesty guards (ADR-035 V7)', () => {
  it('every shipped parameter states its unit, label, citation and verdict', () => {
    for (const id of IMPACT_PARAMETER_IDS) {
      const p = DEFAULT_IMPACT_PARAMS.parameters[id];
      expect(p.unit.length, id).toBeGreaterThan(0);
      expect(p.label.length, id).toBeGreaterThan(0);
      expect(p.citation.length, id).toBeGreaterThan(0);
      expect(typeof p.verified, id).toBe('boolean');
    }
  });

  // The research record flags the exact evacuation-participation percentages as UNVERIFIED
  // (docs/features/DIFFERENTIATORS_RESEARCH.md:82). Shipping this as `verified: true` would be a claim the
  // project cannot support, so the flag AND the wording of the label are both pinned.
  it('participationFraction is NOT a literature value, and its label says so in words', () => {
    const p = DEFAULT_IMPACT_PARAMS.parameters.participationFraction;
    expect(p.verified).toBe(false);
    expect(p.label).toMatch(/NOT a literature value/);
  });

  it('NO shipped value claims to be verified — the honest state of the whole set today', () => {
    const verified = IMPACT_PARAMETER_IDS.filter(
      (id) => DEFAULT_IMPACT_PARAMS.parameters[id].verified,
    );
    expect(verified).toEqual([]);
    expect(DEFAULT_IMPACT_PARAMS.verifiedConvention).toMatch(/UNVERIFIED/);
  });

  // ADR-012: the parameters are DATA. If someone re-hardcodes 0.7 or 500 into a use-case, this fails.
  // The allowlist is the same idea as ADR-035 §4's JUSTIFIED_COLLISIONS: a benign collision is argued in the
  // open, with its reason written here, rather than assumed.
  it('keeps the parameters OUT of the code: no shipped value appears as a literal in src/application/impact', () => {
    const justifiedCollisions: Readonly<Record<string, string>> = {
      'shelter-demand.ts:10':
        'the one-decimal rounding scale in `hours()` (Math.round(n*10)/10) — a presentation constant for HOURS. ' +
        'It collides with minReportableCount, a person-count threshold this module never reads.',
    };
    const files = readdirSync(HERE).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    for (const id of IMPACT_PARAMETER_IDS) {
      const value = String(DEFAULT_IMPACT_PARAMS.parameters[id].value);
      const pattern = new RegExp(`(^|[^\\w.])${value.replace('.', '\\.')}([^\\w.]|$)`);
      for (const file of files) {
        if (justifiedCollisions[`${file}:${value}`] !== undefined) continue;
        const src = readFileSync(`${HERE}${file}`, 'utf8').replace(/^\s*(\/\/|\*|\/\*).*$/gm, ''); // ignore prose
        expect(pattern.test(src), `${id} = ${value} is hardcoded in ${file}`).toBe(false);
      }
    }
  });

  it('assumptionsOf bundles the requested parameters, in order, with their ids', () => {
    const bundle = assumptionsOf(DEFAULT_IMPACT_PARAMS, [
      'loadingTimeHours',
      'participationFraction',
    ]);
    expect(bundle.map((a) => a.id)).toEqual(['loadingTimeHours', 'participationFraction']);
    expect(bundle[0]!.unit).toBe(DEFAULT_IMPACT_PARAMS.parameters.loadingTimeHours.unit);
  });
});
