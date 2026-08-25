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

// max: 1 — a migrator needs exactly one connection; pooling would only slow shutdown.
const client = postgres(url, { max: 1 });
try {
  await migrate(drizzle(client), { migrationsFolder: './drizzle' });
  console.log('migrations applied (drizzle/ → __drizzle_migrations up to date)');
} finally {
  await client.end();
}
