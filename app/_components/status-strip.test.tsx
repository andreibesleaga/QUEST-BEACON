// @vitest-environment happy-dom
// BEACON — StatusStrip tests (owner request 2026-09-11).
//
// The load-bearing properties, in the order they matter:
//   * a count that has NOT arrived is OMITTED, never rendered as 0 and (since 2026-09-12) never as an em
//     dash either — "nothing is waiting for you" and "I do not know yet" are different claims, and on an
//     approval queue the difference is a decision. The em dash was the original remedy and it was wrong:
//     with the API down the live strip read `Active — Sources — Data age —`, which in the most
//     authoritative row on the screen looks like three readings rather than none. Owner, 2026-09-12: "if
//     these infos are not reliable do not add them into the top bar, keep only if they reflect the truth";
//   * the VERIFIER+ queues are not merely hidden below that rank, their HOOKS NEVER RUN, so a PUBLIC
//     visitor never issues a request whose only possible answer is 403;
//   * the wall clock and the data's age are separate readings, and the age is the one tied to the data;
//   * stale data is marked as stale rather than left to look current beside a ticking clock;
//   * a quiet region renders 0 honestly, in the calm tone, and never as an error or an empty frame.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const { useIncidents, useStatus, useAlerts, useReports } = vi.hoisted(() => ({
  useIncidents: vi.fn(),
  useStatus: vi.fn(),
  useAlerts: vi.fn(),
  useReports: vi.fn(),
}));
vi.mock('../_lib/hooks.js', () => ({ useIncidents, useStatus, useAlerts, useReports }));

import { StatusStrip } from './status-strip.js';

/** A UseQueryResult-shaped stub — only the fields the strip reads. */
function q(data?: unknown): unknown {
  return { isPending: false, isError: false, data, error: undefined, refetch: vi.fn() };
}

const NOW = Date.parse('2026-09-11T12:00:00.000Z');
const FRESH = '2026-09-11T11:58:00.000Z'; // 2 minutes old
const STALE = '2026-09-11T10:00:00.000Z'; // 120 minutes old

function incidents(statuses: readonly string[], freshness = FRESH): unknown {
  return q({
    data: {
      regionId: 'ro',
      incidents: statuses.map((status, i) => ({ id: `i${i}`, type: 'FLOOD', status })),
    },
    provenance: [],
    freshness,
  });
}

function sources(modes: readonly string[]): unknown {
  return q({
    data: { regionId: 'ro', sources: modes.map((mode, i) => ({ sourceId: `s${i}`, mode })) },
    provenance: [],
  });
}

