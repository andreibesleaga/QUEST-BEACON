// BEACON — seed dataset tests (E3·T-129; MIGRATION_PLAN §5). Verifies the deterministic reference
// seed WITHOUT a DB: CA LIVE + Romania CACHED regions, one user per RBAC role, agency shelters, and
// that every seeded row respects the DB invariants (occupancy<=capacity, consented, provenance modes).
import { describe, expect, it } from 'vitest';
import {
  isUniqueViolation,
  planLegacySourceUpgrade,
  remapRegionIds,
  buildSeed,
  insertRows,
} from './seed';

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
    expect(data.sourceRecords.some((s) => s.source === 'meteoalarm-ro')).toBe(true);
    // Keyed by ADAPTER id so the live mirror (ADR-039) replaces these rows instead of sitting beside them.
    expect(data.sourceRecords.map((s) => s.source)).toEqual([
      'firms',
      'glofas',
      'effis',
      'meteoalarm-ro',
    ]);
    // Every source record carries a license + fixed fetched_at (freshness anchor, Art. XI).
    for (const s of data.sourceRecords) {
      expect(s.license).toBeTruthy();
      expect(s.fetchedAt).toBeInstanceOf(Date);
    }
  });

  it('seeds exactly one APP_USER per RBAC role', () => {
    expect(data.appUsers.map((u) => u.role).sort()).toEqual([
      'EM',
      'PUBLIC',
      'RESPONDER',
      'VERIFIER',
    ]);
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

  // DEFERRAL REVERSED (2026-09-12). PR #13 merged with these four datasets emptied, pending "panel reads
  // that carry a validated region context". The concern is real — `panels.ts` serves every row regardless
  // of region — but deferring the DATA did not address it and made the state incoherent: the repository
  // still shipped config/reference-data.json, the loader and its eleven tests, and a seed summary line
  // reporting counts for rows it never wrote. That is a feature with no on-camera moment, which is the
  // defect class this codebase explicitly hunts, plus a report claiming work that did not happen.
  //
  // The region-scoping fix belongs in the panel READ path, where the unscoped serve actually is. Until
  // then an empty table is strictly worse than a scoped-but-unfiltered one: the panel silently falls back
  // to its built-in fixture and labels itself degraded, which is what every deployment has shown so far.
  //
  // ONE dataset stays deferred, and on the merits: `ems_overlay_product.domain_id` is documented as the
  // publisher's OWN product id, and the recorded Copernicus page carries only activation codes and a
  // product count. A row minted from that would carry an id the publisher never issued and a product
  // type nobody recorded. The config says so in its `_provenance` block; this test pins that it is empty
  // ON PURPOSE rather than by accident, so the day real product rows arrive the assertion flips loudly.
  it('seeds three dock-panel tables, each row scoped to a region the seed also creates', () => {
    expect(data.supplyLots.length).toBeGreaterThan(0);
    expect(data.volunteerTeams.length).toBeGreaterThan(0);
    expect(data.damageEntries.length).toBeGreaterThan(0);
    expect(data.emsProducts).toEqual([]); // deferred — see above; not a fallback, a decision
    const regionIds = new Set(data.regions.map((r) => r.id));
    // The guard the deferral was worried about, enforced where it can be: no panel row may reference a
    // region this seed did not create, so none can land attached to nothing.
    for (const r of [...data.supplyLots, ...data.volunteerTeams, ...data.emsProducts]) {
      expect(regionIds).toContain(r.regionId);
    }
  });

  it('keys every panel row on a natural id, which is what makes a re-seed safe to re-run', () => {
    // These tables are inserted with a generated uuid, so `domain_id` is the only thing ON CONFLICT can
    // target. A duplicate would be swallowed by DO NOTHING and one of the two rows would silently vanish.
    for (const rows of [
      data.supplyLots,
      data.volunteerTeams,
      data.damageEntries,
      data.emsProducts,
    ]) {
      const ids = rows.map((r) => r.domainId);
      expect(ids.every((id) => typeof id === 'string' && id !== '')).toBe(true);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

// ── The five tables nothing had ever written (2026-09-12) ─────────────────────────────────────────────
//
// Four of them were empty and served a built-in fixture, which is at least visible. `incident` was worse:
// empty AND load-bearing. `resolveIncidentRowId` translates a domain id to the surrogate uuid every
// foreign key uses, so with no row it returned null and every incident-keyed store — evacuation routes
// included — discarded what it was asked to persist, with no error anywhere.
describe('the operational seed', () => {
  const data = buildSeed();

  it('writes an incident row for every seeded scenario, carrying its natural key', () => {
    const domainIds = data.incidents.map((i) => i.domainId);
    expect(domainIds).toContain('us-ca-wildfire-demo');
    expect(domainIds).toContain('ro-flood-demo');
    for (const row of data.incidents) {
      expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(row.regionId).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('derives every id from its domain id, so a re-run changes nothing', () => {
    // These tables have no natural-key column to conflict on. If the ids were generated the second seed
    // run would insert a duplicate of everything the first one wrote.
    const again = buildSeed();
    expect(again.incidents.map((i) => i.id)).toEqual(data.incidents.map((i) => i.id));
    expect(again.resources.map((r) => r.id)).toEqual(data.resources.map((r) => r.id));
    expect(again.publicReports.map((r) => r.id)).toEqual(data.publicReports.map((r) => r.id));
  });

  it('points every task and report at an incident row this same seed creates', () => {
    // The foreign keys are NOT NULL. A task pointing at an id no row carries fails the INSERT at 3 a.m.
    // on someone else's deployment; here it fails now.
    const incidentIds = new Set(data.incidents.map((i) => i.id));
    const resourceIds = new Set(data.resources.map((r) => r.id));
    expect(data.resourceTasks.length).toBeGreaterThan(0);
    for (const task of data.resourceTasks) {
      expect(incidentIds.has(String(task.incidentId))).toBe(true);
      expect(resourceIds.has(String(task.resourceId))).toBe(true);
    }
    expect(data.publicReports.length).toBeGreaterThan(0);
    for (const report of data.publicReports) {
      expect(incidentIds.has(String(report.incidentId))).toBe(true);
    }
  });

  it('seeds consented reports with a generalized location and never a precise one', () => {
    // Art. XIV and the table's own CHECK constraint. `geom_precise` is the responder-only column, and a
    // demonstration report has no real person behind it whose precise location could be protected.
    for (const report of data.publicReports) {
      expect(report.consent).toBe(true);
      expect(report.geomPrecise).toBeUndefined();
      expect(report.purgeAfter).toBeInstanceOf(Date);
    }
  });

  it('leaves every seeded report awaiting a human, never pre-verified', () => {
    // Art. XIII. Seeding a VERIFIED report would hand the queue a decision no person made, and VERIFIED
    // is the state that makes a report eligible to reach a public alert.
    for (const report of data.publicReports) {
      expect(['UNVERIFIED', 'TRIAGED']).toContain(report.status);
    }
  });

  it('scopes every threshold rule to a region this seed creates', () => {
    const regionIds = new Set(data.regions.map((r) => r.id));
    expect(data.thresholdRules.length).toBeGreaterThan(0);
    for (const rule of data.thresholdRules) {
      expect(regionIds.has(String(rule.scope))).toBe(true);
    }
  });

  it('gives the Logistics board something in every lifecycle state it renders', () => {
    // The tab was empty, and a tab with one PROPOSED row in it demonstrates nothing about the lifecycle.
    const statuses = new Set(data.resourceTasks.map((t) => t.status));
    expect(statuses.size).toBeGreaterThanOrEqual(3);
  });
});

describe('planLegacySourceUpgrade — the four display-name rows an existing database still holds', () => {
  const rows = buildSeed().sourceRecords;

  it('is a no-op on a fresh database (no legacy names present)', () => {
    expect(planLegacySourceUpgrade(rows, new Set())).toEqual([]);
    expect(planLegacySourceUpgrade(rows, new Set(['firms', 'glofas']))).toEqual([]);
  });

  it('renames a legacy row in place when the adapter id is still free, so citations at its uuid keep resolving', () => {
    const steps = planLegacySourceUpgrade(rows, new Set(['Copernicus GloFAS', 'other']));
    expect(steps).toEqual([
      {
        kind: 'rename',
        id: rows[1]!.id,
        from: 'Copernicus GloFAS',
        to: 'glofas',
        adapter: 'glofas-adapter',
      },
    ]);
  });

  it('deletes a legacy row when the provenance mirror has already minted the adapter-keyed row', () => {
    const steps = planLegacySourceUpgrade(rows, new Set(['MeteoAlarm (Romania)', 'meteoalarm-ro']));
    expect(steps).toEqual([
      { kind: 'delete', id: rows[3]!.id, from: 'MeteoAlarm (Romania)', to: 'meteoalarm-ro' },
    ]);
  });

  it('handles all four at once, each by its own situation', () => {
    const steps = planLegacySourceUpgrade(
      rows,
      new Set([
        'NASA FIRMS',
        'firms',
        'Copernicus GloFAS',
        'Copernicus EFFIS',
        'effis',
        'MeteoAlarm (Romania)',
      ]),
    );
    expect(steps.map((s) => `${s.kind}:${s.from}`)).toEqual([
      'delete:NASA FIRMS',
      'rename:Copernicus GloFAS',
      'delete:Copernicus EFFIS',
      'rename:MeteoAlarm (Romania)',
    ]);
  });
});

describe('isUniqueViolation — the one driver error the legacy upgrade retries', () => {
  it('recognises Postgres 23505 and nothing else', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ code: '23503' })).toBe(false); // foreign-key violation is NOT retried
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation('23505')).toBe(false);
  });
});

describe('remapRegionIds — seeded FKs follow the region row that actually exists', () => {
  const rows = [
    { domainId: 'a', regionId: 'pinned-es' },
    { domainId: 'b', regionId: 'pinned-ro' },
    { domainId: 'c' },
  ];

  it('is the identity on a fresh database (empty remap) — the same objects, not copies', () => {
    const out = remapRegionIds(rows, new Map());
    expect(out).toEqual(rows);
    expect(out[0]).toBe(rows[0]);
  });

  it('repoints only the rows whose pinned uuid was superseded by a legacy row', () => {
    const out = remapRegionIds(rows, new Map([['pinned-es', 'legacy-es-uuid']]));
    expect(out[0]).toEqual({ domainId: 'a', regionId: 'legacy-es-uuid' });
    expect(out[1]).toBe(rows[1]);
    expect(out[2]).toBe(rows[2]);
  });
});

// ── An empty reference list must not abort the seed (2026-09-14) ──────────────────────────────────────
describe('insertRows', () => {
  type Call = { readonly rows: readonly unknown[]; readonly target: unknown };
  const fakeDb = (calls: Call[]) =>
    ({
      insert: () => ({
        values: (rows: readonly unknown[]) => ({
          onConflictDoNothing: (target?: unknown) => {
            calls.push({ rows, target });
            return Promise.resolve();
          },
        }),
      }),
    }) as unknown as Parameters<typeof insertRows>[0];

  it('skips an empty list entirely — Drizzle would throw "values() must be called with at least one value"', async () => {
    const calls: Call[] = [];
    await insertRows(fakeDb(calls), {} as Parameters<typeof insertRows>[1], []);
    expect(calls).toEqual([]);
  });

  it('inserts a non-empty list with do-nothing-on-conflict, passing the conflict target through', async () => {
    const calls: Call[] = [];
    const table = {} as Parameters<typeof insertRows>[1];
    await insertRows(fakeDb(calls), table, [{ a: 1 }, { a: 2 }]);
    await insertRows(fakeDb(calls), table, [{ a: 3 }], { target: 'domain_id' as never });
    expect(calls[0]?.rows).toHaveLength(2);
    expect(calls[0]?.target).toBeUndefined();
    expect(calls[1]?.target).toEqual({ target: 'domain_id' });
  });
});
