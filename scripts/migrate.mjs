// BEACON — production migrator (WP-B1.2). Runs the committed SQL migrations in `drizzle/` against
// DATABASE_URL using drizzle-orm's programmatic migrator. Exists because the runtime image prunes
// devDependencies (`npm ci --omit=dev`), so `drizzle-kit` is NOT available where Railway runs the
// pre-deploy command — but `drizzle-orm` + the `postgres` driver ARE production deps, and the
// migrator only needs the SQL files + meta/_journal.json (COPY'd into the image by infra/Dockerfile).
//
//   Railway → service Settings → Deploy → Pre-deploy command:  node scripts/migrate.mjs
//   Anywhere else:                                             DATABASE_URL=<url> node scripts/migrate.mjs
//
// Idempotent: drizzle records applied entries in __drizzle_migrations and skips them on re-run.
// Fail-fast: any error exits non-zero so a broken migration BLOCKS the deploy instead of shipping an
// app whose INSERTs would 42703 at runtime (the exact failure mode of the unjournaled-0006 incident).
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required (set it in the Railway service / shell environment).');
  process.exit(1);
}

// A POSTGRES ADVISORY LOCK, so two migrators cannot run at once (2026-09-11).
//
// Until now this script assumed a single caller — true on Railway, where it is one pre-deploy command,
// and false anywhere the app starts more than one replica at a time. Two concurrent drizzle migrators
// both read `__drizzle_migrations`, both decide the same file is unapplied, and both run it; the second
// fails on an object the first just created, and the deploy dies on a migration that was actually fine.
//
// The lock is session-scoped and released with the connection, so a killed migrator does not wedge the
// next one. The key is an arbitrary constant, unique to BEACON's migrator; any other process taking a
// different key is unaffected.
const MIGRATION_LOCK_KEY = 8_270_413_066_105_311n;

// max: 1 — a migrator needs exactly one connection; pooling would only slow shutdown, and the advisory
// lock below is session-scoped, so it must be taken and released on THE SAME connection.
const client = postgres(url, { max: 1 });
try {
  // Blocks (rather than failing) if another migrator holds it: a replica that waits its turn and then
  // finds nothing to do is correct; one that exits non-zero would fail a deploy for doing the right thing.
  await client`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
  await migrate(drizzle(client), { migrationsFolder: './drizzle' });
  console.log('migrations applied (drizzle/ → __drizzle_migrations up to date)');
} finally {
  await client.end();
}
