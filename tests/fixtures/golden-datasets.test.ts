// BEACON — golden-dataset fixture self-test (E9·T-401/T-401a). Proves the two demo-region datasets load
// into VALID domain entities and tell the expected story: CA wildfire served LIVE, RO flood served
// CACHED, exposures land inside/outside the hazard exactly as the deterministic engine must compute them.
// This is the fixture contract every downstream suite (redundancy, e2e) relies on.
import { describe, it, expect } from 'vitest';
import {
  loadCaliforniaWildfire,
  loadRomaniaFlood,
  loadScenario,
  SCENARIO_SLUGS,
  FakeSpatial,
} from '../_harness/index.js';
import type { PolygonGeometry } from '@/domain/value-objects/geo.js';

describe('golden datasets — both demo regions load into valid domain entities', () => {
  it.each(SCENARIO_SLUGS)('%s loads without throwing (factories validate on build)', (slug) => {
    const s = loadScenario(slug);
    expect(s.region.id).toBe(slug === 'california-wildfire' ? 'us-ca' : 'ro');
    expect(s.hazards.length).toBeGreaterThan(0);
    expect(s.infrastructure.length).toBeGreaterThan(0);
    expect(s.sources.length).toBeGreaterThan(0);
    expect(s.report.consent).toBe(true);
  });

  it('California is the LIVE flagship; Romania is the CACHED portability demo', () => {
    expect(loadCaliforniaWildfire().mode).toBe('LIVE');
    expect(loadRomaniaFlood().mode).toBe('CACHED');
  });

  it('every ingested datum carries provenance (F1): sources referenced by hazards exist', () => {
    const s = loadCaliforniaWildfire();
    const sourceIds = new Set(s.sources.map((src) => src.id));
    for (const h of s.hazards) expect(sourceIds.has(h.sourceId)).toBe(true);
  });
});

describe('golden datasets — expected exposures match deterministic point-in-polygon (F3 oracle)', () => {
  const spatial = new FakeSpatial();

  it.each(SCENARIO_SLUGS)('%s: inside-hazard expectations agree with FakeSpatial', (slug) => {
    const s = loadScenario(slug);
    const perimeter = s.hazards[0]!.geometry as PolygonGeometry;
    const nodeById = new Map(s.infrastructure.map((n) => [n.id as string, n]));
    for (const exp of s.expectedExposures) {
      const node = nodeById.get(exp.nodeId as string)!;
      const inside = spatial.pointInPolygon(
        (node.geom as unknown as { coordinates: [number, number] }).coordinates,
        perimeter,
      );
      expect(inside.ok && inside.value).toBe(exp.insideHazard);
    }
  });
});
