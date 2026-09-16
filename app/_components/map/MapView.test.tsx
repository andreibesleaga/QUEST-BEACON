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

function fakeEngine(
  onSetLayers: (d: readonly LayerDescriptor[]) => void = () => undefined,
): MapEngine {
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

  // 2026-09-11, owner-reported: every external deep-link opened a different place from the one on screen,
  // because nothing outside the engine knew where the camera was. This pins the seam that carries it —
  // the engine receives a view-change callback, and what it reports reaches the store the links read.
  it("forwards the engine's camera position to the store, so external links follow the view", async () => {
    let publish: ((v: { center: [number, number]; zoom: number }) => void) | undefined;
    const factory: MapEngineFactory = vi.fn((opts) => {
      publish = opts.onViewChange as typeof publish;
      return fakeEngine();
    });
    const setMapView = useUiStore.getState().setMapView;

    render(<MapView data={data} createEngine={factory} onViewChange={setMapView} />);
    await waitFor(() => expect(publish).toBeDefined());

    // Nothing is claimed before the engine says where it is looking — a guessed viewport is worse than none.
    expect(useUiStore.getState().mapView).toBeUndefined();
    publish?.({ center: [-121.62, 39.76], zoom: 17 });
    await waitFor(() =>
      expect(useUiStore.getState().mapView).toEqual({ center: [-121.62, 39.76], zoom: 17 }),
    );
  });

  // Art. XVI — degrade, LABEL, never dead-end. An air-gapped build has no basemap under the layers; the
  // failure before this was that nothing said so, and a blank backdrop reads as "no buildings here"
  // rather than "no imagery here" — a difference that matters when the layers on top are a wildfire.
  it('labels the missing basemap in an air-gapped build, and says nothing in a connected one', async () => {
    const factory: MapEngineFactory = vi.fn(() => fakeEngine());

    vi.stubEnv('NEXT_PUBLIC_BASEMAP_MODE', 'offline');
    const offline = render(<MapView data={data} createEngine={factory} />);
    await waitFor(() => expect(screen.getByTestId('map-offline-basemap')).toBeInTheDocument());
    // A status role, so a screen-reader operator is told rather than left with a silent empty canvas.
    expect(screen.getByTestId('map-offline-basemap')).toHaveAttribute('role', 'status');
    offline.unmount();

    vi.stubEnv('NEXT_PUBLIC_BASEMAP_MODE', 'online');
    render(<MapView data={data} createEngine={factory} />);
    await waitFor(() => expect(screen.getByTestId('map-canvas')).toBeInTheDocument());
    expect(screen.queryByTestId('map-offline-basemap')).toBeNull();
    vi.unstubAllEnvs();
  });

  it('labels the tileless fallback when every online basemap host refuses', async () => {
    // "online" is not a promise that a basemap arrived — verified 2026-09-12, the default tile host
    // answers this deployment with an "Access blocked" image under a 200 OK. The label carries its own
    // wording, NOT the air-gapped one: an operator on a connected network is not air-gapped, and telling
    // them they are sends them looking for the wrong fault.
    vi.stubEnv('NEXT_PUBLIC_BASEMAP_MODE', 'online');
    const factory: MapEngineFactory = vi.fn((opts) => {
      opts.onBasemapChange?.(null);
      return fakeEngine();
    });

    render(<MapView data={data} createEngine={factory} />);

    await waitFor(() => expect(screen.getByTestId('map-unavailable-basemap')).toBeInTheDocument());
    expect(screen.queryByTestId('map-offline-basemap')).not.toBeInTheDocument();
    vi.unstubAllEnvs();
  });

  it('shows no basemap label at all while the ladder is still asking', async () => {
    // The distinction between "still asking" and "every host refused" is the reason the engine reports
    // `null` rather than a boolean: a healthy load must not flash a failure notice on its way up.
    vi.stubEnv('NEXT_PUBLIC_BASEMAP_MODE', 'online');
    const factory: MapEngineFactory = vi.fn(() => fakeEngine());

    render(<MapView data={data} createEngine={factory} />);

    await waitFor(() => expect(screen.getByTestId('map-view')).toBeInTheDocument());
    expect(screen.queryByTestId('map-unavailable-basemap')).not.toBeInTheDocument();
    vi.unstubAllEnvs();
  });

  // The canvas is aria-hidden, so with a WORKING engine a screen-reader operator used to get nothing at
  // all from the map — the feature table existed only in the failure branch. Pinned in both branches.
  it('offers the accessible feature list whether or not the engine works', async () => {
    const working: MapEngineFactory = vi.fn(() => fakeEngine());
    const { unmount } = render(<MapView data={data} createEngine={working} />);
    await waitFor(() => expect(screen.getByTestId('map-canvas')).toBeInTheDocument());
    expect(screen.getByTestId('map-feature-list')).toBeInTheDocument();
    unmount();

    const throwing: MapEngineFactory = vi.fn(() => {
      throw new Error('no WebGL');
    });
    render(<MapView data={data} createEngine={throwing} />);
    await waitFor(() => expect(screen.getByTestId('map-feature-list')).toBeInTheDocument());
  });

  it('switching region drops the camera — a viewport from another region is wrong, not stale', () => {
    useUiStore.getState().setMapView({ center: [-121.62, 39.76], zoom: 17 });
    useUiStore.getState().setRegion('ro-brasov');
    expect(useUiStore.getState().mapView).toBeUndefined();
  });

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
      expect(
        screen.getByRole('region', { name: 'Interactive map unavailable' }),
      ).toBeInTheDocument(),
    );
    // never a dead-end: the same data is reachable as the accessible list
    expect(
      screen.getByRole('region', { name: 'Map features (accessible list)' }),
    ).toBeInTheDocument();
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
