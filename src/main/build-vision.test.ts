// BEACON — vision compliance-proxy in-path wiring tests (E6·T-290/T-291; ADR-008/008a/ADR-017, Art. XII/
// XIV). Proves the advisory VisionPort flows THROUGH the SAME mandatory-chokepoint shape as build-ai.ts
// (seal-gated adapter, hash-chained audit, fail-closed proxy): FEATURE_VISION=off refuses every call
// (disabled, never a dead-end); FEATURE_VISION=on + consented/PII-screened imagery narrates an advisory,
// confidence-scored finding; unconsented/unscreened imagery is refused (Art. XIV); the burn-area
// (Sentinel-2 NBR) task fixture path runs end-to-end through the deterministic MockVision (no network).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { pino } from 'pino';
import { isOk } from '@/domain/shared/result.js';
import type { ComplianceRequest, VisionMediatePayload, VisionFinding, VisionRequest } from '@/ports/intel.js';
import { loadConfig } from '@/config/index.js';
import { makeObservability } from '@/adapters/ai/observability.js';
import { makeMockVision } from '@/adapters/ai/vision/mock-vision.js';
import { buildComplianceVision } from './build-vision.js';

const SILENT = makeObservability(pino({ level: 'silent' }));

// Recorded, consented, PII-screened Sentinel-2 burn-area (NBR) imagery fixture (E6·T-291) — see
// adapters/ai/vision/__fixtures__/sentinel2-burn-area-001.json for provenance/license.
interface VisionFixture {
  readonly imageRef: string;
  readonly task: VisionRequest['task'];
  readonly consent: { readonly imageConsented: boolean; readonly piiScreened: boolean };
}
const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../adapters/ai/vision/__fixtures__/sentinel2-burn-area-001.json', import.meta.url)), 'utf8'),
) as VisionFixture;

const BURN_AREA_FIXTURE: VisionMediatePayload = {
  request: { imageRef: fixture.imageRef, task: fixture.task },
  context: { imageConsented: fixture.consent.imageConsented, piiScreened: fixture.consent.piiScreened },
};

function visionReq(payload: VisionMediatePayload, actorRole: ComplianceRequest<VisionMediatePayload>['actorRole'] = 'VERIFIER'): ComplianceRequest<VisionMediatePayload> {
  return { actorRole, modelTier: 'VISION', operation: 'vision.analyze', payload };
}

