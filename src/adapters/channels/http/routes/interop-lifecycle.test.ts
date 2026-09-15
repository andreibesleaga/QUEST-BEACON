// BEACON — warning-lifecycle + delivery-feedback route battery (D3.2/D3.3; ADR-036 §2, V3/V4/V5).
//
// The two WMO-checklist gaps this closes are "inform when impacts ended" and "verify warnings reached
// people", so the tests assert the honest version of both:
//   • an ALL-CLEAR really is emitted as a CAP Cancel that references the original message BY TRIPLET — and
//     it still needs a human approver, because telling people a hazard is over is itself a public action;
//   • a delivery tally really is produced from the broadcast loop that used to discard its results — and it
//     contains COUNTS PER CHANNEL and provably no recipient data (Art. XIV).
import { describe, it, expect } from 'vitest';
import { makeAlert } from '@/domain/alert.js';
import type { Alert } from '@/domain/alert.js';
import { asId } from '@/domain/value-objects/ids.js';
import type { AlertId, AppUserId, IncidentId } from '@/domain/value-objects/ids.js';
import type { PolygonGeometry } from '@/domain/value-objects/geo.js';
import type { Result } from '@/domain/shared/result.js';
import { err, ok } from '@/domain/shared/result.js';
import { DomainError } from '@/domain/errors.js';
import type { NotificationPort } from '@/ports/interaction.js';
import { makeAlertSink } from '@/adapters/alerting/alert-sink.js';
import { makeInMemorySubscriberRegistry } from '@/adapters/channels/messaging/subscriber-registry.js';
import {
  handleAlertAllClear,
  handleAlertApprove,
  makeInMemoryAlertStore,
  makeInMemoryEdxlRmStore,
} from './interop.js';
import type { InteropDeps } from './interop.js';

const NOW = '2026-07-05T22:00:00Z';
const clock = (): string => NOW;
const APPROVER = asId<AppUserId>('em-1');
const ORIGINAL = asId<AlertId>('ro-alert-1');

const RING: PolygonGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [24.0, 44.0],
      [24.2, 44.0],
      [24.2, 44.2],
      [24.0, 44.2],
      [24.0, 44.0],
    ],
  ],
};

function draftAlert(): Alert {
  return makeAlert({
    id: ORIGINAL,
    incidentId: asId<IncidentId>('inc-1'),
    category: 'Met',
    severity: 'SEVERE',
    area: RING,
    responseType: ['Evacuate'],
    urgency: 'Immediate',
    certainty: 'Observed',
    headline: 'FLOOD — Severe',
    instruction: 'Leave the floodplain now.',
  });
}

function deps(extra: Partial<InteropDeps> = {}): InteropDeps {
  return {
    clock,
    alerts: makeInMemoryAlertStore([draftAlert()]),
    edxlRm: makeInMemoryEdxlRmStore(),
    sink: makeAlertSink({ clock }),
    ...extra,
  };
}

describe('ALL-CLEAR — first-class, referenced, and still human-approved (V3)', () => {
  it('authors a DRAFT that references the original and emits NOTHING by itself (Art. XIII)', async () => {
    const d = deps();
    await handleAlertApprove({ alertId: ORIGINAL, actorRole: 'EM', approvedBy: APPROVER }, d);
    expect(d.sink.emissions).toHaveLength(1);

    const res = await handleAlertAllClear({ alertId: ORIGINAL, actorRole: 'EM' }, d);
    expect(res.status).toBe(201);
    const body = res.body.data as { alert: Alert };
    expect(body.alert.capStatus).toBe('DRAFT');
    expect(body.alert.approvedBy).toBeUndefined();
    expect(body.alert.references).toEqual([ORIGINAL]);
    expect(res.body.meta?.['emitted']).toBe(false);
    expect(res.body.meta?.['requiresApproval']).toBe(true);
    // Nothing new was emitted: authoring an all-clear is not a public action; approving one is.
    expect(d.sink.emissions).toHaveLength(1);
  });

  it('emits a CAP Cancel carrying the original as a sender,identifier,sent TRIPLET once approved (V4)', async () => {
    const d = deps();
    await handleAlertApprove({ alertId: ORIGINAL, actorRole: 'EM', approvedBy: APPROVER }, d);
    const original = d.sink.emissions[0]!.cap;

    const authored = await handleAlertAllClear({ alertId: ORIGINAL, actorRole: 'EM' }, d);
    const allClearId = (authored.body.data as { alert: Alert }).alert.id;

    const approved = await handleAlertApprove(
      { alertId: allClearId, actorRole: 'EM', approvedBy: APPROVER },
      d,
    );
    expect(approved.status, JSON.stringify(approved.body.errors)).toBe(201);

    const cap = d.sink.emissions.at(-1)!.cap;
    expect(cap.msgType).toBe('Cancel');
    expect(cap.identifier).not.toBe(original.identifier); // a follow-up is a NEW message
    expect(cap.references).toBe(`${original.sender},${original.identifier},${original.sent}`);
    expect(cap.info[0]?.responseType).toEqual(['AllClear']);
    expect(cap.info[0]?.urgency).toBe('Past');
    expect(cap.info[0]?.certainty).toBe('Observed');
  });

  it('BLOCKS the emission of a Cancel whose referenced message this sink never emitted', async () => {
    // A Cancel whose reference cannot be resolved to a real prior message must not go out claiming to
    // cancel something. Constructed by handing a FRESH sink an already-approved cancel.
    const d = deps();
    await handleAlertApprove({ alertId: ORIGINAL, actorRole: 'EM', approvedBy: APPROVER }, d);
    const authored = await handleAlertAllClear({ alertId: ORIGINAL, actorRole: 'EM' }, d);
    const allClear = (authored.body.data as { alert: Alert }).alert;

    const amnesiacSink = makeAlertSink({ clock }); // no emission history at all
    const res = await handleAlertApprove(
      { alertId: allClear.id, actorRole: 'EM', approvedBy: APPROVER },
      { ...d, sink: amnesiacSink },
    );
    expect(res.status).toBe(400);
    expect(amnesiacSink.emissions).toHaveLength(0);
  });

  it('refuses to clear an alert that was never made public, or an unknown one', async () => {
    const d = deps();
    const never = await handleAlertAllClear({ alertId: ORIGINAL, actorRole: 'EM' }, d);
    expect(never.status).toBe(409);
    const missing = await handleAlertAllClear(
      { alertId: asId<AlertId>('nope'), actorRole: 'EM' },
      d,
    );
    expect(missing.status).toBe(404);
  });

  it('requires VERIFIER+ to author an all-clear', async () => {
    const d = deps();
    await handleAlertApprove({ alertId: ORIGINAL, actorRole: 'EM', approvedBy: APPROVER }, d);
    const res = await handleAlertAllClear({ alertId: ORIGINAL, actorRole: 'RESPONDER' }, d);
    expect(res.status).toBe(403);
  });
});

