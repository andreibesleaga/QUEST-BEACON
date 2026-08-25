'use client';
// BEACON — Legend (E8·T-346; U6/F13). Renders the one-meaning-per-colour/shape CONTRACT: every hazard
// severity and data status maps to a colour AND an icon/shape AND a text label. This is the visual proof
// that BEACON never signals by colour alone. Data is sourced from the same meta maps the badges use, so the
// legend can never drift from the live components.
import type { LucideIcon } from 'lucide-react';
import { ShieldQuestion, CircleCheck, Clock, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../_lib/cn.js';
import { useT } from '../../_lib/i18n.js';
import { SEVERITY_MESSAGE_KEY, SEVERITY_META, SEVERITY_ORDER } from './severity-tag.js';
import { MODE_MESSAGE_KEY, MODE_META, MODE_ORDER } from './mode-badge.js';

interface LegendItem {
  key: string;
  label: string;
  icon: LucideIcon;
  className: string;
}

// Module-level constant (no hook here): the English labels stay as the fallback, and `messageKey` carries
// the same token to the render site, which translates it (`ui.legend.status.*`).
const STATUS_ITEMS = [
  { key: 'fresh', messageKey: 'legend.status.fresh', label: 'Fresh', icon: CircleCheck, className: 'text-ok' },
  { key: 'stale', messageKey: 'legend.status.stale', label: 'Stale', icon: Clock, className: 'text-stale' },
  {
    key: 'unavailable',
    messageKey: 'legend.status.unavailable',
    label: 'Unavailable',
    icon: WifiOff,
    className: 'text-stale',
  },
  {
    key: 'unverified',
    messageKey: 'legend.status.unverified',
    label: 'Unverified',
    icon: ShieldQuestion,
    className: 'text-unverified',
  },
] as const;

function LegendRow({ item }: { item: LegendItem }): ReactNode {
  const Icon = item.icon;
  return (
    <li className="flex items-center gap-2 text-sm text-fg">
      <Icon aria-hidden="true" className={cn('size-4 shrink-0', item.className)} strokeWidth={2} />
      <span>{item.label}</span>
    </li>
  );
}

function LegendGroup({ heading, items }: { heading: string; items: readonly LegendItem[] }): ReactNode {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{heading}</h3>
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => (
          <LegendRow key={item.key} item={item} />
        ))}
      </ul>
    </div>
  );
}

// Compact data-attribution line for overlay sources that require credit under their license (ODbL /
// CC BY / CC BY-SA). Basemap tile attribution is handled separately by MapLibre's attributionControl
// (see map/style.ts); this covers the deck.gl data overlays (WorldPop exposure, OpenCelliD coverage,
// OSM-derived infrastructure) plus the public-domain/derivative sources shown on the map.
const DATA_ATTRIBUTION =
  'Data: © OpenStreetMap contributors (ODbL) · WorldPop (CC BY 4.0) · OpenCelliD (CC BY-SA 4.0) · ' +
  'US federal sources (public domain) · Copernicus/JRC (EFFIS) · Webcams provided by windy.com · ' +
  'ALERTCalifornia | UC San Diego · Caltrans/511/CNAIR (link-out)';

export interface LegendProps {
  className?: string | undefined;
}

export function Legend({ className }: LegendProps): ReactNode {
  const t = useT('ui');
  // Rows are still derived from the SAME meta maps the badges use (so the legend cannot drift); only the
  // TEXT is resolved here, at the render site, because the meta maps are module-level constants.
  const severityItems: readonly LegendItem[] = SEVERITY_ORDER.map((s) => ({
    key: s,
    label: t(SEVERITY_MESSAGE_KEY[s]),
    icon: SEVERITY_META[s].icon,
    className: SEVERITY_META[s].className,
  }));
  const modeItems: readonly LegendItem[] = MODE_ORDER.map((m) => ({
    key: m,
    label: t(MODE_MESSAGE_KEY[m]),
    icon: MODE_META[m].icon,
    className: MODE_META[m].className,
  }));
  const statusItems: readonly LegendItem[] = STATUS_ITEMS.map((item) => ({
    key: item.key,
    label: t(item.messageKey),
    icon: item.icon,
    className: item.className,
  }));
  return (
    <section
      aria-label={t('legend.regionLabel')}
      className={cn('flex flex-col gap-4 rounded-lg border border-line bg-surface p-4 text-fg', className)}
    >
      <LegendGroup heading={t('legend.severityHeading')} items={severityItems} />
      <LegendGroup heading={t('legend.statusHeading')} items={statusItems} />
      <LegendGroup heading={t('legend.modeHeading')} items={modeItems} />
      <p className="border-t border-line pt-3 text-xs text-fg-muted">{DATA_ATTRIBUTION}</p>
    </section>
  );
}
