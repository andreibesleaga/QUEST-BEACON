// @vitest-environment happy-dom
// BEACON — ExternalViewLinks tests (E11 "Live Views" · CW3b; FR-VIEW-1/2). All 11 verified providers render
// as real, keyboard-focusable links with the correct href + security attrs; the advisory caption is present;
// every link has an accessible name (a11y).
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExternalViewLinks } from './external-view-links.js';
import type { Position } from '@/domain/value-objects/geo.js';

const PARADISE: Position = [-121.62, 39.76]; // Paradise, CA — matches external-views.test.ts fixture

const EXPECTED_LABELS = [
  'Google Maps',
  'Google Satellite',
  'Street View',
  'Google Earth 3D',
  'Bing Aerial',
  'OpenStreetMap',
  'Windy',
  'Zoom Earth',
  'NASA Worldview',
  'NASA FIRMS \\(active fires\\)', // regex-escaped: used below as a RegExp source
  'Google Flood Hub',
];

describe('ExternalViewLinks', () => {
  it('renders all 11 provider links', () => {
    render(<ExternalViewLinks position={PARADISE} />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(11);
    for (const label of EXPECTED_LABELS) {
      expect(screen.getByRole('link', { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  // The two hazard links carry OPPOSITE coordinate orders (verified against each provider's own code).
  // Pinned here at the render site too: the builder test proves the string, this proves the UI ships it.
  it('renders the hazard links with their verified, opposite coordinate orders', () => {
    render(<ExternalViewLinks position={PARADISE} />);
    expect(screen.getByRole('link', { name: /NASA FIRMS/ })).toHaveAttribute(
      'href',
      'https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@-121.62000,39.76000,8z', // lon,lat
    );
    expect(screen.getByRole('link', { name: /Google Flood Hub/ })).toHaveAttribute(
      'href',
      'https://sites.research.google/floods/l/39.76000/-121.62000/10', // lat/lon
    );
  });

  it('builds the exact Google Maps href for the known Paradise, CA coordinate', () => {
    render(<ExternalViewLinks position={PARADISE} />);
    const link = screen.getByRole('link', { name: /Google Maps/ });
    expect(link).toHaveAttribute(
      'href',
      'https://www.google.com/maps/@?api=1&map_action=map&center=39.76000%2C-121.62000&zoom=14',
    );
  });

  it('builds the exact NASA Worldview bbox href', () => {
    render(<ExternalViewLinks position={PARADISE} />);
    const link = screen.getByRole('link', { name: /NASA Worldview/ });
    expect(link).toHaveAttribute(
      'href',
      'https://worldview.earthdata.nasa.gov/?v=-122.12000,39.26000,-121.12000,40.26000',
    );
  });

  it('every link opens externally in a new tab, safely (target/rel security)', () => {
    render(<ExternalViewLinks position={PARADISE} />);
    for (const link of screen.getAllByRole('link')) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      expect(link.getAttribute('href')).toMatch(/^https:\/\//);
    }
  });

  it('shows the honest link-only advisory caption', () => {
    render(<ExternalViewLinks position={PARADISE} />);
    expect(screen.getByText('External context — opens third-party sites.')).toBeInTheDocument();
  });

  it('folds an optional label into the caption', () => {
    render(<ExternalViewLinks position={PARADISE} label="Camp Fire" />);
    expect(
      screen.getByText('External context — opens third-party sites for Camp Fire.'),
    ).toBeInTheDocument();
  });

  it('gives every link an accessible name (a11y) and a visible kind tag', () => {
    render(<ExternalViewLinks position={PARADISE} />);
    const streetView = screen.getByRole('link', { name: /Street View/ });
    expect(streetView).toHaveAccessibleName(/Street View/);
    expect(streetView).toHaveTextContent('Street');
    const earth3d = screen.getByRole('link', { name: /Google Earth 3D/ });
    expect(earth3d).toHaveTextContent('3D');
  });

  it('links are keyboard-focusable (real anchors, no tabIndex=-1)', () => {
    render(<ExternalViewLinks position={PARADISE} />);
    for (const link of screen.getAllByRole('link')) {
      expect(link.tagName).toBe('A');
      expect(link).not.toHaveAttribute('tabindex', '-1');
    }
  });
});
