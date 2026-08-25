// BEACON — CEMS Rapid Mapping ACL tests (S2·Lane-A2; F1/adapter-contract §4). The RECORDED REAL page
// round-trips to valid HazardGeometry activation centroids; out-of-scope categories are dropped AND
// counted; the WKT centroid keeps GeoJSON (lon, lat) order; the zone-less CEMS timestamp is normalised to
// explicit UTC; an unmappable shape raises a typed PARSE.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { isAdapterError } from '@/adapters/_shared/index.js';
import type { MapContext } from '@/adapters/_shared/index.js';
import { cemsMapper, cemsObservedAt, parseCemsActivations, parseWktPoint } from './cemsrm-acl.js';

const json = readFileSync(fileURLToPath(new URL('./__fixtures__/activations.json', import.meta.url)), 'utf8');
const ctx: MapContext = { fetchedAt: '2026-07-05T22:00:00Z', sourceRecordId: 'sid-1' };

describe('parseCemsActivations', () => {
  it('keeps only in-scope wildfire/flood activations and COUNTS the ones it dropped', () => {
    const res = parseCemsActivations(json);
    // The recorded page holds 19 `Wildfire` + 1 `Volcanic activity` activation.
    expect(res.activations).toHaveLength(19);
    expect(res.skipped).toBe(1);
    expect(res.activations.map((a) => a.code)).toContain('EMSR913');
  });

  it('drops AND counts rows with an unparseable centroid or a missing code', () => {
    const res = parseCemsActivations(
      JSON.stringify({
        results: [
          { code: 'EMSR1', category: 'Flood', centroid: 'POLYGON ((0 0, 1 1, 1 0, 0 0))' },
          { category: 'Flood', centroid: 'POINT (1 2)' },
          { code: 'EMSR2', category: 'Flood', centroid: 'POINT (1 2)' },
        ],
      }),
    );
    expect(res.activations.map((a) => a.code)).toEqual(['EMSR2']);
    expect(res.skipped).toBe(2);
  });

  it('returns an empty result for a body with no results array', () => {
    expect(parseCemsActivations('{"count":0}')).toEqual({ activations: [], skipped: 0 });
  });
});

describe('parseWktPoint', () => {
  it('reads WKT (x y) as GeoJSON [lon, lat] with no axis swap', () => {
    expect(parseWktPoint('POINT (-6.692874380324164 37.47971065538817)')).toEqual([
      -6.692874380324164, 37.47971065538817,
    ]);
    expect(parseWktPoint('point(1 2)')).toEqual([1, 2]);
  });

  it('returns undefined rather than inventing geometry', () => {
    expect(parseWktPoint(undefined)).toBeUndefined();
    expect(parseWktPoint('')).toBeUndefined();
    expect(parseWktPoint('POINT (a b)')).toBeUndefined();
    expect(parseWktPoint('MULTIPOINT (1 2)')).toBeUndefined();
  });
});

describe('cemsMapper.toCanonical (golden round-trip over the recorded page)', () => {
  it('maps every in-scope activation to a valid HOTSPOT centroid with provenance sourceId', () => {
    const { activations } = parseCemsActivations(json);
    const geoms = activations.map((a) => cemsMapper.toCanonical(a, ctx));
    expect(geoms).toHaveLength(19);
    for (const g of geoms) {
      expect(g.kind).toBe('HOTSPOT');
      expect(g.geometry.type).toBe('Point');
      expect(g.sourceId).toBe('sid-1');
      expect(g.intensity).toBeUndefined(); // CEMS publishes no magnitude — none is invented (Art. XII)
      expect(Number.isNaN(Date.parse(g.observedAt))).toBe(false);
    }
    const first = geoms.find((g) => g.id === 'cemsrm:EMSR913');
    expect(first?.geometry).toEqual({ type: 'Point', coordinates: [-6.692874380324164, 37.47971065538817] });
    expect(first?.observedAt).toBe('2026-08-06T10:00:00Z'); // zone-less upstream value + explicit Z
  });

  it('maps a Flood activation to FLOOD_REACH (the EMSR758 Romania shape, verified live via ?code=)', () => {
    const g = cemsMapper.toCanonical(
      {
        code: 'EMSR758',
        name: 'Flood in Galati and Vaslui counties, Romania',
        category: 'Flood',
        countries: ['Romania'],
        eventTime: '2024-09-14T05:00:00',
        centroid: 'POINT (27.9 45.9)',
      },
      ctx,
    );
    expect(g.kind).toBe('FLOOD_REACH');
    expect(g.id).toBe('cemsrm:EMSR758');
    expect(g.observedAt).toBe('2024-09-14T05:00:00Z');
  });

  it('raises a typed PARSE for an activation the ACL cannot place', () => {
    try {
      cemsMapper.toCanonical({ code: 'EMSR9', category: 'Earthquake', centroid: 'POINT (1 2)' }, ctx);
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });
});

describe('cemsObservedAt', () => {
  it('appends an explicit Z to the zone-less CEMS instant', () => {
    expect(cemsObservedAt({ eventTime: '2026-08-06T10:00:00' }, ctx.fetchedAt)).toBe('2026-08-06T10:00:00Z');
  });

  it('leaves an already-zoned instant untouched', () => {
    expect(cemsObservedAt({ eventTime: '2026-08-06T10:00:00+02:00' }, ctx.fetchedAt)).toBe('2026-08-06T10:00:00+02:00');
  });

  it('falls back to the fetch instant for a missing or unparseable eventTime', () => {
    expect(cemsObservedAt({}, ctx.fetchedAt)).toBe(ctx.fetchedAt);
    expect(cemsObservedAt({ eventTime: 'whenever' }, ctx.fetchedAt)).toBe(ctx.fetchedAt);
  });
});
