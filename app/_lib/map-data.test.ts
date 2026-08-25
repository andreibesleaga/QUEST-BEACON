// BEACON — projection → MapData mapper tests (E8·map; Art. XII/XIV/XVI). PURE, no DOM/net. Asserts the
// domain-shaped projection maps to the deck.gl-facing MapData (fire/flood routing, infra/exposure/reports/
// shelters/prediction/route), that precise geometry passes through only when the envelope carried it (server
// gate, Art. XIV), and that per-layer freshness is stamped for populated layers only.
import { describe, it, expect } from 'vitest';
import type { SourceRef } from '@/ports/interaction.js';
import { projectionToMapData } from './map-data.js';
import type {
  MapProjectionData,
  ProjectedWeatherData,
  ProjectedFloodZoneData,
} from './types.js';

const poly = { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] as const };
const rings = [[[0, 0], [1, 0], [1, 1], [0, 0]]] as const;

/** A view onto the Phase-D layers W3b will declare on MapData (present at runtime today via passthrough). */
type PhaseDView = {
  readonly outage?: readonly { readonly id: string; readonly customersOut?: number }[];
  readonly cell?: readonly { readonly id: string; readonly online?: boolean }[];
  readonly weather?: ProjectedWeatherData;
  readonly floodZones?: readonly ProjectedFloodZoneData[];
};

/** Bare projection with only the Phase-D slices set (every other slice empty) for focused mapper tests. */
function phaseDProjection(over: Partial<MapProjectionData>): MapProjectionData {
  return {
    regionId: 'us-ca',
    incidentType: 'WILDFIRE',
    hazards: [],
    gauges: [],
    infrastructure: [],
    exposure: [],
    shelters: [],
    reports: [],
    predictions: [],
    ...over,
  };
}

function fullProjection(withPrecise: boolean): MapProjectionData {
  return {
    regionId: 'us-ca',
    incidentType: 'WILDFIRE',
    hazards: [
      { id: 'perim', kind: 'PERIMETER', geometry: poly, observedAt: 'x' },
      { id: 'hot', kind: 'HOTSPOT', geometry: { type: 'Point', coordinates: [-121.6, 39.7] }, observedAt: 'x' },
      { id: 'reach', kind: 'FLOOD_REACH', geometry: poly, observedAt: 'x' },
    ],
    gauges: [{ id: 'g1', position: [28, 45], floodCategory: 'MINOR', stage: 4.2 }],
    infrastructure: [{ id: 'sub', position: [-121.6, 39.7], kind: 'POWER', status: 'AT_RISK' }],
    exposure: [{ id: 'sub', position: [-121.6, 39.7], reason: 'IN_POLYGON', insideHazard: true }],
    shelters: [{ id: 'sh', position: [-121.4, 39.75], capacity: 200, demand: 20, status: 'OPEN' }],
    reports: [
      {
        id: 'rep',
        position: [-121.55, 39.7],
        status: 'VERIFIED',
        confidence: 0.8,
        ...(withPrecise ? { precisePosition: [-121.552, 39.703] as const } : {}),
      },
    ],
    predictions: [{ id: 'cone', geometry: poly, method: 'wind-buffer first-order', inputs: 'wind: 25', uncertainty: '±40%' }],
    route: { id: 'rt', path: [[-121.6, 39.7], [-121.4, 39.75]], avoidsHazard: true },
  };
}

