'use client';
// BEACON — UnverifiedBadge (E8·T-356; FR-2/EV4). Crowdsourced/social data is labelled with icon + the
// literal word "Unverified" (never colour-only, T-346). Uses the distinct `--unverified` hue + shield icon.
import type { ReactNode } from 'react';
import { ShieldQuestion } from 'lucide-react';
import { BadgeShell } from './badge.js';
import { useT } from '../../_lib/i18n.js';

export interface UnverifiedBadgeProps {
  /** Optional numeric confidence (0–1) shown beside the label. */
  confidence?: number | undefined;
}

export function UnverifiedBadge({ confidence }: UnverifiedBadgeProps): ReactNode {
  const t = useT('ui');
  return (
    <BadgeShell icon={ShieldQuestion} className="text-unverified">
      <span>{t('unverified')}</span>
      {confidence !== undefined ? (
        <span className="text-fg-muted">{Math.round(confidence * 100)}%</span>
      ) : null}
    </BadgeShell>
  );
}
