// BEACON — HDX (UN OCHA Humanitarian Data Exchange) population anti-corruption layer (S2·Lane A3;
// adapter-contract §4, PopulationPort P12, Art. XII). Maps one row of an HDX COD-PS ("Common Operational
// Dataset — Population Statistics") admin-level CSV → a canonical PopulationEstimate. This is the ONLY
// place the raw HDX/COD column names exist; none of them escapes above this module (AGENTS.md §3).
//
// VERIFIED LIVE (2026-08-08, real GETs against data.humdata.org):
//   1. Discovery — `GET /api/3/action/package_search?q=population&fq=res_format:CSV+AND+groups:rou&rows=5`
//      → HTTP 200, CKAN 2.x envelope, 27 matches; dataset `cod-ps-rou` "Romania - Subnational Population
//      Statistics", licence **CC BY-IGO** ("Creative Commons Attribution for Intergovernmental
//      Organisations"), source Eurostat, publisher UNFPA.
//   2. Resource — `GET /dataset/819ed0e9…/resource/91966f08…/download/rou_admpop_adm1_2022_v01.csv`
//      → HTTP 200, 4114 bytes, UTF-8 **with BOM**, recorded VERBATIM into __fixtures__/rou-admpop-adm1.csv.
//      Header: `year,ISO3,ADM0_EN,ADM0_PCODE,ADM1_RO,ADM1_PCODE,F_TL,M_TL,T_TL,F_00_04,…,T_100Plus`
//      (70 columns: 3 totals + 67 sex/age bands). 8 data rows = Romania's 8 NUTS-2 development regions.
//      Sanity check on the recorded numbers: ΣT_TL = 18,983,507 ≈ Romania's 2021 census population (19.05 M).
//   Only `ADM1_PCODE` (region identity) and `T_TL` (total population) are consumed; the 67 age/sex bands are
//   deliberately IGNORED — BEACON's PopulationEstimate is a single exposure count, and silently folding a
//   demographic breakdown into it would be inventing a figure nobody asked for (Art. XII).
//
// LENIENT by contract (S2 recipe): unknown/extra columns are ignored (COD-PS gains columns between vintages),
// and a row that is structurally unusable — wrong cell count, unknown/absent P-code, non-numeric total — is
// DROPPED **and COUNTED** (`HdxPopParseResult.skipped`) rather than thrown, so one bad line can never blank
// the whole exposure base (Art. XVI). Anything that reaches the mapper unmappable raises a typed PARSE.
//
// HONEST LIMITATION — GEOMETRY: COD-PS CSVs are TABULAR. They carry a P-code, never a polygon or a centroid
// (the matching boundaries live in a separate COD-AB dataset that is shapefile/geoservice-only). The
// PopulationPort DTO requires an `area: BBox`, so this ACL uses a BUILTIN, NO-NETWORK P-code → approximate
// centroid table for exactly the 8 Romanian NUTS-2 regions in the recorded resource, and represents each
// region as a deterministic box around that centroid. This is NOT a geocoder and NOT the region's true
// boundary — it exists solely so a bbox query can decide WHICH regions it overlaps. A P-code absent from the
// table is treated as unplaceable (skipped at parse, PARSE at the mapper), never silently guessed at.
//
// HONEST LIMITATION — VINTAGE: this is a 2022 official statistical vintage, not a live figure. It is a
// FALLBACK/cross-check beside `worldpop` (modeled grids) and `census` (US ACS), never a real-time signal.
import type { BBox } from '@/domain/index.js';
import type { PopulationEstimate } from '@/ports/infrastructure-sources.js';
import type { AntiCorruptionMapper } from '@/adapters/_shared/index.js';
import { makeAdapterError } from '@/adapters/_shared/index.js';

/** One parsed + validated HDX COD-PS row: admin P-code identity + the total population column. */
export interface HdxPopRow {
  readonly pcode: string; // ADM1_PCODE, e.g. 'RO006'
  readonly name: string; // ADM1_RO (local-language admin name) — kept for PARSE messages
  readonly total: number; // T_TL — total population, both sexes, all ages
}

export interface HdxPopParseResult {
  readonly rows: readonly HdxPopRow[];
  /** Rows dropped for a malformed/unplaceable shape — DROPPED and COUNTED, never silently discarded. */
  readonly skipped: number;
}

/**
 * BUILTIN, NO-NETWORK P-code → approximate centroid table (WGS-84 [lon, lat]) for the 8 Romanian NUTS-2
 * development regions published by `cod-ps-rou`. Approximate regional centres, rounded to 2 dp — a
 * placement aid, NOT authoritative boundaries (module header). Extend this table (never a live geocoder
 * call) to cover another country's COD-PS resource.
 */
