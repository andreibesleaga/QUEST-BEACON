// BEACON — trend-projection parameter-table tests (C2.2; ADR-033 §4.1/§4.2, ADR-012).
//
// Two jobs, exactly as `likelihood-config.test.ts` (C1.2) and `forecast-trigger-config.test.ts` (C2.4) do for
// their tables: (1) the SHIPPED config/trend-projection.json validates against its published JSON-Schema, so a
// hand edit that breaks the contract fails a test rather than silently relabelling every projection a
// responder reads; (2) the fail-fast parser rejects every malformed table, including the property a
// JSON-Schema cannot express (strictly ascending horizon checkpoints). No live network, no clock, no writes.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { DEFAULT_TREND_CONFIG } from '@/application/shared/config.js';
import { DEFAULT_TREND_PROJECTION_CONFIG, parseTrendProjectionConfig } from './trend-projection-config.js';

const CONFIG = fileURLToPath(new URL('../../../config/trend-projection.json', import.meta.url));
const SCHEMA = fileURLToPath(new URL('../../../schemas/trend-projection.schema.json', import.meta.url));

const raw = JSON.parse(readFileSync(CONFIG, 'utf8')) as Record<string, unknown>;
const schema = JSON.parse(readFileSync(SCHEMA, 'utf8')) as object;
const compile = (): ReturnType<Ajv2020['compile']> =>
  new Ajv2020({ allErrors: true, strict: false }).compile(schema);

const PROSE = 'a sufficiently long basis string for the schema minLength';

/** A minimal VALID table, used as the base every rejection case mutates one field of. */
function validTable(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    authority: PROSE,
    escalation: { referenceSamples: 6, baseUncertainty: 0.4, uncertaintyPerMissingSample: 0.1, basis: PROSE },
    impactOverTime: { checkpointHours: [6, 12, 24], baseUncertainty: 0.4, uncertaintyPerHour: 0.02, basis: PROSE },
    ...over,
  };
}

