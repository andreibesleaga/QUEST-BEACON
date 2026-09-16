// BEACON — operator-maintained reference data loader (ADR-041). Reads config/reference-data.json → rows for
// the four DOCK-PANEL tables, each one first passed through the REAL domain/application factory that guards
// it, exactly as `shelter-registry.ts` does for shelters. Adapter layer (Art. II): config in, rows out.
//
// WHY THIS EXISTS. `panels.ts` serves a DB → FIXTURE ladder: when `supply_lot`, `volunteer_team`,
// `damage_assessment_entry` or `ems_overlay_product` holds no rows, the panel falls back to its built-in
// fixture and labels itself degraded. Nothing in the codebase has ever written those four tables — they are
// maintained by an emergency manager in Directus (ADR-041) — so on every deployment ever made, all four were
// empty and all four panels served the identical fixture in every region. That is the "SitRep and Logistics
// are always the same and never match the region" report, and it is working as designed with nothing in the
// designed-for store.
//
// This file gives the store a starting state. It does NOT make the panels live: two of these datasets have
// no public upstream and cannot have one (see `_provenance` in the config — nobody publishes a county's
// pallet count), so the honest posture is a labelled operator starting set the EM corrects in place.
//
// THE FACTORIES RUN AT LOAD, NOT AT INSERT. A supply lot with a quantity and no unit, a callsign that looks
// like a person's name, a NEED entry carrying a damage severity — each fails here, before any row reaches
// the database, with the invariant named. This is the same bar an EM's own Directus edit is held to when it
// is read back (`panel-data.ts` → the same factories), so the seeded rung is not a laxer path into the
// store than the operator rung.
import { readFileSync } from 'node:fs';
import { makeSupplyFields } from '@/application/aggregate/supplies.js';
import { makeVolunteerTeamFields } from '@/application/aggregate/volunteer-team.js';
import { makeDamageAssessmentEntry } from '@/domain/damage-assessment.js';
import { makeIncident } from '@/domain/incident.js';
import { makeResource } from '@/domain/resource.js';
import { makeResourceTask } from '@/domain/resource-task.js';
import { makePublicReport } from '@/domain/public-report.js';
import { makeThresholdRule } from '@/domain/threshold-rule.js';
import { asId } from '@/domain/value-objects/ids.js';
import { makeDamageOverlayProduct } from '@/domain/damage-overlay.js';
import type { DamageReportCategory, DamageSeverity, NeedKind } from '@/domain/damage-assessment.js';
import type { OverlayProductType } from '@/domain/damage-overlay.js';
import type {
  PublicReportCategory,
  PublicReportSource,
  PublicReportStatus,
} from '@/domain/public-report.js';
import type { IncidentStatus, IncidentType } from '@/domain/incident.js';
import type { ResourceKind, ResourceStatus } from '@/domain/resource.js';
import type { ResourceTaskStatus } from '@/domain/resource-task.js';
import type { ThresholdOperator, ThresholdTarget } from '@/domain/threshold-rule.js';
import type {
  IncidentId,
  PublicReportId,
  RegionId,
  ResourceId,
  ResourceTaskId,
  ThresholdRuleId,
} from '@/domain/value-objects/ids.js';
import type { SupplyUnit } from '@/application/aggregate/supplies.js';
import type { TeamAvailability } from '@/application/aggregate/volunteer-team.js';
import type { Result } from '@/domain/shared/result.js';
import { err, ok } from '@/domain/shared/result.js';
import { DomainError } from '@/domain/errors.js';

/** Where the document lives. CWD-relative — the same posture as every other config reader here. */
const REFERENCE_DATA_PATH = 'config/reference-data.json';

export interface ReferenceSupplyLot {
  readonly domainId: string;
  readonly regionConfigId: string;
  readonly quantity: number;
  readonly unit: SupplyUnit;
  readonly expiresAt?: Date;
}

export interface ReferenceVolunteerTeam {
  readonly domainId: string;
  readonly regionConfigId: string;
  readonly callsign: string;
  readonly headcount: number;
  readonly skills: readonly string[];
  readonly availability: TeamAvailability;
}

export interface ReferenceDamageEntry {
  readonly domainId: string;
  readonly incidentDomainId: string;
  readonly reportStatus: PublicReportStatus;
  readonly category: DamageReportCategory;
  readonly severity?: DamageSeverity;
  readonly needKind?: NeedKind;
  readonly siteCount?: number;
}

export interface ReferenceEmsProduct {
  readonly domainId: string;
  readonly regionConfigId: string;
  readonly activationCode: string;
  readonly productType: OverlayProductType;
  readonly areaOfInterest: string;
  readonly producedAt: Date;
  readonly provider: string;
  readonly licence: string;
  readonly viewUrl: string;
}

