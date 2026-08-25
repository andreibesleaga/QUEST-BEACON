// BEACON — live-vision provider + Article XII guard tests (S2·Lane V; ADR-008a). NO live network: the
// HttpClient and the imagery resolver are both injected, so what a real model would return is expressed here
// as recorded response shapes (plan §1.6).
//
// The centre of gravity is `discards every numeric claim…`: it feeds the provider a response of exactly the
// kind a helpful vision model produces unprompted — a confident area in hectares, a percentage, a structure
// count, a self-reported 0.97 confidence — and asserts NONE of it reaches the operator. That is Art. XII in
// executable form.
import { describe, expect, it } from 'vitest';
import type { HttpResponse } from '../http-client.js';
import type { VisionRequest } from '@/ports/intel.js';
import type { ImageryResolver } from './imagery/resolver.js';
import { DEFAULT_VISION_MODEL, makeOpenRouterVision, parseClassification } from './openrouter-vision.js';
import { classIdsFor, toAdvisoryFinding } from './vision-finding-guard.js';

const IMAGE = {
  imageRef: 'fixture:gibs-modis721-burn-area-us-ca-001',
  bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  mediaType: 'image/png',
  attribution: 'NASA EOSDIS GIBS — layer MODIS_Terra_CorrectedReflectance_Bands721',
};

const imagery: ImageryResolver = { resolve: () => Promise.resolve(IMAGE) };
const BURN: VisionRequest = { imageRef: IMAGE.imageRef, task: 'burn-area' };

function completion(content: string): HttpResponse {
  return { ok: true, status: 200, json: { choices: [{ message: { content } }] } };
}

/** An HttpClient stub that records the single request it was given. */
function stubHttp(response: HttpResponse): { http: { postJson: (u: string, b: unknown, h?: Readonly<Record<string, string>>) => Promise<HttpResponse> }; calls: { url: string; body: unknown; headers?: Readonly<Record<string, string>> }[] } {
  const calls: { url: string; body: unknown; headers?: Readonly<Record<string, string>> }[] = [];
  return {
    calls,
    http: {
      postJson: (url, body, headers): Promise<HttpResponse> => {
        calls.push({ url, body, ...(headers !== undefined ? { headers } : {}) });
        return Promise.resolve(response);
      },
    },
  };
}

const CONFIG = { model: DEFAULT_VISION_MODEL, apiBase: 'https://openrouter.ai/api/v1', apiKey: 'k' };

