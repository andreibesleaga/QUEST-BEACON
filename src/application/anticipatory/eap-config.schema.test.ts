// BEACON — config/eap/*.json ↔ schemas/eap.schema.json pin (D2; ADR-034 §1, V1/V2).
//
// Two jobs, exactly as `likelihood-config.test.ts` does for the threshold table:
//   (1) EVERY shipped EAP validates against the published JSON-Schema — a hand edit that breaks the contract
//       fails a test instead of silently reshaping when people get moved;
//   (2) the schema is CLOSED where it matters: `stop` is required, unknown properties are rejected, and no
//       string field can carry an expression, a template, a path or a URL (data-not-code, enforced).
// No live network, no clock, no filesystem writes.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import { SHIPPED_EAPS } from './eap-config.js';

const CONFIG_DIR = fileURLToPath(new URL('../../../config/eap/', import.meta.url));
const SCHEMA = fileURLToPath(new URL('../../../schemas/eap.schema.json', import.meta.url));
const APPLICATION_DIR = fileURLToPath(new URL('./', import.meta.url));

const files = readdirSync(CONFIG_DIR).filter((f) => f.endsWith('.json')).sort();
const read = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(`${CONFIG_DIR}${file}`, 'utf8')) as Record<string, unknown>;

// Compiled ONCE: Ajv compilation is the expensive step, and a validate function is stateless apart from
// `.errors`, which every assertion below reads immediately after its own call.
const VALIDATE: ValidateFunction = new Ajv2020({ allErrors: true, strict: false }).compile(
  JSON.parse(readFileSync(SCHEMA, 'utf8')) as object,
);
const validator = (): ValidateFunction => VALIDATE;

describe('every shipped EAP validates against schemas/eap.schema.json', () => {
  it('ships at least one protocol per locked demo zone, and the parser loaded them all', () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
    expect(SHIPPED_EAPS.length).toBe(files.length);
    expect(SHIPPED_EAPS.map((e) => e.scope.regionId).sort()).toEqual(['es', 'gr', 'ph', 'ro', 'us-ca']);
  });

  it.each(files)('%s is schema-valid', (file) => {
    const validate = validator();
    validate(read(file));
    expect(validate.errors ?? [], JSON.stringify(validate.errors, null, 2)).toEqual([]);
  });

  it.each(files)('%s declares itself illustrative and endorsed by nobody', (file) => {
    const raw = read(file);
    expect(raw['status']).toBe('ILLUSTRATIVE');
    expect(String(raw['provenance'])).toMatch(/NOT approved/);
  });
});

