// BEACON — LOGISTICS HTTP handler tests (FR-7/FR-8, SPEC §2.2). Deterministic: fixed clock, injected
// ids, Turf spatial (no network). Proves RBAC gates, lifecycle, capacity match, and non-empty provenance (F1).
import { describe, expect, it } from 'vitest';
import { err, ok } from '@/domain/shared/result.js';
import { DomainError } from '@/domain/errors.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { IncidentId, OrgId, ResourceId, ShelterId } from '@/domain/value-objects/ids.js';
import type { Geometry, Position } from '@/domain/value-objects/geo.js';
import { makeResource } from '@/domain/resource.js';
import { makeShelter } from '@/domain/shelter.js';
import { makeTurfSpatialPort } from '@/adapters/spatial/turf-spatial.js';
import { makeRoutingAdapter } from '@/adapters/routing/memory-routing.js';
import { makeLogisticsAdapter } from '@/adapters/logistics/memory-logistics.js';
import {
  handleRoutes,
  handleResourcesGet,
  handleResourcesPost,
  handleResourceTask,
  handlePrePositioning,
} from './logistics.js';
import type { LogisticsHttpResult, PrePositioningTuning } from './logistics.js';

const CLOCK = () => '2026-07-05T22:00:00Z'; // fixed past clock (deterministic; never a wall-clock read)
const INCIDENT = asId<IncidentId>('inc-1');
const ORG = asId<OrgId>('org-1');
const point = (coordinates: Position) => ({ type: 'Point', coordinates }) as const;

const HAZARD: Geometry = {
  type: 'Polygon',
  coordinates: [
    [
      [1, -1],
      [3, -1],
      [3, 1],
      [1, 1],
      [1, -1],
    ],
  ],
};

function routing() {
  let n = 0;
  return makeRoutingAdapter({
    spatial: makeTurfSpatialPort(),
    hazardFor: () => HAZARD,
    newId: (p) => `${p}-${++n}`,
  });
}

function logistics() {
  return makeLogisticsAdapter({
    resources: [
      makeResource({
        id: asId<ResourceId>('res-1'),
        kind: 'ENGINE',
        status: 'AVAILABLE',
        orgId: ORG,
      }),
      makeResource({ id: asId<ResourceId>('res-x'), kind: 'CREW', status: 'AVAILABLE' }), // no org
    ],
    shelters: [
      makeShelter({
        id: asId<ShelterId>('sh-1'),
        geom: point([4, 0]),
        capacity: 100,
        occupancy: 0,
      }),
    ],
    verifiedIncidents: [INCIDENT],
  });
}

describe('handleRoutes (POST /routes — open)', () => {
  it('returns a hazard-avoiding route + shelter matches with non-empty provenance (F1)', async () => {
    const res = await handleRoutes(
      { incidentId: INCIDENT, from: [0, 0], to: [4, 0] },
      { routing: routing(), logistics: logistics(), clock: CLOCK },
    );
    expect(res.status).toBe(200);
    const data = res.body.data as {
      route: { avoidsHazard: boolean };
      shelters: readonly unknown[];
    };
    expect(data.route.avoidsHazard).toBe(true);
    expect(data.shelters.length).toBe(1);
    expect(res.body.provenance.length).toBeGreaterThan(0);
    expect(res.body.freshness).toBe('2026-07-05T22:00:00Z');
  });
});

describe('handleRoutes — origin defaults to the incident’s own place (2026-09-14)', () => {
  it('routes from `originFor(incidentId)` when the request carries no origin', async () => {
    const res = await handleRoutes(
      { incidentId: INCIDENT, to: [4, 0] },
      { routing: routing(), logistics: logistics(), clock: CLOCK, originFor: () => [0, 0] },
    );
    expect(res.status).toBe(200);
    const data = res.body.data as {
      route: { geom: { coordinates: readonly (readonly number[])[] } };
    };
    expect(data.route.geom.coordinates[0]).toEqual([0, 0]);
  });

  it('is a 400 when neither the request nor the incident supplies a place to start from', async () => {
    const res = await handleRoutes(
      { incidentId: INCIDENT, to: [4, 0] },
      { routing: routing(), logistics: logistics(), clock: CLOCK, originFor: () => undefined },
    );
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('no hazard footprint');
  });
});

