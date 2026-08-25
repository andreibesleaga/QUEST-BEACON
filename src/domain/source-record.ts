// BEACON — SOURCE_RECORD entity (E1·T-066/T-067). Provenance anchor (Art. XI).
// Every ingested datum links here. Pure TS — no framework/HTTP/DB imports (F9).
import type { SourceId } from './value-objects/ids.js';
import { InvariantViolation } from './errors.js';
import { makeFreshness } from './value-objects/freshness.js';

// Mode enum mirrors schema.sql CHECK (source_record.mode) — the live/cached/mock config flag.
export const SOURCE_MODES = ['LIVE', 'CACHED', 'MOCK'] as const;
export type SourceMode = (typeof SOURCE_MODES)[number];

export interface SourceRecord {
  readonly id: SourceId;
  readonly source: string; // logical source name (e.g. "NASA FIRMS")
  readonly adapter: string; // adapter id (e.g. "firms-adapter")
  readonly fetchedAt: string; // freshness anchor (U1), ISO-8601 UTC
  readonly license: string; // license string — NOTICE tracking (Art. XI)
  readonly mode: SourceMode;
}

export interface MakeSourceRecordInput {
  readonly id: SourceId;
  readonly source: string;
  readonly adapter: string;
  readonly fetchedAt: string;
  readonly license: string;
  readonly mode: SourceMode;
}

/** Construct a SourceRecord; every field is mandatory (provenance must be complete to be trustworthy). */
export function makeSourceRecord(input: MakeSourceRecordInput): SourceRecord {
  if (!input.source?.trim()) throw new InvariantViolation('SourceRecord.source is required');
  if (!input.adapter?.trim()) throw new InvariantViolation('SourceRecord.adapter is required');
  if (!input.license?.trim()) throw new InvariantViolation('SourceRecord.license is required');
  if (!SOURCE_MODES.includes(input.mode)) {
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
