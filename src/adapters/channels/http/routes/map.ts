// BEACON — MAP-PROJECTION HTTP handler (E7·map; SPEC §2.2, Art. XII/XIV, F1). Framework-agnostic: takes an
// ALREADY-parsed/authenticated request (regionId + resolved role) + the wired MapReadModel and returns an
// Envelope-shaped { status, body } — no server, deterministic, offline. Reads the DOMAIN-shaped MapProjection
// through the pure use-case (numbers/geometry from the domain, never invented — Art. XII). Precise report
// geometry is role-gated INSIDE projectMap (Art. XIV). Provenance is NON-EMPTY on every success (F1).
import { projectMap } from '@/application/map-projection/map-projection.js';
import type { MapReadModel, MapProjection } from '@/application/map-projection/map-projection.js';
import type { AppUserRole } from '@/domain/app-user.js';
import { DomainError } from '@/domain/errors.js';
import type { RegionId } from '@/domain/value-objects/ids.js';
import type { Envelope } from '@/ports/interaction.js';
import { errorEnvelope } from '@/application/interaction/command-router.js';
import { statusForError } from '../error-mapping.js';

/** The transport-neutral result the map handler returns (mirrors HttpResponse's {status, body}). */
export interface MapHttpResult {
  readonly status: number;
  readonly body: Envelope<MapProjection> | Envelope<null>;
}

export interface MapProjectionRequest {
  readonly regionId: RegionId;
  readonly role: AppUserRole;
}

export interface MapProjectionDeps {
  readonly map: MapReadModel;
}

function fail(error: DomainError): MapHttpResult {
  return { status: statusForError(error.code), body: errorEnvelope(error) };
}

/**
 * GET /regions/:id/map — the COP's geometry projection for a region. PUBLIC-readable (like /status,/incidents);
 * precise report/PII geometry is withheld from PUBLIC and revealed only to RESPONDER+ (gated in projectMap,
 * Art. XIV). Unknown region → 404. The seed's provenance rides the envelope (non-empty, F1) + freshness.
 */
export async function handleMapProjection(
  req: MapProjectionRequest,
  deps: MapProjectionDeps,
): Promise<MapHttpResult> {
  const res = await deps.map.sourceFor(req.regionId);
  if (!res.ok) return fail(res.error);
  const source = res.value;
  if (source === null)
    return fail(new DomainError('NOT_FOUND', `region not found: ${req.regionId}`));

  const data = projectMap({ source, role: req.role });
  const body: Envelope<MapProjection> = {
    data,
    provenance: source.provenance,
    ...(source.freshness !== undefined ? { freshness: source.freshness } : {}),
  };
  return { status: 200, body };
}
