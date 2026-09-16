// BEACON — interop HTTP handler tests (E7·T-291/T-303/T-307; SPEC §2.2, ADR-010, Art. XIII). Deterministic
// (fixed past clock, injected ids; no wall-clock/network). Covers the HITL emit gate (a DRAFT approved by a
// VERIFIER emits a schema-valid CAP + is audited; a non-VERIFIER / non-DRAFT / missing alert is REJECTED so
// a DRAFT never reaches emit), the EDXL-RM round-trip, and the EDXL-SitRep emission.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { makeAlert } from '@/domain/alert.js';
import type { Alert } from '@/domain/alert.js';
import { makeResourceTask } from '@/domain/resource-task.js';
import { makeSitRep } from '@/domain/sitrep.js';
import type { SitRep } from '@/domain/sitrep.js';
import type {
  AlertId,
  AppUserId,
  IncidentId,
  ResourceId,
  ResourceTaskId,
  SitRepId,
  SourceId,
} from '@/domain/value-objects/ids.js';
import { asId } from '@/domain/value-objects/ids.js';
import { resourceTaskToEdxlRm } from '@/adapters/interop/edxl-rm-mapper.js';
import { makeAlertSink } from '@/adapters/alerting/alert-sink.js';
import { err } from '@/domain/shared/result.js';
import { DomainError } from '@/domain/errors.js';
import type { MessagingPort } from '@/ports/interaction.js';
import { makeNotifier, type AuditRecord } from '@/adapters/channels/messaging/notification.js';
import { RecordedTransport } from '@/adapters/channels/messaging/messaging-port.js';
import { makeInMemorySubscriberRegistry } from '@/adapters/channels/messaging/subscriber-registry.js';
import {
  handleAlertApprove,
  handleEdxlRmPost,
  handleEdxlRmGet,
  handleEdxlSitrepPost,
  makeInMemoryAlertStore,
  makeInMemoryEdxlRmStore,
  type InteropDeps,
} from './interop.js';

const capSchema = JSON.parse(readFileSync('schemas/cap-v1.2.schema.json', 'utf8')) as object;
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateCap = ajv.compile(capSchema);

const CLOCK = '2026-07-05T14:30:00Z';
const clock = (): string => CLOCK;
const APPROVER = asId<AppUserId>('user-verifier-1');

function draftAlert(id = 'alert-1'): Alert {
  return makeAlert({
    id: asId<AlertId>(id),
    incidentId: asId<IncidentId>('inc-1'),
    capStatus: 'DRAFT',
    category: 'Fire',
    severity: 'SEVERE',
  });
}

function deps(seed: readonly Alert[] = [draftAlert()]): InteropDeps {
  return {
    clock,
    alerts: makeInMemoryAlertStore(seed),
    edxlRm: makeInMemoryEdxlRmStore(),
    sink: makeAlertSink({ clock }),
  };
}

