// BEACON — HTTP feature-route dispatcher (E7·integration; SPEC §2.2, ADR-016/ADR-010/ADR-006, Art. XIII).
// The additive rung wired into handleHttp BEFORE the existing command/system routing: it matches the
// logistics (POST /routes, GET/POST /resources, POST /resource-tasks) + interop (POST /alerts/:id/approve,
// POST/GET /edxl/rm, POST /edxl/sitrep) surfaces onto the sibling feature handlers. Returns null on no match
// so the dispatcher falls through to resolveRoute (reports/alerts/status/…). RBAC is enforced INSIDE each
// feature handler by role rank (Art. XIII); this layer only parses/validates the transport shape and adapts
// the handlers' { status, body } into the channel HttpResponse (reusing channelErrorEnvelope, SPEC §196).
//
// Actor identity (STUB): the approver/actor recorded on a public action is derived from the resolved role
// (`user-<role>`); real per-user identity arrives with full JWT claims (ADR-017). Documented, not hidden.
//
// SSE `/stream` is deliberately NOT handled here: an SSE ReadableStream does not fit the JSON HttpResponse.
// The Next stream delegator (app/api/v1/stream/route.ts) calls handleStream(deps.features) directly.
import { isPosition } from '@/domain/value-objects/geo.js';
import { definedOnly } from '@/domain/shared/guard.js';
import type { Position } from '@/domain/value-objects/geo.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { AppUserId, IncidentId, OrgId, RegionId } from '@/domain/value-objects/ids.js';
import type { AppUserRole } from '@/domain/app-user.js';
import type { EdxlRmMessage } from '@/adapters/interop/edxl-rm-mapper.js';
import type { SitRep } from '@/domain/sitrep.js';
import type { SitRepOptions } from '@/adapters/interop/edxl-sitrep-mapper.js';
import type { ResourceKind, ResourceStatus } from '@/domain/resource.js';
import type { ResourceTaskStatus } from '@/domain/resource-task.js';
import type { AlertId } from '@/domain/value-objects/ids.js';
import type { DomainErrorCode } from '@/domain/errors.js';
import type { HttpDeps, HttpRequest, HttpResponse } from '../http-types.js';
import { channelErrorEnvelope, apiCodeForError } from '../error-mapping.js';
import { makeSpatialPort } from '@/adapters/spatial/index.js';
import {
  handleRoutes,
  handleResourcesGet,
  handleResourcesPost,
  handleResourceTask,
  handlePrePositioning,
} from './logistics.js';
import type { ResourceTaskRequest, ResourcesGetRequest } from './logistics.js';
// The client derives its view of both logistics payloads from the SERVER's own declaration of them; this
// re-export keeps `app/_lib/**` importing ONE server-contract entry point (F-192/F-200/F-190).
export type { ResourcesGetData, ResourceTaskData } from './logistics.js';
import {
  handleAlertApprove,
  handleAlertAllClear,
  handleEdxlRmPost,
  handleEdxlRmGet,
  handleEdxlSitrepPost,
} from './interop.js';
import { handleMapProjection } from './map.js';
import { handleReportsGet, handleAlertsGet } from './queue.js';
import {
  handleSuppliesGet,
  handleVolunteerTeamsGet,
  handleShelterStatusGet,
  handleDamageReportsGet,
  handleEmsOverlayGet,
} from './panels.js';
import type { PanelDeps, PanelGetRequest, PanelHttpResult } from './panels.js';
// The client derives its view of all five dock-panel payloads from the SERVER's own declaration of them;
// this re-export keeps `app/_lib/**` importing ONE server-contract entry point (F-192/F-200/F-190).
export type {
  SuppliesGetData,
  SupplyLotView,
  VolunteerTeamsGetData,
  VolunteerTeamView,
  ShelterStatusGetData,
  DamageReportsGetData,
  EmsOverlayGetData,
} from './panels.js';
import { handleIncidentSummary } from './incident-summary.js';
import type { IncidentSummaryWireFigures } from './incident-summary.js';
import { handleIncidentGet, handleIncidentExposure, type IncidentRoutesDeps } from './incidents.js';
import { handleAdapterHealth } from './adapter-health.js';
import { handleThresholdRules } from './threshold-rules.js';
import { handleAuditEvents } from './audit-events.js';

const JSON_HEADERS: Readonly<Record<string, string>> = { 'content-type': 'application/json' };

/**
 * Remap a feature handler's error envelope (raw DomainError codes from errorEnvelope) onto the stable PUBLIC
 * §196 vocab (FORBIDDEN / STATE_CONFLICT / VALIDATION_ERROR / NOT_FOUND / …), mirroring the command
 * dispatcher's apiErrorEnvelope so the whole HTTP surface speaks ONE public error vocabulary. Success bodies
 * (no errors[]) pass through untouched.
 */
function toPublicBody(body: unknown): unknown {
  if (typeof body !== 'object' || body === null) return body;
  const env = body as { readonly errors?: readonly { readonly code: string; readonly message: string }[] };
  if (env.errors === undefined || env.errors.length === 0) return body;
  return { ...env, errors: env.errors.map((e) => ({ ...e, code: apiCodeForError(e.code as DomainErrorCode) })) };
}

/** A transport-neutral { status, body } result from a feature handler → the channel HttpResponse. */
function toResponse(result: { readonly status: number; readonly body: unknown }): HttpResponse {
  return { status: result.status, body: toPublicBody(result.body), headers: JSON_HEADERS };
}

