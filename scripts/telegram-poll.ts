// BEACON — Telegram getUpdates long-polling DEV runner (E10·T-461; ADR-023; NOT a test — real network, so it
// never runs in CI and is never on the request path). The localhost-friendly alternative to the webhook: it
// pulls inbound updates from the Bot API and feeds them through the SAME inbound mapping + trust pipeline the
// webhook uses, then replies via the real outbound transport — a fully working bot with no public HTTPS URL.
//
// Env-gated + mutually exclusive with the webhook (Locked decision — Bot API forbids getUpdates while a
// webhook is set):
//   • requires CHANNEL_TELEGRAM_MODE=live + TELEGRAM_BOT_TOKEN (else it refuses to run)
//   • refuses to run when TELEGRAM_WEBHOOK_SECRET is set (webhook mode is active — delete the webhook first)
// Usage:  CHANNEL_TELEGRAM_MODE=live TELEGRAM_BOT_TOKEN=<token> TELEGRAM_ALERT_CHAT_IDS=<yourChatId> \
//         npm run telegram:poll
// Load .env EXACTLY as the Next.js app does (found 2026-08-04): tsx does NOT auto-load .env, so until
// this line every doc that said "set it in .env and run this script" was wrong — the script saw only the
// shell environment, which is a large part of why live settings "didn't get picked up". @next/env is the
// same parser the app boots with (strips inline comments and quotes), so script and app can never again
// disagree about what a value is. Pre-set shell vars still win, so the documented inline-override usage
// (`CHANNEL_TELEGRAM_MODE=live npm run telegram:poll`) keeps working unchanged.
import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());

export {}; // module marker (enables top-level await under tsc)

import { randomUUID } from 'node:crypto';
import type { InboundMessage } from '@/ports/interaction.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (process.env.CHANNEL_TELEGRAM_MODE !== 'live' || token === undefined || token.length === 0) {
  console.error('telegram-poll: refusing to run — set CHANNEL_TELEGRAM_MODE=live and TELEGRAM_BOT_TOKEN.');
  process.exit(1);
}
if ((process.env.TELEGRAM_WEBHOOK_SECRET ?? '').length > 0) {
  console.error(
    'telegram-poll: refusing to run — TELEGRAM_WEBHOOK_SECRET is set (webhook mode). Poller and webhook are\n' +
      'mutually exclusive; unset it (and deleteWebhook) to use long-polling.',
  );
  process.exit(1);
}

const { createHttpDepsLive } = await import('@/adapters/channels/http/http-dispatcher.js');
const { handleInbound, makeInboundStore, signInbound, makeTelegramMessaging, telegramUpdateToInbound } =
  await import('@/adapters/channels/messaging/index.js');

// The poller both signs and verifies the canonical payload (Telegram authenticity is the authenticated Bot
// API GET) — an ephemeral per-process secret is sufficient. Operators drive commands from the configured chat.
const secret = randomUUID();
const allowList = Object.fromEntries(
  (process.env.TELEGRAM_ALERT_CHAT_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((id) => [id, 'RESPONDER' as const]),
);

const deps = await createHttpDepsLive();
const store = makeInboundStore();
const transport = makeTelegramMessaging({ mode: 'live', token }, fetch);

interface RawUpdate {
  readonly update_id: number;
  readonly message?: unknown;
}

console.log('telegram-poll: long-polling getUpdates (Ctrl-C to stop)…');
let offset: number | undefined;
for (;;) {
  const url = new URL(`https://api.telegram.org/bot${token}/getUpdates`);
  url.searchParams.set('timeout', '30');
  if (offset !== undefined) url.searchParams.set('offset', String(offset));
  let updates: RawUpdate[] = [];
  try {
    const res = await fetch(url, { method: 'GET' });
    const body = (await res.json()) as { ok?: boolean; result?: RawUpdate[] };
    updates = body.ok === true && Array.isArray(body.result) ? body.result : [];
  } catch (thrown) {
    console.error('telegram-poll: getUpdates error —', thrown instanceof Error ? thrown.message : thrown);
    continue;
  }
  for (const u of updates) {
    offset = u.update_id + 1;
    const inbound = telegramUpdateToInbound({ message: u.message }, deps.clock());
    if (inbound === null) continue;
    const signed: InboundMessage = { ...inbound, signature: signInbound(secret, inbound) };
    const out = await handleInbound(signed, {
      interaction: deps.interaction,
      inbound: { secret, allowList, store, clock: deps.clock },
    });
    console.log(`← ${inbound.senderId}: ${inbound.text}\n→ ${out.reply}`);
    await transport.send(inbound.senderId, out.reply); // reply via the real outbound Bot API transport
  }
}
