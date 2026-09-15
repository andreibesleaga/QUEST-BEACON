// BEACON — LLM ladder tests (E6·T-243…T-254; ADR-007/F3/CM-C5-C16).
import { describe, expect, it } from 'vitest';
import { isErr, isOk } from '@/domain/shared/result.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { CitationId, SitRepId, SourceId } from '@/domain/value-objects/ids.js';
import type { NarrativeRequest } from '@/ports/intel.js';
import { makeGateSeal } from '@/adapters/compliance/gate-token.js';
import { makeLlmLadder } from './llm-ladder.js';
import { makeMockProvider } from './mock-provider.js';
import { resolveLadder } from './ladder-config.js';
import { makeHttpClient } from '../http-client.js';
import { isValidNarration, narrationIsFigureFree } from './output-validator.js';

const citation = {
  id: asId<CitationId>('c1'),
  sitrepId: asId<SitRepId>('s1'),
  sourceId: asId<SourceId>('src1'),
  field: 'summary',
  claim: '2 shelters open',
};
const request: NarrativeRequest = {
  facts: [{ claim: '2 shelters open', citation }],
  style: 'sitrep',
};

describe('LlmLadder — mandatory gateway stamp (F16)', () => {
  it('refuses an un-stamped narrate() call', async () => {
    const ladder = makeLlmLadder([makeMockProvider()], makeGateSeal());
    const r = await ladder.narrate();
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.message).toMatch(/missing gateway stamp/i);
  });

  it('refuses a call sealed with an invalid stamp', async () => {
    const seal = makeGateSeal();
    const ladder = makeLlmLadder([makeMockProvider()], seal);
    const r = await ladder.sealed('garbage-token').narrate(request);
    expect(isErr(r)).toBe(true);
  });

  it('narrates when sealed with a valid stamp', async () => {
    const seal = makeGateSeal();
    const token = await seal.mint({ operation: 'llm.narrate', modelTier: 'CLOUD', maxTokens: 800 });
    const r = await makeLlmLadder([makeMockProvider()], seal).sealed(token).narrate(request);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.citations).toHaveLength(1);
      // Non-vacuity (F-340): the MOCK RUNG produced this, not the deterministic-only floor. Without this
      // assertion a mock whose output the guard rejects would still "pass" every test on this ladder.
      expect(r.value.text).not.toMatch(/deterministic-only/i);
      expect(narrationIsFigureFree(r.value.text)).toBe(true);
    }
  });
});

describe('LlmLadder — descent + AI-off degradation (Art. XVI)', () => {
  const sealed = async (providers: ReturnType<typeof makeMockProvider>[]) => {
    const seal = makeGateSeal();
    const token = await seal.mint({ operation: 'llm.narrate', modelTier: 'CLOUD', maxTokens: 800 });
    return makeLlmLadder(providers, seal).sealed(token);
  };

  it('descends past a failing provider to a healthy one', async () => {
    const llm = await sealed([makeMockProvider('groq', true), makeMockProvider('haiku', false)]);
    const r = await llm.narrate(request);
    expect(isOk(r)).toBe(true);
    // The HEALTHY rung answered — not the deterministic-only floor that answers when every rung fails.
    if (isOk(r)) expect(r.value.text).not.toMatch(/deterministic-only/i);
  });

  it('AI-off (no providers) degrades to a labeled deterministic-only narration, never dead-ends', async () => {
    const llm = await sealed([]);
    const r = await llm.narrate(request);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.text).toMatch(/deterministic-only/i);
      expect(r.value.citations).toHaveLength(1); // numbers/citations retained
    }
  });

  it('AI_MODE=off yields an empty env-resolved ladder', () => {
    const providers = resolveLadder({ AI_MODE: 'off' }, makeHttpClient());
    expect(providers).toHaveLength(0);
  });

  it('env resolves a configured OpenAI-compatible rung', () => {
    const providers = resolveLadder(
      {
        AI_MODE: 'cloud',
        LLM_TIER_DEFAULT_MODEL: 'openai/gpt-oss-120b',
        LLM_TIER_DEFAULT_BASE: 'https://api.groq.com/openai/v1',
      },
      makeHttpClient(),
    );
    expect(providers[0]?.name).toBe('openai/gpt-oss-120b');
  });
});

