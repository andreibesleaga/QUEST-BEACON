// BEACON — the ONE ResourceLogisticsPort contract suite (FR-8, EV9, Art. XIII/ST1, SPEC §5.5).
//
// Every behavioural claim the logistics port makes lives here exactly once and is executed against EVERY
// implementation: the in-memory default (`memory-logistics.test.ts`) and the durable Postgres store
// (`pg-logistics.test.ts`). Two stores that answer the same questions differently is the failure mode this
// file exists to make impossible — a cloned test file would have let the pg store drift the moment either
// side changed, and the drift would have surfaced only in the one configuration the live demo runs.
//
// The suite is deliberately not a `*.test.ts` file: it is IMPORTED by the per-store test files (which name
// the implementation), never collected on its own.
//
// Deterministic: injected ids, fixed fixtures, no clock, no network.
import { describe, expect, it } from 'vitest';
import { isErr, isOk } from '@/domain/shared/result.js';
import { makeResource } from '@/domain/resource.js';
import { makeResourceTask } from '@/domain/resource-task.js';
import { makeShelter } from '@/domain/shelter.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { Position } from '@/domain/value-objects/geo.js';
import type {
  IncidentId,
  OrgId,
  ResourceId,
  ResourceTaskId,
  ShelterId,
} from '@/domain/value-objects/ids.js';
import type { LogisticsAdapter } from './memory-logistics.js';
import type { CapacityMatchDirection } from './shelter-ranking.js';

export const CONTRACT_INCIDENT = asId<IncidentId>('inc-verified');
export const CONTRACT_UNVERIFIED = asId<IncidentId>('inc-unverified');
const ORG = asId<OrgId>('org-1');

const point = (coordinates: Position) => ({ type: 'Point', coordinates }) as const;

/** The dataset a store under test is built over — the same shape both factories consume. */
export interface LogisticsContractFixture {
  readonly resources: readonly ReturnType<typeof makeResource>[];
  readonly shelters: readonly ReturnType<typeof makeShelter>[];
  readonly verifiedIncidents: readonly IncidentId[];
  readonly capacityMatchDirection?: CapacityMatchDirection;
}

/** Build a store over `fixture`. Each implementation supplies one of these; the assertions are shared. */
export type LogisticsStoreFactory = (fixture: LogisticsContractFixture) => LogisticsAdapter;

/** The default fixture: one AVAILABLE + one ASSIGNED resource, and four shelters spanning every status. */
export const CONTRACT_FIXTURE: LogisticsContractFixture = {
  resources: [
    makeResource({
      id: asId<ResourceId>('res-1'),
      kind: 'ENGINE',
      status: 'AVAILABLE',
      orgId: ORG,
    }),
    makeResource({ id: asId<ResourceId>('res-2'), kind: 'CREW', status: 'ASSIGNED', orgId: ORG }),
  ],
  shelters: [
    makeShelter({
      id: asId<ShelterId>('sh-open-near'),
      geom: point([0.1, 0]),
      capacity: 100,
      occupancy: 20,
    }),
    makeShelter({
      id: asId<ShelterId>('sh-open-far'),
      geom: point([5, 0]),
      capacity: 50,
      occupancy: 10,
    }),
    makeShelter({
      id: asId<ShelterId>('sh-full'),
      geom: point([0, 0]),
      capacity: 40,
      occupancy: 40,
      status: 'FULL',
    }),
    makeShelter({
      id: asId<ShelterId>('sh-closed'),
      geom: point([0, 0.1]),
      capacity: 60,
      occupancy: 0,
      status: 'CLOSED',
    }),
  ],
  verifiedIncidents: [CONTRACT_INCIDENT],
};

/**
 * Two EQUALLY DISTANT open shelters with different headroom — the only case in which the two configured
 * objectives can disagree, and therefore the only fixture that can prove `CAPACITY_MATCH_DIRECTION` is read
 * rather than merely declared. `sh-tie-tight` is listed first so registry order, not headroom, is what
 * `minimize_distance` falls back to.
 */
function tieFixture(direction: CapacityMatchDirection): LogisticsContractFixture {
  return {
    resources: [],
    shelters: [
      makeShelter({
        id: asId<ShelterId>('sh-tie-tight'),
        geom: point([0, 0.2]),
        capacity: 100,
        occupancy: 90,
      }),
      makeShelter({
        id: asId<ShelterId>('sh-tie-roomy'),
        geom: point([0, -0.2]),
        capacity: 100,
        occupancy: 0,
      }),
    ],
    verifiedIncidents: [],
    capacityMatchDirection: direction,
  };
}

const proposedTask = (
  id: string,
  status?: 'PROPOSED' | 'TASKED' | 'ENROUTE',
  incident: IncidentId = CONTRACT_INCIDENT,
) =>
  makeResourceTask({
    id: asId<ResourceTaskId>(id),
    resourceId: asId<ResourceId>('res-1'),
    incidentId: incident,
    ...(status !== undefined ? { status } : {}),
  });

/** Advance an id the STORE handed back — the surrogate key is the store's to assign (see pg-logistics.ts). */
const advanceTo = (id: string, status: 'TASKED' | 'ENROUTE') =>
  makeResourceTask({
    id: asId<ResourceTaskId>(id),
    resourceId: asId<ResourceId>('res-1'),
    incidentId: CONTRACT_INCIDENT,
    status,
  });

/**
 * Run the whole ResourceLogisticsPort contract against one implementation.
 *
 * @param implName the store under test, used as the describe prefix so a failure names the guilty side.
 * @param makeStore builds a store over a fixture (both stores accept the identical fixture shape).
 */
