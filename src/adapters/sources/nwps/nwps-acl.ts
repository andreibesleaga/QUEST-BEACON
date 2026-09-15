// BEACON — NWPS anti-corruption layer (E4·T-155; adapter-contract §4, Art. XII). Maps a NOAA National
// Water Prediction Service (api.water.noaa.gov/nwps/v1) gauge object → a canonical Gauge (flood category +
// observed stage + crest forecast). The ONLY place the raw NWPS JSON shape exists; no NWPS field name
// escapes above this module (AGENTS.md §3). Numbers are produced deterministically here — never the LLM.
//
// Honest limitation: a gauge reports the more-severe of its observed vs forecast flood category so the COP
// never under-states risk; the crest forecast is a labeled first-order projection, not a guarantee.
import type { Gauge, FloodCategory, GaugeId, SourceId } from '@/domain/index.js';
import { asId, makeGauge, definedOnly } from '@/domain/index.js';
import type { AntiCorruptionMapper, MapContext } from '@/adapters/_shared/index.js';
import { makeAdapterError } from '@/adapters/_shared/index.js';

interface NwpsStatusPart {
  readonly primary?: number | string | null;
  readonly floodCategory?: string | null;
  readonly validTime?: string | null;
}

/** One raw NWPS gauge (observed + forecast blocks). Raw until mapped. */
export interface NwpsGauge {
  readonly lid?: string;
  readonly latitude?: number | string | null;
  readonly longitude?: number | string | null;
  readonly status?: {
    readonly observed?: NwpsStatusPart | null;
    readonly forecast?: (NwpsStatusPart & { readonly crest?: NwpsStatusPart | null }) | null;
  } | null;
}

/** NWPS flood-category tokens → the ordered domain FloodCategory. */
const CATEGORY: Record<string, FloodCategory> = {
  no_flooding: 'NONE',
  none: 'NONE',
  action: 'ACTION',
  minor: 'MINOR',
  moderate: 'MODERATE',
  major: 'MAJOR',
};

/** Parse the NWPS gauges payload into raw gauge rows. */
export function parseNwpsGauges(text: string): NwpsGauge[] {
  const doc = JSON.parse(text) as { gauges?: NwpsGauge[] };
  return Array.isArray(doc.gauges) ? doc.gauges : [];
}

export const nwpsMapper: AntiCorruptionMapper<NwpsGauge, Gauge> = {
  toCanonical(raw: NwpsGauge, ctx: MapContext): Gauge {
    const [lon, lat] = requirePoint(raw);
    const observed: NwpsStatusPart = raw.status?.observed ?? {};
    const forecast: NwpsStatusPart & { crest?: NwpsStatusPart | null } = raw.status?.forecast ?? {};
    const crest: NwpsStatusPart = forecast.crest ?? {};
    return makeGauge(
      definedOnly({
        id: gaugeId(raw),
        geom: { type: 'Point', coordinates: [lon, lat] },
        floodCategory: worstCategory(observed.floodCategory, forecast.floodCategory),
        sourceId: asId<SourceId>(ctx.sourceRecordId),
        stage: num(observed.primary),
        crestForecast: num(crest.primary ?? forecast.primary),
        crestTime: str(crest.validTime),
      }) as Parameters<typeof makeGauge>[0],
    );
  },
};

/** Require finite lat/lon; a gauge without a location can't be placed on the COP. */
function requirePoint(raw: NwpsGauge): [number, number] {
  const lat = num(raw.latitude);
  const lon = num(raw.longitude);
  if (lat === undefined || lon === undefined) {
    throw makeAdapterError(
      'PARSE',
      `NWPS gauge missing/invalid lat,lon: '${raw.latitude},${raw.longitude}'`,
    );
  }
  return [lon, lat];
}

/** Most-severe of observed vs forecast category (never under-state risk). */
export function worstCategory(
  a: string | null | undefined,
  b: string | null | undefined,
): FloodCategory {
  const ca = category(a);
  const cb = category(b);
  return rank(ca) >= rank(cb) ? ca : cb;
}

function category(token: string | null | undefined): FloodCategory {
  return CATEGORY[(token ?? '').toLowerCase()] ?? 'NONE';
}

const ORDER: readonly FloodCategory[] = ['NONE', 'ACTION', 'MINOR', 'MODERATE', 'MAJOR'];
const rank = (c: FloodCategory): number => ORDER.indexOf(c);

function gaugeId(raw: NwpsGauge): GaugeId {
  const lid = raw.lid && raw.lid.trim() !== '' ? raw.lid : `${raw.latitude},${raw.longitude}`;
  return asId<GaugeId>(`nwps:${lid}`);
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}
