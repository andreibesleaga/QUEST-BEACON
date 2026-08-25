// BEACON — REGION entity (E1·T-047). Operating scope for a set of adapters/incidents.
// Pure domain: no framework/HTTP/DB imports (F9).
import type { RegionId } from './value-objects/ids.js';
import type { BBox } from './value-objects/geo.js';
import { InvariantViolation } from './errors.js';

// Enum mirrors schema.sql region.scope CHECK — keep values byte-identical to the DDL.
export const REGION_SCOPES = ['COMMUNITY', 'STATE', 'COUNTRY'] as const;
export type RegionScope = (typeof REGION_SCOPES)[number];

export interface Region {
  readonly id: RegionId;
  readonly name: string;
  readonly scope: RegionScope;
  readonly bbox: BBox;
  readonly enabledAdapters: readonly string[];
  /**
   * ISO-3166-1 alpha-2 country code (ADR-031). This is what decides whether a country-scoped adapter
   * covers the region — it used to live as a hardcoded map in the composition root, which silently made
   * "add a region by config" untrue for any third country.
   */
  readonly iso?: string;
  /** IANA timezone. Every timestamp shown for this region, and every CAP effective/expiry time, uses it. */
  readonly tz?: string;
  /**
   * The region's languages, most significant first. Drives multilingual alerting (region language +
   * English always, FR-I18N-6) and the coverage-completeness rule that a shipped zone's language ships
   * as a locale.
   */
  readonly languages?: readonly string[];
}

export interface MakeRegionInput {
  readonly id: RegionId;
  readonly name: string;
  readonly scope: RegionScope;
  readonly bbox: BBox;
  readonly enabledAdapters?: readonly string[];
  readonly iso?: string;
  readonly tz?: string;
  readonly languages?: readonly string[];
}

// A BBox is [minLon,minLat,maxLon,maxLat]; min must not exceed max or downstream geo math is undefined.
function assertBBox(bbox: BBox): void {
  if (!Array.isArray(bbox) || bbox.length !== 4 || bbox.some((n) => typeof n !== 'number' || Number.isNaN(n))) {
    throw new InvariantViolation('Region.bbox must be 4 numbers [minLon,minLat,maxLon,maxLat]');
  }
  const [minLon, minLat, maxLon, maxLat] = bbox;
  if (minLon > maxLon || minLat > maxLat) {
    throw new InvariantViolation('Region.bbox min corner must not exceed max corner');
  }
}

/**
 * Validate the optional locality metadata. Split out of `makeRegion` so each function stays inside the
 * complexity gate, and because these three fields form one concern: WHERE the region is and who reads it.
 * An `iso` typo is worth failing loudly on — it does not corrupt data, it silently switches off every
 * country-scoped source for that region, which looks like "no data available" rather than a config bug.
 */
function assertRegionMetadata(input: MakeRegionInput): void {
  if (input.iso !== undefined && !/^[A-Z]{2}$/.test(input.iso)) {
    throw new InvariantViolation(`Region.iso must be an ISO-3166-1 alpha-2 code, got ${input.iso}`);
  }
  if (input.languages?.some((l) => typeof l !== 'string' || l.length === 0)) {
    throw new InvariantViolation('Region.languages must be non-empty BCP-47 tags');
  }
}

export function makeRegion(input: MakeRegionInput): Region {
  if (input.name.trim().length === 0) {
    throw new InvariantViolation('Region.name must be non-empty');
  }
  if (!REGION_SCOPES.includes(input.scope)) {
    throw new InvariantViolation(`Region.scope must be one of ${REGION_SCOPES.join('|')}, got ${String(input.scope)}`);
  }
  assertBBox(input.bbox);
  const enabledAdapters = input.enabledAdapters ?? [];
  if (enabledAdapters.some((a) => typeof a !== 'string' || a.length === 0)) {
    throw new InvariantViolation('Region.enabledAdapters must be non-empty adapter id strings');
  }
  assertRegionMetadata(input);
  return {
    id: input.id,
    name: input.name,
    scope: input.scope,
    bbox: input.bbox,
    enabledAdapters: [...enabledAdapters],
    // Optional on the ENTITY (existing seeds and tests construct regions without them) but REQUIRED by
    // schemas/regions.schema.json, so every config-authored region must supply them.
    ...(input.iso !== undefined ? { iso: input.iso } : {}),
    ...(input.tz !== undefined ? { tz: input.tz } : {}),
    ...(input.languages !== undefined ? { languages: [...input.languages] } : {}),
  };
}
