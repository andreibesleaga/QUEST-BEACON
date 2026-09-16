// BEACON — Common Operating Picture (E8·T-350/T-388; the single crisis-first screen). Composes the
// MapLibre COP + docked SitRep/logistics panels + toolbar (region · layers · theme · ⌘K) over the same
// envelope-typed hooks every channel uses. 'use client' — the map + interactions are browser-side; the
// initial render degrades gracefully (ErrorBoundary + empty states) so the shell never dead-ends.
'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { EmptyState } from './_components/ui/empty-state';
import { useUiStore, type DrawnRoute } from './_lib/store.js';
import { RegionTimeZone, useT } from './_lib/i18n.js';
import { SHIPPED_REGIONS, regionTimeZone, shippedRegion } from '@/config/regions.js';
import { devLogin } from './_lib/api.js';
import {
  useIncidents,
  useMapData,
  useSitRep,
  useReports,
  useAlerts,
  useApproveAlert,
} from './_lib/hooks.js';
import { incidentsOf, reportsOf, alertsOf, sitRepOf, decisionFiguresOf } from './_lib/mappers.js';
import { type ActorRole } from './_lib/types.js';
import {
  CopLayout,
  CommandPalette,
  SitRepPanel,
  LogisticsBoard,
  SosForm,
  VerifierQueue,
  RoutingPanel,
  DecisionSupport,
  DraftAlertReview,
  AnticipatoryPanel,
  ANTICIPATORY_PANEL_ENABLED,
  SuppliesPanel,
  VolunteerTeamsPanel,
  ShelterStatusPanel,
  DamageReportsPanel,
  EmsOverlayPanel,
  type DraftAlertItem,
  type NamedRef,
} from './_components/panels/index.js';
import {
  MapView,
  RegionSelector,
  LayerTogglePanel,
  type MapData,
  type RegionOption,
} from './_components/map/index.js';
import { RegionStream } from './_components/region-stream.js';
import { LoginControl } from './_components/login-control.js';
import { StatusStrip } from './_components/status-strip.js';
import { DbAdminLink } from './_components/db-admin-link.js';
import { PostureControl } from './_components/posture-control.js';
import {
  Legend,
  ThemeToggle,
  LocaleSwitcher,
  Panel,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Popover,
  PopoverTrigger,
  PopoverContent,
  Button,
} from './_components/ui/index.js';

// Demo IdP control gate: hidden unless explicitly enabled (NEXT_PUBLIC_AUTH_DEV_LOGIN=on), so the offline
// demo / e2e / visual-baseline default toolbar is unchanged. The server route is separately gated by
// AUTH_SECRET + AUTH_DEV_LOGIN — this only shows the control that drives it.
const DEV_LOGIN_ENABLED = process.env.NEXT_PUBLIC_AUTH_DEV_LOGIN === 'on';

// Real named-account sign-in gate. On an internet-reachable deploy (DEPLOY_MODE=cloud) the spoofable dev
// header is hard-off and dev-login hard-404s (F-344) — deliberately, and neither is reopened. Privileged
// roles come from POST /auth/login against a CONFIGURED account (AUTH_USERS), which mints the same
// fail-closed HS256 bearer resolvePrincipal already verifies. The request cannot ask for a role: the role
// is whatever the account carries. Hidden unless the build sets NEXT_PUBLIC_AUTH_TOKEN_LOGIN=on, so the
// gates / visual baselines / offline demo render byte-identically.
const TOKEN_LOGIN_ENABLED = process.env.NEXT_PUBLIC_AUTH_TOKEN_LOGIN === 'on';

// Citizen live-view gate (Live Views v1.2, ADR-029). Mirrors the DEV_LOGIN seam above: a build-time-inlined
// NEXT_PUBLIC_ flag that only surfaces the optional "public live stream link" field in the SOS form. This is
// UX-only — the server (POST /reports, FEATURE_CITIZEN_STREAM) is authoritative and REJECTS a liveViewUrl
// with the feature off, regardless of what the client renders. Defaults off (field hidden, byte-identical).
const CITIZEN_STREAM_ENABLED = process.env.NEXT_PUBLIC_FEATURE_CITIZEN_STREAM === 'on';

