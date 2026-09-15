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
import type { IncidentSnapshotPort, ProvenanceSinkPort } from '@/ports/infra.js';
import type { SliceMemo } from './live-seed.js';
import type { LivePicture } from './live-seed.js';
import { loadReferenceRegistry } from '@/adapters/persistence/reference-registry.js';
import { makeSpatialPort } from '@/adapters/spatial/index.js';
import type { SpatialPort } from '@/ports/infra.js';
import { makeThresholdRule } from '@/domain/threshold-rule.js';
import type { ThresholdRule } from '@/domain/threshold-rule.js';
import type { Geometry } from '@/domain/value-objects/geo.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { RegionId, SourceId, ThresholdRuleId } from '@/domain/value-objects/ids.js';
import type { ThresholdAlertSpec } from '@/application/derivation/derive-alerts.js';
import type { RuleRuntimeState } from '@/application/threshold-evaluation/threshold-evaluation.js';
import {
  clusterFootprint,
  liveThresholdSpecs,
  nextRuleStates,
} from '@/application/threshold-evaluation/live-signals.js';
import type { AdapterResult, SourceAdapterPort } from '@/adapters/_shared/index.js';

/** A wired adapter registry keyed by manifest id (one per region so per-region overrides don't collide). */
type Registry = Map<string, SourceAdapterPort>;

/** The live derivation-input seeds assembled from the source adapters (both COP-facing composition paths). */
export interface LiveSeeds {
  readonly coreSeed: CoreSeed;
  readonly mapSeed: MapInputsSeed;
  /** Present under the live-only picture: what the feature layer needs about the discovered incidents. */
  readonly overlay?: LiveFeatureOverlay;
}

/**
 * The feature-layer half of the live picture (ADR-044). The feature seed used to describe the demo
 * incidents only: their threshold specs, their hazard polygons (what a route avoids), their regions.
 * Under live-only those are the DISCOVERED incidents', computed from the picture just assembled.
 */
export interface LiveFeatureOverlay {
  /** Threshold specs with a live reading, carrying the evaluator's state from the previous cycle. */
  readonly thresholds: readonly ThresholdAlertSpec[];
  /** Every configured rule of every region — what GET /threshold-rules lists. */
  readonly thresholdRules: readonly ThresholdRule[];
  /** Discovered incident id → the footprint a road route must avoid. */
  readonly hazards: ReadonlyMap<string, Geometry>;
  /** Discovered incident id → region id (what an approved alert is published under). */
  readonly incidentRegions: ReadonlyMap<string, string>;
  /**
   * Hybrid picture: the seeded demo incident is still served, so its seeded specs keep running BESIDE the
   * live ones. Live-only: the live specs REPLACE them (the demo's specs would draft for incidents the COP
   * no longer serves). Decided by the picture, not by the caller (2026-09-14).
   */
  readonly keepSeeded: boolean;
}

/** Where the rules come from: the table under Postgres, the configuration file otherwise. */
export type ThresholdRulesSource = () => Promise<readonly ThresholdRule[]>;

export interface LiveOverlayOptions {
  readonly spatial?: SpatialPort;
  /** The rules to evaluate; absent ⇒ the configured reference rules. */
  readonly rules?: readonly ThresholdRule[];
  readonly keepSeeded?: boolean;
}

/** The configured reference rules (config/reference-data.json), every region. */
export function configuredThresholdRules(): readonly ThresholdRule[] {
  const reference = loadReferenceRegistry();
  return reference.ok ? reference.value.thresholdRules.map(ruleOf) : [];
}

/**
 * The evaluator's per-alert runtime state (edge / dwell / cooldown), kept for the life of the process so
 * a rule that fired five minutes ago does not fire again on every reingest. In memory on purpose: a
 * restart re-evaluates from a clean state, which errs on the side of a draft the operator can decline.
 */
const LIVE_RULE_STATE = new Map<string, RuleRuntimeState>();

/** Tests only. */
export function resetLiveRuleState(): void {
  LIVE_RULE_STATE.clear();
}

