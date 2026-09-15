// BEACON — Art. XIV retention sweep EXECUTOR (MW-D/D4.3; finding F-25).
// Pure use-case: ports + domain only, no adapters, no filesystem, no wall clock.
//
// WHAT THIS CLOSES. `PublicReport.purgeAfter` has always been stamped at intake and indexed in the DDL
// (`src/domain/public-report.ts:33`, `src/adapters/persistence/schema/intel-tables.ts:22,42`), and
// RESPONSIBLE_DATA.md / Art. XIV claim "no PII retention beyond the incident lifecycle" on the strength of
// it — but NOTHING ever deleted an expired row. The guarantee was claimed in docs and unenforced in code
// (F-25). This module is the missing executor.
//
// DESIGN CHOICES, each load-bearing:
//  • CLOCK-INJECTED, never a wall-clock read: `deps.clock()` is called exactly once per sweep and that one
//    instant is the cutoff basis, so a sweep is reproducible and a test can pin it.
//  • STORE-AGNOSTIC: it talks to `RetentionStorePort`, so the same executor enforces retention on the
//    in-memory default AND on Postgres. A sweep that only worked on the durable store would leave the
//    DEFAULT configuration unenforced — i.e. would not fix F-25 at all.
//  • AGGREGATE-ONLY REPORTING: the report and the ledger evidence carry counts and instants, never the ids
//    of what was deleted (Art. XIV — a purge record must not become a shadow copy of the purged).
//  • DELETION IS NEVER BLOCKED ON THE LEDGER. `alert-sink.ts` audits BEFORE emitting because emission is an
//    irreversible PUBLIC act that must not happen unrecorded. Retention is the mirror image: it is a
//    PRIVACY OBLIGATION, so refusing to delete because the ledger is unavailable would violate the very
//    article the sweep exists to satisfy. The purge therefore runs first and the ledger append follows; a
//    failed append is returned as an error CARRYING the count, so the operator learns that rows were
//    deleted and the record did not land, rather than either outcome being silent.
//  • THE LEDGER/AUDIT CHAIN IS EXEMPT BY DESIGN. It stores ids, actions and hashes — no PII — and deleting
//    from a hash chain destroys tamper-evidence. Retention deletes the row that HOLDS the personal data
//    (precise geometry, live-view URL, contact-free report body); the chain keeps only that a decision was
//    made about a surrogate id.
import type { Result } from '@/domain/shared/result.js';
import { err, ok } from '@/domain/shared/result.js';
import { DomainError } from '@/domain/errors.js';
import type {
  GovernanceLedgerPort,
  RetentionStorePort,
  RetentionSweepReport,
} from '@/ports/governance.js';
import type { RetentionConfig } from './governance-config.js';
import { DEFAULT_GOVERNANCE_CONFIG } from './governance-config.js';

const MINUTE_MS = 60_000;

export interface RetentionSweepDeps {
  readonly store: RetentionStorePort;
  /** The ONE injected instant a sweep is computed from (ISO-8601 UTC). Never `Date.now()` inside. */
  readonly clock: () => string;
  readonly ledger?: GovernanceLedgerPort;
  readonly config?: RetentionConfig;
}

/**
 * The deletion cutoff: rows whose `purgeAfter` is at or before this instant are past their retention
 * deadline (plus any configured grace) and must go. Exported because it is the whole policy in one line and
 * deserves its own assertions.
 */
export function retentionCutoff(now: string, config: RetentionConfig): Result<string, DomainError> {
  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs)) {
    return err(new DomainError('PARSE_ERROR', `retention sweep clock is not an instant: ${now}`));
  }
  return ok(new Date(nowMs - config.sweepGraceMinutes * MINUTE_MS).toISOString());
}

/**
 * Run one retention sweep. Deterministic given the injected clock and the store's contents; safe to run
 * repeatedly (a second sweep at the same instant finds nothing left to purge).
 */
export async function runRetentionSweep(
  deps: RetentionSweepDeps,
): Promise<Result<RetentionSweepReport, DomainError>> {
  const config = deps.config ?? DEFAULT_GOVERNANCE_CONFIG.retention;
  const asOf = deps.clock();
  const cutoffResult = retentionCutoff(asOf, config);
  if (!cutoffResult.ok) return cutoffResult;
  const cutoff = cutoffResult.value;
  const candidates = await deps.store.expired(cutoff);
  if (!candidates.ok) return candidates;
  const ids = candidates.value.map((c) => c.id);
  const purged = ids.length === 0 ? ok(0) : await deps.store.purge(ids);
  if (!purged.ok) return purged;
  const report: RetentionSweepReport = {
    asOf,
    store: deps.store.storeLabel,
    dataset: deps.store.datasetLabel,
    expired: ids.length,
    purged: purged.value,
  };
  return recordSweep(deps.ledger, report, config, cutoff);
}

/** Append the aggregate-only governance record for a completed sweep (counts + instants, never ids). */
function recordSweep(
  ledger: GovernanceLedgerPort | undefined,
  report: RetentionSweepReport,
  config: RetentionConfig,
  cutoff: string,
): Result<RetentionSweepReport, DomainError> {
  if (ledger === undefined) return ok(report);
  const appended = ledger.append({
    action: 'RETENTION_PURGE',
    target: `retention:${report.dataset}`,
    at: report.asOf,
    evidence: {
      store: report.store,
      dataset: report.dataset,
      cutoff,
      retentionDays: config.publicReportRetentionDays,
      graceMinutes: config.sweepGraceMinutes,
      expired: report.expired,
      purged: report.purged,
    },
  });
  if (!appended.ok) {
    // The rows ARE gone (privacy first, see the header). Say so in the error rather than hiding either half.
    return err(
      new DomainError(
        appended.error.code,
        `retention sweep purged ${report.purged} row(s) from ${report.store}:${report.dataset} but the ` +
          `governance record failed to append: ${appended.error.message}`,
      ),
    );
  }
  return ok({ ...report, ledgerHash: appended.value.hash });
}
