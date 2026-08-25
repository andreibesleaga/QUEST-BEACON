// BEACON — live-composition helper (Phase-B B1 integration; Art. XVI). The ONE place that turns the wired
// source-adapter registry into the derivation-input seeds the engines compute over, when
// DATA_SOURCE_COMPOSITION=adapters. Builds ONE registry PER region (from config/adapters.json, each with that
// region's regions.json source_mode_overrides applied — env SOURCE_*_MODE still wins per-row) and assembles
// BOTH the core seed (SitRep inputs) and the map seed (COP geometry) region-by-region, so a region's CACHED/
// MOCK overrides actually reach its adapters and one region's override never bleeds into another. Fail-open:
// any registry/region failure returns null → the caller keeps the offline DEFAULT_SEED (never dead-ends).
//
// The runtime deps (adapter-registry, region-registry, seeds) are DYNAMICALLY imported inside the function —
// they read files via fileURLToPath(import.meta.url) at module load, which throws in a browser-like test env
// (happy-dom). Merely importing this module (e.g. transitively from the HTTP dispatcher into a frontend
// contract test) must stay side-effect-free; the filesystem modules load only when live mode is engaged.
import type { Env } from '@/config/index.js';
import type { CoreSeed, IncidentSeed } from '@/adapters/memory/memory-core.js';
import type { MapInputsSeed } from '@/adapters/memory/memory-map.js';
import type { MapDerivationInput } from '@/application/derivation/derive-cop.js';
import type { SourceView } from '@/application/interaction/command-router.js';
import type { LoadedRegion, RegionRegistry } from '@/adapters/persistence/region-registry.js';
import type { AdapterResult, SourceAdapterPort } from '@/adapters/_shared/index.js';

/** A wired adapter registry keyed by manifest id (one per region so per-region overrides don't collide). */
type Registry = Map<string, SourceAdapterPort>;

/** The live derivation-input seeds assembled from the source adapters (both COP-facing composition paths). */
export interface LiveSeeds {
  readonly coreSeed: CoreSeed;
  readonly mapSeed: MapInputsSeed;
}

/**
 * Build ONE adapter registry per region so each region's regions.json `enabled_adapters` ALLOWLIST and
 * `source_mode_overrides` reach buildAdapterRegistry (env SOURCE_*_MODE still WINS per-row via
 * resolveEntryEnv, and the manifest.mode is the final fallback). A separate registry (its own
 * RedundancyEngine) per region means a CACHED/MOCK override on one region can never bleed into another —
 * and now that the allowlist is enforced, a source a region did not enable is not even instantiated for it.
 * Registry construction is cheap factory instantiation. Returns null (fail-open, Art. XVI) if ANY region's
 * registry fails to build — the caller keeps the offline DEFAULT_SEED. The whole LoadedRegion is handed to
 * `build` so the allowlist and the overrides can never drift apart at this seam (B1.3, finding F-05).
 * Exported to unit-test the per-region allowlist/override threading + isolation without a live network.
 */
export function buildRegionRegistries(
  regions: RegionRegistry,
  build: (region: LoadedRegion) => AdapterResult<Registry>,
): Map<string, Registry> | null {
  const byRegion = new Map<string, Registry>();
  for (const region of regions.regions) {
    const built = build(region);
    if (!built.ok) return null;
    byRegion.set(region.configId, built.value);
  }
  return byRegion;
}

/**
 * Labelled fail-open (found 2026-08-04): the offline-seed fallback is a REAL Art. XVI guarantee and stays —
 * but a silent one turned a one-row CONFIG error into "every source is MOCK" with zero diagnostic, which
 * cost a full debugging session. Under LOG_LEVEL=debug (or BEACON_DEBUG_LIVE=1) the reason the COP fell
 * back to the offline seed is printed; in every other posture it stays silent as before.
 */
function makeDebugLive(config: Env, rawEnv: Record<string, string | undefined>): (msg: string) => void {
  return config.LOG_LEVEL === 'debug' || rawEnv.BEACON_DEBUG_LIVE === '1'
    ? (msg: string): void => console.error(`[live-composition] ${msg} → falling back to offline seed`)
    : (): void => {};
}

/** Render an unknown thrown value for the debug label (stack when available, message/String otherwise). */
function errorText(e: unknown): string {
  return e instanceof Error ? (e.stack ?? e.message) : String(e);
}

/**
 * Assemble the live core + map seeds when DATA_SOURCE_COMPOSITION=adapters; otherwise (or on any registry/
 * region-registry failure) return null so the caller falls back to the offline defaults. The RAW env is read
 * (SOURCE_*_MODE + the composition flag live outside EnvSchema). `nowIso`/`idGen` keep the RedundancyEngine
 * deterministic under an injected clock.
 */
