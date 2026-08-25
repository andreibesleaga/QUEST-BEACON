// BEACON — external-views deep-link builder tests (E11 · CW0; ADR-028). PURE + deterministic: no clock, no
// network, no key. Every provider url is exact-matched for TWO known coordinates (Paradise CA + Brașov RO —
// global coverage), plus the NASA Worldview ~1° bbox math and the zoom option. Position is [lon,lat].
import { describe, it, expect } from 'vitest';
import { buildExternalViews, EXTERNAL_VIEW_KINDS, type ExternalViewLink } from './external-views.js';
import type { Position } from '@/domain/value-objects/geo.js';

const PARADISE: Position = [-121.62, 39.76]; // Paradise, CA (Camp Fire) — [lon,lat]
const BRASOV: Position = [25.6, 45.65]; // Brașov, RO — [lon,lat]

const byLabel = (links: readonly ExternalViewLink[], label: string): ExternalViewLink =>
  links.find((l) => l.label === label)!;

describe('buildExternalViews — exact provider URLs (Paradise, CA)', () => {
  const links = buildExternalViews(PARADISE);

  it('emits all eleven verified providers with valid kinds and https urls', () => {
    expect(links).toHaveLength(11);
    for (const l of links) {
      expect(EXTERNAL_VIEW_KINDS).toContain(l.kind);
      expect(l.url.startsWith('https://')).toBe(true);
      expect(l.provider.length).toBeGreaterThan(0);
    }
  });

  it('Google Maps', () => {
    expect(byLabel(links, 'Google Maps').url).toBe(
      'https://www.google.com/maps/@?api=1&map_action=map&center=39.76000%2C-121.62000&zoom=14',
    );
  });

  it('Google Satellite', () => {
    expect(byLabel(links, 'Google Satellite').url).toBe(
      'https://www.google.com/maps/@?api=1&map_action=map&center=39.76000%2C-121.62000&zoom=14&basemap=satellite',
    );
  });

  it('Street View', () => {
    expect(byLabel(links, 'Street View').url).toBe(
      'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=39.76000%2C-121.62000',
    );
  });

  it('Google Earth 3D', () => {
    expect(byLabel(links, 'Google Earth 3D').url).toBe(
      'https://earth.google.com/web/@39.76000,-121.62000,700a,20000d,35y,0h,0t,0r',
    );
  });

  it('Bing Aerial', () => {
    expect(byLabel(links, 'Bing Aerial').url).toBe(
      'https://www.bing.com/maps/default.aspx?cp=39.76000~-121.62000&style=a&lvl=15',
    );
  });

  it('OpenStreetMap', () => {
    expect(byLabel(links, 'OpenStreetMap').url).toBe(
      'https://www.openstreetmap.org/?mlat=39.76000&mlon=-121.62000#map=14/39.76000/-121.62000',
    );
  });

  it('Windy', () => {
    expect(byLabel(links, 'Windy').url).toBe('https://www.windy.com/?39.76000,-121.62000,10');
  });

  it('Zoom Earth', () => {
    expect(byLabel(links, 'Zoom Earth').url).toBe(
      'https://zoom.earth/maps/satellite/#view=39.76000,-121.62000,8z',
    );
  });

  it('NASA Worldview carries the ~1° bbox (minLon,minLat,maxLon,maxLat)', () => {
    expect(byLabel(links, 'NASA Worldview').url).toBe(
      'https://worldview.earthdata.nasa.gov/?v=-122.12000,39.26000,-121.12000,40.26000',
    );
  });

  // The two hazard links use OPPOSITE coordinate orders, each verified against the provider's own code
  // (see the builder's comments). These exact-match assertions are the regression guard: a transposed
  // pair still produces a valid-LOOKING url, so only pinning the exact string catches the swap.
  it('NASA FIRMS active fires — LONGITUDE first, then latitude, then <zoom>z', () => {
    expect(byLabel(links, 'NASA FIRMS (active fires)').url).toBe(
      'https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@-121.62000,39.76000,8z',
    );
  });

  it('Google Flood Hub — LATITUDE first, then longitude, then zoom', () => {
    expect(byLabel(links, 'Google Flood Hub').url).toBe(
      'https://sites.research.google/floods/l/39.76000/-121.62000/10',
    );
  });
});

