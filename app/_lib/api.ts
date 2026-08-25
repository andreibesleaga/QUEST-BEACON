// BEACON — envelope-typed fetch wrapper + typed API helpers (E8·T-352; ADR-002/U1/F1). Every REST call
// funnels through fetchEnvelope, which ENFORCES the contract at the boundary:
//   • a non-OK status → a typed ApiError carrying {status, code, message} (surfaced from errors[] when present);
//   • a 2xx data response with a missing/empty provenance[] → an ApiError('MISSING_PROVENANCE'): an
//     ungrounded response is a contract violation (F1), not renderable data.
// fetchImpl is injectable (default globalThis.fetch) so tests drive it with a stub — no network.
import type { Envelope } from '@/ports/interaction.js';
import { useUiStore } from './store.js';
import type {
  AlertResult,
  AlertsData,
  DamageReportsData,
  DraftAlertBody,
  EmsOverlayData,
  IncidentsData,
  MapProjectionData,
  MeData,
  PrePositioningData,
  ReportResult,
  ReportsData,
  RequestRouteBody,
  ResourcesData,
  ResourcesQuery,
  ResourceTaskResult,
  RouteData,
  ShelterStatusData,
  SitRepData,
  SourcesData,
  StatusData,
  SubmitReportBody,
  SuppliesData,
  TaskResourceBody,
  VerifyReportBody,
  VolunteerTeamsData,
} from './types.js';

/** Frozen once published (Art. VIII) — every FE call is relative to this base. */
const API_BASE = '/api/v1';

/**
 * The auth header carried on every REST call. When a verified bearer token is present (minted by the demo
 * dev-login, POST /auth/dev-login), send it as `Authorization: Bearer <token>` — real per-user identity the
 * server verifies (JWT `sub`). Otherwise fall back to the `x-beacon-role` dev header, which the dev server
 * trusts ONLY under `AUTH_DEV_TRUST_HEADER=on` (spoofable — DEMO ONLY; the server still authorizes either
 * way). Read from the Zustand store OUTSIDE React so every queryFn/mutationFn call carries the current auth.
 */
function roleHeaders(): Record<string, string> {
  const { authToken, actorRole } = useUiStore.getState();
  return authToken !== undefined && authToken !== ''
    ? { authorization: `Bearer ${authToken}` }
    : { 'x-beacon-role': actorRole };
}

export type FetchImpl = typeof globalThis.fetch;

export interface ApiErrorDetail {
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

/** A typed transport/contract failure. `status` is the HTTP status (0 for client-side contract breaks). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(detail: ApiErrorDetail) {
    super(detail.message);
    this.name = 'ApiError';
    this.status = detail.status;
    this.code = detail.code;
  }
}

async function parseJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

/** Map a non-OK response body onto an ApiError, preferring the envelope's first errors[] entry. */
function errorFromBody(status: number, body: unknown): ApiError {
  const errs = (body as Envelope).errors;
  const first = Array.isArray(errs) ? errs[0] : undefined;
  return new ApiError({
    status,
    code: first?.code ?? 'HTTP_ERROR',
    message: first?.message ?? `Request failed with status ${status}`,
  });
}

/** True when the envelope carries a non-empty provenance[] (F1). */
function hasProvenance(env: Envelope): boolean {
  return Array.isArray(env.provenance) && env.provenance.length > 0;
}

/**
 * Fetch `${API_BASE}${path}`, parse JSON, and enforce the envelope contract. Returns a typed
 * Envelope<T> on success; throws ApiError on a non-OK status or an ungrounded (provenance-less) 2xx.
 */
export async function fetchEnvelope<T>(
  path: string,
  init?: RequestInit,
  fetchImpl: FetchImpl = globalThis.fetch,
): Promise<Envelope<T>> {
  const headers = { ...roleHeaders(), ...((init?.headers as Record<string, string> | undefined) ?? {}) };
  const res = await fetchImpl(`${API_BASE}${path}`, { ...init, headers });
  const body = await parseJson(res);
  if (!res.ok) throw errorFromBody(res.status, body);
  const env = body as Envelope<T>;
  if (!hasProvenance(env)) {
    throw new ApiError({
      status: res.status,
      code: 'MISSING_PROVENANCE',
      message: 'Data response missing a non-empty provenance[] (F1).',
    });
  }
  return env;
}

/** Build a `?k=v` query string from defined params only (undefined keys are dropped). */
function query(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, v);
  const s = qs.toString();
  return s.length > 0 ? `?${s}` : '';
}

/** RequestInit for a JSON-bodied write. */
function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

// ── Typed helpers (each accepts an optional fetchImpl for testing) ─────────────

export function getStatus(regionId?: string, fetchImpl?: FetchImpl): Promise<Envelope<StatusData>> {
  return fetchEnvelope<StatusData>(`/status${query({ regionId })}`, undefined, fetchImpl);
}

