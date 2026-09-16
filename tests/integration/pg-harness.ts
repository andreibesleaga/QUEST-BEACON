// BEACON — the real-Postgres test harness (V2·WP-0).
//
// WHY THIS EXISTS. An all-lens review of WP A2 (2026-09-10) found THREE blocking defects in work whose
// entire unit suite was green. Every one of those tests drove a hand-rolled chainable fake that asserts
// statement SHAPE and never statement BEHAVIOUR — so a work package made entirely of SQL semantics had no
// test that ran SQL, and all three defects lived exactly in the gap that leaves:
//
//   B1  neither durable sink was composed on the production path, so four tables stayed empty in silence;
//   B2  a multi-row `ON CONFLICT DO UPDATE` carrying duplicate keys — the shape the real batch always has,
//       because one source is enabled in several regions — is REJECTED OUTRIGHT by Postgres
//       ("ON CONFLICT DO UPDATE command cannot affect row a second time"). A fake happily accepted it;
//   B3  migration 0007 never ran the DELETE its own header describes, so the UNIQUE index build failed on
//       precisely the database the dedup block exists for, rolling back 0008 and 0009 with it.
//
// A fake cannot model any of those: Postgres's cardinality rule, a constraint build over real duplicates,
// or a `where` clause that actually filters. This harness is the missing rung.
//
// OPT-IN BY DESIGN. Everything here is skipped unless `DATABASE_URL_TEST` names a throwaway database, so
// `npm test` and CI are untouched until someone deliberately opts in. That is also why the guard is a
// SKIP and not a failure: a contributor without Docker must still get a green suite, while the lane stays
// one env var away.
//
//   docker run -d --name beacon-pg -e POSTGRES_PASSWORD=beacon -e POSTGRES_USER=beacon \
//     -e POSTGRES_DB=beacon -p 55432:5432 postgres:16-alpine
//   DATABASE_URL_TEST=postgres://beacon:beacon@localhost:55432/beacon npm run test:integration
import { readFileSync, readdirSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from '@/adapters/persistence/schema';

/** The opt-in switch. Absent ⇒ every suite in this directory skips rather than fails. */
export const PG_URL = process.env['DATABASE_URL_TEST'];

/** `describe.skipIf(NO_PG)` at the top of every integration suite. */
export const NO_PG = PG_URL === undefined || PG_URL === '';

export type IntegrationDb = ReturnType<typeof drizzle<typeof schema>>;

export interface Harness {
  readonly db: IntegrationDb;
  readonly raw: postgres.Sql;
  readonly close: () => Promise<void>;
}

/**
 * Open a connection to the throwaway database. `max: 1` deliberately: these suites assert on shared table
 * state, so a pool would let two statements interleave and turn a real ordering defect into a flake — or,
 * worse, hide one.
 */
export function connect(): Harness {
  if (NO_PG)
    throw new Error('connect() called without DATABASE_URL_TEST — guard the suite with NO_PG');
  const raw = postgres(PG_URL as string, { max: 1, onnotice: () => undefined });
  return { db: drizzle(raw, { schema }), raw, close: async () => raw.end({ timeout: 5 }) };
}

/**
 * Drop and recreate `public`, then apply every migration in `drizzle/` in journal order.
 *
 * Applying the REAL migration files — rather than pushing the Drizzle schema — is the whole point: B3 was
 * a defect in a migration file that the schema definition knew nothing about. A harness that built tables
 * from `schema.ts` would have reproduced the green result that missed it.
 */
export async function resetAndMigrate(h: Harness): Promise<readonly string[]> {
  await h.raw.unsafe('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  const applied: string[] = [];
  for (const file of migrationFiles()) {
    await h.raw.unsafe(readFileSync(`drizzle/${file}`, 'utf8'));
    applied.push(file);
  }
  return applied;
}

/**
 * The migration files in lexical order, which is also journal order because drizzle-kit prefixes every
 * file with a zero-padded index. Read from disk rather than hardcoded so a migration added later is
 * covered by this lane automatically instead of being silently skipped.
 */
export function migrationFiles(): readonly string[] {
  return readdirSync('drizzle')
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/** Apply every migration EXCEPT those at or after `stopBefore` — used to build a realistic pre-upgrade database. */
export async function migrateUpTo(h: Harness, stopBefore: string): Promise<void> {
  await h.raw.unsafe('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  for (const file of migrationFiles()) {
    if (file >= stopBefore) break;
    await h.raw.unsafe(readFileSync(`drizzle/${file}`, 'utf8'));
  }
}

/** Apply one migration by filename prefix (e.g. '0007'). Throws the driver error verbatim — that IS the assertion. */
export async function applyMigration(h: Harness, prefix: string): Promise<void> {
  const file = migrationFiles().find((f) => f.startsWith(prefix));
  if (file === undefined) throw new Error(`no migration matching ${prefix}`);
  await h.raw.unsafe(readFileSync(`drizzle/${file}`, 'utf8'));
}

/** Row count for a table — the bluntest possible assertion, and the one B1 needed. */
export async function countRows(h: Harness, table: string): Promise<number> {
  const rows = await h.db.execute(sql.raw(`SELECT count(*)::int AS n FROM "${table}"`));
  return Number((rows as unknown as readonly { n: number }[])[0]?.n ?? 0);
}