/** A 400 VALIDATION_ERROR (SPEC §196) for a malformed/invalid transport shape. */
function badRequest(message: string): HttpResponse {
  return { status: 400, body: channelErrorEnvelope('VALIDATION_ERROR', message), headers: JSON_HEADERS };
}

/** Parse-outcome: a valid typed request, or a ready-to-return error response. */
type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly res: HttpResponse };

/** A parse failure carrying a 400 body (kept tiny so parsers stay under the complexity budget). */
const parseFail = (message: string): { readonly ok: false; readonly res: HttpResponse } => ({ ok: false, res: badRequest(message) });

/** A non-empty trimmed string, else undefined. */
const optStr = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value : undefined);

/** A branded OrgId from a non-empty string, else undefined. */
const optOrg = (value: unknown): OrgId | undefined => {
  const s = optStr(value);
  return s !== undefined ? asId<OrgId>(s) : undefined;
};

/** Split a path into the segments AFTER `/api/v1` (empty array for the bare base path). */
function featureSegments(path: string): readonly string[] {
  const clean = path.replace(/\/+$/, '');
  const stripped = clean.startsWith('/api/v1') ? clean.slice('/api/v1'.length) : clean;
  return stripped.split('/').filter((s) => s.length > 0);
}

/** Parse a raw JSON body into a plain object, or null on malformed / non-object input. */
function parseBody(body: string | undefined): Record<string, unknown> | null {
  if (body === undefined || body.trim() === '') return null;
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Read a [lon,lat] Position from an unknown value, or null when it is not a valid position. */
function asPosition(value: unknown): Position | null {
  return isPosition(value) ? value : null;
}

// ── POST /routes ────────────────────────────────────────────────────────────────────────────────

/**
 * The EXACT JSON body POST /routes accepts — the ONE declaration of that wire shape (F-361/F-364).
 *
 * `app/_lib/types.ts` re-exports this AS `RequestRouteBody`, exactly as it does `ResourceTaskWireBody`
 * (F-140). The hand-written mirror it replaces declared `origin: {lat, lon}` — an OBJECT where this parser
 * reads a `[lon, lat]` POSITION — and omitted `destination` entirely, which the handler then hard-required.
 * Two independent mismatches meant `POST /routes` 400'd on **every** real submit: the evacuation panel was
 * dead in the shipped product while `tsc` reported 0 errors and the panel's component test passed, because
 * that test mocks the mutation hook and never builds a real request.
 *
 * `destination` stays optional here because `openapi.yaml` always documented it so; `handleRoutes` now
 * resolves the nearest open shelter when it is absent (see `resolveDestination` in logistics.ts).
 */
export type RouteWireBody = {
  /** `[lon, lat]` — GeoJSON axis order, as everywhere else in the domain. NOT `{lat, lon}`. */
  readonly origin: Position;
  /** Optional; omitted ⇒ the server routes to the nearest OPEN shelter (Art. XII: the server ranks). */
  readonly destination?: Position;
  readonly incidentId: string;
  readonly avoidHazard?: boolean;
};

/**
 * Read the OPTIONAL destination. Three outcomes, deliberately distinct: absent ⇒ legal, the server resolves
 * the nearest open shelter; present and valid ⇒ use it; **present but malformed ⇒ REJECT**. Silently
 * ignoring a destination the caller meant would route an evacuee somewhere else entirely, which is far
 * worse than a 400. Extracted to keep `parseRoutes` inside the Gate-6 complexity budget.
 */
function parseDestination(raw: unknown): Parsed<Position | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  const to = asPosition(raw);
  return to === null ? parseFail('destination must be [lon,lat]') : { ok: true, value: to };
}

function parseRoutes(body: string | undefined): Parsed<Parameters<typeof handleRoutes>[0]> {
  const b = parseBody(body);
  if (b === null) return parseFail('malformed or empty JSON body');
  // Keyed by `keyof RouteWireBody`, so renaming a wire field is a compile error here rather than a field
  // that silently reads `undefined` and 400s in a browser.
  const wireField = <K extends keyof RouteWireBody>(key: K): unknown => b[key];
  const incidentId = wireField('incidentId');
  if (typeof incidentId !== 'string' || incidentId.trim() === '') return parseFail('incidentId required');
  // `from`/`to` remain accepted as aliases: they are the server-side vocabulary this route has always also
  // honoured, and dropping them would break existing non-browser callers for no benefit.
  const from = asPosition(wireField('origin') ?? b.from);
  if (from === null) return parseFail('origin [lon,lat] required');
  const destination = parseDestination(wireField('destination') ?? b.to);
  if (!destination.ok) return destination;
  const avoidHazard = wireField('avoidHazard');
  return {
    ok: true,
    value: {
      incidentId: asId<IncidentId>(incidentId),
      from,
      ...(destination.value !== undefined ? { to: destination.value } : {}),
      ...(typeof avoidHazard === 'boolean' ? { avoidHazard } : {}),
    },
  };
}

async function routesRoute(req: HttpRequest, deps: HttpDeps): Promise<HttpResponse> {
  const parsed = parseRoutes(req.body);
  if (!parsed.ok) return parsed.res;
  const { routing, logistics, clock, hazardArrivalFor } = deps.features;
  return toResponse(
    await handleRoutes(parsed.value, {
      routing,
      logistics,
      clock,
      ...(hazardArrivalFor !== undefined ? { hazardArrivalFor } : {}),
    }),
  );
}