export function getIncidents(
  regionId: string,
  fetchImpl?: FetchImpl,
): Promise<Envelope<IncidentsData>> {
  return fetchEnvelope<IncidentsData>(
    `/regions/${encodeURIComponent(regionId)}/incidents`,
    undefined,
    fetchImpl,
  );
}

export function getSitRep(
  incidentId: string,
  fetchImpl?: FetchImpl,
): Promise<Envelope<SitRepData>> {
  return fetchEnvelope<SitRepData>(
    `/incidents/${encodeURIComponent(incidentId)}/sitrep`,
    undefined,
    fetchImpl,
  );
}

export function getMapProjection(
  regionId: string,
  fetchImpl?: FetchImpl,
): Promise<Envelope<MapProjectionData>> {
  return fetchEnvelope<MapProjectionData>(
    `/regions/${encodeURIComponent(regionId)}/map`,
    undefined,
    fetchImpl,
  );
}

export function getSources(regionId?: string, fetchImpl?: FetchImpl): Promise<Envelope<SourcesData>> {
  return fetchEnvelope<SourcesData>(`/sources${query({ regionId })}`, undefined, fetchImpl);
}

export function getMe(fetchImpl?: FetchImpl): Promise<Envelope<MeData>> {
  return fetchEnvelope<MeData>('/me', undefined, fetchImpl);
}

/**
 * GET /resources — the taskable asset registry for ONE incident (RESPONDER+, org-scoped server-side).
 *
 * F-192: this used to take no arguments and fetch a bare `/resources`, while the route hard-fails
 * `badRequest('incidentId query param required')` — so the logistics board 400'd on every real page load
 * while `tsc` reported zero errors. `params` is the SERVER's own derived query contract (`ResourcesQuery`
 * ← `ResourcesWireQuery`), and it is REQUIRED, so "call this endpoint with no query" is no longer a thing
 * this codebase can express. Callers with no incident selected must not call it at all — `useResources`
 * disables the query instead (Art. XVI: never fire a request that can only fail).
 */
export function getResources(
  params: ResourcesQuery,
  fetchImpl?: FetchImpl,
): Promise<Envelope<ResourcesData>> {
  return fetchEnvelope<ResourcesData>(`/resources${query({ ...params })}`, undefined, fetchImpl);
}

/** GET /pre-positioning — advisory resource/shelter suggestions near the projected extent (W2d, RESPONDER+). */
export function getPrePositioning(
  incidentId: string,
  fetchImpl?: FetchImpl,
): Promise<Envelope<PrePositioningData>> {
  return fetchEnvelope<PrePositioningData>(
    `/pre-positioning${query({ incidentId })}`,
    undefined,
    fetchImpl,
  );
}

/**
 * GET /reports — the verifier triage queue (VERIFIER+; precise geometry RESPONDER+, server-gated).
 * The QUEUE view always asks for `?status=pending` so decided reports are excluded by the SERVER —
 * the client's optimistic hide is a latency nicety, not the mechanism (2026-08-05: it was the only
 * mechanism, held in component state, and every remount resurrected "rejected" rows).
 */
export function getReports(fetchImpl?: FetchImpl): Promise<Envelope<ReportsData>> {
  return fetchEnvelope<ReportsData>('/reports?status=pending', undefined, fetchImpl);
}

/** GET /alerts — the computed DRAFT alert queue (VERIFIER+; DRAFT-only, never emitted — Art. XIII). */
export function getAlerts(fetchImpl?: FetchImpl): Promise<Envelope<AlertsData>> {
  return fetchEnvelope<AlertsData>('/alerts', undefined, fetchImpl);
}

// ── The five dock-panel reads (S3·U1/U2; RESPONDER+, server-flag-gated — a disabled panel's route 404s) ──

/** GET /supplies — relief supply lots (FR-D6-2; RESPONDER+, FEATURE_D6_SUPPLIES-gated server-side). */
export function getSupplies(fetchImpl?: FetchImpl): Promise<Envelope<SuppliesData>> {
  return fetchEnvelope<SuppliesData>('/supplies', undefined, fetchImpl);
}

/** GET /volunteer-teams — volunteer team units (FR-D6-1; RESPONDER+, FEATURE_D6_VOLUNTEER_TEAMS-gated). */
export function getVolunteerTeams(fetchImpl?: FetchImpl): Promise<Envelope<VolunteerTeamsData>> {
  return fetchEnvelope<VolunteerTeamsData>('/volunteer-teams', undefined, fetchImpl);
}

/** GET /shelter-status — the aggregate shelter board (FR-D4-3; RESPONDER+, FEATURE_D4_SHELTER_STATUS-gated). */
export function getShelterStatus(fetchImpl?: FetchImpl): Promise<Envelope<ShelterStatusData>> {
  return fetchEnvelope<ShelterStatusData>('/shelter-status', undefined, fetchImpl);
}

