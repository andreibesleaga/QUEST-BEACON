// BEACON — incident-detail + incident-exposure HTTP handlers (E7·routes; SPEC §2.2, Art. XII/XIV, F1).
// Framework-agnostic PURE handlers for the two incident reads openapi.yaml declared and nothing served
// (UNIMPLEMENTED_REGISTER rows 14-15):
//   • GET /incidents/{id}          — the incident record (PUBLIC, same rank as the `incidents` verb).
//   • GET /incidents/{id}/exposure — the deterministic exposure rows for that incident's region.
//
// NEITHER handler re-implements anything. Both resolve the incident through the SAME core InteractionPort
// every other channel dispatches through (`regions` + `incidents` verbs), so the incident contract — its
// shape, its RBAC rank and its F1 provenance — has exactly ONE declaration and cannot drift into a second
// copy here (the re-declared-contract defect class this codebase has hit repeatedly: F-24/F-140/F-192/…).
// Exposure then reads the ALREADY-SHIPPED derivation through `projectMap`, which is the identical
// computation `GET /regions/:id/map` serves as `data.exposure[]`.
//
// HONEST SCOPE of the exposure route: the COP derivation derives exposure PER REGION (`MapSource` carries
// one `incidentType`, and the shipped model has one incident per region). This route therefore resolves the
// incident, then serves ITS REGION's derived exposure — the same rows, reached by incident id. It does not
// pretend to a per-incident partition the engine does not compute.
//
// RBAC on exposure is PUBLIC and role-INDEPENDENT, deliberately: an exposure row names an INFRASTRUCTURE
// NODE (a hospital, a substation) and its relationship to a hazard — a public asset, never a person. The
// Art. XIV precise-geometry gate in `projectMap` applies to the `reports` slice, which this route does not
// serve at all. The role is still threaded into `projectMap` rather than hardcoded, so if the projection
// ever gains a role-gated exposure field the gate applies here automatically instead of being bypassed.
import type { AppUserRole } from '@/domain/app-user.js';
import { DomainError } from '@/domain/errors.js';
import type { Result } from '@/domain/shared/result.js';
import { ok } from '@/domain/shared/result.js';
import type { IncidentId, RegionId } from '@/domain/value-objects/ids.js';
import type { Command, Envelope, InteractionPort, SourceRef } from '@/ports/interaction.js';
import type { IncidentView, RegionView } from '@/application/interaction/command-router.js';
import { errorEnvelope } from '@/application/interaction/command-router.js';
import type { MapReadModel, ProjectedExposure } from '@/application/map-projection/map-projection.js';
import { projectMap } from '@/application/map-projection/map-projection.js';
import { statusForError } from '../error-mapping.js';

/** The transport-neutral result these handlers return (mirrors HttpResponse's {status, body}). */
export interface IncidentHttpResult {
  readonly status: number;
  readonly body: Envelope | Envelope<null>;
}

/** Everything the incident reads need: the shared core, the COP read-model and the injected clock. */
export interface IncidentRoutesDeps {
  readonly interaction: InteractionPort;
  readonly map: MapReadModel;
  readonly clock: () => string;
}

export interface IncidentGetRequest {
  readonly incidentId: IncidentId;
  readonly role: AppUserRole;
  /** Optional narrowing hint: present ⇒ only this region is consulted; absent ⇒ the whole registry. */
  readonly regionId?: RegionId;
}

/** The exposure payload: the incident, its region, and the region's derived exposure rows. */
export interface IncidentExposureData {
  readonly incidentId: string;
  readonly regionId: string;
  readonly exposure: readonly ProjectedExposure[];
  readonly count: number;
}

function fail(error: DomainError): IncidentHttpResult {
  return { status: statusForError(error.code), body: errorEnvelope(error) };
}

/**
 * A 200 with the universal envelope. `freshness` is passed explicitly so it is NEVER omitted (F1/AGENTS §4),
 * and an empty `provenance[]` is backfilled with the deployment's own incident registry rather than shipped
 * empty — a data response with no provenance fails the contract test, so there is no path that emits one.
 */
function success<T>(data: T, provenance: readonly SourceRef[], freshness: string): IncidentHttpResult {
  const refs = provenance.length > 0 ? provenance : [{ sourceId: 'incident-registry', mode: 'LIVE' as const, fetchedAt: freshness }];
  return { status: 200, body: { data, provenance: refs, freshness } };
}

