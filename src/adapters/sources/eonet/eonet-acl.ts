// BEACON — NASA EONET anti-corruption layer (S2·Lane-A2; adapter-contract §4, F1/Art. XII). Maps one
// EONET v3 curated natural-event object → a canonical HazardGeometry (event CENTROID). This is the ONLY
// place the raw EONET JSON shape exists; no EONET field name escapes above this module (AGENTS.md §3).
// Geometry/instants are produced deterministically here — never by the LLM.
//
// VERIFIED LIVE (2026-08-08, real curl — recorded verbatim into `__fixtures__/events.json`):
//   GET https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=20  → HTTP 200, keyless, JSON
//   { title, description, link, events: [ { id, title, link, closed, categories:[{id,title}],
//     sources:[{id,url}], geometry:[{ date, type, coordinates, magnitudeValue?, magnitudeUnit? }] } ] }
//   Observed at probe: 19 `wildfires` + 1 `severeStorms`, and the `floods` category returned ZERO events
//   for both `status=open` and `days=365`. That sparsity is REAL and is stated rather than papered over:
//   EONET's practical live signal for BEACON is wildfires; the flood branch below is implemented and
//   unit-tested but rarely exercised upstream.
//
// SCOPE (mirrors gdacs-acl.ts exactly — BEACON covers wildfire + flood): only `wildfires` and `floods`
// events are kept. Everything else (severeStorms, volcanoes, seaLakeIce, …) is DROPPED **and COUNTED**
// at parse time — lenient by directive, never silently unaccounted for.
//
// HONEST LIMITATION (why this is an EVENT source, not a footprint source): an EONET event's geometry is
// a curated CENTROID point contributed by an upstream reporter (IRWIN/JTWC/…), not an authoritative
// perimeter or flood reach. It is corroborating context — cited, never drawn as a hazard extent (the
// same advisory-vs-footprint distinction as findings F-06/F-48; `live-seed.ts` keeps it out of the map's
// hazards slice via HAZARD_FOOTPRINT_SOURCES).
import type { HazardGeometry, HazardGeometryId, IncidentId, SourceId } from '@/domain/index.js';
import { asId, makeHazardGeometry } from '@/domain/index.js';
import type { AntiCorruptionMapper, MapContext } from '@/adapters/_shared/index.js';
import { makeAdapterError } from '@/adapters/_shared/index.js';

// EONET events are not yet correlated to a BEACON incident; a stable sentinel keeps provenance intact
// without inventing a fake incident id (same convention as firms/gdacs).
const UNASSIGNED_INCIDENT = asId<IncidentId>('eonet-unassigned');

/** In-scope EONET category id → domain HazardGeometry.kind. Anything else is dropped + counted. */
const KIND_BY_CATEGORY: Readonly<Record<string, 'HOTSPOT' | 'FLOOD_REACH'>> = {
  wildfires: 'HOTSPOT',
  floods: 'FLOOD_REACH',
};

/** One EONET category tag (`{ id, title }`), carried verbatim. */
export interface EonetCategory {
  readonly id?: string;
  readonly title?: string;
}

/** One EONET geometry sample: an instant + a GeoJSON-ish position (Point) or ring set (Polygon). */
export interface EonetGeometry {
  readonly date?: string;
  readonly type?: string;
  readonly coordinates?: unknown;
  readonly magnitudeValue?: number | null;
  readonly magnitudeUnit?: string | null;
}

/** One raw EONET event (unknown fields ignored — lenient by directive). */
export interface EonetEvent {
  readonly id?: string;
  readonly title?: string;
  readonly link?: string;
  readonly closed?: string | null;
  readonly categories?: readonly EonetCategory[];
  readonly geometry?: readonly EonetGeometry[];
}

/** Lenient parse result: in-scope events + the count of events dropped as out-of-scope/unusable. */
export interface EonetParseResult {
  readonly events: readonly EonetEvent[];
  readonly skipped: number;
}

/**
 * Parse an EONET v3 `/events` response, keeping ONLY in-scope (wildfire/flood) events that carry a usable
 * id and at least one geometry sample. Every other event is dropped AND counted — the caller can report
 * how much of the feed it declined, so "we saw 20 events and used 5" is always answerable.
 */
export function parseEonetEvents(text: string): EonetParseResult {
  const doc = JSON.parse(text) as { events?: readonly EonetEvent[] };
  const all = Array.isArray(doc.events) ? doc.events : [];
  const events = all.filter(isUsable);
  return { events, skipped: all.length - events.length };
}

