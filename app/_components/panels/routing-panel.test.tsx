// @vitest-environment happy-dom
// BEACON — RoutingPanel tests (E8·T-382/T-383). Submitting requests a route with the typed origin; the
// nearest-shelters result renders ranked with capacity shown (order preserved from the server).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { useRequestRoute } = vi.hoisted(() => ({ useRequestRoute: vi.fn() }));
vi.mock('../../_lib/hooks.js', () => ({ useRequestRoute }));
const { useUiStore } = vi.hoisted(() => ({ useUiStore: vi.fn() }));
vi.mock('../../_lib/store.js', () => ({ useUiStore }));

import { NearestShelters, RoutingPanel } from './routing-panel.js';
import { IntlProvider, type Messages } from '../../_lib/i18n.js';
import enMessages from '../../../messages/en.json';
import roMessages from '../../../messages/ro.json';
import type { ShelterMatch } from '../../_lib/types.js';
import type { Shelter } from '@/domain/shelter.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { ShelterId } from '@/domain/value-objects/ids.js';

const mutate = vi.fn();
// The two store actions the panel calls once a route comes back. Real spies, not no-ops: the test below
// asserts on what they receive, because publishing the route IS the fix — the panel used to compute a
// route and leave the map blank.
const setDrawnRoute = vi.fn();
const showLayer = vi.fn();

interface MockStore {
  activeRegionId: string;
  selectedIncidentId?: string | undefined;
  pickedPoint?: readonly [number, number] | undefined;
  setDrawnRoute: typeof setDrawnRoute;
  showLayer: typeof showLayer;
}

function mockStore(over: Partial<MockStore> = {}): void {
  useUiStore.mockImplementation((sel: (s: MockStore) => unknown) =>
    sel({
      activeRegionId: 'socal',
      selectedIncidentId: undefined,
      pickedPoint: undefined,
      setDrawnRoute,
      showLayer,
      ...over,
    }),
  );
}

beforeEach(() => {
  mutate.mockReset();
  setDrawnRoute.mockReset();
  showLayer.mockReset();
  useRequestRoute.mockReturnValue({ mutate, isPending: false, isError: false, data: undefined });
  mockStore();
});

