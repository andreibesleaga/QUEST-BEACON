// BEACON — one axis order, everywhere, proven rather than asserted in a comment.
//
// The defect this exists to catch is the oldest one in geospatial software and the least visible: a
// coordinate pair written the other way round. `[45.45, 28.0]` is a perfectly valid position — it is in
// the Indian Ocean. Nothing throws, no schema complains, the map simply draws Romania's flood off the
// coast of Somalia, and the only way anyone finds out is by looking at the screen.
//
// This project already handles it carefully per file: every anti-corruption layer converts to GeoJSON
// `[lon, lat]` at the boundary (`wmo-swic` documents CAP's reversed `lat,lon`; `external-views` emits
// latitude first because Google, Bing and OSM all want it that way). What did not exist was a check that
// the SEEDED data, the REGION registry and the SHELTER registry — three separate files, edited by hand,
// by different people, at different times — still agree with each other.
//
// So this suite reads those three sources and asserts one thing in both directions: every seeded
// coordinate falls inside the bbox of the region it is filed under, and the region's own bbox is the
// right way round. When it fails it says whether swapping the pair would fix it, because that is the
// answer 90% of the time and saying so turns a mystery into a one-line edit.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MAP_SEED } from '@/main/map-seed.js';
import * as scenarios from '@/main/scenario-inputs.js';

type BBox = readonly [number, number, number, number]; // [west, south, east, north] — GeoJSON order
type Position = readonly [number, number]; // [lon, lat]

interface RegionRow {
  readonly id: string;
  readonly bbox: BBox;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')) as T;
}

const regions = readJson<{ regions: RegionRow[] }>('config/regions.json').regions;
const bboxes = new Map<string, BBox>(regions.map((r) => [r.id, r.bbox]));

/** Is the point inside the box? Inclusive — a gauge on the border is in the region, not out of it. */
function contains(box: BBox, [lon, lat]: Position): boolean {
  const [west, south, east, north] = box;
  return lon >= west && lon <= east && lat >= south && lat <= north;
}

/** The failure message that does the work: it names the likely cause instead of printing two numbers. */
function why(regionId: string, box: BBox, position: Position, where: string): string {
  const swapped: Position = [position[1], position[0]];
  const hint = contains(box, swapped)
    ? 'THE PAIR IS THE WRONG WAY ROUND — it is inside the region when read as [lat, lon]. GeoJSON order is [lon, lat].'
    : 'It is not a simple axis swap: the point is outside the region either way round.';
  return `${where}: [${position[0]}, ${position[1]}] is outside ${regionId} ${JSON.stringify(box)}. ${hint}`;
}

const GEOJSON_TYPES = new Set([
  'Point',
  'MultiPoint',
  'LineString',
  'MultiLineString',
  'Polygon',
  'MultiPolygon',
]);

/** Every [lon, lat] inside a nested coordinates member, at whatever depth the geometry type puts it. */
function positionsOfCoordinates(node: unknown, out: Position[]): void {
  if (!Array.isArray(node)) return;
  if (node.length === 2 && node.every((n) => typeof n === 'number')) {
    out.push(node as unknown as Position);
    return;
  }
  for (const child of node) positionsOfCoordinates(child, out);
}

interface Found {
  readonly position: Position;
  readonly where: string;
}

/** A GeoJSON geometry's own positions, or null when this object is not a geometry. */
function geometryPositions(record: Record<string, unknown>, path: string): Found[] | null {
  const type = record['type'];
  if (typeof type !== 'string' || !GEOJSON_TYPES.has(type) || !('coordinates' in record))
    return null;
  const found: Position[] = [];
  positionsOfCoordinates(record['coordinates'], found);
  return found.map((position) => ({ position, where: `${path} (${type})` }));
}

/** A `{lon, lat}` record's position — the shape config files use — or null. */
function lonLatPosition(record: Record<string, unknown>): Position | null {
  const lon = record['lon'];
  const lat = record['lat'];
  return typeof lon === 'number' && typeof lat === 'number' ? [lon, lat] : null;
}

/** A field that names itself a position, e.g. `position`, `center`, `origin`. */
function namedPosition(key: string, value: unknown): Position | null {
  const named = key === 'position' || key === 'center' || key === 'origin';
  if (!named || !Array.isArray(value) || value.length !== 2) return null;
  return value.every((n) => typeof n === 'number') ? (value as unknown as Position) : null;
}

/**
 * Walk a seeded structure and collect the coordinates it actually carries.
 *
 * Deliberately NOT "every two-number array": `BBOX_HALF_RANGE`, a trend sample and a buffer pair are all
 * two numbers, and a check that flagged them would be turned off within a week. Only three shapes count —
 * a GeoJSON geometry, a field that names itself a position, and a `{lon, lat}` record.
 */
function collectPositions(node: unknown, path: string, out: Found[]): void {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((child, i) => collectPositions(child, `${path}[${i}]`, out));
    return;
  }
  const record = node as Record<string, unknown>;
  const geometry = geometryPositions(record, path);
  if (geometry !== null) {
    out.push(...geometry);
    return;
  }
  const lonLat = lonLatPosition(record);
  if (lonLat !== null) out.push({ position: lonLat, where: `${path} {lon,lat}` });
  collectFields(record, path, out);
}

function collectFields(record: Record<string, unknown>, path: string, out: Found[]): void {
  for (const [key, value] of Object.entries(record)) {
    const named = namedPosition(key, value);
    if (named !== null) {
      out.push({ position: named, where: `${path}.${key}` });
      continue;
    }
    collectPositions(value, `${path}.${key}`, out);
  }
}

