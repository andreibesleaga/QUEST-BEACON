// BEACON — EFFIS/GWIS adapter (E4·Part-B; adapter-contract §6, HazardSourcePort P1). Copernicus EFFIS/
// GWIS EU/global fire feed (burnt-area polygons + active-fire points) -> canonical HazardGeometry behind
// the shared redundancy ladder (live -> last-known-good cache -> recorded-mock -> unavailable).
// Implements BOTH the framework SourceAdapterPort<HazardGeometry> AND the outward HazardSourcePort, so
// the application depends only on the port, never on EFFIS/GWIS internals.
//
// DATA_SOURCE_VERIFICATION §1 ("Copernicus EFFIS / GWIS"): verdict CACHED, keyless, GLOBAL — the non-US
// equivalent of NIFC (official perimeters) sitting beside FIRMS (global hotspots). Endpoint hosts
// verified reachable 2026-06-29 (forest-fire.emergency.copernicus.eu / gwis.jrc.ec.europa.eu), but the
// DSV row itself notes access is "open WMS; acct only for raw burned-area extracts" — i.e. there is no
// confirmed keyless GeoJSON/ArcGIS REST *query* endpoint for burnt-area/active-fire features, which is
// exactly why this adapter's default mode is CACHED, not LIVE (see DEFAULT_BASE_URL comment below).
// Config-driven: endpoint/mode/timeout from SOURCE_EFFIS_* env.
import { fileURLToPath } from 'node:url';
import type { HazardGeometry, Result } from '@/domain/index.js';
import { DomainError, makeFreshness, ok as domainOk, err as domainErr } from '@/domain/index.js';
import type { Sourced } from '@/ports/infra.js';
import type { HazardSourcePort, AreaQuery } from '@/ports/data-sources.js';
import type {
  AdapterHealth,
  AdapterResult,
  BreakerConfig,
  Coverage,
  FetchResult,
  RedundancyEngine,
  Region,
  SourceAdapterPort,
  SourceConfig,
  SourceMode,
} from '@/adapters/_shared/index.js';
import { httpGetText, loadFixtureText, resolveSourceConfig } from '@/adapters/_shared/index.js';
import type { EffisFeature } from './effis-acl.js';
import { effisMapper, parseEffisFeatures } from './effis-acl.js';

const EFFIS_ID = 'effis';
const EFFIS_SOURCE = 'EFFIS/GWIS (Copernicus)';
const EFFIS_LICENSE = 'Copernicus/JRC open (attribution)';
// UNCONFIRMED exact query path (adapter-contract research gate, AGENTS.md §7/§14): the DSV row verifies
// the EFFIS/GWIS HOST is live and open, but EFFIS/GWIS does not publish a documented keyless GeoJSON/
// ArcGIS REST *query* endpoint for current burnt-area/active-fire features the way NASA FIRMS or NIFC's
// ArcGIS Hub do (raw burned-area extracts are account-gated per the DSV note). This URL is a best-effort
// default built from the verified host + the ArcGIS FeatureServer/query convention EFFIS/GWIS use
// elsewhere in their stack — it must be CONFIRMED (and SOURCE_EFFIS_URL set/overridden if different)
// before this adapter is ever flipped to LIVE. Until then it defaults to CACHED and is fully exercised
// via the recorded mock fixture, per Art. XVI total-redundancy (never a dead-end, never false certainty).
//
// CONFIRMED NEGATIVE, 2026-09-12. The live log read `HTTP 301` for this source and the redirect was
// followed BY HAND, once, to see where it goes: `forest-fire.emergency.copernicus.eu/...` now answers
// 301 to `data.effis.emergency.copernicus.eu/...`, and that host is an **S3 static-file portal** — it
// answers `/effis/rest/services` and every other path with `<Error><Code>NoSuchKey</Code>`, which is
// what an object store says, not what an ArcGIS server says. `maps.effis.emergency.copernicus.eu` does
// serve a 104 KB WMS GetCapabilities, so EFFIS publishes map IMAGES, not queryable features.
// So the guess above is not one redirect away from working; there is no keyless feature-query endpoint
// to point it at. This source stays CACHED, and the README line that called it "ours to fix, not theirs"
// has been corrected. Reopening it means either the WMS path (a different adapter shape entirely) or an
// account-gated extract — a decision, not a config edit.
const DEFAULT_BASE_URL =
  'https://forest-fire.emergency.copernicus.eu/effis/rest/services/CurrentSituation/BurntAreas/FeatureServer/0/query?f=geojson&where=1%3D1&outFields=*';