// ── GET /resources ──────────────────────────────────────────────────────────────────────────────

/** Compile-time assertion helper: `Assert<false>` is a type error, so a broken proof BREAKS THE BUILD. */
type Assert<T extends true> = T;

/**
 * The wire QUERY vocabulary of GET /resources → the `ResourcesGetRequest` field each param feeds. This map
 * is the ONE place the two vocabularies meet (the wire says `org`, the request says `orgId`); every other
 * statement about the query contract — on the server AND in the browser client — is derived from it.
 */
type ResourcesQueryFieldMap = {
  readonly incidentId: 'incidentId';
  readonly org: 'orgId';
};

/**
 * Proof that the map is TOTAL: every field of `ResourcesGetRequest` a CLIENT may supply (i.e. all but
 * `role`, which the server derives from the resolved auth principal and a client must never send) is named
 * by some wire param. Add a client-suppliable field to `ResourcesGetRequest` without giving it a query
 * param and this line fails to compile — the contract cannot silently grow a param the client never sends.
 */
export type ResourcesQueryIsTotal = Assert<
  Exclude<keyof ResourcesGetRequest, 'role'> extends ResourcesQueryFieldMap[keyof ResourcesQueryFieldMap] ? true : false
>;

/** The wire params whose backing request field is REQUIRED — derived, never asserted by hand. */
type RequiredResourcesQueryKey = {
  [W in keyof ResourcesQueryFieldMap]: undefined extends ResourcesGetRequest[ResourcesQueryFieldMap[W]] ? never : W;
}[keyof ResourcesQueryFieldMap];

/**
 * The exact query string GET /resources accepts — DERIVED, exactly as `ResourceTaskWireBody` derives the
 * POST body (F-140). F-192: `api.getResources()` took NO arguments and fetched a bare `/resources`, while
 * this route hard-fails `badRequest('incidentId query param required')` — so the logistics board 400'd on
 * every real page load with `tsc` at 0 errors, because nothing tied the two sides together.
 *
 * Values are plain `string` because a query string is always plain text; the branded `asId<IncidentId>` /
 * `asId<OrgId>` ACL casts happen exactly once, at this boundary, below. OPTIONALITY, however, is derived
 * from `ResourcesGetRequest` itself: `incidentId` is required here *because* it is required there. Make it
 * optional server-side and this type follows automatically; add a new REQUIRED field and every client call
 * site becomes a compile error instead of a runtime 400.
 *
 * `app/_lib/types.ts` re-exports this type AS `ResourcesQuery` and `api.getResources` takes it as a
 * REQUIRED parameter, so "call the endpoint with no query at all" is no longer expressible.
 */
export type ResourcesWireQuery = {
  readonly [W in RequiredResourcesQueryKey]: string;
} & {
  readonly [W in Exclude<keyof ResourcesQueryFieldMap, RequiredResourcesQueryKey>]?: string;
};

async function resourcesGetRoute(req: HttpRequest, role: AppUserRole, deps: HttpDeps): Promise<HttpResponse> {
  // Keyed by `keyof ResourcesWireQuery` (not a bare string literal), so renaming a wire param is a compile
  // error HERE too — the same discipline `wireField` applies to the POST /resource-tasks body.
  const queryParam = <K extends keyof ResourcesWireQuery>(key: K): unknown => req.query?.[key];
  const incidentId = optStr(queryParam('incidentId'));
  if (incidentId === undefined) return badRequest('incidentId query param required');
  const orgId = optOrg(queryParam('org'));
  const request = {
    role,
    incidentId: asId<IncidentId>(incidentId),
    ...(orgId !== undefined ? { orgId } : {}),
  };
  const { logistics, clock } = deps.features;
  return toResponse(await handleResourcesGet(request, { logistics, clock }));
}

// ── GET /pre-positioning — advisory resource/shelter suggestions near the projected extent (W2d) ────────

async function prePositioningRoute(req: HttpRequest, role: AppUserRole, deps: HttpDeps): Promise<HttpResponse> {
  const incidentId = req.query?.incidentId;
  if (typeof incidentId !== 'string' || incidentId.trim() === '') return badRequest('incidentId query param required');
  const { logistics, clock, spatial, projectedExtentFor } = deps.features;
  return toResponse(
    await handlePrePositioning(
      { role, incidentId: asId<IncidentId>(incidentId) },
      {
        logistics,
        clock,
        spatial: spatial ?? makeSpatialPort(),
        ...(projectedExtentFor !== undefined ? { projectedExtentFor } : {}),
      },
    ),
  );
}

