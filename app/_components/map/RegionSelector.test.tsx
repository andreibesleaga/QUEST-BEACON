// @vitest-environment happy-dom
// BEACON — RegionSelector tests (E8·T-361/T-364c). Selecting a region sets activeRegionId (triggers reload);
// GIBS overlays are optional toggles WITH attribution shown.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useUiStore } from '../../_lib/store.js';
import { RegionSelector, GIBS_ATTRIBUTION } from './RegionSelector.js';

const regions = [
  { id: 'default', label: 'Default region' },
  { id: 'norcal', label: 'Northern California' },
];

beforeEach(() => {
  useUiStore.setState({ activeRegionId: 'default', selectedIncidentId: undefined });
});

describe('RegionSelector', () => {
  it('changing the selection sets activeRegionId in the store', async () => {
    const user = userEvent.setup();
    render(<RegionSelector regions={regions} />);
    expect(useUiStore.getState().activeRegionId).toBe('default');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Region' }), 'norcal');
    expect(useUiStore.getState().activeRegionId).toBe('norcal');
  });

  it('renders GIBS overlay toggles with attribution when a handler is provided', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(
      <RegionSelector
        regions={regions}
        enabledOverlays={['fires']}
        overlayDate="2026-07-07"
        onToggleOverlay={onToggle}
      />,
    );
    expect(screen.getByText(new RegExp(GIBS_ATTRIBUTION))).toBeInTheDocument();
    const fires = screen.getByRole('checkbox', { name: 'Active fires (VIIRS)' });
    expect(fires).toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: 'True color (VIIRS)' }));
    expect(onToggle).toHaveBeenCalledWith('truecolor');
  });

  it('omits the overlay controls when no handler is given', () => {
    render(<RegionSelector regions={regions} />);
    expect(screen.queryByText(new RegExp(GIBS_ATTRIBUTION))).toBeNull();
  });
});
