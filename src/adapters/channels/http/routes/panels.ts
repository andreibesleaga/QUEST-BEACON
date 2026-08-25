// BEACON — dock-panel HTTP handlers (S3·U1/U2; FR-D6-1/FR-D6-2/FR-D4-3/FR-D4-4/FR-D4-5, ADR-035 §4,
// ADR-036 §7, Art. XIV/XVI, F1). Framework-agnostic PURE handlers for the five D4/D6 read surfaces that
// un-inert the tested-but-unreachable application modules (the F-81/F-152 "a feature with no on-camera
// moment" class — five more instances, closed here):
//   • GET /supplies         — relief supply lots        (aggregate/supplies.ts,        FEATURE_D6_SUPPLIES)
//   • GET /volunteer-teams  — volunteer team units      (aggregate/volunteer-team.ts,  FEATURE_D6_VOLUNTEER_TEAMS)
//   • GET /shelter-status   — the shelter supply board  (coordination/shelter-status.ts, FEATURE_D4_SHELTER_STATUS)
//   • GET /damage-reports   — damage/needs assessment   (coordination/damage-assessment.ts, FEATURE_D4_DAMAGE_REPORTS)
//   • GET /ems-overlay      — Copernicus EMS link-outs  (coordination/ems-overlay.ts,  FEATURE_D4_EMS_OVERLAY)
// Each takes an ALREADY-authenticated request (resolved role) + an injected clock and returns an
// Envelope-shaped { status, body } — no server, deterministic, offline. RBAC is RESPONDER+ on all five,
// enforced here by role rank (the logistics-dock gate GET /resources already uses; damage buckets carry
// triage-state counts and the dock itself is an operator surface). Provenance is NON-EMPTY on every success
// (F1) and is MOCK: every dataset below is fixture-fed through its REAL domain/application factory, and the
// envelope says so rather than presenting seeded rows as a feed (Art. XVI). The feature flags are gated in
// feature-router.ts at the transport level (OFF ⇒ the same generic 404 an unmatched route returns) — the
// incident-summary posture, so a disabled surface never confirms it exists. Mirrors queue.ts.
import { readFileSync } from 'node:fs';
import { isResponder } from '@/domain/app-user.js';
import type { AppUserRole } from '@/domain/app-user.js';
import { Unauthorized } from '@/domain/errors.js';
import type { DomainError } from '@/domain/errors.js';
import type { Result } from '@/domain/shared/result.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { IncidentId, PublicReportId } from '@/domain/value-objects/ids.js';
import { makeShelter } from '@/domain/shelter.js';
import type { MakeShelterInput } from '@/domain/shelter.js';
import { makeDamageAssessmentEntry } from '@/domain/damage-assessment.js';
import type { DamageReportCategory, DamageSeverity, NeedKind } from '@/domain/damage-assessment.js';
import type { PublicReportStatus } from '@/domain/public-report.js';
import { makeDamageOverlayProduct } from '@/domain/damage-overlay.js';
import type { MakeDamageOverlayProductInput } from '@/domain/damage-overlay.js';
import type { Envelope, SourceRef } from '@/ports/interaction.js';
import { errorEnvelope } from '@/application/interaction/command-router.js';
import { makeSupplyFields } from '@/application/aggregate/supplies.js';
import type { SupplyFields, SupplyUnit } from '@/application/aggregate/supplies.js';
import { makeVolunteerTeamFields } from '@/application/aggregate/volunteer-team.js';
import type { TeamAvailability, VolunteerTeamFields } from '@/application/aggregate/volunteer-team.js';
import { buildShelterStatusBoard } from '@/application/coordination/shelter-status.js';
import type { ShelterStatusBoard } from '@/application/coordination/shelter-status.js';
import { assessDamage } from '@/application/coordination/damage-assessment.js';
import type { DamageAssessment } from '@/application/coordination/damage-assessment.js';
import { buildEmsOverlay } from '@/application/coordination/ems-overlay.js';
import type { EmsOverlay } from '@/application/coordination/ems-overlay.js';
import { statusForError } from '../error-mapping.js';

/** The transport-neutral result every panel handler returns (mirrors HttpResponse's {status, body}). */
export interface PanelHttpResult {
  readonly status: number;
  readonly body: Envelope | Envelope<null>;
}

/** The one dependency every panel read takes: the injected clock (freshness/asOf — never a wall clock here). */
export interface PanelDeps {
  readonly clock: () => string;
}

export interface PanelGetRequest {
  readonly role: AppUserRole;
}

function fail(error: DomainError): PanelHttpResult {
  return { status: statusForError(error.code), body: errorEnvelope(error) };
}

function success<T>(data: T, provenance: readonly SourceRef[]): PanelHttpResult {
  const freshness = provenance[0]?.fetchedAt;
  return { status: 200, body: { data, provenance, ...(freshness ? { freshness } : {}) } };
}

