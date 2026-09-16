// BEACON — bundle the TypeScript seed into ONE plain-node file for the runtime image (2026-09-12).
//
// WHY. `npm run db:seed` is `tsx src/adapters/persistence/seed.ts`. The runtime image is built with
// `npm ci --omit=dev`, so it has no tsx, no src/ tree and no tsconfig path mapping — the exact situation
// scripts/migrate.mjs already exists for. Railway's Postgres has no public URL and the container accepts
// no SSH, so on 2026-09-12 there was NO way to seed the live database at all. This runs in the BUILD
// stage (devDependencies present) and emits `dist/seed.mjs`, which the runner stage COPYs beside
// migrate.mjs and the pre-deploy command runs with plain `node`.
//
// esbuild is NOT a new dependency: it is what tsx and drizzle-kit already run on, resolved from the same
// lockfile. Only the production dependencies the seed needs (drizzle-orm, postgres, zod) stay external —
// they are in the runner image's node_modules; everything under src/ is inlined.
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
await build({
  entryPoints: ['src/adapters/persistence/seed.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  outfile: 'dist/seed.mjs',
  tsconfig: 'tsconfig.json', // honours the `@/` path alias
  external: ['drizzle-orm', 'drizzle-orm/*', 'postgres', 'zod'],
  logLevel: 'info',
  // The seed decides whether it was invoked directly by comparing import.meta.url to argv[1]; a bundle
  // keeps that intact because the bundle IS the file node runs.
});