/** A configured reference rule as the domain rule the evaluator takes, scoped to its region. */
function ruleOf(r: {
  readonly domainId: string;
  readonly regionConfigId: string;
  readonly target: ThresholdRule['target'];
  readonly operator: ThresholdRule['operator'];
  readonly value: string;
  readonly hysteresis?: number;
  readonly cooldown?: number;
}): ThresholdRule {
  return makeThresholdRule({
    id: asId<ThresholdRuleId>(r.domainId),
    scope: asId<RegionId>(r.regionConfigId),
    target: r.target,
    operator: r.operator,
    value: r.value,
    ...(r.hysteresis !== undefined ? { hysteresis: r.hysteresis } : {}),
    ...(r.cooldown !== undefined ? { cooldown: r.cooldown } : {}),
  });
}

/** Build the overlay for the live-only picture from the seeds just assembled. */
export function liveOverlay(
  coreSeed: CoreSeed,
  mapSeed: MapInputsSeed,
  clock: () => string,
  options: LiveOverlayOptions = {},
): LiveFeatureOverlay {
  const spatial = options.spatial ?? makeSpatialPort();
  const rules = options.rules ?? configuredThresholdRules();
  const computedAt = clock();
  const now = Date.parse(computedAt);
  const thresholds: ThresholdAlertSpec[] = [];
  const hazards = new Map<string, Geometry>();
  const incidentRegions = new Map<string, string>();
  for (const [regionId, map] of Object.entries(mapSeed)) {
    const incidents = coreSeed.incidents
      .filter((i) => String(i.regionId) === regionId)
      .map((i) => ({
        id: i.id,
        type: i.type,
        hazards: i.derivation.hazards,
        sourceId: asId<SourceId>(String(i.provenance[0]?.sourceId ?? 'unknown')),
      }));
    for (const i of incidents) {
      incidentRegions.set(String(i.id), regionId);
      const footprint = clusterFootprint(i.hazards);
      if (footprint !== undefined) hazards.set(String(i.id), footprint);
    }
    const specs = liveThresholdSpecs({
      rules: rules.filter((r) => String(r.scope) === regionId),
      incidents,
      infrastructure: map.infrastructure,
      buffers: map.buffers,
      gauges: map.gauges,
      computedAt,
      spatial,
      previous: LIVE_RULE_STATE,
    });
    for (const [id, state] of nextRuleStates(specs, now)) LIVE_RULE_STATE.set(id, state);
    thresholds.push(...specs);
  }
  return {
    thresholds,
    thresholdRules: rules,
    hazards,
    incidentRegions,
    keepSeeded: options.keepSeeded ?? false,
  };
}

/** `fn` over `items`, at most `limit` at a time, results in input order. */
async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
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
function makeDebugLive(
  config: Env,
  rawEnv: Record<string, string | undefined>,
): (msg: string) => void {
  return config.LOG_LEVEL === 'debug' || rawEnv.BEACON_DEBUG_LIVE === '1'
    ? (msg: string): void =>
        console.error(`[live-composition] ${msg} → falling back to offline seed`)
    : (): void => {};
}

/**
 * Mirror the assembled per-region source projection into the durable store (ADR-039).
 *
 * FAIL-OPEN, deliberately: provenance is a RECORD of what happened, never a gate on serving it. A storage
 * outage must degrade the audit trail, not the common operating picture (Art. XVI). The failure is labelled
 * under the same debug switch as every other live-composition fallback, so it is diagnosable rather than
 * silent — the lesson already paid for once by the 2026-08-04 silent-fallback session.
 *
 * The same source may appear under several regions; it is written once per region entry and the upsert
 * collapses them onto one row, keeping the newest fetch instant.
 */
