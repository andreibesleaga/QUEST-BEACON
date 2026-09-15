'use client';
// BEACON — TanStack Query hooks over the typed API (E8·T-352; ADR-002). Region/incident-scoped query
// keys let SSE deltas invalidate PRECISELY (hooks.ts + sse.ts are the read/refresh pair). Verify and
// task mutations apply optimistic cache updates and ROLL BACK on error — the UI stays live while the
// server confirms, but never lies past a failure.
import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import type { Envelope } from '@/ports/interaction.js';
import type { MapData } from '../_components/map/types.js';
import * as api from './api.js';
import type { ApiError, ApproveAlertResult } from './api.js';
import { projectionToMapData } from './map-data.js';
import { useLocaleId } from './i18n.js';
import { useRegionStream } from './sse.js';
import type { StreamTransport } from './sse.js';
import { useUiStore } from './store.js';
import type {
  ActorRole,
  AlertResult,
  AlertsData,
  DamageReportsData,
  DraftAlertBody,
  EmsOverlayData,
  IncidentsData,
  MeData,
  PrePositioningData,
  ReportResult,
  RegionDelta,
  ReportsData,
  RequestRouteBody,
  ResourcesData,
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

/**
 * Canonical, precisely-scoped query keys — the invalidation surface SSE deltas target.
 *
 * THE RULE, and it is the whole reason this object exists: **a key must name every scope the RESPONSE varies
 * on.** A key that omits one is a cache that will eventually serve one context's answer for another, and it
 * does so while the COP keeps rendering perfectly — which is why no rendering test has ever caught one.
 * Region/incident scoping was F-192; ROLE scoping was F-201; and F-366 found three more instances of the
 * role case still live (`reports`, `alerts`, `pre-positioning` — see the note on `reports` below).
 *
 * Each role-scoped key is paired with a `…Scope` PREFIX. TanStack matches by prefix, so the scope is what an
 * invalidation targets when a change affects every role's copy at once. Nothing outside this object may
 * hand-build a key array: a second, parallel key design drifting from this one is precisely what F-192/F-201
 * already cost us.
 */
export const queryKeys = {
  status: (regionId?: string) => ['status', regionId ?? null] as const,
  incidents: (regionId: string) => ['incidents', regionId] as const,
  sitrep: (incidentId: string) => ['sitrep', incidentId] as const,
  sources: (regionId?: string) => ['sources', regionId ?? null] as const,
  // F-366: GET /reports is VERIFIER+ AND the row's `geomPrecise` is revealed only to RESPONDER+ (Art. XIV) —
  // `toReportItem(r, role)` projects a DIFFERENT row per role. Without `role` in the key, an operator who
  // opened the COP as PUBLIC kept the cached 403 after switching to VERIFIER: the queue stayed dead for a
  // user who was by then fully authorized, and nothing refetched it until an unrelated SSE delta arrived.
  // Identical reasoning to `resources` below; this is the same defect on three more endpoints.
  reports: (regionId: string | undefined, role: string) =>
    ['reports', regionId ?? null, role] as const,
  /** The INVALIDATION prefix covering every role's copy of one region's verifier queue. */
  reportsScope: (regionId?: string) => ['reports', regionId ?? null] as const,
  alerts: (regionId: string | undefined, role: string) =>
    ['alerts', regionId ?? null, role] as const,
  /** The INVALIDATION prefix covering every role's copy of one region's DRAFT alert queue. */
  alertsScope: (regionId?: string) => ['alerts', regionId ?? null] as const,
  // F-192: the resource list is INCIDENT-scoped server-side, so the cache key must be too — a single
  // global 'resources' key would have served one incident's assets for another after a selection change.
  // F-201: it is also ROLE-scoped (RBAC gate + per-org narrowing happen server-side), exactly like `map`.
  // Without `role` in the key, switching PUBLIC→EM in the demo switcher left the cached 403 on screen and
  // the board stayed "Resources unavailable" for a user who was, by then, fully authorized.
  resources: (incidentId: string | undefined, role: string) =>
    ['resources', incidentId ?? null, role] as const,
  /** The INVALIDATION prefix covering every role's copy of one incident's list (a task changes them all). */
  resourcesScope: (incidentId?: string) => ['resources', incidentId ?? null] as const,
  map: (regionId: string, role: string) => ['map', regionId, role] as const,
  me: (role: string) => ['me', role] as const,
  prePositioning: (incidentId: string | undefined, role: string) =>
    ['pre-positioning', incidentId ?? null, role] as const,
  /** The INVALIDATION prefix covering every role's copy of one incident's pre-positioning advice. */
  prePositioningScope: (incidentId?: string) => ['pre-positioning', incidentId ?? null] as const,
  // ── The five dock-panel reads (S3·U1/U2). ROLE-scoped for the same reason as `reports`/`resources`
  // (F-201/F-366): all five endpoints 403 below RESPONDER, so without the role in the key an operator who
  // opened the COP as PUBLIC would keep the cached 403 after switching to RESPONDER+ and the panel would
  // stay dead for a user who is, by then, fully authorized. No region/incident segment: the responses are
  // not scoped by either (the server takes no query at all).
  supplies: (role: string) => ['supplies', role] as const,
  volunteerTeams: (role: string) => ['volunteer-teams', role] as const,
  shelterStatus: (role: string) => ['shelter-status', role] as const,
  damageReports: (role: string) => ['damage-reports', role] as const,
  emsOverlay: (role: string) => ['ems-overlay', role] as const,
  // ── Invalidation PREFIXES (F-320). TanStack matches query keys by prefix, so these name the scopes an
  // SSE delta targets when the delta's `entity` is a wildcard or when the changed entity's parent id is not
  // carried on the wire.
  /** Every role's copy of one region's map projection. */
  mapScope: (regionId: string) => ['map', regionId] as const,
  /** Every incident's SitRep (used when a delta does not name one). */
  sitrepScope: () => ['sitrep'] as const,
  /** Every incident's, and every role's, resource list. */
  resourcesAll: () => ['resources'] as const,
  /** Every incident's, and every role's, pre-positioning advice. */
  prePositioningAll: () => ['pre-positioning'] as const,
};

/**
 * The ACTING role, read from the UI store, for the keys whose response varies by it (F-201/F-366).
 *
 * Read INSIDE the hook rather than taken as a parameter on purpose: `api.ts` already resolves the acting
 * principal from this same store on every request (`roleHeaders`), so taking it as a parameter would let a
 * caller key a query by one role while the request is sent as another — a cache slot labelled with a role
 * that never produced it. Subscribing here also makes the switch itself reactive: changing role re-keys the
 * query, which is what turns a stale 403 back into a live panel.
 */
function useActorRole(): string {
  return useUiStore((s) => s.actorRole);
}

// ── Queries ────────────────────────────────────────────────────────────────────

export function useStatus(regionId?: string): UseQueryResult<Envelope<StatusData>, ApiError> {
  return useQuery({
    queryKey: queryKeys.status(regionId),
    queryFn: () => api.getStatus(regionId),
  });
}

export function useIncidents(
  regionId: string | undefined,
): UseQueryResult<Envelope<IncidentsData>, ApiError> {
  return useQuery({
    queryKey: queryKeys.incidents(regionId ?? ''),
    queryFn: () => api.getIncidents(regionId as string),
    enabled: regionId !== undefined && regionId !== '',
  });
}

export function useSitRep(
  incidentId: string | undefined,
): UseQueryResult<Envelope<SitRepData>, ApiError> {
  return useQuery({
    queryKey: queryKeys.sitrep(incidentId ?? ''),
    queryFn: () => api.getSitRep(incidentId as string),
    enabled: incidentId !== undefined && incidentId !== '',
  });
}

export function useSources(regionId?: string): UseQueryResult<Envelope<SourcesData>, ApiError> {
  return useQuery({
    queryKey: queryKeys.sources(regionId),
    queryFn: () => api.getSources(regionId),
  });
}

/**
 * GET /me — the session read (role, verified `sub`, and any EM-only operator link; ADR-040).
 *
 * ALWAYS ENABLED, and that is a correction (owner report 2026-09-11: "the DB Admin button does not show").
 * This hook used to require a bearer, on the reasoning that the local demo's `x-beacon-role` path is not a
 * session and the client should only ever NARROW what the server would answer. The narrowing was real but
 * it was wrong here, for two reasons:
 *
 *  1. **It narrowed a TRUE answer into a false one.** `/me` carries no RBAC of its own — it reports the
 *     principal the server resolved, and returns `{role:'PUBLIC'}` to an anonymous caller. When the server
 *     had already decided the actor is an EM and sent the link, the client suppressed it anyway. A client
 *     that hides an affordance the server granted is not being cautious; it is disagreeing with the
 *     authority, and losing.
 *  2. **It protected nothing.** The gate that matters is the server's, and it is unchanged: `dbAdminUrl`
 *     is present only for `role === 'EM'` with `DB_ADMIN_URL` configured, and is never a `NEXT_PUBLIC_`
 *     value, so it is not in the bundle an anonymous visitor downloads. There was no secret for this
 *     condition to keep.
 *
 * The cost is one small request for an anonymous visitor. That is the honest price of letting the server be
 * the single decider, and it is the right trade.
 *
 * Keyed on the role: switching or signing in re-keys and refetches, and a reload restores the role from
 * sessionStorage and fires again — which is what makes an operator link survive a refresh.
 */
export function useMe(): UseQueryResult<MeData, ApiError> {
  const role = useActorRole();
  return useQuery({
    queryKey: queryKeys.me(role),
    queryFn: () => api.getMe(),
  });
}

/**
 * GET /resources — the taskable asset registry for the SELECTED incident (RESPONDER+, org-scoped).
 *
 * F-192 product decision: with no incident selected the query is DISABLED rather than fired. The endpoint is
 * genuinely incident-scoped (`ResourceLogisticsPort.listAvailable(incidentId)`), so an incident-optional
 * variant would have to invent an "all incidents" answer the port cannot give — and would return a list
 * scoped to nothing while looking like an answer. A request that can only 400 is a dead click whose error
 * blames the server for a client-state problem (Art. XVI: degrade, and LABEL the degradation honestly), so
 * the board renders a designed "no incident selected" empty state instead. Mirrors `useSitRep` /
 * `usePrePositioning` / `useMapData`, which already gate on exactly the same condition.
 */
export function useResources(
  incidentId: string | undefined,
  role: ActorRole,
): UseQueryResult<Envelope<ResourcesData>, ApiError> {
  return useQuery({
    queryKey: queryKeys.resources(incidentId, role),
    queryFn: () => api.getResources({ incidentId: incidentId as string }),
    enabled: incidentId !== undefined && incidentId !== '',
  });
}

/**
 * GET /pre-positioning — advisory resource/shelter suggestions near the projected hazard extent (W2d,
 * RESPONDER+; engine suggests, human decides — Art. XII/XIII). Disabled without an incidentId so the
 * logistics board never fires a request before an incident is selected (mirrors useSitRep's gating).
 */
export function usePrePositioning(
  incidentId: string | undefined,
): UseQueryResult<Envelope<PrePositioningData>, ApiError> {
  const role = useActorRole();
  return useQuery({
    queryKey: queryKeys.prePositioning(incidentId, role),
    queryFn: () => api.getPrePositioning(incidentId as string),
    enabled: incidentId !== undefined && incidentId !== '',
  });
}

/**
 * GET /reports — the verifier queue (VERIFIER+; each row's precise geometry is RESPONDER+-gated, Art. XIV).
 * Keyed by region so the optimistic verify cache aligns, and by ROLE because the server projects a different
 * row — or a 403 — per role (F-366; the `resources` note above is the same defect, found first).
 */
export function useReports(regionId?: string): UseQueryResult<Envelope<ReportsData>, ApiError> {
  const role = useActorRole();
  return useQuery({ queryKey: queryKeys.reports(regionId, role), queryFn: () => api.getReports() });
}

/** GET /alerts — the computed DRAFT alert queue (VERIFIER+; DRAFT-only, Art. XIII). Role-keyed: see useReports. */
export function useAlerts(regionId?: string): UseQueryResult<Envelope<AlertsData>, ApiError> {
  const role = useActorRole();
  return useQuery({ queryKey: queryKeys.alerts(regionId, role), queryFn: () => api.getAlerts() });
}

// ── The five dock-panel reads (S3·U1/U2) ──────────────────────────────────────────────────────────────
// Each is role-keyed (the server 403s below RESPONDER — see the queryKeys note) and takes the mounting
// panel's display gate as `enabled`: with the NEXT_PUBLIC mirror off the panel renders null AND its query
// never fires — a request whose only possible answer is the flag-off 404 is never issued (Art. XVI, the
// same rule the incident-scoped hooks apply to an absent id).

/** GET /supplies — relief supply lots (FR-D6-2; RESPONDER+). */
export function useSupplies(enabled?: boolean): UseQueryResult<Envelope<SuppliesData>, ApiError> {
  const role = useActorRole();
  return useQuery({
    queryKey: queryKeys.supplies(role),
    queryFn: () => api.getSupplies(),
    enabled: enabled !== false,
  });
}

/** GET /volunteer-teams — volunteer team units (FR-D6-1; RESPONDER+). */
export function useVolunteerTeams(
  enabled?: boolean,
): UseQueryResult<Envelope<VolunteerTeamsData>, ApiError> {
  const role = useActorRole();
  return useQuery({
    queryKey: queryKeys.volunteerTeams(role),
    queryFn: () => api.getVolunteerTeams(),
    enabled: enabled !== false,
  });
}

/** GET /shelter-status — the aggregate shelter board (FR-D4-3; RESPONDER+). */
export function useShelterStatus(
  enabled?: boolean,
): UseQueryResult<Envelope<ShelterStatusData>, ApiError> {
  const role = useActorRole();
  return useQuery({
    queryKey: queryKeys.shelterStatus(role),
    queryFn: () => api.getShelterStatus(),
    enabled: enabled !== false,
  });
}

/** GET /damage-reports — per-triage-state damage/needs buckets (FR-D4-4; RESPONDER+). */
export function useDamageReports(
  enabled?: boolean,
): UseQueryResult<Envelope<DamageReportsData>, ApiError> {
  const role = useActorRole();
  return useQuery({
    queryKey: queryKeys.damageReports(role),
    queryFn: () => api.getDamageReports(),
    enabled: enabled !== false,
  });
}

/** GET /ems-overlay — Copernicus EMS link-only damage products (FR-D4-5; RESPONDER+). */
export function useEmsOverlay(
  enabled?: boolean,
): UseQueryResult<Envelope<EmsOverlayData>, ApiError> {
  const role = useActorRole();
  return useQuery({
    queryKey: queryKeys.emsOverlay(role),
    queryFn: () => api.getEmsOverlay(),
    enabled: enabled !== false,
  });
}

/**
 * The COP map dataset for a region, fetched THROUGH the deterministic core (GET /regions/:id/map) and mapped
 * to the frontend MapData (numbers/geometry from the core, not the client — Art. XII). `role` keys the query
 * so an authenticated role change refetches (precise geometry is server-gated, Art. XIV). Absent/loading/error
 * → an empty MapData so the COP never dead-ends (Art. XVI). F1 is enforced upstream by fetchEnvelope.
 */
export function useMapData(regionId: string | undefined, role: ActorRole): MapData {
  const query = useQuery({
    queryKey: queryKeys.map(regionId ?? '', role),
    queryFn: () => api.getMapProjection(regionId as string),
    enabled: regionId !== undefined && regionId !== '',
  });
  const env = query.data;
  return useMemo<MapData>(() => {
    if (env === undefined) return {};
    const mode = env.provenance[0]?.mode ?? 'MOCK';
    // Retain env.provenance[] so map-data resolves PER-LAYER freshness (layerSources → the matching
    // SourceRef's own fetchedAt/mode); mode/freshness stay the shared fallback for unmapped layers.
    return projectionToMapData(env.data, mode, env.freshness ?? null, env.provenance);
  }, [env]);
}

// ── Simple mutations ─────────────────────────────────────────────────────────

export function useSubmitReport(): UseMutationResult<
  Envelope<ReportResult>,
  ApiError,
  SubmitReportBody
> {
  return useMutation({ mutationFn: (body: SubmitReportBody) => api.submitReport(body) });
}

export function useDraftAlert(): UseMutationResult<
  Envelope<AlertResult>,
  ApiError,
  DraftAlertBody
> {
  return useMutation({ mutationFn: (body: DraftAlertBody) => api.draftAlert(body) });
}

export function useRequestRoute(): UseMutationResult<
  Envelope<RouteData>,
  ApiError,
  RequestRouteBody
> {
  return useMutation({ mutationFn: (body: RequestRouteBody) => api.requestRoute(body) });
}

/**
 * The HITL alert-approval mutation (POST /alerts/:id/approve, Art. XIII). On settle it refetches the DRAFT
 * queue so an approved alert leaves the review list. The SERVER enforces VERIFIER+ and DRAFT→ACTUAL.
 */
export function useApproveAlert(
  regionId?: string,
): UseMutationResult<Envelope<ApproveAlertResult>, ApiError, string> {
  const qc = useQueryClient();
  const locale = useLocaleId(); // the approver's UI language → the bilingual broadcast headline
  return useMutation({
    mutationFn: (id: string) => api.approveAlert(id, locale),
    onSettled: () => {
      // The SCOPE prefix, not one role's key: an approval changes the queue for every role that has one
      // cached, and the operator may well have switched roles between the read and the approval (F-366).
      void qc.invalidateQueries({ queryKey: queryKeys.alertsScope(regionId) });
    },
  });
}

// ── Optimistic mutations (verify + task) ──────────────────────────────────────

export interface VerifyVars {
  readonly id: string;
  readonly body: VerifyReportBody;
}
interface OptimisticCtx<T> {
  readonly key: readonly unknown[];
  readonly prev: Envelope<T> | undefined;
}

/** Optimistically stamp the verified report's status onto the cached queue list (envelope data is an object). */
function applyVerify(env: Envelope<ReportsData>, vars: VerifyVars): Envelope<ReportsData> {
  const reports = env.data.reports.map((r) =>
    r.id === vars.id ? { ...r, status: vars.body.decision } : r,
  );
  return { ...env, data: { ...env.data, reports } };
}

/**
 * PATCH /reports/:id — the verifier decide gate (Art. XIII). Returns the FULL response Envelope, so
 * `verify.data?.meta` already carries whatever the server attached — the emitted DRAFT alert
 * (`meta.emittedAlert`, approve-with-CAP) and/or an ADVISORY `meta.visionFinding` (W4c vision-assist, when
 * the verifier's PATCH body included `visionAssist` and FEATURE_VISION is wired). Neither is scored or
 * decided here; the panel reads them defensively (unknown-shaped meta) and renders them read-only —
 * `visionFinding` never feeds back into `decision` (Art. XII/XIII HITL).
 */
export function useVerifyReport(
  regionId?: string,
): UseMutationResult<Envelope<ReportResult>, ApiError, VerifyVars, OptimisticCtx<ReportsData>> {
  const qc = useQueryClient();
  // The EXACT key the acting role's `useReports` reads from — an optimistic write must land on the slot the
  // queue is actually rendering, and after F-366 that slot is role-scoped.
  const key = queryKeys.reports(regionId, useActorRole());
  return useMutation({
    mutationFn: (vars: VerifyVars) => api.verifyReport(vars.id, vars.body),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Envelope<ReportsData>>(key);
      if (prev !== undefined) qc.setQueryData<Envelope<ReportsData>>(key, applyVerify(prev, vars));
      return { key, prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: () => {
      // Invalidate the whole region SCOPE: a decision changes the queue every role sees, not just this one's.
      void qc.invalidateQueries({ queryKey: queryKeys.reportsScope(regionId) });
    },
  });
}

/**
 * POST /resource-tasks — create (absent `id` ⇒ the domain's PROPOSED start state) or advance (present `id`
 * ⇒ exactly one legal forward hop) a resource task. RBAC + the VERIFIED-source gate + the forward-only
 * lifecycle are all enforced SERVER-side; a rejection surfaces as a labelled `ApiError` (Art. XIII/XVI).
 *
 * There is deliberately NO optimistic write here any more. The previous one stamped the TASK's lifecycle
 * status (PROPOSED…CLEARED) onto the RESOURCE's own status field (AVAILABLE|ASSIGNED|OOS) — two different
 * vocabularies — and the server never changes a resource's status when a task is recorded, so the row
 * briefly displayed a value no response would ever confirm and then reverted on invalidation. Showing the
 * SERVER-CONFIRMED task instead (the board keeps `env.data.task`) is the honest version of the same UX.
 */
export function useTaskResource(
  incidentId?: string,
): UseMutationResult<Envelope<ResourceTaskResult>, ApiError, TaskResourceBody> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TaskResourceBody) => api.taskResource(body),
    onSettled: () => {
      // Prefix key: invalidate the incident's list for EVERY role that has one cached (F-201).
      void qc.invalidateQueries({ queryKey: queryKeys.resourcesScope(incidentId) });
    },
  });
}

