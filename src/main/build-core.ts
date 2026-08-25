// BEACON — composition root (E-main; ADR-023). Wires the offline-first core: validate config (fail-fast)
// → assemble CoreServices from adapters → hand the router the single InteractionPort every channel uses.
// This is the ONE place that may read a wall-clock and construct adapters; the core stays pure/injected.
//
// Phase B adds three ADDED rungs (never weakening the offline default, Art. XVI):
//   • AI_MODE=cloud|local wires the real LLM ladder through the compliance proxy (else deterministic-only).
//   • FEATURE_STORE=postgres moves the DURABLE stores (reports + triage audit, regions, sources) onto
//     Postgres; the incident COP always derives per-read in memory.
//   • DATA_SOURCE_COMPOSITION=adapters (via the async buildCoreLive) feeds the engines from LIVE source
//     adapters instead of the hand-seeded CoreSeed. The sync buildCore stays byte-identical (offline default).
import { ok } from '@/domain/shared/result.js';
import type { RegionId } from '@/domain/value-objects/ids.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { AICompliancePort } from '@/ports/intel.js';
import type { SpatialPort } from '@/ports/infra.js';
import type { PublicReportPort } from '@/ports/public-report.js';
import type { InteractionPort } from '@/ports/interaction.js';
import { makeSpatialPort } from '@/adapters/spatial/index.js';
import { createCommandRouter, type CoreServices, type NarrationConfig } from '@/application/interaction/command-router.js';
import {
  MemoryReadModel,
  MemoryReportStore,
  sourceReadModel,
  type CoreSeed,
} from '@/adapters/memory/memory-core.js';
import { makeDb } from '@/adapters/persistence/client.js';
import {
  makePgPublicReportStore,
  makePgRegionReadModel,
  makePgSourceReadModel,
} from '@/adapters/persistence/read-models.js';
import type { AiEnv } from '@/adapters/ai/llm/ladder-config.js';
import { loadConfig, type Env } from '@/config/index.js';
import { buildComplianceAi } from './build-ai.js';
import { buildComplianceVision } from './build-vision.js';
import { assembleLiveSeeds } from './live-composition.js';
import { DEFAULT_SEED } from './seed.js';

/**
 * AI seam default: when AI_MODE=off (or nothing is wired), every narration request is declined at the
 * gateway → the SitRep degrades to deterministic-only (F7). No network, no keys. A real gateway
 * (ComplianceGateway wrapping the LLM ladder) is injected via `overrides.ai` when AI_MODE=cloud|local.
 */
const deterministicOnlyAi: AICompliancePort = {
  mediate: async () => ok({ allowed: false, reason: 'AI disabled (offline default)' }),
};

/** Deterministic-ish id minter for real runs: prefix + boot epoch + monotonic counter (unique, stable-ish). */
function defaultIdMinter(clock: () => string): (prefix: string) => string {
  const boot = Date.parse(clock());
  let n = 0;
  return (prefix) => `${prefix}-${boot}-${++n}`;
}

/** The wired AI seam + its SitRep narration posture. */
interface ResolvedAi {
  readonly ai: AICompliancePort;
  readonly narration?: NarrationConfig;
}

/**
 * Resolve the AI seam. Explicit override wins (tests). Otherwise, ONLY an explicitly-configured
 * AI_MODE=cloud|local wires the mandatory ComplianceGateway. The RAW env (not the parsed Env — the
 * LLM_TIER_* keys live outside EnvSchema) is threaded so the real Groq→OpenRouter→Ollama ladder resolves;
 * an empty real ladder falls back to the offline MOCK (build-ai). Anything else stays deterministic-only (F7).
 */
function resolveAi(options: BuildCoreOptions, config: Env): ResolvedAi {
  if (options.ai !== undefined) return { ai: options.ai };
  const rawEnv = options.env ?? process.env;
  const mode = rawEnv.AI_MODE;
  if (mode === 'cloud' || mode === 'local') {
    return {
      ai: buildComplianceAi(config, { env: rawEnv as AiEnv }).ai,
      narration: { aiMode: mode, modelTier: mode === 'local' ? 'LOCAL' : 'CLOUD' },
    };
  }
  return { ai: deterministicOnlyAi };
}

/**
 * Resolve the vision-assist seam. Explicit override wins (tests). Otherwise `services.vision` is
 * composed ONLY when `FEATURE_VISION=on` — off/unset leaves the field absent from CoreServices, byte-
 * identical to today (mirrors how AI_MODE=off never constructs buildComplianceAi). Deliberately
 * independent of AI_MODE — narration and vision are separate opt-in capabilities (Art. XIV/XVI).
 */
function resolveVision(options: BuildCoreOptions, config: Env): AICompliancePort | undefined {
  if (options.vision !== undefined) return options.vision;
  return config.FEATURE_VISION === 'on' ? buildComplianceVision(config).vision : undefined;
}

/** The four store-bearing CoreServices fields (memory-default ↔ Postgres-durable behind FEATURE_STORE). */
type StoreServices = Pick<CoreServices, 'regions' | 'incidents' | 'sources' | 'reports'>;

interface StoreContext {
  readonly seed: CoreSeed;
  readonly spatial: SpatialPort;
  readonly clock: () => string;
  readonly newId: (prefix: string) => string;
}

/**
 * Resolve the store-bearing services. `FEATURE_STORE=postgres` moves the DURABLE, audit-critical data
 * (public reports + the hash-chained triage audit, regions, sources) onto Postgres; the incident COP ALWAYS
 * derives per-read in memory from the (seed or live-adapter) CoreSeed — no pg incident read-model, by design.
 * Default `memory` keeps the offline-first, air-gapped path (Art. XVI). An injected `reportStore` always wins
 * (POST/PATCH/GET /reports share ONE instance). config.refine guarantees a real DATABASE_URL when postgres.
 */
