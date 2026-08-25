// BEACON — alert-reach tests (MW-D/D1.3; ADR-035 §1(b) + V5/V6; finding F-28).
//
// V5's table plus the two honesty invariants V6 demands: the caveat is never droppable, and NO code path
// reads `TelecomCoverage.online` (which the ACL hardcodes to `true`, so a figure built on it would be
// fabricated). Deterministic ray-cast SpatialPort — no Turf, no network, no clock.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { SpatialPort } from '@/ports/index.js';
import type { TelecomCoverage } from '@/ports/infrastructure-sources.js';
import type { DomainError } from '@/domain/errors.js';
import { DomainError as DomainErrorClass } from '@/domain/errors.js';
import type { Result } from '@/domain/shared/result.js';
import { err, isErr, isOk, ok } from '@/domain/shared/result.js';
import type { Geometry, PolygonGeometry, Position } from '@/domain/value-objects/geo.js';
import { ALERT_REACH_CAVEAT, ALERT_REACH_METHOD, estimateAlertReach, type AlertReachInput } from './alert-reach.js';
import type { PopulationCell } from './zonal-sum.js';

/**
 * A deterministic even-odd ray-cast stand-in for the Turf-backed `SpatialPort` — the same local test double
 * `derive-cop.test.ts` uses, so inside/outside is real geometry rather than a stub returning a constant.
 */
