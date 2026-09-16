// BEACON — FEMA ESF#6 Shelter System anti-corruption layer (WP A4; adapter-contract §4, Art. XI/XII/XVI).
// Maps one ArcGIS feature of FEMA's National Shelter System → a canonical domain `Shelter`. This is the
// ONLY module in which the raw ArcGIS/NSS shapes exist; no FEMA attribute name escapes above it
// (AGENTS.md §3). Geometry is produced deterministically here — never by the LLM.
//
// ── THE SOURCE (re-verified live from this machine, 2026-09-11, every line below fetched not assumed)
//   Service : https://gis.fema.gov/arcgis/rest/services/NSS/FEMA_NSS/MapServer?f=json  → HTTP/2 200
//   serviceDescription : "FEMA ESF#6 Shelter System (Formerly known as the FEMA National Shelter System)"
//   copyrightText      : "FEMA, Mass Care, American Red Cross"  ← attribute ALL THREE
//   Layers  : 0 Open Shelters · 1 Closed Shelters · 2 Full Shelters · 3 Alert Shelters · 4 Total
//             Population · 5 Shelter Locations · 6 Shelter Population Types · 7 Shelter Wheelchair …
//   Counts on 2026-09-11 (returnCountOnly, where=state='CA'): layer 0 = 1, layer 1 = 6,887, layer 2 = 0,
//             layer 3 = 1. A distinct-value query on layer 1 CA returns exactly one shelter_status_code:
//             'CLOSED'. Layer 2 is EMPTY nationally (0 records).
//   Keyless, CORS-open (access-control-allow-origin: *), maxRecordCount 4000 per layer.
//   Licence : a work of the US federal government — not subject to domestic copyright (17 U.S.C. §105).
//             The service's own copyrightText is the attribution string, and it names three parties.
//
// ⚠ OPERATIONAL NOTE FOR ANY FUTURE QUERY BUILDER: gis.fema.gov sits behind Cloudflare, and a `where`
// clause containing the token `IS NULL` is rejected by the WAF with an HTTP 403 HTML block page (measured
// 2026-09-11). Keep `where` trivial (`1=1`) and do all null handling HERE, in the ACL.
//
// ── WHICH LAYERS ARE CONSUMED, AND WHY THAT IS A HONESTY DECISION, NOT A PERFORMANCE ONE
// The domain enum is SHELTER_STATUSES = OPEN | FULL | CLOSED (src/domain/shelter.ts:9, mirroring the
// schema.sql CHECK). FEMA's layers 0/1/2 ARE those three states, so they map 1:1 and are consumed.
// Layer 3 "Alert Shelters" is NOT consumed: an alerted shelter is on standby — calling it OPEN would send
// evacuees to a building that is not receiving them, and calling it CLOSED would erase a real published
// state. There is no honest third option, so the layer is absent rather than smuggled in under a wrong
// status (the same call `hifld-acl.ts` documents for the ten lifeline layers it refuses).
//
// ── RESPONSIBLE DATA (rule 4 — BINDING). These layers also publish `org_poc_name`, `org_poc_phone`,
// `org_poc_after_hours_phone` and `org_poc_email`: NAMED-INDIVIDUAL contact details. They are never
// requested, never parsed, never stored and never logged. The live rung asks for an EXPLICIT field
// projection (SHELTER_OUT_FIELDS below) rather than `outFields=*` for exactly this reason, which is also
// why the recorded fixtures are PII-free — the projection was applied at recording time.
import type { OrgId, Shelter, ShelterId, ShelterStatus } from '@/domain/index.js';
import { asId, makeShelter } from '@/domain/index.js';
import type { AntiCorruptionMapper } from '@/adapters/_shared/index.js';
import { makeAdapterError } from '@/adapters/_shared/index.js';

/** One NSS layer BEACON consumes: its MapServer layer id and the status every feature in it carries. */
export interface FemaShelterLayer {
  readonly layerId: number;
  /** The `shelter_status_code` the layer is named for. Documentation + drift signal, NOT the mapping key. */
  readonly expectedStatus: ShelterStatus;
}

