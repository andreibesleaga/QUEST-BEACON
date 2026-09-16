// BEACON — AI adapter barrel (E6; ADR-007/008/008a/022). LLM ladder + Vision + observability + cost.
export { makeHttpClient } from './http-client.js';
export type { HttpClient, HttpResponse } from './http-client.js';
export { computeCostUsd, estimateReservationUsd, estimateTokens } from './cost-rates.js';
export { makeObservability } from './observability.js';
export type { Observability, GenAiUsage } from './observability.js';
export { LlmLadder, makeLlmLadder } from './llm/llm-ladder.js';
export type { SealableLLM } from './llm/llm-ladder.js';
export { makeMockProvider } from './llm/mock-provider.js';
export type { LlmProvider, ProviderNarration } from './llm/mock-provider.js';
export { makeOpenAiCompatibleProvider } from './llm/openai-compatible-provider.js';
export type { OpenAiProviderConfig } from './llm/openai-compatible-provider.js';
export { resolveLadder } from './llm/ladder-config.js';
export type { AiEnv } from './llm/ladder-config.js';
export {
  isValidNarration,
  narrationIsFigureFree,
  usesOnlyCitedLikelihoodClasses,
} from './llm/output-validator.js';
export { VisionAdapter, makeVisionAdapter } from './vision/vision-adapter.js';
export type { SealableVision, VisionGateContext } from './vision/vision-adapter.js';
export { makeMockVision } from './vision/mock-vision.js';
export type { VisionProvider } from './vision/mock-vision.js';