describe('buildComplianceVision — the mandatory in-path chokepoint, mirroring buildComplianceAi', () => {
  it('FEATURE_VISION=on: routes a VERIFIER vision.analyze call through the gateway + seal-gated adapter, hash-chain audited', async () => {
    const { vision, audit } = buildComplianceVision(loadConfig({ FEATURE_VISION: 'on' }), { observability: SILENT });
    const res = await vision.mediate<VisionMediatePayload, VisionFinding>(visionReq(BURN_AREA_FIXTURE));
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.allowed).toBe(true);
    expect(res.value.result?.label).toBe('possible burn scar'); // MockVision's burn-area label
    expect(res.value.result?.confidence).toBeGreaterThan(0);
    expect(res.value.result?.confidence).toBeLessThanOrEqual(1);
    // Advisory — never a bare number/verdict with no context (Art. XII narration parity).
    expect(res.value.result?.notes).toMatch(/advisory/i);
    expect(audit.events.some((e) => e.action.startsWith('ai_call'))).toBe(true);
    expect(audit.verify()).toBe(true);
  });

  it('FEATURE_VISION=off (default): every call is refused — disabled, never a dead-end (byte-identical to today)', async () => {
    const { vision } = buildComplianceVision(loadConfig({}), { observability: SILENT });
    const res = await vision.mediate<VisionMediatePayload, VisionFinding>(visionReq(BURN_AREA_FIXTURE));
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.allowed).toBe(false);
  });

  it('consent-gate: unconsented imagery is refused even with FEATURE_VISION=on (Art. XIV)', async () => {
    const { vision } = buildComplianceVision(loadConfig({ FEATURE_VISION: 'on' }), { observability: SILENT });
    const unconsented: VisionMediatePayload = { ...BURN_AREA_FIXTURE, context: { imageConsented: false, piiScreened: true } };
    const res = await vision.mediate<VisionMediatePayload, VisionFinding>(visionReq(unconsented));
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.allowed).toBe(false);
  });

  it('consent-gate: un-PII-screened imagery is refused even with FEATURE_VISION=on (Art. XIV)', async () => {
    const { vision } = buildComplianceVision(loadConfig({ FEATURE_VISION: 'on' }), { observability: SILENT });
    const unscreened: VisionMediatePayload = { ...BURN_AREA_FIXTURE, context: { imageConsented: true, piiScreened: false } };
    const res = await vision.mediate<VisionMediatePayload, VisionFinding>(visionReq(unscreened));
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.allowed).toBe(false);
  });

  it('is NOT bypassable: COMPLIANCE_PROXY_ENABLED=off fails closed (503) → no upstream call', async () => {
    const { vision } = buildComplianceVision(loadConfig({ FEATURE_VISION: 'on', COMPLIANCE_PROXY_ENABLED: 'off' }), { observability: SILENT });
    const res = await vision.mediate<VisionMediatePayload, VisionFinding>(visionReq(BURN_AREA_FIXTURE));
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.allowed).toBe(false);
  });

  it('RBAC in-path: a PUBLIC actor may not reach the vision tier (deny-by-default role-scope)', async () => {
    const { vision } = buildComplianceVision(loadConfig({ FEATURE_VISION: 'on' }), { observability: SILENT });
    const res = await vision.mediate<VisionMediatePayload, VisionFinding>(visionReq(BURN_AREA_FIXTURE, 'PUBLIC'));
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.allowed).toBe(false);
  });

  it('degrades on an unavailable provider — never throws (Art. XVI cloud→local→skip)', async () => {
    const { vision } = buildComplianceVision(loadConfig({ FEATURE_VISION: 'on' }), {
      providers: [makeMockVision('cloud-vision', true)], // failing=true
      observability: SILENT,
    });
    const res = await vision.mediate<VisionMediatePayload, VisionFinding>(visionReq(BURN_AREA_FIXTURE));
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.allowed).toBe(false); // skipped, not a thrown exception (F16 fail-open availability)
  });
});

// S2·Lane V — the ladder is no longer hardcoded. `const providers = options.providers ?? [makeMockVision()]`
// was the single line that made every documented VISION_* variable inert (UNIMPLEMENTED_REGISTER row 27);
// these prove the composition root now reads VISION_MODE and that the offline default is untouched.
describe('buildComplianceVision — the env-driven vision ladder (VISION_MODE)', () => {
  it('VISION_MODE=off (default) still composes the plain offline MockVision — no network, no egress', async () => {
    const { vision } = buildComplianceVision(loadConfig({ FEATURE_VISION: 'on' }), { observability: SILENT });
    const res = await vision.mediate<VisionMediatePayload, VisionFinding>(visionReq(BURN_AREA_FIXTURE));
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.result?.label).toBe('possible burn scar');
    expect(res.value.result?.notes).not.toMatch(/DEGRADED RUNG/); // the plain mock, not the labelled fallback
  });

  it('VISION_MODE=cloud with NO OpenRouter key composes the LABELLED degraded rung — boots, never throws', async () => {
    // The keys live outside EnvSchema (build-ai.ts:39), so there is no boot-time refine to catch this; the
    // honest behaviour is a finding that SAYS no model looked at the image, not a dead server.
    const { vision } = buildComplianceVision(loadConfig({ FEATURE_VISION: 'on', VISION_MODE: 'cloud' }), { env: {}, observability: SILENT });
    const res = await vision.mediate<VisionMediatePayload, VisionFinding>(visionReq(BURN_AREA_FIXTURE));
    if (!isOk(res)) throw new Error('expected ok');
    expect(res.value.result?.notes).toMatch(/DEGRADED RUNG/);
    expect(res.value.result?.notes).toMatch(/OPENROUTER_API_KEY/);
  });
});
