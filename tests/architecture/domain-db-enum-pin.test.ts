// BEACON — structural fitness function: THE DOMAIN ENUM AND ITS DATABASE CONSTRAINT CANNOT DRIFT.
// (F-171 / FR-D6-1; the F-24 · F-140 · F-141 · F-192 defect class.)
//
// Five defects in this codebase were one root cause: a contract RE-DECLARED instead of DERIVED. `RESOURCE_KINDS`
// was one of those re-declarations — the same five tokens were typed out in `src/domain/resource.ts`, again in
// the Drizzle CHECK in `src/adapters/persistence/schema/logistics-tables.ts`, again in the reference DDL
// `schemas/schema.sql`, and again in the applied migration. Adding FR-D6-1's `'TEAM'` to only the first of those
// yields a domain that accepts a volunteer team and a database that rejects the INSERT, with `tsc` at zero.
//
// THE FIX IS STRUCTURAL WHERE IT CAN BE AND TESTED WHERE IT CANNOT.
//   • TypeScript: `logistics-tables.ts` / `intel-tables.ts` now hand the DOMAIN CONSTANT to `checkEnum`. There is
//     no second array left to fall out of sync — drift is not detected there, it is impossible. Arm 1 below
//     proves the wiring is real (a constant imported but not used would still leave the old literals behind).
//   • SQL: `schemas/schema.sql` and `drizzle/*.sql` are not importable TypeScript, so they are the copies that
//     CAN still drift — and they are the ones a deployed database is actually built from. Arms 2 and 3 pin them.
//
// Arm 3 is the one that matters operationally: the reference DDL can be perfectly correct while the migration
// that a live database will actually replay was never written. It reads the migrations in journal order and
// checks the LAST state each constraint is left in, which is the state a migrated database ends up in.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import type { PgTable } from 'drizzle-orm/pg-core';

import { RESOURCE_KINDS, RESOURCE_STATUSES } from '@/domain/resource.js';
import { RESOURCE_TASK_STATUSES } from '@/domain/resource-task.js';
import { SHELTER_STATUSES } from '@/domain/shelter.js';
import { MODEL_TIERS } from '@/domain/audit-event.js';
import { PUBLIC_REPORT_CATEGORIES } from '@/domain/public-report.js';
import { SERVED_MODES } from '@/domain/source-record.js';
import { PUBLIC_REPORT_STATUSES } from '@/domain/public-report.js';
import { DAMAGE_SEVERITIES, NEED_KINDS } from '@/domain/damage-assessment.js';
import { OVERLAY_PRODUCT_TYPES } from '@/domain/damage-overlay.js';
import { SUPPLY_UNITS } from '@/application/aggregate/supplies.js';
import { TEAM_AVAILABILITY } from '@/application/aggregate/volunteer-team.js';
import {
  resource,
  resourceTask,
  shelter,
  auditEvent,
} from '@/adapters/persistence/schema/logistics-tables.js';
import { publicReport } from '@/adapters/persistence/schema/intel-tables.js';
import { sourceRecord } from '@/adapters/persistence/schema/core-tables.js';
import {
  damageAssessmentEntry,
  emsOverlayProduct,
  supplyLot,
  volunteerTeam,
} from '@/adapters/persistence/schema/panel-tables.js';

const REPO = process.cwd();

/**
 * Drop `-- …` line comments before any parsing. Not cosmetic: BEACON's DDL is heavily commented in prose, and
 * prose contains apostrophes ("its predecessor's hash"), which a quote-aware paren scanner would read as the
 * start of a string literal and then mis-balance the whole file. A `--` inside a string literal is left alone
 * (odd number of quotes before it on the line).
 */
function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => {
      let quotes = 0;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === "'") quotes++;
        else if (line[i] === '-' && line[i + 1] === '-' && quotes % 2 === 0)
          return line.slice(0, i);
      }
      return line;
    })
    .join('\n');
}

const REFERENCE_DDL = stripSqlComments(readFileSync(resolve(REPO, 'schemas/schema.sql'), 'utf8'));

interface Journal {
  readonly entries: readonly { readonly idx: number; readonly tag: string }[];
}
const JOURNAL: Journal = JSON.parse(
  readFileSync(resolve(REPO, 'drizzle/meta/_journal.json'), 'utf8'),
) as Journal;

