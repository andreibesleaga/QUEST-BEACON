'use client';
// BEACON — MapView (E8·T-358). Mounts a MapLibre map + deck.gl overlay behind the injectable `MapEngine`
// seam (createMapEngine by default; lazy-loaded so the GL bundle never enters a unit test's module graph).
// Wrapped in an ErrorBoundary; if the engine can't start (no WebGL) it shows a LABELLED fallback that STILL
// lists every feature via MapFeatureList — never a dead-end (Art. XVI). LayerManager syncs layers once ready.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Crosshair, Minus, Plus } from 'lucide-react';
import type { Position } from '@/domain/value-objects/geo.js';
import { cn } from '../../_lib/cn.js';
import { useT } from '../../_lib/i18n.js';
import { EmptyState, ErrorBoundary } from '../ui/index.js';
import { LayerManager } from './LayerManager.js';
import { MapFeatureList } from './MapFeatureList.js';
import type { MapData, MapEngine, MapEngineFactory, MapEngineOptions } from './types.js';

export interface MapViewProps {
  readonly data: MapData;
  /** Injectable engine factory (tests pass a fake / throwing one). Defaults to the lazy real MapLibre engine. */
  readonly createEngine?: MapEngineFactory | undefined;
  readonly center?: Position | undefined;
  readonly zoom?: number | undefined;
  /** Basemap click → clicked ground position as [lon, lat]. See MapEngineOptions.onMapClick. */
  readonly onMapClick?: ((position: Position) => void) | undefined;
  readonly className?: string | undefined;
}

function engineOptions(
  el: HTMLElement,
  center?: Position,
  zoom?: number,
  onMapClick?: (position: Position) => void,
): MapEngineOptions {
  return {
    container: el,
    ...(center !== undefined ? { center } : {}),
    ...(zoom !== undefined ? { zoom } : {}),
    ...(onMapClick !== undefined ? { onMapClick } : {}),
  };
}

export function MapView({ data, createEngine, center, zoom, onMapClick, className }: MapViewProps): ReactNode {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [engine, setEngine] = useState<MapEngine | null>(null);
  const [failed, setFailed] = useState(false);
  const t = useT('map');

  // The click handler is held in a REF, not passed through the effect deps. The engine is created once per
  // mount by design (see the dep-list note below), so a caller passing an inline arrow — the natural thing
  // to write — would otherwise tear down and rebuild the whole MapLibre map on every render. The stable
  // wrapper below always calls the LATEST handler.
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;

  useEffect(() => {
    const el = containerRef.current;
    if (el === null) return;
    let disposed = false;
    let created: MapEngine | null = null;

    const start = (make: MapEngineFactory): void => {
      try {
        created = make(engineOptions(el, center, zoom, (p) => onMapClickRef.current?.(p)));
        if (disposed) {
          created.destroy();
          return;
        }
        setEngine(created);
      } catch {
        setFailed(true); // WebGL unavailable / engine init failed → labelled fallback (never a dead-end)
      }
    };

    if (createEngine !== undefined) {
      start(createEngine);
    } else {
      void import('./map-engine.js')
        .then((m) => {
          if (!disposed) start(m.createMapEngine);
        })
        .catch(() => setFailed(true));
    }

    return () => {
      disposed = true;
      created?.destroy();
    };
    // Engine is created once per mount; center/zoom are read at creation time only (intentional dep list).
  }, [createEngine, center, zoom]);

  if (failed) {
    return (
      <ErrorBoundary label={t('errorBoundaryLabel')}>
        <div
          role="region"
          aria-label={t('unavailableTitle')}
          data-testid="map-view"
          className={cn('flex h-full w-full flex-col gap-2 overflow-auto p-4', className)}
        >
          <EmptyState title={t('unavailableTitle')} description={t('unavailableDescription')} />
          <MapFeatureList data={data} />
        </div>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary label={t('errorBoundaryLabel')}>
      {/* `absolute inset-0`, NOT `relative h-full w-full` (F-414 completion, 2026-08-06). This branch's only
          child is the absolutely-positioned canvas below, so the wrapper contributes ZERO content height and
          its height came entirely from `h-full`. A percentage height needs a DEFINITE parent height, and the
          shell's map slot (cop-layout.tsx `<main class="relative min-h-80 …">`) has none — `min-height` sets a
          used height without making it definite. So `h-full` resolved to 0 and the live MapLibre map was
          378x0 on phone / 776x0 on tablet: mounted, WebGL-alive, and invisible. It only looked fine on
          desktop, where the `lg` ROW branch stretches the slot from the aside beside it. Anchoring to the
          slot's padding box instead of measuring against it removes the dependency on an ancestor height
          that this shell will never have. The `failed` branch above keeps `h-full w-full` deliberately: it
          renders IN-FLOW content, so it sizes itself and the min-h-80 floor never binds — and every visual
          baseline is captured on that branch (WebGL is disabled in 12 of the 13 specs), so it stays
          byte-identical. Proven per viewport by the F-414 gate in e2e/webgl-smoke.spec.ts. */}
      <div data-testid="map-view" className={cn('absolute inset-0', className)}>
        <div
          ref={containerRef}
          data-testid="map-canvas"
          aria-hidden="true"
          className="absolute inset-0 bg-surface-2"
        />
        {engine !== null ? <LayerManager engine={engine} data={data} /> : null}
        {/* Mouse-free camera controls (2026-08-25). Real, focusable <button>s OUTSIDE the aria-hidden
            canvas container (controls injected inside it would be focusable-but-hidden to AT), driving
            the engine's camera verbs — so keyboard-only and touch operators can zoom and restore the
            region's home framing. Rendered only once the engine exists, which also keeps every visual
            baseline byte-identical (baselines capture the WebGL-failed branch, where engine is null). */}
        {engine !== null ? (
          <div className="absolute end-2 top-2 z-10 flex flex-col gap-1" data-testid="map-controls">
            <button
              type="button"
              aria-label={t('zoomIn')}
              title={t('zoomIn')}
              data-testid="map-zoom-in"
              onClick={() => engine.zoomIn()}
              className="flex size-11 items-center justify-center rounded-lg border border-line bg-surface text-fg shadow-sm hover:bg-surface-2"
            >
              <Plus aria-hidden="true" className="size-4" strokeWidth={2} />
            </button>
            <button
              type="button"
              aria-label={t('zoomOut')}
              title={t('zoomOut')}
              data-testid="map-zoom-out"
              onClick={() => engine.zoomOut()}
              className="flex size-11 items-center justify-center rounded-lg border border-line bg-surface text-fg shadow-sm hover:bg-surface-2"
            >
              <Minus aria-hidden="true" className="size-4" strokeWidth={2} />
            </button>
            <button
              type="button"
              aria-label={t('recenter')}
              title={t('recenter')}
              data-testid="map-recenter"
              onClick={() => engine.recenter()}
              className="flex size-11 items-center justify-center rounded-lg border border-line bg-surface text-fg shadow-sm hover:bg-surface-2"
            >
              <Crosshair aria-hidden="true" className="size-4" strokeWidth={2} />
            </button>
          </div>
        ) : null}
      </div>
    </ErrorBoundary>
  );
}
