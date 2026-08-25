// BEACON — MessagingPort transports (E10·T-456 Telegram / T-457 WhatsApp; ADR-023/ADR-021). MOCK by
// default: a RecordedTransport captures every outbound send IN MEMORY — no network, fully deterministic,
// the demo transport. A LIVE transport sits behind a config flag (CHANNEL_*_MODE=live + token). For
// Telegram the LIVE transport is REAL (Bot API sendMessage over an injected fetch, typed-Result on any
// failure — never throws); WhatsApp LIVE remains a deliberate stub (T-457 not wired). Live is a config
// switch, never a rewrite (ADR-021 plugin pattern).
import type { Result } from '@/domain/shared/result.js';
import { ok, err } from '@/domain/shared/result.js';
import { DomainError } from '@/domain/errors.js';
import type { MessagingPort } from '@/ports/interaction.js';

export type ChannelMode = 'mock' | 'live';
export type MessagingTransport = 'telegram' | 'whatsapp';

/** Injectable fetch (defaults to the platform global) — lets tests supply a fake, no network in CI. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Config for a messaging transport (12-factor; derived from env — see *ConfigFromEnv below). */
export interface MessagingConfig {
  readonly mode: ChannelMode;
  readonly token?: string;
}

/** One captured outbound send (MOCK). Exposed so tests can assert the round-trip without a network. */
export interface RecordedSend {
  readonly to: string;
  readonly text: string;
}

/** MOCK MessagingPort: records sends in memory. This is the demo default (no egress, deterministic). */
export class RecordedTransport implements MessagingPort {
  readonly sent: RecordedSend[] = [];
  async send(to: string, text: string): Promise<Result<void, DomainError>> {
    this.sent.push({ to, text });
    return ok(undefined);
  }
}

/**
 * LIVE stub (WhatsApp only): reachable when CHANNEL_WHATSAPP_MODE=live + token. Intentionally NOT wired —
 * returns a typed error instead of any HTTP call, so no network dependency exists (T-457 out of scope).
 */
class LiveStubTransport implements MessagingPort {
  constructor(private readonly transport: MessagingTransport) {}
  async send(to: string, text: string): Promise<Result<void, DomainError>> {
    void to; // a real client would POST {to, text}; this stub never makes a network call
    void text;
    return err(
      new DomainError(
        'INVARIANT_VIOLATION',
        `${this.transport} live transport is not wired — run with CHANNEL_${this.transport.toUpperCase()}_MODE=mock`,
      ),
    );
  }
}

/** Shape of the Telegram Bot API response envelope we depend on (ok flag + optional description). */
interface BotApiResponse {
  readonly ok?: unknown;
  readonly description?: unknown;
}

/**
 * REAL Telegram Bot API transport (T-456): POST https://api.telegram.org/bot<token>/sendMessage with
 * JSON {chat_id, text} over an injected fetch. Returns a typed err on network/HTTP/parse/API failure —
 * it NEVER throws (a broadcast side-effect must never crash the approval path). node global fetch by default.
 */
class TelegramLiveTransport implements MessagingPort {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: FetchLike,
    private readonly timeoutMs = 15_000,
  ) {}

  async send(to: string, text: string): Promise<Result<void, DomainError>> {
    const url = `https://api.telegram.org/bot${this.token}/sendMessage`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: to, text }),
        // `redirect: 'manual'` (SECURITY, SSRF hardening — mirrors resilient-http.ts): a MITM'd upstream must
        // not 3xx-redirect this bot egress to an internal address; a 3xx is a non-2xx (res.ok false) ⇒ typed
        // err below, never a follow.
        redirect: 'manual',
        signal: controller.signal,
      });
      const body = (await res.json().catch(() => null)) as BotApiResponse | null;
      if (!res.ok || body === null || body.ok !== true) {
        const detail = typeof body?.description === 'string' ? body.description : `HTTP ${res.status}`;
        return err(new DomainError('INVARIANT_VIOLATION', `telegram sendMessage failed: ${detail}`));
      }
      return ok(undefined);
    } catch (thrown) {
      const reason = thrown instanceof Error ? thrown.message : 'network error';
      return err(new DomainError('INVARIANT_VIOLATION', `telegram sendMessage error: ${reason}`));
    } finally {
      clearTimeout(timer);
    }
  }
}

function makeMessaging(
  transport: MessagingTransport,
  config: MessagingConfig,
  fetchImpl: FetchLike,
): MessagingPort {
  if (config.mode !== 'live' || config.token === undefined || config.token.length === 0) {
    return new RecordedTransport();
  }
  return transport === 'telegram'
    ? new TelegramLiveTransport(config.token, fetchImpl)
    : new LiveStubTransport(transport);
}

/**
 * Telegram MessagingPort — MOCK (RecordedTransport) unless CHANNEL_TELEGRAM_MODE=live + TELEGRAM_BOT_TOKEN,
 * in which case a REAL Bot API transport over `fetchImpl` (T-456). Byte-identical MOCK default when unset.
 */
export function makeTelegramMessaging(config: MessagingConfig, fetchImpl: FetchLike = fetch): MessagingPort {
  return makeMessaging('telegram', config, fetchImpl);
}

/** WhatsApp MessagingPort — MOCK unless CHANNEL_WHATSAPP_MODE=live + WHATSAPP_TOKEN (T-457 stub). */
export function makeWhatsAppMessaging(config: MessagingConfig, fetchImpl: FetchLike = fetch): MessagingPort {
  return makeMessaging('whatsapp', config, fetchImpl);
}

function modeConfig(rawMode: string | undefined, token: string | undefined): MessagingConfig {
  const mode: ChannelMode = rawMode === 'live' ? 'live' : 'mock';
  return token !== undefined && token.length > 0 ? { mode, token } : { mode };
}

/** Read Telegram transport config from the environment (CHANNEL_TELEGRAM_MODE / TELEGRAM_BOT_TOKEN). */
export function telegramConfigFromEnv(env: Record<string, string | undefined>): MessagingConfig {
  return modeConfig(env.CHANNEL_TELEGRAM_MODE, env.TELEGRAM_BOT_TOKEN);
}

/** Read WhatsApp transport config from the environment (CHANNEL_WHATSAPP_MODE / WHATSAPP_TOKEN). */
export function whatsAppConfigFromEnv(env: Record<string, string | undefined>): MessagingConfig {
  return modeConfig(env.CHANNEL_WHATSAPP_MODE, env.WHATSAPP_TOKEN);
}
