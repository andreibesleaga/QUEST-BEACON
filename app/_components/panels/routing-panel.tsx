'use client';
// BEACON — Evac routing (E8·T-382/T-383; FR-7/FR-8/EV7). A route-request form (origin + trigger) posts via
// useRequestRoute; the result renders the ranked nearest shelters with capacity shown. Ranking/order come
// from the server response (deterministic) — never re-sorted here (Art. XII).
import { useEffect, useId, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Home, Route } from 'lucide-react';
import { Button, EmptyState, Panel } from '../ui/index.js';
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
  if (shelters.length === 0) {
    return <EmptyState title="No shelters matched" description="No shelters in range for this origin." icon={Home} />;
  }
  return (
    <ol className="flex flex-col gap-2" aria-label="Nearest shelters">
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
function buildRouteBody(lat: number, lon: number, incidentId: string): RequestRouteBody {
  return { origin: [lon, lat], incidentId };
}

/* The route itself (WP-E, 2026-08-05): `avoidsHazard` and `suggestedStart` were computed, served and
   OpenAPI-documented but NEVER RENDERED — the FR-7 evac-start recommendation was invisible in the
   product. All three lines are ENGINE outputs shown verbatim (Art. XII); the suggested start is a
   labelled first-order recommendation, never a directive. Extracted from RoutingPanel 2026-08-10 when
   the engine label pushed the panel over the complexity gate. */
function RouteSummary({ route }: { route: RouteData['route'] }): ReactNode {
  return (
    <div className="mb-3 flex flex-col gap-1 text-sm" data-testid="route-summary">
      <p className={route.avoidsHazard ? 'text-fg' : 'text-stale'}>
        {route.avoidsHazard
          ? 'Route avoids the incident hazard area.'
          : 'Direct path only — the hazard area could not be avoided (heuristic fallback). Treat with caution.'}
      </p>
      {/* Which engine drew the geometry — an honest label, not a quality score. Absent engine ⇒ no
          label (never guessed). Road routing exists only behind FEATURE_ROUTING=ors + a key. */}
      {route.engine !== undefined ? (
        <p className="text-xs text-fg-muted" data-testid="route-engine">
          {route.engine === 'ors'
            ? 'Road routing (OpenRouteService)'
            : 'Hazard-avoiding heuristic (offline engine — not road-following)'}
        </p>
      ) : null}
      {route.suggestedStart !== undefined ? (
        <p className="text-fg" data-testid="suggested-start">
          <span className="font-semibold">Suggested evacuation start:&nbsp;</span>
          <time dateTime={route.suggestedStart}>{new Date(route.suggestedStart).toUTCString()}</time>
          <span className="text-xs text-fg-muted">
            {' '}
            (projected hazard arrival − route clearance − safety margin; first-order estimate)
          </span>
        </p>
      ) : null}
    </div>
  );
}

export interface RoutingPanelProps {
  className?: string | undefined;
}

export function RoutingPanel({ className }: RoutingPanelProps): ReactNode {
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
  const latId = useId();
  const lonId = useId();
  // The hazard polygon a route must avoid comes FROM the incident, so there is no meaningful evacuation
  // route without one. Surfaced as a disabled control plus a stated reason (Art. XVI: degrade with a
  // label, never a dead-end) instead of posting a body the server would correctly reject.
  const canRoute = selectedIncidentId !== undefined && selectedIncidentId !== '';

  function onSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    if (!canRoute) return;
    const nLat = Number.parseFloat(lat);
    const nLon = Number.parseFloat(lon);
    if (!Number.isFinite(nLat) || !Number.isFinite(nLon)) return;
    route.mutate(buildRouteBody(nLat, nLon, selectedIncidentId));
  }

  const inputClass = 'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg';

  return (
    <Panel title="Evacuation routing" className={className} data-testid="routing-panel">
      <form onSubmit={onSubmit} className="flex flex-col gap-2" aria-label="Request an evacuation route">
        {/* Name the map-click gesture: an affordance nobody is told about does not exist. */}
        <p className="text-xs text-fg-muted">Click the map to set the origin, or type coordinates.</p>
        <div className="flex gap-2">
          <div className="flex-1">
            <label htmlFor={latId} className="mb-1 block text-xs font-medium text-fg-muted">
              Origin latitude
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
              Origin longitude
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
          {route.isPending ? 'Routing…' : 'Request route'}
        </Button>
        {canRoute ? null : (
          <p className="text-xs text-fg-muted">
            Select an incident first — the route is computed to avoid that incident&apos;s hazard area.
          </p>
        )}
      </form>

      {route.isError ? (
        <p role="alert" className="mt-3 text-xs text-alert">
          Route request failed: {route.error.message}
        </p>
      ) : null}

      {route.data ? (
        <section aria-label="Route result" className="mt-4 border-t border-line pt-3">
          <RouteSummary route={route.data.data.route} />
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            Nearest shelters
          </h3>
          <NearestShelters shelters={route.data.data.shelters} />
        </section>
      ) : null}
    </Panel>
  );
}
