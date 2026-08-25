// BEACON — Infrastructure ports (E1·T-090; ADR-001 Infra). Persistence, deltas, queue, geo, cache.
// Interface signatures only — NO framework/DB/HTTP imports (hexagonal boundary; adapters implement these).
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { Freshness } from '@/domain/value-objects/freshness.js';
import type { Geometry, PolygonGeometry, Position } from '@/domain/value-objects/geo.js';

/**
 * Every data-bearing response carries its provenance freshness (contract invariant: provenance[]+freshness).
 * Shared envelope used by the source ports; defined here (infra has no domain-entity deps → no cycles).
 */
export interface Sourced<T> {
  readonly data: T;
  readonly freshness: Freshness;
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
