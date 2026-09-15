// BEACON — ACL mapper round-trip tests (E3·T-116…T-121). Pure (no DB): a DB row → domain → row must
// preserve every field, especially provenance/freshness (sourceId, fetchedAt, observedAt, computedAt).
import { describe, expect, it } from 'vitest';
import {
  alertMapper,
  citationMapper,
  evacRouteMapper,
  exposureMapper,
  hazardGeometryMapper,
  incidentMapper,
  regionMapper,
  resourceMapper,
  resourceTaskMapper,
  shelterMapper,
  sourceRecordMapper,
  thresholdRuleMapper,
} from './mappers';

const T = new Date('2024-09-01T12:00:00.000Z');

describe('incidentMapper', () => {
  it('round-trips a DB row through the domain factory', () => {
    const row = {
      id: 'inc-1',
      regionId: 'reg-1',
      type: 'WILDFIRE',
      status: 'ACTIVE',
      domainId: null,
      createdAt: T,
      updatedAt: T,
    };
    const domain = incidentMapper.fromRow(row);
    expect(domain).toMatchObject({
      id: 'inc-1',
      regionId: 'reg-1',
      type: 'WILDFIRE',
      status: 'ACTIVE',
    });
    expect(incidentMapper.toRow(domain)).toEqual({
      id: 'inc-1',
      regionId: 'reg-1',
      type: 'WILDFIRE',
      status: 'ACTIVE',
    });
  });
});

describe('sourceRecordMapper (provenance + freshness)', () => {
  it('preserves fetchedAt across row->domain->row', () => {
    const row = {
      id: 'src-1',
      source: 'NASA FIRMS',
      adapter: 'firms-adapter',
      fetchedAt: T,
      license: 'NASA open',
      mode: 'LIVE',
      createdAt: T,
    };
    const domain = sourceRecordMapper.fromRow(row);
    expect(domain.fetchedAt).toBe(T.toISOString());
    expect(domain.mode).toBe('LIVE');
    const back = sourceRecordMapper.toRow(domain);
    expect(back.fetchedAt).toEqual(T);
    expect(back.license).toBe('NASA open');
  });
});

describe('hazardGeometryMapper (GeoJSON + provenance)', () => {
  it('round-trips geometry, sourceId and observedAt', () => {
    const geom = { type: 'Point', coordinates: [-121.5, 38.6] } as const;
    const row = {
      id: 'hz-1',
      incidentId: 'inc-1',
      kind: 'HOTSPOT',
      geom,
      bbox: null,
      intensity: 42,
      observedAt: T,
      sourceId: 'src-1',
      createdAt: T,
    };
    const domain = hazardGeometryMapper.fromRow(row);
    expect(domain.geometry).toEqual(geom);
    expect(domain.sourceId).toBe('src-1');
    expect(domain.observedAt).toBe(T.toISOString());
    expect(domain.intensity).toBe(42);
    const back = hazardGeometryMapper.toRow(domain);
    expect(back.geom).toEqual(geom);
    expect(back.sourceId).toBe('src-1');
    expect(back.observedAt).toEqual(T);
  });
});

describe('exposureMapper (deterministic result, computedAt)', () => {
  it('round-trips the (incident,node) exposure with distance', () => {
    const row = {
      id: 'exp-1',
      incidentId: 'inc-1',
      nodeId: 'node-1',
      insideHazard: true,
      distanceM: 0,
      reason: 'IN_POLYGON',
      computedAt: T,
      createdAt: T,
    };
    const domain = exposureMapper.fromRow(row);
    expect(domain).toMatchObject({
      incidentId: 'inc-1',
      nodeId: 'node-1',
      insideHazard: true,
      reason: 'IN_POLYGON',
      distanceM: 0,
    });
    expect(domain.computedAt).toBe(T.toISOString());
    const back = exposureMapper.toRow(domain);
    expect(back).toMatchObject({
      incidentId: 'inc-1',
      nodeId: 'node-1',
      reason: 'IN_POLYGON',
      insideHazard: true,
    });
  });
});