/**
 * A demo incident, as a ROW.
 *
 * The `incident` table was empty on every deployment ever made, and nothing in the codebase wrote it. That
 * is not a cosmetic gap: `resolveIncidentRowId` translates a domain id (`us-ca-wildfire-demo`) to the
 * surrogate uuid every FK uses, and with no row it returns null — so `evac-route-store` and every other
 * incident-keyed store silently discarded what it was asked to persist. No error, no log, just writes that
 * went nowhere. Seeding these rows is what makes the incident-keyed half of the database work at all.
 */
export interface ReferenceIncident {
  readonly domainId: string;
  readonly regionConfigId: string;
  readonly type: IncidentType;
  readonly status: IncidentStatus;
}

export interface ReferenceResource {
  readonly domainId: string;
  readonly regionConfigId: string;
  readonly kind: ResourceKind;
  readonly status: ResourceStatus;
  readonly org?: string;
  readonly lon?: number;
  readonly lat?: number;
}

export interface ReferenceResourceTask {
  readonly domainId: string;
  readonly resourceDomainId: string;
  readonly incidentDomainId: string;
  readonly status: ResourceTaskStatus;
}

export interface ReferencePublicReport {
  readonly domainId: string;
  readonly incidentDomainId: string;
  readonly source: PublicReportSource;
  readonly category: PublicReportCategory;
  readonly status: PublicReportStatus;
  readonly text: string;
  readonly confidence?: number;
  readonly lon?: number;
  readonly lat?: number;
  readonly purgeAfter: Date;
  readonly receivedAt?: Date;
}

export interface ReferenceThresholdRule {
  readonly domainId: string;
  readonly regionConfigId: string;
  readonly target: ThresholdTarget;
  readonly operator: ThresholdOperator;
  readonly value: string;
  readonly hysteresis?: number;
  readonly cooldown?: number;
}

export interface ReferenceRegistry {
  readonly version: number;
  readonly supplyLots: readonly ReferenceSupplyLot[];
  readonly volunteerTeams: readonly ReferenceVolunteerTeam[];
  readonly damageEntries: readonly ReferenceDamageEntry[];
  readonly emsProducts: readonly ReferenceEmsProduct[];
  readonly incidents: readonly ReferenceIncident[];
  readonly resources: readonly ReferenceResource[];
  readonly resourceTasks: readonly ReferenceResourceTask[];
  readonly publicReports: readonly ReferencePublicReport[];
  readonly thresholdRules: readonly ReferenceThresholdRule[];
}

/** The document as it sits on disk — every field `unknown`, because a config file is untrusted input. */
interface RawDoc {
  version?: unknown;
  supply_lots?: unknown;
  volunteer_teams?: unknown;
  damage_assessment_entries?: unknown;
  ems_overlay_products?: unknown;
  incidents?: unknown;
  resources?: unknown;
  resource_tasks?: unknown;
  public_reports?: unknown;
  threshold_rules?: unknown;
}

function invalid(message: string): DomainError {
  return new DomainError('INVARIANT_VIOLATION', `config/reference-data.json: ${message}`);
}

function asArray(
  value: unknown,
  field: string,
): Result<readonly Record<string, unknown>[], DomainError> {
  if (!Array.isArray(value)) return err(invalid(`${field} must be an array`));
  if (value.some((row) => typeof row !== 'object' || row === null || Array.isArray(row))) {
    return err(invalid(`${field} must contain only objects`));
  }
  return ok(value as Record<string, unknown>[]);
}

/**
 * A dataset that may simply not be there yet.
 *
 * The four original datasets are REQUIRED — a document missing `supply_lots` is a document someone broke.
 * The five added later are not: a config file written before they existed is not malformed, it is just
 * older, and failing the whole seed over an absent key would make every addition here a breaking change.
 * Present-but-not-an-array is still an error, because that IS a mistake.
 */
function asOptionalArray(
  value: unknown,
  field: string,
): Result<readonly Record<string, unknown>[], DomainError> {
  return value === undefined ? ok([]) : asArray(value, field);
}

function str(
  row: Record<string, unknown>,
  key: string,
  field: string,
): Result<string, DomainError> {
  const value = row[key];
  return typeof value === 'string' && value.trim() !== ''
    ? ok(value)
    : err(invalid(`${field}.${key} must be a non-empty string`));
}

/**
 * A required instant. Parsed HERE rather than handed to the database as text, so an unparseable date is a
 * named load failure instead of a row Postgres coerces or rejects much later with a less useful message.
 */
