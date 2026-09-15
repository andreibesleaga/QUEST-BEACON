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
  buildRouteLayers,
  caveatText,
  predictionCaveat,
  shelterCapacityLabel,
  LAYER_META,
  buildInfraLayers,
  buildFloodLayers,
  buildExposureLayers,
  pointLabel,
} from './build-layers.js';
import type { MapData, MapLayerState, PredictionCone } from './types.js';

function allOff(): Record<LayerId, boolean> {
  return Object.fromEntries(LAYER_IDS.map((id) => [id, false])) as Record<LayerId, boolean>;
}

const data: MapData = {
  fire: {
    hotspots: [{ id: 'h1', position: [-120, 38] }],
    perimeter: [
      [
        [-120, 38],
        [-119, 38],
        [-119, 39],
        [-120, 38],
      ],
    ],
  },
  reports: [{ id: 'r1', position: [-120, 38], precisePosition: [-120.5, 38.5], confidence: 0.4 }],
  shelters: [{ id: 's1', name: 'North HS', position: [-120, 38], capacity: 100, demand: 40 }],
  outage: [
    {
      id: 'o1',
      polygon: [
        [
          [-120, 38],
          [-119, 38],
          [-119, 39],
          [-120, 38],
        ],
      ],
      assumedOffline: true,
    },
  ],
  cell: [
    { id: 'c1', position: [-120, 38], online: false, technology: 'LTE' },
    { id: 'c2', position: [-120.1, 38.1], online: true },
  ],
  floodZones: [
    {
      id: 'fz1',
      zone: 'AE',
      polygon: [
        [
          [-120, 38],
          [-119, 38],
          [-119, 39],
          [-120, 38],
        ],
      ],
    },
  ],
  weather: {
    position: [-120, 38],
    speedKmh: 25,
    directionDeg: 45,
    compass: 'SW',
    observedAt: '2026-07-05T22:00:00Z',
    label: '25 km/h from the NE',
  },
};

function groups(state: MapLayerState): string[] {
  return buildLayers(state, data).map((l) => l.group);
}

