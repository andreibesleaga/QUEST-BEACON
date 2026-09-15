// BEACON — dock-panel HTTP handlers (S3·U1/U2; FR-D6-1/FR-D6-2/FR-D4-3/FR-D4-4/FR-D4-5, ADR-035 §4,
// ADR-036 §7, ADR-041, Art. XIV/XVI, F1). Framework-agnostic handlers for the five D4/D6 read surfaces that
// un-inert the tested-but-unreachable application modules (the F-81/F-152 "a feature with no on-camera
// moment" class — five more instances, closed here):
//   • GET /supplies         — relief supply lots        (aggregate/supplies.ts,        FEATURE_D6_SUPPLIES)
//   • GET /volunteer-teams  — volunteer team units      (aggregate/volunteer-team.ts,  FEATURE_D6_VOLUNTEER_TEAMS)
//   • GET /shelter-status   — the shelter supply board  (coordination/shelter-status.ts, FEATURE_D4_SHELTER_STATUS)
//   • GET /damage-reports   — damage/needs assessment   (coordination/damage-assessment.ts, FEATURE_D4_DAMAGE_REPORTS)
//   • GET /ems-overlay      — Copernicus EMS link-outs  (coordination/ems-overlay.ts,  FEATURE_D4_EMS_OVERLAY)
// Each takes an ALREADY-authenticated request (resolved role) + injected deps and returns an
// Envelope-shaped { status, body } — no server, deterministic, offline. RBAC is RESPONDER+ on all five,
// enforced here by role rank (the logistics-dock gate GET /resources already uses; damage buckets carry
// triage-state counts and the dock itself is an operator surface). Provenance is NON-EMPTY on every success
// (F1). The feature flags are gated in feature-router.ts at the transport level (OFF ⇒ the same generic 404
// an unmatched route returns) — the incident-summary posture, so a disabled surface never confirms it
// exists. Mirrors queue.ts.
//
// TWO RUNGS, LABELLED (ADR-041; Art. XVI). These panels used to be fixture-fed and INERT: an emergency
// manager could not change a shelter's occupancy, book in a delivered supply lot or stand a team down.
// They now read an OPERATOR-MAINTAINED store when one is wired (`PanelDeps.panelData`, composed only under
// `FEATURE_STORE=postgres`) and serve those rows as `DB` — SPEC §2.1: a record held in BEACON's own store,
// whose `fetchedAt` is its LAST EDIT and which claims nothing about the outside world. With no store wired
// the fixture readers below ARE the rung, exactly as before, so the offline, air-gapped and Playwright
// profiles are byte-identical to the day this seam did not exist.
//
// THE LADDER IS DB → FIXTURE, NEVER DB → EMPTY. A store that is unreachable, or that holds no rows for a
// panel, falls back to the seeded rows and SAYS SO (`meta.status='degraded'` + a non-fatal SOURCE_DEGRADED
// entry, the UW2 vocabulary in schemas/source-ref.schema.json). An empty shelter board and a board with no
// shelters look identical on a screen and mean opposite things; one of them tells an operator there is
// nowhere to send people.
//
// ONE MAPPER PER DATASET, SHARED BY BOTH RUNGS. Each `*View`/`*Of` function below runs the REAL domain or
// application factory, and it is the SAME function the module-load fixture pass runs. That is what makes
// "a row an EM types into Directus is held to every invariant a fixture row is held to" structural rather
// than aspirational: there is no second, laxer path for operator data. A malformed row therefore fails
// LOUDLY (422 VALIDATION_ERROR naming the invariant) instead of rendering as a plausible-looking number.
import { readFileSync } from 'node:fs';
import { isResponder } from '@/domain/app-user.js';
import type { AppUserRole } from '@/domain/app-user.js';
import { DomainError, InvariantViolation, Unauthorized } from '@/domain/errors.js';
import { ok, err } from '@/domain/shared/result.js';
import type { Result } from '@/domain/shared/result.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { IncidentId, OrgId, PublicReportId, ShelterId } from '@/domain/value-objects/ids.js';
import { makeShelter } from '@/domain/shelter.js';
import type { Shelter, ShelterStatus } from '@/domain/shelter.js';
import { makeDamageAssessmentEntry } from '@/domain/damage-assessment.js';
import type {
  AggregateDamageEntry,
  DamageReportCategory,
  DamageSeverity,
  NeedKind,
} from '@/domain/damage-assessment.js';
import type { PublicReportStatus } from '@/domain/public-report.js';
import { makeDamageOverlayProduct } from '@/domain/damage-overlay.js';
import type { AggregateOverlayProduct, OverlayProductType } from '@/domain/damage-overlay.js';
import type { Envelope, SourceRef } from '@/ports/interaction.js';
import type {
  PanelDamageEntryRow,
  PanelDataPort,
  PanelDataset,
  PanelEmsProductRow,
  PanelShelterRow,
  PanelSupplyRow,
  PanelVolunteerTeamRow,
} from '@/ports/panels.js';
import { errorEnvelope } from '@/application/interaction/command-router.js';
import { makeSupplyFields } from '@/application/aggregate/supplies.js';
import type { SupplyFields, SupplyUnit } from '@/application/aggregate/supplies.js';
import { makeVolunteerTeamFields } from '@/application/aggregate/volunteer-team.js';
import type {
  TeamAvailability,
  VolunteerTeamFields,
} from '@/application/aggregate/volunteer-team.js';
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

