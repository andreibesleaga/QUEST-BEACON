// BEACON — dock panels on the OPERATOR-MAINTAINED rung (ADR-041; V2·A12).
//
// panels.test.ts covers the fixture rung — the memory posture, unchanged. This file covers the second rung
// and the ladder between them: rows read from `PanelDataPort` are served as `DB` and dated by their LAST
// EDIT; a store that is unreachable or empty degrades to the seeded rows and SAYS SO; and an operator row
// that breaks a domain invariant fails loudly instead of rendering as a plausible-looking number.
//
// THE PORT IS FAKED HERE, AND THAT IS THE POINT OF THE SEAM — these are handler tests, not SQL tests. What
// the real Postgres adapter does with a real database (that a plain SELECT returns these rows at all) is
// the integration lane's job; `src/adapters/persistence/panel-data.test.ts` states the same boundary.
import { describe, expect, it } from 'vitest';
import { createHttpDeps, handleHttp } from '../http-dispatcher.js';
import type { HttpDeps, HttpRequest } from '../http-types.js';
import { ok, err } from '@/domain/shared/result.js';
import { DomainError } from '@/domain/errors.js';
import { findPersonIdentifyingRuntimeKeys } from '@/domain/shared/aggregate-only.js';
import type { Envelope } from '@/ports/interaction.js';
import type {
  PanelDamageEntryRow,
  PanelDataPort,
  PanelEmsProductRow,
  PanelShelterRow,
  PanelSupplyRow,
  PanelVolunteerTeamRow,
} from '@/ports/panels.js';
import {
  handleSuppliesGet,
  handleVolunteerTeamsGet,
  handleShelterStatusGet,
  handleDamageReportsGet,
  handleEmsOverlayGet,
} from './panels.js';
import type {
  PanelDeps,
  PanelHttpResult,
  ShelterStatusGetData,
  SuppliesGetData,
  VolunteerTeamsGetData,
  DamageReportsGetData,
  EmsOverlayGetData,
} from './panels.js';

const FIXED = '2026-07-05T22:00:00Z';
const clock = (): string => FIXED;
/** The instant an EM last touched a row — deliberately NOT the clock, so the two can never be confused. */
const LAST_EDIT = '2026-07-05T18:42:00.000Z';

const SUPPLY: PanelSupplyRow = { id: 'supply-water-1l', quantity: 4800, unit: 'LITRE' };
const TEAM: PanelVolunteerTeamRow = {
  id: 'team-alpha-3',
  callsign: 'TEAM ALPHA 3',
  headcount: 12,
  availability: 'AVAILABLE',
};
const SHELTER: PanelShelterRow = {
  id: 'shelter-civic-center',
  geom: { type: 'Point', coordinates: [-118.25, 34.05] },
  capacity: 250,
  occupancy: 90,
  status: 'OPEN',
};
const DAMAGE: PanelDamageEntryRow = {
  id: 'rep-001',
  incidentId: 'inc-db',
  reportStatus: 'VERIFIED',
  category: 'DAMAGE',
  severity: 'SEVERE',
  siteCount: 3,
};
const EMS: PanelEmsProductRow = {
  productId: 'EMSR900_AOI01_DEL_PRODUCT_r1',
  activationCode: 'EMSR900',
  productType: 'DELINEATION',
  areaOfInterest: 'Operator AOI',
  producedAt: '2026-07-04T08:00:00Z',
  provider: 'Copernicus Emergency Management Service',
  licence: 'CC BY 4.0',
  viewUrl: 'https://emergency.copernicus.eu/mapping/list-of-components/EMSR900',
};

interface StubRows {
  readonly supplies?: readonly PanelSupplyRow[];
  readonly teams?: readonly PanelVolunteerTeamRow[];
  readonly shelters?: readonly PanelShelterRow[];
  readonly damage?: readonly PanelDamageEntryRow[];
  readonly ems?: readonly PanelEmsProductRow[];
}

/** A port that simply hands back the rows it was given, dated `LAST_EDIT`. */
function stubPort(rows: StubRows = {}): PanelDataPort {
  const set = <R>(r: readonly R[] | undefined) =>
    Promise.resolve(
      ok({
        rows: r ?? [],
        ...(r !== undefined && r.length > 0 ? { lastEditedAt: LAST_EDIT } : {}),
      }),
    );
  return {
    supplies: () => set(rows.supplies),
    volunteerTeams: () => set(rows.teams),
    shelters: () => set(rows.shelters),
    damageEntries: () => set(rows.damage),
    emsProducts: () => set(rows.ems),
  };
}

