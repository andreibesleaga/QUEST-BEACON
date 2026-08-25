// @vitest-environment happy-dom
// BEACON — camera layer builder + click-to-open-external seam tests (E11 "Live Views", wave CW3a). Cameras
// are link-only: one pickable violet pin per feed, clicking opens the source's own https live-view page in a
// new tab with noopener,noreferrer (Art. XII / link-only doctrine). The https guard is defense-in-depth on
// top of the upstream domain guard — a non-https datum NEVER reaches the open seam.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { LAYER_IDS, type LayerId } from '../../_lib/types.js';
import {
  buildLayers,
  buildCameraLayers,
  openExternal,
  CAMERA_CAVEAT,
  LAYER_META,
} from './build-layers.js';
import type { CameraPin, LayerDatum, MapData } from './types.js';

function allOff(): Record<LayerId, boolean> {
  return Object.fromEntries(LAYER_IDS.map((id) => [id, false])) as Record<LayerId, boolean>;
}

const cameras: readonly CameraPin[] = [
  {
    id: 'cam-live',
    position: [-120, 38],
    kind: 'FIRE_CAMERA',
    title: 'Ridge PTZ',
    provider: 'ALERTCalifornia',
    viewUrl: 'https://cameras.alertcalifornia.org/cam/ridge',
    isLive: true,
  },
  {
    id: 'cam-snap',
    position: [-121, 39],
    kind: 'TRAFFIC_CCTV',
    title: 'US-50 @ Echo',
    provider: 'Caltrans',
    viewUrl: 'https://cwwp2.dot.ca.gov/cam/echo',
    isLive: false,
  },
];

afterEach(() => vi.restoreAllMocks());

describe('buildCameraLayers — link-only pins (E11)', () => {
  it('returns [] for absent data and for an empty array (no undefined-vs-empty divergence)', () => {
    expect(buildCameraLayers(undefined)).toEqual([]);
    expect(buildCameraLayers([])).toEqual([]);
  });

  it('emits ONE pickable violet scatterplot descriptor carrying the link-out caveat', () => {
    const layers = buildCameraLayers(cameras);
    expect(layers).toHaveLength(1);
    const [layer] = layers;
    expect(layer?.kind).toBe('scatterplot');
    expect(layer?.group).toBe('cameras');
    expect(layer?.pickable).toBe(true);
    expect(layer?.caveat).toBe(CAMERA_CAVEAT);
    expect(layer?.caveat).toBe(LAYER_META.cameras.caveat);
    expect(layer?.caveat).toMatch(/opens the source's site in a new tab/i);
  });

  it('maps each pin to a datum: title→label, provider, viewUrl, and isLive→LIVE/SNAPSHOT status', () => {
    const [layer] = buildCameraLayers(cameras);
    const live = layer?.data.find((d) => d.id === 'cam-live');
    const snap = layer?.data.find((d) => d.id === 'cam-snap');
    expect(live?.label).toBe('Ridge PTZ');
    expect(live?.provider).toBe('ALERTCalifornia');
    expect(live?.viewUrl).toBe('https://cameras.alertcalifornia.org/cam/ridge');
    expect(live?.position).toEqual([-120, 38]);
    expect(live?.status).toBe('LIVE');
    expect(snap?.status).toBe('SNAPSHOT');
  });

  it('is wired into the pure buildLayers map — cameras ON emits the pins, OFF emits nothing', () => {
    const data: MapData = { cameras };
    const on = buildLayers({ layers: { ...allOff(), cameras: true }, role: 'PUBLIC' }, data).map((l) => l.id);
    expect(on).toContain('cameras-pins');
    const off = buildLayers({ layers: allOff(), role: 'PUBLIC' }, data).map((l) => l.group);
    expect(off).not.toContain('cameras');
  });
});

describe('camera click seam — https-only open, injectable + defensively guarded', () => {
  it("invokes the injected open seam with the datum's https viewUrl on click", () => {
    const open = vi.fn();
    const [layer] = buildCameraLayers(cameras, open);
    const datum: LayerDatum = { id: 'cam-live', viewUrl: 'https://cameras.alertcalifornia.org/cam/ridge' };
    layer?.onClick?.(datum);
    expect(open).toHaveBeenCalledExactlyOnceWith('https://cameras.alertcalifornia.org/cam/ridge');
  });

  it('does NOT open a non-https datum (defense-in-depth on top of the domain guard)', () => {
    const open = vi.fn();
    const [layer] = buildCameraLayers(cameras, open);
    layer?.onClick?.({ id: 'x', viewUrl: 'http://insecure.example/cam' });
    layer?.onClick?.({ id: 'y', viewUrl: 'javascript:alert(1)' });
    layer?.onClick?.({ id: 'z' }); // no viewUrl at all
    expect(open).not.toHaveBeenCalled();
  });
});

describe('openExternal — the sole link-out side effect', () => {
  it('opens an https url in a new tab with noopener,noreferrer', () => {
    const spy = vi.spyOn(window, 'open').mockReturnValue(null);
    openExternal('https://cameras.alertcalifornia.org/cam/ridge');
    expect(spy).toHaveBeenCalledExactlyOnceWith(
      'https://cameras.alertcalifornia.org/cam/ridge',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('never opens a non-https url (http, javascript:, relative)', () => {
    const spy = vi.spyOn(window, 'open').mockReturnValue(null);
    openExternal('http://insecure.example/cam');
    openExternal('javascript:alert(1)');
    openExternal('/relative/path');
    expect(spy).not.toHaveBeenCalled();
  });
});
