// BEACON — registration decision table (ADR-047): on ⇒ register the module worker; off ⇒ retire every
// worker AND every beacon-sw-* cache (complete fallback); no container ⇒ unsupported; a refusal ⇒ failed.
import { describe, expect, it, vi } from 'vitest';
import { SW_URL, applyRegistration } from './registration.js';

function fakes(opts: { registrations?: number; caches?: string[]; refuse?: boolean } = {}) {
  const unregister = vi.fn(() => Promise.resolve(true));
  const register = vi.fn(() =>
    opts.refuse ? Promise.reject(new Error('insecure origin')) : Promise.resolve({}),
  );
  const deleted: string[] = [];
  const container = {
    register,
    getRegistrations: () =>
      Promise.resolve(Array.from({ length: opts.registrations ?? 0 }, () => ({ unregister }))),
  };
  const caches = {
    keys: () => Promise.resolve(opts.caches ?? []),
    delete: (name: string) => {
      deleted.push(name);
      return Promise.resolve(true);
    },
  };
  return { container, caches, register, unregister, deleted };
}

describe('applyRegistration', () => {
  it('registers the worker as a module when the flag is on, touching no cache', async () => {
    const f = fakes({ caches: ['beacon-sw-1-data'] });
    await expect(applyRegistration(f.container, f.caches, true)).resolves.toBe('registered');
    expect(f.register).toHaveBeenCalledWith(SW_URL, { type: 'module' });
    expect(f.deleted).toEqual([]);
  });

  it('retires every worker and only the worker’s own caches when the flag is off', async () => {
    const f = fakes({
      registrations: 2,
      caches: ['beacon-sw-1-data', 'beacon-sw-0-static', 'other-app'],
    });
    await expect(applyRegistration(f.container, f.caches, false)).resolves.toBe('cleared');
    expect(f.register).not.toHaveBeenCalled();
    expect(f.unregister).toHaveBeenCalledTimes(2);
    expect(f.deleted).toEqual(['beacon-sw-1-data', 'beacon-sw-0-static']);
  });

  it('reports cleared even when there was nothing to clear, and tolerates a missing CacheStorage', async () => {
    const f = fakes();
    await expect(applyRegistration(f.container, undefined, false)).resolves.toBe('cleared');
  });

  it('reports unsupported when the browser has no service-worker container', async () => {
    const f = fakes();
    await expect(applyRegistration(undefined, f.caches, true)).resolves.toBe('unsupported');
  });

  it('never throws: a refused registration is reported as failed', async () => {
    const f = fakes({ refuse: true });
    await expect(applyRegistration(f.container, f.caches, true)).resolves.toBe('failed');
  });

  it('still purges the caches when worker retirement fails (and reports failed)', async () => {
    const f = fakes({ caches: ['beacon-sw-1-data', 'other-app'] });
    f.container.getRegistrations = () => Promise.reject(new Error('blocked'));
    await expect(applyRegistration(f.container, f.caches, false)).resolves.toBe('failed');
    expect(f.deleted).toEqual(['beacon-sw-1-data']);
  });

  it('still retires the workers when cache deletion fails (and reports failed)', async () => {
    const f = fakes({ registrations: 1, caches: ['beacon-sw-1-data'] });
    const caches = { keys: f.caches.keys, delete: () => Promise.reject(new Error('locked')) };
    await expect(applyRegistration(f.container, caches, false)).resolves.toBe('failed');
    expect(f.unregister).toHaveBeenCalledTimes(1);
  });
});