// ── GET /incidents/:id/summary — FR-D6-4 incident-close export, CSV/JSON + Content-Disposition ──────────
// (ADR-035 §4; F-172, F-143, F-35). FEATURE_D6_INCIDENT_EXPORT-gated HERE, at the transport level — mirrors
// handleDevLogin's posture (http-dispatcher.ts): OFF ⇒ the SAME generic 404 an unmatched route returns,
// never revealing that the route exists but is merely disabled. Defaults ON (config/index.ts).
//
// `figures` carries the already-computed input `buildIncidentSummary` needs (everything except `incidentId`
// and `generatedAt` — see `IncidentSummaryWireFigures`'s own doc comment in incident-summary.ts for WHY: no
// live aggregation pipeline for tasks/shelters/casualties is reachable from this HTTP layer today). Minimal
// transport-shape validation happens HERE (malformed JSON, missing required fields) so a caller gets an
// actionable 400 instead of a document silently missing a schema-required field; `buildIncidentSummary`
// itself still re-validates every figure (defense in depth, not redundant — this layer only checks
// PRESENCE/rough shape of the three genuinely required wire fields).
function incidentExportEnabled(env: Record<string, string | undefined>): boolean {
  return (env.FEATURE_D6_INCIDENT_EXPORT ?? 'on').toLowerCase() === 'on';
}

/** JSON.parse, remapped to a Parsed-friendly result (never throws out). */
function tryParseJson(raw: string): { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly message: string } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, message: 'figures query param must be valid JSON' };
  }
}

/** The three genuinely-required wire fields (everything else `buildIncidentSummary` itself validates). */
function figuresShapeProblem(obj: Record<string, unknown>): string | null {
  if (typeof obj.alertsIssued !== 'number') return 'figures.alertsIssued is required and must be a number';
  if (typeof obj.tasksCompleted !== 'number') return 'figures.tasksCompleted is required and must be a number';
  if (!Array.isArray(obj.provenance) || obj.provenance.length === 0) {
    return 'figures.provenance is required and must be a non-empty array';
  }
  return null;
}

function parseIncidentSummaryFigures(raw: string | undefined): Parsed<IncidentSummaryWireFigures> {
  if (raw === undefined || raw.trim() === '') {
    return parseFail('figures query param required (JSON-encoded already-computed incident aggregates)');
  }
  const parsedJson = tryParseJson(raw);
  if (!parsedJson.ok) return parseFail(parsedJson.message);
  const { value: parsed } = parsedJson;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return parseFail('figures query param must be a JSON object');
  }
  const obj = parsed as Record<string, unknown>;
  const problem = figuresShapeProblem(obj);
  if (problem !== null) return parseFail(problem);
  return { ok: true, value: obj as unknown as IncidentSummaryWireFigures };
}

async function incidentSummaryRoute(id: string, req: HttpRequest, role: AppUserRole, deps: HttpDeps): Promise<HttpResponse> {
  if (!incidentExportEnabled(deps.env)) {
    return { status: 404, body: channelErrorEnvelope('NOT_FOUND', 'no such route'), headers: JSON_HEADERS };
  }
  const incidentId = id.trim();
  if (incidentId === '') return badRequest('incident id required');
  const figures = parseIncidentSummaryFigures(req.query?.figures);
  if (!figures.ok) return figures.res;
  const format: 'csv' | 'json' = req.query?.format === 'csv' ? 'csv' : 'json';
  return handleIncidentSummary(
    { role, incidentId: asId<IncidentId>(incidentId), figures: figures.value, format },
    { clock: deps.features.clock },
  );
}

// ── POST /resources ─────────────────────────────────────────────────────────────────────────────

function parseResourcePost(body: string | undefined, role: AppUserRole, newId: (p: string) => string): Parsed<Parameters<typeof handleResourcesPost>[0]> {
  const b = parseBody(body);
  if (b === null) return parseFail('malformed or empty JSON body');
  const kind = optStr(b.kind);
  if (kind === undefined) return parseFail('kind required');
  const status = typeof b.status === 'string' ? (b.status as ResourceStatus) : undefined;
  const orgId = optOrg(b.org ?? b.orgId);
  const geom = isPositionGeom(b.geom) ? b.geom : undefined;
  return {
    ok: true,
    value: {
      role,
      id: optStr(b.id) ?? newId('resource'),
      kind: kind as ResourceKind,
      ...(status !== undefined ? { status } : {}),
      ...(orgId !== undefined ? { orgId } : {}),
      ...(geom !== undefined ? { geom } : {}),
    },
  };
}

/** Narrow an unknown value to a GeoJSON Point (the only geom a Resource carries). */
function isPositionGeom(value: unknown): value is { readonly type: 'Point'; readonly coordinates: Position } {
  if (typeof value !== 'object' || value === null) return false;
  const g = value as { type?: unknown; coordinates?: unknown };
  return g.type === 'Point' && isPosition(g.coordinates);
}

async function resourcesPostRoute(req: HttpRequest, role: AppUserRole, deps: HttpDeps): Promise<HttpResponse> {
  const { logistics, clock, newId } = deps.features;
  const parsed = parseResourcePost(req.body, role, newId);
  if (!parsed.ok) return parsed.res;
  return toResponse(await handleResourcesPost(parsed.value, { logistics, clock, register: logistics.register }));
}

// ── POST /resource-tasks ──────────────────────────────────────────────────────────────────────

