// BEACON — in-memory ResourceLogisticsPort adapter tests (FR-8, EV9, Art. XIII/ST1).
//
// The BEHAVIOURAL claims live in the shared contract suite (`logistics-contract.test-suite.ts`) and run
// against every implementation — see `pg-logistics.test.ts` for the durable twin. What stays here is what
// is TRUE OF THIS STORE ONLY and does not generalise: the seeded identity is preserved verbatim (the
// Postgres store's surrogate PK is a DB-minted uuid), and the store is process-local.
import { describe, expect, it } from 'vitest';
import { isOk } from '@/domain/shared/result.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { ResourceId } from '@/domain/value-objects/ids.js';
import { makeResource } from '@/domain/resource.js';
import { makeLogisticsAdapter } from './memory-logistics.js';
import {
  CONTRACT_FIXTURE,
  CONTRACT_INCIDENT,
  describeLogisticsContract,
} from './logistics-contract.test-suite.js';
import type { LogisticsContractFixture } from './logistics-contract.test-suite.js';

const memoryStore = (fixture: LogisticsContractFixture) =>
  makeLogisticsAdapter(
    {
      resources: fixture.resources,
      shelters: fixture.shelters,
      verifiedIncidents: fixture.verifiedIncidents,
    },
    fixture.capacityMatchDirection !== undefined
      ? { capacityMatchDirection: fixture.capacityMatchDirection }
      : {},
  );

describeLogisticsContract('makeLogisticsAdapter', memoryStore);

describe('makeLogisticsAdapter — memory-only guarantees', () => {
  it('preserves the SEEDED resource id verbatim (no surrogate key is minted)', async () => {
    const r = await memoryStore(CONTRACT_FIXTURE).listAvailable(CONTRACT_INCIDENT);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.map((x) => x.id)).toEqual(['res-1']);
  });

  it('registers a resource under the id the caller supplied', async () => {
    const store = memoryStore(CONTRACT_FIXTURE);
    const registered = await store.register(
      makeResource({ id: asId<ResourceId>('res-3'), kind: 'MEDICAL', status: 'AVAILABLE' }),
    );
    expect(isOk(registered) && registered.value.id).toBe('res-3');
  });

  it('keeps state process-local: a second adapter over the same seed sees no earlier registration', async () => {
    // The reason `FEATURE_STORE=postgres` needs a durable store at all — this is a property, not a defect.
    const first = memoryStore(CONTRACT_FIXTURE);
    await first.register(
      makeResource({ id: asId<ResourceId>('res-9'), kind: 'SUPPLY', status: 'AVAILABLE' }),
    );
    const second = await memoryStore(CONTRACT_FIXTURE).listAvailable(CONTRACT_INCIDENT);
    expect(isOk(second) && second.value.some((x) => x.id === 'res-9')).toBe(false);
  });
});
