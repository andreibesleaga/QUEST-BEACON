'use client';
// BEACON — ModeBadge (E8·T-355/adapter discipline). Declares the data-acquisition mode LIVE/CACHED/MOCK
// as icon + label (never colour-only, T-346) — the config-driven live/cached/mock flag made visible.
import type { ReactNode } from 'react';
import { Radio, Database, FlaskConical } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { BadgeShell } from './badge.js';
import { useT } from '../../_lib/i18n.js';

export type SourceMode = 'LIVE' | 'CACHED' | 'MOCK';

interface ModeMeta {
  label: string;
  icon: LucideIcon;
  className: string;
}

export const MODE_META: Record<SourceMode, ModeMeta> = {
  LIVE: { label: 'Live', icon: Radio, className: 'text-ok' },
  CACHED: { label: 'Cached', icon: Database, className: 'text-stale' },
  MOCK: { label: 'Mock', icon: FlaskConical, className: 'text-warn' },
};

export const MODE_ORDER: readonly SourceMode[] = ['LIVE', 'CACHED', 'MOCK'];

/**
 * Catalog key per mode token (`ui.mode.*`). MODE_META above is a MODULE-LEVEL constant and cannot call the
 * `useT` hook — it stays the English fallback; the render site translates via this token-derived key.
 */
export const MODE_MESSAGE_KEY = {
  LIVE: 'mode.LIVE',
  CACHED: 'mode.CACHED',
  MOCK: 'mode.MOCK',
} as const satisfies Record<SourceMode, string>;

export interface ModeBadgeProps {
  mode: SourceMode;
}

export function ModeBadge({ mode }: ModeBadgeProps): ReactNode {
  const t = useT('ui');
  const meta = MODE_META[mode];
  return (
    <BadgeShell icon={meta.icon} className={meta.className}>
      <span>{t(MODE_MESSAGE_KEY[mode])}</span>
    </BadgeShell>
  );
}
