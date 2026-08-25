// BEACON — NASA LANCE NRT flood anti-corruption layer (S2·Lane-A2; adapter-contract §4, NewsIntelPort
// P6, Art. XII). Maps one LANCE `MCDWD_L3_NRT` granule listing entry → a canonical NewsItem announcing
// that NASA's near-real-time OBSERVED flood-water product exists for a given 10°×10° tile and day. This
// is the ONLY place the raw LANCE listing shape exists (AGENTS.md §3). Lenient by directive: unknown
// fields ignored, malformed entries dropped AND counted.
//
// VERIFIED LIVE (2026-08-08, real curl with the project's EARTHDATA_TOKEN, HTTP 200, 945 KB, 2144
// entries — a compact real slice recorded verbatim into `__fixtures__/granules.json`):
//   GET https://nrt3.modaps.eosdis.nasa.gov/api/v2/content/details/allData/61/MCDWD_L3_NRT/Recent
//       ?fields=all&formats=json      Header: `Authorization: Bearer <EARTHDATA_TOKEN>`
//   → { "content": [ { name: "MCDWD_L3_NRT.A2026219.h05v04.061.hdf", downloadsLink, self, size, mtime,
//                      resourceType: "File", status: "Online" }, … ] }
//
// 🔴 WHY THIS IS A NewsItem AND NOT A FLOOD FOOTPRINT (binding — the single most important note here):
// the observed flood EXTENT lives INSIDE the HDF raster, and BEACON ships no raster decoder (zero new
// dependencies is a hard constraint). What is honestly knowable from this endpoint is ONLY: *NASA has
// published an observed-flood product for this tile, for this day, and here is the link*. So that is
// exactly what is emitted — an availability/freshness advisory. Emitting the TILE FOOTPRINT as a
// `FLOOD_REACH` HazardGeometry would paint a 10°-wide rectangle as an inundation area and feed it to
// exposure computation: the F-06/F-48 failure class, and a fabricated number downstream (Art. XII). The
// observed extent reaches the operator through the GIBS imagery overlay / vision layer instead.
//
// TILE GRID (derived, then verified — not guessed): the product's LAADS DAAC title is "NRT Combined
// Terra Aqua MODIS Daily L3 Global Water and Flood Map **Linear Lat Lon Grid** Day", i.e. a plain
// geographic grid, and the live listing spans exactly h00…h35 (36 columns × 10° = 360°) with v01…v14
// (⇒ 80°N…60°S, the product's published coverage). Hence: lonWest = -180 + h·10, latNorth = 90 - v·10.
import type { NewsItem } from '@/ports/intel.js';
import type { AntiCorruptionMapper } from '@/adapters/_shared/index.js';
import { makeAdapterError } from '@/adapters/_shared/index.js';

/** Degrees per MCDWD tile edge (see the TILE GRID note above — derived from the live listing + title). */
const TILE_DEG = 10;

/** One raw LANCE listing entry (unknown fields ignored — lenient by directive). */
export interface LanceGranule {
  readonly name?: string;
  readonly downloadsLink?: string;
  readonly self?: string;
  readonly size?: number;
  readonly status?: string;
}

/** One granule whose filename has been decoded into its tile + composite day (never re-derived later). */
export interface LanceTileGranule {
  readonly granule: LanceGranule;
  readonly h: number;
  readonly v: number;
  readonly dayIso: string; // YYYY-MM-DD (the composite day, UTC)
}

/** Lenient parse result: decoded granules + the count of entries dropped as unusable. */
export interface LanceParseResult {
  readonly granules: readonly LanceTileGranule[];
  readonly skipped: number;
}

// MCDWD_L3_NRT.A<YYYYDDD>.h<HH>v<VV>.<collection>.hdf — the published LANCE naming convention.
const NAME_RE = /^MCDWD_L3_(?:F\d+C?_)?NRT\.A(\d{4})(\d{3})\.h(\d{2})v(\d{2})\.\d+\.hdf$/;

/**
 * Parse a LANCE `content/details` listing, decoding each granule filename into its tile + composite day.
 * An entry whose name does not match the published convention, or that carries no download link, is
 * dropped AND counted — so "we saw 2144 entries and used 10" is always answerable.
 */
