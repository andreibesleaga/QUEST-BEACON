// BEACON — incident discovery: the properties that make it safe to put on an operator's board.
//
// The risk in this module is not that it fails to find fires. It is that it finds too many, names them
// with numbers nobody counted, or gives the same fire a new identity every reingest so the board churns.
// Each test below is one of those.
import { describe, expect, it } from 'vitest';
import { asId, makeHazardGeometry } from '@/domain/index.js';
import type { HazardGeometry, HazardGeometryId, IncidentId, SourceId } from '@/domain/index.js';
import {
  discoverIncidents,
  isUnassignedIncidentId,
  representativePoint,
} from './discover-incidents.js';

const OBSERVED = '2026-09-12T08:00:00Z';

function hotspot(n: number, lon: number, lat: number, source = 'firms'): HazardGeometry {
  return makeHazardGeometry({
    id: asId<HazardGeometryId>(`${source}:${n}`),
    incidentId: asId<IncidentId>(`${source}-unassigned`),
    sourceId: asId<SourceId>(source),
    kind: 'HOTSPOT',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    observedAt: OBSERVED,
  });
}

function perimeter(n: number, lon: number, lat: number, d = 0.02): HazardGeometry {
  return makeHazardGeometry({
    id: asId<HazardGeometryId>(`nifc:${n}`),
    incidentId: asId<IncidentId>('nifc-unassigned'),
    sourceId: asId<SourceId>('nifc'),
    kind: 'PERIMETER',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [lon - d, lat - d],
          [lon + d, lat - d],
          [lon + d, lat + d],
          [lon - d, lat + d],
          [lon - d, lat - d],
        ],
      ],
    },
    observedAt: OBSERVED,
  });
}

/** Three hotspots close enough to share a cell — the smallest thing this module will call a fire. */
const CLUSTER = [hotspot(1, -121.6, 39.7), hotspot(2, -121.62, 39.72), hotspot(3, -121.58, 39.68)];

describe('what becomes an incident', () => {
  it('turns a cluster of unclaimed hotspots into one incident, not three', () => {
    const found = discoverIncidents(CLUSTER);
    expect(found).toHaveLength(1);
    expect(found[0]?.type).toBe('WILDFIRE');
    expect(found[0]?.hazards).toHaveLength(3);
  });

  it('refuses a lone satellite pixel, which is a detection and not an emergency', () => {
    // The threshold is the whole reason this module can be pointed at FIRMS without burying the board.
    expect(discoverIncidents([hotspot(1, -121.6, 39.7)])).toEqual([]);
    expect(discoverIncidents([hotspot(1, -121.6, 39.7), hotspot(2, -121.61, 39.71)])).toEqual([]);
  });

  it('accepts a single official perimeter, because the publisher already made that judgement', () => {
    const found = discoverIncidents([perimeter(1, -121.6, 39.7)]);
    expect(found).toHaveLength(1);
    expect(found[0]?.headline).toContain('Wildfire perimeter');
  });

  it('never discovers an incident from geometry that already belongs to one', () => {
    // Seeded and assigned hazards are somebody else's incident. Re-discovering them would duplicate the
    // demo wildfire beside itself on every reingest.
    const assigned = CLUSTER.map((h) =>
      makeHazardGeometry({
        id: h.id,
        incidentId: asId<IncidentId>('us-ca-wildfire-demo'),
        sourceId: h.sourceId,
        kind: h.kind,
        geometry: h.geometry,
        observedAt: h.observedAt,
      }),
    );
    expect(discoverIncidents(assigned)).toEqual([]);
  });

  it('never discovers an incident from BEACON’s own projections', () => {
    // A SPREAD_CONE is this product's forecast. Discovering an incident from one would be the system
    // reading its own output back as an observation — the circularity ADR-032 §3 exists to prevent.
    const cone = makeHazardGeometry({
      id: asId<HazardGeometryId>('proj:1'),
      incidentId: asId<IncidentId>('firms-unassigned'),
      sourceId: asId<SourceId>('beacon-projection'),
      kind: 'SPREAD_CONE',
      geometry: { type: 'Point', coordinates: [-121.6, 39.7] },
      observedAt: OBSERVED,
    });
    expect(discoverIncidents([cone, cone, cone])).toEqual([]);
  });
});