describe('handleRoutes — durable route trail (ADR-039)', () => {
  it('records the computed route when a store is composed', async () => {
    const accepted: unknown[] = [];
    const routeStore = {
      accept: async (r: unknown) => {
        accepted.push(r);
        return { ok: true as const, value: null };
      },
    };
    const res = await handleRoutes(
      { incidentId: INCIDENT, from: [0, 0], to: [4, 0] },
      { routing: routing(), logistics: logistics(), clock: CLOCK, routeStore },
    );
    expect(res.status).toBe(200);
    expect(accepted).toHaveLength(1);
  });

  it('serves the route even when the store REJECTS — the trail is valuable, the path is essential', async () => {
    const routeStore = {
      accept: async (): Promise<never> => {
        throw new Error('db down');
      },
    };
    const res = await handleRoutes(
      { incidentId: INCIDENT, from: [0, 0], to: [4, 0] },
      { routing: routing(), logistics: logistics(), clock: CLOCK, routeStore },
    );
    expect(res.status).toBe(200); // Art. XVI: a storage outage must not deny an evacuation route
  });

  it('writes nothing when no store is composed (memory posture unchanged)', async () => {
    const res = await handleRoutes(
      { incidentId: INCIDENT, from: [0, 0], to: [4, 0] },
      { routing: routing(), logistics: logistics(), clock: CLOCK },
    );
    expect(res.status).toBe(200);
  });
});

describe('handleRoutes — computed evac suggested_start (FR-7, SPEC §5.7)', () => {
  const ARRIVAL = '2026-07-06T02:00:00Z';
  const box = (cx: number, cy: number, d: number): Geometry => ({
    type: 'Polygon',
    coordinates: [
      [
        [cx - d, cy - d],
        [cx + d, cy - d],
        [cx + d, cy + d],
        [cx - d, cy + d],
        [cx - d, cy - d],
      ],
    ],
  });
  const routingFor = (hazard: Geometry) => {
    let n = 0;
    return makeRoutingAdapter({
      spatial: makeTurfSpatialPort(),
      hazardFor: () => hazard,
      newId: (p) => `${p}-${++n}`,
    });
  };
  const start = async (hazard: Geometry): Promise<string | undefined> => {
    const res = await handleRoutes(
      { incidentId: INCIDENT, from: [0, 0], to: [4, 0] },
      {
        routing: routingFor(hazard),
        logistics: logistics(),
        clock: CLOCK,
        hazardArrivalFor: () => ARRIVAL,
      },
    );
    return (res.body.data as { route: { suggestedStart?: string } }).route.suggestedStart;
  };

  it('derives suggested_start from the projected arrival (before arrival, deterministic)', async () => {
    const s = await start(box(2, 0, 0.3));
    expect(s).toBeDefined();
    expect(Date.parse(s!)).toBeLessThan(Date.parse(ARRIVAL)); // arrival − clearance − margin
  });

  it('moving/enlarging the hazard lengthens the detour ⇒ an EARLIER suggested_start', async () => {
    const small = await start(box(2, 0, 0.3));
    const big = await start(box(2, 0, 1.0)); // larger footprint ⇒ longer detour ⇒ more clearance
    expect(Date.parse(big!)).toBeLessThan(Date.parse(small!));
  });

  it('omits suggested_start when no projected arrival is known (never a dead-end, Art. XVI)', async () => {
    const res = await handleRoutes(
      { incidentId: INCIDENT, from: [0, 0], to: [4, 0] },
      { routing: routingFor(box(2, 0, 0.3)), logistics: logistics(), clock: CLOCK },
    );
    expect(
      (res.body.data as { route: { suggestedStart?: string } }).route.suggestedStart,
    ).toBeUndefined();
  });
});

describe('handleResourcesGet (GET /resources — RESPONDER+)', () => {
  it('rejects PUBLIC with 403 FORBIDDEN-equivalent (UNAUTHORIZED)', async () => {
    const res = await handleResourcesGet(
      { role: 'PUBLIC', incidentId: INCIDENT },
      { logistics: logistics(), clock: CLOCK },
    );
    expect(res.status).toBe(403);
    expect(res.body.errors?.[0]?.code).toBe('UNAUTHORIZED');
  });

  it('org-scopes a RESPONDER to their own org assets', async () => {
    const res = await handleResourcesGet(
      { role: 'RESPONDER', incidentId: INCIDENT, orgId: ORG },
      { logistics: logistics(), clock: CLOCK },
    );
    expect(res.status).toBe(200);
    const data = res.body.data as { resources: readonly { id: string }[] };
    expect(data.resources.map((r) => r.id)).toEqual(['res-1']);
  });

  it('lets EM see all AVAILABLE resources in the region', async () => {
    const res = await handleResourcesGet(
      { role: 'EM', incidentId: INCIDENT },
      { logistics: logistics(), clock: CLOCK },
    );
    const data = res.body.data as { resources: readonly { id: string }[] };
    expect(data.resources.map((r) => r.id).sort()).toEqual(['res-1', 'res-x']);
  });
});