// Deploy-posture badge (WP-A1, 2026-08-05). `live` ⇒ a green LIVE chip replaces BOTH the red DEV tag and
// the demo role-switcher (which is a NO-OP on cloud anyway — AUTH_DEV_TRUST_HEADER is hard-off there, so
// rendering it only advertised a dev posture on a judged deploy; the acting role then comes solely from
// the signed-in account via /auth/login → JWT). Build-time inlined like every NEXT_PUBLIC_ gate; unset ⇒
// `dev` ⇒ the toolbar renders byte-identically to every existing baseline.
const DEPLOY_POSTURE_LIVE = process.env.NEXT_PUBLIC_DEPLOY_POSTURE === 'live';

// Vision-assist toggle in the verifier queue (WP-D, 2026-08-05). UX-only mirror of the server's
// FEATURE_VISION (which stays authoritative — off ⇒ the request field is accepted but inert). Build-time
// gated so default builds and every visual baseline stay byte-identical.
const VISION_ASSIST_ENABLED = process.env.NEXT_PUBLIC_FEATURE_VISION === 'on';
/**
 * The LIVE-imagery variant of the vision trigger: the fixture handle becomes a real `gibs:` reference built
 * from the report's own position. Nested INSIDE `VISION_ASSIST_ENABLED` at the render site rather than being
 * an independent switch — live imagery without the vision toggle would be a control that fetches a satellite
 * tile and has nowhere to send it. Both default off, so the captured baselines see neither.
 */
const VISION_LIVE_ENABLED = process.env.NEXT_PUBLIC_FEATURE_VISION_LIVE === 'on';

/**
 * DEMO-ONLY dev-login: picks the current role + a userId → POST /auth/dev-login → stores the bearer token
 * (true per-user identity). Sits beside the role switcher. Renders nothing unless the demo IdP is enabled.
 */

/**
 * The Decision tab's approval wiring (WP-C2): VERIFIER/EM + an outstanding DRAFT ⇒ a real onApprove
 * (the SAME approve mutation as the Drafts tab — one approval path, Art. XIII); otherwise the REASON it
 * is unavailable (Art. XVI: labelled, never a dead control). The server enforces the role regardless —
 * this only decides whether the control is offered or explained. Extracted for the complexity ceiling.
 */
/**
 * What the approval surfaces should DISPLAY for the current mutation + queue state (2026-08-25).
 * - `approveError`: a FAILED approval must be labelled, never silent — before this, a rejected approve
 *   (e.g. the one seeded DRAFT already promoted in an earlier session) left the button looking dead.
 * - `approvedSticky`: "Approved" sticks only while it is true of what the tab shows — after the queue
 *   refetch removes the approved DRAFT, an EMPTY queue keeps the badge (the decision visibly stuck);
 *   a DIFFERENT draft arriving first re-enables the button so the next decision can be made
 *   (`approve.variables` is the id of the last approval). Previously `approve.isSuccess` alone badged
 *   "Approved" forever, hiding any newly arrived DRAFT behind a stale success.
 */
function approvalDisplayState(
  approve: ReturnType<typeof useApproveAlert>,
  draftAlerts: readonly DraftAlertItem[],
): { approveError: string | undefined; approvedSticky: boolean } {
  return {
    approveError: approve.isError ? approve.error.message : undefined,
    approvedSticky:
      approve.isSuccess && (draftAlerts.length === 0 || approve.variables === draftAlerts[0]?.id),
  };
}

