// BEACON — domain error taxonomy (E1·T-043/T-044). Discriminated by `code`; pure (F9).
export type DomainErrorCode =
  | 'INVARIANT_VIOLATION'
  | 'INVALID_TRANSITION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PARSE_ERROR'
  | 'UNAUTHORIZED' // role lacks the required rank for a command (RBAC, every channel — ADR-023/Art.XIII)
  // The fault is OURS, not the caller's: infrastructure the request had no way to influence (a missing
  // migration, an unreachable dependency). It exists because every other code accuses the client of
  // something, and mapping a server fault onto one of those tells the operator to go look in the wrong
  // place. Channels map it to 5xx via their `default` arm (error-mapping.ts) — a 4xx for a broken
  // deployment is a lie the monitoring believes.
  | 'INTERNAL_ERROR';

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}
export class InvariantViolation extends DomainError {
  constructor(message: string) {
    super('INVARIANT_VIOLATION', message);
    this.name = 'InvariantViolation';
  }
}
export class InvalidTransition extends DomainError {
  constructor(message: string) {
    super('INVALID_TRANSITION', message);
    this.name = 'InvalidTransition';
  }
}
export class Unauthorized extends DomainError {
  constructor(message: string) {
    super('UNAUTHORIZED', message);
    this.name = 'Unauthorized';
  }
}
