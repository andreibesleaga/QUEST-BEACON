// BEACON — shelter registry + schema tests (FR-8, SPEC §5.5; ADR-012).
//
// The load-bearing tests are the negative ones. `config/shelters.json` is edited BY HAND by an operator
// under time pressure, so the question this file answers is not "does the happy path parse" but "what
// happens when the edit is wrong": a shelter holding more people than it can, a FULL site with room left, a
// duplicated primary key, a swapped coordinate. Each of those must stop the seed, because the alternative
// is a shelter row that renders confidently and sends evacuees somewhere that cannot take them.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  allShelters,
  loadShelterRegistry,
  parseShelterRegistry,
} from './shelter-registry.js';

const CONFIG = fileURLToPath(new URL('../../../config/shelters.json', import.meta.url));
const SCHEMA = fileURLToPath(new URL('../../../schemas/shelters.schema.json', import.meta.url));
const REGIONS = fileURLToPath(new URL('../../../config/regions.json', import.meta.url));

interface RawEntry {
  id: string;
  lon: number;
  lat: number;
  capacity: number;
  occupancy?: number;
  status?: string;
}
interface RawFile {
  version: number;
  regions: { region_id: string; shelters: RawEntry[] }[];
}

const raw = JSON.parse(readFileSync(CONFIG, 'utf8')) as RawFile;
const validator = () =>
  new Ajv2020({ allErrors: true, strict: false }).compile(
    JSON.parse(readFileSync(SCHEMA, 'utf8')) as object,
  );

describe('config/shelters.json ↔ schemas/shelters.schema.json', () => {
  it('validates against the published JSON-Schema', () => {
    const validate = validator();
    validate(raw);
    expect(validate.errors ?? [], JSON.stringify(validate.errors, null, 2)).toEqual([]);
  });

  it('groups shelters under regions that actually exist in config/regions.json', () => {
    const known = (JSON.parse(readFileSync(REGIONS, 'utf8')) as { regions: { id: string }[] }).regions.map(
      (r) => r.id,
    );
    for (const group of raw.regions) expect(known).toContain(group.region_id);
  });

  it('rejects a latitude outside [-90,90] — the classic hand-edited lon/lat swap', () => {
    const validate = validator();
    const swapped = structuredClone(raw);
    const first = swapped.regions[0]?.shelters[0];
    if (first === undefined) throw new Error('fixture requires at least one configured shelter');
    [first.lon, first.lat] = [first.lat, 121.49];
    expect(validate(swapped)).toBe(false);
  });

  it('rejects an id that is not a uuid (shelter.id is a uuid column)', () => {
    const validate = validator();
    const renamed = structuredClone(raw);
    const first = renamed.regions[0]?.shelters[0];
    if (first === undefined) throw new Error('fixture requires at least one configured shelter');
    first.id = 'sacramento-cal-expo';
    expect(validate(renamed)).toBe(false);
  });
});

describe('parseShelterRegistry — domain invariants are enforced at LOAD, not at insert', () => {
  const group = (shelters: RawEntry[]) => ({ version: 1, regions: [{ region_id: 'us-ca', shelters }] });
  const entry = (over: Partial<RawEntry> = {}): RawEntry => ({
    id: '00000000-0000-4000-8000-0000000000f1',
    lon: -121.49,
    lat: 38.58,
    capacity: 100,
    occupancy: 10,
    status: 'OPEN',
    ...over,
  });

  it('builds domain Shelter entities with org, capacity and status carried through', () => {
    const registry = parseShelterRegistry({
      version: 1,
      regions: [{ region_id: 'us-ca', shelters: [{ ...entry(), org: 'American Red Cross' }] }],
    });
    const [shelter] = allShelters(registry);
    expect(shelter?.capacity).toBe(100);
    expect(shelter?.occupancy).toBe(10);
    expect(shelter?.status).toBe('OPEN');
    expect(shelter?.orgId).toBe('American Red Cross');
    expect(shelter?.geom).toEqual({ type: 'Point', coordinates: [-121.49, 38.58] });
  });

  it('defaults occupancy to 0 and status to OPEN (the schema defaults, applied by the domain factory)', () => {
    const registry = parseShelterRegistry(
      group([{ id: '00000000-0000-4000-8000-0000000000f2', lon: 26.1, lat: 44.43, capacity: 50 }]),
    );
    expect(allShelters(registry)[0]?.occupancy).toBe(0);
    expect(allShelters(registry)[0]?.status).toBe('OPEN');
  });

  it('refuses occupancy above capacity — a shelter cannot hold more than it can hold', () => {
    expect(() => parseShelterRegistry(group([entry({ capacity: 40, occupancy: 41 })]))).toThrow();
  });

  it('refuses FULL with headroom left — the status would lie about the site', () => {
    expect(() => parseShelterRegistry(group([entry({ capacity: 100, occupancy: 10, status: 'FULL' })]))).toThrow();
  });

  it('refuses a duplicate shelter id across region groups (a PK, and the handle an UPDATE targets)', () => {
    const duplicated = {
      version: 1,
      regions: [
        { region_id: 'us-ca', shelters: [entry()] },
        { region_id: 'ro', shelters: [entry({ lon: 26.1, lat: 44.43 })] },
      ],
    };
    expect(() => parseShelterRegistry(duplicated)).toThrow(/duplicate shelter id/);
  });

  it('refuses a non-numeric coordinate rather than coercing it to NaN', () => {
    expect(() => parseShelterRegistry(group([entry({ lon: '-121.49' as unknown as number })]))).toThrow(/lon/);
  });

  it('refuses a file that is not { version, regions[] }', () => {
    expect(() => parseShelterRegistry({ shelters: [] })).toThrow(/version, regions/);
  });

  it('refuses a region group with no shelters[] array', () => {
    expect(() => parseShelterRegistry({ version: 1, regions: [{ region_id: 'us-ca' }] })).toThrow(/shelters/);
  });
});

describe('loadShelterRegistry', () => {
  it('loads the SHIPPED config and returns domain shelters', () => {
    const res = loadShelterRegistry();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.version).toBe(1);
    expect(allShelters(res.value).length).toBeGreaterThan(0);
    for (const s of allShelters(res.value)) {
      expect(s.occupancy).toBeLessThanOrEqual(s.capacity);
    }
  });

  it('returns a typed Result (never throws upstream) when the file is missing', () => {
    const res = loadShelterRegistry('/nonexistent/shelters.json');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('PARSE_ERROR');
  });
});
