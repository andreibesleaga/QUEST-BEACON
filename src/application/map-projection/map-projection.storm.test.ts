// BEACON — storm-family projection tests (ADR-032; FR-STORM-1/2, FU-9, FEV-5). PURE + deterministic: fixed
// clock, no IO, no net. Two claims are under test:
//   1. TRACK/CONE/STORM_SURGE hazards pass through `hazards` VERBATIM (projectHazard is kind-agnostic — the
//      one seam ADR-032 §2 says needs no new case), and
//   2. the derived `storm` wire slice carries the track as a LINE, the cone/surge as POLYGONS, and the
//      attribution (issuing agency + advisory instant) the cone's uncertainty label must name — with NO
//      BEACON-computed uncertainty figure anywhere, because BEACON models none of it (§6).
import { describe, it, expect } from 'vitest';
import { projectMap, type MapSource } from './map-projection.js';
import { makeHazardGeometry } from '@/domain/hazard-geometry.js';
import type { HazardKind } from '@/domain/hazard-geometry.js';
import { asId } from '@/domain/value-objects/ids.js';
import type {
  HazardGeometryId,
  IncidentId,
  RegionId,
  SourceId,
} from '@/domain/value-objects/ids.js';
import type {
  Geometry,
  LineStringGeometry,
  MultiPolygonGeometry,
  PolygonGeometry,
} from '@/domain/value-objects/geo.js';

const AT = '2026-07-05T22:00:00Z';
const ADVISORY_AT = '2026-07-05T21:00:00Z';
const REGION = asId<RegionId>('ph');
const INCIDENT = asId<IncidentId>('inc-storm-1');
const PAGASA = asId<SourceId>('pagasa-tcb');
const JTWC = asId<SourceId>('jtwc-warning');

const TRACK_LINE: LineStringGeometry = {
  type: 'LineString',
  coordinates: [
    [125.5, 12.5],
    [123.4, 13.2],
    [121.2, 14.1],
  ],
};
const CONE_POLY: PolygonGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [120, 13],
      [123, 13],
      [123, 15],
      [120, 15],
      [120, 13],
    ],
  ],
};
const SURGE_MULTI: MultiPolygonGeometry = {
  type: 'MultiPolygon',
  coordinates: [
    [
      [
        [120.9, 14.5],
        [121.1, 14.5],
        [121.1, 14.7],
        [120.9, 14.5],
      ],
    ],
    [
      [
        [121.5, 14.0],
        [121.7, 14.0],
        [121.7, 14.2],
        [121.5, 14.0],
      ],
    ],
  ],
};

function hazard(
  kind: HazardKind,
  geometry: Geometry,
  sourceId: SourceId = PAGASA,
  observedAt = ADVISORY_AT,
) {
  return makeHazardGeometry({
    id: asId<HazardGeometryId>(`hz-${kind}`),
    incidentId: INCIDENT,
    sourceId,
    kind,
    geometry,
    observedAt,
  });
}

/** A STORM incident's map source — every non-storm slice empty, so the assertions isolate the storm layer. */
function stormSource(hazards: MapSource['hazards']): MapSource {
  return {
    regionId: REGION,
    incidentType: 'STORM',
    hazards,
    gauges: [],
    infrastructure: [],
    exposure: [],
    shelters: [],
    reports: [],
    predictions: [],
    provenance: [{ sourceId: 'pagasa-tcb', mode: 'MOCK', fetchedAt: AT }],
  };
}

const projectStormSource = (hazards: MapSource['hazards']) =>
  projectMap({ source: stormSource(hazards), role: 'PUBLIC' }).storm;

describe('storm projection — hazard passthrough (ADR-032 §2)', () => {
  it('carries TRACK, CONE and STORM_SURGE through `hazards` verbatim, geometry and kind intact', () => {
    const hazards = [
      hazard('TRACK', TRACK_LINE),
      hazard('CONE', CONE_POLY),
      hazard('STORM_SURGE', SURGE_MULTI),
    ];
    const p = projectMap({ source: stormSource(hazards), role: 'PUBLIC' });
    expect(p.incidentType).toBe('STORM');
    expect(p.hazards.map((h) => h.kind)).toEqual(['TRACK', 'CONE', 'STORM_SURGE']);
    expect(p.hazards[0]?.geometry).toEqual(TRACK_LINE);
    expect(p.hazards[2]?.geometry).toEqual(SURGE_MULTI);
    expect(p.hazards.every((h) => h.observedAt === ADVISORY_AT)).toBe(true);
  });
});

