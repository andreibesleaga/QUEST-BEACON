// BEACON — shelter registry loader (FR-8, SPEC §5.5; ADR-011/ADR-012). Reads config/shelters.json →
// Shelter entities via `makeShelter`, so the agency shelter list is editable DATA rather than a literal
// buried in the seed. Adapter layer (Art. II) — config in, domain out.
//
// TWO editable surfaces, both first-class and neither requiring a UI (user directive, plan §0):
//   • this file + `npm run db:seed` — the reproducible starting state, idempotent on the shelter uuid;
//   • a direct `UPDATE shelter SET …` — the live mid-incident correction, which the seed will not clobber
//     (ON CONFLICT DO NOTHING keys on the same id).
// The entity factory runs at LOAD, so an impossible shelter (occupancy above capacity, FULL with headroom
// left) is refused at boot instead of seeding a row that lies about its own capacity.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeShelter, asId } from '@/domain/index.js';
import type { OrgId, Shelter, ShelterId, ShelterStatus } from '@/domain/index.js';
import type { Result } from '@/domain/shared/result.js';
import { err, ok } from '@/domain/shared/result.js';
import { DomainError } from '@/domain/errors.js';

/** One region's shelters. `regionId` is GROUPING ONLY — the `shelter` table carries no region column. */
export interface ShelterRegionGroup {
  readonly regionId: string;
  readonly shelters: readonly Shelter[];
}

export interface ShelterRegistry {
  readonly version: number;
  readonly regions: readonly ShelterRegionGroup[];
}

interface RawShelter {
  id?: unknown;
  org?: unknown;
  lon?: unknown;
  lat?: unknown;
  capacity?: unknown;
  occupancy?: unknown;
  status?: unknown;
}

interface RawGroup {
  region_id?: unknown;
  shelters?: unknown;
}

/**
 * Resolved LAZILY, not at module evaluation: `fileURLToPath` throws on a non-`file:` `import.meta.url`, so
 * an eager constant would make merely IMPORTING this module a crash under a browser-environment test runner
 * (the same reasoning as `region-registry.ts`).
 */
function defaultConfigPath(): string {
  return fileURLToPath(new URL('../../../config/shelters.json', import.meta.url));
}

function requireNumber(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new DomainError('PARSE_ERROR', `config/shelters.json: ${what} must be a finite number`);
  }
  return v;
}

function parseShelter(raw: RawShelter): Shelter {
  // `note` is not read here on purpose: it is an operator comment in the file, and the Shelter entity has
  // no name field to carry it (finding F-406 — a label no column can keep true is worse than none).
  return makeShelter({
    id: asId<ShelterId>(String(raw.id)),
    geom: { type: 'Point', coordinates: [requireNumber(raw.lon, 'lon'), requireNumber(raw.lat, 'lat')] },
    capacity: requireNumber(raw.capacity, 'capacity'),
    ...(raw.occupancy !== undefined ? { occupancy: requireNumber(raw.occupancy, 'occupancy') } : {}),
    ...(typeof raw.status === 'string' ? { status: raw.status as ShelterStatus } : {}),
    ...(typeof raw.org === 'string' && raw.org !== '' ? { orgId: asId<OrgId>(raw.org) } : {}),
  });
}

function parseGroup(raw: RawGroup): ShelterRegionGroup {
  if (!Array.isArray(raw.shelters)) {
    throw new DomainError('PARSE_ERROR', 'config/shelters.json: each region needs a shelters[] array');
  }
  return {
    regionId: String(raw.region_id),
    shelters: (raw.shelters as RawShelter[]).map(parseShelter),
  };
}

/**
 * A shelter id is a PRIMARY KEY and the handle an operator types into an UPDATE. A duplicate would make the
 * seed silently insert one of two intended shelters and send every correction to whichever won, so it is
 * refused here — the JSON-Schema can constrain each entry but cannot see across region groups.
 */
function assertUniqueIds(regions: readonly ShelterRegionGroup[]): void {
  const seen = new Set<string>();
  for (const group of regions) {
    for (const s of group.shelters) {
      if (seen.has(String(s.id))) {
        throw new DomainError('PARSE_ERROR', `config/shelters.json: duplicate shelter id ${String(s.id)}`);
      }
      seen.add(String(s.id));
    }
  }
}

/** Parse an already-loaded registry object into typed domain shelters (pure — used by tests + the seed). */
export function parseShelterRegistry(raw: unknown): ShelterRegistry {
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { regions?: unknown }).regions)) {
    throw new DomainError('PARSE_ERROR', 'shelter registry must be { version, regions[] }');
  }
  const obj = raw as { version?: unknown; regions: RawGroup[] };
  const regions = obj.regions.map(parseGroup);
  assertUniqueIds(regions);
  return { version: Number(obj.version), regions };
}

/** Every configured shelter, flattened in registry order (what the seed inserts). */
export function allShelters(registry: ShelterRegistry): readonly Shelter[] {
  return registry.regions.flatMap((g) => g.shelters);
}

/** Load + parse config/shelters.json (default path). Returns a typed Result — never throws upstream. */
export function loadShelterRegistry(path?: string): Result<ShelterRegistry, DomainError> {
  try {
    return ok(parseShelterRegistry(JSON.parse(readFileSync(path ?? defaultConfigPath(), 'utf8'))));
  } catch (e) {
    return e instanceof DomainError
      ? err(e)
      : err(new DomainError('PARSE_ERROR', `failed to load shelter registry: ${String(e)}`));
  }
}
