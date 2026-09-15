// BEACON — Next.js App-Router delegator for the Telegram inbound webhook (E10·T-461; ADR-023). TRIVIAL by
// design: translate the Next Request (secret-token header + raw body) → the framework-agnostic
// handleTelegramWebhook → Response. ALL verification/mapping/trust logic lives in the tested pure handler
// (zero logic here). Shares the ONE process-wide core via getHttpDepsAsync() like the other delegators; the
// per-process inbound trust store (replay/rate window) is a module singleton so it survives across requests.
//
// Mutual exclusion (Locked decision): this webhook and scripts/telegram-poll.ts are the two INBOUND paths and
// are never used together — webhook registration (setWebhook) is an explicit operator action, never boot-time.
import { getHttpDepsAsync } from '@/adapters/channels/http/http-dispatcher.js';
import { handleTelegramWebhook } from '@/adapters/channels/messaging/telegram-webhook.js';
import { makeInboundStore } from '@/adapters/channels/messaging/trust.js';
import type { SenderAllowList } from '@/adapters/channels/messaging/trust.js';
import { parseChatIds } from '@/adapters/channels/messaging/subscriber-registry.js';

// Per-process trust state (replay set + per-sender rate window) — one instance for the server lifetime.
const inboundStore = makeInboundStore();

// Bounded in-process replay dedupe for the Telegram update_id (SECURITY; no timers, no Date). The webhook
// self-signs with a fresh clock so the trust pipeline's replay guard can't catch a captured-POST replay for
// this path — this closes it: a re-delivered update_id is acked 200 without re-dispatching. FIFO-capped so
// a long-running server stays memory-bounded (Set preserves insertion order → oldest evicted first).
const SEEN_UPDATE_CAP = 1000;
const seenUpdateIds = new Set<number>();
function seenUpdate(id: number): boolean {
  if (seenUpdateIds.has(id)) return true;
  seenUpdateIds.add(id);
  if (seenUpdateIds.size > SEEN_UPDATE_CAP) {
    const oldest = seenUpdateIds.values().next().value;
    if (oldest !== undefined) seenUpdateIds.delete(oldest);
  }
  return false;
}

/**
 * The inbound command allow-list. Operator chat ids configured for the approved-alert broadcast
 * (TELEGRAM_ALERT_CHAT_IDS) are the SAME trusted operators permitted to drive read/report commands over the
 * bot; every OTHER sender is denied by default (the trust pipeline rejects an unlisted senderId).
 */
function allowListFromEnv(env: Record<string, string | undefined>): SenderAllowList {
  const entries = parseChatIds(env.TELEGRAM_ALERT_CHAT_IDS).map((id) => [id, 'RESPONDER'] as const);
  return Object.fromEntries(entries);
}

export async function POST(request: Request): Promise<Response> {
  const deps = await getHttpDepsAsync();
  const rawBody = await request.text();
  const result = await handleTelegramWebhook(
    { secretToken: request.headers.get('x-telegram-bot-api-secret-token') ?? undefined, rawBody },
    {
      secret: deps.env.TELEGRAM_WEBHOOK_SECRET,
      allowList: allowListFromEnv(deps.env),
      store: inboundStore,
      interaction: deps.interaction,
      clock: deps.clock,
      seenUpdate,
    },
  );
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'content-type': 'application/json' },
  });
}
