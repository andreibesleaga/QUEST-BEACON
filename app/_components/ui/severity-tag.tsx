'use client';
// BEACON — SeverityTag (E8·T-346; U6/F13). One-meaning-per-colour/shape: each hazard severity pairs a
// DISTINCT token colour AND a DISTINCT icon shape AND a text label — so meaning survives colour-blindness,
// greyscale print, and monochrome map tiles. The SEVERITY_META map is re-used by the Legend (T-346).
import type { ReactNode } from 'react';
import { Info, TriangleAlert, ShieldAlert, OctagonAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { BadgeShell } from './badge.js';
import { useT } from '../../_lib/i18n.js';

export type Severity = 'MINOR' | 'MODERATE' | 'SEVERE' | 'EXTREME';

export interface SeverityMeta {
  label: string;
  /** Distinct shape per severity (circle / triangle / shield / octagon). */
  icon: LucideIcon;
  /** Distinct token colour utility per severity. */
  className: string;
}

export const SEVERITY_META: Record<Severity, SeverityMeta> = {
  MINOR: { label: 'Minor', icon: Info, className: 'text-sev-minor' },
  MODERATE: { label: 'Moderate', icon: TriangleAlert, className: 'text-sev-moderate' },
  SEVERE: { label: 'Severe', icon: ShieldAlert, className: 'text-sev-severe' },
  EXTREME: { label: 'Extreme', icon: OctagonAlert, className: 'text-sev-extreme' },
};

export const SEVERITY_ORDER: readonly Severity[] = ['MINOR', 'MODERATE', 'SEVERE', 'EXTREME'];

/**
 * Catalog key per severity token (`ui.severity.*`). SEVERITY_META above is a MODULE-LEVEL constant, so it
 * cannot call the `useT` hook — it stays the English fallback (and keeps non-React consumers working) while
 * every render site translates through this token-derived key.
 */
export const SEVERITY_MESSAGE_KEY = {
  MINOR: 'severity.MINOR',
  MODERATE: 'severity.MODERATE',
  SEVERE: 'severity.SEVERE',
  EXTREME: 'severity.EXTREME',
} as const satisfies Record<Severity, string>;

export interface SeverityTagProps {
  severity: Severity;
}

export function SeverityTag({ severity }: SeverityTagProps): ReactNode {
  const t = useT('ui');
  const meta = SEVERITY_META[severity];
  return (
    <BadgeShell icon={meta.icon} className={meta.className}>
      <span>{t(SEVERITY_MESSAGE_KEY[severity])}</span>
    </BadgeShell>
  );
}
