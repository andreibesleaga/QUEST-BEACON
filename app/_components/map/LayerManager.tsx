'use client';
// BEACON — LayerManager (E8·T-359). Bridges the Zustand layer state + the map data to the injected
// MapEngine: on every change it recomputes the pure descriptor set (buildLayers) and hands it to
// engine.setLayers, which registers/removes deck.gl layers by id. Renders nothing — it is a pure sync.
import { useEffect } from 'react';
import { useUiStore } from '../../_lib/store.js';
import { useT } from '../../_lib/i18n.js';
import { buildLayers } from './build-layers.js';
import type { MapData, MapEngine } from './types.js';

export interface LayerManagerProps {
  readonly engine: MapEngine;
  readonly data: MapData;
}

export function LayerManager({ engine, data }: LayerManagerProps): null {
  const layers = useUiStore((s) => s.layers);
  const role = useUiStore((s) => s.actorRole);
  // The descriptor labels drawn on the GL canvas are localized too — the translator is stable per locale.
  const t = useT('map');

  useEffect(() => {
    engine.setLayers(buildLayers({ layers, role }, data, t));
  }, [engine, layers, role, data, t]);

  return null;
}
