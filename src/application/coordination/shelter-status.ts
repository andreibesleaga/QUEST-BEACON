// BEACON — SHELTER STATUS BOARD + CSV export (MW-D/D5.3; FR-D4-3 `FEATURE_D4_SHELTER_STATUS`, FEV-22,
// ADR-036 §7). Pure application layer: PORTS + DOMAIN only (F9/ADR-001).
//
// F-35, STATED HONESTLY RATHER THAN PAPERED OVER. There is still **no shelter SOURCE ADAPTER** in this
// repo — shelters are hand-seeded (`src/adapters/persistence/seed.ts:66`). Building the FEMA Open-Shelters
// ArcGIS adapter is `src/adapters/sources/**` work, which is NOT in D5's file set (finding F-154). So this
// board makes the provenance a REQUIRED, TYPED input instead of a hopeful assumption: every board carries a
// `SourceMode` (`LIVE|CACHED|MOCK`, imported from the domain — not a fourth private copy of that vocabulary)
// and renders a claim string that can only say "live" when the mode IS `LIVE`. Feeding hand-seeded shelters
// in produces a board that says so, at every render and in the CSV header comment-free header row's
// accompanying metadata (`ShelterStatusBoard.provenanceClaim`). Art. XVI: never claim LIVE for MOCK data.
//
// AGGREGATE-ONLY (Art. XIV). A row is `{shelterId, status, capacity, occupancy, available, utilization}` —
// counts and a ratio. No occupant, no household, no roster, and no `geom`: a shelter's precise point belongs
// to the map projection (`ProjectedShelter`), which is already role-gated, and putting it in an exportable
// CSV would move a location into a file that leaves the system. The export path additionally re-checks at
// runtime via `guardAggregateOnly` (ADR-035 §4 Layer D) — the type is not trusted at the one irreversible
// step, exactly as `alert-sink.ts:121` re-checks `asEmittable` before serializing a CAP document.
//
// NOT RE-DERIVED: `SHELTER_STATUSES` and the capacity/occupancy invariants come from `@/domain/shelter.js`;
// shelter DEMAND (residents needing shelter vs Σ available) is already quantified by
// `src/application/impact/shelter-demand.ts` and is NOT recomputed here — this board reports SUPPLY.
import type { ShelterId } from '@/domain/value-objects/ids.js';
import type { Shelter, ShelterStatus } from '@/domain/shelter.js';
import { SHELTER_STATUSES } from '@/domain/shelter.js';
import type { SourceMode } from '@/domain/source-record.js';
import { SOURCE_MODES } from '@/domain/source-record.js';
import { DomainError } from '@/domain/errors.js';
import type { Result } from '@/domain/shared/result.js';
import { ok, err } from '@/domain/shared/result.js';
import type { AggregateOnly } from '@/domain/shared/aggregate-only.js';
import { guardAggregateOnly } from '@/application/privacy/incident-summary-guard.js';
import { toCsv, type CsvColumn } from './csv.js';

export interface ShelterStatusRow {
  readonly shelterId: ShelterId;
  readonly status: ShelterStatus;
  readonly capacity: number;
  readonly occupancy: number;
  /**
   * capacity − occupancy: PHYSICAL spare space, never negative (the domain's occupancy ≤ capacity invariant
   * guarantees it). ⚠ It is NOT an intake decision: a CLOSED shelter with an empty hall still reports its
   * spare space here. `totals.availableOpen` is the operationally meaningful number — spare space at OPEN
   * shelters only — and exists precisely so nobody reads a closed shelter's spare hall as intake capacity.
   */
  readonly available: number;
  /** occupancy ÷ capacity, rounded to 2 dp (F-96 precedent: a labelled ratio never carries float residue).
   *  A zero-capacity shelter reports 0 — a ratio with no denominator is not an occupancy figure. */
  readonly utilization: number;
}

/** Layer A (ADR-035 §4): the exported row shape may never acquire a person-identifying key. */
export type AggregateShelterRow = AggregateOnly<ShelterStatusRow>;

export interface ShelterStatusTotals {
  readonly shelters: number;
  readonly capacity: number;
  readonly occupancy: number;
  /** Σ physical spare space over ALL shelters (including CLOSED ones) — see `ShelterStatusRow.available`. */
  readonly available: number;
  /** Σ spare space at OPEN shelters only — the number that answers "where can people go right now?". */
  readonly availableOpen: number;
  readonly utilization: number;
  /** Shelter COUNT per status; every status key present (zeros included) — derived from the domain union. */
  readonly byStatus: Readonly<Record<ShelterStatus, number>>;
}

export interface ShelterStatusProvenance {
  /** LIVE | CACHED | MOCK — the domain's own vocabulary (`src/domain/source-record.ts:8`). */
  readonly mode: SourceMode;
  /** Where the rows came from, in words an operator can check (e.g. 'hand-seeded demo shelters'). */
  readonly sourceLabel: string;
  /** ISO-8601 as-of instant, INJECTED by the caller — this module never reads a clock. */
  readonly asOf: string;
}

