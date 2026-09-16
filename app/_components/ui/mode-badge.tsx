'use client';
// BEACON — ModeBadge (E8·T-355/adapter discipline). Declares the SERVED provenance mode
// LIVE/CACHED/MOCK/DB as icon + label (never colour-only, T-346) — the provenance of a datum made visible.
//
// `DB` (ADR-041 §3, V2·A12) is the operator-maintained rung: a row an EM keeps in BEACON's own store. It is
// deliberately NOT styled like MOCK — the data is real operational fact, not an invented fixture — and
// deliberately not styled like LIVE either, because it makes no claim about the outside world.
import type { ReactNode } from 'react';
import { Radio, Database, FlaskConical, ClipboardPen } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { BadgeShell } from './badge.js';
import { useT } from '../../_lib/i18n.js';

// Mirrors the domain's SERVED_MODES (src/domain/source-record.ts). Re-declared rather than imported for
// the reason app/_lib/types.ts re-declares every wire shape: the client bundle does not pull in src/domain.
export type SourceMode = 'LIVE' | 'CACHED' | 'MOCK' | 'DB';

interface ModeMeta {
  label: string;
  icon: LucideIcon;
  className: string;
}

export const MODE_META: Record<SourceMode, ModeMeta> = {
  LIVE: { label: 'Live', icon: Radio, className: 'text-ok' },
  CACHED: { label: 'Cached', icon: Database, className: 'text-stale' },
  MOCK: { label: 'Mock', icon: FlaskConical, className: 'text-warn' },
  DB: { label: 'Operator', icon: ClipboardPen, className: 'text-primary' },
};

export const MODE_ORDER: readonly SourceMode[] = ['LIVE', 'CACHED', 'DB', 'MOCK'];

/**
 * Catalog key per mode token (`ui.mode.*`). MODE_META above is a MODULE-LEVEL constant and cannot call the
 * `useT` hook — it stays the English fallback; the render site translates via this token-derived key.
 */
export const MODE_MESSAGE_KEY = {
  LIVE: 'mode.LIVE',
  CACHED: 'mode.CACHED',
  MOCK: 'mode.MOCK',
  DB: 'mode.DB',
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
