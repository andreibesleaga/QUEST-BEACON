// BEACON — GET /alerts lists an approved alert with its new state (2026-11-21; FR-11, Art. XIII).
//
// The list is the review surface for the approval gate. An alert the reviewer has approved stays in it
// with state ACTUAL, so the reviewer sees the outcome of the decision; the client offers the approve
// control for DRAFT rows only. The API description used to say every row is DRAFT while the handler
// listed every alert — this pins the behaviour the description now states.
import { describe, it, expect } from 'vitest';
import { makeAlert } from '@/domain/alert.js';
import type { AlertId, AppUserId, IncidentId } from '@/domain/value-objects/ids.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { Envelope } from '@/ports/interaction.js';
import { makeInMemoryAlertStore } from './interop.js';
import { handleAlertsGet, type AlertQueueItem } from './queue.js';

const clock = (): string => '2026-07-05T14:30:00Z';
const INCIDENT = asId<IncidentId>('inc-1');

const outstanding = makeAlert({
  id: asId<AlertId>('alert-draft'),
  incidentId: INCIDENT,
  capStatus: 'DRAFT',
  category: 'Met',
  severity: 'SEVERE',
});
const approved = makeAlert({
  id: asId<AlertId>('alert-approved'),
  incidentId: INCIDENT,
  capStatus: 'ACTUAL',
  category: 'Fire',
  severity: 'MODERATE',
  approvedBy: asId<AppUserId>('user-em-1'),
});

describe('GET /alerts — approved alerts stay listed', () => {
  it('lists the DRAFT and the approved alert, each with its own state', async () => {
    const res = await handleAlertsGet(
      { role: 'VERIFIER' },
      { alerts: makeInMemoryAlertStore([outstanding, approved]), clock },
    );
    expect(res.status).toBe(200);
    const rows = (res.body as Envelope<{ readonly alerts: readonly AlertQueueItem[] }>).data.alerts;
    expect(rows.map((a) => [a.id, a.state])).toEqual([
      ['alert-draft', 'DRAFT'],
      ['alert-approved', 'ACTUAL'],
    ]);
  });

  it('refuses a role below VERIFIER whatever the list holds', async () => {
    const res = await handleAlertsGet(
      { role: 'RESPONDER' },
      { alerts: makeInMemoryAlertStore([approved]), clock },
    );
    expect(res.status).toBe(403);
  });
});