/**
 * The exact JSON wire shape POST /resource-tasks accepts — DERIVED from `ResourceTaskRequest` (the very
 * type `handleResourceTask` in logistics.ts consumes) rather than hand-duplicated (F-140: the former
 * `TaskResourceBody` in app/_lib/types.ts was a free-standing client-side copy that drifted in BOTH the
 * field name — `transition` vs the server's `status` — AND the optionality of `incidentId` at once; a
 * correct-but-duplicated type would still have drifted later). `role` is excluded: the server derives it
 * from the resolved auth principal and a client must never set it.
 *
 * F-191: `id` used to be excluded too, and that omission — not any parsing bug — is why the board could
 * only ever CREATE. `parseResourceTask` has ALWAYS read `optStr(b.id) ?? newId('task')`, so posting a known
 * task id ADVANCES that task (`memory-logistics.advanceTask` → `stepTask`) while omitting it MINTS a new
 * one, which the domain requires to start at PROPOSED. The wire type said only "create" existed, so the
 * board offered TASKED for a task that did not exist yet and every default click 409'd
 * (`a new resource task must start at PROPOSED, got TASKED`). Declaring `id` OPTIONAL states the endpoint's
 * real, already-implemented semantics — absent ⇒ create at PROPOSED, present ⇒ advance one legal forward
 * hop — and grants the client no capability the parser did not already honour; it simply stops the type
 * from hiding half the endpoint. (The alternative, relaxing `createTask` to accept any start status, would
 * have deleted the EV9 lifecycle invariant to make one dropdown convenient — see the finding.)
 *
 * `incidentId` is a flat `string` here (not the branded `IncidentId`) because the WIRE is always plain
 * JSON — the ACL cast (`asId<IncidentId>` below) happens exactly once, at this boundary. `status` is
 * REQUIRED client-side (the UI always resolves a target step before it enables the control) even though
 * `ResourceTaskRequest.status` is optional for other (server-internal) callers that accept the domain
 * default of PROPOSED.
 *
 * `app/_lib/types.ts` re-exports this type AS `TaskResourceBody` (`export type { ResourceTaskWireBody as
 * TaskResourceBody } from '@/adapters/channels/http/routes/feature-router.js'`) instead of re-declaring
 * it, so a server-side rename/retype of any field here becomes a CLIENT compile error, not a silent 400 in
 * a real browser — the class of bug F-140 records becomes structurally inexpressible, not merely tested for.
 */
export type ResourceTaskWireBody = {
  /** Absent ⇒ CREATE a new task (server-minted id, must start at PROPOSED). Present ⇒ ADVANCE that task. */
  readonly id?: ResourceTaskRequest['id'];
  readonly resourceId: ResourceTaskRequest['resourceId'];
  readonly incidentId: string;
  readonly status: NonNullable<ResourceTaskRequest['status']>;
  readonly shelterId?: ResourceTaskRequest['shelterId'];
};

function parseResourceTask(body: string | undefined, role: AppUserRole, newId: (p: string) => string): Parsed<Parameters<typeof handleResourceTask>[0]> {
  const b = parseBody(body);
  if (b === null) return parseFail('malformed or empty JSON body');
  // Every raw-JSON read below is keyed by `keyof ResourceTaskWireBody` (not a bare string literal), so a
  // future rename of a wire field is a compile error HERE too — not just in the client's derived type.
  const wireField = <K extends keyof ResourceTaskWireBody>(key: K): unknown => b[key];
  const resourceId = optStr(wireField('resourceId'));
  const incidentId = optStr(wireField('incidentId'));
  if (resourceId === undefined) return parseFail('resourceId required');
  if (incidentId === undefined) return parseFail('incidentId required');
  const rawStatus = wireField('status');
  const status = typeof rawStatus === 'string' ? (rawStatus as ResourceTaskStatus) : undefined;
  const shelterId = optStr(wireField('shelterId'));
  return {
    ok: true,
    value: {
      role,
      // Keyed through `wireField` like every other read (F-191): `id` is now part of the declared wire
      // contract, so this is no longer the one field the type pretended did not exist.
      id: optStr(wireField('id')) ?? newId('task'),
      resourceId,
      incidentId: asId<IncidentId>(incidentId),
      ...(status !== undefined ? { status } : {}),
      ...(shelterId !== undefined ? { shelterId } : {}),
    },
  };
}

async function resourceTaskRoute(req: HttpRequest, role: AppUserRole, deps: HttpDeps): Promise<HttpResponse> {
  const { logistics, clock, newId } = deps.features;
  const parsed = parseResourceTask(req.body, role, newId);
  if (!parsed.ok) return parsed.res;
  return toResponse(await handleResourceTask(parsed.value, { logistics, clock }));
}

// ── POST /alerts/:id/approve — the HITL emit gate (Art. XIII) ────────────────────────────────────

async function alertApproveRoute(alertId: string, req: HttpRequest, role: AppUserRole, deps: HttpDeps, actor: string): Promise<HttpResponse> {
  // approvedBy is the server-derived TRUE actor (verified JWT `sub`, else role key) — one identity value
  // across the whole HTTP surface (unifies the former divergent `user-<role>` stub with the verify actor).
  // The OPTIONAL body `lang` is the approver's UI locale, used ONLY to render the bilingual broadcast
  // headline; it is coerced through the locale allowlist downstream, so a hostile value cannot select a
  // dynamic-import path or change any decision (NFR-F7). Malformed/absent body ⇒ English-only broadcast.
  const lang = parseBody(req.body)?.lang;
  return toResponse(
    await handleAlertApprove(
      {
        alertId: asId<AlertId>(alertId),
        actorRole: role,
        approvedBy: asId<AppUserId>(actor),
        ...(typeof lang === 'string' ? { lang } : {}),
      },
      deps.features.interop,
    ),
  );
}

