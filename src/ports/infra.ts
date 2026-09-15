// BEACON — Infrastructure ports (E1·T-090; ADR-001 Infra). Persistence, deltas, queue, geo, cache.
// Interface signatures only — NO framework/DB/HTTP imports (hexagonal boundary; adapters implement these).
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { Freshness } from '@/domain/value-objects/freshness.js';
import type { Geometry, PolygonGeometry, Position } from '@/domain/value-objects/geo.js';
import type { ServedMode } from '@/domain/source-record.js';

/**
 * Every data-bearing response carries its provenance freshness (contract invariant: provenance[]+freshness).
 * Shared envelope used by the source ports; defined here (infra has no domain-entity deps → no cycles).
 */
export interface Sourced<T> {
  readonly data: T;
  readonly freshness: Freshness;
}

/**
 * One source the COP consulted on a fetch cycle, in the shape the durable store keeps.
 * `sourceId` is the manifest id the operator sees (`firms`, `nws`) — the same key space `/sources` renders.
 */
export interface ProvenanceEntry {
  readonly sourceId: string;
  readonly adapter: string;
  /** SERVED mode (ADR-041 §3) — what produced the row, which is why `DB` is spellable here and nowhere in
   *  the ladder config. `source_record.mode`'s CHECK carries the same four values (migration 0010). */
  readonly mode: ServedMode;
  readonly fetchedAt: string; // ISO-8601
  readonly license?: string;
}

/**
 * Durable provenance mirror (ADR-039). Records which sources served, so the database fills itself from the
 * live world instead of only from a reference seed.
 *
 * Composed ONLY under `FEATURE_STORE=postgres`; the memory posture passes no sink at all and is unchanged.
 * Implementations UPSERT on the source's natural key: one current row per source, whose uuid stays stable
 * so citations can reference it. Callers treat a failure as "not persisted" and keep serving (Art. XVI).
 */
export interface ProvenanceSinkPort {
  record(entries: readonly ProvenanceEntry[]): Promise<Result<void, DomainError>>;
}

/** One incident the COP is currently showing, addressed by the ids the COP itself uses. */
export interface IncidentSnapshot {
  readonly incidentId: string; // domain id, e.g. `us-ca-wildfire-demo`
  readonly regionId: string; // region's config id, e.g. `us-ca`
  readonly type: string;
  readonly status: string;
}

/**
 * Durable incident mirror (ADR-039). Upserts on the incident's natural key, so the table holds the
 * incidents the COP is actually serving rather than only the reference seed's.
 *
 * THE MIRROR RECORDS; IT DOES NOT DECIDE. Each call refreshes `updated_at` on every incident in the batch —
 * "last seen by a composition" is the store's only lifecycle claim. An incident the COP stops serving (a
 * DISCOVERED cluster that dispersed, or that fell below the per-region visibility cap) simply stops being
 * refreshed, and its timestamp says when. The store never closes a row itself, and never reopens one an
 * operator closed: CLOSED is terminal (domain `canTransitionIncident`) and closing is an operator's
 * decision (Art. XIII).
 *
 * Separate from {@link ProvenanceSinkPort} on purpose: one records WHICH SOURCES SERVED, the other WHAT THE
 * PICTURE CONTAINS. They are composed together and fail independently — a broken incident write must not
 * cost us the provenance record, or vice versa.
 */
export interface IncidentSnapshotPort {
  record(incidents: readonly IncidentSnapshot[]): Promise<Result<void, DomainError>>;
}

/** Handle returned by a subscription; call to stop receiving events. */
export type Unsubscribe = () => void;

/**
 * Generic persistence boundary (ADR-013 — Drizzle/Postgres adapter implements it).
 * `T` is a domain entity; `Id` its branded id. No SQL/ORM types leak through this interface.
 */
export interface RepositoryPort<T, Id extends string = string> {
  getById(id: Id): Promise<Result<T | null, DomainError>>;
  save(entity: T): Promise<Result<T, DomainError>>;
  delete(id: Id): Promise<Result<void, DomainError>>;
  // Minimal filtered list; concrete adapters narrow the filter. `unknown` kept intentionally generic
  // at the port level (each repository defines its own query DTO) — see adapter for the real shape.
  list(filter?: unknown): Promise<Result<readonly T[], DomainError>>;
}

/** In-process/Redis-Streams event bus (FEATURE_EVENTBUS). Powers SSE deltas. */
export interface EventBusPort {
  publish<E>(topic: string, event: E): Promise<Result<void, DomainError>>;
  subscribe<E>(topic: string, handler: (event: E) => void): Result<Unsubscribe, DomainError>;
}

/** Async work queue (FEATURE_QUEUE: CRON default ↔ Redis+BullMQ flag). */
export interface QueuePort {
  enqueue<J>(queue: string, job: J): Promise<Result<string, DomainError>>; // returns job id
  process<J>(queue: string, handler: (job: J) => Promise<void>): Result<Unsubscribe, DomainError>;
}

/**
 * Deterministic geometry math (FEATURE_SPATIAL: Turf.js default ↔ PostGIS flag).
 * All numbers/exposures come from HERE, never from the LLM (Art. XII).
 */
export interface SpatialPort {
  pointInPolygon(point: Position, polygon: PolygonGeometry): Result<boolean, DomainError>;
  buffer(geom: Geometry, meters: number): Result<PolygonGeometry, DomainError>;
  intersect(a: Geometry, b: Geometry): Result<boolean, DomainError>;
}

/** Cache boundary (FEATURE_CACHE: in-memory default ↔ Redis flag). Also backs last-known-good. */
export interface CachePort {
  get<T>(key: string): Promise<Result<T | null, DomainError>>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<Result<void, DomainError>>;
  delete(key: string): Promise<Result<void, DomainError>>;
}
