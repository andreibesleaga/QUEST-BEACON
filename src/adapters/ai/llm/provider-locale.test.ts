// BEACON — narrator-locale tests (ADR-030; FR-I18N-2, and the Art. XII boundary it must not cross).
// The narrator is the ONE place a language preference reaches the model. Two things must hold:
//   1. asking for a locale actually instructs the model (otherwise the feature is decorative), and
//   2. asking for ENGLISH — or not asking at all — produces the byte-identical prompt it produced before
//      i18n existed, so the AI-parity and prompt-stability guarantees are untouched.
// Deterministic: a fake in-memory HttpClient, no network.
import { describe, it, expect } from 'vitest';
import type { NarrativeRequest } from '@/ports/intel.js';
import type { HttpClient, HttpResponse } from '../http-client.js';
import { makeOpenAiCompatibleProvider } from './openai-compatible-provider.js';

interface Call {
  readonly body: unknown;
}

function fakeHttp(): { http: HttpClient; calls: Call[] } {
  const calls: Call[] = [];
  const response: HttpResponse = {
    status: 200,
    ok: true,
    json: { choices: [{ message: { content: 'prose' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
  };
  const http: HttpClient = {
    postJson(_url, body) {
      calls.push({ body });
      return Promise.resolve(response);
    },
  };
  return { http, calls };
}

const cfg = { name: 'test-model', apiBase: 'https://api.example/v1', maxOutputTokens: 256 };

function baseRequest(locale?: string): NarrativeRequest {
  return {
    facts: [{ claim: '3 active hotspots within 5 km of Freeport' } as NarrativeRequest['facts'][number]],
    style: 'sitrep',
    ...(locale !== undefined ? { locale } : {}),
  };
}

/** The user-role prompt actually sent upstream. */
function userPrompt(call: Call): string {
  const body = call.body as { messages?: readonly { role: string; content: string }[] };
  return body.messages?.find((m) => m.role === 'user')?.content ?? '';
}

describe('narrator locale threading', () => {
  it('instructs the model to write in the requested language', async () => {
    const { http, calls } = fakeHttp();
    await makeOpenAiCompatibleProvider(cfg, http).narrate(baseRequest('ro'));
    const prompt = userPrompt(calls[0]!);
    expect(prompt).toContain('"ro"');
    expect(prompt).toMatch(/language/i);
  });

  it('tells the model to leave identifiers, place names, sources and units alone', async () => {
    // Localizing a station name or a unit of record would corrupt the citation trail.
    const { http, calls } = fakeHttp();
    await makeOpenAiCompatibleProvider(cfg, http).narrate(baseRequest('ar'));
    expect(userPrompt(calls[0]!)).toMatch(/identifiers, place names, source names and units/i);
  });

  it('still sends the cited facts, and only those, as the narration input', async () => {
    const { http, calls } = fakeHttp();
    await makeOpenAiCompatibleProvider(cfg, http).narrate(baseRequest('bn'));
    expect(userPrompt(calls[0]!)).toContain('3 active hotspots within 5 km of Freeport');
  });

  it('produces the SAME prompt with no locale and with locale "en" (English is the un-instructed default)', async () => {
    const a = fakeHttp();
    await makeOpenAiCompatibleProvider(cfg, a.http).narrate(baseRequest());
    const b = fakeHttp();
    await makeOpenAiCompatibleProvider(cfg, b.http).narrate(baseRequest('en'));
    expect(userPrompt(b.calls[0]!)).toBe(userPrompt(a.calls[0]!));
    // …and that prompt carries no language instruction at all.
    expect(userPrompt(a.calls[0]!)).not.toMatch(/BCP-47/);
  });
});
