// @vitest-environment happy-dom
// BEACON — OutlookPanel tests (C2.3; ADR-033 §5, FEV-8).
//
// Written deliberately, not because a gate demanded them: `vitest.config.ts` scopes coverage `include` to
// `src/**`, so nothing in `app/**` is measured by the 99% floor (finding F-76). The contract asserted here
// is the one that matters for this surface: the panel RENDERS the engine's order and labelling and computes
// nothing (Art. XII), and an incident with no Outlook renders no section at all.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OutlookPanel } from './outlook-panel.js';
import type { RankedOutlookItem } from '../../_lib/types.js';

const ROWS: readonly RankedOutlookItem[] = [
  {
    rank: 1,
    predictionId: 'ro-escalation-1',
    kind: 'ESCALATION',
    method: 'least-squares trend projection over gauge stage',
    uncertainty: 0.45,
    likelihoodClass: 'VERY_LIKELY',
    etaHours: 8,
    hazardArrival: '2026-07-06T06:00:00.000Z',
  },
  {
    rank: 2,
    predictionId: 'ro-impact-1',
    kind: 'IMPACT_OVER_TIME',
    method: 'exposure-basis count projected along the trend slope',
    uncertainty: 0.6,
  },
];

describe('OutlookPanel', () => {
  it('renders NOTHING when there is no outlook (absent section, not an empty one)', () => {
    const { container } = render(<OutlookPanel outlook={[]} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('outlook-panel')).not.toBeInTheDocument();
  });

  it('renders one row per outlook item, in the ENGINE order it was given', () => {
    render(<OutlookPanel outlook={ROWS} />);
    const rows = screen.getAllByTestId('outlook-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('ESCALATION');
    expect(rows[1]).toHaveTextContent('IMPACT_OVER_TIME');
  });

  it('NEVER re-sorts: an out-of-rule order from the server renders exactly as served (Art. XII)', () => {
    // The client is not a second ranking engine. Given rows the engine would never emit in this order, the
    // panel still renders them verbatim — a client-side re-sort would be a silent second source of truth.
    render(<OutlookPanel outlook={[...ROWS].reverse()} />);
    const rows = screen.getAllByTestId('outlook-row');
    expect(rows[0]).toHaveTextContent('IMPACT_OVER_TIME');
    expect(rows[1]).toHaveTextContent('ESCALATION');
  });

  it('shows the rank straight from data (never recomputed from the array index)', () => {
    render(<OutlookPanel outlook={[{ ...ROWS[0]!, rank: 7 }]} />);
    expect(screen.getByTestId('outlook-row')).toHaveTextContent('7');
  });

  it('labels every row with its own method and uncertainty (a class is never shown bare, FU-11)', () => {
    render(<OutlookPanel outlook={ROWS} />);
    const rows = screen.getAllByTestId('outlook-row');
    expect(rows[0]).toHaveTextContent('least-squares trend projection over gauge stage');
    expect(rows[0]).toHaveTextContent('uncertainty 0.45');
    expect(rows[1]).toHaveTextContent('exposure-basis count projected along the trend slope');
    expect(rows[1]).toHaveTextContent('uncertainty 0.6');
  });

  it('renders the likelihood class token VERBATIM (a closed server vocabulary, like trend)', () => {
    render(<OutlookPanel outlook={ROWS} />);
    expect(screen.getByText('VERY_LIKELY')).toBeInTheDocument();
  });

  it('says "not classified" rather than defaulting a class the source never supported (FUW-3)', () => {
    render(<OutlookPanel outlook={ROWS} />);
    expect(screen.getByText('not classified')).toBeInTheDocument();
    expect(screen.queryByText('POSSIBLE')).not.toBeInTheDocument();
  });

  it('shows the source-supported lead time, and says so honestly when there is none', () => {
    render(<OutlookPanel outlook={ROWS} />);
    expect(screen.getByText('in ~8 h')).toBeInTheDocument();
    expect(screen.getByText('no lead time from source')).toBeInTheDocument();
  });

  it('renders an unrounded lead time exactly as the source stated it', () => {
    render(<OutlookPanel outlook={[{ ...ROWS[0]!, etaHours: 6.5 }]} />);
    expect(screen.getByText('in ~6.5 h')).toBeInTheDocument();
  });

  it('exposes the section to assistive tech with a localized label', () => {
    render(<OutlookPanel outlook={ROWS} />);
    expect(screen.getByRole('region', { name: 'Ranked outlook' })).toBeInTheDocument();
  });
});
