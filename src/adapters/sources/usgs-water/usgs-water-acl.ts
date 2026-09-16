// BEACON — USGS Water anti-corruption layer (E4·T-156; adapter-contract §4, Art. XII). Maps a USGS Water
// Services Instantaneous-Values (IV) JSON time-series → a canonical Gauge (observed gauge height). The
// ONLY place the raw USGS JSON shape exists; no USGS field name escapes above this module (AGENTS.md §3).
// Numbers are produced deterministically here — never the LLM. A series without geolocation raises PARSE.
//
// Honest limitations: (1) USGS IV reports a RAW gauge stage, not an NWS flood category → floodCategory is
// NONE here (flood classification is layered downstream against NWS/NWPS thresholds). (2) Per
// DATA_SOURCE_VERIFICATION §2 the adapter DEFAULTS to the new OGC host `api.waterdata.usgs.gov` (legacy
// `waterservices.usgs.gov` decommissions Q1 2027). ⚠ This ACL still parses the LEGACY IV JSON shape
// (`value.timeSeries[]`): DATA_SOURCE_VERIFICATION does not record the OGC response field names, and the
// verified-schema mandate forbids guessing them. Mapping the OGC response is a follow-up gated on a
// verified OGC schema; until then the recorded fixture + mock/cached demo paths use this legacy shape.
import type { Gauge, GaugeId, SourceId } from '@/domain/index.js';
import { asId, makeGauge, definedOnly } from '@/domain/index.js';
import type { AntiCorruptionMapper, MapContext } from '@/adapters/_shared/index.js';
import { makeAdapterError } from '@/adapters/_shared/index.js';

interface UsgsValue {
  readonly value?: string | number | null;
  readonly dateTime?: string;
}

/** One raw USGS IV time-series (site metadata + one variable's observations). Raw until mapped. */
export interface UsgsTimeSeries {
  readonly sourceInfo?: {
    readonly siteName?: string;
    readonly siteCode?: readonly { readonly value?: string }[];
    readonly geoLocation?: {
      readonly geogLocation?: { readonly latitude?: number; readonly longitude?: number };
    };
  };
  readonly values?: readonly { readonly value?: readonly UsgsValue[] }[];
}

/** Parse the USGS IV payload into raw time-series rows. */
export function parseUsgsTimeSeries(text: string): UsgsTimeSeries[] {
  const doc = JSON.parse(text) as { value?: { timeSeries?: UsgsTimeSeries[] } };
  return Array.isArray(doc.value?.timeSeries) ? doc.value.timeSeries : [];
}

export const usgsWaterMapper: AntiCorruptionMapper<UsgsTimeSeries, Gauge> = {
  toCanonical(raw: UsgsTimeSeries, ctx: MapContext): Gauge {
    const [lon, lat] = requireGeo(raw);
    return makeGauge(
      definedOnly({
        id: siteId(raw),
        geom: { type: 'Point', coordinates: [lon, lat] },
        floodCategory: 'NONE' as const, // USGS IV = raw stage; flood category classified downstream (honest limitation)
        sourceId: asId<SourceId>(ctx.sourceRecordId),
        stage: latestStage(raw),
      }) as Parameters<typeof makeGauge>[0],
    );
  },
};

/** Require a finite [lon,lat] from the series' geolocation; a series without it can't be placed. */
function requireGeo(raw: UsgsTimeSeries): [number, number] {
  const geo = raw.sourceInfo?.geoLocation?.geogLocation;
  const lat = num(geo?.latitude); // num() also enforces finiteness
  const lon = num(geo?.longitude);
  if (lat === undefined || lon === undefined) {
    throw makeAdapterError(
      'PARSE',
      `USGS series missing/invalid geolocation for '${raw.sourceInfo?.siteName ?? '?'}'`,
    );
  }
  return [lon, lat];
}

/** Latest observed value across the series' first value block. */
function latestStage(raw: UsgsTimeSeries): number | undefined {
  const points = raw.values?.[0]?.value ?? [];
  const last = points[points.length - 1];
  return num(last?.value);
}

function siteId(raw: UsgsTimeSeries): GaugeId {
  const code = raw.sourceInfo?.siteCode?.[0]?.value;
  return asId<GaugeId>(`usgs:${code && code.trim() !== '' ? code : 'unknown'}`);
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}