function instantOf(
  row: Record<string, unknown>,
  key: string,
  field: string,
): Result<Date, DomainError> {
  const raw = str(row, key, field);
  if (!raw.ok) return raw;
  const parsed = new Date(raw.value);
  return Number.isNaN(parsed.getTime())
    ? err(invalid(`${field}.${key} is not a parseable instant: ${raw.value}`))
    : ok(parsed);
}

/** Optional field parser: absent/empty is allowed; present with the wrong type is a load error. */
function optStr(
  row: Record<string, unknown>,
  key: string,
  field: string,
): Result<string | undefined, DomainError> {
  const value = row[key];
  if (value === undefined || value === null) return ok(undefined);
  if (typeof value !== 'string')
    return err(invalid(`${field}.${key} must be a non-empty string when provided`));
  return value.trim() === '' ? ok(undefined) : ok(value);
}

function optNum(
  row: Record<string, unknown>,
  key: string,
  field: string,
): Result<number | undefined, DomainError> {
  const value = row[key];
  if (value === undefined || value === null) return ok(undefined);
  return typeof value === 'number'
    ? ok(value)
    : err(invalid(`${field}.${key} must be a number when provided`));
}

/**
 * Surface a factory's rejection with the row that caused it. Without the id, a seed that fails on row 9 of
 * 12 tells an operator only that "something in the supply lots is wrong".
 */
function rejected(field: string, domainId: string, reason: string): DomainError {
  return invalid(`${field}[${domainId}] rejected by its own factory: ${reason}`);
}

/**
 * Pull several REQUIRED strings in one pass, so a builder carries one branch instead of one per field.
 * The first missing field names itself and stops the load — a config error is worth reporting precisely,
 * but not worth enumerating exhaustively before the operator has fixed the first one.
 */
function requireStrings(
  row: Record<string, unknown>,
  dataset: string,
  keys: readonly string[],
): Result<Record<string, string>, DomainError> {
  // `domain_id` is resolved FIRST and on its own, so every complaint after it can name the row it came
  // from. Without that, a missing licence on the fourth overlay reports only "ems_overlay_products.licence",
  // which is the same message whichever row is at fault.
  const domainId = str(row, 'domain_id', dataset);
  if (!domainId.ok) return domainId;
  const field = `${dataset}[${domainId.value}]`;
  const out: Record<string, string> = { domain_id: domainId.value };
  for (const key of keys) {
    if (key === 'domain_id') continue;
    const value = str(row, key, field);
    if (!value.ok) return value;
    out[key] = value.value;
  }
  return ok(out);
}

/**
 * Run a THROWING domain factory and return its complaint, or null when it was satisfied. The two domain
 * factories here assert rather than return a Result; this keeps that difference from leaking a try/catch
 * into every builder.
 */
function checkedByFactory(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Drop the undefined entries, so an optional field is ABSENT rather than present-and-undefined. */
function definedOnly<T extends Record<string, unknown>>(
  entries: T,
): Partial<{ [K in keyof T]: Exclude<T[K], undefined> }> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined) out[key] = value;
  }
  // The cast is the point of the function: `exactOptionalPropertyTypes` treats a present-but-undefined
  // property as different from an absent one, and the loop above has just made every retained value defined.
  return out as Partial<{ [K in keyof T]: Exclude<T[K], undefined> }>;
}

function buildSupplyLots(raw: unknown): Result<ReferenceSupplyLot[], DomainError> {
  const rows = asArray(raw, 'supply_lots');
  if (!rows.ok) return rows;
  const out: ReferenceSupplyLot[] = [];
  const seen = new Set<string>();
  for (const row of rows.value) {
    const req = requireStrings(row, 'supply_lots', ['domain_id', 'region_id', 'unit']);
    if (!req.ok) return req;
    const domainId = req.value['domain_id']!;
    if (seen.has(domainId))
      return err(invalid(`supply_lots has duplicate domain_id '${domainId}'`));
    seen.add(domainId);
    const quantity = optNum(row, 'quantity', `supply_lots[${domainId}]`);
    if (!quantity.ok) return quantity;
    const expiresRaw = optStr(row, 'expires_at', `supply_lots[${domainId}]`);
    if (!expiresRaw.ok) return expiresRaw;
    // The REAL factory — quantity integrality, the closed unit enum, quantity-requires-unit and a
    // parseable expiry are all its rules, not re-implemented here.
    const fields = makeSupplyFields(
      definedOnly({
        quantity: quantity.value,
        unit: req.value['unit'] as SupplyUnit,
        expiresAt: expiresRaw.value,
      }),
    );
    if (!fields.ok) return err(rejected('supply_lots', domainId, fields.error.message));
    // A lot with no quantity is a row that says nothing; the factory permits it (an EM may be mid-entry
    // in Directus) but a SHIPPED starting state that says nothing is not worth seeding.
    if (quantity.value === undefined) {
      return err(invalid(`supply_lots[${domainId}] must carry a quantity`));
    }
    out.push({
      domainId,
      regionConfigId: req.value['region_id']!,
      quantity: quantity.value,
      unit: req.value['unit'] as SupplyUnit,
      ...definedOnly({
        expiresAt: expiresRaw.value === undefined ? undefined : new Date(expiresRaw.value),
      }),
    });
  }
  return ok(out);
}

