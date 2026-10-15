import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('has a valid dependency tree for CycloneDX SBOM generation', () => {
  const result = spawnSync('npm', ['ls', '--json', '--long', '--all'], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: 20_000,
  });

  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout).problems ?? []).toEqual([]);
});
