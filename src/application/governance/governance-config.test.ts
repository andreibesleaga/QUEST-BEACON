// BEACON — governance config tests (MW-D/D4; ADR-012 "config, not code").
// Two layers, the same split as likelihood-config.test.ts / region-registry.schema.test.ts:
//   1. the SHIPPED config file is validated against its JSON-Schema (Ajv 2020-12), so the schema is a live
//      guarantee rather than decoration — a schema nobody validates against is worse than none;
//   2. the hand-written parser is exercised on every rejection path, including the cross-field invariants a
//      JSON-Schema cannot express.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import { DEFAULT_GOVERNANCE_CONFIG, parseGovernanceConfig } from './governance-config.js';

const CONFIG_PATH = './config/governance.json';
const SCHEMA_PATH = './schemas/governance.schema.json';
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8')) as unknown;

describe('config/governance.json ↔ schemas/governance.schema.json', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(readJson(SCHEMA_PATH) as object);

  it('the SHIPPED config validates against the shipped schema', () => {
    const valid = validate(readJson(CONFIG_PATH));
    expect(validate.errors ?? []).toEqual([]);
    expect(valid).toBe(true);
  });

  it('the schema REJECTS a non-approver role — no config can name a role that cannot approve', () => {
    const raw = readJson(CONFIG_PATH) as Record<string, Record<string, unknown>>;
    for (const role of ['PUBLIC', 'RESPONDER']) {
      expect(validate({ ...raw, approval: { ...raw.approval, authorizerRole: role } })).toBe(false);
      expect(validate({ ...raw, approval: { ...raw.approval, fallbackRole: role } })).toBe(false);
    }
  });

  it('the schema REJECTS an auto-approve knob, a zero window and an unknown block', () => {
    const raw = readJson(CONFIG_PATH) as Record<string, Record<string, unknown>>;
    // `additionalProperties: false` is what makes "there is no auto-approve setting" a guarantee.
    expect(validate({ ...raw, approval: { ...raw.approval, autoApproveAfterMinutes: 5 } })).toBe(false);
    expect(validate({ ...raw, approval: { ...raw.approval, fallbackAfterMinutes: 0 } })).toBe(false);
    expect(validate({ ...raw, somethingNew: {} })).toBe(false);
  });

  it('the schema REQUIRES a `basis` on every parameter block (a number must state what grounds it)', () => {
    const raw = readJson(CONFIG_PATH) as Record<string, Record<string, unknown>>;
    for (const block of ['approval', 'retention', 'drill']) {
      const stripped = { ...raw[block] };
      delete stripped.basis;
      expect(validate({ ...raw, [block]: stripped })).toBe(false);
    }
  });

  it('the schema REJECTS a fractional or absurd retention window', () => {
    const raw = readJson(CONFIG_PATH) as Record<string, Record<string, unknown>>;
    expect(validate({ ...raw, retention: { ...raw.retention, publicReportRetentionDays: 30.5 } })).toBe(false);
    expect(validate({ ...raw, retention: { ...raw.retention, publicReportRetentionDays: 0 } })).toBe(false);
    expect(validate({ ...raw, retention: { ...raw.retention, publicReportRetentionDays: 4000 } })).toBe(false);
    expect(validate({ ...raw, retention: { ...raw.retention, sweepGraceMinutes: -1 } })).toBe(false);
  });
});