function buildVolunteerTeams(raw: unknown): Result<ReferenceVolunteerTeam[], DomainError> {
  const rows = asArray(raw, 'volunteer_teams');
  if (!rows.ok) return rows;
  const out: ReferenceVolunteerTeam[] = [];
  const seen = new Set<string>();
  for (const row of rows.value) {
    const req = requireStrings(row, 'volunteer_teams', [
      'domain_id',
      'region_id',
      'callsign',
      'availability',
    ]);
    if (!req.ok) return req;
    const domainId = req.value['domain_id']!;
    if (seen.has(domainId))
      return err(invalid(`volunteer_teams has duplicate domain_id '${domainId}'`));
    seen.add(domainId);
    const skillsRaw = row['skills'];
    if (!Array.isArray(skillsRaw) || skillsRaw.some((skill) => typeof skill !== 'string')) {
      return err(invalid(`volunteer_teams[${domainId}].skills must be an array of strings`));
    }
    const skills = skillsRaw as string[];
    const headcount = optNum(row, 'headcount', `volunteer_teams[${domainId}]`);
    if (!headcount.ok) return headcount;
    // The REAL factory — the callsign pattern/maxLength (read from the JSON Schema, so "never a person's
    // name" is enforced on a seeded row too), the non-negative tally and the closed availability enum.
    const fields = makeVolunteerTeamFields(
      definedOnly({
        callsign: req.value['callsign']!,
        headcount: headcount.value,
        skills,
        availability: req.value['availability'] as TeamAvailability,
      }),
    );
    if (!fields.ok) return err(rejected('volunteer_teams', domainId, fields.error.message));
    if (headcount.value === undefined) {
      return err(invalid(`volunteer_teams[${domainId}] must carry a headcount`));
    }
    out.push({
      domainId,
      regionConfigId: req.value['region_id']!,
      callsign: req.value['callsign']!,
      headcount: headcount.value,
      skills,
      availability: req.value['availability'] as TeamAvailability,
    });
  }
  return ok(out);
}

function buildDamageEntries(raw: unknown): Result<ReferenceDamageEntry[], DomainError> {
  const rows = asArray(raw, 'damage_assessment_entries');
  if (!rows.ok) return rows;
  const out: ReferenceDamageEntry[] = [];
  const seen = new Set<string>();
  for (const row of rows.value) {
    const req = requireStrings(row, 'damage_assessment_entries', [
      'domain_id',
      'incident_domain_id',
      'report_status',
      'category',
    ]);
    if (!req.ok) return req;
    const domainId = req.value['domain_id']!;
    if (seen.has(domainId))
      return err(invalid(`damage_assessment_entries has duplicate domain_id '${domainId}'`));
    seen.add(domainId);
    const severity = optStr(row, 'severity', `damage_assessment_entries[${domainId}]`);
    if (!severity.ok) return severity;
    const needKind = optStr(row, 'need_kind', `damage_assessment_entries[${domainId}]`);
    if (!needKind.ok) return needKind;
    const siteCount = optNum(row, 'site_count', `damage_assessment_entries[${domainId}]`);
    if (!siteCount.ok) return siteCount;
    const optional = definedOnly({
      severity: severity.value as DamageSeverity | undefined,
      needKind: needKind.value as NeedKind | undefined,
      siteCount: siteCount.value,
    });
    const entry: ReferenceDamageEntry = {
      domainId,
      incidentDomainId: req.value['incident_domain_id']!,
      reportStatus: req.value['report_status'] as PublicReportStatus,
      category: req.value['category'] as DamageReportCategory,
      ...optional,
    };
    // The REAL factory. It also enforces the rule that keeps the board's buckets meaningful: a NEED entry
    // carries a needKind and never a damage severity, so the two can never be summed into one number.
    const verdict = checkedByFactory(() =>
      makeDamageAssessmentEntry({
        report: {
          id: domainId as never,
          status: entry.reportStatus,
          incidentId: entry.incidentDomainId as never,
          category: entry.category,
        },
        category: entry.category,
        ...optional,
      }),
    );
    if (verdict !== null) return err(rejected('damage_assessment_entries', domainId, verdict));
    out.push(entry);
  }
  return ok(out);
}

