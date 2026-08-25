// BEACON — INCIDENT entity (E1·T-049). Wildfire/flood/storm event scoped to a region, with a status guard.
// Pure domain: no framework/HTTP/DB imports (F9).
import type { IncidentId, RegionId } from './value-objects/ids.js';
import { InvariantViolation, InvalidTransition } from './errors.js';

// Enums mirror schema.sql incident.type / incident.status CHECK constraints exactly.
// STORM (tropical cyclone / typhoon) is first-class alongside WILDFIRE/FLOOD — ADR-032, FR-STORM-1/FU-9.
export const INCIDENT_TYPES = ['WILDFIRE', 'FLOOD', 'STORM'] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];

export const INCIDENT_STATUSES = ['ACTIVE', 'CONTAINED', 'CLOSED'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export interface Incident {
  readonly id: IncidentId;
  readonly regionId: RegionId;
  readonly type: IncidentType;
  readonly status: IncidentStatus;
}

export interface MakeIncidentInput {
  readonly id: IncidentId;
  readonly regionId: RegionId;
  readonly type: IncidentType;
  readonly status?: IncidentStatus; // schema default ACTIVE
}

// Legal status transitions. ACTIVE<->CONTAINED (a contained fire can re-flare); either may CLOSE.
// CLOSED is terminal — a closed incident never reopens (T-049 acceptance: CLOSED->ACTIVE rejected).
const LEGAL_TRANSITIONS: Readonly<Record<IncidentStatus, readonly IncidentStatus[]>> = {
  ACTIVE: ['CONTAINED', 'CLOSED'],
  CONTAINED: ['ACTIVE', 'CLOSED'],
  CLOSED: [],
};

export function canTransitionIncident(from: IncidentStatus, to: IncidentStatus): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

export function makeIncident(input: MakeIncidentInput): Incident {
  if (!INCIDENT_TYPES.includes(input.type)) {
    throw new InvariantViolation(`Incident.type must be one of ${INCIDENT_TYPES.join('|')}, got ${String(input.type)}`);
  }
  const status = input.status ?? 'ACTIVE';
  if (!INCIDENT_STATUSES.includes(status)) {
    throw new InvariantViolation(`Incident.status must be one of ${INCIDENT_STATUSES.join('|')}, got ${String(status)}`);
  }
  return { id: input.id, regionId: input.regionId, type: input.type, status };
}

/** Transition an incident's status; throws InvalidTransition on an illegal hop (e.g. CLOSED->ACTIVE). */
export function transitionIncident(incident: Incident, to: IncidentStatus): Incident {
  if (!canTransitionIncident(incident.status, to)) {
    throw new InvalidTransition(`Incident cannot move ${incident.status} -> ${to}`);
  }
  return { ...incident, status: to };
}
