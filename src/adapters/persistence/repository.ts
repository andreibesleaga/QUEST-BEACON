// BEACON — generic RepositoryPort machinery (E3·T-114/T-116; Art. II anti-corruption).
// A repository is assembled from four typed persistence closures; this module wraps them so a
// failure becomes a typed Result/DomainError and NEVER throws upstream (AGENTS.md §4 error handling).
import type { RepositoryPort } from '@/ports/infra.js';
import type { Result } from '@/domain/shared/result.js';
import { err, ok } from '@/domain/shared/result.js';
import { DomainError } from '@/domain/errors.js';

/** The raw persistence operations a concrete (Drizzle) repository provides for one aggregate. */
export interface RepositoryOps<T, Id extends string> {
  getById(id: Id): Promise<T | null>;
  upsert(entity: T): Promise<T>;
  remove(id: Id): Promise<void>;
  list(filter?: unknown): Promise<readonly T[]>;
}

function pgErrorCode(e: unknown): string | undefined {
  if (typeof e === 'object' && e !== null && 'code' in e) {
    const code = (e as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Map an unknown thrown value (Postgres driver error, mapper InvariantViolation, …) to a DomainError.
 *
 * 42P01 (undefined_table) and 42703 (undefined_column) are SCHEMA faults — the deployment is missing a
 * migration. They used to fall into the default arm and surface as HTTP 400 VALIDATION_ERROR, i.e. the API
 * told the caller it had sent bad data while the truth was that the server had no table to read. That
 * misdirects every operator who looks at the response first, so they are now the server's own fault and
 * surface as 5xx (`statusForError` default). Genuine caller-input faults keep their 4xx codes.
 */
export function toDomainError(e: unknown): DomainError {
  if (e instanceof DomainError) return e; // preserve mapper/factory invariant violations verbatim
  switch (pgErrorCode(e)) {
    case '23505':
      return new DomainError('CONFLICT', `unique violation: ${message(e)}`);
    case '23503':
      return new DomainError('CONFLICT', `foreign key violation: ${message(e)}`);
    case '23514':
    case '23502':
      return new DomainError('INVARIANT_VIOLATION', `constraint violation: ${message(e)}`);
    case '42P01':
    case '42703':
      return new DomainError('INTERNAL_ERROR', `database schema is not migrated: ${message(e)}`);
    default:
      return new DomainError('PARSE_ERROR', `persistence error: ${message(e)}`);
  }
}

/** Run a persistence closure, converting any throw into an `err(DomainError)` (never throws upstream). */
export async function tryResult<T>(fn: () => Promise<T>): Promise<Result<T, DomainError>> {
  try {
    return ok(await fn());
  } catch (e) {
    return err(toDomainError(e));
  }
}

/**
 * Assemble a {@link RepositoryPort} from typed persistence closures. Every method is wrapped so the
 * port contract (Result-returning, non-throwing) holds regardless of the underlying driver's behavior.
 */
export function makeRepository<T, Id extends string = string>(
  ops: RepositoryOps<T, Id>,
): RepositoryPort<T, Id> {
  return {
    getById: (id) => tryResult(() => ops.getById(id)),
    save: (entity) => tryResult(() => ops.upsert(entity)),
    delete: (id) => tryResult<void>(() => ops.remove(id)),
    list: (filter) => tryResult(() => ops.list(filter)),
  };
}
