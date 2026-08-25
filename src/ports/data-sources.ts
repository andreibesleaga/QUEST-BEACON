// BEACON — Data-source ports (E1·T-085; ADR-001 P1–P3). Hazard / weather / flood-gauge adapters.
// Interface signatures only — anti-corruption boundary; adapters normalize raw CSV/XML/GeoJSON → domain.
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { BBox } from '@/domain/value-objects/geo.js';
import type { Sourced } from './infra.js';
// Cross-cluster domain entities (E1 W1, written in parallel). Real types once those files land.
import type { HazardGeometry } from '@/domain/hazard-geometry.js'; // cross-cluster entity — E1·T-051 (hazard-geometry.ts)
import type { Gauge } from '@/domain/gauge.js'; // cross-cluster entity — E1·T-053 (gauge.ts)

/** Query window shared by the spatial source ports. */
export interface AreaQuery {
  readonly bbox: BBox;
  readonly since?: string; // ISO-8601 lower bound (freshness window)
}

// Wind/weather has no canonical entity; it feeds labeled first-order predictions (fire cone). Port-local DTO.
export interface WeatherObservation {
  readonly at: string; // ISO-8601
  readonly position: readonly [lon: number, lat: number];
  readonly windSpeedMs?: number;
  readonly windDirDeg?: number;
  readonly tempC?: number;
  readonly humidityPct?: number;
}

/** P1 — hazard footprints (FIRMS hotspots, EFFIS/GWIS perimeters, flood reach). */
export interface HazardSourcePort {
  fetchHazards(query: AreaQuery): Promise<Result<Sourced<readonly HazardGeometry[]>, DomainError>>;
}

/** P3 — weather observations/forecasts (NWS/MeteoAlarm). Numbers stay deterministic downstream. */
export interface WeatherSourcePort {
  fetchWeather(query: AreaQuery): Promise<Result<Sourced<readonly WeatherObservation[]>, DomainError>>;
}

/** P2 — flood gauges + crest forecast (NWPS/USGS/GloFAS). */
export interface FloodGaugePort {
  fetchGauges(query: AreaQuery): Promise<Result<Sourced<readonly Gauge[]>, DomainError>>;
}