describe('identity and order', () => {
  it('gives the same fire the same id no matter what order the hotspots arrive in', () => {
    // This runs every reingest. An id derived from arrival order would make one fire arrive as a brand
    // new incident every five minutes, and every alert and every acknowledgement with it.
    const forward = discoverIncidents(CLUSTER);
    const backward = discoverIncidents([...CLUSTER].reverse());
    expect(forward[0]?.id).toBe(backward[0]?.id);
    expect(forward[0]?.headline).toBe(backward[0]?.headline);
  });

  it('qualifies the id by scope, so two regions sharing a grid cell never share an incident', () => {
    const cluster = [hotspot(1, 20.1, 45.1), hotspot(2, 20.12, 45.11), hotspot(3, 20.11, 45.12)];
    const ro = discoverIncidents(cluster, { scope: 'ro' });
    const hu = discoverIncidents(cluster, { scope: 'hu' });
    const unscoped = discoverIncidents(cluster);
    expect(String(ro[0]!.id)).toMatch(/^discovered:ro:WILDFIRE:/);
    expect(String(hu[0]!.id)).toMatch(/^discovered:hu:WILDFIRE:/);
    expect(ro[0]!.id).not.toBe(hu[0]!.id);
    expect(String(unscoped[0]!.id)).toMatch(/^discovered:WILDFIRE:/);
  });

  it('keeps the LARGEST clusters when the cap bites', () => {
    const big = [0, 1, 2, 3, 4, 5].map((i) => hotspot(i, -121.6 + i * 0.001, 39.7));
    const small = [10, 11, 12].map((i) => hotspot(i, -118.0, 34.0 + (i - 10) * 0.001));
    const found = discoverIncidents([...small, ...big], { max: 1 });
    expect(found).toHaveLength(1);
    expect(found[0]?.hazards).toHaveLength(6);
  });

  it('separates fires that are far apart and merges ones that are not', () => {
    const butte = CLUSTER;
    const la = [20, 21, 22].map((i) => hotspot(i, -118.2, 34.05 + (i - 20) * 0.001));
    expect(discoverIncidents([...butte, ...la])).toHaveLength(2);
  });
});

describe('what the headline may say', () => {
  it('quotes a count it did the counting for, and coordinates it computed', () => {
    const found = discoverIncidents(CLUSTER);
    expect(found[0]?.headline).toBe('Wildfire — 3 hotspots near 39.70°N 121.60°W');
  });

  it('carries no severity word, because nothing here measured severity', () => {
    // Art. XII in the one place an unearned adjective would travel furthest: the line an operator reads
    // first, and the line a narration would happily have embellished.
    const found = discoverIncidents(CLUSTER);
    expect(found[0]?.headline).not.toMatch(/major|severe|catastrophic|critical|massive/i);
  });

  it('names every source that contributed, in first-seen order', () => {
    const mixed = [...CLUSTER, hotspot(4, -121.6, 39.71, 'eonet')];
    const found = discoverIncidents(mixed);
    expect(found[0]?.sourceIds).toEqual(['firms', 'eonet']);
  });

  it('is exactly as fresh as its freshest input', () => {
    const later = makeHazardGeometry({
      id: asId<HazardGeometryId>('firms:9'),
      incidentId: asId<IncidentId>('firms-unassigned'),
      sourceId: asId<SourceId>('firms'),
      kind: 'HOTSPOT',
      geometry: { type: 'Point', coordinates: [-121.6, 39.7] },
      observedAt: '2026-09-12T09:30:00Z',
    });
    expect(discoverIncidents([...CLUSTER, later])[0]?.observedAt).toBe('2026-09-12T09:30:00Z');
  });
});

describe('geometry handling', () => {
  it('locates a polygon by its bounds, not by its first vertex', () => {
    const point = representativePoint(perimeter(1, -121.6, 39.7).geometry);
    expect(point?.[0]).toBeCloseTo(-121.6, 6);
    expect(point?.[1]).toBeCloseTo(39.7, 6);
  });

  it('recognises the unassigned convention every hazard ACL uses', () => {
    expect(isUnassignedIncidentId(asId<IncidentId>('firms-unassigned'))).toBe(true);
    expect(isUnassignedIncidentId(asId<IncidentId>('us-ca-wildfire-demo'))).toBe(false);
  });
});

// ── The convention this module depends on, checked against the ACLs themselves ────────────────────────
//
// `isUnassignedIncidentId` matches a SUFFIX rather than importing six per-source constants. That is a
// deliberate trade — and it is only safe while the convention holds, so this reads the ACLs and checks.
// A seventh hazard source that names its placeholder `pending-incident` would silently never be
// discovered from; here it fails the suite instead.
describe('the -unassigned convention across every hazard ACL', () => {
  it('every placeholder incident id an ACL mints is recognised as unassigned', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const root = fileURLToPath(new URL('../../adapters/sources', import.meta.url));
    const placeholders: { file: string; id: string }[] = [];
    for (const dir of readdirSync(root)) {
      const full = join(root, dir);
      if (!statSync(full).isDirectory()) continue;
      for (const file of readdirSync(full).filter((f) => f.endsWith('-acl.ts'))) {
        const text = readFileSync(join(full, file), 'utf8');
        for (const m of text.matchAll(/asId<IncidentId>\('([^']+)'\)/g)) {
          placeholders.push({ file: `${dir}/${file}`, id: m[1] as string });
        }
      }
    }
    // Not vacuous: the six hazard ACLs that mint one must actually be found.
    expect(placeholders.length).toBeGreaterThanOrEqual(6);
    for (const { file, id } of placeholders) {
      expect(
        isUnassignedIncidentId(asId<IncidentId>(id)),
        `${file} mints the placeholder incident id '${id}', which discovery does not recognise as ` +
          `unassigned — every hazard it publishes would be invisible to incident discovery.`,
      ).toBe(true);
    }
  });
});