/** Every migration body, in the order a database replays them (journal `idx`, not directory order). */
const MIGRATIONS: readonly { readonly tag: string; readonly sql: string }[] = [...JOURNAL.entries]
  .sort((a, b) => a.idx - b.idx)
  .map((e) => ({
    tag: e.tag,
    sql: stripSqlComments(readFileSync(resolve(REPO, `drizzle/${e.tag}.sql`), 'utf8')),
  }));

/** The quoted string literals inside an `IN ( … )` list, in order. */
function inListValues(clause: string): readonly string[] {
  return [...clause.matchAll(/'([^']*)'/g)].map((m) => m[1] as string);
}

/** The body of `CREATE TABLE <name> ( … )`. Scoping matters: `kind` and `status` are reused across tables, so
 *  an unscoped regex over the whole DDL silently matches the wrong table and passes for the wrong reason. */
function createTableBody(ddl: string, table: string): string {
  const m = new RegExp(`CREATE TABLE\\s+"?${table}"?\\s*\\(`, 'i').exec(ddl);
  expect(m, `schemas/schema.sql has no CREATE TABLE ${table}`).not.toBeNull();
  return balancedFrom(ddl, m!.index + m![0].length - 1);
}

/** The text between the parenthesis at `openIndex` and its matching close (single-quote aware). */
function balancedFrom(text: string, openIndex: number): string {
  let depth = 0;
  let inQuote = false;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'") inQuote = !inQuote;
    if (inQuote) continue;
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return text.slice(openIndex + 1, i);
    }
  }
  throw new Error('unbalanced parentheses in SQL');
}

/**
 * The allowed values a Drizzle CHECK constraint actually renders. Read from the COMPILED SQL + its bound
 * parameters, never from the source text: this is what the database would be given, so it proves the domain
 * constant is genuinely wired to that column rather than merely imported into the file.
 */
function drizzleCheckValues(table: PgTable, constraintName: string): readonly string[] {
  const found = getTableConfig(table).checks.find((c) => c.name === constraintName);
  expect(found, `no CHECK named ${constraintName} on the Drizzle table`).toBeDefined();
  const query = new PgDialect().sqlToQuery(found!.value);
  expect(query.sql, `${constraintName} is not an IN-list CHECK`).toMatch(/ IN \(/);
  return query.params as readonly string[];
}

/** The values the reference DDL allows for `<table>.<column>` — scoped to that table's CREATE TABLE body. */
function referenceDdlValues(table: string, column: string): readonly string[] {
  const body = createTableBody(REFERENCE_DDL, table);
  const m = new RegExp(`\\b${column}\\s+IN\\s*\\(`, 'i').exec(body);
  expect(m, `schemas/schema.sql: ${table} has no "${column} IN (…)" CHECK`).not.toBeNull();
  return inListValues(balancedFrom(body, m!.index + m![0].length - 1));
}

/**
 * The values a constraint is left allowing after replaying every migration in journal order. Matches BOTH
 * forms a Drizzle migration uses: the inline `CONSTRAINT "x" CHECK (…)` inside 0000's CREATE TABLE, and the
 * later `ALTER TABLE … ADD CONSTRAINT "x" CHECK (…)`. `undefined` means no migration ever created it — which
 * for a constraint the domain relies on is itself the failure, so callers assert on it rather than skipping.
 */
function migratedValues(constraintName: string): readonly string[] | undefined {
  let latest: readonly string[] | undefined;
  const re = new RegExp(`CONSTRAINT "${constraintName}" CHECK \\(`, 'g');
  for (const { sql } of MIGRATIONS) {
    for (const m of sql.matchAll(re)) {
      const body = balancedFrom(sql, m.index + m[0].length - 1);
      if (/ IN \(/.test(body)) latest = inListValues(body);
    }
  }
  return latest;
}

/** First value found under `key` anywhere in a JSON document (breadth-first, deterministic order). */
function findKey(node: unknown, key: string): unknown {
  if (node === null || typeof node !== 'object') return undefined;
  const queue: unknown[] = [node];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === null || typeof current !== 'object') continue;
    const record = current as Record<string, unknown>;
    if (key in record) return record[key];
    for (const value of Object.values(record)) queue.push(value);
  }
  return undefined;
}