describe('storm projection — the derived wire slice (FEV-5)', () => {
  it('projects a full advisory: track as a line, cone and surge as polygon rings', () => {
    const storm = projectStormSource([
      hazard('TRACK', TRACK_LINE),
      hazard('CONE', CONE_POLY),
      hazard('STORM_SURGE', SURGE_MULTI),
    ]);
    expect(storm?.track).toEqual(TRACK_LINE.coordinates);
    expect(storm?.cone).toEqual(CONE_POLY.coordinates);
    // MultiPolygon surge → the first polygon's rings (same rule the fire perimeter/flood reach already use).
    expect(storm?.surge).toEqual(SURGE_MULTI.coordinates[0]);
  });

  it('attributes the slice to the CONE issuer + advisory instant (the cone is what must be labelled)', () => {
    const storm = projectStormSource([
      hazard('TRACK', TRACK_LINE, JTWC, AT),
      hazard('CONE', CONE_POLY, PAGASA, ADVISORY_AT),
    ]);
    expect(storm?.agency).toBe('pagasa-tcb');
    expect(storm?.advisoryAt).toBe(ADVISORY_AT);
  });

  it('carries NO BEACON-computed uncertainty figure — the cone is ingested, not modelled (§6)', () => {
    const storm = projectStormSource([hazard('CONE', CONE_POLY)]);
    expect(storm).not.toHaveProperty('uncertainty');
    expect(storm).not.toHaveProperty('method');
    expect(Object.keys(storm ?? {}).sort()).toEqual(['advisoryAt', 'agency', 'cone']);
  });

  it('falls back to the track, then the surge, for attribution when no cone is issued yet', () => {
    expect(projectStormSource([hazard('TRACK', TRACK_LINE, JTWC, AT)])?.agency).toBe(
      'jtwc-warning',
    );
    expect(projectStormSource([hazard('STORM_SURGE', CONE_POLY, JTWC, AT)])?.agency).toBe(
      'jtwc-warning',
    );
  });

  it('emits only the geometries the advisory actually supplies (track-only / surge-only bulletins)', () => {
    const trackOnly = projectStormSource([hazard('TRACK', TRACK_LINE)]);
    expect(trackOnly?.track).toEqual(TRACK_LINE.coordinates);
    expect(trackOnly?.cone).toBeUndefined();
    expect(trackOnly?.surge).toBeUndefined();

    const surgeOnly = projectStormSource([hazard('STORM_SURGE', CONE_POLY)]);
    expect(surgeOnly?.surge).toEqual(CONE_POLY.coordinates);
    expect(surgeOnly?.track).toBeUndefined();
  });

  it('omits the slice entirely for a region with no storm geometry (absent, not empty — Art. XVI)', () => {
    expect(projectStormSource([hazard('PERIMETER', CONE_POLY)])).toBeUndefined();
    expect(projectStormSource([])).toBeUndefined();
  });

  it('skips a storm hazard whose geometry type cannot be plotted rather than coercing it', () => {
    // A TRACK that is not a LineString (a malformed upstream product) contributes nothing…
    expect(projectStormSource([hazard('TRACK', CONE_POLY)])).toBeUndefined();
    // …and a CONE that is not a polygon likewise, even though the kinds themselves are valid.
    expect(projectStormSource([hazard('CONE', TRACK_LINE)])).toBeUndefined();
    // …but a sibling geometry that IS plottable still renders (degraded, never dead-ended).
    const partial = projectStormSource([
      hazard('TRACK', CONE_POLY),
      hazard('STORM_SURGE', CONE_POLY),
    ]);
    expect(partial?.track).toBeUndefined();
    expect(partial?.surge).toEqual(CONE_POLY.coordinates);
  });

  it('uses the FIRST hazard of each kind (an advisory carries one track, one cone, one surge)', () => {
    const storm = projectStormSource([
      hazard('CONE', CONE_POLY, PAGASA, ADVISORY_AT),
      makeHazardGeometry({
        id: asId<HazardGeometryId>('hz-CONE-superseded'),
        incidentId: INCIDENT,
        sourceId: JTWC,
        kind: 'CONE',
        geometry: SURGE_MULTI,
        observedAt: AT,
      }),
    ]);
    expect(storm?.agency).toBe('pagasa-tcb');
    expect(storm?.cone).toEqual(CONE_POLY.coordinates);
  });
});
