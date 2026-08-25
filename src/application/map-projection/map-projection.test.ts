// BEACON — map-projection use-case tests (E8·map; Art. XII/XIV). PURE + deterministic: no clock/IO/net.
// Covers the golden projection, the RESPONDER+ precise-PII gate (Art. XIV), the empty-region case, and the
// non-point / missing-layer skip branches (geometry that can't be plotted is dropped, never faked).
import { describe, it, expect } from 'vitest';
import { projectMap, type MapSource, type ExposureSource, type OutageArea, type CellSite, type WeatherGlyph } from './map-projection.js';
import { makeFloodZone } from '@/domain/flood-zone.js';
import { makeCameraFeed } from '@/domain/camera-feed.js';
import type { CameraFeed } from '@/domain/camera-feed.js';
import type { CameraFeedId } from '@/domain/value-objects/ids.js';
import { makeHazardGeometry } from '@/domain/hazard-geometry.js';
import { makeGauge } from '@/domain/gauge.js';
import { makeInfrastructureNode } from '@/domain/infrastructure-node.js';
import { makeExposure } from '@/domain/exposure.js';
import { makeShelter } from '@/domain/shelter.js';
import { makePublicReport } from '@/domain/public-report.js';
import { makePrediction } from '@/domain/prediction.js';
import {
  projectEscalation,
  projectImpactOverTime,
} from '@/application/prediction-projection/trend-projection.js';
import { makeEvacRoute } from '@/domain/evac-route.js';
import { asId } from '@/domain/value-objects/ids.js';
import type {
  RegionId,
  IncidentId,
  SourceId,
  HazardGeometryId,
  GaugeId,
  InfrastructureNodeId,
  PredictionId,
  EvacRouteId,
  ShelterId,
  PublicReportId,
} from '@/domain/value-objects/ids.js';
import type { PointGeometry, PolygonGeometry, LineStringGeometry } from '@/domain/value-objects/geo.js';

const AT = '2026-07-05T22:00:00Z';
const REGION = asId<RegionId>('us-ca');
const INCIDENT = asId<IncidentId>('inc-1');
const SRC = asId<SourceId>('firms');
const point = (c: PointGeometry['coordinates']): PointGeometry => ({ type: 'Point', coordinates: c });
const poly: PolygonGeometry = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };
const provenance = [{ sourceId: 'firms', mode: 'MOCK', fetchedAt: AT }] as const;

const NODE = asId<InfrastructureNodeId>('node-1');
const substation = makeInfrastructureNode({ id: NODE, type: 'POWER', status: 'AT_RISK', geom: point([-121.6, 39.7]) });

/** A fully-populated source (all layers present). */
function fullSource(): MapSource {
  const exposure: ExposureSource = {
    exposure: makeExposure({ incidentId: INCIDENT, nodeId: NODE, reason: 'IN_POLYGON', insideHazard: true, computedAt: AT }),
    node: substation,
  };
  return {
    regionId: REGION,
    incidentType: 'WILDFIRE',
    hazards: [
      makeHazardGeometry({ id: asId<HazardGeometryId>('hz-1'), incidentId: INCIDENT, sourceId: SRC, kind: 'PERIMETER', geometry: poly, observedAt: AT }),
      makeHazardGeometry({ id: asId<HazardGeometryId>('hz-2'), incidentId: INCIDENT, sourceId: SRC, kind: 'HOTSPOT', geometry: point([-121.6, 39.7]), observedAt: AT, intensity: 340 }),
    ],
    gauges: [makeGauge({ id: asId<GaugeId>('g-1'), geom: point([28, 45]), floodCategory: 'MINOR', stage: 4.2 })],
    infrastructure: [substation],
    exposure: [exposure],
    shelters: [makeShelter({ id: asId<ShelterId>('sh-1'), geom: point([-121.4, 39.75]), capacity: 200, occupancy: 20 })],
    reports: [
      makePublicReport({
        id: asId<PublicReportId>('rep-1'),
        source: 'WEB',
        status: 'VERIFIED',
        consent: true,
        confidence: 0.8,
        geomGeneralized: point([-121.55, 39.7]),
        geomPrecise: point([-121.552, 39.703]),
        purgeAfter: '2026-08-05T22:00:00Z',
      }),
    ],
    predictions: [
      makePrediction({
        id: asId<PredictionId>('pr-1'),
        incidentId: INCIDENT,
        kind: 'FIRE_CONE',
        method: 'wind-buffer first-order',
        inputs: { wind: '25 km/h', from: 'NE' },
        uncertainty: 0.4,
        geom: poly,
      }),
    ],
    route: makeEvacRoute({ id: asId<EvacRouteId>('rt-1'), incidentId: INCIDENT, geom: { type: 'LineString', coordinates: [[-121.6, 39.7], [-121.4, 39.75]] } satisfies LineStringGeometry, avoidsHazard: true }),
    provenance,
    freshness: AT,
  };
}