describe('OpenRouterVisionProvider — the request it sends', () => {
  it('POSTs an OpenAI-compatible chat completion carrying the image as a base64 data URI', async () => {
    const stub = stubHttp(completion('{"class":"burn-scar","certainty":"medium","notes":"A dark scar sits across the ridge."}'));
    await makeOpenRouterVision(CONFIG, { http: stub.http, imagery }).analyze(BURN);
    const call = stub.calls[0];
    expect(call?.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(call?.headers?.['authorization']).toBe('Bearer k');
    const body = call?.body as { model: string; temperature: number; messages: { role: string; content: unknown }[] };
    expect(body.model).toBe(DEFAULT_VISION_MODEL);
    expect(body.temperature).toBe(0); // same pixels ⇒ same classification
    const parts = body.messages[1]?.content as { type: string; image_url?: { url: string } }[];
    expect(parts[1]?.type).toBe('image_url');
    expect(parts[1]?.image_url?.url).toBe('data:image/png;base64,iVBORw==');
  });

  it('asks ONLY for a classification: the prompt offers the closed class list and forbids figures', async () => {
    const stub = stubHttp(completion('{"class":"burn-scar","certainty":"low"}'));
    await makeOpenRouterVision(CONFIG, { http: stub.http, imagery }).analyze(BURN);
    const system = String((stub.calls[0]?.body as { messages: { content: string }[] }).messages[0]?.content);
    for (const id of classIdsFor('burn-area')) expect(system).toContain(id);
    expect(system).toMatch(/NO FIGURE OF ANY KIND/);
    expect(system).toMatch(/low, medium, high/);
  });

  it('omits the authorization header for a keyless (local Ollama-shaped) rung', async () => {
    const stub = stubHttp(completion('{"class":"burn-scar","certainty":"high"}'));
    await makeOpenRouterVision({ model: 'llava', apiBase: 'http://localhost:11434/v1' }, { http: stub.http, imagery }).analyze(BURN);
    expect(stub.calls[0]?.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(stub.calls[0]?.headers?.['authorization']).toBeUndefined();
  });
});

describe('OpenRouterVisionProvider — Article XII: the model may classify, never produce a figure', () => {
  it('discards every numeric claim the model returns (label from a closed set, confidence from BEACON)', async () => {
    // Exactly what an unguarded vision model volunteers: an area, a percentage, a count, and its own score.
    const stub = stubHttp(
      completion(
        '{"class":"burn-scar","certainty":"high","confidence":0.97,"area_ha":1240,"structures_damaged":37,' +
          '"notes":"About 1240 hectares burned, roughly 40% of the visible ridge, and this is the worst-hit sector."}',
      ),
    );
    const finding = await makeOpenRouterVision(CONFIG, { http: stub.http, imagery }).analyze(BURN);
    expect(finding.label).toBe('possible burn scar'); // from the closed vocabulary, never model prose
    expect(finding.confidence).toBe(0.8); // BEACON's table for "high" — NOT the model's 0.97
    expect(finding.notes ?? '').not.toMatch(/1240|40%|37|0\.97/);
    expect(finding.notes ?? '').not.toMatch(/worst-hit/i); // a ranking is a figure too (F-340)
    expect(finding.notes).toMatch(/advisory/i);
    expect(finding.notes).toMatch(/NASA EOSDIS GIBS/); // cited at the point of creation
  });

  it('keeps figure-free prose, so a well-behaved model still gets to describe the scene', async () => {
    const stub = stubHttp(completion('{"class":"burn-scar","certainty":"medium","notes":"A dark scar runs along the ridge line."}'));
    const finding = await makeOpenRouterVision(CONFIG, { http: stub.http, imagery }).analyze(BURN);
    expect(finding.notes).toMatch(/dark scar runs along the ridge line/);
    expect(finding.confidence).toBe(0.6);
  });

  it('maps an unrecognised or absent class to "inconclusive" rather than echoing the model', () => {
    for (const raw of [{ class: 'catastrophic-megafire' }, { class: 42 }, {}]) {
      expect(toAdvisoryFinding(raw, 'burn-area', 'attr').label).toMatch(/^inconclusive/);
    }
  });

  it('lands on the lowest confidence rung for a missing or invented certainty word', () => {
    expect(toAdvisoryFinding({ class: 'burn-scar' }, 'burn-area', 'attr').confidence).toBe(0.25);
    expect(toAdvisoryFinding({ class: 'burn-scar', certainty: 'absolutely certain' }, 'burn-area', 'attr').confidence).toBe(0.25);
    // Never overstates: the top rung stays below 1 so a deterministic layer is never argued with.
    expect(toAdvisoryFinding({ class: 'burn-scar', certainty: 'HIGH' }, 'burn-area', 'attr').confidence).toBeLessThan(1);
  });

  it('classifies every task from its own vocabulary (no cross-task leakage)', () => {
    expect(toAdvisoryFinding({ class: 'standing-water' }, 'flood-extent', 'a').label).toBe('possible standing water');
    expect(toAdvisoryFinding({ class: 'standing-water' }, 'burn-area', 'a').label).toMatch(/^inconclusive/);
    expect(toAdvisoryFinding({ class: 'structural-damage' }, 'damage-severity', 'a').label).toBe('possible structural damage');
    expect(toAdvisoryFinding({ class: 'scene-described' }, 'scene', 'a').label).toBe('scene description');
  });
});

describe('OpenRouterVisionProvider — failure paths all THROW so the ladder descends (Art. XVI)', () => {
  it('throws on a non-2xx, an empty completion, and unparseable output', async () => {
    const provider = (r: HttpResponse): ReturnType<typeof makeOpenRouterVision> =>
      makeOpenRouterVision(CONFIG, { http: stubHttp(r).http, imagery });
    await expect(provider({ ok: false, status: 429, json: null }).analyze(BURN)).rejects.toThrow(/returned 429/);
    await expect(provider(completion('   ')).analyze(BURN)).rejects.toThrow(/empty classification/);
    await expect(provider(completion('I cannot help with that.')).analyze(BURN)).rejects.toThrow(/no JSON object/);
    // A 2xx whose body did not parse (`json: null`) — what a timed-out/truncated free-tier reply looks like.
    // Found in the 2026-08-08 live proof, where it threw a raw TypeError instead of descending the ladder.
    await expect(provider({ ok: true, status: 200, json: null }).analyze(BURN)).rejects.toThrow(/empty classification/);
  });

  it('throws when the imagery itself cannot be resolved — no pixels, no finding', async () => {
    const failing: ImageryResolver = { resolve: () => Promise.reject(new Error('imagery fixture:x not recorded on disk')) };
    const stub = stubHttp(completion('{"class":"burn-scar","certainty":"high"}'));
    await expect(makeOpenRouterVision(CONFIG, { http: stub.http, imagery: failing }).analyze(BURN)).rejects.toThrow(/not recorded on disk/);
    expect(stub.calls).toHaveLength(0); // and never calls the model on nothing
  });

  it('recovers JSON from a fenced or prefixed completion (small free models do this constantly)', () => {
    expect(parseClassification('```json\n{"class":"burn-scar"}\n```').class).toBe('burn-scar');
    expect(parseClassification('Sure! {"class":"obscured"} Hope that helps.').class).toBe('obscured');
    expect(() => parseClassification('[1,2,3]')).toThrow(/no JSON object/);
  });
});