function resolveStore(config: Env, options: BuildCoreOptions, ctx: StoreContext): StoreServices {
  const readModel = new MemoryReadModel(ctx.seed, ctx.spatial); // incidents (COP) always derive in memory
  if (config.FEATURE_STORE === 'postgres') {
    const db = makeDb(config.DATABASE_URL);
    return {
      regions: makePgRegionReadModel(db),
      incidents: readModel,
      sources: makePgSourceReadModel(db),
      reports: options.reportStore ?? makePgPublicReportStore(db, ctx.clock, ctx.newId),
    };
  }
  return {
    regions: readModel,
    incidents: readModel,
    sources: sourceReadModel(readModel),
    reports: options.reportStore ?? new MemoryReportStore(ctx.clock, ctx.newId),
  };
}

export interface BuildCoreOptions {
  /** Environment record to validate (defaults to process.env). */
  readonly env?: Record<string, string | undefined>;
  /** Offline dataset (defaults to the built-in CA + RO demo seed). */
  readonly seed?: CoreSeed;
  /** Injected clock (defaults to wall-clock — the one sanctioned wall-clock read). Tests inject a fixed one. */
  readonly clock?: () => string;
  /** Injected id minter (tests inject a counter for determinism). */
  readonly newId?: (prefix: string) => string;
  /** AI compliance gateway (defaults to deterministic-only). Wire the real gateway for AI_MODE=cloud|local. */
  readonly ai?: AICompliancePort;
  /** Vision-assist compliance gateway (defaults to absent unless FEATURE_VISION=on). Tests inject a fake. */
  readonly vision?: AICompliancePort;
  /** Spatial engine backing the exposure/prediction derivation (defaults to the config-selected SpatialPort). */
  readonly spatial?: SpatialPort;
  /**
   * Shared report store (POST/PATCH /reports + GET /reports read the SAME instance). Defaults to a fresh
   * empty store — MemoryReportStore (offline) or the durable Postgres store (FEATURE_STORE=postgres), both
   * PublicReportPort. The HTTP composition injects one instance so the verifier queue + intake stay coherent.
   */
  readonly reportStore?: PublicReportPort;
}

/** Shared assembly: resolve config/clock/id/spatial/ai/store from options + the given (offline or live) seed. */
function assembleServices(options: BuildCoreOptions, config: Env, seed: CoreSeed): CoreServices {
  const clock = options.clock ?? (() => new Date().toISOString());
  const newId = options.newId ?? defaultIdMinter(clock);
  const spatial = options.spatial ?? makeSpatialPort();
  const { ai, narration } = resolveAi(options, config);
  const vision = resolveVision(options, config);
  const store = resolveStore(config, options, { seed, spatial, clock, newId });
  return {
    clock,
    newId,
    defaultRegionId: asId<RegionId>(seed.defaultRegionId),
    ...store,
    ai,
    ...(narration !== undefined ? { narration } : {}),
    ...(vision !== undefined ? { vision } : {}),
  };
}

/** Build the wired CoreServices. Validates config fail-fast, then assembles offline-first adapters. */
export function buildCore(options: BuildCoreOptions = {}): { services: CoreServices; config: Env } {
  const config = loadConfig(options.env);
  const seed = options.seed ?? DEFAULT_SEED;
  return { services: assembleServices(options, config, seed), config };
}

/** Convenience: build the single InteractionPort every channel (HTTP/CLI/messaging) dispatches through. */
export function buildInteraction(options: BuildCoreOptions = {}): InteractionPort {
  return createCommandRouter(buildCore(options).services);
}

/**
 * OPT-IN live composition (DATA_SOURCE_COMPOSITION=adapters): the engines compute over REAL source-adapter
 * inputs (CA hazards/weather/gauges LIVE; RO gauges/news CACHED) via the redundancy ladder, with every slice
 * no adapter serves yet kept seeded (hybrid — see live-seed.ts). Any registry/assembly failure falls back to
 * the offline DEFAULT_SEED — the core NEVER dead-ends (Art. XVI). An explicit `options.seed` disables the live
 * path (tests stay hermetic). The sync buildCore/buildInteraction are unchanged.
 */
export async function buildCoreLive(options: BuildCoreOptions = {}): Promise<{ services: CoreServices; config: Env }> {
  const config = loadConfig(options.env);
  const rawEnv = options.env ?? process.env;
  const clock = options.clock ?? (() => new Date().toISOString());
  const seed = await resolveSeed(options, config, rawEnv, clock);
  return { services: assembleServices({ ...options, clock }, config, seed), config };
}

/** Async InteractionPort over the live composition (see buildCoreLive). */
export async function buildInteractionLive(options: BuildCoreOptions = {}): Promise<InteractionPort> {
  return createCommandRouter((await buildCoreLive(options)).services);
}

/**
 * Pick the CoreSeed: an explicit override or the offline default UNLESS DATA_SOURCE_COMPOSITION=adapters, in
 * which case the live-adapter seed is assembled (shared helper: registry from config/adapters.json →
 * RedundancyEngine ladder → derivation inputs). Fail-open to DEFAULT_SEED — the core never dead-ends (Art. XVI).
 */
async function resolveSeed(
  options: BuildCoreOptions,
  config: Env,
  rawEnv: Record<string, string | undefined>,
  clock: () => string,
): Promise<CoreSeed> {
  if (options.seed !== undefined) return options.seed;
  const newId = options.newId ?? defaultIdMinter(clock);
  const live = await assembleLiveSeeds(config, rawEnv, clock, newId);
  return live?.coreSeed ?? DEFAULT_SEED;
}