async function recordProvenance(
  sink: ProvenanceSinkPort | undefined,
  sources: Record<string, readonly SourceView[]>,
  licenses: ReadonlyMap<string, string>,
  debugLive: (msg: string) => void,
): Promise<void> {
  if (sink === undefined) return; // memory posture — nothing to mirror
  const entries = Object.values(sources).flatMap((views) =>
    views.map((v) => ({
      sourceId: v.sourceId,
      adapter: v.sourceId,
      mode: v.mode,
      fetchedAt: v.fetchedAt,
      // CARRY THE LICENCE (Copilot review, PR #10, 2026-09-11). Without it the column is written NULL,
      // `sourceRecordMapper.fromRow` turns NULL into '', and `makeSourceRecord` rejects an empty licence —
      // so a source that only ever appeared live would make the Postgres-backed `/sources` read throw for
      // everyone, including the rows that were perfectly fine. Art. XI is the reason the domain refuses an
      // unlicensed source record; the bug was writing one anyway.
      //
      // The value comes from the adapter manifest, which is where each source's licence is already
      // declared and NOTICE-tracked. An unknown id contributes no licence rather than a guessed one: a
      // fabricated licence string is a provenance lie, and omitting the row is the honest failure.
      ...(licenses.get(v.sourceId) !== undefined ? { license: licenses.get(v.sourceId)! } : {}),
    })),
  );
  try {
    const res = await sink.record(entries);
    if (!res.ok)
      debugLive(`provenance sink rejected ${entries.length} entries: ${res.error.message}`);
  } catch (e) {
    debugLive(`provenance sink threw: ${errorText(e)}`);
  }
}

/**
 * Mirror the COP's incidents into the durable store (ADR-039). Fail-open for the same reason as
 * `recordProvenance`, and INDEPENDENTLY of it: a broken incident write must not also cost us the
 * provenance record, which is the more load-bearing of the two.
 */
