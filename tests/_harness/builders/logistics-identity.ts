// BEACON test harness — builders for the logistics, identity & audit cluster (resource, resource-task,
// shelter, evac-route, app-user, audit-event). `valid*` uses the real domain factory; a couple of
// `invalid*Input` red-path variants break a lifecycle/capacity invariant (TEST_PLAN §4).
import { makeResource, type MakeResourceInput, type Resource } from '@/domain/resource.js';
import {
  makeResourceTask,
  type MakeResourceTaskInput,
  type ResourceTask,
} from '@/domain/resource-task.js';
import { makeShelter, type MakeShelterInput, type Shelter } from '@/domain/shelter.js';
import { makeEvacRoute, type MakeEvacRouteInput, type EvacRoute } from '@/domain/evac-route.js';
import { makeAppUser, type MakeAppUserInput, type AppUser } from '@/domain/app-user.js';
import {
  makeAuditEvent,
  type MakeAuditEventInput,
  type AuditEvent,
} from '@/domain/audit-event.js';
import type { LineStringGeometry } from '@/domain/value-objects/geo.js';
import { FIXED_NOW_ISO } from '../clock.js';
import {
  resourceId,
  resourceTaskId,
  shelterId,
  evacRouteId,
  appUserId,
  auditEventId,
  incidentId,
  orgId,
} from './ids.js';
import { point } from './hazard-env.js';

export function validResource(overrides: Partial<MakeResourceInput> = {}): Resource {
  return makeResource({
    id: resourceId('res-engine-7'),
    kind: 'ENGINE',
    status: 'AVAILABLE',
    orgId: orgId('org-calfire'),
    geom: point(-121.7, 39.8),
    ...overrides,
  });
}

export function validResourceTask(overrides: Partial<MakeResourceTaskInput> = {}): ResourceTask {
  return makeResourceTask({
    id: resourceTaskId('task-1'),
    resourceId: resourceId('res-engine-7'),
    incidentId: incidentId('inc-ca-camp'),
    status: 'PROPOSED',
    ...overrides,
  });
}

export function validShelter(overrides: Partial<MakeShelterInput> = {}): Shelter {
  return makeShelter({
    id: shelterId('shelter-ca-1'),
    geom: point(-121.9, 39.9),
    capacity: 200,
    occupancy: 45,
    status: 'OPEN',
    orgId: orgId('org-redcross'),
    ...overrides,
  });
}

export function evacLine(): LineStringGeometry {
  return { type: 'LineString', coordinates: [[-121.6, 39.75], [-121.8, 39.85], [-121.95, 39.92]] };
}

export function validEvacRoute(overrides: Partial<MakeEvacRouteInput> = {}): EvacRoute {
  return makeEvacRoute({
    id: evacRouteId('route-ca-1'),
    incidentId: incidentId('inc-ca-camp'),
    geom: evacLine(),
    avoidsHazard: true,
    suggestedStart: FIXED_NOW_ISO,
    ...overrides,
  });
}

export function validAppUser(overrides: Partial<MakeAppUserInput> = {}): AppUser {
  return makeAppUser({ id: appUserId('user-em-1'), role: 'EM', orgId: orgId('org-calfire'), ...overrides });
}

export function validAuditEvent(overrides: Partial<MakeAuditEventInput> = {}): AuditEvent {
  return makeAuditEvent({
    id: auditEventId('audit-1'),
    actorId: appUserId('user-em-1'),
    action: 'alert.approve',
    target: 'alert-ca-1',
    at: FIXED_NOW_ISO,
    ...overrides,
  });
}

// ---- invalid variants -------------------------------------------------------------------------------
/** occupancy > capacity must be rejected (schema chk_shelter_occupancy_le_capacity). */
export function invalidShelterInputOverCapacity(): MakeShelterInput {
  return { id: shelterId('bad'), geom: point(-121.9, 39.9), capacity: 10, occupancy: 25 };
}
