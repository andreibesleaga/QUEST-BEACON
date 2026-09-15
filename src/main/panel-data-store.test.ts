// BEACON — composition of the OPERATOR-MAINTAINED panel store (ADR-041; V2·A12).
//
// WHY THIS FILE EXISTS AT ALL. The A2 all-lens review (2026-09-10) found defect B1: the ADR-039 durable
// mirrors were implemented, unit-tested and composed by NOTHING, so under FEATURE_STORE=postgres three
// tables stayed empty and nobody noticed. `panelDataStore` is the same kind of seam, so it gets the test
// that defect would have failed — both halves of it: that the postgres posture builds a port, and that the
// memory posture builds NONE and never touches the db client (Art. XVI — the air-gapped profile must not
// acquire a database dependency by accident).
//
// The db client is MOCKED, so no connection and no network is ever opened (the build-core.test.ts pattern).
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { makeDb } from '@/adapters/persistence/client.js';
import { loadConfig } from '@/config/index.js';
import { panelDataStore } from './build-core';

const pg = vi.hoisted(() => ({ db: { marker: 'fake-pg-client' as const } }));
vi.mock('@/adapters/persistence/client.js', () => ({
  makeDb: vi.fn(() => pg.db),
  sharedDb: vi.fn(() => pg.db),
  getDb: vi.fn(() => pg.db),
}));

const REAL_DATABASE_URL = 'postgres://user:pass@example.invalid:5432/beacon'; // never dialed (db is mocked)

describe('panelDataStore — the operator-maintained panel store seam', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('memory posture (the default): composes NO store and never opens a db client', () => {
    const config = loadConfig({});
    expect(config.FEATURE_STORE).toBe('memory');
    expect(panelDataStore(config)).toBeUndefined();
    expect(makeDb).not.toHaveBeenCalled();
  });

  it('FEATURE_STORE=postgres: composes a port over the configured DATABASE_URL', () => {
    const port = panelDataStore(
      loadConfig({ FEATURE_STORE: 'postgres', DATABASE_URL: REAL_DATABASE_URL }),
    );
    expect(makeDb).toHaveBeenCalledWith(REAL_DATABASE_URL);
    expect(port).toBeDefined();
    // All five panel datasets, or a panel silently keeps reading its fixture forever.
    expect(Object.keys(port!).sort()).toEqual([
      'damageEntries',
      'emsProducts',
      'shelters',
      'supplies',
      'volunteerTeams',
    ]);
  });
});