interface PinnedEnum {
  readonly what: string;
  readonly domain: readonly string[];
  readonly table: PgTable;
  readonly constraint: string;
  /** The table and column as they are spelled in `schemas/schema.sql`. */
  readonly ddlTable: string;
  readonly ddlColumn: string;
}

// Every closed vocabulary the DOMAIN owns that a DATABASE CONSTRAINT also enforces. A new one belongs here.
const PINNED: readonly PinnedEnum[] = [
  {
    what: 'RESOURCE_KINDS (FR-D6-1 added TEAM)',
    domain: RESOURCE_KINDS,
    table: resource,
    constraint: 'chk_resource_kind',
    ddlTable: 'resource',
    ddlColumn: 'kind',
  },
  {
    what: 'RESOURCE_STATUSES',
    domain: RESOURCE_STATUSES,
    table: resource,
    constraint: 'chk_resource_status',
    ddlTable: 'resource',
    ddlColumn: 'status',
  },
  {
    what: 'RESOURCE_TASK_STATUSES (the F-24 machine)',
    domain: RESOURCE_TASK_STATUSES,
    table: resourceTask,
    constraint: 'chk_resource_task_status',
    ddlTable: 'resource_task',
    ddlColumn: 'status',
  },
  {
    what: 'SHELTER_STATUSES',
    domain: SHELTER_STATUSES,
    table: shelter,
    constraint: 'chk_shelter_status',
    ddlTable: 'shelter',
    ddlColumn: 'status',
  },
  {
    what: 'MODEL_TIERS',
    domain: MODEL_TIERS,
    table: auditEvent,
    constraint: 'chk_audit_event_model_tier',
    ddlTable: 'audit_event',
    ddlColumn: 'model_tier',
  },
  {
    what: 'PUBLIC_REPORT_CATEGORIES (FR-D4-4)',
    domain: PUBLIC_REPORT_CATEGORIES,
    table: publicReport,
    constraint: 'chk_public_report_category',
    ddlTable: 'public_report',
    ddlColumn: 'category',
  },
  // ADR-041 §3 / migration 0010 — the SERVED vocabulary, not the three-rung ladder: this column records
  // what actually served a source, and `ProvenanceEntry.mode` (its only writer) can now say `DB`.
  {
    what: 'SERVED_MODES (ADR-041 — DB is a served mode, not a ladder rung)',
    domain: SERVED_MODES,
    table: sourceRecord,
    constraint: 'chk_source_record_mode',
    ddlTable: 'source_record',
    ddlColumn: 'mode',
  },
  // ADR-041 / migration 0010 — the operator-maintained panel tables. These matter MORE than the rest:
  // they are the only tables a human types into by hand, so a domain/DB split here is not a failed
  // INSERT in a background job, it is an emergency manager's edit silently rejected mid-incident.
  {
    what: 'SUPPLY_UNITS (FR-D6-2)',
    domain: SUPPLY_UNITS,
    table: supplyLot,
    constraint: 'chk_supply_lot_unit',
    ddlTable: 'supply_lot',
    ddlColumn: 'unit',
  },
  {
    what: 'TEAM_AVAILABILITY (FR-D6-1)',
    domain: TEAM_AVAILABILITY,
    table: volunteerTeam,
    constraint: 'chk_volunteer_team_availability',
    ddlTable: 'volunteer_team',
    ddlColumn: 'availability',
  },
  {
    what: 'PUBLIC_REPORT_STATUSES (the triage split that must never be summed)',
    domain: PUBLIC_REPORT_STATUSES,
    table: damageAssessmentEntry,
    constraint: 'chk_damage_entry_report_status',
    ddlTable: 'damage_assessment_entry',
    ddlColumn: 'report_status',
  },
  {
    what: 'PUBLIC_REPORT_CATEGORIES on the damage entry (FR-D4-4)',
    domain: PUBLIC_REPORT_CATEGORIES,
    table: damageAssessmentEntry,
    constraint: 'chk_damage_entry_category',
    ddlTable: 'damage_assessment_entry',
    ddlColumn: 'category',
  },
  {
    what: 'DAMAGE_SEVERITIES (FR-D4-4)',
    domain: DAMAGE_SEVERITIES,
    table: damageAssessmentEntry,
    constraint: 'chk_damage_entry_severity',
    ddlTable: 'damage_assessment_entry',
    ddlColumn: 'severity',
  },
  {
    what: 'NEED_KINDS (FR-D4-4)',
    domain: NEED_KINDS,
    table: damageAssessmentEntry,
    constraint: 'chk_damage_entry_need_kind',
    ddlTable: 'damage_assessment_entry',
    ddlColumn: 'need_kind',
  },
  {
    what: 'OVERLAY_PRODUCT_TYPES (FR-D4-5)',
    domain: OVERLAY_PRODUCT_TYPES,
    table: emsOverlayProduct,
    constraint: 'chk_ems_product_type',
    ddlTable: 'ems_overlay_product',
    ddlColumn: 'product_type',
  },
];