/**
 * A port that answers with NO rows but still dates the dataset. The pg adapter cannot produce this (it
 * derives `lastEditedAt` from the rows), but the PORT contract allows it — and it is the case that proves
 * the empty-rows guard is load-bearing rather than incidentally covered by the missing timestamp.
 */
function datedEmptyPort(): PanelDataPort {
  const empty = () => Promise.resolve(ok({ rows: [], lastEditedAt: LAST_EDIT }));
  return {
    supplies: empty,
    volunteerTeams: empty,
    shelters: empty,
    damageEntries: empty,
    emsProducts: empty,
  };
}

/** A port that is configured but cannot answer — the "database is down mid-incident" posture. */
function brokenPort(): PanelDataPort {
  const boom = () => Promise.resolve(err(new DomainError('INTERNAL_ERROR', 'connection refused')));
  return {
    supplies: boom,
    volunteerTeams: boom,
    shelters: boom,
    damageEntries: boom,
    emsProducts: boom,
  };
}

const POPULATED: StubRows = {
  supplies: [SUPPLY],
  teams: [TEAM],
  shelters: [SHELTER],
  damage: [DAMAGE],
  ems: [EMS],
};

const HANDLERS = [
  ['supplies', handleSuppliesGet],
  ['volunteer-teams', handleVolunteerTeamsGet],
  ['shelter-status', handleShelterStatusGet],
  ['damage-reports', handleDamageReportsGet],
  ['ems-overlay', handleEmsOverlayGet],
] as const;

function dataOf<T>(res: PanelHttpResult): T {
  return (res.body as Envelope<T>).data;
}

const deps = (panelData?: PanelDataPort): PanelDeps =>
  panelData === undefined ? { clock } : { clock, panelData };

describe('dock panels on the DB rung — provenance', () => {
  it('labels every panel DB and dates it by the row LAST EDIT, never by the clock (ADR-041 §3)', async () => {
    for (const [name, handler] of HANDLERS) {
      const res = await handler({ role: 'RESPONDER' }, deps(stubPort(POPULATED)));
      const env = res.body as Envelope;
      expect(res.status, name).toBe(200);
      expect(env.provenance[0]?.mode, name).toBe('DB');
      expect(env.provenance[0]?.fetchedAt, name).toBe(LAST_EDIT);
      expect(env.freshness, name).toBe(LAST_EDIT);
      expect(env.freshness, name).not.toBe(FIXED); // the clock must not masquerade as an edit instant
      // A healthy operator rung is NOT a degraded one: no UW2 block, no warning.
      expect(env.meta, name).toBeUndefined();
      expect(env.errors, name).toBeUndefined();
    }
  });

  it('serves the operator rows themselves, through the same factories the fixtures go through', async () => {
    const d = deps(stubPort(POPULATED));
    const { supplies } = dataOf<SuppliesGetData>(await handleSuppliesGet({ role: 'RESPONDER' }, d));
    expect(supplies).toEqual([
      { id: 'supply-water-1l', kind: 'SUPPLY', quantity: 4800, unit: 'LITRE' },
    ]);
    const { teams } = dataOf<VolunteerTeamsGetData>(
      await handleVolunteerTeamsGet({ role: 'RESPONDER' }, d),
    );
    expect(teams.map((t) => t.id)).toEqual(['team-alpha-3']);
    expect(findPersonIdentifyingRuntimeKeys(teams)).toEqual([]); // Art. XIV holds on operator rows too
    const { overlay } = dataOf<EmsOverlayGetData>(
      await handleEmsOverlayGet({ role: 'RESPONDER' }, d),
    );
    expect(overlay.products.map((p) => p.productId)).toEqual(['EMSR900_AOI01_DEL_PRODUCT_r1']);
  });

  it('the shelter board says OPERATOR-MAINTAINED — it can no more claim "live" for a DB row than for a seed', async () => {
    const { board } = dataOf<ShelterStatusGetData>(
      await handleShelterStatusGet({ role: 'RESPONDER' }, deps(stubPort(POPULATED))),
    );
    expect(board.provenance.mode).toBe('DB');
    expect(board.provenance.asOf).toBe(LAST_EDIT);
    expect(board.provenanceClaim).toContain('Operator-maintained');
    expect(board.provenanceClaim).not.toMatch(/^Live/);
    expect(board.provenanceClaim).not.toContain('MOCK');
    expect(board.totals.shelters).toBe(1);
  });
});

