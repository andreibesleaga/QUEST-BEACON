// BEACON — runtime adapter registry (Phase-B B1; FR-10 zero-core-change, adapter-contract §5, Art. XVI).
// The previously-absent LIVE caller for config/adapters.json + the 30 make*Adapter factories. It reads and
// VALIDATES the manifest at boot (fail-fast, no throw), then builds a registry keyed by manifest id, each
// adapter sharing ONE RedundancyEngine. Adding a source stays "one manifest row + one adapter file": the
// only edit here is a new entry in the TYPED STATIC ADAPTER_FACTORIES map (a boot-safe, honest binding —
// we do NOT dynamic-import the manifest `module` string). Mode precedence per row: env SOURCE_<PREFIX>_MODE
// → regions.json source_mode_overrides → manifest.mode; the resolved mode is fed to the factory via env so
// its resolveSourceConfig still fail-fasts on a LIVE-without-key.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CachePort } from '@/ports/infra.js';
import type { AdapterResult, Env, Manifest, ManifestEntry, SourceAdapterPort } from '@/adapters/_shared/index.js';
import { RedundancyEngine, validateManifest, makeAdapterError, ok, err } from '@/adapters/_shared/index.js';
import { makeFirmsAdapter } from '@/adapters/sources/firms/firms-adapter.js';
import { makeNwsAdapter } from '@/adapters/sources/nws/nws-adapter.js';
import { makeNwpsAdapter } from '@/adapters/sources/nwps/nwps-adapter.js';
import { makeGlofasAdapter } from '@/adapters/sources/glofas/glofas-adapter.js';
import { makeGdacsAdapter } from '@/adapters/sources/gdacs/gdacs-adapter.js';
import { makeMeteoalarmRoAdapter } from '@/adapters/sources/meteoalarm-ro/meteoalarm-ro-adapter.js';
// B3.1: the SAME generic MeteoAlarm adapter, one factory per country feed (zero new parsing code).
import { makeMeteoalarmEsAdapter, makeMeteoalarmGrAdapter } from '@/adapters/sources/meteoalarm/meteoalarm-adapter.js';
// B3.2: WMO-SWIC CAP relay (first configured source `ph-pagasa-en` — PAGASA-DOST, CC BY 4.0).
import { makeWmoSwicAdapter } from '@/adapters/sources/wmo-swic/wmo-swic-adapter.js';
import { makeOpenMeteoAdapter } from '@/adapters/sources/open-meteo/open-meteo-adapter.js';
import { makeUsgsWaterAdapter } from '@/adapters/sources/usgs-water/usgs-water-adapter.js';
// Phase-D catalog completion (the full portal-named source set — see PHASE3-FULL-DELIVERY-PLAN.md W1):
import { makeGdeltAdapter } from '@/adapters/sources/gdelt/gdelt-adapter.js';
import { makeReliefWebAdapter } from '@/adapters/sources/reliefweb/reliefweb-adapter.js';
import { makeAgencyRssAdapter } from '@/adapters/sources/agency-rss/agency-rss-adapter.js';
import { makeBlueskyAdapter } from '@/adapters/sources/bluesky/bluesky-adapter.js';
import { makeMastodonAdapter } from '@/adapters/sources/mastodon/mastodon-adapter.js';
// S2 Lane A3: weather / population / infrastructure depth.
import { makeMetnoAdapter } from '@/adapters/sources/metno/metno-adapter.js';
import { makeAnmAdapter } from '@/adapters/sources/anm/anm-adapter.js';
import { makeHdxPopAdapter } from '@/adapters/sources/hdxpop/hdxpop-adapter.js';
import { makeHifldAdapter } from '@/adapters/sources/hifld/hifld-adapter.js';
// S2 Lane A2: hazard/event + official-context corroboration.
import { makeEonetAdapter } from '@/adapters/sources/eonet/eonet-adapter.js';
import { makeCemsRmAdapter } from '@/adapters/sources/cemsrm/cemsrm-adapter.js';
import { makeOpenFemaAdapter } from '@/adapters/sources/openfema/openfema-adapter.js';
import { makeCapHubAdapter } from '@/adapters/sources/caphub/caphub-adapter.js';
import { makeLanceFloodAdapter } from '@/adapters/sources/lanceflood/lanceflood-adapter.js';
import { makeNriAdapter } from '@/adapters/sources/nri/nri-adapter.js';
import { makeNifcAdapter } from '@/adapters/sources/nifc/nifc-adapter.js';
import { makeEffisAdapter } from '@/adapters/sources/effis/effis-adapter.js';
import { makeOsmOverpassAdapter } from '@/adapters/sources/osm-overpass/osm-overpass-adapter.js';
import { makeWorldPopAdapter } from '@/adapters/sources/worldpop/worldpop-adapter.js';
import { makeCensusAdapter } from '@/adapters/sources/census/census-adapter.js';
import { makeNfhlAdapter } from '@/adapters/sources/nfhl/nfhl-adapter.js';
import { makeEagleIAdapter } from '@/adapters/sources/eagle-i/eagle-i-adapter.js';
import { makeOpenCelliDAdapter } from '@/adapters/sources/opencellid/opencellid-adapter.js';
import { makeItuAdapter } from '@/adapters/sources/itu/itu-adapter.js';
import { makeCamaraGsmaAdapter } from '@/adapters/sources/camara-gsma/camara-gsma-adapter.js';
// Live Views (CW1): camera directories (E11; ADR-027/028; CameraDirectoryPort P16).
// S3 Lane A: the AirQuality trio (P17) — registered the day their SitRep consumer landed (F-52 honoured:
// live-seed routes the AirQuality port to the airQuality slot, whose consumer is derive-cop's threshold fact).
import { makeOpenAqAdapter } from '@/adapters/sources/openaq/openaq-adapter.js';
import { makeAirNowAdapter } from '@/adapters/sources/airnow/airnow-adapter.js';
import { makeSensorCommunityAdapter } from '@/adapters/sources/sensorcommunity/sensorcommunity-adapter.js';
import { makeCaltransCctvAdapter } from '@/adapters/sources/caltrans-cctv/caltrans-cctv-adapter.js';
import { makeAlertWildfireAdapter } from '@/adapters/sources/alertwildfire/alertwildfire-adapter.js';
import { makeWindyWebcamsAdapter } from '@/adapters/sources/windy-webcams/windy-webcams-adapter.js';
import { makeDot511Adapter } from '@/adapters/sources/dot511/dot511-adapter.js';
import { makeCnadnrRoAdapter } from '@/adapters/sources/cnadnr-ro/cnadnr-ro-adapter.js';

