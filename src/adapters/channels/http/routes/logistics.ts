// BEACON — LOGISTICS HTTP handlers (E7; FR-7/FR-8, SPEC §2.2: POST /routes, GET/POST /resources,
// POST /resource-tasks, GET /pre-positioning). Framework-agnostic: each handler takes an ALREADY-parsed/
// authenticated request + the wired adapters and returns an Envelope-shaped { status, body } — no server,
// deterministic, offline. The route table + composition root wire these in (this file edits nothing shared).
//
// RBAC (SPEC §2.2 / Art. XIII): /routes is open; /resources + /resource-tasks + /pre-positioning require
// RESPONDER+ (pre-positioning surfaces the same asset registry as /resources — same gate). Errors mirror the
// existing HTTP style: DomainError → errorEnvelope + statusForError. Provenance is NON-EMPTY on every success
// (F1). GET /pre-positioning (W2d, PRD flagship-4 "pre-positioning from predictions") ranks resources/shelters
// NEAR — never inside — the projected hazard extent as ADVISORY suggestions: the engine ranks, a human decides
// whether to actually task/relocate (Art. XII/XIII — never auto-tasked from this handler).
import { isResponder, roleRank } from '@/domain/app-user.js';
import type { AppUserRole } from '@/domain/app-user.js';
import { DomainError, Unauthorized } from '@/domain/errors.js';
import type { Result } from '@/domain/shared/result.js';
import { ok, err } from '@/domain/shared/result.js';
import { makeResource } from '@/domain/resource.js';
import type { Resource, ResourceKind, ResourceStatus } from '@/domain/resource.js';
import { makeResourceTask } from '@/domain/resource-task.js';
import type { ResourceTask, ResourceTaskStatus } from '@/domain/resource-task.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { EvacRouteId, IncidentId, OrgId, ResourceId, ResourceTaskId, ShelterId } from '@/domain/value-objects/ids.js';
import type { Geometry, PointGeometry, Position } from '@/domain/value-objects/geo.js';
import type { EvacRoute } from '@/domain/evac-route.js';
import type { Shelter } from '@/domain/shelter.js';
import type { Envelope, SourceRef } from '@/ports/interaction.js';
import type { SpatialPort } from '@/ports/infra.js';
import type { RoutingPort, ResourceLogisticsPort } from '@/ports/logistics.js';
import { errorEnvelope } from '@/application/interaction/command-router.js';
import { planEvacRoute, computeSuggestedStart, routeClearanceSeconds } from '@/application/evac-routing/evac-routing.js';
import { suggestPrePositioning } from '@/application/pre-positioning/pre-positioning.js';
import { statusForError } from '../error-mapping.js';

/** The transport-neutral result every logistics handler returns (mirrors HttpResponse's {status, body}). */
export interface LogisticsHttpResult {
  readonly status: number;
  readonly body: Envelope | Envelope<null>;
}

// ── envelope helpers (mirror command-router's envelope() + the HTTP error style) ──────────────────────

/** MOCK-mode provenance for the offline logistics store — NON-EMPTY so every data response satisfies F1. */
function mockProvenance(clock: () => string): readonly SourceRef[] {
  return [{ sourceId: 'logistics', mode: 'MOCK', fetchedAt: clock() }];
}

function fail(error: DomainError): LogisticsHttpResult {
  return { status: statusForError(error.code), body: errorEnvelope(error) };
}

function success<T>(
  status: number,
  data: T,
  provenance: readonly SourceRef[],
  meta?: Readonly<Record<string, unknown>>,
): LogisticsHttpResult {
  const freshness = provenance[0]?.fetchedAt;
  const body: Envelope<T> = {
    data,
    provenance,
    ...(freshness ? { freshness } : {}),
    ...(meta ? { meta } : {}),
  };
  return { status, body };
}

const asDomainError = (cause: unknown): DomainError =>
  cause instanceof DomainError ? cause : new DomainError('INVARIANT_VIOLATION', 'invalid request payload');

// ── POST /routes — hazard-avoiding evac route + nearest open shelters (OPEN, capacity). Auth: – (open). ──

export interface RoutesRequest {
  readonly incidentId: IncidentId;
  readonly from: Position;
  /**
   * Destination. OPTIONAL (F-361) — omitted means "route me to safety", and the SERVER resolves the nearest
   * open shelter deterministically (Art. XII: the client never ranks or picks).
   *
   * `openapi.yaml` has documented `destination` as optional — *"if omitted, the nearest open shelter is the
   * destination"* — since S03, and the evacuation panel collects only an origin and renders the ranked
   * shelters the server returns. The implementation hard-required it anyway, so `POST /routes` 400'd on
   * every real submit while the panel's own component test asserted, greenly, that the client sends a
   * payload the server refuses. Making this optional is what the published contract always promised.
   */
  readonly to?: Position;
  readonly avoidHazard?: boolean;
}

