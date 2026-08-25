// BEACON — GET /incidents/:id/summary HTTP handler (E7·D6; FR-D6-4, ADR-035 §4, FEATURE_D6_INCIDENT_EXPORT;
// closes F-172). A thin adapter over the PURE, already-guarded `buildIncidentSummary`
// (src/application/aggregate/incident-summary.ts, F-143): RESPONDER+ RBAC (an incident summary is
// responder-tier data — the same gate GET /pre-positioning and GET /resources already use,
// `src/adapters/channels/http/routes/logistics.ts:159,266`, `isResponder(role)`), then `buildIncidentSummary`
// runs Layer D (`guardAggregateOnly`) internally and returns `err` with NOTHING ELSE when it fires — that
// error branch is propagated VERBATIM here and NEVER serialized (see `errorResponse` below; mirrors
// `src/adapters/alerting/alert-sink.ts:121`'s pre-emit re-check pattern that `incident-summary.ts` itself
// already follows).
//
// CSV rendering REUSES the shared `toCsv`/`csvCell` primitive (`src/application/coordination/csv.ts`,
// RFC 4180 + OWASP formula-injection neutralisation, built for the shelter-status export) — this is
// deliberately NOT a second hand-rolled CSV writer (the F-24/F-140/F-141/F-190/F-192 duplication class:
// re-declaring something that already exists instead of deriving/reusing it).
//
// WHY THIS HANDLER RETURNS THE FULL `HttpResponse` SHAPE (not the `{status, body: Envelope}` shape
// map.ts/queue.ts/logistics.ts use): a file export needs a `content-type` + `Content-Disposition` header
// the shared JSON-envelope wrapper (`feature-router.ts`'s `toResponse`) does not carry, so this handler
// builds the transport response directly, remapping DomainError codes to the public SPEC §196 vocabulary
// itself (`apiErrorEnvelope`/`channelErrorEnvelope`, same helpers `toResponse` would have used).
//
// NO LIVE AGGREGATION PIPELINE EXISTS YET for `tasksCompleted`/`tasksTotal`/shelter counts/`affectedAreaKm2`/
// `casualtyTally` (verified: no incident-scoped task, shelter, or casualty store is reachable from the HTTP
// layer — `LogisticsAdapter` exposes no task-listing method, `findShelters` is a location-ranked lookup, not
// an incident-scoped inventory, and `makeCasualtyTally` has no adapter call site). Building that pipeline is
// `src/application/**` work, out of this lane's file set. `buildIncidentSummary`'s OWN contract is that it
// "reads only already-held aggregates" — i.e. the CALLER already holds these numbers — so this route accepts
// them from the caller (the `figures` query param, parsed in `feature-router.ts`) rather than fabricating a
// number this codebase does not yet compute anywhere (Art. XVI: never fake a figure).
import { isResponder } from '@/domain/app-user.js';
import type { AppUserRole } from '@/domain/app-user.js';
import { buildIncidentSummary } from '@/application/aggregate/incident-summary.js';
import type {
  BuildIncidentSummaryInput,
  IncidentSummary,
  IncidentSummaryError,
} from '@/application/aggregate/incident-summary.js';
import { makeCasualtyTally } from '@/application/aggregate/casualty-tally.js';
import type { CasualtyTally, MakeCasualtyTallyInput } from '@/application/aggregate/casualty-tally.js';
import type { IncidentId } from '@/domain/value-objects/ids.js';
import { SOURCE_MODES } from '@/domain/source-record.js';
import type { SourceRecord } from '@/domain/source-record.js';
import { toCsv } from '@/application/coordination/csv.js';
import type { CsvColumn } from '@/application/coordination/csv.js';
import { apiErrorEnvelope, channelErrorEnvelope, statusForError } from '../error-mapping.js';
import type { HttpResponse } from '../http-types.js';

const JSON_HEADERS: Readonly<Record<string, string>> = { 'content-type': 'application/json' };

