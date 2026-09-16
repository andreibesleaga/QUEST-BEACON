// BEACON — Air-quality source port (S2 Lane A4; ADR-037 "Live-Demo Delivery Increment"). The outward seam
// for the air/smoke source family (OpenAQ, US EPA AirNow, Sensor.Community — wired as adapters in S2).
// Interface signature + port-local DTO only — anti-corruption boundary; every response carries freshness
// (Sourced<T>). Mirrors OutagePort/TelecomPort in infrastructure-sources.ts: air quality has no canonical
// domain entity, it feeds CORROBORATION (a wildfire's smoke plume is visible in surface PM2.5 hours before
// any perimeter is published), so the DTO lives here and raw upstream shapes stay in each adapter's ACL.
//
// P17 (NOT P16 — `cameras.ts` already holds P16 CameraDirectoryPort; docs/LIVE_DEMO_DELIVERY_PLAN.md §2·S2
// says "P16" for this port, which collides. The collision is resolved here in favour of the shipped code.)
//
// Art. XII: every field below is a DETERMINISTIC figure copied verbatim from an authoritative source. This
// port never carries a computed/estimated index — `aqi`/`aqiCategory` are populated ONLY when the upstream
// itself publishes them (AirNow does; OpenAQ and Sensor.Community publish raw concentrations only, so those
// two leave them undefined rather than inventing a conversion). The LLM narrates these figures, never
// produces them.
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { SourceId } from '@/domain/value-objects/ids.js';
import type { Sourced } from './infra.js';
import type { AreaQuery } from './data-sources.js';

/** Pollutants BEACON models. Wildfire smoke is the motivating signal, hence PM25/PM10 first. */
export const AIR_QUALITY_POLLUTANTS = ['PM25', 'PM10', 'O3', 'NO2', 'SO2', 'CO'] as const;
export type AirQualityPollutant = (typeof AIR_QUALITY_POLLUTANTS)[number];

/**
 * US EPA AQI categories, verbatim from the AirNow "Air Quality 101" table (docs.airnowapi.org/aq101,
 * verified 2026-08-08): 0–50 Good · 51–100 Moderate · 101–150 Unhealthy for Sensitive Groups ·
 * 151–200 Unhealthy · 201–300 Very Unhealthy · 301–500 Hazardous. Ordered worst-last so a category
 * comparison is an index comparison (no re-derived numbers).
 */
export const AQI_CATEGORIES = [
  'GOOD',
  'MODERATE',
  'UNHEALTHY_SENSITIVE',
  'UNHEALTHY',
  'VERY_UNHEALTHY',
  'HAZARDOUS',
] as const;
export type AqiCategory = (typeof AQI_CATEGORIES)[number];

/**
 * One observation from one station/sensor for one pollutant. Port-local DTO (no canonical entity — see the
 * header); the identity fields are what let a SitRep fact CITE the reading rather than assert it.
 */
export interface AirQualityReading {
  /** Adapter-scoped stable station identity, e.g. 'airnow:840060792020' — dedup-friendly, never upstream-raw. */
  readonly stationId: string;
  /** Human-readable station label when the source publishes one (AirNow SiteName, OpenAQ location name). */
  readonly stationName?: string;
  readonly position: readonly [lon: number, lat: number];
  readonly pollutant: AirQualityPollutant;
  /** The measured concentration, in `unit`. Never unit-converted — see `unit`. */
  readonly value: number;
  /** Upstream unit VERBATIM (e.g. 'UG/M3', 'µg/m³', 'ppb'). Honest-limitations rule: a cross-source unit
   *  conversion would be a derived number, so units are carried, not normalised (cf. Gauge.gaugeUnit). */
  readonly unit: string;
  /** Source-published AQI-style index. Undefined when the source publishes concentrations only. */
  readonly aqi?: number;
  /** Source-published AQI category. Undefined when the source publishes concentrations only. */
  readonly aqiCategory?: AqiCategory;
  readonly observedAt: string; // ISO-8601 UTC
  /** The SOURCE_RECORD that grounds this reading (F2: no field without a citation). */
  readonly sourceId: SourceId;
}

/** P17 — surface air-quality observations for an area (smoke/AQ corroboration of a wildfire signal). */
export interface AirQualityPort {
  fetchAirQuality(
    query: AreaQuery,
  ): Promise<Result<Sourced<readonly AirQualityReading[]>, DomainError>>;
}
