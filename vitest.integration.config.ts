// BEACON — the real-Postgres integration lane (V2·WP-0).
//
// A SEPARATE project from `vitest.config.ts` on purpose. These suites talk to a live database, share table
// state, and are opt-in via `DATABASE_URL_TEST`; folding them into the default run would make `npm test`
// depend on Docker and would mix their timings and coverage into the unit gate. `npm test` stays exactly
// what it was — see `tests/integration/pg-harness.ts` for why this lane had to exist at all.
//
//   docker run -d --name beacon-pg -e POSTGRES_PASSWORD=beacon -e POSTGRES_USER=beacon \
//     -e POSTGRES_DB=beacon -p 55432:5432 postgres:16-alpine
//   DATABASE_URL_TEST=postgres://beacon:beacon@localhost:55432/beacon npm run test:integration
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/**/*.integration.test.ts'],
    // Every suite in this lane resets and re-migrates the SAME database. Running them in parallel would
    // let one suite's DROP SCHEMA land inside another's assertions — turning a real defect into a flake,
    // or hiding one. Serial is not a performance compromise here; it is the correctness requirement.
    fileParallelism: false,
    // Applying the full migration set from empty, several times over, is legitimately slower than a unit
    // test. This ceiling is generous so a slow container never reads as a failure.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // No coverage thresholds: this lane exists to prove BEHAVIOUR against a real engine, and measuring it
    // as coverage would invite writing integration tests to move a number rather than to prove a property.
  },
});
