// BEACON — buildLayers + layer-builder tests (E8·T-359…T-369). Pure data→descriptor mapping: a toggle
// flip adds/removes exactly that group's descriptors; reports carry the Unverified flag + PII-gated geometry;
// shelters encode capacity as a NUMERIC label (non-color); every builder is empty-safe.
import { describe, it, expect } from 'vitest';
import { LAYER_IDS, type LayerId } from '../../_lib/types.js';
import {
  buildLayers,
  buildFireLayers,
  buildReportLayers,
  buildShelterLayers,
  buildOutageLayers,
  buildCellLayers,
  buildFloodZoneLayers,
  buildWeatherLayers,
  buildPredictionLayers,
  predictionCaveat,
  shelterCapacityLabel,
  LAYER_META,
} from './build-layers.js';
import type { MapData, MapLayerState, PredictionCone } from './types.js';

function allOff(): Record<LayerId, boolean> {
  return Object.fromEntries(LAYER_IDS.map((id) => [id, false])) as Record<LayerId, boolean>;
}

const data: MapData = {
  fire: {
    hotspots: [{ id: 'h1', position: [-120, 38] }],
    perimeter: [[[-120, 38], [-119, 38], [-119, 39], [-120, 38]]],
  },
  reports: [{ id: 'r1', position: [-120, 38], precisePosition: [-120.5, 38.5], confidence: 0.4 }],
  shelters: [{ id: 's1', name: 'North HS', position: [-120, 38], capacity: 100, demand: 40 }],
  outage: [{ id: 'o1', polygon: [[[-120, 38], [-119, 38], [-119, 39], [-120, 38]]], assumedOffline: true }],
  cell: [
    { id: 'c1', position: [-120, 38], online: false, technology: 'LTE' },
    { id: 'c2', position: [-120.1, 38.1], online: true },
  ],
  floodZones: [{ id: 'fz1', zone: 'AE', polygon: [[[-120, 38], [-119, 38], [-119, 39], [-120, 38]]] }],
  weather: { position: [-120, 38], speedKmh: 25, directionDeg: 45, compass: 'SW', observedAt: '2026-07-05T22:00:00Z', label: '25 km/h from the NE' },
};

function groups(state: MapLayerState): string[] {
  return buildLayers(state, data).map((l) => l.group);
}

describe('buildLayers — toggle adds/removes a layer', () => {
  it('emits fire descriptors when fire is ON', () => {
    const ids = buildLayers({ layers: { ...allOff(), fire: true }, role: 'PUBLIC' }, data).map((l) => l.id);
    expect(ids).toContain('fire-hotspots');
    expect(ids).toContain('fire-perimeter');
  });

  it('emits floodzone descriptors when floodzone is ON, none when OFF', () => {
    const on = buildLayers({ layers: { ...allOff(), floodzone: true }, role: 'PUBLIC' }, data).map((l) => l.id);
    expect(on).toContain('floodzone-areas');
    expect(groups({ layers: allOff(), role: 'PUBLIC' })).not.toContain('floodzone');
  });

  it('emits weather descriptors (point + label) when weather is ON, none when OFF', () => {
    const on = buildLayers({ layers: { ...allOff(), weather: true }, role: 'PUBLIC' }, data).map((l) => l.id);
    expect(on).toContain('weather-observation');
    expect(on).toContain('weather-observation-label');
    expect(groups({ layers: allOff(), role: 'PUBLIC' })).not.toContain('weather');
  });

  it('emits NO fire descriptors when fire is OFF (the toggle removes them)', () => {
    expect(groups({ layers: allOff(), role: 'PUBLIC' })).not.toContain('fire');
  });

  it('flipping a single toggle changes only that group', () => {
    const off = groups({ layers: { ...allOff(), reports: true }, role: 'PUBLIC' });
    const on = groups({ layers: { ...allOff(), reports: true, fire: true }, role: 'PUBLIC' });
    expect(off).toEqual(['reports']);
    expect(on.filter((g) => g === 'fire').length).toBeGreaterThan(0);
    expect(on).toContain('reports');
  });
});

