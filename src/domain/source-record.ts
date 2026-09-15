// BEACON — SOURCE_RECORD entity (E1·T-066/T-067). Provenance anchor (Art. XI).
// Every ingested datum links here. Pure TS — no framework/HTTP/DB imports (F9).
import type { SourceId } from './value-objects/ids.js';
import { InvariantViolation } from './errors.js';
import { makeFreshness } from './value-objects/freshness.js';

// THE LADDER RUNGS. A per-source CONFIGURATION: how an adapter should TRY to get its data
// (`SOURCE_<NAME>_MODE`, the adapter manifest, the per-region override map). Exactly three, forever — see
// SERVED_MODES below for why `DB` is deliberately not one of them.
export const SOURCE_MODES = ['LIVE', 'CACHED', 'MOCK'] as const;
export type SourceMode = (typeof SOURCE_MODES)[number];

// THE SERVED-PROVENANCE VOCABULARY (ADR-041 §3). A different question from the one above: not "how should
// this adapter try", but "where did the datum I am showing you actually come from". `DB` answers it for a
// record NOBODY PUBLISHES — an operator-maintained row held in BEACON's own store. It makes no claim about
// the outside world and never implies upstream freshness; a `DB` row's `fetchedAt` is its LAST EDIT.
//
// DERIVED, NEVER RE-TYPED (the F-24/F-140/F-171 discipline): the served set IS the ladder set plus `DB`, so
// widening the ladder cannot leave this behind. The reverse widening is refused on purpose — no adapter
// fetches `DB`, so `SOURCE_FIRMS_MODE=DB` would be a configuration that cannot mean anything, which is why
// `adapter-manifest.schema.json` and `regions.schema.json` keep exactly three values.
//
// Why not simply keep `MOCK` for operator rows: `MOCK` means RECORDED FIXTURE — invented data standing in
// for real data. A shelter occupancy an EM entered an hour ago is real operational fact, and consistently
// labelling true data as fake erodes the label just as surely as the reverse. Why not `CACHED`: that is
// defined as a last-known-good copy OF AN UPSTREAM RESPONSE, and here there is no upstream at all.
export const SERVED_MODES = [...SOURCE_MODES, 'DB'] as const;
export type ServedMode = (typeof SERVED_MODES)[number];

export interface SourceRecord {
  readonly id: SourceId;
  readonly source: string; // logical source name (e.g. "NASA FIRMS")
  readonly adapter: string; // adapter id (e.g. "firms-adapter")
  readonly fetchedAt: string; // freshness anchor (U1), ISO-8601 UTC
  readonly license: string; // license string — NOTICE tracking (Art. XI)
  /** SERVED provenance, not ladder config: what actually produced this row (LIVE|CACHED|MOCK|DB). */
  readonly mode: ServedMode;
}

export interface MakeSourceRecordInput {
  readonly id: SourceId;
  readonly source: string;
  readonly adapter: string;
  readonly fetchedAt: string;
  readonly license: string;
  readonly mode: ServedMode;
}

/** Construct a SourceRecord; every field is mandatory (provenance must be complete to be trustworthy). */
export function makeSourceRecord(input: MakeSourceRecordInput): SourceRecord {
  if (!input.source?.trim()) throw new InvariantViolation('SourceRecord.source is required');
  if (!input.adapter?.trim()) throw new InvariantViolation('SourceRecord.adapter is required');
  if (!input.license?.trim()) throw new InvariantViolation('SourceRecord.license is required');
  if (!SERVED_MODES.includes(input.mode)) {
    throw new InvariantViolation(`SourceRecord.mode invalid: ${String(input.mode)}`);
  }
  // Reuse the Freshness VO to reject NaN/future fetch timestamps (clock-skew guard, U1).
  try {
    makeFreshness(input.fetchedAt);
  } catch (e) {
    throw e instanceof InvariantViolation ? e : new InvariantViolation(String(e));
  }
  return {
    id: input.id,
    source: input.source,
    adapter: input.adapter,
    fetchedAt: input.fetchedAt,
    license: input.license,
    mode: input.mode,
  };
}