describe('dock panels on the DB rung — the ladder never ends in an empty panel (Art. XVI)', () => {
  it('an unreachable store degrades to the seeded rows and SAYS SO on every panel', async () => {
    for (const [name, handler] of HANDLERS) {
      const res = await handler({ role: 'RESPONDER' }, deps(brokenPort()));
      const env = res.body as Envelope;
      expect(res.status, name).toBe(200); // a 200 with labelled fallback data, never a dead-end
      expect(env.provenance[0]?.mode, name).toBe('MOCK');
      expect(env.freshness, name).toBe(FIXED); // seeded rows are dated by the clock again
      expect(env.meta, name).toEqual({ status: 'degraded', degraded: true, mode: 'MOCK' });
      expect(env.errors?.[0]?.code, name).toBe('SOURCE_DEGRADED');
      expect(env.errors?.[0]?.message, name).toContain('unreachable');
    }
  });

  it('an EMPTY store degrades too, with its own reason — a blank board is not an answer', async () => {
    for (const [name, handler] of HANDLERS) {
      const res = await handler({ role: 'RESPONDER' }, deps(stubPort({})));
      const env = res.body as Envelope;
      expect(res.status, name).toBe(200);
      expect(env.provenance[0]?.mode, name).toBe('MOCK');
      expect(env.errors?.[0]?.message, name).toContain('no rows');
    }
  });

  it('a DATED but empty dataset degrades too — rows, not a timestamp, are what a panel has to show', async () => {
    for (const [name, handler] of HANDLERS) {
      const res = await handler({ role: 'RESPONDER' }, deps(datedEmptyPort()));
      const env = res.body as Envelope;
      expect(res.status, name).toBe(200);
      expect(env.provenance[0]?.mode, name).toBe('MOCK');
      expect(env.freshness, name).toBe(FIXED); // the seeded rung's clock, never the empty table's date
      expect(env.errors?.[0]?.message, name).toContain('no rows');
    }
  });

  it('the degraded shelter board carries the reason in its claim sentence, not only in the envelope', async () => {
    const { board } = dataOf<ShelterStatusGetData>(
      await handleShelterStatusGet({ role: 'RESPONDER' }, deps(brokenPort())),
    );
    expect(board.provenance.mode).toBe('MOCK');
    expect(board.provenanceClaim).toContain('MOCK');
    expect(board.provenanceClaim).toContain('unreachable');
    // The fallback is the seeded fixture, so the board is populated rather than blank.
    expect(board.totals.shelters).toBeGreaterThan(0);
  });

  it('with NO store wired the envelope is exactly what it was before this seam existed (memory posture)', async () => {
    for (const [name, handler] of HANDLERS) {
      const res = await handler({ role: 'RESPONDER' }, deps());
      const env = res.body as Envelope;
      expect(Object.keys(env), name).toEqual(['data', 'provenance', 'freshness']);
      expect(env.provenance, name).toEqual([
        { sourceId: expect.any(String), mode: 'MOCK', fetchedAt: FIXED },
      ]);
    }
  });
});

