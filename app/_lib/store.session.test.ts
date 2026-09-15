// @vitest-environment happy-dom
// BEACON — sessionStorage session persistence (S3·U3). The auth slice (actorRole + authToken) rehydrates
// from sessionStorage at store creation and is mirrored on every auth transition — so a reload does not
// sign the operator out mid-incident, while the session still dies with the tab (sessionStorage, NEVER
// localStorage). Every malformation degrades to clean least-privilege defaults; nothing here may crash.
// (store.test.ts runs the same module under node — no window — so the SSR init path is covered twice.)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// The static import types `freshStore` only; every test re-imports the module so creation-time
// rehydration runs against the storage that test seeded.
import { SESSION_STORAGE_KEY, type useUiStore } from './store.js';

/** Re-import the store module fresh so its creation-time rehydration runs against the seeded storage. */
async function freshStore(): Promise<typeof useUiStore> {
  vi.resetModules();
  return (await import('./store.js')).useUiStore;
}

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useUiStore session persistence (sessionStorage)', () => {
  it('rehydrates actorRole + authToken from sessionStorage on init', async () => {
    sessionStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ actorRole: 'VERIFIER', authToken: 'jwt-abc' }),
    );
    const store = await freshStore();
    expect(store.getState().actorRole).toBe('VERIFIER');
    expect(store.getState().authToken).toBe('jwt-abc');
  });

  it('rehydrates a role-only session (no token minted yet — the header-based offline demo)', async () => {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ actorRole: 'RESPONDER' }));
    const store = await freshStore();
    expect(store.getState().actorRole).toBe('RESPONDER');
    expect(store.getState().authToken).toBeUndefined();
  });

  it('absent storage ⇒ clean least-privilege defaults', async () => {
    const store = await freshStore();
    expect(store.getState().actorRole).toBe('PUBLIC');
    expect(store.getState().authToken).toBeUndefined();
  });

  it('corrupted JSON is ignored — clean defaults, never a crash', async () => {
    sessionStorage.setItem(SESSION_STORAGE_KEY, '{not json!!');
    const store = await freshStore();
    expect(store.getState().actorRole).toBe('PUBLIC');
    expect(store.getState().authToken).toBeUndefined();
  });

  it('an out-of-vocabulary role is rejected wholesale (tampered storage never seeds RBAC state)', async () => {
    sessionStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ actorRole: 'SUPERADMIN', authToken: 'jwt-x' }),
    );
    const store = await freshStore();
    expect(store.getState().actorRole).toBe('PUBLIC');
    expect(store.getState().authToken).toBeUndefined();
  });

  it('a non-string token is rejected wholesale', async () => {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ actorRole: 'EM', authToken: 42 }));
    const store = await freshStore();
    expect(store.getState().actorRole).toBe('PUBLIC');
    expect(store.getState().authToken).toBeUndefined();
  });

  it('a storage read that THROWS degrades to defaults (privacy modes), never a crash', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    const store = await freshStore();
    expect(store.getState().actorRole).toBe('PUBLIC');
    expect(store.getState().authToken).toBeUndefined();
  });

  it('setRole and setAuthToken mirror the auth slice — and ONLY the auth slice — to sessionStorage', async () => {
    const store = await freshStore();
    store.getState().setRole('RESPONDER');
    expect(JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY) ?? '')).toEqual({
      actorRole: 'RESPONDER',
    });
    store.getState().setAuthToken('jwt-abc');
    expect(JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY) ?? '')).toEqual({
      actorRole: 'RESPONDER',
      authToken: 'jwt-abc',
    });
    // Nothing may land in localStorage — the session must die with the tab, by design.
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('logout (setAuthToken(undefined)) removes the persisted session entirely', async () => {
    const store = await freshStore();
    store.getState().setRole('VERIFIER');
    store.getState().setAuthToken('jwt-abc');
    expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).not.toBeNull();
    store.getState().setAuthToken(undefined);
    expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('is SSR-safe: with no window the store initializes to defaults and auth actions never throw', async () => {
    vi.stubGlobal('window', undefined);
    const store = await freshStore();
    expect(store.getState().actorRole).toBe('PUBLIC');
    expect(() => {
      store.getState().setRole('EM');
      store.getState().setAuthToken('jwt-abc');
      store.getState().setAuthToken(undefined);
    }).not.toThrow();
    expect(store.getState().actorRole).toBe('EM');
  });
});