describe('resolveLadder — env → ordered ladder (B5 name-drift guard)', () => {
  const http = makeHttpClient();

  it('resolves all three tiers into 3 providers in ladder order (default → fallback → local)', () => {
    const providers = resolveLadder(
      {
        AI_MODE: 'cloud',
        LLM_TIER_DEFAULT_MODEL: 'openai/gpt-oss-120b',
        LLM_TIER_DEFAULT_BASE: 'https://api.groq.com/openai/v1',
        LLM_TIER_FALLBACK_MODEL: 'anthropic/claude-haiku-4-5',
        LLM_TIER_FALLBACK_BASE: 'https://openrouter.ai/api/v1',
        LLM_TIER_LOCAL_MODEL: 'llama3',
        LLM_TIER_LOCAL_BASE: 'http://localhost:11434/v1',
      },
      http,
    );
    expect(providers.map((p) => p.name)).toEqual([
      'openai/gpt-oss-120b',
      'anthropic/claude-haiku-4-5',
      'llama3',
    ]);
  });

  it('resolves ONLY the local tier into a single Ollama rung', () => {
    const providers = resolveLadder(
      {
        AI_MODE: 'local',
        LLM_TIER_LOCAL_MODEL: 'llama3',
        LLM_TIER_LOCAL_BASE: 'http://localhost:11434/v1',
      },
      http,
    );
    expect(providers.map((p) => p.name)).toEqual(['llama3']);
  });

  it('skips a tier that has MODEL but no BASE (unconfigured rung → skipped, ladder still valid)', () => {
    const providers = resolveLadder(
      { AI_MODE: 'cloud', LLM_TIER_DEFAULT_MODEL: 'openai/gpt-oss-120b' },
      http,
    );
    expect(providers).toHaveLength(0);
  });

  it('binds the EXACT .env.example B5 cloud profile keys (a rename in ladder-config.ts breaks this)', () => {
    // These key names MUST match the LLM_TIER_*_{MODEL,BASE,KEY} block in .env.example / ladder-config.ts.
    const envExampleCloudProfile = {
      AI_MODE: 'cloud',
      LLM_TIER_DEFAULT_MODEL: 'openai/gpt-oss-120b',
      LLM_TIER_DEFAULT_BASE: 'https://api.groq.com/openai/v1',
      LLM_TIER_DEFAULT_KEY: 'gsk-example',
      LLM_TIER_FALLBACK_MODEL: 'anthropic/claude-haiku-4-5',
      LLM_TIER_FALLBACK_BASE: 'https://openrouter.ai/api/v1',
      LLM_TIER_FALLBACK_KEY: 'sk-or-example',
    };
    const providers = resolveLadder(envExampleCloudProfile, http);
    expect(providers.map((p) => p.name)).toEqual([
      'openai/gpt-oss-120b',
      'anthropic/claude-haiku-4-5',
    ]);
  });
});

describe('output-validator — F3/F-340 (LLM never emits a figure)', () => {
  it('accepts figure-free narration', () => {
    expect(narrationIsFigureFree('Shelters are open across the county.')).toBe(true);
  });

  it('rejects narration carrying a figure — invented OR echoed from the facts (F-340)', () => {
    expect(narrationIsFigureFree('There are 2 shelters and 47 casualties.')).toBe(false);
    expect(isValidNarration({ text: '47 casualties', citations: [citation] }, request.facts)).toBe(
      false,
    );
    // The echo used to pass, which is exactly how a fabricated figure got in: "2" is in the fact bag, so a
    // bag check could not tell "2 shelters" (true) from "2 fatalities" (invented). Both are rejected now.
    expect(narrationIsFigureFree('There are 2 shelters open.')).toBe(false);
    expect(
      isValidNarration(
        { text: 'There are 2 shelters open.', citations: [citation] },
        request.facts,
      ),
    ).toBe(false);
  });

  it('a hallucinated-number provider output is rejected → deterministic-only', async () => {
    const seal = makeGateSeal();
    const token = await seal.mint({ operation: 'llm.narrate', modelTier: 'CLOUD', maxTokens: 800 });
    // Provider fabricates a casualty figure not in the facts → invalid → descends.
    const liar = {
      name: 'liar',
      narrate: () =>
        Promise.resolve({ text: 'Estimated 999 casualties.', inputTokens: 5, outputTokens: 5 }),
    };
    const r = await makeLlmLadder([liar], seal).sealed(token).narrate(request);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.text).toMatch(/deterministic-only/i);
  });
});