describe('alertMapper (approval invariant preserved)', () => {
  it('round-trips an ACTUAL alert with approver + area', () => {
    const area = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    } as const;
    const row = {
      id: 'al-1',
      incidentId: 'inc-1',
      thresholdRuleId: null,
      capStatus: 'ACTUAL',
      category: 'Fire',
      severity: 'SEVERE',
      area,
      edxlKind: 'CAP',
      sentAt: T,
      approvedBy: 'user-em',
      createdAt: T,
      updatedAt: T,
    };
    const domain = alertMapper.fromRow(row);
    expect(domain.capStatus).toBe('ACTUAL');
    expect(domain.approvedBy).toBe('user-em');
    expect(domain.area).toEqual(area);
    const back = alertMapper.toRow(domain);
    expect(back.capStatus).toBe('ACTUAL');
    expect(back.approvedBy).toBe('user-em');
    expect(back.sentAt).toEqual(T);
  });

  it('rejects a persisted ACTUAL alert missing its approver (ACL re-validates, Art. XIII)', () => {
    const row = {
      id: 'al-2',
      incidentId: 'inc-1',
      thresholdRuleId: null,
      capStatus: 'ACTUAL',
      category: 'Fire',
      severity: 'SEVERE',
      area: null,
      edxlKind: 'CAP',
      sentAt: null,
      approvedBy: null,
      createdAt: T,
      updatedAt: T,
    };
    expect(() => alertMapper.fromRow(row)).toThrow();
  });
});

describe('citationMapper', () => {
  it('round-trips a grounding citation', () => {
    const row = {
      id: 'c-1',
      sitrepId: 's-1',
      sourceId: 'src-1',
      field: 'summary',
      claim: 'x',
      createdAt: T,
    };
    const domain = citationMapper.fromRow(row);
    expect(domain).toMatchObject({
      id: 'c-1',
      sitrepId: 's-1',
      sourceId: 'src-1',
      field: 'summary',
      claim: 'x',
    });
    expect(citationMapper.toRow(domain)).toMatchObject({ sitrepId: 's-1', sourceId: 'src-1' });
  });
});

describe('regionMapper', () => {
  it('round-trips a region with its bbox tuple + enabled adapters', () => {
    const row = {
      id: 'reg-1',
      name: 'California (Flagship)',
      scope: 'STATE',
      bbox: [-124.48, 32.53, -114.13, 42.01] as [number, number, number, number],
      enabledAdapters: ['firms', 'nws'],
      sourceModeOverrides: {},
      domainId: null,
      createdAt: T,
      updatedAt: T,
    };
    const domain = regionMapper.fromRow(row);
    expect(domain.bbox).toEqual([-124.48, 32.53, -114.13, 42.01]);
    expect(domain.enabledAdapters).toEqual(['firms', 'nws']);
    expect(regionMapper.toRow(domain).name).toBe('California (Flagship)');
  });
});

describe('thresholdRuleMapper (numeric<->text hysteresis/cooldown)', () => {
  it('round-trips numeric debounce fields stored as text', () => {
    const row = {
      id: 'tr-1',
      target: 'GAUGE_CATEGORY',
      operator: 'gte',
      value: 'MAJOR',
      scope: 'reg-1',
      hysteresis: '0.5',
      cooldown: '300',
      createdAt: T,
      updatedAt: T,
    };
    const domain = thresholdRuleMapper.fromRow(row);
    expect(domain.hysteresis).toBe(0.5);
    expect(domain.cooldown).toBe(300);
    const back = thresholdRuleMapper.toRow(domain);
    expect(back.hysteresis).toBe('0.5');
    expect(back.cooldown).toBe('300');
    expect(back.scope).toBe('reg-1');
  });
});

const point = (lon: number, lat: number) => ({
  type: 'Point' as const,
  coordinates: [lon, lat] as [number, number],
});
const line = (a: [number, number], b: [number, number]) => ({
  type: 'LineString' as const,
  coordinates: [a, b],
});

// ---- Logistics cluster --------------------------------------------------------------------------
// These four `toRow`s deliberately omit the surrogate uuid PK (see the cluster header in mappers.ts), so
// what is pinned here is the OTHER direction: everything else survives the round trip, the nullable columns
// hydrate to ABSENT rather than to `undefined` values, and a NULL capacity does not become a phantom one.

