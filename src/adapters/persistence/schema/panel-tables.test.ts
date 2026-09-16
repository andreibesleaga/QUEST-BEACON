// BEACON — the five OPERATOR-MAINTAINED panel datasets are addressable by a HUMAN (ADR-041; V2·A12).
//
// These four new tables plus the reused `shelter` are the only tables in BEACON an emergency manager edits
// BY HAND, in Directus, mid-incident. That changes what "correct schema" means for them: a surrogate uuid is
// enough for a machine and useless to the person who has to find the row for the civic-centre shelter again
// at 3am. So every panel table carries a NATURAL KEY — the same fix ADR-039/migrations 0008-0009 gave
// `incident` and `region` — and this file is the fitness function that keeps it that way.
//
// NOT NULL here, unlike 0008/0009. Those columns were retrofitted onto tables that already held rows and had
// to tolerate NULL. Four of these tables are new, so a row without a readable id can simply be forbidden;
// `shelter` is the exception, because it has rows already.
import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import type { PgTable } from 'drizzle-orm/pg-core';
import {
  damageAssessmentEntry,
  emsOverlayProduct,
  supplyLot,
  volunteerTeam,
} from './panel-tables.js';
import { shelter } from './logistics-tables.js';

/** The five panel datasets, and whether their natural key may be NULL (only the pre-existing table's may). */
const PANEL_TABLES: ReadonlyArray<readonly [string, PgTable, boolean]> = [
  ['supply_lot', supplyLot, false],
  ['volunteer_team', volunteerTeam, false],
  ['damage_assessment_entry', damageAssessmentEntry, false],
  ['ems_overlay_product', emsOverlayProduct, false],
  ['shelter (pre-existing — retrofitted key, so nullable)', shelter, true],
];

describe('every operator-editable panel table is addressable by a readable id', () => {
  it.each(PANEL_TABLES)('%s has a UNIQUE domain_id', (_name, table) => {
    const cfg = getTableConfig(table);
    const column = cfg.columns.find((c) => c.name === 'domain_id');
    expect(column, 'no domain_id column').toBeDefined();
    expect(column!.getSQLType()).toBe('text');
    const uniqueOnDomainId = cfg.uniqueConstraints.some(
      (c) => c.columns.length === 1 && c.columns[0]?.name === 'domain_id',
    );
    expect(uniqueOnDomainId, 'domain_id carries no unique constraint').toBe(true);
  });

  it.each(PANEL_TABLES)(
    '%s: domain_id nullability matches whether the table pre-existed',
    (_name, table, nullable) => {
      const column = getTableConfig(table).columns.find((c) => c.name === 'domain_id');
      expect(column!.notNull).toBe(!nullable);
    },
  );

  it.each(PANEL_TABLES.slice(0, 4))(
    '%s keeps the audit columns every BEACON table carries',
    (_name, table) => {
      const names = getTableConfig(table).columns.map((c) => c.name);
      expect(names).toContain('created_at');
      expect(names).toContain('updated_at');
      // A `DB` row's provenance `fetchedAt` IS its last edit (ADR-041 §3), so `updated_at` is not decoration:
      // it is the timestamp the panel serves as freshness. A table without it could not be labelled honestly.
    },
  );
});

describe('the panel tables enforce the same invariants the domain factories do', () => {
  const checksOf = (table: PgTable): readonly string[] =>
    getTableConfig(table).checks.map((c) => c.name);

  it('supply_lot refuses a bare quantity — the "quantity requires a unit" invariant, in the database', () => {
    expect(checksOf(supplyLot)).toContain('chk_supply_lot_quantity_requires_unit');
    expect(checksOf(supplyLot)).toContain('chk_supply_lot_quantity_nonneg');
  });

  it('volunteer_team refuses a negative headcount (a tally, never a roster)', () => {
    expect(checksOf(volunteerTeam)).toContain('chk_volunteer_team_headcount_nonneg');
  });

  it('damage_assessment_entry refuses a negative site count', () => {
    expect(checksOf(damageAssessmentEntry)).toContain('chk_damage_entry_site_count_nonneg');
  });
});
