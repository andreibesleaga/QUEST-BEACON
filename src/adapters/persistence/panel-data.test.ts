// BEACON — Postgres panel-data adapter tests (ADR-041; V2·A12).
//
// WHAT THIS FILE CAN AND CANNOT PROVE, stated up front because the A2 all-lens review found three blocking
// defects that every test had missed by asserting statement SHAPE against a chainable fake. The fake below
// is deliberately the WEAKEST one that can exist: `db.select().from(t)` resolves to the rows for `t` and
// nothing else — no `where`, no `limit`, no join, no insert, no `ON CONFLICT`, because the adapter under
// test issues none. So these tests prove the ROW MAPPING, the `lastEditedAt` reduction, the omission of
// absent optionals and the non-throwing contract. They prove NOTHING about SQL: that a plain SELECT of
// these five tables returns their rows is the one database behaviour assumed here, and it belongs to the
// integration lane.
import { describe, expect, it } from 'vitest';
import { isOk } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { PanelDataPort, PanelDataset } from '@/ports/panels.js';
import { makePgPanelDataPort } from './panel-data';
import type { Db } from './client';
import {
  damageAssessmentEntry,
  emsOverlayProduct,
  shelter,
  supplyLot,
  volunteerTeam,
} from './schema';

type Row = Record<string, unknown>;

/** The weakest possible fake: one SELECT per table, resolved from a map. See the header. */
function fakeDb(rows: ReadonlyMap<unknown, readonly Row[]>): Db {
  return {
    select: () => ({ from: (t: unknown) => Promise.resolve(rows.get(t) ?? []) }),
  } as unknown as Db;
}

/** A db whose driver throws — the "configured but unreachable" posture the panel must degrade from. */
function throwingDb(): Db {
  return {
    select: () => ({
      from: () => Promise.reject(new Error('ECONNREFUSED 10.0.0.5:5432')),
    }),
  } as unknown as Db;
}

const EDIT_1 = new Date('2026-07-04T08:00:00.000Z');
const EDIT_2 = new Date('2026-07-05T11:30:00.000Z');

const SUPPLY_ROWS: readonly Row[] = [
  {
    id: 'uuid-a',
    domainId: 'supply-water-1l',
    quantity: 480,
    unit: 'LITRE',
    expiresAt: new Date('2026-12-01T00:00:00.000Z'),
    updatedAt: EDIT_1,
  },
  {
    id: 'uuid-b',
    domainId: 'supply-blankets',
    quantity: null,
    unit: null,
    expiresAt: null,
    updatedAt: EDIT_2,
  },
];

const TEAM_ROWS: readonly Row[] = [
  {
    id: 'uuid-c',
    domainId: 'team-alpha-3',
    callsign: 'TEAM ALPHA 3',
    headcount: 8,
    skills: ['SWIFTWATER'],
    availability: 'AVAILABLE',
    updatedAt: EDIT_1,
  },
];

const SHELTER_ROWS: readonly Row[] = [
  {
    id: 'uuid-d',
    domainId: 'shelter-civic-center',
    geom: { type: 'Point', coordinates: [-121.5, 38.6] },
    capacity: 200,
    occupancy: 40,
    status: 'OPEN',
    org: 'org-red-cross',
    updatedAt: EDIT_2,
  },
  // A row seeded BEFORE migration 0010 added the natural key, and one nobody has counted the capacity of.
  {
    id: 'uuid-e',
    domainId: null,
    geom: { type: 'Point', coordinates: [-121.6, 38.7] },
    capacity: null,
    occupancy: 0,
    status: 'CLOSED',
    org: null,
    updatedAt: EDIT_1,
  },
];

const DAMAGE_ROWS: readonly Row[] = [
  {
    id: 'uuid-f',
    domainId: 'rep-001',
    incidentDomainId: 'us-ca-wildfire-demo',
    reportStatus: 'VERIFIED',
    category: 'DAMAGE',
    severity: 'SEVERE',
    needKind: null,
    siteCount: 3,
    updatedAt: EDIT_1,
  },
];

const EMS_ROWS: readonly Row[] = [
  {
    id: 'uuid-g',
    domainId: 'EMSR773_AOI01_DEL_PRODUCT_r1',
    activationCode: 'EMSR773',
    productType: 'DELINEATION',
    areaOfInterest: 'Sacramento County',
    producedAt: new Date('2026-07-02T06:00:00.000Z'),
    provider: 'Copernicus EMS',
    licence: 'CC BY 4.0',
    viewUrl: 'https://emergency.copernicus.eu/x',
    updatedAt: EDIT_2,
  },
];

const ALL = new Map<unknown, readonly Row[]>([
  [supplyLot, SUPPLY_ROWS],
  [volunteerTeam, TEAM_ROWS],
  [shelter, SHELTER_ROWS],
  [damageAssessmentEntry, DAMAGE_ROWS],
  [emsOverlayProduct, EMS_ROWS],
]);