describe('resourceMapper', () => {
  const row = {
    id: '00000000-0000-4000-8000-000000000101',
    kind: 'ENGINE',
    status: 'AVAILABLE',
    geom: point(-121.49, 38.58),
    org: 'CAL FIRE',
    createdAt: T,
    updatedAt: T,
  };

  it('round-trips kind, status, org and the point geometry', () => {
    const domain = resourceMapper.fromRow(row);
    expect(domain).toMatchObject({ kind: 'ENGINE', status: 'AVAILABLE', orgId: 'CAL FIRE' });
    expect(domain.geom).toEqual({ type: 'Point', coordinates: [-121.49, 38.58] });
    const back = resourceMapper.toRow(domain);
    expect(back).toEqual({ kind: 'ENGINE', status: 'AVAILABLE', org: 'CAL FIRE', geom: row.geom });
    expect(back).not.toHaveProperty('id');
  });

  it('leaves nullable org/geom ABSENT rather than present-and-undefined', () => {
    const domain = resourceMapper.fromRow({ ...row, org: null, geom: null });
    expect('orgId' in domain).toBe(false);
    expect('geom' in domain).toBe(false);
  });
});

describe('shelterMapper', () => {
  const row = {
    id: '00000000-0000-4000-8000-000000000b01',
    geom: point(-121.49, 38.58),
    capacity: 500,
    occupancy: 120,
    status: 'OPEN',
    org: 'American Red Cross',
    domainId: null,
    createdAt: T,
    updatedAt: T,
  };

  it('round-trips capacity, occupancy, status and org', () => {
    const domain = shelterMapper.fromRow(row);
    expect(domain).toMatchObject({
      capacity: 500,
      occupancy: 120,
      status: 'OPEN',
      orgId: 'American Red Cross',
    });
    expect(shelterMapper.toRow(domain)).toEqual({
      geom: row.geom,
      capacity: 500,
      occupancy: 120,
      status: 'OPEN',
      org: 'American Red Cross',
    });
  });

  it('hydrates a NULL capacity to 0, which makes the shelter INELIGIBLE rather than roomy', () => {
    // `shelter.capacity` is nullable: nobody has counted the site. Inventing headroom would send evacuees
    // to a building that may not be able to take them (Art. XVI — degrade honestly).
    const domain = shelterMapper.fromRow({ ...row, capacity: null, occupancy: 0 });
    expect(domain.capacity).toBe(0);
    expect(domain.capacity - domain.occupancy).toBe(0);
  });
});

describe('resourceTaskMapper', () => {
  const row = {
    id: '00000000-0000-4000-8000-000000000201',
    resourceId: '00000000-0000-4000-8000-000000000101',
    incidentId: '00000000-0000-4000-8000-0000000000c1',
    shelterId: '00000000-0000-4000-8000-000000000b01',
    status: 'TASKED',
    target: point(-121.4, 38.6),
    edxlRmRef: 'RM-2026-0007',
    createdAt: T,
    updatedAt: T,
  };

  it('round-trips the lifecycle status plus the mutual-aid + shelter links', () => {
    const domain = resourceTaskMapper.fromRow(row);
    expect(domain).toMatchObject({ status: 'TASKED', edxlRmRef: 'RM-2026-0007' });
    expect(domain.shelterId).toBe(row.shelterId);
    const back = resourceTaskMapper.toRow(domain);
    expect(back.status).toBe('TASKED');
    expect(back.target).toEqual(row.target);
    expect(back).not.toHaveProperty('id');
  });

  it('leaves the nullable shelter/target/EDXL columns absent', () => {
    const domain = resourceTaskMapper.fromRow({
      ...row,
      shelterId: null,
      target: null,
      edxlRmRef: null,
    });
    expect('shelterId' in domain).toBe(false);
    expect('target' in domain).toBe(false);
    expect('edxlRmRef' in domain).toBe(false);
  });
});

describe('evacRouteMapper', () => {
  const row = {
    id: '00000000-0000-4000-8000-000000000301',
    incidentId: '00000000-0000-4000-8000-0000000000c1',
    geom: line([-121.5, 38.6], [-121.4, 38.7]),
    avoidsHazard: true,
    suggestedStart: new Date('2026-07-05T22:00:00.000Z'),
    createdAt: T,
  };

  it('round-trips the path, the hazard-avoidance flag and the computed suggested_start', () => {
    const domain = evacRouteMapper.fromRow(row);
    expect(domain.avoidsHazard).toBe(true);
    expect(domain.suggestedStart).toBe('2026-07-05T22:00:00.000Z');
    const back = evacRouteMapper.toRow(domain);
    expect(back.suggestedStart).toEqual(row.suggestedStart);
    expect(back.geom).toEqual(row.geom);
  });

  it('leaves a NULL suggested_start absent (no projected arrival ⇒ no start time, never a guess)', () => {
    const domain = evacRouteMapper.fromRow({ ...row, suggestedStart: null });
    expect('suggestedStart' in domain).toBe(false);
  });
});