export function describeLogisticsContract(
  implName: string,
  makeStore: LogisticsStoreFactory,
): void {
  describe(`${implName} — listAvailable`, () => {
    it('returns only AVAILABLE resources', async () => {
      const r = await makeStore(CONTRACT_FIXTURE).listAvailable(CONTRACT_INCIDENT);
      expect(isOk(r)).toBe(true);
      if (isOk(r)) expect(r.value.map((x) => x.kind)).toEqual(['ENGINE']);
    });

    it('reflects a newly registered resource', async () => {
      const store = makeStore(CONTRACT_FIXTURE);
      const registered = await store.register(
        makeResource({ id: asId<ResourceId>('res-3'), kind: 'MEDICAL', status: 'AVAILABLE' }),
      );
      expect(isOk(registered)).toBe(true);
      if (!isOk(registered)) return;
      const listed = await store.listAvailable(CONTRACT_INCIDENT);
      // Match on the id the STORE returned: the durable store mints the surrogate uuid PK itself.
      expect(isOk(listed) && listed.value.some((x) => x.id === registered.value.id)).toBe(true);
    });
  });

  describe(`${implName} — findShelters (capacity match)`, () => {
    it('returns only OPEN shelters with spare capacity, nearest-first', async () => {
      const r = await makeStore(CONTRACT_FIXTURE).findShelters([0, 0]);
      expect(isOk(r)).toBe(true);
      if (isOk(r)) expect(r.value.map((s) => s.id)).toEqual(['sh-open-near', 'sh-open-far']);
    });

    it('excludes FULL and CLOSED shelters', async () => {
      const r = await makeStore(CONTRACT_FIXTURE).findShelters([0, 0]);
      expect(isOk(r)).toBe(true);
      if (isOk(r)) {
        const ids = r.value.map((s) => s.id);
        expect(ids).not.toContain('sh-full');
        expect(ids).not.toContain('sh-closed');
      }
    });

    it('CAPACITY_MATCH_DIRECTION=maximize_availability_per_distance breaks a distance tie on headroom', async () => {
      const store = makeStore(tieFixture('maximize_availability_per_distance'));
      const r = await store.findShelters([0, 0]);
      expect(isOk(r)).toBe(true);
      if (isOk(r)) expect(r.value.map((s) => s.id)).toEqual(['sh-tie-roomy', 'sh-tie-tight']);
    });

    it('CAPACITY_MATCH_DIRECTION=minimize_distance ranks on distance alone', async () => {
      const store = makeStore(tieFixture('minimize_distance'));
      const r = await store.findShelters([0, 0]);
      expect(isOk(r)).toBe(true);
      if (isOk(r)) expect(r.value.map((s) => s.id)).toEqual(['sh-tie-tight', 'sh-tie-roomy']);
    });
  });

  describe(`${implName} — task (lifecycle + guardrails)`, () => {
    it('creates a PROPOSED task, then advances it one legal step to TASKED', async () => {
      const store = makeStore(CONTRACT_FIXTURE);
      const created = await store.task(proposedTask('t-1'));
      expect(isOk(created)).toBe(true);
      if (!isOk(created)) return;
      expect(created.value.status).toBe('PROPOSED');
      const advanced = await store.task(advanceTo(String(created.value.id), 'TASKED'));
      expect(isOk(advanced)).toBe(true);
      if (isOk(advanced)) expect(advanced.value.status).toBe('TASKED');
    });

    it('rejects an ILLEGAL transition (PROPOSED → ENROUTE skips TASKED) with INVALID_TRANSITION', async () => {
      const store = makeStore(CONTRACT_FIXTURE);
      const created = await store.task(proposedTask('t-2'));
      expect(isOk(created)).toBe(true);
      if (!isOk(created)) return;
      const skipped = await store.task(advanceTo(String(created.value.id), 'ENROUTE'));
      expect(isErr(skipped)).toBe(true);
      if (isErr(skipped)) expect(skipped.error.code).toBe('INVALID_TRANSITION');
    });

    it('rejects a new task that does not start at PROPOSED with INVALID_TRANSITION', async () => {
      const r = await makeStore(CONTRACT_FIXTURE).task(proposedTask('t-3', 'TASKED'));
      expect(isErr(r)).toBe(true);
      if (isErr(r)) expect(r.error.code).toBe('INVALID_TRANSITION');
    });

    it('rejects a task from an UNVERIFIED source (Art. XIII/ST1) with UNAUTHORIZED', async () => {
      const r = await makeStore(CONTRACT_FIXTURE).task(
        proposedTask('t-4', 'PROPOSED', CONTRACT_UNVERIFIED),
      );
      expect(isErr(r)).toBe(true);
      if (isErr(r)) expect(r.error.code).toBe('UNAUTHORIZED');
    });

    it('refuses an unverified tasking BEFORE any write reaches the store', async () => {
      // Ordering matters (Art. XIII): the verified-source gate is the FIRST thing either store evaluates,
      // so a refused tasking leaves nothing behind to advance later.
      const store = makeStore(CONTRACT_FIXTURE);
      const refused = await store.task(proposedTask('t-5', 'PROPOSED', CONTRACT_UNVERIFIED));
      expect(isErr(refused)).toBe(true);
      const retried = await store.task(advanceTo('t-5', 'TASKED'));
      expect(isErr(retried)).toBe(true);
      if (isErr(retried)) expect(retried.error.code).toBe('INVALID_TRANSITION');
    });
  });
}
