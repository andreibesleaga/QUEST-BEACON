// @vitest-environment happy-dom
// BEACON — deploy-posture control tests (extracted component, 2026-08-25). Deterministic: pure props, no
// network. Covers BOTH build postures — the page-level gate is a prop precisely so the live branch (which
// no baseline or dev-default render ever reaches) is still machine-verified.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PostureControl } from './posture-control.js';

describe('PostureControl', () => {
  it('LIVE posture: green chip + a TEXT-ONLY current-role chip — and no role control at all', () => {
    render(<PostureControl live actorRole="PUBLIC" setRole={vi.fn()} />);
    expect(screen.getByTestId('posture-live')).toBeInTheDocument();
    // The role stays visible on a live deploy (it was previously shown only by the dev switcher)…
    expect(screen.getByTestId('actor-role')).toHaveTextContent('PUBLIC');
    // …but is display-only: on live there must be NO surface that could even ask for a role (F-344).
    expect(screen.queryByTestId('role-switcher')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('LIVE posture: the role chip tracks the signed-in account role', () => {
    render(<PostureControl live actorRole="EM" setRole={vi.fn()} />);
    expect(screen.getByTestId('actor-role')).toHaveTextContent('EM');
  });

  it('DEV posture: red DEV tag + the demo role switcher, which reports the chosen role', async () => {
    const setRole = vi.fn();
    const user = userEvent.setup();
    render(<PostureControl live={false} actorRole="PUBLIC" setRole={setRole} />);
    expect(screen.queryByTestId('posture-live')).not.toBeInTheDocument();
    expect(screen.queryByTestId('actor-role')).not.toBeInTheDocument(); // dropdown already shows the role
    await user.selectOptions(screen.getByTestId('role-switcher'), 'VERIFIER');
    expect(setRole).toHaveBeenCalledWith('VERIFIER');
  });
});
