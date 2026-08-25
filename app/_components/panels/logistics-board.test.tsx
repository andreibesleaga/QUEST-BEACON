// @vitest-environment happy-dom
// BEACON — LogisticsBoard tests (E8·T-384…T-386; W2d flagship-4). The shelter widget shows a NUMERIC
// (non-colour) capacity ratio + shape; a tasking 409/403 surfaces as a LABELLED error (only-from-VERIFIED is
// server-enforced); the pre-positioning panel is always advisory-labelled and every state is a designed
// empty state (never a blank panel, Art. XVI/XIII).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { useResources, useTaskResource, usePrePositioning } = vi.hoisted(() => ({
  useResources: vi.fn(),
  useTaskResource: vi.fn(),
  usePrePositioning: vi.fn(),
}));
vi.mock('../../_lib/hooks.js', () => ({ useResources, useTaskResource, usePrePositioning }));
const { useUiStore } = vi.hoisted(() => ({ useUiStore: vi.fn() }));
vi.mock('../../_lib/store.js', () => ({ useUiStore }));

import {
  LogisticsBoard,
  PrePositioningPanel,
  ShelterCapacityWidget,
  nextResourceTaskStatus,
  resourceKindIcon,
} from './logistics-board.js';
import type {
  PrePositioningData,
  ResourcesData,
  ResourceTaskView,
  ShelterMatch,
} from '../../_lib/types.js';
// F-24 regression: import the DOMAIN's exported machine directly (not a re-declared local copy) so this test
// keeps proving the board derives from the domain rather than merely echoing it — if a future edit ever
// re-introduces a hardcoded UI array, this import stays the single source the assertion is checked against.
import { RESOURCE_TASK_STATUSES } from '@/domain/resource-task.js';
// Same reason, for the FR-D6-1 icon map: the kinds under test are the DOMAIN's, never a list retyped here.
import { RESOURCE_KINDS } from '@/domain/resource.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { ShelterId } from '@/domain/value-objects/ids.js';
import { Truck } from 'lucide-react';

// F-200: the envelope `data` of GET /resources is an OBJECT keyed by `resources` (the server returns
// `success(200, {resources})`), not a bare array — this fixture is now typed by the DERIVED `ResourcesData`,
// so it cannot go back to being an array without failing `tsc`. `orgId` (not `org`) is the wire field name.
const RESOURCES: ResourcesData = {
  resources: [{ id: 'eng-1', kind: 'ENGINE', status: 'AVAILABLE', orgId: 'CAL-FIRE' }],
};
const INCIDENT = 'inc-1';

function resourcesEnvelope(data: ResourcesData) {
  return { data, provenance: [{ sourceId: 'logi', mode: 'LIVE', fetchedAt: 'x' }] };
}

function prePositioningEnvelope(data: PrePositioningData) {
  return { data, provenance: [{ sourceId: 'logistics', mode: 'MOCK', fetchedAt: 'x' }] };
}

/**
 * A `useTaskResource` stub that behaves like the real mutation's success path: it forwards the per-call
 * `onSuccess` the board relies on to record the SERVER-CONFIRMED task (F-191). `confirm` is the task the
 * fake server "returns"; the board must compute the next legal step from THAT, never from its own guess.
 */
function taskMutationStub(confirm: (body: { status: string }) => ResourceTaskView) {
  const mutate = vi.fn(
    (body: { status: string }, opts?: { onSuccess?: (env: { data: { task: ResourceTaskView } }) => void }) => {
      opts?.onSuccess?.({ data: { task: confirm(body) } });
    },
  );
  return { mutate, isPending: false, isError: false };
}

beforeEach(() => {
  useResources.mockReturnValue({ isPending: false, isError: false, data: resourcesEnvelope(RESOURCES) });
  useTaskResource.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false });
  usePrePositioning.mockReturnValue({
    isPending: false,
    isError: false,
    data: prePositioningEnvelope({ method: 'first-order ranking', extentAvailable: false, suggestions: [] }),
  });
  useUiStore.mockImplementation((sel: (s: { actorRole: string }) => unknown) =>
    sel({ actorRole: 'EM' }),
  );
});