export function parseLanceGranules(text: string): LanceParseResult {
  const doc = JSON.parse(text) as { content?: readonly LanceGranule[] };
  const all = Array.isArray(doc.content) ? doc.content : [];
  const granules: LanceTileGranule[] = [];
  for (const granule of all) {
    const decoded = decode(granule);
    if (decoded !== undefined) granules.push(decoded);
  }
  return { granules, skipped: all.length - granules.length };
}

function decode(granule: LanceGranule): LanceTileGranule | undefined {
  const m = NAME_RE.exec(granule.name ?? '');
  if (m === null || (granule.downloadsLink ?? '') === '') return undefined;
  const dayIso = yearDayToIso(Number(m[1]), Number(m[2]));
  if (dayIso === undefined) return undefined;
  return { granule, h: Number(m[3]), v: Number(m[4]), dayIso };
}

/**
 * LANCE `A<YYYY><DDD>` (year + day-of-year) → `YYYY-MM-DD` (UTC). Computed with `Date.UTC(y, 0, ddd)`,
 * which is leap-year-correct by construction; an out-of-range day yields undefined rather than a shifted
 * date (a silently wrong observation date on a flood product would be worse than dropping the granule).
 */
export function yearDayToIso(year: number, dayOfYear: number): string | undefined {
  if (!Number.isInteger(year) || !Number.isInteger(dayOfYear) || dayOfYear < 1 || dayOfYear > 366) return undefined;
  const date = new Date(Date.UTC(year, 0, dayOfYear));
  if (date.getUTCFullYear() !== year) return undefined; // day 366 of a non-leap year
  return date.toISOString().slice(0, 10);
}

/** The tile's geographic bounds `[minLon, minLat, maxLon, maxLat]` (WGS-84) — see the TILE GRID note. */
export function tileBBox(h: number, v: number): readonly [number, number, number, number] {
  const west = -180 + h * TILE_DEG;
  const north = 90 - v * TILE_DEG;
  return [west, north - TILE_DEG, west + TILE_DEG, north];
}

/** True when a tile's 10°×10° cell overlaps the queried bbox (edge-touching counts as overlap). */
export function tileIntersects(h: number, v: number, bbox: readonly [number, number, number, number]): boolean {
  const [west, south, east, north] = tileBBox(h, v);
  return west <= bbox[2] && east >= bbox[0] && south <= bbox[3] && north >= bbox[1];
}

export const lanceMapper: AntiCorruptionMapper<LanceTileGranule, NewsItem> = {
  toCanonical(raw: LanceTileGranule): NewsItem {
    const url = raw.granule.downloadsLink ?? '';
    if (url === '') {
      // parseLanceGranules already filters these out; this is the last-resort typed guard at the ACL
      // boundary (never-silently-dropped doctrine).
      throw makeAdapterError('PARSE', `LANCE granule '${raw.granule.name ?? '?'}' has no download link`);
    }
    const tile = `h${pad(raw.h)}v${pad(raw.v)}`;
    return {
      title: `NASA LANCE NRT observed-flood product available — tile ${tile} (${raw.dayIso})`,
      url,
      // Day-granularity by construction: MCDWD is a DAILY composite, so the honest instant is the start
      // of its composite day in UTC — not a fabricated acquisition time.
      publishedAt: `${raw.dayIso}T00:00:00Z`,
      summary: summarize(raw, tile),
      sourceAuthority: 'OFFICIAL',
      credibility: 0.9,
    };
  },
};

function summarize(raw: LanceTileGranule, tile: string): string {
  const [west, south, east, north] = tileBBox(raw.h, raw.v);
  return (
    `MODIS/Aqua+Terra 250 m near-real-time flood-water composite covering ${west},${south} to ${east},${north} — ` +
    'availability and freshness only: the observed flood extent is inside the HDF raster and is NOT decoded ' +
    'here, so no flood geometry is claimed from this source (use the GIBS overlay / vision layer for the ' +
    `extent). Granule ${raw.granule.name ?? tile}; download requires an Earthdata Login token.`
  );
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
