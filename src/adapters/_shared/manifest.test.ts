// BEACON — Manifest contract tests (E4·T-144; FR-10/manifest-schema/U5). The shipped config/adapters.json
// validates against the manifest schema; an invalid entry fails boot; breaker/cache config derives from
// an entry (zero-core-change onboarding).
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { validateManifest, findEntry, breakerFromEntry, cacheTtlFromEntry } from './manifest.js';

const schema = JSON.parse(readFileSync('schemas/adapter-manifest.schema.json', 'utf8')) as object;
const adaptersJson = JSON.parse(readFileSync('config/adapters.json', 'utf8')) as unknown;

describe('validateManifest', () => {
  it('accepts the shipped config/adapters.json', () => {
    const res = validateManifest(adaptersJson, schema);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const firms = findEntry(res.value, 'firms');
    expect(firms?.port).toBe('HazardSource');
    expect(firms?.mode).toBe('LIVE');
  });

  it('rejects an entry missing a required field (fail-fast boot check)', () => {
    const bad = { adapters: [{ id: 'x', port: 'HazardSource' }] }; // missing coverage/mode/intervalSec/license
    const res = validateManifest(bad, schema);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });

  it('rejects an id that is not kebab-case', () => {
    const bad = {
      adapters: [
        {
          id: 'Bad_Id',
          port: 'HazardSource',
          coverage: { kind: 'GLOBAL' },
          mode: 'MOCK',
          intervalSec: 300,
          license: 'PD',
        },
      ],
    };
    expect(validateManifest(bad, schema).ok).toBe(false);
  });

  it('derives breaker + cache config from a manifest entry', () => {
    const res = validateManifest(adaptersJson, schema);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const firms = findEntry(res.value, 'firms');
    expect(firms).toBeDefined();
    if (!firms) return;
    expect(breakerFromEntry(firms)).toMatchObject({ failureThreshold: 5, cooldownSec: 120 });
    expect(cacheTtlFromEntry(firms)).toBe(900);
  });

  it('applies defaults when the circuitBreaker block is omitted', () => {
    const entry = {
      id: 'x',
      port: 'HazardSource' as const,
      coverage: { kind: 'GLOBAL' as const },
      mode: 'MOCK' as const,
      intervalSec: 300,
      license: 'PD',
    };
    expect(breakerFromEntry(entry)).toMatchObject({ failureThreshold: 5, cooldownSec: 120 });
    expect(cacheTtlFromEntry(entry)).toBe(900);
  });
});
