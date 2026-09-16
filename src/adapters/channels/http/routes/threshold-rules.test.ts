// BEACON — threshold-rule listing handler tests (E7·routes; register row 17). DETERMINISTIC: fixed clock,
// hand-built domain rules, no IO. Asserts the EM-only gate at EVERY lower rank, the envelope contract, and
// that the listed rules are the injected ones verbatim (no projection copy that could drift).
import { describe, it, expect } from 'vitest';
import { handleThresholdRules, type ThresholdRulesData } from './threshold-rules.js';
import { makeThresholdRule } from '@/domain/threshold-rule.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { RegionId, ThresholdRuleId } from '@/domain/value-objects/ids.js';
import type { AppUserRole } from '@/domain/app-user.js';
import type { Envelope } from '@/ports/interaction.js';

const FIXED = '2026-07-05T22:00:00Z';

const RULES = [
  makeThresholdRule({
    id: asId<ThresholdRuleId>('ca-hazard-buffer-rule'),
    target: 'HAZARD_BUFFER',
    operator: 'enters',
    value: '1000m',
  }),
  makeThresholdRule({
    id: asId<ThresholdRuleId>('ro-forecast-crossing-rule'),
    scope: asId<RegionId>('ro'),
    target: 'FORECAST_GAUGE_CATEGORY',
    operator: 'gte',
    value: 'MODERATE',
    hysteresis: 0,
    cooldown: 3600,
  }),
];

const deps = { rules: RULES, clock: () => FIXED };
const envelope = (body: unknown): Envelope => body as Envelope;

describe('handleThresholdRules — GET /threshold-rules', () => {
  it.each<AppUserRole>(['PUBLIC', 'RESPONDER', 'VERIFIER'])(
    'refuses %s with 403 — configuring/reading threshold rules is EM-only (CLARIFICATIONS §B.Q6)',
    async (role) => {
      const res = await handleThresholdRules({ role }, deps);
      expect(res.status).toBe(403);
      expect(envelope(res.body).errors?.[0]?.code).toBe('UNAUTHORIZED');
      expect(envelope(res.body).errors?.[0]?.message).toContain('EM');
    },
  );

  it('serves EM the configured rules with non-empty provenance + freshness (F1)', async () => {
    const res = await handleThresholdRules({ role: 'EM' }, deps);
    expect(res.status).toBe(200);
    const env = envelope(res.body);
    // Provenance names the CONFIGURATION, not a feed — attributing rules to an upstream source would lie.
    expect(env.provenance).toEqual([
      { sourceId: 'threshold-rule-config', mode: 'LIVE', fetchedAt: FIXED },
    ]);
    expect(env.freshness).toBe(FIXED);
    const data = env.data as ThresholdRulesData;
    expect(data.count).toBe(2);
    // The rules are the injected objects VERBATIM — the endpoint lists what runs, it does not re-describe it.
    expect(data.rules).toEqual(RULES);
    expect(data.rules[1]).toMatchObject({
      target: 'FORECAST_GAUGE_CATEGORY',
      operator: 'gte',
      value: 'MODERATE',
      scope: 'ro',
      cooldown: 3600,
    });
  });

  it('answers honestly (count 0) for a deployment that configures no rules — never an error', async () => {
    const res = await handleThresholdRules({ role: 'EM' }, { rules: [], clock: () => FIXED });
    expect(res.status).toBe(200);
    expect(envelope(res.body).data as ThresholdRulesData).toEqual({ rules: [], count: 0 });
    expect(envelope(res.body).provenance.length).toBe(1);
  });
});
