// @vitest-environment happy-dom
// BEACON — ShelterStatusPanel tests (S3·U1; FR-D4-3/FEV-22). The envelope fixture is BUILT FROM REAL
// GET /shelter-status OUTPUT (handleHttp as RESPONDER — the verifier-queue pattern). Covers: flag off ⇒
// null AND the query told not to fire; the board totals + per-shelter rows rendered verbatim (Art. XII);
// the module's provenance claim rendered VERBATIM — it says MOCK for the hand-seeded rows and can never
// say "live" for them (F-35, Art. XVI); loading/error/empty all labelled.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { useShelterStatus } = vi.hoisted(() => ({ useShelterStatus: vi.fn() }));
vi.mock('../../_lib/hooks.js', () => ({ useShelterStatus }));

import { ShelterStatusPanel } from './shelter-status-panel.js';
import { realGet } from '../../_lib/real-http.js';
import type { Envelope, ShelterStatusData } from '../../_lib/types.js';

let env: Envelope<ShelterStatusData>;
const refetch = vi.fn();

beforeAll(async () => {
  ({ env } = await realGet<ShelterStatusData>('/api/v1/shelter-status', 'RESPONDER'));
});

/** A UseQueryResult-shaped stub — only the fields the panel reads. */
function state(over: Partial<{ isPending: boolean; isError: boolean; data: unknown; error: unknown }>): unknown {
  return { isPending: false, isError: false, data: undefined, error: undefined, refetch, ...over };
}

beforeEach(() => {
  refetch.mockReset();
  useShelterStatus.mockReturnValue(state({ data: env }));
});

describe('ShelterStatusPanel (over real GET /shelter-status output)', () => {
  it('renders NULL when the display gate is off — and the query is told not to fire (Art. XVI)', () => {
    const { container } = render(<ShelterStatusPanel enabled={false} />);
    expect(container.firstChild).toBeNull();
    expect(useShelterStatus).toHaveBeenCalledWith(false);
  });

  it('renders the board totals verbatim — availableOpen is the labelled, operationally meaningful figure', () => {
    render(<ShelterStatusPanel enabled />);
    const totals = screen.getByTestId('shelter-totals');
    expect(totals).toHaveTextContent('Shelters');
    expect(totals).toHaveTextContent(String(env.data.board.totals.shelters));
    expect(totals).toHaveTextContent('Open spare capacity');
    expect(totals).toHaveTextContent(String(env.data.board.totals.availableOpen));
  });

  it('renders one row per shelter with status token and occupancy/capacity straight off the board', () => {
    render(<ShelterStatusPanel enabled />);
    for (const row of env.data.board.rows) {
      expect(screen.getByTestId(`shelter-row-${row.shelterId}`)).toBeInTheDocument();
    }
    // The FULL shelter: 120/120 with its domain status token, verbatim (never re-derived client-side).
    const full = screen.getByTestId('shelter-row-shelter-north-high');
    expect(full).toHaveTextContent('FULL');
    expect(full).toHaveTextContent('120/120');
  });

  it('renders the module provenance claim VERBATIM — hand-seeded rows say MOCK, never "live" (F-35)', () => {
    render(<ShelterStatusPanel enabled />);
    const claim = screen.getByTestId('shelter-provenance-claim');
    expect(claim).toHaveTextContent('MOCK/seeded shelter data');
    expect(claim.textContent).not.toMatch(/^Live/);
    expect(screen.getByText('Provenance')).toBeInTheDocument();
  });

  it('renders a labelled loading state while pending', () => {
    useShelterStatus.mockReturnValue(state({ isPending: true }));
    render(<ShelterStatusPanel enabled />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });

  it('surfaces a 403 role denial as a labelled, retryable unavailable-state — never a dead-end', async () => {
    const user = userEvent.setup();
    useShelterStatus.mockReturnValue(
      state({ isError: true, error: { message: 'GET /shelter-status requires RESPONDER+' } }),
    );
    render(<ShelterStatusPanel enabled />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Shelter status unavailable');
    expect(alert).toHaveTextContent('GET /shelter-status requires RESPONDER+');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('renders a designed empty state when the board has no rows', () => {
    const board = { ...env.data.board, rows: [] };
    useShelterStatus.mockReturnValue(state({ data: { ...env, data: { board } } }));
    render(<ShelterStatusPanel enabled />);
    expect(screen.getByText('No shelter rows')).toBeInTheDocument();
  });
});

// Malformed-envelope guard (added 2026-08-08): a 200 whose data lacks the expected field must land on the
// LABELLED error rung — the COP page test's fallback envelope crashed the page tree through an unguarded
// read in one of these panels; this pins the guard in each.
describe('malformed envelope shape', () => {
  it('renders the labelled unavailable state, never throws, when data is an empty object', () => {
    useShelterStatus.mockReturnValue(state({ data: { data: {}, provenance: [], freshness: undefined } }));
    render(<ShelterStatusPanel enabled />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