export interface ShelterStatusBoard {
  readonly rows: readonly AggregateShelterRow[];
  readonly totals: ShelterStatusTotals;
  readonly provenance: ShelterStatusProvenance;
  /** The one sentence every shelter surface renders. Says LIVE only when the mode is LIVE. */
  readonly provenanceClaim: string;
}

export interface ShelterStatusInput {
  readonly shelters: readonly Shelter[];
  readonly provenance: ShelterStatusProvenance;
}

/** Round a ratio to 2 dp deterministically (no locale, no float residue on a labelled approximate figure). */
function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 100) / 100;
}

function rowOf(shelter: Shelter): AggregateShelterRow {
  const row: ShelterStatusRow = {
    shelterId: shelter.id,
    status: shelter.status,
    capacity: shelter.capacity,
    occupancy: shelter.occupancy,
    available: shelter.capacity - shelter.occupancy,
    utilization: ratio(shelter.occupancy, shelter.capacity),
  };
  // The Layer-A gate: assignable ONLY while ShelterStatusRow is person-identifying-key free.
  return row;
}

function emptyByStatus(): Record<ShelterStatus, number> {
  return Object.fromEntries(SHELTER_STATUSES.map((s) => [s, 0])) as Record<ShelterStatus, number>;
}

/** The provenance sentence. The word "live" is reachable ONLY through `mode === 'LIVE'`. */
export function shelterProvenanceClaim(provenance: ShelterStatusProvenance): string {
  const asOf = `as of ${provenance.asOf}`;
  if (provenance.mode === 'LIVE') return `Live shelter data from ${provenance.sourceLabel} (${asOf}).`;
  if (provenance.mode === 'CACHED') {
    return `CACHED shelter data from ${provenance.sourceLabel} — not a current reading (${asOf}).`;
  }
  return `MOCK/seeded shelter data from ${provenance.sourceLabel} — illustrative, NOT an operational feed (${asOf}).`;
}

/**
 * Build the shelter supply board. Deterministic and total: same input ⇒ same output, no clock, no I/O.
 * Rows are ordered by shelter id so the board (and its CSV) is byte-stable across runs.
 */
export function buildShelterStatusBoard(input: ShelterStatusInput): Result<ShelterStatusBoard, DomainError> {
  if (!SOURCE_MODES.includes(input.provenance.mode)) {
    return err(
      new DomainError(
        'PARSE_ERROR',
        `Shelter board provenance.mode must be one of ${SOURCE_MODES.join('|')}, got ${String(input.provenance.mode)}`,
      ),
    );
  }
  const rows = [...input.shelters].sort((a, b) => a.id.localeCompare(b.id)).map(rowOf);
  const byStatus = emptyByStatus();
  for (const shelter of input.shelters) byStatus[shelter.status] += 1;
  const capacity = rows.reduce((sum, r) => sum + r.capacity, 0);
  const occupancy = rows.reduce((sum, r) => sum + r.occupancy, 0);
  const availableOpen = rows.reduce((sum, r) => sum + (r.status === 'OPEN' ? r.available : 0), 0);
  return ok({
    rows,
    totals: {
      shelters: rows.length,
      capacity,
      occupancy,
      available: capacity - occupancy,
      availableOpen,
      utilization: ratio(occupancy, capacity),
      byStatus,
    },
    provenance: input.provenance,
    provenanceClaim: shelterProvenanceClaim(input.provenance),
  });
}

/** The exported columns, in order. Adding one here is the ONLY way a column reaches the CSV. */
export const SHELTER_CSV_COLUMNS: readonly CsvColumn<AggregateShelterRow>[] = [
  { header: 'shelter_id', value: (r) => r.shelterId },
  { header: 'status', value: (r) => r.status },
  { header: 'capacity', value: (r) => r.capacity },
  { header: 'occupancy', value: (r) => r.occupancy },
  { header: 'available', value: (r) => r.available },
  { header: 'utilization', value: (r) => r.utilization },
];

/**
 * Export the board as RFC 4180 CSV — the one place shelter data physically LEAVES the system, so it is
 * fail-closed: `guardAggregateOnly` re-walks the actual rows at runtime and a person-identifying key
 * anywhere in the object graph aborts the export with the offending paths named (ADR-035 §4 Layer D). The
 * error branch is terminal: the caller gets no document at all, never a redacted one.
 */
export function shelterStatusCsv(board: ShelterStatusBoard): Result<string, DomainError> {
  const guarded = guardAggregateOnly(board.rows);
  if (!guarded.ok) {
    return err(
      new DomainError(
        'CONFLICT',
        `Shelter CSV export refused — person-identifying field(s) present: ${guarded.error.keys.join(', ')}`,
      ),
    );
  }
  return ok(toCsv(guarded.value, SHELTER_CSV_COLUMNS));
}