/** MOCK-mode provenance for the fixture-fed panels — NON-EMPTY so every data response satisfies F1. */
function mockProvenance(sourceId: string, clock: () => string): readonly SourceRef[] {
  return [{ sourceId, mode: 'MOCK', fetchedAt: clock() }];
}

/** Unwrap a factory Result at fixture-load; a broken fixture fails EVERY test loudly, never one request quietly. */
function unwrap<T>(res: Result<T, DomainError>): T {
  if (!res.ok) throw res.error;
  return res.value;
}

/** Read + parse one fixtures/coordination/*.json document (CWD-relative — same posture as the module tests). */
function readFixture<T>(name: string): T {
  return JSON.parse(readFileSync(`fixtures/coordination/${name}`, 'utf8')) as T;
}

// ── GET /supplies — relief supply lots (FR-D6-2; RESPONDER+) ─────────────────────────────────────────

/** One supply LOT: an id plus the FR-D6-2 aggregate fields — stock only, never a donor or a payment. */
export type SupplyLotView = { readonly id: string } & SupplyFields;

/**
 * The `data` payload GET /supplies returns — the ONE declaration of that shape (the F-200 discipline).
 * `app/_lib/types.ts` re-exports it, so renaming the `supplies` key is a client COMPILE error.
 */
export interface SuppliesGetData {
  readonly supplies: readonly SupplyLotView[];
}

interface SupplyFixtureRow {
  readonly id: string;
  readonly quantity?: number;
  readonly unit?: SupplyUnit;
  readonly expiresAt?: string;
}

// Fixture rows through the REAL factory at module load (the shelters.json precedent): every invariant —
// integer quantity, quantity-requires-unit, closed unit enum — holds on what this route serves.
const SUPPLY_LOTS: readonly SupplyLotView[] = readFixture<{ supplies: readonly SupplyFixtureRow[] }>(
  'supplies.json',
).supplies.map((row) => ({
  id: row.id,
  ...unwrap(
    makeSupplyFields({
      ...(row.quantity !== undefined ? { quantity: row.quantity } : {}),
      ...(row.unit !== undefined ? { unit: row.unit } : {}),
      ...(row.expiresAt !== undefined ? { expiresAt: row.expiresAt } : {}),
    }),
  ),
}));

/** GET /supplies — the relief-supply stock list. RESPONDER+ (the logistics-dock gate, SPEC §2.2). */
export function handleSuppliesGet(req: PanelGetRequest, deps: PanelDeps): PanelHttpResult {
  if (!isResponder(req.role)) return fail(new Unauthorized('GET /supplies requires RESPONDER+'));
  return success<SuppliesGetData>({ supplies: SUPPLY_LOTS }, mockProvenance('relief-supplies', deps.clock));
}

// ── GET /volunteer-teams — volunteer team units (FR-D6-1; RESPONDER+) ────────────────────────────────

/** One volunteer TEAM unit: an id plus the FR-D6-1 aggregate fields — a tally and tags, never a roster. */
export type VolunteerTeamView = { readonly id: string } & VolunteerTeamFields;

/** The `data` payload GET /volunteer-teams returns — the ONE declaration of that shape (F-200). */
export interface VolunteerTeamsGetData {
  readonly teams: readonly VolunteerTeamView[];
}

interface VolunteerTeamFixtureRow {
  readonly id: string;
  readonly callsign?: string;
  readonly headcount?: number;
  readonly skills?: readonly string[];
  readonly availability?: TeamAvailability;
}

const VOLUNTEER_TEAMS: readonly VolunteerTeamView[] = readFixture<{ teams: readonly VolunteerTeamFixtureRow[] }>(
  'volunteer-teams.json',
).teams.map((row) => ({
  id: row.id,
  ...unwrap(
    makeVolunteerTeamFields({
      ...(row.callsign !== undefined ? { callsign: row.callsign } : {}),
      ...(row.headcount !== undefined ? { headcount: row.headcount } : {}),
      ...(row.skills !== undefined ? { skills: row.skills } : {}),
      ...(row.availability !== undefined ? { availability: row.availability } : {}),
    }),
  ),
}));

/** GET /volunteer-teams — the team-unit registry view. RESPONDER+ (same gate as /resources). */
export function handleVolunteerTeamsGet(req: PanelGetRequest, deps: PanelDeps): PanelHttpResult {
  if (!isResponder(req.role)) return fail(new Unauthorized('GET /volunteer-teams requires RESPONDER+'));
  return success<VolunteerTeamsGetData>({ teams: VOLUNTEER_TEAMS }, mockProvenance('volunteer-registry', deps.clock));
}

// ── GET /shelter-status — the shelter SUPPLY board (FR-D4-3; RESPONDER+) ─────────────────────────────

/** The `data` payload GET /shelter-status returns: the module's whole board — rows, totals, and the
 *  provenance claim that can only say "live" when the mode IS LIVE (shelter-status.ts header, F-35). */