/** The dependencies every panel read takes. */
export interface PanelDeps {
  /** The injected clock (freshness/asOf — never a wall clock here). */
  readonly clock: () => string;
  /**
   * The operator-maintained store, composed ONLY under `FEATURE_STORE=postgres` (build-core.ts
   * `panelDataStore`). ABSENT is the memory posture and the point of the seam: with no port the handlers
   * run the fixture rung and nothing about the offline/air-gapped/Playwright profiles changes (Art. XVI —
   * the database is a rung, not a requirement).
   */
  readonly panelData?: PanelDataPort;
}

export interface PanelGetRequest {
  readonly role: AppUserRole;
}

function fail(error: DomainError): PanelHttpResult {
  return { status: statusForError(error.code), body: errorEnvelope(error) };
}

/** Unwrap a factory Result; a broken row fails LOUDLY (module load for fixtures, 422 for operator rows). */
function unwrap<T>(res: Result<T, DomainError>): T {
  if (!res.ok) throw res.error;
  return res.value;
}

/** Read + parse one fixtures/coordination/*.json document (CWD-relative — same posture as the module tests). */
function readFixture<T>(name: string): T {
  return JSON.parse(readFileSync(`fixtures/coordination/${name}`, 'utf8')) as T;
}

// ── The rung: which source actually served this request, and how it must be labelled ─────────────────────

/** Why the fixture rung was used when a store WAS configured. Non-fatal, and always stated on the wire. */
const STORE_UNREACHABLE = 'operator store unreachable — showing seeded rows instead';
const STORE_EMPTY = 'operator store holds no rows for this panel — showing seeded rows instead';

/**
 * The rows a panel serves plus the provenance it must claim for them. `fetchedAt` is the row set's LAST
 * EDIT on the `DB` rung and the injected clock on the fixture rung — never the other way round, because a
 * clock read would dress operator data up as freshness nobody measured (ADR-041 §3).
 */
interface PanelRung<V> {
  readonly rows: readonly V[];
  readonly mode: 'DB' | 'MOCK';
  readonly fetchedAt: string;
  /** Set ONLY when a configured store could not serve this panel — the sentence the envelope carries. */
  readonly degradedBecause?: string;
}

/**
 * Resolve a panel's rung: the operator store when it is wired AND has something to say, the seeded fixture
 * otherwise. `map` is the shared per-dataset factory pass, applied here so a malformed operator row becomes
 * a typed `err` rather than an exception escaping into the transport.
 */
