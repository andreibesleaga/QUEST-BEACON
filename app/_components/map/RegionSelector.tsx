'use client';
// BEACON — RegionSelector (E8·T-361) + GIBS satellite overlays (E8·T-364c). Selecting a region sets
// activeRegionId in the store (which re-keys the TanStack queries → data reload). Optional keyless NASA
// GIBS overlays (true-color / fires / flood / aerosol) are exposed as controlled toggles WITH the required
// attribution + layer-date freshness — honest, no vendor token.
import type { ReactNode } from 'react';
import { useUiStore } from '../../_lib/store.js';
import { DEFAULT_REGION_ID } from '../../_lib/store.js';
import { useT } from '../../_lib/i18n.js';

export interface RegionOption {
  readonly id: string;
  readonly label: string;
}

export const GIBS_OVERLAYS = [
  { id: 'truecolor', label: 'True color (VIIRS)' },
  { id: 'fires', label: 'Active fires (VIIRS)' },
  { id: 'flood', label: 'Flood (MODIS)' },
  { id: 'aerosol', label: 'Aerosol optical depth' },
] as const;
export type GibsOverlayId = (typeof GIBS_OVERLAYS)[number]['id'];

/** Required attribution for NASA GIBS/EOSDIS imagery (shown whenever an overlay is offered). */
export const GIBS_ATTRIBUTION = 'Satellite imagery: NASA EOSDIS GIBS';

export interface RegionSelectorProps {
  readonly regions?: readonly RegionOption[] | undefined;
  /** Ids of the currently-enabled GIBS overlays (controlled). */
  readonly enabledOverlays?: readonly GibsOverlayId[] | undefined;
  /** Layer date shown as the overlay-set freshness (GIBS tiles are dated, not live). */
  readonly overlayDate?: string | undefined;
  readonly onToggleOverlay?: ((id: GibsOverlayId) => void) | undefined;
  readonly className?: string | undefined;
}

export function RegionSelector({
  regions,
  enabledOverlays,
  overlayDate,
  onToggleOverlay,
  className,
}: RegionSelectorProps): ReactNode {
  const activeRegionId = useUiStore((s) => s.activeRegionId);
  const setRegion = useUiStore((s) => s.setRegion);
  const t = useT('map');
  // Caller-supplied region labels are data (region names, not UI copy); only the built-in default is localized.
  const options: readonly RegionOption[] = regions ?? [
    { id: DEFAULT_REGION_ID, label: t('region.default') },
  ];
  const enabled = new Set<GibsOverlayId>(enabledOverlays ?? []);

  return (
    <div className={className}>
      <label className="flex flex-col gap-1 text-sm text-fg">
        <span className="font-semibold">{t('region.label')}</span>
        <select
          data-testid="region-selector"
          className="min-h-11 rounded-lg border border-line bg-surface px-3 text-fg"
          value={activeRegionId}
          onChange={(e) => setRegion(e.target.value)}
        >
          {options.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </label>

      {onToggleOverlay ? (
        <fieldset className="mt-3">
          <legend className="text-sm font-semibold text-fg">{t('region.overlaysLegend')}</legend>
          <ul className="mt-1 flex flex-col gap-1">
            {GIBS_OVERLAYS.map((o) => (
              <li key={o.id}>
                <label className="flex min-h-11 items-center gap-2 text-sm text-fg">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={enabled.has(o.id)}
                    onChange={() => onToggleOverlay(o.id)}
                  />
                  {/* GIBS_OVERLAYS stays the English source of record; the visible name is keyed by id. */}
                  <span>{t(`gibs.${o.id}`)}</span>
                </label>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-fg-muted">
            {t('region.attribution')}
            {overlayDate ? ` — ${overlayDate}` : ''}
          </p>
        </fieldset>
      ) : null}
    </div>
  );
}
