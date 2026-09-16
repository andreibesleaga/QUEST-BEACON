// BEACON — SHELTER entity (E1·T-077). Agency-seeded shelter with capacity vs occupancy invariant.
// Pure domain: no framework/HTTP/DB imports (F9).
import type { ShelterId, OrgId } from './value-objects/ids.js';
import type { PointGeometry } from './value-objects/geo.js';
import { isPosition } from './value-objects/geo.js';
import { invariant, definedOnly } from './shared/guard.js';

// Enum mirrors schema.sql shelter.status CHECK.
export const SHELTER_STATUSES = ['OPEN', 'FULL', 'CLOSED'] as const;
export type ShelterStatus = (typeof SHELTER_STATUSES)[number];

export interface Shelter {
  readonly id: ShelterId;
  readonly geom: PointGeometry; // NOT NULL in the DDL
  readonly capacity: number; // non-negative headcount
  readonly occupancy: number; // 0 ≤ occupancy ≤ capacity
  readonly status: ShelterStatus;
  readonly orgId?: OrgId; // nullable in the DDL (agency-entered)
}

export interface MakeShelterInput {
  readonly id: ShelterId;
  readonly geom: PointGeometry;
  readonly capacity: number;
  readonly occupancy?: number; // defaults to 0 (schema default)
  readonly status?: ShelterStatus; // defaults to OPEN (schema default)
  readonly orgId?: OrgId;
}

function assertPoint(geom: PointGeometry): void {
  invariant(
    geom.type === 'Point' && isPosition(geom.coordinates),
    'Shelter.geom must be a GeoJSON Point with a [lon,lat] position',
  );
}

export function makeShelter(input: MakeShelterInput): Shelter {
  assertPoint(input.geom);

  invariant(
    Number.isInteger(input.capacity) && input.capacity >= 0,
    `Shelter.capacity must be a non-negative integer, got ${String(input.capacity)}`,
  );
  const occupancy = input.occupancy ?? 0;
  invariant(
    Number.isInteger(occupancy) && occupancy >= 0,
    `Shelter.occupancy must be a non-negative integer, got ${String(occupancy)}`,
  );
  // Core invariant (schema chk_shelter_occupancy_le_capacity): you cannot shelter more than you can hold.
  invariant(
    occupancy <= input.capacity,
    `Shelter.occupancy (${occupancy}) must not exceed capacity (${input.capacity})`,
  );

  const status = input.status ?? 'OPEN';
  invariant(
    SHELTER_STATUSES.includes(status),
    `Shelter.status must be one of ${SHELTER_STATUSES.join('|')}, got ${String(status)}`,
  );
  // FULL is a claim about occupancy: it must hold exactly at capacity, else the status lies.
  invariant(
    status !== 'FULL' || occupancy === input.capacity,
    `Shelter.status FULL requires occupancy (${occupancy}) == capacity (${input.capacity})`,
  );

  return definedOnly({
    id: input.id,
    geom: input.geom,
    capacity: input.capacity,
    occupancy,
    status,
    orgId: input.orgId,
  }) as Shelter;
}