async function resolveRung<R, V>(
  deps: PanelDeps,
  read: (port: PanelDataPort) => Promise<Result<PanelDataset<R>, DomainError>>,
  fixture: readonly V[],
  map: (row: R) => V,
): Promise<Result<PanelRung<V>, DomainError>> {
  const seeded = (degradedBecause?: string): Result<PanelRung<V>, DomainError> =>
    ok({
      rows: fixture,
      mode: 'MOCK',
      fetchedAt: deps.clock(),
      ...(degradedBecause !== undefined ? { degradedBecause } : {}),
    });
  if (deps.panelData === undefined) return seeded(); // memory posture — the fixture IS the rung, silently
  const res = await read(deps.panelData);
  if (!res.ok) return seeded(`${STORE_UNREACHABLE} (${res.error.code})`);
  const { rows, lastEditedAt } = res.value;
  // No rows ⇒ nothing to date and nothing to show. Degrading here is the deliberate choice: a freshly
  // migrated, not-yet-populated table would otherwise render an empty board that looks exactly like a real
  // "no shelters" answer. The label is what keeps that honest — the panel says it is showing seeded rows.
  if (rows.length === 0 || lastEditedAt === undefined) return seeded(STORE_EMPTY);
  try {
    return ok({ rows: rows.map(map), mode: 'DB', fetchedAt: lastEditedAt });
  } catch (e) {
    return err(e instanceof DomainError ? e : new InvariantViolation(String(e)));
  }
}

/**
 * The success envelope for a panel. Provenance is one ref naming the dataset and the rung that served it;
 * `freshness` is that ref's instant. A degraded rung additionally carries the sanctioned UW2 degradation
 * block — still a 200 with real data, never a dead-end (Art. XVI).
 */