describe('ShelterCapacityWidget', () => {
  // F-409: the old fixtures set `demand`, a field `Shelter` does not have, so this test certified a ratio
  // the product could never render — in the real app every shelter showed 0/capacity at 0% and the
  // over-capacity octagon was unreachable. The widget now reads OCCUPANCY, the demand the entity actually
  // models; these fixtures are real entities, so an invented field no longer compiles.
  it('renders a numeric (non-colour) occupancy ratio with a shape label', () => {
    const shelters: ShelterMatch[] = [
      {
        id: asId<ShelterId>('s1'),
        geom: { type: 'Point', coordinates: [-118.24, 34.05] },
        capacity: 200,
        occupancy: 250,
        status: 'OPEN',
      },
      {
        id: asId<ShelterId>('s2'),
        geom: { type: 'Point', coordinates: [-118.3, 34.1] },
        capacity: 100,
        occupancy: 40,
        status: 'OPEN',
      },
    ];
    render(<ShelterCapacityWidget shelters={shelters} />);
    expect(screen.getByTestId('ratio-s1')).toHaveTextContent('250/200');
    expect(screen.getByText('Over capacity')).toBeInTheDocument();
    expect(screen.getByText('Within capacity')).toBeInTheDocument();
  });
});

describe('nextResourceTaskStatus (the UI’s target step is DERIVED from the domain machine — F-191)', () => {
  it('walks the domain lifecycle exactly once per step and then stops', () => {
    // No task yet ⇒ the machine's START state, which is the ONLY status memory-logistics.createTask accepts.
    expect(nextResourceTaskStatus(undefined)).toBe(RESOURCE_TASK_STATUSES[0]);
    // Every existing status advances by exactly one forward hop — no skips, no backward moves (EV9).
    for (let i = 0; i < RESOURCE_TASK_STATUSES.length - 1; i += 1) {
      expect(nextResourceTaskStatus(RESOURCE_TASK_STATUSES[i]!)).toBe(RESOURCE_TASK_STATUSES[i + 1]);
    }
    // The terminal state has no next step: the control disables rather than offering a click that can only 409.
    expect(nextResourceTaskStatus(RESOURCE_TASK_STATUSES.at(-1)!)).toBeUndefined();
  });
});