function buildEmsProducts(raw: unknown): Result<ReferenceEmsProduct[], DomainError> {
  const rows = asArray(raw, 'ems_overlay_products');
  if (!rows.ok) return rows;
  const out: ReferenceEmsProduct[] = [];
  const seen = new Set<string>();
  for (const row of rows.value) {
    const req = requireStrings(row, 'ems_overlay_products', [
      'domain_id',
      'region_id',
      'activation_code',
      'product_type',
      'area_of_interest',
      'provider',
      'licence',
      'view_url',
    ]);
    if (!req.ok) return req;
    const domainId = req.value['domain_id']!;
    if (seen.has(domainId))
      return err(invalid(`ems_overlay_products has duplicate domain_id '${domainId}'`));
    seen.add(domainId);
    const producedAt = instantOf(row, 'produced_at', `ems_overlay_products[${domainId}]`);
    if (!producedAt.ok) return producedAt;
    const product: ReferenceEmsProduct = {
      domainId,
      regionConfigId: req.value['region_id']!,
      activationCode: req.value['activation_code']!,
      productType: req.value['product_type'] as OverlayProductType,
      areaOfInterest: req.value['area_of_interest']!,
      producedAt: producedAt.value,
      provider: req.value['provider']!,
      licence: req.value['licence']!,
      viewUrl: req.value['view_url']!,
    };
    // The REAL factory. It is the one that refuses an overlay with no licence recorded — Art. XI: an
    // overlay whose terms nobody can state may not be shown at all.
    const verdict = checkedByFactory(() =>
      makeDamageOverlayProduct({
        productId: product.domainId,
        activationCode: product.activationCode,
        productType: product.productType,
        areaOfInterest: product.areaOfInterest,
        producedAt: product.producedAt.toISOString(),
        provider: product.provider,
        licence: product.licence,
        viewUrl: product.viewUrl,
      }),
    );
    if (verdict !== null) return err(rejected('ems_overlay_products', domainId, verdict));
    out.push(product);
  }
  return ok(out);
}

// ── The five tables nothing had ever written (2026-09-12) ─────────────────────────────────────────────
//
// Four panels were empty and one table was load-bearing without anybody noticing. `resource` and
// `resource_task` back the Logistics tab; `public_report` backs the verification queue, which is the
// product's human-in-the-loop claim and had nothing in it to demonstrate; `threshold_rule` backs the
// engine that raises DRAFT alerts. And `incident` — the one that matters most — was empty on every
// deployment ever made, so every incident-keyed store wrote into a translation that returned null.
//
// The same rule as the four datasets above: the REAL factory runs at load, so a rule with a negative
// cooldown, a report with no consent, or a task in a status nobody defined fails the SEED rather than
// the operator's afternoon.

function buildIncidents(raw: unknown): Result<ReferenceIncident[], DomainError> {
  const rows = asOptionalArray(raw, 'incidents');
  if (!rows.ok) return rows;
  const out: ReferenceIncident[] = [];
  const seen = new Set<string>();
  for (const row of rows.value) {
    const req = requireStrings(row, 'incidents', ['domain_id', 'region_id', 'type', 'status']);
    if (!req.ok) return req;
    const domainId = req.value['domain_id']!;
    if (seen.has(domainId)) return err(invalid(`incidents has duplicate domain_id '${domainId}'`));
    seen.add(domainId);
    const entry: ReferenceIncident = {
      domainId,
      regionConfigId: req.value['region_id']!,
      type: req.value['type'] as IncidentType,
      status: req.value['status'] as IncidentStatus,
    };
    const verdict = checkedByFactory(() =>
      makeIncident({
        id: asId<IncidentId>(entry.domainId),
        regionId: asId<RegionId>(entry.regionConfigId),
        type: entry.type,
        status: entry.status,
      }),
    );
    if (verdict !== null) return err(rejected('incidents', domainId, verdict));
    out.push(entry);
  }
  return ok(out);
}

