// BEACON — the POPULATION GRID artifact: format, fail-fast parser, integrity verification, and the
// grid→cells adapter the zonal-sum engine consumes (MW-D/D1.2; ADR-035 §1 "Grid format"; finding F-27).
//
// WHY A QUANTIZED INTEGER GRID AND NOT A GeoTIFF (ADR-035 §1 + "Alternatives considered"). F-27 verified
// that no raster/tile artifact exists anywhere in the repo and no raster reader is a dependency. Adding one
// would cost bundle budget (NFR-F2), a licence review and a native-dependency risk in the air-gapped image —
// for a job that is a weighted SUM OVER CELLS. A quantized integer grid in JSON is inspectable, diffable,
// dependency-free, and reviewable as data. ⛔ No new dependency is introduced by this module.
//
// WHY THE COUNTS ARE INTEGERS IN `quantumPersons` UNITS. A float grid diffs badly, hashes fragilely and
// implies sub-person precision that a modelled population product does not have. Counts are stored as
// non-negative integers and multiplied by `quantumPersons` on read, so the file is exact, byte-stable and
// small, and the quantum is the artifact's own honest statement of its resolution in PEOPLE.
//
// INTEGRITY IS FAIL-CLOSED (master plan §5.8; ADR-035 V4). A shipped grid is a build-time artifact and
// therefore a supply-chain surface: `verifyPopulationGridIntegrity` recomputes a digest over the EXACT bytes
// `canonicalGridBytes` defines and refuses the grid on any mismatch. The digest function is INJECTED, so this
// module stays pure (no `node:crypto`, no I/O, no clock) and the loader that owns the filesystem owns the
// hashing primitive too.
//
// AGGREGATE-ONLY (Art. XIV). A cell is an area and a count. There is no identifier, no address, no household
// and no sub-cell precision in the format — and none can be added without changing this file and its schema.
import type { BBox } from '@/domain/value-objects/geo.js';
import type { Result } from '@/domain/shared/result.js';
import { ok, err } from '@/domain/shared/result.js';
import { DomainError } from '@/domain/errors.js';
import type { PopulationCell } from './zonal-sum.js';

/** What the grid IS, so a figure derived from it can never be read as more than the product allows. */
export interface PopulationGridProvenance {
  /** The upstream population product, verbatim (e.g. 'WorldPop wpgppop'). */
  readonly product: string;
  /** The product's vintage — years-old modelled RESIDENTIAL population, not present population. */
  readonly vintage: string;
  /** The product's native resolution, in the product's own words (e.g. '~100 m'). */
  readonly resolutionLabel: string;
  readonly licence: string;
  /**
   * How the product's values became THESE cells (e.g. 'native product cells, area-summed to the grid cell').
   * Load-bearing: a grid built by spreading one area total uniformly carries no cell-level information and
   * must say so here, because the arithmetic downstream is identical either way.
   */
  readonly disaggregation: string;
  /** The one sentence a reader must see with any figure from this grid. */
  readonly limitation: string;
}

/**
 * A shipped population grid: a regular lon/lat lattice of aggregate counts over `bbox`.
 *
 * Cells are ROW-MAJOR from the SOUTH-WEST corner: index `r * cols + c` covers
 * `[minLon + c*cellSizeDeg, minLat + r*cellSizeDeg, minLon + (c+1)*cellSizeDeg, minLat + (r+1)*cellSizeDeg]`.
 * That ordering is part of the format (and of the hash), which is what makes a zonal sum over it
 * reproducible byte-for-byte across runs and machines.
 */
export interface PopulationGrid {
  readonly version: 1;
  /** Stable artifact id, used in the manifest and reported as the figure's population source. */
  readonly id: string;
  readonly bbox: BBox;
  /** Cell edge length in degrees (square in degree space; NOT square in metres — see `limitation`). */
  readonly cellSizeDeg: number;
  readonly cols: number;
  readonly rows: number;
  /** People per stored integer unit — `counts[i] * quantumPersons` is the cell's modelled population. */
  readonly quantumPersons: number;
  /** Row-major, south-west origin, length exactly `cols * rows`, every entry a non-negative integer. */
  readonly counts: readonly number[];
  readonly provenance: PopulationGridProvenance;
}

function fail<T>(message: string): Result<T, DomainError> {
  return err(new DomainError('PARSE_ERROR', `Invalid population grid: ${message}`));
}

interface RawGrid {
  readonly version?: unknown;
  readonly id?: unknown;
  readonly bbox?: unknown;
  readonly cellSizeDeg?: unknown;
  readonly cols?: unknown;
  readonly rows?: unknown;
  readonly quantumPersons?: unknown;
  readonly counts?: unknown;
  readonly provenance?: Readonly<Record<string, unknown>>;
}