export const RO_ADM1_CENTROIDS: Readonly<Record<string, readonly [lon: number, lat: number]>> = {
  RO001: [26.9, 47.0], // Nord-Est
  RO002: [27.8, 45.2], // Sud-Est
  RO003: [25.6, 44.6], // Sud-Muntenia
  RO004: [23.6, 44.5], // Sud-Vest Oltenia
  RO005: [22.0, 45.9], // Vest
  RO006: [23.3, 47.0], // Nord-Vest
  RO007: [24.9, 46.2], // Centru
  RO008: [26.1, 44.45], // București-Ilfov
};

/**
 * Half-width (degrees) of the deterministic box drawn around each region centroid. NUTS-2 development
 * regions span roughly 150–250 km, so 1.0° (~110 km half-width) is the honest order of magnitude — coarse
 * BY DESIGN, and never presented as the region's real outline.
 */
const CENTROID_BOX_DEG = 1.0;

/** Columns this ACL consumes. Everything else in the 70-column COD-PS header is ignored by design. */
const COL_PCODE = 'ADM1_PCODE';
const COL_NAME = 'ADM1_RO';
const COL_TOTAL = 'T_TL';

/**
 * Parse an HDX COD-PS admin CSV into raw rows. HDX serves these files UTF-8 with a BOM and with unquoted
 * cells (verified on the recorded resource), so a deterministic split is sufficient and needs no new
 * dependency — but a row whose cell count does not match the header is skipped rather than mis-keyed.
 * An empty/headerless body yields an empty result rather than a throw (the ladder degrades, never dead-ends).
 */
export function parseHdxPopCsv(text: string): HdxPopParseResult {
  const lines = text
    .replace(/^\uFEFF/, '') // strip the UTF-8 BOM HDX prepends
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const headerLine = lines[0];
  if (headerLine === undefined) return { rows: [], skipped: 0 };
  const header = headerLine.split(',').map((h) => h.trim());
  const rows: HdxPopRow[] = [];
  let skipped = 0;
  for (const line of lines.slice(1)) {
    const row = toRow(header, line.split(','));
    if (row === undefined) skipped += 1;
    else rows.push(row);
  }
  return { rows, skipped };
}

function toRow(header: readonly string[], cells: readonly string[]): HdxPopRow | undefined {
  if (cells.length !== header.length) return undefined; // mis-shaped line → never mis-key it into columns
  const pcode = cell(header, cells, COL_PCODE);
  const total = Number(cell(header, cells, COL_TOTAL));
  // An unknown P-code is unplaceable (no centroid ⇒ no `area`), so it is skipped HERE rather than smuggled
  // to the mapper — an intentional, documented scope decision, not data corruption.
  if (pcode === '' || RO_ADM1_CENTROIDS[pcode] === undefined) return undefined;
  if (!Number.isFinite(total) || total < 0) return undefined;
  return { pcode, name: cell(header, cells, COL_NAME), total };
}

function cell(header: readonly string[], cells: readonly string[], column: string): string {
  const idx = header.indexOf(column);
  return idx < 0 ? '' : (cells[idx] ?? '').trim();
}

export const hdxPopMapper: AntiCorruptionMapper<HdxPopRow, PopulationEstimate> = {
  // No sourceId/id to stamp: PopulationEstimate (the port DTO) carries neither — see eagle-i-acl.ts for the
  // same shape. `ctx` is intentionally omitted from this implementation's arity.
  toCanonical(raw: HdxPopRow): PopulationEstimate {
    const centroid = RO_ADM1_CENTROIDS[raw.pcode];
    if (centroid === undefined) {
      // Defensive: parseHdxPopCsv already filters these, but the ACL boundary itself must never accept a
      // row it cannot place (never-silently-dropped doctrine).
      throw makeAdapterError('PARSE', `HDX COD-PS row '${raw.name}' has no builtin centroid for P-code '${raw.pcode}'`);
    }
    return { area: centroidBox(centroid), count: raw.total };
  },
};

function centroidBox([lon, lat]: readonly [number, number]): BBox {
  return [lon - CENTROID_BOX_DEG, lat - CENTROID_BOX_DEG, lon + CENTROID_BOX_DEG, lat + CENTROID_BOX_DEG];
}

/** Centre point of a BBox — recovers a region's centroid from its stored `area`. */
export function bboxCenter(bbox: BBox): readonly [lon: number, lat: number] {
  return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
}

/** Point-in-bbox membership test (inclusive bounds), used to scope region sub-estimates to a query bbox. */
export function pointInBBox(point: readonly [lon: number, lat: number], bbox: BBox): boolean {
  const [lon, lat] = point;
  return lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}
