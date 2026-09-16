// BEACON — external-views deep-link builder tests (E11 · CW0; ADR-028). PURE + deterministic: no clock, no
// network, no key. Every provider url is exact-matched for TWO known coordinates (Paradise CA + Brașov RO —
// global coverage), plus the NASA Worldview ~1° bbox math and the zoom option. Position is [lon,lat].
import { describe, it, expect } from 'vitest';
import {
  buildExternalViews,
  EXTERNAL_VIEW_KINDS,
  type ExternalViewLink,
} from './external-views.js';
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

describe("buildExternalViews — the operator's zoom reaches EVERY provider", () => {
  // 2026-09-11, owner-reported: "the current view on the COP map must be kept with all the other sources
  // and external sources ... for all the external links."
  //
  // THE ASSERTION BELOW REPLACED ITS OWN OPPOSITE. The previous version of this test said "Non-Google
  // providers keep their own fixed context zoom regardless of the option" and pinned Windy to 10 and
  // FIRMS to 8 whatever the caller asked for. That was not a guard; it was the defect, written down and
  // protected by a green check — an operator zoomed to a street opened Windy at a whole-region view and
  // Zoom Earth at a continental one. The change is deliberate and the old expectation is gone on purpose.
  it('defaults every provider to its verified framing when no zoom is given', () => {
    const links = buildExternalViews(PARADISE);
    expect(byLabel(links, 'Google Maps').url).toContain('&zoom=14');
    expect(byLabel(links, 'Google Satellite').url).toContain('&zoom=14&basemap=satellite');
    // The nine exact-match tests above already pin the rest at this default — this only names the anchor.
    expect(byLabel(links, 'Windy').url).toBe('https://www.windy.com/?39.76000,-121.62000,10');
    expect(byLabel(links, 'NASA FIRMS (active fires)').url).toContain(',8z');
  });

  it('carries an explicit zoom into EVERY provider, each on its own scale', () => {
    const links = buildExternalViews(PARADISE, { zoom: 17 }); // operator zoomed to a street
    expect(byLabel(links, 'Google Maps').url).toContain('&zoom=17');
    expect(byLabel(links, 'Google Satellite').url).toContain('&zoom=17&basemap=satellite');
    expect(byLabel(links, 'OpenStreetMap').url).toContain('#map=17/');
    expect(byLabel(links, 'Bing Aerial').url).toContain('&lvl=18');
    expect(byLabel(links, 'Windy').url).toBe('https://www.windy.com/?39.76000,-121.62000,13');
    expect(byLabel(links, 'Zoom Earth').url).toContain(',11z');
    expect(byLabel(links, 'NASA FIRMS (active fires)').url).toContain(',11z');
    expect(byLabel(links, 'Google Flood Hub').url.endsWith('/13')).toBe(true);
    // Google Earth takes a camera DISTANCE, which shrinks as the operator zooms in: 20000 m at 14 → 2500 m.
    expect(byLabel(links, 'Google Earth 3D').url).toContain('700a,2500d,');
    // Worldview takes an EXTENT, which shrinks the same way: ±0.5° at 14 → ±0.0625° at 17.
    expect(byLabel(links, 'NASA Worldview').url).toBe(
      'https://worldview.earthdata.nasa.gov/?v=-121.68250,39.69750,-121.55750,39.82250',
    );
  });

  it('keeps the hazard views WIDER than the operator framing at every zoom', () => {
    // The reason the fixed zooms existed is still valid and must survive being made relative: a
    // fire-detection or flood-forecast view zoomed to a doorstep shows a handful of pixels of a regional
    // event. What changed is that the width now moves WITH the camera instead of ignoring it.
    for (const z of [8, 11, 14, 17, 20]) {
      const links = buildExternalViews(PARADISE, { zoom: z });
      const fire = Number(/,(\d+)z$/.exec(byLabel(links, 'NASA FIRMS (active fires)').url)?.[1]);
      const flood = Number(byLabel(links, 'Google Flood Hub').url.split('/').pop());
      expect(fire).toBeLessThan(z);
      expect(flood).toBeLessThan(z);
    }
  });

  it("clamps to each provider's own accepted range instead of emitting a value it would reject", () => {
    // FIRMS validates 0..22 in its own hash parser; Zoom Earth tops out at 15; Flood Hub at 15. A COP
    // zoomed to its extremes must still produce a url the provider can PARSE — a rejected deep-link is
    // a dead-end, and Art. XVI says degrade and label, never dead-end.
    const wide = buildExternalViews(PARADISE, { zoom: 1 });
    expect(byLabel(wide, 'NASA FIRMS (active fires)').url).toContain(',0z');
    expect(byLabel(wide, 'Zoom Earth').url).toContain(',2z');
    expect(byLabel(wide, 'Google Flood Hub').url.endsWith('/1')).toBe(true);
    expect(byLabel(wide, 'OpenStreetMap').url).toContain('#map=1/');
    // ...and the Worldview box stays a box rather than swallowing the globe.
    const v = /\?v=(.*)$/.exec(byLabel(wide, 'NASA Worldview').url)?.[1] ?? '';
    const [minLon, minLat, maxLon, maxLat] = v.split(',').map(Number);
    expect(minLon).toBeGreaterThanOrEqual(-180);
    expect(maxLon).toBeLessThanOrEqual(180);
    expect(minLat).toBeGreaterThanOrEqual(-90);
    expect(maxLat).toBeLessThanOrEqual(90);

    const tight = buildExternalViews(PARADISE, { zoom: 22 });
    expect(byLabel(tight, 'Zoom Earth').url).toContain(',15z');
    expect(byLabel(tight, 'Bing Aerial').url).toContain('&lvl=20');
    expect(byLabel(tight, 'Google Flood Hub').url.endsWith('/15')).toBe(true);
    // Google Earth never asks for a sub-metre camera.
    expect(byLabel(tight, 'Google Earth 3D').url).toContain('700a,150d,');
  });

  it('every url stays a well-formed https url at extreme zooms — no NaN, no empty segment', () => {
    for (const z of [0, 1, 14, 22, 24]) {
      for (const link of buildExternalViews(PARADISE, { zoom: z })) {
        expect(link.url.startsWith('https://')).toBe(true);
        expect(link.url).not.toContain('NaN');
        expect(link.url).not.toContain('undefined');
        expect(() => new URL(link.url)).not.toThrow();
      }
    }
  });
});