describe('handleAlertApprove (HITL emit gate, Art. XIII)', () => {
  it('a DRAFT approved by a VERIFIER emits a schema-valid CAP and is audited', async () => {
    const d = deps();
    const res = await handleAlertApprove(
      { alertId: asId<AlertId>('alert-1'), actorRole: 'VERIFIER', approvedBy: APPROVER },
      d,
    );

    expect(res.status).toBe(201);
    const data = res.body.data as { alert: Alert; cap: unknown };
    expect(data.alert.capStatus).toBe('ACTUAL');
    expect(data.alert.approvedBy).toBe(APPROVER);
    expect(validateCap(data.cap)).toBe(true); // emitted CAP validates against its schema
    // Emitted exactly once, audited, chain intact.
    expect(d.sink.emissions).toHaveLength(1);
    expect(d.sink.verify()).toBe(true);
    expect(res.body.meta?.auditHash).toBe(d.sink.emissions[0]?.auditHash);
    expect(res.body.provenance[0]?.mode).toBe('MOCK'); // no real external send
  });

  it('an EM (higher rank) may also approve + emit', async () => {
    const d = deps();
    const res = await handleAlertApprove(
      {
        alertId: asId<AlertId>('alert-1'),
        actorRole: 'EM',
        approvedBy: asId<AppUserId>('user-em-1'),
      },
      d,
    );
    expect(res.status).toBe(201);
    expect(d.sink.emissions).toHaveLength(1);
  });

  it('REJECTS a DRAFT approval by a non-VERIFIER — nothing is emitted (Art. XIII)', async () => {
    for (const role of ['PUBLIC', 'RESPONDER'] as const) {
      const d = deps();
      const res = await handleAlertApprove(
        { alertId: asId<AlertId>('alert-1'), actorRole: role, approvedBy: APPROVER },
        d,
      );
      expect(res.status).toBe(403);
      expect(res.body.errors?.[0]?.code).toBe('UNAUTHORIZED');
      expect(d.sink.emissions).toHaveLength(0); // no emission occurred
    }
  });

  it('REJECTS approving a non-DRAFT alert (409) — no double emit', async () => {
    const already = makeAlert({
      id: asId<AlertId>('alert-actual'),
      incidentId: asId<IncidentId>('inc-1'),
      capStatus: 'ACTUAL',
      category: 'Fire',
      severity: 'SEVERE',
      approvedBy: APPROVER,
    });
    const d = deps([already]);
    const res = await handleAlertApprove(
      { alertId: asId<AlertId>('alert-actual'), actorRole: 'VERIFIER', approvedBy: APPROVER },
      d,
    );
    expect(res.status).toBe(409);
    expect(res.body.errors?.[0]?.code).toBe('CONFLICT');
    expect(d.sink.emissions).toHaveLength(0);
  });

  it('returns 404 for an unknown alert id', async () => {
    const d = deps();
    const res = await handleAlertApprove(
      { alertId: asId<AlertId>('nope'), actorRole: 'VERIFIER', approvedBy: APPROVER },
      d,
    );
    expect(res.status).toBe(404);
    expect(res.body.errors?.[0]?.code).toBe('NOT_FOUND');
  });
});