/** A source-adapter factory: resolves SOURCE_<PREFIX>_* config from env, returns the wired port or CONFIG Err. */
export type AdapterFactory = (engine: RedundancyEngine, env: Env) => AdapterResult<SourceAdapterPort>;

/**
 * Manifest-id → factory. TYPED + STATIC by design: it is boot-safe (no dynamic import of the manifest
 * `module` string, which would defer failures to first use) and honest (the 30 wired sources are visible
 * at a glance). Adding a source = one manifest row + one adapter file + one entry here.
 */
export const ADAPTER_FACTORIES: Readonly<Record<string, AdapterFactory>> = {
  firms: makeFirmsAdapter,
  nws: makeNwsAdapter,
  nwps: makeNwpsAdapter,
  glofas: makeGlofasAdapter,
  gdacs: makeGdacsAdapter,
  'meteoalarm-ro': makeMeteoalarmRoAdapter,
  // B3 aggregators: MeteoAlarm per-country (one generic adapter) + the WMO-SWIC CAP relay. Enabled as of
  // B3.3 by exactly the zone each one's COUNTRIES coverage covers — `meteoalarm-es`→`es`,
  // `meteoalarm-gr`→`gr`, `wmo-swic`→`ph` — all three added as config rows, with no change to this file.
  'meteoalarm-gr': makeMeteoalarmGrAdapter,
  'meteoalarm-es': makeMeteoalarmEsAdapter,
  'wmo-swic': makeWmoSwicAdapter,
  'open-meteo': makeOpenMeteoAdapter,
  'usgs-water': makeUsgsWaterAdapter,
  // Phase-D: news/social intel
  gdelt: makeGdeltAdapter,
  reliefweb: makeReliefWebAdapter,
  'agency-rss': makeAgencyRssAdapter,
  bluesky: makeBlueskyAdapter,
  mastodon: makeMastodonAdapter,
  // S2 Lane A3
  metno: makeMetnoAdapter,
  anm: makeAnmAdapter,
  hdxpop: makeHdxPopAdapter,
  hifld: makeHifldAdapter,
  // S2 Lane A2
  eonet: makeEonetAdapter,
  cemsrm: makeCemsRmAdapter,
  openfema: makeOpenFemaAdapter,
  caphub: makeCapHubAdapter,
  lanceflood: makeLanceFloodAdapter,
  nri: makeNriAdapter,
  // Phase-D: fire perimeters (US + EU/global)
  nifc: makeNifcAdapter,
  effis: makeEffisAdapter,
  // Phase-D: infrastructure / population / flood zones / outages / telecom
  'osm-overpass': makeOsmOverpassAdapter,
  worldpop: makeWorldPopAdapter,
  census: makeCensusAdapter,
  nfhl: makeNfhlAdapter,
  'eagle-i': makeEagleIAdapter,
  opencellid: makeOpenCelliDAdapter,
  itu: makeItuAdapter,
  'camara-gsma': makeCamaraGsmaAdapter,
  // S3 Lane A: air quality (P17) — the trio held at S2 on F-52, registered with its SitRep consumer
  openaq: makeOpenAqAdapter,
  airnow: makeAirNowAdapter,
  sensorcommunity: makeSensorCommunityAdapter,
  // Live Views (CW1): camera directories
  'caltrans-cctv': makeCaltransCctvAdapter,
  alertwildfire: makeAlertWildfireAdapter,
  'windy-webcams': makeWindyWebcamsAdapter,
  dot511: makeDot511Adapter,
  'cnadnr-ro': makeCnadnrRoAdapter,
};

