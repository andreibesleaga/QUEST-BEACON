// BEACON — OpenAI-compatible provider tests (E6·T-246; ADR-007/ADR-008a). Ladder-descent contract: a
// non-2xx response throws (so the ladder falls to the next rung), an empty completion throws
// (parseNarration), and the Bearer auth header is sent ONLY when an apiKey is configured. Deterministic:
// a fake in-memory HttpClient — no network.
import { describe, it, expect } from 'vitest';
import type { NarrativeRequest } from '@/ports/intel.js';
import type { HttpClient, HttpResponse } from '../http-client.js';
import { makeOpenAiCompatibleProvider } from './openai-compatible-provider.js';

interface Call {
  readonly url: string;
  readonly body: unknown;
  readonly headers: Readonly<Record<string, string>>;
}

/** Records every call and returns a canned response. */
function fakeHttp(response: HttpResponse): { http: HttpClient; calls: Call[] } {
  const calls: Call[] = [];
  const http: HttpClient = {
    postJson(url, body, headers = {}) {
      calls.push({ url, body, headers });
      return Promise.resolve(response);
    },
  };
  return { http, calls };
}

const request: NarrativeRequest = {
  facts: [{ claim: '3 active hotspots within 5 km of Freeport' } as NarrativeRequest['facts'][number]],
  style: 'sitrep',
};

const cfg = { name: 'test-model', apiBase: 'https://api.example/v1', maxOutputTokens: 256 };

describe('makeOpenAiCompatibleProvider.narrate', () => {
  it('maps a 2xx completion to a ProviderNarration with usage tokens', async () => {
    const { http, calls } = fakeHttp({
      status: 200,
      ok: true,
      json: {
        choices: [{ message: { content: 'Cited prose about the hotspots.' } }],
        usage: { prompt_tokens: 42, completion_tokens: 7 },
      },
    });
    const provider = makeOpenAiCompatibleProvider({ ...cfg, apiKey: 'secret' }, http);
    const out = await provider.narrate(request);
    expect(out.text).toBe('Cited prose about the hotspots.');
    expect(out.inputTokens).toBe(42);
    expect(out.outputTokens).toBe(7);
    expect(calls[0]?.url).toBe('https://api.example/v1/chat/completions');
  });

  it('throws on a non-2xx response so the ladder descends to the next rung', async () => {
    const { http } = fakeHttp({ status: 503, ok: false, json: null });
    const provider = makeOpenAiCompatibleProvider(cfg, http);
    await expect(provider.narrate(request)).rejects.toThrow(/returned 503/);
  });

  it('throws on an empty completion (parseNarration guard)', async () => {
    const { http } = fakeHttp({
      status: 200,
      ok: true,
      json: { choices: [{ message: { content: '   ' } }] },
    });
    const provider = makeOpenAiCompatibleProvider(cfg, http);
    await expect(provider.narrate(request)).rejects.toThrow(/empty narration/);
  });

  it('sends a Bearer auth header ONLY when an apiKey is configured', async () => {
    const withKey = fakeHttp({ status: 200, ok: true, json: { choices: [{ message: { content: 'x' } }] } });
    await makeOpenAiCompatibleProvider({ ...cfg, apiKey: 'secret' }, withKey.http).narrate(request);
    expect(withKey.calls[0]?.headers.authorization).toBe('Bearer secret');

    const noKey = fakeHttp({ status: 200, ok: true, json: { choices: [{ message: { content: 'x' } }] } });
    await makeOpenAiCompatibleProvider(cfg, noKey.http).narrate(request);
    expect(noKey.calls[0]?.headers.authorization).toBeUndefined();
  });

  it('falls back to estimated tokens when the provider omits usage', async () => {
    const { http } = fakeHttp({
      status: 200,
      ok: true,
      json: { choices: [{ message: { content: 'Some narrated output.' } }] },
    });
    const provider = makeOpenAiCompatibleProvider(cfg, http);
    const out = await provider.narrate(request);
    expect(out.inputTokens).toBeGreaterThan(0);
    expect(out.outputTokens).toBeGreaterThan(0);
  });
});
