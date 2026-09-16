// @vitest-environment happy-dom
// BEACON — MapTooltip tests (E8·T-366/T-357). A picked report renders the Unverified badge + confidence;
// a caveat renders as a labelled note; a verified datum shows no badge.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MapTooltip } from './MapTooltip.js';

describe('MapTooltip', () => {
  it('shows the Unverified badge + confidence for a report datum', () => {
    render(
      <MapTooltip
        group="reports"
        datum={{ id: 'r1', label: 'Trapped', unverified: true, confidence: 0.5 }}
      />,
    );
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    expect(screen.getByText('Unverified')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('renders a caveat as a labelled note', () => {
    render(<MapTooltip group="outage" datum={{ id: 'o1' }} caveat="County-granular estimate." />);
    const note = screen.getByText('County-granular estimate.');
    expect(note).toHaveAttribute('role', 'note');
  });

  it('shows no Unverified badge for a verified datum', () => {
    render(<MapTooltip group="infra" datum={{ id: 'n1', label: 'Substation' }} />);
    expect(screen.queryByText('Unverified')).toBeNull();
  });

  it('renders a floodzone datum with its zone class + the honest NFHL caveat (W3b)', () => {
    render(
      <MapTooltip
        group="floodzone"
        datum={{ id: 'fz1', label: 'Zone AE', status: 'AE' }}
        caveat="Regulatory flood zones — not a live extent"
      />,
    );
    expect(screen.getByText('Zone AE')).toBeInTheDocument();
    expect(screen.getByText('Layer: floodzone')).toBeInTheDocument();
    expect(screen.getByText('Regulatory flood zones — not a live extent')).toHaveAttribute(
      'role',
      'note',
    );
    expect(screen.queryByText('Unverified')).toBeNull();
  });

  it('renders a live-camera datum: title + provider + LIVE + click-to-open affordance + link-out caveat (E11)', () => {
    render(
      <MapTooltip
        group="cameras"
        datum={{
          id: 'cam-live',
          label: 'Ridge PTZ',
          status: 'LIVE',
          provider: 'ALERTCalifornia',
          viewUrl: 'https://cameras.alertcalifornia.org/cam/ridge',
        }}
        caveat="Live cameras — opens the source's site in a new tab"
      />,
    );
    expect(screen.getByText('Ridge PTZ')).toBeInTheDocument();
    expect(screen.getByText('ALERTCalifornia')).toBeInTheDocument();
    expect(screen.getByText('LIVE')).toBeInTheDocument();
    expect(screen.getByText('click to open ↗')).toBeInTheDocument();
    expect(screen.getByText("Live cameras — opens the source's site in a new tab")).toHaveAttribute(
      'role',
      'note',
    );
    expect(screen.queryByText('Unverified')).toBeNull();
  });

  it('labels a non-live camera datum SNAPSHOT (honest freshness, never a fake "live")', () => {
    render(
      <MapTooltip
        group="cameras"
        datum={{
          id: 'cam-snap',
          label: 'US-50 @ Echo',
          status: 'SNAPSHOT',
          provider: 'Caltrans',
          viewUrl: 'https://cwwp2.dot.ca.gov/cam/echo',
        }}
      />,
    );
    expect(screen.getByText('SNAPSHOT')).toBeInTheDocument();
    expect(screen.getByText('click to open ↗')).toBeInTheDocument();
  });

  it('does NOT show the camera affordance for a non-camera datum (no viewUrl → unchanged tooltip)', () => {
    render(<MapTooltip group="cell" datum={{ id: 'c1', label: 'LTE', status: 'ONLINE' }} />);
    expect(screen.queryByText('click to open ↗')).toBeNull();
  });

  it('renders a weather datum with the preformatted wind label + the observation-point caveat (W3b)', () => {
    render(
      <MapTooltip
        group="weather"
        datum={{ id: 'weather-observation', label: '25 km/h from the NE' }}
        caveat="Observation point — not a forecast grid"
      />,
    );
    expect(screen.getByText('25 km/h from the NE')).toBeInTheDocument();
    expect(screen.getByText('Observation point — not a forecast grid')).toHaveAttribute(
      'role',
      'note',
    );
  });
});
