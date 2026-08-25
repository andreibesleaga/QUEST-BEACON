// @vitest-environment happy-dom
// BEACON — DamageReportsPanel tests (S3·U2; FR-D4-4/FEV-23, Art. XIII). The envelope fixture is BUILT FROM
// REAL GET /damage-reports OUTPUT (handleHttp as RESPONDER — the verifier-queue pattern). The load-bearing
// assertions are the HONESTY ones: one card per triage bucket, every non-VERIFIED bucket carrying the
// module's own unverified label VERBATIM, the caveat rendered, and NO cross-bucket grand total anywhere on
// screen — the number Art. XIII forbids this surface from inventing. Plus flag/loading/error/empty rungs.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { useDamageReports } = vi.hoisted(() => ({ useDamageReports: vi.fn() }));
vi.mock('../../_lib/hooks.js', () => ({ useDamageReports }));

import { DamageReportsPanel } from './damage-reports-panel.js';
import { realGet } from '../../_lib/real-http.js';
import type { Envelope, DamageReportsData } from '../../_lib/types.js';

let env: Envelope<DamageReportsData>;
const refetch = vi.fn();

beforeAll(async () => {
  ({ env } = await realGet<DamageReportsData>('/api/v1/damage-reports', 'RESPONDER'));
});

/** A UseQueryResult-shaped stub — only the fields the panel reads. */
function state(over: Partial<{ isPending: boolean; isError: boolean; data: unknown; error: unknown }>): unknown {
  return { isPending: false, isError: false, data: undefined, error: undefined, refetch, ...over };
}

beforeEach(() => {
  refetch.mockReset();
  useDamageReports.mockReturnValue(state({ data: env }));
});

describe('DamageReportsPanel (over real GET /damage-reports output)', () => {
  it('renders NULL when the display gate is off — and the query is told not to fire (Art. XVI)', () => {
    const { container } = render(<DamageReportsPanel enabled={false} />);
    expect(container.firstChild).toBeNull();
    expect(useDamageReports).toHaveBeenCalledWith(false);
  });

  it('renders one card per triage bucket — the pipeline vocabulary, never re-declared or re-ordered', () => {
    render(<DamageReportsPanel enabled />);
    for (const status of Object.keys(env.data.assessment.byTriageStatus)) {
      expect(screen.getByTestId(`damage-bucket-${status}`)).toBeInTheDocument();
    }
  });

  it('attaches the module unverified label VERBATIM to every non-VERIFIED bucket — and never to VERIFIED', () => {
    render(<DamageReportsPanel enabled />);
    for (const status of ['UNVERIFIED', 'TRIAGED', 'REJECTED']) {
      expect(screen.getByTestId(`damage-unverified-${status}`)).toHaveTextContent(
        'unverified — not authoritative',
      );
    }
    expect(screen.queryByTestId('damage-unverified-VERIFIED')).not.toBeInTheDocument();
  });

  it('renders bucket figures verbatim and NO cross-bucket grand total anywhere (Art. XIII)', () => {
    render(<DamageReportsPanel enabled />);
    // The seeded VERIFIED bucket: 3 entries over 14 self-reported sites (damage-entries.json).
    const verified = screen.getByTestId('damage-bucket-VERIFIED');
    expect(verified).toHaveTextContent('3');
    expect(verified).toHaveTextContent('14');
    expect(verified).toHaveTextContent('DESTROYED'); // worst severity, the domain order's answer
    // The numbers a summing panel would show — 9 entries / 556 sites across buckets — must NOT exist.
    expect(screen.queryByText('9')).not.toBeInTheDocument();
    expect(screen.queryByText('556')).not.toBeInTheDocument();
  });

  it('renders the module caveat verbatim (counts of reports, not a survey)', () => {
    render(<DamageReportsPanel enabled />);
    expect(screen.getByTestId('damage-caveat')).toHaveTextContent('Counts of REPORTS, not a survey');
    expect(screen.getByText('Provenance')).toBeInTheDocument();
  });

  it('renders unmet-need tokens per bucket, verbatim (never summed across buckets)', () => {
    render(<DamageReportsPanel enabled />);
    // The seeded VERIFIED bucket carries one WATER need; UNVERIFIED carries one POWER need.
    expect(screen.getByTestId('damage-bucket-VERIFIED')).toHaveTextContent('WATER 1');
    expect(screen.getByTestId('damage-bucket-UNVERIFIED')).toHaveTextContent('POWER 1');
  });

  it('renders a labelled loading state while pending', () => {
    useDamageReports.mockReturnValue(state({ isPending: true }));
    render(<DamageReportsPanel enabled />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });

  it('surfaces a 403 role denial as a labelled, retryable unavailable-state — never a dead-end', async () => {
    const user = userEvent.setup();
    useDamageReports.mockReturnValue(
      state({ isError: true, error: { message: 'GET /damage-reports requires RESPONDER+' } }),
    );
    render(<DamageReportsPanel enabled />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Damage reports unavailable');
    expect(alert).toHaveTextContent('GET /damage-reports requires RESPONDER+');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('renders a designed empty state when every bucket is empty', () => {
    const zeroed = Object.fromEntries(
      Object.entries(env.data.assessment.byTriageStatus).map(([status, bucket]) => [
        status,
        { ...bucket, entries: 0, siteCount: 0 },
      ]),
    );
    const assessment = { ...env.data.assessment, byTriageStatus: zeroed };
    useDamageReports.mockReturnValue(state({ data: { ...env, data: { assessment } } }));
    render(<DamageReportsPanel enabled />);
    expect(screen.getByText('No assessment entries')).toBeInTheDocument();
  });
});

// Malformed-envelope guard (added 2026-08-08): a 200 whose data lacks the expected field must land on the
// LABELLED error rung — the COP page test's fallback envelope crashed the page tree through an unguarded
// read in one of these panels; this pins the guard in each.
describe('malformed envelope shape', () => {
  it('renders the labelled unavailable state, never throws, when data is an empty object', () => {
    useDamageReports.mockReturnValue(state({ data: { data: {}, provenance: [], freshness: undefined } }));
    render(<DamageReportsPanel enabled />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