/**
 * The wire shape of `figures.casualtyTally` — DERIVED from `MakeCasualtyTallyInput`, the input type of the
 * FR-D6-5 factory (F-192 discipline), NOT from `CasualtyTally` itself. That distinction is the whole of
 * finding F-346: `CasualtyTally` carries `label` + `authoritative`, which are SERVER-DERIVED (read from
 * `schemas/d6-casualty-tally.schema.json` by `makeCasualtyTally`), so a wire type that included them invited
 * a caller to supply them — and the route, copying the caller's object by reference into the export
 * document, printed whatever they sent into an official-looking CSV.
 */
export type IncidentSummaryWireCasualtyTally = MakeCasualtyTallyInput;

/** The `figures` query-param wire shape — DERIVED from `BuildIncidentSummaryInput` (F-192 discipline: a
 * wire contract is derived from the type the server actually consumes, never hand-duplicated), everything
 * the pure builder needs EXCEPT `incidentId` (the path segment), `generatedAt` (the injected server
 * clock — Art. XII, a client can never set the document's own timestamp) and the casualty tally, whose
 * caller-owned fields are narrower than the domain value (see `IncidentSummaryWireCasualtyTally`). */
export type IncidentSummaryWireFigures = Omit<
  BuildIncidentSummaryInput,
  'incidentId' | 'generatedAt' | 'casualtyTally'
> & {
  readonly casualtyTally?: IncidentSummaryWireCasualtyTally;
};

export interface IncidentSummaryRequest {
  readonly role: AppUserRole;
  readonly incidentId: IncidentId;
  readonly figures: IncidentSummaryWireFigures;
  readonly format: 'csv' | 'json';
}

export interface IncidentSummaryDeps {
  /** Injected clock — the ONLY source of `generatedAt` (Art. XII: this module never reads a wall clock). */
  readonly clock: () => string;
}

/** Header-injection-safe filename fragment: only `[A-Za-z0-9._-]` survives (an incidentId is normally an
 * opaque slug/UUID, but a Content-Disposition filename must never carry a client-influenced CR/LF/quote). */
const FILENAME_UNSAFE = /[^A-Za-z0-9._-]/g;

function summaryFilename(incidentId: string, format: 'csv' | 'json'): string {
  return `incident-${incidentId.replace(FILENAME_UNSAFE, '_')}-summary.${format}`;
}

/** One row per document (a summary is ONE incident, not a list) — column order is the declared export
 * shape; `??` coerces an absent optional figure to an empty CSV cell rather than the literal string
 * "undefined" (csvCell only accepts string|number). */
const INCIDENT_SUMMARY_CSV_COLUMNS: readonly CsvColumn<IncidentSummary>[] = [
  { header: 'incidentId', value: (s) => s.incidentId },
  { header: 'regionId', value: (s) => s.regionId ?? '' },
  { header: 'generatedAt', value: (s) => s.generatedAt },
  { header: 'closedAt', value: (s) => s.closedAt ?? '' },
  { header: 'alertsIssued', value: (s) => s.alertsIssued },
  { header: 'tasksCompleted', value: (s) => s.tasksCompleted },
  { header: 'tasksTotal', value: (s) => s.tasksTotal ?? '' },
  { header: 'sheltersOpen', value: (s) => s.sheltersOpen ?? '' },
  { header: 'shelterOccupancyPeak', value: (s) => s.shelterOccupancyPeak ?? '' },
  { header: 'shelterCapacityTotal', value: (s) => s.shelterCapacityTotal ?? '' },
  { header: 'affectedAreaKm2', value: (s) => s.affectedAreaKm2 ?? '' },
  { header: 'casualtyTallyCount', value: (s) => s.casualtyTally?.count ?? '' },
  { header: 'casualtyTallyLabel', value: (s) => s.casualtyTally?.label ?? '' },
  { header: 'freshnessFetchedAt', value: (s) => s.freshness.fetchedAt },
  { header: 'provenanceSources', value: (s) => s.provenance.map((p) => `${p.source} (${p.mode})`).join('; ') },
  { header: 'caveats', value: (s) => s.caveats.join(' | ') },
];

