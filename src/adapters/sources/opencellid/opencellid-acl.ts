// BEACON — OpenCelliD anti-corruption layer (E4·T-13x; adapter-contract §4, TelecomPort P13, Art. XII).
// Maps a raw OpenCelliD `cell/getInArea` response (opencellid.org) → the canonical port-local
// TelecomCoverage DTO (src/ports/infrastructure-sources.ts:18). This is the ONLY place the raw
// OpenCelliD cell-tower shape exists; no field name escapes above this module (AGENTS.md §3). Numbers/
// positions are produced deterministically here — never by the LLM.
//
// Honest limitations (Art. — honest limitations; DATA_SOURCE_VERIFICATION §4 OpenCelliD row):
//   1. OpenCelliD is a STATIC, CROWDSOURCED tower database, not a live network-status feed. It has no
//      concept of a cell being "up"/"down" right now — `online` is therefore always stamped `true`
//      (the tower is registered/known), not a live health signal. Callers must not read `online: false`
//      out of this adapter; a truly offline area shows up as an absent/sparse tower, not a `false` flag.
//   2. Coverage has CROWDSOURCED GAPS — contributor density varies by region/operator, so an empty result
//      for a bbox means "no reported towers", not "no towers exist" (verdict CACHED, never treated as a
//      live authoritative census).
// A raw cell missing/invalid lat or lon cannot be placed on the map; per the OpenCelliD task contract
// those rows are SKIPPED + COUNTED at parse time (parseOpenCelliDCells), not silently dropped without a
// trace and not individually PARSE-failing the whole batch (an area query can return many rows; one bad
// crowdsourced row should not fail the rest). The mapper itself still honors the generic
// AntiCorruptionMapper contract and throws a typed PARSE if it is ever handed a malformed row directly.
import type { TelecomCoverage } from '@/ports/infrastructure-sources.js';
import { definedOnly } from '@/domain/index.js';
import type { AntiCorruptionMapper } from '@/adapters/_shared/index.js';
import { makeAdapterError } from '@/adapters/_shared/index.js';

/** One raw OpenCelliD cell record (getInArea `cells[]` element). Raw until mapped. */
export interface OpenCelliDCell {
  readonly lat?: number | string | null;
  readonly lon?: number | string | null;
  readonly radio?: string | null; // GSM | UMTS | LTE | NR
  readonly mcc?: number;
  readonly mnc?: number;
  readonly lac?: number;
  readonly cellid?: number;
  readonly averageSignalStrength?: number;
  readonly range?: number;
  readonly samples?: number;
  readonly changeable?: number;
  readonly created?: number;
  readonly updated?: number;
}

interface OpenCelliDResponse {
  readonly cells?: readonly unknown[];
}

export interface ParsedCells {
  readonly rows: readonly OpenCelliDCell[];
  /** Count of raw entries dropped for missing/invalid lat or lon (crowdsourced-data hygiene). */
  readonly skipped: number;
}

/** Parse a `getInArea` JSON body into raw cell rows, skipping (and counting) malformed entries. */
export function parseOpenCelliDCells(text: string): ParsedCells {
  const doc = JSON.parse(text) as OpenCelliDResponse;
  const raw = Array.isArray(doc.cells) ? doc.cells : [];
  const rows: OpenCelliDCell[] = [];
  let skipped = 0;
  for (const entry of raw) {
    if (isWellFormedCell(entry)) rows.push(entry);
    else skipped += 1;
  }
  return { rows, skipped };
}

function isWellFormedCell(entry: unknown): entry is OpenCelliDCell {
  if (typeof entry !== 'object' || entry === null) return false;
  const cell = entry as OpenCelliDCell;
  return num(cell.lat) !== undefined && num(cell.lon) !== undefined;
}

export const openCelliDMapper: AntiCorruptionMapper<OpenCelliDCell, TelecomCoverage> = {
  // No timestamp/id to fold from ctx: TelecomCoverage carries no such field, and cells reaching this
  // mapper are already position-validated by parseOpenCelliDCells. `ctx` is intentionally omitted from
  // this implementation's arity (TS structurally allows a mapper with fewer parameters than the
  // AntiCorruptionMapper interface declares — see the identical pattern in eagle-i-acl.ts).
  toCanonical(raw: OpenCelliDCell): TelecomCoverage {
    const lat = num(raw.lat);
    const lon = num(raw.lon);
    if (lat === undefined || lon === undefined) {
      throw makeAdapterError(
        'PARSE',
        `OpenCelliD cell missing/invalid lat,lon: '${String(raw.lat)},${String(raw.lon)}'`,
      );
    }
    // No live status is available from a static tower DB — see honest-limitation note above.
    return definedOnly({
      position: [lon, lat] as const,
      technology: radio(raw.radio),
      online: true,
    }) as TelecomCoverage;
  },
};

function radio(v: string | null | undefined): string | undefined {
  if (v === null || v === undefined) return undefined;
  const trimmed = v.trim();
  return trimmed === '' ? undefined : trimmed;
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}
