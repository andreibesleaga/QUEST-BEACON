// BEACON — DomainError → HTTP status + public API-code mapping (E7·T-315; SPEC §2.3/§2.6/§196). The ONE
// place channel-level HTTP semantics meet the core's typed errors. Two translations happen here so the
// public API stays faithful to its own contract:
//   • DomainError.code → HTTP status (SPEC §2.3)
//   • the INTERNAL domain vocabulary → the PUBLIC, stable API error vocabulary (SPEC §196)
// A stack or internal message is NEVER leaked beyond {code, message} (SECURITY_BASELINE, Art. IV).
import type { DomainError, DomainErrorCode } from '@/domain/errors.js';
import type { Envelope, EnvelopeError } from '@/ports/interaction.js';

/** DomainError.code → HTTP status (SPEC §2.3). Unknown codes fall back to 500 (never leak detail). */
export function statusForError(code: DomainErrorCode): number {
  switch (code) {
    case 'NOT_FOUND':
      return 404;
    case 'UNAUTHORIZED':
      return 403;
    case 'PARSE_ERROR':
      return 400;
    case 'CONFLICT':
    case 'INVALID_TRANSITION':
      return 409;
    case 'INVARIANT_VIOLATION':
      return 422;
    default:
      return 500;
  }
}

/**
 * Internal domain code → the stable, machine-readable PUBLIC API code (SPEC §196). The domain vocabulary
 * (INVARIANT_VIOLATION / PARSE_ERROR / UNAUTHORIZED …) never leaks onto the wire; clients see the
 * documented API codes. Domain `UNAUTHORIZED` (authenticated-but-wrong-rank) is the SPEC's `FORBIDDEN` (403).
 */
export function apiCodeForError(code: DomainErrorCode): string {
  switch (code) {
    case 'NOT_FOUND':
      return 'NOT_FOUND';
    case 'UNAUTHORIZED':
      return 'FORBIDDEN';
    case 'PARSE_ERROR':
    case 'INVARIANT_VIOLATION':
      return 'VALIDATION_ERROR';
    case 'CONFLICT':
    case 'INVALID_TRANSITION':
      return 'STATE_CONFLICT';
    default:
      return 'INTERNAL_ERROR';
  }
}

/** Error envelope for a typed DomainError, carrying the PUBLIC API code (SPEC §196), never the domain code. */
export function apiErrorEnvelope(error: DomainError): Envelope<null> {
  return channelErrorEnvelope(apiCodeForError(error.code), error.message);
}

/** A minimal error envelope for channel failures (rate-limit, malformed body). `code` is a SPEC §196 code. */
export function channelErrorEnvelope(code: string, message: string): Envelope<null> {
  const error: EnvelopeError = { code, message };
  return { data: null, provenance: [], errors: [error] };
}
