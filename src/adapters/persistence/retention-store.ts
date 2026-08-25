// BEACON — Postgres retention store: the durable half of the Art. XIV purge sweep (MW-D/D4.3, F-25).
//
// `public_report.purge_after` has been stamped at intake and INDEXED since E3 (`idx_public_report_purge`,
// `schema/intel-tables.ts:42`) — the index existed for a sweep that was never written. This adapter is the
// query behind that index; the policy and the governance record live in the pure use-case
// (`src/application/governance/retention-sweep.ts`), so this file contains no retention number and no clock.
//
// SCOPE, stated precisely: deleting the `public_report` row removes everything personal the report carries —
// `geom_precise` (the responder-only SOS location), `live_view_url` (the consent-gated stream link),
// `geom_generalized`, the confidence blend and the receipt instant, because they are COLUMNS ON THAT ROW.
// The hash-chained triage audit in `audit_event` is deliberately NOT touched: it holds an action, an instant
// and a surrogate id (`public_report:<id>|actor:<id>`) — no personal data — and deleting from a hash chain
// destroys the tamper-evidence the chain exists to provide.
import { inArray, lte } from 'drizzle-orm';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { RetentionCandidate, RetentionStorePort } from '@/ports/governance.js';
import type { Db } from './client';
import { tryResult } from './repository';
import { publicReport } from './schema';

/**
 * Build the durable retention store. Same `RetentionStorePort` surface as the in-memory report store, so ONE
 * sweep executor enforces retention whichever store `FEATURE_STORE` selects — a sweep that only worked on
 * Postgres would leave the DEFAULT (memory) configuration unenforced, i.e. would not close F-25 at all.
 */
export function makePgRetentionStore(db: Db): RetentionStorePort {
  return {
    storeLabel: 'postgres',
    datasetLabel: 'public_report',

    /** Rows at or before the cutoff instant. Read id + deadline only — never the report body. */
    expired(asOf: string): Promise<Result<readonly RetentionCandidate[], DomainError>> {
      return tryResult(async () => {
        const rows = await db
          .select({ id: publicReport.id, purgeAfter: publicReport.purgeAfter })
          .from(publicReport)
          .where(lte(publicReport.purgeAfter, new Date(asOf)));
        return rows.map(
          (r): RetentionCandidate => ({
            id: r.id,
            purgeAfter: r.purgeAfter ? r.purgeAfter.toISOString() : '',
          }),
        );
      });
    },

    /** Hard DELETE — not a soft flag. A row marked "purged" that is still readable is not purged. */
    purge(ids: readonly string[]): Promise<Result<number, DomainError>> {
      return tryResult(async () => {
        if (ids.length === 0) return 0;
        const deleted = await db
          .delete(publicReport)
          .where(inArray(publicReport.id, [...ids]))
          .returning({ id: publicReport.id });
        return deleted.length;
      });
    },
  };
}