function isUsable(event: EonetEvent): boolean {
  return (
    categoryKind(event) !== undefined &&
    typeof event.id === 'string' &&
    event.id !== '' &&
    latestGeometry(event) !== undefined
  );
}

/** The event's first in-scope category → domain kind (undefined when no category is in scope). */
function categoryKind(event: EonetEvent): 'HOTSPOT' | 'FLOOD_REACH' | undefined {
  for (const category of event.categories ?? []) {
    const kind = KIND_BY_CATEGORY[category.id ?? ''];
    if (kind !== undefined) return kind;
  }
  return undefined;
}

/**
 * The NEWEST geometry sample (EONET appends samples over an event's life — a storm track has many; a
 * wildfire usually one). Newest = the honest "where is it now" for a live COP. Samples with an
 * unparseable date sort last rather than crashing the batch (lenient).
 */
export function latestGeometry(event: EonetEvent): EonetGeometry | undefined {
  let best: EonetGeometry | undefined;
  let bestT = Number.NEGATIVE_INFINITY;
  for (const g of event.geometry ?? []) {
    if (position(g) === undefined) continue;
    const t = Date.parse(g.date ?? '');
    const rank = Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
    if (best === undefined || rank > bestT) {
      best = g;
      bestT = rank;
    }
  }
  return best;
}

/**
 * A representative [lon, lat] for one geometry sample. EONET serves `Point` for most events and
 * `Polygon` for a few (ice/area events); for a Polygon the honest representative location is the centre
 * of its own ring extent — the COP marks EONET events as points (coarse-feed limitation, header note),
 * so no polygon is ever promoted to a hazard extent here.
 */
export function position(geom: EonetGeometry | undefined): readonly [number, number] | undefined {
  if (geom === undefined) return undefined;
  if (geom.type === 'Point') return asPosition(geom.coordinates);
  if (geom.type === 'Polygon') return ringCentre(geom.coordinates);
  return undefined;
}

function asPosition(coords: unknown): readonly [number, number] | undefined {
  if (!Array.isArray(coords) || coords.length < 2) return undefined;
  const [lon, lat] = coords;
  return isFiniteNum(lon) && isFiniteNum(lat) ? [lon, lat] : undefined;
}

/** Centre of a Polygon's OUTER ring extent (`coordinates[0]` per GeoJSON), or undefined if unusable. */
function ringCentre(coords: unknown): readonly [number, number] | undefined {
  if (!Array.isArray(coords)) return undefined;
  const ring = coords[0];
  if (!Array.isArray(ring) || ring.length === 0) return undefined;
  const points = ring
    .map(asPosition)
    .filter((p): p is readonly [number, number] => p !== undefined);
  if (points.length === 0) return undefined;
  const lons = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  return [(Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export const eonetMapper: AntiCorruptionMapper<EonetEvent, HazardGeometry> = {
  toCanonical(raw: EonetEvent, ctx: MapContext): HazardGeometry {
    const kind = categoryKind(raw);
    const geom = latestGeometry(raw);
    const point = position(geom);
    if (kind === undefined || point === undefined) {
      // parseEonetEvents already filters these out; this is the last-resort typed guard at the ACL
      // boundary (never-silently-dropped doctrine — a shape we cannot map raises PARSE, it never maps
      // to a plausible-looking invention).
      throw makeAdapterError(
        'PARSE',
        `EONET event '${raw.id ?? '?'}' has no in-scope category or usable geometry`,
      );
    }
    const base = {
      id: asId<HazardGeometryId>(`eonet:${raw.id}`),
      incidentId: UNASSIGNED_INCIDENT,
      sourceId: asId<SourceId>(ctx.sourceRecordId),
      kind,
      geometry: { type: 'Point' as const, coordinates: point },
      observedAt: observedAt(geom, ctx.fetchedAt),
    };
    // `magnitudeValue` is the reporter's own figure (acres / kts / …) carried VERBATIM as intensity —
    // never rescaled, never unit-converted, and omitted entirely when absent (Art. XII: no guessed number).
    const magnitude = geom?.magnitudeValue;
    return makeHazardGeometry(isFiniteNum(magnitude) ? { ...base, intensity: magnitude } : base);
  },
};

/** The sample's own instant, or the fetch instant when EONET omitted/garbled it (never fabricated past). */
export function observedAt(geom: EonetGeometry | undefined, fallback: string): string {
  const date = geom?.date ?? '';
  return date !== '' && !Number.isNaN(Date.parse(date)) ? date : fallback;
}