function buildResources(raw: unknown): Result<ReferenceResource[], DomainError> {
  const rows = asOptionalArray(raw, 'resources');
  if (!rows.ok) return rows;
  const out: ReferenceResource[] = [];
  const seen = new Set<string>();
  for (const row of rows.value) {
    const req = requireStrings(row, 'resources', ['domain_id', 'region_id', 'kind', 'status']);
    if (!req.ok) return req;
    const domainId = req.value['domain_id']!;
    if (seen.has(domainId)) return err(invalid(`resources has duplicate domain_id '${domainId}'`));
    seen.add(domainId);
    const field = `resources[${domainId}]`;
    const org = optStr(row, 'org', field);
    if (!org.ok) return org;
    const lon = optNum(row, 'lon', field);
    if (!lon.ok) return lon;
    const lat = optNum(row, 'lat', field);
    if (!lat.ok) return lat;
    if ((lon.value === undefined) !== (lat.value === undefined)) {
      // Half a coordinate is not a location. Accepting one would put the resource on the null island.
      return err(invalid(`${field} must carry BOTH lon and lat, or neither`));
    }
    const entry: ReferenceResource = {
      domainId,
      regionConfigId: req.value['region_id']!,
      kind: req.value['kind'] as ResourceKind,
      status: req.value['status'] as ResourceStatus,
      ...definedOnly({ org: org.value, lon: lon.value, lat: lat.value }),
    };
    const verdict = checkedByFactory(() =>
      makeResource({
        id: asId<ResourceId>(entry.domainId),
        kind: entry.kind,
        status: entry.status,
        ...definedOnly({ org: entry.org }),
        ...(entry.lon !== undefined && entry.lat !== undefined
          ? { geom: { type: 'Point' as const, coordinates: [entry.lon, entry.lat] as const } }
          : {}),
      }),
    );
    if (verdict !== null) return err(rejected('resources', domainId, verdict));
    out.push(entry);
  }
  return ok(out);
}

function buildResourceTasks(raw: unknown): Result<ReferenceResourceTask[], DomainError> {
  const rows = asOptionalArray(raw, 'resource_tasks');
  if (!rows.ok) return rows;
  const out: ReferenceResourceTask[] = [];
  const seen = new Set<string>();
  for (const row of rows.value) {
    const req = requireStrings(row, 'resource_tasks', [
      'domain_id',
      'resource_domain_id',
      'incident_domain_id',
      'status',
    ]);
    if (!req.ok) return req;
    const domainId = req.value['domain_id']!;
    if (seen.has(domainId))
      return err(invalid(`resource_tasks has duplicate domain_id '${domainId}'`));
    seen.add(domainId);
    const entry: ReferenceResourceTask = {
      domainId,
      resourceDomainId: req.value['resource_domain_id']!,
      incidentDomainId: req.value['incident_domain_id']!,
      status: req.value['status'] as ResourceTaskStatus,
    };
    const verdict = checkedByFactory(() =>
      makeResourceTask({
        id: asId<ResourceTaskId>(entry.domainId),
        resourceId: asId<ResourceId>(entry.resourceDomainId),
        incidentId: asId<IncidentId>(entry.incidentDomainId),
        status: entry.status,
      }),
    );
    if (verdict !== null) return err(rejected('resource_tasks', domainId, verdict));
    out.push(entry);
  }
  return ok(out);
}

function buildPublicReports(raw: unknown): Result<ReferencePublicReport[], DomainError> {
  const rows = asOptionalArray(raw, 'public_reports');
  if (!rows.ok) return rows;
  const out: ReferencePublicReport[] = [];
  const seen = new Set<string>();
  for (const row of rows.value) {
    const built = buildPublicReport(row, seen);
    if (!built.ok) return built;
    out.push(built.value);
  }
  return ok(out);
}

/** The optional half of a report row, parsed in one place so the builder carries one branch, not five. */
interface ReportOptionals {
  readonly confidence?: number;
  readonly lon?: number;
  readonly lat?: number;
  readonly receivedAt?: Date;
}

function reportOptionals(
  row: Record<string, unknown>,
  field: string,
): Result<ReportOptionals, DomainError> {
  const confidence = optNum(row, 'confidence', field);
  if (!confidence.ok) return confidence;
  const lon = optNum(row, 'lon', field);
  if (!lon.ok) return lon;
  const lat = optNum(row, 'lat', field);
  if (!lat.ok) return lat;
  if ((lon.value === undefined) !== (lat.value === undefined)) {
    return err(invalid(`${field} must carry BOTH lon and lat, or neither`));
  }
  if (row['received_at'] === undefined) {
    return ok(definedOnly({ confidence: confidence.value, lon: lon.value, lat: lat.value }));
  }
  const receivedAt = instantOf(row, 'received_at', field);
  if (!receivedAt.ok) return receivedAt;
  return ok(
    definedOnly({
      confidence: confidence.value,
      lon: lon.value,
      lat: lat.value,
      receivedAt: receivedAt.value,
    }),
  );
}

