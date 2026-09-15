// BEACON — Drizzle client over DATABASE_URL (E3·T-115; ADR-012). Local Postgres ↔ Neon by env only.
// Adapter layer (Art. II) — the sole place that opens a DB connection. postgres-js driver (no engine binary).
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Build a Drizzle client bound to `url` (default: DATABASE_URL). Fail-fast at the composition
 * boundary if the URL is missing (12-factor config validation, AGENTS.md §14) — this is boot-time,
 * not a per-request path, so throwing here does not violate the "no throw upstream" repo rule.
 */
export function makeDb(url: string | undefined = process.env.DATABASE_URL): Db {
  if (!url) {
    throw new Error('DATABASE_URL is required to open the persistence adapter (ADR-012)');
  }
  return drizzle(postgres(url), { schema });
}

/**
 * Clients memoized BY URL. `makeDb` opens a NEW connection pool on every call, and the composition root
 * calls it from several independent seams (the durable store, the provenance mirror, the incident mirror,
 * the evac-route trail). Each pool defaults to 10 connections, so a handful of seams can exhaust a
 * free-tier Postgres connection ceiling at boot — a failure that looks like an outage, not a config bug.
 * Keying by URL rather than holding one global keeps the test seams (which pass an explicit URL) honest.
 */
const clients = new Map<string, Db>();

/** A process-wide client for `url`, opening its pool at most once. Prefer this over `makeDb` when composing. */
export function sharedDb(url: string | undefined = process.env.DATABASE_URL): Db {
  const key = url ?? '';
  const existing = clients.get(key);
  if (existing !== undefined) return existing;
  const db = makeDb(url);
  clients.set(key, db);
  return db;
}

/** Lazily-memoized process-wide client (one pool per process). */
export function getDb(): Db {
  return sharedDb();
}