const PROVENANCE_KEYS = ['product', 'vintage', 'resolutionLabel', 'licence', 'disaggregation', 'limitation'] as const;

function parseProvenance(raw: Readonly<Record<string, unknown>> | undefined): Result<PopulationGridProvenance, DomainError> {
  if (typeof raw !== 'object' || raw === null) return fail('provenance must be an object');
  const out: Record<string, string> = {};
  for (const key of PROVENANCE_KEYS) {
    const v = raw[key];
    if (typeof v !== 'string' || v.trim().length === 0) return fail(`provenance.${key} must be a non-empty string`);
    out[key] = v;
  }
  return ok(out as unknown as PopulationGridProvenance);
}

function parseBbox(raw: unknown): Result<BBox, DomainError> {
  if (!Array.isArray(raw) || raw.length !== 4 || raw.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
    return fail('bbox must be four finite numbers [minLon,minLat,maxLon,maxLat]');
  }
  const b = raw as [number, number, number, number];
  if (b[0] >= b[2] || b[1] >= b[3]) return fail(`bbox must have positive extent, got [${b.join(',')}]`);
  return ok(b);
}

function positiveInt(v: unknown, what: string): Result<number, DomainError> {
  if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) return fail(`${what} must be a positive integer`);
  return ok(v);
}

function positiveNumber(v: unknown, what: string): Result<number, DomainError> {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return fail(`${what} must be a positive finite number`);
  return ok(v);
}

function nonEmptyText(v: unknown, what: string): Result<string, DomainError> {
  if (typeof v !== 'string' || v.trim().length === 0) return fail(`${what} must be a non-empty string`);
  return ok(v);
}

/** Every count a non-negative integer of exactly `cols*rows` length — the quantization contract. */
function parseCounts(raw: unknown, expected: number): Result<readonly number[], DomainError> {
  if (!Array.isArray(raw)) return fail('counts must be an array');
  if (raw.length !== expected) return fail(`counts must have cols*rows = ${expected} entries, got ${raw.length}`);
  for (const [i, n] of raw.entries()) {
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
      return fail(`counts[${i}] must be a non-negative integer (quantized), got ${String(n)}`);
    }
  }
  return ok(raw as readonly number[]);
}

/**
 * Parse + validate a population-grid artifact. Every violation is a typed error, never a partial grid: a
 * half-valid grid is worse than none, because every figure it produces looks equally authoritative.
 *
 * The lattice is checked for CONSISTENCY, not just shape — `cols`/`rows` must reproduce `bbox` from
 * `cellSizeDeg` within a tolerance far below one cell, so a grid whose header disagrees with its own extent
 * is rejected rather than silently mis-georeferencing every count in it.
 */
export function parsePopulationGrid(raw: unknown): Result<PopulationGrid, DomainError> {
  if (typeof raw !== 'object' || raw === null) return fail('the artifact must be a JSON object');
  const g = raw as RawGrid;
  const header = parseHeader(g);
  if (!header.ok) return header;
  const { bbox, cellSizeDeg, cols, rows, quantumPersons, id } = header.value;
  const counts = parseCounts(g.counts, cols * rows);
  if (!counts.ok) return counts;
  const prov = parseProvenance(g.provenance);
  if (!prov.ok) return prov;
  const lattice = latticeProblem(bbox, cellSizeDeg, cols, rows);
  if (lattice !== null) return fail(lattice);
  return { ok: true, value: { version: 1, id, bbox, cellSizeDeg, cols, rows, quantumPersons, counts: counts.value, provenance: prov.value } };
}

interface GridHeader {
  readonly id: string;
  readonly bbox: BBox;
  readonly cellSizeDeg: number;
  readonly cols: number;
  readonly rows: number;
  readonly quantumPersons: number;
}

/** The scalar header fields, validated together so `parsePopulationGrid` stays under the complexity ceiling. */
function parseHeader(g: RawGrid): Result<GridHeader, DomainError> {
  if (g.version !== 1) return fail(`version must be 1, got ${String(g.version)}`);
  const id = nonEmptyText(g.id, 'id');
  if (!id.ok) return id;
  const bbox = parseBbox(g.bbox);
  if (!bbox.ok) return bbox;
  const cellSizeDeg = positiveNumber(g.cellSizeDeg, 'cellSizeDeg (degrees)');
  if (!cellSizeDeg.ok) return cellSizeDeg;
  const cols = positiveInt(g.cols, 'cols');
  if (!cols.ok) return cols;
  const rows = positiveInt(g.rows, 'rows');
  if (!rows.ok) return rows;
  const quantumPersons = positiveNumber(g.quantumPersons, 'quantumPersons (people per stored unit)');
  if (!quantumPersons.ok) return quantumPersons;
  return ok({
    id: id.value,
    bbox: bbox.value,
    cellSizeDeg: cellSizeDeg.value,
    cols: cols.value,
    rows: rows.value,
    quantumPersons: quantumPersons.value,
  });
}

