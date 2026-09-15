// BEACON test harness — in-memory CachePort (TEST_PLAN §4). Backs the RedundancyEngine's last-known-good
// rung in tests without Redis. A `failReads` toggle simulates a torn/unreadable cache entry so the
// cache-corruption chaos case (§3.9) can assert the engine falls through to mock, never relabels stale.
import type { CachePort } from '@/ports/infra.js';
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import { ok, err } from '@/domain/shared/result.js';
import { DomainError as DomainErr } from '@/domain/errors.js';

interface Entry {
  readonly value: unknown;
  readonly expiresAtMs?: number;
}

export interface FakeCacheOptions {
  readonly nowMs?: () => number;
  readonly failReads?: boolean; // simulate a torn cache entry (chaos)
}

export class FakeCache implements CachePort {
  private readonly store = new Map<string, Entry>();
  private readonly nowMs: () => number;
  public failReads: boolean;
  public getCount = 0;
  public setCount = 0;

  constructor(options: FakeCacheOptions = {}) {
    this.nowMs = options.nowMs ?? (() => Date.now());
    this.failReads = options.failReads ?? false;
  }

  get<T>(key: string): Promise<Result<T | null, DomainError>> {
    this.getCount++;
    if (this.failReads) {
      return Promise.resolve(err(new DomainErr('CONFLICT', `torn cache entry for ${key}`)));
    }
    const entry = this.store.get(key);
    if (entry === undefined) return Promise.resolve(ok(null));
    if (entry.expiresAtMs !== undefined && this.nowMs() > entry.expiresAtMs) {
      this.store.delete(key);
      return Promise.resolve(ok(null));
    }
    return Promise.resolve(ok(entry.value as T));
  }

  set<T>(key: string, value: T, ttlSeconds?: number): Promise<Result<void, DomainError>> {
    this.setCount++;
    const entry: Entry =
      ttlSeconds === undefined
        ? { value }
        : { value, expiresAtMs: this.nowMs() + ttlSeconds * 1000 };
    this.store.set(key, entry);
    return Promise.resolve(ok(undefined));
  }

  delete(key: string): Promise<Result<void, DomainError>> {
    this.store.delete(key);
    return Promise.resolve(ok(undefined));
  }

  /** Test affordance: current entry count (not part of the port). */
  size(): number {
    return this.store.size;
  }
}