const MANIFEST_PATH = fileURLToPath(new URL('../../config/adapters.json', import.meta.url));
const SCHEMA_PATH = fileURLToPath(new URL('../../schemas/adapter-manifest.schema.json', import.meta.url));

/** Read + validate config/adapters.json against the manifest JSON Schema. Fail-fast CONFIG Err (never throws). */
export function loadManifest(manifestPath: string = MANIFEST_PATH, schemaPath: string = SCHEMA_PATH): AdapterResult<Manifest> {
  let raw: unknown;
  let schema: object;
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
    schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as object;
  } catch (e) {
    return err(makeAdapterError('CONFIG', `failed to read adapter manifest: ${String(e)}`, { retryable: false }));
  }
  return validateManifest(raw, schema);
}

/** Deps for {@link buildAdapterRegistry}. `manifest` is injectable (tests); otherwise it is loaded + validated. */
export interface BuildAdapterRegistryDeps {
  readonly cache: CachePort;
  readonly env: Env;
  readonly nowIso?: () => string;
  readonly idGen?: () => string;
  /** Injected manifest (tests); defaults to loadManifest(). */
  readonly manifest?: Manifest;
  /** regions.json source_mode_overrides for the active region (manifest-id → LIVE|CACHED|MOCK). */
  readonly sourceModeOverrides?: Readonly<Record<string, string>>;
  /**
   * The active region's `enabled_adapters` ALLOWLIST (config/regions.json → Region.enabledAdapters).
   * This is the one place the allowlist is ENFORCED (B1.3, finding F-05: it used to be parsed, persisted
   * and drift-guarded but consumed by nothing, so every manifest row was built for every region).
   *
   * Two DELIBERATE, documented, tested semantics — they are NOT the same case:
   *  • OMITTED (`undefined`) ⇒ the caller is NOT region-scoped (the redundancy acceptance harness, a
   *    per-adapter test): every manifest row is built, exactly as before this field existed.
   *  • PRESENT ⇒ it IS the allowlist: only manifest rows whose id appears are built. An EMPTY array is
   *    therefore an EMPTY allowlist ⇒ ZERO adapters — never "all". Silently widening an empty allowlist to
   *    the whole manifest would send a region's queries to sources its operator deliberately did not
   *    enable (licensing/sovereignty), which is the opposite of an allowlist. The result degrades, it does
   *    not break: an absent adapter is simply never consulted, so every slice keeps its hand-seeded value
   *    with its own honest mode label and nothing is ever mislabelled LIVE (Art. XVI).
   * Every SHIPPED region has a non-empty allowlist — asserted in region-registry.test.ts, so the
   * empty-allowlist branch can never be reached silently in production.
   */
  readonly enabledAdapters?: readonly string[];
}

