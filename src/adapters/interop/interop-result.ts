// BEACON — interop ACL result helpers (E7 interop; ADR-001/ADR-010). Mappers return a typed
// Result<T, DomainError>; a schema/validation failure surfaces as a typed PARSE_ERROR (never a raw throw
// or a leaked format), and a guardrail breach (e.g. ACTUAL without approver) as CONFLICT.
import { DomainError } from '@/domain/errors.js';
import type { Result } from '@/domain/shared/result.js';
import { ok, err } from '@/domain/shared/result.js';
import { formatErrors, validatorForFile, validatorForSchema } from './schema-validator.js';

/** Typed PARSE_ERROR for a mapping/validation failure at the interop boundary. */
export function parseErr<T>(message: string): Result<T, DomainError> {
  return err(new DomainError('PARSE_ERROR', message));
}

/** Typed CONFLICT for a guardrail breach (Art. XIII validate-before-emit). */
export function conflictErr<T>(message: string): Result<T, DomainError> {
  return err(new DomainError('CONFLICT', message));
}

/** Validate `doc` against a schema FILE; return ok(doc) or a typed PARSE_ERROR with the reasons. */
export function validatedByFile<T>(
  kind: string,
  schemaPath: string,
  doc: T,
): Result<T, DomainError> {
  const validate = validatorForFile(schemaPath);
  if (!validate(doc))
    return parseErr(`${kind} failed ${schemaPath} validation: ${formatErrors(validate)}`);
  return ok(doc);
}

/** Validate `doc` against an in-memory schema; return ok(doc) or a typed PARSE_ERROR. */
export function validatedBySchema<T>(
  kind: string,
  key: string,
  schema: object,
  doc: T,
): Result<T, DomainError> {
  const validate = validatorForSchema(key, schema);
  if (!validate(doc))
    return parseErr(`${kind} failed ${key} validation: ${formatErrors(validate)}`);
  return ok(doc);
}
