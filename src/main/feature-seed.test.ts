// BEACON — feature-seed composition tests (W4a; ADR-016, FR-7, Art. XVI). Proves the routing ladder:
// default/unset FEATURE_ROUTING stays the byte-identical heuristic-only rung; FEATURE_ROUTING=ors + a key
// composes the ORS rung with a fallback to the SAME hazard-avoiding heuristic on any ORS failure (never a
// raw straight line, never a dead-end); FEATURE_ROUTING=ors without a key never wires ORS (honest degrade,
// no crash — the fail-fast gate for this misconfiguration is EnvSchema's refine, exercised separately below).
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '@/config/index.js';
import { isOk } from '@/domain/shared/result.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { IncidentId } from '@/domain/value-objects/ids.js';
import type { HttpClient, HttpResponse } from '@/adapters/ai/http-client.js';
import { buildFeatureDeps, DEFAULT_FEATURE_SEED } from './feature-seed.js';

const CLOCK = () => '2026-07-05T22:00:00Z';
const CA_INCIDENT = asId<IncidentId>('us-ca-wildfire-demo');
const FROM: readonly [number, number] = [-121.6, 39.7];
const TO: readonly [number, number] = [-121.5, 39.7];

const SUCCESS_ORS_BODY = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { summary: { distance: 1200, duration: 90 } },
      geometry: {
        type: 'LineString',
        coordinates: [
          [-121.6, 39.7],
          [-121.55, 39.71],
          [-121.5, 39.7],
        ],
      },
    },
  ],
};

function fakeHttp(response: HttpResponse): HttpClient {
  return { postJson: () => Promise.resolve(response) };
}

function throwingHttp(): HttpClient {
  return { postJson: () => Promise.reject(new Error('network/timeout: fetch failed')) };
}

describe('buildFeatureDeps routing ladder', () => {
  it('defaults to the heuristic-only router when FEATURE_ROUTING is unset (byte-identical to today)', async () => {
    const deps = buildFeatureDeps({ clock: CLOCK, env: {} });
    const r = await deps.routing.route({ incidentId: CA_INCIDENT, from: FROM, to: TO });
    expect(isOk(r)).toBe(true);
    // The heuristic hazard-avoiding router runs against the seeded CA hazard box — avoidsHazard is decided
    // deterministically by the same memory-routing.ts logic as before this change (untouched).
    if (isOk(r)) expect(typeof r.value.avoidsHazard).toBe('boolean');
  });

  it('FEATURE_ROUTING=ors without ORS_API_KEY never wires ORS (falls back to the heuristic, no crash)', async () => {
    const deps = buildFeatureDeps({ clock: CLOCK, env: { FEATURE_ROUTING: 'ors' } });
    const r = await deps.routing.route({ incidentId: CA_INCIDENT, from: FROM, to: TO });
    expect(isOk(r)).toBe(true);
  });

  it('FEATURE_ROUTING=ors + ORS_API_KEY composes the ORS rung (success ⇒ ORS geometry, avoidsHazard=true)', async () => {
    const orsHttp = fakeHttp({ status: 200, ok: true, json: SUCCESS_ORS_BODY });
    const deps = buildFeatureDeps({
      clock: CLOCK,
      env: { FEATURE_ROUTING: 'ors', ORS_API_KEY: 'k' },
      orsHttp,
    });
    const r = await deps.routing.route({ incidentId: CA_INCIDENT, from: FROM, to: TO });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.avoidsHazard).toBe(true); // CA incident has a seeded Polygon hazard ⇒ avoid_polygons sent
    expect(r.value.geom.coordinates).toEqual([
      [-121.6, 39.7],
      [-121.55, 39.71],
      [-121.5, 39.7],
    ]);
  });

  it('ORS-down (HTTP 5xx) degrades to the hazard-avoiding heuristic — never a dead-end, never a raw straight line', async () => {
    const orsHttp = fakeHttp({ status: 503, ok: false, json: null });
    const deps = buildFeatureDeps({
      clock: CLOCK,
      env: { FEATURE_ROUTING: 'ors', ORS_API_KEY: 'k' },
      orsHttp,
    });
    const withoutOrs = buildFeatureDeps({ clock: CLOCK, env: {} });
    const lines: string[] = [];
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);
    try {
      const r = await deps.routing.route({ incidentId: CA_INCIDENT, from: FROM, to: TO });
      const heuristicOnly = await withoutOrs.routing.route({
        incidentId: CA_INCIDENT,
        from: FROM,
        to: TO,
      });
      expect(isOk(r)).toBe(true);
      expect(isOk(heuristicOnly)).toBe(true);
      // Same hazard-avoiding heuristic output as the no-ORS default (deterministic — same seed/clock/newId).
      if (isOk(r) && isOk(heuristicOnly)) expect(r.value.geom).toEqual(heuristicOnly.value.geom);
    } finally {
      stderr.mockRestore();
    }
    // The operator-visible reason for the degraded engine reaches the deploy log: typed code + message.
    const degraded = lines.filter((l) =>
      l.startsWith('[beacon] routing degraded: ors -> heuristic — '),
    );
    expect(degraded).toHaveLength(1);
    expect(degraded[0]).toMatch(/^\[beacon\] routing degraded: ors -> heuristic — [A-Z_]+: .+\n$/);
  });

  it('ORS-down (network throw) also degrades to the heuristic, never surfacing a raw error to the caller', async () => {
    const deps = buildFeatureDeps({
      clock: CLOCK,
      env: { FEATURE_ROUTING: 'ors', ORS_API_KEY: 'k' },
      orsHttp: throwingHttp(),
    });
    const r = await deps.routing.route({ incidentId: CA_INCIDENT, from: FROM, to: TO });
    expect(isOk(r)).toBe(true);
  });

  it('keeps the DEFAULT_FEATURE_SEED hazard map intact (no regression to the offline dataset)', () => {
    expect(DEFAULT_FEATURE_SEED.hazards.has(String(CA_INCIDENT))).toBe(true);
  });
});

describe('EnvSchema fail-fast (config/index.ts refine, exercised via loadConfig)', () => {
  it('FEATURE_ROUTING=ors without ORS_API_KEY throws at config load (the composition-time fail-fast gate)', () => {
    expect(() => loadConfig({ FEATURE_ROUTING: 'ors' })).toThrow(/ORS_API_KEY/);
  });

  it('FEATURE_ROUTING=ors with ORS_API_KEY loads cleanly', () => {
    expect(() => loadConfig({ FEATURE_ROUTING: 'ors', ORS_API_KEY: 'k' })).not.toThrow();
  });

  it('FEATURE_ROUTING defaults to heuristic when unset', () => {
    expect(loadConfig({}).FEATURE_ROUTING).toBe('heuristic');
  });
});
