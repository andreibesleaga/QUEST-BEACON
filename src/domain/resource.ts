// BEACON — RESOURCE entity (E1·T-073). Responder asset registry (crew/engine/aircraft/…).
// Pure domain: no framework/HTTP/DB imports (F9).
import type { ResourceId, OrgId } from './value-objects/ids.js';
import type { PointGeometry } from './value-objects/geo.js';
import { isPosition } from './value-objects/geo.js';
import { InvariantViolation } from './errors.js';

// Enums mirror schema.sql resource.kind / resource.status CHECK.
//
// THIS ARRAY IS THE ONE DEFINITION. `src/adapters/persistence/schema/logistics-tables.ts` no longer retypes
// these tokens beside its CHECK constraint — it IMPORTS this constant and hands it to `checkEnum`, so the DB
// constraint and the domain union cannot drift (that drift is the F-24/F-140/F-141/F-192 defect class:
// re-declaring a contract instead of deriving it). The remaining hand-written copy is the human-authored
// reference DDL `schemas/schema.sql`, which is not importable TypeScript; it is therefore PINNED to this
// array by `tests/architecture/domain-db-enum-pin.test.ts` rather than trusted.
//
// 'TEAM' is FR-D6-1 (ADR-035 §4): a volunteer team is registered and tasked as a UNIT, so it is a resource
// KIND rather than a new entity — the task lifecycle, the board and the ranking then apply to it unchanged.
// Its aggregate fields (callsign/headcount/skills/availability) live in
// `src/application/aggregate/volunteer-team.ts`; the domain may not import the application layer, so they
// are NOT restated here (see the finding recorded with this change).
export const RESOURCE_KINDS = ['CREW', 'ENGINE', 'AIRCRAFT', 'MEDICAL', 'SUPPLY', 'TEAM'] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export const RESOURCE_STATUSES = ['AVAILABLE', 'ASSIGNED', 'OOS'] as const;
export type ResourceStatus = (typeof RESOURCE_STATUSES)[number];

export interface Resource {
  readonly id: ResourceId;
  readonly kind: ResourceKind;
  readonly status: ResourceStatus;
  // org + geom are nullable in the DDL; modelled as optional (exactOptionalPropertyTypes: absent, not undefined).
  readonly orgId?: OrgId;
  readonly geom?: PointGeometry;
}

export interface MakeResourceInput {
  readonly id: ResourceId;
  readonly kind: ResourceKind;
  readonly status?: ResourceStatus; // defaults to AVAILABLE (schema default)
  readonly orgId?: OrgId;
  readonly geom?: PointGeometry;
}

// A resource may carry a GeoJSON Point location; reject anything that is not a valid Point.
function assertPoint(geom: PointGeometry): void {
  if (geom.type !== 'Point' || !isPosition(geom.coordinates)) {
    throw new InvariantViolation('Resource.geom must be a GeoJSON Point with a [lon,lat] position');
  }
}

export function makeResource(input: MakeResourceInput): Resource {
  if (!RESOURCE_KINDS.includes(input.kind)) {
    throw new InvariantViolation(
      `Resource.kind must be one of ${RESOURCE_KINDS.join('|')}, got ${String(input.kind)}`,
    );
  }
  const status = input.status ?? 'AVAILABLE';
  if (!RESOURCE_STATUSES.includes(status)) {
    throw new InvariantViolation(
      `Resource.status must be one of ${RESOURCE_STATUSES.join('|')}, got ${String(status)}`,
    );
  }
  if (input.geom !== undefined) assertPoint(input.geom);

  return {
    id: input.id,
    kind: input.kind,
    status,
    // Conditionally include optionals so exactOptionalPropertyTypes stays satisfied (no explicit undefined).
    ...(input.orgId !== undefined ? { orgId: input.orgId } : {}),
    ...(input.geom !== undefined ? { geom: input.geom } : {}),
  };
}