describe('handleAlertApprove — HITL alert broadcast (Art. XIII/XIV, ADR-023)', () => {
  function withBroadcast(
    chatIds: readonly string[],
    transport: MessagingPort,
  ): { d: InteropDeps; audit: AuditRecord[] } {
    const audit: AuditRecord[] = [];
    const notifier = makeNotifier({ transport, clock, audit });
    const subscribers = makeInMemorySubscriberRegistry(chatIds);
    return { d: { ...deps(), notifier, subscribers }, audit };
  }

  it('broadcasts the approved alert digest to every subscriber AFTER a successful emit (happy path)', async () => {
    const transport = new RecordedTransport();
    const { d, audit } = withBroadcast(['chat-1', 'chat-2'], transport);

    const res = await handleAlertApprove(
      { alertId: asId<AlertId>('alert-1'), actorRole: 'VERIFIER', approvedBy: APPROVER },
      d,
    );

    expect(res.status).toBe(201); // approval itself unaffected
    expect(d.sink.emissions).toHaveLength(1); // emitted exactly once
    expect(transport.sent).toHaveLength(2); // fanned out to both subscribers
    expect(transport.sent.map((s) => s.to)).toEqual(['chat-1', 'chat-2']);
    for (const sent of transport.sent) {
      expect(sent.text).toContain('BEACON ALERT');
      expect(sent.text).toContain('SEVERE'); // the deterministic alert facts (not an LLM figure)
      expect(sent.text).toContain('Fire');
    }
    expect(audit).toHaveLength(2); // every broadcast is audited (hash-chained)
  });

  // Bilingual broadcast (2026-08-04): the approver's UI locale localizes the headline CHROME via the
  // catalog (never an LLM), with the English line always appended — every responder can read at least
  // one of the two, and the engine facts are byte-identical in both.
  it('broadcasts BILINGUAL (UI language + English) when the approver has a non-English locale', async () => {
    const transport = new RecordedTransport();
    const { d } = withBroadcast(['chat-1'], transport);

    const res = await handleAlertApprove(
      {
        alertId: asId<AlertId>('alert-1'),
        actorRole: 'VERIFIER',
        approvedBy: APPROVER,
        lang: 'ro',
      },
      d,
    );

    expect(res.status).toBe(201);
    const text = transport.sent[0]!.text;
    expect(text).toContain('ALERTĂ BEACON'); // the localized line, first
    expect(text).toContain('BEACON ALERT'); // the English line, always present
    // The engine facts appear in BOTH lines untranslated (Art. XII).
    expect(text.match(/SEVERE/g)?.length).toBe(2);
  });

  it('an English (or absent) locale broadcasts a single line — the pre-feature message unchanged', async () => {
    const transport = new RecordedTransport();
    const { d } = withBroadcast(['chat-1'], transport);
    await handleAlertApprove(
      {
        alertId: asId<AlertId>('alert-1'),
        actorRole: 'VERIFIER',
        approvedBy: APPROVER,
        lang: 'en',
      },
      d,
    );
    expect(transport.sent[0]!.text.match(/BEACON ALERT/g)?.length).toBe(1);
  });

  it('a broadcast transport FAILURE is audited-not-fatal — the approval still returns 201 (never 5xx)', async () => {
    const failing: MessagingPort = {
      send: () => Promise.resolve(err(new DomainError('INVARIANT_VIOLATION', 'telegram down'))),
    };
    const { d, audit } = withBroadcast(['chat-1'], failing);

    const res = await handleAlertApprove(
      { alertId: asId<AlertId>('alert-1'), actorRole: 'VERIFIER', approvedBy: APPROVER },
      d,
    );

    expect(res.status).toBe(201); // broadcast failure never fails the approval
    expect(d.sink.emissions).toHaveLength(1);
    expect(audit).toHaveLength(1); // the send intent was still audited before the failed delivery
  });

  it('a THROWING transport still cannot 5xx the approval (broadcast side-effect is fully isolated)', async () => {
    const throwing: MessagingPort = {
      send: () => {
        throw new Error('boom');
      },
    };
    const { d } = withBroadcast(['chat-1'], throwing);
    const res = await handleAlertApprove(
      { alertId: asId<AlertId>('alert-1'), actorRole: 'VERIFIER', approvedBy: APPROVER },
      d,
    );
    expect(res.status).toBe(201);
    expect(d.sink.emissions).toHaveLength(1);
  });

  it('NO broadcast when the alert is NOT emitted — a non-VERIFIER (403) never reaches subscribers (HITL)', async () => {
    const transport = new RecordedTransport();
    const { d } = withBroadcast(['chat-1'], transport);
    const res = await handleAlertApprove(
      { alertId: asId<AlertId>('alert-1'), actorRole: 'RESPONDER', approvedBy: APPROVER },
      d,
    );
    expect(res.status).toBe(403);
    expect(d.sink.emissions).toHaveLength(0);
    expect(transport.sent).toHaveLength(0); // a DRAFT that never emits never broadcasts
  });

  it('NO broadcast when approving a non-DRAFT alert (409) — no emit, no fan-out', async () => {
    const already = makeAlert({
      id: asId<AlertId>('alert-actual'),
      incidentId: asId<IncidentId>('inc-1'),
      capStatus: 'ACTUAL',
      category: 'Fire',
      severity: 'SEVERE',
      approvedBy: APPROVER,
    });
    const transport = new RecordedTransport();
    const audit: AuditRecord[] = [];
    const d: InteropDeps = {
      ...deps([already]),
      notifier: makeNotifier({ transport, clock, audit }),
      subscribers: makeInMemorySubscriberRegistry(['chat-1']),
    };
    const res = await handleAlertApprove(
      { alertId: asId<AlertId>('alert-actual'), actorRole: 'VERIFIER', approvedBy: APPROVER },
      d,
    );
    expect(res.status).toBe(409);
    expect(transport.sent).toHaveLength(0);
  });

  it('with NO broadcast deps wired, handleAlertApprove is byte-identical (still emits, no fan-out)', async () => {
    const res = await handleAlertApprove(
      { alertId: asId<AlertId>('alert-1'), actorRole: 'VERIFIER', approvedBy: APPROVER },
      deps(),
    );
    expect(res.status).toBe(201);
  });
});

