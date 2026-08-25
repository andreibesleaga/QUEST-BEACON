// BEACON — Governance ports (MW-D/D4; ADR-034 §5/§7, Art. XII/XIII/XIV). Interface signatures only.
//
// THREE PORTS, and the reason each is a port rather than a direct call:
//  • `GovernanceLedgerPort` — the append-only, hash-chained governance record. Defined here so a USE-CASE
//    THIS FILE KNOWS NOTHING ABOUT (the anticipatory-action engine, lane D2) can write governance records
//    without importing an adapter: `src/application/**` may import ports and never adapters
//    (`.dependency-cruiser.cjs` `application-no-adapters`). D2 depends on this interface; the chain lives
//    behind it in `src/adapters/governance/ledger.ts`.
//  • `RetentionStorePort` — the minimum surface an Art. XIV retention sweep needs from ANY store. This is
//    what makes the sweep executor testable with no database at all (F-25), and enforceable on both the
//    in-memory default and Postgres from ONE use-case.
//  • `DrillRecorderPort` — where an EXERCISE artifact goes instead of a channel. It accepts `DrillAlert`,
//    which is not assignable to `EmittableAlert`, so the two paths cannot be confused at the type level.
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { AppUserId, IncidentId } from '@/domain/value-objects/ids.js';
import type { AppUserRole } from '@/domain/app-user.js';
import type { LedgerAction, LedgerEntry } from '@/domain/governance.js';
import type { DrillAlert } from '@/domain/drill.js';

/**
 * One governance write. `at` is REQUIRED and is the caller's INJECTED clock — the port deliberately offers
 * no "default to now", so a governance record cannot be stamped from a wall-clock read (Art. XII
 * determinism; replay of a drill or an EAP episode must reproduce byte-identical entries).
 *
 * `actorId`/`actorRole` record WHO acted by id and role. There is no name field, and `evidence` is walked
 * for person-identifying keys and REJECTED if any is present (Art. XIV) — see `findPersonIdentifyingKey`.
 */
export interface LedgerAppendInput {
  readonly action: LedgerAction;
  readonly target: string;
  readonly at: string;
  readonly actorId?: AppUserId;
  readonly actorRole?: AppUserRole;
  /** The full evidence record. Digested into the chain; stored append-only beside it, never inside it. */
  readonly evidence?: unknown;
  readonly incidentId?: IncidentId;
  readonly regionId?: string;
}

/** The outcome of verifying the whole ledger. Fail-closed: `intact:false` names where and why. */
export interface LedgerVerification {
  readonly intact: boolean;
  readonly entries: number;
  /** 1-based `seq` of the first bad entry (absent when intact). */
  readonly brokenAt?: number;
  /** `CHAIN_LINK` = a spliced/edited chain entry; `EVIDENCE_DIGEST` = the stored evidence was mutated. */
  readonly reason?: 'CHAIN_LINK' | 'EVIDENCE_DIGEST';
}

/**
 * The append-only governance ledger (FR-GOV-1 / FEV-19). `append` returns a `Result` rather than throwing
 * so a caller in a request path fails closed with a typed error instead of crashing.
 */
export interface GovernanceLedgerPort {
  append(input: LedgerAppendInput): Result<LedgerEntry, DomainError>;
  /** The chain, in append order. Read-only — there is no update and no delete. */
  readonly entries: readonly LedgerEntry[];
  /** The evidence record behind a digest, or `undefined` if this ledger never recorded it. */
  evidenceFor(digest: string): unknown;
  verify(): LedgerVerification;
}

/** A row whose retention clock has run out. `id` is a surrogate identifier — never a person. */
export interface RetentionCandidate {
  readonly id: string;
  readonly purgeAfter: string;
}

/**
 * The store-side half of the Art. XIV retention sweep. Two operations, both id-only: find what has expired
 * as of an injected instant, and hard-delete it. Implemented by the in-memory report store (the offline
 * default) and by a Postgres adapter, so the guarantee is not conditional on which store is configured.
 */
export interface RetentionStorePort {
  /** Honest label of what is being swept, carried into the sweep report ('memory' | 'postgres'). */
  readonly storeLabel: string;
  /** What the sweep is about — used in the ledger target (e.g. `public_report`). */
  readonly datasetLabel: string;
  expired(asOf: string): Promise<Result<readonly RetentionCandidate[], DomainError>>;
  purge(ids: readonly string[]): Promise<Result<number, DomainError>>;
}

/** Aggregate-only sweep outcome: counts and instants, never the ids of what was purged (Art. XIV). */
export interface RetentionSweepReport {
  readonly asOf: string;
  readonly store: string;
  readonly dataset: string;
  readonly expired: number;
  readonly purged: number;
  /** The ledger link committing this sweep, when a ledger was supplied. */
  readonly ledgerHash?: string;
}

/** A recorded EXERCISE artifact. `sink` is honest labelling: no channel, no network, ever. */
export interface DrillRecord {
  readonly alertId: string;
  readonly capStatus: 'EXERCISE';
  readonly label: string;
  readonly recordedAt: string;
  readonly ledgerHash: string;
  readonly sink: 'DRILL_RECORDER';
}

/** Where a drill artifact goes. Accepts ONLY `DrillAlert` — an `EmittableAlert` does not fit, and vice versa. */
export interface DrillRecorderPort {
  record(artifact: DrillAlert, at: string): Result<DrillRecord, DomainError>;
  readonly records: readonly DrillRecord[];
}