/** The five reads under one loop-friendly name — they share one contract (row type erased on purpose). */
type AnyRead = (port: PanelDataPort) => Promise<Result<PanelDataset<unknown>, DomainError>>;
const READS: readonly (readonly [string, AnyRead])[] = [
  ['supplies', (p) => p.supplies()],
  ['volunteerTeams', (p) => p.volunteerTeams()],
  ['shelters', (p) => p.shelters()],
  ['damageEntries', (p) => p.damageEntries()],
  ['emsProducts', (p) => p.emsProducts()],
];

describe('makePgPanelDataPort — the shared contract', () => {
  it('dates every dataset by its NEWEST updated_at — a DB row is as fresh as its last EDIT, not as "now"', async () => {
    const port = makePgPanelDataPort(fakeDb(ALL));
    const supplies = await port.supplies();
    expect(isOk(supplies)).toBe(true);
    if (!supplies.ok) return;
    expect(supplies.value.lastEditedAt).toBe(EDIT_2.toISOString()); // the NEWER of the two rows
  });

  it('an empty table has nothing to date: rows [] and NO lastEditedAt (never an invented "now")', async () => {
    const port = makePgPanelDataPort(fakeDb(new Map()));
    for (const [name, read] of READS) {
      const res = await read(port);
      expect(isOk(res), name).toBe(true);
      if (!res.ok) continue;
      expect(res.value.rows, name).toEqual([]);
      expect(res.value.lastEditedAt, name).toBeUndefined();
    }
  });

  it('a driver failure returns err on every read — it NEVER throws into the panel handler', async () => {
    const port = makePgPanelDataPort(throwingDb());
    for (const [name, read] of READS) {
      const res = await read(port);
      expect(isOk(res), name).toBe(false);
    }
  });
});

describe('makePgPanelDataPort — row mapping', () => {
  it('serves the NATURAL key as the row id, so the panel shows what the operator edited', async () => {
    const port = makePgPanelDataPort(fakeDb(ALL));
    const supplies = await port.supplies();
    const teams = await port.volunteerTeams();
    const ems = await port.emsProducts();
    const damage = await port.damageEntries();
    if (!supplies.ok || !teams.ok || !ems.ok || !damage.ok) throw new Error('expected ok');
    expect(supplies.value.rows.map((r) => r.id)).toEqual(['supply-water-1l', 'supply-blankets']);
    expect(teams.value.rows[0]?.id).toBe('team-alpha-3');
    expect(ems.value.rows[0]?.productId).toBe('EMSR773_AOI01_DEL_PRODUCT_r1');
    expect(damage.value.rows[0]?.id).toBe('rep-001');
    expect(damage.value.rows[0]?.incidentId).toBe('us-ca-wildfire-demo');
  });

  it('OMITS a NULL optional instead of passing null down — the factory sees an absent field, not a lie', async () => {
    const port = makePgPanelDataPort(fakeDb(ALL));
    const supplies = await port.supplies();
    if (!supplies.ok) throw new Error('expected ok');
    const blankets = supplies.value.rows[1]!;
    expect(blankets).not.toHaveProperty('quantity');
    expect(blankets).not.toHaveProperty('unit');
    expect(blankets).not.toHaveProperty('expiresAt');
    // …and a present one keeps its value, rendered as ISO-8601 rather than a Date.
    expect(supplies.value.rows[0]?.expiresAt).toBe('2026-12-01T00:00:00.000Z');
  });

  it('shelter: a pre-0010 row keeps its uuid, and an UNCOUNTED capacity hydrates to 0, never an invented one', async () => {
    const port = makePgPanelDataPort(fakeDb(ALL));
    const shelters = await port.shelters();
    if (!shelters.ok) throw new Error('expected ok');
    expect(shelters.value.rows[0]?.id).toBe('shelter-civic-center');
    expect(shelters.value.rows[0]?.orgId).toBe('org-red-cross');
    expect(shelters.value.rows[1]?.id).toBe('uuid-e'); // no natural key yet — the surrogate is still an id
    expect(shelters.value.rows[1]?.capacity).toBe(0); // 0 makes it INELIGIBLE, not a destination with headroom
    expect(shelters.value.rows[1]).not.toHaveProperty('orgId');
  });

  it('renders instants as ISO-8601 strings — the domain factories take strings, never Date objects', async () => {
    const port = makePgPanelDataPort(fakeDb(ALL));
    const ems = await port.emsProducts();
    if (!ems.ok) throw new Error('expected ok');
    expect(ems.value.rows[0]?.producedAt).toBe('2026-07-02T06:00:00.000Z');
  });
});
