// @vitest-environment happy-dom
// BEACON — Legend tests (E8·T-346). The legend renders every severity + status with BOTH a text label and
// an icon/shape — the one-meaning-per-colour contract, asserted by text (never colour).
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Legend } from './legend.js';
import { SEVERITY_ORDER, SEVERITY_META } from './severity-tag.js';
import { MODE_ORDER, MODE_META } from './mode-badge.js';

describe('Legend', () => {
  it('is a labelled region', () => {
    render(<Legend />);
    expect(screen.getByRole('region', { name: 'Map legend' })).toBeInTheDocument();
  });

  it('lists every hazard severity by text label', () => {
    render(<Legend />);
    for (const s of SEVERITY_ORDER) {
      expect(screen.getByText(SEVERITY_META[s].label)).toBeInTheDocument();
    }
  });

  it('lists every source mode and the data-status labels', () => {
    render(<Legend />);
    for (const m of MODE_ORDER) {
      // Mode labels (Live/Cached/Mock) — getAllByText because "Live" also appears under status? No: status
      // uses Fresh/Stale/Unavailable, so mode labels are unique here.
      expect(screen.getByText(MODE_META[m].label)).toBeInTheDocument();
    }
    for (const status of ['Fresh', 'Stale', 'Unavailable', 'Unverified']) {
      expect(screen.getByText(status)).toBeInTheDocument();
    }
  });

  it('renders an icon for every legend row (never colour-only)', () => {
    const { container } = render(<Legend />);
    const rows = container.querySelectorAll('li');
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((row) => expect(row.querySelector('svg')).toBeInTheDocument());
  });

  it('renders a data-attribution line for licensed overlay sources (ODbL/CC BY/CC BY-SA)', () => {
    render(<Legend />);
    expect(
      screen.getByText(
        'Data: © OpenStreetMap contributors (ODbL) · WorldPop (CC BY 4.0) · OpenCelliD (CC BY-SA 4.0) · ' +
          'US federal sources (public domain) · Copernicus/JRC (EFFIS) · Webcams provided by windy.com · ' +
          'ALERTCalifornia | UC San Diego · Caltrans/511/CNAIR (link-out)',
      ),
    ).toBeInTheDocument();
  });

  it('credits the E11 live-camera sources, incl. the ToS-mandatory Windy webcams badge (FR-CAM-3)', () => {
    render(<Legend />);
    const attribution = screen.getByText(/Webcams provided by windy\.com/);
    expect(attribution).toHaveTextContent('Webcams provided by windy.com');
    expect(attribution).toHaveTextContent('ALERTCalifornia | UC San Diego');
    expect(attribution).toHaveTextContent('Caltrans/511/CNAIR (link-out)');
  });
});
