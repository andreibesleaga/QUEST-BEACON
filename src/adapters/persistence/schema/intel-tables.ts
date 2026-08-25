// BEACON — Drizzle tables: intel, sources & alerting cluster (E3·T-098…T-101).
// Byte-faithful mirror of schemas/schema.sql tables 9,10,12,13,14. Adapter layer (Art. II).
import { sql } from 'drizzle-orm';
import { boolean, check, doublePrecision, index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import type { Geometry } from '@/domain/value-objects/geo.js';
// DERIVED, NEVER RETYPED — see the note in ./logistics-tables.ts. FR-D4-4's category vocabulary has exactly
// one definition (`src/domain/public-report.ts`) and the CHECK is generated from it, so the DB constraint
// cannot reject a category the domain accepts.
import { PUBLIC_REPORT_CATEGORIES } from '@/domain/public-report.js';
import { checkEnum, createdAtColumn, idColumn, instant, updatedAtColumn } from './columns';
import { appUser, incident, region, sourceRecord } from './core-tables';

// 9. PUBLIC_REPORT — consented crowdsourced SOS (lifecycle §3). geom_precise is responder-only (app layer, Art. XIV).
export const publicReport = pgTable(
  'public_report',
  {
    id: idColumn(),
    incidentId: uuid('incident_id').references(() => incident.id, { onDelete: 'set null' }),
    source: text('source').notNull(),
    // FR-D4-4 (ADR-036 §7 / G14): `source` is the CHANNEL; this is the report's KIND. Nullable — a report
    // filed before FR-D4-4 is uncategorised, which is not the same as an assumed 'SOS'.
    category: text('category'),
    // The reporter's claim — what a verifier approves/rejects (Art. XIII). Purged with the row at
    // purge_after and only ever served to VERIFIER+ (GET /reports), which is how Art. XIV is satisfied
    // here exactly as it is for geom_precise. Nullable: rows predating migration 0006 carry none.
    reportText: text('report_text'),
    status: text('status').notNull().default('UNVERIFIED'),
    // FR-D6-5 aggregate casualty tally (ADR-035 §4). ONLY the count and the observation instant are stored:
    // the mandatory "unverified — not authoritative" caveat is NOT a storable column, so there is no row
    // that can carry the number without it — `makePublicReport` stamps the caveat on every hydration
    // (read-models.ts `reportFromRow`). A label you cannot persist is a label you cannot fail to persist.
    casualtyCount: integer('casualty_count'),
    casualtyAsOf: text('casualty_as_of'),
    confidence: doublePrecision('confidence'),
    confidenceComponents: jsonb('confidence_components').$type<Record<string, number>>(),
    geomGeneralized: jsonb('geom_generalized').$type<Geometry>(),
    geomPrecise: jsonb('geom_precise').$type<Geometry>(),
    consent: boolean('consent').notNull().default(false),
    purgeAfter: instant('purge_after'),
    // Receipt instant (ISO-8601 text) stamped at intake — powers the live-view chip's ~2h TTL fade.
    receivedAt: text('received_at'),
    // Live Views v1.2 (ADR-029): the consent-gated citizen live-view link, purged with the row. Link-only.
    liveViewUrl: text('live_view_url'),
    sourceId: uuid('source_id').references(() => sourceRecord.id, { onDelete: 'set null' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    checkEnum('chk_public_report_source', t.source, ['WEB', 'SMS', 'SOCIAL']),
    checkEnum('chk_public_report_status', t.status, ['UNVERIFIED', 'TRIAGED', 'VERIFIED', 'REJECTED']),
    // `col IN (...)` passes NULL, so the nullable category column needs no extra allowance.
    checkEnum('chk_public_report_category', t.category, PUBLIC_REPORT_CATEGORIES),
    check(
      'chk_public_report_casualty_count_nonneg',
      sql`${t.casualtyCount} IS NULL OR ${t.casualtyCount} >= 0`,
    ),
    check(
      'chk_public_report_confidence',
      sql`${t.confidence} IS NULL OR (${t.confidence} >= 0 AND ${t.confidence} <= 1)`,
    ),
    // Intake invariant (EV4): a report must be consented to exist.
    check('chk_public_report_consent', sql`${t.consent} = true`),
    index('idx_public_report_incident').on(t.incidentId),
    index('idx_public_report_status').on(t.status),
    index('idx_public_report_purge').on(t.purgeAfter),
    index('idx_public_report_source').on(t.sourceId),
  ],
);

// 10. SITREP — generated cited situational report.
export const sitrep = pgTable(
  'sitrep',
  {
    id: idColumn(),
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incident.id, { onDelete: 'cascade' }),
    generatedAt: instant('generated_at').notNull().defaultNow(),
    summary: text('summary'),
    priorities: jsonb('priorities').$type<unknown[]>().notNull().default([]),
    trend: text('trend'),
    aiMode: text('ai_mode').notNull().default('deterministic-only'),
    createdAt: createdAtColumn(),
  },
  (t) => [
    checkEnum('chk_sitrep_trend', t.trend, ['ESCALATING', 'STEADY', 'DEESCALATING']),
    checkEnum('chk_sitrep_ai_mode', t.aiMode, ['cloud', 'local', 'deterministic-only']),
    index('idx_sitrep_incident').on(t.incidentId),
    index('idx_sitrep_generated').on(t.generatedAt.desc()),
  ],
);

// 12. CITATION — grounds one SITREP field to a SOURCE_RECORD (Art. XI/XII, U2).
export const citation = pgTable(
  'citation',
  {
    id: idColumn(),
    sitrepId: uuid('sitrep_id')
      .notNull()
      .references(() => sitrep.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sourceRecord.id, { onDelete: 'restrict' }),
    field: text('field').notNull(),
    claim: text('claim').notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index('idx_citation_sitrep').on(t.sitrepId),
    index('idx_citation_source').on(t.sourceId),
    index('idx_citation_field').on(t.sitrepId, t.field),
  ],
);

// 13. THRESHOLD_RULE — early-warning trigger config (defined before ALERT).
export const thresholdRule = pgTable(
  'threshold_rule',
  {
    id: idColumn(),
    target: text('target').notNull(),
    operator: text('operator').notNull(),
    value: text('value').notNull(),
    scope: uuid('scope').references(() => region.id, { onDelete: 'cascade' }),
    hysteresis: text('hysteresis'),
    cooldown: text('cooldown'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    checkEnum('chk_threshold_rule_target', t.target, ['GAUGE_CATEGORY', 'HAZARD_BUFFER', 'FORECAST_GAUGE_CATEGORY']),
    checkEnum('chk_threshold_rule_operator', t.operator, ['crosses', 'gte', 'enters']),
    index('idx_threshold_rule_scope').on(t.scope),
    index('idx_threshold_rule_target').on(t.target),
  ],
);

// 14. ALERT — CAP/EDXL alert (lifecycle §5). Art. XIII: no ACTUAL without approver.
export const alert = pgTable(
  'alert',
  {
    id: idColumn(),
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incident.id, { onDelete: 'cascade' }),
    thresholdRuleId: uuid('threshold_rule_id').references(() => thresholdRule.id, {
      onDelete: 'set null',
    }),
    capStatus: text('cap_status').notNull().default('DRAFT'),
    category: text('category').notNull(),
    severity: text('severity').notNull(),
    area: jsonb('area').$type<Geometry>(),
    edxlKind: text('edxl_kind').notNull().default('CAP'),
    sentAt: instant('sent_at'),
    approvedBy: uuid('approved_by').references(() => appUser.id, { onDelete: 'restrict' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    checkEnum('chk_alert_cap_status', t.capStatus, ['DRAFT', 'ACTUAL']),
    checkEnum('chk_alert_category', t.category, ['Fire', 'Met', 'Safety']),
    checkEnum('chk_alert_severity', t.severity, ['MINOR', 'MODERATE', 'SEVERE', 'EXTREME']),
    checkEnum('chk_alert_edxl_kind', t.edxlKind, ['CAP', 'EDXL_RM', 'EDXL_SITREP']),
    // Art. XIII / ST1 / UW5: an ACTUAL alert MUST be human-approved. DRAFT may not be.
    check('chk_alert_actual_approved', sql`${t.capStatus} <> 'ACTUAL' OR ${t.approvedBy} IS NOT NULL`),
    index('idx_alert_incident').on(t.incidentId),
    index('idx_alert_status').on(t.capStatus),
    index('idx_alert_severity').on(t.severity),
    index('idx_alert_sent').on(t.sentAt.desc()),
    index('idx_alert_approved_by').on(t.approvedBy),
  ],
);