describe('layer builders — empty-safe + shape', () => {
  it('every builder returns [] for absent data', () => {
    expect(buildFireLayers(undefined)).toEqual([]);
    expect(buildReportLayers(undefined, 'PUBLIC')).toEqual([]);
    expect(buildShelterLayers(undefined)).toEqual([]);
    expect(buildOutageLayers(undefined)).toEqual([]);
    expect(buildCellLayers(undefined)).toEqual([]);
    expect(buildFloodZoneLayers(undefined)).toEqual([]);
    expect(buildWeatherLayers(undefined)).toEqual([]);
    expect(buildPredictionLayers(undefined)).toEqual([]);
  });

  it('every builder returns [] for an empty array (never undefined-vs-empty divergence)', () => {
    expect(buildOutageLayers([])).toEqual([]);
    expect(buildCellLayers([])).toEqual([]);
    expect(buildFloodZoneLayers([])).toEqual([]);
    expect(buildPredictionLayers([])).toEqual([]);
  });

  it('outage descriptor carries the county-granular caveat', () => {
    const [layer] = buildOutageLayers(data.outage);
    expect(layer?.caveat).toBe(LAYER_META.outage.caveat);
    expect(layer?.caveat).toMatch(/county-granular/i);
  });
});

describe('floodzone — regulatory polygons, honest caveat (T-367/W3b)', () => {
  it('emits one polygon descriptor of kind "polygon" carrying the NFHL caveat', () => {
    const [layer] = buildFloodZoneLayers(data.floodZones);
    expect(layer?.kind).toBe('polygon');
    expect(layer?.group).toBe('floodzone');
    expect(layer?.caveat).toBe(LAYER_META.floodzone.caveat);
    expect(layer?.caveat).toMatch(/not a live extent/i);
  });

  it('carries the zone class as the datum label + status, and the source polygon verbatim', () => {
    const [layer] = buildFloodZoneLayers(data.floodZones);
    const [datum] = layer?.data ?? [];
    expect(datum?.status).toBe('AE');
    expect(datum?.label).toBe('Zone AE');
    expect(datum?.polygon).toEqual(data.floodZones?.[0]?.polygon);
  });
});

describe('weather — one wind glyph at the observation point, never a synthesized grid (locked decision)', () => {
  it('emits exactly one point + one label descriptor, each with exactly one datum', () => {
    const layers = buildWeatherLayers(data.weather);
    expect(layers).toHaveLength(2);
    const point = layers.find((l) => l.kind === 'scatterplot');
    const label = layers.find((l) => l.kind === 'text');
    expect(point?.data).toHaveLength(1);
    expect(label?.data).toHaveLength(1);
    expect(point?.pickable).toBe(true);
    expect(point?.caveat).toBe(LAYER_META.weather.caveat);
    expect(point?.caveat).toMatch(/not a forecast grid/i);
  });

  it('carries the preformatted server label verbatim — no client-derived wind figure', () => {
    const [point] = buildWeatherLayers(data.weather);
    expect(point?.data[0]?.label).toBe('25 km/h from the NE');
    expect(point?.data[0]?.position).toEqual([-120, 38]);
  });
});

describe('cell — online/offline status + technology surfaced (W2b wire-shape parity)', () => {
  it('marks an offline site OFFLINE and an online site ONLINE', () => {
    const [layer] = buildCellLayers(data.cell);
    expect(layer?.data.find((d) => d.id === 'c1')?.status).toBe('OFFLINE');
    expect(layer?.data.find((d) => d.id === 'c2')?.status).toBe('ONLINE');
  });

  it('surfaces technology as the tooltip label when present', () => {
    const [layer] = buildCellLayers(data.cell);
    expect(layer?.data.find((d) => d.id === 'c1')?.label).toBe('LTE');
    expect(layer?.data.find((d) => d.id === 'c2')?.label).toBeUndefined();
  });

  it('carries the OpenCelliD-estimate caveat', () => {
    const [layer] = buildCellLayers(data.cell);
    expect(layer?.caveat).toBe(LAYER_META.cell.caveat);
  });
});

describe('outage — ASSUMED-offline honesty (locked decision)', () => {
  it('labels an assumed-offline area with the ASSUMED-offline wording + customer count', () => {
    const [layer] = buildOutageLayers([
      { id: 'o1', polygon: data.outage![0]!.polygon, assumedOffline: true, customersOut: 500 },
    ]);
    expect(layer?.data[0]?.label).toBe('500 customers out — ASSUMED offline');
    expect(layer?.data[0]?.status).toBe('assumed-offline');
  });

  it('treats an absent assumedOffline flag as ASSUMED offline (never silently confirmed)', () => {
    const [layer] = buildOutageLayers([{ id: 'o1', polygon: data.outage![0]!.polygon }]);
    expect(layer?.data[0]?.label).toBe('ASSUMED offline');
  });

  it('labels a confirmed-reported area distinctly from an assumed one', () => {
    const [layer] = buildOutageLayers([
      { id: 'o1', polygon: data.outage![0]!.polygon, assumedOffline: false },
    ]);
    expect(layer?.data[0]?.label).toBe('Reported offline');
    expect(layer?.data[0]?.status).toBe('reported');
  });
});

