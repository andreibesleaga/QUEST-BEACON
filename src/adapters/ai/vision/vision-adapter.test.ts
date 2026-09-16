// BEACON — VisionPort adapter tests (E6·T-290/T-291; ADR-008/ADR-008a/CM-C10).
import { describe, expect, it } from 'vitest';
import { isErr, isOk } from '@/domain/shared/result.js';
import type { VisionRequest } from '@/ports/intel.js';
import { makeGateSeal } from '@/adapters/compliance/gate-token.js';
import { makeVisionAdapter } from './vision-adapter.js';
import { makeMockVision } from './mock-vision.js';

const request: VisionRequest = { imageRef: 'img-handle-1', task: 'flood-extent' };
const consented = { imageConsented: true, piiScreened: true };

async function stamp(seal = makeGateSeal()): Promise<string> {
  return seal.mint({ operation: 'vision.analyze', modelTier: 'VISION', maxTokens: 0 });
}

describe('VisionAdapter — off by default + gates', () => {
  it('refuses an un-stamped analyze() call', async () => {
    const v = makeVisionAdapter([makeMockVision()], makeGateSeal(), true);
    expect(isErr(await v.analyze())).toBe(true);
  });

  it('degrades to skip when FEATURE_VISION=off', async () => {
    const seal = makeGateSeal();
    const v = makeVisionAdapter([makeMockVision()], seal, false);
    const r = await v.sealed(await stamp(seal), consented).analyze(request);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.message).toMatch(/disabled|skipped/i);
  });

  it('rejects an un-consented / un-screened image BEFORE processing', async () => {
    const seal = makeGateSeal();
    const v = makeVisionAdapter([makeMockVision()], seal, true);
    const r = await v
      .sealed(await stamp(seal), { imageConsented: false, piiScreened: true })
      .analyze(request);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.message).toMatch(/consent/i);
  });

  it('returns an advisory, confidence-scored finding when enabled + consented + stamped', async () => {
    const seal = makeGateSeal();
    const v = makeVisionAdapter([makeMockVision()], seal, true);
    const r = await v.sealed(await stamp(seal), consented).analyze(request);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.confidence).toBeGreaterThan(0);
      expect(r.value.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('descends cloud→local→skip and never dead-ends', async () => {
    const seal = makeGateSeal();
    const v = makeVisionAdapter(
      [makeMockVision('cloud', true), makeMockVision('local', false)],
      seal,
      true,
    );
    const r = await v.sealed(await stamp(seal), consented).analyze(request);
    expect(isOk(r)).toBe(true);
  });
});
