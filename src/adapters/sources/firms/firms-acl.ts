// BEACON — FIRMS anti-corruption layer (E4·T-147; adapter-contract §4, FIRMS/F1/Art. XII). Maps a NASA
// FIRMS active-fire CSV row → a canonical HazardGeometry (kind HOTSPOT). This is the ONLY place the raw
// CSV shape exists; no CSV field name escapes above this module (AGENTS.md §3). Numbers/geometry are
// produced deterministically here — never by the LLM. A row that cannot map raises a typed PARSE.
//
// Honest limitation (Art. — honest limitations): FIRMS gives thermal HOTSPOTS, not fire PERIMETERS. Each
// record is a satellite fire-detection pixel (VIIRS 375 m / MODIS 1 km), subject to thermal false
// positives; it is corroborating evidence, not an authoritative burn boundary.
import type { HazardGeometry, HazardGeometryId, IncidentId, SourceId } from '@/domain/index.js';
import { asId, makeHazardGeometry } from '@/domain/index.js';
import type { AntiCorruptionMapper, MapContext } from '@/adapters/_shared/index.js';
import { makeAdapterError } from '@/adapters/_shared/index.js';

/** One parsed FIRMS CSV row (header-keyed). All values are raw strings until mapped. */
export type FirmsRow = Readonly<Record<string, string>>;

// FIRMS hotspots are not yet correlated to a BEACON incident; correlation happens downstream. A stable
// sentinel keeps provenance intact without inventing a fake incident id.
const UNASSIGNED_INCIDENT = asId<IncidentId>('firms-unassigned');

/**
 * Tiny deterministic CSV splitter (no new dependency). FIRMS active-fire CSV is flat, unquoted numeric/
 * short-token data, so a comma/newline split is sufficient and fully deterministic.
 */
export function parseFirmsCsv(text: string): FirmsRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const headerLine = lines[0];
  if (headerLine === undefined) return [];
  const header = headerLine.split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => rowFromCells(header, line.split(',')));
}

function rowFromCells(header: readonly string[], cells: readonly string[]): FirmsRow {
  const row: Record<string, string> = {};
  header.forEach((key, i) => {
    row[key] = (cells[i] ?? '').trim();
  });
  return row;
}

export const firmsMapper: AntiCorruptionMapper<FirmsRow, HazardGeometry> = {
  toCanonical(raw: FirmsRow, ctx: MapContext): HazardGeometry {
    const lat = Number(raw.latitude);
    const lon = Number(raw.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw makeAdapterError(
        'PARSE',
        `FIRMS row missing/invalid lat,lon: '${raw.latitude},${raw.longitude}'`,
      );
    }
    const frp = Number(raw.frp);
    const base = {
      id: hotspotId(raw),
      incidentId: UNASSIGNED_INCIDENT,
      sourceId: asId<SourceId>(ctx.sourceRecordId),
      kind: 'HOTSPOT' as const,
      geometry: { type: 'Point' as const, coordinates: [lon, lat] as const },
      observedAt: firmsObservedAt(raw),
    };
    return makeHazardGeometry(Number.isFinite(frp) ? { ...base, intensity: frp } : base);
  },
};

/** Stable id from the detection's location + acquisition instant (deterministic, dedup-friendly). */
function hotspotId(raw: FirmsRow): HazardGeometryId {
  return asId<HazardGeometryId>(
    `firms:${raw.latitude},${raw.longitude}@${raw.acq_date}T${raw.acq_time}`,
  );
}

/** Combine FIRMS acq_date (YYYY-MM-DD) + acq_time (HHMM, may be short) into an ISO-8601 UTC instant. */
export function firmsObservedAt(raw: FirmsRow): string {
  const date = raw.acq_date;
  if (!date) throw makeAdapterError('PARSE', 'FIRMS row missing acq_date');
  const hhmm = (raw.acq_time ?? '0').padStart(4, '0');
  return `${date}T${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}:00Z`;
}
