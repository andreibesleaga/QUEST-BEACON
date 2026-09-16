// BEACON — Recorded-mock loader tests (E4·T-137; ADR-009/OP3). A present fixture loads; a configured but
// absent fixture is a fail-fast CONFIG error (not a silent empty result).
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadFixtureText, loadFixtureJson } from './recorded-mock.js';

const firmsFixtures = fileURLToPath(new URL('../sources/firms/__fixtures__', import.meta.url));

describe('recorded-mock loader', () => {
  it('loads a present fixture as raw text', async () => {
    const res = await loadFixtureText(firmsFixtures, 'hotspots.csv');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toContain('latitude,longitude');
  });

  it('returns CONFIG (fail-fast) when the fixture is absent', async () => {
    const res = await loadFixtureText(firmsFixtures, 'does-not-exist.csv');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('CONFIG');
  });

  it('parses a JSON fixture, CONFIG on invalid JSON path', async () => {
    const res = await loadFixtureJson(firmsFixtures, 'nope.json');
    expect(res.ok).toBe(false);
  });
});
