'use client';
// BEACON — LayerTogglePanel (E8·T-360). Keyboard-operable checkboxes bound 1:1 to useUiStore.toggleLayer;
// each row carries the layer's FreshnessBadge (icon + label, never a bare timestamp) and, where relevant,
// an honest per-layer caveat (outage county-granularity, cell estimate, FIRMS≠perimeter). Native checkboxes
// give correct role/keyboard for free; the whole panel is one labelled fieldset.
import type { ReactNode } from 'react';
import { LAYER_IDS, type LayerId } from '../../_lib/types.js';
import { useUiStore } from '../../_lib/store.js';
import { useT } from '../../_lib/i18n.js';
import { FreshnessBadge } from '../ui/index.js';
import { LAYER_META, caveatText } from './build-layers.js';
import type { MapData } from './types.js';

export interface LayerTogglePanelProps {
  /** Supplies each layer's freshness (mode + fetchedAt + cadence) for its badge. */
  readonly data?: MapData | undefined;
  /** Fixed clock for deterministic badge rendering in tests. */
  readonly now?: number | Date | undefined;
  readonly className?: string | undefined;
}

export function LayerTogglePanel({ data, now, className }: LayerTogglePanelProps): ReactNode {
  const layers = useUiStore((s) => s.layers);
  const toggleLayer = useUiStore((s) => s.toggleLayer);
  const freshness = data?.freshness;
  const t = useT('map');

  return (
    <fieldset
      data-testid="layer-toggle-panel"
      className={className}
      // fieldset gets an accessible name from its legend below
    >
      <legend className="mb-2 text-sm font-semibold text-fg">{t('layersLegend')}</legend>
      {/*
        F-413: the list MUST be its own scroll region. There are 14 layers, each row at least 44 px tall
        (`min-h-11`, the WCAG 2.2 target-size floor) plus optional caveat lines — comfortably over 800 px —
        and this panel renders inside a Popover anchored to the toolbar at the TOP of the page. Unbounded,
        it simply ran off the bottom of the viewport: every layer from "Exposure" (the 10th) downward was
        UNREACHABLE by mouse or keyboard, on a 1440×900 desktop as well as on phones. That is five shipped
        map layers a user could never turn on, on the flagship COP surface.

        Caught by the browser gate, which is the only place it COULD be caught: the panel renders all 14
        rows in jsdom, so every component test passed and every row was "present" — presence is not reach.
      */}
      <ul className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto pe-1">
        {LAYER_IDS.map((id: LayerId) => {
          const meta = LAYER_META[id];
          const fresh = freshness?.[id];
          return (
            <li key={id} className="flex flex-col gap-1">
              {/* flex-wrap + min-w-0 (WP-A4, 2026-08-05): the popover is ~256px wide and the freshness
                  badge is whitespace-nowrap — a long translated layer name beside an "Unavailable · N days
                  ago" badge overflowed the row and was CLIPPED by the popover. Wrapping drops the badge to
                  its own line instead; the name itself may break mid-word rather than push past the edge. */}
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-sm text-fg">
                  <input
                    type="checkbox"
                    className="size-4 shrink-0"
                    checked={layers[id]}
                    onChange={() => toggleLayer(id)}
                  />
                  {/* LAYER_META stays the English source of record; the visible name is keyed by layer id. */}
                  <span className="min-w-0 break-words">{t(`layer.${id}`)}</span>
                </label>
                {fresh ? (
                  <FreshnessBadge
                    fetchedAt={fresh.fetchedAt}
                    mode={fresh.mode}
                    {...(fresh.cadenceSec !== undefined ? { cadenceSec: fresh.cadenceSec } : {})}
                    {...(now !== undefined ? { now } : {})}
                  />
                ) : null}
              </div>
              {meta.caveat ? (
                <p role="note" className="ps-6 text-xs text-fg-muted">
                  {caveatText(t, meta.caveat)}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
