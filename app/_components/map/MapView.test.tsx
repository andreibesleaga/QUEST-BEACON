// @vitest-environment happy-dom
// BEACON — MapView tests (E8·T-358). GL is injected: a fake engine drives the happy path (LayerManager
// syncs layers); a THROWING factory simulates WebGL-unavailable → labelled fallback that STILL lists every
// feature (never a dead-end, Art. XVI). The real MapLibre engine is never touched in a unit test.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { LAYER_IDS, type LayerId } from '../../_lib/types.js';
import { useUiStore } from '../../_lib/store.js';
import { MapView } from './MapView.js';
import type { LayerDescriptor, MapData, MapEngine, MapEngineFactory } from './types.js';

const data: MapData = {
  fire: { hotspots: [{ id: 'h1', position: [-120, 38] }] },
  reports: [{ id: 'r1', text: 'Trapped', position: [-120, 38] }],
};

function resetStore(): void {
  const off = Object.fromEntries(LAYER_IDS.map((id) => [id, false])) as Record<LayerId, boolean>;
  useUiStore.setState({ layers: { ...off, fire: true, reports: true }, actorRole: 'PUBLIC' });
}

function fakeEngine(onSetLayers: (d: readonly LayerDescriptor[]) => void = () => undefined): MapEngine {
  return {
    setLayers: onSetLayers,
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    recenter: vi.fn(),
    destroy: vi.fn(),
  };
}

describe('MapView', () => {
  beforeEach(resetStore);

  it('mounts the injected engine and syncs layers via LayerManager', async () => {
    const calls: LayerDescriptor[][] = [];
    const engine: MapEngine = fakeEngine((d) => calls.push([...d]));
    const factory: MapEngineFactory = vi.fn(() => engine);

    render(<MapView data={data} createEngine={factory} />);

    expect(screen.getByTestId('map-canvas')).toBeInTheDocument();
    await waitFor(() => expect(factory).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls[calls.length - 1]?.map((l) => l.group)).toContain('fire');
  });

  it('renders a labelled fallback + accessible feature list when the engine throws (no WebGL)', async () => {
    const throwing: MapEngineFactory = () => {
      throw new Error('WebGL unavailable');
    };

    render(<MapView data={data} createEngine={throwing} />);

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Interactive map unavailable' })).toBeInTheDocument(),
    );
    // never a dead-end: the same data is reachable as the accessible list
    expect(screen.getByRole('region', { name: 'Map features (accessible list)' })).toBeInTheDocument();
    expect(screen.getByText('Trapped')).toBeInTheDocument();
    // the GL canvas is gone in the fallback
    expect(screen.queryByTestId('map-canvas')).toBeNull();
    // no engine ⇒ no camera controls either (this branch is also every visual baseline's branch)
    expect(screen.queryByTestId('map-controls')).toBeNull();
  });

  it('renders keyboard-operable camera controls OUTSIDE the aria-hidden canvas, driving the engine verbs', async () => {
    const engine = fakeEngine();
    render(<MapView data={data} createEngine={() => engine} />);

    const controls = await screen.findByTestId('map-controls');
    // real, focusable buttons — NOT injected inside the aria-hidden canvas container, where they would
    // be focusable-but-invisible to assistive tech
    expect(screen.getByTestId('map-canvas')).toHaveAttribute('aria-hidden', 'true');
    expect(controls.closest('[aria-hidden="true"]')).toBeNull();

    screen.getByRole('button', { name: 'Zoom in' }).click();
    screen.getByRole('button', { name: 'Zoom out' }).click();
    screen.getByRole('button', { name: 'Re-center map' }).click();
    expect(engine.zoomIn).toHaveBeenCalledTimes(1);
    expect(engine.zoomOut).toHaveBeenCalledTimes(1);
    expect(engine.recenter).toHaveBeenCalledTimes(1);
  });
});