describe('projectionToMapData', () => {
  it('routes hazards to fire (perimeter+hotspots) and flood (extent+gauges)', () => {
    const md = projectionToMapData(fullProjection(false), 'MOCK', '2026-07-05T22:00:00Z');
    expect(md.fire?.perimeter).toEqual(poly.coordinates);
    expect(md.fire?.hotspots).toEqual([{ id: 'hot', position: [-121.6, 39.7] }]);
    expect(md.flood?.extent).toEqual(poly.coordinates);
    expect(md.flood?.gauges[0]).toMatchObject({ id: 'g1', position: [28, 45], status: 'MINOR', stage: 4.2 });
  });

  it('maps infrastructure, exposure, shelters, prediction and route', () => {
    const md = projectionToMapData(fullProjection(false), 'MOCK', null);
    expect(md.infrastructure?.[0]).toMatchObject({ id: 'sub', kind: 'POWER', status: 'AT_RISK' });
    expect(md.exposure?.[0]).toMatchObject({ id: 'sub', hazard: 'IN_POLYGON' });
    expect(md.shelters?.[0]).toMatchObject({ id: 'sh', capacity: 200, demand: 20 });
    expect(md.predictions).toHaveLength(1);
    expect(md.predictions?.[0]).toMatchObject({ id: 'cone', polygon: poly.coordinates, method: 'wind-buffer first-order' });
    expect(md.route).toMatchObject({ id: 'rt', hazardAvoided: true });
  });

  it('maps EVERY wire prediction to its own cone, in order (ADR-033 §3.1)', () => {
    const second = { id: 'crest', geometry: poly, method: 'NWPS forecast-crest ∩ FEMA NFHL', inputs: 'crest: 4.2', uncertainty: '±25%' };
    const p: MapProjectionData = { ...fullProjection(false), predictions: [...fullProjection(false).predictions, second] };
    const md = projectionToMapData(p, 'MOCK', null);
    expect(md.predictions?.map((c) => c.id)).toEqual(['cone', 'crest']);
    expect(md.predictions?.map((c) => c.uncertainty)).toEqual(['±40%', '±25%']);
    expect(md.freshness?.prediction).toBeDefined(); // the toggle lights up off the PLURAL field
  });

  it('skips a prediction whose geometry is not a polygon, keeping the plottable ones', () => {
    const pointPred = { id: 'trend', geometry: { type: 'Point', coordinates: [0, 0] } as const, method: 'trend', inputs: 'slope: 1', uncertainty: '±20%' };
    const p: MapProjectionData = { ...fullProjection(false), predictions: [pointPred, ...fullProjection(false).predictions] };
    expect(projectionToMapData(p, 'MOCK', null).predictions?.map((c) => c.id)).toEqual(['cone']);
    const onlyUnplottable: MapProjectionData = { ...fullProjection(false), predictions: [pointPred] };
    const md = projectionToMapData(onlyUnplottable, 'MOCK', null);
    expect(md.predictions).toBeUndefined(); // no plottable cone ⇒ absent layer, not an empty one (Art. XVI)
    expect(md.freshness?.prediction).toBeUndefined();
  });

  it('passes precise report geometry through only when present (server-gated, Art. XIV)', () => {
    expect(projectionToMapData(fullProjection(true), 'MOCK', null).reports?.[0]?.precisePosition).toEqual([-121.552, 39.703]);
    expect(projectionToMapData(fullProjection(false), 'MOCK', null).reports?.[0]?.precisePosition).toBeUndefined();
  });

  it('stamps freshness on populated layers with the envelope mode + timestamp', () => {
    const md = projectionToMapData(fullProjection(false), 'MOCK', '2026-07-05T22:00:00Z');
    expect(md.freshness?.fire).toEqual({ fetchedAt: '2026-07-05T22:00:00Z', mode: 'MOCK' });
    expect(md.freshness?.route).toEqual({ fetchedAt: '2026-07-05T22:00:00Z', mode: 'MOCK' });
    expect(md.freshness?.outage).toBeUndefined(); // an absent layer contributes no freshness
  });

  it('omits empty layers so an absent layer contributes nothing (Art. XVI)', () => {
    const empty: MapProjectionData = {
      regionId: 'ro', incidentType: 'FLOOD', hazards: [], gauges: [], infrastructure: [], exposure: [], shelters: [], reports: [], predictions: [],
    };
    const md = projectionToMapData(empty, 'MOCK', null);
    expect(md.fire).toBeUndefined();
    expect(md.flood).toBeUndefined();
    expect(md.infrastructure).toBeUndefined();
    expect(md.predictions).toBeUndefined();
    expect(md.route).toBeUndefined();
    expect(md.freshness).toEqual({});
  });
});

