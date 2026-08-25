// BEACON — env-driven VISION ladder resolver (S2·Lane V; ADR-008a, Art. XVI). The vision twin of
// `llm/ladder-config.ts`: it turns `VISION_MODE`/`VISION_PROVIDER`/`VISION_MODEL`/`VISION_API_BASE`/
// `VISION_LOCAL_MODEL` into an ordered `VisionProvider[]`, and it is what closes UNIMPLEMENTED_REGISTER
// row 27 — those variables were documented from S03 and read by NO code, because `build-vision.ts` hardcoded
// `[makeMockVision()]`.
//
// TWO env sources, deliberately, mirroring build-ai.ts:39:
//   • the PARSED `Env` for the VISION_* vars (they are in EnvSchema, so a typo'd value fails at boot);
//   • a RAW env record for the OpenRouter credentials, because `LLM_TIER_*` / `OPENROUTER_API_KEY` live
//     OUTSIDE EnvSchema by design and this rung REUSES them rather than inventing a second vision key.
//
// Every unhappy path returns a LABELLED degraded mock rather than throwing: a misconfigured vision rung must
// not take down a server whose vision output is advisory by definition. `MockVision` is always appended last
// so a live rung that fails at request time also lands there (Art. XVI).
import type { Env } from '@/config/index.js';
import { makeHttpClient, type HttpClient } from '../http-client.js';
import { makeDegradedMockVision, makeMockVision, type VisionProvider } from './mock-vision.js';
import { makeImageryResolver, type ImageryResolver } from './imagery/resolver.js';
import { DEFAULT_OPENROUTER_BASE, DEFAULT_VISION_MODEL, makeOpenRouterVision } from './openrouter-vision.js';
import type { FetchLike } from './imagery/imagery-source.js';

/** Raw env record carrying the LLM ladder's OpenRouter credentials (NOT the parsed Env — same as `AiEnv`). */
export type VisionEnv = Readonly<Record<string, string | undefined>>;

export interface VisionLadderDeps {
  /** Injected `fetch` for BOTH the imagery fetch and the model call — tests never touch the network. */
  readonly fetchImpl?: FetchLike;
  readonly http?: HttpClient;
  readonly imagery?: ImageryResolver;
}

/**
 * The OpenRouter key, in the order an operator would expect it to be found: the LLM ladder's explicit
 * fallback-tier key first (that tier IS OpenRouter in `.env.example`), then the plain `OPENROUTER_API_KEY`
 * the repo already documents. NOTHING new is introduced — plan §3 says the vision rung reuses this key.
 */
export function resolveOpenRouterKey(env: VisionEnv): string | undefined {
  const key = env['LLM_TIER_FALLBACK_KEY'] ?? env['OPENROUTER_API_KEY'];
  return key !== undefined && key.length > 0 ? key : undefined;
}

function resolveImagery(config: Env, deps: VisionLadderDeps): ImageryResolver {
  return deps.imagery ?? makeImageryResolver({ fetchImpl: deps.fetchImpl ?? fetch, config });
}

function cloudProviders(config: Env, env: VisionEnv, deps: VisionLadderDeps): readonly VisionProvider[] {
  // Only OpenRouter (and OpenAI-compatible clones of it) is implemented. A different VISION_PROVIDER is
  // named honestly in the degraded label instead of being silently ignored — an operator who set it deserves
  // to learn from the finding that it did nothing.
  const provider = config.VISION_PROVIDER ?? 'openrouter';
  const apiKey = resolveOpenRouterKey(env);
  if (apiKey === undefined) {
    return [makeDegradedMockVision('VISION_MODE=cloud but no OpenRouter key is set (LLM_TIER_FALLBACK_KEY / OPENROUTER_API_KEY)')];
  }
  return [
    makeOpenRouterVision(
      {
        model: config.VISION_MODEL ?? DEFAULT_VISION_MODEL,
        apiBase: config.VISION_API_BASE ?? env['LLM_TIER_FALLBACK_BASE'] ?? DEFAULT_OPENROUTER_BASE,
        apiKey,
      },
      { http: deps.http ?? makeHttpClient(deps.fetchImpl ?? fetch), imagery: resolveImagery(config, deps) },
    ),
    makeDegradedMockVision(`cloud vision rung (${provider}) did not answer`),
  ];
}

function localProviders(config: Env, deps: VisionLadderDeps): readonly VisionProvider[] {
  // VISION_API_BASE is guaranteed by an EnvSchema refine (config/index.ts:399); the model is not, and a
  // local endpoint with no model name cannot be called at all.
  const model = config.VISION_LOCAL_MODEL;
  if (model === undefined || config.VISION_API_BASE === undefined) {
    return [makeDegradedMockVision('VISION_MODE=local but VISION_LOCAL_MODEL/VISION_API_BASE is incomplete')];
  }
  return [
    makeOpenRouterVision(
      { model, apiBase: config.VISION_API_BASE },
      { http: deps.http ?? makeHttpClient(deps.fetchImpl ?? fetch), imagery: resolveImagery(config, deps) },
    ),
    makeDegradedMockVision('local vision rung did not answer'),
  ];
}

/**
 * The ordered vision ladder for a configuration. `VISION_MODE=off` (the default) is byte-identical to the
 * shipped behaviour — the plain in-process MockVision, no network, no egress — so an untouched deployment
 * sees no change at all.
 */
export function resolveVisionProviders(config: Env, env: VisionEnv = {}, deps: VisionLadderDeps = {}): readonly VisionProvider[] {
  if (config.VISION_MODE === 'cloud') return cloudProviders(config, env, deps);
  if (config.VISION_MODE === 'local') return localProviders(config, deps);
  return [makeMockVision()];
}