function buildPublicReport(
  row: Record<string, unknown>,
  seen: Set<string>,
): Result<ReferencePublicReport, DomainError> {
  const req = requireStrings(row, 'public_reports', [
    'domain_id',
    'incident_domain_id',
    'source',
    'category',
    'status',
    'text',
  ]);
  if (!req.ok) return req;
  const domainId = req.value['domain_id']!;
  if (seen.has(domainId))
    return err(invalid(`public_reports has duplicate domain_id '${domainId}'`));
  seen.add(domainId);
  const field = `public_reports[${domainId}]`;
  const purgeAfter = instantOf(row, 'purge_after', field);
  if (!purgeAfter.ok) return purgeAfter;
  const optional = reportOptionals(row, field);
  if (!optional.ok) return optional;
  const entry: ReferencePublicReport = {
    domainId,
    incidentDomainId: req.value['incident_domain_id']!,
    source: req.value['source'] as PublicReportSource,
    category: req.value['category'] as PublicReportCategory,
    status: req.value['status'] as PublicReportStatus,
    text: req.value['text']!,
    purgeAfter: purgeAfter.value,
    ...optional.value,
  };
  const verdict = checkedByFactory(() => reportFactoryCheck(entry));
  if (verdict !== null) return err(rejected('public_reports', domainId, verdict));
  return ok(entry);
}

/**
 * The REAL factory, with consent hardcoded true — and that is not a shortcut.
 *
 * `makePublicReport` refuses a report without consent (RESPONSIBLE_DATA.md), and a seeded demonstration
 * report is one this project authored, so the consent is genuinely given by its author. Reading the flag
 * out of the config file instead would let someone set `consent: true` on a stranger's behalf, which is
 * the precise thing the invariant exists to prevent.
 */
function reportFactoryCheck(entry: ReferencePublicReport): unknown {
  return makePublicReport({
    id: asId<PublicReportId>(entry.domainId),
    incidentId: asId<IncidentId>(entry.incidentDomainId),
    source: entry.source,
    category: entry.category,
    status: entry.status,
    text: entry.text,
    consent: true,
    purgeAfter: entry.purgeAfter.toISOString(),
    ...definedOnly({
      confidence: entry.confidence,
      receivedAt: entry.receivedAt?.toISOString(),
    }),
    ...(entry.lon !== undefined && entry.lat !== undefined
      ? {
          geomGeneralized: { type: 'Point' as const, coordinates: [entry.lon, entry.lat] as const },
        }
      : {}),
  });
}

function buildThresholdRules(raw: unknown): Result<ReferenceThresholdRule[], DomainError> {
  const rows = asOptionalArray(raw, 'threshold_rules');
  if (!rows.ok) return rows;
  const out: ReferenceThresholdRule[] = [];
  const seen = new Set<string>();
  for (const row of rows.value) {
    const req = requireStrings(row, 'threshold_rules', [
      'domain_id',
      'region_id',
      'target',
      'operator',
      'value',
    ]);
    if (!req.ok) return req;
    const domainId = req.value['domain_id']!;
    if (seen.has(domainId))
      return err(invalid(`threshold_rules has duplicate domain_id '${domainId}'`));
    seen.add(domainId);
    const field = `threshold_rules[${domainId}]`;
    const hysteresis = optNum(row, 'hysteresis', field);
    if (!hysteresis.ok) return hysteresis;
    const cooldown = optNum(row, 'cooldown', field);
    if (!cooldown.ok) return cooldown;
    const entry: ReferenceThresholdRule = {
      domainId,
      regionConfigId: req.value['region_id']!,
      target: req.value['target'] as ThresholdTarget,
      operator: req.value['operator'] as ThresholdOperator,
      value: req.value['value']!,
      ...definedOnly({ hysteresis: hysteresis.value, cooldown: cooldown.value }),
    };
    const verdict = checkedByFactory(() =>
      makeThresholdRule({
        id: asId<ThresholdRuleId>(entry.domainId),
        target: entry.target,
        operator: entry.operator,
        value: entry.value,
        scope: asId<RegionId>(entry.regionConfigId),
        ...definedOnly({ hysteresis: entry.hysteresis, cooldown: entry.cooldown }),
      }),
    );
    if (verdict !== null) return err(rejected('threshold_rules', domainId, verdict));
    out.push(entry);
  }
  return ok(out);
}

/**
 * The cross-dataset check the database would otherwise make at 3 a.m.
 *
 * `resource_task.resource_id` and `.incident_id` are NOT NULL foreign keys, and `public_report.incident_id`
 * is a foreign key too. A task naming a resource that does not exist fails the INSERT with a Postgres
 * constraint name and a uuid — true, and useless. Named here, it fails the LOAD with the domain ids an
 * operator actually wrote.
 */