describe('projectionToMapData — Phase-D slices (outage/cell/weather/floodzone)', () => {
  it('maps a populated outage slice, preserving customersOut/assumedOffline for the builder', () => {
    const p = phaseDProjection({
      outage: [{ id: 'o1', polygon: rings, assumedOffline: true, customersOut: 1200 }],
    });
    const md = projectionToMapData(p, 'CACHED', '2026-07-05T22:00:00Z') as PhaseDView & { freshness?: Record<string, unknown> };
    expect(md.outage?.[0]).toMatchObject({ id: 'o1', customersOut: 1200 });
    expect(md.freshness?.outage).toBeDefined();
  });

  it('maps a populated cell slice, preserving online (rides through structurally for W3b)', () => {
    const p = phaseDProjection({ cell: [{ id: 'c1', position: [-121.6, 39.7], online: false, technology: 'LTE' }] });
    const md = projectionToMapData(p, 'CACHED', null) as PhaseDView;
    expect(md.cell?.[0]).toMatchObject({ id: 'c1', online: false });
  });

  it('maps the single weather glyph (wire shape is the client shape — Art. XII passthrough)', () => {
    const weather: ProjectedWeatherData = {
      position: [-121.6, 39.7],
      speedKmh: 25,
      directionDeg: 210,
      // The engine now also ships the structured parts (compass token + raw timestamp) so the client can
      // render the glyph in the active language; `label` stays as the English/non-UI fallback (ADR-030).
      compass: 'SW',
      observedAt: '2026-07-05T22:00:00Z',
      label: 'Wind 25 km/h from SW (210°), obs x',
    };
    const md = projectionToMapData(phaseDProjection({ weather }), 'LIVE', null) as PhaseDView;
    expect(md.weather).toEqual(weather);
  });

  it('maps the flood-zone polygons', () => {
    const p = phaseDProjection({ floodZones: [{ id: 'z1', zone: 'AE', polygon: rings }] });
    const md = projectionToMapData(p, 'CACHED', null) as PhaseDView;
    expect(md.floodZones?.[0]).toMatchObject({ id: 'z1', zone: 'AE' });
  });

  it('omits an empty or missing Phase-D slice (never a dead-end, Art. XVI)', () => {
    const md = projectionToMapData(phaseDProjection({ outage: [], cell: [], floodZones: [] }), 'MOCK', null) as PhaseDView & { freshness: Record<string, unknown> };
    expect(md.outage).toBeUndefined();
    expect(md.cell).toBeUndefined();
    expect(md.weather).toBeUndefined();
    expect(md.floodZones).toBeUndefined();
    expect(md.freshness).toEqual({});
  });
});

describe('projectionToMapData — per-layer freshness resolution', () => {
  const provenance: readonly SourceRef[] = [
    { sourceId: 'eagle-i', mode: 'CACHED', fetchedAt: '2026-07-05T18:00:00Z' },
    { sourceId: 'opencellid', mode: 'LIVE', fetchedAt: '2026-07-05T21:30:00Z' },
  ];

  it('stamps each layer from its OWN mapped source (layerSources → provenance ref fetchedAt/mode)', () => {
    const p = phaseDProjection({
      outage: [{ id: 'o1', polygon: rings, assumedOffline: true }],
      cell: [{ id: 'c1', position: [-121.6, 39.7], online: true }],
      layerSources: { outage: 'eagle-i', cell: 'opencellid' },
    });
    const md = projectionToMapData(p, 'MOCK', '2026-07-05T22:00:00Z', provenance);
    expect(md.freshness?.outage).toEqual({ fetchedAt: '2026-07-05T18:00:00Z', mode: 'CACHED' });
    expect(md.freshness?.cell).toEqual({ fetchedAt: '2026-07-05T21:30:00Z', mode: 'LIVE' });
  });

  it('falls back to the shared stamp when layerSources maps to an UNKNOWN source (degraded rung)', () => {
    const p = phaseDProjection({
      outage: [{ id: 'o1', polygon: rings, assumedOffline: true }],
      layerSources: { outage: 'not-in-provenance' },
    });
    const md = projectionToMapData(p, 'MOCK', '2026-07-05T22:00:00Z', provenance);
    expect(md.freshness?.outage).toEqual({ fetchedAt: '2026-07-05T22:00:00Z', mode: 'MOCK' });
  });

  it('falls back to the shared stamp when layerSources is ABSENT entirely (old envelope)', () => {
    const p = phaseDProjection({ outage: [{ id: 'o1', polygon: rings, assumedOffline: true }] });
    const md = projectionToMapData(p, 'CACHED', '2026-07-05T20:00:00Z', provenance);
    expect(md.freshness?.outage).toEqual({ fetchedAt: '2026-07-05T20:00:00Z', mode: 'CACHED' });
  });

  it('resolves layers independently — one mapped, one fell back — in a single projection', () => {
    const p = phaseDProjection({
      hazards: [{ id: 'hot', kind: 'HOTSPOT', geometry: { type: 'Point', coordinates: [-121.6, 39.7] }, observedAt: 'x' }],
      outage: [{ id: 'o1', polygon: rings, assumedOffline: true }],
      layerSources: { outage: 'eagle-i' }, // fire has no mapped source → shared fallback
    });
    const md = projectionToMapData(p, 'MOCK', '2026-07-05T22:00:00Z', provenance);
    expect(md.freshness?.outage).toEqual({ fetchedAt: '2026-07-05T18:00:00Z', mode: 'CACHED' });
    expect(md.freshness?.fire).toEqual({ fetchedAt: '2026-07-05T22:00:00Z', mode: 'MOCK' });
  });
});