export async function assembleLiveSeeds(
  config: Env,
  rawEnv: Record<string, string | undefined>,
  clock: () => string,
  newId: (prefix: string) => string,
): Promise<LiveSeeds | null> {
  if (rawEnv.DATA_SOURCE_COMPOSITION !== 'adapters') return null;
  const debugLive = makeDebugLive(config, rawEnv); // labelled fail-open — see makeDebugLive
  // Fully fail-open (Art. XVI): ANY unexpected throw (a dynamic import, the registry build, or an assembly
  // await) returns null → the caller keeps the offline DEFAULT_SEED. Live is an added rung, never a way to
  // break the COP.
  try {
    const [{ makeCachePort }, { loadRegionRegistry }, { buildAdapterRegistry }, { assembleLiveCoreSeed, assembleLiveMapSeed }, { DEFAULT_SEED }, { DEFAULT_MAP_SEED }] =
      await Promise.all([
        import('@/adapters/cache/index.js'),
        import('@/adapters/persistence/region-registry.js'),
        import('./adapter-registry.js'),
        import('./live-seed.js'),
        import('./seed.js'),
        import('./map-seed.js'),
      ]);
    const regions = loadRegionRegistry();
    if (!regions.ok) {
      debugLive(`region registry failed to load: ${regions.error.message}`);
      return null;
    }
    // ONE registry per region so each region's enabled_adapters allowlist AND source_mode_overrides
    // (regions.json) reach buildAdapterRegistry (env SOURCE_*_MODE still wins per-row). A shared CachePort
    // backs them (last-known-good is source-keyed, as before); the per-region RedundancyEngines keep one
    // region's override from bleeding into another. The allowlist makes "add a region by config" true in the
    // other direction too: a region only ever consults the sources its config permits (F-05).
    const cache = makeCachePort(config.FEATURE_CACHE);
    const byRegion = buildRegionRegistries(regions.value, (region) => {
      const built = buildAdapterRegistry({
        cache,
        env: rawEnv,
        nowIso: clock,
        idGen: () => newId('rec'),
        sourceModeOverrides: region.sourceModeOverrides,
        enabledAdapters: region.region.enabledAdapters,
      });
      // Name the region + the exact row error — a one-adapter CONFIG failure fails the WHOLE region's
      // registry by design (never a half-built registry), so without this label it is undebuggable.
      if (!built.ok) debugLive(`region '${region.configId}' registry build failed: ${built.error.message}`);
      return built;
    });
    if (byRegion === null) return null;
    // CORE — enrich each region's incidents under ITS OWN registry, then merge back (preserving the incident
    // order + the per-region source projection GET /status reads). Sequential per region (NOT Promise.all):
    // that region's core + map assemblies fetch overlapping sources through its ONE RedundancyEngine, so a
    // concurrent run would race the per-source breaker/last-known-good state.
    const enrichedById = new Map<string, IncidentSeed>();
    const sources: Record<string, readonly SourceView[]> = { ...DEFAULT_SEED.sources };
    for (const regionId of new Set(DEFAULT_SEED.incidents.map((i) => i.regionId))) {
      const registry = byRegion.get(regionId)!; // aligned with regions.json; a miss fails open via the outer catch
      const incidents = DEFAULT_SEED.incidents.filter((i) => i.regionId === regionId);
      const enrichedSeed = await assembleLiveCoreSeed(registry, regions.value, { ...DEFAULT_SEED, incidents }, clock);
      for (const inc of enrichedSeed.incidents) enrichedById.set(inc.id, inc);
      sources[regionId] = enrichedSeed.sources[regionId]!;
    }
    const coreSeed: CoreSeed = { ...DEFAULT_SEED, incidents: DEFAULT_SEED.incidents.map((i) => enrichedById.get(i.id)!), sources };
    // MAP — assembleLiveMapSeed is already region-keyed, so slice it per region (its own registry) + merge.
    const mapSeed: Record<string, MapDerivationInput> = { ...DEFAULT_MAP_SEED };
    for (const regionId of Object.keys(DEFAULT_MAP_SEED)) {
      const registry = byRegion.get(regionId)!;
      // Pass the registry so bbox/iso come from config — never from a duplicated fallback table (F-06).
      Object.assign(mapSeed, await assembleLiveMapSeed(registry, { [regionId]: DEFAULT_MAP_SEED[regionId]! }, clock, regions.value));
    }
    return { coreSeed, mapSeed };
  } catch (e) {
    debugLive(`live assembly threw: ${errorText(e)}`);
    return null;
  }
}