describe('projectMap — golden projection', () => {
  it('maps every layer to its DOMAIN-shaped projection (deterministic)', () => {
    const p = projectMap({ source: fullSource(), role: 'RESPONDER' });
    expect(p.regionId).toBe('us-ca');
    expect(p.incidentType).toBe('WILDFIRE');
    expect(p.hazards).toHaveLength(2);
    expect(p.hazards[0]).toMatchObject({ id: 'hz-1', kind: 'PERIMETER', geometry: poly, observedAt: AT });
    expect(p.hazards[1]).toMatchObject({ kind: 'HOTSPOT', intensity: 340 });
    expect(p.gauges[0]).toMatchObject({ id: 'g-1', position: [28, 45], floodCategory: 'MINOR', stage: 4.2 });
    expect(p.infrastructure[0]).toMatchObject({ id: 'node-1', position: [-121.6, 39.7], kind: 'POWER', status: 'AT_RISK' });
    expect(p.exposure[0]).toMatchObject({ id: 'node-1', position: [-121.6, 39.7], reason: 'IN_POLYGON', insideHazard: true });
    expect(p.shelters[0]).toMatchObject({ id: 'sh-1', capacity: 200, demand: 20, status: 'OPEN' });
    expect(p.predictions).toHaveLength(1);
    expect(p.predictions[0]).toMatchObject({ id: 'pr-1', method: 'wind-buffer first-order', inputs: 'wind: 25 km/h, from: NE', uncertainty: '±40%' });
    // The deprecated singular mirror stays byte-identical to `predictions[0]` for v1 clients (ADR-033 §3.1).
    expect(p.prediction).toEqual(p.predictions[0]);
    expect(p.route).toMatchObject({ id: 'rt-1', avoidsHazard: true });
    expect(p.route?.path).toEqual([[-121.6, 39.7], [-121.4, 39.75]]);
  });
});

describe('projectMap — precise-PII RBAC gate (Art. XIV)', () => {
  it('RESPONDER sees the precise report position', () => {
    const p = projectMap({ source: fullSource(), role: 'RESPONDER' });
    expect(p.reports[0]).toMatchObject({ id: 'rep-1', position: [-121.55, 39.7], precisePosition: [-121.552, 39.703], status: 'VERIFIED', confidence: 0.8 });
  });

  it('PUBLIC sees ONLY the generalized position (no precise geometry leaks)', () => {
    const p = projectMap({ source: fullSource(), role: 'PUBLIC' });
    expect(p.reports[0]?.position).toEqual([-121.55, 39.7]);
    expect(p.reports[0]?.precisePosition).toBeUndefined();
  });

  it('a report with no precise geometry has no precisePosition even for RESPONDER', () => {
    const src = fullSource();
    const report = makePublicReport({ id: asId<PublicReportId>('rep-2'), source: 'WEB', status: 'VERIFIED', consent: true, geomGeneralized: point([1, 2]), purgeAfter: '2026-08-05T22:00:00Z' });
    const p = projectMap({ source: { ...src, reports: [report] }, role: 'EM' });
    expect(p.reports[0]?.position).toEqual([1, 2]);
    expect(p.reports[0]?.precisePosition).toBeUndefined();
  });
});

describe('projectMap — empty region', () => {
  it('preserves empty layers and omits absent prediction/route', () => {
    const src: MapSource = { regionId: REGION, incidentType: 'WILDFIRE', hazards: [], gauges: [], infrastructure: [], exposure: [], shelters: [], reports: [], predictions: [], provenance };
    const p = projectMap({ source: src, role: 'PUBLIC' });
    expect(p.hazards).toEqual([]);
    expect(p.gauges).toEqual([]);
    expect(p.infrastructure).toEqual([]);
    expect(p.reports).toEqual([]);
    expect(p.predictions).toEqual([]);
    expect(p.prediction).toBeUndefined(); // no first survivor ⇒ the v1 mirror key is absent, exactly as before
    expect(p.route).toBeUndefined();
  });
});

