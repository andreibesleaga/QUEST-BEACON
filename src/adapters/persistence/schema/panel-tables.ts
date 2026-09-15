// BEACON — Drizzle tables: the OPERATOR-MAINTAINED dock-panel datasets (ADR-041; V2·A12).
// Adapter layer (Art. II). Mirrors schemas/schema.sql tables 20-23; migration 0010.
//
// WHAT THESE ARE, AND HOW THEY DIFFER FROM EVERY OTHER TABLE HERE. Nothing publishes relief-supply stock,
// volunteer-team readiness or a shelter's occupancy: there is no adapter to write, no feed to poll, and
// pretending otherwise is the F-35 dishonesty this codebase refuses. What exists instead is an emergency
// manager who KNOWS those numbers. These four tables (plus the pre-existing `shelter`, reused rather than
// duplicated) are that person's writable surface — edited in Directus, read by the five dock panels, and
// labelled `DB` on the wire: an operator-maintained record held in BEACON's own store, never a live feed.
//
// NATURAL KEYS ARE LOAD-BEARING HERE, not a nicety. These are the only rows a human edits by hand, and the
// operator opening the table in Directus must see `supply-water-1l`, not a uuid (the ADR-039 §2a argument,
// applied to the tables where it matters most). NOT NULL, unlike 0008/0009's retrofits: these tables are
// new, so a row with no readable id is simply forbidden rather than tolerated.
//
// THE CHECKS ARE THE DOMAIN'S OWN INVARIANTS, DERIVED. Every closed vocabulary below is the domain constant
// itself handed to `checkEnum` (the F-171 discipline logistics-tables.ts established) and the numeric
// constraints restate what `makeSupplyFields` / `makeVolunteerTeamFields` / `makeDamageAssessmentEntry`
// enforce. Belt and braces on purpose: the adapter re-runs those factories on every read, so a bad row is
// refused twice — but a database an operator types into directly deserves to refuse it the first time.
import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { SUPPLY_UNITS } from '@/application/aggregate/supplies.js';
import { TEAM_AVAILABILITY } from '@/application/aggregate/volunteer-team.js';
import {
  DAMAGE_REPORT_CATEGORIES,
  DAMAGE_SEVERITIES,
  NEED_KINDS,
} from '@/domain/damage-assessment.js';
import { OVERLAY_PRODUCT_TYPES } from '@/domain/damage-overlay.js';
import { PUBLIC_REPORT_STATUSES } from '@/domain/public-report.js';
import { checkEnum, createdAtColumn, idColumn, instant, updatedAtColumn } from './columns';
import { region } from './core-tables';

/**
 * The optional region scope every panel dataset carries.
 *
 * STATED PLAINLY SO IT IS NOT MISREAD: the five panel ROUTES take no region parameter (the API shapes are
 * frozen for V2, plan §0·8), so the adapter serves EVERY row regardless of this column. It exists because
 * the rows are curated per region by the people who own them — an EM filters on it in Directus, and a
 * region-scoped read later needs no migration. It is deliberately NULLABLE: a supply lot held centrally
 * belongs to no single region, and forcing one would be inventing a fact.
 */
const regionScope = () => uuid('region_id').references(() => region.id, { onDelete: 'cascade' });

