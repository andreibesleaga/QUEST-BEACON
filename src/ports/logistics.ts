// BEACON — Logistics/interop ports (E1·T-089; ADR-001 P8/P9/P10). Routing, resource logistics, alert sink.
// Interface signatures only. GUARDRAIL (Art. XIII): AlertSinkPort.emit accepts ONLY an approved ACTUAL
// alert — enforced at the TYPE level (capStatus:'ACTUAL' literal + required approvedBy), so a DRAFT or
// an unapproved alert cannot be passed to emit at compile time.
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { Position } from '@/domain/value-objects/geo.js';
import type { Sourced } from './infra.js';
import type { AreaQuery } from './data-sources.js';
import type { IncidentId, AppUserId } from '@/domain/value-objects/ids.js';
import type { EvacRoute } from '@/domain/evac-route.js';
import type { Resource } from '@/domain/resource.js';
import type { ResourceTask } from '@/domain/resource-task.js';
import type { Shelter } from '@/domain/shelter.js';
// Cross-cluster domain entity (E1 W1, written in parallel).
import type { Alert } from '@/domain/alert.js'; // cross-cluster entity — E1·T-069 (alert.ts)

/** P8 — evacuation routing (ORS → self-host Valhalla/OSRM → heuristic fallback ladder). */
export interface RouteRequest {
  readonly incidentId: IncidentId;
  readonly from: Position;
  readonly to: Position;
  readonly avoidHazard?: boolean; // default true — routes go around the hazard footprint (EV7)
}

export interface RoutingPort {
  route(request: RouteRequest): Promise<Result<EvacRoute, DomainError>>;
}

/** P9 — resource/shelter logistics + mutual aid (EDXL-RM round trip). */
export interface ResourceLogisticsPort {
  listAvailable(incidentId: IncidentId): Promise<Result<readonly Resource[], DomainError>>;
  /** Propose/advance a tasking; the ResourceTask entity guards the forward-only lifecycle. */
  task(task: ResourceTask): Promise<Result<ResourceTask, DomainError>>;
  findShelters(near: Position): Promise<Result<readonly Shelter[], DomainError>>;
}

/**
 * P18 — published shelter DIRECTORIES for an area (FEMA ESF#6 National Shelter System, and any future
 * national register). Mirrors CameraDirectoryPort/TelecomPort: a read-only source seam over an authority's
 * published roster, distinct from {@link ResourceLogisticsPort.findShelters}, which reads BEACON's own
 * operator-maintained shelter table. A directory reports what the publisher says — including a shelter it
 * says is CLOSED — and every response carries freshness (Sourced<T>).
 */
export interface ShelterDirectoryPort {
  fetchShelters(query: AreaQuery): Promise<Result<Sourced<readonly Shelter[]>, DomainError>>;
}

/**
 * Type-level proof that an alert is emittable: it is ACTUAL and carries an approver (Art. XIII).
 * Intersecting the cross-cluster Alert with these required fields makes `approved_by IS NOT NULL`
 * a COMPILE-TIME guarantee (mirrors schema.sql chk_alert_actual_approved).
 */
export type EmittableAlert = Alert & {
  readonly capStatus: 'ACTUAL';
  readonly approvedBy: AppUserId;
};

/** P10 — outbound interop sink (CAP v1.2 / EDXL-RM / EDXL-SitRep). Emits only approved ACTUAL alerts. */
export interface AlertSinkPort {
  emit(alert: EmittableAlert): Promise<Result<void, DomainError>>;
}