describe('the schema is closed where it matters', () => {
  const base = (): Record<string, unknown> => read(files[0] as string);

  it('REJECTS a protocol with no stop block — an EAP that cannot be stopped is the dangerous case', () => {
    const validate = validator();
    const withoutStop = base();
    delete withoutStop['stop'];
    expect(validate(withoutStop)).toBe(false);
    expect(JSON.stringify(validate.errors)).toContain('stop');
  });

  it.each(['conditions', 'authorizerRole', 'maxDurationHours'])('rejects a stop block missing %s', (field) => {
    const raw = base();
    const stop = { ...(raw['stop'] as Record<string, unknown>) };
    delete stop[field];
    expect(validator()({ ...raw, stop })).toBe(false);
  });

  it('rejects an empty stop-condition list', () => {
    const raw = base();
    expect(validator()({ ...raw, stop: { ...(raw['stop'] as object), conditions: [] } })).toBe(false);
  });

  it.each([
    'version',
    'id',
    'label',
    'hazard',
    'status',
    'provenance',
    'scope',
    'triggers',
    'actions',
    'resourceCeiling',
    'approval',
  ])('rejects a protocol missing the required element %s', (field) => {
    const raw = base();
    delete raw[field];
    expect(validator()(raw)).toBe(false);
  });

  it('rejects an unknown property at every level (additionalProperties:false)', () => {
    const raw = base();
    expect(validator()({ ...raw, autoDispatch: true })).toBe(false);
    expect(validator()({ ...raw, stop: { ...(raw['stop'] as object), overrideRole: 'PUBLIC' } })).toBe(false);
    expect(validator()({ ...raw, approval: { ...(raw['approval'] as object), autoApproveAfterMinutes: 5 } })).toBe(false);
    expect(
      validator()({ ...raw, resourceCeiling: { ...(raw['resourceCeiling'] as object), currency: 'EUR', budget: 1000 } }),
    ).toBe(false);
  });

  it('rejects a role that cannot approve (PUBLIC/RESPONDER are not in the enum)', () => {
    const raw = base();
    for (const role of ['PUBLIC', 'RESPONDER', 'ADMIN']) {
      expect(validator()({ ...raw, approval: { ...(raw['approval'] as object), authorizerRole: role } })).toBe(false);
      expect(validator()({ ...raw, stop: { ...(raw['stop'] as object), authorizerRole: role } })).toBe(false);
    }
  });

  it('rejects a scope geometry that is not a closed-area Polygon, and admits no geometryRef indirection', () => {
    const raw = base();
    const scope = raw['scope'] as Record<string, unknown>;
    expect(validator()({ ...raw, scope: { ...scope, geometry: { type: 'Point', coordinates: [0, 0] } } })).toBe(false);
    expect(validator()({ ...raw, scope: { ...scope, geometryRef: 'config/eap/geom.json' } })).toBe(false);
  });

  it('admits NO expression, template, path or URL in any string field (data-not-code)', () => {
    const raw = base();
    const payloads = [
      '${process.env.HOME}',
      '`rm -rf /`',
      '../../etc/passwd',
      'https://example.test/eap.json',
      '<script>x</script>',
      'a = b | c',
    ];
    for (const payload of payloads) {
      expect(validator()({ ...raw, label: payload }), payload).toBe(false);
      expect(validator()({ ...raw, provenance: `${payload} NOT approved by anyone at all whatsoever indeed` }), payload).toBe(
        false,
      );
    }
  });

  it('rejects an id that could be read as a path segment', () => {
    const raw = base();
    for (const id of ['../ro', 'ro/flood', 'RO-FLOOD', 'ro flood', '/ro']) {
      expect(validator()({ ...raw, id }), id).toBe(false);
    }
  });

  it('rejects a trigger stage missing either magnitude gate', () => {
    const raw = base();
    const triggers = raw['triggers'] as Record<string, Record<string, unknown>>;
    for (const field of ['minMembersFraction', 'minLikelihoodClass', 'leadTimeHours', 'threshold', 'comparator']) {
      const readiness = { ...triggers['readiness'] };
      delete readiness[field];
      expect(validator()({ ...raw, triggers: { ...triggers, readiness } }), field).toBe(false);
    }
  });

  it('rejects a member fraction outside [0,1] and a non-positive lead time', () => {
    const raw = base();
    const triggers = raw['triggers'] as Record<string, Record<string, unknown>>;
    expect(validator()({ ...raw, triggers: { ...triggers, readiness: { ...triggers['readiness'], minMembersFraction: 1.5 } } })).toBe(false);
    expect(validator()({ ...raw, triggers: { ...triggers, readiness: { ...triggers['readiness'], leadTimeHours: 0 } } })).toBe(false);
  });
});

describe('the use-case contains no code-execution seam and no threshold literal (V2)', () => {
  const sources = readdirSync(APPLICATION_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => ({ file: f, text: readFileSync(`${APPLICATION_DIR}${f}`, 'utf8') }));

  it.each(sources.map((s) => s.file))('%s contains no eval, Function constructor or dynamic import', (file) => {
    const text = sources.find((s) => s.file === file)?.text ?? '';
    expect(text).not.toMatch(/\beval\s*\(/);
    expect(text).not.toMatch(/new\s+Function\s*\(/);
    expect(text).not.toMatch(/\bimport\s*\(/);
    expect(text).not.toMatch(/require\s*\(/);
  });

  it('holds no EAP threshold, member fraction or duration literal (ADR-012: they are all data)', () => {
    const code = sources
      .map((s) => s.text)
      .join('\n')
      .replace(/^\s*(\/\/|\*|\/\*).*$/gm, ''); // ignore prose in comments
    for (const literal of ['6500', '7200', '0.35', '0.55', '168', '120']) {
      expect(code, literal).not.toContain(literal);
    }
  });
});
