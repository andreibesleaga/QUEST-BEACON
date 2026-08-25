// BEACON — Postgres ResourceLogisticsPort adapter (plan §0 decisions 14/17; ADR-013, Art. II). The DURABLE
// twin of `memory-logistics.ts`: under FEATURE_STORE=postgres a tasked resource, a registered asset and an
// opened shelter survive a restart. Until this existed, `FEATURE_STORE=postgres` moved the reports/regions/
// sources stores onto Postgres while logistics silently stayed in process memory — so the one configuration
// the live demo runs lost every tasking on restart.
//
// PARITY IS TESTED, NOT PROMISED: both stores are driven through ONE exported contract suite
// (`logistics-contract.test-suite.ts`), so an eligibility rule, an ordering or a lifecycle guard that
// changes on one side and not the other turns the build red instead of diverging in production. The
// shelter objective and the spare-capacity predicate are literally the same functions
// (`shelter-ranking.ts`), not two implementations that agree today.
//
// IDENTITY — the one deliberate difference, and why it is not a semantic one: `resource.id` and
// `resource_task.id` are `uuid` columns while BEACON's runtime ids are not uuids (`task-<boot>-<n>`), so the
// DB mints the surrogate key and the STORED entity is what the caller gets back (`read-models.ts` made the
// same call for `public_report`). The observable contract is unchanged — an unknown id CREATES and must
// start at PROPOSED, a known id ADVANCES exactly one legal hop — because a caller advances the task it was
// handed, which is what the HTTP client already does (`feature-router.ts` POST /resource-tasks).
import { eq } from 'drizzle-orm';
import { InvalidTransition, Unauthorized } from '@/domain/errors.js';
import { DomainError } from '@/domain/errors.js';
import type { Resource } from '@/domain/resource.js';
import { transitionResourceTask } from '@/domain/resource-task.js';
import type { ResourceTask, ResourceTaskStatus } from '@/domain/resource-task.js';
import type { IncidentId } from '@/domain/value-objects/ids.js';
import type { Db } from '@/adapters/persistence/client.js';
import { tryResult } from '@/adapters/persistence/repository.js';
import { resourceMapper, resourceTaskMapper, shelterMapper } from '@/adapters/persistence/mappers.js';
import { resource, resourceTask, shelter } from '@/adapters/persistence/schema.js';
import type { LogisticsAdapter, LogisticsOptions } from './memory-logistics.js';
import { DEFAULT_CAPACITY_MATCH_DIRECTION, rankShelters } from './shelter-ranking.js';

type TaskRow = typeof resourceTask.$inferSelect;

export interface PgLogisticsOptions extends LogisticsOptions {
  readonly db: Db;
  /**
   * Incidents whose triggering source is VERIFIED (Art. XIII / ST1) — INJECTED, exactly as the in-memory
   * seed injects it, so both stores refuse an unverified tasking on identical terms. Deriving it from the
   * report/incident lifecycle is the composition root's job in a real deployment, not this adapter's.
   */
  readonly verifiedIncidents?: readonly IncidentId[];
}

/**
 * The text shape a `uuid` column accepts. An id that is not a uuid cannot name an existing row, so it is
 * treated as "no such task" here rather than handed to Postgres, which would reject the literal (22P02)
 * and turn a plain CREATE into a driver error.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `.returning()` yields ≥1 row on a write; guard so a domain mapper never receives `undefined`. */
function firstRow<R>(rows: readonly R[], what: string): R {
  const row = rows[0];
  if (row === undefined) throw new DomainError('PARSE_ERROR', `${what} returned no row`);
  return row;
}

async function findTaskRow(db: Db, id: string): Promise<TaskRow | undefined> {
  if (!UUID_RE.test(id)) return undefined;
  const [row] = await db.select().from(resourceTask).where(eq(resourceTask.id, id)).limit(1);
  return row;
}

/** A brand-new task must enter the lifecycle at PROPOSED (its start state, EV9) — the memory guard, verbatim. */
async function createTask(db: Db, task: ResourceTask): Promise<ResourceTask> {
  if (task.status !== 'PROPOSED') {
    throw new InvalidTransition(`a new resource task must start at PROPOSED, got ${task.status}`);
  }
  const rows = await db.insert(resourceTask).values(resourceTaskMapper.toRow(task)).returning();
  return resourceTaskMapper.fromRow(firstRow(rows, 'resource_task.create'));
}

/**
 * Advance an existing row by exactly one legal forward hop. The DOMAIN machine decides (it throws
 * InvalidTransition on a skip or a backward move) — the guard is never re-expressed in SQL, so the DB CHECK,
 * the domain union and this adapter cannot disagree about what a legal tasking hop is.
 */
async function stepTask(db: Db, existing: TaskRow, to: ResourceTaskStatus): Promise<ResourceTask> {
  const next = transitionResourceTask(resourceTaskMapper.fromRow(existing), to);
  const rows = await db
    .update(resourceTask)
    .set({ status: next.status })
    .where(eq(resourceTask.id, existing.id))
    .returning();
  return resourceTaskMapper.fromRow(firstRow(rows, 'resource_task.advance'));
}

/**
 * Build the durable Postgres logistics store. Same `LogisticsAdapter` surface as `makeLogisticsAdapter`, so
 * it is a drop-in for `HttpFeatureDeps.logistics`. Failure NEVER throws upstream: every op is wrapped in
 * `tryResult`, which maps a driver fault to a typed DomainError (repository.ts).
 */
export function makePgLogisticsStore(options: PgLogisticsOptions): LogisticsAdapter {
  const { db } = options;
  const verified = new Set<string>((options.verifiedIncidents ?? []).map((id) => String(id)));
  const direction = options.capacityMatchDirection ?? DEFAULT_CAPACITY_MATCH_DIRECTION;

  return {
    // incidentId scopes the query; like the memory store this is a REGION-level registry, so every
    // AVAILABLE asset is returned and the HTTP layer applies the org scoping (SPEC §2.2).
    listAvailable: () =>
      tryResult(async () =>
        (await db.select().from(resource).where(eq(resource.status, 'AVAILABLE'))).map(
          resourceMapper.fromRow,
        ),
      ),

    // Eligibility + ordering are deliberately NOT pushed into SQL: `rankShelters`/`hasSpareCapacity` are the
    // single shared definition both stores rank with (see shelter-ranking.ts). A WHERE clause here would be
    // a second copy of the rule, free to drift the moment the objective changes.
    findShelters: (near) =>
      tryResult(async () =>
        rankShelters((await db.select().from(shelter)).map(shelterMapper.fromRow), near, direction),
      ),

    task: (task) =>
      tryResult(async () => {
        if (!verified.has(String(task.incidentId))) {
          throw new Unauthorized(
            `resource task requires a VERIFIED source (Art. XIII/ST1): incident ${String(task.incidentId)}`,
          );
        }
        const existing = await findTaskRow(db, String(task.id));
        return existing === undefined ? createTask(db, task) : stepTask(db, existing, task.status);
      }),

    register: (entity: Resource) =>
      tryResult(async () => {
        const rows = await db.insert(resource).values(resourceMapper.toRow(entity)).returning();
        return resourceMapper.fromRow(firstRow(rows, 'resource.register'));
      }),
  };
}
