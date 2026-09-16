// @vitest-environment happy-dom
// BEACON — ActMenu tests (E8·T-389). Keyboard-openable; exposes all three DRAFT/HITL-gated actions, each
// routing to its callback.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActMenu } from './act-menu.js';

function setup() {
  const onTaskResource = vi.fn();
  const onDrawRoute = vi.fn();
  const onCreateAlert = vi.fn();
  render(
    <ActMenu
      onTaskResource={onTaskResource}
      onDrawRoute={onDrawRoute}
      onCreateAlert={onCreateAlert}
    />,
  );
  return { onTaskResource, onDrawRoute, onCreateAlert };
}

describe('ActMenu', () => {
  it('opens from the keyboard and exposes all three actions', async () => {
    const user = userEvent.setup();
    setup();
    screen.getByRole('button', { name: 'Act' }).focus();
    await user.keyboard('{Enter}');

    expect(await screen.findByRole('menuitem', { name: /Task resource/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Draw evac route/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Create DRAFT alert/ })).toBeInTheDocument();
  });

  it('routes each action to its callback', async () => {
    const user = userEvent.setup();
    const { onCreateAlert } = setup();
    await user.click(screen.getByRole('button', { name: 'Act' }));
    await user.click(await screen.findByRole('menuitem', { name: /Create DRAFT alert/ }));
    expect(onCreateAlert).toHaveBeenCalledTimes(1);
  });
});