describe('LogisticsBoard tasking', () => {
  it('surfaces a 409 tasking rejection as a labelled error', () => {
    useTaskResource.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error: { code: 'CONFLICT', message: 'Resource not in VERIFIED state', status: 409 },
    });
    render(<LogisticsBoard incidentId={INCIDENT} />);
    const err = screen.getByTestId('task-error');
    expect(err).toHaveAttribute('role', 'alert');
    expect(err).toHaveTextContent('CONFLICT');
    expect(err).toHaveTextContent('VERIFIED state');
  });

  it('F-191: the FIRST click CREATES at the domain start state (PROPOSED) — no task id, because none ' +
    'exists yet — using the field names/shape the SERVER actually reads (F-24/F-140)', async () => {
    const stub = taskMutationStub(() => ({ id: 'task-1', status: 'PROPOSED' }));
    useTaskResource.mockReturnValue(stub);
    const user = userEvent.setup();
    // incidentId is REQUIRED to reach the server (F-140) — LogisticsBoard must thread it into TaskControl's
    // mutation, not just receive it as an unused prop.
    render(<LogisticsBoard incidentId={INCIDENT} />);
    await user.selectOptions(screen.getByLabelText('Resource to task'), 'eng-1');
    await user.click(screen.getByRole('button', { name: 'Task' }));
    // The key is `status` (not `transition`), `incidentId` is present (F-140), the token is the DOMAIN's
    // (F-24), and NO `id` is sent — this is a creation, which the domain requires to start at PROPOSED.
    // Before F-191 this posted the <select>'s default (TASKED) and 409'd on every default click.
    expect(stub.mutate).toHaveBeenCalledWith(
      { resourceId: 'eng-1', incidentId: INCIDENT, status: 'PROPOSED' },
      expect.anything(),
    );
  });

  it('F-191: the SECOND click ADVANCES the SERVER-CONFIRMED task by id, one legal hop — the flow a real ' +
    'user completes, with the domain invariant intact rather than relaxed', async () => {
    // The fake server echoes back whatever status was asked for, under the id it minted — exactly what the
    // real handler does (`success(201, {task: res.value})`).
    const stub = taskMutationStub((body) => ({ id: 'task-1', status: body.status as ResourceTaskView['status'] }));
    useTaskResource.mockReturnValue(stub);
    const user = userEvent.setup();
    render(<LogisticsBoard incidentId={INCIDENT} />);
    await user.selectOptions(screen.getByLabelText('Resource to task'), 'eng-1');
    await user.click(screen.getByRole('button', { name: 'Task' })); // create → PROPOSED
    await user.click(screen.getByRole('button', { name: 'Task' })); // advance → TASKED
    expect(stub.mutate).toHaveBeenLastCalledWith(
      { id: 'task-1', resourceId: 'eng-1', incidentId: INCIDENT, status: 'TASKED' },
      expect.anything(),
    );
    // The row shows the CONFIRMED lifecycle state (labelled with the catalog's display vocabulary), so an
    // operator can see where the task actually is — never an optimistic guess the server did not confirm.
    expect(screen.getByTestId('task-status-eng-1')).toHaveTextContent('ASSIGNED');
  });

  it('F-191: the whole lifecycle is walkable click-by-click and the control stops dead at CLEARED', async () => {
    const stub = taskMutationStub((body) => ({ id: 'task-1', status: body.status as ResourceTaskView['status'] }));
    useTaskResource.mockReturnValue(stub);
    const user = userEvent.setup();
    render(<LogisticsBoard incidentId={INCIDENT} />);
    await user.selectOptions(screen.getByLabelText('Resource to task'), 'eng-1');
    for (const expected of RESOURCE_TASK_STATUSES) {
      await user.click(screen.getByRole('button', { name: 'Task' }));
      expect((stub.mutate.mock.calls.at(-1)?.[0] as { status: string }).status).toBe(expected);
    }
    expect(stub.mutate).toHaveBeenCalledTimes(RESOURCE_TASK_STATUSES.length);
    // Terminal: no legal next hop, so the button is disabled instead of offering a guaranteed 409.
    expect(screen.getByRole('button', { name: 'Task' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Task' }));
    expect(stub.mutate).toHaveBeenCalledTimes(RESOURCE_TASK_STATUSES.length);
  });

  it('F-192: with no incident selected the board shows a DESIGNED empty state and never renders a tasking ' +
    'control — the resource query is disabled, not fired at an endpoint that can only 400', () => {
    render(<LogisticsBoard />);
    expect(screen.getAllByText('No incident selected').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Task' })).not.toBeInTheDocument();
    // The hook is still CALLED (hooks are unconditional) — with undefined, which is what disables it.
    expect(useResources).toHaveBeenCalledWith(undefined, 'EM');
  });

  it('F-192/F-201: the resource query is scoped to the SELECTED incident AND the acting role (both are ' +
    'server-side scopes — a role change must refetch, not serve a cached 403)', () => {
    render(<LogisticsBoard incidentId={INCIDENT} />);
    expect(useResources).toHaveBeenCalledWith(INCIDENT, 'EM');
  });

  it('F-24: the transition <select> options are EXACTLY the domain machine, in order — drift is now ' +
    'structural (derived), not merely detected; only the ONE legal next hop is selectable (F-191)', () => {
    render(<LogisticsBoard incidentId={INCIDENT} />);
    const select = screen.getByLabelText('Lifecycle transition') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([...RESOURCE_TASK_STATUSES]);
    // Forward-only, one step at a time: with no task yet, PROPOSED is the only enabled option.
    const enabled = Array.from(select.options).filter((o) => !o.disabled).map((o) => o.value);
    expect(enabled).toEqual([RESOURCE_TASK_STATUSES[0]]);
  });

  it('hides the tasking control for a PUBLIC role', () => {
    useUiStore.mockImplementation((sel: (s: { actorRole: string }) => unknown) =>
      sel({ actorRole: 'PUBLIC' }),
    );
    render(<LogisticsBoard incidentId={INCIDENT} />);
    expect(screen.queryByRole('button', { name: 'Task' })).not.toBeInTheDocument();
  });

  it('always shows the pre-positioning suggestions section with its Advisory label', () => {
    render(<LogisticsBoard incidentId={INCIDENT} />);
    expect(screen.getByLabelText('Pre-positioning suggestions')).toBeInTheDocument();
    expect(screen.getByText('Advisory — human decides')).toBeInTheDocument();
  });
});

describe('PrePositioningPanel (GET /pre-positioning — W2d, flagship-4)', () => {
  it('shows a labelled empty state when no incident is selected (never fires the request)', () => {
    render(<PrePositioningPanel />);
    expect(screen.getByText('No incident selected')).toBeInTheDocument();
  });

  it('shows a labelled empty state when no projected extent is known yet for the incident', () => {
    usePrePositioning.mockReturnValue({
      isPending: false,
      isError: false,
      data: prePositioningEnvelope({ method: 'first-order ranking', extentAvailable: false, suggestions: [] }),
    });
    render(<PrePositioningPanel incidentId="inc-1" />);
    expect(screen.getByText('No projected extent yet')).toBeInTheDocument();
  });

  it('shows a labelled empty state when the extent is known but no nearby assets are found', () => {
    usePrePositioning.mockReturnValue({
      isPending: false,
      isError: false,
      data: prePositioningEnvelope({ method: 'first-order ranking', extentAvailable: true, suggestions: [] }),
    });
    render(<PrePositioningPanel incidentId="inc-1" />);
    expect(screen.getByText('No nearby assets')).toBeInTheDocument();
  });

  it('surfaces a load error as a labelled ErrorState', () => {
    usePrePositioning.mockReturnValue({
      isPending: false,
      isError: true,
      error: { code: 'FORBIDDEN', message: 'RESPONDER+ required' },
      refetch: vi.fn(),
    });
    render(<PrePositioningPanel incidentId="inc-1" />);
    expect(screen.getByText('Pre-positioning unavailable')).toBeInTheDocument();
    expect(screen.getByText('RESPONDER+ required')).toBeInTheDocument();
  });

  it('shows a loading skeleton while pending', () => {
    usePrePositioning.mockReturnValue({ isPending: true, isError: false });
    render(<PrePositioningPanel incidentId="inc-1" />);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });

  it('renders ranked RESOURCE and SHELTER suggestions with distance + shelter capacity/occupancy', () => {
    usePrePositioning.mockReturnValue({
      isPending: false,
      isError: false,
      data: prePositioningEnvelope({
        method: 'first-order ranking',
        extentAvailable: true,
        suggestions: [
          { kind: 'RESOURCE', refId: 'eng-1', distanceMeters: 1200, resourceKind: 'ENGINE' },
          { kind: 'SHELTER', refId: 'sh-1', distanceMeters: 3400, capacity: 100, occupancy: 40 },
        ],
      }),
    });
    render(<PrePositioningPanel incidentId="inc-1" />);
    expect(screen.getByText(/ENGINE/)).toBeInTheDocument();
    expect(screen.getByText(/eng-1/)).toBeInTheDocument();
    expect(screen.getByText('1.2 km')).toBeInTheDocument();
    expect(screen.getByText(/Shelter/)).toBeInTheDocument();
    expect(screen.getByText('40/100')).toBeInTheDocument();
    expect(screen.getByText('3.4 km')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// FR-D6-1 resource-kind icon map (ADR-035 §4; finding F-171). Two guarantees, one of which is about pixels.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('resourceKindIcon — the FR-D6-1 icon map', () => {
  it('covers EVERY domain kind (the map is typed Record<ResourceKind,…>, so a gap is a tsc error, not a ??)', () => {
    for (const kind of RESOURCE_KINDS) expect(resourceKindIcon(kind)).toBeDefined();
  });

  it('is a PIXEL NO-OP for every pre-existing kind — the visual-baseline budget is zero (F-194/F-47)', () => {
    // Before this change `ResourceRow` hardcoded `Truck` for every resource. Any kind that can appear in an
    // existing Playwright baseline must therefore still render `Truck`; only the NEW kind may differ.
    for (const kind of RESOURCE_KINDS.filter((k) => k !== 'TEAM')) {
      expect(resourceKindIcon(kind)).toBe(Truck);
    }
  });

  it('gives the new TEAM kind a distinct glyph (a volunteer team is not a vehicle)', () => {
    expect(resourceKindIcon('TEAM')).not.toBe(Truck);
  });

  it('degrades to the previous default for an unknown/absent wire token (never a dead end, Art. XVI)', () => {
    expect(resourceKindIcon(undefined)).toBe(Truck);
    expect(resourceKindIcon('DRONE')).toBe(Truck); // a kind this client build has never heard of
  });
});
