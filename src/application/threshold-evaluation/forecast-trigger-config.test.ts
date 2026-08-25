// BEACON — forecast-crossing trigger-gate config tests (C2.4; ADR-033 §6, ADR-012).
//
// Two jobs, exactly as likelihood-config.test.ts does for the likelihood table: (1) the SHIPPED
// config/forecast-trigger.json validates against its published JSON-Schema, so a hand edit that breaks the
// contract fails a test rather than silently changing when responders get an anticipatory DRAFT; (2) the
// fail-fast parser rejects every malformed table, including the property JSON-Schema cannot express (a
// non-empty lead-time window). No live network, no clock, no filesystem writes.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  DEFAULT_FORECAST_TRIGGER_CONFIG,
  parseForecastTriggerConfig,
} from './forecast-trigger-config.js';

const CONFIG = fileURLToPath(new URL('../../../config/forecast-trigger.json', import.meta.url));
const SCHEMA = fileURLToPath(new URL('../../../schemas/forecast-trigger.schema.json', import.meta.url));

const raw = JSON.parse(readFileSync(CONFIG, 'utf8')) as Record<string, unknown>;
const schema = JSON.parse(readFileSync(SCHEMA, 'utf8')) as object;
const compile = (): ReturnType<Ajv2020['compile']> =>
  new Ajv2020({ allErrors: true, strict: false }).compile(schema);

/** A minimal VALID table, used as the base every rejection case mutates one field of. */
function validTable(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    authority: 'a sufficiently long authority string for the schema minLength',
    firePolicy: 'a sufficiently long fire-policy string for the schema minLength',
    leadTime: { minHours: 0, maxHours: 48, basis: 'a sufficiently long basis string for the schema' },
    vintage: { maxForecastAgeHours: 24, basis: 'a sufficiently long basis string for the schema' },
    ...over,
  };
}

describe('config/forecast-trigger.json ↔ schemas/forecast-trigger.schema.json', () => {
  it('validates against the published JSON-Schema', () => {
    const validate = compile();
    validate(raw);
    expect(validate.errors ?? [], JSON.stringify(validate.errors, null, 2)).toEqual([]);
  });

  it('rejects an unknown top-level key, an unknown likelihood class and a negative lead time', () => {
    const validate = compile();
    expect(validate({ ...raw, invented: true })).toBe(false);
    expect(validate({ ...raw, minLikelihood: { class: 'CERTAIN', basis: 'x'.repeat(30) } })).toBe(false);
    expect(validate(validTable({ leadTime: { minHours: -1, maxHours: 48, basis: 'x'.repeat(30) } }))).toBe(
      false,
    );
  });

  it('requires a `basis` on every gate — a number cannot be added here without saying what grounds it', () => {
    const validate = compile();
    expect(validate(validTable({ vintage: { maxForecastAgeHours: 24 } }))).toBe(false);
    expect(validate(validTable({ leadTime: { minHours: 0, maxHours: 48 } }))).toBe(false);
    expect(validate({ ...raw, minLikelihood: { class: 'LIKELY' } })).toBe(false);
  });

  it('keeps the gates OUT of the code: no gate value appears as a literal in the evaluator', () => {
    // ADR-012: the gates are data. If someone re-hardcodes 168/24/LIKELY into the use-case this fails.
    const engine = readFileSync(
      fileURLToPath(new URL('./threshold-evaluation.ts', import.meta.url)),
      'utf8',
    ).replace(/^\s*(\/\/|\*|\/\*).*$/gm, ''); // ignore prose in comments
    expect(engine).not.toMatch(/\b168\b/);
    expect(engine).not.toMatch(/\b24\b/);
    expect(engine).not.toMatch(/'LIKELY'/);
  });
});

describe('DEFAULT_FORECAST_TRIGGER_CONFIG (the shipped table, parsed at import time)', () => {
  it('exposes the shipped gates with their prose bases intact', () => {
    const cfg = DEFAULT_FORECAST_TRIGGER_CONFIG;
    expect(cfg.version).toBe(1);
    expect(cfg.minLikelihood?.class).toBe('LIKELY');
    expect(cfg.leadTime.minHours).toBe(0);
    expect(cfg.leadTime.maxHours).toBe(168);
    expect(cfg.vintage.maxForecastAgeHours).toBe(24);
    // Every gate states its own grounding — that is the schema's requirement made observable.
    expect(cfg.minLikelihood?.basis.length).toBeGreaterThan(20);
    expect(cfg.leadTime.basis.length).toBeGreaterThan(20);
    expect(cfg.vintage.basis.length).toBeGreaterThan(20);
    expect(cfg.authority).toContain('ADR-033');
    // Art. XIII is stated in the config itself, not only in the code that reads it.
    expect(cfg.firePolicy).toContain('DRAFT');
  });

  it('parses the shipped file to exactly the same value (no import-time mutation)', () => {
    expect(parseForecastTriggerConfig(raw)).toEqual(DEFAULT_FORECAST_TRIGGER_CONFIG);
  });
});

