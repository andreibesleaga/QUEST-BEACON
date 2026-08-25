// BEACON — seed dataset tests (E3·T-129; MIGRATION_PLAN §5). Verifies the deterministic reference
// seed WITHOUT a DB: CA LIVE + Romania CACHED regions, one user per RBAC role, agency shelters, and
// that every seeded row respects the DB invariants (occupancy<=capacity, consented, provenance modes).
import { describe, expect, it } from 'vitest';
import { buildSeed } from './seed';

describe('buildSeed', () => {
  const data = buildSeed();

  it('is deterministic (identical across calls)', () => {
    expect(buildSeed()).toEqual(data);
  });

  it('seeds California (LIVE flagship) + Romania (CACHED)', () => {
    const names = data.regions.map((r) => r.name);
    expect(names).toContain('California (Flagship)');
    expect(names).toContain('Romania (EU Flood)');
    const ro = data.regions.find((r) => r.name === 'Romania (EU Flood)');
    expect(ro?.scope).toBe('COUNTRY');
    expect(ro?.sourceModeOverrides?.['glofas']).toBe('CACHED');
  });

  it('seeds one SOURCE_RECORD per demo mode incl. MeteoAlarm-RO (provenance)', () => {
    const modes = data.sourceRecords.map((s) => s.mode);
    expect(modes).toContain('LIVE');
    expect(modes).toContain('CACHED');
    expect(data.sourceRecords.some((s) => s.source === 'MeteoAlarm (Romania)')).toBe(true);
    // Every source record carries a license + fixed fetched_at (freshness anchor, Art. XI).
    for (const s of data.sourceRecords) {
      expect(s.license).toBeTruthy();
      expect(s.fetchedAt).toBeInstanceOf(Date);
    }
  });

  it('seeds exactly one APP_USER per RBAC role', () => {
    expect(data.appUsers.map((u) => u.role).sort()).toEqual(['EM', 'PUBLIC', 'RESPONDER', 'VERIFIER']);
  });

  it('seeds agency shelters incl. Bucharest (IGSU), all occupancy<=capacity', () => {
    expect(data.shelters.some((s) => s.org === 'IGSU (Romania)')).toBe(true);
    for (const s of data.shelters) {
      expect(s.geom).toMatchObject({ type: 'Point' });
      if (typeof s.capacity === 'number') expect(s.occupancy ?? 0).toBeLessThanOrEqual(s.capacity);
    }
  });

  it('uses valid hex demo UUIDs (no non-hex placeholders)', () => {
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    for (const r of [...data.regions, ...data.sourceRecords, ...data.appUsers, ...data.shelters]) {
      expect(String(r.id)).toMatch(uuidRe);
    }
  });
});
