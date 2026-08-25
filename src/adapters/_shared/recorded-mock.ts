// BEACON — Recorded-mock loader (E4·T-136/T-137; adapter-contract §3.1.4, ADR-009/OP3). Loads a
// deterministic recorded upstream response from an adapter's fixtures dir so the SAME ACL maps it —
// the mock rung is byte-for-byte a recorded live response. Powers the air-gapped acceptance test.
// A configured-but-absent fixture is a CONFIG failure (fail-fast), not a silent empty result (T-137).
import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { AdapterResult } from './contract.js';
import { ok, err } from './contract.js';
import { makeAdapterError, errorMessage } from './errors.js';

/** Read a fixture as text (CSV/XML/JSON left raw for the adapter's ACL to map). */
export async function loadFixtureText(
  fixturesDir: string,
  fixture: string,
): Promise<AdapterResult<string>> {
  const path = isAbsolute(fixture) ? fixture : join(fixturesDir, fixture);
  try {
    return ok(await readFile(path, 'utf8'));
  } catch (e) {
    return err(
      makeAdapterError('CONFIG', `recorded-mock fixture not found: ${path} (${errorMessage(e)})`, {
        retryable: false,
      }),
    );
  }
}

/** Read + parse a JSON fixture. CONFIG on missing file or invalid JSON. */
export async function loadFixtureJson<T>(
  fixturesDir: string,
  fixture: string,
): Promise<AdapterResult<T>> {
  const text = await loadFixtureText(fixturesDir, fixture);
  if (!text.ok) return text;
  try {
    return ok(JSON.parse(text.value) as T);
  } catch (e) {
    return err(makeAdapterError('CONFIG', `invalid mock JSON in ${fixture}: ${errorMessage(e)}`, { retryable: false }));
  }
}