// Map click → origin. On a COP the operator points at where the people are; typing a decimal pair under
// time pressure is the failure mode this replaces. `pickedPoint` is [lon, lat] (GeoJSON order), so this
// also pins the axis convention — a silent swap here would route people in the wrong direction.
describe('RoutingPanel — origin pre-filled from a map click', () => {
  it('fills origin lat/lon from the picked point, respecting [lon, lat] order', () => {
    mockStore({
      activeRegionId: 'socal',
      selectedIncidentId: 'inc-1',
      pickedPoint: [-118.24, 34.05],
    });
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
function shelter(
  id: string,
  capacity: number,
  occupancy: number,
  status: Shelter['status'] = 'OPEN',
): Shelter {
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
    mockStore({ activeRegionId: 'socal', selectedIncidentId: 'inc-1' });
    const user = userEvent.setup();
    render(<RoutingPanel />);
    await user.type(screen.getByLabelText('Origin latitude'), '34.05');
    await user.type(screen.getByLabelText('Origin longitude'), '-118.24');
    await user.click(screen.getByRole('button', { name: /Request route/ }));
    expect(mutate).toHaveBeenCalledWith({ origin: [-118.24, 34.05], incidentId: 'inc-1' });
  });

  it('with both origin fields empty, asks for a route from the incident’s own place (no origin in the body)', async () => {
    mockStore({ activeRegionId: 'socal', selectedIncidentId: 'inc-1' });
    const user = userEvent.setup();
    render(<RoutingPanel />);
    await user.click(screen.getByRole('button', { name: /Request route/ }));
    expect(mutate).toHaveBeenCalledWith({ incidentId: 'inc-1' });
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
  function withRouteResult(
    avoidsHazard: boolean,
    suggestedStart?: string,
    engine?: 'ors' | 'heuristic',
  ): void {
    useRequestRoute.mockReturnValue({
      mutate,
      isPending: false,
      isError: false,
      data: {
        data: {
          route: {
            id: 'evac-1',
            incidentId: 'inc-1',
            geom: {
              type: 'LineString',
              coordinates: [
                [-120, 38],
                [-120.1, 38.1],
              ],
            },
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
    expect(screen.getByTestId('route-summary')).toHaveTextContent(
      'Route avoids the incident hazard area.',
    );
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

// ── i18n (ADR-030; FR-I18N-1/2, WCAG 3.1.2) ──────────────────────────────────────────────────────────
// This panel shipped with NO translation hook at all, so under `lang="ar"` a screen reader applied Arabic
// pronunciation to English landmark names. Two of the strings pinned here are ACCESSIBLE NAMES (the form
// and the result section) and one is the heuristic-fallback CAUTION — a caution an operator cannot read is
// not a caution. The expectation is read FROM the catalogue (never a hard-coded Romanian string that would
// silently rot), plus an explicit "is not the English source" assertion, which is the actual regression.
// ── The route has to reach the MAP (owner-reported, 2026-09-12) ───────────────────────────────────────
//
// THE DEFECT. The panel computed a route, said when to leave and listed the nearest shelters, and drew
// nothing on the map. The map's route layer was fully built and wired — `buildRouteLayers` reads
// `MapData.route` — but `MapData` is the server's region picture, and a route the operator has just asked
// for is not part of any region's picture. Nothing bridged the two, so the single artefact this panel
// exists to produce was the one thing invisible on the ground it applies to.
//
// Two things must happen, and BOTH were missing: publish the path, and turn the layer on (it ships off).
describe('RoutingPanel — the computed route reaches the map', () => {
  const routed = (over: Record<string, unknown> = {}): void => {
    useRequestRoute.mockReturnValue({
      mutate,
      isPending: false,
      isError: false,
      data: {
        data: {
          route: {
            id: 'evac-7',
            incidentId: 'inc-1',
            geom: {
              type: 'LineString',
              coordinates: [
                [-120, 38],
                [-120.1, 38.1],
                [-120.2, 38.2],
              ],
            },
            avoidsHazard: true,
            ...over,
          },
          shelters: [],
        },
        provenance: [{ sourceId: 'evac-routing', mode: 'MOCK', fetchedAt: '2026-07-05T22:00:00Z' }],
        freshness: '2026-07-05T22:00:00Z',
      },
    });
  };

  it('publishes the path in [lon, lat] order, unflipped', () => {
    routed();
    render(<RoutingPanel />);
    expect(setDrawnRoute).toHaveBeenCalledWith({
      id: 'evac-7',
      // The identity the overlay is only valid beside, taken from the server's answer.
      incidentId: 'inc-1',
      // GeoJSON is already [lon, lat] and so is the map, so the coordinates pass straight through. A
      // transposed pair here would route people to another continent while every label still read right.
      path: [
        [-120, 38],
        [-120.1, 38.1],
        [-120.2, 38.2],
      ],
      hazardAvoided: true,
    });
  });

  it('turns the route layer on, because it ships OFF and the route would stay invisible', () => {
    routed();
    render(<RoutingPanel />);
    expect(showLayer).toHaveBeenCalledWith('route');
  });

  it('carries the hazard-avoidance flag through rather than assuming it', () => {
    routed({ avoidsHazard: false });
    render(<RoutingPanel />);
    expect(setDrawnRoute).toHaveBeenCalledWith(expect.objectContaining({ hazardAvoided: false }));
  });

  it('CLEARS the overlay when there is no route in hand, rather than leaving the last one drawn', () => {
    // The dangerous case (review, PR #12): a route is on the map, the operator asks for another, and the
    // request fails or is still in flight. `routeData` goes undefined. Returning early there left the
    // previous path drawn — a confident line corresponding to nothing the operator asked for. On an
    // evacuation map, showing nothing sends someone to check; showing the wrong line gets acted on.
    render(<RoutingPanel />); // default mock: data undefined
    expect(setDrawnRoute).toHaveBeenCalledWith(undefined);
    expect(showLayer).not.toHaveBeenCalled(); // and nothing is switched on for a route that does not exist
  });

  it('ties the overlay to the incident the SERVER computed it against, not the current selection', () => {
    // If these ever diverge — a slow response arriving after the operator moved on — the server's answer
    // is the truth about which hazard this path avoids, and the selector drops it rather than drawing it.
    routed({ incidentId: 'inc-OTHER' });
    render(<RoutingPanel />);
    expect(setDrawnRoute).toHaveBeenCalledWith(
      expect.objectContaining({ incidentId: 'inc-OTHER' }),
    );
  });
});

describe('RoutingPanel — i18n', () => {
  it('names its landmarks and renders its safety caveat from the active catalogue', () => {
    useRequestRoute.mockReturnValue({
      mutate,
      isPending: false,
      isError: false,
      data: {
        data: {
          route: {
            id: 'evac-1',
            incidentId: 'inc-1',
            geom: {
              type: 'LineString',
              coordinates: [
                [-120, 38],
                [-120.1, 38.1],
              ],
            },
            avoidsHazard: false,
          },
          // ONE shelter, not none: `nearestShelters` is the accessible NAME OF THE LIST, and an empty
          // result renders the empty state instead of a list, so the assertion below could never see it.
          shelters: [
            {
              id: 'shelter-1',
              geom: { type: 'Point', coordinates: [-120.05, 38.05] },
              capacity: 120,
              occupancy: 30,
              status: 'OPEN',
            },
          ],
        },
        provenance: [{ sourceId: 'evac-routing', mode: 'MOCK', fetchedAt: '2026-07-05T22:00:00Z' }],
        freshness: '2026-07-05T22:00:00Z',
      },
    });
    const ro = roMessages.routingPanel;
    render(
      <IntlProvider
        value={{ locale: 'ro', messages: roMessages as unknown as Messages, timeZone: 'UTC' }}
      >
        <RoutingPanel />
      </IntlProvider>,
    );
    expect(ro.formLabel).not.toBe(enMessages.routingPanel.formLabel); // the catalogue is genuinely translated
    expect(screen.getByRole('form', { name: ro.formLabel })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: ro.resultLabel })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: ro.nearestShelters })).toBeInTheDocument();
    expect(screen.getByTestId('route-summary')).toHaveTextContent(ro.heuristicFallback);
  });

  // FR-I18N-4: `toUTCString()` produced fixed English month names ("Mon, 06 Jul 2026") in all 14 locales.
  // The instant is now formatted through the ICU formatter in the active locale + region timezone, while
  // the machine-readable `dateTime` attribute keeps the untouched ISO instant.
  it('formats the suggested start with Intl, not toUTCString', () => {
    useRequestRoute.mockReturnValue({
      mutate,
      isPending: false,
      isError: false,
      data: {
        data: {
          route: {
            id: 'evac-1',
            incidentId: 'inc-1',
            geom: {
              type: 'LineString',
              coordinates: [
                [-120, 38],
                [-120.1, 38.1],
              ],
            },
            avoidsHazard: true,
            suggestedStart: '2026-07-06T00:30:00Z',
          },
          shelters: [],
        },
        provenance: [{ sourceId: 'evac-routing', mode: 'MOCK', fetchedAt: '2026-07-05T22:00:00Z' }],
        freshness: '2026-07-05T22:00:00Z',
      },
    });
    render(
      <IntlProvider
        value={{ locale: 'ro', messages: roMessages as unknown as Messages, timeZone: 'UTC' }}
      >
        <RoutingPanel />
      </IntlProvider>,
    );
    const start = screen.getByTestId('suggested-start');
    expect(start.textContent).not.toContain('GMT'); // the toUTCString signature
    expect(start.querySelector('time')).toHaveAttribute('datetime', '2026-07-06T00:30:00Z');
    expect(start).toHaveTextContent('2026');
  });
});

// ── 2026-09-14: the route in words (owner: "if you cannot show it on the map, describe it") ─────────────
describe('RoutingPanel — route narrative', () => {
  function withNarrative(route: Record<string, unknown>): void {
    useRequestRoute.mockReturnValue({
      mutate,
      isPending: false,
      isError: false,
      data: {
        data: {
          route: {
            id: 'evac-1',
            incidentId: 'inc-1',
            geom: {
              type: 'LineString',
              coordinates: [
                [-120, 38],
                [-120.1, 38.1],
              ],
            },
            avoidsHazard: true,
            ...route,
          },
          shelters: [],
        },
        provenance: [{ sourceId: 'evac-routing', mode: 'MOCK', fetchedAt: '2026-07-05T22:00:00Z' }],
        freshness: '2026-07-05T22:00:00Z',
      },
    } as unknown as ReturnType<typeof useRequestRoute>);
  }

  it('shows the engine’s distance, duration and turn list', () => {
    withNarrative({
      engine: 'ors',
      distanceM: 12_345,
      durationSec: 900,
      steps: ['Head north on Main St', 'Turn right'],
    });
    render(<RoutingPanel />);
    const n = screen.getByTestId('route-narrative');
    expect(n).toHaveTextContent('Distance');
    expect(n).toHaveTextContent('12.3 km');
    expect(n).toHaveTextContent('15 min');
    expect(n).toHaveTextContent('Turn by turn (2)');
    expect(n).toHaveTextContent('Head north on Main St');
    expect(n).not.toHaveTextContent('straight-line');
  });

  it('labels a heuristic distance as a straight-line estimate, and renders nothing when the route carries no figures', () => {
    withNarrative({ engine: 'heuristic', distanceM: 28_000, durationSec: 4000 });
    render(<RoutingPanel />);
    expect(screen.getByTestId('route-narrative')).toHaveTextContent('straight-line estimate');
    cleanup();
    withNarrative({});
    render(<RoutingPanel />);
    expect(screen.queryByTestId('route-narrative')).not.toBeInTheDocument();
  });
});