export interface RoutesDeps {
  readonly routing: RoutingPort;
  readonly logistics: ResourceLogisticsPort;
  readonly clock: () => string;
  /** Per-incident projected hazard-arrival (ISO-8601). Present ⇒ the route carries a computed suggested_start (FR-7). */
  readonly hazardArrivalFor?: (incidentId: IncidentId) => string | undefined;
  /** Evac convoy speed (m/s) for the clearance estimate; defaults to the SPEC §5.7 value. */
  readonly evacSpeedMps?: number;
  /** Safety-margin seconds subtracted from the arrival; defaults to the SPEC §5.7 value. */
  readonly safetyMarginSec?: number;
}

/**
 * Attach the deterministic evac suggested_start (FR-7, SPEC §5.7). It is COMPUTED, not seeded:
 * suggested_start = projected_hazard_arrival − route_clearance(routed path) − safety_margin. Because the
 * clearance comes from the ROUTED path length, moving the hazard (a longer detour) shifts the start earlier.
 * No projected arrival ⇒ the route is returned without a suggested_start (never a dead-end, Art. XVI).
 */
function withSuggestedStart(route: EvacRoute, req: RoutesRequest, deps: RoutesDeps): EvacRoute {
  if (route.suggestedStart !== undefined) return route;
  const arrival = deps.hazardArrivalFor?.(req.incidentId);
  if (arrival === undefined) return route;
  const clearanceSec = routeClearanceSeconds(route.geom, deps.evacSpeedMps);
  const start = computeSuggestedStart({
    projectedHazardArrival: arrival,
    routeClearanceSec: clearanceSec,
    ...(deps.safetyMarginSec !== undefined ? { safetyMarginSec: deps.safetyMarginSec } : {}),
  });
  return start !== null ? { ...route, suggestedStart: start } : route;
}

/**
 * The `data` payload POST /routes returns — the ONE declaration of that shape (F-406, the F-200 pattern).
 *
 * It was an anonymous object literal, and the frontend mirrored it BY HAND as
 * `{ geometry?: unknown; shelters: ShelterMatch[] }`. Three things were wrong at once and none of them could
 * fail to compile: the route arrives under `route` (not `geometry`), it is a full `EvacRoute` (not a bare
 * LineString), and `ShelterMatch` invented `name`/`demand` fields the `Shelter` entity does not have —
 * so the panel's shelter rows rendered an id where a name belonged and a permanent "—" for demand.
 *
 * Naming the shape lets `app/_lib/types.ts` DERIVE its view, so renaming a key or changing an entity becomes
 * a client COMPILE error rather than a silently-blank panel in a browser.
 */
export interface RoutesData {
  readonly route: EvacRoute;
  readonly shelters: readonly Shelter[];
}

/**
 * Resolve the route destination: the caller's explicit `to`, else the nearest OPEN shelter to the origin
 * (F-361). Ranking is the logistics port's — deterministic, server-side, never re-sorted (Art. XII).
 *
 * A closed shelter is not a destination, so the search is filtered rather than trusting position 0 blindly.
 * With no open shelter in range the caller gets a typed, explanatory error instead of a route to nowhere
 * (Art. XVI: degrade with a label, never a dead-end and never a silently-wrong destination).
 */
async function resolveDestination(
  req: RoutesRequest,
  deps: RoutesDeps,
): Promise<Result<Position, DomainError>> {
  if (req.to !== undefined) return ok(req.to);
  const shelters = await deps.logistics.findShelters(req.from);
  if (!shelters.ok) return shelters;
  const open = shelters.value.find((s) => s.status === 'OPEN');
  if (open === undefined) {
    return err(
      new DomainError(
        'NOT_FOUND',
        'no open shelter in range to route to — supply an explicit destination',
      ),
    );
  }
  return ok(open.geom.coordinates);
}