async function recordIncidents(
  sink: IncidentSnapshotPort | undefined,
  incidents: readonly {
    readonly id: string;
    readonly regionId: string;
    readonly type: string;
    readonly status: string;
  }[],
  debugLive: (msg: string) => void,
): Promise<void> {
  if (sink === undefined) return; // memory posture — nothing to mirror
  const snapshots = incidents.map((i) => ({
    incidentId: i.id,
    regionId: i.regionId,
    type: i.type,
    status: i.status,
  }));
  try {
    const res = await sink.record(snapshots);
    if (!res.ok)
      debugLive(`incident sink rejected ${snapshots.length} snapshots: ${res.error.message}`);
  } catch (e) {
    debugLive(`incident sink threw: ${errorText(e)}`);
  }
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
/**
 * The feature overlay of the picture (ADR-044). Both pictures evaluate the live rules over the discovered
 * incidents; the hybrid picture also keeps the seeded demo specs, since the demo incident is still served.
 * Until 2026-09-14 the hybrid picture carried no overlay at all — a deployment on `LIVE_PICTURE=hybrid`
 * never evaluated a live rule.
 */
function overlayFor(
  livePicture: LivePicture,
  coreSeed: CoreSeed,
  mapSeed: MapInputsSeed,
  clock: () => string,
  rules: readonly ThresholdRule[],
): Pick<LiveSeeds, 'overlay'> {
  return {
    overlay: liveOverlay(coreSeed, mapSeed, clock, { rules, keepSeeded: livePicture === 'hybrid' }),
  };
}

/** The rules this cycle evaluates: the source's answer, or the configuration when it has none (fail-open). */
async function rulesFrom(
  source: ThresholdRulesSource | undefined,
  debugLive: (msg: string) => void,
): Promise<readonly ThresholdRule[]> {
  if (source === undefined) return configuredThresholdRules();
  try {
    return await source();
  } catch (e) {
    debugLive(
      `threshold rules unreadable from the table (${errorText(e)}); configuration rules used`,
    );
    return configuredThresholdRules();
  }
}

/** `auto` is `live-only` on the adapters posture (the only posture this composition runs under). */
function pictureFor(config: Env): LivePicture {
  return config.LIVE_PICTURE === 'hybrid' ? 'hybrid' : 'live-only';
}

export async function assembleLiveSeeds(
  config: Env,
  rawEnv: Record<string, string | undefined>,
  clock: () => string,
  newId: (prefix: string) => string,
  /**
   * ADR-039 — durable provenance mirror, composed ONLY under `FEATURE_STORE=postgres`. Absent in the memory
   * posture, which therefore behaves byte-identically to before this parameter existed.
   */
  provenanceSink?: ProvenanceSinkPort,
  /** ADR-039 — durable incident mirror; composed alongside the provenance sink, failing independently. */
  incidentSink?: IncidentSnapshotPort,
  /** ADR-044 — the rules to evaluate (the table under Postgres); absent ⇒ the configuration file. */
  thresholdRules?: ThresholdRulesSource,
): Promise<LiveSeeds | null> {
  if (rawEnv.DATA_SOURCE_COMPOSITION !== 'adapters') return null;
  const debugLive = makeDebugLive(config, rawEnv); // labelled fail-open — see makeDebugLive
  // Fully fail-open (Art. XVI): ANY unexpected throw (a dynamic import, the registry build, or an assembly
  // await) returns null → the caller keeps the offline DEFAULT_SEED. Live is an added rung, never a way to
  // break the COP.
  try {
    const [
      { makeCachePort },
      { loadRegionRegistry },
      { buildAdapterRegistry, loadManifest },
      { assembleLiveCoreSeed, assembleLiveMapSeed },
      { DEFAULT_SEED },
      { DEFAULT_MAP_SEED },
    ] = await Promise.all([
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
    // sourceId → licence, straight from the validated adapter manifest (the NOTICE-tracked declaration).
    // Empty when the manifest cannot be read: no licence is written, which is recoverable, rather than a
    // wrong one, which is not.
    const manifest = loadManifest();
    const sourceLicenses = new Map<string, string>(
      manifest.ok ? manifest.value.adapters.map((a) => [a.id, a.license] as const) : [],
    );
    if (!manifest.ok)
      debugLive(`adapter manifest unreadable for licences: ${manifest.error.message}`);
    const byRegion = buildRegionRegistries(regions.value, (region) => {
      const built = buildAdapterRegistry({
        cache,
        env: rawEnv,
        nowIso: clock,
        idGen: () => newId('rec'),
        sourceModeOverrides: region.sourceModeOverrides,
        enabledAdapters: region.region.enabledAdapters,
      });
      // Since 2026-09-12 a one-adapter CONFIG failure no longer fails the region: the row is excluded and
      // reported by buildAdapterRegistry itself (`source excluded from registry`, stderr, unconditional).
      // What CAN still fail the whole region is a manifest/code disagreement, which is a build defect.
      if (!built.ok)
        debugLive(`region '${region.configId}' registry build failed: ${built.error.message}`);
      return built;
    });
    if (byRegion === null) return null;
    // CORE — enrich each region's incidents under ITS OWN registry, then merge back (preserving the incident
    // order + the per-region source projection GET /status reads). Sequential per region (NOT Promise.all):
    // that region's core + map assemblies fetch overlapping sources through its ONE RedundancyEngine, so a
    // concurrent run would race the per-source breaker/last-known-good state.
    const enrichedById = new Map<string, IncidentSeed>();
    const sources: Record<string, readonly SourceView[]> = { ...DEFAULT_SEED.sources };
    // ONE memo for the whole run, shared by the SitRep pass and the map pass below. They consult
    // overlapping sources for the same region — FIRMS, NIFC, the gauges and the weather all feed both —
    // and every one of those was being fetched twice per composition. The memo is keyed by region AND
    // adapter, so nothing crosses a region boundary, and it is thrown away with the run, so no answer here
    // is older than the composition itself. Measured cost before this change: 247 s.
    const memo: SliceMemo = new Map();
    // ADR-043 — what the picture is made of. `auto` is `live-only` here: this function only runs under
    // DATA_SOURCE_COMPOSITION=adapters, and on the live posture the owner wants only current live
    // reportings; `hybrid` (the seeded demo enriched by live slices) stays available by name.
    const livePicture = pictureFor(config);
    const regionIds = [...new Set(DEFAULT_SEED.incidents.map((i) => i.regionId))];
    // Regions in parallel, bounded (LIVE_REGION_CONCURRENCY): each region has its own registry and
    // engine and its own last-known-good keys, so nothing is shared; the memo is region-keyed too.
    const perRegion = await mapLimited(
      regionIds,
      config.LIVE_REGION_CONCURRENCY,
      async (regionId) => {
        const registry = byRegion.get(regionId)!; // aligned with regions.json; a miss fails open via the outer catch
        const incidents = DEFAULT_SEED.incidents.filter((i) => i.regionId === regionId);
        const enrichedSeed = await assembleLiveCoreSeed(
          registry,
          regions.value,
          { ...DEFAULT_SEED, incidents },
          clock,
          memo,
          { livePicture },
        );
        return { regionId, enrichedSeed };
      },
    );
    for (const { regionId, enrichedSeed } of perRegion) {
      for (const inc of enrichedSeed.incidents) enrichedById.set(inc.id, inc);
      sources[regionId] = enrichedSeed.sources[regionId]!;
    }
    // Seeded incidents first, in their seeded order; then every incident the per-region assembly FOUND.
    // Until 2026-09-13 this line mapped over DEFAULT_SEED only, so the discovered incidents that
    // `assembleLiveCoreSeed` appends (V3 §3.1) were composed, mirrored nowhere and served never — the
    // live deployment listed the demo fire beside 77 unclaimed hotspots and nine perimeters.
    const seededIds = new Set(DEFAULT_SEED.incidents.map((i) => i.id));
    const coreSeed: CoreSeed = {
      ...DEFAULT_SEED,
      incidents: [
        // Seeded first, in seeded order — absent altogether under live-only, where the assembly returned
        // only what it discovered (ADR-043).
        ...DEFAULT_SEED.incidents.flatMap((i) => {
          const enrichedIncident = enrichedById.get(i.id);
          return enrichedIncident === undefined ? [] : [enrichedIncident];
        }),
        ...[...enrichedById.values()].filter((i) => !seededIds.has(i.id)),
      ],
      sources,
    };
    // ADR-039 — mirror the sources the COP ACTUALLY consulted into the durable store, so `/sources` under
    // FEATURE_STORE=postgres stops reading a table only the reference seed ever filled. Deliberately placed
    // on the assembled projection rather than inside each adapter: this is the same `SourceView[]` the API
    // renders, so the row and the screen cannot drift. Awaited (not fire-and-forget) so a failure is
    // observable in the debug label — but never fatal: see recordProvenance.
    await recordProvenance(provenanceSink, sources, sourceLicenses, debugLive);
    // The picture itself, not just who supplied it: the incidents the COP is serving, upserted on their
    // natural key. This is also what gives SitRep history something to reference (ADR-039).
    await recordIncidents(incidentSink, coreSeed.incidents, debugLive);
    // MAP — assembleLiveMapSeed is already region-keyed, so slice it per region (its own registry) + merge.
    const mapSeed: Record<string, MapDerivationInput> = { ...DEFAULT_MAP_SEED };
    const mapSlices = await mapLimited(
      Object.keys(DEFAULT_MAP_SEED),
      config.LIVE_REGION_CONCURRENCY,
      (regionId) =>
        assembleLiveMapSeed(
          byRegion.get(regionId)!,
          { [regionId]: DEFAULT_MAP_SEED[regionId]! },
          clock,
          regions.value,
          memo,
          { livePicture },
        ),
    );
    for (const slice of mapSlices) Object.assign(mapSeed, slice);
    // ADR-044 — the feature layer's view of the discovered incidents: live threshold specs, the
    // footprints routes avoid, and each incident's region.
    const rules = await rulesFrom(thresholdRules, debugLive);
    return { coreSeed, mapSeed, ...overlayFor(livePicture, coreSeed, mapSeed, clock, rules) };
  } catch (e) {
    debugLive(`live assembly threw: ${errorText(e)}`);
    return null;
  }
}