/**
 * Layer D's error branch, mapped to a public status/body. `PII_FIELD_FOUND` is deliberately NOT a
 * `DomainErrorCode` (`incident-summary-guard.ts`'s own doc comment: "discriminable on `code`… so a caller
 * can branch without instanceof"), so it is handled here explicitly rather than falling into
 * `statusForError`'s `default: 500` — which would misreport a CAUGHT privacy violation as an opaque internal
 * error instead of the actionable 422 it actually is. The message carries only KEY PATHS (e.g.
 * `casualtyTally.reporterId`), never a value — `guardAggregateOnly` itself never captures the offending
 * value, only its path (`incident-summary-guard.ts`), so nothing PII-shaped can leak through this message.
 *
 * DEPTH, NOT DECORATION — and stated honestly. Since F-346 every object this route hands the builder is
 * REBUILT from named fields (the tally by `makeCasualtyTally`, the provenance rows by `toProvenanceRow`), so
 * no wire key can currently reach Layer D through this route: a forged `casualtyTally.reporterId` is now
 * rejected EARLIER and harder, with a 400 naming the field. This branch stays because the builder's contract
 * is by-reference by design (`incident-summary.ts:74-82` — that is the surface Layer D guards, proven at the
 * application boundary by `src/application/aggregate/incident-summary.test.ts`), so the day another
 * by-reference input is added upstream, the mapping is already here and fail-closed rather than defaulting
 * to `statusForError`'s opaque 500.
 */
function errorResponse(error: IncidentSummaryError): HttpResponse {
  if (error.code === 'PII_FIELD_FOUND') {
    return {
      status: 422,
      body: channelErrorEnvelope(
        'VALIDATION_ERROR',
        `incident summary export blocked: person-identifying field(s) present at ${error.keys.join(', ')} (Art. XIV aggregate-only)`,
      ),
      headers: JSON_HEADERS,
    };
  }
  return { status: statusForError(error.code), body: apiErrorEnvelope(error), headers: JSON_HEADERS };
}

/** A 400 in the PUBLIC SPEC §196 vocabulary — the same shape/status `routing.ts`'s `badRequest` returns. */
function badRequest(message: string): HttpResponse {
  return { status: 400, body: channelErrorEnvelope('VALIDATION_ERROR', message), headers: JSON_HEADERS };
}

/** `{ok:true, value}` or a ready-made rejection response — the `Parsed<T>` shape the router already uses. */
type Checked<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly res: HttpResponse };

// ── F-346. THE CASUALTY TALLY IS RE-DERIVED SERVER-SIDE, NEVER COPIED FROM THE CALLER (Art. XII) ───────────
// `figures` is untrusted client JSON that `feature-router.ts` casts to `IncidentSummaryWireFigures` after
// checking only three fields for PRESENCE. Every other figure on this route is a scalar that
// `buildIncidentSummary`'s `checkFigures` validates; the tally was an OBJECT, and it was carried into the
// document by reference — so a RESPONDER could export `count:-7.5` under the label
// "CONFIRMED by County Coroner — official verified count", `authoritative:true`, and get a 200 text/csv with
// that string in it. Layer D walks key NAMES, so it cannot see a forged VALUE, and it never could.
//
// The fix is not a second validator: it is to route the caller's numbers through the ALREADY-TESTED FR-D6-5
// factory (`makeCasualtyTally`), which owns the count invariant and stamps `label`/`authoritative` from
// `schemas/d6-casualty-tally.schema.json`. So the caveat on the exported figure is a server fact again.
//
// A client-supplied `label`/`authoritative` is REJECTED, NOT SILENTLY DROPPED — the precedent this follows
// verbatim is the client-supplied `actorId` on PATCH /reports (`routing.ts:265-272`): failing loud with the
// public VALIDATION_ERROR vocabulary surfaces a stale or malicious client instead of hiding the misuse, and
// makes the contract explicit — these fields are server-derived, not request inputs. Silent stripping would
// have produced an export that LOOKED like it honoured the request while quietly disagreeing with it.
/** The only tally fields a caller owns. Anything else on the wire object is rejected by name, never dropped. */
const CALLER_OWNED_TALLY_FIELDS: readonly (keyof MakeCasualtyTallyInput)[] = ['reportId', 'count', 'asOf'];
/** Stamped by `makeCasualtyTally` from the schema — named separately so the rejection can say WHY. */
const SERVER_DERIVED_TALLY_FIELDS: readonly string[] = ['label', 'authoritative'];