beforeEach(() => {
  useIncidents.mockReturnValue(incidents(['ACTIVE', 'ACTIVE', 'CLOSED']));
  useStatus.mockReturnValue(sources(['LIVE', 'LIVE', 'CACHED']));
  useAlerts.mockReturnValue(
    q({ data: { alerts: [{ id: 'a1', state: 'DRAFT' }] }, provenance: [] }),
  );
  useReports.mockReturnValue(
    q({
      data: {
        reports: [
          { id: 'r1', status: 'UNVERIFIED' },
          { id: 'r2', status: 'VERIFIED' },
        ],
      },
      provenance: [],
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('StatusStrip', () => {
  it('counts only ACTIVE incidents, and only LIVE sources as live', () => {
    render(<StatusStrip regionId="ro" actorRole="PUBLIC" now={NOW} />);
    expect(screen.getByTestId('status-strip-active')).toHaveTextContent('2');
    // Two of three sources are LIVE — the other is CACHED and must not be counted as live.
    expect(screen.getByTestId('status-strip-sources')).toHaveTextContent('2/3');
  });

  it('reports the data’s age in minutes, distinct from the wall clock', () => {
    render(<StatusStrip regionId="ro" actorRole="PUBLIC" now={NOW} />);
    expect(screen.getByTestId('status-strip-age')).toHaveTextContent('2');
    // The clock is its own reading and is NOT the data's timestamp.
    expect(screen.getByTestId('status-strip-clock')).toBeInTheDocument();
  });

  it('marks data older than 30 minutes as an alert rather than letting it look current', () => {
    useIncidents.mockReturnValue(incidents(['ACTIVE'], STALE));
    render(<StatusStrip regionId="ro" actorRole="PUBLIC" now={NOW} />);
    const age = screen.getByTestId('status-strip-age');
    expect(age).toHaveTextContent('120');
    expect(age.querySelector('.text-alert')).not.toBeNull();
  });

  it('renders a quiet region as a calm 0, never as an error or a blank', () => {
    useIncidents.mockReturnValue(incidents(['CLOSED']));
    render(<StatusStrip regionId="ro" actorRole="PUBLIC" now={NOW} />);
    const active = screen.getByTestId('status-strip-active');
    expect(active).toHaveTextContent('0');
    // Calm tone, not the alert tone: a truthfully quiet region is a designed state, not a problem.
    expect(active.querySelector('.text-alert')).toBeNull();
  });

  // REPLACED ITS OWN OPPOSITE (2026-09-12). This asserted an em dash in each cell. That shipped, the API
  // went down, and the strip rendered a tidy row of labels with a dash under every one — which reads as
  // data, not as its absence. An unknown figure is now absent from the DOM entirely, and when nothing at
  // all is known the strip says so in words.
  it('omits every stat when nothing is known, and says so once instead', () => {
    useIncidents.mockReturnValue(q(undefined));
    useStatus.mockReturnValue(q(undefined));
    render(<StatusStrip regionId="ro" actorRole="PUBLIC" now={NOW} />);
    expect(screen.queryByTestId('status-strip-active')).toBeNull();
    expect(screen.queryByTestId('status-strip-sources')).toBeNull();
    expect(screen.queryByTestId('status-strip-age')).toBeNull();
    // The one honest statement that replaces them, and it is NOT an em dash.
    const said = screen.getByTestId('status-strip-unavailable');
    expect(said.textContent ?? '').not.toContain('—');
    expect((said.textContent ?? '').length).toBeGreaterThan(3);
  });

  // Review, PR #12: the unavailable branch returned BEFORE mounting the queues, so an EM whose region
  // read had failed lost the pending/unverified counts entirely — the figures they most need, discarded
  // because unrelated endpoints were down.
  it('still shows an operator their queues when the region figures are unreadable', () => {
    useIncidents.mockReturnValue(q(undefined));
    useStatus.mockReturnValue(q(undefined));
    useAlerts.mockReturnValue(
      q({ data: { alerts: [{ id: 'a1', state: 'DRAFT' }] }, provenance: [] }),
    );
    useReports.mockReturnValue(
      q({ data: { reports: [{ id: 'r1', status: 'UNVERIFIED' }] }, provenance: [] }),
    );
    render(<StatusStrip regionId="ro" actorRole="EM" now={NOW} />);
    expect(screen.getByTestId('status-strip-unavailable')).toBeInTheDocument();
    expect(screen.getByTestId('status-strip-pending')).toHaveTextContent('1');
    expect(screen.getByTestId('status-strip-unverified')).toHaveTextContent('1');
  });

  it('does NOT ask for queues on the unavailable branch for a PUBLIC visitor', () => {
    useIncidents.mockReturnValue(q(undefined));
    useStatus.mockReturnValue(q(undefined));
    render(<StatusStrip regionId="ro" actorRole="PUBLIC" now={NOW} />);
    expect(screen.getByTestId('status-strip-unavailable')).toBeInTheDocument();
    // The role gate must survive the restructure: still no request whose only answer could be 403.
    expect(useAlerts).not.toHaveBeenCalled();
    expect(useReports).not.toHaveBeenCalled();
  });

  it('keeps the stats it DOES know and drops only the ones it does not', () => {
    // The partial case is the one a blanket "hide everything" would get wrong: a known active count is
    // still worth showing while the source list is unreadable.
    useIncidents.mockReturnValue(
      q({
        data: { incidents: [{ id: 'i1', status: 'ACTIVE' }] },
        provenance: [],
        freshness: '2026-09-11T12:00:00.000Z',
      }),
    );
    useStatus.mockReturnValue(q(undefined));
    render(<StatusStrip regionId="ro" actorRole="PUBLIC" now={NOW} />);
    expect(screen.getByTestId('status-strip-active')).toHaveTextContent('1');
    expect(screen.queryByTestId('status-strip-sources')).toBeNull();
    expect(screen.queryByTestId('status-strip-unavailable')).toBeNull();
  });

  describe('role gating', () => {
    it('does not even CALL the VERIFIER+ hooks for a PUBLIC visitor', () => {
      render(<StatusStrip regionId="ro" actorRole="PUBLIC" now={NOW} />);
      expect(screen.queryByTestId('status-strip-pending')).toBeNull();
      expect(screen.queryByTestId('status-strip-unverified')).toBeNull();
      // The point of the separate child component: a request whose only possible answer is 403 is never issued.
      expect(useAlerts).not.toHaveBeenCalled();
      expect(useReports).not.toHaveBeenCalled();
    });

    it('does not call them for a RESPONDER either', () => {
      render(<StatusStrip regionId="ro" actorRole="RESPONDER" now={NOW} />);
      expect(useAlerts).not.toHaveBeenCalled();
      expect(useReports).not.toHaveBeenCalled();
    });

    it.each(['VERIFIER', 'EM'] as const)('shows the operator queues for %s', (role) => {
      render(<StatusStrip regionId="ro" actorRole={role} now={NOW} />);
      expect(screen.getByTestId('status-strip-pending')).toHaveTextContent('1'); // one DRAFT
      expect(screen.getByTestId('status-strip-unverified')).toHaveTextContent('1'); // one UNVERIFIED of two
    });

    it('counts only DRAFT alerts and only UNVERIFIED reports', () => {
      useAlerts.mockReturnValue(
        q({
          data: {
            alerts: [
              { id: 'a1', state: 'APPROVED' },
              { id: 'a2', state: 'DRAFT' },
            ],
          },
          provenance: [],
        }),
      );
      render(<StatusStrip regionId="ro" actorRole="EM" now={NOW} />);
      expect(screen.getByTestId('status-strip-pending')).toHaveTextContent('1');
    });

    it('OMITS an unloaded queue rather than showing an all-clear or a dash', () => {
      useAlerts.mockReturnValue(q(undefined));
      useReports.mockReturnValue(q(undefined));
      render(<StatusStrip regionId="ro" actorRole="EM" now={NOW} />);
      // An operator must never read "0 pending" from a request that has not answered — and, since
      // 2026-09-12, must not read a dash either. An unanswered queue contributes nothing to the strip.
      expect(screen.queryByTestId('status-strip-pending')).toBeNull();
      expect(screen.queryByTestId('status-strip-unverified')).toBeNull();
    });
  });

  // The live-region assertions moved to the dedicated suite below, after the accessibility audit found
  // this original version was asserting the DEFECT: it pinned `role="status"` to the outer wrapper, which
  // is exactly what put the ticking clock inside a polite region.
});

// ── The live-region defect found by the accessibility audit, 2026-09-11 ─────────────────────────────
//
// The first version wrapped the WHOLE strip in `role="status" aria-live="polite"` and carried a comment
// claiming the clock "announces nothing". That was wrong: `aria-live` is inherited by the entire subtree
// and the default `aria-relevant` includes text replacement, so a screen reader announced the ticking
// second every second and queued every other announcement behind it. These tests pin the structure so the
// clock cannot drift back inside the region.
describe('StatusStrip — the clock must not sit inside a live region', () => {
  it('scopes the live region to the COUNTS, not the whole strip', () => {
    render(<StatusStrip regionId="ro" actorRole="PUBLIC" now={NOW} />);
    const strip = screen.getByTestId('status-strip');
    // The outer wrapper is layout only.
    expect(strip).not.toHaveAttribute('aria-live');
    expect(strip).not.toHaveAttribute('role');
    const counts = screen.getByTestId('status-strip-counts');
    expect(counts).toHaveAttribute('role', 'status');
    expect(counts).toHaveAttribute('aria-live', 'polite');
  });

  it('keeps the clock OUTSIDE the live region, and marks it aria-live="off"', () => {
    render(<StatusStrip regionId="ro" actorRole="PUBLIC" now={NOW} />);
    const counts = screen.getByTestId('status-strip-counts');
    const clock = screen.getByTestId('status-strip-clock');
    // A per-second announcement starves every other announcement on the page — the clock must not be a
    // descendant of anything polite.
    expect(counts.contains(clock)).toBe(false);
    expect(clock.querySelector('time')).toHaveAttribute('aria-live', 'off');
  });
});
