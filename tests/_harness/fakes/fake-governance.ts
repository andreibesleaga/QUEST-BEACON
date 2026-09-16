// BEACON test harness — in-memory governance fakes (MW-D/D4; TEST_PLAN §4).
//
// `FakeGovernanceLedger` is a RECORDER, not a chain: it deliberately does NOT reimplement hash linking,
// because a second chaining implementation — even in test code — is the thing ADR-034 §5 argues against.
// Its `hash` values are synthetic sequential labels. The REAL chaining, tamper-evidence and PII refusal are
// covered against the real writer in `src/adapters/governance/ledger.test.ts`; these fakes exist so PURE
// application use-cases can be tested without importing an adapter (the `application-no-adapters` boundary
// holds for test files too, enforced by `.dependency-cruiser.cjs` + eslint `no-restricted-imports`).
import type { LedgerEntry } from '@/domain/governance.js';
import { makeLedgerEntry } from '@/domain/governance.js';
import { DomainError } from '@/domain/errors.js';
import type { Result } from '@/domain/shared/result.js';
import { err, ok } from '@/domain/shared/result.js';
import type {
  GovernanceLedgerPort,
  LedgerAppendInput,
  LedgerVerification,
  RetentionCandidate,
  RetentionStorePort,
} from '@/ports/governance.js';

/** Mirrors the real adapter's digested envelope shape so an assertion written here holds there too. */
function envelopeOf(
  input: LedgerAppendInput,
): { actorRole?: string; evidence?: unknown } | undefined {
  if (input.actorRole === undefined && input.evidence === undefined) return undefined;
  return {
    ...(input.actorRole !== undefined ? { actorRole: input.actorRole } : {}),
    ...(input.evidence !== undefined ? { evidence: input.evidence } : {}),
  };
}

export class FakeGovernanceLedger implements GovernanceLedgerPort {
  private readonly log: LedgerEntry[] = [];
  private readonly evidence = new Map<string, unknown>();
  /** Set to a code to make the NEXT append fail (exercises the fail-closed paths in the use-cases). */
  public failNextAppend: 'CONFLICT' | 'INVARIANT_VIOLATION' | undefined = undefined;
  /** Every input as received — lets a test assert exactly what a use-case chose to record. */
  public readonly appended: LedgerAppendInput[] = [];

  append(input: LedgerAppendInput): Result<LedgerEntry, DomainError> {
    if (this.failNextAppend !== undefined) {
      const code = this.failNextAppend;
      this.failNextAppend = undefined;
      return err(new DomainError(code, `injected ledger failure for ${input.action}`));
    }
    // Mirror the real writer's fail-closed input validation so a use-case's error path is exercised the
    // same way here as in production (the real one is `src/adapters/governance/ledger.ts` `validate`).
    if (Number.isNaN(Date.parse(input.at))) {
      return err(
        new DomainError(
          'INVARIANT_VIOLATION',
          `ledger 'at' must be an ISO-8601 instant, got ${input.at}`,
        ),
      );
    }
    this.appended.push(input);
    const seq = this.log.length + 1;
    const envelope = envelopeOf(input);
    const digest = envelope === undefined ? undefined : `ev-${seq}`;
    if (digest !== undefined) this.evidence.set(digest, envelope);
    const entry = makeLedgerEntry({
      seq,
      action: input.action,
      target: input.target,
      at: input.at,
      hash: `h-${seq}`,
      ...(input.actorId !== undefined ? { actorId: input.actorId } : {}),
      ...(input.actorRole !== undefined ? { actorRole: input.actorRole } : {}),
      ...(digest !== undefined ? { evidenceDigest: digest } : {}),
      ...(seq > 1 ? { prevHash: `h-${seq - 1}` } : {}),
    });
    this.log.push(entry);
    return ok(entry);
  }

  get entries(): readonly LedgerEntry[] {
    return this.log;
  }

  evidenceFor(digest: string): unknown {
    return this.evidence.get(digest);
  }

  verify(): LedgerVerification {
    return { intact: true, entries: this.log.length };
  }
}

/** In-memory `RetentionStorePort`: rows are `{id, purgeAfter}` pairs, so no database is involved at all. */
export class FakeRetentionStore implements RetentionStorePort {
  public readonly storeLabel: string;
  public readonly datasetLabel = 'public_report';
  /** Ids passed to the last `purge` call — lets a test assert the sweep asked for exactly the expired set. */
  public purgeCalls: readonly string[][] = [];
  public failExpired = false;
  public failPurge = false;
  /** When set, `purge` reports fewer deletions than requested (a row vanished between query and delete). */
  public purgedOverride: number | undefined = undefined;

  private rows: Map<string, string>;

  constructor(rows: Readonly<Record<string, string>> = {}, storeLabel = 'fake') {
    this.rows = new Map(Object.entries(rows));
    this.storeLabel = storeLabel;
  }

  expired(asOf: string): Promise<Result<readonly RetentionCandidate[], DomainError>> {
    if (this.failExpired) {
      return Promise.resolve(err(new DomainError('PARSE_ERROR', 'injected expired() failure')));
    }
    const cutoff = Date.parse(asOf);
    const due = [...this.rows.entries()]
      .filter(([, purgeAfter]) => Date.parse(purgeAfter) <= cutoff)
      .map(([id, purgeAfter]): RetentionCandidate => ({ id, purgeAfter }));
    return Promise.resolve(ok(due));
  }

  purge(ids: readonly string[]): Promise<Result<number, DomainError>> {
    this.purgeCalls = [...this.purgeCalls, [...ids]];
    if (this.failPurge) {
      return Promise.resolve(err(new DomainError('CONFLICT', 'injected purge() failure')));
    }
    let removed = 0;
    for (const id of ids) if (this.rows.delete(id)) removed += 1;
    return Promise.resolve(ok(this.purgedOverride ?? removed));
  }

  /** Remaining rows — a test asserts the PII is actually gone, not just reported as gone. */
  get remaining(): readonly string[] {
    return [...this.rows.keys()];
  }
}
