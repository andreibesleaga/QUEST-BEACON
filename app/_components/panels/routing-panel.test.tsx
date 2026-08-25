// @vitest-environment happy-dom
// BEACON — RoutingPanel tests (E8·T-382/T-383). Submitting requests a route with the typed origin; the
// nearest-shelters result renders ranked with capacity shown (order preserved from the server).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { useRequestRoute } = vi.hoisted(() => ({ useRequestRoute: vi.fn() }));
vi.mock('../../_lib/hooks.js', () => ({ useRequestRoute }));
const { useUiStore } = vi.hoisted(() => ({ useUiStore: vi.fn() }));
vi.mock('../../_lib/store.js', () => ({ useUiStore }));

import { NearestShelters, RoutingPanel } from './routing-panel.js';
import type { ShelterMatch } from '../../_lib/types.js';
import type { Shelter } from '@/domain/shelter.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { ShelterId } from '@/domain/value-objects/ids.js';

const mutate = vi.fn();

beforeEach(() => {
  mutate.mockReset();
  useRequestRoute.mockReturnValue({ mutate, isPending: false, isError: false, data: undefined });
  useUiStore.mockImplementation(
    (sel: (s: { activeRegionId: string; selectedIncidentId?: string | undefined; pickedPoint?: readonly [number, number] | undefined }) => unknown) =>
      sel({ activeRegionId: 'socal', selectedIncidentId: undefined, pickedPoint: undefined }),
  );
});

// Map click → origin. On a COP the operator points at where the people are; typing a decimal pair under
// time pressure is the failure mode this replaces. `pickedPoint` is [lon, lat] (GeoJSON order), so this
// also pins the axis convention — a silent swap here would route people in the wrong direction.
describe('RoutingPanel — origin pre-filled from a map click', () => {
  it('fills origin lat/lon from the picked point, respecting [lon, lat] order', () => {
    useUiStore.mockImplementation(
      (sel: (s: { activeRegionId: string; selectedIncidentId?: string | undefined; pickedPoint?: readonly [number, number] | undefined }) => unknown) =>
        sel({ activeRegionId: 'socal', selectedIncidentId: 'inc-1', pickedPoint: [-118.24, 34.05] }),
    );
    render(<RoutingPanel />);
    expect(screen.getByLabelText(/Origin latitude/i)).toHaveValue('34.050000');
    expect(screen.getByLabelText(/Origin longitude/i)).toHaveValue('-118.240000');
  });

  it('leaves the fields empty when nothing has been picked', () => {
    render(<RoutingPanel />);
    expect(screen.getByLabelText(/Origin latitude/i)).toHaveValue('');
  });
});

// F-406: these fixtures used to be `{id, name, capacity}` — `name` is a field the `Shelter` entity has never
// had. Building a fixture from an invented shape is how a component test comes to certify a rendering the
// product can never produce; `ShelterMatch` is now the domain entity, so a fixture like that no longer
// compiles. Every field below is one the server genuinely sends.
function shelter(id: string, capacity: number, occupancy: number, status: Shelter['status'] = 'OPEN'): Shelter {
  return {
    id: asId<ShelterId>(id),
    geom: { type: 'Point', coordinates: [-118.24, 34.05] },
    capacity,
    occupancy,
    status,
  };
}

describe('NearestShelters', () => {
  it('renders ranked shelters with their real occupancy against capacity', () => {
    const shelters: ShelterMatch[] = [shelter('s1', 200, 40), shelter('s2', 100, 90)];
    render(<NearestShelters shelters={shelters} />);
    const list = screen.getByRole('list', { name: 'Nearest shelters' });
    expect(list).toHaveTextContent('s1');
    expect(list).toHaveTextContent('40/200');
    expect(list).toHaveTextContent('OPEN');
  });
});

