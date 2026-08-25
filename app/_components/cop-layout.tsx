'use client';
// BEACON — Responsive COP shell (E8·T-350/D-27; UIUX§4). A single crisis-first screen: a map slot with
// docked, COLLAPSIBLE SitRep & logistics panels around it. Reflows across breakpoints — phone: stacked
// bottom-sheet dock; tablet/desktop: side-docked multi-panel — with NO horizontal scroll ever (min-w-0 +
// overflow-x-hidden on every track). The orchestrator fills the slots with the real map + panels; this file
// owns only layout + collapse, never data. DO NOT couple to app/page.tsx.
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { IconButton } from './ui/index.js';
import { cn } from '../_lib/cn.js';
import { useT } from '../_lib/i18n.js';

interface DockRegionProps {
  label: string;
  children: ReactNode;
  defaultCollapsed?: boolean;
}

/** A collapsible dock slot: a slim keyboard-operable bar + the panel body it shows/hides (aria-controls). */
function DockRegion({ label, children, defaultCollapsed = false }: DockRegionProps): ReactNode {
  const t = useT('shell');
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const bodyId = useId();
  return (
    // `lg:min-h-0 lg:flex-1` + the scroller below give EACH dock its own scrollbar on the pinned desktop
    // layout (added 2026-08-04). Previously both docks shared the aside's single scroller, so a long
    // SitRep pushed the whole logistics board out of reach and the operator had to scroll past all of the
    // situation report to task a resource. A collapsed dock keeps `flex-1` off so it shrinks to its bar.
    <div className={cn('flex min-w-0 flex-col', collapsed ? '' : 'lg:min-h-0 lg:flex-1')}>
      <div className="flex shrink-0 items-center justify-between gap-2 px-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{label}</span>
        <IconButton
          variant="ghost"
          size="sm"
          icon={collapsed ? PanelLeftOpen : PanelLeftClose}
          label={collapsed ? t('expand', { label }) : t('collapse', { label })}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={() => setCollapsed((v) => !v)}
        />
      </div>
      {/* The dock's OWN scroller. `min-h-0` is what lets a flex child actually shrink below its content
          height — without it `overflow-y-auto` never engages and the panel just grows. */}
      <div id={bodyId} hidden={collapsed} className="min-w-0 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        {children}
      </div>
    </div>
  );
}

export interface CopLayoutProps {
  /** The map (from app/_components/map) — fills the central slot. */
  map: ReactNode;
  sitrep: ReactNode;
  logistics: ReactNode;
  /** Optional top toolbar (region selector · act menu · theme toggle · command-palette mount). */
  toolbar?: ReactNode | undefined;
  sitrepLabel?: string | undefined;
  logisticsLabel?: string | undefined;
  className?: string | undefined;
}

export function CopLayout({
  map,
  sitrep,
  logistics,
  toolbar,
  sitrepLabel,
  logisticsLabel,
  className,
}: CopLayoutProps): ReactNode {
  // Dock names default to the catalog (a caller may still override with its own already-translated label).
  const t = useT('shell');
  const sitrepName = sitrepLabel ?? t('sitrepDock');
  const logisticsName = logisticsLabel ?? t('logisticsDock');
  return (
    <div className={cn('flex h-full w-full flex-col overflow-hidden bg-bg text-fg', className)}>
      {toolbar ? (
        /* flex-wrap, NOT overflow-x-hidden (WP-A3, 2026-08-05): the old clip made overflowing toolbar
           children — notably the sign-in fields once webfont swap widened earlier items — vanish off the
           right edge with no scrollbar and no way to reach them (WCAG 1.4.10 reflow). Wrapping keeps every
           control reachable at every width; on desktop nothing wraps, so those baselines are unchanged. */
        <header className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          {toolbar}
        </header>
      ) : null}

      {/* Phone: column (map on top, dock below as bottom-sheet). lg: row (map + side-docked panels). */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <main
          aria-label={t('mapLabel')}
          // MAP_SLOT_MIN_PX floor — finding F-414, and it is load-bearing, not cosmetic.
          // Nothing in this shell's ancestor chain has a DEFINITE height (app/_components/ui/card.tsx's
          // `min-h-0 flex-1 p-4` sits inside an auto-height <section>), so this slot is CONTENT-sized, not
          // viewport-sized. The real map's success branch renders ONE child, `absolute inset-0`
          // (MapView.tsx:94-99) — which contributes ZERO to content height. Measured consequence with WebGL
          // ON: the slot was 378x0 on phone and 776x0 on tablet, i.e. the live MapLibre map was clipped to
          // nothing by this element's own overflow-hidden and could not even be scrolled to. It only
          // survived on desktop by accident: at `lg` this track is a ROW, so align-items:stretch sized the
          // slot from the tall aside beside it (1022x1480), never from the map.
          // The floor is deliberately far BELOW every measured rendering (fallback branch: 834 phone,
          // 750 tablet, 1260 desktop) so it changes no pixel that is already correct — it only forbids the
          // collapse. Asserted per project in e2e/webgl-smoke.spec.ts.
          className="relative min-h-80 min-w-0 flex-1 overflow-hidden"
        >
          {map}
        </main>

        <aside
          aria-label={t('panelsLabel')}
          className={cn(
            'flex min-h-0 min-w-0 shrink-0 flex-col gap-3 overflow-y-auto overflow-x-hidden border-t border-line p-3',
            // On the pinned desktop layout the aside itself must NOT scroll — each dock scrolls itself
            // (see DockRegion). Keeping `overflow-y-auto` here too would produce a second, outer scrollbar
            // and the nested-scroller trap where the wheel moves the wrong track.
            'lg:w-96 lg:max-w-[92vw] lg:overflow-y-hidden lg:border-s lg:border-t-0',
          )}
        >
          <DockRegion label={sitrepName}>{sitrep}</DockRegion>
          <DockRegion label={logisticsName}>{logistics}</DockRegion>
        </aside>
      </div>
    </div>
  );
}