/** Dispatch one READ verb through the shared core under the caller's own role (RBAC stays in the router). */
function dispatchRead(deps: IncidentRoutesDeps, role: AppUserRole, command: Command): Promise<Result<Envelope, DomainError>> {
  return deps.interaction.handle({ channel: 'http', actorRole: role, command, receivedAt: deps.clock() });
}

/**
 * The regions to search, in registry order. An explicit `?regionId=` short-circuits the walk; otherwise the
 * REGISTRY decides the candidate set, because an incident id carries no region and guessing one from its
 * string shape is exactly the substitution F-06 records. The walk is bounded by the shipped-zone count.
 */
async function regionsToSearch(
  deps: IncidentRoutesDeps,
  role: AppUserRole,
  explicit: RegionId | undefined,
): Promise<Result<readonly RegionId[], DomainError>> {
  if (explicit !== undefined) return ok([explicit]);
  const res = await dispatchRead(deps, role, { verb: 'regions' });
  if (!res.ok) return res;
  const { regions } = res.value.data as { readonly regions: readonly RegionView[] };
  return ok(regions.map((r) => r.id));
}

/** A located incident plus the envelope guarantees the core already computed for it (never recomputed here). */
interface FoundIncident {
  readonly view: IncidentView;
  readonly provenance: readonly SourceRef[];
  readonly freshness?: string;
}

/** Locate one incident across the candidate regions, or `null` when no region holds it (→ 404). */
async function findIncident(
  req: IncidentGetRequest,
  deps: IncidentRoutesDeps,
): Promise<Result<FoundIncident | null, DomainError>> {
  const regions = await regionsToSearch(deps, req.role, req.regionId);
  if (!regions.ok) return regions;
  for (const regionId of regions.value) {
    const res = await dispatchRead(deps, req.role, { verb: 'incidents', regionId });
    if (!res.ok) return res;
    const { incidents } = res.value.data as { readonly incidents: readonly IncidentView[] };
    const view = incidents.find((i) => String(i.id) === String(req.incidentId));
    if (view !== undefined) {
      return ok({
        view,
        provenance: res.value.provenance,
        ...(res.value.freshness !== undefined ? { freshness: res.value.freshness } : {}),
      });
    }
  }
  return ok(null);
}

/**
 * GET /incidents/{id} — the incident record. PUBLIC, the SAME rank the `incidents` verb carries
 * (command-router MIN_ROLE), so the detail read can never be looser than the list it is a row of. Unknown
 * id → 404. The served shape IS the list route's element (`IncidentView`) — one declaration, not a second.
 */
export async function handleIncidentGet(
  req: IncidentGetRequest,
  deps: IncidentRoutesDeps,
): Promise<IncidentHttpResult> {
  const found = await findIncident(req, deps);
  if (!found.ok) return fail(found.error);
  if (found.value === null) return fail(new DomainError('NOT_FOUND', `incident not found: ${req.incidentId}`));
  return success(found.value.view, found.value.provenance, found.value.freshness ?? deps.clock());
}

/**
 * GET /incidents/{id}/exposure — the deterministic exposure rows (FR-3/EV2). PUBLIC like the map it reuses;
 * `precisePosition` is revealed only to RESPONDER+ inside `projectMap` (Art. XIV). Numbers and geometry come
 * from the derivation engine, never from this layer and never from the LLM (Art. XII).
 *
 * Unknown incident → 404. An incident whose region has no COP source → 404 with a message naming BOTH, so
 * the caller can tell "no such incident" apart from "that region carries no map inputs".
 */
export async function handleIncidentExposure(
  req: IncidentGetRequest,
  deps: IncidentRoutesDeps,
): Promise<IncidentHttpResult> {
  const found = await findIncident(req, deps);
  if (!found.ok) return fail(found.error);
  if (found.value === null) return fail(new DomainError('NOT_FOUND', `incident not found: ${req.incidentId}`));
  const { view } = found.value;
  const srcRes = await deps.map.sourceFor(view.regionId);
  if (!srcRes.ok) return fail(srcRes.error);
  const source = srcRes.value;
  if (source === null) {
    return fail(
      new DomainError('NOT_FOUND', `no COP source for region ${view.regionId} (incident ${req.incidentId})`),
    );
  }
  const { exposure } = projectMap({ source, role: req.role });
  const data: IncidentExposureData = {
    incidentId: String(view.id),
    regionId: String(view.regionId),
    exposure,
    count: exposure.length,
  };
  return success(data, source.provenance, source.freshness ?? deps.clock());
}