/**
 * Exactly the layers whose published state the domain can state honestly (rationale in the module header).
 * Open first so the actionable destinations lead the mapped output, then Full, then the long Closed tail.
 */
export const FEMA_SHELTER_LAYERS: readonly FemaShelterLayer[] = [
  { layerId: 0, expectedStatus: 'OPEN' },
  { layerId: 1, expectedStatus: 'CLOSED' },
  { layerId: 2, expectedStatus: 'FULL' },
];

/**
 * The EXPLICIT field projection the live rung requests. Not `outFields=*`: that would pull the four
 * `org_poc_*` named-individual contact fields into BEACON's process memory, logs and recorded fixtures,
 * which RESPONSIBLE_DATA rule 4 forbids. Every field here is one this ACL actually reads or records.
 */
export const SHELTER_OUT_FIELDS = [
  'shelter_id',
  'shelter_name',
  'address_1',
  'city',
  'county_parish',
  'state',
  'zip',
  'evacuation_capacity',
  'post_impact_capacity',
  'total_population',
  'general_population',
  'org_organization_name',
  'shelter_status_code',
  'facility_type',
  'latitude',
  'longitude',
].join(',');

/**
 * FEMA's placeholder for "capacity not counted". It is NOT a headcount, and treating it as one would put a
 * 99,999-person figure on a village church. EVIDENCE (live, 2026-09-11): 39 records nationally carry
 * `evacuation_capacity = 99999`, EVERY one of them also carries `post_impact_capacity = 0`, and the set
 * includes 'NCC Radio Group Station KXBX' (a radio station), 'Seventh-day Adventist Church' and
 * 'Middletown High School'. No building in that list holds 99,999 people; it is a data-entry sentinel.
 */
export const CAPACITY_SENTINEL = 99999;

/** The only `shelter_status_code` values the domain can state. Anything else is dropped, never guessed. */
const STATUS_BY_CODE: Readonly<Record<string, ShelterStatus>> = {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
  FULL: 'FULL',
};

/**
 * One raw NSS feature, flattened and PII-stripped. `capacity` and `occupancy` are the figures FEMA
 * PUBLISHED, verbatim — including `null` ("did not publish") and the 99999 sentinel. Normalisation is the
 * mapper's job, so the raw row never loses the distinction between "zero" and "not counted".
 */
export interface FemaShelterRaw {
  readonly shelterId: number;
  readonly name: string;
  readonly statusCode: string;
  readonly lon: number;
  readonly lat: number;
  readonly capacity: number | null;
  readonly occupancy: number | null;
  readonly org: string | null;
  readonly state: string | null;
}

/**
 * Parse output. Every rejected feature is DROPPED **and COUNTED** in the bucket that says WHY — a silent
 * drop would let a shrinking shelter list look like an honest one. The three inexpressible buckets are the
 * measurable size of the domain gap this WP reports (see PLAN-DELTA in the WP write-up).
 */
export interface FemaShelterParseResult {
  readonly rows: readonly FemaShelterRaw[];
  /** Structurally unusable: no id, or no coordinate pair — a shelter nobody could be sent to. */
  readonly skippedUnusable: number;
  /** A published `shelter_status_code` with no honest member in SHELTER_STATUSES (e.g. ALERT). */
  readonly skippedUnmappableStatus: number;
  /** Occupancy published, capacity NOT — the domain requires `occupancy <= capacity: number`. */
  readonly skippedUncountedButOccupied: number;
  /** Published occupancy exceeds published capacity — a real over-capacity state the domain forbids. */
  readonly skippedOverCapacity: number;
}

/**
 * Parse one layer's ArcGIS `f=json` response. Invalid JSON, an ArcGIS `{"error":…}` envelope, or a
 * Cloudflare HTML block page all yield an EMPTY result rather than a throw, so the redundancy ladder
 * degrades to cache/mock instead of dead-ending the COP (Art. XVI).
 */