// One thousandth of a cell — far tighter than any georeferencing error that matters, loose enough for the
// float residue of `cols * cellSizeDeg`. NOT a coordinate rounding: nothing here rewrites a vertex (F-98).
const LATTICE_TOLERANCE = 1e-3;

function latticeProblem(bbox: BBox, cellSizeDeg: number, cols: number, rows: number): string | null {
  const spanX = (bbox[2] - bbox[0]) / cellSizeDeg;
  const spanY = (bbox[3] - bbox[1]) / cellSizeDeg;
  if (Math.abs(spanX - cols) > LATTICE_TOLERANCE) {
    return `cols (${cols}) disagrees with bbox width / cellSizeDeg (${spanX})`;
  }
  if (Math.abs(spanY - rows) > LATTICE_TOLERANCE) {
    return `rows (${rows}) disagrees with bbox height / cellSizeDeg (${spanY})`;
  }
  return null;
}

/**
 * The grid as aggregate `PopulationCell`s, in row-major order — the SAME input type a served
 * `PopulationEstimate` becomes, so the shipped-grid rung and the served-bbox rung share one engine.
 *
 * Zero-count cells are dropped: they cannot change a sum, and skipping them keeps the clip work
 * proportional to the populated area rather than to the bounding box.
 *
 * ⚠ Cell bounds are computed from `bbox[0]/bbox[1]` plus an integer multiple of `cellSizeDeg` and are NEVER
 * rounded (F-98) — a rounded cell edge would move the boundary between "counted" and "not counted".
 */
export function populationGridCells(grid: PopulationGrid): readonly PopulationCell[] {
  const out: PopulationCell[] = [];
  const [minLon, minLat] = grid.bbox;
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const raw = grid.counts[r * grid.cols + c]!;
      if (raw === 0) continue;
      const west = minLon + c * grid.cellSizeDeg;
      const south = minLat + r * grid.cellSizeDeg;
      out.push({
        bbox: [west, south, west + grid.cellSizeDeg, south + grid.cellSizeDeg],
        count: raw * grid.quantumPersons,
      });
    }
  }
  return out;
}

/** Total modelled population in the artifact (the manifest records it so drift is visible without a clip). */
export function populationGridTotal(grid: PopulationGrid): number {
  return grid.counts.reduce((sum, n) => sum + n, 0) * grid.quantumPersons;
}

/**
 * The EXACT byte string a grid's SHA-256 covers. Defined here rather than "hash the file" on purpose: the
 * digest must be reproducible from the PARSED grid, so a manifest entry can be re-verified after a
 * whitespace-only reformat of the JSON file and CANNOT be re-verified after a value changes.
 *
 * The field order below is part of the format contract; changing it invalidates every manifest entry, which
 * is the intended consequence rather than a hazard.
 */
export function canonicalGridBytes(grid: PopulationGrid): string {
  return [
    String(grid.version),
    grid.id,
    grid.bbox.join(','),
    String(grid.cellSizeDeg),
    String(grid.cols),
    String(grid.rows),
    String(grid.quantumPersons),
    grid.counts.join(','),
    PROVENANCE_KEYS.map((k) => grid.provenance[k]).join(''),
  ].join('');
}

/** An injected digest: bytes → lower-case hex. The loader supplies `node:crypto`; tests supply their own. */
export type Digest = (bytes: string) => string;

/**
 * Verify a grid against the SHA-256 recorded in the manifest. FAIL-CLOSED: any mismatch is a typed error and
 * the caller MUST fall through to the next rung with an honest label — a grid whose integrity cannot be
 * proven is not used at a reduced confidence, it is not used at all (master plan §5.8, ADR-035 V4).
 */
export function verifyPopulationGridIntegrity(
  grid: PopulationGrid,
  expectedSha256: string,
  digest: Digest,
): Result<PopulationGrid, DomainError> {
  const actual = digest(canonicalGridBytes(grid)).toLowerCase();
  const expected = expectedSha256.trim().toLowerCase();
  if (actual !== expected) {
    return err(
      new DomainError(
        'INVARIANT_VIOLATION',
        `Population grid '${grid.id}' failed integrity check: manifest sha256 ${expected}, computed ${actual}`,
      ),
    );
  }
  return ok(grid);
}
