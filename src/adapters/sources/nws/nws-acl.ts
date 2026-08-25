// BEACON — NWS anti-corruption layer (E4·T-153; adapter-contract §4, Art. XII). Maps a NOAA NWS
// (api.weather.gov) observation GeoJSON Feature → a port-local WeatherObservation DTO. This is the ONLY
// place the raw GeoJSON shape exists; no NWS field name escapes above this module (AGENTS.md §3). Numbers
// are produced deterministically here — never by the LLM. A feature without geometry raises a typed PARSE.
//
// Honest limitation: NWS quantitative values carry WMO unit codes; wind is km/h and is converted to m/s
// deterministically. Weather has no canonical domain entity — it feeds labeled first-order predictions.
import type { WeatherObservation } from '@/ports/data-sources.js';
import { definedOnly } from '@/domain/index.js';
import type { AntiCorruptionMapper, MapContext } from '@/adapters/_shared/index.js';
import { makeAdapterError } from '@/adapters/_shared/index.js';

/** A NWS GeoJSON observation Feature (geometry Point + quantitative properties). Raw until mapped. */
export interface NwsFeature {
  readonly geometry?: { readonly type?: string; readonly coordinates?: readonly number[] } | null;
  readonly properties?: Readonly<Record<string, unknown>> | null;
}

interface NwsQuantity {
  readonly value?: number | string | null;
  readonly unitCode?: string;
}

/** Parse the NWS observations payload: a FeatureCollection, or a single latest-observation Feature. */
export function parseNwsObservations(text: string): NwsFeature[] {
  const doc = JSON.parse(text) as { type?: string; features?: NwsFeature[] } & NwsFeature;
  if (Array.isArray(doc.features)) return doc.features;
  if (doc.geometry !== undefined || doc.properties !== undefined) return [doc];
  return [];
}

export const nwsMapper: AntiCorruptionMapper<NwsFeature, WeatherObservation> = {
  toCanonical(raw: NwsFeature, ctx: MapContext): WeatherObservation {
    const position = requirePosition(raw.geometry?.coordinates);
    const props = raw.properties ?? {};
    const at = typeof props.timestamp === 'string' ? props.timestamp : ctx.fetchedAt;
    return definedOnly({
      at,
      position,
      windSpeedMs: windMs(quantity(props, 'windSpeed')),
      windDirDeg: num(quantity(props, 'windDirection')?.value),
      tempC: num(quantity(props, 'temperature')?.value),
      humidityPct: num(quantity(props, 'relativeHumidity')?.value),
    }) as WeatherObservation;
  },
};

/** Require a finite [lon,lat] from a GeoJSON coordinate pair; a feature without geometry can't be placed. */
function requirePosition(coords: readonly number[] | undefined): [number, number] {
  const lon = coords?.[0];
  const lat = coords?.[1];
  if (lon === undefined || lat === undefined || !Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw makeAdapterError('PARSE', `NWS observation missing/invalid geometry: ${JSON.stringify(coords)}`);
  }
  return [lon, lat];
}

/** Convert a NWS windSpeed quantity to m/s (km/h → /3.6); pass through when already m/s. */
function windMs(q: NwsQuantity | undefined): number | undefined {
  const v = num(q?.value);
  if (v === undefined) return undefined;
  const unit = q?.unitCode ?? '';
  return unit.includes('km_h') ? v / 3.6 : v;
}

function quantity(props: Readonly<Record<string, unknown>>, key: string): NwsQuantity | undefined {
  const q = props[key];
  return typeof q === 'object' && q !== null ? (q as NwsQuantity) : undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}
