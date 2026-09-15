// BEACON — Redis CachePort adapter (FLAG path; FEATURE_CACHE=redis; T-128; ADR-001 Infra).
//
// STUB — NOT wired to a live Redis in this build. The in-memory adapter is the LOCKED demo
// default; this file only exists so the FEATURE_CACHE=redis flag path stays interface-conformant.
// Wiring a real client (e.g. ioredis) is a future dependency decision that requires approval —
// there is deliberately NO redis client dependency in this build. Until one is provisioned every
// method returns a typed INVARIANT_VIOLATION so the flag path is fail-safe and never silently
// drops or serves stale cache entries. Set FEATURE_CACHE=memory to run.
import { err } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import { DomainError } from '@/domain/errors.js';
import type { CachePort } from '@/ports/infra.js';

const NOT_IMPLEMENTED =
  'Redis CachePort not implemented in this build — no redis client dependency; set FEATURE_CACHE=memory';

// Consumes (and discards) the call arguments so the fail-safe error is symmetric across methods.
const notImplemented = <T>(...args: readonly unknown[]): Promise<Result<T, DomainError>> => {
  void args;
  return Promise.resolve(err(new DomainError('INVARIANT_VIOLATION', NOT_IMPLEMENTED)));
};

export class RedisCache implements CachePort {
  get<T>(key: string): Promise<Result<T | null, DomainError>> {
    return notImplemented(key);
  }

  set<T>(key: string, value: T, ttlSeconds?: number): Promise<Result<void, DomainError>> {
    return notImplemented(key, value, ttlSeconds);
  }

  delete(key: string): Promise<Result<void, DomainError>> {
    return notImplemented(key);
  }
}

/** Factory for the Redis-backed CachePort (flag path; stub until a client dep is approved). */
export const makeRedisCache = (): CachePort => new RedisCache();
