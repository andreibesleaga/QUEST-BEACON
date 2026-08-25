// @vitest-environment happy-dom
// BEACON — MapFeatureList tests (E8·T-391; S3·U3). The accessible map alternative: every feature reachable
// as keyboard-focusable text, reports badged Unverified, precise-PII geometry gated by role here too, and
// EVERY one of the 14 LAYER_IDS contributing rows when (and only when) it has data.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LAYER_IDS, type LayerId } from '../../_lib/types.js';
import { useUiStore } from '../../_lib/store.js';
import { MapFeatureList, toFeatureRows } from './MapFeatureList.js';
import type { MapData } from './types.js';

const data: MapData = {
  fire: { hotspots: [{ id: 'h1', position: [-119.1, 37.1], severity: 'SEVERE' }] },
  flood: { gauges: [{ id: 'g1', name: 'Bear R.', position: [-121, 39], stage: 12, unit: 'ft' }] },
  infrastructure: [{ id: 'n1', name: 'Substation A', position: [-120.2, 38.2], status: 'AT_RISK' }],
  exposure: [{ id: 'e1', name: 'Clinic', position: [-120.3, 38.3], hazard: 'flood' }],
  reports: [{ id: 'r1', text: 'Trapped', position: [-120.0, 38.0], precisePosition: [-120.9, 38.9], confidence: 0.5 }],
  shelters: [{ id: 's1', name: 'North HS', position: [-120.4, 38.4], capacity: 100, demand: 40 }],
};

beforeEach(() => {
  useUiStore.setState({ actorRole: 'PUBLIC', selectedIncidentId: undefined });
});

describe('MapFeatureList', () => {
  it('is a labelled region listing every feature as text', () => {
    render(<MapFeatureList data={data} role="PUBLIC" />);
    const region = screen.getByRole('region', { name: 'Map features (accessible list)' });
    const scoped = within(region);
    expect(scoped.getByText('Bear R.')).toBeInTheDocument();
    expect(scoped.getByText('Substation A')).toBeInTheDocument();
    expect(scoped.getByText('Clinic')).toBeInTheDocument();
    expect(scoped.getByText('North HS')).toBeInTheDocument();
    expect(scoped.getByText('Trapped')).toBeInTheDocument();
  });

  it('renders a keyboard-focusable action button per feature', () => {
    render(<MapFeatureList data={data} role="PUBLIC" />);
    const buttons = screen.getAllByRole('button', { name: /^Focus / });
    // one per feature: fire, gauge, infra, exposure, report, shelter
    expect(buttons.length).toBe(6);
    buttons.forEach((b) => expect(b).toBeEnabled());
  });

  it('badges reports Unverified (icon + label, never color-only)', () => {
    render(<MapFeatureList data={data} role="PUBLIC" />);
    expect(screen.getByText('Unverified')).toBeInTheDocument();
  });

  it('gates precise-PII geometry: PUBLIC sees generalized coords', () => {
    render(<MapFeatureList data={data} role="PUBLIC" />);
    expect(screen.getByText('38.000, -120.000')).toBeInTheDocument();
    expect(screen.queryByText('38.900, -120.900')).toBeNull();
  });

  it('gates precise-PII geometry: RESPONDER sees precise coords', () => {
    render(<MapFeatureList data={data} role="RESPONDER" />);
    expect(screen.getByText('38.900, -120.900')).toBeInTheDocument();
  });

  it('activating a row button selects the feature', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<MapFeatureList data={data} role="PUBLIC" onSelectFeature={onSelect} />);
    await user.click(screen.getByRole('button', { name: 'Focus Bear R.' }));
    expect(onSelect).toHaveBeenCalledWith('g1');
  });

  it('toFeatureRows produces one row per feature', () => {
    expect(toFeatureRows(data, 'PUBLIC')).toHaveLength(6);
    expect(toFeatureRows({}, 'PUBLIC')).toHaveLength(0);
  });
});

// ── S3·U3: rows for ALL 14 LAYER_IDS ───────────────────────────────────────────

/** A MapData populating every one of the 14 toggleable layers (a square ring for every polygon). */
const ring = [
  [-120.0, 38.0],
  [-120.1, 38.0],
  [-120.1, 38.1],
  [-120.0, 38.1],
  [-120.0, 38.0],
] as const;

const fullData: MapData = {
  ...data,
  storm: {
    track: [[-119.5, 37.5], [-119.6, 37.6]],
    cone: [ring],
    surge: [ring],
    agency: 'NHC',
    advisoryAt: '2026-07-05T21:00:00Z',
  },
  floodZones: [{ id: 'fz1', zone: 'AE', polygon: [ring] }],
  outage: [{ id: 'o1', polygon: [ring], customersOut: 1200 }],
  cell: [{ id: 'c1', position: [-120.5, 38.5], technology: 'LTE', online: false }],
  weather: {
    position: [-120.6, 38.6],
    speedKmh: 28,
    directionDeg: 210,
    compass: 'SW',
    observedAt: '2026-07-05T22:00:00Z',
    label: 'Wind 28 km/h from SW (210°), obs 2026-07-05T22:00:00Z',
  },
  cameras: [
    {
      id: 'cam1',
      position: [-120.7, 38.7],
      kind: 'FIRE_CAMERA',
      title: 'Ridge Cam 4',
      provider: 'ALERTCalifornia',
      viewUrl: 'https://cameras.example.org/ridge-4',
      isLive: true,
    },
  ],
  predictions: [
    { id: 'p1', polygon: [ring], method: 'wind-buffer first-order', inputs: 'NWS wind 15kt @ 210°', uncertainty: '±30% buffer' },
  ],
  route: { id: 'rt1', path: [[-120.8, 38.8], [-120.9, 38.9]], hazardAvoided: true },
};

