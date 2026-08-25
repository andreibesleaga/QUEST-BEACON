// BEACON — DRILL artifact tests (MW-D/D4; ADR-034 §7 Layer 1).
// The COMPILE-TIME half of this guarantee lives in tests/architecture/drill-isolation.test.ts (a
// `@ts-expect-error` on `sink.emit(exercise)`); this file pins the runtime shape the type relies on.
import { describe, expect, it } from 'vitest';
import {
  DRILL_MODES,
  EXERCISE_CAP_STATUS,
  EXERCISE_LABEL,
  exerciseLabelled,
  isDrillArtifact,
  makeDrillAlert,
} from './drill.js';
import { CAP_STATUSES, makeAlert } from './alert.js';
import { InvariantViolation } from './errors.js';
import { asId } from './value-objects/ids.js';
import type { AlertId, AppUserId, IncidentId } from './value-objects/ids.js';

const T0 = '2026-07-05T22:00:00.000Z';
const alertId = asId<AlertId>('al-drill-1');
const incidentId = asId<IncidentId>('inc-1');
const approver = asId<AppUserId>('u-em-1');
const base = { id: alertId, incidentId, category: 'Met', severity: 'SEVERE', at: T0 } as const;

describe('makeDrillAlert', () => {
  it('stamps EXERCISE status, the exercise flag and the never-translated label', () => {
    const drill = makeDrillAlert(base);
    expect(drill.capStatus).toBe('EXERCISE');
    expect(drill.exercise).toBe(true);
    expect(drill.label).toBe(EXERCISE_LABEL);
    expect(drill.sentAt).toBe(T0); // the injected instant, never a wall-clock read
    expect(Object.isFrozen(drill)).toBe(true);
  });

  it('never carries `approvedBy` — the field the emit gate reads is uninhabited on a drill', () => {
    const drill = makeDrillAlert({ ...base, exerciseApprovedBy: approver, exerciseApprovedByRole: 'EM' });
    expect(drill.approvedBy).toBeUndefined();
    expect(Object.keys(drill)).not.toContain('approvedBy');
    // Who approved the EXERCISE is still recorded — just not in the field an emission would consult.
    expect(drill.exerciseApprovedBy).toBe(approver);
    expect(drill.exerciseApprovedByRole).toBe('EM');
  });

  it('omits the optional exercise-approver fields when absent', () => {
    const drill = makeDrillAlert(base);
    expect(Object.keys(drill)).not.toContain('exerciseApprovedBy');
    expect(Object.keys(drill)).not.toContain('exerciseApprovedByRole');
  });

  it('carries an optional area and edxlKind, defaulting the kind exactly as makeAlert does', () => {
    const area = { type: 'Point', coordinates: [25.6, 45.1] } as const;
    const withArea = makeDrillAlert({ ...base, area, edxlKind: 'EDXL_SITREP' });
    expect(withArea.area).toEqual(area);
    expect(withArea.edxlKind).toBe('EDXL_SITREP');
    expect(makeDrillAlert(base).edxlKind).toBe('CAP');
    expect(Object.keys(makeDrillAlert(base))).not.toContain('area');
  });

  it('enforces every real Alert invariant — an exercise is held to the same validity bar', () => {
    expect(() => makeDrillAlert({ ...base, category: 'Weather' as never })).toThrow(InvariantViolation);
    expect(() => makeDrillAlert({ ...base, severity: 'CATASTROPHIC' as never })).toThrow(InvariantViolation);
    expect(() => makeDrillAlert({ ...base, incidentId: '' as unknown as IncidentId })).toThrow(InvariantViolation);
  });

  it('is NOT expressible as a CapStatus — EXERCISE is deliberately outside the shared enum', () => {
    // Widening CAP_STATUSES would make every Alert-typed consumer silently accept an exercise value; keeping
    // EXERCISE out means a drill artifact is not an Alert and cannot flow anywhere an Alert flows.
    expect(CAP_STATUSES).toEqual(['DRAFT', 'ACTUAL']);
    expect((CAP_STATUSES as readonly string[]).includes(EXERCISE_CAP_STATUS)).toBe(false);
  });
});

describe('isDrillArtifact', () => {
  it('is true for an exercise artifact and false for a real DRAFT or ACTUAL alert', () => {
    expect(isDrillArtifact(makeDrillAlert(base))).toBe(true);
    expect(isDrillArtifact(makeAlert({ id: alertId, incidentId, category: 'Met', severity: 'SEVERE' }))).toBe(false);
    expect(
      isDrillArtifact(
        makeAlert({ id: alertId, incidentId, category: 'Met', severity: 'SEVERE', capStatus: 'ACTUAL', approvedBy: approver }),
      ),
    ).toBe(false);
    expect(isDrillArtifact({})).toBe(false);
  });
});

describe('labelling (FOP-4)', () => {
  it('prefixes a human-readable document so it cannot be mistaken for a real emergency', () => {
    expect(exerciseLabelled('Flood warning for Ialomița')).toBe(`${EXERCISE_LABEL} — Flood warning for Ialomița`);
  });

  it('declares the drill-mode vocabulary once, defaulting off elsewhere', () => {
    expect(DRILL_MODES).toEqual(['off', 'on']);
  });
});
