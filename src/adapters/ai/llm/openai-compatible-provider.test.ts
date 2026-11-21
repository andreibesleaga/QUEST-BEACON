// BEACON — OpenAI-compatible provider tests (E6·T-246; ADR-007/ADR-008a). Ladder-descent contract: a
// non-2xx response throws (so the ladder falls to the next rung), an empty completion throws
// (parseNarration), and the Bearer auth header is sent ONLY when an apiKey is configured. Deterministic:
// a fake in-memory HttpClient — no network.
import { describe, it, expect } from 'vitest';
import type { NarrativeRequest } from '@/ports/intel.js';
import type { HttpClient, HttpResponse } from '../http-client.js';
import { makeOpenAiCompatibleProvider, plainProse } from './openai-compatible-provider.js';

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
  facts: [
    { claim: '3 active hotspots within 5 km of Freeport' } as NarrativeRequest['facts'][number],
  ],
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
    const withKey = fakeHttp({
      status: 200,
      ok: true,
      json: { choices: [{ message: { content: 'x' } }] },
    });
    await makeOpenAiCompatibleProvider({ ...cfg, apiKey: 'secret' }, withKey.http).narrate(request);
    expect(withKey.calls[0]?.headers.authorization).toBe('Bearer secret');

    const noKey = fakeHttp({
      status: 200,
      ok: true,
      json: { choices: [{ message: { content: 'x' } }] },
    });
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

// The report panel shows the summary as one paragraph of text, so markdown would print as characters.
describe('plainProse — a completion as the plain text the panel shows', () => {
  it('drops a heading line whole and joins the paragraphs (the live case of 2026-11-21)', () => {
    const completion =
      '# Situational Report\n\nCalifornia is experiencing concurrent hazard activity.\n\nSurface winds favour southeastward spread.';
    expect(plainProse(completion)).toBe(
      'California is experiencing concurrent hazard activity. Surface winds favour southeastward spread.',
    );
  });

  it('removes bullet markers and emphasis marks, and changes no word', () => {
    expect(
      plainProse('- **Wildfire** activity is confirmed.\n* Flooding is `widely` reported.'),
    ).toBe('Wildfire activity is confirmed. Flooding is widely reported.');
  });

  it('leaves plain prose exactly as it is', () => {
    const prose = 'No electrical substations fall within the current hazard footprint.';
    expect(plainProse(prose)).toBe(prose);
  });

  it('keeps a hash that is not a heading, and an underscore inside a name', () => {
    expect(plainProse('Station #north reports smoke near snake_river.')).toBe(
      'Station #north reports smoke near snake_river.',
    );
  });

  it('a completion that is only a title is empty — the rung then steps aside', async () => {
    expect(plainProse('## Situational Report\n')).toBe('');
    const { http } = fakeHttp({
      status: 200,
      ok: true,
      json: { choices: [{ message: { content: '# Situational Report' } }] },
    });
    const provider = makeOpenAiCompatibleProvider(
      { name: 'm', apiBase: 'https://x', maxOutputTokens: 100 },
      http,
    );
    await expect(provider.narrate(request)).rejects.toThrow(/empty narration/);
  });

  it('the provider returns the cleaned text, not the raw completion', async () => {
    const { http } = fakeHttp({
      status: 200,
      ok: true,
      json: { choices: [{ message: { content: '# Report\n\nWildfire activity is confirmed.' } }] },
    });
    const provider = makeOpenAiCompatibleProvider(
      { name: 'm', apiBase: 'https://x', maxOutputTokens: 100 },
      http,
    );
    expect((await provider.narrate(request)).text).toBe('Wildfire activity is confirmed.');
  });
});