export function parseFemaShelterLayer(text: string): FemaShelterParseResult {
  const doc = safeParse(text);
  const features = (doc as { features?: unknown } | undefined)?.features;
  if (!Array.isArray(features)) return empty();

  const rows: FemaShelterRaw[] = [];
  let unusable = 0;
  let unmappableStatus = 0;
  let uncountedButOccupied = 0;
  let overCapacity = 0;

  for (const feature of features) {
    const row = toRow(feature);
    if (row === undefined) {
      unusable += 1;
      continue;
    }
    switch (verdict(row)) {
      case 'KEEP':
        rows.push(row);
        break;
      case 'UNMAPPABLE_STATUS':
        unmappableStatus += 1;
        break;
      case 'UNCOUNTED_BUT_OCCUPIED':
        uncountedButOccupied += 1;
        break;
      case 'OVER_CAPACITY':
        overCapacity += 1;
        break;
    }
  }
  return {
    rows,
    skippedUnusable: unusable,
    skippedUnmappableStatus: unmappableStatus,
    skippedUncountedButOccupied: uncountedButOccupied,
    skippedOverCapacity: overCapacity,
  };
}

/**
 * `true` when FEMA published no usable capacity for this building — either the field is absent/null, or it
 * carries the {@link CAPACITY_SENTINEL} placeholder. A published `0` is NOT uncounted: it is a real
 * published zero (972 California records carry it), and it happens to hydrate to the same domain value.
 */
export function isUncounted(capacity: number | null): boolean {
  return capacity === null || capacity === CAPACITY_SENTINEL;
}

/** Why a parsed row is kept or dropped. Each rejection maps 1:1 to a counter in FemaShelterParseResult. */
type Verdict = 'KEEP' | 'UNMAPPABLE_STATUS' | 'UNCOUNTED_BUT_OCCUPIED' | 'OVER_CAPACITY';

/**
 * Decide whether the domain can hold what FEMA published for this shelter, WITHOUT changing any figure.
 *
 * The load-bearing case is UNCOUNTED_BUT_OCCUPIED. FEMA publishes people sheltering with no capacity
 * figure (7 of the 13 nationally-open shelters on 2026-09-11 did). `makeShelter` requires a numeric
 * capacity with `occupancy <= capacity`, so every encoding available to us lies: capacity 0 contradicts
 * the published headcount, capacity := occupancy invents a building size and silently implies FULL, and
 * occupancy 0 erases real people. There is no honest representation, so the row is dropped and counted
 * rather than fabricated. With occupancy 0 or unpublished there IS an honest reading — "nobody has counted
 * this building" — and the mapper takes it.
 *
 * OVER_CAPACITY is a genuine published over-capacity shelter. The domain invariant (and the schema CHECK
 * it mirrors) forbids occupancy > capacity, and clamping either figure would rewrite what FEMA published.
 */
function verdict(row: FemaShelterRaw): Verdict {
  if (STATUS_BY_CODE[row.statusCode] === undefined) return 'UNMAPPABLE_STATUS';
  const occupancy = row.occupancy ?? 0;
  if (isUncounted(row.capacity)) return occupancy > 0 ? 'UNCOUNTED_BUT_OCCUPIED' : 'KEEP';
  return occupancy > (row.capacity ?? 0) ? 'OVER_CAPACITY' : 'KEEP';
}

