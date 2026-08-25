'use client';
// BEACON — MapTooltip (E8·T-366/T-357). The popup content shown when a deck.gl feature is picked. For an
// UNVERIFIED datum (reports/SOS) it renders the shared UnverifiedBadge (icon + label + confidence, never
// color-only). Layer caveats (outage granularity, prediction method) ride along as a labelled note.
import type { ReactNode } from 'react';
import type { LayerId } from '../../_lib/types.js';
import { useT } from '../../_lib/i18n.js';
import { UnverifiedBadge } from '../ui/index.js';
import { caveatText } from './build-layers.js';
import type { LayerDatum } from './types.js';

export interface MapTooltipProps {
  readonly datum: LayerDatum;
  readonly group: LayerId;
  readonly caveat?: string | undefined;
}

export function MapTooltip({ datum, group, caveat }: MapTooltipProps): ReactNode {
  const t = useT('map');
  return (
    <div
      role="tooltip"
      className="flex max-w-xs flex-col gap-1 rounded-lg border border-line bg-surface p-3 text-sm text-fg"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{datum.label ?? datum.id}</span>
        {datum.unverified ? (
          <UnverifiedBadge {...(datum.confidence !== undefined ? { confidence: datum.confidence } : {})} />
        ) : null}
      </div>
      {/* `group` is the layer id (a machine value) — only the surrounding wording is localized. */}
      <span className="text-xs text-fg-muted">{t('tooltip.layer', { group })}</span>
      {datum.viewUrl ? (
        // Live camera (E11): provider + LIVE/SNAPSHOT status + the click-to-open affordance. Gated on the
        // camera-only `viewUrl` field so every other layer's tooltip is unchanged.
        <div className="flex items-center justify-between gap-2 text-xs">
          {datum.provider ? <span className="text-fg-muted">{datum.provider}</span> : null}
          {datum.status ? <span className="font-medium text-fg">{datum.status}</span> : null}
          <span className="font-medium text-primary">{t('tooltip.clickToOpen')}</span>
        </div>
      ) : null}
      {caveat ? (
        <p role="note" className="text-xs text-fg-muted">
          {caveatText(t, caveat)}
        </p>
      ) : null}
    </div>
  );
}
