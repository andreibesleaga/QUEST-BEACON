// BEACON — shipped-region registry, client-safe view (ADR-011/ADR-031; FR-ZONE-1/7). Pure and env-free, so
// the browser and the server read the SAME `config/regions.json` and there is exactly one answer to "which
// regions exist". Mirrors the `src/config/locales.ts` pattern deliberately: config is the single source of
// truth, and a UI list derived from it can never drift from the registry the engine queries.
//
// Scope: this exposes only what the UI legitimately needs — identity, geography, timezone and languages.
// It does NOT expose `enabled_adapters` or `source_mode_overrides`: those are operational posture, the
// server is authoritative for them, and the client has no business branching on them.
//
// NOTE: the region SELECTOR LABEL does not come from here. `name` in the config is an operator-facing
// English string; the UI renders `shell.region.<id>` from the message catalog so the selector translates
// (finding F-22 — deriving the label from config would also have broken four visual baselines).
import regionsConfig from '../../config/regions.json';

export interface ShippedRegion {
  readonly id: string;
  /** ISO-3166-1 alpha-2 of the containing country — decides country-scoped source coverage. */
  readonly iso: string;
  /** IANA timezone. Every timestamp displayed while this region is active is formatted in it. */
  readonly tz: string;
  /** BCP-47 tags, most significant first. Outbound alerts carry these AND English (FR-I18N-6). */
  readonly languages: readonly string[];
  /** [minLon, minLat, maxLon, maxLat] — the region's extent, never defaulted from another region. */
  readonly bbox: readonly number[];
}

interface RawRegion {
  readonly id: string;
  readonly iso?: string;
  readonly tz?: string;
  readonly languages?: readonly string[];
  readonly bbox?: readonly number[];
}

/** Every configured region, in registry order (which is the selector order). */
export const SHIPPED_REGIONS: readonly ShippedRegion[] = (
  regionsConfig.regions as readonly RawRegion[]
).map((r) => ({
  id: r.id,
  iso: r.iso ?? '',
  tz: r.tz ?? 'UTC',
  languages: r.languages ?? [],
  bbox: r.bbox ?? [],
}));

/** The region the COP opens on. */
export const DEFAULT_REGION_ID: string = regionsConfig.default_region_id;

/** Look up a configured region. Returns undefined rather than substituting another region (finding F-06). */
export function shippedRegion(id: string): ShippedRegion | undefined {
  return SHIPPED_REGIONS.find((r) => r.id === id);
}

/**
 * Timezone for a region. Falls back to UTC — an explicit, honest "no region context" rather than the
 * viewer's local zone, which would silently relabel a foreign incident's timeline as if it were local.
 */
export function regionTimeZone(id: string | undefined): string {
  return (id === undefined ? undefined : shippedRegion(id)?.tz) ?? 'UTC';
}
