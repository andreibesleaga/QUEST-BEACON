// BEACON — positionForIncident tests (E11 "Live Views" · CW3b). Pure priority-order scan over MapData;
// no network, no clock — every case is exact-input/exact-output.
import { describe, it, expect } from 'vitest';
import { positionForIncident } from './incident-position.js';
import type { MapData } from '../_components/map/types.js';

describe('positionForIncident', () => {
  it('returns undefined for empty map data (no geolocated feature loaded)', () => {
    expect(positionForIncident({})).toBeUndefined();
  });

  it('prefers exposure over every other slice', () => {
    const mapData: MapData = {
      exposure: [{ id: 'e1', position: [-121.6, 39.76] }],
      fire: { hotspots: [{ id: 'f1', position: [-121.5, 39.7] }] },
      reports: [{ id: 'r1', position: [-121.4, 39.6] }],
    };
    expect(positionForIncident(mapData)).toEqual([-121.6, 39.76]);
  });

  it('falls back to fire hotspots when exposure is absent', () => {
    const mapData: MapData = {
      fire: { hotspots: [{ id: 'f1', position: [-121.5, 39.7] }] },
      reports: [{ id: 'r1', position: [-121.4, 39.6] }],
    };
    expect(positionForIncident(mapData)).toEqual([-121.5, 39.7]);
  });

  it('falls back to flood gauges when exposure and fire are absent', () => {
    const mapData: MapData = {
      flood: { gauges: [{ id: 'g1', position: [25.6, 45.65] }] },
      shelters: [{ id: 's1', position: [25.7, 45.7] }],
    };
    expect(positionForIncident(mapData)).toEqual([25.6, 45.65]);
  });

  it('falls back to reports, then shelters, then infrastructure, then cell, then camera, then weather', () => {
    expect(positionForIncident({ reports: [{ id: 'r1', position: [1, 2] }] })).toEqual([1, 2]);
    expect(positionForIncident({ shelters: [{ id: 's1', position: [3, 4] }] })).toEqual([3, 4]);
    expect(positionForIncident({ infrastructure: [{ id: 'i1', position: [5, 6] }] })).toEqual([5, 6]);
    expect(positionForIncident({ cell: [{ id: 'c1', position: [7, 8] }] })).toEqual([7, 8]);
    expect(
      positionForIncident({
        cameras: [
          {
            id: 'cam1',
            position: [9, 10],
            kind: 'FIRE_CAMERA',
            title: 'Ridge cam',
            provider: 'ALERTCalifornia',
            viewUrl: 'https://example.test/cam1',
            isLive: true,
          },
        ],
      }),
    ).toEqual([9, 10]);
    expect(
      positionForIncident({
        weather: { position: [11, 12], speedKmh: 10, directionDeg: 90, compass: 'SW', observedAt: '2026-07-05T22:00:00Z', label: '10 km/h from the E' },
      }),
    ).toEqual([11, 12]);
  });

  it('ignores an empty hotspots array and falls through to the next slice', () => {
    const mapData: MapData = {
      fire: { hotspots: [] },
      reports: [{ id: 'r1', position: [1, 2] }],
    };
    expect(positionForIncident(mapData)).toEqual([1, 2]);
  });
});