describe('projectMap — non-point / missing-layer skip branches', () => {
  it('skips an infra node / exposure node whose geometry is not a Point', () => {
    const roadNode = makeInfrastructureNode({ id: asId<InfrastructureNodeId>('road-1'), type: 'ROAD', geom: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } });
    const src: MapSource = {
      ...fullSource(),
      infrastructure: [roadNode],
      exposure: [{ exposure: makeExposure({ incidentId: INCIDENT, nodeId: asId<InfrastructureNodeId>('road-1'), reason: 'IN_BUFFER', computedAt: AT }), node: roadNode }],
    };
    const p = projectMap({ source: src, role: 'RESPONDER' });
    expect(p.infrastructure).toEqual([]);
    expect(p.exposure).toEqual([]);
  });

  it('skips a report with no generalized geometry, and one whose generalized geometry is not a Point', () => {
    const noGeom = makePublicReport({ id: asId<PublicReportId>('rep-3'), source: 'WEB', status: 'VERIFIED', consent: true, purgeAfter: '2026-08-05T22:00:00Z' });
    const polyGeom = makePublicReport({ id: asId<PublicReportId>('rep-4'), source: 'WEB', status: 'VERIFIED', consent: true, geomGeneralized: poly, purgeAfter: '2026-08-05T22:00:00Z' });
    const p = projectMap({ source: { ...fullSource(), reports: [noGeom, polyGeom] }, role: 'PUBLIC' });
    expect(p.reports).toEqual([]);
  });

  it('omits a prediction that carries no geometry, keeping the geolocated ones', () => {
    const src = fullSource();
    const noGeomPrediction = makePrediction({ id: asId<PredictionId>('pr-2'), incidentId: INCIDENT, kind: 'ESCALATION', method: 'trend', inputs: {}, uncertainty: 0.2 });
    const only = projectMap({ source: { ...src, predictions: [noGeomPrediction] }, role: 'PUBLIC' });
    expect(only.predictions).toEqual([]);
    expect(only.prediction).toBeUndefined();
    // A geometry-less prediction is skipped WITHOUT displacing the plottable ones that follow it.
    const mixed = projectMap({ source: { ...src, predictions: [noGeomPrediction, ...src.predictions] }, role: 'PUBLIC' });
    expect(mixed.predictions.map((x) => x.id)).toEqual(['pr-1']);
    expect(mixed.prediction?.id).toBe('pr-1');
  });

  it('the REAL constructed ESCALATION/IMPACT_OVER_TIME kinds produce no descriptor and displace nothing', () => {
    // Not a hand-built stub: these are the records the C2.2 projectors actually emit (ADR-033 §4.1/§4.2),
    // which carry no geometry by design (finding F-77). The cone must come through byte-identically.
    const samples = [
      { t: 0, value: 10 },
      { t: 3600, value: 20 },
      { t: 7200, value: 30 },
    ];
    const escalation = projectEscalation({
      id: asId<PredictionId>('esc-1'),
      incidentId: INCIDENT,
      signal: { samples },
      signalLabel: 'burned area (acres)',
    });
    const impact = projectImpactOverTime({
      id: asId<PredictionId>('imp-1'),
      incidentId: INCIDENT,
      basis: 'exposedPopulation',
      currentCount: 90,
      series: samples,
      signalLabel: 'burned area (acres)',
      nowMs: Date.parse(AT),
    });
    const src = fullSource();
    const bare = projectMap({ source: src, role: 'PUBLIC' });
    const mixed = projectMap({
      source: { ...src, predictions: [escalation!, ...src.predictions, impact!] },
      role: 'PUBLIC',
    });
    expect(escalation?.kind).toBe('ESCALATION');
    expect(impact?.kind).toBe('IMPACT_OVER_TIME');
    expect(mixed.predictions).toEqual(bare.predictions); // one cone in, the same one cone out
    expect(mixed.prediction).toEqual(bare.prediction);
  });

  it('projects EVERY prediction, each keeping its own method/inputs/uncertainty (ADR-033 §3.1)', () => {
    const src = fullSource();
    const second = makePrediction({
      id: asId<PredictionId>('pr-9'),
      incidentId: INCIDENT,
      kind: 'FLOOD_INUNDATION',
      method: 'NWPS forecast-crest ∩ FEMA NFHL',
      inputs: { crest: '4.2 m' },
      uncertainty: 0.25,
      geom: poly,
    });
    const p = projectMap({ source: { ...src, predictions: [...src.predictions, second] }, role: 'PUBLIC' });
    expect(p.predictions).toHaveLength(2);
    expect(p.predictions[0]).toMatchObject({ id: 'pr-1', method: 'wind-buffer first-order', uncertainty: '±40%' });
    expect(p.predictions[1]).toMatchObject({ id: 'pr-9', method: 'NWPS forecast-crest ∩ FEMA NFHL', inputs: 'crest: 4.2 m', uncertainty: '±25%' });
    expect(p.prediction?.id).toBe('pr-1'); // the v1 mirror still names the FIRST, never a merged blob
  });

  it('omits the intensity when a hazard has none', () => {
    const src = fullSource();
    const p = projectMap({ source: { ...src, hazards: [src.hazards[0]!] }, role: 'PUBLIC' });
    expect(p.hazards[0]?.intensity).toBeUndefined();
  });

  it('omits gauge stage when absent', () => {
    const src = fullSource();
    const g = makeGauge({ id: asId<GaugeId>('g-2'), geom: point([1, 1]), floodCategory: 'NONE' });
    const p = projectMap({ source: { ...src, gauges: [g] }, role: 'PUBLIC' });
    expect(p.gauges[0]?.stage).toBeUndefined();
  });
});

