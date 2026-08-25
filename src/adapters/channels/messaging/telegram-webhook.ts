// BEACON — Telegram inbound webhook handler (E10·T-461; ADR-023 §trust, Art. XIII). Framework-agnostic PURE
// handler the Next route adapts (mirrors interop.ts's transport-neutral { status, body } style). Telegram
// authenticity is the X-Telegram-Bot-Api-Secret-Token header (constant-time compared to TELEGRAM_WEBHOOK_SECRET
// — the shared inbound-secret this boundary then self-signs the canonical message with, so the FULL existing
// trust pipeline still runs: allow-list → replay → rate → firewall → parse). Posture is non-disclosing:
//   • no secret configured        ⇒ generic 404 (route "does not exist", mirroring the dev-login posture)
//   • bad/absent secret token      ⇒ generic 401 (never confirms config)
//   • verified but unparseable/non-message update ⇒ 200 (Telegram retry semantics — never make it loop)
// node:crypto is allowed here (adapter layer, not domain).
import { timingSafeEqual } from 'node:crypto';
import type { InboundMessage, InteractionPort } from '@/ports/interaction.js';
import { handleInbound } from './handle-inbound.js';
import { signInbound } from './trust.js';
import type { InboundStore, SenderAllowList } from './trust.js';

/** The minimal Telegram Update shape we map (extra fields ignored; missing fields ⇒ null → 200). */
interface TelegramUpdate {
  /** Telegram's monotonically-increasing per-update id — the replay/dedupe key (see seenUpdate). */
  readonly update_id?: unknown;
  readonly message?: {
    readonly text?: unknown;
    readonly chat?: { readonly id?: unknown };
    readonly from?: { readonly id?: unknown; readonly language_code?: unknown };
  };
}

/** Everything the webhook handler needs — all injected (deterministic tests: fixed clock/secret/allow-list). */
export interface TelegramWebhookDeps {
  /** TELEGRAM_WEBHOOK_SECRET (raw env). Undefined/empty ⇒ the route is disabled (generic 404). */
  readonly secret: string | undefined;
  /** chatId → role allow-list (deny-by-default; an unlisted sender is rejected downstream by the trust pipeline). */
  readonly allowList: SenderAllowList;
  /** Per-process trust state (replay set + rate window) — persisted across requests by the composition root. */
  readonly store: InboundStore;
  /** The SAME shared core InteractionPort every channel uses (zero core change). */
  readonly interaction: InteractionPort;
  /** Injected clock (ISO-8601 now) — never a wall-clock read here. */
  readonly clock: () => string;
  /**
   * Replay/dedupe seam (SECURITY): returns true if this Telegram update_id was ALREADY processed, and
   * records it (first-seen ⇒ false) otherwise. Injected + bounded by the composition root (no timers/clock).
   * Undefined ⇒ dedupe disabled (deterministic tests that don't exercise replay). See handleTelegramWebhook.
   */
  readonly seenUpdate?: (id: number) => boolean;
}

/** A transport-neutral response: HTTP status + a JSON-serializable body (the Next route wraps it verbatim). */
export interface TelegramWebhookResult {
  readonly status: number;
  readonly body: unknown;
}

const GENERIC_NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'no such route' } } as const;
const GENERIC_UNAUTHORIZED = { error: { code: 'UNAUTHORIZED', message: 'unauthorized' } } as const;
const ACK = { ok: true } as const; // Telegram only needs a 2xx ack

/** Constant-time secret-token compare; a length mismatch or absent token fails closed (no early-out leak). */
export function secretMatches(provided: string | undefined, expected: string): boolean {
  if (provided === undefined || provided.length === 0) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Safe JSON parse — returns null on any malformed body (verified-but-unparseable ⇒ 200 upstream). */
function safeParse(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    return null;
  }
}

/**
 * `from.language_code` → InboundMessage.locale. The ports contract named this source from day one
 * ("Telegram: `from.language_code`") and the webhook never read it, so every bot reply came back with
 * English chrome regardless of the sender's Telegram language (found 2026-08-04 — the third instance of
 * the declared-but-unhonoured-contract class that day). Coerced through the locale allowlist downstream;
 * an unshipped language degrades to English, never an error. Extracted for the complexity ceiling.
 */
function localeOf(msg: TelegramUpdate['message']): { locale?: string } {
  const lang = msg?.from?.language_code;
  return typeof lang === 'string' && lang !== '' ? { locale: lang } : {};
}

/**
 * Map a Telegram Update JSON → an unsigned InboundMessage, or null when it carries no usable text message
 * (a non-message update, an edited-message, a callback, etc.). `senderId` is the CHAT id (the allow-list +
 * reply audience are per-chat); `receivedAt` is the injected clock (freshness-checked in the trust pipeline).
 */
export function telegramUpdateToInbound(update: unknown, receivedAt: string): InboundMessage | null {
  const msg = (update as TelegramUpdate | null)?.message;
  const text = msg?.text;
  const chatId = msg?.chat?.id;
  if (typeof text !== 'string' || text.length === 0) return null;
  if (typeof chatId !== 'number' && typeof chatId !== 'string') return null;
  return { transport: 'telegram', senderId: String(chatId), text, receivedAt, ...localeOf(msg) };
}

/**
 * Handle one inbound Telegram webhook POST. Order is security-first; every non-2xx body is generic (no config
 * disclosure). On a verified, parseable text message it self-signs the canonical payload with the webhook
 * secret and runs the EXISTING trust pipeline via handleInbound — an unlisted/blocked/replayed sender is
 * rejected there and still returns 200 (a safe ack), so Telegram never loops. Never throws.
 */
export async function handleTelegramWebhook(
  req: { readonly secretToken: string | undefined; readonly rawBody: string },
  deps: TelegramWebhookDeps,
): Promise<TelegramWebhookResult> {
  if (deps.secret === undefined || deps.secret.length === 0) {
    return { status: 404, body: GENERIC_NOT_FOUND }; // secret not configured ⇒ route disabled (non-disclosing)
  }
  if (!secretMatches(req.secretToken, deps.secret)) {
    return { status: 401, body: GENERIC_UNAUTHORIZED };
  }
  const update = safeParse(req.rawBody);
  // Replay/dedupe (SECURITY, ADR-023 §trust): this boundary self-signs with a FRESH clock, so the trust
  // pipeline's replay/freshness guards can never fire for the webhook path — a captured POST would otherwise
  // replay successfully. Telegram's update_id is the stable per-update key: if we've already processed it,
  // ack 200 WITHOUT re-dispatching (Telegram retries redeliver the same update_id — always 2xx, never loop,
  // never act twice). Non-numeric/absent update_id ⇒ no dedupe applied (processed as before).
  const updateId = (update as TelegramUpdate | null)?.update_id;
  if (typeof updateId === 'number' && deps.seenUpdate?.(updateId) === true) {
    return { status: 200, body: ACK };
  }
  const inbound = update === null ? null : telegramUpdateToInbound(update, deps.clock());
  if (inbound === null) return { status: 200, body: ACK }; // verified-but-unparseable/non-message ⇒ 200

  // The secret-token already authenticated Telegram → this boundary self-signs so the downstream pipeline
  // (allow-list → replay → rate → firewall → parse) runs unchanged. An Err just yields a safe reply + 200.
  const signed: InboundMessage = { ...inbound, signature: signInbound(deps.secret, inbound) };
  await handleInbound(signed, {
    interaction: deps.interaction,
    inbound: { secret: deps.secret, allowList: deps.allowList, store: deps.store, clock: deps.clock },
  });
  return { status: 200, body: ACK };
}