/**
 * The manifest rows a region is PERMITTED to build. An OMITTED allowlist means "not region-scoped" ⇒ every
 * row; a PRESENT one is the allowlist ⇒ only its ids, and an EMPTY one therefore permits NOTHING (see
 * {@link BuildAdapterRegistryDeps.enabledAdapters} for why that is the honest reading, not "all").
 *
 * An allowlisted id with NO manifest row simply grants nothing — it cannot conjure an adapter — and is not an
 * error here: the regions↔manifest drift-guard test (region-registry.test.ts) is the enforcement point for
 * that typo, so a stale config id can never take down live composition for every region at runtime.
 */
function permittedRows(rows: readonly ManifestEntry[], enabled: readonly string[] | undefined): readonly ManifestEntry[] {
  if (enabled === undefined) return rows;
  const allowed = new Set(enabled);
  return rows.filter((row) => allowed.has(row.id));
}

/**
 * Build the runtime adapter registry: validate the manifest, then for each row PERMITTED BY THE REGION'S
 * ALLOWLIST call its factory with a mode-resolved env (env > region-override > manifest.mode), collecting
 * the wired ports into a Map keyed by manifest id. ONE shared RedundancyEngine backs every adapter (shared
 * breaker/cache state). Any CONFIG Err (unknown id, LIVE without key, bad manifest) on a row that IS built
 * short-circuits fail-fast — the caller never gets a half-built registry, and nothing throws.
 *
 * The allowlist filter runs BEFORE the factory lookup, on purpose: a manifest row a region does not enable
 * must not be able to fail that region's boot (Art. XVI — a misconfigured row degrades to "this region does
 * not consult that source", it never dead-ends a region that never wanted it). The global "every manifest id
 * has a factory" invariant is not lost: it is still enforced for every unscoped caller and asserted directly
 * in adapter-registry.test.ts.
 */
export function buildAdapterRegistry(deps: BuildAdapterRegistryDeps): AdapterResult<Map<string, SourceAdapterPort>> {
  const manifestRes = deps.manifest !== undefined ? ok(deps.manifest) : loadManifest();
  if (!manifestRes.ok) return manifestRes;

  const engine = new RedundancyEngine({
    cache: deps.cache,
    ...(deps.nowIso !== undefined ? { nowIso: deps.nowIso } : {}),
    ...(deps.idGen !== undefined ? { idGen: deps.idGen } : {}),
  });

  const registry = new Map<string, SourceAdapterPort>();
  // A row the region did not enable is never built ⇒ never fetched, never labelled, never mislabelled LIVE.
  for (const entry of permittedRows(manifestRes.value.adapters, deps.enabledAdapters)) {
    const factory = ADAPTER_FACTORIES[entry.id];
    if (factory === undefined) {
      return err(makeAdapterError('CONFIG', `no adapter factory registered for manifest id '${entry.id}'`, { retryable: false }));
    }
    const adapterRes = factory(engine, resolveEntryEnv(entry, deps.env, deps.sourceModeOverrides));
    if (!adapterRes.ok) return adapterRes;
    registry.set(entry.id, adapterRes.value);
  }
  return ok(registry);
}

/**
 * Resolve the env the factory sees so its SOURCE_<PREFIX>_MODE reflects the precedence env > region-override
 * > manifest.mode. When env already sets the mode, it is left untouched (env wins); otherwise the effective
 * mode (override, else manifest) is injected so the factory's fail-fast key checks still run.
 */
function resolveEntryEnv(entry: ManifestEntry, env: Env, overrides?: Readonly<Record<string, string>>): Env {
  const prefix = entry.configPrefix;
  if (prefix === undefined) return env;
  const key = `SOURCE_${prefix}_MODE`;
  const fromEnv = env[key];
  if (fromEnv !== undefined && fromEnv !== '') return env;
  const effective = overrides?.[entry.id] ?? entry.mode;
  return { ...env, [key]: effective };
}