describe('handleEdxlRmPost / handleEdxlRmGet (EDXL-RM round-trip, FR-9)', () => {
  function inboundMessage() {
    const task = makeResourceTask({
      id: asId<ResourceTaskId>('task-1'),
      resourceId: asId<ResourceId>('res-engine-7'),
      incidentId: asId<IncidentId>('inc-1'),
      status: 'PROPOSED',
      edxlRmRef: 'urn:beacon:rm:corr-1',
    });
    const ser = resourceTaskToEdxlRm(task, { sentDateTime: CLOCK });
    if (!ser.ok) throw new Error('fixture serialize failed');
    return ser.value;
  }

  it('imports an EDXL-RM message to a canonical task, then exports it back (round-trip)', async () => {
    const d = deps();
    const post = await handleEdxlRmPost({ actorRole: 'RESPONDER', message: inboundMessage() }, d);
    expect(post.status).toBe(201);
    expect(post.body.meta?.correlationId).toBe('urn:beacon:rm:corr-1');

    const get = await handleEdxlRmGet({ actorRole: 'RESPONDER', id: 'urn:beacon:rm:corr-1' }, d);
    expect(get.status).toBe(200);
    const data = get.body.data as {
      task: { status: string };
      edxlRm: { originatingMessageID: string };
    };
    expect(data.task.status).toBe('PROPOSED');
    expect(data.edxlRm.originatingMessageID).toBe('urn:beacon:rm:corr-1');
  });

  it('REJECTS an EDXL-RM import by a below-RESPONDER actor (403)', async () => {
    const d = deps();
    const res = await handleEdxlRmPost({ actorRole: 'PUBLIC', message: inboundMessage() }, d);
    expect(res.status).toBe(403);
  });

  it('returns 404 for an unknown EDXL-RM correlation id', async () => {
    const res = await handleEdxlRmGet({ actorRole: 'EM', id: 'missing' }, deps());
    expect(res.status).toBe(404);
  });
});

describe('handleEdxlSitrepPost (EDXL-SitRep emission, FR-9)', () => {
  function citedSitRep(): SitRep {
    return makeSitRep({
      id: asId<SitRepId>('sitrep-1'),
      incidentId: asId<IncidentId>('inc-1'),
      generatedAt: CLOCK,
      summary: 'Fire has grown to 1,200 acres; 3 shelters open.',
      trend: 'ESCALATING',
      aiMode: 'cloud',
      fields: [
        {
          field: 'summary.executiveSummary',
          claim: 'Fire has grown to 1,200 acres',
          citations: [{ sourceId: asId<SourceId>('11111111-1111-4111-8111-111111111111') }],
        },
      ],
    });
  }

  it('emits a schema-valid EDXL-SitRep with preserved citations for a VERIFIER', async () => {
    const res = await handleEdxlSitrepPost(
      { actorRole: 'VERIFIER', sitrep: citedSitRep(), options: { incidentType: 'WILDFIRE' } },
      deps(),
    );
    expect(res.status).toBe(201);
    expect(res.body.citations).toHaveLength(1);
    expect(res.body.citations?.[0]?.field).toBe('summary.executiveSummary');
  });

  it('REJECTS an EDXL-SitRep emission by a non-VERIFIER (403)', async () => {
    const res = await handleEdxlSitrepPost(
      { actorRole: 'RESPONDER', sitrep: citedSitRep() },
      deps(),
    );
    expect(res.status).toBe(403);
  });
});