describe('buildExternalViews — exact provider URLs (Brașov, RO — global coverage)', () => {
  const links = buildExternalViews(BRASOV);

  it('Google Maps', () => {
    expect(byLabel(links, 'Google Maps').url).toBe(
      'https://www.google.com/maps/@?api=1&map_action=map&center=45.65000%2C25.60000&zoom=14',
    );
  });

  it('Bing Aerial', () => {
    expect(byLabel(links, 'Bing Aerial').url).toBe(
      'https://www.bing.com/maps/default.aspx?cp=45.65000~25.60000&style=a&lvl=15',
    );
  });

  it('NASA Worldview bbox (RO)', () => {
    expect(byLabel(links, 'NASA Worldview').url).toBe(
      'https://worldview.earthdata.nasa.gov/?v=25.10000,45.15000,26.10000,46.15000',
    );
  });

  // Brașov is the sharper order test: BOTH values are positive and in-range for either slot, so a
  // transposition would look entirely plausible on screen (25.6,45.65 is a real place too — in Romania's
  // neighbour airspace, ~hundreds of km away). Exact strings, opposite orders, same point.
  it('NASA FIRMS active fires (RO) — lon,lat', () => {
    expect(byLabel(links, 'NASA FIRMS (active fires)').url).toBe(
      'https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@25.60000,45.65000,8z',
    );
  });

  it('Google Flood Hub (RO) — lat/lon', () => {
    expect(byLabel(links, 'Google Flood Hub').url).toBe(
      'https://sites.research.google/floods/l/45.65000/25.60000/10',
    );
  });

  it('the two hazard links describe the SAME point with reversed coordinate order', () => {
    const firms = byLabel(links, 'NASA FIRMS (active fires)').url;
    const flood = byLabel(links, 'Google Flood Hub').url;
    expect(firms).toContain('@25.60000,45.65000'); // lon,lat
    expect(flood).toContain('/45.65000/25.60000'); // lat/lon
  });
});

describe('buildExternalViews — NASA Worldview bbox clamping (antimeridian/poles)', () => {
  it('clamps the bbox corners to valid lon (±180) / lat (±90) ranges near the antimeridian and pole', () => {
    const edge: Position = [179.8, 89.8]; // [lon,lat] — +0.5 would overflow both 180 and 90
    const links = buildExternalViews(edge);
    expect(byLabel(links, 'NASA Worldview').url).toBe(
      'https://worldview.earthdata.nasa.gov/?v=179.30000,89.30000,180.00000,90.00000',
    );
  });
});

describe('buildExternalViews — zoom option', () => {
  it('defaults Google Maps/Satellite zoom to 14', () => {
    const links = buildExternalViews(PARADISE);
    expect(byLabel(links, 'Google Maps').url).toContain('&zoom=14');
    expect(byLabel(links, 'Google Satellite').url).toContain('&zoom=14&basemap=satellite');
  });

  it('applies an explicit zoom to Google Maps + Satellite', () => {
    const links = buildExternalViews(PARADISE, { zoom: 11 });
    expect(byLabel(links, 'Google Maps').url).toBe(
      'https://www.google.com/maps/@?api=1&map_action=map&center=39.76000%2C-121.62000&zoom=11',
    );
    expect(byLabel(links, 'Google Satellite').url).toContain('&zoom=11&basemap=satellite');
    // Non-Google providers keep their own fixed context zoom regardless of the option.
    expect(byLabel(links, 'Windy').url).toBe('https://www.windy.com/?39.76000,-121.62000,10');
    // The hazard views keep their deliberately WIDER regional zooms (fire 8, flood 10) — a street-level
    // 11 would frame a handful of pixels of a regional event.
    expect(byLabel(links, 'NASA FIRMS (active fires)').url).toContain(',8z');
    expect(byLabel(links, 'Google Flood Hub').url.endsWith('/10')).toBe(true);
  });
});