export interface ShelterStatusGetData {
  readonly board: ShelterStatusBoard;
}

const SHELTER_FIXTURE = readFixture<{ shelters: readonly MakeShelterInput[] }>('shelters.json')
  .shelters.map((s) => makeShelter(s));

/**
 * GET /shelter-status — the aggregate shelter board. RESPONDER+. The board's `asOf` is the injected clock
 * and its mode is MOCK: the rows are the hand-seeded demo shelters, and `provenanceClaim` says exactly that
 * on every response (Art. XVI — the module was built so this route CANNOT claim live for seeded rows).
 */
export function handleShelterStatusGet(req: PanelGetRequest, deps: PanelDeps): PanelHttpResult {
  if (!isResponder(req.role)) return fail(new Unauthorized('GET /shelter-status requires RESPONDER+'));
  const board = buildShelterStatusBoard({
    shelters: SHELTER_FIXTURE,
    provenance: {
      mode: 'MOCK',
      sourceLabel: 'hand-seeded demo shelters (no shelter source adapter exists — F-35)',
      asOf: deps.clock(),
    },
  });
  if (!board.ok) return fail(board.error);
  return success<ShelterStatusGetData>({ board: board.value }, mockProvenance('shelter-board', deps.clock));
}

// ── GET /damage-reports — damage/needs assessment (FR-D4-4; RESPONDER+) ──────────────────────────────

/** The `data` payload GET /damage-reports returns: one bucket per triage state, NEVER a grand total —
 *  the module's structural verified/unverified split travels to the wire intact (Art. XIII). */
export interface DamageReportsGetData {
  readonly assessment: DamageAssessment;
}

interface DamageFixtureRow {
  readonly report: { readonly id: string; readonly status: PublicReportStatus; readonly incidentId?: string };
  readonly category: DamageReportCategory;
  readonly severity?: DamageSeverity;
  readonly needKind?: NeedKind;
  readonly siteCount?: number;
}

const DAMAGE_FIXTURE = readFixture<{ incidentId: string; entries: readonly DamageFixtureRow[] }>(
  'damage-entries.json',
);

// Every fixture row through the REAL domain factory — an entry the pipeline could not produce cannot be served.
const DAMAGE_ENTRIES = DAMAGE_FIXTURE.entries.map((e) =>
  makeDamageAssessmentEntry({
    report: {
      id: asId<PublicReportId>(e.report.id),
      status: e.report.status,
      ...(e.report.incidentId !== undefined ? { incidentId: asId<IncidentId>(e.report.incidentId) } : {}),
    },
    category: e.category,
    ...(e.severity !== undefined ? { severity: e.severity } : {}),
    ...(e.needKind !== undefined ? { needKind: e.needKind } : {}),
    ...(e.siteCount !== undefined ? { siteCount: e.siteCount } : {}),
  }),
);

/** GET /damage-reports — the per-triage-state damage/needs buckets. RESPONDER+ (counts of triage work). */
export function handleDamageReportsGet(req: PanelGetRequest, deps: PanelDeps): PanelHttpResult {
  if (!isResponder(req.role)) return fail(new Unauthorized('GET /damage-reports requires RESPONDER+'));
  const assessment = assessDamage({
    incidentId: asId<IncidentId>(DAMAGE_FIXTURE.incidentId),
    entries: DAMAGE_ENTRIES,
  });
  if (!assessment.ok) return fail(assessment.error);
  return success<DamageReportsGetData>(
    { assessment: assessment.value },
    mockProvenance('damage-assessment', deps.clock),
  );
}

// ── GET /ems-overlay — Copernicus EMS damage products, link-only (FR-D4-5; RESPONDER+) ───────────────

/** The `data` payload GET /ems-overlay returns: the attributed, dated, LINK-ONLY overlay (FEV-24). */
export interface EmsOverlayGetData {
  readonly overlay: EmsOverlay;
}

const EMS_PRODUCTS = readFixture<{ products: readonly MakeDamageOverlayProductInput[] }>('ems-products.json')
  .products.map((p) => makeDamageOverlayProduct(p));

/**
 * GET /ems-overlay — published Copernicus EMS rapid-mapping products as an attributed, dated link-out list.
 * RESPONDER+. `asOf` is the injected clock, so a product "produced after" the evaluation instant lands in
 * `rejected` with its reason rather than rendering a negative age (Art. XVI — the module enforces this).
 */
export function handleEmsOverlayGet(req: PanelGetRequest, deps: PanelDeps): PanelHttpResult {
  if (!isResponder(req.role)) return fail(new Unauthorized('GET /ems-overlay requires RESPONDER+'));
  const overlay = buildEmsOverlay({ products: EMS_PRODUCTS, asOf: deps.clock() });
  if (!overlay.ok) return fail(overlay.error);
  return success<EmsOverlayGetData>({ overlay: overlay.value }, mockProvenance('copernicus-ems', deps.clock));
}