const MOCK_FIXTURE = 'burnt-areas.json';

const DEFAULT_BREAKER: BreakerConfig = { failureThreshold: 5, cooldownSec: 120, halfOpenTrials: 1 };
const DEFAULT_CACHE_TTL_SEC = 900;

export interface EffisAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string;
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
}

export class EffisAdapter implements SourceAdapterPort<HazardGeometry>, HazardSourcePort {
  readonly id = EFFIS_ID;
  readonly coverage: Coverage = { kind: 'GLOBAL' }; // EU/global fire feed; RO/non-US real coverage
  readonly mode: SourceMode;

  private readonly engine: RedundancyEngine;
  private readonly config: SourceConfig;
  private readonly fixturesDir: string;
  private readonly breaker: BreakerConfig;
  private readonly cacheTtlSec: number;

  constructor(deps: EffisAdapterDeps) {
    this.engine = deps.engine;
    this.config = deps.config;
    this.mode = deps.config.mode;
    this.fixturesDir =
      deps.fixturesDir ?? fileURLToPath(new URL('./__fixtures__', import.meta.url));
    this.breaker = deps.breaker ?? DEFAULT_BREAKER;
    this.cacheTtlSec = deps.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  }

  fetch(region: Region): Promise<AdapterResult<FetchResult<HazardGeometry>>> {
    return this.engine.run<EffisFeature, HazardGeometry>({
      adapterId: this.id,
      source: EFFIS_SOURCE,
      license: EFFIS_LICENSE,
      mode: this.mode,
      coverage: this.coverage,
      region,
      cacheTtlSec: this.cacheTtlSec,
      breaker: this.breaker,
      mapper: effisMapper,
      fetchLive: () => this.fetchLive(),
      loadMockRaw: () => this.loadMock(),
    });
  }

  health(): AdapterHealth {
    return this.engine.health(this.id, this.breaker);
  }

  /** Outward domain port (P1). Adapts a FetchResult to the Sourced envelope the application consumes. */
  async fetchHazards(
    query: AreaQuery,
  ): Promise<Result<Sourced<readonly HazardGeometry[]>, DomainError>> {
    const res = await this.fetch({ id: 'query', bbox: query.bbox });
    if (!res.ok) {
      return domainErr(
        new DomainError(
          'NOT_FOUND',
          `EFFIS/GWIS unavailable (${res.error.kind}): ${res.error.message}`,
        ),
      );
    }
    const data = res.value.records.map((r) => r.entity);
    return domainOk({ data, freshness: makeFreshness(res.value.freshness) });
  }

  private async fetchLive(): Promise<readonly EffisFeature[]> {
    // The current-situation query returns the global feature set; region filtering happens downstream
    // (COP), mirroring gdacs-adapter.ts's global feed pattern.
    const base = this.config.url ?? DEFAULT_BASE_URL;
    const json = await httpGetText(base, { timeoutMs: this.config.timeoutMs });
    return parseEffisFeatures(json);
  }

  private async loadMock(): Promise<readonly EffisFeature[]> {
    const res = await loadFixtureText(this.fixturesDir, MOCK_FIXTURE);
    if (!res.ok) throw res.error;
    return parseEffisFeatures(res.value);
  }
}

/** Factory: resolve SOURCE_EFFIS_* config from env. Fail-fast (CONFIG) on a bad mode/url. Defaults to
 * CACHED (not LIVE) per the endpoint-confirmation caveat on DEFAULT_BASE_URL above. */
export function makeEffisAdapter(
  engine: RedundancyEngine,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AdapterResult<EffisAdapter> {
  const cfg = resolveSourceConfig({
    prefix: 'EFFIS',
    env,
    defaultMode: 'CACHED',
    defaultUrl: DEFAULT_BASE_URL,
  });
  if (!cfg.ok) return cfg;
  return { ok: true, value: new EffisAdapter({ engine, config: cfg.value }) };
}