describe('handleResourcesPost (POST /resources — RESPONDER+ own org)', () => {
  it('rejects PUBLIC with 403', async () => {
    const res = await handleResourcesPost(
      { role: 'PUBLIC', id: 'res-new', kind: 'ENGINE' },
      { logistics: logistics(), clock: CLOCK },
    );
    expect(res.status).toBe(403);
  });

  it('registers a resource (201) and persists it so GET sees it', async () => {
    const adapter = logistics();
    const deps = { logistics: adapter, clock: CLOCK, register: adapter.register };
    const created = await handleResourcesPost(
      { role: 'RESPONDER', id: 'res-new', kind: 'MEDICAL', orgId: ORG, geom: point([1, 1]) },
      deps,
    );
    expect(created.status).toBe(201);
    expect(created.body.provenance.length).toBeGreaterThan(0);
    const list = await handleResourcesGet({ role: 'EM', incidentId: INCIDENT }, deps);
    const data = list.body.data as { resources: readonly { id: string }[] };
    expect(data.resources.some((r) => r.id === 'res-new')).toBe(true);
  });

  it('surfaces a STORE failure instead of a 201 for a resource nobody persisted', async () => {
    // The register result used to be discarded, so a durable store that refused the write still produced a
    // "201 Created" and the operator lost the asset silently (invisible while the only store was in-memory).
    const adapter = logistics();
    const res = await handleResourcesPost(
      { role: 'RESPONDER', id: 'res-new', kind: 'MEDICAL', orgId: ORG },
      {
        logistics: adapter,
        clock: CLOCK,
        register: () => Promise.resolve(err(new DomainError('CONFLICT', 'unique violation'))),
      },
    );
    expect(res.status).toBe(409);
  });

  it('echoes the id the STORE assigned, not the one the caller asked for', async () => {
    // The durable store owns the surrogate uuid PK; a caller must be told the id it has to quote to task
    // this resource later, or the very next POST /resource-tasks names a resource that does not exist.
    const adapter = logistics();
    const stored = makeResource({
      id: asId<ResourceId>('db-minted-uuid'),
      kind: 'MEDICAL',
      orgId: ORG,
    });
    const res = await handleResourcesPost(
      { role: 'RESPONDER', id: 'res-requested', kind: 'MEDICAL', orgId: ORG },
      { logistics: adapter, clock: CLOCK, register: () => Promise.resolve(ok(stored)) },
    );
    expect(res.status).toBe(201);
    expect((res.body.data as { resource: { id: string } }).resource.id).toBe('db-minted-uuid');
  });

  it('maps an invalid resource payload to a validation error', async () => {
    const res = await handleResourcesPost(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { role: 'RESPONDER', id: 'bad', kind: 'NOT_A_KIND' as any },
      { logistics: logistics(), clock: CLOCK },
    );
    expect(res.status).toBe(422);
    expect(res.body.errors?.[0]?.code).toBe('INVARIANT_VIOLATION');
  });
});