describe('dock panels on the DB rung — a malformed operator row fails LOUDLY', () => {
  it('422s a supply lot whose unit is outside the closed vocabulary (never a bare, uninterpretable number)', async () => {
    const res = await handleSuppliesGet(
      { role: 'RESPONDER' },
      deps(stubPort({ supplies: [{ id: 'supply-bad', quantity: 10, unit: 'GALLON' }] })),
    );
    expect(res.status).toBe(422);
    expect((res.body as Envelope).errors?.[0]?.message).toContain('unit');
  });

  it('422s a quantity with no unit — the same invariant the fixture rung is held to', async () => {
    const res = await handleSuppliesGet(
      { role: 'RESPONDER' },
      deps(stubPort({ supplies: [{ id: 'supply-bad', quantity: 10 }] })),
    );
    expect(res.status).toBe(422);
    expect((res.body as Envelope).errors?.[0]?.message).toContain('requires a unit');
  });

  it('422s a volunteer team whose callsign breaks the schema-derived pattern', async () => {
    const res = await handleVolunteerTeamsGet(
      { role: 'RESPONDER' },
      deps(stubPort({ teams: [{ ...TEAM, callsign: 'team alpha 3' }] })),
    );
    expect(res.status).toBe(422);
  });

  it('422s a damage entry whose category is outside the closed vocabulary', async () => {
    const res = await handleDamageReportsGet(
      { role: 'RESPONDER' },
      deps(stubPort({ damage: [{ ...DAMAGE, category: 'BANANA' }] })),
    );
    expect(res.status).toBe(422);
  });

  it('422s an EMS product with no licence — an unlicensed overlay may not be displayed at all (Art. XI)', async () => {
    const res = await handleEmsOverlayGet(
      { role: 'RESPONDER' },
      deps(stubPort({ ems: [{ ...EMS, licence: '  ' }] })),
    );
    expect(res.status).toBe(422);
  });

  it('422s a shelter whose occupancy exceeds its capacity — an impossible board is refused, not rendered', async () => {
    const res = await handleShelterStatusGet(
      { role: 'RESPONDER' },
      deps(stubPort({ shelters: [{ ...SHELTER, capacity: 10, occupancy: 99 }] })),
    );
    expect(res.status).toBe(422);
  });
});

describe('GET /damage-reports on the DB rung — the table is not single-incident', () => {
  it('names the incident the rows belong to (not the fixture id) in the assessment it returns', async () => {
    const { assessment } = dataOf<DamageReportsGetData>(
      await handleDamageReportsGet({ role: 'RESPONDER' }, deps(stubPort({ damage: [DAMAGE] }))),
    );
    expect(assessment.incidentId).toBe('inc-db');
    expect(assessment.byTriageStatus.VERIFIED.entries).toBe(1);
  });

  it('refuses a board that spans two incidents rather than silently dropping the minority rows', async () => {
    const other: PanelDamageEntryRow = { ...DAMAGE, id: 'rep-002', incidentId: 'inc-other' };
    const res = await handleDamageReportsGet(
      { role: 'RESPONDER' },
      deps(stubPort({ damage: [DAMAGE, DAMAGE, other] })),
    );
    expect(res.status).toBe(409); // CONFLICT — a damage report must never vanish from the count
    expect((res.body as Envelope).errors?.[0]?.message).toContain('rep-002');
  });
});

// ── Through the REAL dispatcher: the port has to actually REACH the handler ──────────────────────────────
// The A2 review's B1 defect was a store that was implemented, tested and composed by NOTHING. The tests
// above call the handlers directly and would pass with `panelData` dropped on the floor at the transport
// boundary, so this block drives the whole path: HttpDeps → feature-router → panelDeps → handler.

function routerDeps(panelData: PanelDataPort): HttpDeps {
  let n = 0;
  const base = createHttpDeps({
    core: { clock, newId: (p: string) => `${p}-${++n}`, env: { AUTH_DEV_TRUST_HEADER: 'on' } },
    rateLimit: { capacity: 1000, refillPerSec: 0 },
  });
  return { ...base, panelData };
}

const req = (path: string): HttpRequest => ({
  method: 'GET',
  path,
  query: {},
  headers: { 'x-beacon-role': 'RESPONDER' },
});

describe('dock panels through handleHttp — the operator store reaches the handler', () => {
  it('serves DB-labelled rows on every panel route when HttpDeps carries a panelData port', async () => {
    const d = routerDeps(stubPort(POPULATED));
    for (const path of [
      '/api/v1/supplies',
      '/api/v1/volunteer-teams',
      '/api/v1/shelter-status',
      '/api/v1/damage-reports',
      '/api/v1/ems-overlay',
    ]) {
      const res = await handleHttp(req(path), d);
      const env = res.body as Envelope;
      expect(res.status, path).toBe(200);
      expect(env.provenance[0]?.mode, path).toBe('DB');
      expect(env.freshness, path).toBe(LAST_EDIT);
    }
  });

  it('an unreachable store still answers 200 through the router, degraded and labelled', async () => {
    const res = await handleHttp(req('/api/v1/shelter-status'), routerDeps(brokenPort()));
    expect(res.status).toBe(200);
    expect((res.body as Envelope).meta).toEqual({
      status: 'degraded',
      degraded: true,
      mode: 'MOCK',
    });
  });
});
