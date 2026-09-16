// BEACON — EONET ACL tests (S2·Lane-A2; F1/adapter-contract §4). The RECORDED REAL response round-trips
// to valid HazardGeometry event centroids; out-of-scope categories are dropped AND counted (never
// silently unaccounted for); the newest geometry sample wins; magnitudes are carried verbatim; an
// unmappable shape raises a typed PARSE rather than a plausible-looking invention.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { isAdapterError } from '@/adapters/_shared/index.js';
import type { MapContext } from '@/adapters/_shared/index.js';
import {
  eonetMapper,
  latestGeometry,
  observedAt,
  parseEonetEvents,
  position,
} from './eonet-acl.js';

const json = readFileSync(
  fileURLToPath(new URL('./__fixtures__/events.json', import.meta.url)),
  'utf8',
);
const ctx: MapContext = { fetchedAt: '2026-07-05T22:00:00Z', sourceRecordId: 'sid-1' };

describe('parseEonetEvents', () => {
  it('keeps only in-scope wildfire/flood events and COUNTS the ones it dropped', () => {
    const res = parseEonetEvents(json);
    // The recorded response holds 5 `wildfires` + 1 `severeStorms` (a real tropical-cyclone track).
    expect(res.events).toHaveLength(5);
    expect(res.skipped).toBe(1); // severeStorms — out of BEACON's wildfire+flood scope
    expect(res.events.map((e) => e.id)).toContain('EONET_22198');
  });

  it('drops AND counts an event with no usable geometry', () => {
    const res = parseEonetEvents(
      JSON.stringify({ events: [{ id: 'x', categories: [{ id: 'wildfires' }], geometry: [] }] }),
    );
    expect(res.events).toHaveLength(0);
    expect(res.skipped).toBe(1);
  });

  it('drops AND counts an event with no id', () => {
    const res = parseEonetEvents(
      JSON.stringify({
        events: [
          {
            categories: [{ id: 'floods' }],
            geometry: [{ date: '2026-07-01T00:00:00Z', type: 'Point', coordinates: [1, 2] }],
          },
        ],
      }),
    );
    expect(res.events).toHaveLength(0);
    expect(res.skipped).toBe(1);
  });

  it('returns an empty result for a body with no events array', () => {
    expect(parseEonetEvents('{}')).toEqual({ events: [], skipped: 0 });
  });
});

describe('eonetMapper.toCanonical (golden round-trip over the recorded response)', () => {
  it('maps every in-scope fixture event to a valid HOTSPOT centroid with provenance sourceId', () => {
    const { events } = parseEonetEvents(json);
    const geoms = events.map((e) => eonetMapper.toCanonical(e, ctx));
    expect(geoms).toHaveLength(5);
    for (const g of geoms) {
      expect(g.kind).toBe('HOTSPOT');
      expect(g.geometry.type).toBe('Point');
      expect(g.sourceId).toBe('sid-1');
      expect(Number.isNaN(Date.parse(g.observedAt))).toBe(false);
    }
    const gann = geoms.find((g) => g.id === 'eonet:EONET_22198');
    expect(gann?.geometry).toEqual({ type: 'Point', coordinates: [-120.77336, 38.111446] });
    expect(gann?.intensity).toBe(10373); // magnitudeValue carried VERBATIM (acres — never converted)
    expect(gann?.observedAt).toBe('2026-08-03T20:28:00Z');
  });

  it('maps a floods-category event to FLOOD_REACH', () => {
    const g = eonetMapper.toCanonical(
      {
        id: 'EONET_F1',
        categories: [{ id: 'floods' }],
        geometry: [{ date: '2026-07-04T06:00:00Z', type: 'Point', coordinates: [27.9, 45.8] }],
      },
      ctx,
    );
    expect(g.kind).toBe('FLOOD_REACH');
    expect(g.geometry).toEqual({ type: 'Point', coordinates: [27.9, 45.8] });
    expect(g.intensity).toBeUndefined(); // no magnitudeValue ⇒ no invented number (Art. XII)
  });

  it('uses the NEWEST geometry sample of a multi-sample event', () => {
    const g = eonetMapper.toCanonical(
      {
        id: 'EONET_T',
        categories: [{ id: 'wildfires' }],
        geometry: [
          { date: '2026-07-01T00:00:00Z', type: 'Point', coordinates: [10, 10] },
          { date: '2026-07-03T00:00:00Z', type: 'Point', coordinates: [12, 11] },
          { date: '2026-07-02T00:00:00Z', type: 'Point', coordinates: [11, 10.5] },
        ],
      },
      ctx,
    );
    expect(g.geometry).toEqual({ type: 'Point', coordinates: [12, 11] });
    expect(g.observedAt).toBe('2026-07-03T00:00:00Z');
  });

  it('reduces a Polygon sample to the centre of its outer-ring extent (never promoted to an extent)', () => {
    const g = eonetMapper.toCanonical(
      {
        id: 'EONET_P',
        categories: [{ id: 'floods' }],
        geometry: [
          {
            date: '2026-07-04T00:00:00Z',
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [4, 0],
                [4, 2],
                [0, 2],
                [0, 0],
              ],
            ],
          },
        ],
      },
      ctx,
    );
    expect(g.geometry).toEqual({ type: 'Point', coordinates: [2, 1] });
  });

  it('raises a typed PARSE for an event the ACL cannot place', () => {
    try {
      eonetMapper.toCanonical({ id: 'EONET_X', categories: [{ id: 'volcanoes' }] }, ctx);
      expect.unreachable('should throw PARSE');
    } catch (e) {
      expect(isAdapterError(e)).toBe(true);
      if (isAdapterError(e)) expect(e.kind).toBe('PARSE');
    }
  });
});

describe('EONET geometry helpers', () => {
  it('ignores samples whose coordinates are not a finite pair', () => {
    expect(position({ type: 'Point', coordinates: ['a', 2] })).toBeUndefined();
    expect(position({ type: 'Point', coordinates: [1] })).toBeUndefined();
    expect(position({ type: 'LineString', coordinates: [[1, 2]] })).toBeUndefined();
    expect(position(undefined)).toBeUndefined();
    expect(position({ type: 'Polygon', coordinates: 'nope' })).toBeUndefined();
    expect(position({ type: 'Polygon', coordinates: [[]] })).toBeUndefined();
    expect(position({ type: 'Polygon', coordinates: [[['a', 'b']]] })).toBeUndefined();
  });

  it('ranks a date-less sample below a dated one but still returns it when it is the only usable sample', () => {
    const only = latestGeometry({ geometry: [{ type: 'Point', coordinates: [5, 6] }] });
    expect(only?.coordinates).toEqual([5, 6]);
    const mixed = latestGeometry({
      geometry: [
        { type: 'Point', coordinates: [5, 6] },
        { date: '2026-07-02T00:00:00Z', type: 'Point', coordinates: [7, 8] },
      ],
    });
    expect(mixed?.coordinates).toEqual([7, 8]);
  });

  it('falls back to the fetch instant when a sample has no parseable date', () => {
    expect(observedAt({ type: 'Point', coordinates: [1, 2] }, ctx.fetchedAt)).toBe(ctx.fetchedAt);
    expect(
      observedAt({ date: 'not-a-date', type: 'Point', coordinates: [1, 2] }, ctx.fetchedAt),
    ).toBe(ctx.fetchedAt);
    expect(observedAt(undefined, ctx.fetchedAt)).toBe(ctx.fetchedAt);
  });
});