// ── Phase-D layers: outage / cell / weather / floodzone (derived source → anonymous wire shapes) ────────

describe('projectMap — Phase-D map layers', () => {
  const outageFull: OutageArea = {
    id: 'outage-0',
    polygon: [[[-121.7, 39.6], [-121.5, 39.6], [-121.5, 39.8], [-121.7, 39.8], [-121.7, 39.6]]],
    assumedOffline: true,
    observedAt: AT,
    customersOut: 1200,
  };
  const cellFull: CellSite = { id: 'cell-0', position: [-121.6, 39.7], online: false, technology: 'LTE' };
  const weather: WeatherGlyph = { position: [-121.6, 39.7], speedKmh: 25, directionDeg: 225, observedAt: AT };
  const zone = makeFloodZone({ id: 'z-ae', zone: 'AE', geom: poly });

  it('projects every Phase-D slice to its wire shape and drops the raw source timestamp', () => {
    const src: MapSource = {
      ...fullSource(),
      outages: [outageFull],
      cellSites: [cellFull],
      weather,
      floodZones: [zone],
      layerSources: { outage: 'eagle-i', cell: 'opencellid', weather: 'open-meteo', floodzone: 'nfhl' },
    };
    const p = projectMap({ source: src, role: 'RESPONDER' });
    expect(p.outage?.[0]).toEqual({ id: 'outage-0', polygon: outageFull.polygon, assumedOffline: true, customersOut: 1200 });
    expect(p.outage?.[0]).not.toHaveProperty('observedAt'); // no raw timestamp leak
    expect(p.cell?.[0]).toEqual({ id: 'cell-0', position: [-121.6, 39.7], online: false, technology: 'LTE' });
    // The glyph now also ships the structured parts — the compass TOKEN and the raw observation time — so
    // the client can render the label in the active language, while `label` stays as the English/non-UI
    // form (ADR-030: server closed vocabularies are localized at the presentation edge, not in the engine).
    expect(p.weather).toEqual({
      position: [-121.6, 39.7],
      speedKmh: 25,
      directionDeg: 225,
      compass: 'SW',
      observedAt: AT,
      label: `Wind 25 km/h from SW (225°), obs ${AT}`,
    });
    expect(p.floodZones?.[0]).toEqual({ id: 'z-ae', zone: 'AE', polygon: poly.coordinates });
    expect(p.layerSources).toEqual({ outage: 'eagle-i', cell: 'opencellid', weather: 'open-meteo', floodzone: 'nfhl' });
  });

  it('omits optional customersOut / technology when absent', () => {
    const src: MapSource = {
      ...fullSource(),
      outages: [{ id: 'outage-0', polygon: outageFull.polygon, assumedOffline: true, observedAt: AT }],
      cellSites: [{ id: 'cell-0', position: [-121.6, 39.7], online: true }],
    };
    const p = projectMap({ source: src, role: 'PUBLIC' });
    expect(p.outage?.[0]).not.toHaveProperty('customersOut');
    expect(p.cell?.[0]).not.toHaveProperty('technology');
    expect(p.cell?.[0]?.online).toBe(true);
  });

  it('preserves empty Phase-D layers and omits absent ones', () => {
    const src: MapSource = { ...fullSource(), outages: [], cellSites: [] };
    const p = projectMap({ source: src, role: 'PUBLIC' });
    expect(p.outage).toEqual([]);
    expect(p.cell).toEqual([]);
    expect(p.weather).toBeUndefined();
    expect(p.floodZones).toBeUndefined();
    expect(p.layerSources).toBeUndefined();
  });
});

