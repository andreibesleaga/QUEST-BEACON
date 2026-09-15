// BEACON — in-memory ResourceLogisticsPort adapter (E5·T-224/227; FR-8, EV9, SPEC §5.5). The DEFAULT,
// air-gapped logistics store: seedable resources + shelters, a forward-only ResourceTask lifecycle, and
// deterministic shelter capacity matching. GUARDRAIL (Art. XIII / ST1): a resource may be tasked ONLY
// when its triggering source (incident) is VERIFIED — an unverified tasking is rejected (UNAUTHORIZED).
// No infra. Adapters may import @/domain,@/ports (hexagonal boundary).
import { ok, err } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import { DomainError, Unauthorized, InvalidTransition } from '@/domain/errors.js';
import type { Resource } from '@/domain/resource.js';
import { transitionResourceTask } from '@/domain/resource-task.js';
import type { ResourceTask, ResourceTaskStatus } from '@/domain/resource-task.js';
import type { Shelter } from '@/domain/shelter.js';
import type { IncidentId } from '@/domain/value-objects/ids.js';
import type { ResourceLogisticsPort } from '@/ports/logistics.js';
import { DEFAULT_CAPACITY_MATCH_DIRECTION, rankShelters } from './shelter-ranking.js';
import type { CapacityMatchDirection } from './shelter-ranking.js';

export interface LogisticsSeed {
  readonly resources: readonly Resource[];
  readonly shelters: readonly Shelter[];
  /**
   * Incidents whose triggering source is VERIFIED (Art. XIII / ST1). Only these may task a resource —
   * this is the logistics-side of the deterministic→AI→human handshake (no public action from an
   * UNVERIFIED report). Omitted ⇒ empty ⇒ tasking is refused until a verified incident is seeded.
   */
  readonly verifiedIncidents?: readonly IncidentId[];
}

/**
 * The port plus a `register` write path (POST /resources persists into the same store GET reads).
 *
 * `register` is ASYNC because the durable twin (pg-logistics.ts) cannot answer before the row is written,
 * and a store that reported success before persisting would return 201 for a resource nobody stored. The
 * in-memory store resolves immediately, so the offline path is unchanged.
 */
export interface LogisticsAdapter extends ResourceLogisticsPort {
  register(resource: Resource): Promise<Result<Resource, DomainError>>;
}

/** Non-seed, per-composition knobs (config-derived) — kept off {@link LogisticsSeed}, which is DATA. */
export interface LogisticsOptions {
  /** The shelter-matching objective (CAPACITY_MATCH_DIRECTION). Omitted ⇒ the documented default. */
  readonly capacityMatchDirection?: CapacityMatchDirection;
}

/** A brand-new task must enter the lifecycle at PROPOSED (its start state, EV9). */
function createTask(
  task: ResourceTask,
  store: Map<string, ResourceTask>,
): Result<ResourceTask, DomainError> {
  if (task.status !== 'PROPOSED') {
    return err(
      new InvalidTransition(`a new resource task must start at PROPOSED, got ${task.status}`),
    );
  }
  store.set(String(task.id), task);
  return ok(task);
}

/** Advance an existing task by exactly one legal forward hop (the domain machine enforces no skip/backward). */
function stepTask(
  existing: ResourceTask,
  to: ResourceTaskStatus,
  store: Map<string, ResourceTask>,
): Result<ResourceTask, DomainError> {
  try {
    const next = transitionResourceTask(existing, to);
    store.set(String(next.id), next);
    return ok(next);
  } catch (cause) {
    return err(
      cause instanceof DomainError
        ? cause
        : new InvalidTransition('illegal resource-task transition'),
    );
  }
}

function advanceTask(
  task: ResourceTask,
  store: Map<string, ResourceTask>,
  verified: ReadonlySet<string>,
): Result<ResourceTask, DomainError> {
  if (!verified.has(String(task.incidentId))) {
    return err(
      new Unauthorized(
        `resource task requires a VERIFIED source (Art. XIII/ST1): incident ${String(task.incidentId)}`,
      ),
    );
  }
  const existing = store.get(String(task.id));
  return existing === undefined ? createTask(task, store) : stepTask(existing, task.status, store);
}

/** Build the in-memory logistics adapter from a seed. Deterministic; state lives only in this process. */
export function makeLogisticsAdapter(
  seed: LogisticsSeed,
  options: LogisticsOptions = {},
): LogisticsAdapter {
  const resources: Resource[] = [...seed.resources];
  const shelters = seed.shelters;
  const verified = new Set<string>((seed.verifiedIncidents ?? []).map((id) => String(id)));
  const tasks = new Map<string, ResourceTask>();
  const direction = options.capacityMatchDirection ?? DEFAULT_CAPACITY_MATCH_DIRECTION;

  return {
    // incidentId scopes the query; the offline store returns all AVAILABLE assets (region-level registry).
    listAvailable: () => Promise.resolve(ok(resources.filter((r) => r.status === 'AVAILABLE'))),
    findShelters: (near) => Promise.resolve(ok(rankShelters(shelters, near, direction))),
    task: (task) => Promise.resolve(advanceTask(task, tasks, verified)),
    register: (resource) => {
      resources.push(resource);
      return Promise.resolve(ok(resource));
    },
  };
}
