// BEACON — gateway seal tests (E6·T-255/T-256; ADR-017/F16/D-29).
import { describe, expect, it } from 'vitest';
import { makeGateSeal } from './gate-token.js';

describe('GateSeal — in-process capability stamp', () => {
  it('mints a stamp its own instance can verify', async () => {
    const seal = makeGateSeal();
    const token = await seal.mint({ operation: 'llm.narrate', modelTier: 'CLOUD', maxTokens: 800 });
    const claims = await seal.verify(token);
    expect(claims?.operation).toBe('llm.narrate');
    expect(claims?.maxTokens).toBe(800);
  });

  it('rejects a forged/garbage token (adapter would refuse the call)', async () => {
    const seal = makeGateSeal();
    expect(await seal.verify('not-a-jwt')).toBeNull();
  });

  it('rejects a token minted by a DIFFERENT seal (no cross-forge)', async () => {
    const a = makeGateSeal();
    const b = makeGateSeal();
    const token = await a.mint({ operation: 'llm.narrate', modelTier: 'CLOUD', maxTokens: 400 });
    expect(await b.verify(token)).toBeNull();
  });
});
