// BEACON — Drizzle tables: logistics, identity & audit cluster (E3·T-102…T-104).
// Byte-faithful mirror of schemas/schema.sql tables 15,16,17,18,19. Adapter layer (Art. II).
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import type { Geometry } from '@/domain/value-objects/geo.js';
// DERIVED, NEVER RETYPED. These CHECK constraints used to carry a hand-written second copy of each domain
// enum ('CREW','ENGINE',… beside RESOURCE_KINDS). That is precisely the F-24/F-140/F-141/F-192 defect class
// — two declarations of one contract, drifting silently while `tsc` stays at 0 — and it is what let FR-D6-1's
// new 'TEAM' kind be added to the domain union while the DB constraint would still have rejected the row.
// The adapter layer MAY import the domain (Art. II / .dependency-cruiser.cjs `domain-is-pure` is one-way), so
// the constants themselves are handed to `checkEnum`: there is no second array left to fall out of sync, and
// widening a domain enum now regenerates the constraint by construction rather than by remembering to.
import { RESOURCE_KINDS, RESOURCE_STATUSES } from '@/domain/resource.js';
import { RESOURCE_TASK_STATUSES } from '@/domain/resource-task.js';
import { SHELTER_STATUSES } from '@/domain/shelter.js';
import { MODEL_TIERS } from '@/domain/audit-event.js';
import { checkEnum, createdAtColumn, idColumn, instant, updatedAtColumn } from './columns';
import { appUser, incident } from './core-tables';

// 15. RESOURCE — responder asset registry (defined before RESOURCE_TASK).
export const resource = pgTable(
  'resource',
  {
    id: idColumn(),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('AVAILABLE'),
    geom: jsonb('geom').$type<Geometry>(),
    org: text('org'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    checkEnum('chk_resource_kind', t.kind, RESOURCE_KINDS),
    checkEnum('chk_resource_status', t.status, RESOURCE_STATUSES),
    index('idx_resource_kind').on(t.kind),
    index('idx_resource_status').on(t.status),
  ],
);

// 16. SHELTER — agency-seeded shelter w/ capacity vs occupancy.
export const shelter = pgTable(
  'shelter',
  {
    id: idColumn(),
    geom: jsonb('geom').$type<Geometry>().notNull(),
    capacity: integer('capacity'),
    occupancy: integer('occupancy').notNull().default(0),
    status: text('status').notNull().default('OPEN'),
    org: text('org'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    checkEnum('chk_shelter_status', t.status, SHELTER_STATUSES),
    check('chk_shelter_capacity_nonneg', sql`${t.capacity} IS NULL OR ${t.capacity} >= 0`),
    check('chk_shelter_occupancy_nonneg', sql`${t.occupancy} >= 0`),
    check(
      'chk_shelter_occupancy_le_capacity',
      sql`${t.capacity} IS NULL OR ${t.occupancy} <= ${t.capacity}`,
    ),
    index('idx_shelter_status').on(t.status),
  ],
);

// 17. RESOURCE_TASK — tasking lifecycle (PROPOSED->...->CLEARED, EV9).
export const resourceTask = pgTable(
  'resource_task',
  {
    id: idColumn(),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resource.id, { onDelete: 'cascade' }),
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incident.id, { onDelete: 'cascade' }),
    shelterId: uuid('shelter_id').references(() => shelter.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('PROPOSED'),
    target: jsonb('target').$type<Geometry>(),
    edxlRmRef: text('edxl_rm_ref'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    // F-24 was this exact machine: the UI said ASSIGNED/EN_ROUTE/ON_SCENE while the domain said
    // TASKED/ENROUTE/ONSCENE. The DB copy is the third surface that could disagree — now it cannot.
    checkEnum('chk_resource_task_status', t.status, RESOURCE_TASK_STATUSES),
    index('idx_restask_resource').on(t.resourceId),
    index('idx_restask_incident').on(t.incidentId),
    index('idx_restask_shelter').on(t.shelterId),
    index('idx_restask_status').on(t.status),
    index('idx_restask_edxlref').on(t.edxlRmRef),
  ],
);

// 18. EVAC_ROUTE — hazard-avoiding evacuation route (EV7).
export const evacRoute = pgTable(
  'evac_route',
  {
    id: idColumn(),
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incident.id, { onDelete: 'cascade' }),
    geom: jsonb('geom').$type<Geometry>().notNull(),
    avoidsHazard: boolean('avoids_hazard').notNull().default(true),
    suggestedStart: instant('suggested_start'),
    createdAt: createdAtColumn(),
  },
  (t) => [index('idx_evacroute_incident').on(t.incidentId)],
);

// 19. AUDIT_EVENT — append-only audit trail w/ cost attribution + tamper-evident hash chain (ADR-022/D-27).
export const auditEvent = pgTable(
  'audit_event',
  {
    id: idColumn(),
    actorId: uuid('actor_id').references(() => appUser.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    target: text('target').notNull(),
    at: instant('at').notNull().defaultNow(),
    costTokensIn: integer('cost_tokens_in'),
    costTokensOut: integer('cost_tokens_out'),
    costUsd: numeric('cost_usd'),
    modelTier: text('model_tier'),
    prevHash: text('prev_hash'),
    hash: text('hash'),
    createdAt: createdAtColumn(),
  },
  (t) => [
    // model_tier is nullable; checkEnum's `col IN (...)` passes NULL (only set on AI/adapter events).
    checkEnum('chk_audit_event_model_tier', t.modelTier, MODEL_TIERS),
    index('idx_audit_actor').on(t.actorId),
    index('idx_audit_at').on(t.at.desc()),
    index('idx_audit_target').on(t.target),
  ],
);
