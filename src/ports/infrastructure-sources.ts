// BEACON — Infrastructure/exposure source ports (E1·T-086; ADR-001 P4/P5/P12/P13).
// Interface signatures only — anti-corruption boundary; every response carries freshness (Sourced<T>).
import type { Result } from '@/domain/shared/result.js';
import type { DomainError } from '@/domain/errors.js';
import type { BBox } from '@/domain/value-objects/geo.js';
import type { Sourced } from './infra.js';
import type { AreaQuery } from './data-sources.js';
// Cross-cluster domain entity (E1 W1, written in parallel).
import type { InfrastructureNode } from '@/domain/infrastructure-node.js'; // cross-cluster entity — E1·T-055 (infrastructure-node.ts)

// Outage / telecom / population have no canonical entity — they feed EXPOSURE computation. Port-local DTOs.
export interface OutageRecord {
  readonly area: BBox; // affected area (e.g. EAGLE-I county granularity — stated honestly)
  readonly customersOut?: number;
  readonly observedAt: string; // ISO-8601
}

export interface TelecomCoverage {
  readonly position: readonly [lon: number, lat: number];
  readonly technology?: string; // e.g. LTE/5G/GSM (OpenCelliD)
  readonly online: boolean;
}

export interface PopulationEstimate {
  readonly area: BBox;
  readonly count: number; // deterministic WorldPop/HDX estimate
}

/** P4 — lifeline assets (Overpass/OSM: hospitals, power, cell, road, rail, shelters). */
export interface InfrastructurePort {
  fetchNodes(
    query: AreaQuery,
  ): Promise<Result<Sourced<readonly InfrastructureNode[]>, DomainError>>;
}

/** P5 — power/service outages (EAGLE-I or global-equivalent). */
export interface OutagePort {
  fetchOutages(query: AreaQuery): Promise<Result<Sourced<readonly OutageRecord[]>, DomainError>>;
}

/** P13 — telecom coverage/status (OpenCelliD). */
export interface TelecomPort {
  fetchCoverage(
    query: AreaQuery,
  ): Promise<Result<Sourced<readonly TelecomCoverage[]>, DomainError>>;
}

/** P12 — population exposure base (WorldPop/HDX-HAPI). */
export interface PopulationPort {
  estimatePopulation(area: BBox): Promise<Result<Sourced<PopulationEstimate>, DomainError>>;
}