function decisionApprovalProps(
  actorRole: ActorRole,
  firstDraft: DraftAlertItem | undefined,
  approveById: (id: string) => void,
  tDecision: (key: 'noDraftToApprove' | 'roleRequiredToApprove') => string,
): { onApprove: () => void } | { unavailableReason: string } {
  const canApprove = actorRole === 'VERIFIER' || actorRole === 'EM';
  if (canApprove && firstDraft !== undefined) {
    return { onApprove: () => approveById(firstDraft.id) };
  }
  return {
    unavailableReason: canApprove
      ? tDecision('noDraftToApprove')
      : tDecision('roleRequiredToApprove'),
  };
}

function DevLoginControl(): ReactNode {
  const t = useT('toolbar');
  const actorRole = useUiStore((s) => s.actorRole);
  const authToken = useUiStore((s) => s.authToken);
  const setAuthToken = useUiStore((s) => s.setAuthToken);
  const [userId, setUserId] = useState('');
  if (!DEV_LOGIN_ENABLED) return null;
  if (authToken !== undefined) {
    return (
      <Button
        variant="ghost"
        size="sm"
        data-testid="dev-logout"
        onClick={() => setAuthToken(undefined)}
      >
        {t('signedIn')}
      </Button>
    );
  }
  const signIn = (): void => {
    void devLogin(actorRole, userId).then((t) => {
      if (t !== undefined) setAuthToken(t);
    });
  };
  return (
    <span className="flex items-center gap-1">
      <input
        aria-label={t('devLoginUserId')}
        data-testid="dev-login-user"
        value={userId}
        onChange={(e) => setUserId(e.target.value)}
        placeholder={t('devLoginUserPlaceholder')}
        className="w-20 rounded bg-surface-2 px-1 py-0.5 text-xs text-fg"
      />
      <Button variant="ghost" size="sm" data-testid="dev-login" onClick={signIn}>
        {t('devLogin')}
      </Button>
    </span>
  );
}

/**
 * The drawn route IF it still belongs to the incident now selected, else nothing.
 *
 * A route is computed to avoid ONE incident's hazard area, so a path is meaningful only beside the
 * incident it was computed against. Switching incidents used to leave the previous escape route drawn —
 * a confident line for the wrong hazard (review, PR #12).
 */
function routeForIncident(
  route: DrawnRoute | undefined,
  selectedIncidentId: string | undefined,
): DrawnRoute | undefined {
  if (route === undefined) return undefined;
  return route.incidentId === selectedIncidentId ? route : undefined;
}

/** A discovered incident carries its region in its id (`discovered:<region>:…`); everything else is seeded. */
const isDiscoveredId = (id: string): boolean => id.startsWith('discovered:');

/**
 * ADR-043 — a region with no live hazard has no LIVE incident; say so in the reader's words. Under the
 * hybrid picture the seeded demo incident is still listed, and the notice then says that the incident on
 * the board is the demo scenario (owner decision, 2026-09-14): the reader is never left to assume that a
 * hand-seeded fire is today's.
 */
function NoLiveIncidents({
  loaded,
  live,
  incidentIds,
}: {
  readonly loaded: boolean;
  /** Deploy posture (NEXT_PUBLIC_DEPLOY_POSTURE=live): only a live deployment has a demo scenario to disclose. */
  readonly live: boolean;
  readonly incidentIds: readonly string[];
}): ReactNode {
  const tApp = useT('app');
  if (!loaded || incidentIds.some(isDiscoveredId)) return null;
  const demo = incidentIds.length > 0;
  // The offline/air-gapped product (ADR-043: the hand-seeded picture IS the whole product there) says
  // nothing; the seeded incidents are not a demo standing in for live data, they are the data.
  if (demo && !live) return null;
  return (
    <div data-testid="no-live-incidents" data-demo={demo ? 'true' : 'false'}>
      <EmptyState
        title={tApp('noLiveIncidentsTitle')}
        description={tApp(demo ? 'noLiveIncidentsDemoDescription' : 'noLiveIncidentsDescription')}
      />
    </div>
  );
}