/** POST /routes — delegate to the evac-routing use-case (FR-7), then surface the computed suggested_start. */
export async function handleRoutes(req: RoutesRequest, deps: RoutesDeps): Promise<LogisticsHttpResult> {
  const destination = await resolveDestination(req, deps);
  if (!destination.ok) return fail(destination.error);
  const to = destination.value;
  const plan = await planEvacRoute(
    {
      request: {
        incidentId: req.incidentId,
        from: req.from,
        to,
        ...(req.avoidHazard !== undefined ? { avoidHazard: req.avoidHazard } : {}),
      },
      heuristicRouteId: asId<EvacRouteId>(`evac-heuristic-${req.incidentId}`),
    },
    deps.routing,
  );
  if (!plan.ok) return fail(plan.error);
  const route = withSuggestedStart(plan.value.route, req, deps);
  const shelters = await deps.logistics.findShelters(to);
  if (!shelters.ok) return fail(shelters.error);
  return success(200, { route, shelters: shelters.value } satisfies RoutesData, mockProvenance(deps.clock));
}

// ── GET/POST /resources + POST /resource-tasks — RESPONDER+ (org-scoped). ─────────────────────────────

export interface LogisticsDeps {
  readonly logistics: ResourceLogisticsPort;
  readonly clock: () => string;
}

/** EM+ sees every resource; RESPONDER/VERIFIER are org-scoped (only their own org's assets, SPEC §2.2). */
function scopeResources(list: readonly Resource[], role: AppUserRole, orgId: OrgId | undefined): readonly Resource[] {
  if (roleRank(role) >= roleRank('EM')) return list;
  return orgId === undefined ? [] : list.filter((r) => r.orgId === orgId);
}

export interface ResourcesGetRequest {
  readonly role: AppUserRole;
  readonly incidentId: IncidentId;
  readonly orgId?: OrgId;
}

/**
 * The `data` payload GET /resources returns — the ONE declaration of that shape (F-200). It was previously
 * an anonymous object literal here, which the frontend mirrored BY HAND as a bare `readonly Resource[]`;
 * the board then called `.map()` on an object and crashed the whole panel. Naming the shape lets the client
 * DERIVE its view (`app/_lib/types.ts` builds `ResourcesData` off `keyof ResourcesGetData`), so renaming or
 * unwrapping the `resources` key becomes a client COMPILE error instead of a runtime TypeError in a browser.
 */
export interface ResourcesGetData {
  readonly resources: readonly Resource[];
}

export async function handleResourcesGet(req: ResourcesGetRequest, deps: LogisticsDeps): Promise<LogisticsHttpResult> {
  if (!isResponder(req.role)) return fail(new Unauthorized('GET /resources requires RESPONDER+'));
  const res = await deps.logistics.listAvailable(req.incidentId);
  if (!res.ok) return fail(res.error);
  const scoped = scopeResources(res.value, req.role, req.orgId);
  return success<ResourcesGetData>(200, { resources: scoped }, mockProvenance(deps.clock));
}

export interface ResourcesPostRequest {
  readonly role: AppUserRole;
  readonly id: string;
  readonly kind: ResourceKind;
  readonly status?: ResourceStatus;
  readonly orgId?: OrgId;
  readonly geom?: PointGeometry;
}

/**
 * POST /resources persists into the adapter store when it supports `register` (both adapters do).
 *
 * ASYNC and Result-returning: the durable store (pg-logistics.ts) cannot answer before the row is written,
 * and the outcome is now AWAITED. It used to be discarded, so a store that failed to persist still produced
 * a 201 for a resource nobody had stored — invisible while the only store was in-memory and always
 * succeeded, and a silent data-loss report the moment FEATURE_STORE=postgres made failure possible.
 */
export interface ResourcesPostDeps extends LogisticsDeps {
  readonly register?: (resource: Resource) => Promise<Result<Resource, DomainError>>;
}

/** Validate the request into a domain Resource, or the typed error the factory raised (never a throw). */
function parseResource(req: ResourcesPostRequest): Result<Resource, DomainError> {
  try {
    return ok(
      makeResource({
        id: asId<ResourceId>(req.id),
        kind: req.kind,
        ...(req.status !== undefined ? { status: req.status } : {}),
        ...(req.orgId !== undefined ? { orgId: req.orgId } : {}),
        ...(req.geom !== undefined ? { geom: req.geom } : {}),
      }),
    );
  } catch (cause) {
    return err(asDomainError(cause));
  }
}

export async function handleResourcesPost(req: ResourcesPostRequest, deps: ResourcesPostDeps): Promise<LogisticsHttpResult> {
  if (!isResponder(req.role)) return fail(new Unauthorized('POST /resources requires RESPONDER+ (own org)'));
  const parsed = parseResource(req);
  if (!parsed.ok) return fail(parsed.error);
  const resource = parsed.value;
  const stored = await deps.register?.(resource);
  if (stored !== undefined && !stored.ok) return fail(stored.error);
  // Echo what was actually STORED when a store answered: the durable store owns the surrogate uuid PK, so
  // the caller must be told the id it has to quote to task this resource later (never the one it asked for).
  return success(201, { resource: stored?.ok === true ? stored.value : resource }, mockProvenance(deps.clock));
}