// ── Storm slice (ADR-032; FR-STORM-2) ─────────────────────────────────────────────────────────────
// The storm wire slice is structurally identical to the component `StormData`, so this is a passthrough —
// the client never re-derives a track, a cone or a surge extent (Art. XII). What still needs pinning is the
// PRESENCE logic: the layer must appear in `presentLayers` (so it gets a freshness badge) exactly when it
// carries geometry, and be absent — not empty — otherwise (Art. XVI).

const STORM_TRACK = [[125.5, 12.5], [123.4, 13.2]] as const;
const STORM_CONE = [[[120, 13], [123, 13], [123, 15], [120, 13]]] as const;

describe('projectionToMapData — storm slice', () => {
  it('passes the track, cone, surge and attribution through verbatim', () => {
    const storm = { track: STORM_TRACK, cone: STORM_CONE, surge: rings, agency: 'pagasa-tcb', advisoryAt: '2026-07-05T21:00:00Z' };
    const md = projectionToMapData(phaseDProjection({ incidentType: 'STORM', storm }), 'MOCK', null);
    expect(md.storm).toEqual(storm);
  });

  it('stamps freshness for the storm layer once it is populated', () => {
    const md = projectionToMapData(
      phaseDProjection({ storm: { cone: STORM_CONE } }),
      'CACHED',
      '2026-07-05T22:00:00Z',
    );
    expect(md.freshness?.storm).toEqual({ fetchedAt: '2026-07-05T22:00:00Z', mode: 'CACHED' });
  });

  it('resolves the storm layer to its own source when layerSources names one', () => {
    const provenance: readonly SourceRef[] = [
      { sourceId: 'pagasa-tcb', mode: 'LIVE', fetchedAt: '2026-07-05T21:30:00Z' },
    ];
    const md = projectionToMapData(
      phaseDProjection({ storm: { cone: STORM_CONE }, layerSources: { storm: 'pagasa-tcb' } }),
      'MOCK',
      '2026-07-05T22:00:00Z',
      provenance,
    );
    expect(md.freshness?.storm).toEqual({ fetchedAt: '2026-07-05T21:30:00Z', mode: 'LIVE' });
  });

  it('omits the layer for a region with no storm, and for a slice carrying no geometry', () => {
    expect(projectionToMapData(phaseDProjection({}), 'MOCK', null).storm).toBeUndefined();
    const attributionOnly = { agency: 'pagasa-tcb', advisoryAt: '2026-07-05T21:00:00Z' };
    const md = projectionToMapData(phaseDProjection({ storm: attributionOnly }), 'MOCK', null);
    expect(md.storm).toBeUndefined();
    expect(md.freshness?.storm).toBeUndefined();
  });
});