/** A notifier that fails for a named audience — models one unreachable destination. */
function flakyNotifier(failFor: readonly string[], seen: string[]): NotificationPort {
  return {
    notify(audience: string): Promise<Result<void, DomainError>> {
      seen.push(audience);
      return Promise.resolve(
        failFor.includes(audience)
          ? err(new DomainError('CONFLICT', 'transport down'))
          : ok(undefined),
      );
    },
  };
}

describe('per-channel delivery counts (V5; finding F-30)', () => {
  it('tallies attempted / delivered / failed per CHANNEL with one failing destination of three', async () => {
    const seen: string[] = [];
    const d = deps({
      notifier: flakyNotifier(['chat-b'], seen),
      subscribers: makeInMemorySubscriberRegistry(['chat-a', 'chat-b', 'chat-c']),
    });
    const res = await handleAlertApprove(
      { alertId: ORIGINAL, actorRole: 'EM', approvedBy: APPROVER },
      d,
    );

    expect(res.status).toBe(201);
    expect(res.body.meta?.['delivery']).toEqual([
      { channel: 'telegram', attempted: 3, delivered: 2, failed: 1 },
    ]);
    expect(seen).toEqual(['chat-a', 'chat-b', 'chat-c']); // every destination was still attempted
  });

  it('retains NO per-recipient data anywhere in the response or the emission audit (Art. XIV)', async () => {
    const chatIds = ['chat-a', 'chat-b', 'chat-c'];
    const d = deps({
      notifier: flakyNotifier(['chat-b'], []),
      subscribers: makeInMemorySubscriberRegistry(chatIds),
    });
    const res = await handleAlertApprove(
      { alertId: ORIGINAL, actorRole: 'EM', approvedBy: APPROVER },
      d,
    );

    const serialized = JSON.stringify(res.body) + JSON.stringify(d.sink.emissions);
    for (const id of chatIds) expect(serialized, `${id} must not appear`).not.toContain(id);
    // And the tally's own shape offers nowhere to put one: exactly four keys, all of them numbers or a name.
    const tally = (res.body.meta?.['delivery'] as readonly Record<string, unknown>[])[0]!;
    expect(Object.keys(tally).sort()).toEqual(['attempted', 'channel', 'delivered', 'failed']);
  });

  it('stays audited-not-fatal: a THROWING transport counts as failed and never 5xx-es the approval', async () => {
    const exploding: NotificationPort = {
      notify: () => {
        throw new Error('socket closed');
      },
    };
    const d = deps({
      notifier: exploding,
      subscribers: makeInMemorySubscriberRegistry(['chat-a', 'chat-b']),
    });
    const res = await handleAlertApprove(
      { alertId: ORIGINAL, actorRole: 'EM', approvedBy: APPROVER },
      d,
    );

    expect(res.status).toBe(201);
    expect(res.body.meta?.['delivery']).toEqual([
      { channel: 'telegram', attempted: 2, delivered: 0, failed: 2 },
    ]);
  });

  it('names the channel from the composition rather than assuming one', async () => {
    const d = deps({
      notifier: flakyNotifier([], []),
      subscribers: makeInMemorySubscriberRegistry(['chat-a']),
      broadcastChannel: 'whatsapp',
    });
    const res = await handleAlertApprove(
      { alertId: ORIGINAL, actorRole: 'EM', approvedBy: APPROVER },
      d,
    );
    expect(res.body.meta?.['delivery']).toEqual([
      { channel: 'whatsapp', attempted: 1, delivered: 1, failed: 0 },
    ]);
  });

  it('omits `delivery` entirely when no channel is wired (silence is not a delivery claim)', async () => {
    const res = await handleAlertApprove(
      { alertId: ORIGINAL, actorRole: 'EM', approvedBy: APPROVER },
      deps(),
    );
    expect(res.status).toBe(201);
    expect(res.body.meta?.['delivery']).toBeUndefined();
    expect(res.body.meta?.['emitted']).toBe(true);
  });
});
