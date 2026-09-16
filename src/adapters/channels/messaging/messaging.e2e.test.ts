// BEACON — messaging channel e2e (E10·T-462; ADR-023). Deterministic: fixed past clock, counter id
// minter, RecordedTransport, injected secret/allow-list. No network. Drives the SAME wired core the CLI
// and HTTP API use, asserting identical Envelope guarantees (F1 provenance, F2 citations) plus the
// responsible-data guarantee (NotificationPort never broadcasts precise coordinates, Art. XIV).
import { describe, it, expect } from 'vitest';
import type { Envelope, InboundMessage } from '@/ports/interaction.js';
import { buildInteraction } from '@/main/build-core.js';
import {
  handleInbound,
  makeInboundStore,
  makeNotifier,
  signInbound,
  RecordedTransport,
  type AuditRecord,
  type InboundDeps,
  type SenderAllowList,
} from './index.js';

const NOW = '2026-07-05T22:00:00Z';
const SECRET = 'e2e-telegram-secret';
const ALLOW: SenderAllowList = { 'responder-1': 'RESPONDER' };
const fixed = {
  clock: () => NOW,
  newId: ((): ((p: string) => string) => {
    let n = 0;
    return (p) => `${p}-${++n}`;
  })(),
};

function signed(senderId: string, text: string): InboundMessage {
  const base = { transport: 'telegram' as const, senderId, text, receivedAt: NOW };
  return { ...base, signature: signInbound(SECRET, base) };
}

function inboundDeps(): InboundDeps {
  return { secret: SECRET, allowList: ALLOW, store: makeInboundStore(), clock: () => NOW };
}

describe('messaging e2e — MOCK transport, same core, same guarantees', () => {
  it('inbound "report … consent" from an allowed RESPONDER creates an UNVERIFIED report', async () => {
    const interaction = buildInteraction({ env: {}, ...fixed });
    const out = await handleInbound(
      signed('responder-1', 'report water rising near the community center consent'),
      { interaction, inbound: inboundDeps() },
    );
    expect(out.envelope).not.toBeNull();
    const env = out.envelope as Envelope;
    expect(env.meta?.status).toBe('UNVERIFIED'); // HITL: no public action follows (Art. XIII)
    expect(env.provenance.length).toBeGreaterThan(0); // F1
  });

  it('inbound "sitrep ro-flood-demo" replies with a digest carrying the engine claim + citations + freshness', async () => {
    const interaction = buildInteraction({ env: {}, ...fixed });
    const out = await handleInbound(signed('responder-1', 'sitrep ro-flood-demo'), {
      interaction,
      inbound: inboundDeps(),
    });

    const env = out.envelope as Envelope;
    // Same Envelope guarantees as every other channel (F1 + F2).
    expect(env.provenance.length).toBeGreaterThan(0);
    expect(env.citations?.length).toBeGreaterThan(0);
    expect(env.freshness).toBe(NOW);
    // The rendered digest surfaces the deterministic field claim (not an LLM figure) + citations + freshness.
    expect(out.reply).toMatch(/crest/);
    expect(out.reply).toMatch(/discharge/); // the engine claim itself, verbatim
    expect(out.reply).toMatch(/citations:/);
    expect(out.reply).toContain(`freshness: ${NOW}`);
  });

  it('rejects an unsigned inbound message with a safe, non-leaking reply', async () => {
    const interaction = buildInteraction({ env: {}, ...fixed });
    const unsigned: InboundMessage = {
      transport: 'telegram',
      senderId: 'responder-1',
      text: 'status',
      receivedAt: NOW,
    };
    const out = await handleInbound(unsigned, { interaction, inbound: inboundDeps() });
    expect(out.reply).toMatch(/UNAUTHORIZED/);
    expect(out.envelope?.errors?.[0]?.code).toBe('UNAUTHORIZED');
  });

  it('NotificationPort redacts PII (precise coordinates, email, phone) but keeps engine figures (Art. XIV/XII)', async () => {
    const transport = new RecordedTransport();
    const audit: AuditRecord[] = [];
    const notifier = makeNotifier({ transport, clock: () => NOW, audit });

    const envelope: Envelope = {
      data: {
        headline: 'Flood alert — discharge 12.47 m³/s', // an engine figure that must SURVIVE
        text: 'Evacuate area near 45.12345, 28.98765; contact jane@example.com or 555-123-4567',
      },
      provenance: [{ sourceId: 'glofas', mode: 'MOCK', fetchedAt: NOW }],
    };
    const res = await notifier.notify('public-broadcast', envelope);

    expect(res.ok).toBe(true);
    const text = transport.sent[0]?.text ?? '';
    expect(text).not.toContain('45.12345'); // precise coordinate PAIR stripped (Art. XIV)
    expect(text).not.toContain('28.98765');
    expect(text).not.toContain('jane@example.com'); // email redacted
    expect(text).not.toContain('555-123-4567'); // phone redacted
    expect(text).toContain('[redacted-location]');
    expect(text).toContain('12.47'); // the cited engine figure is NOT altered (Art. XII)
    expect(audit).toHaveLength(1); // every send audited
    expect(audit[0]?.audience).toBe('public-broadcast');
  });
});
