// BEACON — messaging channel barrel (E10·T-455…T-459/T-462; ADR-023). A DRIVING (inbound) + DRIVEN
// (outbound) adapter set over the SAME core as every other channel — zero core change, MOCK by default.
export { parseMessageToCommand } from './parse.js';
export {
  mapInbound,
  signInbound,
  makeInboundStore,
  type InboundDeps,
  type InboundStore,
  type SenderAllowList,
  type RateLimitConfig,
} from './trust.js';
export {
  RecordedTransport,
  makeTelegramMessaging,
  makeWhatsAppMessaging,
  telegramConfigFromEnv,
  whatsAppConfigFromEnv,
  type MessagingConfig,
  type ChannelMode,
  type MessagingTransport,
  type RecordedSend,
  type FetchLike,
} from './messaging-port.js';
export { makeNotifier, type NotificationDeps, type AuditRecord } from './notification.js';
export {
  makeInMemorySubscriberRegistry,
  parseChatIds,
  type SubscriberRegistry,
} from './subscriber-registry.js';
export {
  handleTelegramWebhook,
  telegramUpdateToInbound,
  secretMatches,
  type TelegramWebhookDeps,
  type TelegramWebhookResult,
} from './telegram-webhook.js';
export {
  handleInbound,
  renderDigest,
  type HandleInboundDeps,
  type InboundReply,
} from './handle-inbound.js';
export { digestChromeFor, type DigestChrome } from './digest-i18n.js';
