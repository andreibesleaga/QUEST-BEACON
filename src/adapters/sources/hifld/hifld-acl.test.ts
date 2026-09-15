// BEACON — HIFLD ACL tests (S2·Lane A3; adapter-contract §4, P4). Every RECORDED REAL lifeline layer
// round-trips to valid InfrastructureNodes of that layer's type; the five layers' DIFFERENT attribute
// schemas are all handled by reading only geometry + id (LENIENT); malformed/non-Point features are dropped
// AND COUNTED; status is never invented; a feature reaching the mapper unmappable raises a typed PARSE.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { isAdapterError } from '@/adapters/_shared/index.js';
import type { HifldLayer } from './hifld-acl.js';
import { HIFLD_LAYERS, hifldMapper, parseHifldLayer } from './hifld-acl.js';

const CTX = { fetchedAt: '2026-07-05T22:00:00Z', sourceRecordId: 'sid-hifld' };
const layerBody = (layerId: number): string =>
  readFileSync(
    fileURLToPath(new URL(`./__fixtures__/lifelines-${layerId}.geojson`, import.meta.url)),
    'utf8',
  );

describe('HIFLD_LAYERS', () => {
  it('consumes exactly the five layers the domain enum can represent honestly', () => {
    expect(HIFLD_LAYERS).toEqual([
      { layerId: 10, type: 'HOSPITAL' },
      { layerId: 9, type: 'NURSING_HOME' },
      { layerId: 5, type: 'POWER' },
      { layerId: 4, type: 'CELL' },
      { layerId: 0, type: 'SHELTER' },
    ]);
  });
});

describe('parseHifldLayer', () => {
  it('parses every recorded layer body despite their different attribute schemas (LENIENT)', () => {
    for (const layer of HIFLD_LAYERS) {
      const { rows, skipped } = parseHifldLayer(layerBody(layer.layerId), layer);
      expect(rows).toHaveLength(4); // each recorded body was captured with resultRecordCount=4
      expect(skipped).toBe(0);
      for (const row of rows) {
        expect(row.type).toBe(layer.type);
        expect(row.featureId).not.toBe('');
      }
    }
  });

  it('reads the id from ID, else OBJECTID, else the GeoJSON feature id (schemas disagree)', () => {
    const layer: HifldLayer = { layerId: 10, type: 'HOSPITAL' };
    const feature = (properties: Record<string, unknown>, id?: number): unknown => ({
      ...(id === undefined ? {} : { id }),
      geometry: { type: 'Point', coordinates: [-121.8, 39.7] },
      properties,
    });
    const parse = (f: unknown): string | undefined =>
      parseHifldLayer(JSON.stringify({ features: [f] }), layer).rows[0]?.featureId;
    expect(parse(feature({ ID: '0004595926', OBJECTID: 248 }, 248))).toBe('0004595926');
    expect(parse(feature({ OBJECTID: 865 }, 865))).toBe('865');
    expect(parse(feature({}, 1829))).toBe('1829');
  });

  it('DROPS AND COUNTS malformed features (no geometry, non-Point, bad coordinates, no id)', () => {
    const layer: HifldLayer = { layerId: 5, type: 'POWER' };
    const doc = {
      features: [
        {
          id: 1,
          geometry: { type: 'Point', coordinates: [-121.7, 39.6] },
          properties: { ID: 'a' },
        },
        { id: 2, properties: { ID: 'b' } }, // no geometry
        { id: 3, geometry: { type: 'Polygon', coordinates: [[[0, 0]]] }, properties: { ID: 'c' } }, // not a Point
        { id: 4, geometry: { type: 'Point', coordinates: ['x', 'y'] }, properties: { ID: 'd' } },
        { geometry: { type: 'Point', coordinates: [1, 2] }, properties: {} }, // nothing to identify it by
        null,
      ],
    };
    const { rows, skipped } = parseHifldLayer(JSON.stringify(doc), layer);
    expect(rows).toHaveLength(1);
    expect(skipped).toBe(5);
  });

  it('returns an empty result on invalid JSON or an ArcGIS error envelope (ladder degrades)', () => {
    const layer: HifldLayer = { layerId: 10, type: 'HOSPITAL' };
    expect(parseHifldLayer('Bad Request', layer)).toEqual({ rows: [], skipped: 0 });
    // Exactly what the dead `Hospitals_gdb` service returns today — must degrade, not throw.
    expect(parseHifldLayer('{"error":{"code":400,"message":"Invalid URL"}}', layer)).toEqual({
      rows: [],
      skipped: 0,
    });
  });
});

describe('hifldMapper.toCanonical (golden round-trip on the recorded bodies)', () => {
  it('maps a recorded hospital to a HOSPITAL node with a layer-scoped id and provenance sourceId', () => {
    const layer: HifldLayer = { layerId: 10, type: 'HOSPITAL' };
    const { rows } = parseHifldLayer(layerBody(10), layer);
    const node = hifldMapper.toCanonical(rows[0]!, CTX);
    expect(node.type).toBe('HOSPITAL');
    expect(node.geom).toEqual({ type: 'Point', coordinates: [-121.847648767, 39.7545639690001] });
    expect(node.id).toBe('hifld:10:0004595926');
    expect(node.sourceId).toBe('sid-hifld');
  });

  it('stamps every node ONLINE — HIFLD publishes no live operational state (never invented)', () => {
    for (const layer of HIFLD_LAYERS) {
      const { rows } = parseHifldLayer(layerBody(layer.layerId), layer);
      for (const row of rows) {
        const node = hifldMapper.toCanonical(row, CTX);
        expect(node.status).toBe('ONLINE');
        expect(node.type).toBe(layer.type);
        expect(node.id.startsWith(`hifld:${layer.layerId}:`)).toBe(true);
      }
    }
  });

  it('raises a typed PARSE on a feature that cannot be placed (defensive ACL boundary)', () => {
    try {
      hifldMapper.toCanonical(
        { layerId: 10, type: 'HOSPITAL', featureId: 'x', lon: Number.NaN, lat: 0 },
        CTX,
      );
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });
});