export const femaShelterMapper: AntiCorruptionMapper<FemaShelterRaw, Shelter> = {
  // No MapContext parameter: unlike InfrastructureNode, the domain `Shelter` carries no `sourceId` field —
  // its provenance lives on the CanonicalRecord the engine pairs with it, so the context is genuinely unused.
  toCanonical(raw: FemaShelterRaw): Shelter {
    const status = STATUS_BY_CODE[raw.statusCode];
    if (status === undefined) {
      // Defensive: parseFemaShelterLayer filters these first, but the ACL boundary itself must never
      // invent a status for a code FEMA published and the domain cannot state.
      throw makeAdapterError(
        'PARSE',
        `FEMA shelter '${raw.shelterId}' carries shelter_status_code '${raw.statusCode}', which has no honest domain status`,
      );
    }
    if (!Number.isFinite(raw.lon) || !Number.isFinite(raw.lat)) {
      throw makeAdapterError('PARSE', `FEMA shelter '${raw.shelterId}' has invalid coordinates`);
    }
    // UNCOUNTED → 0. This is the codebase's existing, documented meaning for an absent capacity
    // (src/adapters/persistence/mappers.ts shelterMapper.fromRow: "NULL means 'nobody has counted this
    // building', and it hydrates to 0 — which makes the shelter INELIGIBLE for matching rather than a
    // destination with an invented headroom"). It is a refusal to guess, not a claim of zero beds.
    const capacity = isUncounted(raw.capacity) ? 0 : (raw.capacity ?? 0);
    const org = raw.org?.trim();
    return makeShelter({
      id: asId<ShelterId>(`shelters-fema:${raw.shelterId}`),
      geom: { type: 'Point', coordinates: [raw.lon, raw.lat] },
      capacity,
      // FEMA's `total_population`. Unpublished hydrates to 0, the schema default and the only "no count"
      // the NOT NULL occupancy column can hold — never an estimate.
      occupancy: raw.occupancy ?? 0,
      // The PUBLISHED status, carried through unchanged. A CLOSED shelter renders CLOSED: it is never
      // promoted to OPEN, and closed shelters are never filtered out to make the map look busier.
      status,
      // The operating organisation FEMA published (e.g. 'THREE RIVERS CHAPTER'). Absent stays ABSENT —
      // no 'Unknown' placeholder, which would read as an agency name downstream.
      ...(org !== undefined && org !== '' ? { orgId: asId<OrgId>(org) } : {}),
    });
  },
};

function empty(): FemaShelterParseResult {
  return {
    rows: [],
    skippedUnusable: 0,
    skippedUnmappableStatus: 0,
    skippedUncountedButOccupied: 0,
    skippedOverCapacity: 0,
  };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * A feature is usable when it has an integer `shelter_id` and a coordinate pair. The ArcGIS `geometry`
 * (requested in outSR 4326) is preferred over the `latitude`/`longitude` attributes because it is the
 * geometry the service actually placed the feature at; the attributes are the fallback for a response
 * fetched with `returnGeometry=false`.
 */
function toRow(feature: unknown): FemaShelterRaw | undefined {
  if (typeof feature !== 'object' || feature === null) return undefined;
  const f = feature as { attributes?: unknown; geometry?: { x?: unknown; y?: unknown } };
  if (typeof f.attributes !== 'object' || f.attributes === null) return undefined;
  const a = f.attributes as Record<string, unknown>;

  const shelterId = num(a.shelter_id);
  if (shelterId === undefined) return undefined;
  const point = position(f.geometry, a);
  if (point === undefined) return undefined;
  const [lon, lat] = point;

  return { shelterId, lon, lat, ...published(a) };
}

/**
 * The published attributes, carried across verbatim. `capacity`/`occupancy` keep `null` for "FEMA did not
 * publish this" — the raw row must never lose the distinction between a published zero and no count at all.
 * Only the fields in SHELTER_OUT_FIELDS are read; the `org_poc_*` PII fields are never touched.
 */
function published(a: Record<string, unknown>): Omit<FemaShelterRaw, 'shelterId' | 'lon' | 'lat'> {
  return {
    name: str(a.shelter_name) ?? '',
    statusCode: (str(a.shelter_status_code) ?? '').toUpperCase(),
    capacity: intOrNull(a.evacuation_capacity),
    occupancy: intOrNull(a.total_population),
    org: str(a.org_organization_name) ?? null,
    state: str(a.state) ?? null,
  };
}

/**
 * The shelter's [lon, lat]. The ArcGIS `geometry` (requested in outSR 4326) is preferred over the
 * `latitude`/`longitude` attributes because it is where the service actually placed the feature; the
 * attributes are the fallback for a response fetched with `returnGeometry=false`.
 */
function position(
  geometry: { x?: unknown; y?: unknown } | undefined,
  attributes: Record<string, unknown>,
): readonly [number, number] | undefined {
  const lon = num(geometry?.x) ?? num(attributes.longitude);
  const lat = num(geometry?.y) ?? num(attributes.latitude);
  return lon === undefined || lat === undefined ? undefined : [lon, lat];
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

/** A published integer, or `null` for "FEMA did not publish this". Never coerces absence into a number. */
function intOrNull(v: unknown): number | null {
  const n = num(v);
  return n === undefined ? null : Math.trunc(n);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}
