// BEACON — P16: the OPERATOR-MAINTAINED dock-panel datasets (ADR-041; V2·A12).
// Interface signatures only — no framework/DB/HTTP imports (hexagonal boundary; adapters implement these).
//
// WHY THIS PORT EXISTS. Nothing publishes relief-supply stock, volunteer-team readiness or a shelter's
// occupancy: there is no adapter to write and no feed to poll (F-35/F-154). What exists instead is an
// emergency manager who KNOWS those numbers. This port is that person's data, read back — served as `DB`,
// which SPEC §2.1 defines as an operator-maintained record held in BEACON's own store. It is deliberately
// NOT a `SourceAdapterPort`: there is no upstream to fetch, no cache to keep and no circuit to break.
//
// WHY EVERY CLOSED VOCABULARY BELOW IS `string` AND NOT ITS UNION. These rows come out of `text` columns a
// human types into. Declaring `unit: SupplyUnit` here would be a compile-time claim about a value the
// compiler has not seen and cannot check — the same "a cast is not a validation" defect the raw-EDXL ingest
// path had (F-31). The narrowing happens exactly once, on the read path, when the row is handed to the REAL
// domain factory (`makeSupplyFields`, `makeVolunteerTeamFields`, `makeShelter`, `makeDamageAssessmentEntry`,
// `makeDamageOverlayProduct`) — the same factory the fixture rows go through. A malformed operator row
// therefore fails loudly at the boundary instead of rendering as a plausible-looking number.
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { PointGeometry } from '@/domain/value-objects/geo.js';

/**
 * One panel's rows plus the instant they were last edited.
 *
 * `lastEditedAt` is what a `DB` ref's `fetchedAt` MEANS (ADR-041 §3): the newest `updated_at` across the
 * rows, never a clock read. A store with no rows has nothing to date, so it is absent — and the caller
 * treats that as "this rung has nothing to say" rather than inventing "now".
 */
export interface PanelDataset<R> {
  readonly rows: readonly R[];
  readonly lastEditedAt?: string; // ISO-8601 UTC
}

/** A relief supply LOT. STOCK ONLY — no donor, no payment, no recipient key exists here or downstream. */
export interface PanelSupplyRow {
  /** The NATURAL key (`supply-water-1l`), which is what the operator edits and what the panel serves as id. */
  readonly id: string;
  readonly quantity?: number;
  readonly unit?: string;
  readonly expiresAt?: string;
}

/** A volunteer team UNIT: a callsign, a tally and capability tags — never a roster (Art. XIV). */
export interface PanelVolunteerTeamRow {
  readonly id: string;
  readonly callsign?: string;
  readonly headcount?: number;
  readonly skills?: readonly string[];
  readonly availability?: string;
}

/** A shelter, in the shape `makeShelter` takes. `capacity` is required by the domain; see the adapter. */
export interface PanelShelterRow {
  readonly id: string;
  readonly geom: PointGeometry;
  readonly capacity: number;
  readonly occupancy?: number;
  readonly status?: string;
  readonly orgId?: string;
}

/**
 * One damage/needs observation AND the triage state it was seen in. `incidentId` rides on every row rather
 * than on the dataset because the table is not single-incident: the grouping rule that picks which incident
 * the panel shows is pure, lives at the read site, and is unit-tested without a database.
 */
export interface PanelDamageEntryRow {
  readonly id: string;
  readonly incidentId: string;
  readonly reportStatus: string;
  readonly category: string;
  readonly severity?: string;
  readonly needKind?: string;
  readonly siteCount?: number;
}

/** A published Copernicus EMS product. LINK-ONLY: every field is attribution or a link, never raster. */
export interface PanelEmsProductRow {
  readonly productId: string;
  readonly activationCode: string;
  readonly productType: string;
  readonly areaOfInterest: string;
  readonly producedAt: string;
  readonly provider: string;
  readonly licence: string;
  readonly viewUrl: string;
}

/**
 * P16 — the five operator-maintained panel datasets.
 *
 * Result-returning and NON-THROWING, like every other persistence port: a store that is configured but
 * unreachable must hand the caller an `err` it can label and degrade from, never an exception that empties
 * a shelter board. An empty board and a board with no shelters look identical on a screen and mean opposite
 * things (Art. XVI).
 */
export interface PanelDataPort {
  supplies(): Promise<Result<PanelDataset<PanelSupplyRow>, DomainError>>;
  volunteerTeams(): Promise<Result<PanelDataset<PanelVolunteerTeamRow>, DomainError>>;
  shelters(): Promise<Result<PanelDataset<PanelShelterRow>, DomainError>>;
  damageEntries(): Promise<Result<PanelDataset<PanelDamageEntryRow>, DomainError>>;
  emsProducts(): Promise<Result<PanelDataset<PanelEmsProductRow>, DomainError>>;
}
