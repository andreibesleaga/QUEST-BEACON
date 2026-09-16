// BEACON — SourceAdapter contract types (E4·T-130; adapter-contract.md §1-3, ADR-001). The adapter-layer
// port every data-source adapter satisfies, plus the canonical envelope (provenance is STRUCTURAL, F1).
// Reuses the domain Result/SourceRecord (no duplication — Rule of Three): these are the SAME primitives,
// parameterised with the adapter failure type. Part-B adapters depend ONLY on this module + `redundancy`.
import type { Result } from '@/domain/shared/result.js';
import type { SourceMode, SourceRecord } from '@/domain/source-record.js';
import type { AdapterError } from './errors.js';
import type { Geometry } from '@/domain/value-objects/geo.js';

export type { Result, SourceMode, SourceRecord };
export { ok, err, isOk, isErr } from '@/domain/shared/result.js';

/** Every adapter method returns this: a value, or a typed AdapterError (never a raw throw). */
export type AdapterResult<T> = Result<T, AdapterError>;

/** A canonical domain entity (HazardGeometry, Gauge, …) paired with its mandatory provenance (Art. XI). */
export interface CanonicalRecord<T = unknown> {
  readonly entity: T;
  readonly provenance: SourceRecord;
}

/** The unit an adapter serves: mapped records + freshness + the effective (possibly degraded) mode. */
export interface FetchResult<T = unknown> {
  readonly records: readonly CanonicalRecord<T>[];
  readonly freshness: string; // newest fetchedAt across records (ISO-8601)
  readonly mode: SourceMode; // effective mode actually served (may differ after fallback)
  readonly degraded: boolean; // true when served from cache/mock or a fallback rung
}

export type Region = {
  readonly id: string;
  readonly bbox: readonly [number, number, number, number]; // [minLon,minLat,maxLon,maxLat] WGS-84
  readonly iso?: string; // ISO-3166-1 alpha-2 — optional, gates COUNTRIES coverage (OP4)
  /** The region's outline (ADR-042): a served record must touch it, not merely the bbox. Optional. */
  readonly boundary?: Geometry;
  /**
   * Areas of interest inside the region (ADR-045): the boxes around the incidents the picture is being
   * assembled for, `[minLon,minLat,maxLon,maxLat]` each. An upstream that cannot answer for a whole region
   * (Overpass across California times out; OpenCelliD caps an area at 4 km²) is asked about these instead.
   * Adapters that ignore it are unchanged. Optional; absent ⇒ the region bbox as before.
   */
  readonly focus?: readonly (readonly [number, number, number, number])[];
};

export type Coverage =
  | { readonly kind: 'GLOBAL' }
  | { readonly kind: 'BBOX'; readonly bbox: readonly [number, number, number, number] }
  | { readonly kind: 'COUNTRIES'; readonly iso: readonly string[] };

export type HealthState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'; // circuit-breaker state

export interface AdapterHealth {
  readonly state: HealthState;
  readonly lastSuccessAt?: string;
  readonly consecutiveFailures: number;
  readonly lastError?: AdapterError;
}

/**
 * The base contract every source adapter implements (P1–P13 source ports extend it). `<T>` is the
 * canonical entity. `fetch` walks the redundancy ladder (live → cache → mock → unavailable), never
 * throws upstream, and stamps provenance/freshness/degraded (adapter-contract §3.1).
 */
export interface SourceAdapterPort<T = unknown> {
  readonly id: string;
  readonly coverage: Coverage;
  readonly mode: SourceMode;
  fetch(region: Region): Promise<AdapterResult<FetchResult<T>>>;
  health(): AdapterHealth;
  ping?(): Promise<AdapterResult<true>>;
}

/** Context passed to a mapper for one fetch (shared provenance id + fetch instant). */
export interface MapContext {
  readonly fetchedAt: string; // ISO-8601
  readonly sourceRecordId: string; // uuid — the SourceRecord all rows in this fetch share
}

/**
 * The anti-corruption boundary (adapter-contract §4): map ONE raw upstream element to a canonical domain
 * entity. Pure; no I/O. MUST throw/return a typed PARSE on a shape it cannot map (never silently drop).
 */
export interface AntiCorruptionMapper<RawShape, T> {
  toCanonical(raw: RawShape, ctx: MapContext): T;
}