export default function CopPage(): ReactNode {
  const t = useT('toolbar');
  const tApp = useT('app');
  const tShell = useT('shell');
  const tTabs = useT('tabs');
  const tPanels = useT('panels');
  const tAnticipatory = useT('anticipatory');
  const tDecision = useT('decision');
  const activeRegionId = useUiStore((s) => s.activeRegionId);
  const selectedIncidentId = useUiStore((s) => s.selectedIncidentId);
  const selectIncident = useUiStore((s) => s.selectIncident);
  const actorRole = useUiStore((s) => s.actorRole);
  const setRole = useUiStore((s) => s.setRole);
  const setPickedPoint = useUiStore((s) => s.setPickedPoint);
  const setMapView = useUiStore((s) => s.setMapView);

  const incidents = useIncidents(activeRegionId);
  // The envelope `data` is an OBJECT ({ regionId, incidents: [...] }) — read the array off `.incidents`.
  const incidentList = useMemo(
    () => (incidents.data ? incidentsOf(incidents.data) : []),
    [incidents.data],
  );

  // Auto-select the first incident of the active region so the SitRep panel has focus (monitor → assess).
  useEffect(() => {
    if (!selectedIncidentId && incidentList.length > 0) selectIncident(incidentList[0]!.id);
  }, [selectedIncidentId, incidentList, selectIncident]);

  // Map geometry flows THROUGH the deterministic core (GET /regions/:id/map) — the client only renders it
  // (Art. XII). Precise report geometry is server-gated by role (Art. XIV). Empty on load/error (Art. XVI).
  const serverMapData: MapData = useMapData(activeRegionId, actorRole);
  // The operator's own computed route is overlaid on the server's region picture, so the map draws the
  // one artefact the routing panel exists to produce. Merged here — the composition point — rather than
  // inside `useMapData`, which must keep returning exactly what the server sent (Art. XI: the provenance
  // on that envelope describes the server's data, and a client-computed overlay is not covered by it).
  // Read through the selector, never `drawnRoute` directly: it yields the path ONLY while it still belongs
  // to the incident now selected, so switching incidents cannot leave the previous escape route drawn.
  const drawnRoute = useUiStore((s) => s.drawnRoute);
  const activeRoute = routeForIncident(drawnRoute, selectedIncidentId);
  const mapData: MapData = useMemo(
    () => (activeRoute === undefined ? serverMapData : { ...serverMapData, route: activeRoute }),
    [serverMapData, activeRoute],
  );

  // Shelter capacity rows for the FR-8 capacity-vs-demand widget, from the SAME server projection the map
  // renders. `ShelterFeature.demand` IS the domain `occupancy` (map-projection.ts:316 — the projection
  // renames, it does not model a separate figure), so no number is invented here. Rows missing either
  // figure are dropped rather than defaulted: a fabricated 0/0 is exactly the F-409 defect this widget
  // already had once. Always passed (never undefined) so the board shows its labelled empty state instead
  // of hiding the section — degrade labelled, never a dead-end (Art. XVI).
  const shelterRows = useMemo(
    () =>
      (mapData.shelters ?? []).flatMap((s) =>
        s.capacity !== undefined && s.demand !== undefined
          ? [{ id: s.id, capacity: s.capacity, occupancy: s.demand }]
          : [],
      ),
    [mapData.shelters],
  );

  // The camera FOLLOWS the active region (found 2026-08-04 in the live capture: the engine's initial
  // center is the CA default and nothing ever re-aimed it, so switching to Romania kept the camera over
  // California while Romania's layers rendered off-screen — the multi-region claim died on camera).
  // Center = the region's config bbox midpoint; zoom = a Web-Mercator longitude-span fit, clamped to a
  // sane range. useMemo on the REGION ID is load-bearing, not a nicety: MapView deliberately recreates the
  // engine when center/zoom change identity, so these references must change only when the region does.
  const regionView = useMemo(() => {
    const bbox = shippedRegion(activeRegionId)?.bbox;
    if (bbox === undefined || bbox.length !== 4) return undefined; // no bbox ⇒ engine default, never a guess
    const [west, south, east, north] = bbox as readonly [number, number, number, number];
    const lonSpan = Math.max(east - west, 1e-6);
    return {
      center: [(west + east) / 2, (south + north) / 2] as const,
      zoom: Math.max(3, Math.min(12, Math.log2(360 / lonSpan))),
    };
  }, [activeRegionId]);
  const incidentRefs = useMemo<readonly NamedRef[]>(
    () => incidentList.map((i) => ({ id: i.id, label: i.headline ?? i.id })),
    [incidentList],
  );

  // decide → act datasets. GET /reports + /alerts are VERIFIER+ (403 for PUBLIC → empty list, never a dead-end).
  const reportsQuery = useReports(activeRegionId);
  const reportList = useMemo(
    () => (reportsQuery.data ? reportsOf(reportsQuery.data) : []),
    [reportsQuery.data],
  );
  const alertsQuery = useAlerts(activeRegionId);
  const draftAlerts = useMemo<readonly DraftAlertItem[]>(() => {
    if (!alertsQuery.data) return [];
    const prov = alertsQuery.data.provenance;
    return alertsOf(alertsQuery.data).map((a) => ({
      id: a.id,
      state: a.state,
      headline: `${a.severity ?? ''} ${a.category ?? 'alert'} — ${a.incidentId ?? ''}`.trim(),
      ...(a.incidentId !== undefined ? { incidentId: a.incidentId } : {}),
      // WP A8/F-301: the server's forecast evidence, carried through untouched — the client computes none of it.
      ...(a.forecast !== undefined ? { forecast: a.forecast } : {}),
      provenance: prov,
    }));
  }, [alertsQuery.data]);
  const approve = useApproveAlert(activeRegionId);
  const decisionApproval = decisionApprovalProps(
    actorRole,
    draftAlerts[0],
    (id) => approve.mutate(id),
    tDecision,
  );
  const { approveError, approvedSticky } = approvalDisplayState(approve, draftAlerts);

  // Decision support figures + narration are DERIVED from the selected incident's SitRep (engine numbers only).
  const decisionSitRep = useSitRep(selectedIncidentId);
  const sitRepView = decisionSitRep.data ? sitRepOf(decisionSitRep.data) : undefined;
  const decisionFigures = sitRepView ? decisionFiguresOf(sitRepView.data) : [];

  const noop = (): void => {};

  // The region LIST comes from config/regions.json (FR-ZONE-1) — adding a region is a config entry, not a
  // code edit. Only the LABEL comes from the catalog, so the selector translates and the existing visual
  // baselines keep their exact wording (finding F-22). A region without a catalog label falls back to its
  // id rather than rendering blank.
  const regions = useMemo<readonly RegionOption[]>(
    () =>
      SHIPPED_REGIONS.map((r) => ({
        id: r.id,
        label: tShell.has(`region.${r.id}` as 'region.us-ca')
          ? tShell(`region.${r.id}` as 'region.us-ca')
          : r.id,
      })),
    [tShell],
  );

  const panelRefs = useMemo<readonly NamedRef[]>(
    () => [
      { id: 'sitrep', label: tPanels('sitrepTitle') },
      { id: 'logistics', label: tPanels('logisticsTitle') },
    ],
    [tPanels],
  );

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <RegionSelector regions={regions} />
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm">
            {t('layers')}
          </Button>
        </PopoverTrigger>
        <PopoverContent>
          <LayerTogglePanel data={mapData} />
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm">
            {t('legend')}
          </Button>
        </PopoverTrigger>
        <PopoverContent>
          <Legend />
        </PopoverContent>
      </Popover>
      <PostureControl live={DEPLOY_POSTURE_LIVE} actorRole={actorRole} setRole={setRole} />
      <DevLoginControl />
      <LoginControl enabled={TOKEN_LOGIN_ENABLED} />
      {/* A7 (ADR-040) — the EM-only Directus link, in the account cluster next to the sign-in control. It
          gates itself on what the authenticated session read returned, so it needs no prop and no build-time
          flag: an unconfigured deployment and a non-EM session both render nothing. */}
      <DbAdminLink />
      <LocaleSwitcher />
      <ThemeToggle />
      {/* Owner request 2026-09-11 — the at-a-glance line: what is happening, what is waiting on this role,
          and how old the answer is. `sm:ms-auto` inside the strip pushes it to the trailing edge on real
          screens and lets it wrap onto its own line on a phone, where a squeezed row of figures would be
          harder to read than a wrapped one. Every figure is a length of a list the server already sent
          (Art. XII); the wall clock and the data's age are shown as separate facts on purpose. */}
      <StatusStrip regionId={activeRegionId} actorRole={actorRole} />
      {/* ADR-043 — under the live-only picture a region with no live hazard has no incident. Say so, in
          the reader's words, rather than leaving panels waiting on a selection that will never come. */}
      <NoLiveIncidents
        loaded={incidents.isSuccess}
        live={DEPLOY_POSTURE_LIVE}
        incidentIds={incidentList.map((i) => String(i.id))}
      />
      <CommandPalette
        regions={regions.map((r) => ({ id: r.id, label: r.label }))}
        incidents={incidentRefs}
        panels={panelRefs}
        onJumpPanel={noop}
        onTaskResource={noop}
        onDrawRoute={noop}
        onCreateAlert={noop}
      />
    </div>
  );

  const sitrep = (
    <Tabs defaultValue="sitrep">
      <TabsList>
        <TabsTrigger value="sitrep">{tTabs('sitrep')}</TabsTrigger>
        <TabsTrigger value="decision">{tTabs('decision')}</TabsTrigger>
        <TabsTrigger value="drafts">{tTabs('drafts')}</TabsTrigger>
        {/* D7 — the anticipatory tab is gated by the SAME build-time constant as the panel body, so with
            the flag off neither the trigger nor the content exists in the DOM and the COP renders exactly
            as it did before (F-194: the visual-baseline budget is spent; verified by running Playwright,
            not by argument — F-47). Turning it on is one env var plus one baseline regeneration. */}
        {ANTICIPATORY_PANEL_ENABLED ? (
          <TabsTrigger value="anticipatory">{tAnticipatory('tab')}</TabsTrigger>
        ) : null}
      </TabsList>
      <TabsContent value="sitrep">
        <SitRepPanel />
        {/* S3·U2 — each panel self-gates on its NEXT_PUBLIC_FEATURE_D4_* mirror (null when off), so the
            unconditional mount moves nothing in the pinned gate profile. */}
        <DamageReportsPanel className="mt-4" />
        <EmsOverlayPanel className="mt-4" />
      </TabsContent>
      <TabsContent value="decision">
        {/* The Decision tab's Approve acts on the region's FIRST outstanding DRAFT alert — the same
            approve mutation as the Drafts tab, so there is exactly ONE approval path (Art. XIII).
            Until 2026-08-05 no onApprove was passed at all, so the HITL keystone control rendered
            permanently disabled with no explanation — reading as broken rather than enforced. When it
            IS unavailable, the reason is spelled out (Art. XVI: labelled, never a dead control). */}
        <DecisionSupport
          figures={decisionFigures}
          {...(sitRepView?.data.summary !== undefined
            ? { narration: sitRepView.data.summary }
            : {})}
          {...(sitRepView ? { citations: sitRepView.citations } : {})}
          {...decisionApproval}
          approved={approvedSticky}
          approveError={approveError}
        />
      </TabsContent>
      <TabsContent value="drafts">
        <DraftAlertReview
          alerts={draftAlerts}
          onApprove={(id) => approve.mutate(id)}
          approveError={approveError}
        />
      </TabsContent>
      {ANTICIPATORY_PANEL_ENABLED ? (
        <TabsContent value="anticipatory">
          <AnticipatoryPanel regionId={activeRegionId} />
        </TabsContent>
      ) : null}
    </Tabs>
  );

  const logistics = (
    <Tabs defaultValue="resources">
      <TabsList>
        <TabsTrigger value="resources">{tTabs('resources')}</TabsTrigger>
        <TabsTrigger value="verify">{tTabs('verify')}</TabsTrigger>
        <TabsTrigger value="report">{tTabs('report')}</TabsTrigger>
        <TabsTrigger value="route">{tTabs('route')}</TabsTrigger>
      </TabsList>
      <TabsContent value="resources">
        <LogisticsBoard incidentId={selectedIncidentId} shelters={shelterRows} />
        {/* S3·U1 — same self-gating contract as the SitRep-dock panels above (D4/D6 mirrors). */}
        <ShelterStatusPanel className="mt-4" />
        <SuppliesPanel className="mt-4" />
        <VolunteerTeamsPanel className="mt-4" />
      </TabsContent>
      {/* forceMount on the three INPUT-BEARING tabs (2026-08-25): their panels hold volatile local
          state — a half-typed SOS report + consent, route inputs, the verifier's vision toggles and
          optimistic decisions — and Radix unmounts inactive tab content by default, so switching tabs
          silently destroyed a crisis operator's in-progress input. forceMount keeps them mounted while
          Radix still `hidden`s the inactive panel (no visual or layout change). Query-only tabs keep
          the default unmount — nothing user-authored lives in them. */}
      <TabsContent value="verify" forceMount>
        <VerifierQueue
          reports={reportList}
          regionId={activeRegionId}
          visionEnabled={VISION_ASSIST_ENABLED}
          visionLiveEnabled={VISION_LIVE_ENABLED}
        />
      </TabsContent>
      <TabsContent value="report" forceMount>
        <SosForm citizenStreamEnabled={CITIZEN_STREAM_ENABLED} />
      </TabsContent>
      <TabsContent value="route" forceMount>
        <RoutingPanel />
      </TabsContent>
    </Tabs>
  );

  return (
    // `lg:h-full` (not h-full) is deliberate: only the side-docked desktop/EOC layout is pinned to the
    // viewport, so the map stays put and each dock scrolls itself. Phone/tablet keep the stacked
    // bottom-sheet dock and normal page scrolling, which is the right behaviour on a small screen.
    <main id="main" className="lg:h-full">
      {/* F-320 — the COP's refresh engine. Without this line the SSE client is dead code and the screen
          never changes after first load: every hook above is a one-shot fetch. RegionStream opens the
          region-keyed delta channel (falling back to polling on a drop, Art. XVI) and invalidates the
          precise query keys those hooks read from, so a delta REFETCHES grounded data over REST rather
          than carrying any of it (Art. XII). Mounted here because this is where the active region lives. */}
      <RegionStream regionId={activeRegionId} />
      {/* Every timestamp below this point is formatted in the ACTIVE REGION's timezone (FR-I18N-4), not the
          viewer's — a Romanian gauge reading labelled in California time would be a quietly wrong fact.
          An unconfigured region resolves to UTC, which is honest rather than plausible. */}
      <RegionTimeZone timeZone={regionTimeZone(activeRegionId)}>
        {/* Carry the definite height through the card so CopLayout's own `h-full` finally resolves. */}
        <Panel title={tApp('title')} headingLevel="h1" className="lg:h-full">
          <CopLayout
            map={
              <MapView
                data={mapData}
                // Map click → the picked coordinate, which the SOS form and the evac-route form pre-fill
                // from. `setPickedPoint` is a stable zustand action, so this never remounts the engine.
                onMapClick={setPickedPoint}
                // Camera settled → the store's live viewport, which every external deep-link is built
                // from. Also a stable zustand action, so the engine is never rebuilt by this prop.
                onViewChange={setMapView}
                {...(regionView !== undefined
                  ? { center: regionView.center, zoom: regionView.zoom }
                  : {})}
              />
            }
            sitrep={sitrep}
            logistics={logistics}
            toolbar={toolbar}
          />
        </Panel>
      </RegionTimeZone>
    </main>
  );
}