/** layer id → the row-key prefix its rows carry (derived from the component's own `key` scheme). */
const ROW_KEY_PREFIX: Record<LayerId, string> = {
  fire: 'fire-',
  flood: 'gauge-',
  storm: 'storm-',
  floodzone: 'floodzone-',
  infra: 'infra-',
  outage: 'outage-',
  cell: 'cell-',
  weather: 'weather-',
  cameras: 'camera-',
  exposure: 'exp-',
  reports: 'report-',
  prediction: 'prediction-',
  route: 'route-',
  shelters: 'shelter-',
};

describe('MapFeatureList × 14 LAYER_IDS (S3·U3)', () => {
  it('every one of the 14 layer ids contributes at least one row when populated', () => {
    const keys = toFeatureRows(fullData, 'PUBLIC').map((r) => r.key);
    for (const id of LAYER_IDS) {
      const prefix = ROW_KEY_PREFIX[id];
      expect(keys.some((k) => k.startsWith(prefix)), `layer '${id}' must contribute a row`).toBe(true);
    }
  });

  it('an absent layer contributes NO row — and an all-empty dataset degrades to the labelled empty state', () => {
    // Absent slices (the base fixture has no Phase-D layers): none of the new prefixes may appear.
    const baseKeys = toFeatureRows(data, 'PUBLIC').map((r) => r.key);
    for (const id of ['storm', 'floodzone', 'outage', 'cell', 'weather', 'cameras', 'prediction', 'route'] as const) {
      expect(baseKeys.some((k) => k.startsWith(ROW_KEY_PREFIX[id]))).toBe(false);
    }
    // Empty (not just absent) slices degrade identically: no rows, never a fabricated one.
    const empties: MapData = {
      storm: {},
      floodZones: [],
      outage: [],
      cell: [],
      cameras: [],
      predictions: [],
      route: { id: 'rt0', path: [] },
    };
    expect(toFeatureRows(empties, 'PUBLIC')).toHaveLength(0);
    // And the component shows the SAME labelled empty state existing empty layers get.
    render(<MapFeatureList data={empties} role="PUBLIC" />);
    expect(screen.getByText('No map features in the current view.')).toBeInTheDocument();
  });

  it('renders the new rows with their honest labels/caveats (storm cone attributed, outage assumed, zone code)', () => {
    render(<MapFeatureList data={fullData} role="PUBLIC" />);
    const scoped = within(screen.getByTestId('map-feature-list'));
    // Storm family: one row per supplied geometry, cone caveat naming the issuing agency + advisory instant.
    expect(scoped.getByText('Cyclone centre track — advisory, not an impact area')).toBeInTheDocument();
    expect(scoped.getByText(/Forecast cone from NHC, advisory 2026-07-05T21:00:00Z/)).toBeInTheDocument();
    expect(scoped.getByText('Storm-surge extent — impact area, included in exposure')).toBeInTheDocument();
    // Flood zone: the NFHL code + the regulatory (not live) caveat.
    expect(scoped.getByText('Zone AE')).toBeInTheDocument();
    expect(scoped.getByText('Regulatory flood zones — not a live extent')).toBeInTheDocument();
    // Outage: the assumed-offline inference is labelled, with the deterministic count verbatim.
    expect(scoped.getByText('1200 customers out — ASSUMED offline')).toBeInTheDocument();
    // Cell: technology + online-state machine tokens.
    expect(scoped.getByText('LTE — OFFLINE')).toBeInTheDocument();
    // Weather: the observation's own composed label.
    expect(scoped.getByText('Wind 28 km/h from SW (210°), obs 2026-07-05T22:00:00Z')).toBeInTheDocument();
    // Camera: title + provider + LIVE token (link-only doctrine — no embedded player anywhere).
    expect(scoped.getByText('Ridge Cam 4')).toBeInTheDocument();
    expect(scoped.getByText('ALERTCalifornia — LIVE')).toBeInTheDocument();
    // Prediction: the cone's method/inputs/uncertainty sentence rides the row (labelled projection, T-367).
    expect(
      scoped.getByText('First-order wind-buffer first-order; inputs: NWS wind 15kt @ 210°; uncertainty: ±30% buffer.'),
    ).toBeInTheDocument();
    // Route: the engine's own avoidance claim as a machine token.
    expect(scoped.getByText('HAZARD-AVOIDED')).toBeInTheDocument();
  });

  it('every new row is keyboard-selectable like the existing six', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<MapFeatureList data={fullData} role="PUBLIC" onSelectFeature={onSelect} />);
    // 6 original + storm×3 + floodzone + outage + cell + weather + camera + prediction + route = 16 rows.
    expect(screen.getAllByRole('button', { name: /^Focus / })).toHaveLength(16);
    await user.click(screen.getByRole('button', { name: 'Focus Zone AE' }));
    expect(onSelect).toHaveBeenCalledWith('fz1');
    await user.click(screen.getByRole('button', { name: 'Focus Ridge Cam 4' }));
    expect(onSelect).toHaveBeenCalledWith('cam1');
  });
});
