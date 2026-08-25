// @vitest-environment happy-dom
// BEACON — CopLayout tests (E8·T-350). Renders the map + both docked panels; the collapse control is
// keyboard-operable and hides its panel body (aria-expanded reflects state).
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CopLayout } from './cop-layout.js';

function renderLayout() {
  render(
    <CopLayout
      map={<div>MAP-SLOT</div>}
      sitrep={<div>SITREP-PANEL</div>}
      logistics={<div>LOGISTICS-PANEL</div>}
      toolbar={<button type="button">Region</button>}
    />,
  );
}

describe('CopLayout', () => {
  it('renders the map slot and both docked panels', () => {
    renderLayout();
    expect(screen.getByText('MAP-SLOT')).toBeInTheDocument();
    expect(screen.getByText('SITREP-PANEL')).toBeInTheDocument();
    expect(screen.getByText('LOGISTICS-PANEL')).toBeInTheDocument();
    expect(screen.getByRole('main', { name: /operating picture/i })).toBeInTheDocument();
  });

  it('collapse control is keyboard-operable and hides the panel body', async () => {
    const user = userEvent.setup();
    renderLayout();
    const collapse = screen.getByRole('button', { name: 'Collapse Situation Report' });
    expect(collapse).toHaveAttribute('aria-expanded', 'true');

    collapse.focus();
    expect(collapse).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(screen.getByRole('button', { name: 'Expand Situation Report' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByText('SITREP-PANEL')).not.toBeVisible();
  });
});
