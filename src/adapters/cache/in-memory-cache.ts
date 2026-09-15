// BEACON — In-memory CachePort adapter (DEFAULT; FEATURE_CACHE=memory; T-128; ADR-001 Infra).
// The locked demo default. Backs last-known-good (T-128 F6): a stored value survives later
// source-misses because a miss simply never calls set(), so the good value is still served.
// A single-process Map with per-key TTL. The clock is injected so tests advance time
// deterministically without real timers.
import { err, ok } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import { DomainError } from '@/domain/errors.js';
import type { CachePort } from '@/ports/infra.js';

/** One cache slot. `expiresAt === null` means the entry never expires. */
interface Entry {
  readonly value: unknown;
  readonly expiresAt: number | null;
}

export class InMemoryCache implements CachePort {
  private readonly store = new Map<string, Entry>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  get<T>(key: string): Promise<Result<T | null, DomainError>> {
    const entry = this.store.get(key);
    if (entry === undefined) {
      return Promise.resolve(ok(null));
    }
    if (entry.expiresAt !== null && this.now() >= entry.expiresAt) {
      this.store.delete(key); // lazy eviction
      return Promise.resolve(ok(null));
    }
    return Promise.resolve(ok(entry.value as T));
  }

  set<T>(key: string, value: T, ttlSeconds?: number): Promise<Result<void, DomainError>> {
    let expiresAt: number | null = null;
    if (ttlSeconds !== undefined) {
      if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
        return Promise.resolve(
          err(
            new DomainError(
              'INVARIANT_VIOLATION',
              `ttlSeconds must be finite and > 0, got ${ttlSeconds}`,
            ),
          ),
        );
      }
      expiresAt = this.now() + ttlSeconds * 1000;
    }
    this.store.set(key, { value, expiresAt });
    return Promise.resolve(ok(undefined));
  }

  delete(key: string): Promise<Result<void, DomainError>> {
    this.store.delete(key);
    return Promise.resolve(ok(undefined));
  }
}

/** Factory for the default in-memory CachePort. `now` is injectable for deterministic tests. */
export const makeInMemoryCache = (now: () => number = Date.now): CachePort =>
  new InMemoryCache(now);