// ── SSE → cache refresh (F-320) ───────────────────────────────────────────────
// The other half of the read/refresh pair named at the top of this file. `sse.ts` owns the TRANSPORT
// (EventSource + polling fallback); this owns the MAPPING from a delta to the query keys it makes stale.
// Art. XII is the whole point of the split: a delta carries no number, no geometry and no text — it names
// what changed, and the client REFETCHES that entity over REST, where provenance[]/freshness/RBAC apply.

/** The leading segment of a delta type ('incident.updated' → 'incident'). The wire vocabulary is open. */
function deltaKind(type: string): string {
  return (type.split('.')[0] ?? '').toLowerCase();
}

/** Everything a region's COP reads — the conservative target for a poll tick or an unknown delta type. */
function regionReadSet(regionId: string): readonly (readonly unknown[])[] {
  return [
    queryKeys.status(regionId),
    queryKeys.incidents(regionId),
    queryKeys.sources(regionId),
    queryKeys.reportsScope(regionId),
    queryKeys.alertsScope(regionId),
    queryKeys.mapScope(regionId),
    queryKeys.sitrepScope(),
    queryKeys.resourcesAll(),
    queryKeys.prePositioningAll(),
  ];
}

/** Build the keys one delta kind targets. `sitrep` is pre-resolved (named incident, or the whole prefix). */
type DeltaRoute = (regionId: string, sitrep: readonly unknown[]) => readonly (readonly unknown[])[];

