'use client';
// BEACON — FreshnessBadge (E8·T-355; FR-2/U4). Per-source freshness as icon + label + relative time —
// NEVER a bare timestamp or a colour alone (T-346). "stale" when age > cadence×2; MOCK renders as
// "unavailable" (real source unreachable, showing recorded mock). Deterministic: pass a fixed `now` in tests.
import type { ReactNode } from 'react';
import { CircleCheck, Clock, WifiOff } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { BadgeShell } from './badge.js';
import { RELATIVE_TIME_MESSAGE_KEY, relativeTimeParts, toEpochMs } from './relative-time.js';
import { useT } from '../../_lib/i18n.js';

export type FreshnessMode = 'LIVE' | 'CACHED' | 'MOCK';
export type FreshnessState = 'fresh' | 'stale' | 'unavailable';

export interface FreshnessBadgeProps {
  /** When the datum was fetched; `null` = never / no data → "unavailable". */
  fetchedAt: Date | string | number | null;
  mode: FreshnessMode;
  /** Expected refresh interval (s); age beyond 2× marks the badge stale. */
  cadenceSec?: number | undefined;
  /** Fixed clock for deterministic rendering (defaults to now). */
  now?: number | Date | undefined;
}

interface StateMeta {
  icon: LucideIcon;
  label: string;
  className: string;
}

const STATE_META: Record<FreshnessState, StateMeta> = {
  fresh: { icon: CircleCheck, label: 'Live', className: 'text-ok' },
  stale: { icon: Clock, label: 'Stale', className: 'text-stale' },
  unavailable: { icon: WifiOff, label: 'Unavailable', className: 'text-stale' },
};

/**
 * Catalog key per state token (`ui.freshness.*`). STATE_META above is a MODULE-LEVEL constant and cannot
 * call the `useT` hook — it stays the English fallback; the render site translates via this key.
 */
const STATE_MESSAGE_KEY = {
  fresh: 'freshness.fresh',
  stale: 'freshness.stale',
  unavailable: 'freshness.unavailable',
} as const satisfies Record<FreshnessState, string>;

/** Pure freshness classifier — the single source of the fresh/stale/unavailable decision. */
export function computeFreshness(
  fetchedAt: Date | string | number | null,
  mode: FreshnessMode,
  cadenceSec: number | undefined,
  nowMs: number,
): FreshnessState {
  if (mode === 'MOCK') return 'unavailable';
  if (fetchedAt === null) return 'unavailable';
  const ageSec = (nowMs - toEpochMs(fetchedAt)) / 1000;
  if (cadenceSec !== undefined && ageSec > cadenceSec * 2) return 'stale';
  if (mode === 'CACHED') return 'stale';
  return 'fresh';
}

export function FreshnessBadge({ fetchedAt, mode, cadenceSec, now }: FreshnessBadgeProps): ReactNode {
  const t = useT('ui');
  const nowMs = now === undefined ? Date.now() : now instanceof Date ? now.getTime() : now;
  const state = computeFreshness(fetchedAt, mode, cadenceSec, nowMs);
  const meta = STATE_META[state];
  // The numeric part is passed as a pre-formatted string: an age is a raw count, not a grouped number.
  const age = fetchedAt === null ? null : relativeTimeParts(fetchedAt, nowMs);
  return (
    <BadgeShell icon={meta.icon} className={meta.className}>
      <span>{t(STATE_MESSAGE_KEY[state])}</span>
      {age !== null ? (
        <time className="text-fg-muted">
          {t(RELATIVE_TIME_MESSAGE_KEY[age.unit], { value: String(age.value) })}
        </time>
      ) : null}
    </BadgeShell>
  );
}