describe('handleResourceTask (POST /resource-tasks — RESPONDER+/EM, VERIFIED source)', () => {
  it('rejects PUBLIC with 403', async () => {
    const res = await handleResourceTask(
      { role: 'PUBLIC', id: 't-1', resourceId: 'res-1', incidentId: INCIDENT },
      { logistics: logistics(), clock: CLOCK },
    );
    expect(res.status).toBe(403);
  });

  it('creates a PROPOSED task then advances it to TASKED (201, forward-only)', async () => {
    const deps = { logistics: logistics(), clock: CLOCK };
    const created = await handleResourceTask(
      { role: 'RESPONDER', id: 't-1', resourceId: 'res-1', incidentId: INCIDENT },
      deps,
    );
    expect(created.status).toBe(201);
    const advanced = await handleResourceTask(
      { role: 'RESPONDER', id: 't-1', resourceId: 'res-1', incidentId: INCIDENT, status: 'TASKED' },
      deps,
    );
    expect(advanced.status).toBe(201);
    const data = advanced.body.data as { task: { status: string } };
    expect(data.task.status).toBe('TASKED');
  });

  it('rejects an illegal skip (PROPOSED → ENROUTE) with 409 STATE_CONFLICT-equivalent', async () => {
    const deps = { logistics: logistics(), clock: CLOCK };
    await handleResourceTask(
      { role: 'RESPONDER', id: 't-2', resourceId: 'res-1', incidentId: INCIDENT },
      deps,
    );
    const skipped = await handleResourceTask(
      {
        role: 'RESPONDER',
        id: 't-2',
        resourceId: 'res-1',
        incidentId: INCIDENT,
        status: 'ENROUTE',
      },
      deps,
    );
    expect(skipped.status).toBe(409);
    expect(skipped.body.errors?.[0]?.code).toBe('INVALID_TRANSITION');
  });

  it('rejects a task from an UNVERIFIED source with 403 (Art. XIII/ST1)', async () => {
    const res = await handleResourceTask(
      {
        role: 'RESPONDER',
        id: 't-3',
        resourceId: 'res-1',
        incidentId: asId<IncidentId>('inc-unverified'),
      },
      { logistics: logistics(), clock: CLOCK },
    );
    expect(res.status).toBe(403);
    expect(res.body.errors?.[0]?.code).toBe('UNAUTHORIZED');
  });
});

