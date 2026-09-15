// BEACON — drill composition-root tests (MW-D/D4; ADR-034 §7 Layer 2).
// The MODULE-GRAPH proof that this composition cannot reach a live channel lives in
// tests/architecture/drill-isolation.test.ts; this file asserts the composition's behaviour and the
// server-authoritative mode read. Deterministic: injected clock + injected env, no process.env mutation.
import { describe, expect, it } from 'vitest';
import { isOk } from '@/domain/shared/result.js';
import { EXERCISE_LABEL } from '@/domain/drill.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { AlertId, AppUserId, IncidentId } from '@/domain/value-objects/ids.js';
import { makeAuditChain } from '@/adapters/compliance/audit-chain.js';
import { DEFAULT_GOVERNANCE_CONFIG } from '@/application/governance/governance-config.js';
import { buildDrillDeps, resolveDrillMode } from './build-drill.js';

const T0 = '2026-07-05T22:00:00.000Z';
const clock = (): string => T0;
const em = asId<AppUserId>('u-em-1');
const episodeInput = {
  episodeId: 'ep-1',
  incidentId: asId<IncidentId>('inc-ro-1'),
  alertId: asId<AlertId>('al-drill-1'),
  category: 'Met',
  severity: 'SEVERE',
  approvalAttempt: { actorId: em, role: 'EM', at: T0 },
} as const;

describe('resolveDrillMode (server authoritative)', () => {
  it('defaults to off — an exercise composition is never the accidental one', () => {
    expect(resolveDrillMode({})).toBe('off');
    expect(resolveDrillMode({ DRILL_MODE: undefined })).toBe('off');
  });

  it('reads DRILL_MODE, and only DRILL_MODE', () => {
    expect(resolveDrillMode({ DRILL_MODE: 'on' })).toBe('on');
    // The browser mirror is UX-only and can never turn the server composition on by itself. (loadConfig
    // additionally refuses to boot when the two disagree — src/config/index.ts.)
    expect(resolveDrillMode({ NEXT_PUBLIC_DRILL_MODE: 'on' })).toBe('off');
  });

  it('degrades an unrecognised value to off (fail safe: not-in-drill is never the surprise)', () => {
    expect(resolveDrillMode({ DRILL_MODE: 'yes' })).toBe('off');
  });
});

describe('buildDrillDeps', () => {
  it('composes a ledger, a recorder and the SHIPPED SOP chain — and no channel of any kind', () => {
    const deps = buildDrillDeps({ clock, env: {} });
    expect(deps.mode).toBe('off');
    expect(deps.sopChain).toEqual(DEFAULT_GOVERNANCE_CONFIG.approval);
    expect(deps.recorder.records).toEqual([]);
    expect(deps.ledger.entries).toEqual([]);
    // The live composition's broadcast deps are `notifier`/`subscribers` (feature-seed.ts). A drill
    // composition has no such key, because makeBroadcastDeps is never called here.
    expect(Object.keys(deps)).toEqual([
      'mode',
      'clock',
      'ledger',
      'recorder',
      'sopChain',
      'episode',
    ]);
    expect(Object.keys(deps)).not.toContain('notifier');
    expect(Object.keys(deps)).not.toContain('subscribers');
    expect(Object.keys(deps)).not.toContain('sink');
  });

  it('runs a full exercise episode end to end, recording an EXERCISE artifact only', () => {
    const deps = buildDrillDeps({ clock, env: { DRILL_MODE: 'on' } });
    expect(deps.mode).toBe('on');
    const res = deps.episode(episodeInput);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.artifact.capStatus).toBe('EXERCISE');
    expect(res.value.artifact.label).toBe(EXERCISE_LABEL);
    expect(res.value.record?.sink).toBe('DRILL_RECORDER');
    expect(deps.recorder.records).toHaveLength(1);
    expect(deps.ledger.entries.map((e) => e.action)).toEqual([
      'DRILL_START',
      'SOP_APPROVE',
      'DRILL_ARTIFACT',
      'DRILL_END',
    ]);
    expect(deps.ledger.verify().intact).toBe(true);
  });

  it('writes the exercise into a SHARED chain when one is injected (one sequence, not two logs)', () => {
    const audit = makeAuditChain();
    audit.append({ action: 'ALERT_EMIT', target: 'alert:al-real', at: T0 });
    const deps = buildDrillDeps({ clock, env: {}, audit });
    expect(isOk(deps.episode(episodeInput))).toBe(true);
    expect(audit.events.map((e) => e.action)).toEqual([
      'ALERT_EMIT',
      'DRILL_START',
      'SOP_APPROVE',
      'DRILL_ARTIFACT',
      'DRILL_END',
    ]);
    expect(audit.verify()).toBe(true);
  });

  it('accepts a governance override (an operator SOP that is not the shipped one)', () => {
    const deps = buildDrillDeps({
      clock,
      env: {},
      governance: {
        ...DEFAULT_GOVERNANCE_CONFIG,
        approval: { authorizerRole: 'VERIFIER', fallbackRole: 'EM', fallbackAfterMinutes: 5 },
      },
    });
    expect(deps.sopChain.authorizerRole).toBe('VERIFIER');
    // …and the episode then holds the EM to the fallback window rather than approving instantly.
    const res = deps.episode(episodeInput);
    expect(isOk(res)).toBe(false);
  });

  it('falls back to process.env when no env is injected (the production read path)', () => {
    expect(buildDrillDeps({ clock }).mode).toBe(resolveDrillMode(process.env));
  });
});