// ── POST /alerts/:id/all-clear — author the ALL-CLEAR draft (D3.2; ADR-036 §2) ───────────────────
//
// Creates a DRAFT and emits NOTHING. An all-clear is a public message — telling people a hazard is over can
// send them back into it — so it goes through the SAME `/alerts/:id/approve` gate as the warning it clears.
// There is no second emit path (Art. XIII).

async function alertAllClearRoute(alertId: string, req: HttpRequest, role: AppUserRole, deps: HttpDeps): Promise<HttpResponse> {
  const body = (parseBody(req.body) ?? {}) as Record<string, unknown>;
  const text = (key: string): string | undefined =>
    typeof body[key] === 'string' && body[key] !== '' ? (body[key] as string) : undefined;
  return toResponse(
    await handleAlertAllClear(
      definedOnly({
        alertId: asId<AlertId>(alertId),
        actorRole: role,
        headline: text('headline'),
        description: text('description'),
        instruction: text('instruction'),
      }) as Parameters<typeof handleAlertAllClear>[0],
      deps.features.interop,
    ),
  );
}

// ── EDXL interop ────────────────────────────────────────────────────────────────────────────────

async function edxlRmPostRoute(req: HttpRequest, role: AppUserRole, deps: HttpDeps): Promise<HttpResponse> {
  const b = parseBody(req.body);
  if (b === null) return badRequest('malformed or empty JSON body');
  return toResponse(await handleEdxlRmPost({ actorRole: role, message: b as unknown as EdxlRmMessage }, deps.features.interop));
}

async function edxlRmGetRoute(id: string, role: AppUserRole, deps: HttpDeps): Promise<HttpResponse> {
  return toResponse(await handleEdxlRmGet({ actorRole: role, id }, deps.features.interop));
}

async function edxlSitrepPostRoute(req: HttpRequest, role: AppUserRole, deps: HttpDeps): Promise<HttpResponse> {
  const b = parseBody(req.body);
  if (b === null) return badRequest('malformed or empty JSON body');
  const sitrep = b.sitrep as unknown as SitRep;
  const options = b.options as SitRepOptions | undefined;
  return toResponse(
    await handleEdxlSitrepPost(
      { actorRole: role, sitrep, ...(options !== undefined ? { options } : {}) },
      deps.features.interop,
    ),
  );
}

// ── GET /regions/:id/map — the COP geometry projection (PUBLIC-readable; precise geom RESPONDER-gated) ──

async function mapRoute(regionId: string, role: AppUserRole, deps: HttpDeps): Promise<HttpResponse> {
  return toResponse(
    await handleMapProjection({ regionId: asId<RegionId>(regionId), role }, { map: deps.features.map }),
  );
}

// ── GET /reports (verifier queue, VERIFIER+; precise geom RESPONDER+) + GET /alerts (DRAFT queue, VERIFIER+) ──

async function reportsGetRoute(req: HttpRequest, role: AppUserRole, deps: HttpDeps): Promise<HttpResponse> {
  // Strict query posture (same as /resources): the only defined value is `pending`; anything else is a
  // 400, never a silent unfiltered response that LOOKS like the queue but resurrects decided reports.
  const status = req.query?.['status'];
  if (status !== undefined && status !== 'pending') {
    return badRequest('status must be "pending" when present');
  }
  return toResponse(
    await handleReportsGet(
      { role, ...(status === 'pending' ? { status } : {}) },
      { reports: deps.reports, clock: deps.features.clock },
    ),
  );
}

async function alertsGetRoute(role: AppUserRole, deps: HttpDeps): Promise<HttpResponse> {
  return toResponse(await handleAlertsGet({ role }, { alerts: deps.features.interop.alerts, clock: deps.features.clock }));
}

// ── GET /incidents/:id + GET /incidents/:id/exposure — the two incident reads (register rows 14-15) ─────
//
// Both resolve the incident through the SHARED core (deps.interaction), so the incident contract and its
// PUBLIC rank keep exactly one declaration; exposure then reuses the shipped COP derivation via the SAME
// MapReadModel that backs GET /regions/:id/map. See routes/incidents.ts for the honest region-scope note.

function incidentRoutesDeps(deps: HttpDeps): IncidentRoutesDeps {
  return { interaction: deps.interaction, map: deps.features.map, clock: deps.features.clock };
}

/** The optional `?regionId=` narrowing hint shared by both incident reads (absent ⇒ walk the registry). */
function incidentRegionHint(req: HttpRequest): { regionId?: RegionId } {
  const raw = req.query?.regionId;
  return raw !== undefined && raw.trim() !== '' ? { regionId: asId<RegionId>(raw) } : {};
}

async function incidentGetRoute(id: string, req: HttpRequest, role: AppUserRole, deps: HttpDeps): Promise<HttpResponse> {
  const incidentId = id.trim();
  if (incidentId === '') return badRequest('incident id required');
  return toResponse(
    await handleIncidentGet(
      { incidentId: asId<IncidentId>(incidentId), role, ...incidentRegionHint(req) },
      incidentRoutesDeps(deps),
    ),
  );
}

async function incidentExposureRoute(id: string, req: HttpRequest, role: AppUserRole, deps: HttpDeps): Promise<HttpResponse> {
  const incidentId = id.trim();
  if (incidentId === '') return badRequest('incident id required');
  return toResponse(
    await handleIncidentExposure(
      { incidentId: asId<IncidentId>(incidentId), role, ...incidentRegionHint(req) },
      incidentRoutesDeps(deps),
    ),
  );
}

