// BEACON — Adapter registry / manifest reader (E4·T-143/T-144; adapter-contract §5, manifest-schema,
// FR-10 zero-core-change). Parses config/adapters.json and VALIDATES it against the manifest JSON Schema
// at boot (fail-fast, U5). Adding a source = one manifest row + one adapter file; no core edit. The
// registry is data-driven, so Part-B adapters register a row here and derive their breaker/cache config.
import Ajv2020 from 'ajv/dist/2020.js'; // manifest + provenance schemas are JSON-Schema draft 2020-12
import addFormats from 'ajv-formats';
import type { AdapterResult, Coverage, SourceMode } from './contract.js';
import { ok, err } from './contract.js';
import type { BreakerConfig } from './circuit-breaker.js';
import { makeAdapterError } from './errors.js';

export interface ManifestEntry {
  readonly id: string;
  readonly port: string;
  readonly entity?: string;
  readonly source?: string;
  readonly module?: string;
  readonly coverage: Coverage;
  readonly mode: SourceMode;
  readonly intervalSec: number;
  readonly configPrefix?: string;
  readonly license: string;
  readonly attribution?: string;
  readonly cache?: { readonly ttlSec: number };
  readonly circuitBreaker?: {
    readonly failureThreshold: number;
    readonly cooldownSec: number;
    readonly halfOpenTrials?: number;
  };
  readonly mock?: { readonly fixture: string };
  readonly verifiedTier?: SourceMode;
  /**
   * FloodGauge adapters only: the unit this source publishes its `Gauge.stage` / `Gauge.crestForecast`
   * figures in, verbatim (e.g. 'ft', 'm³/s'). The entity carries plain numbers, so this is what lets a
   * served reading be stated as a LABELED figure (Art. XII); an adapter with no row here has its numeric
   * readings omitted rather than guessed. Per-ADAPTER, never per-region.
   */
  readonly gaugeUnit?: string;
}

export interface Manifest {
  readonly $schemaVersion?: string;
  readonly adapters: readonly ManifestEntry[];
}

/** Validate a parsed manifest against its JSON Schema. Fail-fast CONFIG on any violation (boot check). */
export function validateManifest(data: unknown, schema: object): AdapterResult<Manifest> {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(data)) {
    const detail = (validate.errors ?? [])
      .map((e) => `${e.instancePath || '(root)'} ${e.message ?? ''}`.trim())
      .join('; ');
    return err(makeAdapterError('CONFIG', `invalid adapter manifest: ${detail}`, { retryable: false }));
  }
  return ok(data as Manifest);
}

/** Look up one adapter entry by id. */
export function findEntry(manifest: Manifest, id: string): ManifestEntry | undefined {
  return manifest.adapters.find((a) => a.id === id);
}

const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_COOLDOWN_SEC = 120;

/** Derive a BreakerConfig from a manifest entry (defaults applied when the block is omitted). */
export function breakerFromEntry(entry: ManifestEntry): BreakerConfig {
  const cb = entry.circuitBreaker;
  return {
    failureThreshold: cb?.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD,
    cooldownSec: cb?.cooldownSec ?? DEFAULT_COOLDOWN_SEC,
    ...(cb?.halfOpenTrials !== undefined ? { halfOpenTrials: cb.halfOpenTrials } : {}),
  };
}

/** Cache TTL from a manifest entry (default 900s per adapter-contract §5). */
export function cacheTtlFromEntry(entry: ManifestEntry): number {
  return entry.cache?.ttlSec ?? 900;
}
