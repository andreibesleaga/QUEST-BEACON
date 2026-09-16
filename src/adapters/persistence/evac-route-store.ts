// BEACON — durable ACCEPTED evacuation routes (UNIMPLEMENTED_REGISTER row 30; EV7, FR-7, ADR-013).
//
// `evac_route` has existed since E3 and nothing ever wrote to it. POST /routes PLANS a route on every call
// (ORS → heuristic ladder), and that stays exactly as it is: the display path is unchanged and still
// re-plans per request, because a route is only as good as the hazard footprint it was computed against.
//
// What is persisted is the route an operator ACCEPTED — the decision, keyed by incident. That is a
// different fact from "the route the engine would suggest right now", and it is the one worth surviving a
// restart: it is what was communicated, what a convoy was sent down, and what an after-action review needs.
// `listByIncident` is therefore a HISTORY read (newest first), never the source of the rendered route.
import { desc, eq } from 'drizzle-orm';
import { resolveIncidentRowId } from './natural-keys.js';
import type { Result } from '@/domain/shared/result.js';
import { DomainError } from '@/domain/errors.js';
import type { EvacRoute } from '@/domain/evac-route.js';
import type { IncidentId } from '@/domain/value-objects/ids.js';
import type { Db } from './client';
import { tryResult } from './repository';
import { evacRouteMapper } from './mappers';
import { evacRoute } from './schema';

/** Injection seam for the natural-key resolver (ADR-039); tests drive it without standing up a schema. */
export interface PgEvacRouteStoreOptions {
  readonly resolveIncident?: (domainIncidentId: string) => Promise<string | null>;
}

export interface PgEvacRouteStore {
  /** Persist an accepted route plan. `null` = skipped: its incident has no stored row (ADR-039 §2a). */
  accept(route: EvacRoute): Promise<Result<EvacRoute | null, DomainError>>;
  /** The incident's accepted routes, newest first — audit/history, not the rendered route. */
  listByIncident(incidentId: IncidentId): Promise<Result<readonly EvacRoute[], DomainError>>;
}

function firstRow<R>(rows: readonly R[], what: string): R {
  const row = rows[0];
  if (row === undefined) throw new DomainError('PARSE_ERROR', `${what} returned no row`);
  return row;
}

/**
 * Build the durable evac-route store. Every accepted route is an APPEND: re-accepting after the hazard
 * moved records a second decision rather than overwriting the first, because the earlier route was really
 * issued and an audit trail that can be edited by a later decision is not an audit trail.
 */
export function makePgEvacRouteStore(
  db: Db,
  options: PgEvacRouteStoreOptions = {},
): PgEvacRouteStore {
  const resolveIncident =
    options.resolveIncident ?? ((id): Promise<string | null> => resolveIncidentRowId(db, id));
  return {
    accept: (route) =>
      tryResult(async () => {
        // ADR-039: `evac_route.incident_id` is a uuid FK while a route names its incident by domain id —
        // the same defect that kept the SitRep store uncomposed. Resolve, or refuse: a route filed against
        // an incident that does not exist would be an orphan in the record of what was ordered.
        const incidentRowId = await resolveIncident(String(route.incidentId));
        if (incidentRowId === null) return null;
        const rows = await db
          .insert(evacRoute)
          .values({ ...evacRouteMapper.toRow(route), incidentId: incidentRowId })
          .returning();
        // Answer in the caller's id space: it asked about `us-ca-wildfire-demo`, not a surrogate.
        return {
          ...evacRouteMapper.fromRow(firstRow(rows, 'evac_route.accept')),
          incidentId: route.incidentId,
        };
      }),

    listByIncident: (incidentId) =>
      tryResult(async () => {
        // Symmetry with `accept` — rows are stored against the resolved uuid, so they must be read by it.
        const incidentRowId = await resolveIncident(String(incidentId));
        if (incidentRowId === null) return [];
        return (
          await db
            .select()
            .from(evacRoute)
            .where(eq(evacRoute.incidentId, incidentRowId))
            .orderBy(desc(evacRoute.createdAt))
        ).map((r) => ({ ...evacRouteMapper.fromRow(r), incidentId }));
      }),
  };
}