describe('DEFAULT_GOVERNANCE_CONFIG (parsed at import time — fail fast at boot)', () => {
  it('exposes the shipped SOP chain, retention window and drill default', () => {
    expect(DEFAULT_GOVERNANCE_CONFIG.approval).toEqual({
      authorizerRole: 'EM',
      fallbackRole: 'VERIFIER',
      fallbackAfterMinutes: 30,
    });
    expect(DEFAULT_GOVERNANCE_CONFIG.retention).toEqual({ publicReportRetentionDays: 30, sweepGraceMinutes: 0 });
    expect(DEFAULT_GOVERNANCE_CONFIG.drillMode).toBe('off'); // DRILL_MODE ships off (spec-delta §6)
    expect(DEFAULT_GOVERNANCE_CONFIG.authority.length).toBeGreaterThan(20);
  });

  it('holds NO governance literal in code — the parsed values come from the file', () => {
    const raw = readJson(CONFIG_PATH) as { approval: { fallbackAfterMinutes: number } };
    expect(DEFAULT_GOVERNANCE_CONFIG.approval.fallbackAfterMinutes).toBe(raw.approval.fallbackAfterMinutes);
  });

  it('matches the retention window the report stores already stamp (30 days)', () => {
    // The stores' own default is still a code literal (see the D4 report, F-133): this assertion is what
    // would catch the two drifting apart until that duplication is removed.
    expect(DEFAULT_GOVERNANCE_CONFIG.retention.publicReportRetentionDays).toBe(30);
  });
});

describe('parseGovernanceConfig rejections', () => {
  const valid = readJson(CONFIG_PATH) as Record<string, unknown>;
  const withApproval = (over: Record<string, unknown>): unknown => ({
    ...valid,
    approval: { ...(valid.approval as object), ...over },
  });

  it('rejects a non-object, a wrong version and a blank authority', () => {
    expect(() => parseGovernanceConfig(null)).toThrow(/must contain a JSON object/);
    expect(() => parseGovernanceConfig('nope')).toThrow(/must contain a JSON object/);
    expect(() => parseGovernanceConfig({ ...valid, version: 2 })).toThrow(/version must be 1/);
    expect(() => parseGovernanceConfig({ ...valid, authority: '   ' })).toThrow(/authority/);
  });

  it('rejects a missing block', () => {
    for (const block of ['approval', 'retention', 'drill']) {
      const raw = { ...valid };
      delete raw[block];
      expect(() => parseGovernanceConfig(raw)).toThrow(new RegExp(`${block} must be an object`));
    }
  });

  it('rejects an unknown role, a non-approver role and a missing basis', () => {
    expect(() => parseGovernanceConfig(withApproval({ authorizerRole: 'ADMIN' }))).toThrow(/must be one of/);
    expect(() => parseGovernanceConfig(withApproval({ authorizerRole: 'RESPONDER' }))).toThrow(/approval authority/);
    expect(() => parseGovernanceConfig(withApproval({ fallbackRole: 'PUBLIC' }))).toThrow(/approval authority/);
    expect(() => parseGovernanceConfig(withApproval({ basis: '' }))).toThrow(/approval.basis/);
  });

  it('rejects the cross-field invariants a JSON-Schema cannot express', () => {
    // Self-delegation: schema-valid (both are approver roles) yet a delegation that does nothing.
    expect(() => parseGovernanceConfig(withApproval({ fallbackRole: 'EM' }))).toThrow(/no-op/);
    expect(() => parseGovernanceConfig(withApproval({ fallbackAfterMinutes: 0 }))).toThrow(/positive/);
    expect(() => parseGovernanceConfig(withApproval({ fallbackAfterMinutes: 'soon' }))).toThrow(/positive/);
  });

  it('rejects a bad retention window and a bad drill mode', () => {
    const withRetention = (over: Record<string, unknown>): unknown => ({
      ...valid,
      retention: { ...(valid.retention as object), ...over },
    });
    expect(() => parseGovernanceConfig(withRetention({ publicReportRetentionDays: 0 }))).toThrow(/integer >= 1/);
    expect(() => parseGovernanceConfig(withRetention({ publicReportRetentionDays: 1.5 }))).toThrow(/integer >= 1/);
    expect(() => parseGovernanceConfig(withRetention({ sweepGraceMinutes: -1 }))).toThrow(/integer >= 0/);
    expect(() => parseGovernanceConfig(withRetention({ basis: '' }))).toThrow(/retention.basis/);
    expect(() => parseGovernanceConfig({ ...valid, drill: { mode: 'maybe', basis: 'x'.repeat(30) } })).toThrow(
      /drill.mode/,
    );
    expect(() => parseGovernanceConfig({ ...valid, drill: { mode: 'off', basis: '' } })).toThrow(/drill.basis/);
  });
});