describe('reports — Unverified flag + precise-PII gating (T-366/T-370)', () => {
  it('marks every report datum unverified', () => {
    const [layer] = buildReportLayers(data.reports, 'PUBLIC');
    expect(layer?.data.every((d) => d.unverified === true)).toBe(true);
  });

  it('PUBLIC sees the generalized position; RESPONDER sees the precise one', () => {
    const [pub] = buildReportLayers(data.reports, 'PUBLIC');
    const [resp] = buildReportLayers(data.reports, 'RESPONDER');
    expect(pub?.data[0]?.position).toEqual([-120, 38]);
    expect(resp?.data[0]?.position).toEqual([-120.5, 38.5]);
  });
});

describe('shelters — capacity encoded NON-color (T-369)', () => {
  it('produces a numeric capacity label, not a color signal', () => {
    expect(shelterCapacityLabel({ id: 's1', position: [0, 0], capacity: 100, demand: 40 })).toBe(
      'Cap 100 · Need 40',
    );
  });

  it('emits a text descriptor whose datum label carries the numeric capacity', () => {
    const layers = buildShelterLayers(data.shelters);
    const text = layers.find((l) => l.kind === 'text');
    expect(text).toBeDefined();
    expect(text?.data[0]?.label).toBe('Cap 100 · Need 40');
  });
});

describe('prediction — plural cones, each labelled with its OWN method/inputs/uncertainty (ADR-033 §3.1)', () => {
  const cone = (id: string, method: string, uncertainty: string): PredictionCone => ({
    id,
    polygon: [[[-120, 38], [-119, 38], [-119, 39], [-120, 38]]],
    method,
    inputs: `wind: ${id}`,
    uncertainty,
  });
  const fireCone = cone('pred-fire', 'wind-buffer first-order', '±40%');
  const floodCone = cone('pred-flood', 'NWPS forecast-crest ∩ FEMA NFHL', '±25%');

  it('one cone produces exactly the historical single descriptor (byte-identical)', () => {
    expect(buildPredictionLayers([fireCone])).toEqual([
      {
        id: 'prediction-cone',
        group: 'prediction',
        kind: 'polygon',
        pickable: true,
        caveat: 'First-order wind-buffer first-order; inputs: wind: pred-fire; uncertainty: ±40%.',
        data: [{ id: 'pred-fire', polygon: fireCone.polygon }],
      },
    ]);
  });

  it('N cones produce N descriptors with distinct ids — never one merged polygon', () => {
    const out = buildPredictionLayers([fireCone, floodCone]);
    expect(out.map((l) => l.id)).toEqual(['prediction-cone', 'prediction-cone-1']);
    expect(out.every((l) => l.group === 'prediction')).toBe(true);
    expect(out.map((l) => l.data.length)).toEqual([1, 1]); // one polygon per prediction, not a union
    expect(out.map((l) => l.data[0]?.id)).toEqual(['pred-fire', 'pred-flood']);
  });

  it('each descriptor keeps ITS OWN method + inputs + uncertainty caveat (no averaged label)', () => {
    const out = buildPredictionLayers([fireCone, floodCone]);
    expect(out[0]?.caveat).toBe(predictionCaveat(fireCone));
    expect(out[1]?.caveat).toBe(predictionCaveat(floodCone));
    expect(out[0]?.caveat).toContain('±40%');
    expect(out[1]?.caveat).toContain('±25%');
    expect(out[0]?.caveat).not.toBe(out[1]?.caveat);
  });

  it('the prediction toggle routes MapData.predictions through the registry', () => {
    const withCones: MapData = { ...data, predictions: [fireCone, floodCone] };
    const ids = buildLayers({ layers: { ...allOff(), prediction: true }, role: 'PUBLIC' }, withCones).map((l) => l.id);
    expect(ids).toEqual(['prediction-cone', 'prediction-cone-1']);
    expect(buildLayers({ layers: allOff(), role: 'PUBLIC' }, withCones)).toEqual([]);
  });
});
