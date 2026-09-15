// BEACON — interop schema validator (E7 interop ACL; ADR-010). Memoized Ajv draft 2020-12 compilation,
// matching the E4/E6 posture (`ajv/dist/2020.js` + ajv-formats, strict:false). Every boundary
// serialization emitted by this layer is validated against its JSON-Schema before it is returned as ok,
// so a malformed CAP/EDXL/GeoJSON document can never leak upward (validate-before-emit, ADR-010).
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { ValidateFunction } from 'ajv';

const byKey = new Map<string, ValidateFunction>();

/** Compile (once) a validator for an in-memory schema object, memoized by a stable key. */
export function validatorForSchema(key: string, schema: object): ValidateFunction {
  const cached = byKey.get(key);
  if (cached) return cached;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  byKey.set(key, validate);
  return validate;
}

/** Compile (once) a validator for a JSON-Schema file on disk (path relative to cwd, as E4 does). */
export function validatorForFile(schemaPath: string): ValidateFunction {
  const cached = byKey.get(schemaPath);
  if (cached) return cached;
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as object;
  return validatorForSchema(schemaPath, schema);
}

/** Human-readable join of the last validation errors (for typed error messages). */
export function formatErrors(validate: ValidateFunction): string {
  return (validate.errors ?? [])
    .map((e) => `${e.instancePath || '(root)'} ${e.message ?? ''}`.trim())
    .join('; ');
}
