// BEACON — ITU anti-corruption layer (TelecomPort P13; adapter-contract §4, Art. XII). Maps one
// country/region-level ITU-style connectivity indicator row → a canonical TelecomCoverage. The ONLY
// place this raw row shape exists; no ITU field escapes above this module (AGENTS.md §3).
//
// DATA_SOURCE_VERIFICATION.md row 57 (§4): "ITU Disaster Connectivity Maps" — free, ITU terms, per-event,
// Global, but **gated/sparse**; .env.example already documents `SOURCE_ITU_MODE=mock` (gated data, not
// wired for live in v1). This ACL/fixture is therefore SCHEMA-CRAFTED (hand-authored, illustrative), NOT
// a literal recorded ITU API payload — see __fixtures__/connectivity.json header comment for the full
// honesty note. It models ITU's published national/regional connectivity indicator concepts (Internet-use
// penetration %, mobile-broadband population coverage %), not per-tower or per-device data.
//
// HONEST AGGREGATION SEMANTICS: every mapped TelecomCoverage carries `technology: 'aggregate-connectivity'`
// and `online: true` — this is NOT a live up/down signal for a tower or cell. It means "this area has a
// documented national/regional connectivity statistic available", placed at the area's representative
// centroid. ITU indicators are periodic country/region-level statistics, never real-time infrastructure
// status; callers must not read `online` here as "network currently reachable".
import type { TelecomCoverage } from '@/ports/infrastructure-sources.js';
import type { AntiCorruptionMapper } from '@/adapters/_shared/index.js';
import { makeAdapterError } from '@/adapters/_shared/index.js';

const AGGREGATE_CONNECTIVITY_TECHNOLOGY = 'aggregate-connectivity';

/** One raw ITU-style connectivity indicator row (schema-crafted; raw until mapped). */
export interface ItuConnectivityRow {
  readonly area?: string; // area code, e.g. 'US-CA' or 'RO' — not validated against ISO-3166 here
  readonly areaName?: string;
  readonly centroid?: readonly [number, number] | null; // [lon, lat] representative point for the area
  readonly internetPenetration?: number | null; // fraction 0..1 of population using the Internet
  readonly mobileCoverage?: number | null; // fraction 0..1 covered by at least mobile-broadband
  readonly observedAt?: string;
}

interface ItuFixtureDoc {
  readonly rows?: readonly ItuConnectivityRow[];
}

/** Parse the fixture/live JSON text into raw rows (top-level `{ rows: [...] }` document). */
export function parseItuRows(text: string): ItuConnectivityRow[] {
  const doc = JSON.parse(text) as ItuFixtureDoc;
  return Array.isArray(doc.rows) ? [...doc.rows] : [];
}

export const ituMapper: AntiCorruptionMapper<ItuConnectivityRow, TelecomCoverage> = {
  toCanonical(raw: ItuConnectivityRow): TelecomCoverage {
    requireNonEmptyArea(raw.area);
    const position = requireCentroid(raw.centroid, raw.area);
    requireFraction(raw.internetPenetration, 'internetPenetration', raw.area);
    requireFraction(raw.mobileCoverage, 'mobileCoverage', raw.area);
    return { position, technology: AGGREGATE_CONNECTIVITY_TECHNOLOGY, online: true };
  },
};

function requireNonEmptyArea(area: string | undefined): asserts area is string {
  if (typeof area !== 'string' || area.trim() === '') {
    throw makeAdapterError('PARSE', `ITU row missing area code: ${JSON.stringify(area)}`);
  }
}

function requireCentroid(
  centroid: ItuConnectivityRow['centroid'],
  area: string | undefined,
): readonly [number, number] {
  const lon = centroid?.[0];
  const lat = centroid?.[1];
  if (typeof lon !== 'number' || typeof lat !== 'number' || !Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw makeAdapterError('PARSE', `ITU row '${area ?? '?'}' missing/invalid centroid: ${JSON.stringify(centroid)}`);
  }
  return [lon, lat];
}

function requireFraction(value: number | null | undefined, field: string, area: string | undefined): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw makeAdapterError('PARSE', `ITU row '${area ?? '?'}' invalid ${field} (expected 0..1): ${String(value)}`);
  }
}
