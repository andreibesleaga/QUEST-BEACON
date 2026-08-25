// BEACON — vision LADDER resolution tests (S2·Lane V; ADR-008a, Art. XVI). These are the tests that make
// UNIMPLEMENTED_REGISTER row 27 false: each asserts that a `VISION_*` variable now CHANGES something. No
// live network — the HttpClient is injected, and `VISION_MODE=off` never constructs one at all.
import { describe, expect, it } from 'vitest';
import { loadConfig } from '@/config/index.js';
import type { HttpResponse } from '../http-client.js';
import type { ImageryResolver } from './imagery/resolver.js';
import { DEGRADED_PREFIX } from './mock-vision.js';
import { DEFAULT_VISION_MODEL } from './openrouter-vision.js';
import { resolveOpenRouterKey, resolveVisionProviders } from './vision-config.js';

const imagery: ImageryResolver = {
  resolve: () =>
    Promise.resolve({ imageRef: 'fixture:t', bytes: new Uint8Array([1]), mediaType: 'image/png', attribution: 'GIBS' }),
};

function stubHttp(): { http: { postJson: (u: string, b: unknown) => Promise<HttpResponse> }; urls: string[]; bodies: unknown[] } {
  const urls: string[] = [];
  const bodies: unknown[] = [];
  return {
    urls,
    bodies,
    http: {
      postJson: (url, body): Promise<HttpResponse> => {
        urls.push(url);
        bodies.push(body);
        return Promise.resolve({ ok: true, status: 200, json: { choices: [{ message: { content: '{"class":"burn-scar","certainty":"high"}' } }] } });
      },
    },
  };
}

describe('resolveVisionProviders — VISION_MODE selects the rung', () => {
  it('off (the default) is byte-identical to the shipped behaviour: one plain in-process mock, no network', () => {
    const providers = resolveVisionProviders(loadConfig({}));
    expect(providers).toHaveLength(1);
    expect(providers[0]?.name).toBe('mock-vision');
  });

  it('cloud + an OpenRouter key ⇒ a real provider in front of a labelled degraded mock', () => {
    const providers = resolveVisionProviders(loadConfig({ VISION_MODE: 'cloud' }), { OPENROUTER_API_KEY: 'k' }, { imagery });
    expect(providers).toHaveLength(2);
    expect(providers[0]?.name).toBe(DEFAULT_VISION_MODEL);
    expect(providers[1]?.name).toContain(DEGRADED_PREFIX);
  });

  it('VISION_MODEL / VISION_API_BASE are actually read (row 27 is closed by this assertion)', async () => {
    const stub = stubHttp();
    const providers = resolveVisionProviders(
      loadConfig({ VISION_MODE: 'cloud', VISION_MODEL: 'qwen/qwen3-vl:free', VISION_API_BASE: 'https://proxy.example/v1' }),
      { OPENROUTER_API_KEY: 'k' },
      { http: stub.http, imagery },
    );
    expect(providers[0]?.name).toBe('qwen/qwen3-vl:free');
    await providers[0]?.analyze({ imageRef: 'fixture:t', task: 'burn-area' });
    expect(stub.urls[0]).toBe('https://proxy.example/v1/chat/completions');
    expect((stub.bodies[0] as { model: string }).model).toBe('qwen/qwen3-vl:free');
  });

  it('cloud with NO key degrades to a LABELLED mock — never throws, never silently succeeds', async () => {
    const providers = resolveVisionProviders(loadConfig({ VISION_MODE: 'cloud' }), {}, { imagery });
    expect(providers).toHaveLength(1);
    expect(providers[0]?.name).toContain(DEGRADED_PREFIX);
    const finding = await providers[0]?.analyze({ imageRef: 'fixture:t', task: 'burn-area' });
    // The operator learns from the FINDING that no model looked at the image, and why.
    expect(finding?.notes).toMatch(/DEGRADED RUNG/);
    expect(finding?.notes).toMatch(/OPENROUTER_API_KEY/);
  });

  it('treats an empty-string key as absent (an unset .env line is empty, not missing)', () => {
    expect(resolveOpenRouterKey({ OPENROUTER_API_KEY: '' })).toBeUndefined();
    expect(resolveOpenRouterKey({ OPENROUTER_API_KEY: 'k' })).toBe('k');
    // The LLM ladder's own tier key wins — it is the more specific statement of intent.
    expect(resolveOpenRouterKey({ LLM_TIER_FALLBACK_KEY: 'tier', OPENROUTER_API_KEY: 'plain' })).toBe('tier');
  });

  it('local ⇒ an Ollama-shaped rung at VISION_API_BASE with VISION_LOCAL_MODEL', async () => {
    const stub = stubHttp();
    const providers = resolveVisionProviders(
      loadConfig({ VISION_MODE: 'local', VISION_API_BASE: 'http://localhost:11434/v1', VISION_LOCAL_MODEL: 'llava' }),
      {},
      { http: stub.http, imagery },
    );
    expect(providers[0]?.name).toBe('llava');
    await providers[0]?.analyze({ imageRef: 'fixture:t', task: 'burn-area' });
    expect(stub.urls[0]).toBe('http://localhost:11434/v1/chat/completions');
    expect(providers[1]?.name).toContain(DEGRADED_PREFIX);
  });

  it('local with no VISION_LOCAL_MODEL degrades to a labelled mock (an endpoint with no model is uncallable)', async () => {
    const providers = resolveVisionProviders(loadConfig({ VISION_MODE: 'local', VISION_API_BASE: 'http://localhost:11434/v1' }), {}, { imagery });
    expect(providers[0]?.name).toContain(DEGRADED_PREFIX);
    const finding = await providers[0]?.analyze({ imageRef: 'fixture:t', task: 'burn-area' });
    expect(finding?.notes).toMatch(/VISION_LOCAL_MODEL/);
  });

  it('names an unimplemented VISION_PROVIDER in the degraded label instead of ignoring it', async () => {
    const providers = resolveVisionProviders(
      loadConfig({ VISION_MODE: 'cloud', VISION_PROVIDER: 'bedrock' }),
      { OPENROUTER_API_KEY: 'k' },
      { imagery },
    );
    const finding = await providers[1]?.analyze({ imageRef: 'fixture:t', task: 'burn-area' });
    expect(finding?.notes).toMatch(/bedrock/);
  });

  it('a degraded mock still returns an ADVISORY, confidence-scored finding — degrade, never dead-end', async () => {
    const providers = resolveVisionProviders(loadConfig({ VISION_MODE: 'cloud' }), {}, { imagery });
    const finding = await providers[0]?.analyze({ imageRef: 'fixture:t', task: 'flood-extent' });
    expect(finding?.label).toBe('possible standing water');
    expect(finding?.confidence).toBeGreaterThan(0);
    expect(finding?.confidence).toBeLessThanOrEqual(1);
  });
});
