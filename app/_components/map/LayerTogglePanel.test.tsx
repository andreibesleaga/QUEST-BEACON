// @vitest-environment happy-dom
// BEACON — LayerTogglePanel tests (E8·T-360). Keyboard-operable checkboxes drive useUiStore.toggleLayer;
// each row shows a FreshnessBadge and, where relevant, an honest caveat (outage county-granularity).
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LAYER_IDS, type LayerId } from '../../_lib/types.js';
import { useUiStore } from '../../_lib/store.js';
import { LayerTogglePanel } from './LayerTogglePanel.js';
import { LAYER_META } from './build-layers.js';
import type { MapData } from './types.js';

const NOW = Date.parse('2026-07-07T12:00:00Z');

const data: MapData = {
  freshness: {
    fire: { fetchedAt: '2026-07-07T11:59:00Z', mode: 'LIVE', cadenceSec: 300 },
    outage: { fetchedAt: '2026-07-07T11:00:00Z', mode: 'CACHED', cadenceSec: 900 },
  },
};

function resetStore(): void {
  const off = Object.fromEntries(LAYER_IDS.map((id) => [id, false])) as Record<LayerId, boolean>;
  useUiStore.setState({ layers: { ...off, fire: true }, actorRole: 'PUBLIC' });
}

describe('LayerTogglePanel', () => {
  beforeEach(resetStore);

  it('renders a checkbox per layer, checked to match the store', () => {
    render(<LayerTogglePanel data={data} now={NOW} />);
    const fire = screen.getByRole('checkbox', { name: LAYER_META.fire.label });
    expect(fire).toBeChecked();
    const flood = screen.getByRole('checkbox', { name: LAYER_META.flood.label });
    expect(flood).not.toBeChecked();
  });

  it('toggling a checkbox flips the store flag (keyboard/pointer)', async () => {
    const user = userEvent.setup();
    render(<LayerTogglePanel data={data} now={NOW} />);
    expect(useUiStore.getState().layers.flood).toBe(false);
    await user.click(screen.getByRole('checkbox', { name: LAYER_META.flood.label }));
    expect(useUiStore.getState().layers.flood).toBe(true);
  });

  it('shows a FreshnessBadge for layers that carry freshness', () => {
    render(<LayerTogglePanel data={data} now={NOW} />);
    // fire is LIVE + fresh → "Live"; outage is CACHED → "Stale"
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('Stale')).toBeInTheDocument();
  });

  it('surfaces the outage county-granularity caveat', () => {
    render(<LayerTogglePanel data={data} now={NOW} />);
    const note = screen.getByText(LAYER_META.outage.caveat as string);
    expect(note).toBeInTheDocument();
    expect(note).toHaveAttribute('role', 'note');
  });

  // ADR-032 §4/§6 + legend a11y: the storm row must be reachable by NAME (never colour-only) and its
  // "BEACON does not model storms" caveat must be in the accessible tree, not merely drawn on the map.
  it('offers the storm layer as a named, unchecked-by-default toggle with its honesty caveat', async () => {
    const user = userEvent.setup();
    render(<LayerTogglePanel data={data} now={NOW} />);
    const storm = screen.getByRole('checkbox', { name: LAYER_META.storm.label });
    expect(storm).not.toBeChecked();
    const note = screen.getByText(LAYER_META.storm.caveat as string);
    expect(note).toHaveAttribute('role', 'note');
    await user.click(storm);
    expect(useUiStore.getState().layers.storm).toBe(true);
  });
});

// WP-A4 (2026-08-05): the row must WRAP rather than clip when a nowrap freshness badge meets a long
// translated layer name in the ~256px popover. jsdom cannot measure overflow (F-413's lesson: presence
// is not reach), so this pins the layout CONTRACT — wrap on the row, min-width collapse on the name —
// and the browser gate (a11y layers scan + visual baselines) verifies the rendered result.
describe('LayerTogglePanel — badge/name overflow contract', () => {
  it('rows are wrap-enabled and the layer name may collapse below its intrinsic width', () => {
    render(<LayerTogglePanel />);
    const panel = screen.getByTestId('layer-toggle-panel');
    const row = panel.querySelector('li > div');
    expect(row?.className).toContain('flex-wrap');
    const name = row?.querySelector('label > span');
    expect(name?.className).toContain('min-w-0');
    expect(name?.className).toContain('break-words');
  });
});
