// BEACON — approved-alert subscriber registry (E10·T-460; ADR-023, Art. XIII/XIV). The chat-id audience the
// HITL broadcast fans out to after an alert is approved + emitted. Deliberately a tiny in-memory list seeded
// from TELEGRAM_ALERT_CHAT_IDS (comma-separated, raw env at composition — the feature-seed idiom): keeping it
// behind a narrow interface lets a durable/DB-backed registry slot in later with zero call-site change. The
// registry holds ONLY opaque chat ids (no PII); the NotificationPort still redacts every outbound text.

/** The audience the approved-alert broadcast targets. Narrow on purpose so a durable impl can replace it. */
export interface SubscriberRegistry {
  /** Current, de-duplicated, insertion-ordered chat ids. */
  list(): readonly string[];
  /** Add a chat id (idempotent — a duplicate is ignored). Returns true when newly added. */
  add(chatId: string): boolean;
}

/** Parse the comma-separated TELEGRAM_ALERT_CHAT_IDS raw env value into trimmed, non-empty chat ids. */
export function parseChatIds(raw: string | undefined): readonly string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** In-memory SubscriberRegistry seeded from a chat-id list (deterministic; survives across requests in-process). */
export function makeInMemorySubscriberRegistry(seed: readonly string[] = []): SubscriberRegistry {
  const ids = new Set<string>(seed);
  return {
    list: () => [...ids],
    add: (chatId) => {
      if (chatId.length === 0 || ids.has(chatId)) return false;
      ids.add(chatId);
      return true;
    },
  };
}