const RESOURCE_ROUTE: DeltaRoute = () => [queryKeys.resourcesAll(), queryKeys.prePositioningAll()];
const MONITOR_ROUTE: DeltaRoute = (regionId) => [
  queryKeys.status(regionId),
  queryKeys.sources(regionId),
];
const DERIVED_ROUTE: DeltaRoute = (regionId, sitrep) => [sitrep, queryKeys.mapScope(regionId)];

/** delta kind → the keys it makes stale. An absent kind falls through to the whole region read set. */
const DELTA_ROUTES: Readonly<Record<string, DeltaRoute>> = {
  incident: (regionId, sitrep) => [
    queryKeys.incidents(regionId),
    queryKeys.mapScope(regionId),
    sitrep,
  ],
  sitrep: (_regionId, sitrep) => [sitrep],
  exposure: DERIVED_ROUTE,
  prediction: DERIVED_ROUTE,
  // A verified/new report changes both the verifier queue and the reports layer on the map. Both targets are
  // SCOPE prefixes: every role's cached copy is now stale, not just the one currently on screen.
  report: (regionId) => [queryKeys.reportsScope(regionId), queryKeys.mapScope(regionId)],
  alert: (regionId) => [queryKeys.alertsScope(regionId)],
  resource: RESOURCE_ROUTE,
  task: RESOURCE_ROUTE,
  source: MONITOR_ROUTE,
  status: MONITOR_ROUTE,
};

