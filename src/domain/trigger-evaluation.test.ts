// BEACON — TRIGGER_EVALUATION vocabulary tests (D2; ADR-034 §3, finding F-34).
//
// These assertions are the honesty constraint made executable: if a future edit adds a `LIVE` source tier, a
// probability field to member-count evidence, or softens a label into marketing, one of these fails.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ENSEMBLE_MEMBER_COUNT_LABEL,
  SOURCE_DERIVED_PROBABILITY_LABEL,
  TRIGGER_APPLIED_GATES,
  TRIGGER_EVIDENCE_KINDS,
  TRIGGER_OUTCOME_REASONS,
  TRIGGER_SOURCE_TIERS,
  eapLedgerTarget,
} from './trigger-evaluation.js';

const SOURCE = readFileSync(
  fileURLToPath(new URL('./trigger-evaluation.ts', import.meta.url)),
  'utf8',
);

describe('the closed vocabularies', () => {
  it('offers exactly two evidence kinds and never mixes them', () => {
    expect([...TRIGGER_EVIDENCE_KINDS]).toEqual([
      'ENSEMBLE_MEMBER_COUNT',
      'SOURCE_DERIVED_PROBABILITY',
    ]);
    expect([...TRIGGER_APPLIED_GATES]).toEqual(['MEMBER_FRACTION', 'LIKELIHOOD_CLASS']);
  });

  it('has NO live source tier: a live-ensemble claim is unrepresentable, not merely discouraged (F-34)', () => {
    expect([...TRIGGER_SOURCE_TIERS]).toEqual(['CACHED', 'FIXTURE']);
    expect(TRIGGER_SOURCE_TIERS as readonly string[]).not.toContain('LIVE');
  });

  it('names a reason for every refusal, so no cycle is ever unexplained', () => {
    expect(TRIGGER_OUTCOME_REASONS.length).toBe(new Set(TRIGGER_OUTCOME_REASONS).size);
    for (const reason of [
      'EPISODE_STOPPED',
      'NO_EVIDENCE',
      'STALE_VINTAGE',
      'SUPERSEDED_RUN',
      'MAX_DURATION_ELAPSED',
    ]) {
      expect(TRIGGER_OUTCOME_REASONS as readonly string[]).toContain(reason);
    }
  });

  it('formats one and only one ledger target spelling for an episode', () => {
    expect(eapLedgerTarget('ro-danube-flood', 'ep-1')).toBe('eap:ro-danube-flood#ep-1');
  });
});

describe('the evidence labels state what the numbers are NOT (F-34)', () => {
  it('calls a member share a share of members, and denies it is a chance of occurrence', () => {
    expect(ENSEMBLE_MEMBER_COUNT_LABEL).toMatch(/share of forecast members over the threshold/i);
    expect(ENSEMBLE_MEMBER_COUNT_LABEL).toMatch(/NOT a calibrated probability/);
    expect(ENSEMBLE_MEMBER_COUNT_LABEL).toMatch(/NOT a chance of occurrence/);
    expect(ENSEMBLE_MEMBER_COUNT_LABEL).toMatch(/no wired live ensemble source/i);
  });

  it('never claims live ACCESS — it only ever denies having any', () => {
    expect(ENSEMBLE_MEMBER_COUNT_LABEL).not.toMatch(
      /\b(live feed|live api|live subscription|real-?time ensemble)\b/i,
    );
    // The only mention of "live" is the denial itself.
    expect([...ENSEMBLE_MEMBER_COUNT_LABEL.matchAll(/live/gi)].length).toBe(1);
    expect(ENSEMBLE_MEMBER_COUNT_LABEL).toMatch(/no wired live ensemble source/);
  });

  it('says a source-published probability is carried verbatim and never becomes a member count', () => {
    expect(SOURCE_DERIVED_PROBABILITY_LABEL).toMatch(/published by the source/i);
    expect(SOURCE_DERIVED_PROBABILITY_LABEL).toMatch(/never converts it into a member count/i);
  });
});

describe('the two evidence shapes are structurally disjoint (ADR-034 §3)', () => {
  it('declares no probability/chance/percent field on the member-count shape', () => {
    const memberShape = SOURCE.slice(
      SOURCE.indexOf('export interface EnsembleMemberCountEvidence'),
      SOURCE.indexOf('export interface SourceDerivedProbabilityEvidence'),
    );
    const fields = [...memberShape.matchAll(/^\s{2}readonly (\w+)/gm)].map((m) => m[1]);
    expect(fields).toContain('membersOverThreshold');
    expect(fields).toContain('memberTotal');
    for (const banned of ['probability', 'chance', 'percent', 'percentage', 'likelihoodPercent']) {
      expect(fields).not.toContain(banned);
    }
  });

  it('declares no memberTotal on the source-derived-probability shape', () => {
    const probShape = SOURCE.slice(
      SOURCE.indexOf('export interface SourceDerivedProbabilityEvidence'),
      SOURCE.indexOf('export type TriggerEvidence ='),
    );
    const fields = [...probShape.matchAll(/^\s{2}readonly (\w+)/gm)].map((m) => m[1]);
    expect(fields).toContain('probability');
    for (const banned of ['memberTotal', 'membersOverThreshold', 'memberFraction']) {
      expect(fields).not.toContain(banned);
    }
  });
});
