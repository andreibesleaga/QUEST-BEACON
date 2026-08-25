// BEACON — Drizzle schema kernel (E3·T-091). CHECK-enum helper + shared column mixins.
// Adapter layer (Art. II): MAY import drizzle. Mirrors schemas/schema.sql conventions:
//   uuid PK DEFAULT gen_random_uuid(), timestamptz DEFAULT now(), enums-as-CHECK.
import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { check, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Emit a Drizzle CHECK constraint that pins a text column to an enum's allowed values —
 * the byte-faithful equivalent of `CHECK (col IN ('A','B',...))` in schemas/schema.sql.
 * We model enums as CHECK constraints (not pgEnum) per MIGRATION_PLAN §2 so the allowed
 * set lives in one place and adding a value is a cheap migration.
 */
export function checkEnum(name: string, column: AnyPgColumn, values: readonly string[]) {
  const list = sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );
  return check(name, sql`${column} IN (${list})`);
}

/** uuid PRIMARY KEY DEFAULT gen_random_uuid() — the canonical surrogate id (MIGRATION_PLAN §2). */
export const idColumn = () => uuid('id').primaryKey().defaultRandom();

/** timestamptz NOT NULL DEFAULT now() — audit-friendly creation instant. */
export const createdAtColumn = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** timestamptz NOT NULL DEFAULT now() — mutation instant (maintained by set_updated_at() trigger). */
export const updatedAtColumn = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/** A generic timestamptz column builder (nullable by default) for one-off instants. */
export const instant = (name: string) => timestamp(name, { withTimezone: true });
