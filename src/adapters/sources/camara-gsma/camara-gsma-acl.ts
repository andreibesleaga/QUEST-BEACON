// BEACON — CAMARA/GSMA Open Gateway anti-corruption layer (E4·TelecomPort P13; adapter-contract §4,
// Art. XII/XIV). Maps one aggregate CAMARA-style connectivity row (Population Density Data / Region
// Device Count / Connectivity Insights style) → a canonical TelecomCoverage. The ONLY place this raw row
// shape exists; no CAMARA field escapes above this module (AGENTS.md §3).
//
// DATA_SOURCE_VERIFICATION.md row 59 (§4): CAMARA/GSMA Open Gateway is **operator-gated** — there is no
// public keyless live endpoint; a live integration requires the client to contract an operator sandbox
// agreement. Verdict: MOCK. This adapter is therefore MOCK-only (see camara-gsma-adapter.ts factory,
// which rejects SOURCE_CAMARA_GSMA_MODE=LIVE with a CONFIG error).
//
// NO PII (Art. XIV, ADR-021): CAMARA's Population-Density/Device-Count/Connectivity-Insights family is
// contractually aggregate-only (k-anonymity floor, no individual device/subscriber is ever resolvable).
// The canonical TelecomCoverage entity ({position, technology?, online}) structurally carries no personal
// identifier field, and this mapper additionally enforces `aggregateOnly === true` on every raw row as a
// privacy invariant — a row missing that flag is rejected as PARSE, never silently passed through.
import type { TelecomCoverage } from '@/ports/infrastructure-sources.js';
import type { AntiCorruptionMapper } from '@/adapters/_shared/index.js';
import { makeAdapterError } from '@/adapters/_shared/index.js';

const VALID_STATUS = ['NORMAL', 'DEGRADED', 'OFFLINE'] as const;
type ConnectivityStatus = (typeof VALID_STATUS)[number];

/**
 * One raw CAMARA/GSMA aggregate row (adapted/flattened from the repo's recorded fixture
 * fixtures/camara-gsma/population-density.json — see __fixtures__/coverage.json header comment).
 * Schema-crafted to match CAMARA's documented aggregate-connectivity concepts; raw until mapped.
 */
export interface CamaraGsmaRow {
  readonly cellId?: string;
  readonly position?: readonly [number, number] | null; // [lon, lat] — aggregate cell representative point
  readonly networkTypes?: readonly string[] | null; // e.g. ["5G","4G"]
  readonly connectivityStatus?: string | null; // NORMAL | DEGRADED | OFFLINE
  readonly aggregateOnly?: boolean; // MUST be true — structural no-PII invariant (Art. XIV)
  readonly minAggregationGroup?: number;
  readonly observedAt?: string;
}

interface CamaraGsmaFixtureDoc {
  readonly rows?: readonly CamaraGsmaRow[];
}

/** Parse the fixture/live JSON text into raw rows (top-level `{ rows: [...] }` document). */
export function parseCamaraGsmaRows(text: string): CamaraGsmaRow[] {
  const doc = JSON.parse(text) as CamaraGsmaFixtureDoc;
  return Array.isArray(doc.rows) ? [...doc.rows] : [];
}

export const camaraGsmaMapper: AntiCorruptionMapper<CamaraGsmaRow, TelecomCoverage> = {
  toCanonical(raw: CamaraGsmaRow): TelecomCoverage {
    if (raw.aggregateOnly !== true) {
      throw makeAdapterError(
        'PARSE',
        `CAMARA row '${raw.cellId ?? '?'}' missing aggregateOnly:true — refusing to map a row without the aggregate-only privacy guarantee (Art. XIV)`,
      );
    }
    const position = requirePosition(raw.position, raw.cellId);
    const status = requireStatus(raw.connectivityStatus, raw.cellId);
    const online = status !== 'OFFLINE';
    const technology =
      raw.networkTypes !== undefined && raw.networkTypes !== null && raw.networkTypes.length > 0
        ? raw.networkTypes.join('+')
        : undefined;
    return technology !== undefined ? { position, technology, online } : { position, online };
  },
};

function requirePosition(
  position: CamaraGsmaRow['position'],
  cellId: string | undefined,
): readonly [number, number] {
  const lon = position?.[0];
  const lat = position?.[1];
  if (
    typeof lon !== 'number' ||
    typeof lat !== 'number' ||
    !Number.isFinite(lon) ||
    !Number.isFinite(lat)
  ) {
    throw makeAdapterError(
      'PARSE',
      `CAMARA row '${cellId ?? '?'}' missing/invalid position: ${JSON.stringify(position)}`,
    );
  }
  return [lon, lat];
}

function requireStatus(
  status: string | null | undefined,
  cellId: string | undefined,
): ConnectivityStatus {
  if (
    status === null ||
    status === undefined ||
    !(VALID_STATUS as readonly string[]).includes(status)
  ) {
    throw makeAdapterError(
      'PARSE',
      `CAMARA row '${cellId ?? '?'}' invalid connectivityStatus: '${String(status)}'`,
    );
  }
  return status as ConnectivityStatus;
}