describe('buildLayers — toggle adds/removes a layer', () => {
  it('emits fire descriptors when fire is ON', () => {
    const ids = buildLayers({ layers: { ...allOff(), fire: true }, role: 'PUBLIC' }, data).map(
      (l) => l.id,
    );
    expect(ids).toContain('fire-hotspots');
    expect(ids).toContain('fire-perimeter');
  });

  it('emits floodzone descriptors when floodzone is ON, none when OFF', () => {
    const on = buildLayers({ layers: { ...allOff(), floodzone: true }, role: 'PUBLIC' }, data).map(
      (l) => l.id,
    );
    expect(on).toContain('floodzone-areas');
    expect(groups({ layers: allOff(), role: 'PUBLIC' })).not.toContain('floodzone');
  });

  it('emits weather descriptors (point + label) when weather is ON, none when OFF', () => {
    const on = buildLayers({ layers: { ...allOff(), weather: true }, role: 'PUBLIC' }, data).map(
      (l) => l.id,
    );
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

  // WP A4 — once a published DIRECTORY feeds this layer (FEMA NSS on California), most pins are buildings
  // that are CLOSED, and several closed ones publish LARGER capacities than the single open one, whose
  // capacity FEMA has not counted (0). A label that shows only capacity-vs-demand would therefore point an
  // operator at a 623-bed hall nobody can enter and make the one real destination look useless. The status
  // is rendered as the domain token VERBATIM, exactly as the shelter-status board does
  // (shelter-status-panel.tsx:53 "status token verbatim (domain vocabulary)") — no new i18n key, and no
  // colour-only encoding (T-369).
  it('renders the PUBLISHED status alongside the figures when the feature carries one', () => {
    expect(
      shelterCapacityLabel({
        id: 's1',
        position: [0, 0],
        status: 'CLOSED',
        capacity: 623,
        demand: 0,
      }),
    ).toBe('CLOSED · Cap 623 · Need 0');
    expect(
      shelterCapacityLabel({ id: 's2', position: [0, 0], status: 'OPEN', capacity: 0, demand: 0 }),
    ).toBe('OPEN · Cap 0 · Need 0');
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
    polygon: [
      [
        [-120, 38],
        [-119, 38],
        [-119, 39],
        [-120, 38],
      ],
    ],
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
    const ids = buildLayers(
      { layers: { ...allOff(), prediction: true }, role: 'PUBLIC' },
      withCones,
    ).map((l) => l.id);
    expect(ids).toEqual(['prediction-cone', 'prediction-cone-1']);
    expect(buildLayers({ layers: allOff(), role: 'PUBLIC' }, withCones)).toEqual([]);
  });
});

// ── The route caveat (2026-09-12) ─────────────────────────────────────────────────────────────────────
//
// Reported as "the evacuation route on the map is completely wrong". What the map was drawing is a line
// between two points — which is also exactly what `evac-routing.ts` degrades to when no routing engine is
// configured, and the map said nothing about the difference. A straight line across a valley looked
// exactly like a road route.
describe('buildRouteLayers', () => {
  const path = [
    [-121.6, 39.7],
    [-121.5, 39.8],
  ] as const;

  it('warns on the route the engine did not verify as hazard-avoiding', () => {
    const [layer] = buildRouteLayers({ id: 'r1', path, hazardAvoided: false });
    expect(layer?.caveat).toContain('not verified to avoid the hazard');
  });

  it('says nothing about a route the engine DID keep clear of the hazard', () => {
    const [layer] = buildRouteLayers({ id: 'r1', path, hazardAvoided: true });
    expect(layer?.caveat).toBeUndefined();
  });

  it('says nothing when the server made no claim either way', () => {
    // Silence from the server is not a warning. Inventing a caveat for an absent field would be its own
    // small dishonesty, and it would attach one to every route on a deployment that predates the field.
    const [layer] = buildRouteLayers({ id: 'r1', path });
    expect(layer?.caveat).toBeUndefined();
  });

  it('carries a caveat that is localized, not shipped as an English literal', () => {
    const [layer] = buildRouteLayers({ id: 'r1', path, hazardAvoided: false });
    const t = ((key: string) => `T:${key}`) as unknown as Parameters<typeof caveatText>[0];
    const translated = caveatText(t, layer?.caveat as string);
    expect(translated).toBe('T:caveat.routeDirect');
  });
});

// ── Point labels (2026-09-14): every point type carries a tooltip headline built from what the WIRE
// actually carries (kind/status for nodes, category/stage for gauges, intensity for hotspots, reason for
// exposure); sparse gauges also carry theirs ON the map as a text layer, like shelters and the weather glyph.
describe('point labels', () => {
  it('pointLabel joins only the parts a point carries', () => {
    expect(pointLabel('Enloe Medical Center', 'HOSPITAL')).toBe('Enloe Medical Center · HOSPITAL');
    expect(pointLabel(undefined, 'HOSPITAL')).toBe('HOSPITAL');
    expect(pointLabel('Gauge', undefined)).toBe('Gauge');
    expect(pointLabel(' ', undefined)).toBeUndefined();
  });

  it('infra: the tooltip label is the kind the wire carries (a name leads when supplied); no text layer', () => {
    const layers = buildInfraLayers([
      { id: 'n1', position: [-121.6, 39.7], kind: 'HOSPITAL', status: 'ONLINE' },
      { id: 'n2', position: [-121.5, 39.7], name: 'Enloe Medical Center', kind: 'HOSPITAL' },
      { id: 'n3', position: [-121.4, 39.7] },
    ]);
    expect(layers.map((l) => l.id)).toEqual(['infra-nodes']);
    expect(layers[0]?.data.map((d) => d.label)).toEqual([
      'HOSPITAL',
      'Enloe Medical Center · HOSPITAL',
      undefined,
    ]);
  });

  it('gauges: category and stage as the wire carries them, on the tooltip and on the map', () => {
    const layers = buildFloodLayers({
      gauges: [
        { id: 'g1', position: [27.5, 45.5], status: 'MODERATE', stage: 3.2, unit: 'm' },
        { id: 'g2', position: [27.6, 45.6], stage: 1.1 },
        { id: 'g3', position: [27.7, 45.7], status: 'NORMAL' },
        { id: 'g4', position: [27.8, 45.8] },
      ],
    });
    const points = layers.find((l) => l.id === 'flood-gauges');
    expect(points?.data.map((d) => d.label)).toEqual([
      'MODERATE · 3.2m',
      '1.1',
      'NORMAL',
      undefined,
    ]);
    const labels = layers.find((l) => l.id === 'flood-gauge-labels');
    expect(labels?.kind).toBe('text');
    expect(labels?.data.map((d) => d.label)).toEqual(['MODERATE · 3.2m', '1.1', 'NORMAL']);
    expect(
      buildFloodLayers({ gauges: [{ id: 'g4', position: [27.8, 45.8] }] }).map((l) => l.id),
    ).toEqual(['flood-gauges']);
  });

  it('hotspots carry their intensity, exposure nodes their reason — never the raw id', () => {
    const fire = buildFireLayers({
      hotspots: [
        { id: 'h1', position: [-121.6, 39.7], brightness: 341.2 },
        { id: 'h2', position: [-121.61, 39.71] },
      ],
    });
    expect(fire.find((l) => l.id === 'fire-hotspots')?.data.map((d) => d.label)).toEqual([
      'Hotspot · 341.2',
      'Hotspot',
    ]);
    const exposure = buildExposureLayers([
      { id: 'e1', position: [-121.6, 39.7], hazard: 'inside HOTSPOT buffer' },
      { id: 'e2', position: [-121.5, 39.7], name: 'Oroville Hospital', kind: 'HOSPITAL' },
    ]);
    expect(exposure[0]?.data.map((d) => d.label)).toEqual([
      'inside HOTSPOT buffer',
      'Oroville Hospital · HOSPITAL',
    ]);
  });
});