describe('domain enum ↔ DB CHECK constraint (F-171; the F-24 defect class)', () => {
  it.each(PINNED.map((p) => [p.what, p] as const))(
    'arm 1 — %s: the Drizzle CHECK renders EXACTLY the domain constant (derivation is wired, not merely imported)',
    (_what, pin) => {
      expect(drizzleCheckValues(pin.table, pin.constraint)).toEqual([...pin.domain]);
    },
  );

  it.each(PINNED.map((p) => [p.what, p] as const))(
    'arm 2 — %s: the reference DDL schemas/schema.sql allows EXACTLY the domain constant',
    (_what, pin) => {
      expect(referenceDdlValues(pin.ddlTable, pin.ddlColumn)).toEqual([...pin.domain]);
    },
  );

  it.each(PINNED.map((p) => [p.what, p] as const))(
    'arm 3 — %s: replaying drizzle/*.sql leaves the constraint allowing EXACTLY the domain constant',
    (_what, pin) => {
      const applied = migratedValues(pin.constraint);
      expect(
        applied,
        `no migration in drizzle/ ever creates ${pin.constraint} — a migrated database would not enforce it`,
      ).toBeDefined();
      expect(applied).toEqual([...pin.domain]);
    },
  );

  it('arm 4 — the JSON-Schema mirrors of RESOURCE_KINDS agree with the domain (schemas/eap.schema.json)', () => {
    // A THIRD kind of mirror, found while widening RESOURCE_KINDS: `schemas/eap.schema.json` re-types the
    // vocabulary twice (`$defs.resourceKind.enum` and the `maxByKind` property keys), and `early-action-
    // protocol.ts` validates the SAME field against the domain constant. Left un-pinned, an EAP naming a
    // 'TEAM' would pass the domain factory and fail `eap-config.schema.test.ts` — a domain/schema split of
    // the identical F-24 defect. JSON Schema cannot import a TS constant, so it is pinned here instead.
    const eap = JSON.parse(
      readFileSync(resolve(REPO, 'schemas/eap.schema.json'), 'utf8'),
    ) as Record<string, unknown>;
    // Found by WALK, not by a hard-coded JSON pointer: a schema reshuffle must not silently skip this check.
    const maxByKind = findKey(eap, 'maxByKind') as
      { properties: Record<string, unknown> } | undefined;
    const resourceKind = findKey(eap, 'resourceKind') as { enum?: string[] } | undefined;
    expect(
      resourceKind?.enum,
      'schemas/eap.schema.json has no $defs.resourceKind enum',
    ).toBeDefined();
    expect(
      maxByKind?.properties,
      'schemas/eap.schema.json has no resourceCeiling.maxByKind',
    ).toBeDefined();
    expect(resourceKind?.enum).toEqual([...RESOURCE_KINDS]);
    expect(Object.keys(maxByKind!.properties).sort()).toEqual([...RESOURCE_KINDS].sort());
  });

  it('the reference DDL is not accidentally matching a DIFFERENT table (sanity on arm 2s regexes)', () => {
    // `status`/`kind` are reused across tables, so arm 2 is only meaningful if each lookup lands on the
    // constraint it claims. Anchor two of them explicitly.
    expect(REFERENCE_DDL).toContain(
      "CHECK (kind IN ('CREW','ENGINE','AIRCRAFT','MEDICAL','SUPPLY','TEAM'))",
    );
    expect(REFERENCE_DDL).toContain("CHECK (category IN ('SOS','DAMAGE','NEED'))");
  });
});
