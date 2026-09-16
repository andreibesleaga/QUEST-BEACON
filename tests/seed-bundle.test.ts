// BEACON — the seed bundle must run under plain node, from the runtime image's shape (Copilot, PR #15).
//
// WHY THIS EXISTS. `scripts/build-seed.mjs` bundles the TypeScript seed into `dist/seed.mjs` so the runner
// image — `npm ci --omit=dev`, no tsx, no src/ — can seed the live database as its pre-deploy command. The
// first version shipped with a proof that only showed the bundle LOADS (it failed on the missing
// DATABASE_URL before reading anything). Review caught what that proof could not: two registry loaders
// resolve `config/*.json` relative to `import.meta.url`, which inside the bundle is the bundle's own path, so
// in production the seed would have died on ENOENT before its first INSERT. Observed:
//   seed failed: … ENOENT … open '/home/andrei/work/IEEE/config/regions.json'
//
// So this test runs the REAL bundle with plain `node` from a fresh directory that holds only `config/`, the
// way /app does in the runner image, against an unreachable database. The seed must get PAST every config
// read and die on the database — "Failed query" is success here. A second case runs it from a directory
// with no config/ at all and pins that the fallback is cwd-based, i.e. the runner MUST ship config/ (it
// does: infra/Dockerfile COPYs it). The build itself runs here too, so a bundle that no longer builds fails
// this test rather than the deploy.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const BUNDLE = join(ROOT, 'dist', 'seed.mjs');
// A closed port on loopback: the connection is refused immediately, so the run never waits on a timeout.
const UNREACHABLE_DB = 'postgres://u:p@127.0.0.1:1/db';

function runBundle(cwd: string): { status: number | null; stderr: string } {
  const r = spawnSync(process.execPath, [BUNDLE], {
    cwd,
    env: { ...process.env, DATABASE_URL: UNREACHABLE_DB },
    encoding: 'utf8',
    timeout: 25_000,
  });
  return { status: r.status, stderr: r.stderr };
}

describe('dist/seed.mjs — the seed as the runtime image runs it', () => {
  let runnerShaped: string;
  let bare: string;

  beforeAll(() => {
    execFileSync(process.execPath, ['scripts/build-seed.mjs'], {
      cwd: ROOT,
      stdio: 'pipe',
      timeout: 60_000,
    });
    runnerShaped = mkdtempSync(join(tmpdir(), 'beacon-seed-runner-'));
    cpSync(join(ROOT, 'config'), join(runnerShaped, 'config'), { recursive: true });
    bare = mkdtempSync(join(tmpdir(), 'beacon-seed-bare-'));
  }, 90_000);

  afterAll(() => {
    rmSync(runnerShaped, { recursive: true, force: true });
    rmSync(bare, { recursive: true, force: true });
  });

  it('reads every config file from a cwd that holds only config/, and reaches the database', () => {
    const { status, stderr } = runBundle(runnerShaped);
    expect(status).not.toBe(0); // the database is unreachable on purpose
    // Past every config read: the failure is the FIRST SQL STATEMENT, not a file.
    expect(stderr).toMatch(/Failed query|ECONNREFUSED|connect/);
    expect(stderr).not.toMatch(/ENOENT/);
    expect(stderr).not.toMatch(/\.json/);
  });

  it('fails on config/regions.json — by name — when the cwd has no config/, so the fallback is provably cwd-based', () => {
    const { status, stderr } = runBundle(bare);
    expect(status).not.toBe(0);
    // This is the failure the runner image would show if infra/Dockerfile stopped copying config/.
    expect(stderr).toMatch(/ENOENT/);
    expect(stderr).toContain(join(bare, 'config', 'regions.json'));
  });
});