/** GET /damage-reports — per-triage-state damage/needs buckets (FR-D4-4; RESPONDER+, FEATURE_D4_DAMAGE_REPORTS-gated). */
export function getDamageReports(fetchImpl?: FetchImpl): Promise<Envelope<DamageReportsData>> {
  return fetchEnvelope<DamageReportsData>('/damage-reports', undefined, fetchImpl);
}

/** GET /ems-overlay — Copernicus EMS link-only damage products (FR-D4-5; RESPONDER+, FEATURE_D4_EMS_OVERLAY-gated). */
export function getEmsOverlay(fetchImpl?: FetchImpl): Promise<Envelope<EmsOverlayData>> {
  return fetchEnvelope<EmsOverlayData>('/ems-overlay', undefined, fetchImpl);
}

export function submitReport(
  body: SubmitReportBody,
  fetchImpl?: FetchImpl,
): Promise<Envelope<ReportResult>> {
  return fetchEnvelope<ReportResult>('/reports', jsonInit('POST', body), fetchImpl);
}

export function verifyReport(
  id: string,
  body: VerifyReportBody,
  fetchImpl?: FetchImpl,
): Promise<Envelope<ReportResult>> {
  return fetchEnvelope<ReportResult>(
    `/reports/${encodeURIComponent(id)}`,
    jsonInit('PATCH', body),
    fetchImpl,
  );
}

export function draftAlert(
  body: DraftAlertBody,
  fetchImpl?: FetchImpl,
): Promise<Envelope<AlertResult>> {
  return fetchEnvelope<AlertResult>('/alerts', jsonInit('POST', body), fetchImpl);
}

/** The HITL approve gate result: the promoted alert (DRAFT→ACTUAL) — narrowed to what the UI reads. */
export interface ApproveAlertResult {
  readonly alert?: { readonly id?: string; readonly capStatus?: string };
}

/**
 * POST /alerts/:id/approve — the authenticated HITL emit gate (Art. XIII). VERIFIER+; the SERVER promotes
 * DRAFT→ACTUAL and records the approver. This only routes the human's approval — it does not itself weaken
 * any gate (an unauthorized actor or a non-DRAFT alert is rejected server-side).
 */
export function approveAlert(id: string, lang?: string, fetchImpl?: FetchImpl): Promise<Envelope<ApproveAlertResult>> {
  // `lang` is the approver's UI locale — it drives the BILINGUAL Telegram broadcast headline (localized
  // line + English line). Presentation-only: the server coerces it through the locale allowlist and it
  // can never change what is approved or emitted.
  return fetchEnvelope<ApproveAlertResult>(
    `/alerts/${encodeURIComponent(id)}/approve`,
    jsonInit('POST', lang !== undefined ? { lang } : {}),
    fetchImpl,
  );
}

export function taskResource(
  body: TaskResourceBody,
  fetchImpl?: FetchImpl,
): Promise<Envelope<ResourceTaskResult>> {
  return fetchEnvelope<ResourceTaskResult>('/resource-tasks', jsonInit('POST', body), fetchImpl);
}

export function requestRoute(
  body: RequestRouteBody,
  fetchImpl?: FetchImpl,
): Promise<Envelope<RouteData>> {
  return fetchEnvelope<RouteData>('/routes', jsonInit('POST', body), fetchImpl);
}

/**
 * POST /auth/login — the REAL named-account login. Returns the minted bearer AND the role the SERVER
 * assigned to that account, which the caller stores so the UI stops claiming a role the token does not
 * carry. Returns undefined on any failure (bad credentials 401, or 404 when the server has no accounts
 * configured — the offline posture); the caller surfaces one honest message either way, because
 * distinguishing them in the UI would leak which accounts exist.
 */
export async function login(
  userId: string,
  password: string,
  fetchImpl: FetchImpl = globalThis.fetch,
): Promise<{ token: string; role: string; userId: string } | undefined> {
  const res = await fetchImpl(`${API_BASE}/auth/login`, jsonInit('POST', { userId, password }));
  if (!res.ok) return undefined;
  const body = (await parseJson(res)) as { token?: unknown; role?: unknown; userId?: unknown };
  if (typeof body.token !== 'string' || typeof body.role !== 'string') return undefined;
  return { token: body.token, role: body.role, userId: typeof body.userId === 'string' ? body.userId : userId };
}

/**
 * POST /auth/dev-login — the demo IdP (NOT production issuance). Mints a bearer token for {role, userId}.
 * The response is a plain `{token}` (no envelope), so this bypasses fetchEnvelope. Returns the token on
 * 200, or undefined when the server has dev-login disabled (offline/e2e → 404). No auth header is sent.
 */
export async function devLogin(
  role: string,
  userId: string,
  fetchImpl: FetchImpl = globalThis.fetch,
): Promise<string | undefined> {
  const res = await fetchImpl(`${API_BASE}/auth/dev-login`, jsonInit('POST', { role, userId }));
  if (!res.ok) return undefined;
  const body = (await parseJson(res)) as { token?: unknown };
  return typeof body.token === 'string' ? body.token : undefined;
}