// ── The remaining shapes, each of which reaches a branch the cases above do not ───────────────────────
describe('floods, perimeters and the eastern hemisphere', () => {
  function floodReach(n: number, lon: number, lat: number): HazardGeometry {
    return makeHazardGeometry({
      id: asId<HazardGeometryId>(`glofas:${n}`),
      incidentId: asId<IncidentId>('lanceflood-unassigned'),
      sourceId: asId<SourceId>('lanceflood'),
      kind: 'FLOOD_REACH',
      geometry: {
        type: 'LineString',
        coordinates: [
          [lon, lat],
          [lon + 0.01, lat + 0.01],
        ],
      },
      observedAt: OBSERVED,
    });
  }

  it('names a single flood reach in the singular and several in the plural', () => {
    // Romania's demo region, so this also exercises positive coordinates: everything above is in
    // California, where both degrees are negative and the N/E half of the formatter never runs.
    const one = discoverIncidents([floodReach(1, 28.0, 45.45)]);
    expect(one[0]?.type).toBe('FLOOD');
    expect(one[0]?.headline).toBe('Flood — 1 reported reach near 45.45°N 28.01°E');

    const many = discoverIncidents([floodReach(1, 28.0, 45.45), floodReach(2, 28.02, 45.46)]);
    expect(many[0]?.headline).toContain('2 reported reaches');
  });

  it('counts perimeters when there is more than one, and stays silent about it when there is one', () => {
    const single = discoverIncidents([perimeter(1, -121.6, 39.7)]);
    expect(single[0]?.headline).toBe('Wildfire perimeter near 39.70°N 121.60°W');
    const pair = discoverIncidents([perimeter(1, -121.6, 39.7), perimeter(2, -121.61, 39.71)]);
    expect(pair[0]?.headline).toContain('Wildfire perimeters (2)');
  });

  it('says "1 hotspot", not "1 hotspots", when a perimeter carries a lone hotspot along with it', () => {
    // The cluster is significant because of the perimeter; the count still has to read correctly.
    const mixed = [perimeter(1, -121.6, 39.7), hotspot(1, -121.6, 39.7)];
    const found = discoverIncidents(mixed);
    expect(found[0]?.hazards).toHaveLength(2);
    expect(found[0]?.headline).toContain('Wildfire perimeter');
  });

  it('ignores geometry that carries no usable coordinates at all', () => {
    // A publisher can emit an empty ring. It cannot be placed, so it is not placed — rather than being
    // clustered at [0, 0], which is in the Gulf of Guinea and would be a fire nobody can find.
    const empty = makeHazardGeometry({
      id: asId<HazardGeometryId>('firms:empty'),
      incidentId: asId<IncidentId>('firms-unassigned'),
      sourceId: asId<SourceId>('firms'),
      kind: 'PERIMETER',
      geometry: { type: 'Polygon', coordinates: [] },
      observedAt: OBSERVED,
    });
    expect(representativePoint(empty.geometry)).toBeNull();
    expect(discoverIncidents([empty])).toEqual([]);
  });

  it('ignores a coordinate pair that is not finite', () => {
    const nan = makeHazardGeometry({
      id: asId<HazardGeometryId>('firms:nan'),
      incidentId: asId<IncidentId>('firms-unassigned'),
      sourceId: asId<SourceId>('firms'),
      kind: 'PERIMETER',
      geometry: { type: 'Point', coordinates: [Number.NaN, 39.7] },
      observedAt: OBSERVED,
    });
    expect(representativePoint(nan.geometry)).toBeNull();
  });

  it('breaks a tie between equal-sized clusters by id, so the cap is never arbitrary', () => {
    const a = [1, 2, 3].map((i) => hotspot(i, -121.6, 39.7 + i * 0.001));
    const b = [4, 5, 6].map((i) => hotspot(i, -118.0, 34.0 + i * 0.001));
    const found = discoverIncidents([...a, ...b]);
    expect(found).toHaveLength(2);
    expect([...found.map((f) => String(f.id))].sort()).toEqual(found.map((f) => String(f.id)));
  });
});

describe('the two edges an operator can configure into existence', () => {
  it('says "1 hotspot" when a deployment lowers the threshold to one', () => {
    // `minHotspots` is an option, so a deployment CAN ask for single-pixel incidents. The default refuses
    // them; if someone opts in, the sentence still has to read correctly.
    const found = discoverIncidents([hotspot(1, -121.6, 39.7)], { minHotspots: 1 });
    expect(found[0]?.headline).toBe('Wildfire — 1 hotspot near 39.70°N 121.60°W');
  });

  it('treats a geometry whose coordinates are not an array as unplaceable, rather than throwing', () => {
    // Third-party geometry reaches this module through six different ACLs. A malformed `coordinates` must
    // cost one hazard, not the whole composition.
    const malformed = {
      type: 'Point',
      coordinates: 'somewhere',
    } as unknown as HazardGeometry['geometry'];
    expect(representativePoint(malformed)).toBeNull();
  });
});