describe('parseForecastTriggerConfig — fail fast on a malformed table', () => {
  it('rejects a non-object and an unsupported version', () => {
    expect(() => parseForecastTriggerConfig(null)).toThrow(/must contain a JSON object/);
    expect(() => parseForecastTriggerConfig('nope')).toThrow(/must contain a JSON object/);
    expect(() => parseForecastTriggerConfig(validTable({ version: 2 }))).toThrow(/version must be 1/);
  });

  it('rejects missing/blank prose', () => {
    expect(() => parseForecastTriggerConfig(validTable({ authority: '   ' }))).toThrow(/authority/);
    expect(() => parseForecastTriggerConfig(validTable({ firePolicy: 42 }))).toThrow(/firePolicy/);
  });

  it('rejects a malformed minLikelihood gate but accepts its ABSENCE (the gate is optional)', () => {
    expect(() => parseForecastTriggerConfig(validTable({ minLikelihood: 'LIKELY' }))).toThrow(
      /minLikelihood must be an object/,
    );
    expect(() =>
      parseForecastTriggerConfig(validTable({ minLikelihood: { class: 'CERTAIN', basis: 'x'.repeat(30) } })),
    ).toThrow(/minLikelihood.class must be one of/);
    expect(() =>
      parseForecastTriggerConfig(validTable({ minLikelihood: { class: 'LIKELY' } })),
    ).toThrow(/minLikelihood.basis/);
    // Absent ⇒ parsed away entirely, so the evaluator's likelihood gate is simply not applied.
    expect(parseForecastTriggerConfig(validTable()).minLikelihood).toBeUndefined();
  });

  it('rejects a malformed or inverted lead-time window (the property no JSON-Schema can state)', () => {
    expect(() => parseForecastTriggerConfig(validTable({ leadTime: null }))).toThrow(
      /leadTime must be an object/,
    );
    expect(() =>
      parseForecastTriggerConfig(validTable({ leadTime: { minHours: -1, maxHours: 48, basis: 'x'.repeat(30) } })),
    ).toThrow(/leadTime.minHours/);
    expect(() =>
      parseForecastTriggerConfig(
        validTable({ leadTime: { minHours: 0, maxHours: Number.POSITIVE_INFINITY, basis: 'x'.repeat(30) } }),
      ),
    ).toThrow(/leadTime.maxHours/);
    expect(() =>
      parseForecastTriggerConfig(validTable({ leadTime: { minHours: 0, maxHours: 0, basis: 'x'.repeat(30) } })),
    ).toThrow(/leadTime window must be non-empty/);
    expect(() =>
      parseForecastTriggerConfig(validTable({ leadTime: { minHours: 72, maxHours: 48, basis: 'x'.repeat(30) } })),
    ).toThrow(/leadTime window must be non-empty/);
    expect(() =>
      parseForecastTriggerConfig(validTable({ leadTime: { minHours: 0, maxHours: 48, basis: '' } })),
    ).toThrow(/leadTime.basis/);
  });

  it('rejects a malformed vintage window', () => {
    expect(() => parseForecastTriggerConfig(validTable({ vintage: undefined }))).toThrow(
      /vintage must be an object/,
    );
    expect(() =>
      parseForecastTriggerConfig(validTable({ vintage: { maxForecastAgeHours: '24', basis: 'x'.repeat(30) } })),
    ).toThrow(/vintage.maxForecastAgeHours/);
    expect(() =>
      parseForecastTriggerConfig(validTable({ vintage: { maxForecastAgeHours: 0, basis: 'x'.repeat(30) } })),
    ).toThrow(/vintage.maxForecastAgeHours must be greater than 0/);
    expect(() =>
      parseForecastTriggerConfig(validTable({ vintage: { maxForecastAgeHours: 24, basis: 5 } })),
    ).toThrow(/vintage.basis/);
  });
});
