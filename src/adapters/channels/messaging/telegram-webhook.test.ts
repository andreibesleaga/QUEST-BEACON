// BEACON — Telegram inbound webhook tests (E10·T-461; ADR-023, Art. XIII). Deterministic: fixed past clock,
// injected fake InteractionPort, in-memory trust store. No network, no Next. Covers the secret-token verify
// (valid/invalid/missing-config), the verified-but-unparseable ⇒ 200 (Telegram retry semantics), the update
// mapping, and the deny-by-default trust pipeline (an unlisted sender still 200s — a safe ack, never a loop).
import { describe, it, expect } from 'vitest';
import { ok } from '@/domain/shared/result.js';
import type { Envelope, InteractionPort, InteractionRequest } from '@/ports/interaction.js';
import { handleTelegramWebhook, secretMatches, telegramUpdateToInbound, type TelegramWebhookDeps } from './telegram-webhook.js';
import { makeInboundStore, type SenderAllowList } from './trust.js';

const NOW = '2026-07-05T22:00:00Z';
const SECRET = 'webhook-secret-token';
const ALLOW: SenderAllowList = { '42': 'RESPONDER' };

/** A recording fake InteractionPort — returns a minimal, F1-valid envelope so the digest renders. */
function fakeInteraction(): InteractionPort & { readonly calls: InteractionRequest[] } {
  const calls: InteractionRequest[] = [];
  return {
    calls,
    handle(req: InteractionRequest) {
      calls.push(req);
      const envelope: Envelope = { data: {}, provenance: [{ sourceId: 's', mode: 'MOCK', fetchedAt: NOW }] };
      return Promise.resolve(ok(envelope));
    },
  };
}

function deps(
  overrides: Partial<Omit<TelegramWebhookDeps, 'interaction'>> = {},
): TelegramWebhookDeps & { interaction: ReturnType<typeof fakeInteraction> } {
  const interaction = fakeInteraction();
  return {
    secret: SECRET,
    allowList: ALLOW,
    store: makeInboundStore(),
    clock: () => NOW,
    ...overrides,
    interaction,
  };
}

const statusUpdate = JSON.stringify({ message: { text: 'status', chat: { id: 42 }, from: { id: 42 } } });

describe('handleTelegramWebhook — secret-token verification', () => {
  it('a valid secret token + allow-listed sender reaches the core (200, interaction called)', async () => {
    const d = deps();
    const res = await handleTelegramWebhook({ secretToken: SECRET, rawBody: statusUpdate }, d);
    expect(res.status).toBe(200);
    expect(d.interaction.calls).toHaveLength(1);
    expect(d.interaction.calls[0]?.channel).toBe('telegram');
    expect(d.interaction.calls[0]?.command.verb).toBe('status');
    expect(d.interaction.calls[0]?.actorRole).toBe('RESPONDER');
  });

  it('an invalid secret token is rejected (401) — nothing reaches the core', async () => {
    const d = deps();
    const res = await handleTelegramWebhook({ secretToken: 'wrong', rawBody: statusUpdate }, d);
    expect(res.status).toBe(401);
    expect(d.interaction.calls).toHaveLength(0);
  });

  it('an absent secret token is rejected (401)', async () => {
    const d = deps();
    const res = await handleTelegramWebhook({ secretToken: undefined, rawBody: statusUpdate }, d);
    expect(res.status).toBe(401);
    expect(d.interaction.calls).toHaveLength(0);
  });

  it('no secret configured ⇒ generic 404 (route disabled, non-disclosing) regardless of token', async () => {
    const d = deps({ secret: undefined });
    const res = await handleTelegramWebhook({ secretToken: 'anything', rawBody: statusUpdate }, d);
    expect(res.status).toBe(404);
    expect(d.interaction.calls).toHaveLength(0);
  });
});

