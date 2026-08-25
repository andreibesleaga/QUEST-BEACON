// BEACON — F-53 CLOSURE TEST: multilingual CAP is EMITTED by the production composition (D3.4; ADR-036 §5,
// FR-I18N-6 / FUW-2).
//
// This file exists because the previous state of the world was "built but unreached": `capTranslationsFor()`
// and `regionAlertLocales()` both existed, both were unit-tested, and NEITHER had a production caller — so
// every CAP document BEACON actually emitted carried exactly one English <info> block. A unit test of the
// helpers could not have caught that, and did not.
//
// So these tests deliberately refuse to construct anything by hand. They go through `buildFeatureDeps`
// (the real composition root) and `handleAlertApprove` (the real HITL route), then read the document out of
// `sink.emissions` — the same array the HTTP response returns. If the wiring regresses, this fails; a helper
// unit test would still pass.
import { describe, it, expect } from 'vitest';
import { asId } from '@/domain/value-objects/ids.js';
import type { AlertId, IncidentId, SourceId, ThresholdRuleId } from '@/domain/value-objects/ids.js';
import { makeThresholdRule } from '@/domain/threshold-rule.js';
import { capMachineValuesAgree } from '@/adapters/interop/cap-mapper.js';
import { handleAlertApprove } from '@/adapters/channels/http/routes/interop.js';
import type { AppUserId } from '@/domain/value-objects/ids.js';
import { buildFeatureDeps, DEFAULT_FEATURE_SEED } from './feature-seed.js';
import type { FeatureSeed } from './feature-seed.js';

const FIXED_NOW = '2026-07-05T22:00:00Z';
const clock = (): string => FIXED_NOW;
const APPROVER = asId<AppUserId>('em-1');

/** A firing threshold spec for one incident — the ONLY way a DRAFT alert comes into existence (FR-11). */
function spec(incidentId: IncidentId, alertId: string): FeatureSeed['thresholds'][number] {
  return {
    rule: makeThresholdRule({
      id: asId<ThresholdRuleId>(`${alertId}-rule`),
      target: 'HAZARD_BUFFER',
      operator: 'enters',
      value: '1000m',
    }),
    reading: { hazardWithinBuffer: true },
    incidentId,
    alertId: asId<AlertId>(alertId),
    category: 'Met',
    severity: 'SEVERE',
    sourceId: asId<SourceId>('nwps'),
  };
}

/** Approve + emit `alertId` through the real route and return the emitted CAP document. */
async function emitThrough(seed: FeatureSeed, alertId: string) {
  const deps = buildFeatureDeps({ clock, seed, env: {} });
  const res = await handleAlertApprove(
    { alertId: asId<AlertId>(alertId), actorRole: 'EM', approvedBy: APPROVER },
    deps.interop,
  );
  expect(res.status, JSON.stringify(res.body.errors)).toBe(201);
  const record = deps.interop.sink.emissions.at(-1);
  expect(record).toBeDefined();
  return record!.cap;
}

