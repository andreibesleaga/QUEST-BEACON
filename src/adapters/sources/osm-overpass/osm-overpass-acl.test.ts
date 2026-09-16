// BEACON — OSM Overpass ACL tests (adapter-contract §4). classifyInfraType is the ONLY tag-mapping
// decision point (hospital/power-substation/comms-mast -> their InfraNodeType; fire_station and a
// non-comms mast have no honest type and classify to undefined); parseOverpassElements filters the raw
// fixture down to only the mappable node elements (skip+count is recoverable as raw.length - parsed.length);
// the mapper golden-round-trips every parsed element to a valid InfrastructureNode with provenance sourceId;
// malformed/unmappable rows raise a typed PARSE (never silently dropped); resolveOsmName's name/fallback.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { isAdapterError } from '@/adapters/_shared/index.js';
import type { MapContext } from '@/adapters/_shared/index.js';
import type { OsmOverpassElement } from './osm-overpass-acl.js';
import {
  classifyInfraType,
  osmOverpassMapper,
  parseOverpassElements,
  resolveOsmName,
} from './osm-overpass-acl.js';

const raw = readFileSync(
  fileURLToPath(new URL('./__fixtures__/elements.json', import.meta.url)),
  'utf8',
);
const rawElementCount = (JSON.parse(raw) as { elements: unknown[] }).elements.length;
const ctx: MapContext = { fetchedAt: '2026-07-05T22:00:00Z', sourceRecordId: 'sid-1' };

describe('classifyInfraType', () => {
  it('maps amenity=hospital to HOSPITAL', () => {
    expect(classifyInfraType({ amenity: 'hospital' })).toBe('HOSPITAL');
  });

  it('maps power=substation to POWER', () => {
    expect(classifyInfraType({ power: 'substation' })).toBe('POWER');
  });

  it('maps man_made=mast + tower:type=communication to CELL', () => {
    expect(classifyInfraType({ man_made: 'mast', 'tower:type': 'communication' })).toBe('CELL');
  });

  it('maps man_made=mast + a bare "communication" key to CELL (OSM Key:communication convention)', () => {
    expect(classifyInfraType({ man_made: 'mast', communication: 'gsm' })).toBe('CELL');
  });

  it('does not map amenity=fire_station (no honest InfraNodeType exists for it)', () => {
    expect(classifyInfraType({ amenity: 'fire_station' })).toBeUndefined();
  });

  it('does not map a non-communication mast (e.g. tower:type=lighting)', () => {
    expect(classifyInfraType({ man_made: 'mast', 'tower:type': 'lighting' })).toBeUndefined();
  });

  it('returns undefined for undefined/empty tags', () => {
    expect(classifyInfraType(undefined)).toBeUndefined();
    expect(classifyInfraType({})).toBeUndefined();
  });
});

describe('parseOverpassElements', () => {
  it('keeps only mappable node elements, dropping fire_station + the lighting mast (skip+count)', () => {
    expect(rawElementCount).toBe(6);
    const rows = parseOverpassElements(raw);
    expect(rows).toHaveLength(3); // 6 raw - 2 fire_station - 1 lighting mast = 3 mappable
    expect(rows.map((r) => r.tags?.amenity ?? r.tags?.power ?? r.tags?.man_made)).toEqual([
      'hospital',
      'substation',
      'mast',
    ]);
  });

  it('returns [] when there are no elements', () => {
    expect(parseOverpassElements(JSON.stringify({}))).toEqual([]);
  });

  it('drops non-node elements (e.g. way/relation) even if tags would otherwise match', () => {
    const doc = JSON.stringify({
      elements: [{ type: 'way', id: 1, tags: { amenity: 'hospital' } }],
    });
    expect(parseOverpassElements(doc)).toEqual([]);
  });
});

describe('osmOverpassMapper.toCanonical (golden round-trip)', () => {
  it('maps every fixture-filtered element to a valid InfrastructureNode with the right type + provenance', () => {
    const rows = parseOverpassElements(raw);
    const nodes = rows.map((r) => osmOverpassMapper.toCanonical(r, ctx));
    expect(nodes).toHaveLength(3);
    expect(nodes.map((n) => n.type)).toEqual(['HOSPITAL', 'POWER', 'CELL']);
    for (const n of nodes) {
      expect(n.geom.type).toBe('Point');
      expect(n.status).toBe('ONLINE');
      expect(n.sourceId).toBe('sid-1');
    }
    const hospital = nodes[0];
    expect(hospital?.geom).toEqual({ type: 'Point', coordinates: [-121.8675319, 39.7541866] });
    expect(String(hospital?.id)).toBe('osm:node:10866352476');
  });

  it('throws a typed PARSE when tags do not map to a supported InfraNodeType (defensive re-check)', () => {
    const fireStation: OsmOverpassElement = {
      type: 'node',
      id: 1,
      lat: 39.7,
      lon: -121.8,
      tags: { amenity: 'fire_station' },
    };
    try {
      osmOverpassMapper.toCanonical(fireStation, ctx);
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });

  it('throws a typed PARSE on a hospital node missing lat/lon (malformed upstream, never silently dropped)', () => {
    const malformed: OsmOverpassElement = { type: 'node', id: 2, tags: { amenity: 'hospital' } };
    try {
      osmOverpassMapper.toCanonical(malformed, ctx);
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });

  it('throws a typed PARSE on a substation node with a non-finite lat', () => {
    const malformed: OsmOverpassElement = {
      type: 'node',
      id: 3,
      lat: Number.NaN,
      lon: -121.8,
      tags: { power: 'substation' },
    };
    expect(() => osmOverpassMapper.toCanonical(malformed, ctx)).toThrow();
  });
});

describe('resolveOsmName', () => {
  it('uses tags.name when present', () => {
    const el: OsmOverpassElement = { id: 42, tags: { name: 'Enloe Rehabilitation Center' } };
    expect(resolveOsmName(el, 'HOSPITAL')).toBe('Enloe Rehabilitation Center');
  });

  it('falls back to `${type}-${id}` when tags.name is absent/blank', () => {
    expect(resolveOsmName({ id: 42, tags: {} }, 'POWER')).toBe('POWER-42');
    expect(resolveOsmName({ id: 43, tags: { name: '   ' } }, 'CELL')).toBe('CELL-43');
    expect(resolveOsmName({ id: 44 }, 'HOSPITAL')).toBe('HOSPITAL-44');
  });
});

// ── A 200 OK is not a result (2026-09-12) ─────────────────────────────────────────────────────────────
describe('an Overpass response that reports its own failure', () => {
  it('is refused, because "no elements" and "the query died" are not the same answer', () => {
    // Verified live that day: the exact query this adapter sends for California's bbox comes back 200 OK
    // as `{"elements": [], "remark": "runtime error: Query timed out ... after 26 seconds."}`. Read as
    // data, that is a California with no hospitals, no substations and no masts — served as LIVE, badged
    // fresh. Refusing it sends the ladder to the cached/mock rung, which then says it is degraded.
    const body = JSON.stringify({
      version: 0.6,
      elements: [],
      remark: 'runtime error: Query timed out in "query" at line 1 after 26 seconds.',
    });
    expect(() => parseOverpassElements(body)).toThrow(/Overpass refused the query/);
  });

  it('still accepts a genuinely empty answer, which is a real and different thing', () => {
    // A bbox over open ocean has no lifeline nodes. That must stay an empty LIVE result, not an error —
    // otherwise the guard above would make every quiet region look broken.
    expect(parseOverpassElements(JSON.stringify({ version: 0.6, elements: [] }))).toEqual([]);
  });
});