function tallyFieldProblem(obj: Record<string, unknown>): string | null {
  for (const key of Object.keys(obj)) {
    if (SERVER_DERIVED_TALLY_FIELDS.includes(key)) {
      return `figures.casualtyTally.${key} is derived server-side by the FR-D6-5 factory from schemas/d6-casualty-tally.schema.json (the caveat travels with the number); do not send it`;
    }
    if (!(CALLER_OWNED_TALLY_FIELDS as readonly string[]).includes(key)) {
      return `figures.casualtyTally.${key} is not an accepted field; send only {reportId, count, asOf}`;
    }
  }
  if (typeof obj.count !== 'number') return 'figures.casualtyTally.count is required and must be a number';
  if (obj.reportId !== undefined && typeof obj.reportId !== 'string') {
    return 'figures.casualtyTally.reportId must be a string when present';
  }
  if (obj.asOf !== undefined && typeof obj.asOf !== 'string') {
    return 'figures.casualtyTally.asOf must be a string when present';
  }
  return null;
}

/**
 * Re-derive the tally through `makeCasualtyTally`. Returns `undefined` when the caller sent none (the tally
 * is optional — an incident with no reported casualties exports without one, never with a zero the server
 * invented).
 */
function checkCasualtyTally(raw: unknown): Checked<CasualtyTally | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, res: badRequest('figures.casualtyTally must be a JSON object of {reportId?, count, asOf?}') };
  }
  const obj = raw as Record<string, unknown>;
  const problem = tallyFieldProblem(obj);
  if (problem !== null) return { ok: false, res: badRequest(problem) };

  const built = makeCasualtyTally({
    count: obj.count as number,
    ...(obj.reportId !== undefined ? { reportId: obj.reportId as string } : {}),
    ...(obj.asOf !== undefined ? { asOf: obj.asOf as string } : {}),
  });
  // The factory's own INVARIANT_VIOLATION message names the broken rule (e.g. "must be a non-negative
  // integer"). It is a client-input failure at THIS boundary, so it maps to 400 VALIDATION_ERROR — the same
  // public vocabulary the actorId rejection uses — rather than the 422 the same error earns when it is the
  // SERVER's own already-held figure that is out of domain (`errorResponse` below).
  if (!built.ok) return { ok: false, res: badRequest(built.error.message) };
  return { ok: true, value: built.value as CasualtyTally };
}

// ── F-350. A MALFORMED PROVENANCE ROW IS A TYPED 400, NOT A RAW THROW (Art. XVI) ───────────────────────────
// `feature-router.ts` checks that `figures.provenance` is a non-empty ARRAY and nothing more; the builder
// then maps every row with `String(record.id)`. A single `null` element therefore raised a TypeError that
// escaped `handleHttp` altogether (the dispatcher's sanitising try/catch at http-dispatcher.ts:63 wraps only
// the COMMAND path, never a feature route) — the caller got a framework 500 with NO envelope, which is a
// dead-end, not a labelled degradation. A row of the wrong SHAPE was worse than a throw: it exported a
// document with "undefined (LIVE)" provenance cells, i.e. a figure claiming a source that does not exist.
/** Every field `toProvenanceRow` reads. `mode` is checked against the DOMAIN vocabulary, not a local copy. */
const REQUIRED_PROVENANCE_FIELDS: readonly string[] = ['id', 'source', 'adapter', 'fetchedAt', 'license'];

