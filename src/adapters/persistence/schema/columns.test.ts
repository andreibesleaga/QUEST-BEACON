// BEACON — unit tests for the Drizzle schema kernel (E3·T-091). Verifies the CHECK-enum helper
// emits `col IN (...)` and the shared column mixins produce the expected Postgres column shapes.
import { describe, expect, it } from 'vitest';
import { getTableConfig, PgDialect, pgTable, text } from 'drizzle-orm/pg-core';
import { checkEnum, createdAtColumn, idColumn, updatedAtColumn } from './columns.js';

// A throwaway table exercising every helper. getTableConfig exposes the compiled columns + checks.
const probe = pgTable('probe', {
  id: idColumn(),
  status: text('status').notNull(),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

describe('column mixins', () => {
  const cfg = getTableConfig(probe);
  const byName = (name: string) => cfg.columns.find((c) => c.name === name);

  it('idColumn is a uuid primary key with a default', () => {
    const id = byName('id');
    expect(id?.primary).toBe(true);
    expect(id?.getSQLType()).toBe('uuid');
    expect(id?.hasDefault).toBe(true);
  });

  it('created_at / updated_at are NOT NULL timestamptz with defaults', () => {
    for (const name of ['created_at', 'updated_at']) {
      const col = byName(name);
      expect(col?.notNull).toBe(true);
      expect(col?.getSQLType()).toBe('timestamp with time zone');
      expect(col?.hasDefault).toBe(true);
    }
  });
});

describe('checkEnum', () => {
  it('emits a named CHECK constraint containing every allowed value', () => {
    const values = ['ALPHA', 'BETA', 'GAMMA'] as const;
    const table = pgTable(
      'enum_probe',
      { mode: text('mode').notNull() },
      (t) => [checkEnum('chk_enum_probe_mode', t.mode, values)],
    );
    const cfg = getTableConfig(table);
    expect(cfg.checks).toHaveLength(1);
    const constraint = cfg.checks[0];
    expect(constraint?.name).toBe('chk_enum_probe_mode');
    // Render the CHECK's SQL via the real Postgres dialect: `"mode" in ($1, $2, $3)` + bound params.
    const query = new PgDialect().sqlToQuery(constraint!.value);
    expect(query.sql.toLowerCase()).toContain('in (');
    expect(query.sql).toContain('"mode"');
    for (const v of values) expect(query.params).toContain(v);
  });
});
