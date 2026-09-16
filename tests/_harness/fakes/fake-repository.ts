// BEACON test harness — generic in-memory RepositoryPort<T,Id> (TEST_PLAN §4). No SQL/Drizzle; entities
// are keyed by an injected id-extractor so any aggregate can be stored. Returns typed domain Results,
// never throws — mirrors the real adapter contract.
import type { RepositoryPort } from '@/ports/infra.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import { ok, err } from '@/domain/shared/result.js';
import { DomainError as DomainErr } from '@/domain/errors.js';

export class FakeRepository<T, Id extends string = string> implements RepositoryPort<T, Id> {
  private readonly store = new Map<Id, T>();
  public failSave = false;

  constructor(private readonly idOf: (entity: T) => Id) {}

  getById(id: Id): Promise<Result<T | null, DomainError>> {
    return Promise.resolve(ok(this.store.get(id) ?? null));
  }

  save(entity: T): Promise<Result<T, DomainError>> {
    if (this.failSave) {
      return Promise.resolve(err(new DomainErr('CONFLICT', 'repository save failed (injected)')));
    }
    this.store.set(this.idOf(entity), entity);
    return Promise.resolve(ok(entity));
  }

  delete(id: Id): Promise<Result<void, DomainError>> {
    this.store.delete(id);
    return Promise.resolve(ok(undefined));
  }

  list(): Promise<Result<readonly T[], DomainError>> {
    return Promise.resolve(ok([...this.store.values()]));
  }

  /** Test affordance: seed many entities at once. */
  seed(entities: readonly T[]): void {
    for (const e of entities) this.store.set(this.idOf(e), e);
  }
}