function checkReferences(
  incidents: readonly ReferenceIncident[],
  resources: readonly ReferenceResource[],
  tasks: readonly ReferenceResourceTask[],
  reports: readonly ReferencePublicReport[],
): DomainError | null {
  const incidentIds = new Set(incidents.map((i) => i.domainId));
  const resourceIds = new Set(resources.map((r) => r.domainId));
  for (const task of tasks) {
    if (!resourceIds.has(task.resourceDomainId)) {
      return invalid(
        `resource_tasks[${task.domainId}] names resource '${task.resourceDomainId}', which is not in resources`,
      );
    }
    if (!incidentIds.has(task.incidentDomainId)) {
      return invalid(
        `resource_tasks[${task.domainId}] names incident '${task.incidentDomainId}', which is not in incidents`,
      );
    }
  }
  for (const report of reports) {
    if (!incidentIds.has(report.incidentDomainId)) {
      return invalid(
        `public_reports[${report.domainId}] names incident '${report.incidentDomainId}', which is not in incidents`,
      );
    }
  }
  return null;
}

/**
 * Load and validate the reference dataset. Returns `err` — never throws — so the caller decides whether a
 * malformed config is fatal. For the seed it is: a starting state nobody can trust is worse than none.
 */
/** Read + parse the document, or say precisely why it could not be read. */
function readDoc(path: string): Result<RawDoc, DomainError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    return err(
      invalid(`unreadable or not valid JSON: ${e instanceof Error ? e.message : String(e)}`),
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return err(invalid('root must be an object'));
  }
  const doc = parsed as RawDoc;
  return typeof doc.version === 'number' ? ok(doc) : err(invalid('version must be a number'));
}

type PanelDatasets = Pick<
  ReferenceRegistry,
  'supplyLots' | 'volunteerTeams' | 'damageEntries' | 'emsProducts'
>;
type OperationalDatasets = Pick<
  ReferenceRegistry,
  'incidents' | 'resources' | 'resourceTasks' | 'publicReports' | 'thresholdRules'
>;

/** The four ORIGINAL datasets (ADR-041). Required: a document missing one of these is broken, not old. */
function loadPanelDatasets(doc: RawDoc): Result<PanelDatasets, DomainError> {
  const supplyLots = buildSupplyLots(doc.supply_lots);
  if (!supplyLots.ok) return supplyLots;
  const volunteerTeams = buildVolunteerTeams(doc.volunteer_teams);
  if (!volunteerTeams.ok) return volunteerTeams;
  const damageEntries = buildDamageEntries(doc.damage_assessment_entries);
  if (!damageEntries.ok) return damageEntries;
  const emsProducts = buildEmsProducts(doc.ems_overlay_products);
  if (!emsProducts.ok) return emsProducts;
  return ok({
    supplyLots: supplyLots.value,
    volunteerTeams: volunteerTeams.value,
    damageEntries: damageEntries.value,
    emsProducts: emsProducts.value,
  });
}

/** The five added 2026-09-12. Optional (see `asOptionalArray`) and cross-checked against each other. */
function loadOperationalDatasets(doc: RawDoc): Result<OperationalDatasets, DomainError> {
  const incidents = buildIncidents(doc.incidents);
  if (!incidents.ok) return incidents;
  const resources = buildResources(doc.resources);
  if (!resources.ok) return resources;
  const resourceTasks = buildResourceTasks(doc.resource_tasks);
  if (!resourceTasks.ok) return resourceTasks;
  const publicReports = buildPublicReports(doc.public_reports);
  if (!publicReports.ok) return publicReports;
  const thresholdRules = buildThresholdRules(doc.threshold_rules);
  if (!thresholdRules.ok) return thresholdRules;
  const referential = checkReferences(
    incidents.value,
    resources.value,
    resourceTasks.value,
    publicReports.value,
  );
  if (referential !== null) return err(referential);
  return ok({
    incidents: incidents.value,
    resources: resources.value,
    resourceTasks: resourceTasks.value,
    publicReports: publicReports.value,
    thresholdRules: thresholdRules.value,
  });
}

export function loadReferenceRegistry(
  path: string = REFERENCE_DATA_PATH,
): Result<ReferenceRegistry, DomainError> {
  const doc = readDoc(path);
  if (!doc.ok) return doc;
  const panels = loadPanelDatasets(doc.value);
  if (!panels.ok) return panels;
  const operational = loadOperationalDatasets(doc.value);
  if (!operational.ok) return operational;
  return ok({ version: doc.value.version as number, ...panels.value, ...operational.value });
}