// 20. SUPPLY_LOT — relief supply stock (FR-D6-2). STOCK ONLY: no donor, no payment, no recipient — those
// keys are in PERSON_IDENTIFYING_KEYS and adding one here would fail the Layer B/C guards as well.
export const supplyLot = pgTable(
  'supply_lot',
  {
    id: idColumn(),
    domainId: text('domain_id').notNull(),
    regionId: regionScope(),
    quantity: integer('quantity'),
    unit: text('unit'),
    expiresAt: instant('expires_at'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    checkEnum('chk_supply_lot_unit', t.unit, SUPPLY_UNITS),
    check('chk_supply_lot_quantity_nonneg', sql`${t.quantity} IS NULL OR ${t.quantity} >= 0`),
    // `makeSupplyFields` refuses a quantity with no unit — a bare number is not a comparable stock figure.
    // The same rule in SQL, because this is a table a human types into.
    check(
      'chk_supply_lot_quantity_requires_unit',
      sql`${t.quantity} IS NULL OR ${t.unit} IS NOT NULL`,
    ),
    unique('uq_supply_lot_domain_id').on(t.domainId),
    index('idx_supply_lot_region').on(t.regionId),
    index('idx_supply_lot_expires').on(t.expiresAt),
  ],
);

// 21. VOLUNTEER_TEAM — volunteer team UNITS (FR-D6-1). A callsign, a tally and capability tags: never a
// roster, never a member, never a contact (Art. XIV / ADR-035 §4).
export const volunteerTeam = pgTable(
  'volunteer_team',
  {
    id: idColumn(),
    domainId: text('domain_id').notNull(),
    regionId: regionScope(),
    callsign: text('callsign'),
    headcount: integer('headcount'),
    skills: jsonb('skills').$type<string[]>().notNull().default([]),
    availability: text('availability'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    checkEnum('chk_volunteer_team_availability', t.availability, TEAM_AVAILABILITY),
    check(
      'chk_volunteer_team_headcount_nonneg',
      sql`${t.headcount} IS NULL OR ${t.headcount} >= 0`,
    ),
    unique('uq_volunteer_team_domain_id').on(t.domainId),
    index('idx_volunteer_team_region').on(t.regionId),
    index('idx_volunteer_team_availability').on(t.availability),
  ],
);

// 22. DAMAGE_ASSESSMENT_ENTRY — one damage/needs observation and the TRIAGE STATE it was seen in (FR-D4-4).
// The triage state travels WITH the row for the reason the module keeps the buckets separate: a verified
// figure and an unverified one must never be summed into a single number (Art. XIII).
export const damageAssessmentEntry = pgTable(
  'damage_assessment_entry',
  {
    id: idColumn(),
    // The report id IS the readable key an operator recognises (`rep-001`) — the same one the triage queue
    // shows — so it is the natural key rather than a second, invented one.
    domainId: text('domain_id').notNull(),
    // TEXT, NOT A UUID FK, and this is deliberate. Under `FEATURE_STORE=postgres` the incident COP is still
    // derived per-read IN MEMORY (build-core.ts `resolveStore`), so a live incident frequently has NO row in
    // `incident` at all. A FK would reject exactly the rows the product legitimately has, and the assessment
    // this feeds is keyed by the DOMAIN incident id in any case (`assessDamage({ incidentId })`).
    incidentDomainId: text('incident_domain_id').notNull(),
    reportStatus: text('report_status').notNull(),
    category: text('category').notNull(),
    severity: text('severity'),
    needKind: text('need_kind'),
    siteCount: integer('site_count'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    checkEnum('chk_damage_entry_report_status', t.reportStatus, PUBLIC_REPORT_STATUSES),
    checkEnum('chk_damage_entry_category', t.category, DAMAGE_REPORT_CATEGORIES),
    checkEnum('chk_damage_entry_severity', t.severity, DAMAGE_SEVERITIES),
    checkEnum('chk_damage_entry_need_kind', t.needKind, NEED_KINDS),
    check('chk_damage_entry_site_count_nonneg', sql`${t.siteCount} IS NULL OR ${t.siteCount} >= 0`),
    unique('uq_damage_entry_domain_id').on(t.domainId),
    index('idx_damage_entry_incident').on(t.incidentDomainId),
    index('idx_damage_entry_status').on(t.reportStatus),
  ],
);

// 23. EMS_OVERLAY_PRODUCT — published Copernicus EMS rapid-mapping products, LINK-ONLY (FR-D4-5, FEV-24).
// Every column is either attribution or a link: BEACON never mirrors, re-hosts or dereferences the product.
export const emsOverlayProduct = pgTable(
  'ems_overlay_product',
  {
    id: idColumn(),
    // The publisher's own product id (`EMSR773_AOI01_DEL_PRODUCT_r1`) — a natural key that already exists in
    // the outside world, so BEACON does not mint a competing one.
    domainId: text('domain_id').notNull(),
    regionId: regionScope(),
    activationCode: text('activation_code').notNull(),
    productType: text('product_type').notNull(),
    areaOfInterest: text('area_of_interest').notNull(),
    producedAt: instant('produced_at').notNull(),
    provider: text('provider').notNull(),
    // NOT NULL on purpose: an overlay whose licence nobody recorded may not be shown at all (Art. XI).
    licence: text('licence').notNull(),
    viewUrl: text('view_url').notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    checkEnum('chk_ems_product_type', t.productType, OVERLAY_PRODUCT_TYPES),
    unique('uq_ems_product_domain_id').on(t.domainId),
    index('idx_ems_product_region').on(t.regionId),
    index('idx_ems_product_produced').on(t.producedAt.desc()),
  ],
);
