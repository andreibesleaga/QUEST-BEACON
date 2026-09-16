// BEACON — durable incident mirror (ADR-039; V2·A2).
//
// WHY. Under FEATURE_STORE=postgres the `incident` table held only what the reference seed put there, so a
// database an operator opened in Directus showed a fixture rather than the picture the COP was serving.
// This writes the incidents the COP actually has, keyed by the id the COP actually uses.
//
// IT IS ALSO WHAT MAKES SITREP HISTORY POSSIBLE. `sitrep.incident_id` is a uuid FK; a SitRep can only be
// persisted against an incident that EXISTS as a row. Until something wrote incidents, the SitRep store had
// nothing to reference — which is why it sat composed-nowhere for a release (UNIMPLEMENTED_REGISTER).
//
// UPSERT, NEVER DUPLICATE. The natural key (migration 0008) means a restart refreshes the same rows instead
// of accumulating a new set per boot, and — as with sources — it keeps each incident's uuid stable so the
// history rows written against it stay valid.
import { sql } from 'drizzle-orm';
import { tryResult } from './repository.js';
import { resolveRegionRowId } from './natural-keys.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { IncidentSnapshot, IncidentSnapshotPort } from '@/ports/infra.js';
import type { Db } from './client.js';
import { incident } from './schema.js';

/** Durable incident mirror over `incident`. Upserts on the natural key; skips incidents in unknown regions. */
export function makePgIncidentSnapshotStore(db: Db): IncidentSnapshotPort {
  return {
    record: (incidents: readonly IncidentSnapshot[]): Promise<Result<void, DomainError>> =>
      tryResult(async () => {
        if (incidents.length === 0) return;
        // Resolve each DISTINCT region once — a region's uuid is fixed for the life of the process.
        const regionIds = new Map<string, string | null>();
        for (const key of new Set(incidents.map((i) => i.regionId))) {
          regionIds.set(key, await resolveRegionRowId(db, key));
        }
        const rows = incidents
          // An incident whose region was never seeded is SKIPPED, not attached to an arbitrary region: a
          // wrongly-regioned incident is worse than an absent one, because it reads as fact.
          .filter((i) => regionIds.get(i.regionId) != null)
          .map((i) => ({
            regionId: regionIds.get(i.regionId)!,
            type: i.type,
            status: i.status,
            domainId: i.incidentId,
            // `id` omitted — the DB mints the surrogate on first sight and keeps it, so the SitRep history
            // written against this incident stays valid across every later refresh.
          }));
        if (rows.length === 0) return;
        await db
          .insert(incident)
          .values(rows)
          .onConflictDoUpdate({
            target: incident.domainId,
            set: {
              type: sql`excluded.type`,
              // CLOSED IS TERMINAL (domain: canTransitionIncident). An operator who closed an incident —
              // seeded or discovered — must not have it reopened by the next composition merely because
              // the picture still contains it; the row keeps CLOSED and the COP's view is the COP's.
              status: sql`CASE WHEN ${incident.status} = 'CLOSED' THEN ${incident.status} ELSE excluded.status END`,
              regionId: sql`excluded.region_id`,
              // LAST SEEN. This is the whole of the mirror's lifecycle claim: `updated_at` is the last
              // composition that served the incident. A DISCOVERED incident whose cluster is gone simply
              // stops being refreshed, and the timestamp says when — the mirror never closes anything
              // itself (review, PR #29): a close from here would race a newer replica's upsert, would
              // mistake the five-per-region visibility cap for a disappearance, and would break the
              // terminal rule the day the cluster came back under its stable id. Closing is a decision
              // (Art. XIII), and decisions are the operator's.
              updatedAt: sql`now()`,
            },
          });
      }),
  };
}