// ── GET /health/adapters, /threshold-rules, /audit-events — the three governance/ops reads (rows 16-18) ──

async function adapterHealthRoute(req: HttpRequest, role: AppUserRole, deps: HttpDeps): Promise<HttpResponse> {
  const regionId = req.query?.regionId;
  return toResponse(
    await handleAdapterHealth(
      { role, ...(regionId !== undefined && regionId.trim() !== '' ? { regionId: asId<RegionId>(regionId) } : {}) },
      { interaction: deps.interaction, clock: deps.features.clock },
    ),
  );
}

async function thresholdRulesRoute(role: AppUserRole, deps: HttpDeps): Promise<HttpResponse> {
  return toResponse(
    await handleThresholdRules({ role }, { rules: deps.features.thresholdRules ?? [], clock: deps.features.clock }),
  );
}

/**
 * Parse an optional non-negative integer query param. A present-but-malformed value is REJECTED with a 400
 * rather than coerced to a default: silently paging from row 0 because `?offset=abc` parsed to NaN would
 * make an auditor believe they had read the whole chain.
 */
function parsePageParam(raw: string | undefined, name: string): Parsed<number | undefined> {
  if (raw === undefined || raw.trim() === '') return { ok: true, value: undefined };
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    return parseFail(`${name} must be a non-negative integer when present`);
  }
  return { ok: true, value };
}

async function auditEventsRoute(req: HttpRequest, role: AppUserRole, deps: HttpDeps): Promise<HttpResponse> {
  const limit = parsePageParam(req.query?.limit, 'limit');
  if (!limit.ok) return limit.res;
  const offset = parsePageParam(req.query?.offset, 'offset');
  if (!offset.ok) return offset.res;
  return toResponse(
    await handleAuditEvents(
      { role, ...(limit.value !== undefined ? { limit: limit.value } : {}), ...(offset.value !== undefined ? { offset: offset.value } : {}) },
      // The SHARED hash chain the CAP emission path writes to (AlertSink.audit) — not a second log.
      { audit: deps.features.interop.sink.audit, clock: deps.features.clock },
    ),
  );
}

// ── GET /supplies, /volunteer-teams, /shelter-status, /damage-reports, /ems-overlay — dock panels ────────
// (S3·U1/U2; ADR-035 §4 / ADR-036 §7). Flag-gated HERE, at the transport level — the incident-summary
// posture (see incidentExportEnabled above): OFF ⇒ the SAME generic 404 an unmatched route returns, never
// revealing that the route exists but is merely disabled. All five flags default ON (config/index.ts) and
// are pinned OFF in the Playwright gate profile. RBAC (RESPONDER+) lives in the handlers (panels.ts).

/** One dock-panel route row: the server flag that gates it + the pure handler it dispatches to. */
interface DockPanelRoute {
  readonly flag: string;
  readonly handle: (req: PanelGetRequest, deps: PanelDeps) => PanelHttpResult;
}

/** Path segment → its flag + handler. Data-driven so `matchGetDockPanel` stays under the complexity gate. */
const DOCK_PANEL_ROUTES: Readonly<Record<string, DockPanelRoute>> = {
  'supplies': { flag: 'FEATURE_D6_SUPPLIES', handle: handleSuppliesGet },
  'volunteer-teams': { flag: 'FEATURE_D6_VOLUNTEER_TEAMS', handle: handleVolunteerTeamsGet },
  'shelter-status': { flag: 'FEATURE_D4_SHELTER_STATUS', handle: handleShelterStatusGet },
  'damage-reports': { flag: 'FEATURE_D4_DAMAGE_REPORTS', handle: handleDamageReportsGet },
  'ems-overlay': { flag: 'FEATURE_D4_EMS_OVERLAY', handle: handleEmsOverlayGet },
};

/** A dock-panel flag read off the RAW env — default ON, matching the validated EnvSchema default. */
function dockPanelEnabled(env: Record<string, string | undefined>, flag: string): boolean {
  return (env[flag] ?? 'on').toLowerCase() === 'on';
}

function dockPanelRoute(entry: DockPanelRoute, role: AppUserRole, deps: HttpDeps): Promise<HttpResponse> {
  if (!dockPanelEnabled(deps.env, entry.flag)) {
    return Promise.resolve({ status: 404, body: channelErrorEnvelope('NOT_FOUND', 'no such route'), headers: JSON_HEADERS });
  }
  return Promise.resolve(toResponse(entry.handle({ role }, { clock: deps.features.clock })));
}

/** The five single-segment dock-panel GETs, matched AFTER matchGetSingle. Null when no panel route matches. */
function matchGetDockPanel(seg: string, role: AppUserRole, deps: HttpDeps): Promise<HttpResponse> | null {
  const entry = DOCK_PANEL_ROUTES[seg];
  return entry === undefined ? null : dockPanelRoute(entry, role, deps);
}

// ── Route tables ──────────────────────────────────────────────────────────────────────────────

