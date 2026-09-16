// BEACON — service-worker registration / retirement (ADR-047). Pure over two narrow interfaces so the
// decision table is unit-tested without a browser: enabled ⇒ register the module worker; disabled ⇒
// unregister every worker of this origin and delete every `beacon-sw-*` cache, so switching the flag
// off leaves NO trace of the feature on the operator's device (the fallback is complete, not "off").

/** The name prefix every cache the worker owns starts with (mirrors CACHE_PREFIX in public/sw.js). */
export const SW_CACHE_PREFIX = 'beacon-sw-';
export const SW_URL = '/sw.js';

export interface RegistrationLike {
  unregister(): Promise<boolean>;
}
export interface WorkerContainerLike {
  register(url: string, options: { type: 'module' }): Promise<unknown>;
  getRegistrations(): Promise<readonly RegistrationLike[]>;
}
export interface CacheStorageLike {
  keys(): Promise<readonly string[]>;
  delete(name: string): Promise<boolean>;
}

export type RegistrationOutcome = 'registered' | 'cleared' | 'unsupported' | 'failed';

/**
 * Apply the flag to this device. Never throws: a browser that refuses (private mode, an http origin,
 * a blocked worker) simply reports `failed` and the app runs exactly as it does without a worker.
 */
export async function applyRegistration(
  container: WorkerContainerLike | undefined,
  caches: CacheStorageLike | undefined,
  enabled: boolean,
): Promise<RegistrationOutcome> {
  if (container === undefined) return 'unsupported';
  if (enabled) {
    try {
      await container.register(SW_URL, { type: 'module' });
      return 'registered';
    } catch {
      return 'failed';
    }
  }
  // Retirement and purge are INDEPENDENT: a worker that refuses to unregister must not leave the caches
  // behind, and a cache that refuses deletion must not leave the worker registered. Either failure
  // still reports `failed`.
  const [retired, purged] = await Promise.all([retireWorkers(container), purgeCaches(caches)]);
  return retired && purged ? 'cleared' : 'failed';
}

async function retireWorkers(container: WorkerContainerLike): Promise<boolean> {
  try {
    const registrations = await container.getRegistrations();
    await Promise.all(registrations.map((r) => r.unregister()));
    return true;
  } catch {
    return false;
  }
}

async function purgeCaches(caches: CacheStorageLike | undefined): Promise<boolean> {
  if (caches === undefined) return true;
  try {
    const names = await caches.keys();
    await Promise.all(
      names.filter((n) => n.startsWith(SW_CACHE_PREFIX)).map((n) => caches.delete(n)),
    );
    return true;
  } catch {
    return false;
  }
}

/** A message the worker posts when it answered from its cache (see servedFromCacheMessage in sw.js). */
export interface ServedFromCache {
  readonly type: 'beacon:served-from-cache';
  readonly url: string;
  readonly cachedAt: string | null;
}
export interface ServedFromNetwork {
  readonly type: 'beacon:served-from-network';
  readonly url: string;
}

/** Narrow an untrusted `MessageEvent.data` to one of the worker's messages, else undefined. */
export function parseWorkerMessage(data: unknown): ServedFromCache | ServedFromNetwork | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const m = data as { type?: unknown; url?: unknown; cachedAt?: unknown };
  if (typeof m.url !== 'string') return undefined;
  if (m.type === 'beacon:served-from-network') return { type: m.type, url: m.url };
  if (m.type === 'beacon:served-from-cache') {
    return {
      type: m.type,
      url: m.url,
      cachedAt: typeof m.cachedAt === 'string' ? m.cachedAt : null,
    };
  }
  return undefined;
}