describe('the region registry itself', () => {
  it.each(regions.map((r) => r.id))('%s declares a bbox in GeoJSON order and in range', (id) => {
    const [west, south, east, north] = bboxes.get(id) as BBox;
    // A bbox written [south, west, north, east] — the other common convention — usually still parses.
    // These four assertions are what separate the two: a latitude cannot exceed 90.
    expect(west).toBeLessThan(east);
    expect(south).toBeLessThan(north);
    expect(Math.abs(west)).toBeLessThanOrEqual(180);
    expect(Math.abs(east)).toBeLessThanOrEqual(180);
    expect(Math.abs(south)).toBeLessThanOrEqual(90);
    expect(Math.abs(north)).toBeLessThanOrEqual(90);
  });

  it('agrees with the scenario centres, which are maintained in a different file', () => {
    // The cross-check that a single-file review cannot make. `config/regions.json` is edited when a zone
    // is added; `scenario-inputs.ts` is edited when a demo is written. Nothing but this test has ever
    // required the two to point at the same part of the planet.
    const centres: readonly [string, Position][] = [
      ['us-ca', scenarios.CA_CENTER],
      ['ro', scenarios.RO_CENTER],
      ['es', scenarios.ES_CENTER],
      ['gr', scenarios.GR_CENTER],
      ['ph', scenarios.PH_CENTER],
    ];
    for (const [id, centre] of centres) {
      const box = bboxes.get(id) as BBox;
      expect(contains(box, centre), why(id, box, centre, `scenario centre for ${id}`)).toBe(true);
    }
  });
});

describe('every seeded coordinate is in the region it is filed under', () => {
  const shelters = readJson<{
    regions: { region_id: string; shelters: { id: string; lon: number; lat: number }[] }[];
  }>('config/shelters.json').regions;

  it.each(shelters.map((r) => r.region_id))('config/shelters.json — %s', (regionId) => {
    const box = bboxes.get(regionId);
    expect(
      box,
      `shelters.json files rows under '${regionId}', which config/regions.json does not declare`,
    ).toBeDefined();
    const rows = shelters.find((r) => r.region_id === regionId)?.shelters ?? [];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const position: Position = [row.lon, row.lat];
      expect(
        contains(box as BBox, position),
        why(regionId, box as BBox, position, `shelter ${row.id}`),
      ).toBe(true);
    }
  });

  it.each(Object.keys(DEFAULT_MAP_SEED))('the built-in map seed — %s', (regionId) => {
    const box = bboxes.get(regionId);
    expect(
      box,
      `DEFAULT_MAP_SEED carries '${regionId}', which config/regions.json does not declare`,
    ).toBeDefined();
    const found: Found[] = [];
    collectPositions(DEFAULT_MAP_SEED[regionId as keyof typeof DEFAULT_MAP_SEED], regionId, found);
    // A region whose seed yields no coordinate at all would make this test vacuous — the exact "gate that
    // cannot fail for the thing it covers" shape this project keeps finding.
    expect(found.length).toBeGreaterThan(0);
    for (const { position, where } of found) {
      expect(contains(box as BBox, position), why(regionId, box as BBox, position, where)).toBe(
        true,
      );
    }
  });
});

// ── The operator reference data (added with the five operational datasets, 2026-09-12) ────────────────
//
// `config/reference-data.json` is a fourth hand-edited file carrying coordinates, and it arrived after
// this suite did. A resource is filed under a region directly; a report is filed under an incident, and
// the incident names the region — so the report's location is checked against the region it inherits,
// which is also the check that catches a report attached to the wrong incident entirely.
describe('config/reference-data.json places every row inside the region it is filed under', () => {
  interface RefDoc {
    readonly incidents?: { domain_id: string; region_id: string }[];
    readonly resources?: { domain_id: string; region_id: string; lon?: number; lat?: number }[];
    readonly public_reports?: {
      domain_id: string;
      incident_domain_id: string;
      lon?: number;
      lat?: number;
    }[];
  }
  const doc = readJson<RefDoc>('config/reference-data.json');
  const regionOfIncident = new Map((doc.incidents ?? []).map((i) => [i.domain_id, i.region_id]));

  it('every resource with a location is inside its own region', () => {
    const located = (doc.resources ?? []).filter((r) => r.lon !== undefined && r.lat !== undefined);
    expect(located.length).toBeGreaterThan(0);
    for (const row of located) {
      const box = bboxes.get(row.region_id);
      expect(box, `resources[${row.domain_id}] names region '${row.region_id}'`).toBeDefined();
      const position: Position = [row.lon as number, row.lat as number];
      expect(
        contains(box as BBox, position),
        why(row.region_id, box as BBox, position, `resources[${row.domain_id}]`),
      ).toBe(true);
    }
  });

  it('every report with a location is inside the region of the incident it is filed under', () => {
    const located = (doc.public_reports ?? []).filter(
      (r) => r.lon !== undefined && r.lat !== undefined,
    );
    expect(located.length).toBeGreaterThan(0);
    for (const row of located) {
      const regionId = regionOfIncident.get(row.incident_domain_id);
      expect(regionId, `public_reports[${row.domain_id}] names an unknown incident`).toBeDefined();
      const box = bboxes.get(String(regionId));
      const position: Position = [row.lon as number, row.lat as number];
      expect(
        contains(box as BBox, position),
        why(String(regionId), box as BBox, position, `public_reports[${row.domain_id}]`),
      ).toBe(true);
    }
  });
});
