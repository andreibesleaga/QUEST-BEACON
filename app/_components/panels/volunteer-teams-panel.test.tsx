// @vitest-environment happy-dom
// BEACON — VolunteerTeamsPanel tests (S3·U1; FR-D6-1). The envelope fixture is BUILT FROM REAL
// GET /volunteer-teams OUTPUT (handleHttp as RESPONDER — the verifier-queue pattern). Covers: flag off ⇒
// null AND the query told not to fire; team UNITS rendered (callsign, headcount tally, capability tags,
// duty-state token verbatim); provenance/freshness labelled; loading/error/empty all labelled (Art. XVI).
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { useVolunteerTeams } = vi.hoisted(() => ({ useVolunteerTeams: vi.fn() }));
vi.mock('../../_lib/hooks.js', () => ({ useVolunteerTeams }));

import { VolunteerTeamsPanel } from './volunteer-teams-panel.js';
import { realGet, FIXED_CLOCK } from '../../_lib/real-http.js';
import type { Envelope, VolunteerTeamsData } from '../../_lib/types.js';

let env: Envelope<VolunteerTeamsData>;
const refetch = vi.fn();

beforeAll(async () => {
  ({ env } = await realGet<VolunteerTeamsData>('/api/v1/volunteer-teams', 'RESPONDER'));
});

/** A UseQueryResult-shaped stub — only the fields the panel reads. */
function state(over: Partial<{ isPending: boolean; isError: boolean; data: unknown; error: unknown }>): unknown {
  return { isPending: false, isError: false, data: undefined, error: undefined, refetch, ...over };
}

beforeEach(() => {
  refetch.mockReset();
  useVolunteerTeams.mockReturnValue(state({ data: env }));
});

describe('VolunteerTeamsPanel (over real GET /volunteer-teams output)', () => {
  it('renders NULL when the display gate is off — and the query is told not to fire (Art. XVI)', () => {
    const { container } = render(<VolunteerTeamsPanel enabled={false} />);
    expect(container.firstChild).toBeNull();
    expect(useVolunteerTeams).toHaveBeenCalledWith(false);
  });

  it('renders every real team as a UNIT: callsign, headcount tally, and the duty-state token verbatim', () => {
    render(<VolunteerTeamsPanel enabled />);
    for (const team of env.data.teams) {
      expect(screen.getByTestId(`team-${team.id}`)).toBeInTheDocument();
    }
    const alpha = screen.getByTestId('team-team-alpha-3');
    expect(alpha).toHaveTextContent('TEAM ALPHA 3');
    expect(alpha).toHaveTextContent('Headcount 12');
    expect(screen.getByTestId('team-availability-team-alpha-3')).toHaveTextContent('AVAILABLE');
  });

  it('renders team-level capability tags — and a stood-up zero-headcount unit renders honestly', () => {
    render(<VolunteerTeamsPanel enabled />);
    expect(within(screen.getByTestId('team-team-alpha-3')).getByText('chainsaw')).toBeInTheDocument();
    // team-charlie-7 carries no skills → no capability group inside its row (present-only, never blank chips).
    expect(within(screen.getByTestId('team-team-charlie-7')).queryByRole('group')).not.toBeInTheDocument();
    expect(screen.getByTestId('team-team-charlie-7')).toHaveTextContent('Headcount 0');
  });

  it('labels provenance and freshness (F1 made legible)', () => {
    render(<VolunteerTeamsPanel enabled />);
    expect(screen.getByText('Provenance')).toBeInTheDocument();
    expect(screen.getByTestId('volunteer-teams-freshness')).toHaveTextContent(FIXED_CLOCK);
  });

  it('renders a labelled loading state while pending', () => {
    useVolunteerTeams.mockReturnValue(state({ isPending: true }));
    render(<VolunteerTeamsPanel enabled />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });

  it('surfaces a 403 role denial as a labelled, retryable unavailable-state — never a dead-end', async () => {
    const user = userEvent.setup();
    useVolunteerTeams.mockReturnValue(
      state({ isError: true, error: { message: 'GET /volunteer-teams requires RESPONDER+' } }),
    );
    render(<VolunteerTeamsPanel enabled />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Volunteer teams unavailable');
    expect(alert).toHaveTextContent('GET /volunteer-teams requires RESPONDER+');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('renders a designed empty state when the server has no teams', () => {
    useVolunteerTeams.mockReturnValue(state({ data: { ...env, data: { teams: [] } } }));
    render(<VolunteerTeamsPanel enabled />);
    expect(screen.getByText('No volunteer teams')).toBeInTheDocument();
  });
});

// Malformed-envelope guard (added 2026-08-08): a 200 whose data lacks the expected field must land on the
// LABELLED error rung — the COP page test's fallback envelope crashed the page tree through an unguarded
// read in one of these panels; this pins the guard in each.
describe('malformed envelope shape', () => {
  it('renders the labelled unavailable state, never throws, when data is an empty object', () => {
    useVolunteerTeams.mockReturnValue(state({ data: { data: {}, provenance: [], freshness: undefined } }));
    render(<VolunteerTeamsPanel enabled />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
