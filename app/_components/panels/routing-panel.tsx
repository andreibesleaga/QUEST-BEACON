'use client';
// BEACON — Evac routing (E8·T-382/T-383; FR-7/FR-8/EV7). A route-request form (origin + trigger) posts via
// useRequestRoute; the result renders the ranked nearest shelters with capacity shown. Ranking/order come
// from the server response (deterministic) — never re-sorted here (Art. XII).
import { useEffect, useId, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Home, Route } from 'lucide-react';
import { Button, EmptyState, Panel } from '../ui/index.js';
import { useFormat, useT } from '../../_lib/i18n.js';
import { useRequestRoute } from '../../_lib/hooks.js';
import { useUiStore } from '../../_lib/store.js';
import type { RequestRouteBody, RouteData, ShelterMatch } from '../../_lib/types.js';

export interface NearestSheltersProps {
  shelters: readonly ShelterMatch[];
}

/**
 * Ranked nearest shelters — order is the server's, never re-sorted here (Art. XII).
 *
 * F-406: this rendered `s.name ?? s.id` and an optional `s.demand`, neither of which exists on the `Shelter`
 * entity the server actually sends. The row now shows what a shelter genuinely carries — OCCUPANCY against
 * CAPACITY, plus its status — which is also the more useful number during an evacuation: "how full is it".
 */
