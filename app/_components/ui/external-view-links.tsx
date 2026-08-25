'use client';
// BEACON — ExternalViewLinks (E11 "Live Views" · CW3b; ADR-028; FR-VIEW-1/2). Renders the deterministic
// third-party 3D/satellite/street/weather deep-links for a [lon,lat] point. Pure presentational: consumes
// `buildExternalViews` (src/application/external-views/external-views.ts) DIRECTLY — that builder is a
// framework-free pure function (no network/key/state), and importing it here duplicates nothing (see
// boundary note below) rather than forking a second copy of the verified URL templates.
//
// Boundary note (checked against .dependency-cruiser.cjs + eslint.config.js): depcruise's `boundaries`
// script only cruises `src/**`, and neither depcruise nor the ESLint `no-restricted-imports` rules forbid
// `app/**` importing `@/application/**` (only `src/domain` and `src/application` themselves are
// restricted, from importing adapters/frameworks). `app/` already imports `@/domain` and `@/ports` types
// directly elsewhere (e.g. app/_lib/types.ts, app/_components/map/types.ts) and AGENTS.md §3 describes the
// Next.js layer as delegating to application use-cases — so a direct import is the legal, minimal,
// single-source-of-truth choice; no re-export/duplicate shim is needed.
//
// Link-only + advisory (Art. XII): every entry opens the provider's OWN site in a new tab (`target="_blank"
// rel="noopener noreferrer"`) — real, keyboard-focusable anchors, never a client-side embed/proxy/fetch.
import type { ReactNode } from 'react';
import { buildExternalViews, type ExternalViewKind } from '@/application/external-views/external-views.js';
import type { Position } from '@/domain/value-objects/geo.js';
import { cn } from '../../_lib/cn.js';
import { useT } from '../../_lib/i18n.js';

/** The English kind labels — kept as the source-of-record fallback the `ui.externalViews.kind.*` catalog mirrors. */
export const KIND_LABEL: Record<ExternalViewKind, string> = {
  map: 'Map',
  satellite: 'Satellite',
  street: 'Street',
  '3d': '3D',
  weather: 'Weather',
  imagery: 'Imagery',
  fire: 'Fire',
  flood: 'Flood',
};

/**
 * Catalog key per kind token (`ui.externalViews.kind.*`). KIND_LABEL above is a MODULE-LEVEL constant and
 * cannot call the `useT` hook — it stays the English fallback; the render site translates via this key.
 */
const KIND_MESSAGE_KEY = {
  map: 'externalViews.kind.map',
  satellite: 'externalViews.kind.satellite',
  street: 'externalViews.kind.street',
  '3d': 'externalViews.kind.3d',
  weather: 'externalViews.kind.weather',
  imagery: 'externalViews.kind.imagery',
  fire: 'externalViews.kind.fire',
  flood: 'externalViews.kind.flood',
} as const satisfies Record<ExternalViewKind, string>;

export interface ExternalViewLinksProps {
  /** The [lon,lat] point every deep-link is built from. */
  position: Position;
  /** Optional context (e.g. incident headline) folded into the advisory caption — cosmetic only. */
  label?: string | undefined;
  className?: string | undefined;
}

/** The link-list body: caption + a compact grid of real `<a>` links, one per verified provider. */
export function ExternalViewLinks({ position, label, className }: ExternalViewLinksProps): ReactNode {
  const t = useT('ui');
  const links = buildExternalViews(position);
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <p className="text-xs text-fg-muted">
        {label ? t('externalViews.captionFor', { label }) : t('externalViews.caption')}
      </p>
      <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2" aria-label={t('externalViews.listLabel')}>
        {links.map((link) => (
          <li key={`${link.provider}-${link.label}`}>
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                'flex min-h-11 items-center justify-between gap-1.5 rounded border border-line bg-surface',
                'px-2 py-1.5 text-xs text-fg hover:bg-surface-2 hover:text-fg',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg',
              )}
            >
              <span className="truncate font-medium">{link.label}</span>
              <span className="shrink-0 rounded bg-surface-2 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
                {t(KIND_MESSAGE_KEY[link.kind])}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