describe('RoutingPanel', () => {
  // F-361: the body asserted here is the one the server actually parses — `origin` as a [lon, lat] Position
  // with the incident whose hazard the route must avoid. The previous assertion (`{origin: {lat, lon},
  // regionId}`) was green while POST /routes 400'd on every real submit, because it only ever checked what
  // the client passed to a MOCKED hook — no server, real or simulated, was ever involved.
  it('requests a route with the typed origin when an incident is selected', async () => {
    useUiStore.mockImplementation(
      (sel: (s: { activeRegionId: string; selectedIncidentId?: string | undefined }) => unknown) =>
        sel({ activeRegionId: 'socal', selectedIncidentId: 'inc-1' }),
    );
    const user = userEvent.setup();
    render(<RoutingPanel />);
    await user.type(screen.getByLabelText('Origin latitude'), '34.05');
    await user.type(screen.getByLabelText('Origin longitude'), '-118.24');
    await user.click(screen.getByRole('button', { name: /Request route/ }));
    expect(mutate).toHaveBeenCalledWith({ origin: [-118.24, 34.05], incidentId: 'inc-1' });
  });

  it('cannot submit without a selected incident, and says why (Art. XVI — labelled, not a dead-end)', async () => {
    render(<RoutingPanel />); // beforeEach leaves selectedIncidentId undefined
    expect(screen.getByRole('button', { name: /Request route/ })).toBeDisabled();
    expect(screen.getByText(/Select an incident first/)).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });
});

// WP-E (2026-08-05): `avoidsHazard` + `suggestedStart` were computed, served and documented but NEVER
// rendered — the FR-7 evac-start recommendation was invisible. These pin the new route-summary section.
describe('RoutingPanel — route summary (avoidsHazard + suggested start)', () => {
  function withRouteResult(avoidsHazard: boolean, suggestedStart?: string, engine?: 'ors' | 'heuristic'): void {
    useRequestRoute.mockReturnValue({
      mutate,
      isPending: false,
      isError: false,
      data: {
        data: {
          route: {
            id: 'evac-1',
            incidentId: 'inc-1',
            geom: { type: 'LineString', coordinates: [[-120, 38], [-120.1, 38.1]] },
            avoidsHazard,
            ...(suggestedStart !== undefined ? { suggestedStart } : {}),
            ...(engine !== undefined ? { engine } : {}),
          },
          shelters: [],
        },
        provenance: [{ sourceId: 'evac-routing', mode: 'MOCK', fetchedAt: '2026-07-05T22:00:00Z' }],
        freshness: '2026-07-05T22:00:00Z',
      },
    });
  }

  it('shows the hazard-avoidance state and the labelled first-order suggested start', () => {
    withRouteResult(true, '2026-07-06T00:30:00Z');
    render(<RoutingPanel />);
    expect(screen.getByTestId('route-summary')).toHaveTextContent('Route avoids the incident hazard area.');
    expect(screen.getByTestId('suggested-start')).toHaveTextContent('Suggested evacuation start:');
    expect(screen.getByTestId('suggested-start')).toHaveTextContent('first-order estimate');
  });

  it('labels the heuristic straight-line fallback honestly and omits the start when the engine has none', () => {
    withRouteResult(false);
    render(<RoutingPanel />);
    expect(screen.getByTestId('route-summary')).toHaveTextContent('could not be avoided');
    expect(screen.queryByTestId('suggested-start')).not.toBeInTheDocument();
  });

  // 2026-08-10: the served `engine` tag ('ors' | 'heuristic') is rendered as an honest label, and an
  // absent tag renders NOTHING — the panel never guesses which engine drew the geometry.
  it('names the ORS road-routing engine when the route says so', () => {
    withRouteResult(true, undefined, 'ors');
    render(<RoutingPanel />);
    expect(screen.getByTestId('route-engine')).toHaveTextContent('Road routing (OpenRouteService)');
  });

  it('names the heuristic engine, with its not-road-following caveat', () => {
    withRouteResult(true, undefined, 'heuristic');
    render(<RoutingPanel />);
    expect(screen.getByTestId('route-engine')).toHaveTextContent('heuristic');
    expect(screen.getByTestId('route-engine')).toHaveTextContent('not road-following');
  });

  it('shows no engine label at all when the route carries no engine tag', () => {
    withRouteResult(true);
    render(<RoutingPanel />);
    expect(screen.queryByTestId('route-engine')).not.toBeInTheDocument();
  });
});