export function NearestShelters({ shelters }: NearestSheltersProps): ReactNode {
  const t = useT('routingPanel');
  if (shelters.length === 0) {
    return (
      <EmptyState
        title={t('noSheltersTitle')}
        description={t('noSheltersDescription')}
        icon={Home}
      />
    );
  }
  return (
    <ol className="flex flex-col gap-2" aria-label={t('nearestShelters')}>
      {shelters.map((s, i) => (
        <li
          key={s.id}
          className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface p-2 text-sm"
        >
          <span className="flex items-center gap-2 text-fg">
            <span className="min-w-6 shrink-0 rounded bg-surface-2 px-1.5 text-center font-semibold tabular-nums">
              {i + 1}
            </span>
            {s.id}
          </span>
          <span className="tabular-nums text-fg-muted">
            {s.occupancy}/{s.capacity} · {s.status}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Build the POST /routes body (F-361). `origin` is a `[lon, lat]` Position — GeoJSON axis order, the same
 * order the domain uses everywhere — NOT the `{lat, lon}` object this used to send. `destination` is
 * deliberately omitted: the server resolves the nearest OPEN shelter deterministically (Art. XII), which is
 * what the published contract promised and what this panel renders.
 *
 * `incidentId` is REQUIRED by the route (the hazard polygon to avoid comes from it), so a missing incident
 * is surfaced to the user as a disabled submit rather than sent and rejected — see the guard at the call site.
 * The old `regionId` fallback is gone: no route has ever read it, so it could only ever have produced a 400.
 */
function buildRouteBody(
  origin: readonly [lat: number, lon: number] | undefined,
  incidentId: string,
): RequestRouteBody {
  // No origin ⇒ the server starts from the incident's own place (its footprint centre, 2026-09-14).
  return origin === undefined ? { incidentId } : { origin: [origin[1], origin[0]], incidentId };
}

/* The route itself (WP-E, 2026-08-05): `avoidsHazard` and `suggestedStart` were computed, served and
   OpenAPI-documented but NEVER RENDERED — the FR-7 evac-start recommendation was invisible in the
   product. All three lines are ENGINE outputs shown verbatim (Art. XII); the suggested start is a
   labelled first-order recommendation, never a directive. Extracted from RoutingPanel 2026-08-10 when
   the engine label pushed the panel over the complexity gate. */
function RouteSummary({ route }: { route: RouteData['route'] }): ReactNode {
  const t = useT('routingPanel');
  // FR-I18N-4: the instant is formatted in the ACTIVE locale and the region's timezone. It used to render
  // `toUTCString()`, whose English month/day abbreviations ("Mon, 06 Jul 2026") were fixed in all 14
  // locales — an evacuation start time an operator has to decode is a usability defect on a timed decision.
  const format = useFormat();
  return (
    <div className="mb-3 flex flex-col gap-1 text-sm" data-testid="route-summary">
      <p className={route.avoidsHazard ? 'text-fg' : 'text-stale'}>
        {route.avoidsHazard ? t('avoidsHazard') : t('heuristicFallback')}
      </p>
      {/* Which engine drew the geometry — an honest label, not a quality score. Absent engine ⇒ no
          label (never guessed). Road routing exists only behind FEATURE_ROUTING=ors + a key. */}
      {route.engine !== undefined ? (
        <p className="text-xs text-fg-muted" data-testid="route-engine">
          {route.engine === 'ors' ? t('engineOrs') : t('engineHeuristic')}
        </p>
      ) : null}
      <RouteNarrative route={route} />
      {route.suggestedStart !== undefined ? (
        <p className="text-fg" data-testid="suggested-start">
          <span className="font-semibold">{t('suggestedStart')}&nbsp;</span>
          {/* The machine-readable `dateTime` keeps the untouched ISO instant; only the RENDERED form is
              localized, so a parser and a screen reader never disagree about which moment this is. */}
          <time dateTime={route.suggestedStart}>
            {format.dateTime(new Date(route.suggestedStart), {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </time>
          <span className="text-xs text-fg-muted"> {t('suggestedStartCaveat')}</span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * The route in words (2026-09-14, owner: "if you cannot show it on the map, describe it"). Distance and
 * duration are the ENGINE's figures — ORS's summary, or the straight-line rung's great-circle distance and
 * clearance estimate, labelled as such — and the turn list is ORS's instructions verbatim. Nothing here is
 * computed in the browser (Art. XII); absent figures render nothing rather than a guess.
 */
function RouteNarrative({ route }: { route: RouteData['route'] }): ReactNode {
  const t = useT('routingPanel');
  const hasFigure = route.distanceM !== undefined || route.durationSec !== undefined;
  const hasSteps = route.steps !== undefined && route.steps.length > 0;
  if (!hasFigure && !hasSteps) return null;
  return (
    <div className="flex flex-col gap-1" data-testid="route-narrative">
      <DistanceLine route={route} label={t('distance')} caveat={t('straightLineCaveat')} />
      <DurationLine route={route} label={t('duration')} />
      {hasSteps ? <StepsList steps={route.steps ?? []} label={t('steps')} /> : null}
    </div>
  );
}

function DistanceLine({
  route,
  label,
  caveat,
}: {
  route: RouteData['route'];
  label: string;
  caveat: string;
}): ReactNode {
  const format = useFormat();
  if (route.distanceM === undefined) return null;
  return (
    <p className="text-fg">
      <span className="font-semibold">{label}&nbsp;</span>
      <span className="tabular-nums">
        {format.number(route.distanceM / 1000, { maximumFractionDigits: 1 })} km
      </span>
      {route.engine === 'heuristic' ? (
        <span className="text-xs text-fg-muted"> ({caveat})</span>
      ) : null}
    </p>
  );
}

function DurationLine({ route, label }: { route: RouteData['route']; label: string }): ReactNode {
  const format = useFormat();
  if (route.durationSec === undefined) return null;
  return (
    <p className="text-fg">
      <span className="font-semibold">{label}&nbsp;</span>
      <span className="tabular-nums">{format.number(Math.round(route.durationSec / 60))} min</span>
    </p>
  );
}

function StepsList({ steps, label }: { steps: readonly string[]; label: string }): ReactNode {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-semibold">
        {label} ({steps.length})
      </summary>
      <ol className="ms-4 list-decimal text-fg-muted">
        {steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
    </details>
  );
}

export interface RoutingPanelProps {
  className?: string | undefined;
}

export function RoutingPanel({ className }: RoutingPanelProps): ReactNode {
  const t = useT('routingPanel');
  const selectedIncidentId = useUiStore((s) => s.selectedIncidentId);
  const route = useRequestRoute();
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');

  // Map click → the evacuation ORIGIN. Picking "where the people are" off the map is the natural gesture
  // on a COP; typing a decimal pair under time pressure is not. Fields stay editable (pre-fill, not lock).
  const pickedPoint = useUiStore((s) => s.pickedPoint);
  useEffect(() => {
    if (pickedPoint === undefined) return;
    const [pLon, pLat] = pickedPoint;
    setLat(pLat.toFixed(6));
    setLon(pLon.toFixed(6));
  }, [pickedPoint]);
  // PUT THE COMPUTED ROUTE ON THE MAP (2026-09-12, owner-reported).
  //
  // The panel used to end at its own summary: it told the operator when to leave and which shelters were
  // nearest, and drew nothing on the ground the advice applies to. The map's route layer was already built
  // and wired — `buildRouteLayers` reads `MapData.route` — but `MapData` is the server's region picture,
  // and a route the operator has just requested is not part of any region's picture. Nothing bridged the
  // two, so the single artefact this panel exists to produce was the one thing it could not show.
  //
  // The server's `geom` is a GeoJSON LineString, whose coordinates are already `[lon, lat]` — the same
  // order the map uses — so the path passes through with no axis flip to get wrong.
  const setDrawnRoute = useUiStore((s) => s.setDrawnRoute);
  // ...and TURN THE LAYER ON. The route layer ships off by default (only fire, flood and reports are on),
  // so publishing the route without this left it in the map's data and still invisible — the same bug one
  // step further along. `showLayer` is idempotent on purpose: `toggleLayer` would HIDE the route for an
  // operator who already had the layer enabled, which is the opposite of what asking for a route means.
  const showLayer = useUiStore((s) => s.showLayer);
  const routeData = route.data?.data.route;
  useEffect(() => {
    // NO ROUTE IN HAND ⇒ NOTHING DRAWN. The first version returned early here, which left the previous
    // route on the map while a new request was in flight or after one failed — so the operator saw a
    // confident path that no longer corresponded to anything they had asked for. Clearing is the honest
    // state: an evacuation map that shows nothing is a map you go and check, and one that shows the wrong
    // line is a map you act on (review, PR #12).
    if (routeData === undefined) {
      setDrawnRoute(undefined);
      return;
    }
    setDrawnRoute({
      id: routeData.id,
      // The identity the overlay is only valid beside. Taken from the SERVER's answer, not from the
      // panel's current selection, so the path is tied to the incident it was actually computed against.
      incidentId: routeData.incidentId,
      path: routeData.geom.coordinates.map((c) => [c[0], c[1]] as const),
      hazardAvoided: routeData.avoidsHazard,
    });
    showLayer('route');
  }, [routeData, setDrawnRoute, showLayer]);

  const latId = useId();
  const lonId = useId();
  // The hazard polygon a route must avoid comes FROM the incident, so there is no meaningful evacuation
  // route without one. Surfaced as a disabled control plus a stated reason (Art. XVI: degrade with a
  // label, never a dead-end) instead of posting a body the server would correctly reject.
  const canRoute = selectedIncidentId !== undefined && selectedIncidentId !== '';

  function onSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    if (!canRoute) return;
    if (lat.trim() === '' && lon.trim() === '') {
      route.mutate(buildRouteBody(undefined, selectedIncidentId));
      return;
    }
    const nLat = Number.parseFloat(lat);
    const nLon = Number.parseFloat(lon);
    if (!Number.isFinite(nLat) || !Number.isFinite(nLon)) return;
    route.mutate(buildRouteBody([nLat, nLon], selectedIncidentId));
  }

  const inputClass = 'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg';

  return (
    <Panel title={t('title')} className={className} data-testid="routing-panel">
      <form onSubmit={onSubmit} className="flex flex-col gap-2" aria-label={t('formLabel')}>
        {/* Name the map-click gesture: an affordance nobody is told about does not exist. */}
        <p className="text-xs text-fg-muted">{t('clickHint')}</p>
        {t('originDefaultHint')}
        <div className="flex gap-2">
          <div className="flex-1">
            <label htmlFor={latId} className="mb-1 block text-xs font-medium text-fg-muted">
              {t('originLat')}
            </label>
            <input
              id={latId}
              inputMode="decimal"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              className={inputClass}
              placeholder="34.05"
            />
          </div>
          <div className="flex-1">
            <label htmlFor={lonId} className="mb-1 block text-xs font-medium text-fg-muted">
              {t('originLon')}
            </label>
            <input
              id={lonId}
              inputMode="decimal"
              value={lon}
              onChange={(e) => setLon(e.target.value)}
              className={inputClass}
              placeholder="-118.24"
            />
          </div>
        </div>
        <Button type="submit" variant="primary" disabled={route.isPending || !canRoute}>
          <Route aria-hidden="true" className="size-4" strokeWidth={2} />
          {route.isPending ? t('submitting') : t('submit')}
        </Button>
        {canRoute ? null : <p className="text-xs text-fg-muted">{t('needIncident')}</p>}
      </form>

      {route.isError ? (
        <p role="alert" className="mt-3 text-xs text-alert">
          {t('requestFailed', { message: route.error.message })}
        </p>
      ) : null}

      {route.data ? (
        <section aria-label={t('resultLabel')} className="mt-4 border-t border-line pt-3">
          <RouteSummary route={route.data.data.route} />
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            {t('nearestShelters')}
          </h3>
          <NearestShelters shelters={route.data.data.shelters} />
        </section>
      ) : null}
    </Panel>
  );
}
