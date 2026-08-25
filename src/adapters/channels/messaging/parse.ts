// BEACON — messaging NL-lite parser (E10·T-455/T-459; ADR-023). Maps plain chat text to ONE canonical
// Command. It ONLY routes — it never computes a number, ranking, distance, or exposure (Art. XII); the
// deterministic engine behind the router owns every figure. Unknown input → a typed PARSE_ERROR.
//
// Consent rule (documented, honest — EV4 / Art. XIV):
//   A `report` is treated as CONSENTED only when the message carries BOTH (a) the explicit `report`
//   keyword (intent) AND (b) an explicit consent affirmation token (`consent`). The keyword alone is
//   NOT enough — consent is never silently implied. Without the affirmation the parser returns a
//   PARSE_ERROR asking the sender to consent, so `consent: true` (a compile-time literal) is only ever
//   produced from a real, explicit affirmation.
import type { Result } from '@/domain/shared/result.js';
import { ok, err } from '@/domain/shared/result.js';
import { DomainError } from '@/domain/errors.js';
import type { Command } from '@/ports/interaction.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { IncidentId } from '@/domain/value-objects/ids.js';

/** Explicit consent affirmation token — the only thing that unlocks `consent: true` on a report. */
const CONSENT_RE = /\bconsent\b/i;

function parseError(message: string): Result<Command, DomainError> {
  return err(new DomainError('PARSE_ERROR', message));
}

/** `sitrep <incidentId>` — the incidentId is passed verbatim to the router (no computation here). */
function parseSitrep(arg: string): Result<Command, DomainError> {
  if (arg.length === 0) return parseError('sitrep requires an incidentId — try: sitrep <incidentId>');
  return ok<Command>({ verb: 'sitrep', incidentId: asId<IncidentId>(arg) });
}

/** `report <free text>` — requires an explicit consent affirmation (see consent rule at top). */
function parseReport(full: string, arg: string): Result<Command, DomainError> {
  if (arg.length === 0) return parseError('report requires text — try: report <what you observed> consent');
  if (!CONSENT_RE.test(full)) {
    return parseError('report needs explicit consent — include the word "consent" to submit');
  }
  return ok<Command>({ verb: 'report', consent: true, text: arg });
}

/**
 * Map a plain chat message to a canonical Command. Supported: `status`, `sources`, `sitrep <id>`,
 * `report <text> consent`. Anything else is a typed PARSE_ERROR. No numbers are ever produced here.
 */
export function parseMessageToCommand(text: string): Result<Command, DomainError> {
  const trimmed = text.trim();
  const parts = trimmed.split(/\s+/);
  const verb = (parts[0] ?? '').toLowerCase();
  const arg = parts.slice(1).join(' ').trim();
  switch (verb) {
    case 'status':
      return ok<Command>({ verb: 'status' });
    case 'sources':
      return ok<Command>({ verb: 'sources' });
    case 'sitrep':
      return parseSitrep(arg);
    case 'report':
      return parseReport(trimmed, arg);
    default:
      return parseError(`unrecognized command: ${verb.length > 0 ? verb : '(empty message)'}`);
  }
}