function served<T>(data: T, sourceId: string, rung: PanelRung<unknown>): PanelHttpResult {
  const provenance: readonly SourceRef[] = [
    { sourceId, mode: rung.mode, fetchedAt: rung.fetchedAt },
  ];
  return {
    status: 200,
    body: {
      data,
      provenance,
      freshness: rung.fetchedAt,
      ...(rung.degradedBecause !== undefined
        ? {
            meta: { status: 'degraded', degraded: true, mode: rung.mode },
            errors: [{ code: 'SOURCE_DEGRADED', message: rung.degradedBecause }],
          }
        : {}),
    },
  };
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

/**
 * Row → view through the REAL factory: every invariant — integer quantity, quantity-requires-unit, closed
 * unit enum — holds on what this route serves, from either rung. `unit` arrives as the `string` a `text`
 * column actually holds; the cast is safe ONLY because `makeSupplyFields` re-checks membership at runtime
 * (`checkUnit`), which is where an operator's typo is caught.
 */
function supplyLotView(row: PanelSupplyRow): SupplyLotView {
  return {
    id: row.id,
    ...unwrap(
      makeSupplyFields({
        ...(row.quantity !== undefined ? { quantity: row.quantity } : {}),
        ...(row.unit !== undefined ? { unit: row.unit as SupplyUnit } : {}),
        ...(row.expiresAt !== undefined ? { expiresAt: row.expiresAt } : {}),
      }),
    ),
  };
}

// The fixture pass runs at MODULE LOAD (the shelters.json precedent), so a broken fixture fails EVERY test
// loudly rather than one request quietly.
const SUPPLY_FIXTURE: readonly SupplyLotView[] = readFixture<{
  supplies: readonly PanelSupplyRow[];
}>('supplies.json').supplies.map(supplyLotView);

/** GET /supplies — the relief-supply stock list. RESPONDER+ (the logistics-dock gate, SPEC §2.2). */
export async function handleSuppliesGet(
  req: PanelGetRequest,
  deps: PanelDeps,
): Promise<PanelHttpResult> {
  if (!isResponder(req.role)) return fail(new Unauthorized('GET /supplies requires RESPONDER+'));
  const rung = await resolveRung(deps, (p) => p.supplies(), SUPPLY_FIXTURE, supplyLotView);
  if (!rung.ok) return fail(rung.error);
  return served<SuppliesGetData>({ supplies: rung.value.rows }, 'relief-supplies', rung.value);
}

// ── GET /volunteer-teams — volunteer team units (FR-D6-1; RESPONDER+) ────────────────────────────────

/** One volunteer TEAM unit: an id plus the FR-D6-1 aggregate fields — a tally and tags, never a roster. */
export type VolunteerTeamView = { readonly id: string } & VolunteerTeamFields;

/** The `data` payload GET /volunteer-teams returns — the ONE declaration of that shape (F-200). */
export interface VolunteerTeamsGetData {
  readonly teams: readonly VolunteerTeamView[];
}

/** Row → view through the REAL factory (callsign pattern, non-negative tally, closed availability enum). */
function volunteerTeamView(row: PanelVolunteerTeamRow): VolunteerTeamView {
  return {
    id: row.id,
    ...unwrap(
      makeVolunteerTeamFields({
        ...(row.callsign !== undefined ? { callsign: row.callsign } : {}),
        ...(row.headcount !== undefined ? { headcount: row.headcount } : {}),
        ...(row.skills !== undefined ? { skills: row.skills } : {}),
        ...(row.availability !== undefined
          ? { availability: row.availability as TeamAvailability }
          : {}),
      }),
    ),
  };
}

const VOLUNTEER_FIXTURE: readonly VolunteerTeamView[] = readFixture<{
  teams: readonly PanelVolunteerTeamRow[];
}>('volunteer-teams.json').teams.map(volunteerTeamView);

/** GET /volunteer-teams — the team-unit registry view. RESPONDER+ (same gate as /resources). */
export async function handleVolunteerTeamsGet(
  req: PanelGetRequest,
  deps: PanelDeps,
): Promise<PanelHttpResult> {
  if (!isResponder(req.role))
    return fail(new Unauthorized('GET /volunteer-teams requires RESPONDER+'));
  const rung = await resolveRung(
    deps,
    (p) => p.volunteerTeams(),
    VOLUNTEER_FIXTURE,
    volunteerTeamView,
  );
  if (!rung.ok) return fail(rung.error);
  return served<VolunteerTeamsGetData>(
    { teams: rung.value.rows },
    'volunteer-registry',
    rung.value,
  );
}

// ── GET /shelter-status — the shelter SUPPLY board (FR-D4-3; RESPONDER+) ─────────────────────────────

/** The `data` payload GET /shelter-status returns: the module's whole board — rows, totals, and the
 *  provenance claim that can only say "live" when the mode IS LIVE (shelter-status.ts header, F-35). */
export interface ShelterStatusGetData {
  readonly board: ShelterStatusBoard;
}

/** Row → domain Shelter through the REAL factory (occupancy ≤ capacity, FULL ⇔ occupancy == capacity). */
function shelterOf(row: PanelShelterRow): Shelter {
  return makeShelter({
    id: asId<ShelterId>(row.id),
    geom: row.geom,
    capacity: row.capacity,
    ...(row.occupancy !== undefined ? { occupancy: row.occupancy } : {}),
    ...(row.status !== undefined ? { status: row.status as ShelterStatus } : {}),
    ...(row.orgId !== undefined ? { orgId: asId<OrgId>(row.orgId) } : {}),
  });
}

const SHELTER_FIXTURE: readonly Shelter[] = readFixture<{ shelters: readonly PanelShelterRow[] }>(
  'shelters.json',
).shelters.map(shelterOf);

/** Seeded rows are illustrative and the board must keep saying so — the A4 requirement, unchanged. */
const SHELTER_SEED_LABEL = 'hand-seeded demo shelters (no shelter source adapter exists — F-35)';
/** `DB` names WHO maintains the row, not where it is stored — that is what tells an operator whether to trust it. */
const SHELTER_DB_LABEL =
  "records the duty officer maintains in BEACON's own store (edited in Directus)";

/**
 * GET /shelter-status — the aggregate shelter board. RESPONDER+. The board's `asOf` is the rung's instant
 * (the injected clock for seeded rows, the LAST EDIT for operator rows) and `provenanceClaim` says exactly
 * which it is: the module was built so this route CANNOT claim live for either (Art. XVI).
 */
export async function handleShelterStatusGet(
  req: PanelGetRequest,
  deps: PanelDeps,
): Promise<PanelHttpResult> {
  if (!isResponder(req.role))
    return fail(new Unauthorized('GET /shelter-status requires RESPONDER+'));
  const rung = await resolveRung(deps, (p) => p.shelters(), SHELTER_FIXTURE, shelterOf);
  if (!rung.ok) return fail(rung.error);
  const { rows, mode, fetchedAt, degradedBecause } = rung.value;
  const seedLabel =
    degradedBecause === undefined
      ? SHELTER_SEED_LABEL
      : `${SHELTER_SEED_LABEL} — ${degradedBecause}`;
  const board = buildShelterStatusBoard({
    shelters: rows,
    provenance: {
      mode,
      sourceLabel: mode === 'DB' ? SHELTER_DB_LABEL : seedLabel,
      asOf: fetchedAt,
    },
  });
  if (!board.ok) return fail(board.error);
  return served<ShelterStatusGetData>({ board: board.value }, 'shelter-board', rung.value);
}

// ── GET /damage-reports — damage/needs assessment (FR-D4-4; RESPONDER+) ──────────────────────────────

/** The `data` payload GET /damage-reports returns: one bucket per triage state, NEVER a grand total —
 *  the module's structural verified/unverified split travels to the wire intact (Art. XIII). */
export interface DamageReportsGetData {
  readonly assessment: DamageAssessment;
}

interface DamageFixtureRow {
  readonly report: {
    readonly id: string;
    readonly status: PublicReportStatus;
    readonly incidentId?: string;
  };
  readonly category: DamageReportCategory;
  readonly severity?: DamageSeverity;
  readonly needKind?: NeedKind;
  readonly siteCount?: number;
}

const DAMAGE_FIXTURE = readFixture<{ incidentId: string; entries: readonly DamageFixtureRow[] }>(
  'damage-entries.json',
);

/** Row → entry through the REAL domain factory — an entry the pipeline could not produce cannot be served. */
function damageEntryOf(row: PanelDamageEntryRow): AggregateDamageEntry {
  return makeDamageAssessmentEntry({
    report: {
      id: asId<PublicReportId>(row.id),
      status: row.reportStatus as PublicReportStatus,
      incidentId: asId<IncidentId>(row.incidentId),
    },
    category: row.category as DamageReportCategory,
    ...(row.severity !== undefined ? { severity: row.severity as DamageSeverity } : {}),
    ...(row.needKind !== undefined ? { needKind: row.needKind as NeedKind } : {}),
    ...(row.siteCount !== undefined ? { siteCount: row.siteCount } : {}),
  });
}

/** The nested fixture row flattened into the ONE row shape both rungs share — a rename, never a factory. */
function damageFixtureRow(e: DamageFixtureRow): PanelDamageEntryRow {
  return {
    id: e.report.id,
    incidentId: e.report.incidentId ?? DAMAGE_FIXTURE.incidentId,
    reportStatus: e.report.status,
    category: e.category,
    ...(e.severity !== undefined ? { severity: e.severity } : {}),
    ...(e.needKind !== undefined ? { needKind: e.needKind } : {}),
    ...(e.siteCount !== undefined ? { siteCount: e.siteCount } : {}),
  };
}

const DAMAGE_ENTRIES: readonly AggregateDamageEntry[] = DAMAGE_FIXTURE.entries
  .map(damageFixtureRow)
  .map(damageEntryOf);

/**
 * Which incident an operator-maintained board is FOR. `damage_assessment_entry` is not a single-incident
 * table (an EM curates rows across activations), while the frozen response carries exactly one assessment,
 * so one incident has to be named: the one the most rows belong to, ties broken by id so the choice is
 * deterministic. Rows belonging to any OTHER incident are still passed to `assessDamage`, which refuses the
 * whole request with CONFLICT naming them — the panel must not quietly drop a damage report.
 */
function dominantIncident(entries: readonly AggregateDamageEntry[], fallback: string): string {
  const counts = new Map<string, number>();
  for (const e of entries)
    counts.set(String(e.incidentId), (counts.get(String(e.incidentId)) ?? 0) + 1);
  return (
    [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).at(0)?.[0] ??
    fallback
  );
}

/** GET /damage-reports — the per-triage-state damage/needs buckets. RESPONDER+ (counts of triage work). */
export async function handleDamageReportsGet(
  req: PanelGetRequest,
  deps: PanelDeps,
): Promise<PanelHttpResult> {
  if (!isResponder(req.role))
    return fail(new Unauthorized('GET /damage-reports requires RESPONDER+'));
  const rung = await resolveRung(deps, (p) => p.damageEntries(), DAMAGE_ENTRIES, damageEntryOf);
  if (!rung.ok) return fail(rung.error);
  // The seeded rung keeps the fixture's own declared incident; the operator rung has to derive one.
  const incidentId =
    rung.value.mode === 'DB'
      ? dominantIncident(rung.value.rows, DAMAGE_FIXTURE.incidentId)
      : DAMAGE_FIXTURE.incidentId;
  const assessment = assessDamage({
    incidentId: asId<IncidentId>(incidentId),
    entries: rung.value.rows,
  });
  if (!assessment.ok) return fail(assessment.error);
  return served<DamageReportsGetData>(
    { assessment: assessment.value },
    'damage-assessment',
    rung.value,
  );
}

// ── GET /ems-overlay — Copernicus EMS damage products, link-only (FR-D4-5; RESPONDER+) ───────────────

/** The `data` payload GET /ems-overlay returns: the attributed, dated, LINK-ONLY overlay (FEV-24). */
export interface EmsOverlayGetData {
  readonly overlay: EmsOverlay;
}

/** Row → product through the REAL factory: attribution, licence and production date are INVARIANTS here. */
function emsProductOf(row: PanelEmsProductRow): AggregateOverlayProduct {
  return makeDamageOverlayProduct({
    productId: row.productId,
    activationCode: row.activationCode,
    productType: row.productType as OverlayProductType,
    areaOfInterest: row.areaOfInterest,
    producedAt: row.producedAt,
    provider: row.provider,
    licence: row.licence,
    viewUrl: row.viewUrl,
  });
}

const EMS_FIXTURE: readonly AggregateOverlayProduct[] = readFixture<{
  products: readonly PanelEmsProductRow[];
}>('ems-products.json').products.map(emsProductOf);

/**
 * GET /ems-overlay — published Copernicus EMS rapid-mapping products as an attributed, dated link-out list.
 * RESPONDER+. `asOf` is the injected clock, so a product "produced after" the evaluation instant lands in
 * `rejected` with its reason rather than rendering a negative age (Art. XVI — the module enforces this).
 * Note the deliberate asymmetry: `asOf` stays the CLOCK even on the `DB` rung, because it is the instant the
 * product ages are measured against, not a provenance claim about the rows.
 */
export async function handleEmsOverlayGet(
  req: PanelGetRequest,
  deps: PanelDeps,
): Promise<PanelHttpResult> {
  if (!isResponder(req.role)) return fail(new Unauthorized('GET /ems-overlay requires RESPONDER+'));
  const rung = await resolveRung(deps, (p) => p.emsProducts(), EMS_FIXTURE, emsProductOf);
  if (!rung.ok) return fail(rung.error);
  const overlay = buildEmsOverlay({ products: rung.value.rows, asOf: deps.clock() });
  if (!overlay.ok) return fail(overlay.error);
  return served<EmsOverlayGetData>({ overlay: overlay.value }, 'copernicus-ems', rung.value);
}