describe('handleTelegramWebhook — Telegram retry semantics + trust pipeline', () => {
  it('a verified but unparseable body ⇒ 200 (never make Telegram loop)', async () => {
    const d = deps();
    const res = await handleTelegramWebhook({ secretToken: SECRET, rawBody: '<<not json>>' }, d);
    expect(res.status).toBe(200);
    expect(d.interaction.calls).toHaveLength(0);
  });

  it('a verified non-message update (no text/chat) ⇒ 200, no core call', async () => {
    const d = deps();
    const res = await handleTelegramWebhook({ secretToken: SECRET, rawBody: JSON.stringify({ update_id: 7 }) }, d);
    expect(res.status).toBe(200);
    expect(d.interaction.calls).toHaveLength(0);
  });

  it('an UNLISTED sender is denied by the trust pipeline but still 200s (safe ack)', async () => {
    const d = deps({ allowList: {} }); // deny-by-default
    const res = await handleTelegramWebhook({ secretToken: SECRET, rawBody: statusUpdate }, d);
    expect(res.status).toBe(200);
    expect(d.interaction.calls).toHaveLength(0); // never reached the core
  });
});

describe('handleTelegramWebhook — update_id replay dedupe (seenUpdate)', () => {
  const withId = (id: unknown, text = 'status'): string =>
    JSON.stringify({ update_id: id, message: { text, chat: { id: 42 } } });

  /** A stateful dedupe seam: true if this id was seen before, records it (first-seen ⇒ false) otherwise. */
  function seenUpdateSeam(): (id: number) => boolean {
    const seen = new Set<number>();
    return (id) => {
      if (seen.has(id)) return true;
      seen.add(id);
      return false;
    };
  }

  it('a replayed update_id ⇒ 200 and is NOT re-dispatched (closes the fresh-clock self-sign gap)', async () => {
    const interaction = fakeInteraction();
    const base = { secret: SECRET, allowList: ALLOW, store: makeInboundStore(), seenUpdate: seenUpdateSeam(), interaction };
    // The webhook self-signs with a FRESH clock, so replaying the captured POST 1 min later yields a DIFFERENT
    // signature — trust.ts's (transport,sender,signature) replay key would NOT catch it. Only seenUpdate does.
    const first = await handleTelegramWebhook({ secretToken: SECRET, rawBody: withId(100) }, { ...base, clock: () => NOW });
    const replay = await handleTelegramWebhook({ secretToken: SECRET, rawBody: withId(100) }, { ...base, clock: () => '2026-07-05T22:01:00Z' });
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(interaction.calls).toHaveLength(1); // the replay was deduped by update_id, never re-dispatched
  });

  it('distinct update_ids both dispatch', async () => {
    const interaction = fakeInteraction();
    const base = { secret: SECRET, allowList: ALLOW, store: makeInboundStore(), seenUpdate: seenUpdateSeam(), clock: () => NOW, interaction };
    await handleTelegramWebhook({ secretToken: SECRET, rawBody: withId(1, 'status') }, base);
    await handleTelegramWebhook({ secretToken: SECRET, rawBody: withId(2, 'sources') }, base); // distinct text ⇒ distinct signature
    expect(interaction.calls).toHaveLength(2);
  });

  it('a non-numeric update_id is processed as before (no dedupe applied)', async () => {
    const interaction = fakeInteraction();
    const base = { secret: SECRET, allowList: ALLOW, store: makeInboundStore(), seenUpdate: seenUpdateSeam(), clock: () => NOW, interaction };
    await handleTelegramWebhook({ secretToken: SECRET, rawBody: withId('abc', 'status') }, base);
    await handleTelegramWebhook({ secretToken: SECRET, rawBody: withId('abc', 'sources') }, base);
    expect(interaction.calls).toHaveLength(2); // string update_id ⇒ seenUpdate never consulted
  });
});

describe('telegramUpdateToInbound / secretMatches', () => {
  it('maps message.text + chat.id → InboundMessage (chat id is the senderId)', () => {
    const inbound = telegramUpdateToInbound({ message: { text: 'sources', chat: { id: 42 } } }, NOW);
    expect(inbound).toEqual({ transport: 'telegram', senderId: '42', text: 'sources', receivedAt: NOW });
  });

  it('returns null for an update with no usable text message', () => {
    expect(telegramUpdateToInbound({ message: { chat: { id: 42 } } }, NOW)).toBeNull();
    expect(telegramUpdateToInbound({}, NOW)).toBeNull();
    expect(telegramUpdateToInbound(null, NOW)).toBeNull();
  });

  it('secretMatches is a constant-time equal that fails closed on mismatch/absent/length', () => {
    expect(secretMatches(SECRET, SECRET)).toBe(true);
    expect(secretMatches('wrong', SECRET)).toBe(false);
    expect(secretMatches(undefined, SECRET)).toBe(false);
    expect(secretMatches('short', SECRET)).toBe(false);
  });
});