function provenanceRowProblem(row: unknown, index: number): string | null {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) {
    return `figures.provenance[${index}] must be a SOURCE_RECORD object (Art. XI — provenance is structural, not optional)`;
  }
  const r = row as Record<string, unknown>;
  for (const field of REQUIRED_PROVENANCE_FIELDS) {
    if (typeof r[field] !== 'string' || (r[field] as string).trim() === '') {
      return `figures.provenance[${index}].${field} is required and must be a non-empty string`;
    }
  }
  if (!(SOURCE_MODES as readonly string[]).includes(r.mode as string)) {
    return `figures.provenance[${index}].mode must be one of ${SOURCE_MODES.join('|')} — a cached or mock figure is never exported as LIVE (Art. XVI)`;
  }
  return null;
}

function checkProvenance(rows: readonly unknown[]): Checked<readonly SourceRecord[]> {
  for (const [index, row] of rows.entries()) {
    const problem = provenanceRowProblem(row, index);
    if (problem !== null) return { ok: false, res: badRequest(problem) };
  }
  return { ok: true, value: rows as readonly SourceRecord[] };
}

/**
 * GET /incidents/:id/summary — RESPONDER+. Re-derives every client-supplied figure the server owns
 * (F-346: the casualty tally goes through `makeCasualtyTally`, never a copied reference), validates the
 * untrusted transport shape into a TYPED rejection (F-350), then calls the pure, already-guarded
 * `buildIncidentSummary` and propagates its error branch VERBATIM (never the payload beside it — F-143's own
 * invariant, re-verified here rather than trusted, exactly as `alert-sink.ts:121` re-checks `asEmittable`
 * before serializing).
 */
function exportIncidentSummary(req: IncidentSummaryRequest, deps: IncidentSummaryDeps): HttpResponse {
  if (!isResponder(req.role)) {
    return {
      status: 403,
      body: channelErrorEnvelope('FORBIDDEN', 'GET /incidents/:id/summary requires RESPONDER+'),
      headers: JSON_HEADERS,
    };
  }

  const { casualtyTally: wireTally, provenance: wireProvenance, ...figures } = req.figures;
  const tally = checkCasualtyTally(wireTally);
  if (!tally.ok) return tally.res;
  const provenance = checkProvenance(wireProvenance ?? []);
  if (!provenance.ok) return provenance.res;

  const result = buildIncidentSummary({
    incidentId: String(req.incidentId),
    generatedAt: deps.clock(),
    ...figures,
    provenance: provenance.value,
    // The SERVER's tally, rebuilt from the caller's count by the tested factory — never the caller's object.
    ...(tally.value !== undefined ? { casualtyTally: tally.value } : {}),
  });
  if (!result.ok) return errorResponse(result.error);

  const filename = summaryFilename(String(req.incidentId), req.format);
  const disposition = `attachment; filename="${filename}"`;
  if (req.format === 'csv') {
    return {
      status: 200,
      body: toCsv([result.value], INCIDENT_SUMMARY_CSV_COLUMNS),
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': disposition },
    };
  }
  return {
    status: 200,
    body: result.value,
    headers: { 'content-type': 'application/json', 'content-disposition': disposition },
  };
}

/**
 * F-350's outer half: the LAST-RESORT typed boundary. Everything above returns a typed rejection for every
 * failure it can NAME; this catch exists for the ones it cannot — an injected dependency that throws (the
 * clock), a future figure added to the builder without a shape check here. The dispatcher's sanitising
 * try/catch (`http-dispatcher.ts:63`) covers only the COMMAND path, so without this a throw anywhere under
 * this route escapes `handleHttp` and the caller gets a framework 500 with NO envelope — a dead-end, which
 * Art. XVI forbids. The response carries `{code, message}` ONLY: no stack, no internal message
 * (SECURITY_BASELINE, Art. IV), matching the dispatcher's own non-domain-throw branch verbatim.
 */
export function handleIncidentSummary(req: IncidentSummaryRequest, deps: IncidentSummaryDeps): HttpResponse {
  try {
    return exportIncidentSummary(req, deps);
  } catch {
    return {
      status: 500,
      body: channelErrorEnvelope('INTERNAL_ERROR', 'internal error'),
      headers: JSON_HEADERS,
    };
  }
}