// ── handlePrePositioning (GET /pre-positioning — RESPONDER+; W2d, PRD flagship-4) ─────────────────────
describe('handlePrePositioning (GET /pre-positioning — RESPONDER+)', () => {
  // HAZARD is the box [[1,-1],[3,-1],[3,1],[1,1],[1,-1]] declared above — reused as the projected extent.
  function prePositioningLogistics() {
    return makeLogisticsAdapter({
      resources: [
        makeResource({
          id: asId<ResourceId>('res-near'),
          kind: 'ENGINE',
          status: 'AVAILABLE',
          geom: point([3.05, 0]),
        }),
        makeResource({
          id: asId<ResourceId>('res-inside'),
          kind: 'CREW',
          status: 'AVAILABLE',
          geom: point([2, 0]),
        }),
        makeResource({
          id: asId<ResourceId>('res-assigned'),
          kind: 'MEDICAL',
          status: 'ASSIGNED',
          geom: point([3.02, 0]),
        }),
      ],
      shelters: [
        makeShelter({
          id: asId<ShelterId>('sh-near'),
          geom: point([3.03, 0]),
          capacity: 50,
          occupancy: 10,
        }),
      ],
      verifiedIncidents: [INCIDENT],
    });
  }

  const extentFor = (id: IncidentId) => (String(id) === String(INCIDENT) ? HAZARD : undefined);

  it('rejects PUBLIC with 403', async () => {
    const res = await handlePrePositioning(
      { role: 'PUBLIC', incidentId: INCIDENT },
      {
        logistics: prePositioningLogistics(),
        spatial: makeTurfSpatialPort(),
        clock: CLOCK,
        projectedExtentFor: extentFor,
      },
    );
    expect(res.status).toBe(403);
    expect(res.body.errors?.[0]?.code).toBe('UNAUTHORIZED');
  });

  it('ranks the near resource + shelter, excludes the inside and the non-AVAILABLE resource, with non-empty provenance (F1)', async () => {
    const res = await handlePrePositioning(
      { role: 'RESPONDER', incidentId: INCIDENT },
      {
        logistics: prePositioningLogistics(),
        spatial: makeTurfSpatialPort(),
        clock: CLOCK,
        projectedExtentFor: extentFor,
      },
    );
    expect(res.status).toBe(200);
    const data = res.body.data as {
      extentAvailable: boolean;
      method: string;
      suggestions: readonly { kind: string; refId: string }[];
    };
    expect(data.extentAvailable).toBe(true);
    expect(data.method).toContain('first-order ranking');
    const ids = data.suggestions.map((s) => s.refId);
    expect(ids).toContain('res-near');
    expect(ids).toContain('sh-near');
    expect(ids).not.toContain('res-inside'); // inside the extent — not "near"
    expect(ids).not.toContain('res-assigned'); // ASSIGNED — already committed
    expect(res.body.provenance.length).toBeGreaterThan(0);
    expect(res.body.meta?.note).toContain('human decides');
  });

  it('returns a labeled empty result when no projected extent is known for the incident (never a dead-end)', async () => {
    const res = await handlePrePositioning(
      { role: 'EM', incidentId: asId<IncidentId>('inc-no-prediction') },
      {
        logistics: prePositioningLogistics(),
        spatial: makeTurfSpatialPort(),
        clock: CLOCK,
        projectedExtentFor: extentFor,
      },
    );
    expect(res.status).toBe(200);
    const data = res.body.data as { extentAvailable: boolean; suggestions: readonly unknown[] };
    expect(data.extentAvailable).toBe(false);
    expect(data.suggestions).toEqual([]);
  });

  it('degrades to a labeled empty result when no projectedExtentFor is wired at all', async () => {
    const res = await handlePrePositioning(
      { role: 'EM', incidentId: INCIDENT },
      { logistics: prePositioningLogistics(), spatial: makeTurfSpatialPort(), clock: CLOCK },
    );
    expect(res.status).toBe(200);
    const data = res.body.data as { extentAvailable: boolean };
    expect(data.extentAvailable).toBe(false);
  });

  // ── V2·A9 — the two constants are now operator-configurable (PREPOSITION_RADIUS_KM / _TOP_N) ─────────
  // The use-case has always accepted both; what A9 adds is a composition root that actually passes them.
  // These prove the handler FORWARDS them, and — the acceptance that matters — that omitting them leaves
  // behaviour byte-identical to pre-V2.
  const suggestionIds = (res: LogisticsHttpResult): readonly string[] =>
    (res.body.data as { suggestions: readonly { refId: string }[] }).suggestions.map(
      (s) => s.refId,
    );

  it('honours a narrowed radius: sh-near (~3.3 km from the extent edge) stays, res-near (~5.6 km) drops', async () => {
    const res = await handlePrePositioning(
      { role: 'RESPONDER', incidentId: INCIDENT },
      {
        logistics: prePositioningLogistics(),
        spatial: makeTurfSpatialPort(),
        clock: CLOCK,
        projectedExtentFor: extentFor,
        tuning: { nearRadiusMeters: 4_000, maxPerCategory: 5 },
      },
    );
    expect(res.status).toBe(200);
    expect(suggestionIds(res)).toEqual(['sh-near']);
  });

  it('honours a narrowed per-category cap: the NEAREST of two eligible resources survives top-1', async () => {
    const twoNear = makeLogisticsAdapter({
      resources: [
        makeResource({
          id: asId<ResourceId>('res-a'),
          kind: 'ENGINE',
          status: 'AVAILABLE',
          geom: point([3.01, 0]),
        }),
        makeResource({
          id: asId<ResourceId>('res-b'),
          kind: 'CREW',
          status: 'AVAILABLE',
          geom: point([3.02, 0]),
        }),
      ],
      shelters: [],
      verifiedIncidents: [INCIDENT],
    });
    const res = await handlePrePositioning(
      { role: 'RESPONDER', incidentId: INCIDENT },
      {
        logistics: twoNear,
        spatial: makeTurfSpatialPort(),
        clock: CLOCK,
        projectedExtentFor: extentFor,
        tuning: { nearRadiusMeters: 20_000, maxPerCategory: 1 },
      },
    );
    expect(suggestionIds(res)).toEqual(['res-a']);
  });

  it('is byte-identical with tuning at the shipped defaults and with no tuning at all (A9 acceptance)', async () => {
    const call = (tuning?: PrePositioningTuning) =>
      handlePrePositioning(
        { role: 'RESPONDER', incidentId: INCIDENT },
        {
          logistics: prePositioningLogistics(),
          spatial: makeTurfSpatialPort(),
          clock: CLOCK,
          projectedExtentFor: extentFor,
          ...(tuning !== undefined ? { tuning } : {}),
        },
      );
    const [defaulted, explicit] = await Promise.all([
      call(),
      call({ nearRadiusMeters: 20_000, maxPerCategory: 5 }),
    ]);
    expect(JSON.stringify(explicit)).toBe(JSON.stringify(defaulted));
  });
});