describe('config/trend-projection.json ↔ schemas/trend-projection.schema.json', () => {
  it('validates against the published JSON-Schema', () => {
    const validate = compile();
    validate(raw);
    expect(validate.errors ?? [], JSON.stringify(validate.errors, null, 2)).toEqual([]);
  });

  it('rejects an unknown key, an out-of-range uncertainty and a non-positive checkpoint', () => {
    const validate = compile();
    expect(validate({ ...raw, invented: true })).toBe(false);
    expect(validate(validTable({ escalation: { referenceSamples: 6, baseUncertainty: 1.4, uncertaintyPerMissingSample: 0.1, basis: PROSE } }))).toBe(false);
    expect(validate(validTable({ impactOverTime: { checkpointHours: [0], baseUncertainty: 0.4, uncertaintyPerHour: 0.02, basis: PROSE } }))).toBe(false);
    expect(validate(validTable({ impactOverTime: { checkpointHours: [], baseUncertainty: 0.4, uncertaintyPerHour: 0.02, basis: PROSE } }))).toBe(false);
  });

  it('requires a `basis` on every block — a number cannot be added here without saying what grounds it', () => {
    const validate = compile();
    expect(validate(validTable({ escalation: { referenceSamples: 6, baseUncertainty: 0.4, uncertaintyPerMissingSample: 0.1 } }))).toBe(false);
    expect(validate(validTable({ impactOverTime: { checkpointHours: [6], baseUncertainty: 0.4, uncertaintyPerHour: 0.02 } }))).toBe(false);
  });

  it('keeps the parameters OUT of the code: no shipped value appears as a literal in the projectors', () => {
    // ADR-012: the curves are data. If someone re-hardcodes 0.4/0.02/6/12/24 into the use-case this fails.
    const projector = readFileSync(
      fileURLToPath(new URL('./trend-projection.ts', import.meta.url)),
      'utf8',
    ).replace(/^\s*(\/\/|\*|\/\*).*$/gm, ''); // ignore prose in comments
    for (const literal of ['0.4', '0.02', '0.1']) expect(projector).not.toContain(literal);
    expect(projector).not.toMatch(/\breferenceSamples\s*[:=]\s*\d/);
    expect(projector).not.toMatch(/checkpointHours\s*[:=]\s*\[/);
  });
});

describe('DEFAULT_TREND_PROJECTION_CONFIG (the shipped table, parsed at import time)', () => {
  it('exposes the shipped curves with their prose bases intact', () => {
    const cfg = DEFAULT_TREND_PROJECTION_CONFIG;
    expect(cfg.version).toBe(1);
    expect(cfg.escalation.referenceSamples).toBe(6);
    expect(cfg.escalation.baseUncertainty).toBe(0.4);
    expect(cfg.escalation.uncertaintyPerMissingSample).toBe(0.1);
    expect([...cfg.impactOverTime.checkpointHours]).toEqual([6, 12, 24]);
    expect(cfg.impactOverTime.baseUncertainty).toBe(0.4);
    expect(cfg.impactOverTime.uncertaintyPerHour).toBe(0.02);
    // Every block states its own grounding — the schema's requirement made observable.
    expect(cfg.escalation.basis.length).toBeGreaterThan(20);
    expect(cfg.impactOverTime.basis.length).toBeGreaterThan(20);
    expect(cfg.authority).toContain('ADR-033');
  });

  it('the escalation reference count is anchored to the trend classifier\'s own minimum, not a free number', () => {
    // The basis prose claims "twice the classifier's minimum" — pin it, so the two cannot drift apart.
    expect(DEFAULT_TREND_PROJECTION_CONFIG.escalation.referenceSamples).toBe(2 * DEFAULT_TREND_CONFIG.minSamples);
    expect(DEFAULT_TREND_PROJECTION_CONFIG.escalation.basis).toContain('minSamples');
  });

  it('states the honest limitation: an uncertainty label is not a probability of occurrence (F-34)', () => {
    expect(DEFAULT_TREND_PROJECTION_CONFIG.authority).toContain('probability of occurrence');
  });

  it('parses the shipped file to exactly the same value (no import-time mutation)', () => {
    expect(parseTrendProjectionConfig(raw)).toEqual(DEFAULT_TREND_PROJECTION_CONFIG);
  });
});

describe('parseTrendProjectionConfig — fail fast on a malformed table', () => {
  it('rejects a non-object and an unsupported version', () => {
    expect(() => parseTrendProjectionConfig(null)).toThrow(/must contain a JSON object/);
    expect(() => parseTrendProjectionConfig('nope')).toThrow(/must contain a JSON object/);
    expect(() => parseTrendProjectionConfig(validTable({ version: 2 }))).toThrow(/version must be 1/);
  });

  it('rejects missing/blank prose', () => {
    expect(() => parseTrendProjectionConfig(validTable({ authority: '   ' }))).toThrow(/authority/);
    expect(() =>
      parseTrendProjectionConfig(validTable({ escalation: { referenceSamples: 6, baseUncertainty: 0.4, uncertaintyPerMissingSample: 0.1, basis: 7 } })),
    ).toThrow(/escalation.basis/);
    expect(() =>
      parseTrendProjectionConfig(validTable({ impactOverTime: { checkpointHours: [6], baseUncertainty: 0.4, uncertaintyPerHour: 0.02 } })),
    ).toThrow(/impactOverTime.basis/);
  });

  it('rejects a malformed escalation block', () => {
    expect(() => parseTrendProjectionConfig(validTable({ escalation: 'sparse' }))).toThrow(
      /escalation must be an object/,
    );
    expect(() =>
      parseTrendProjectionConfig(validTable({ escalation: { referenceSamples: 2.5, baseUncertainty: 0.4, uncertaintyPerMissingSample: 0.1, basis: PROSE } })),
    ).toThrow(/escalation.referenceSamples must be an integer >= 1/);
    expect(() =>
      parseTrendProjectionConfig(validTable({ escalation: { referenceSamples: 0, baseUncertainty: 0.4, uncertaintyPerMissingSample: 0.1, basis: PROSE } })),
    ).toThrow(/escalation.referenceSamples/);
    expect(() =>
      parseTrendProjectionConfig(validTable({ escalation: { referenceSamples: 6, baseUncertainty: 2, uncertaintyPerMissingSample: 0.1, basis: PROSE } })),
    ).toThrow(/escalation.baseUncertainty must be a number in \[0,1\]/);
    expect(() =>
      parseTrendProjectionConfig(validTable({ escalation: { referenceSamples: 6, baseUncertainty: 0.4, uncertaintyPerMissingSample: '0.1', basis: PROSE } })),
    ).toThrow(/escalation.uncertaintyPerMissingSample/);
  });

  it('rejects a malformed impactOverTime block', () => {
    expect(() => parseTrendProjectionConfig(validTable({ impactOverTime: null }))).toThrow(
      /impactOverTime must be an object/,
    );
    expect(() =>
      parseTrendProjectionConfig(validTable({ impactOverTime: { checkpointHours: [6, 12], baseUncertainty: 0.4, uncertaintyPerHour: 1.2, basis: PROSE } })),
    ).toThrow(/impactOverTime.uncertaintyPerHour/);
    expect(() =>
      parseTrendProjectionConfig(validTable({ impactOverTime: { checkpointHours: [6], baseUncertainty: '0.4', uncertaintyPerHour: 0.02, basis: PROSE } })),
    ).toThrow(/impactOverTime.baseUncertainty/);
  });

  it('rejects checkpoints that are absent, empty, non-numeric, non-positive or NOT strictly ascending', () => {
    const withCheckpoints = (checkpointHours: unknown): Record<string, unknown> =>
      validTable({ impactOverTime: { checkpointHours, baseUncertainty: 0.4, uncertaintyPerHour: 0.02, basis: PROSE } });
    expect(() => parseTrendProjectionConfig(withCheckpoints(undefined))).toThrow(/must be a non-empty array/);
    expect(() => parseTrendProjectionConfig(withCheckpoints([]))).toThrow(/must be a non-empty array/);
    expect(() => parseTrendProjectionConfig(withCheckpoints(['6']))).toThrow(/checkpointHours\[0\]/);
    expect(() => parseTrendProjectionConfig(withCheckpoints([0]))).toThrow(/checkpointHours\[0\]/);
    expect(() => parseTrendProjectionConfig(withCheckpoints([6, Number.POSITIVE_INFINITY]))).toThrow(
      /checkpointHours\[1\]/,
    );
    // The property no JSON-Schema can state: descending or repeated horizons would mislabel the worst case.
    expect(() => parseTrendProjectionConfig(withCheckpoints([24, 6]))).toThrow(/must strictly ascend/);
    expect(() => parseTrendProjectionConfig(withCheckpoints([6, 6]))).toThrow(/must strictly ascend/);
  });
});
