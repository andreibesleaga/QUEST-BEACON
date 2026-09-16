// BEACON — subscriber registry tests (E10·T-460; ADR-023). Pure, deterministic. Covers the raw-env chat-id
// parsing (comma-separated, trimmed, empties dropped) and the in-memory registry's de-dup + insertion order.
import { describe, it, expect } from 'vitest';
import { makeInMemorySubscriberRegistry, parseChatIds } from './subscriber-registry.js';

describe('parseChatIds (TELEGRAM_ALERT_CHAT_IDS)', () => {
  it('splits comma-separated ids, trims whitespace, and drops empties', () => {
    expect(parseChatIds(' 111 , 222,333 ,')).toEqual(['111', '222', '333']);
  });

  it('returns [] for undefined / empty / whitespace-only input', () => {
    expect(parseChatIds(undefined)).toEqual([]);
    expect(parseChatIds('')).toEqual([]);
    expect(parseChatIds('  , ,')).toEqual([]);
  });
});

describe('makeInMemorySubscriberRegistry', () => {
  it('seeds from a chat-id list and lists them in insertion order', () => {
    const reg = makeInMemorySubscriberRegistry(['111', '222']);
    expect(reg.list()).toEqual(['111', '222']);
  });

  it('add is idempotent — a duplicate is ignored (add returns false)', () => {
    const reg = makeInMemorySubscriberRegistry(['111']);
    expect(reg.add('222')).toBe(true);
    expect(reg.add('222')).toBe(false); // duplicate
    expect(reg.add('')).toBe(false); // empty rejected
    expect(reg.list()).toEqual(['111', '222']);
  });
});
