// BEACON — sustainability endpoint tests (E7·T-342; FR-14/ADR-020/F18). Schema-valid, non-blocking, cached.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { handleSustainability } from './sustainability.js';

const FIXED = '2026-07-05T22:00:00Z';

const schema = JSON.parse(readFileSync('schemas/sustainability-v05.schema.json', 'utf8')) as object;
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

describe('handleSustainability', () => {
  it('returns a 200 modeled report that validates against sustainability-v05.schema.json', () => {
    const res = handleSustainability(() => FIXED);
    expect(res.status).toBe(200);
    expect(validate(res.body)).toBe(true);
  });

  it('publishes modeled/estimated figures with a methodology-uri (ADR-020)', () => {
    const body = handleSustainability(() => FIXED).body as Record<string, unknown>;
    expect(body['measurement-method']).toBe('third-party-modeled');
    expect(body['methodology-uri']).toBe('docs/SUSTAINABILITY.md');
    expect(body.updated).toBe(FIXED);
  });

  it('sets cache headers + ETag (heavily cached, no per-request overhead)', () => {
    const res = handleSustainability(() => FIXED);
    expect(res.headers['cache-control']).toContain('max-age');
    expect(res.headers.etag).toContain('W/');
  });

  it('reads provider, method and methodology link from the SUSTAINABILITY_* settings (2026-11-21)', () => {
    // Documented since the endpoint shipped, and read by nothing until now.
    const res = handleSustainability(() => FIXED, {
      SUSTAINABILITY_PROVIDER: 'County EOC (ops@example.org)',
      SUSTAINABILITY_MEASUREMENT_METHOD: 'cloud-billing',
      SUSTAINABILITY_METHODOLOGY_URI: 'https://example.org/methodology',
    });
    const body = res.body as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body.provider).toBe('County EOC (ops@example.org)');
    expect(body['measurement-method']).toBe('cloud-billing');
    expect(body['methodology-uri']).toBe('https://example.org/methodology');
    expect(validate(body)).toBe(true);
  });

  it('an unset or blank setting keeps the value the endpoint always served', () => {
    const plain = handleSustainability(() => FIXED).body;
    const blank = handleSustainability(() => FIXED, {
      SUSTAINABILITY_PROVIDER: '  ',
      SUSTAINABILITY_METHODOLOGY_URI: '',
    }).body;
    expect(blank).toEqual(plain);
  });

  it('SUSTAINABILITY_ENABLED=off switches the endpoint off (404); anything else leaves it on', () => {
    expect(handleSustainability(() => FIXED, { SUSTAINABILITY_ENABLED: 'off' }).status).toBe(404);
    expect(handleSustainability(() => FIXED, { SUSTAINABILITY_ENABLED: 'on' }).status).toBe(200);
    expect(handleSustainability(() => FIXED, {}).status).toBe(200);
  });
});