/** Single-segment GET feature routes: /resources, /reports, /alerts, /pre-positioning, /threshold-rules, /audit-events. */
function matchGetSingle(seg: string, req: HttpRequest, role: AppUserRole, deps: HttpDeps): Promise<HttpResponse> | null {
  if (seg === 'resources') return resourcesGetRoute(req, role, deps);
  if (seg === 'reports') return reportsGetRoute(req, role, deps);
  if (seg === 'alerts') return alertsGetRoute(role, deps);
  if (seg === 'pre-positioning') return prePositioningRoute(req, role, deps);
  if (seg === 'threshold-rules') return thresholdRulesRoute(role, deps);
  if (seg === 'audit-events') return auditEventsRoute(req, role, deps);
  return null;
}

/**
 * Two-segment GET routes: /incidents/:id, /health/adapters. NEW shape — the feature router previously
 * matched only 1- and 3-segment GETs (and `routing.ts` still does), which is exactly why both of these
 * answered 404 while openapi.yaml declared them (UNIMPLEMENTED_REGISTER rows 14/16). `/health` itself is
 * SINGLE-segment and still resolves through routing.ts's liveness probe — unchanged.
 */
function matchGetPair(segs: readonly string[], req: HttpRequest, role: AppUserRole, deps: HttpDeps): Promise<HttpResponse> | null {
  if (segs[0] === 'incidents') return incidentGetRoute(segs[1]!, req, role, deps);
  if (segs[0] === 'health' && segs[1] === 'adapters') return adapterHealthRoute(req, role, deps);
  return null;
}

/** Three-segment GET routes: /regions/:id/map, /edxl/rm/:id, /incidents/:id/summary, /incidents/:id/exposure. */
function matchGetTriple(segs: readonly string[], req: HttpRequest, role: AppUserRole, deps: HttpDeps): Promise<HttpResponse> | null {
  if (segs[0] === 'regions' && segs[2] === 'map') return mapRoute(segs[1]!, role, deps);
  if (segs[0] === 'edxl' && segs[1] === 'rm') return edxlRmGetRoute(segs[2]!, role, deps);
  if (segs[0] === 'incidents' && segs[2] === 'summary') return incidentSummaryRoute(segs[1]!, req, role, deps);
  if (segs[0] === 'incidents' && segs[2] === 'exposure') return incidentExposureRoute(segs[1]!, req, role, deps);
  return null;
}

/** GET feature routes: /resources, /reports, /alerts, /pre-positioning, /threshold-rules, /audit-events,
 * the five flag-gated dock panels (/supplies, /volunteer-teams, /shelter-status, /damage-reports,
 * /ems-overlay), /incidents/:id, /health/adapters, /regions/:id/map, /edxl/rm/:id,
 * /incidents/:id/{summary,exposure}. Null when no match. */
function matchGet(segs: readonly string[], req: HttpRequest, role: AppUserRole, deps: HttpDeps): Promise<HttpResponse> | null {
  if (segs.length === 1) return matchGetSingle(segs[0]!, req, role, deps) ?? matchGetDockPanel(segs[0]!, role, deps);
  if (segs.length === 2) return matchGetPair(segs, req, role, deps);
  if (segs.length === 3) return matchGetTriple(segs, req, role, deps);
  return null;
}

/** Single-segment POST routes: /routes, /resources, /resource-tasks. */
function matchPostSingle(seg: string, req: HttpRequest, role: AppUserRole, deps: HttpDeps): Promise<HttpResponse> | null {
  if (seg === 'routes') return routesRoute(req, deps);
  if (seg === 'resources') return resourcesPostRoute(req, role, deps);
  if (seg === 'resource-tasks') return resourceTaskRoute(req, role, deps);
  return null;
}

/** Two-segment /edxl/* POST routes: /edxl/rm, /edxl/sitrep. */
function matchPostEdxl(segs: readonly string[], req: HttpRequest, role: AppUserRole, deps: HttpDeps): Promise<HttpResponse> | null {
  if (segs.length !== 2 || segs[0] !== 'edxl') return null;
  if (segs[1] === 'rm') return edxlRmPostRoute(req, role, deps);
  if (segs[1] === 'sitrep') return edxlSitrepPostRoute(req, role, deps);
  return null;
}

/** POST feature routes. Returns null when no feature route matches (dispatcher falls through). */
function matchPost(segs: readonly string[], req: HttpRequest, role: AppUserRole, deps: HttpDeps, actor: string): Promise<HttpResponse> | null {
  const single = segs.length === 1 ? matchPostSingle(segs[0]!, req, role, deps) : null;
  if (single !== null) return single;
  if (segs.length === 3 && segs[0] === 'alerts' && segs[2] === 'approve') return alertApproveRoute(segs[1]!, req, role, deps, actor);
  if (segs.length === 3 && segs[0] === 'alerts' && segs[2] === 'all-clear') return alertAllClearRoute(segs[1]!, req, role, deps);
  return matchPostEdxl(segs, req, role, deps);
}

/**
 * Dispatch a feature route (logistics + interop). Returns the HttpResponse when matched, or null so the
 * caller (handleHttp) falls through to the existing command/system routing. RBAC lives in the handlers.
 * `actor` is the server-derived TRUE identity (verified JWT `sub`, else role key) recorded on public actions.
 */
export function handleFeatureRoute(req: HttpRequest, role: AppUserRole, deps: HttpDeps, actor: string): Promise<HttpResponse> | null {
  const method = req.method.toUpperCase();
  const segs = featureSegments(req.path);
  if (method === 'GET') return matchGet(segs, req, role, deps);
  if (method === 'POST') return matchPost(segs, req, role, deps, actor);
  return null;
}