export interface ResourceTaskRequest {
  readonly role: AppUserRole;
  readonly id: string;
  readonly resourceId: string;
  readonly incidentId: IncidentId;
  readonly status?: ResourceTaskStatus;
  readonly shelterId?: string;
}

/**
 * The `data` payload POST /resource-tasks returns: the created OR advanced task, nested under `task`
 * (F-190 recorded the client's hand-written mirror declaring a flat `{id,status}` instead). Named for the
 * same reason as `ResourcesGetData` — the client derives its view from this rather than restating it.
 */
export interface ResourceTaskData {
  readonly task: ResourceTask;
}

export async function handleResourceTask(req: ResourceTaskRequest, deps: LogisticsDeps): Promise<LogisticsHttpResult> {
  if (!isResponder(req.role)) return fail(new Unauthorized('POST /resource-tasks requires RESPONDER+/EM'));
  let task;
  try {
    task = makeResourceTask({
      id: asId<ResourceTaskId>(req.id),
      resourceId: asId<ResourceId>(req.resourceId),
      incidentId: req.incidentId,
      ...(req.status !== undefined ? { status: req.status } : {}),
      ...(req.shelterId !== undefined ? { shelterId: asId<ShelterId>(req.shelterId) } : {}),
    });
  } catch (cause) {
    return fail(asDomainError(cause));
  }
  const res = await deps.logistics.task(task);
  if (!res.ok) return fail(res.error);
  return success<ResourceTaskData>(201, { task: res.value }, mockProvenance(deps.clock), {
    note: 'tasking recorded (VERIFIED-source gate + forward-only lifecycle enforced — Art. XIII)',
  });
}

// ── GET /pre-positioning — resources/shelters ranked near the projected hazard extent (RESPONDER+). ────
// W2d (PRD flagship-4 "pre-positioning from predictions"): the ONE missing logistics claim. Ranking itself
// is the pure `suggestPrePositioning` use-case (src/application/pre-positioning) — this handler only gathers
// the candidate pools through the EXISTING ResourceLogisticsPort surface (no port change) and the per-incident
// projected extent, then returns the labeled, advisory result. ADVISORY ONLY — never tasks a resource.

/** Arbitrary anchor for `findShelters` — memory-logistics does not cap/drop by proximity to it (only status +
 * spare capacity), so any anchor returns the same eligible set; `suggestPrePositioning` re-ranks by the
 * projected EXTENT, not by this point. */
const PRE_POSITIONING_SHELTER_ANCHOR: Position = [0, 0];

export interface PrePositioningRequest {
  readonly role: AppUserRole;
  readonly incidentId: IncidentId;
}

export interface PrePositioningDeps {
  readonly logistics: ResourceLogisticsPort;
  readonly spatial: SpatialPort;
  readonly clock: () => string;
  /** Per-incident projected hazard extent (prediction-projection OUTPUT, e.g. `Prediction.geom`). Absent
   * function/incident ⇒ no suggestions yet — a labeled `extentAvailable:false`, never a dead-end (Art. XVI). */
  readonly projectedExtentFor?: (incidentId: IncidentId) => Geometry | undefined;
}

export async function handlePrePositioning(
  req: PrePositioningRequest,
  deps: PrePositioningDeps,
): Promise<LogisticsHttpResult> {
  if (!isResponder(req.role)) return fail(new Unauthorized('GET /pre-positioning requires RESPONDER+'));
  const resources = await deps.logistics.listAvailable(req.incidentId);
  if (!resources.ok) return fail(resources.error);
  const shelters = await deps.logistics.findShelters(PRE_POSITIONING_SHELTER_ANCHOR);
  if (!shelters.ok) return fail(shelters.error);

  const extent = deps.projectedExtentFor?.(req.incidentId);
  const ranked = suggestPrePositioning(
    {
      candidates: { resources: resources.value, shelters: shelters.value },
      ...(extent !== undefined ? { extent } : {}),
    },
    deps.spatial,
  );
  if (!ranked.ok) return fail(ranked.error);
  return success(200, ranked.value, mockProvenance(deps.clock), {
    note: 'advisory pre-positioning suggestions — engine suggests, human decides (Art. XII/XIII); never auto-tasked',
  });
}