function inRing(pt: Position, ring: readonly Position[]): boolean {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** A deterministic ray-cast SpatialPort: only `pointInPolygon` is exercised here. */
const spatial: SpatialPort = {
  pointInPolygon: (pt: Position, polygon: PolygonGeometry): Result<boolean, DomainError> =>
    ok(inRing(pt, polygon.coordinates[0] ?? [])),
  buffer: () => err(new DomainErrorClass('INVARIANT_VIOLATION', 'not used')),
  intersect: () => err(new DomainErrorClass('INVARIANT_VIOLATION', 'not used')),
};
const failingSpatial: SpatialPort = {
  ...spatial,
  pointInPolygon: () => err(new DomainErrorClass('PARSE_ERROR', 'spatial down')),
};

const rect = (minX: number, minY: number, maxX: number, maxY: number): Geometry => ({
  type: 'Polygon',
  coordinates: [[[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY]] as readonly Position[]],
});
const EXTENT = [rect(0, 0, 1, 1)];
const site = (lon: number, lat: number): TelecomCoverage => ({ position: [lon, lat], online: true, technology: 'LTE' });

function reach(over: Partial<AlertReachInput> = {}, port: SpatialPort = spatial) {
  const res = estimateAlertReach(
    { sites: [], geometries: EXTENT, populationResolution: 'NONE', ...over },
    port,
  );
  if (!isOk(res)) throw new Error(`expected ok, got ${res.error.message}`);
  return res.value;
}

describe('the GEOMETRIC site count (the intersection F-28/F9 says never happened)', () => {
  it('counts the sites inside the extent and reports the loss fraction', () => {
    const f = reach({ sites: [site(0.5, 0.5), site(0.2, 0.8), site(5, 5)] });
    expect(f.sitesTotal).toBe(3);
    expect(f.sitesInExtent).toBe(2);
    expect(f.siteLossFraction).toBeCloseTo(2 / 3, 9);
    expect(f.method).toBe(ALERT_REACH_METHOD);
    expect(f.caveat).toBe(ALERT_REACH_CAVEAT);
  });

  it('a site exactly ON the boundary is decided by the port, deterministically and identically each run', () => {
    const a = reach({ sites: [site(1, 0.5)] });
    const b = reach({ sites: [site(1, 0.5)] });
    expect(a.sitesInExtent).toBe(b.sitesInExtent);
  });

  it('ZERO sites ⇒ no flag, `siteDataAvailable: false`, and never a silent zero loss', () => {
    const f = reach({ sites: [] });
    expect(f.sitesTotal).toBe(0);
    expect(f.siteDataAvailable).toBe(false);
    expect(f.siteLossFraction).toBe(0);
    expect(f.requiresNonCellularDissemination).toBe(false);
    expect(f.inputs).toMatchObject({ flagRaisedBy: 'none' });
  });

  it('a SpatialPort error short-circuits — never a partial or guessed count', () => {
    expect(isErr(estimateAlertReach({ sites: [site(0.5, 0.5)], geometries: EXTENT, populationResolution: 'NONE' }, failingSpatial))).toBe(true);
  });
});

describe('nearest-site assignment (the resident limb)', () => {
  // Cells are ~0.02° across (≈2 km), well inside the 15 km assignment radius, so the geometry is unambiguous.
  const cells: readonly PopulationCell[] = [
    { bbox: [0.40, 0.40, 0.42, 0.42], count: 800 }, // nearest site is the one INSIDE the extent
    { bbox: [4.99, 4.99, 5.01, 5.01], count: 300 }, // nearest site is the one OUTSIDE the extent
    { bbox: [40.0, 40.0, 40.02, 40.02], count: 250 }, // no site within the radius at all
  ];
  const sites = [site(0.41, 0.41), site(5, 5)];

  it('splits residents into losing / already-unserved, with no double counting', () => {
    const f = reach({ sites, populationCells: cells, populationResolution: 'CELL_LEVEL' });
    expect(f.residentsLosingCellularReach).toBe(800);
    expect(f.residentsAlreadyUnserved).toBe(250);
    expect(f.inputs).toMatchObject({ populationCellsAssigned: 2 });
    // The already-unserved residents are NOT part of the loss figure.
    expect(f.residentsLosingCellularReach).not.toBe(800 + 250);
  });

  it('withholds the resident figure entirely when the population data is AREA_LEVEL — never a zero', () => {
    const f = reach({ sites, populationCells: cells, populationResolution: 'AREA_LEVEL' });
    expect(f.residentsLosingCellularReach).toBeUndefined();
    expect(f.residentsAlreadyUnserved).toBeUndefined();
    expect(f.populationResolution).toBe('AREA_LEVEL');
  });

  it('withholds it when CELL_LEVEL is claimed but no cells were supplied', () => {
    expect(reach({ sites, populationResolution: 'CELL_LEVEL' }).residentsLosingCellularReach).toBeUndefined();
  });

  it('ignores empty/negative cells, and counts residents as already-unserved when NO site exists', () => {
    const f = reach({
      sites: [],
      populationCells: [{ bbox: [0.4, 0.4, 0.42, 0.42], count: 500 }, { bbox: [0.4, 0.4, 0.42, 0.42], count: -1 }],
      populationResolution: 'CELL_LEVEL',
    });
    expect(f.residentsAlreadyUnserved).toBe(500);
    expect(f.residentsLosingCellularReach).toBe(0);
  });
});

describe('the dissemination flag — either limb is enough, and it says which one', () => {
  it('raises on the RESIDENT limb', () => {
    const f = reach({
      sites: [site(0.5, 0.5), site(5, 5), site(6, 6), site(7, 7), site(8, 8)], // 1/5 sites ⇒ below the site limb
      populationCells: [{ bbox: [0.49, 0.49, 0.51, 0.51], count: 900 }],
      populationResolution: 'CELL_LEVEL',
    });
    expect(f.requiresNonCellularDissemination).toBe(true);
    expect(f.inputs).toMatchObject({ flagRaisedBy: 'residents' });
  });

  it('raises on the SITE-LOSS limb alone, which is what makes the figure work without a grid', () => {
    const f = reach({ sites: [site(0.5, 0.5), site(5, 5)] }); // 1/2 ⇒ over the fraction threshold
    expect(f.requiresNonCellularDissemination).toBe(true);
    expect(f.inputs).toMatchObject({ flagRaisedBy: 'siteLossFraction' });
  });

  it('stays down when neither limb is crossed', () => {
    const f = reach({ sites: [site(0.5, 0.5), site(5, 5), site(6, 6), site(7, 7), site(8, 8)] }); // 1/5 = 0.2
    expect(f.requiresNonCellularDissemination).toBe(false);
  });
});

describe('the honesty invariants (ADR-035 V6)', () => {
  it('the caveat names every thing the figure is NOT, and the uncertainty is prose, not a fake interval', () => {
    const f = reach({ sites: [site(0.5, 0.5)] });
    expect(f.caveat).toMatch(/not an outage prediction/i);
    expect(f.caveat).toMatch(/lower bound/i);
    expect(f.uncertainty).toMatch(/proxy/i);
    expect(f.uncertainty).not.toMatch(/±/);
  });

  it('NO code path reads `TelecomCoverage.online` — it is hardcoded true at the ACL (F-28)', () => {
    // Strip ALL comments (including trailing ones) — the module deliberately DISCUSSES `online` at length to
    // explain why it is never read, and that prose must not be mistaken for a read. The file contains no `//`
    // inside a string literal, so the line-comment strip is safe here.
    const src = readFileSync(fileURLToPath(new URL('./alert-reach.ts', import.meta.url)), 'utf8')
      .replace(/\/\/.*$/gm, '')
      .replace(/^\s*\*.*$/gm, '');
    expect(src).not.toMatch(/\.online\b/);
    expect(reach({ sites: [site(0.5, 0.5)] }).inputs).toMatchObject({ onlineFieldRead: false });
  });

  it('the figure is identical whether the sites claim online true or false — `online` cannot move a number', () => {
    const online = reach({ sites: [{ position: [0.5, 0.5], online: true }, { position: [5, 5], online: true }] });
    const offline = reach({ sites: [{ position: [0.5, 0.5], online: false }, { position: [5, 5], online: false }] });
    expect(online).toEqual(offline);
  });
});