/**
 * Map ONE region delta onto the query keys it invalidates. Pure and exported so the mapping is testable
 * without a transport. An unrecognised `type` (including the fallback's synthetic 'poll') refetches the
 * region's whole read set: a notification this client cannot classify must refresh MORE, never be dropped
 * — a swallowed delta is exactly the "stale COP that looks live" failure Art. XVI forbids.
 */
export function regionInvalidationKeys(
  delta: RegionDelta,
  regionId: string,
): readonly (readonly unknown[])[] {
  const wildcard = delta.entity === '' || delta.entity === '*';
  const sitrep = wildcard ? queryKeys.sitrepScope() : queryKeys.sitrep(delta.entity);
  const route = DELTA_ROUTES[deltaKind(delta.type)];
  return route === undefined ? regionReadSet(regionId) : route(regionId, sitrep);
}

/**
 * Mount the region delta channel and refresh the COP from it. Returns the active ladder rung
 * ('sse' | 'polling' | 'idle') so the mounting component can LABEL the degradation (Art. XVI).
 *
 * Deltas for another region are dropped (cross-region isolation, THREAT T13.1) — the server subscribes on a
 * region-keyed topic, and this is the client-side half of the same guarantee.
 */
export function useRegionSync(regionId: string | undefined): StreamTransport {
  const qc = useQueryClient();
  const onDelta = useCallback(
    (delta: RegionDelta): void => {
      if (regionId === undefined || regionId === '') return;
      if (delta.region !== regionId) return;
      for (const queryKey of regionInvalidationKeys(delta, regionId)) {
        void qc.invalidateQueries({ queryKey });
      }
    },
    [qc, regionId],
  );
  return useRegionStream(regionId, onDelta);
}
