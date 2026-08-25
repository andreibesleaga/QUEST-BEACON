// BEACON — MeteoAlarm Romania adapter (E4·T-177, Part-B; adapter-contract §6, NewsIntelPort P6). Official
// Romania weather warnings (the EU non-US equivalent) → canonical NewsItem behind the shared redundancy
// ladder (live → last-known-good cache → recorded-mock → typed unavailable).
//
// B3.1 WIDENING, backward-compatible ALIAS ROW: the adapter logic now lives in the generic
// `../meteoalarm/meteoalarm-adapter.ts` (one class, N country feeds — Greece/Spain presets there).
// This module keeps the ORIGINAL public surface — `MeteoalarmRoAdapter`, `MeteoalarmRoAdapterDeps`,
// `makeMeteoalarmRoAdapter`, id `meteoalarm-ro`, env prefix SOURCE_METEOALARM_RO_*, recorded fixture
// `__fixtures__/romania-atom.xml` — so the `ro` region's allowlist, the manifest row and every existing
// test keep working unchanged (pinned by the untouched meteoalarm-ro-adapter.test.ts).
//
// DATA_SOURCE_VERIFICATION §10.1/§10.4: verified tier CACHED, keyless legacy Atom, CC-BY-4.0-equivalent,
// coverage Romania (all 42 counties). The feed has NO geometry (only county + awareness codes) → honest
// NewsItem advisory mapping (see ../meteoalarm/meteoalarm-acl.ts header). Config-driven: mode/url/timeout
// from SOURCE_METEOALARM_RO_* env. Default mode MOCK (air-gapped-first); the fixture is a real sample.
import { fileURLToPath } from 'node:url';
import type {
  AdapterResult,
  BreakerConfig,
  Env,
  RedundancyEngine,
  Region,
  SourceConfig,
} from '@/adapters/_shared/index.js';
import { ok, resolveSourceConfig } from '@/adapters/_shared/index.js';
import type { MeteoalarmFeed } from '../meteoalarm/meteoalarm-adapter.js';
import { MeteoalarmAdapter } from '../meteoalarm/meteoalarm-adapter.js';

const DEFAULT_BASE_URL = 'https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-romania';

// Romania bbox + ISO — the fixed region the outward NewsIntelPort queries (COUNTRIES coverage gate).
const RO_REGION: Region = { id: 'ro', bbox: [20, 43, 30, 48], iso: 'RO' };

const RO_FEED: MeteoalarmFeed = {
  adapterId: 'meteoalarm-ro',
  iso: 'RO',
  defaultUrl: DEFAULT_BASE_URL,
  newsRegion: RO_REGION,
  fixture: 'romania-atom.xml',
  fixturesDir: fileURLToPath(new URL('./__fixtures__', import.meta.url)),
};

export interface MeteoalarmRoAdapterDeps {
  readonly engine: RedundancyEngine;
  readonly config: SourceConfig;
  readonly fixturesDir?: string;
  readonly breaker?: BreakerConfig;
  readonly cacheTtlSec?: number;
}

export class MeteoalarmRoAdapter extends MeteoalarmAdapter {
  constructor(deps: MeteoalarmRoAdapterDeps) {
    super({ ...deps, feed: RO_FEED });
  }
}

/** Factory: resolve SOURCE_METEOALARM_RO_* config from env. Fail-fast (CONFIG) on a bad mode/url. */
export function makeMeteoalarmRoAdapter(
  engine: RedundancyEngine,
  env: Env = process.env,
): AdapterResult<MeteoalarmRoAdapter> {
  const cfg = resolveSourceConfig({
    prefix: 'METEOALARM_RO',
    env,
    defaultMode: 'MOCK',
    defaultUrl: DEFAULT_BASE_URL,
  });
  if (!cfg.ok) return cfg;
  return ok(new MeteoalarmRoAdapter({ engine, config: cfg.value }));
}
