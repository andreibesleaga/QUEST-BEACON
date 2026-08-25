// BEACON — Open-Meteo anti-corruption layer (E4·T-157; adapter-contract §4, Art. XII). Maps an Open-Meteo
// current-weather JSON payload (api.open-meteo.com/v1/forecast) → a port-local WeatherObservation. The ONLY
// place the raw Open-Meteo shape exists; no field name escapes above this module (AGENTS.md §3). Numbers are
// produced deterministically here — never the LLM. A payload without lat/lon raises a typed PARSE.
//
// Honest limitations: Open-Meteo is a global MODEL (no official warnings) under CC BY 4.0; the URL requests
// wind in m/s + timezone=UTC so units/timestamps need no conversion. It is the free non-US weather rung
// (RO/global) beside NWS (US); heavy/commercial use should self-host Open-Meteo (Art. XVI, per DSV §CC-BY).
import type { WeatherObservation } from '@/ports/data-sources.js';
import { definedOnly } from '@/domain/index.js';
import type { AntiCorruptionMapper, MapContext } from '@/adapters/_shared/index.js';
import { makeAdapterError } from '@/adapters/_shared/index.js';

interface OpenMeteoCurrentBlock {
  readonly time?: string;
  readonly temperature_2m?: number | string | null;
  readonly relative_humidity_2m?: number | string | null;
  readonly wind_speed_10m?: number | string | null;
  readonly wind_direction_10m?: number | string | null;
}

/** One raw Open-Meteo forecast response (site lat/lon + a `current` block). Raw until mapped. */
export interface OpenMeteoResponse {
  readonly latitude?: number | string | null;
  readonly longitude?: number | string | null;
  readonly current?: OpenMeteoCurrentBlock | null;
}

/** Parse an Open-Meteo payload into raw rows: one `current` observation, or none. */
export function parseOpenMeteo(text: string): OpenMeteoResponse[] {
  const doc = JSON.parse(text) as OpenMeteoResponse;
  return doc.current != null ? [doc] : [];
}

export const openMeteoMapper: AntiCorruptionMapper<OpenMeteoResponse, WeatherObservation> = {
  toCanonical(raw: OpenMeteoResponse, ctx: MapContext): WeatherObservation {
    const position = requirePosition(raw);
    const cur: OpenMeteoCurrentBlock = raw.current ?? {};
    return definedOnly({
      at: toIsoUtc(cur.time, ctx.fetchedAt),
      position,
      windSpeedMs: num(cur.wind_speed_10m),
      windDirDeg: num(cur.wind_direction_10m),
      tempC: num(cur.temperature_2m),
      humidityPct: num(cur.relative_humidity_2m),
    }) as WeatherObservation;
  },
};

/** Require a finite [lon,lat] from the response; a payload without a location can't be placed. */
function requirePosition(raw: OpenMeteoResponse): [number, number] {
  const lon = num(raw.longitude);
  const lat = num(raw.latitude);
  if (lon === undefined || lat === undefined) {
    throw makeAdapterError('PARSE', `Open-Meteo response missing/invalid lat,lon: '${raw.latitude},${raw.longitude}'`);
  }
  return [lon, lat];
}

/** Open-Meteo (timezone=UTC) returns minute-resolution ISO with no zone suffix; normalize to explicit UTC. */
function toIsoUtc(t: string | undefined, fallback: string): string {
  if (t === undefined || t.trim() === '') return fallback;
  return /(?:Z|[+-]\d\d:\d\d)$/.test(t) ? t : `${t}:00Z`;
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}