// ── E11 "Live Views": camera link-out pins (verbatim, role-independent, https-defended) ────────────────

describe('projectMap — live cameras (E11)', () => {
  const cam = makeCameraFeed({
    id: asId<CameraFeedId>('alertca:cam-2'),
    position: [-121.62, 39.76],
    kind: 'FIRE_CAMERA',
    title: 'Colby Fire — Camera 2',
    provider: 'ALERTCalifornia',
    viewUrl: 'https://cameras.alertcalifornia.org/cam/colby-2',
    license: 'ALERTCalifornia | UC San Diego',
    isLive: true,
  });

  it('projects a camera VERBATIM to its wire pin (role-independent — cameras are public)', () => {
    const p = projectMap({ source: { ...fullSource(), cameras: [cam] }, role: 'PUBLIC' });
    expect(p.cameras?.[0]).toEqual({
      id: 'alertca:cam-2',
      position: [-121.62, 39.76],
      kind: 'FIRE_CAMERA',
      title: 'Colby Fire — Camera 2',
      provider: 'ALERTCalifornia',
      viewUrl: 'https://cameras.alertcalifornia.org/cam/colby-2',
      isLive: true,
    });
  });

  it('preserves an empty camera slice', () => {
    const p = projectMap({ source: { ...fullSource(), cameras: [] }, role: 'PUBLIC' });
    expect(p.cameras).toEqual([]);
  });

  it('omits the camera slice entirely when the source has none', () => {
    expect(projectMap({ source: fullSource(), role: 'PUBLIC' }).cameras).toBeUndefined();
  });

  it('DEFENSIVELY drops a feed whose viewUrl is not https (belt-and-suspenders link-out guard)', () => {
    // A malformed feed bypassing the domain factory (which would reject it) must still never reach an href.
    const badCam = { ...cam, viewUrl: 'http://insecure.example.org/cam' } as unknown as CameraFeed;
    const p = projectMap({ source: { ...fullSource(), cameras: [cam, badCam] }, role: 'PUBLIC' });
    expect(p.cameras).toHaveLength(1);
    expect(p.cameras?.[0]?.id).toBe('alertca:cam-2');
  });

  // F-153: this last-mile guard was a private `/^https:\/\//i` — WEAKER than the domain invariant it exists
  // to back up, so a feed that bypassed the factory with an IP-literal host sailed through to an href. It now
  // derives from @/domain/shared/link-policy. Restore the regex and this test goes red.
  it('DEFENSIVELY drops a feed with an IP-LITERAL host, which the old regex guard let through (F-153)', () => {
    const metadataCam = { ...cam, id: 'bad:v4', viewUrl: 'https://169.254.169.254/cam' } as unknown as CameraFeed;
    const v6Cam = { ...cam, id: 'bad:v6', viewUrl: 'https://[::1]/cam' } as unknown as CameraFeed;
    const p = projectMap({ source: { ...fullSource(), cameras: [cam, metadataCam, v6Cam] }, role: 'PUBLIC' });
    expect(p.cameras).toHaveLength(1);
    expect(p.cameras?.[0]?.id).toBe('alertca:cam-2');
  });
});
