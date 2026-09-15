// BEACON — Vitest config (E0·T-006, extended for E8 frontend). Coverage gate ≥99% line+branch on
// domain+application (F-core). Backend tests run in the 'node' env; React component tests declare
// `// @vitest-environment happy-dom` at the top of the file (per-file, version-safe). JSX is compiled
// via esbuild's automatic runtime so no extra plugin is needed.
import { coverageConfigDefaults, defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  esbuild: {
    jsx: 'automatic', // React 19 automatic runtime (no `import React` needed in components)
  },
  test: {
    globals: true,
    environment: 'node', // default; frontend tests opt into happy-dom via a per-file docblock
    setupFiles: ['./vitest.setup.ts'],
    // F-363. Vitest's default is 5000 ms, and two live-composition tests legitimately take ~4.1 s and ~4.7 s
    // in isolation — a ~6% margin. Under full-suite parallel load they cross it, so `npm test` exited 1
    // REPRODUCIBLY while the same files passed alone. That is the F-157 shape: a result that depends on
    // machine load rather than on the code, which this project's determinism rule forbids. CI runs on a
    // 2-core runner with no override, so it was strictly more exposed than a dev box.
    //
    // This raises the CEILING; it does not hide a slow test. The two tests are slow for a real reason
    // (they compose the live adapter graph), and nothing here weakens an assertion — the alternative fix,
    // making live composition lazy, is a behaviour change and belongs in its own task, not in a config
    // tweak made to turn a gate green.
    testTimeout: 30_000,
    include: [
      'tests/**/*.test.ts',
      'src/**/*.test.ts',
      'app/**/*.test.{ts,tsx}', // frontend component tests (App Router UI)
      'src/**/*.test.tsx',
    ],
    // Playwright specs live under e2e/ and run with their own runner — never collected by Vitest.
    // `tests/integration/**` is the opt-in real-Postgres lane (V2·WP-0) and runs under
    // `vitest.integration.config.ts` via `npm run test:integration`; collecting it here would make the
    // default suite depend on a running database.
    exclude: ['**/node_modules/**', 'e2e/**', 'tests/integration/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      // Two-tier gate (TEST_PLAN §2): domain+application carry the ≥99% floor; the composition root, the
      // adapter layer and the frontend carry their own measured-minus-margin floors (ratchet upward only).
      //
      // F-365: `app/**` was omitted from this list entirely — 71 source files unmeasured, and that is exactly
      // where F-360/F-361/F-362 lived. AN EXCLUDED PATH IS AN UNMEASURED PATH: the "≥99%" headline applied
      // only to domain+application, and the frontend could (and did) ship whole request-assembly defects
      // without moving a single number. Adding it is the point of the finding, so nothing under `app/` is
      // exempted here — not `layout.tsx`, not the three Next `route.ts` delegators, not the WebGL map engine.
      // Each of those currently reads 0% and is COUNTED as 0%; a floor that quietly excluded them would be
      // the same defect wearing a different mask. The one exclusion is the test-only harness under
      // `app/**/__testing__/`, which is test infrastructure exactly like a `*.test.ts` file (already excluded
      // by `coverageConfigDefaults`) and would otherwise inflate the frontend number with its own execution.
      include: ['src/domain/**', 'src/application/**', 'src/main/**', 'src/adapters/**', 'app/**'],
      exclude: [...coverageConfigDefaults.exclude, 'app/**/__testing__/**'],
      thresholds: {
        'src/domain/**': { lines: 99, branches: 99, functions: 99, statements: 99 },
        'src/application/**': { lines: 99, branches: 99, functions: 99, statements: 99 },
        'src/main/**': { lines: 97, branches: 79, functions: 96, statements: 97 },
        'src/adapters/**': { lines: 90, branches: 83, functions: 93, statements: 90 },
        // MEASURED 2026-08-02, immediately after the F-366 hook tests landed: lines 90.57 · branches 87.95 ·
        // functions 90.27 · statements 90.57 (full suite, `vitest run --coverage`, 306 files / 3771 passed).
        // The floor is that measurement minus a ~1.5-point margin — the same shape as the `main`/`adapters`
        // floors above, and for the same reason: enough slack that an unrelated lane adding a small amount of
        // frontend code does not turn the gate red, and not one point more. It is a RATCHET: raise it when the
        // measurement rises, never lower it to accommodate a regression. No number here was invented — every
        // one of these four was read off an actual run.
        'app/**': { lines: 89, branches: 86, functions: 89, statements: 89 },
      },
    },
  },
});
