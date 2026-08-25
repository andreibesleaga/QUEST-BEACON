// BEACON — Provenance / freshness stamper (E4·T-138; adapter-contract §2, source-ref.schema, F1).
// Every datum an adapter emits carries a SourceRecord (source, adapter, fetchedAt, license, mode).
// An emitted record without provenance fails the contract test — grounding is structural, not optional.
import { randomUUID } from 'node:crypto';
import { makeSourceRecord } from '@/domain/source-record.js';
import type { SourceId } from '@/domain/value-objects/ids.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { CanonicalRecord, FetchResult, SourceMode, SourceRecord } from './contract.js';

export interface ProvenanceInput {
  readonly adapterId: string; // == SourceRecord.adapter == manifest id
  readonly source: string; // display name, e.g. "NASA FIRMS"
  readonly license: string; // tracked in NOTICE (Art. XI)
  readonly mode: SourceMode; // LIVE | CACHED | MOCK
  readonly fetchedAt: string; // ISO-8601 freshness anchor
  readonly id?: string; // injectable uuid (deterministic tests); defaults to randomUUID()
}

/** Build the SourceRecord all rows of one fetch share. Validates via the domain factory (throws on breach). */
export function stampProvenance(input: ProvenanceInput): SourceRecord {
  return makeSourceRecord({
    id: asId<SourceId>(input.id ?? randomUUID()),
    source: input.source,
    adapter: input.adapterId,
    fetchedAt: input.fetchedAt,
    license: input.license,
    mode: input.mode,
  });
}

/** Newest fetchedAt across the records (the FetchResult freshness); falls back when there are no records. */
export function newestFreshness(records: readonly CanonicalRecord[], fallback: string): string {
  let newest = '';
  for (const r of records) {
    if (r.provenance.fetchedAt > newest) newest = r.provenance.fetchedAt;
  }
  return newest === '' ? fallback : newest;
}

/** Assemble a FetchResult with computed freshness. */
export function buildFetchResult<T>(
  records: readonly CanonicalRecord<T>[],
  mode: SourceMode,
  degraded: boolean,
  fallbackFreshness: string,
): FetchResult<T> {
  return { records, mode, degraded, freshness: newestFreshness(records, fallbackFreshness) };
}