describe('F-53 — a REAL emitted CAP carries one <info> per region language', () => {
  it('emits a Romanian AND an English <info> block for an alert in the `ro` region', async () => {
    // config/regions.json declares region `ro` with languages: ['ro']; regionAlertLocales appends English.
    const seed: FeatureSeed = {
      ...DEFAULT_FEATURE_SEED,
      thresholds: [spec(asId<IncidentId>('ro-flood-demo'), 'ro-alert-draft-1')],
    };
    const cap = await emitThrough(seed, 'ro-alert-draft-1');

    expect(cap.info).toHaveLength(2);
    expect(cap.info.map((i) => i.language)).toEqual(['ro', 'en']);
  });

  it('carries genuinely DIFFERENT human text per block (not English twice under two tags)', async () => {
    const seed: FeatureSeed = {
      ...DEFAULT_FEATURE_SEED,
      thresholds: [spec(asId<IncidentId>('ro-flood-demo'), 'ro-alert-draft-1')],
    };
    const cap = await emitThrough(seed, 'ro-alert-draft-1');
    const ro = cap.info[0]!;
    const en = cap.info[1]!;

    // Romanian copy, from messages/ro.json `warning.*` — the whole point of the hop.
    expect(ro.event).toBe('Inundație sau vreme severă');
    expect(ro.headline).toContain('INUNDAȚIE');
    expect(ro.instruction).toContain('Urmăriți actualizările');
    // English copy, from messages/en.json — ALWAYS present (ADR-030 §7).
    expect(en.event).toBe('Flood or severe weather');
    expect(en.headline).toContain('FLOOD');
    expect(en.instruction).toContain('Watch for updates');
    // Not the same words. If the wiring silently fell back to English, these would be equal.
    expect(ro.headline).not.toBe(en.headline);
    expect(ro.description).not.toBe(en.description);
    expect(ro.instruction).not.toBe(en.instruction);
  });

  it('keeps every MACHINE-READABLE value byte-identical across both blocks (FUW-2)', async () => {
    const seed: FeatureSeed = {
      ...DEFAULT_FEATURE_SEED,
      thresholds: [spec(asId<IncidentId>('ro-flood-demo'), 'ro-alert-draft-1')],
    };
    const cap = await emitThrough(seed, 'ro-alert-draft-1');

    expect(capMachineValuesAgree(cap)).toBe(true);
    for (const info of cap.info) {
      expect(info.category).toEqual(['Met']);
      expect(info.severity).toBe('Severe');
      expect(info.urgency).toBe('Expected');
      expect(info.certainty).toBe('Likely');
    }
    // KNOWN GAP, pinned here rather than glossed (finding F-124): a threshold-derived DRAFT alert carries no
    // `area` geometry (`buildDraftAlert` does not attach the hazard footprint), so the emitted document has
    // no <area> block at all — which is also why CAP_PROFILE=ipaws would reject it (that profile requires at
    // least one <area>). This assertion documents the current truth; when the derivation starts attaching
    // geometry it will fail and be updated deliberately, instead of the gap being invisible.
    const [ro, en] = cap.info;
    expect(ro?.area).toBeUndefined();
    expect(en?.area).toBeUndefined();
  });

  it('emits ONE English block for an English-only region (no duplicate, no fabricated language)', async () => {
    // The shipped demo alert lives in `us-ca` (languages: ['en']) — so the default demo document is
    // single-block, exactly as before. That is correct behaviour, not an unwired path.
    const cap = await emitThrough(DEFAULT_FEATURE_SEED, 'ca-alert-draft-1');
    expect(cap.info).toHaveLength(1);
    expect(cap.info[0]?.language).toBe('en');
    expect(cap.info[0]?.event).toBe('Wildfire');
  });

  it('emits ENGLISH ONLY for an incident mapped to no region (never another region language)', async () => {
    const seed: FeatureSeed = {
      ...DEFAULT_FEATURE_SEED,
      thresholds: [spec(asId<IncidentId>('unmapped-incident'), 'orphan-alert-1')],
      incidentRegions: new Map(),
    };
    const cap = await emitThrough(seed, 'orphan-alert-1');
    expect(cap.info.map((i) => i.language)).toEqual(['en']);
  });

  it('emits Filipino + English for a region whose languages already include English (no duplicate `en`)', async () => {
    // config/regions.json region `ph` declares languages: ['fil', 'en'] — the de-duplication is real config,
    // not a hypothetical.
    const seed: FeatureSeed = {
      ...DEFAULT_FEATURE_SEED,
      thresholds: [spec(asId<IncidentId>('ph-storm-demo'), 'ph-alert-draft-1')],
      incidentRegions: new Map([['ph-storm-demo', 'ph']]),
      incidentAreaDesc: new Map([['ph-storm-demo', 'Albay, Bicol Region']]),
    };
    const cap = await emitThrough(seed, 'ph-alert-draft-1');
    expect(cap.info.map((i) => i.language)).toEqual(['fil', 'en']);
    expect(cap.info[0]?.instruction).toContain('Sundan ang mga update');
  });
});
