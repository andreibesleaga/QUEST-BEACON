// @vitest-environment happy-dom
// BEACON — LayerManager tests (E8·T-359). With a FAKE engine (no WebGL), flipping a store toggle re-runs
// buildLayers and hands the engine a descriptor set with/without that group — the add/remove contract.
import { describe, it, expect, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { LAYER_IDS, type LayerId } from '../../_lib/types.js';
import { useUiStore } from '../../_lib/store.js';
import { LayerManager } from './LayerManager.js';
import type { LayerDescriptor, MapData, MapEngine } from './types.js';

const data: MapData = {
  fire: { hotspots: [{ id: 'h1', position: [-120, 38] }] },
  flood: { gauges: [{ id: 'g1', position: [-121, 39], stage: 12 }] },
  reports: [{ id: 'r1', position: [-120, 38] }],
};

function resetStore(): void {
  const off = Object.fromEntries(LAYER_IDS.map((id) => [id, false])) as Record<LayerId, boolean>;
  useUiStore.setState({
    layers: { ...off, fire: true, flood: true, reports: true },
    actorRole: 'PUBLIC',
    activeRegionId: 'default',
    selectedIncidentId: undefined,
  });
}

describe('LayerManager', () => {
  beforeEach(resetStore);

  it('registers layers on mount and removes a group when its toggle flips off', () => {
    const calls: LayerDescriptor[][] = [];
    const engine: MapEngine = {
      setLayers: (d) => calls.push([...d]),
      zoomIn: () => undefined,
      zoomOut: () => undefined,
      recenter: () => undefined,
      destroy: () => undefined,
    };

    render(<LayerManager engine={engine} data={data} />);

    const firstGroups = () => calls[calls.length - 1]?.map((l) => l.group) ?? [];
    expect(firstGroups()).toContain('fire');

    act(() => useUiStore.getState().toggleLayer('fire'));

    expect(firstGroups()).not.toContain('fire');
    // other layers survive the single flip
    expect(firstGroups()).toContain('flood');
  });

  it('adds a group when a previously-off toggle flips on', () => {
    const calls: LayerDescriptor[][] = [];
    const engine: MapEngine = {
      setLayers: (d) => calls.push([...d]),
      zoomIn: () => undefined,
      zoomOut: () => undefined,
      recenter: () => undefined,
      destroy: () => undefined,
    };

    act(() => useUiStore.setState({ layers: { ...useUiStore.getState().layers, fire: false } }));
    render(<LayerManager engine={engine} data={data} />);
    expect(calls[calls.length - 1]?.map((l) => l.group)).not.toContain('fire');

    act(() => useUiStore.getState().toggleLayer('fire'));
    expect(calls[calls.length - 1]?.map((l) => l.group)).toContain('fire');
  });
});
